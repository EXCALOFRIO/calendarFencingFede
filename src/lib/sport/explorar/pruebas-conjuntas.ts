import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { crearDetectorCondicion } from '@/lib/sport/esquema';
import { filas } from './contexto';
import { UUID_RE } from './cursor';
import { listaUuid } from './filtros-sql';

/**
 * Pruebas conjuntas (migración drizzle-d1/0013_pruebas_conjuntas.sql): la lectura de Engarde,
 * con poules y cuadro, de un evento que la RFEE publica partido en varias clasificaciones
 * (veteranos de dos franjas, Criterium mixto o de dos años). Cada parte guarda los puestos
 * oficiales; la conjunta guarda los asaltos y sus puestos no llevan persona, así que nunca
 * duplican el historial de un tirador. Desde una parte se enlaza con la conjunta:
 * «Poules y cuadro: prueba conjunta».
 *
 * La tabla puede no existir todavía (la migración se aplica a mano): sin ella no hay enlaces.
 */
export const ETIQUETA_PRUEBA_CONJUNTA = 'Poules y cuadro: prueba conjunta';

export type ReglaConjunta = 'partes' | 'contenida';

export type EnlaceConjunta = {
  /** Prueba con las poules y el cuadro de todas las partes. */
  conjuntaId: string;
  regla: ReglaConjunta;
  /** Pruebas con los puestos oficiales (incluida la consultada si es una parte), ordenadas. */
  partes: string[];
};

type Ejecutor = Pick<Db, 'execute'>;

/** Detector de la tabla: verdadero se recuerda, falso se reintenta al minuto (`crearDetectorCondicion`). */
export function crearDetectorConjuntas(db: Ejecutor): () => Promise<boolean> {
  return crearDetectorCondicion(async () => filas<{ ok: number }>(await db.execute(sql`
    SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'sport_competition_combined' LIMIT 1`)).length > 0);
}

/**
 * Enlace de una prueba con su conjunta: si `competitionId` es una parte, su conjunta y las
 * demás partes; si es la conjunta, ella misma con sus partes. `null` si no es ninguna.
 */
export async function pruebaConjuntaDe(
  db: Ejecutor, competitionId: string, hayTabla: () => Promise<boolean>,
): Promise<EnlaceConjunta | null> {
  if (!UUID_RE.test(competitionId) || !(await hayTabla())) return null;
  const rs = filas<{ conjunta: string; regla: ReglaConjunta; parte: string }>(await db.execute(sql`
    SELECT k.combined_competition_id AS conjunta, k.rule AS regla, k.part_competition_id AS parte
      FROM sport_competition_combined k
     WHERE k.combined_competition_id = coalesce(
             (SELECT combined_competition_id FROM sport_competition_combined WHERE part_competition_id = ${competitionId}),
             (SELECT combined_competition_id FROM sport_competition_combined WHERE combined_competition_id = ${competitionId} LIMIT 1))
     ORDER BY k.part_competition_id`));
  if (rs.length === 0) return null;
  return { conjuntaId: rs[0].conjunta, regla: rs[0].regla, partes: rs.map((r) => r.parte) };
}

/**
 * Para listas (ficha de evento, historial): prueba → conjunta de las que son partes, y cada
 * conjunta → ella misma. Las demás no salen en el mapa.
 */
export async function conjuntasDe(
  db: Ejecutor, competitionIds: readonly string[], hayTabla: () => Promise<boolean>,
): Promise<Map<string, string>> {
  const ids = [...new Set(competitionIds.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, string>();
  if (ids.length === 0 || !(await hayTabla())) return out;
  const rs = filas<{ prueba: string; conjunta: string }>(await db.execute(sql`
    SELECT part_competition_id AS prueba, combined_competition_id AS conjunta FROM sport_competition_combined
     WHERE part_competition_id IN (${listaUuid(ids)})
    UNION
    SELECT combined_competition_id AS prueba, combined_competition_id AS conjunta FROM sport_competition_combined
     WHERE combined_competition_id IN (${listaUuid(ids)})`));
  for (const r of rs) out.set(r.prueba, r.conjunta);
  return out;
}
