import type { SessionProfile, Weapon } from '@/lib/auth/session';

/**
 * Quién puede ver el ranking INTERNO (`ranking_snapshot` / `ranking_point`):
 * puestos, puntos, desglose por prueba, cortes y reglas derivadas de él.
 *
 *   admin    todas las armas
 *   coach    solo las armas que tiene asignadas en `profile_weapon`
 *   resto    nada (athlete, sin sesión)
 *
 * El perfil sale de `getSessionProfile`, que en cada petición lee rol y estado
 * de la base y devuelve `null` si el acceso está revocado. Aquí no se mira el
 * nombre ni el correo: ningún texto mostrado concede permisos.
 *
 * Las consultas internas reciben el resultado de `armasInternas` y no el
 * perfil, y devuelven vacío sin tocar la base cuando la lista no incluye el
 * arma pedida. Así el arma que llegue por parámetro o por ID no amplía nada.
 */
export const TODAS_LAS_ARMAS: readonly Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];

type PerfilAutorizable = Pick<SessionProfile, 'role' | 'weapons'> | null | undefined;

export function armasInternas(perfil: PerfilAutorizable): Weapon[] {
  if (!perfil) return [];
  if (perfil.role === 'admin') return [...TODAS_LAS_ARMAS];
  if (perfil.role === 'coach') {
    return TODAS_LAS_ARMAS.filter((arma) => perfil.weapons.includes(arma));
  }
  return [];
}

export function puedeVerInterno(
  armas: readonly Weapon[],
  arma: Weapon | string,
): boolean {
  return (armas as readonly string[]).includes(arma);
}
