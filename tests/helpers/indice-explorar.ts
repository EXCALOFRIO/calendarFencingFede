import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { SENTENCIAS_INDICE } from '@/lib/sport/explorar/indice-sql';

const MIGRACION = readFileSync(new URL('../../drizzle-d1/0004_indice_explorar.sql', import.meta.url), 'utf8')
  .replace(/--> statement-breakpoint/g, '');

/**
 * Crea y reconstruye el índice de palabras de Explorar (0004) sobre un SQLite
 * de prueba. Las sugerencias sólo funcionan con él: sin índice responden
 * `no_disponible`.
 */
export function construirIndiceExplorar(sqlite: DatabaseSync): void {
  sqlite.exec(MIGRACION);
  sqlite.exec('BEGIN');
  for (const sentencia of SENTENCIAS_INDICE) sqlite.exec(sentencia);
  sqlite.exec('COMMIT');
}
