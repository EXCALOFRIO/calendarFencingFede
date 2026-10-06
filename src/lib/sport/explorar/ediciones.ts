import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { clasificarSerie, SERIES_COMPLEMENTARIAS, type SerieComplementaria } from '@/lib/ingest/series-complementarias';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, UUID_RE } from './cursor';
import {
  agruparPruebas,
  enlacesDePrueba,
  estadoResultados,
  FUENTE_FIE,
  lecturasDePuestos,
  pruebaDeId,
  pruebaPorDefecto,
  type Clasificacion,
  type EdicionDetalle,
  type EdicionResumen,
  type FilaClasificacion,
  type FilaEnlace,
  type PruebaDeEdicion,
} from './edicion-modelo';
import { leerAsaltosDeGrupo } from './ediciones-asaltos';
import type { AsaltosDePrueba } from './tipos-busqueda';
import { listaUuid, plegarSql } from './filtros-sql';
import type { Arma, Formato, Genero } from './tipos';

/**
 * Lecturas de ediciones y de la clasificación de sus pruebas. Sólo leen D1:
 * ni llaman a una fuente externa ni dependen de que la edición esté vinculada
 * al calendario. Cada lectura exige sesión antes de validar o consultar nada.
 */

const LIMITE_EDICIONES_SERIE = 200;
const LIMITE_PRUEBAS = 200;
const LIMITE_EDICIONES_EVENTO = 6;
const CLASE_CLASIFICACION = 'clasificacion-edicion';
/**
 * La clasificación se lee entera de una vez (una prueba FIE ronda los 400
 * puestos): el buscador de la página la recorre en el cliente. Por encima se
 * pagina con el cursor.
 */
export const LIMITE_CLASIFICACION = 1000;

const uuid = z.string().regex(UUID_RE);

export const esquemaEdicion = z
  .object({
    edicionId: uuid,
    prueba: uuid.optional(),
    cursor: z.string().min(1).max(600).optional(),
    limite: z.number().int().min(1).max(LIMITE_CLASIFICACION).optional(),
  })
  .strict();

const esquemaEvento = z.object({ eventoId: uuid }).strict();

type FilaEdicion = {
  id: string;
  nombre: string;
  temporada: string;
  fuente: string;
  ciudad: string | null;
  pais: string | null;
  inicio: string | null;
  fin: string | null;
  pruebas: number;
  armas: string | null;
  formatos: string | null;
};

function lista<T extends string>(texto: string | null): T[] {
  return texto ? (texto.split(',').filter(Boolean).sort() as T[]) : [];
}

export function aResumen(f: FilaEdicion): EdicionResumen {
  return {
    id: f.id,
    nombre: f.nombre,
    temporada: f.temporada,
    fuente: f.fuente,
    ciudad: f.ciudad,
    pais: f.pais,
    inicio: f.inicio,
    fin: f.fin,
    pruebas: Number(f.pruebas),
    armas: lista<Arma>(f.armas),
    formatos: lista<Formato>(f.formatos),
    serie: clasificarSerie({ nombre: f.nombre }),
  };
}

/** Columnas de una edición con el resumen de sus pruebas (alias `e`). */
export const COLUMNAS_EDICION = sql`
  e.id AS id, e.name AS nombre, e.season AS temporada, e.source AS fuente,
  e.city AS ciudad, e.country_code AS pais, e.start_date AS inicio, e.end_date AS fin,
  (SELECT count(*) FROM sport_competition c WHERE c.edition_id = e.id) AS pruebas,
  (SELECT group_concat(DISTINCT c.weapon) FROM sport_competition c WHERE c.edition_id = e.id) AS armas,
  (SELECT group_concat(DISTINCT c.format) FROM sport_competition c WHERE c.edition_id = e.id) AS formatos`;

export type ResultadoSeries =
  | { estado: 'ok'; series: { serie: SerieComplementaria; ediciones: EdicionResumen[] }[] }
  | { estado: 'no_disponible' };

/**
 * Ediciones de las tres series complementarias que existen en la base. La
 * serie se decide por el nombre publicado de la edición (como el backfill) y
 * lo no reconocido se omite: nunca se completa una serie con ediciones o pruebas
 * que la fuente no publicó. Una serie sin ediciones se devuelve vacía.
 */
export async function leerSeries(ctx: ContextoExplorador): Promise<ResultadoSeries> {
  await exigirPerfil(ctx);
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const rows = filas<FilaEdicion>(
    await ctx.db.execute(sql`
      SELECT ${COLUMNAS_EDICION}
      FROM sport_edition e
      WHERE ${plegarSql(sql`e.name`)} LIKE '%olymp%'
         OR ${plegarSql(sql`e.name`)} LIKE '%olimp%'
         OR ${plegarSql(sql`e.name`)} LIKE '%mediterr%'
      ORDER BY e.start_date DESC NULLS LAST, e.id DESC
      LIMIT ${LIMITE_EDICIONES_SERIE}`),
  );
  const ediciones = rows.map(aResumen);
  return {
    estado: 'ok',
    series: SERIES_COMPLEMENTARIAS.map((serie) => ({
      serie,
      ediciones: ediciones.filter((e) => e.serie === serie),
    })),
  };
}

type FilaPrueba = {
  id: string;
  edicionId: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string | null;
  formato: Formato;
  fecha: string | null;
  fuente: string;
  pruebaCalendarioId: string | null;
  importados: number;
  asaltos?: number;
};

type FilaLectura = {
  pruebaId: string;
  hecho: string;
  fuente: string;
  estado: string;
  cursor: string | null;
  url: string | null;
};

export function aPrueba(
  f: FilaPrueba,
  lecturas: readonly FilaLectura[],
): PruebaDeEdicion {
  const importados = Number(f.importados);
  return {
    id: f.id,
    arma: f.arma,
    genero: f.genero,
    categoria: { codigo: f.categoria, raw: f.categoriaRaw },
    formato: f.formato,
    fecha: f.fecha,
    fuente: f.fuente,
    pruebaCalendarioId: f.pruebaCalendarioId,
    asaltos: Number(f.asaltos ?? 0),
    resultados: {
      estado: estadoResultados(
        importados,
        lecturasDePuestos(lecturas),
      ),
      importados,
    },
    enlaces: enlacesDePrueba(
      lecturas
        .filter((l) => l.hecho === 'link')
        .map<FilaEnlace>((l) => ({ fuente: l.fuente, cursor: l.cursor, url: l.url })),
    ),
  };
}

/** Pruebas de varias ediciones con su estado de resultados y sus enlaces comprobados. */
async function leerPruebas(
  ctx: ContextoExplorador,
  edicionIds: readonly string[],
): Promise<Map<string, PruebaDeEdicion[]>> {
  const porEdicion = new Map<string, PruebaDeEdicion[]>();
  if (edicionIds.length === 0) return porEdicion;
  const ids = listaUuid(edicionIds);

  const pruebas = filas<FilaPrueba>(
    await ctx.db.execute(sql`
      SELECT c.id AS id, c.edition_id AS "edicionId", c.weapon AS arma,
             c.gender AS genero, c.category AS categoria, c.category_raw AS "categoriaRaw",
             c.format AS formato, c.competition_date AS fecha, c.source AS fuente,
             c.event_competition_id AS "pruebaCalendarioId",
             (SELECT count(*) FROM sport_result r WHERE r.competition_id = c.id) AS importados,
             (SELECT count(*) FROM sport_bout b WHERE b.competition_id = c.id) AS asaltos
      FROM sport_competition c
      WHERE c.edition_id IN (${ids})
      ORDER BY c.edition_id, c.competition_date NULLS LAST, c.format, c.weapon,
               c.gender, c.category, c.id
      LIMIT ${LIMITE_PRUEBAS}`),
  );
  if (pruebas.length === 0) return porEdicion;

  // Lectura de puestos por prueba (`results`, o `ranking` si es de la FIE) y
  // estado de enlaces por la clave de la prueba canónica (`fuente:clave`), que
  // es como se guardan.
  const lecturas = filas<FilaLectura>(
    await ctx.db.execute(sql`
      SELECT cov.competition_id AS "pruebaId", cov.fact_kind AS hecho, cov.source AS fuente,
             cov.status AS estado, cov.cursor AS cursor, cov.source_url AS url
      FROM sport_import_coverage cov
      WHERE (cov.fact_kind = 'results' OR (cov.fact_kind = 'ranking' AND cov.source = ${FUENTE_FIE}))
        AND cov.competition_id IN (SELECT c.id FROM sport_competition c WHERE c.edition_id IN (${ids}))
      UNION ALL
      SELECT c.id, cov.fact_kind, cov.source, cov.status, cov.cursor, cov.source_url
      FROM sport_competition c
      JOIN sport_import_coverage cov
        ON cov.fact_kind = 'link' AND cov.season = c.season
       AND cov.competition_key = c.source || ':' || c.competition_key
      WHERE c.edition_id IN (${ids}) AND cov.source LIKE 'enlace:%'`),
  );

  for (const f of pruebas) {
    const dto = aPrueba(f, lecturas.filter((l) => l.pruebaId === f.id));
    const actuales = porEdicion.get(f.edicionId) ?? [];
    actuales.push(dto);
    porEdicion.set(f.edicionId, actuales);
  }
  for (const [id, lista] of porEdicion) porEdicion.set(id, agruparPruebas(lista));
  return porEdicion;
}

export type ResultadoEdicionesEvento =
  | { estado: 'ok'; ediciones: (EdicionResumen & { pruebasDetalle: PruebaDeEdicion[] })[] }
  | { estado: 'entrada_invalida' }
  | { estado: 'no_disponible' };

/**
 * Ediciones deportivas vinculadas a un torneo del calendario (también las
 * vinculadas a su par absorbido). Una lista vacía significa «sin edición
 * vinculada»; no dice nada sobre si el torneo ha tenido resultados.
 */
export async function leerEdicionesDeEvento(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoEdicionesEvento> {
  await exigirPerfil(ctx);
  const analizada = esquemaEvento.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const { eventoId } = analizada.data;
  const rows = filas<FilaEdicion>(
    await ctx.db.execute(sql`
      SELECT ${COLUMNAS_EDICION}
      FROM sport_edition e
      JOIN event ev ON ev.id = e.event_id
      WHERE ev.id = ${eventoId} OR ev.canonical_event_id = ${eventoId}
      ORDER BY e.start_date NULLS LAST, e.id
      LIMIT ${LIMITE_EDICIONES_EVENTO}`),
  );
  const resumenes = rows.map(aResumen);
  const pruebas = await leerPruebas(ctx, resumenes.map((e) => e.id));
  return {
    estado: 'ok',
    ediciones: resumenes.map((e) => ({ ...e, pruebasDetalle: pruebas.get(e.id) ?? [] })),
  };
}

/** `null` = sin asaltos importados de la prueba (o ninguna prueba elegida); `'error'` = no se pudieron leer. */
export type AsaltosEdicion = AsaltosDePrueba | null | 'error';

/** Opcional para quien construye la edición sin leer asaltos (banda del calendario, pruebas). */
export type EdicionConAsaltos = EdicionDetalle & { asaltos?: AsaltosEdicion };

export type ResultadoEdicion =
  | { estado: 'ok'; edicion: EdicionConAsaltos }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'no_encontrada' }
  | { estado: 'no_disponible' };

type FilaPuesto = {
  id: string;
  puesto: number | null;
  puestoPublicado: string | null;
  nombre: string;
  pais: string | null;
  club: string | null;
  personaId: string | null;
};

/**
 * Una edición con todas sus pruebas (agrupadas, ver `agruparPruebas`) y la
 * clasificación, poules y cuadro de la prueba pedida o, sin pedir ninguna, de
 * la primera con puestos. La clasificación sale de UNA fuente (la que más
 * puestos tiene) para no mezclar dos lecturas de la misma prueba; las demás se avisan.
 * El cursor de página sólo vale con la prueba escrita en la petición.
 * Una fila lleva `personaId` sólo si el resultado está vinculado a una persona
 * deportiva: nunca se busca por nombre ni se usa una cuenta.
 */
export async function leerEdicion(ctx: ContextoExplorador, entrada: unknown): Promise<ResultadoEdicion> {
  await exigirPerfil(ctx);
  const analizada = esquemaEdicion.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  const { edicionId, prueba, cursor, limite: pedido } = analizada.data;

  // El cursor sólo vale para la misma edición y prueba.
  const huella = { edicionId, prueba: prueba ?? null };
  let clave: readonly (string | number)[] | null = null;
  if (cursor) {
    clave = decodificarCursor(CLASE_CLASIFICACION, huella, cursor, 3);
    if (!clave || !UUID_RE.test(String(clave[2])) || ![0, 1].includes(Number(clave[0]))) {
      return { estado: 'cursor_invalido' };
    }
  }

  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const [cabecera] = filas<FilaEdicion>(
    await ctx.db.execute(sql`
      SELECT ${COLUMNAS_EDICION}
      FROM sport_edition e
      WHERE e.id = ${edicionId}`),
  );
  if (!cabecera) return { estado: 'no_encontrada' };

  const pruebasDetalle = (await leerPruebas(ctx, [edicionId])).get(edicionId) ?? [];
  // Una parte de una prueba agrupada abre la prueba entera; sin pedir ninguna
  // se abre la primera con puestos. Una prueba ajena no abre otra en su lugar.
  const elegida = prueba ? pruebaDeId(pruebasDetalle, prueba) : pruebaPorDefecto(pruebasDetalle);

  let clasificacion: Clasificacion | null = null;
  let asaltos: AsaltosEdicion = null;
  if (elegida) {
    const huellaElegida = { edicionId, prueba: elegida.id };
    [clasificacion, asaltos] = await Promise.all([
      leerClasificacion(ctx, elegida.id, huellaElegida, clave, pedido ?? LIMITE_CLASIFICACION),
      // Poules y cuadro son un extra: si fallan, la clasificación se sigue viendo.
      leerAsaltosDeGrupo(ctx, elegida.miembros ?? [elegida.id]).catch((error: unknown) => {
        console.error('[explorar] los asaltos de la prueba no se pudieron leer:', error instanceof Error ? error.name : 'desconocido');
        return 'error' as const;
      }),
    ]);
  }

  return {
    estado: 'ok',
    edicion: {
      ...aResumen(cabecera),
      pruebasDetalle,
      pruebaDesconocida: Boolean(prueba) && !elegida,
      clasificacion,
      asaltos,
      pruebaElegida: elegida?.id ?? null,
    },
  };
}

async function leerClasificacion(
  ctx: ContextoExplorador,
  pruebaId: string,
  huella: unknown,
  clave: readonly (string | number)[] | null,
  limite: number,
): Promise<Clasificacion> {
  const fuentes = filas<{ fuente: string; n: number }>(
    await ctx.db.execute(sql`
      SELECT r.source AS fuente, count(*) AS n
      FROM sport_result r
      WHERE r.competition_id = ${pruebaId}
      GROUP BY r.source
      ORDER BY count(*) DESC, r.source`),
  );
  const principal = fuentes[0];
  if (!principal) return { pruebaId, fuente: '', filas: [], siguiente: null, otrasFuentes: [] };

  const posicion = sql`(r.position IS NULL), coalesce(r.position, 0), r.id`;
  const condicion = clave
    ? sql`AND ((r.position IS NULL), coalesce(r.position, 0), r.id) > (${Number(clave[0])}, ${Number(clave[1])}, ${String(clave[2])})`
    : sql``;
  const rows = filas<FilaPuesto>(
    await ctx.db.execute(sql`
      SELECT r.id AS id, r.position AS puesto, r.position_raw AS "puestoPublicado",
             r.source_name AS nombre, r.source_country_code AS pais, r.source_club AS club,
             r.person_id AS "personaId"
      FROM sport_result r
      WHERE r.competition_id = ${pruebaId} AND r.source = ${principal.fuente} ${condicion}
      ORDER BY ${posicion}
      LIMIT ${limite + 1}`),
  );
  const pagina = rows.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  const siguiente =
    rows.length > limite && ultima
      ? codificarCursor(CLASE_CLASIFICACION, huella, [
          ultima.puesto === null ? 1 : 0,
          ultima.puesto ?? 0,
          ultima.id,
        ])
      : null;

  return {
    pruebaId,
    fuente: principal.fuente,
    filas: pagina.map<FilaClasificacion>((r) => ({
      id: r.id,
      puesto: r.puesto === null ? null : Number(r.puesto),
      puestoPublicado: r.puestoPublicado,
      nombre: r.nombre,
      pais: r.pais,
      club: r.club,
      personaId: r.personaId,
    })),
    siguiente,
    otrasFuentes: fuentes.slice(1).map((f) => ({ fuente: f.fuente, filas: Number(f.n) })),
  };
}
