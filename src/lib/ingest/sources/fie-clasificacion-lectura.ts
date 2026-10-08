import { and, eq, sql, type SQL } from 'drizzle-orm';
import { fueraDeLista } from '@/lib/sqlite';

/**
 * Cierre de la lectura de UN grupo de la clasificación FIE
 * (temporada, formato, arma, género, categoría).
 *
 * La ingestión solo reescribe las filas que cambian, así que sin esto:
 *  - quien sale de la lista de la FIE se queda para siempre con su último
 *    puesto, y
 *  - no hay forma de saber cuándo se leyó el grupo por última vez (`updated_at`
 *    es la fecha del último CAMBIO de cada fila).
 *
 * Reglas, en este orden:
 *  1. Una lectura fallida o vacía no toca nada: ni borra ni registra. Vaciar un
 *     ranking porque la FIE contestó mal es peor que enseñarlo un día viejo.
 *  2. Si la respuesta trae menos de la mitad de las filas guardadas, tampoco se
 *     borra (pinta a respuesta cortada), pero sí se registra la lectura.
 *  3. Si no, se borran las filas del grupo que no vinieron y se registra.
 *
 * Se llama DESPUÉS del upsert del grupo: si el upsert falla, la excepción sale
 * antes y no se borra nada.
 */

export type GrupoClasificacionFie = {
  season: number;
  format: 'INDIVIDUAL' | 'EQUIPOS';
  weapon: 'FLORETE' | 'ESPADA' | 'SABLE';
  gender: 'M' | 'F' | 'MIXTO';
  categoryRaw: string;
};

export type LecturaGrupoFie =
  | {
      ok: true;
      fieIds: readonly number[];
      sourceUrl: string | null;
      /**
       * De los presentes, cuántos ya estaban guardados antes del upsert. Con
       * él, el recuento sale de la lectura anterior más los nuevos, sin
       * `count(*)` sobre el grupo.
       */
      yaGuardadas?: number;
    }
  | { ok: false };

export type EscritorLecturaFie = {
  /**
   * Filas guardadas del grupo, ya con el upsert de esta lectura. Con `previo`
   * puede salir de `fie_clasificacion_lectura.row_count` (lo guardado tras la
   * lectura anterior) más las filas nuevas.
   */
  contarGuardadas(grupo: GrupoClasificacionFie, previo?: { nuevas: number; ahora: Date }): Promise<number>;
  borrarAusentes(grupo: GrupoClasificacionFie, presentes: readonly number[]): Promise<number>;
  registrarLectura(
    grupo: GrupoClasificacionFie,
    datos: { filas: number; borradas: number; leidoEn: Date; sourceUrl: string | null },
  ): Promise<void>;
};

export const PROPORCION_MINIMA_PARA_PODAR = 0.5;

/** Pasado esto, el recuento guardado no se usa y se vuelve a contar el grupo. */
export const VIGENCIA_RECUENTO_MS = 30 * 86_400_000;

export async function cerrarLecturaGrupo(
  escritor: EscritorLecturaFie,
  grupo: GrupoClasificacionFie,
  lectura: LecturaGrupoFie,
  ahora: Date = new Date(),
): Promise<{ borradas: number; registrada: boolean; podaOmitida: boolean }> {
  if (!lectura.ok || lectura.fieIds.length === 0) {
    return { borradas: 0, registrada: false, podaOmitida: true };
  }
  const presentes = [...new Set(lectura.fieIds)];
  const guardadas = await escritor.contarGuardadas(
    grupo,
    lectura.yaGuardadas === undefined
      ? undefined
      : { nuevas: Math.max(0, presentes.length - lectura.yaGuardadas), ahora },
  );
  const podaOmitida = presentes.length < guardadas * PROPORCION_MINIMA_PARA_PODAR;
  // Todo lo presente está guardado: si no hay más filas que presentes, no sobra ninguna.
  const nadaQueBorrar = guardadas <= presentes.length;
  const borradas = podaOmitida || nadaQueBorrar ? 0 : await escritor.borrarAusentes(grupo, presentes);
  await escritor.registrarLectura(grupo, {
    // Lo que queda guardado tras esta lectura: es lo que usa la siguiente para no contar.
    filas: podaOmitida ? guardadas : presentes.length,
    borradas,
    leidoEn: ahora,
    sourceUrl: lectura.sourceUrl,
  });
  return { borradas, registrada: true, podaOmitida };
}

export type DbLectura = {
  execute: (query: SQL) => PromiseLike<{ rows: unknown[] }>;
};

/**
 * El escritor real sobre D1. `fie_clasificacion_lectura` llega con la
 * migración 0009: si todavía no está aplicada, registrar la lectura falla en
 * silencio y la ingestión sigue (la poda sí se hace, porque solo usa
 * `fie_clasificacion`).
 */
export function escritorLecturaD1(
  db: DbLectura,
  tabla: typeof import('@/db/schema').fieClasificacion,
): EscritorLecturaFie {
  const delGrupo = (g: GrupoClasificacionFie) =>
    and(
      eq(tabla.season, g.season),
      eq(tabla.format, g.format),
      eq(tabla.weapon, g.weapon),
      eq(tabla.gender, g.gender),
      eq(tabla.categoryRaw, g.categoryRaw),
    );

  return {
    async contarGuardadas(g, previo) {
      if (previo) {
        try {
          const { rows } = await db.execute(sql`
            select row_count as n, read_at as r from fie_clasificacion_lectura
            where season = ${g.season} and format = ${g.format} and weapon = ${g.weapon}
              and gender = ${g.gender} and category_raw = ${g.categoryRaw}`);
          const fila = rows[0] as { n?: number; r?: number } | undefined;
          if (fila && previo.ahora.getTime() - Number(fila.r) < VIGENCIA_RECUENTO_MS) {
            return Number(fila.n) + previo.nuevas;
          }
        } catch {
          // Sin 0009 se cuenta como antes.
        }
      }
      const { rows } = await db.execute(
        sql`select count(*) as n from ${tabla} where ${delGrupo(g)}`,
      );
      return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
    },
    async borrarAusentes(g, presentes) {
      const { rows } = await db.execute(
        sql`delete from ${tabla} where ${delGrupo(g)} and ${fueraDeLista(tabla.fieId, [...presentes])} returning fie_id`,
      );
      return rows.length;
    },
    async registrarLectura(g, d) {
      try {
        await db.execute(sql`
          insert into fie_clasificacion_lectura
            (season, format, weapon, gender, category_raw, row_count, deleted_count, read_at, source_url)
          values (${g.season}, ${g.format}, ${g.weapon}, ${g.gender}, ${g.categoryRaw},
                  ${d.filas}, ${d.borradas}, ${d.leidoEn.getTime()}, ${d.sourceUrl})
          on conflict (season, format, weapon, gender, category_raw) do update set
            row_count = excluded.row_count,
            deleted_count = excluded.deleted_count,
            read_at = excluded.read_at,
            source_url = excluded.source_url`);
      } catch {
        // Tabla aún sin migrar: la fecha de lectura se pierde, el ranking no.
      }
    },
  };
}
