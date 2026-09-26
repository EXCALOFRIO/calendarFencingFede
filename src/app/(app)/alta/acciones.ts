'use server';

import { revalidatePath } from 'next/cache';
import {
  type Candidato,
  type MotivoRechazo,
  buscarCandidatos,
  vincularFichaDesdeRanking,
} from '@/lib/altas/desde-ranking';
import { requireProfile } from '@/lib/auth/session';

/**
 * Las dos acciones de `/alta`: buscarse y confirmar.
 *
 * Las dos exigen sesión. La búsqueda porque el ranking oficial trae fechas de
 * nacimiento y clubes de menores de edad y eso no se sirve a quien pase por la
 * URL; la confirmación porque sin cuenta no hay nada a lo que vincular.
 *
 * La regla de negocio no está aquí: está en `src/lib/altas/desde-ranking.ts`,
 * que es lo que comparten esta pantalla y `scripts/alta-desde-ranking.ts`.
 */

export type ResultadoBusqueda =
  | { ok: true; candidatos: Candidato[] }
  | { ok: false; error: string };

export async function buscarEnRanking(texto: string): Promise<ResultadoBusqueda> {
  await requireProfile();

  const limpio = texto.trim();
  if (limpio.length < 3) {
    return {
      ok: false,
      error:
        'Escribe al menos tres letras de tu apellido, o tu número de licencia ' +
        'completo.',
    };
  }

  return { ok: true, candidatos: await buscarCandidatos(limpio) };
}

export type ResultadoVinculo =
  | { ok: true }
  | { ok: false; motivo: MotivoRechazo; error: string };

/**
 * Vincula la ficha elegida a la cuenta que ha entrado.
 *
 * No recibe ningún identificador de cuenta de fuera: el perfil sale de la
 * sesión. Lo único que llega del navegador es qué fila del ranking se reclama y
 * la licencia con la que se demuestra que es suya.
 */
export async function vincularFicha(
  clave: string,
  licencia: string,
): Promise<ResultadoVinculo> {
  const perfil = await requireProfile();

  const resultado = await vincularFichaDesdeRanking({
    profileId: perfil.profileId,
    clave,
    licencia,
    origen: 'autoservicio',
  });

  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo, error: resultado.error };
  }

  /**
   * Una ficha nueva cambia media aplicación: el calendario ya sabe su arma, el
   * chip de la cabecera enseña arma y categoría, «Mi estado» deja de estar
   * vacío y el ranking se abre por lo suyo. Se invalida todo eso de una vez.
   */
  for (const ruta of ['/alta', '/', '/estado', '/ranking', '/perfil']) {
    revalidatePath(ruta);
  }

  return { ok: true };
}
