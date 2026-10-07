import { sql } from 'drizzle-orm';
import { MAX_TOCADOS_INDIVIDUAL } from './asaltos-orientados-sql';
import { lecturasDescartadas } from './cara-a-cara';
import { filas, type ContextoExplorador } from './contexto';
import { listaUuid } from './filtros-sql';
import { clasificarCompeticion } from './tipo-competicion';
import type { Arma, Formato, Genero } from './tipos';
import type { AmbitoCompeticion, RivalBasico } from './tipos-social';

/**
 * Rivales de la ficha por ámbito (todos, nacional, internacional): con quién
 * ha tirado más, a quién gana más y quién le gana más.
 *
 * Cuenta igual que el cara a cara (`listarRivales`): sólo asaltos de pruebas
 * individuales con marcador individual (un relevo de equipos no cuenta), con
 * los dos tiradores resueltos a una persona, y sin las lecturas repetidas de
 * una misma prueba (`lecturasDescartadas`). Así el balance de cada fila es el
 * que se ve al abrir el cara a cara sin filtros.
 */

export type AmbitoRivales = 'todos' | AmbitoCompeticion;

export type RivalAmbito = RivalBasico & { asaltos: number; victorias: number; derrotas: number };

export type ListasRivales = {
  /** Rivales distintos con algún asalto en el ámbito. */
  rivales: number;
  masEnfrentados: RivalAmbito[];
  /** Más victorias contra él; a igualdad, mejor diferencia. */
  aQuienMasGana: RivalAmbito[];
  /** Más derrotas contra él; a igualdad, peor diferencia. */
  quienMasLeGana: RivalAmbito[];
};

export type RivalesPorAmbito = Record<AmbitoRivales, ListasRivales>;

export const RIVALES_POR_LISTA = 5;

export type FilaRivalAmbito = {
  rival: string;
  nombre: string | null;
  pais: string | null;
  prueba: string;
  asaltos: number;
  victorias: number;
  derrotas: number;
  equivalencia: string | null;
  fecha: string | null;
  arma: Arma;
  genero: Genero;
  categoria: string;
  formato: Formato | null;
  fuente: string;
  torneo: string;
  paisTorneo: string | null;
  ambitoEvento: string | null;
  circuitoEvento: string | null;
  fuenteEvento: string | null;
};

/**
 * Una fila por rival (persona raíz) y prueba, con lo que hace falta para
 * clasificar la prueba.
 *
 * Mismos asaltos que `sqlAsaltosOrientados`, pero agrupados por prueba y
 * rival ANTES de cruzar con la prueba: el formato es de la prueba, así que
 * filtrarlo después del GROUP BY da lo mismo y la prueba se lee una vez por
 * grupo, no por asalto (y sin la fecha de la edición, que aquí no se usa).
 */
export function sqlRivalesPorPrueba(ids: readonly string[], canonicaId: string) {
  const grupo = listaUuid(ids);
  return sql`
    WITH crudos AS MATERIALIZED (
      SELECT b.competition_id AS prueba, b.fencer_b_person_id AS rival_id, count(*) AS asaltos,
             sum(b.score_a > b.score_b) AS victorias, sum(b.score_a < b.score_b) AS derrotas
      FROM sport_bout b
      WHERE b.fencer_a_person_id IN (${grupo}) AND max(b.score_a, b.score_b) <= ${MAX_TOCADOS_INDIVIDUAL}
      GROUP BY 1, 2
      UNION ALL
      SELECT b.competition_id, b.fencer_a_person_id, count(*),
             sum(b.score_b > b.score_a), sum(b.score_b < b.score_a)
      FROM sport_bout b
      WHERE b.fencer_b_person_id IN (${grupo}) AND max(b.score_a, b.score_b) <= ${MAX_TOCADOS_INDIVIDUAL}
        AND (b.fencer_a_person_id IS NULL OR b.fencer_a_person_id NOT IN (${grupo}))
      GROUP BY 1, 2
    ), por_prueba AS MATERIALIZED (
      SELECT coalesce(rp.merged_into_person_id, rp.id) AS rival, o.prueba AS prueba,
             sum(o.asaltos) AS asaltos, sum(o.victorias) AS victorias, sum(o.derrotas) AS derrotas
      FROM crudos o CROSS JOIN sport_person rp ON rp.id = o.rival_id
      WHERE coalesce(rp.merged_into_person_id, rp.id) <> ${canonicaId}
      GROUP BY 1, 2
    )
    SELECT pp.rival AS rival, p.display_name AS nombre, p.country_code AS pais, pp.prueba AS prueba,
           pp.asaltos AS asaltos, pp.victorias AS victorias, pp.derrotas AS derrotas,
           c.event_competition_id AS equivalencia, coalesce(c.competition_date, e.start_date) AS fecha,
           c.weapon AS arma, c.gender AS genero, c.category AS categoria, c.format AS formato,
           c.source AS fuente, e.name AS torneo, e.country_code AS "paisTorneo",
           ev0.scope AS "ambitoEvento", ev0.circuit AS "circuitoEvento", ev0.source AS "fuenteEvento"
    FROM por_prueba pp
    CROSS JOIN sport_competition c ON c.id = pp.prueba
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    LEFT JOIN sport_person p ON p.id = pp.rival
    WHERE c.format = 'INDIVIDUAL'`;
}

const UN_DIA = 86_400_000;
const diasEntre = (a: string, b: string) =>
  Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / UN_DIA;

/** Pruebas de un rival que podrían ser dos lecturas de la misma; sólo para ellas hacen falta los puestos. */
export function pruebasDudosas(ps: readonly FilaRivalAmbito[]): string[] {
  if (ps.length < 2) return [];
  return ps
    .filter((a) => ps.some((b) => b !== a && (
      (a.equivalencia && a.equivalencia === b.equivalencia)
      || (a.fecha && b.fecha && diasEntre(a.fecha, b.fecha) <= 1 && a.arma === b.arma && a.genero === b.genero
        && a.categoria === b.categoria && a.formato === b.formato))))
    .map((p) => p.prueba);
}

/** Puestos por prueba y persona raíz: `prueba → persona → puesto`. */
export type PuestosPorPrueba = ReadonlyMap<string, ReadonlyMap<string, number>>;

const ordenar = (lista: RivalAmbito[], clave: (r: RivalAmbito) => number[]) =>
  [...lista].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id);
  });

function listas(rivales: RivalAmbito[], n: number): ListasRivales {
  const conAsaltos = rivales.filter((r) => r.asaltos > 0);
  return {
    rivales: conAsaltos.length,
    masEnfrentados: ordenar(conAsaltos, (r) => [r.asaltos, r.victorias - r.derrotas]).slice(0, n),
    aQuienMasGana: ordenar(conAsaltos.filter((r) => r.victorias > 0), (r) => [r.victorias, r.victorias - r.derrotas, r.asaltos]).slice(0, n),
    quienMasLeGana: ordenar(conAsaltos.filter((r) => r.derrotas > 0), (r) => [r.derrotas, r.derrotas - r.victorias, r.asaltos]).slice(0, n),
  };
}

/**
 * Agrega las filas por rival y ámbito. Las lecturas descartadas se deciden
 * con todas las pruebas del rival (no por ámbito), igual que en el cara a cara.
 */
export function aRivalesPorAmbito(
  rows: readonly FilaRivalAmbito[],
  puestos: PuestosPorPrueba,
  canonicaId: string,
  n = RIVALES_POR_LISTA,
): RivalesPorAmbito {
  const ambitoDe = new Map<string, AmbitoCompeticion>();
  const porRival = new Map<string, FilaRivalAmbito[]>();
  for (const r of rows) {
    if (!ambitoDe.has(r.prueba)) {
      ambitoDe.set(r.prueba, clasificarCompeticion({
        nombre: r.torneo, fuente: r.fuente, pais: r.paisTorneo,
        ambitoEvento: r.ambitoEvento, circuitoEvento: r.circuitoEvento, fuenteEvento: r.fuenteEvento,
      }).ambito);
    }
    const lista = porRival.get(r.rival);
    if (lista) lista.push(r);
    else porRival.set(r.rival, [r]);
  }

  const por: Record<AmbitoRivales, RivalAmbito[]> = { todos: [], nacional: [], internacional: [] };
  for (const [id, ps] of porRival) {
    const lecturas = ps.map((p) => ({
      id: p.prueba, fuente: '', torneo: '', arma: p.arma, genero: p.genero, categoria: p.categoria,
      categoriaRaw: null, temporada: '', lecturas: '', formato: p.formato, equivalencia: p.equivalencia,
      fecha: p.fecha, asaltos: Number(p.asaltos),
      puestoYo: puestos.get(p.prueba)?.get(canonicaId) ?? null,
      puestoRival: puestos.get(p.prueba)?.get(id) ?? null,
    }));
    const fuera = new Set(lecturasDescartadas(lecturas));
    const base: RivalBasico = { id, nombre: ps[0].nombre ?? '', pais: ps[0].pais };
    const suma: Record<AmbitoRivales, RivalAmbito> = {
      todos: { ...base, asaltos: 0, victorias: 0, derrotas: 0 },
      nacional: { ...base, asaltos: 0, victorias: 0, derrotas: 0 },
      internacional: { ...base, asaltos: 0, victorias: 0, derrotas: 0 },
    };
    for (const p of ps) {
      if (fuera.has(p.prueba)) continue;
      for (const k of ['todos', ambitoDe.get(p.prueba)!] as const) {
        suma[k].asaltos += Number(p.asaltos);
        suma[k].victorias += Number(p.victorias ?? 0);
        suma[k].derrotas += Number(p.derrotas ?? 0);
      }
    }
    por.todos.push(suma.todos);
    por.nacional.push(suma.nacional);
    por.internacional.push(suma.internacional);
  }
  return { todos: listas(por.todos, n), nacional: listas(por.nacional, n), internacional: listas(por.internacional, n) };
}

const LOTE_PRUEBAS = 80;

async function leerPuestos(db: ContextoExplorador['db'], pruebas: readonly string[]): Promise<PuestosPorPrueba> {
  const salida = new Map<string, Map<string, number>>();
  for (let i = 0; i < pruebas.length; i += LOTE_PRUEBAS) {
    const rows = filas<{ prueba: string; persona: string; puesto: number }>(await db.execute(sql`
      SELECT r.competition_id AS prueba, coalesce(p.merged_into_person_id, p.id) AS persona, min(r.position) AS puesto
      FROM sport_result r CROSS JOIN sport_person p ON p.id = r.person_id
      WHERE r.competition_id IN (${listaUuid(pruebas.slice(i, i + LOTE_PRUEBAS))}) AND r.position > 0
      GROUP BY 1, 2`));
    for (const r of rows) {
      const m = salida.get(r.prueba) ?? new Map<string, number>();
      m.set(r.persona, Number(r.puesto));
      salida.set(r.prueba, m);
    }
  }
  return salida;
}

/** `null` si la lectura falla: la pestaña dice que no se pudo leer, no «sin rivales». */
export async function leerRivalesPorAmbitoDe(
  db: ContextoExplorador['db'],
  ids: readonly string[],
  canonicaId: string,
): Promise<RivalesPorAmbito | null> {
  try {
    const rows = filas<FilaRivalAmbito>(await db.execute(sqlRivalesPorPrueba(ids, canonicaId)));
    const porRival = new Map<string, FilaRivalAmbito[]>();
    for (const r of rows) porRival.set(r.rival, [...(porRival.get(r.rival) ?? []), r]);
    const dudosas = [...new Set([...porRival.values()].flatMap(pruebasDudosas))];
    const puestos = dudosas.length > 0 ? await leerPuestos(db, dudosas) : new Map();
    return aRivalesPorAmbito(rows, puestos, canonicaId);
  } catch (error) {
    console.error('[explorar] los rivales por ámbito no se pudieron leer:',
      error instanceof Error ? error.name : 'desconocido');
    return null;
  }
}
