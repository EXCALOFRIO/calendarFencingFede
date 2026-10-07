import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { codificarCursor, decodificarCursor, UUID_RE } from './cursor';
import { LIMITE_MAXIMO } from './entrada';

/**
 * Lista «Siguiendo»: a quién sigue la cuenta de la sesión, de la más reciente
 * a la más antigua. Es la misma relación que el feed (`sport_favorite`), con
 * cada persona llevada a su raíz igual que allí.
 *
 * Una sola consulta y sólo con lo que pinta la fila (nombre y país): nada de
 * conteos de resultados ni armas, que obligarían a leer `sport_result` entero
 * de cada persona seguida. La foto la pide cada fila al verse.
 */

const CLASE = 'siguiendo-lista';

export const LIMITE_LISTA_SIGUIENDO = LIMITE_MAXIMO;

export type PersonaSeguida = { id: string; nombre: string; pais: string | null };

export type ResultadoListaSiguiendo =
  | { estado: 'ok'; items: PersonaSeguida[]; siguiente: string | null; sinResultados: boolean }
  | { estado: 'entrada_invalida' }
  | { estado: 'cursor_invalido' }
  | { estado: 'no_disponible' };

const esquema = z
  .object({
    cursor: z.string().min(1).max(600).optional(),
    limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional(),
  })
  .strict();

export function sqlListaSiguiendo(profileId: string, limite: number, clave: readonly [number, string] | null) {
  const posicion = clave ? sql`WHERE (g.creado, g.canonica) < (${clave[0]}, ${clave[1]})` : sql``;
  return sql`
    WITH g AS (
      SELECT coalesce(p.merged_into_person_id, p.id) AS canonica, max(f.created_at) AS creado
      FROM sport_favorite f CROSS JOIN sport_person p ON p.id = f.person_id
      WHERE f.profile_id = ${profileId}
      GROUP BY coalesce(p.merged_into_person_id, p.id)
    )
    SELECT p.id AS id, p.display_name AS nombre, p.country_code AS pais, g.creado AS creado
    FROM g CROSS JOIN sport_person p ON p.id = g.canonica
    ${posicion}
    ORDER BY g.creado DESC, g.canonica DESC
    LIMIT ${limite + 1}`;
}

type Fila = PersonaSeguida & { creado: number };

export async function leerListaSiguiendo(ctx: ContextoExplorador, entrada: unknown): Promise<ResultadoListaSiguiendo> {
  const perfil = await exigirPerfil(ctx);
  const analizada = esquema.safeParse(entrada ?? {});
  if (!analizada.success) return { estado: 'entrada_invalida' };

  const filtros = { cuenta: perfil.profileId };
  let clave: [number, string] | null = null;
  if (analizada.data.cursor) {
    const k = decodificarCursor(CLASE, filtros, analizada.data.cursor, 2);
    if (!k || typeof k[0] !== 'number' || !Number.isFinite(k[0]) || !UUID_RE.test(String(k[1]))) {
      return { estado: 'cursor_invalido' };
    }
    clave = [k[0], String(k[1])];
  }
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const limite = analizada.data.limite ?? LIMITE_LISTA_SIGUIENDO;
  const encontradas = filas<Fila>(await ctx.db.execute(sqlListaSiguiendo(perfil.profileId, limite, clave)));
  const pagina = encontradas.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  return {
    estado: 'ok',
    items: pagina.map((f) => ({ id: f.id, nombre: f.nombre, pais: f.pais })),
    siguiente: encontradas.length > limite && ultima
      ? codificarCursor(CLASE, filtros, [Number(ultima.creado), ultima.id])
      : null,
    sinResultados: pagina.length === 0,
  };
}
