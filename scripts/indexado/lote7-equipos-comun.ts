/**
 * Piezas comunes de los productores del lote 7 de pruebas por equipos RFEE
 * (`lote7-equipos-engarde.ts`, `lote7-equipos-pdf.ts`).
 *
 * Cada fichero de hechos completa una prueba que YA existe en la copia de
 * producción: lleva la misma fuente, temporada, `tournamentKey` y
 * `competitionKey` que la fila guardada, de modo que `cargar-hechos.ts` la
 * aumenta (sección a sección) en vez de crear otra. Las claves salen siempre
 * de la base, nunca de la lectura.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { CARPETA_TRABAJO } from './comun';

export const NUEVO7 = join(CARPETA_TRABAJO, 'nuevo7.sqlite');
export const SALIDA_EQUIPOS = join(CARPETA_TRABAJO, 'hechos', 'lote7-equipos');
export const CACHE_EQUIPOS = join(CARPETA_TRABAJO, 'cache-lote7-equipos');

export type PruebaEquipos = {
  id: string;
  source: 'rfee_pdf' | 'engarde';
  season: string;
  competitionKey: string;
  weapon: HechosPrueba['competition']['weapon'];
  gender: HechosPrueba['competition']['gender'];
  category: HechosPrueba['competition']['category'];
  categoryRaw: string | null;
  date: string | null;
  sourceUrl: string | null;
  edition: {
    id: string;
    tournamentKey: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    city: string | null;
    countryCode: string | null;
    sourceUrl: string | null;
  };
  resultados: {
    factKey: string; name: string; position: number | null;
    positionRaw?: string | null; club?: string | null; countryCode?: string | null; points?: string | null;
  }[];
  poules: number;
  cuadro: number;
  cobertura: Record<string, string>;
};

/** Pruebas por equipos de una fuente nacional, con lo que ya tienen guardado. */
export function pruebasEquipos(db: DatabaseSync, source: 'rfee_pdf' | 'engarde'): PruebaEquipos[] {
  const filas = db.prepare(
    `SELECT c.id, c.source, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw,
            c.competition_date, c.source_url, e.id eid, e.tournament_key, e.name, e.start_date, e.end_date, e.city,
            e.country_code, e.source_url esu,
            (SELECT count(*) FROM sport_bout b WHERE b.competition_id=c.id AND b.phase='POULE') np,
            (SELECT count(*) FROM sport_bout b WHERE b.competition_id=c.id AND b.phase='TABLEAU') nt
       FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
      WHERE c.format='EQUIPOS' AND c.source=? ORDER BY c.season, c.competition_key`,
  ).all(source) as Record<string, string | number | null>[];
  const res = db.prepare(
    `SELECT source_fact_key, source_name, position, position_raw, source_club, source_country_code, official_points
       FROM sport_result WHERE competition_id=? AND source=?
      ORDER BY position IS NULL, position, source_fact_key`,
  );
  const cob = db.prepare(`SELECT fact_kind, status FROM sport_import_coverage WHERE competition_id=?`);
  return filas.map((f) => ({
    id: String(f.id),
    source,
    season: String(f.season),
    competitionKey: String(f.competition_key),
    weapon: f.weapon as PruebaEquipos['weapon'],
    gender: f.gender as PruebaEquipos['gender'],
    category: f.category as PruebaEquipos['category'],
    categoryRaw: (f.category_raw as string | null) ?? null,
    date: (f.competition_date as string | null) ?? null,
    sourceUrl: (f.source_url as string | null) ?? null,
    edition: {
      id: String(f.eid),
      tournamentKey: String(f.tournament_key),
      name: String(f.name),
      startDate: (f.start_date as string | null) ?? null,
      endDate: (f.end_date as string | null) ?? null,
      city: (f.city as string | null) ?? null,
      countryCode: (f.country_code as string | null) ?? null,
      sourceUrl: (f.esu as string | null) ?? null,
    },
    resultados: (res.all(f.id, source) as {
      source_fact_key: string; source_name: string; position: number | null; position_raw: string | null;
      source_club: string | null; source_country_code: string | null; official_points: string | null;
    }[]).map((r) => ({
      factKey: r.source_fact_key, name: r.source_name, position: r.position, positionRaw: r.position_raw,
      club: r.source_club, countryCode: r.source_country_code, points: r.official_points,
    })),
    poules: Number(f.np),
    cuadro: Number(f.nt),
    cobertura: Object.fromEntries((cob.all(f.id) as { fact_kind: string; status: string }[]).map((c) => [c.fact_kind, c.status])),
  }));
}

/**
 * La clasificación guardada tal cual, con el estado de su cobertura. En rfee_pdf la carga
 * recalcula la cobertura `pdf` del documento con el estado de la clasificación de cada fichero:
 * un fichero que sólo trae encuentros la rebajaría a `sin_resultados`. Con las mismas claves y
 * valores el cargador no cambia ninguna fila.
 */
export function clasificacionGuardada(p: PruebaEquipos): { results: HechosPrueba['results']; estado: HechosPrueba['status']['results'] } {
  const results = p.resultados.map((r) => ({
    factKey: r.factKey, name: r.name, position: r.position, positionRaw: r.positionRaw ?? null,
    club: r.club ?? null, countryCode: r.countryCode && /^[A-Z]{3}$/.test(r.countryCode) ? r.countryCode : null,
    points: r.points && /^-?\d+(\.\d+)?$/.test(r.points) ? r.points : null,
    fieId: null, license: null, birthYear: null,
  }));
  const c = p.cobertura.results;
  const estado = results.length === 0 ? 'sin_resultados' : c === 'completo' || c === 'parcial' ? c : 'parcial';
  return { results, estado };
}

/** El tramo de la clave antes de `~n`: las partes de un mismo documento. */
export const raizClave = (k: string): string => k.replace(/~\d+$/, '');

/**
 * Un encuentro por equipos válido: relevos a 45 salvo que la fuente diga otra cosa, sin empates
 * salvo con ganador explícito y con el ganador por delante. Devuelve el motivo si no lo es.
 */
export function motivoEncuentro(b: Pick<AsaltoHecho, 'scoreA' | 'scoreB' | 'winner' | 'aName' | 'bName'>, max = 45): string | null {
  const { scoreA: a, scoreB: c } = b;
  if (!Number.isInteger(a) || !Number.isInteger(c) || a < 0 || c < 0) return 'marcador_invalido';
  if (a > max || c > max) return 'marcador_fuera_de_rango';
  if (b.aName.trim() === '' || b.bName.trim() === '') return 'sin_nombre';
  if (a === c && b.winner === null) return 'empate_sin_ganador';
  if (a !== c && b.winner !== null && b.winner !== (a > c ? 'A' : 'B')) return 'ganador_incoherente';
  return null;
}

const ganadorDe = (b: Pick<AsaltoHecho, 'aRef' | 'bRef' | 'scoreA' | 'scoreB' | 'winner'>) =>
  b.scoreA > b.scoreB || (b.scoreA === b.scoreB && b.winner === 'A') ? b.aRef : b.bRef;

/**
 * Encuentros del cuadro principal (`T<n>`) que no pueden ser de ese cuadro: un equipo que ya
 * perdió en una ronda mayor no vuelve a tirar en una menor (eso es un encuentro por puestos mal
 * situado). Y si la clasificación da los puestos 1 y 2, la final es entre esos dos. Devuelve los
 * índices (en `bouts`) que sobran; los encuentros por puestos (`T2-3`, `T4-5`…) no se miran.
 */
export function incoherentesCuadroEquipos(
  bouts: readonly AsaltoHecho[],
  podio: { primero: string | null; segundo: string | null } = { primero: null, segundo: null },
  mismo: (x: string, y: string) => boolean = (x, y) => x === y,
): Set<number> {
  const tam = (r: string) => {
    const m = /^T(\d+)$/.exec(r);
    return m ? Number(m[1]) : null;
  };
  const principales = bouts
    .map((b, i) => ({ b, i, n: b.phase === 'TABLEAU' ? tam(b.roundKey) : null }))
    .filter((x): x is { b: AsaltoHecho; i: number; n: number } => x.n !== null);
  const eliminadoEn = new Map<string, number>();
  for (const { b, n } of principales) {
    const perdedor = ganadorDe(b) === b.aRef ? b.bRef : b.aRef;
    eliminadoEn.set(perdedor, Math.max(eliminadoEn.get(perdedor) ?? 0, n));
  }
  const fuera = new Set<number>();
  for (const { b, i, n } of principales) {
    if ([b.aRef, b.bRef].some((r) => (eliminadoEn.get(r) ?? 0) > n)) fuera.add(i);
    if (n === 2 && podio.primero && podio.segundo) {
      const g = ganadorDe(b) === b.aRef ? b.aName : b.bName;
      const p = ganadorDe(b) === b.aRef ? b.bName : b.aName;
      if (!mismo(g, podio.primero) || !mismo(p, podio.segundo)) fuera.add(i);
    }
  }
  return fuera;
}

/**
 * El encuentro por el tercer puesto leído como una ronda del cuadro principal: el único encuentro
 * de `T2`/`T4` entre los dos perdedores de semifinales pasa a `T2-3` (si no hay ya uno).
 */
export function tercerPuestoComoRonda(bouts: readonly AsaltoHecho[]): AsaltoHecho[] {
  if (bouts.some((b) => b.phase === 'TABLEAU' && b.roundKey === 'T2-3')) return [...bouts];
  const semis = bouts.filter((b) => b.phase === 'TABLEAU' && b.roundKey === 'T4');
  if (semis.length < 2 || semis.length > 3) return [...bouts];
  const perdedores = new Set(semis.map((b) => (ganadorDe(b) === b.aRef ? b.bRef : b.aRef)));
  if (perdedores.size !== 2) return [...bouts];
  const candidatos = bouts.filter((b) => b.phase === 'TABLEAU' && /^T\d+$/.test(b.roundKey) && perdedores.has(b.aRef) && perdedores.has(b.bRef));
  if (candidatos.length !== 1) return [...bouts];
  return bouts.map((b) => (b === candidatos[0] ? { ...b, roundKey: 'T2-3' } : b));
}

/**
 * Hechos de una prueba ya guardada: edición y prueba copiadas de la base. `results` vacío deja la
 * clasificación guardada como está (el cargador la conserva); las secciones sin filas van como
 * `sin_resultados`.
 */
export function hechosDePrueba(
  p: PruebaEquipos,
  datos: {
    extractor: string;
    sourceUrl: string;
    sourceSha256: string;
    results: HechosPrueba['results'];
    bouts: AsaltoHecho[];
    status: HechosPrueba['status'];
  },
): HechosPrueba {
  return hechosPrueba.parse({
    version: 1,
    source: p.source,
    extractor: datos.extractor,
    sourceUrl: datos.sourceUrl,
    sourceSha256: datos.sourceSha256,
    edition: {
      season: p.season,
      tournamentKey: p.edition.tournamentKey,
      name: p.edition.name,
      startDate: p.edition.startDate,
      endDate: p.edition.endDate,
      city: p.edition.city,
      countryCode: p.edition.countryCode,
    },
    competition: {
      competitionKey: p.competitionKey,
      weapon: p.weapon,
      gender: p.gender,
      category: p.category,
      categoryRaw: p.categoryRaw,
      format: 'EQUIPOS',
      date: p.date,
    },
    status: datos.status,
    results: datos.results,
    bouts: datos.bouts,
  });
}

export function escribirHechos(carpeta: string, h: HechosPrueba): string {
  mkdirSync(carpeta, { recursive: true });
  const nombre = ficheroHechos(h);
  const ruta = join(carpeta, nombre);
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(hechosPrueba.parse(h), null, 2)}\n`, 'utf8');
  renameSync(tmp, ruta);
  return nombre;
}

export function asegurarCarpeta(d: string): string {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
