import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { porcentaje, sqlAsaltosOrientados } from './asaltos-orientados-sql';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { listaUuid } from './filtros-sql';
import { resolverPersona } from './personas';
import {
  clasificarCompeticion,
  etiquetaCategoria,
  ordenCategoria,
  PUESTO_SIN_CLASIFICAR,
  TIPOS_COMPETICION,
} from './tipo-competicion';
import type {
  AmbitoCompeticion,
  EstadisticasPorAmbito,
  ResultadoEstadisticasAmbito,
  ResumenCompeticiones,
  TipoCompeticion,
  TonoTipo,
} from './tipos-social';

export { clasificarCompeticion, etiquetaCategoria, TIPOS_COMPETICION } from './tipo-competicion';

/** Pruebas individuales leídas como máximo; la persona con más tiene ~250. */
export const LIMITE_PRUEBAS_AMBITO = 1500;

/**
 * Una fila por prueba individual (equivalencias de calendario fundidas): su
 * puesto y su balance de asaltos. La clasificación por tipo y ámbito se hace
 * en TypeScript con `clasificarCompeticion`, la misma que pinta las
 * pastillas, para que ambas no puedan discrepar.
 *
 * Un puesto contradictorio entre dos fuentes de la misma prueba no cuenta como
 * puesto (sigue contando como prueba disputada). Una prueba con asaltos pero
 * sin puesto publicado también cuenta.
 */
export function sqlPruebasAmbito(ids: readonly string[]) {
  return sql`
    WITH ${sqlAsaltosOrientados(ids)}, hechos AS (
      -- Resultados (puesto, -1 si no hay) y asaltos (favor/contra) en un solo
      -- GROUP BY: agrupar cada lado aparte y cruzarlos costaba el doble en D1.
      SELECT coalesce('cal:' || c.event_competition_id, 'sport:' || c.id) AS equivalencia,
             c.id AS prueba, coalesce(CASE WHEN r.position > 0 THEN r.position END, -1) AS puesto,
             NULL AS favor, NULL AS contra, c.id || '|' || r.id AS resultado
      FROM sport_result r CROSS JOIN sport_competition c ON c.id = r.competition_id
      WHERE r.person_id IN (${listaUuid(ids)}) AND c.format = 'INDIVIDUAL'
      UNION ALL
      SELECT equivalencia, prueba, NULL, favor, contra, NULL FROM validos
    ), por_prueba AS (
      SELECT equivalencia, min(prueba) AS prueba,
             CASE WHEN min(puesto) = max(puesto) AND min(puesto) > 0 THEN min(puesto) END AS puesto,
             count(favor) AS asaltos,
             coalesce(sum(favor > contra), 0) AS victorias, coalesce(sum(favor < contra), 0) AS derrotas,
             coalesce(sum(favor), 0) AS dados, coalesce(sum(contra), 0) AS recibidos,
             -- Fila de resultado que se enseña: la de la prueba de menor ID del grupo.
             min(resultado) AS resultado
      FROM hechos GROUP BY equivalencia
    )
    SELECT c.source AS fuente, e.name AS torneo, c.category AS categoria, e.country_code AS pais,
           ev0.scope AS "ambitoEvento", ev0.circuit AS "circuitoEvento", ev0.source AS "fuenteEvento",
           t.puesto AS puesto, t.asaltos AS asaltos, t.victorias AS victorias,
           t.derrotas AS derrotas, t.dados AS dados, t.recibidos AS recibidos,
           rr.id AS "resultadoId", rr.competition_id AS "pruebaResultado",
           CASE WHEN rr.position > 0 THEN rr.position END AS "puestoResultado", rr.position_raw AS "puestoPublicado", rr.official_points AS puntos, rr.source AS "fuenteResultado",
           coalesce(rr.source_url, c.source_url) AS enlace,
           e.id AS "edicionId", e.city AS ciudad, c.weapon AS arma, c.gender AS genero,
           c.category_raw AS "categoriaRaw", c.season AS temporada,
           coalesce(rr.occurred_on, c.competition_date, e.start_date) AS fecha,
           coalesce(rr.occurred_on, c.competition_date, e.start_date, '0001-01-01') AS "fechaOrden"
    FROM por_prueba t
    CROSS JOIN sport_competition c ON c.id = t.prueba
    CROSS JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    LEFT JOIN sport_result rr ON rr.id = substr(t.resultado, instr(t.resultado, '|') + 1)
    ORDER BY coalesce(c.competition_date, e.start_date, '0001-01-01') DESC, t.prueba
    LIMIT ${LIMITE_PRUEBAS_AMBITO + 1}`;
}

/** Datos de presentación de la misma fila; `resultadoId` nulo = sólo hay asaltos, sin clasificación. */
export type FilaPresentacionPrueba = {
  resultadoId: string | null;
  pruebaResultado: string | null;
  /** Puesto de esa fila; `puesto` (el de la prueba) es nulo si dos fuentes se contradicen. */
  puestoResultado: number | null;
  puestoPublicado: string | null;
  puntos: string | null;
  fuenteResultado: string | null;
  enlace: string | null;
  edicionId: string;
  ciudad: string | null;
  arma: string;
  genero: string;
  categoriaRaw: string | null;
  temporada: string;
  fecha: string | null;
  fechaOrden: string;
};

export type FilaPruebaAmbito = Partial<FilaPresentacionPrueba> & {
  fuente: string;
  torneo: string;
  categoria: string;
  pais: string | null;
  ambitoEvento: string | null;
  circuitoEvento: string | null;
  fuenteEvento: string | null;
  puesto: number | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  dados: number;
  recibidos: number;
};

function clasificarFila(f: FilaPruebaAmbito) {
  return clasificarCompeticion({
    nombre: f.torneo, fuente: f.fuente, pais: f.pais,
    ambitoEvento: f.ambitoEvento, circuitoEvento: f.circuitoEvento, fuenteEvento: f.fuenteEvento,
  });
}

const conPuesto = (f: FilaPruebaAmbito) =>
  f.puestoResultado != null && Number(f.puestoResultado) > 0 && Number(f.puestoResultado) < PUESTO_SIN_CLASIFICAR;

/**
 * Funde la misma prueba publicada por dos fuentes sin enlace de calendario
 * común (Skermo y el PDF de la RFEE, o Engarde): mismo día, arma, género,
 * categoría y ámbito, y fuentes distintas. Una persona no tira dos pruebas
 * individuales de la misma categoría y arma el mismo día. Se queda la fila con
 * puesto (y, a igualdad, la que trae asaltos); los asaltos son los de la copia
 * que más tenga, sin sumar: suelen ser los mismos asaltos. Dos puestos
 * distintos dejan la prueba sin puesto consensuado.
 */
export function fundirPruebasRepetidas(rows: readonly FilaPruebaAmbito[]): FilaPruebaAmbito[] {
  const salida: FilaPruebaAmbito[] = [];
  const grupos = new Map<string, { i: number; fuentes: Set<string> }[]>();
  for (const f of rows) {
    if (!f.fecha || !f.arma || !f.genero) {
      salida.push(f);
      continue;
    }
    const clave = [f.fecha, f.arma, f.genero, f.categoria, clasificarFila(f).ambito].join('|');
    const fuente = f.fuenteResultado ?? f.fuente;
    const candidatos = grupos.get(clave) ?? [];
    const g = candidatos.find((c) => !c.fuentes.has(fuente));
    if (!g) {
      candidatos.push({ i: salida.length, fuentes: new Set([fuente]) });
      grupos.set(clave, candidatos);
      salida.push(f);
      continue;
    }
    g.fuentes.add(fuente);
    const previa = salida[g.i];
    const nuevaGana = (conPuesto(f) && !conPuesto(previa))
      || (conPuesto(f) === conPuesto(previa) && Number(f.asaltos) > Number(previa.asaltos));
    const base = nuevaGana ? f : previa;
    const otra = nuevaGana ? previa : f;
    const asaltos = Number(otra.asaltos) > Number(base.asaltos) ? otra : base;
    const puestos = [previa.puesto, f.puesto].filter((p): p is number => p != null).map(Number);
    const contradicen = conPuesto(previa) && conPuesto(f) && Number(previa.puestoResultado) !== Number(f.puestoResultado);
    salida[g.i] = {
      ...base,
      puesto: contradicen ? null : puestos.length > 0 ? puestos[0] : null,
      asaltos: asaltos.asaltos, victorias: asaltos.victorias, derrotas: asaltos.derrotas,
      dados: asaltos.dados, recibidos: asaltos.recibidos,
    };
  }
  return salida;
}

function vacio(clave: string, etiqueta: string): ResumenCompeticiones {
  return {
    clave, etiqueta, competiciones: 0, oros: 0, platas: 0, bronces: 0, medallas: 0, finales: 0,
    mejorPuesto: null, asaltos: 0, victorias: 0, derrotas: 0, porcentajeVictorias: null,
    tocadosDados: 0, tocadosRecibidos: 0, indiceTocados: 0,
  };
}

function sumar(r: ResumenCompeticiones, f: FilaPruebaAmbito): void {
  const puesto = f.puesto === null ? null : Number(f.puesto);
  r.competiciones += 1;
  if (puesto === 1) r.oros += 1;
  if (puesto === 2) r.platas += 1;
  if (puesto === 3) r.bronces += 1;
  if (puesto !== null && puesto >= 1 && puesto <= 3) r.medallas += 1;
  if (puesto !== null && puesto >= 1 && puesto <= 8) r.finales += 1;
  if (puesto !== null && puesto > 0 && (r.mejorPuesto === null || puesto < r.mejorPuesto)) r.mejorPuesto = puesto;
  r.asaltos += Number(f.asaltos);
  r.victorias += Number(f.victorias);
  r.derrotas += Number(f.derrotas);
  r.tocadosDados += Number(f.dados);
  r.tocadosRecibidos += Number(f.recibidos);
}

function cerrar<T extends ResumenCompeticiones>(r: T): T {
  r.porcentajeVictorias = porcentaje(r.victorias, r.derrotas);
  r.indiceTocados = r.tocadosDados - r.tocadosRecibidos;
  return r;
}

const ETIQUETA_AMBITO: Record<AmbitoCompeticion, string> = {
  internacional: 'Internacional',
  nacional: 'Nacional',
};

export function aEstadisticasPorAmbito(rows: readonly FilaPruebaAmbito[]): EstadisticasPorAmbito {
  const truncado = rows.length > LIMITE_PRUEBAS_AMBITO;
  const total = vacio('total', 'Total');
  const ambitos = {
    internacional: { ...vacio('internacional', ETIQUETA_AMBITO.internacional), porCategoria: new Map<string, ResumenCompeticiones>() },
    nacional: { ...vacio('nacional', ETIQUETA_AMBITO.nacional), porCategoria: new Map<string, ResumenCompeticiones>() },
  };
  const categorias = new Map<string, ResumenCompeticiones>();
  const tipos = new Map<TipoCompeticion, ResumenCompeticiones & { tono: TonoTipo }>();
  const en = (mapa: Map<string, ResumenCompeticiones>, clave: string) => {
    let r = mapa.get(clave);
    if (!r) mapa.set(clave, (r = vacio(clave, etiquetaCategoria(clave))));
    return r;
  };

  for (const f of fundirPruebasRepetidas(rows.slice(0, LIMITE_PRUEBAS_AMBITO))) {
    const c = clasificarFila(f);
    const ambito = ambitos[c.ambito];
    let tipo = tipos.get(c.tipo);
    if (!tipo) tipos.set(c.tipo, (tipo = { ...vacio(c.tipo, c.etiqueta), tono: c.tono }));
    for (const r of [total, ambito, en(ambito.porCategoria, f.categoria), en(categorias, f.categoria), tipo]) sumar(r, f);
  }

  const porCategorias = (m: Map<string, ResumenCompeticiones>) =>
    [...m.values()].map(cerrar).sort((a, b) => ordenCategoria(a.clave) - ordenCategoria(b.clave));
  const ambitoFinal = (a: typeof ambitos.internacional, clave: AmbitoCompeticion) => {
    const { porCategoria, ...resto } = a;
    return { ...cerrar(resto), clave, porCategoria: porCategorias(porCategoria) };
  };
  const ordenTipos = Object.keys(TIPOS_COMPETICION);
  return {
    total: cerrar(total),
    internacional: ambitoFinal(ambitos.internacional, 'internacional'),
    nacional: ambitoFinal(ambitos.nacional, 'nacional'),
    porCategoria: porCategorias(categorias),
    porTipo: [...tipos.values()].map(cerrar).sort((a, b) => ordenTipos.indexOf(a.clave) - ordenTipos.indexOf(b.clave)),
    truncado,
  };
}

/** Filas por prueba para quien ya resolvió la persona; un fallo devuelve `null`. */
export async function leerPruebasAmbitoDe(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<FilaPruebaAmbito[] | null> {
  try {
    return filas<FilaPruebaAmbito>(await db.execute(sqlPruebasAmbito(ids)));
  } catch (error) {
    console.error('[explorar] las estadísticas por ámbito no se pudieron leer:',
      error instanceof Error ? error.name : 'desconocido');
    return null;
  }
}

/** Para quien ya resolvió la persona; un fallo devuelve `null`. */
export async function leerEstadisticasAmbitoDe(
  db: ContextoExplorador['db'],
  ids: readonly string[],
): Promise<EstadisticasPorAmbito | null> {
  const rows = await leerPruebasAmbitoDe(db, ids);
  return rows ? aEstadisticasPorAmbito(rows) : null;
}

const esquema = z.object({ personaId: z.string().regex(UUID_RE) }).strict();

export async function leerEstadisticasAmbito(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoEstadisticasAmbito> {
  await exigirPerfil(ctx);
  const analizada = esquema.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const persona = await resolverPersona(ctx.db, analizada.data.personaId);
  if (!persona) return { estado: 'no_encontrada' };
  const datos = await leerEstadisticasAmbitoDe(ctx.db, persona.ids);
  return datos ? { estado: 'ok', personaId: persona.canonicaId, datos } : { estado: 'error' };
}
