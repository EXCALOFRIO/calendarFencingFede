import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { abrirBase, puestosDeBase, type PruebaBase, type PuestoBase } from './fie-completar-comun';
import { consistenciaCuadro } from './cuadro-consistencia';

/**
 * Piezas comunes de los lectores `lote10-fie-*`: pruebas FIE de nuevo9 a las
 * que les falta una fase, cabecera de hechos con las claves existentes y
 * validaciones de asaltos contra la clasificación oficial guardada.
 *
 * Los ficheros llevan `results: []` (con estado `parcial`, que el cargador no
 * elige para la sección de puestos): sólo completan asaltos de pruebas que ya
 * están en la base, con las referencias `source_fact_key` de su clasificación.
 */

export { abrirBase, puestosDeBase, type PruebaBase, type PuestoBase };

export const HOY = '2026-10-07';

/** Pruebas FIE celebradas con sus recuentos de puestos y asaltos por fase (cualquier modalidad). */
export function pruebasFie(db: DatabaseSync, filtro: { desde?: number; hasta?: number; formato?: 'INDIVIDUAL' | 'EQUIPOS' } = {}): PruebaBase[] {
  const filas = db.prepare(`
    WITH c AS (
      SELECT c.*, e.tournament_key, e.name ename, e.start_date, e.end_date, e.city, e.country_code
        FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
       WHERE c.source = 'fie' AND CAST(c.season AS INTEGER) BETWEEN ? AND ? AND (? IS NULL OR c.format = ?)),
    r AS (SELECT competition_id, count(*) n FROM sport_result WHERE competition_id IN (SELECT id FROM c) GROUP BY 1),
    b AS (SELECT competition_id, sum(phase = 'POULE') p, sum(phase = 'TABLEAU') t
            FROM sport_bout WHERE competition_id IN (SELECT id FROM c) GROUP BY 1)
    SELECT c.id, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.format,
           c.competition_date, c.source_url, c.tournament_key, c.ename, c.start_date, c.end_date, c.city, c.country_code,
           coalesce(r.n, 0) res, coalesce(b.p, 0) p, coalesce(b.t, 0) t
      FROM c LEFT JOIN r ON r.competition_id = c.id LEFT JOIN b ON b.competition_id = c.id
     ORDER BY CAST(c.season AS INTEGER), c.competition_key`)
    .all(filtro.desde ?? 1900, filtro.hasta ?? 2100, filtro.formato ?? null, filtro.formato ?? null) as Record<string, string | number | null>[];
  return filas.map((f) => ({
    id: String(f.id),
    season: String(f.season),
    competitionKey: String(f.competition_key),
    weapon: f.weapon as PruebaBase['weapon'],
    gender: f.gender as PruebaBase['gender'],
    category: f.category as PruebaBase['category'],
    categoryRaw: (f.category_raw as string | null) ?? null,
    format: f.format as PruebaBase['format'],
    date: (f.competition_date as string | null) ?? null,
    tournamentKey: String(f.tournament_key),
    editionName: String(f.ename),
    startDate: (f.start_date as string | null) ?? null,
    endDate: (f.end_date as string | null) ?? null,
    city: (f.city as string | null) ?? null,
    countryCode: (f.country_code as string | null) ?? null,
    sourceUrl: (f.source_url as string | null) ?? null,
    resultados: Number(f.res),
    poule: Number(f.p),
    tableau: Number(f.t),
    coberturaPools: null,
    coberturaTableau: null,
  }));
}

const PAIS = /^[A-Z]{3}$/;

/** Hechos con las claves de edición y prueba guardadas, sin puestos, con los asaltos dados. */
export function hechosAsaltos(
  p: PruebaBase,
  datos: {
    extractor: string;
    sourceUrl: string;
    sourceSha256: string;
    pools: HechosPrueba['status']['pools'];
    tableau: HechosPrueba['status']['tableau'];
    notas: string[];
    bouts: AsaltoHecho[];
  },
): HechosPrueba {
  return hechosPrueba.parse({
    version: 1,
    source: 'fie',
    extractor: datos.extractor,
    sourceUrl: datos.sourceUrl,
    sourceSha256: datos.sourceSha256,
    edition: {
      season: p.season, tournamentKey: p.tournamentKey, name: p.editionName, startDate: p.startDate, endDate: p.endDate,
      city: p.city, countryCode: p.countryCode && PAIS.test(p.countryCode) ? p.countryCode : null,
    },
    competition: {
      competitionKey: p.competitionKey, weapon: p.weapon, gender: p.gender, category: p.category,
      categoryRaw: p.categoryRaw, format: p.format, date: p.date,
    },
    // `parcial` con 0 filas: el cargador no elige este fichero para los puestos y no toca los guardados.
    status: { results: 'parcial', pools: datos.pools, tableau: datos.tableau, publishedParticipants: null, notes: datos.notas },
    results: [],
    bouts: datos.bouts,
  });
}

export function escribirHechos(carpeta: string, h: HechosPrueba): string {
  if (!existsSync(carpeta)) mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, ficheroHechos(h));
  writeFileSync(ruta, `${JSON.stringify(h, null, 1)}\n`);
  return ruta;
}

/** Tamaño de la ronda de cuadro principal: `A64` → 64; las de otras tablas (B, C...) no cuentan. */
export function tamanoPrincipal(roundKey: string): number | null {
  const m = /^A(\d+)$/.exec(roundKey);
  return m ? Number(m[1]) : null;
}

export type ProblemaCuadro =
  | 'final_no_es_1_y_2'
  | 'semifinal_no_es_3'
  | 'tercer_puesto_no_cuadra'
  | 'perdedor_con_puesto_imposible'
  | 'cuadro_incoherente';

/**
 * El cuadro principal frente a la clasificación oficial: el ganador de la
 * final es el 1.º y el perdedor el 2.º; los perdedores de semifinales son 3.º
 * (o 3.º y 4.º si hubo combate por el bronce: `C2` en individual y `B2` por
 * equipos, como en la API de la FIE); y el perdedor de la ronda de N tiene un
 * puesto entre N/2+1 y N. Las rondas, referencias y marcadores son los ya
 * resueltos a `factKey`.
 */
export function cuadroContraClasificacion(
  bouts: readonly Pick<AsaltoHecho, 'roundKey' | 'aRef' | 'bRef' | 'scoreA' | 'scoreB' | 'winner'>[],
  puestos: ReadonlyMap<string, number | null>,
  rondaBronce = 'C2',
): ProblemaCuadro[] {
  const problemas = new Set<ProblemaCuadro>();
  const ganador = (b: (typeof bouts)[number]) => (b.winner ? (b.winner === 'A' ? b.aRef : b.bRef) : b.scoreA > b.scoreB ? b.aRef : b.bRef);
  const perdedor = (b: (typeof bouts)[number]) => (ganador(b) === b.aRef ? b.bRef : b.aRef);
  const bronce = bouts.some((b) => b.roundKey === rondaBronce);
  for (const b of bouts) {
    const g = puestos.get(ganador(b)) ?? null;
    const p = puestos.get(perdedor(b)) ?? null;
    if (b.roundKey === 'A2') {
      if ((g !== null && g !== 1) || (p !== null && p !== 2)) problemas.add('final_no_es_1_y_2');
    } else if (b.roundKey === 'A4') {
      if (p !== null && (bronce ? p !== 3 && p !== 4 : p !== 3)) problemas.add('semifinal_no_es_3');
    } else if (b.roundKey === rondaBronce) {
      if ((g !== null && g !== 3) || (p !== null && p !== 4)) problemas.add('tercer_puesto_no_cuadra');
    } else {
      const n = tamanoPrincipal(b.roundKey);
      if (n !== null && p !== null && (p <= n / 2 || p > n)) problemas.add('perdedor_con_puesto_imposible');
    }
  }
  const principales = bouts.filter((b) => tamanoPrincipal(b.roundKey) !== null);
  if (principales.length && consistenciaCuadro(principales).incoherentes.size > 0) problemas.add('cuadro_incoherente');
  return [...problemas];
}

/** Totales de una poule (victorias, tocados dados y recibidos por tirador) a partir de sus asaltos. */
export function totalesPoule(bouts: readonly { a: string; b: string; sa: number; sb: number; ganador: 'A' | 'B' }[]) {
  const t = new Map<string, { v: number; d: number; ts: number; tr: number }>();
  const de = (k: string) => t.get(k) ?? t.set(k, { v: 0, d: 0, ts: 0, tr: 0 }).get(k)!;
  for (const b of bouts) {
    const x = de(b.a);
    const y = de(b.b);
    x.ts += b.sa;
    x.tr += b.sb;
    y.ts += b.sb;
    y.tr += b.sa;
    if (b.ganador === 'A') {
      x.v += 1;
      y.d += 1;
    } else {
      y.v += 1;
      x.d += 1;
    }
  }
  return t;
}

/** Puestos de la clasificación guardada por `factKey`. */
/**
 * Engarde titula igual («Tableau préliminaire de 64») rondas de 64 y de 128: una ronda previa (AN con N ≥ 16) cuyos
 * perdedores tienen todos puesto oficial en N+1..2N es la de 2N. Sólo se renombra si no choca con otra ronda leída.
 */
export function corregirRondasPorPuestos<B extends Pick<AsaltoHecho, 'roundKey' | 'aRef' | 'bRef' | 'scoreA' | 'scoreB' | 'winner'>>(
  bouts: readonly B[],
  puestos: ReadonlyMap<string, number | null>,
): B[] {
  const perdedor = (b: B) => {
    const ganaA = b.winner ? b.winner === 'A' : b.scoreA > b.scoreB;
    return ganaA ? b.bRef : b.aRef;
  };
  const rondas = new Set(bouts.map((b) => b.roundKey));
  const cambio = new Map<string, string>();
  for (const r of rondas) {
    const n = tamanoPrincipal(r);
    if (n === null || n < 16) continue;
    const ps = bouts.filter((b) => b.roundKey === r).map((b) => puestos.get(perdedor(b)) ?? null);
    if (ps.some((p) => p === null)) continue;
    const enRango = (m: number) => ps.every((p) => p! > m / 2 && p! <= m);
    if (enRango(n) || !enRango(2 * n) || rondas.has(`A${2 * n}`)) continue;
    cambio.set(r, `A${2 * n}`);
  }
  return cambio.size ? bouts.map((b) => (cambio.has(b.roundKey) ? { ...b, roundKey: cambio.get(b.roundKey)! } : b)) : [...bouts];
}

export function mapaPuestos(puestos: readonly PuestoBase[]): Map<string, number | null> {
  return new Map(puestos.map((r) => [r.factKey, r.position]));
}

export const plegar = (s: string) =>
  s.replace(/ß/g, 'ss').replace(/[łŁ]/g, 'l').replace(/[øØ]/g, 'o').replace(/[đĐ]/g, 'd').replace(/[æÆ]/g, 'ae').replace(/ı/g, 'i').replace(/[əƏ]/g, 'e').replace(/[’'`´]/g, '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
