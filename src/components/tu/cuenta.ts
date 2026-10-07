import type { AthleteSummary, SessionProfile } from '@/lib/auth/session';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { CATEGORY_LABEL, WEAPON_LABEL } from '@/lib/utils';

export const ROL: Record<string, string> = {
  admin: 'Dirección técnica',
  coach: 'Seleccionador',
  club: 'Club',
  athlete: 'Tirador',
  guardian: 'Tutor',
};

export function iniciales(nombre: string): string {
  return nombre
    .replace(/^DEMO\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

type Temporada = { categories: Parameters<typeof deriveCategoriesFromBirthDate>[1] } | null | undefined;

/**
 * Nombre y segunda línea de la cuenta (avatar de la cabecera y «Tú»). Para
 * un tirador, su arma y su categoría, que es lo que le identifica aquí; para
 * el resto, su papel. Si el nombre y el papel coinciden («Dirección
 * técnica»), la segunda línea sobra.
 */
export function describirCuenta(
  perfil: Pick<SessionProfile, 'fullName' | 'role'>,
  atletas: readonly Pick<AthleteSummary, 'weapons' | 'birthDate'>[],
  temporada: Temporada,
): { nombre: string; iniciales: string; segundaLinea: string | null } {
  const tirador = atletas[0];
  const categorias = tirador && temporada ? deriveCategoriesFromBirthDate(tirador.birthDate, temporada.categories) : null;
  const subtitulo =
    tirador && tirador.weapons.length > 0
      ? [
          WEAPON_LABEL[tirador.weapons[0]!],
          categorias?.own ? (CATEGORY_LABEL[categorias.own as keyof typeof CATEGORY_LABEL] ?? categorias.own) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : (ROL[perfil.role] ?? perfil.role);
  const nombre = perfil.fullName.replace(/^DEMO\s+/i, '');
  return {
    nombre,
    iniciales: iniciales(perfil.fullName),
    segundaLinea: subtitulo.toLowerCase() === nombre.toLowerCase() ? null : subtitulo,
  };
}
