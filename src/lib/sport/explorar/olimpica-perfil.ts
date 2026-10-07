import { sql } from 'drizzle-orm';
import { getAnotacionesOlimpicas } from '@/lib/queries/olimpica';
import {
  colorOlimpico,
  type AnotacionOlimpica,
  type ArmaOlimpica,
  type GeneroOlimpico,
} from '@/lib/ranking/olimpica';
import { filas, type ContextoExplorador } from './contexto';
import { listaUuid } from './filtros-sql';
import type { MejorMundial } from './ranking-nacional';

/**
 * Marca olímpica de la persona en cada prueba olímpica (absoluto, masculino o
 * femenino) en la que figura en la clasificación FIE vigente: la anotación
 * completa del motor (estado, camino, puesto, lo que le falta o su margen),
 * con la fecha del ranking y la prueba dentro, para que la etiqueta se
 * explique sola sin la tabla de /ranking delante.
 *
 * Entra lo que tiene color (`colorOlimpico`): verde, amarillo y el gris de
 * RUS/BLR que entrarían o estarían cerca si contaran.
 *
 * Coste: lo que ya pagaba /ranking para esa prueba. `getAnotacionesOlimpicas`
 * lee las filas sénior de UNA prueba (individual y equipos) y va con `cache`,
 * así que varias personas de la misma prueba en una petición la leen una vez.
 */
export type OlimpicaPerfil = { arma: MejorMundial['arma']; genero: MejorMundial['genero']; anotacion: AnotacionOlimpica };

type Plaza = { arma: string; genero: string; fieId: number };

const esPrueba = (p: { arma?: string; genero?: string; categoria?: string }) =>
  p.categoria === 'ABS' && (p.genero === 'M' || p.genero === 'F')
  && (p.arma === 'FLORETE' || p.arma === 'ESPADA' || p.arma === 'SABLE');

async function marcasDe(plazas: readonly Plaza[]): Promise<(OlimpicaPerfil | null)[]> {
  return Promise.all(plazas.map(async (m): Promise<OlimpicaPerfil | null> => {
    try {
      const prueba = await getAnotacionesOlimpicas(m.arma as ArmaOlimpica, m.genero as GeneroOlimpico);
      const anotacion = prueba?.individual[String(m.fieId)];
      if (!prueba || !anotacion || !colorOlimpico(anotacion)) return null;
      return {
        arma: m.arma as OlimpicaPerfil['arma'],
        genero: m.genero as OlimpicaPerfil['genero'],
        anotacion: { ...anotacion, fechaRanking: prueba.fechaRanking, prueba: { arma: prueba.arma, genero: prueba.genero } },
      };
    } catch {
      return null;
    }
  }));
}

export async function leerOlimpicaPerfil(actuales: readonly MejorMundial[] | undefined): Promise<OlimpicaPerfil[]> {
  const candidatas = (actuales ?? []).filter((m) => esPrueba(m) && Number.isFinite(m.fieId));
  if (candidatas.length === 0) return [];
  const salida = await marcasDe(candidatas.map((m) => ({ arma: m.arma, genero: m.genero, fieId: m.fieId! })));
  return salida.filter((o): o is OlimpicaPerfil => o !== null);
}

/**
 * Las filas sénior individuales de la clasificación FIE vigente de varias
 * personas (y de las fichas fusionadas en ellas), por su `fie_addr_id`
 * confirmado. Mismo recorrido que `sqlClasificacionFieDePersonas`: grupo a
 * grupo por la clave única, sin barrer la tabla.
 */
export function sqlPlazasFieDePersonas(ids: readonly string[]) {
  return sql`
    WITH pedidas AS MATERIALIZED (
      SELECT p.id AS persona, p.id AS miembro FROM sport_person p WHERE p.id IN (${listaUuid(ids)})
      UNION
      SELECT p.merged_into_person_id, p.id FROM sport_person p WHERE p.merged_into_person_id IN (${listaUuid(ids)})
    ), ids AS MATERIALIZED (
      SELECT DISTINCT d.persona, CAST(x.value AS INTEGER) AS fie
      FROM pedidas d CROSS JOIN sport_external_id x ON x.person_id = d.miembro
      WHERE x.scheme = 'fie_addr_id' AND x.link_status = 'CONFIRMADO'
    ), g AS MATERIALIZED (
      -- Sólo columnas del índice fie_clasificacion_key: filtrar aquí por category obliga a leer las ~11.500 filas.
      SELECT DISTINCT season, weapon, gender, category_raw FROM fie_clasificacion
      WHERE season = (SELECT max(season) FROM fie_clasificacion) AND gender IN ('M', 'F')
    )
    SELECT ids.persona AS persona, f.weapon AS arma, f.gender AS genero, f.fie_id AS "fieId"
    FROM g CROSS JOIN ids CROSS JOIN fie_clasificacion f
      ON f.season = g.season AND f.weapon = g.weapon AND f.gender = g.gender
     AND f.category_raw = g.category_raw AND f.format = 'INDIVIDUAL' AND f.fie_id = ids.fie
    WHERE f.position IS NOT NULL AND f.category = 'ABS'`;
}

/**
 * Marcas olímpicas de una lista de personas (Buscar, listas de perfiles), por
 * id de persona. Quien no tiene ninguna no aparece. Una consulta para todas
 * las personas y, como mucho, una lectura por prueba olímpica que salga (seis).
 * Nunca falla: sin datos, `{}`.
 */
export async function leerOlimpicaPersonas(
  db: ContextoExplorador['db'],
  personaIds: readonly string[],
): Promise<Record<string, OlimpicaPerfil[]>> {
  const ids = [...new Set(personaIds)];
  if (ids.length === 0) return {};
  try {
    const plazas = filas<Plaza & { persona: string }>(await db.execute(sqlPlazasFieDePersonas(ids)))
      .map((p) => ({ ...p, fieId: Number(p.fieId), categoria: 'ABS' }))
      .filter((p) => esPrueba(p) && Number.isFinite(p.fieId));
    const marcas = await marcasDe(plazas);
    const salida: Record<string, OlimpicaPerfil[]> = {};
    plazas.forEach((p, i) => {
      const m = marcas[i];
      if (m) (salida[p.persona] ??= []).push(m);
    });
    return salida;
  } catch {
    return {};
  }
}
