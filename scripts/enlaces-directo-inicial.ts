/**
 * Carga inicial de los enlaces «En directo / Resultados» del calendario.
 *
 *   npx tsx scripts/enlaces-directo-inicial.ts [--db <sqlite>] [--salida <carpeta>] [--sin-red]
 *
 * Lee la copia de producción en SÓLO LECTURA y escribe un `.sql` para aplicar
 * a mano en D1 después de `drizzle-d1/0008_enlaces_directo.sql`. No escribe en
 * ninguna base.
 *
 *  - FIE: `livestreamResultsLink` de `/api/fie/competition/<temporada>/<id>`
 *    de cada prueba FIE del calendario (casi siempre Fencing Time Live).
 *  - Engarde: la cuenta de la RFEE (`prog/getTournois.php`, organismo `rfee`)
 *    y el índice de cada torneo, emparejados por fecha ±1, ciudad y prueba.
 *
 * Cada respuesta queda en la caché `cache-enlaces-directo`; con `--sin-red`
 * sólo se usa la caché. Peticiones secuenciales, ≥600 ms por host.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { esPortada, normalizarUrlDirecto, proveedorDeUrl } from '../src/lib/calendario/enlaces-directo';
import {
  emparejarTorneoEngarde,
  parsearListaTorneosEngarde,
  sinTorneoAmbiguo,
  type PruebaCalendarioDirecto,
} from '../src/lib/ingest/enlaces-directo-engarde';
import { ENGARDE_BASE, ENGARDE_INDICE, formularioIndice, parsearIndiceEngarde, type PruebaEngarde } from '../src/lib/ingest/sources/engarde';

const TRABAJO = join(homedir(), 'calendario-datos', 'calendario-trabajo');
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DB = arg('db', join(TRABAJO, 'nuevo7.sqlite'));
const SALIDA = arg('salida', join(TRABAJO, 'enlaces-directo'));
const CACHE = join(TRABAJO, 'cache-enlaces-directo');
const SIN_RED = process.argv.includes('--sin-red');
const UA = process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)';

mkdirSync(CACHE, { recursive: true });
mkdirSync(SALIDA, { recursive: true });

const ultimo = new Map<string, number>();
async function pedir(url: string, formulario?: Record<string, string>): Promise<{ status: number; body: string }> {
  const clave = createHash('sha1')
    .update(url + (formulario ? `#${new URLSearchParams(formulario)}` : ''))
    .digest('hex')
    .slice(0, 16);
  const fichero = join(CACHE, clave);
  if (existsSync(fichero)) {
    const c = JSON.parse(readFileSync(fichero, 'utf8')) as { status: number; body: string };
    if (c.status === 200 || SIN_RED) return c;
  }
  if (SIN_RED) return { status: 0, body: '' };
  const host = new URL(url).host;
  const espera = (ultimo.get(host) ?? 0) + 700 - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimo.set(host, Date.now());
  const res = await fetch(url, {
    method: formulario ? 'POST' : 'GET',
    headers: {
      'User-Agent': UA,
      ...(formulario ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: formulario ? new URLSearchParams(formulario).toString() : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const salida = { url, form: formulario ?? null, status: res.status, body: await res.text(), en: new Date().toISOString() };
  writeFileSync(fichero, JSON.stringify(salida));
  appendFileSync(join(CACHE, '_registro.jsonl'), `${JSON.stringify({ url, form: formulario ?? null, status: salida.status, fichero: clave, en: salida.en })}\n`);
  return salida;
}

type Fila = {
  eventId: string;
  competitionId: string | null;
  url: string;
  regla: string;
};

const db = new DatabaseSync(DB, { readOnly: true });

const calendario = (
  db
    .prepare(
      `SELECT c.id competitionId, c.event_id eventId, c.weapon, c.gender, c.category, c.format,
              substr(coalesce(c.competition_date, e.start_date), 1, 10) fecha, e.city ciudad, e.country pais, e.circuit
         FROM event_competition c JOIN event e ON e.id = c.event_id
        WHERE e.disappeared_at IS NULL AND e.canonical_event_id IS NULL`,
    )
    .all() as PruebaCalendarioDirecto[]
);

const filas: Fila[] = [];
const notas: string[] = [];

async function fie(): Promise<void> {
  const eventos = db
    .prepare(
      `SELECT e.id eventId, e.source_id sourceId,
              (SELECT group_concat(c.id) FROM event_competition c WHERE c.event_id = e.id) comps
         FROM event e WHERE e.source = 'fie' AND e.disappeared_at IS NULL AND e.source_id LIKE 'fie-____-%'`,
    )
    .all() as { eventId: string; sourceId: string; comps: string | null }[];
  let conEnlace = 0;
  let fallos = 0;
  for (const e of eventos) {
    const [, season, id] = e.sourceId.split('-');
    const r = await pedir(`https://fie.org/api/fie/competition/${season}/${id}`);
    if (r.status !== 200) {
      fallos += 1;
      continue;
    }
    let meta: { livestreamResultsLink?: string | null; competitionId?: number };
    try {
      meta = JSON.parse(r.body);
    } catch {
      fallos += 1;
      continue;
    }
    if (String(meta.competitionId) !== id) {
      fallos += 1;
      continue;
    }
    const url = normalizarUrlDirecto(meta.livestreamResultsLink);
    if (!url || esPortada(url)) continue;
    const comps = (e.comps ?? '').split(',').filter(Boolean);
    conEnlace += 1;
    filas.push({
      eventId: e.eventId,
      competitionId: comps.length === 1 ? comps[0] : null,
      url,
      regla: 'fie_competicion',
    });
  }
  notas.push(`FIE: ${eventos.length} pruebas del calendario, ${conEnlace} con enlace publicado, ${fallos} sin respuesta`);
}

async function engarde(): Promise<void> {
  const desde = (db.prepare(`SELECT min(start_date) d FROM event WHERE disappeared_at IS NULL`).get() as { d: string }).d;
  const torneos: { evt: string; titulo: string; fecha: string }[] = [];
  for (let pagina = 1; pagina <= 3; pagina += 1) {
    const r = await pedir(`${ENGARDE_BASE}/prog/getTournois.php`, {
      option: 'tournois', organism: 'rfee', nrows: '50', order: 'desc', page: String(pagina),
    });
    const lista = r.status === 200 ? parsearListaTorneosEngarde(r.body, 'rfee') : null;
    if (!lista || lista.length === 0) break;
    torneos.push(...lista);
    if (lista[lista.length - 1].fecha < desde) break;
  }
  const mirar = torneos.filter((t) => t.fecha >= desde);
  const deEngarde: Fila[] = [];
  let emparejados = 0;
  for (const t of mirar) {
    const pruebas: PruebaEngarde[] = [];
    for (let pagina = 1, paginas = 1; pagina <= Math.min(paginas, 3); pagina += 1) {
      const r = await pedir(ENGARDE_INDICE, formularioIndice('rfee', t.evt, pagina));
      const indice = r.status === 200 ? parsearIndiceEngarde(r.body) : null;
      if (!indice || !indice.ok) break;
      paginas = indice.paginas;
      pruebas.push(...indice.pruebas.filter((p) => !pruebas.some((q) => q.compe === p.compe)));
    }
    const { enlaces, sinPareja, ambiguas } = emparejarTorneoEngarde(pruebas, calendario);
    if (enlaces.length > 0) emparejados += 1;
    notas.push(
      `  engarde rfee/${t.evt} ${t.fecha} «${t.titulo}»: ${pruebas.length} pruebas, ` +
        `${enlaces.filter((e) => e.competitionId).length} emparejadas, ${sinPareja} sin pareja, ${ambiguas} ambiguas`,
    );
    for (const e of enlaces) deEngarde.push({ eventId: e.eventId, competitionId: e.competitionId, url: e.url, regla: e.regla });
  }
  filas.push(...sinTorneoAmbiguo(deEngarde));
  notas.push(`Engarde RFEE: ${torneos.length} torneos listados, ${mirar.length} desde ${desde}, ${emparejados} con pareja`);
}

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

function sqlDe(f: Fila): string {
  const plataforma = proveedorDeUrl(f.url);
  const comp = f.competitionId === null ? 'IS NULL' : `= ${q(f.competitionId)}`;
  return (
    `INSERT INTO live_source (event_id, event_competition_id, platform, kind, url, label, is_automatic, match_rule)\n` +
    `SELECT ${q(f.eventId)}, ${q(f.competitionId)}, ${q(plataforma)}, 'resultados', ${q(f.url)}, NULL, 1, ${q(f.regla)}\n` +
    ` WHERE EXISTS (SELECT 1 FROM event WHERE id = ${q(f.eventId)})\n` +
    (f.competitionId ? `   AND EXISTS (SELECT 1 FROM event_competition WHERE id = ${q(f.competitionId)})\n` : '') +
    `   AND NOT EXISTS (SELECT 1 FROM live_source WHERE event_id = ${q(f.eventId)} AND event_competition_id ${comp} AND url = ${q(f.url)});`
  );
}

await fie();
await engarde();

const unicas = [...new Map(filas.map((f) => [`${f.eventId}|${f.competitionId ?? ''}|${f.url}`, f])).values()];
const cuerpo = [
  '-- Enlaces «En directo / Resultados» iniciales. Aplicar DESPUÉS de drizzle-d1/0008_enlaces_directo.sql.',
  `-- Generado por scripts/enlaces-directo-inicial.ts el ${new Date().toISOString()} sobre una copia de sólo lectura.`,
  '-- Idempotente: cada fila comprueba que el evento y la prueba existen y que el enlace no está ya.',
  ...unicas.map(sqlDe),
  '',
].join('\n');
writeFileSync(join(SALIDA, '01_enlaces_directo_inicial.sql'), cuerpo);
writeFileSync(join(SALIDA, 'enlaces-directo-inicial.json'), JSON.stringify(unicas, null, 1));

const porProveedor: Record<string, number> = {};
for (const f of unicas) {
  const k = `${proveedorDeUrl(f.url)} ${f.competitionId ? 'prueba' : 'torneo'} ${f.regla}`;
  porProveedor[k] = (porProveedor[k] ?? 0) + 1;
}
console.log(notas.join('\n'));
console.log(porProveedor);
console.log(`${unicas.length} filas -> ${join(SALIDA, '01_enlaces_directo_inicial.sql')}`);
