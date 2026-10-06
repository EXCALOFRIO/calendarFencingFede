import { sql, type SQL } from 'drizzle-orm';
import { ERROR_NO_AUTENTICADO, exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { condicionesPrueba, listaUuid, y } from './filtros-sql';
import { resolverPersona } from './personas';
import type { Arma, Genero } from './tipos';

/**
 * Relevos de las pruebas por equipos (`sport_relay`, migración 0010).
 *
 * Un relevo no es un asalto: no entra en `sport_bout`, ni en el balance del
 * cara a cara ni en los recuentos de rivales, que siguen contando sólo
 * asaltos individuales. Aquí se leen aparte, con los tocados que dio y
 * recibió cada tirador en ese relevo.
 *
 * Mientras la 0010 no esté aplicada las tablas no existen: cualquier fallo
 * de lectura es `null` y la sección no se pinta.
 */

const MAX_RELEVOS_CARA_A_CARA = 200;
const MAX_PRUEBAS_PERFIL = 200;

type Prueba = {
  pruebaId: string;
  edicionId: string;
  torneo: string;
  fuente: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string | null;
  temporada: string;
  fecha: string | null;
};

export type RelevoCaraACara = Prueba & {
  id: string;
  /** Número de relevo dentro del encuentro (1..9). */
  numero: number;
  fase: 'POULE' | 'TABLEAU';
  /** Clave de ronda como en `sport_bout` (`T8`, `T2-3`…); `null` en los cuadros de puestos. */
  ronda: string | null;
  rondaPublicada: string | null;
  /** Tocados de cada una en ese relevo, desde la persona consultada. */
  mios: number;
  rival: number;
  miEquipo: string;
  suEquipo: string;
  /** Marcador final del encuentro, también desde la persona consultada. */
  final: { mios: number; rival: number };
};

export type RelevosCaraACara = {
  items: RelevoCaraACara[];
  resumen: { relevos: number; tocadosFavor: number; tocadosContra: number };
  /** Se alcanzó el tope de relevos leídos (los más recientes). */
  truncado: boolean;
};

export type PruebaRelevosPerfil = Prueba & {
  equipo: string;
  encuentros: number;
  relevos: number;
  dados: number;
  recibidos: number;
};

export type RelevosPerfil = {
  relevos: number;
  encuentros: number;
  dados: number;
  recibidos: number;
  /** Dados menos recibidos. */
  indice: number;
  pruebas: PruebaRelevosPerfil[];
  truncado: boolean;
};

export type FiltrosRelevos = { temporada?: string; arma?: Arma; fase?: 'POULE' | 'TABLEAU' };

const FECHA = sql.raw('coalesce(c.competition_date, e.start_date)');
const UNIONES = sql.raw(`CROSS JOIN sport_team_match m ON m.id = rl.match_id
    CROSS JOIN sport_competition c ON c.id = m.competition_id
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id`);
const COLUMNAS_PRUEBA = sql.raw(`c.id AS "pruebaId", e.id AS "edicionId", e.name AS torneo, c.source AS fuente,
    c.weapon AS arma, c.gender AS genero, c.category AS categoria, c.category_raw AS "categoriaRaw",
    c.season AS temporada, coalesce(c.competition_date, e.start_date) AS fecha`);

export function sqlRelevosEntre(yo: readonly string[], rival: readonly string[], f: FiltrosRelevos = {}): SQL {
  const ladoA = sql`rl.fencer_a_person_id IN (${listaUuid(yo)})`;
  const de = (a: string, b: string) => sql.raw(`CASE WHEN rl.fencer_a_person_id IN (SELECT value FROM yo) THEN ${a} ELSE ${b} END`);
  const condiciones: SQL[] = [
    sql`((${ladoA} AND rl.fencer_b_person_id IN (${listaUuid(rival)}))
      OR (rl.fencer_a_person_id IN (${listaUuid(rival)}) AND rl.fencer_b_person_id IN (${listaUuid(yo)})))`,
    ...condicionesPrueba({ temporada: f.temporada, arma: f.arma }, FECHA),
  ];
  if (f.fase) condiciones.push(sql`m.phase = ${f.fase}`);
  return sql`
    WITH yo(value) AS (${listaUuid(yo)})
    SELECT rl.id AS id, rl.relay_number AS numero, m.phase AS fase, m.round_key AS ronda, m.round_label AS "rondaPublicada",
           ${de('rl.touches_a', 'rl.touches_b')} AS mios, ${de('rl.touches_b', 'rl.touches_a')} AS rival,
           ${de('m.team_a_name', 'm.team_b_name')} AS "miEquipo", ${de('m.team_b_name', 'm.team_a_name')} AS "suEquipo",
           ${de('m.score_a', 'm.score_b')} AS "finalMios", ${de('m.score_b', 'm.score_a')} AS "finalRival",
           ${COLUMNAS_PRUEBA}
    FROM sport_relay rl ${UNIONES}
    WHERE ${y(condiciones)}
    ORDER BY ${FECHA} DESC NULLS LAST, m.id, rl.relay_number
    LIMIT ${MAX_RELEVOS_CARA_A_CARA + 1}`;
}

export function sqlRelevosPerfil(ids: readonly string[]): SQL {
  return sql`
    WITH mios AS (
      SELECT rl.match_id, rl.touches_a AS dados, rl.touches_b AS recibidos, 'a' AS lado
      FROM sport_relay rl WHERE rl.fencer_a_person_id IN (${listaUuid(ids)})
      UNION ALL
      SELECT rl.match_id, rl.touches_b, rl.touches_a, 'b'
      FROM sport_relay rl WHERE rl.fencer_b_person_id IN (${listaUuid(ids)})
    )
    SELECT ${COLUMNAS_PRUEBA},
           min(CASE WHEN x.lado = 'a' THEN m.team_a_name ELSE m.team_b_name END) AS equipo,
           count(DISTINCT x.match_id) AS encuentros, count(*) AS relevos,
           sum(x.dados) AS dados, sum(x.recibidos) AS recibidos
    FROM mios x
    CROSS JOIN sport_team_match m ON m.id = x.match_id
    CROSS JOIN sport_competition c ON c.id = m.competition_id
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    GROUP BY c.id
    ORDER BY ${FECHA} DESC NULLS LAST, c.id
    LIMIT ${MAX_PRUEBAS_PERFIL + 1}`;
}

type FilaRelevo = Omit<RelevoCaraACara, 'final'> & { finalMios: number; finalRival: number };

const n = (v: unknown) => Number(v ?? 0);

export function aRelevosCaraACara(rows: readonly FilaRelevo[]): RelevosCaraACara {
  const truncado = rows.length > MAX_RELEVOS_CARA_A_CARA;
  const items = rows.slice(0, MAX_RELEVOS_CARA_A_CARA).map<RelevoCaraACara>(({ finalMios, finalRival, ...r }) => ({
    ...r,
    numero: n(r.numero),
    mios: n(r.mios),
    rival: n(r.rival),
    final: { mios: n(finalMios), rival: n(finalRival) },
  }));
  return {
    items,
    resumen: {
      relevos: items.length,
      tocadosFavor: items.reduce((s, r) => s + r.mios, 0),
      tocadosContra: items.reduce((s, r) => s + r.rival, 0),
    },
    truncado,
  };
}

export function aRelevosPerfil(rows: readonly PruebaRelevosPerfil[]): RelevosPerfil | null {
  const pruebas = rows.slice(0, MAX_PRUEBAS_PERFIL).map((r) => ({
    ...r,
    encuentros: n(r.encuentros),
    relevos: n(r.relevos),
    dados: n(r.dados),
    recibidos: n(r.recibidos),
  }));
  if (pruebas.length === 0) return null;
  const suma = (k: 'encuentros' | 'relevos' | 'dados' | 'recibidos') => pruebas.reduce((s, p) => s + p[k], 0);
  return {
    relevos: suma('relevos'),
    encuentros: suma('encuentros'),
    dados: suma('dados'),
    recibidos: suma('recibidos'),
    indice: suma('dados') - suma('recibidos'),
    pruebas,
    truncado: rows.length > MAX_PRUEBAS_PERFIL,
  };
}

function registrar(error: unknown, que: string): void {
  // Sin la 0010 o sin sesión no hay nada que avisar: la sección simplemente no sale.
  const mensaje = error instanceof Error ? error.message : '';
  if (mensaje === ERROR_NO_AUTENTICADO || /no such table: sport_(relay|team_match)/.test(mensaje)) return;
  console.error(`[explorar] ${que}:`, error instanceof Error ? error.message.slice(0, 120) : 'desconocido');
}

/** Relevos de una persona (todas las ids de su grupo de fusión); `null` si no hay o no se pudo leer. */
export async function leerRelevosPerfilDe(db: ContextoExplorador['db'], ids: readonly string[]): Promise<RelevosPerfil | null> {
  try {
    return aRelevosPerfil(filas<PruebaRelevosPerfil>(await db.execute(sqlRelevosPerfil(ids))));
  } catch (error) {
    registrar(error, 'relevos del perfil');
    return null;
  }
}

const ARMAS = new Set<string>(['FLORETE', 'ESPADA', 'SABLE']);

/**
 * Relevos entre dos personas para el cara a cara, con los mismos filtros de
 * temporada, arma y fase. `null` si alguna no existe, no hay sesión válida
 * para leer o las tablas aún no están.
 */
export async function cargarRelevosCaraACara(
  ctx: ContextoExplorador,
  personaId: string,
  rivalId: string,
  filtros: { temporada?: string; arma?: string; fase?: string } = {},
): Promise<RelevosCaraACara | null> {
  try {
    await exigirPerfil(ctx);
    if (!UUID_RE.test(personaId) || !UUID_RE.test(rivalId) || !(await ctx.esquema()).identidad) return null;
    const [yo, rival] = await Promise.all([resolverPersona(ctx.db, personaId), resolverPersona(ctx.db, rivalId)]);
    if (!yo || !rival || yo.canonicaId === rival.canonicaId) return null;
    const f: FiltrosRelevos = {
      ...(filtros.temporada ? { temporada: filtros.temporada } : {}),
      ...(filtros.arma && ARMAS.has(filtros.arma) ? { arma: filtros.arma as Arma } : {}),
      ...(filtros.fase === 'POULE' || filtros.fase === 'TABLEAU' ? { fase: filtros.fase } : {}),
    };
    return aRelevosCaraACara(filas<FilaRelevo>(await ctx.db.execute(sqlRelevosEntre(yo.ids, rival.ids, f))));
  } catch (error) {
    registrar(error, 'relevos del cara a cara');
    return null;
  }
}
