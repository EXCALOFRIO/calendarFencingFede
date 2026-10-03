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
const MAX_COMUNES = 200;
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
      SELECT ra.competition_id
      FROM sport_result ra JOIN sport_result rb ON rb.competition_id = ra.competition_id
      WHERE ra.person_id IN (${listaUuid(yo)}) AND rb.person_id IN (${listaUuid(rival)})
      UNION
      SELECT b.competition_id FROM sport_bout b WHERE ${parejaDe(yo, rival)}
    )
    SELECT c.id AS id, c.source AS fuente, e.name AS torneo, c.weapon AS arma,
           c.gender AS genero, c.category AS categoria, c.category_raw AS "categoriaRaw",
           c.season AS temporada,
           (SELECT count(*) FROM sport_bout b
            WHERE b.competition_id = c.id AND ${parejaDe(yo, rival)}) AS asaltos,
           (SELECT coalesce(group_concat(cov.fact_kind || ':' || cov.status, ','), '')
            FROM sport_import_coverage cov
            WHERE cov.competition_id = c.id AND cov.fact_kind IN ('pools', 'tableau', 'pdf')) AS lecturas
    FROM comunes cm
    JOIN sport_competition c ON c.id = cm.competition_id
    JOIN sport_edition e ON e.id = c.edition_id
    LEFT JOIN event ev0 ON ev0.id = e.event_id
    WHERE ${y(condiciones)}
    ORDER BY c.competition_date DESC NULLS LAST, c.id
    LIMIT ${MAX_COMUNES + 1}`;
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

  const comunes = filas<FilaComun>(comunesRows);
  const truncado = comunes.length > MAX_COMUNES;
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
  };
}

export type ResultadoRivales =
  | { estado: 'ok'; items: RivalResumen[]; siguiente: string | null; sinResultados: boolean }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'no_encontrada' }
  | { estado: 'no_disponible' };

/**
 * Rivales individuales con al menos un asalto confirmado, paginados por
 * `(nombre normalizado, id)`. Sirve para elegir oponente en el filtro del
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
    clave = decodificarCursor(CLASE_RIVALES, huella, cursor, 2);
    if (!clave || !UUID_RE.test(String(clave[1]))) return { estado: 'cursor_invalido' };
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
  if (clave) {
    externas.push(sql`(cp.name_normalized, cp.id) > (${String(clave[0])}, ${String(clave[1])})`);
  }

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
      SELECT cp.id AS id, cp.name_normalized AS clave, cp.display_name AS nombre,
             cp.country_code AS pais, sum(x.n) AS asaltos
      FROM orientados x
      JOIN ruta r ON r.rival_id = x.rival_id AND r.destino IS NULL
      JOIN sport_person cp ON cp.id = r.id
      WHERE ${y(externas)}
      GROUP BY cp.id, cp.name_normalized, cp.display_name, cp.country_code
      ORDER BY cp.name_normalized ASC, cp.id ASC
      LIMIT ${limite + 1}`),
  );
  const pagina = rows.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  return {
    estado: 'ok',
    items: pagina.map((r) => ({ id: r.id, nombre: r.nombre, pais: r.pais, asaltos: Number(r.asaltos) })),
    siguiente:
      rows.length > limite && ultima ? codificarCursor(CLASE_RIVALES, huella, [ultima.clave, ultima.id]) : null,
    sinResultados: pagina.length === 0,
  };
}
