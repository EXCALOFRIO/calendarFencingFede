/**
 * Descarga y lee la ficha FIE (`/api/fie/fencer/<id>`) de los tiradores con ID
 * FIE confirmado en una copia SQLite, y escribe `perfiles/fie-atletas.jsonl`.
 *
 *   npx tsx scripts/indexado/fie-atletas.ts [--db <copia.sqlite>] [--desde 2010]
 *     [--solo-esp] [--limite N] [--concurrencia 4] [--pausa-ms 350]
 *     [--cache <dir>] [--salida <fichero.jsonl>] [--sin-red]
 *     [--excluir <fie-atletas-anterior.jsonl>] [--intervalo-ms 0]
 *
 * `--excluir` deja fuera los IDs FIE ya leídos en otro fichero (sólo las
 * personas nuevas). `--intervalo-ms` impone una separación mínima entre dos
 * peticiones cualesquiera, también con varios hilos. User-Agent:
 * INGEST_USER_AGENT (entorno o `.env`).
 *
 * Educado con la FIE: como mucho 4 peticiones a la vez, pausa entre peticiones
 * de cada hilo y caché de la respuesta cruda (gzip) por ID: una segunda pasada
 * no vuelve a pedir nada. Un 404 se cachea como definitivo; un 5xx o un corte
 * de red no, y se reintenta en la siguiente ejecución. Se puede interrumpir y
 * relanzar: retoma por donde iba. `--sin-red` sólo relee la caché.
 *
 * Orden: primero los españoles, luego el resto por resultado más reciente.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { leerAtletaFie, type AtletaFie } from './perfiles-fie';

const API = 'https://fie.org/api/fie/fencer';
const AGENTE = 'calendario-esgrima/1.0 (perfiles; contacto en la app)';
const MAX_CONCURRENCIA = 4;

export type ObjetivoFie = { fieId: number; personaId: string; pais: string | null; ultimo: string | null };

export function objetivosFie(db: DatabaseSync, desde: string, soloEsp: boolean): ObjetivoFie[] {
  const filas = db.prepare(`
    WITH canon AS (
      SELECT p.id, coalesce(m2.id, m1.id, p.id) AS c
      FROM sport_person p
      LEFT JOIN sport_person m1 ON m1.id = p.merged_into_person_id
      LEFT JOIN sport_person m2 ON m2.id = m1.merged_into_person_id
    ), ids AS (
      SELECT DISTINCT CAST(x.value AS INTEGER) AS fie_id, canon.c AS persona, x.person_id AS miembro
      FROM sport_external_id x JOIN canon ON canon.id = x.person_id
      WHERE x.scheme = 'fie_addr_id' AND x.scope_source = 'fie' AND x.link_status = 'CONFIRMADO'
        AND x.value GLOB '[1-9]*'
    )
    SELECT ids.fie_id AS fieId, ids.persona AS personaId, cp.country_code AS pais,
           max(coalesce(r.occurred_on, c.competition_date, e.start_date)) AS ultimo
    FROM ids
    JOIN sport_person cp ON cp.id = ids.persona
    JOIN sport_person mm ON mm.merged_into_person_id = ids.persona OR mm.id = ids.persona
    JOIN sport_result r ON r.person_id = mm.id
    JOIN sport_competition c ON c.id = r.competition_id
    JOIN sport_edition e ON e.id = c.edition_id
    GROUP BY ids.fie_id, ids.persona
    HAVING ultimo >= ?`).all(desde) as ObjetivoFie[];
  // Un ID FIE en dos personas canónicas es un conflicto de identidad: no se atribuye a ninguna.
  const porId = new Map<number, ObjetivoFie[]>();
  for (const f of filas) porId.set(f.fieId, [...(porId.get(f.fieId) ?? []), f]);
  const unicos = [...porId.values()].filter((v) => v.length === 1).map((v) => v[0]);
  return unicos
    .filter((f) => !soloEsp || f.pais === 'ESP')
    .sort((a, b) =>
      Number(b.pais === 'ESP') - Number(a.pais === 'ESP') ||
      String(b.ultimo ?? '').localeCompare(String(a.ultimo ?? '')) || a.fieId - b.fieId);
}

/** IDs FIE ya leídos en un `fie-atletas*.jsonl` anterior (para `--excluir`). */
export function idsEnJsonl(texto: string): Set<number> {
  const ids = new Set<number>();
  for (const l of texto.split(/\r?\n/)) {
    if (!l.trim()) continue;
    const id = Number((JSON.parse(l) as { fieId?: unknown }).fieId);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/**
 * Separación mínima entre el inicio de dos peticiones cualesquiera, sea cual
 * sea el hilo: la pausa de cada hilo sola no la garantiza con varios hilos.
 */
export function crearCompuerta(intervaloMs: number, reloj = Date.now, dormir = esperar) {
  let proxima = 0;
  return async () => {
    const ahora = reloj();
    const turno = Math.max(ahora, proxima);
    proxima = turno + intervaloMs;
    if (turno > ahora) await dormir(turno - ahora);
  };
}

function agenteRed(): string {
  if (process.env.INGEST_USER_AGENT) return process.env.INGEST_USER_AGENT;
  const ruta = resolve(import.meta.dirname ?? '.', '../../.env');
  if (existsSync(ruta)) {
    for (const l of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
      const m = /^INGEST_USER_AGENT\s*=\s*(.*)$/.exec(l);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return AGENTE;
}

type Cacheado = { estado: number; cuerpo: string | null };

function rutaCache(dir: string, fieId: number) {
  return join(dir, String(fieId % 100).padStart(2, '0'), `${fieId}.json.gz`);
}

function leerCache(dir: string, fieId: number): Cacheado | null {
  const ruta = rutaCache(dir, fieId);
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(gunzipSync(readFileSync(ruta)).toString('utf8')) as Cacheado;
  } catch {
    return null;
  }
}

function guardarCache(dir: string, fieId: number, valor: Cacheado) {
  const ruta = rutaCache(dir, fieId);
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, gzipSync(JSON.stringify(valor)));
  renameSync(tmp, ruta);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pedir(fieId: number, agente: string): Promise<Cacheado | { transitorio: string }> {
  try {
    const res = await fetch(`${API}/${fieId}`, {
      headers: { Accept: 'application/json', 'User-Agent': agente },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404 || res.status === 410) return { estado: res.status, cuerpo: null };
    if (!res.ok) return { transitorio: `HTTP ${res.status}` };
    return { estado: 200, cuerpo: await res.text() };
  } catch (e) {
    return { transitorio: e instanceof Error ? e.message : String(e) };
  }
}

export type FilaFieAtleta = AtletaFie & { personaId: string };

async function main() {
  const db = argumento('db', join(CARPETA_TRABAJO, 'perfiles.sqlite'));
  const desde = argumento('desde', '2010');
  const soloEsp = bandera('solo-esp');
  const limite = Number(argumento('limite', '0'));
  const concurrencia = Math.min(MAX_CONCURRENCIA, Math.max(1, Number(argumento('concurrencia', '4'))));
  const pausa = Math.max(100, Number(argumento('pausa-ms', '350')));
  const cache = resolve(argumento('cache', join(CARPETA_TRABAJO, 'cache-fie-atletas')));
  const salida = resolve(argumento('salida', join(CARPETA_TRABAJO, 'perfiles', 'fie-atletas.jsonl')));
  const sinRed = bandera('sin-red');
  const excluir = argumento('excluir', '');
  const intervalo = Math.max(0, Number(argumento('intervalo-ms', '0')));
  const agente = agenteRed();
  const turno = crearCompuerta(intervalo);
  mkdirSync(cache, { recursive: true });
  mkdirSync(dirname(salida), { recursive: true });

  const base = new DatabaseSync(db, { readOnly: true });
  let objetivos = objetivosFie(base, desde, soloEsp);
  base.close();
  if (excluir) {
    const ya = idsEnJsonl(readFileSync(resolve(excluir), 'utf8'));
    objetivos = objetivos.filter((o) => !ya.has(o.fieId));
    console.log(`excluidos por ${excluir}: ${ya.size} IDs ya leídos`);
  }
  if (limite > 0) objetivos = objetivos.slice(0, limite);
  console.log(`objetivos: ${objetivos.length} (${objetivos.filter((o) => o.pais === 'ESP').length} ESP)`);

  const stats = { cache: 0, descargados: 0, noExiste: 0, transitorios: 0, invalidos: 0, leidos: 0 };
  const errores: string[] = [];
  let siguiente = 0;
  const inicio = Date.now();

  async function hilo() {
    while (siguiente < objetivos.length) {
      const o = objetivos[siguiente++];
      if (leerCache(cache, o.fieId)) { stats.cache += 1; continue; }
      if (sinRed) continue;
      await turno();
      const r = await pedir(o.fieId, agente);
      if ('transitorio' in r) {
        stats.transitorios += 1;
        if (errores.length < 20) errores.push(`${o.fieId}: ${r.transitorio}`);
        // Ante errores seguidos, se frena en vez de insistir.
        await esperar(pausa * 6);
        continue;
      }
      guardarCache(cache, o.fieId, r);
      if (r.estado === 200) stats.descargados += 1; else stats.noExiste += 1;
      const hechos = stats.descargados + stats.noExiste;
      if (hechos % 250 === 0) {
        const seg = (Date.now() - inicio) / 1000;
        console.log(`  ${hechos} descargadas en ${seg.toFixed(0)} s (${(hechos / seg).toFixed(1)}/s), cache ${stats.cache}, transitorios ${stats.transitorios}`);
      }
      await esperar(pausa);
    }
  }
  await Promise.all(Array.from({ length: concurrencia }, hilo));

  const tmp = `${salida}.tmp`;
  writeFileSync(tmp, '');
  for (const o of objetivos) {
    const c = leerCache(cache, o.fieId);
    if (!c || c.estado !== 200 || !c.cuerpo) continue;
    let atleta: AtletaFie | null = null;
    try {
      atleta = leerAtletaFie(JSON.parse(c.cuerpo), o.fieId);
    } catch {
      atleta = null;
    }
    if (!atleta) { stats.invalidos += 1; continue; }
    stats.leidos += 1;
    const fila: FilaFieAtleta = { personaId: o.personaId, ...atleta };
    appendFileSync(tmp, `${JSON.stringify(fila)}\n`);
  }
  renameSync(tmp, salida);
  console.log(JSON.stringify({ salida, ...stats, errores }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
