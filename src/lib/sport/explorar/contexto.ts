import type { Db } from '@/db';
import type { SessionProfile } from '@/lib/auth/session';
import type { EstadoEsquema } from '@/lib/sport/esquema';
import type { DepsPropietario } from './propietario';

/**
 * Dependencias de las lecturas del explorador. Los módulos de este directorio
 * no importan la base real: la reciben aquí, de modo que se ejercitan con un
 * registrador de SQL y un perfil controlado, y `real.ts` es el único sitio que
 * conecta D1 y la sesión.
 */
export type ContextoExplorador = {
  db: Pick<Db, 'execute'> & Partial<Pick<Db, 'batch'>>;
  /** Perfil vigente de la petición, o `null` sin sesión o con acceso revocado. */
  perfil: () => Promise<SessionProfile | null>;
  esquema: () => Promise<EstadoEsquema>;
  propietario: DepsPropietario;
  /** Día actual (YYYY-MM-DD). */
  hoy: () => string;
};

export const ERROR_NO_AUTENTICADO = 'NO_AUTENTICADO';

/**
 * Guarda previa a cualquier lectura: sin sesión vigente (incluida una cuenta
 * revocada, que `getSessionProfile` ya devuelve como `null`) no se consulta
 * nada. Ningún rol queda excluido: el explorador es deportivo y común.
 */
export async function exigirPerfil(ctx: ContextoExplorador): Promise<SessionProfile> {
  const perfil = await ctx.perfil();
  if (!perfil) throw new Error(ERROR_NO_AUTENTICADO);
  return perfil;
}

/** Filas de un `db.execute` (array directo o `{ rows }`). */
export function filas<T>(resultado: unknown): T[] {
  if (Array.isArray(resultado)) return resultado as T[];
  const rows = (resultado as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
