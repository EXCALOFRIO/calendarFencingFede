import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor } from './cursor';
import { LIMITE_MAXIMO, LIMITE_POR_DEFECTO } from './entrada';
import {
  consultarFavorito,
  guardarFavorito,
  listarFavoritos,
  quitarFavorito,
} from './favoritos';
import { FECHA_EDICION } from './asaltos-orientados-sql';
import { listaUuid } from './filtros-sql';
import { clasificarCompeticion } from './tipo-competicion';
import type {
  EntradaSiguiendo,
  Medalla,
  ResultadoConteoSiguiendo,
  ResultadoSiguiendo,
} from './tipos-social';

/**
 * «Seguir» es el favorito de siempre (`sport_favorite`) con otro nombre: no
 * hay tabla nueva, ni avisos, ni nada visible para la persona seguida. Las
 * acciones son las de favoritos (misma sesión, misma consolidación de
 * fusiones, misma guarda de sólo lectura).
 */
export const seguir = guardarFavorito;
export const dejarDeSeguir = quitarFavorito;
export const consultarSeguimiento = consultarFavorito;
export const listarSeguidos = listarFavoritos;

const CLASE = 'siguiendo';

/**
 * Personas seguidas que entran en el feed (las guardadas más recientemente).
 * Acota el trabajo de una cuenta con muchísimos favoritos.
 */
export const MAX_SEGUIDAS_FEED = 300;

/** Umbral que no deja fuera ninguna fila. */
const SIN_UMBRAL = '0000-00-00';

/**
 * Filas con fecha leídas por página en el primer intento. El doble cubre las
 * copias que retira la deduplicación; con medallas se asume que al menos una
 * de cada diez filas es podio (si no, se repite sin ventana).
 */
export function candidatosFeed(limite: number, soloMedallas: boolean): number {
  return (soloMedallas ? 10 : 2) * (limite + 1);
}

const CLAVE_ID_RE = /^[0-9a-zA-Z-]{1,64}$/;
const CLAVE_FECHA_RE = /^\d{4}-\d{2}-\d{2}/;

const esquemaFeed = z
  .object({
    cursor: z.string().min(1).max(600).optional(),
    limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional(),
    soloMedallas: z.boolean().optional(),
  })
  .strict();

/** Seguidas de la cuenta, llevadas a su persona raíz (las fusiones no encadenan). */
function seguidasDe(profileId: string) {
  return sql`
    seguidas AS MATERIALIZED (
      SELECT coalesce(p.merged_into_person_id, p.id) AS canonica, max(f.created_at) AS creado
      FROM sport_favorite f CROSS JOIN sport_person p ON p.id = f.person_id
      WHERE f.profile_id = ${profileId}
      GROUP BY coalesce(p.merged_into_person_id, p.id)
      ORDER BY creado DESC LIMIT ${MAX_SEGUIDAS_FEED}
    )`;
}

/**
 * Resultados de las personas seguidas, del más reciente al más antiguo.
 *
 * Leer la fila de `sport_result` cuesta ~10 µs (filas anchas); seguir a 300
 * personas con muchos resultados son ~40 000 filas. Por eso primero se
 * calcula SÓLO con `sport_result_person_date_idx` (sin tocar la tabla) la
 * fecha umbral por encima de la cual ya hay al menos `candidatos` resultados
 * con fecha posteriores al cursor, y sólo se leen las filas desde esa fecha
 * (las sin `occurred_on`, del PDF RFEE, toman la fecha de la prueba y se
 * filtran igual). Cualquier fila más antigua queda por detrás de esas
 * `candidatos`, así que si la página sale llena es exacta. Si la
 * deduplicación o el filtro de medallas la dejan corta, `leerFeedSiguiendo`
 * repite con `candidatos = null` (todas las filas de las seguidas, acotadas
 * por `MAX_SEGUIDAS_FEED`). La columna `umbral` dice qué ventana se usó.
 *
 * Cada persona entra con todos los miembros de su grupo fusionado. Si hay
 * varias copias de la misma prueba para la misma persona (dos miembros
 * fundidos, o dos fuentes con el mismo `event_competition_id`) sale sólo la de
 * mayor clave de orden; con cursor, una copia se descarta también si su
 * hermana mayor ya salió en una página anterior.
 *
 * Sólo se filtra por `profile_id` de la sesión: ninguna entrada elige cuenta.
 */
export function sqlFeedSiguiendo(
  profileId: string,
  limite: number,
  clave: readonly [string, string] | null,
  soloMedallas: boolean,
  candidatos: number | null = candidatosFeed(limite, soloMedallas),
) {
  const medallas = (alias: string) =>
    soloMedallas ? sql.raw(`AND ${alias}.position BETWEEN 1 AND 3`) : sql``;
  // Sólo fechas estrictamente anteriores a la del cursor: mencionar `r.id`
  // obligaría a leer cada fila de la tabla. El umbral sale igual o más bajo
  // (más candidatas), nunca deja fuera una fila de la página.
  const trasCursor = clave ? sql`AND r.occurred_on < ${clave[0]}` : sql``;
  const umbral = candidatos === null
    ? sql`${SIN_UMBRAL}`
    : sql`coalesce((
        SELECT r.occurred_on FROM miembros m CROSS JOIN sport_result r ON r.person_id = m.id
        WHERE r.occurred_on IS NOT NULL ${trasCursor}
        ORDER BY r.occurred_on DESC LIMIT 1 OFFSET ${candidatos - 1}
      ), ${SIN_UMBRAL})`;
  // Una hermana con clave mayor tiene fecha >= la de la copia: con fecha
  // propia se busca por rango del índice; sin ella, entre las filas sin fecha.
  const hermana = (fechaPropia: boolean) => sql`EXISTS (
      SELECT 1 FROM miembros m2
      CROSS JOIN sport_result r2 ON r2.person_id = m2.id
      CROSS JOIN sport_competition c ON c.id = r2.competition_id
      WHERE m2.canonica = p.canonica
        AND ${fechaPropia ? sql`r2.occurred_on >= p.fecha_orden` : sql`r2.occurred_on IS NULL`}
        AND r2.id <> p.resultado ${medallas('r2')}
        AND coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) = p.equivalencia
        AND (coalesce(r2.occurred_on, c.competition_date, ${sql.raw(FECHA_EDICION)}, '0001-01-01'), r2.id)
          > (p.fecha_orden, p.resultado))`;
  const posicion = clave ? sql`AND (u.fecha_orden, u.resultado) < (${clave[0]}, ${clave[1]})` : sql``;
  const yaMostrada = clave
    ? sql`WHERE NOT ((p.equivalencia GLOB 'cal:*' OR (SELECT count(*) FROM miembros g WHERE g.canonica = p.canonica) > 1)
        AND (${hermana(true)} OR ${hermana(false)}))`
    : sql``;
  const ventana = clave
    ? sql`>= (SELECT fecha FROM umbral) AND fecha_orden <= ${clave[0]}`
    : sql`>= (SELECT fecha FROM umbral)`;
  return sql`
    WITH ${seguidasDe(profileId)}, miembros AS MATERIALIZED (
      SELECT s.canonica, s.canonica AS id FROM seguidas s
      UNION
      SELECT s.canonica, m.id FROM seguidas s CROSS JOIN sport_person m ON m.merged_into_person_id = s.canonica
    ), umbral AS MATERIALIZED (
      SELECT ${umbral} AS fecha
    ), candidatos AS MATERIALIZED (
      SELECT m.canonica, r.id AS resultado, r.competition_id AS prueba, r.occurred_on AS fecha_orden
      FROM miembros m CROSS JOIN sport_result r ON r.person_id = m.id
      WHERE r.occurred_on >= (SELECT fecha FROM umbral) ${clave ? sql`AND r.occurred_on <= ${clave[0]}` : sql``}
        ${medallas('r')}
      UNION ALL
      SELECT * FROM (
        SELECT m.canonica, r.id AS resultado, r.competition_id AS prueba,
               coalesce(c.competition_date, ${sql.raw(FECHA_EDICION)}, '0001-01-01') AS fecha_orden
        FROM miembros m
        CROSS JOIN sport_result r ON r.person_id = m.id
        CROSS JOIN sport_competition c ON c.id = r.competition_id
        WHERE r.occurred_on IS NULL ${medallas('r')}
      ) WHERE fecha_orden ${ventana}
    ), unicos AS (
      SELECT k.*, coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
             row_number() OVER (
               PARTITION BY k.canonica, coalesce('cal:' || c.event_competition_id, 'sport:' || c.id)
               ORDER BY k.fecha_orden DESC, k.resultado DESC) AS copia
      FROM candidatos k CROSS JOIN sport_competition c ON c.id = k.prueba
    ), previas AS MATERIALIZED (
      SELECT * FROM unicos u WHERE u.copia = 1 ${posicion}
    ), pagina AS MATERIALIZED (
      SELECT * FROM previas p ${yaMostrada}
      ORDER BY p.fecha_orden DESC, p.resultado DESC
      LIMIT ${limite + 1}
    ), conteos AS MATERIALIZED (
      -- Caché de conteos sólo durante esta sentencia: varias personas de la
      -- página comparten prueba. Sin KV, caducidades ni otra ida a D1.
      SELECT pruebas.prueba,
             (SELECT count(*) FROM sport_result x WHERE x.competition_id = pruebas.prueba) AS participantes
      FROM (SELECT DISTINCT prueba FROM pagina) pruebas
    )
    SELECT pg.resultado AS id, pg.fecha_orden AS "fechaOrden", (SELECT fecha FROM umbral) AS umbral,
           coalesce(r.occurred_on, c.competition_date, e.start_date) AS fecha,
           CASE WHEN r.position > 0 THEN r.position END AS puesto, r.position_raw AS "puestoLiteral",
           tot.participantes AS participantes,
           p.id AS "personaId", p.display_name AS nombre, p.country_code AS pais,
           c.id AS "pruebaId", e.id AS "edicionId", e.name AS torneo, e.city AS ciudad,
           e.country_code AS "paisEdicion", c.weapon AS arma, c.gender AS genero,
           c.category AS categoria, c.format AS formato, c.source AS fuente,
           ev0.scope AS "ambitoEvento", ev0.circuit AS "circuitoEvento", ev0.source AS "fuenteEvento"
    FROM pagina pg
    CROSS JOIN conteos tot ON tot.prueba = pg.prueba
    CROSS JOIN sport_result r ON r.id = pg.resultado
    CROSS JOIN sport_person p ON p.id = pg.canonica
    CROSS JOIN sport_competition c ON c.id = pg.prueba
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    ORDER BY pg.fecha_orden DESC, pg.resultado DESC`;
}

type FilaFeed = {
  id: string;
  fechaOrden: string;
  umbral: string;
  fecha: string | null;
  puesto: number | null;
  puestoLiteral: string | null;
  participantes: number;
  personaId: string;
  nombre: string;
  pais: string | null;
  pruebaId: string;
  edicionId: string;
  torneo: string;
  ciudad: string | null;
  paisEdicion: string | null;
  arma: string;
  genero: string;
  categoria: string;
  formato: string;
  fuente: string;
  ambitoEvento: string | null;
  circuitoEvento: string | null;
  fuenteEvento: string | null;
};

const MEDALLAS: Record<number, Medalla> = { 1: 'oro', 2: 'plata', 3: 'bronce' };

function aEntrada(f: FilaFeed): EntradaSiguiendo {
  const puesto = f.puesto === null ? null : Number(f.puesto);
  return {
    id: f.id,
    persona: { id: f.personaId, nombre: f.nombre, pais: f.pais },
    fecha: f.fecha,
    puesto,
    puestoLiteral: f.puestoLiteral,
    medalla: puesto === null ? null : (MEDALLAS[puesto] ?? null),
    participantes: Number(f.participantes),
    prueba: {
      id: f.pruebaId, edicionId: f.edicionId, torneo: f.torneo, ciudad: f.ciudad,
      arma: f.arma, genero: f.genero, categoria: f.categoria, formato: f.formato, fuente: f.fuente,
    },
    clasificacion: clasificarCompeticion({
      nombre: f.torneo, fuente: f.fuente, pais: f.paisEdicion,
      ambitoEvento: f.ambitoEvento, circuitoEvento: f.circuitoEvento, fuenteEvento: f.fuenteEvento,
    }),
  };
}

/** Feed «Siguiendo» de la cuenta de la sesión, paginado por cursor. */
export async function leerFeedSiguiendo(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoSiguiendo> {
  const perfil = await exigirPerfil(ctx);
  const analizada = esquemaFeed.safeParse(entrada ?? {});
  if (!analizada.success) return { estado: 'entrada_invalida' };
  const soloMedallas = analizada.data.soloMedallas ?? false;

  // La huella incluye la cuenta: un cursor de otra cuenta o filtro no sirve.
  const filtros = { cuenta: perfil.profileId, soloMedallas };
  let clave: [string, string] | null = null;
  if (analizada.data.cursor) {
    const k = decodificarCursor(CLASE, filtros, analizada.data.cursor, 2);
    if (!k || !CLAVE_FECHA_RE.test(String(k[0])) || !CLAVE_ID_RE.test(String(k[1]))) {
      return { estado: 'cursor_invalido' };
    }
    clave = [String(k[0]), String(k[1])];
  }
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const limite = analizada.data.limite ?? LIMITE_POR_DEFECTO;
  let rows = filas<FilaFeed>(
    await ctx.db.execute(sqlFeedSiguiendo(perfil.profileId, limite, clave, soloMedallas)),
  );
  // Página corta con ventana: puede haber filas más antiguas que cuenten.
  if (rows.length <= limite && (rows.length === 0 || rows[0].umbral !== SIN_UMBRAL)) {
    rows = filas<FilaFeed>(
      await ctx.db.execute(sqlFeedSiguiendo(perfil.profileId, limite, clave, soloMedallas, null)),
    );
  }
  const pagina = rows.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  return {
    estado: 'ok',
    items: pagina.map(aEntrada),
    siguiente: rows.length > limite && ultima
      ? codificarCursor(CLASE, filtros, [ultima.fechaOrden, ultima.id])
      : null,
    sinResultados: pagina.length === 0,
  };
}

export function sqlConteoSiguiendo(profileId: string) {
  return sql`
    SELECT count(DISTINCT coalesce(p.merged_into_person_id, p.id)) AS n
    FROM sport_favorite f CROSS JOIN sport_person p ON p.id = f.person_id
    WHERE f.profile_id = ${profileId}`;
}

/** De `ids` (personas raíz), las que sigue la cuenta, aunque guardara a una fundida en ellas. */
export function sqlSeguidasEntre(profileId: string, ids: readonly string[]) {
  return sql`
    SELECT DISTINCT coalesce(p.merged_into_person_id, p.id) AS id
    FROM sport_favorite f CROSS JOIN sport_person p ON p.id = f.person_id
    WHERE f.profile_id = ${profileId}
      AND coalesce(p.merged_into_person_id, p.id) IN (${listaUuid(ids)})`;
}

/** Personas de `ids` que sigue la cuenta de la sesión. */
export async function seguidasEntre(ctx: ContextoExplorador, ids: readonly string[]): Promise<Set<string>> {
  const perfil = await exigirPerfil(ctx);
  if (ids.length === 0) return new Set();
  return new Set(filas<{ id: string }>(await ctx.db.execute(sqlSeguidasEntre(perfil.profileId, ids))).map((f) => f.id));
}

/** «Siguiendo N» de la cuenta de la sesión (personas raíz distintas). */
export async function contarSiguiendo(ctx: ContextoExplorador): Promise<ResultadoConteoSiguiendo> {
  const perfil = await exigirPerfil(ctx);
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const [fila] = filas<{ n: number }>(await ctx.db.execute(sqlConteoSiguiendo(perfil.profileId)));
  return { estado: 'ok', siguiendo: Number(fila?.n ?? 0) };
}
