import { sql } from 'drizzle-orm';
import {
  leerRankingOficialDePersonas,
  type EntradaPersonaRankingOficial,
} from '@/lib/sport/ranking-oficial-db';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, FECHA_RE, UUID_RE } from './cursor';
import {
  esquemaFicha,
  esquemaHistorial,
  filtrosPrueba,
  LIMITE_POR_DEFECTO,
} from './entrada';
import {
  condicionesPrueba,
  FECHA_ORDEN_RESULTADO,
  FECHA_RESULTADO,
  listaUuid,
  TIPO_DOCUMENTADO,
  UNION_EVENTO_CANONICO,
  unionesPrueba,
  y,
} from './filtros-sql';
import { leerCabeceras, resolverPersona } from './personas';
import { resolverPersonaPropia, type PropietarioResuelto } from './propietario';
import type {
  Arma,
  CoberturaFicha,
  EntradaRankingOficial,
  EstadisticaPorTipo,
  EstadoCoberturaDto,
  FichaDeportiva,
  FiltrosPrueba,
  Formato,
  Genero,
  ResultadoHistorial,
} from './tipos';

/**
 * RFEE (Skermo) y FIE no publican la fecha de su ranking: `publishedOn` es el
 * día que se leyó. Con lo guardado ninguna fuente puede demostrar una fecha
 * histórica, así que `sourcePublishedOn` queda desconocida y la fecha se
 * presenta como observada (base de lectura) hasta que una fuente publique la
 * suya y se guarde aparte.
 */
export function fechaRanking(publishedOn: string): EntradaRankingOficial['fecha'] {
  return { sourcePublishedOn: null, observedOn: publishedOn, baseLectura: true };
}

export function aEntradaRanking(e: EntradaPersonaRankingOficial): EntradaRankingOficial {
  const p = e.publicacion;
  return {
    fuente: p.source,
    temporada: p.season,
    arma: p.weapon as Arma,
    genero: p.gender as Genero,
    categoria: { codigo: p.category, raw: p.categoryRaw },
    formato: p.format as Formato,
    puesto: e.position,
    puntos: e.points,
    totalPublicado: p.publishedTotal,
    fecha: fechaRanking(p.publishedOn),
    enlace: p.sourceUrl,
  };
}

type FilaEstadistica = {
  tipo: string | null;
  clasificaciones: number;
  mejorPuesto: number | null;
  podios: number;
  victorias: number;
  sinPuesto: number;
};

export function aEstadisticas(rows: readonly FilaEstadistica[]): EstadisticaPorTipo[] {
  return rows
    .map<EstadisticaPorTipo>((r) => ({
      tipo: r.tipo,
      clasificaciones: Number(r.clasificaciones),
      mejorPuesto: r.mejorPuesto === null ? null : Number(r.mejorPuesto),
      podios: Number(r.podios),
      victorias: Number(r.victorias),
      sinPuestoNumerico: Number(r.sinPuesto),
    }))
    .sort((a, b) => {
      if (a.tipo === null) return b.tipo === null ? 0 : 1;
      if (b.tipo === null) return -1;
      return a.tipo < b.tipo ? -1 : 1;
    });
}

/**
 * Estadísticas por tipo de torneo DOCUMENTADO a partir de clasificaciones
 * individuales publicadas, una por prueba (una prueba leída en dos fuentes no
 * cuenta dos veces). Una inscripción sin resultado no existe aquí: no se lee
 * `competition_registration`. El tipo sale del circuito del calendario
 * vinculado; sin vínculo o con circuito genérico va al grupo `null`.
 */
export function sqlEstadisticas(ids: readonly string[]) {
  return sql`
    SELECT tipo, count(*) FILTER (WHERE puesto IS NOT NULL)::int AS clasificaciones,
           min(puesto)::int AS "mejorPuesto",
           count(*) FILTER (WHERE puesto <= 3)::int AS podios,
           count(*) FILTER (WHERE puesto = 1)::int AS victorias,
           count(*) FILTER (WHERE puesto IS NULL)::int AS "sinPuesto"
    FROM (
      SELECT DISTINCT ON (r.competition_id) ${TIPO_DOCUMENTADO} AS tipo, r.position AS puesto
      FROM sport_result r
      ${unionesPrueba('r')}
      ${UNION_EVENTO_CANONICO}
      WHERE r.person_id IN (${listaUuid(ids)}) AND c.format::text = 'INDIVIDUAL'
      ORDER BY r.competition_id, (r.position IS NULL), r.revised_at DESC, r.id DESC
    ) una_por_prueba
    GROUP BY tipo`;
}

export function sqlCobertura(ids: readonly string[]) {
  const lista = listaUuid(ids);
  return [
    sql`
      SELECT count(*)::int AS resultados, count(DISTINCT r.competition_id)::int AS pruebas,
             count(DISTINCT c.edition_id)::int AS ediciones
      FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
      WHERE r.person_id IN (${lista})`,
    sql`
      SELECT cov.fact_kind AS hecho, cov.status::text AS estado, count(*)::int AS pruebas
      FROM sport_import_coverage cov
      WHERE cov.competition_id IN (
        SELECT DISTINCT r.competition_id FROM sport_result r WHERE r.person_id IN (${lista}))
      GROUP BY cov.fact_kind, cov.status
      ORDER BY cov.fact_kind, cov.status`,
  ] as const;
}

export type ResultadoFicha =
  | { estado: 'ok'; ficha: FichaDeportiva }
  | { estado: 'entrada_invalida' }
  | { estado: 'no_encontrada' }
  | { estado: 'no_disponible' }
  /** Pidió «mi perfil» y la cuenta no tiene una persona confirmada: no se adjudica a un homónimo. */
  | { estado: 'propia_no_confirmada'; motivo: Exclude<PropietarioResuelto['estado'], 'confirmada' | 'no_disponible'> };

/**
 * Ficha deportiva: identidad mínima, estadísticas, cobertura y ranking oficial
 * de una temporada explícita. Sin `personaId` se abre la persona de la cuenta,
 * sólo si está confirmada. Una persona ajena devuelve únicamente hechos
 * deportivos; ni propia ni ajena llevan datos de la cuenta.
 */
export async function leerFicha(ctx: ContextoExplorador, entrada: unknown): Promise<ResultadoFicha> {
  const perfil = await exigirPerfil(ctx);

  const analizada = esquemaFicha.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const propietario = await resolverPersonaPropia(ctx, perfil.profileId);
  let objetivo = analizada.data.personaId;
  if (!objetivo) {
    if (propietario.estado === 'no_disponible') return { estado: 'no_disponible' };
    if (propietario.estado !== 'confirmada') {
      return { estado: 'propia_no_confirmada', motivo: propietario.estado };
    }
    objetivo = propietario.personaId;
  }

  const persona = await resolverPersona(ctx.db, objetivo);
  if (!persona) return { estado: 'no_encontrada' };
  const { canonicaId, ids } = persona;

  const formato: Formato = analizada.data.formato ?? 'INDIVIDUAL';
  const lista = listaUuid(ids);
  const [cobPrueba, cobLecturas] = sqlCobertura(ids);

  const [cabeceras, alias, estadisticas, resumen, lecturas, temporadas] = await Promise.all([
    leerCabeceras(ctx.db, [canonicaId]),
    ctx.db.execute(sql`
      SELECT DISTINCT name_original AS nombre FROM sport_person_alias
      WHERE person_id IN (${lista}) ORDER BY name_original LIMIT 6`),
    ctx.db.execute(sqlEstadisticas(ids)),
    ctx.db.execute(cobPrueba),
    ctx.db.execute(cobLecturas),
    ctx.db.execute(sql`
      SELECT p.season AS temporada
      FROM sport_ranking_entry e JOIN sport_ranking_publication p ON p.id = e.publication_id
      WHERE e.person_id IN (${lista}) AND p.format::text = ${formato}
      GROUP BY p.season
      ORDER BY max(p.published_on) DESC, p.season DESC
      LIMIT 40`),
  ]);

  const cabecera = cabeceras.get(canonicaId);
  if (!cabecera) return { estado: 'no_encontrada' };

  const disponibles = filas<{ temporada: string }>(temporadas).map((t) => t.temporada);
  const temporadaRanking = analizada.data.temporadaRanking ?? disponibles[0] ?? null;
  const entradasRanking = temporadaRanking
    ? (await leerRankingOficialDePersonas(ctx.db, ids, temporadaRanking, formato)).map(aEntradaRanking)
    : [];

  const [conteo] = filas<{ resultados: number; pruebas: number; ediciones: number }>(resumen);
  const cobertura: CoberturaFicha = {
    resultadosImportados: Number(conteo?.resultados ?? 0),
    pruebasConResultado: Number(conteo?.pruebas ?? 0),
    ediciones: Number(conteo?.ediciones ?? 0),
    lecturas: filas<{ hecho: string; estado: EstadoCoberturaDto; pruebas: number }>(lecturas).map(
      (l) => ({ hecho: l.hecho, estado: l.estado, pruebas: Number(l.pruebas) }),
    ),
    historiaCompleta: false,
  };

  return {
    estado: 'ok',
    ficha: {
      id: cabecera.id,
      nombre: cabecera.nombre,
      alias: filas<{ nombre: string }>(alias)
        .map((a) => a.nombre)
        .filter((n) => n !== cabecera.nombre),
      pais: cabecera.pais,
      genero: cabecera.genero,
      anioNacimiento: cabecera.anioNacimiento,
      esPropia: propietario.estado === 'confirmada' && propietario.personaId === canonicaId,
      estadisticas: {
        conjunto: 'clasificaciones_individuales',
        porTipo: aEstadisticas(filas<FilaEstadistica>(estadisticas)),
      },
      cobertura,
      rankingOficial: {
        temporada: temporadaRanking,
        formato,
        temporadasDisponibles: disponibles,
        entradas: entradasRanking,
      },
    },
  };
}

type FilaHistorial = {
  id: string;
  puesto: number | null;
  puestoPublicado: string | null;
  puntos: string | null;
  fuente: string;
  enlace: string | null;
  torneoId: string;
  torneo: string;
  ciudad: string | null;
  paisTorneo: string | null;
  tipo: string | null;
  pruebaId: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string | null;
  formato: Formato;
  temporada: string;
  fecha: string | null;
  fechaOrden: string;
};

export function sqlHistorial(
  ids: readonly string[],
  filtros: FiltrosPrueba,
  limite: number,
  clave: readonly (string | number)[] | null,
) {
  const condiciones = [sql`r.person_id IN (${listaUuid(ids)})`, ...condicionesPrueba(filtros, FECHA_RESULTADO)];
  if (clave) {
    condiciones.push(
      sql`(${FECHA_ORDEN_RESULTADO}, r.id) < (${String(clave[0])}::date, ${String(clave[1])}::uuid)`,
    );
  }
  return sql`
    SELECT r.id::text AS id, r.position AS puesto, r.position_raw AS "puestoPublicado",
           r.official_points::text AS puntos, r.source AS fuente,
           coalesce(r.source_url, c.source_url) AS enlace,
           e.id::text AS "torneoId", e.name AS torneo, e.city AS ciudad, e.country_code AS "paisTorneo",
           ${TIPO_DOCUMENTADO} AS tipo,
           c.id::text AS "pruebaId", c.weapon::text AS arma, c.gender::text AS genero,
           c.category::text AS categoria, c.category_raw AS "categoriaRaw", c.format::text AS formato,
           c.season AS temporada, (${FECHA_RESULTADO})::text AS fecha,
           (${FECHA_ORDEN_RESULTADO})::text AS "fechaOrden"
    FROM sport_result r
    ${unionesPrueba('r')}
    ${UNION_EVENTO_CANONICO}
    WHERE ${y(condiciones)}
    ORDER BY ${FECHA_ORDEN_RESULTADO} DESC, r.id DESC
    LIMIT ${limite + 1}`;
}

export type ResultadoPaginaHistorial =
  | { estado: 'ok'; items: ResultadoHistorial[]; siguiente: string | null; sinResultados: boolean }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'no_encontrada' }
  | { estado: 'no_disponible' };

const CLASE_HISTORIAL = 'historial';

/**
 * Historial de clasificaciones de una persona, del más reciente al más
 * antiguo, paginado por `(fecha, id)`. Cada fila es un puesto publicado de una
 * prueba; las inscripciones no aparecen. La categoría conserva el código de la
 * aplicación (M10/M12 incluidos) y el literal de la fuente.
 */
export async function leerHistorial(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoPaginaHistorial> {
  await exigirPerfil(ctx);

  const analizada = esquemaHistorial.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  const { personaId, cursor, limite: pedido, ...resto } = analizada.data;
  const filtros = filtrosPrueba(resto);
  // La persona forma parte de la huella: un cursor de otra ficha no vale.
  const huella = { personaId, ...filtros };

  let clave: readonly (string | number)[] | null = null;
  if (cursor) {
    clave = decodificarCursor(CLASE_HISTORIAL, huella, cursor, 2);
    if (!clave || !FECHA_RE.test(String(clave[0])) || !UUID_RE.test(String(clave[1]))) {
      return { estado: 'cursor_invalido' };
    }
  }

  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const persona = await resolverPersona(ctx.db, personaId);
  if (!persona) return { estado: 'no_encontrada' };

  const limite = pedido ?? LIMITE_POR_DEFECTO;
  const rows = filas<FilaHistorial>(
    await ctx.db.execute(sqlHistorial(persona.ids, filtros, limite, clave)),
  );
  const pagina = rows.slice(0, limite);
  const ultima = pagina[pagina.length - 1];

  return {
    estado: 'ok',
    items: pagina.map<ResultadoHistorial>((r) => ({
      id: r.id,
      puesto: r.puesto === null ? null : Number(r.puesto),
      puestoPublicado: r.puestoPublicado,
      puntosOficiales: r.puntos,
      fuente: r.fuente,
      enlace: r.enlace,
      torneo: { id: r.torneoId, nombre: r.torneo, ciudad: r.ciudad, pais: r.paisTorneo },
      tipoDocumentado: r.tipo,
      prueba: {
        id: r.pruebaId,
        arma: r.arma,
        genero: r.genero,
        categoria: { codigo: r.categoria, raw: r.categoriaRaw },
        formato: r.formato,
      },
      temporada: r.temporada,
      fecha: r.fecha,
    })),
    siguiente:
      rows.length > limite && ultima
        ? codificarCursor(CLASE_HISTORIAL, huella, [ultima.fechaOrden, ultima.id])
        : null,
    sinResultados: pagina.length === 0,
  };
}
