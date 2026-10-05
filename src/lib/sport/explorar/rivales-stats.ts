import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { MEDIDAS_REGISTRO, porcentaje, sqlAsaltosOrientados } from './asaltos-orientados-sql';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { resolverPersona } from './personas';
import type {
  BalanceRival,
  ClaveCuriosidad,
  Curiosidad,
  EstadisticasRivales,
  RegistroAsaltos,
  ResultadoEstadisticasRivales,
  RivalBasico,
} from './tipos-social';

export type * from './tipos-social';

/** Rivales devueltos en la tabla (los de más asaltos). */
export const LIMITE_RIVALES_STATS = 30;
/** Asaltos mínimos para las curiosidades que comparan proporciones. */
export const MINIMO_ASALTOS_CURIOSIDAD = 3;

const MEDIDAS_RIVAL = sql.raw(`
  pr.rival AS rival, pr.asaltos, pr.victorias, pr.derrotas, pr.empates, pr.dados, pr.recibidos,
  pr.ajustados, pr."ajustadosGanados", pr.racha, pr."ultimaFecha"`);

/**
 * Una sola sentencia y sólo agregados: totales, por fase, la tabla de rivales
 * acotada y una fila por curiosidad (cada una `LIMIT 1`). Las filas que vuelven
 * al Worker son como mucho 3 + `LIMITE_RIVALES_STATS` + 9.
 *
 * El rival es su persona raíz: `coalesce(merged_into_person_id, id)` (las
 * fusiones no encadenan). Los asaltos contra otro miembro del propio grupo no
 * cuentan, ni los de un rival sin persona resuelta (no se adivina por nombre).
 *
 * La racha ordena los asaltos de cada rival por fecha; el mismo día, la poule
 * va antes que la eliminación directa y después por ID (la fuente no publica
 * la hora).
 */
export function sqlEstadisticasRivales(ids: readonly string[], canonicaId: string) {
  const minimo = MINIMO_ASALTOS_CURIOSIDAD;
  // Cada curiosidad ordena por `principal DESC, resto, pr.rival` entre los
  // rivales que cumplen `donde`.
  const curiosidades: { clave: ClaveCuriosidad; donde: string; principal: string; resto: string }[] = [
    { clave: 'rivalMasHabitual', donde: 'TRUE', principal: 'pr.asaltos', resto: 'pr."ultimaOrden" DESC' },
    { clave: 'masTocadosDados', donde: 'pr.dados > 0', principal: 'pr.dados', resto: 'pr.asaltos ASC' },
    { clave: 'masTocadosPorAsalto', donde: `pr.asaltos >= ${minimo}`, principal: 'pr.dados * 1.0 / pr.asaltos', resto: 'pr.asaltos DESC' },
    { clave: 'masTocadosRecibidos', donde: 'pr.recibidos > 0', principal: 'pr.recibidos', resto: 'pr.asaltos ASC' },
    { clave: 'rivalMasDificil', donde: `pr.asaltos >= ${minimo} AND pr.derrotas > pr.victorias`,
      principal: 'pr.derrotas', resto: 'pr.derrotas - pr.victorias DESC, pr.asaltos DESC' },
    { clave: 'masVictoriasContra', donde: `pr.asaltos >= ${minimo} AND pr.victorias > pr.derrotas`,
      principal: 'pr.victorias', resto: 'pr.victorias - pr.derrotas DESC, pr.asaltos DESC' },
    { clave: 'duelosMasAjustados', donde: 'pr.ajustados > 0', principal: 'pr.ajustados', resto: 'pr.asaltos ASC' },
    { clave: 'mejorRacha', donde: 'pr.racha >= 2', principal: 'pr.racha', resto: 'pr."ultimaOrden" DESC' },
  ];
  const curiosidad = (i: number) => {
    const c = curiosidades[i];
    return sql`
    SELECT * FROM (
      SELECT 'curiosidad' AS clase, ${c.clave} AS clave, ${MEDIDAS_RIVAL},
             NULL AS favor, NULL AS contra, NULL AS fecha, NULL AS prueba
      FROM candidatos pr WHERE ${sql.raw(c.donde)}
      ORDER BY ${sql.raw(c.principal)} DESC, ${sql.raw(c.resto)}, pr.rival LIMIT 1)`;
  };
  const maximos = sql.raw(curiosidades
    .map((c, i) => `max(CASE WHEN ${c.donde} THEN ${c.principal} END) AS m${i}`).join(',\n             '));
  const esCandidato = sql.raw(curiosidades
    .map((c, i) => `(${c.donde} AND ${c.principal} = mx.m${i})`).join('\n         OR '));
  const medidasFase = (fase: 'POULE' | 'TABLEAU') => {
    const en = (expr: string) => `CASE WHEN fase = '${fase}' THEN ${expr} END`;
    return sql.raw(`sum(fase = '${fase}') AS "${fase}_asaltos",
             coalesce(sum(${en('favor > contra')}), 0) AS "${fase}_victorias",
             coalesce(sum(${en('favor < contra')}), 0) AS "${fase}_derrotas",
             coalesce(sum(${en('favor = contra')}), 0) AS "${fase}_empates",
             coalesce(sum(${en('favor')}), 0) AS "${fase}_dados",
             coalesce(sum(${en('contra')}), 0) AS "${fase}_recibidos"`);
  };
  const filaFase = (fase: 'POULE' | 'TABLEAU') => sql.raw(`
      SELECT 'fase', '${fase}', NULL, "${fase}_asaltos", "${fase}_victorias", "${fase}_derrotas",
             "${fase}_empates", "${fase}_dados", "${fase}_recibidos", 0, 0, 0, NULL, NULL, NULL, NULL, NULL
      FROM resumen WHERE "${fase}_asaltos" > 0`);
  return sql`
    WITH ${sqlAsaltosOrientados(ids)}, con_rival AS MATERIALIZED (
      SELECT v.*, coalesce(rp.merged_into_person_id, rp.id) AS rival
      FROM validos v CROSS JOIN sport_person rp ON rp.id = v.rival_id
      WHERE coalesce(rp.merged_into_person_id, rp.id) <> ${canonicaId}
    ), secuencia AS (
      -- Isla: no victorias contra el rival hasta este asalto incluido. Cada
      -- isla es una no victoria seguida de victorias (la 0, sólo victorias),
      -- así que sus victorias son una racha. Una sola ventana: en D1 cuestan.
      SELECT rival, favor, contra, fecha, fecha_orden,
             sum(favor <= contra) OVER (
               PARTITION BY rival ORDER BY fecha_orden, fase = 'TABLEAU', id ROWS UNBOUNDED PRECEDING
             ) AS isla
      FROM con_rival
    ), islas AS (
      SELECT rival, count(*) AS asaltos, sum(favor > contra) AS victorias, sum(favor < contra) AS derrotas,
             sum(favor = contra) AS empates, sum(favor) AS dados, sum(contra) AS recibidos,
             sum(abs(favor - contra) = 1) AS ajustados,
             sum(abs(favor - contra) = 1 AND favor > contra) AS "ajustadosGanados",
             max(fecha) AS "ultimaFecha", max(fecha_orden) AS "ultimaOrden"
      FROM secuencia GROUP BY rival, isla
    ), por_rival AS MATERIALIZED (
      SELECT rival, sum(asaltos) AS asaltos, sum(victorias) AS victorias, sum(derrotas) AS derrotas,
             sum(empates) AS empates, sum(dados) AS dados, sum(recibidos) AS recibidos,
             sum(ajustados) AS ajustados, sum("ajustadosGanados") AS "ajustadosGanados",
             max(victorias) AS racha,
             max("ultimaFecha") AS "ultimaFecha", max("ultimaOrden") AS "ultimaOrden"
      FROM islas GROUP BY rival
    ), resumen AS MATERIALIZED (
      -- Totales y fases en una sola pasada (un GROUP BY fase volvería a leer y ordenar).
      SELECT ${MEDIDAS_REGISTRO},
             coalesce(sum(abs(favor - contra) = 1), 0) AS ajustados,
             coalesce(sum(abs(favor - contra) = 1 AND favor > contra), 0) AS "ajustadosGanados",
             ${medidasFase('POULE')}, ${medidasFase('TABLEAU')}
      FROM con_rival
    ), maximos AS MATERIALIZED (
      SELECT count(*) AS rivales,
             ${maximos}
      FROM por_rival pr
    ), candidatos AS MATERIALIZED (
      -- El ganador de cada curiosidad tiene el máximo de su criterio principal:
      -- sólo esos rivales se ordenan (y no la tabla entera una vez por curiosidad).
      SELECT pr.* FROM maximos mx CROSS JOIN por_rival pr
      WHERE ${esCandidato}
    ), salida AS (
      -- D1 admite como mucho cinco términos por cadena de UNION ALL: se anidan en grupos.
      SELECT * FROM (
      SELECT 'total' AS clase, NULL AS clave, NULL AS rival,
             asaltos, victorias, derrotas, empates, dados, recibidos, ajustados, "ajustadosGanados",
             (SELECT rivales FROM maximos) AS racha, NULL AS "ultimaFecha",
             NULL AS favor, NULL AS contra, NULL AS fecha, NULL AS prueba
      FROM resumen
      UNION ALL ${filaFase('POULE')}
      UNION ALL ${filaFase('TABLEAU')}
      UNION ALL
      SELECT * FROM (
        SELECT 'rival', NULL, ${MEDIDAS_RIVAL}, NULL, NULL, NULL, NULL
        FROM por_rival pr ORDER BY pr.asaltos DESC, pr."ultimaOrden" DESC, pr.rival
        LIMIT ${LIMITE_RIVALES_STATS + 1})
      )
      UNION ALL SELECT * FROM (
      ${curiosidad(0)}
      UNION ALL ${curiosidad(1)}
      UNION ALL ${curiosidad(2)}
      UNION ALL ${curiosidad(3)}
      )
      UNION ALL SELECT * FROM (
      ${curiosidad(4)}
      UNION ALL ${curiosidad(5)}
      UNION ALL ${curiosidad(6)}
      UNION ALL ${curiosidad(7)}
      )
      UNION ALL SELECT * FROM (
        SELECT 'curiosidad', 'mayorVictoria', ${MEDIDAS_RIVAL}, cr.favor, cr.contra, cr.fecha, cr.prueba
        FROM (
          SELECT * FROM con_rival WHERE favor > contra
          ORDER BY favor - contra DESC, fecha_orden DESC, id LIMIT 1
        ) cr CROSS JOIN por_rival pr ON pr.rival = cr.rival)
    )
    SELECT s.*, p.display_name AS "nombreRival", p.country_code AS "paisRival", ed.name AS torneo
    FROM salida s
    LEFT JOIN sport_person p ON p.id = s.rival
    LEFT JOIN sport_competition pc ON pc.id = s.prueba
    LEFT JOIN sport_edition ed ON ed.id = pc.edition_id`;
}

export type FilaEstadisticasRivales = {
  clase: 'total' | 'fase' | 'rival' | 'curiosidad';
  clave: string | null;
  rival: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
  empates: number;
  dados: number;
  recibidos: number;
  ajustados: number;
  ajustadosGanados: number;
  /** En `total` es el número de rivales distintos. */
  racha: number;
  ultimaFecha: string | null;
  favor: number | null;
  contra: number | null;
  fecha: string | null;
  prueba: string | null;
  nombreRival: string | null;
  paisRival: string | null;
  torneo: string | null;
};

const VACIO: RegistroAsaltos = {
  asaltos: 0, victorias: 0, derrotas: 0, empates: 0,
  tocadosDados: 0, tocadosRecibidos: 0, porcentajeVictorias: null,
};

function registro(f: FilaEstadisticasRivales | undefined): RegistroAsaltos {
  if (!f) return { ...VACIO };
  const victorias = Number(f.victorias);
  const derrotas = Number(f.derrotas);
  return {
    asaltos: Number(f.asaltos),
    victorias,
    derrotas,
    empates: Number(f.empates),
    tocadosDados: Number(f.dados),
    tocadosRecibidos: Number(f.recibidos),
    porcentajeVictorias: porcentaje(victorias, derrotas),
  };
}

function balance(f: FilaEstadisticasRivales): BalanceRival {
  const rival: RivalBasico = { id: String(f.rival), nombre: f.nombreRival ?? '', pais: f.paisRival };
  return {
    ...registro(f),
    rival,
    decididosPorUno: Number(f.ajustados),
    ganadosPorUno: Number(f.ajustadosGanados),
    mejorRacha: Number(f.racha),
    ultimaFecha: f.ultimaFecha,
  };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const decimal = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

type Texto = { etiqueta: string; valor: (b: BalanceRival, f: FilaEstadisticasRivales) => number; frase: (b: BalanceRival, f: FilaEstadisticasRivales) => string };

/** Etiquetas neutras: describen el duelo deportivo, sin juicios sobre el rival. */
export const TEXTOS_CURIOSIDAD: Record<ClaveCuriosidad, Texto> = {
  rivalMasHabitual: {
    etiqueta: 'Rival más habitual',
    valor: (b) => b.asaltos,
    frase: (b) => `${plural(b.asaltos, 'asalto', 'asaltos')} contra ${b.rival.nombre} (${b.victorias}-${b.derrotas}).`,
  },
  masTocadosDados: {
    etiqueta: 'Más tocados dados',
    valor: (b) => b.tocadosDados,
    frase: (b) => `${plural(b.tocadosDados, 'tocado', 'tocados')} a ${b.rival.nombre} en ${plural(b.asaltos, 'asalto', 'asaltos')}.`,
  },
  masTocadosPorAsalto: {
    etiqueta: 'Más tocados por asalto',
    valor: (b) => b.tocadosDados / b.asaltos,
    frase: (b) => `${decimal(b.tocadosDados / b.asaltos)} tocados por asalto contra ${b.rival.nombre}.`,
  },
  masTocadosRecibidos: {
    etiqueta: 'Más tocados recibidos',
    valor: (b) => b.tocadosRecibidos,
    frase: (b) => `${b.rival.nombre} le ha dado ${plural(b.tocadosRecibidos, 'tocado', 'tocados')}.`,
  },
  rivalMasDificil: {
    etiqueta: 'Rival más difícil',
    valor: (b) => b.derrotas,
    frase: (b) => `Balance de ${b.victorias}-${b.derrotas} contra ${b.rival.nombre}.`,
  },
  masVictoriasContra: {
    etiqueta: 'Mejor balance',
    valor: (b) => b.victorias,
    frase: (b) => `Balance de ${b.victorias}-${b.derrotas} contra ${b.rival.nombre}.`,
  },
  duelosMasAjustados: {
    etiqueta: 'Duelos más ajustados',
    valor: (b) => b.decididosPorUno,
    frase: (b) => `${plural(b.decididosPorUno, 'asalto decidido', 'asaltos decididos')} por un tocado contra ${b.rival.nombre} (${b.ganadosPorUno} ganados).`,
  },
  mejorRacha: {
    etiqueta: 'Mejor racha',
    valor: (b) => b.mejorRacha,
    frase: (b) => `${plural(b.mejorRacha, 'victoria seguida', 'victorias seguidas')} contra ${b.rival.nombre}.`,
  },
  mayorVictoria: {
    etiqueta: 'Victoria más amplia',
    valor: (_b, f) => Number(f.favor) - Number(f.contra),
    frase: (b, f) => `${f.favor}-${f.contra} contra ${b.rival.nombre}${f.torneo ? ` (${f.torneo})` : ''}.`,
  },
};

const ORDEN_CURIOSIDADES = Object.keys(TEXTOS_CURIOSIDAD) as ClaveCuriosidad[];

export function aEstadisticasRivales(rows: readonly FilaEstadisticasRivales[]): EstadisticasRivales {
  const total = rows.find((r) => r.clase === 'total');
  const fase = (f: string) => rows.find((r) => r.clase === 'fase' && r.clave === f);
  const rivales = rows.filter((r) => r.clase === 'rival').map(balance);
  const curiosidades: Curiosidad[] = rows
    .filter((r) => r.clase === 'curiosidad' && r.rival && (ORDEN_CURIOSIDADES as string[]).includes(String(r.clave)))
    .map((r) => {
      const clave = r.clave as ClaveCuriosidad;
      const b = balance(r);
      const t = TEXTOS_CURIOSIDAD[clave];
      return {
        clave,
        etiqueta: t.etiqueta,
        descripcion: t.frase(b, r),
        rival: b.rival,
        valor: t.valor(b, r),
        balance: b,
        marcador: clave === 'mayorVictoria' && r.prueba
          ? { favor: Number(r.favor), contra: Number(r.contra), fecha: r.fecha, pruebaId: r.prueba, torneo: r.torneo ?? '' }
          : null,
      };
    })
    .sort((a, b) => ORDEN_CURIOSIDADES.indexOf(a.clave) - ORDEN_CURIOSIDADES.indexOf(b.clave));
  const ajustados = Number(total?.ajustados ?? 0);
  const ajustadosGanados = Number(total?.ajustadosGanados ?? 0);
  return {
    total: registro(total),
    poule: registro(fase('POULE')),
    eliminacion: registro(fase('TABLEAU')),
    sangreFria: {
      asaltos: ajustados,
      victorias: ajustadosGanados,
      porcentaje: ajustados > 0 ? ajustadosGanados / ajustados : null,
    },
    rivalesDistintos: Number(total?.racha ?? 0),
    rivales: rivales.slice(0, LIMITE_RIVALES_STATS),
    rivalesTruncado: rivales.length > LIMITE_RIVALES_STATS,
    curiosidades,
  };
}

/**
 * Para quien ya resolvió la persona (la ficha tiene `ids` y `canonicaId`).
 * Un fallo devuelve `null` y no tumba el resto de la página.
 */
export async function leerEstadisticasRivalesDe(
  db: ContextoExplorador['db'],
  ids: readonly string[],
  canonicaId: string,
): Promise<EstadisticasRivales | null> {
  try {
    return aEstadisticasRivales(
      filas<FilaEstadisticasRivales>(await db.execute(sqlEstadisticasRivales(ids, canonicaId))),
    );
  } catch (error) {
    console.error('[explorar] las estadísticas de rivales no se pudieron leer:',
      error instanceof Error ? error.name : 'desconocido');
    return null;
  }
}

const esquema = z.object({ personaId: z.string().regex(UUID_RE) }).strict();

/** Entrada completa: exige sesión, valida el ID y resuelve las fusiones. */
export async function leerEstadisticasRivales(
  ctx: ContextoExplorador,
  entrada: unknown,
): Promise<ResultadoEstadisticasRivales> {
  await exigirPerfil(ctx);
  const analizada = esquema.safeParse(entrada);
  if (!analizada.success) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const persona = await resolverPersona(ctx.db, analizada.data.personaId);
  if (!persona) return { estado: 'no_encontrada' };
  const datos = await leerEstadisticasRivalesDe(ctx.db, persona.ids, persona.canonicaId);
  return datos ? { estado: 'ok', personaId: persona.canonicaId, datos } : { estado: 'error' };
}
