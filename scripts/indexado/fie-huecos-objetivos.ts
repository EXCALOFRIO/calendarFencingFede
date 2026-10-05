import { DatabaseSync } from 'node:sqlite';
import {
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import { NUEVO_POR_DEFECTO, normalizarNombre } from './comun';

/**
 * Pruebas del calendario FIE (temporada 2017 en adelante, ya celebradas) que la
 * base no tiene con resultados, y la construcción de sus hechos con las MISMAS
 * claves de edición y prueba que la fila FIE existente, de modo que el cargador
 * las rellena en lugar de crear otra prueba.
 */

export type Objetivo = {
  id: string;
  season: string;
  competitionKey: string;
  weapon: HechosPrueba['competition']['weapon'];
  gender: HechosPrueba['competition']['gender'];
  category: HechosPrueba['competition']['category'];
  categoryRaw: string | null;
  format: HechosPrueba['competition']['format'];
  date: string | null;
  tournamentKey: string;
  editionName: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  countryCode: string | null;
  sourceUrl: string | null;
};

export function abrirBase(ruta = NUEVO_POR_DEFECTO): DatabaseSync {
  return new DatabaseSync(ruta, { readOnly: true });
}

export function cargarObjetivos(db: DatabaseSync, hoy = new Date().toISOString().slice(0, 10)): Objetivo[] {
  const filas = db.prepare(`
    SELECT c.id, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.format,
           c.competition_date, c.source_url, e.tournament_key, e.name, e.start_date, e.end_date, e.city, e.country_code
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND CAST(c.season AS INTEGER) >= 2017
       AND coalesce(c.competition_date, e.start_date) < ?
       AND NOT EXISTS (SELECT 1 FROM sport_result r WHERE r.competition_id = c.id)
     ORDER BY e.name, c.season, c.competition_key`).all(hoy) as Record<string, string | null>[];
  return filas.map((f) => ({
    id: f.id!,
    season: f.season!,
    competitionKey: f.competition_key!,
    weapon: f.weapon as Objetivo['weapon'],
    gender: f.gender as Objetivo['gender'],
    category: f.category as Objetivo['category'],
    categoryRaw: f.category_raw,
    format: f.format as Objetivo['format'],
    date: f.competition_date,
    tournamentKey: f.tournament_key!,
    editionName: f.name!,
    startDate: f.start_date,
    endDate: f.end_date,
    city: f.city,
    countryCode: f.country_code,
    sourceUrl: f.source_url,
  }));
}

/**
 * La FIE copia en la temporada siguiente pruebas aún sin sede con las fechas de la
 * anterior (temporada 2027 con fechas de febrero de 2026, sede «TBD»): no son
 * pruebas celebradas y no se les asigna ningún resultado.
 */
export function esMarcadorFie(o: Objetivo): boolean {
  const fecha = o.date ?? o.startDate;
  if (!fecha) return true;
  const inicioTemporada = `${Number(o.season) - 1}-08-01`;
  return fecha < inicioTemporada;
}

export const fechaDe = (o: Objetivo): string => (o.date ?? o.startDate)!;

// ---------------------------------------------------------------------------
// Vínculo a personas FIE existentes
// ---------------------------------------------------------------------------

export type IndicePersonasFie = Map<string, Set<string>>;

const claveIndice = (nombre: string, pais: string, genero: string) => `${normalizarNombre(nombre)}|${pais}|${genero}`;

/**
 * Personas con ID FIE confirmado, por (nombre normalizado o alias, país, género).
 * El país es el de la ficha y también el de cada puesto FIE publicado de esa
 * persona, porque los cadetes cambian poco de nación pero la ficha guarda una.
 */
export function indicePersonasFie(db: DatabaseSync): IndicePersonasFie {
  const m: IndicePersonasFie = new Map();
  const anotar = (nombre: string | null, pais: string | null, genero: string | null, fieId: string) => {
    if (!nombre || !pais || (genero !== 'M' && genero !== 'F')) return;
    const k = claveIndice(nombre, pais, genero);
    (m.get(k) ?? m.set(k, new Set()).get(k)!).add(fieId);
  };
  const personas = db.prepare(`
    SELECT x.value fie, p.display_name nombre, p.country_code pais, p.gender genero, p.id
      FROM sport_external_id x JOIN sport_person p ON p.id = x.person_id
     WHERE x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO'`).all() as Record<string, string | null>[];
  const alias = db.prepare('SELECT person_id, name_original FROM sport_person_alias').all() as { person_id: string; name_original: string }[];
  const aliasDe = new Map<string, string[]>();
  for (const a of alias) (aliasDe.get(a.person_id) ?? aliasDe.set(a.person_id, []).get(a.person_id)!).push(a.name_original);
  for (const p of personas) {
    if (!p.fie || !/^\d+$/.test(p.fie)) continue;
    anotar(p.nombre, p.pais, p.genero, p.fie);
    for (const n of aliasDe.get(p.id!) ?? []) anotar(n, p.pais, p.genero, p.fie);
  }
  const puestos = db.prepare(`
    SELECT r.source_fact_key fie, r.source_name nombre, r.source_country_code pais, c.gender genero
      FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
     WHERE r.source = 'fie' AND c.format = 'INDIVIDUAL' AND r.source_country_code IS NOT NULL`);
  for (const r of puestos.iterate() as Iterable<Record<string, string>>) {
    if (/^\d+$/.test(r.fie)) anotar(r.nombre, r.pais, r.genero, r.fie);
  }
  return m;
}

/** ID FIE de la única persona FIE con ese nombre, país y género; null si no hay o hay varias. */
export function fieIdPorNombre(indice: IndicePersonasFie, nombre: string, pais: string | null, genero: string): string | null {
  if (!pais || (genero !== 'M' && genero !== 'F')) return null;
  const s = indice.get(claveIndice(nombre, pais, genero));
  return s && s.size === 1 ? [...s][0] : null;
}

// ---------------------------------------------------------------------------
// Construcción de hechos
// ---------------------------------------------------------------------------

export type FilaPublicada = {
  /** Clave propia de la fuente cuando no hay vínculo a una persona FIE. */
  claveFuente: string;
  name: string;
  countryCode: string | null;
  club: string | null;
  position: number | null;
  positionRaw: string | null;
  birthYear: number | null;
};

const PAIS = /^[A-Z]{3}$/;

/**
 * Puestos individuales: si nombre + país + género casan con una sola persona FIE,
 * la clave es su ID FIE (así `unificar-personas` reutiliza esa persona); si no, la
 * clave de la fuente. `fieId` queda siempre vacío: la fuente no lo publica.
 */
export function resultadosIndividuales(
  filas: FilaPublicada[],
  genero: string,
  indice: IndicePersonasFie,
): { results: ResultadoHecho[]; vinculados: number; mapa: Map<string, string> } {
  const usados = new Set<string>();
  const mapa = new Map<string, string>();
  const results: ResultadoHecho[] = [];
  let vinculados = 0;
  for (const f of filas) {
    const pais = f.countryCode && PAIS.test(f.countryCode) ? f.countryCode : null;
    let clave = f.claveFuente;
    const fie = fieIdPorNombre(indice, f.name, pais, genero);
    if (fie && !usados.has(fie)) {
      clave = fie;
      vinculados += 1;
    }
    let k = clave;
    for (let i = 2; usados.has(k); i += 1) k = `${clave}~${i}`;
    usados.add(k);
    mapa.set(f.claveFuente, k);
    results.push({
      factKey: k, name: f.name, countryCode: pais, club: f.club, position: f.position, positionRaw: f.positionRaw,
      points: null, fieId: null, license: null, birthYear: f.birthYear,
    });
  }
  return { results, vinculados, mapa };
}

/** Puestos por equipos: clave `team:<fuente>:<país o nombre>`, sin persona. */
export function resultadosEquipos(filas: Omit<FilaPublicada, 'birthYear'>[], fuente: string): ResultadoHecho[] {
  const usados = new Set<string>();
  return filas.map((f) => {
    const pais = f.countryCode && PAIS.test(f.countryCode) ? f.countryCode : null;
    const base = `team:${fuente}:${pais ?? f.name.replace(/\s+/g, '_')}`;
    let k = base;
    for (let i = 2; usados.has(k); i += 1) k = `${base}~${i}`;
    usados.add(k);
    return {
      factKey: k, name: f.name, countryCode: pais, club: null, position: f.position, positionRaw: f.positionRaw,
      points: null, fieId: null, license: null, birthYear: null,
    };
  });
}

export function construirHechos(
  o: Objetivo,
  datos: {
    extractor: string;
    sourceUrl: string;
    sourceSha256: string;
    results: ResultadoHecho[];
    bouts: AsaltoHecho[];
    status: HechosPrueba['status'];
  },
): HechosPrueba {
  return hechosPrueba.parse({
    version: 1,
    source: 'fie',
    extractor: datos.extractor,
    sourceUrl: datos.sourceUrl,
    sourceSha256: datos.sourceSha256,
    edition: {
      season: o.season,
      tournamentKey: o.tournamentKey,
      name: o.editionName,
      startDate: o.startDate,
      endDate: o.endDate,
      city: o.city,
      countryCode: o.countryCode && PAIS.test(o.countryCode) ? o.countryCode : null,
    },
    competition: {
      competitionKey: o.competitionKey,
      weapon: o.weapon,
      gender: o.gender,
      category: o.category,
      categoryRaw: o.categoryRaw,
      format: o.format,
      date: o.date,
    },
    status: datos.status,
    results: datos.results,
    bouts: datos.bouts,
  });
}

// ---------------------------------------------------------------------------
// Grupos del informe
// ---------------------------------------------------------------------------

export function grupoDe(nombre: string): string {
  const n = nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/europe cadets/.test(n)) return 'Europeos cadetes';
  if (/asiatiques cadets/.test(n)) return 'Asiáticos cadetes';
  if (/afrique/.test(n)) return 'Africanos';
  if (/panamericains cadets/.test(n)) return 'Panamericanos cadetes';
  if (/mediterranean fencing championship/.test(n)) return 'Mediterráneos U20/U17/U15';
  if (/mediterranee/.test(n)) return 'Mediterráneos cadetes/júnior';
  if (/commonwealth/.test(n)) return 'Commonwealth júnior/cadete';
  if (/jeux mediterraneens|mediterranean games/.test(n)) return 'Juegos Mediterráneos';
  if (/universiade|fisu/.test(n)) return 'Universiadas/FISU';
  if (/veterans par equipes/.test(n)) return 'Mundiales veteranos equipos';
  if (/south east asian/.test(n)) return 'SEA Games';
  if (/joj/.test(n)) return 'JOJ 2018 mixto';
  if (/juniors-cadets/.test(n)) return 'Mundiales júnior-cadete';
  if (/coupe du monde/.test(n)) return 'Copas del Mundo';
  if (/satellite/.test(n)) return 'Satélites';
  return 'Otros';
}
