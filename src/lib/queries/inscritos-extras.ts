import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { claveExtra, type ExtraInscrito, type PuestoInscrito } from '@/lib/entries/union';
import { personaDeFilaOficial } from './personas-ranking';

/**
 * Lo público que acompaña a cada inscrito enlazado con una persona deportiva
 * (`personaDeFila`): su nacionalidad y sus puestos vigentes en el ranking FIE
 * (`fie_clasificacion`, la tabla de /ranking) y en el de la RFEE
 * (`official_ranking_entry`), en la categoría de la prueba o, si ahí no
 * figura, en el absoluto.
 *
 * Tres sentencias para toda la lista, sean diez inscritos o doscientos. Los
 * puestos se cruzan por ids estables, nunca por nombre: el ID FIE confirmado
 * de la persona (o de las fundidas en ella) y, en la RFEE, la misma persona
 * que la tabla de /ranking le asigna a cada fila (`personaDeFilaOficial`). Si
 * una persona tiene dos filas distintas en la misma lista, no se elige.
 */

type Ejecutor = Pick<Db, 'execute'>;

export type ParInscrito = { competitionId: string; personaId: string };

/** Por `claveExtra(prueba, persona)`. */
export type ExtrasInscritos = Record<string, ExtraInscrito>;

export type FilaPuesto = { c: string; p: string; cat: string; categoria: string; puesto: number | string; ref: string | number };

function filasDe<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const rows = (r as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Pares (prueba, persona) de la lista, el arma, género y categoría de cada
 * prueba y las personas fundidas en cada una. En las pruebas por equipos el
 * puesto que se da es el individual del tirador.
 */
function base(pares: readonly ParInscrito[]) {
  const json = JSON.stringify(pares.map((x) => [x.competitionId, x.personaId]));
  return sql`
    par AS MATERIALIZED (
      SELECT DISTINCT json_extract(j.value, '$[0]') AS c, json_extract(j.value, '$[1]') AS p FROM json_each(${json}) j
    ), pr AS MATERIALIZED (
      SELECT par.c AS c, par.p AS p, ec.weapon AS arma, ec.gender AS genero, ec.category AS cat
      FROM par CROSS JOIN event_competition ec ON ec.id = par.c
    ), miembros AS MATERIALIZED (
      SELECT DISTINCT p, p AS m FROM pr
      UNION
      SELECT DISTINCT pr.p, s.id FROM pr CROSS JOIN sport_person s ON s.merged_into_person_id = pr.p
    )`;
}

export function sqlPuestosMundiales(pares: readonly ParInscrito[]) {
  return sql`
    WITH ${base(pares)}, ids AS MATERIALIZED (
      SELECT DISTINCT mi.p AS p, CAST(x.value AS INTEGER) AS fie
      FROM miembros mi CROSS JOIN sport_external_id x
        ON x.person_id = mi.m AND x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO'
    )
    SELECT pr.c AS c, pr.p AS p, pr.cat AS cat, f.category AS categoria, f.position AS puesto, f.fie_id AS ref
    FROM pr CROSS JOIN ids ON ids.p = pr.p
    CROSS JOIN fie_clasificacion f ON f.fie_id = ids.fie AND f.season = (SELECT max(season) FROM fie_clasificacion)
    -- Los «+» apartan del plan el índice por grupo, que recorría la lista FIE
    -- entera por cada inscrito (27.000 filas en una Copa del Mundo): así entra
    -- por (fie_id, season) y lee unas pocas filas por persona.
    WHERE +f.format = 'INDIVIDUAL' AND f.position IS NOT NULL
      AND +f.weapon = pr.arma AND +f.gender = pr.genero AND +f.category IN (pr.cat, 'ABS')`;
}

/**
 * La temporada vigente de la tabla oficial, sólo las listas de las pruebas
 * (su categoría y el absoluto), y de cada fila la persona que le da /ranking.
 * Lee lo que midan esas listas, no lo que tenga cada inscrito: ~4.400 filas
 * en una Copa del Mundo frente a las ~8.300 de buscar por persona sus ids de
 * Skermo y sus licencias.
 */
export function sqlPuestosNacionales(pares: readonly ParInscrito[]) {
  return sql`
    WITH ${base(pares)}, vig AS MATERIALIZED (
      SELECT max(season_label) AS s FROM official_ranking_entry
    ), listas AS MATERIALIZED (
      SELECT DISTINCT arma, genero, cat FROM pr
    ), filas AS MATERIALIZED (
      SELECT o.id AS id, o.weapon AS arma, o.gender AS genero, o.category AS categoria, o.position AS puesto,
             ${personaDeFilaOficial} AS persona
      FROM listas l CROSS JOIN official_ranking_entry o
        ON o.season_label = (SELECT s FROM vig) AND o.weapon = l.arma AND o.gender = l.genero
          AND o.category IN (l.cat, 'ABS')
      WHERE o.position IS NOT NULL
    )
    SELECT pr.c AS c, pr.p AS p, pr.cat AS cat, f.categoria AS categoria, f.puesto AS puesto, f.id AS ref
    FROM pr CROSS JOIN miembros mi ON mi.p = pr.p
    CROSS JOIN filas f ON f.persona = mi.m
    WHERE f.arma = pr.arma AND f.genero = pr.genero AND f.categoria IN (pr.cat, 'ABS')`;
}

export function sqlPaises(personaIds: readonly string[]) {
  return sql`
    SELECT s.id AS p, s.country_code AS pais FROM sport_person s
    WHERE s.id IN (SELECT value FROM json_each(${JSON.stringify(personaIds)}))`;
}

/**
 * El puesto de cada par: el de la categoría de la prueba si lo hay; si no, el
 * absoluto. Dos filas distintas en la misma lista (dos ID FIE, dos fichas de
 * la RFEE) no se resuelven: sin puesto.
 */
export function elegirPuestos(filas: readonly FilaPuesto[]): Map<string, PuestoInscrito> {
  const porLista = new Map<string, { cat: string; refs: Set<string>; puesto: number }>();
  for (const f of filas) {
    const puesto = Number(f.puesto);
    if (!Number.isInteger(puesto) || puesto <= 0) continue;
    const k = `${claveExtra(f.c, f.p)}|${f.categoria}`;
    const ya = porLista.get(k);
    if (ya) ya.refs.add(String(f.ref));
    else porLista.set(k, { cat: f.cat, refs: new Set([String(f.ref)]), puesto });
  }
  const salida = new Map<string, PuestoInscrito>();
  const elegir = (clave: string, cat: string) => {
    const propia = porLista.get(`${clave}|${cat}`);
    if (propia) return propia.refs.size === 1 ? { puesto: propia.puesto, absoluto: false } : null;
    const abs = porLista.get(`${clave}|ABS`);
    return abs && abs.refs.size === 1 ? { puesto: abs.puesto, absoluto: true } : null;
  };
  for (const f of filas) {
    const clave = claveExtra(f.c, f.p);
    if (salida.has(clave)) continue;
    const p = elegir(clave, f.cat);
    if (p) salida.set(clave, p);
  }
  return salida;
}

export function construirExtras(
  pares: readonly ParInscrito[],
  mundiales: readonly FilaPuesto[],
  nacionales: readonly FilaPuesto[],
  paises: readonly { p: string; pais: string | null }[],
): ExtrasInscritos {
  const mundial = elegirPuestos(mundiales);
  const nacional = elegirPuestos(nacionales);
  const pais = new Map(paises.map((x) => [x.p, x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null]));
  const salida: ExtrasInscritos = {};
  for (const { competitionId, personaId } of pares) {
    const clave = claveExtra(competitionId, personaId);
    salida[clave] = {
      pais: pais.get(personaId) ?? null,
      mundial: mundial.get(clave) ?? null,
      nacional: nacional.get(clave) ?? null,
    };
  }
  return salida;
}

/** Un fallo de cualquiera de las tres deja esa parte vacía, no la lista sin enlaces. */
export async function leerExtrasInscritos(db: Ejecutor, pares: readonly ParInscrito[]): Promise<ExtrasInscritos> {
  if (pares.length === 0) return {};
  const personas = [...new Set(pares.map((x) => x.personaId))];
  const [mundiales, nacionales, paises] = await Promise.all([
    db.execute(sqlPuestosMundiales(pares)).then(filasDe<FilaPuesto>, () => []),
    db.execute(sqlPuestosNacionales(pares)).then(filasDe<FilaPuesto>, () => []),
    db.execute(sqlPaises(personas)).then(filasDe<{ p: string; pais: string | null }>, () => []),
  ]);
  return construirExtras(pares, mundiales, nacionales, paises);
}
