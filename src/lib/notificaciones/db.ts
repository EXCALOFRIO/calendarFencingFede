import type { SQL } from 'drizzle-orm';
import type { Db } from '@/db';

/**
 * Lo único que estos módulos necesitan de la base: ejecutar SQL. Lo reciben
 * por parámetro para probarse sobre `node:sqlite` con la migración real.
 */
export type DbAvisos = Pick<Db, 'execute'>;

export async function filasDe<T>(db: DbAvisos, consulta: SQL): Promise<T[]> {
  const resultado = (await db.execute(consulta)) as unknown;
  if (Array.isArray(resultado)) return resultado as T[];
  const rows = (resultado as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Lista para `IN (SELECT value FROM json_each(?))`: un parámetro, no uno por valor. */
export const jsonLista = (valores: readonly string[]) => JSON.stringify([...new Set(valores)]);

/** ¿Falta la 0014? Así el cron y la campana degradan en vez de fallar. */
export function esFaltaDeTabla(error: unknown): boolean {
  const texto = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}` : String(error);
  return /no such table: notificacion/i.test(texto);
}
