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
  const curiosidad = (clave: ClaveCuriosidad, donde: string, orden: string) => sql`
    SELECT * FROM (
      SELECT 'curiosidad' AS clase, ${clave} AS clave, ${MEDIDAS_RIVAL},
             NULL AS favor, NULL AS contra, NULL AS fecha, NULL AS prueba
      FROM por_rival pr WHERE ${sql.raw(donde)}
      ORDER BY ${sql.raw(orden)}, pr.rival LIMIT 1)`;
  const minimo = MINIMO_ASALTOS_CURIOSIDAD;
  return sql`
    WITH ${sqlAsaltosOrientados(ids)}, con_rival AS MATERIALIZED (
      SELECT v.*, coalesce(rp.merged_into_person_id, rp.id) AS rival
      FROM validos v CROSS JOIN sport_person rp ON rp.id = v.rival_id
      WHERE coalesce(rp.merged_into_person_id, rp.id) <> ${canonicaId}
    ), secuencia AS (
      SELECT rival, favor > contra AS gana,
             row_number() OVER (PARTITION BY rival ORDER BY fecha_orden, fase = 'TABLEAU', id)
             - row_number() OVER (PARTITION BY rival, favor > contra ORDER BY fecha_orden, fase = 'TABLEAU', id) AS isla
      FROM con_rival
    ), rachas AS (
      SELECT rival, max(n) AS racha FROM (
        SELECT rival, count(*) AS n FROM secuencia WHERE gana GROUP BY rival, isla
      ) GROUP BY rival
    ), por_rival AS MATERIALIZED (
      SELECT cr.rival, ${MEDIDAS_REGISTRO},
             sum(abs(favor - contra) = 1) AS ajustados,
             sum(abs(favor - contra) = 1 AND favor > contra) AS "ajustadosGanados",
             coalesce(max(ra.racha), 0) AS racha,
             max(fecha) AS "ultimaFecha", max(fecha_orden) AS "ultimaOrden"
      FROM con_rival cr LEFT JOIN rachas ra ON ra.rival = cr.rival
      GROUP BY cr.rival
    ), salida AS (
      -- D1 admite como mucho cinco términos por cadena de UNION ALL: se anidan en grupos.
      SELECT * FROM (
      SELECT 'total' AS clase, NULL AS clave, NULL AS rival, ${MEDIDAS_REGISTRO},
             coalesce(sum(abs(favor - contra) = 1), 0) AS ajustados,
             coalesce(sum(abs(favor - contra) = 1 AND favor > contra), 0) AS "ajustadosGanados",
             (SELECT count(*) FROM por_rival) AS racha, NULL AS "ultimaFecha",
             NULL AS favor, NULL AS contra, NULL AS fecha, NULL AS prueba
      FROM con_rival
      UNION ALL
      SELECT 'fase', fase, NULL, ${MEDIDAS_REGISTRO}, 0, 0, 0, NULL, NULL, NULL, NULL, NULL
      FROM con_rival GROUP BY fase
      UNION ALL
      SELECT * FROM (
        SELECT 'rival', NULL, ${MEDIDAS_RIVAL}, NULL, NULL, NULL, NULL
        FROM por_rival pr ORDER BY pr.asaltos DESC, pr."ultimaOrden" DESC, pr.rival
        LIMIT ${LIMITE_RIVALES_STATS + 1})
      )
      UNION ALL SELECT * FROM (
      ${curiosidad('rivalMasHabitual', 'TRUE', 'pr.asaltos DESC, pr."ultimaOrden" DESC')}
      UNION ALL ${curiosidad('masTocadosDados', 'pr.dados > 0', 'pr.dados DESC, pr.asaltos ASC')}
      UNION ALL ${curiosidad('masTocadosPorAsalto', `pr.asaltos >= ${minimo}`,
        'pr.dados * 1.0 / pr.asaltos DESC, pr.asaltos DESC')}
      UNION ALL ${curiosidad('masTocadosRecibidos', 'pr.recibidos > 0', 'pr.recibidos DESC, pr.asaltos ASC')}
      )
      UNION ALL SELECT * FROM (
      ${curiosidad('rivalMasDificil', `pr.asaltos >= ${minimo} AND pr.derrotas > pr.victorias`,
        'pr.derrotas DESC, pr.derrotas - pr.victorias DESC, pr.asaltos DESC')}
      UNION ALL ${curiosidad('masVictoriasContra', `pr.asaltos >= ${minimo} AND pr.victorias > pr.derrotas`,
        'pr.victorias DESC, pr.victorias - pr.derrotas DESC, pr.asaltos DESC')}
      UNION ALL ${curiosidad('duelosMasAjustados', 'pr.ajustados > 0', 'pr.ajustados DESC, pr.asaltos ASC')}
      UNION ALL ${curiosidad('mejorRacha', 'pr.racha >= 2', 'pr.racha DESC, pr."ultimaOrden" DESC')}
      )
      UNION ALL SELECT * FROM (
        SELECT 'curiosidad', 'mayorVictoria', ${MEDIDAS_RIVAL}, cr.favor, cr.contra, cr.fecha, cr.prueba
        FROM con_rival cr JOIN por_rival pr ON pr.rival = cr.rival
        WHERE cr.favor > cr.contra
        ORDER BY cr.favor - cr.contra DESC, cr.fecha_orden DESC, cr.id LIMIT 1)
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
