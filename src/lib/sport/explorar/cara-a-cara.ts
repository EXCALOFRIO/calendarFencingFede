import { sql, type SQL } from 'drizzle-orm';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, FECHA_RE, UUID_RE } from './cursor';
import {
  esquemaCaraACara,
  esquemaRivales,
  filtrosPrueba,
  LIMITE_POR_DEFECTO,
  normalizarConsulta,
} from './entrada';
import { condicionesPrueba, listaUuid, unionesPrueba, y } from './filtros-sql';
import { leerCabeceras, resolverPersona, SALTOS } from './personas';
import { clasificarCompeticion, PUESTO_SIN_CLASIFICAR } from './tipo-competicion';
import type { ClasificacionCompeticion } from './tipos-social';
import type {
  Arma,
  AsaltoDto,
  EstadoAsaltos,
  Formato,
  Genero,
  RivalResumen,
} from './tipos';

/**
 * Cara a cara individual entre dos personas confirmadas.
 *
 * Cuenta sólo filas de `sport_bout` de pruebas individuales cuyos DOS
 * participantes están resueltos a una persona (equipos, BYE, relevos y
 * marcadores incompletos no llegan a esa tabla; los puestos no son asaltos).
 * El asalto de poule está guardado una sola vez aunque la matriz publique las
 * dos perspectivas, y aquí se orienta hacia la persona consultada. Un
 * marcador empatado no tiene ganador: se cuenta aparte y no suma victoria ni
 * derrota.
 */

const CLASE = 'h2h';
const CLASE_RIVALES = 'rivales';
const MAX_COMUNES = 500;
const MAX_PENDIENTES = 20;

export type LecturaPrueba = { hecho: string; estado: string };

const HECHOS_ESPERADOS: Record<string, readonly string[]> = {
  fie: ['pools', 'tableau'],
  rfee_pdf: ['pdf'],
};

/**
 * Estado de los asaltos publicados de una prueba, a partir de la cobertura de
 * importación. «Completo» es el total publicado por la fuente para cada hecho
 * esperado; que falte un hecho, haya error o esté pendiente impide verificar.
 * Sin ninguna lectura la prueba no se ha procesado: pendiente, nunca «sin
 * asaltos».
 */
export function estadoAsaltosPrueba(
  fuente: string,
  lecturas: readonly LecturaPrueba[],
  asaltos: number,
): EstadoAsaltos {
  const incompletoConDatos: EstadoAsaltos = asaltos > 0 ? 'parcial' : 'pendiente';
  if (lecturas.length === 0) return incompletoConDatos;
  if (lecturas.some((l) => ['error', 'conflicto', 'parcial'].includes(l.estado))) return 'parcial';
  const faltan = (HECHOS_ESPERADOS[fuente] ?? []).some(
    (hecho) => !lecturas.some((l) => l.hecho === hecho),
  );
  if (faltan || lecturas.some((l) => l.estado === 'pendiente')) return incompletoConDatos;
  return lecturas.every((l) => l.estado === 'sin_resultados')
    ? 'sin_asaltos_publicados'
    : 'verificado';
}

export type PruebaComun = {
  id: string;
  fuente: string;
  torneo: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string | null;
  temporada: string;
  asaltos: number;
  estado: EstadoAsaltos;
};

export type CoberturaCaraACara = {
  /** `sin_pruebas_comunes` NO significa que nunca se enfrentaran: sólo que no hay prueba común importada. */
  estado: 'verificado' | 'parcial' | 'pendiente' | 'sin_pruebas_comunes';
  /** Un conjunto verificado sólo describe lo publicado e importado, no toda su carrera. */
  exhaustivo: false;
  pruebasComunes: number;
  pruebasConAsaltos: number;
  pruebasSinAsaltosPublicados: number;
  pruebasSinVerificar: number;
  pendientes: PruebaComun[];
  pendientesTruncado: boolean;
};

export function resumirCobertura(
  pruebas: readonly PruebaComun[],
  truncado: boolean,
): CoberturaCaraACara {
  const sinVerificar = pruebas.filter((p) => p.estado === 'parcial' || p.estado === 'pendiente');
  let estado: CoberturaCaraACara['estado'];
  if (pruebas.length === 0) estado = 'sin_pruebas_comunes';
  else if (truncado || pruebas.some((p) => p.estado === 'parcial')) estado = 'parcial';
  else if (sinVerificar.length === pruebas.length) estado = 'pendiente';
  else estado = sinVerificar.length > 0 ? 'parcial' : 'verificado';

  return {
    estado,
    exhaustivo: false,
    pruebasComunes: pruebas.length,
    pruebasConAsaltos: pruebas.filter((p) => p.asaltos > 0).length,
    pruebasSinAsaltosPublicados: pruebas.filter((p) => p.estado === 'sin_asaltos_publicados').length,
    pruebasSinVerificar: sinVerificar.length,
    pendientes: sinVerificar.slice(0, MAX_PENDIENTES),
    pendientesTruncado: sinVerificar.length > MAX_PENDIENTES,
  };
}

const FECHA_ASALTO = sql.raw('coalesce(b.occurred_on, c.competition_date, e.start_date)');
const FECHA_ORDEN_ASALTO = sql.raw(
  "coalesce(b.occurred_on, c.competition_date, e.start_date, '0001-01-01')",
);

/** Pareja en cualquiera de los dos órdenes en que `sport_bout` guarda las referencias. */
function parejaDe(a: readonly string[], b: readonly string[]): SQL {
  return sql`((b.fencer_a_person_id IN (${listaUuid(a)}) AND b.fencer_b_person_id IN (${listaUuid(b)}))
    OR (b.fencer_a_person_id IN (${listaUuid(b)}) AND b.fencer_b_person_id IN (${listaUuid(a)})))`;
}

const MIOS = (a: readonly string[]) =>
  sql`(CASE WHEN b.fencer_a_person_id IN (${listaUuid(a)}) THEN b.score_a ELSE b.score_b END)`;
const RIVAL = (a: readonly string[]) =>
  sql`(CASE WHEN b.fencer_a_person_id IN (${listaUuid(a)}) THEN b.score_b ELSE b.score_a END)`;

type FiltrosH2h = ReturnType<typeof filtrosPrueba> & { fase?: 'POULE' | 'TABLEAU' };

function condicionesH2h(
  yo: readonly string[],
  rival: readonly string[],
  f: FiltrosH2h,
): SQL[] {
  const condiciones = [
    sql`c.format = 'INDIVIDUAL'`,
    parejaDe(yo, rival),
    ...condicionesPrueba(f, FECHA_ASALTO),
  ];
  if (f.fase) condiciones.push(sql`b.phase = ${f.fase}`);
  return condiciones;
}

export function sqlResumenAsaltos(yo: readonly string[], rival: readonly string[], f: FiltrosH2h) {
  return sql`
    SELECT count(*) AS asaltos,
           count(*) FILTER (WHERE mios > rival) AS victorias,
           count(*) FILTER (WHERE mios < rival) AS derrotas,
           count(*) FILTER (WHERE mios = rival) AS "sinDecidir",
           coalesce(sum(mios), 0) AS "tantosFavor", coalesce(sum(rival), 0) AS "tantosContra"
    FROM (
      SELECT ${MIOS(yo)} AS mios, ${RIVAL(yo)} AS rival
      FROM sport_bout b ${unionesPrueba('b')}
      WHERE ${y(condicionesH2h(yo, rival, f))}
    ) s`;
}

export function sqlAsaltos(
  yo: readonly string[],
  rival: readonly string[],
  f: FiltrosH2h,
  limite: number,
  clave: readonly (string | number)[] | null,
) {
  // Un marcador empatado no tiene ganador: cuenta como «sin decidir» en el
  // resumen y no se lista como victoria ni derrota.
  const condiciones = [...condicionesH2h(yo, rival, f), sql`b.score_a <> b.score_b`];
  if (clave) {
    condiciones.push(
      sql`(${FECHA_ORDEN_ASALTO}, b.id) < (${String(clave[0])}, ${String(clave[1])})`,
    );
  }
  return sql`
    SELECT b.id AS id, ${MIOS(yo)} AS mios, ${RIVAL(yo)} AS rival,
           e.id AS "torneoId", e.name AS torneo,
           c.id AS "pruebaId", c.weapon AS arma, c.gender AS genero,
           c.category AS categoria, c.category_raw AS "categoriaRaw", c.format AS formato,
           c.season AS temporada, (${FECHA_ASALTO}) AS fecha,
           (${FECHA_ORDEN_ASALTO}) AS "fechaOrden",
           b.phase AS fase, b.round_key AS ronda, coalesce(b.source_url, c.source_url) AS enlace
    FROM sport_bout b ${unionesPrueba('b')}
    WHERE ${y(condiciones)}
    ORDER BY ${FECHA_ORDEN_ASALTO} DESC, b.id DESC
    LIMIT ${limite + 1}`;
}

export function sqlPruebasComunes(
  yo: readonly string[],
  rival: readonly string[],
  f: FiltrosH2h,
) {
  const condiciones = [
    sql`c.format = 'INDIVIDUAL'`,
    ...condicionesPrueba(f, sql.raw('coalesce(c.competition_date, e.start_date)')),
  ];
  return sql`
    WITH comunes AS (
      -- Cada lado por sport_result_person_date_idx; un JOIN por prueba leía la clasificación entera.
      SELECT ra.competition_id FROM sport_result ra WHERE ra.person_id IN (${listaUuid(yo)})
      INTERSECT
      SELECT rb.competition_id FROM sport_result rb WHERE rb.person_id IN (${listaUuid(rival)})
      UNION
      SELECT b.competition_id FROM sport_bout b WHERE ${parejaDe(yo, rival)}
    ), puestos AS MATERIALIZED (
      -- Los resultados de las dos personas se leen una vez (person_date_idx) y se agrupan por prueba.
      SELECT r.competition_id AS id,
             min(CASE WHEN r.person_id IN (${listaUuid(yo)}) AND r.position > 0 THEN r.position END) AS yo,
             min(CASE WHEN r.person_id IN (${listaUuid(yo)}) THEN r.position_raw END) AS "yoRaw",
             min(CASE WHEN r.person_id IN (${listaUuid(rival)}) AND r.position > 0 THEN r.position END) AS rival,
             min(CASE WHEN r.person_id IN (${listaUuid(rival)}) THEN r.position_raw END) AS "rivalRaw"
      FROM sport_result r WHERE r.person_id IN (${listaUuid([...yo, ...rival])})
      GROUP BY r.competition_id
    ), duelos AS MATERIALIZED (
      SELECT b.competition_id AS id, count(*) AS asaltos,
             coalesce(sum(b.phase = 'POULE' AND ${MIOS(yo)} > ${RIVAL(yo)}), 0) AS "pouleV",
             coalesce(sum(b.phase = 'POULE' AND ${MIOS(yo)} < ${RIVAL(yo)}), 0) AS "pouleD",
             coalesce(sum(b.phase = 'TABLEAU' AND ${MIOS(yo)} > ${RIVAL(yo)}), 0) AS "directaV",
             coalesce(sum(b.phase = 'TABLEAU' AND ${MIOS(yo)} < ${RIVAL(yo)}), 0) AS "directaD"
      FROM sport_bout b WHERE ${parejaDe(yo, rival)}
      GROUP BY b.competition_id
    )
    SELECT c.id AS id, c.source AS fuente, e.name AS torneo, c.weapon AS arma,
           c.gender AS genero, c.category AS categoria, c.category_raw AS "categoriaRaw",
           c.season AS temporada, coalesce(d.asaltos, 0) AS asaltos,
           (SELECT coalesce(group_concat(cov.fact_kind || ':' || cov.status, ','), '')
            FROM sport_import_coverage cov
            WHERE cov.competition_id = c.id AND cov.fact_kind IN ('pools', 'tableau', 'pdf')) AS lecturas,
           c.event_competition_id AS equivalencia, e.id AS "edicionId", e.city AS ciudad,
           e.country_code AS pais, ev0.scope AS "ambitoEvento", ev0.circuit AS "circuitoEvento",
           ev0.source AS "fuenteEvento", coalesce(c.competition_date, e.start_date) AS fecha,
           p.yo AS "puestoYo", p."yoRaw" AS "puestoYoRaw", p.rival AS "puestoRival", p."rivalRaw" AS "puestoRivalRaw",
           coalesce(d."pouleV", 0) AS "pouleV", coalesce(d."pouleD", 0) AS "pouleD",
           coalesce(d."directaV", 0) AS "directaV", coalesce(d."directaD", 0) AS "directaD"
    FROM comunes cm
    JOIN sport_competition c ON c.id = cm.competition_id
    JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    LEFT JOIN puestos p ON p.id = c.id
    LEFT JOIN duelos d ON d.id = c.id
    WHERE ${y(condiciones)}
    ORDER BY coalesce(c.competition_date, e.start_date) DESC NULLS LAST, c.id
    LIMIT ${MAX_COMUNES + 1}`;
}

function puestoReal(v: unknown): number | null {
  const n = v == null ? null : Number(v);
  return n !== null && Number.isInteger(n) && n > 0 && n < PUESTO_SIN_CLASIFICAR ? n : null;
}

export type BalanceFase = { victorias: number; derrotas: number };

/** Una prueba individual en la que coincidieron, con el puesto de cada una y sus asaltos. */
export type EncuentroCaraACara = {
  pruebaId: string;
  edicionId: string;
  torneo: string;
  fecha: string | null;
  ciudad: string | null;
  pais: string | null;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string | null;
  temporada: string;
  fuente: string;
  clasificacion: ClasificacionCompeticion;
  puestos: {
    yo: number | null;
    rival: number | null;
    /** Literal publicado cuando no hay puesto numérico. */
    yoPublicado: string | null;
    rivalPublicado: string | null;
  };
  /** Quién terminó por delante; `null` si falta el puesto de alguna. */
  delante: 'yo' | 'rival' | 'empate' | null;
  asaltos: { total: number; poule: BalanceFase; directa: BalanceFase };
};

export type ResumenEncuentros = {
  competiciones: number;
  /** Pruebas con puesto numérico de las dos: la base de «por delante». */
  conAmbosPuestos: number;
  delanteYo: number;
  delanteRival: number;
  empates: number;
  poule: BalanceFase;
  directa: BalanceFase;
  ultimo: EncuentroCaraACara | null;
  /** Se alcanzó el tope de pruebas comunes leídas. */
  truncado: boolean;
};

type FilaEncuentro = FilaComun & {
  equivalencia?: string | null;
  edicionId?: string;
  ciudad?: string | null;
  pais?: string | null;
  ambitoEvento?: string | null;
  circuitoEvento?: string | null;
  fuenteEvento?: string | null;
  fecha?: string | null;
  puestoYo?: number | null;
  puestoYoRaw?: string | null;
  puestoRival?: number | null;
  puestoRivalRaw?: string | null;
  pouleV?: number;
  pouleD?: number;
  directaV?: number;
  directaD?: number;
};

function aEncuentro(f: FilaEncuentro): EncuentroCaraACara {
  const yo = puestoReal(f.puestoYo);
  const rival = puestoReal(f.puestoRival);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    pruebaId: f.id,
    edicionId: f.edicionId ?? '',
    torneo: f.torneo,
    fecha: f.fecha ?? null,
    ciudad: f.ciudad ?? null,
    pais: f.pais ?? null,
    arma: f.arma,
    genero: f.genero,
    categoria: f.categoria,
    categoriaRaw: f.categoriaRaw,
    temporada: f.temporada,
    fuente: f.fuente,
    clasificacion: clasificarCompeticion({
      nombre: f.torneo ?? '', fuente: f.fuente ?? '', pais: f.pais ?? null,
      ambitoEvento: f.ambitoEvento, circuitoEvento: f.circuitoEvento, fuenteEvento: f.fuenteEvento,
    }),
    puestos: {
      yo,
      rival,
      yoPublicado: yo === null ? f.puestoYoRaw ?? null : null,
      rivalPublicado: rival === null ? f.puestoRivalRaw ?? null : null,
    },
    delante: yo === null || rival === null ? null : yo < rival ? 'yo' : yo > rival ? 'rival' : 'empate',
    asaltos: {
      total: n(f.asaltos),
      poule: { victorias: n(f.pouleV), derrotas: n(f.pouleD) },
      directa: { victorias: n(f.directaV), derrotas: n(f.directaD) },
    },
  };
}

function normalizarTorneo(nombre: string): string {
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
}

/**
 * Encuentros sin duplicados: dos fuentes de la misma prueba del calendario
 * cuentan una vez. Se queda la fila con los dos puestos y, a igualdad, la
 * de más asaltos; el orden (más reciente primero) es el de la consulta.
 */
export function aEncuentros(rows: readonly FilaEncuentro[], truncado: boolean): {
  encuentros: EncuentroCaraACara[];
  resumen: ResumenEncuentros;
} {
  const elegidas = new Map<string, { i: number; e: EncuentroCaraACara }>();
  const porHuella = new Map<string, string>();
  rows.forEach((f, i) => {
    const e = aEncuentro(f);
    let clave = f.equivalencia ? `cal:${f.equivalencia}` : `sport:${f.id}`;
    // Dos fuentes nacionales (p. ej. skermo_rfee y rfee_pdf) publican la misma
    // prueba sin enlace de calendario. Mismo día, misma prueba y los mismos dos
    // puestos sólo pasa si es la misma competición.
    if (e.delante && e.fecha) {
      const huella = [e.fecha, e.arma, e.genero, e.categoria, normalizarTorneo(e.torneo), e.puestos.yo, e.puestos.rival].join('|');
      const vista = porHuella.get(huella);
      if (vista && vista !== clave) clave = vista;
      else porHuella.set(huella, clave);
    }
    const previa = elegidas.get(clave);
    const peso = (x: EncuentroCaraACara) => (x.delante ? 1_000_000 : 0) + x.asaltos.total;
    if (!previa || peso(e) > peso(previa.e)) elegidas.set(clave, { i: previa?.i ?? i, e });
  });
  const encuentros = [...elegidas.values()].sort((a, b) => a.i - b.i).map((x) => x.e);
  const resumen: ResumenEncuentros = {
    competiciones: encuentros.length,
    conAmbosPuestos: 0, delanteYo: 0, delanteRival: 0, empates: 0,
    poule: { victorias: 0, derrotas: 0 },
    directa: { victorias: 0, derrotas: 0 },
    ultimo: encuentros[0] ?? null,
    truncado,
  };
  for (const e of encuentros) {
    if (e.delante) resumen.conAmbosPuestos += 1;
    if (e.delante === 'yo') resumen.delanteYo += 1;
    if (e.delante === 'rival') resumen.delanteRival += 1;
    if (e.delante === 'empate') resumen.empates += 1;
    resumen.poule.victorias += e.asaltos.poule.victorias;
    resumen.poule.derrotas += e.asaltos.poule.derrotas;
    resumen.directa.victorias += e.asaltos.directa.victorias;
    resumen.directa.derrotas += e.asaltos.directa.derrotas;
  }
  return { encuentros, resumen };
}

type FilaAsalto = {
  id: string;
  mios: number;
  rival: number;
  torneoId: string;
  torneo: string;
  pruebaId: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaRaw: string | null;
  formato: Formato;
  temporada: string;
  fecha: string | null;
  fechaOrden: string;
  fase: 'POULE' | 'TABLEAU';
  ronda: string;
  enlace: string | null;
};

type FilaComun = Omit<PruebaComun, 'estado' | 'asaltos'> & { asaltos: number; lecturas: string };

function parseLecturas(texto: string): LecturaPrueba[] {
  return texto
    .split(',')
    .filter(Boolean)
    .map((par) => {
      const [hecho, estado] = par.split(':');
      return { hecho, estado };
    });
}

export type ResultadoCaraACara =
  | {
      estado: 'ok';
      personas: {
        yo: { id: string; nombre: string; pais: string | null };
        rival: { id: string; nombre: string; pais: string | null };
      };
      resumen: {
        asaltos: number;
        victorias: number;
        derrotas: number;
        sinDecidir: number;
        tantosFavor: number;
        tantosContra: number;
      };
      cobertura: CoberturaCaraACara;
      items: AsaltoDto[];
      siguiente: string | null;
      /** Todas las pruebas comunes, más reciente primero. Ausente en lecturas anteriores. */
      encuentros?: EncuentroCaraACara[];
      resumenEncuentros?: ResumenEncuentros;
    }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'misma_persona' }
  | { estado: 'no_encontrada' }
  | { estado: 'no_disponible' };

export async function leerCaraACara(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoCaraACara> {
  await exigirPerfil(ctx);

  const analizada = esquemaCaraACara.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  const { personaId, rivalId, cursor, limite: pedido, fase, ...resto } = analizada.data;
  const filtros: FiltrosH2h = { ...filtrosPrueba(resto), ...(fase ? { fase } : {}) };
  const huella = { personaId, rivalId, ...filtros };

  let clave: readonly (string | number)[] | null = null;
  if (cursor) {
    clave = decodificarCursor(CLASE, huella, cursor, 2);
    if (!clave || !FECHA_RE.test(String(clave[0])) || !UUID_RE.test(String(clave[1]))) {
      return { estado: 'cursor_invalido' };
    }
  }

  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const [yo, rival] = await Promise.all([
    resolverPersona(ctx.db, personaId),
    resolverPersona(ctx.db, rivalId),
  ]);
  if (!yo || !rival) return { estado: 'no_encontrada' };
  if (yo.canonicaId === rival.canonicaId) return { estado: 'misma_persona' };

  const limite = pedido ?? LIMITE_POR_DEFECTO;
  const [cabeceras, resumenRows, asaltosRows, comunesRows] = await Promise.all([
    leerCabeceras(ctx.db, [yo.canonicaId, rival.canonicaId]),
    ctx.db.execute(sqlResumenAsaltos(yo.ids, rival.ids, filtros)),
    ctx.db.execute(sqlAsaltos(yo.ids, rival.ids, filtros, limite, clave)),
    ctx.db.execute(sqlPruebasComunes(yo.ids, rival.ids, filtros)),
  ]);

  const cabYo = cabeceras.get(yo.canonicaId);
  const cabRival = cabeceras.get(rival.canonicaId);
  if (!cabYo || !cabRival) return { estado: 'no_encontrada' };

  const [r] = filas<Record<string, number>>(resumenRows);
  const asaltos = filas<FilaAsalto>(asaltosRows);
  const pagina = asaltos.slice(0, limite);
  const ultima = pagina[pagina.length - 1];

  const comunes = filas<FilaEncuentro>(comunesRows);
  const truncado = comunes.length > MAX_COMUNES;
  const { encuentros, resumen: resumenEncuentros } = aEncuentros(comunes.slice(0, MAX_COMUNES), truncado);
  const pruebas = comunes.slice(0, MAX_COMUNES).map<PruebaComun>((c) => {
    const n = Number(c.asaltos);
    return {
      id: c.id,
      fuente: c.fuente,
      torneo: c.torneo,
      arma: c.arma,
      genero: c.genero,
      categoria: c.categoria,
      categoriaRaw: c.categoriaRaw,
      temporada: c.temporada,
      asaltos: n,
      estado: estadoAsaltosPrueba(c.fuente, parseLecturas(c.lecturas ?? ''), n),
    };
  });

  return {
    estado: 'ok',
    personas: {
      yo: { id: cabYo.id, nombre: cabYo.nombre, pais: cabYo.pais },
      rival: { id: cabRival.id, nombre: cabRival.nombre, pais: cabRival.pais },
    },
    resumen: {
      asaltos: Number(r?.asaltos ?? 0),
      victorias: Number(r?.victorias ?? 0),
      derrotas: Number(r?.derrotas ?? 0),
      sinDecidir: Number(r?.sinDecidir ?? 0),
      tantosFavor: Number(r?.tantosFavor ?? 0),
      tantosContra: Number(r?.tantosContra ?? 0),
    },
    cobertura: resumirCobertura(pruebas, truncado),
    items: pagina.map<AsaltoDto>((a) => ({
      id: a.id,
      marcador: { mios: Number(a.mios), rival: Number(a.rival) },
      resultado: Number(a.mios) > Number(a.rival) ? 'victoria' : 'derrota',
      torneo: { id: a.torneoId, nombre: a.torneo },
      prueba: {
        id: a.pruebaId,
        arma: a.arma,
        genero: a.genero,
        categoria: { codigo: a.categoria, raw: a.categoriaRaw },
        formato: a.formato,
      },
      temporada: a.temporada,
      fecha: a.fecha,
      fase: a.fase,
      rondaPublicada: a.ronda,
      enlace: a.enlace,
    })),
    siguiente:
      asaltos.length > limite && ultima
        ? codificarCursor(CLASE, huella, [ultima.fechaOrden, ultima.id])
        : null,
    encuentros,
    resumenEncuentros,
  };
}

export type ResultadoRivales =
  | { estado: 'ok'; items: RivalResumen[]; siguiente: string | null; sinResultados: boolean }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'no_encontrada' }
  | { estado: 'no_disponible' };

/**
 * Rivales individuales con al menos un asalto confirmado, de más a menos
 * asaltos y paginados por `(asaltos, nombre normalizado, id)`. Sirve para elegir oponente en el filtro del
 * cara a cara; un rival sin persona resuelta no aparece (no se adivina por
 * nombre).
 */
export async function listarRivales(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoRivales> {
  await exigirPerfil(ctx);

  const analizada = esquemaRivales.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  const { personaId, cursor, limite: pedido, ...resto } = analizada.data;
  const filtros = { ...filtrosPrueba({ temporada: resto.temporada }), q: normalizarConsulta(resto.q) };
  const huella = { personaId, ...filtros };

  let clave: readonly (string | number)[] | null = null;
  if (cursor) {
    clave = decodificarCursor(CLASE_RIVALES, huella, cursor, 3);
    if (
      !clave || !Number.isInteger(Number(clave[0])) || Number(clave[0]) < 1
      || typeof clave[1] !== 'string' || !UUID_RE.test(String(clave[2]))
    ) {
      return { estado: 'cursor_invalido' };
    }
  }

  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const persona = await resolverPersona(ctx.db, personaId);
  if (!persona) return { estado: 'no_encontrada' };

  const limite = pedido ?? LIMITE_POR_DEFECTO;
  const lista = listaUuid(persona.ids);
  const condiciones: SQL[] = [
    sql`c.format = 'INDIVIDUAL'`,
    sql`(b.fencer_a_person_id IN (${lista}) OR b.fencer_b_person_id IN (${lista}))`,
    sql`b.fencer_a_person_id IS NOT NULL AND b.fencer_b_person_id IS NOT NULL`,
    ...(filtros.temporada ? [sql`c.season = ${filtros.temporada}`] : []),
  ];
  const externas: SQL[] = [sql`cp.id <> ${persona.canonicaId}`];
  for (const w of (filtros.q ?? '').split(' ').filter(Boolean)) {
    externas.push(
      sql`(cp.name_normalized LIKE ${`${w}%`} OR cp.name_normalized LIKE ${`% ${w}%`})`,
    );
  }
  // El orden es por asaltos (un agregado): la posición del cursor se compara en HAVING.
  const despues = clave
    ? sql`HAVING (-sum(x.n), coalesce(cp.name_normalized, ''), cp.id) > (${-Number(clave[0])}, ${String(clave[1])}, ${String(clave[2])})`
    : sql``;

  const rows = filas<{ id: string; clave: string; nombre: string; pais: string | null; asaltos: number }>(
    await ctx.db.execute(sql`
      WITH RECURSIVE orientados AS (
        SELECT CASE WHEN b.fencer_a_person_id IN (${lista}) THEN b.fencer_b_person_id ELSE b.fencer_a_person_id END AS rival_id,
               1 AS n
        FROM sport_bout b ${unionesPrueba('b')}
        WHERE ${y(condiciones)}
      ), ruta(rival_id, id, destino, salto) AS (
        SELECT DISTINCT x.rival_id, p.id, p.merged_into_person_id, 0
        FROM orientados x JOIN sport_person p ON p.id = x.rival_id
        UNION ALL
        SELECT r.rival_id, p.id, p.merged_into_person_id, r.salto + 1
        FROM ruta r JOIN sport_person p ON p.id = r.destino WHERE r.salto < ${SALTOS}
      )
      SELECT cp.id AS id, coalesce(cp.name_normalized, '') AS clave, cp.display_name AS nombre,
             cp.country_code AS pais, sum(x.n) AS asaltos
      FROM orientados x
      JOIN ruta r ON r.rival_id = x.rival_id AND r.destino IS NULL
      JOIN sport_person cp ON cp.id = r.id
      WHERE ${y(externas)}
      GROUP BY cp.id, cp.name_normalized, cp.display_name, cp.country_code
      ${despues}
      ORDER BY sum(x.n) DESC, coalesce(cp.name_normalized, '') ASC, cp.id ASC
      LIMIT ${limite + 1}`),
  );
  const pagina = rows.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  return {
    estado: 'ok',
    items: pagina.map((r) => ({ id: r.id, nombre: r.nombre, pais: r.pais, asaltos: Number(r.asaltos) })),
    siguiente:
      rows.length > limite && ultima
        ? codificarCursor(CLASE_RIVALES, huella, [Number(ultima.asaltos), ultima.clave, ultima.id])
        : null,
    sinResultados: pagina.length === 0,
  };
}
