/**
 * Inventario de pruebas que faltan enteras en nuevo7 (sólo lectura):
 *
 *  1. Catálogo nacional RFEE (`ownRfeeCatalog` y las filas nacionales que sólo trae el
 *     catálogo con `owa=1`): fila celebrada sin ninguna prueba con su arma, género (o
 *     mixto), categoría y modalidad a ±2 días en ninguna fuente nacional. Cada hueco se
 *     clasifica: cubierto por la FIE, documento enlazado leído como otra prueba, sin
 *     documento publicado, Engarde sin datos, recuperado en `hechos/lote7-faltan`…
 *  2. Calendario de la app: pruebas de eventos ya terminados sin prueba equivalente.
 *  3. FIE por equipos sin clasificación.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-faltan-huecos.ts [--db <nuevo7.sqlite>] [--salida <json>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { CARPETA_ENGARDE, enlaceEngarde, type FilaInventario } from './engarde-descargar';
import { abrirNuevo7, dia, INVENTARIO_NACIONAL, NUEVO7, SALIDA_LOTE7 } from './lote7-faltan-comun';

export type PruebaBase = { source: string; key: string; weapon: string; gender: string; category: string; format: string; d: number; url: string | null; resultados: number };

export type Clase =
  | 'cubierta'
  | 'cubierta_fie'
  | 'recuperada_lote7'
  | 'documento_en_otra_prueba'
  | 'engarde_sin_datos'
  | 'sin_documento'
  | 'pendiente';

const NACIONALES = new Set(['rfee_pdf', 'skermo_rfee', 'engarde']);
const NOMBRE_NACIONAL = /\b(TNR|TLM|CAMPEONATO DE ESPA\S*|CTO\.? ESPA\S*|LIGA|CRITERIUM|FENCING FOR EVERYONE|SILLA|COPA DEL REY|COPA DE LA REINA|NACIONAL)(?![A-Z0-9])/i;

export function compatibles(p: Pick<PruebaBase, 'weapon' | 'gender' | 'category' | 'format' | 'd'>, f: { arma: string | null; genero: string | null; categoria: string | null; formato: string | null; fecha: string | null }, margen = 2): boolean {
  if (!f.fecha || p.weapon !== f.arma || p.category !== f.categoria || p.format !== f.formato) return false;
  if (p.gender !== f.genero && p.gender !== 'MIXTO' && f.genero !== 'MIXTO') return false;
  return Math.abs(p.d - dia(f.fecha)) <= margen;
}

/** Identificador de 32 hex de un PDF de Skermo (`client/1/<id>.pdf`). */
export const idPdf = (url: string): string | null => /\/([0-9a-f]{32})\.pdf/i.exec(url)?.[1]?.toLowerCase() ?? null;

export function clasificarFila(
  f: FilaInventario,
  pruebas: readonly PruebaBase[],
  docs: ReadonlyMap<string, PruebaBase[]>,
  recuperadas: readonly PruebaBase[],
  engardeSinDatos: ReadonlySet<string>,
): { clase: Clase; detalle: string | null } {
  const nac = pruebas.filter((p) => NACIONALES.has(p.source) && compatibles(p, f));
  if (nac.length > 0) return { clase: 'cubierta', detalle: nac.map((p) => `${p.source}:${p.key}`).slice(0, 3).join(' ') };
  const fie = pruebas.filter((p) => p.source === 'fie' && compatibles(p, f));
  if (fie.length > 0) return { clase: 'cubierta_fie', detalle: fie.map((p) => `fie:${p.key}`).join(' ') };
  const rec = recuperadas.filter((p) => compatibles(p, f));
  if (rec.length > 0) return { clase: 'recuperada_lote7', detalle: rec.map((p) => `${p.source}:${p.key}`).join(' ') };
  const otras = f.enlaces.map((e) => idPdf(e.url)).filter((x): x is string => !!x).flatMap((id) => (docs.get(id) ?? []).map((p) => ({ id, p })));
  if (otras.length > 0) {
    return { clase: 'documento_en_otra_prueba', detalle: otras.map(({ id, p }) => `${id.slice(0, 8)}→${p.weapon} ${p.gender} ${p.category} ${p.format} ${new Date(p.d * 86_400_000).toISOString().slice(0, 10)}`).join('; ') };
  }
  const eg = f.enlaces.map((e) => enlaceEngarde(e.url)).filter((e) => e.tipo === 'torneo') as { org: string; evt: string }[];
  if (eg.length > 0 && eg.every((e) => engardeSinDatos.has(`${e.org}/${e.evt}`.toLowerCase()))) {
    return { clase: 'engarde_sin_datos', detalle: eg.map((e) => `${e.org}/${e.evt}`).join(' ') };
  }
  if (f.enlaces.length === 0) return { clase: 'sin_documento', detalle: null };
  return { clase: 'pendiente', detalle: f.enlaces.map((e) => `${e.tipo}:${e.url}`).join(' ') };
}

export function pruebasDeBase(db: ReturnType<typeof abrirNuevo7>): PruebaBase[] {
  return (db.prepare(`
    SELECT c.source, c.competition_key k, c.weapon, c.gender, c.category, c.format, coalesce(c.competition_date, e.start_date) f,
           coalesce(c.source_url, e.source_url) u,
           (SELECT count(*) FROM sport_result r WHERE r.competition_id = c.id) n
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE coalesce(c.competition_date, e.start_date) IS NOT NULL`).all() as Record<string, string | number | null>[])
    .map((r) => ({
      source: String(r.source), key: String(r.k), weapon: String(r.weapon), gender: String(r.gender), category: String(r.category),
      format: String(r.format), d: dia(String(r.f)), url: r.u === null ? null : String(r.u), resultados: Number(r.n),
    }));
}

/** Pruebas ya escritas en `hechos/lote7-faltan` por los extractores de este lote. */
export function pruebasRecuperadas(carpeta = SALIDA_LOTE7): PruebaBase[] {
  if (!existsSync(carpeta)) return [];
  const out: PruebaBase[] = [];
  for (const f of readdirSync(carpeta)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const h = JSON.parse(readFileSync(join(carpeta, f), 'utf8')) as HechosPrueba;
    const fecha = h.competition.date ?? h.edition.startDate;
    if (!fecha) continue;
    out.push({
      source: h.source, key: h.competition.competitionKey, weapon: h.competition.weapon, gender: h.competition.gender,
      category: h.competition.category, format: h.competition.format, d: dia(fecha), url: h.sourceUrl, resultados: h.results.length,
    });
  }
  return out;
}

/** Torneos de Engarde de la caché nacional cuya página sólo dice «This competition currently has no data» o cuyo índice está vacío. */
export function engardeSinDatos(raiz: string): Set<string> {
  const s = new Set<string>();
  const registro = join(raiz, 'raw', '_registro.jsonl');
  if (!existsSync(registro)) return s;
  const porTorneo = new Map<string, { con: number; sin: number }>();
  for (const l of readFileSync(registro, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as { clave: string; status: number; fichero: string | null };
    const [org, evt, compe, pagina] = r.clave.split('/');
    const k = `${org}/${evt}`.toLowerCase();
    const t = porTorneo.get(k) ?? { con: 0, sin: 0 };
    porTorneo.set(k, t);
    if (!r.fichero || r.status !== 200) continue;
    const cuerpo = readFileSync(join(raiz, 'raw', r.fichero), 'utf8');
    if (compe === '_torneo' && pagina === 'indice-p1.xml') {
      if (!/<comp\b/.test(cuerpo)) t.sin += 1;
    } else if (pagina === 'clasfinal.htm' || pagina === 'prueba.html') {
      if (/currently has no data/i.test(cuerpo)) t.sin += 1;
      else if (/table class="liste"[\s\S]*?<td/i.test(cuerpo)) t.con += 1;
    }
  }
  for (const [k, t] of porTorneo) if (t.sin > 0 && t.con === 0) s.add(k);
  return s;
}

export type FilaHueco = {
  temporada: string; fecha: string; arma: string | null; genero: string | null; categoria: string | null; formato: string | null;
  nombre: string; claveCatalogo: string; catalogo: 'propio' | 'owa'; clase: Clase; detalle: string | null;
  enlaces: FilaInventario['enlaces'];
};

export function huecosCatalogo(
  inv: { ownRfeeCatalog: FilaInventario[]; catalog: FilaInventario[] },
  pruebas: readonly PruebaBase[],
  recuperadas: readonly PruebaBase[],
  sinDatos: ReadonlySet<string>,
  hoy: string,
): FilaHueco[] {
  const docs = new Map<string, PruebaBase[]>();
  for (const p of pruebas) {
    for (const t of [p.key, p.url ?? '']) {
      const id = /([0-9a-f]{32})/i.exec(t)?.[1]?.toLowerCase();
      if (id && p.source === 'rfee_pdf') (docs.get(id) ?? docs.set(id, []).get(id)!).push(p);
    }
  }
  // `claveCatalogo` numera las filas de cada índice por separado (`fila:RFEE:73` no es la misma
  // prueba en los dos), así que la misma fila se reconoce por su contenido.
  const contenido = (f: FilaInventario) => [f.temporada, f.nombre, f.fecha, f.arma, f.genero, f.categoria, f.formato].join('|');
  const propias = new Set(inv.ownRfeeCatalog.map(contenido));
  const filas = [
    ...inv.ownRfeeCatalog.map((f) => ({ f, catalogo: 'propio' as const })),
    ...inv.catalog.filter((f) => !propias.has(contenido(f)) && NOMBRE_NACIONAL.test(f.nombre)).map((f) => ({ f, catalogo: 'owa' as const })),
  ];
  const out: FilaHueco[] = [];
  for (const { f, catalogo } of filas) {
    if (!f.fecha || f.fecha >= hoy || /CANCELAD|APLAZAD|SUSPENDID/i.test(f.nombre)) continue;
    const { clase, detalle } = clasificarFila(f, pruebas, docs, recuperadas, sinDatos);
    if (clase === 'cubierta') continue;
    out.push({
      temporada: f.temporada, fecha: f.fecha, arma: f.arma, genero: f.genero, categoria: f.categoria, formato: f.formato,
      nombre: f.nombre, claveCatalogo: f.claveCatalogo, catalogo, clase, detalle, enlaces: f.enlaces,
    });
  }
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

export function huecosCalendario(db: ReturnType<typeof abrirNuevo7>, pruebas: readonly PruebaBase[], recuperadas: readonly PruebaBase[], hoy: string) {
  const filas = db.prepare(`
    SELECT e.source, e.scope, e.circuit, e.name, e.city, e.country, e.start_date, ec.weapon, ec.gender, ec.category, ec.format,
           coalesce(ec.competition_date, e.start_date) fecha, ec.source_id
      FROM event e JOIN event_competition ec ON ec.event_id = e.id
     WHERE e.end_date < ? AND e.cancelled = 0`).all(hoy) as Record<string, string | null>[];
  const out: Record<string, unknown>[] = [];
  for (const r of filas) {
    const fila = { arma: r.weapon, genero: r.gender, categoria: r.category, formato: r.format, fecha: r.fecha };
    const con = pruebas.filter((p) => compatibles(p, fila));
    const conResultados = con.filter((p) => p.resultados > 0);
    const rec = recuperadas.filter((p) => compatibles(p, fila));
    if (conResultados.length > 0) continue;
    out.push({
      fuente: r.source, ambito: r.scope, circuito: r.circuit, nombre: r.name, lugar: `${r.city ?? ''} ${r.country ?? ''}`.trim(),
      fecha: r.fecha, prueba: `${r.weapon} ${r.gender} ${r.category} ${r.format}`, sourceId: r.source_id,
      estado: rec.length > 0 ? 'recuperada_lote7' : con.length > 0 ? 'existe_sin_resultados' : 'falta',
    });
  }
  return out;
}

function contar<T>(xs: readonly T[], k: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) m[k(x)] = (m[k(x)] ?? 0) + 1;
  return m;
}

function main(): void {
  const hoy = argumento('hoy', new Date().toISOString().slice(0, 10));
  const db = abrirNuevo7(argumento('db', NUEVO7));
  const inv = JSON.parse(readFileSync(argumento('inventario', INVENTARIO_NACIONAL), 'utf8'));
  const pruebas = pruebasDeBase(db);
  const recuperadas = pruebasRecuperadas();
  const sinDatos = engardeSinDatos(CARPETA_ENGARDE);
  const catalogo = huecosCatalogo(inv, pruebas, recuperadas, sinDatos, hoy);
  const calendario = huecosCalendario(db, pruebas, recuperadas, hoy);
  const equipos = db.prepare(`
    SELECT c.season, count(*) n FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND c.format = 'EQUIPOS' AND coalesce(c.competition_date, e.start_date) < ?
       AND NOT EXISTS (SELECT 1 FROM sport_result r WHERE r.competition_id = c.id) GROUP BY c.season`).all(hoy);
  db.close();
  const recuperadasFie = recuperadas.filter((p) => p.source === 'fie' && p.format === 'EQUIPOS').length;
  const informe = {
    generado: new Date().toISOString(), hoy,
    catalogo: {
      huecos: catalogo.length,
      porClase: contar(catalogo, (f) => f.clase),
      porClaseYCatalogo: contar(catalogo, (f) => `${f.catalogo}:${f.clase}`),
      porTemporadaYClase: contar(catalogo, (f) => `${f.temporada}:${f.clase}`),
      filas: catalogo,
    },
    calendario: {
      pruebasSinResultados: calendario.length,
      porEstado: contar(calendario, (f) => String(f.estado)),
      porFuenteYCircuito: contar(calendario, (f) => `${f.fuente}:${f.circuito}:${f.estado}`),
      filas: calendario,
    },
    fieEquiposSinClasificacion: { porTemporada: equipos, recuperadasLote7: recuperadasFie },
  };
  const salida = argumento('salida', join(SALIDA_LOTE7, '_informe-huecos.json'));
  writeFileSync(salida, `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify({ ...informe, catalogo: { ...informe.catalogo, filas: undefined, porTemporadaYClase: undefined }, calendario: { ...informe.calendario, filas: undefined } }, null, 1));
  console.log(`Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
