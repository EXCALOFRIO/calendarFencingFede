'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  type Candidato,
  type MotivoRechazo,
  buscarCandidatos,
  vincularFichaDesdeRanking,
} from '@/lib/altas/desde-ranking';
import { confirmarSoyYo } from '@/lib/altas/por-nombre';
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

/**
 * -------------------------------------------------------------------------
 * LAS DOS ACCIONES DEL ALTA POR NOMBRE
 * -------------------------------------------------------------------------
 * Es lo que pidió el usuario con estas palabras: *«¿no puedes pillarlo por su
 * nombre? que le pregunten al entrar su nombre… y de ahí que pille de la lista
 * aunque no lo haya escrito perfecto, le pregunte "¿eres tú?"»*.
 *
 * `requireProfile()` en las dos, y no es una formalidad: en las listas
 * oficiales hay menores, con su club y su año de nacimiento. Esto no es un
 * buscador público y no puede serlo. El resto de los límites —tres letras
 * mínimo, cinco candidatos, el año y no la fecha— están en
 * `src/lib/altas/por-nombre.ts`, junto al razonamiento de por qué.
 */

/**
 * «Sí, soy yo»: se escribe el enlace.
 *
 * Del navegador solo llega **qué fila se reclama** y lo que se escribió para
 * encontrarla; la cuenta sale de la sesión, nunca de un campo del formulario.
 * Si llegara de fuera, esto sería «vincúlale la ficha de Carlos Llavador a
 * quien yo diga».
 *
 * Acaba siempre en una redirección y no devuelve nada, y eso es lo que permite
 * que la pantalla entera sea servidor sin estado de cliente: si va bien, a
 * `/alta?hecha=1`, que enseña el puesto oficial leído de la base; si no, a la
 * misma búsqueda con el CÓDIGO del rechazo, que la página convierte en frase
 * con `MENSAJE_RECHAZO`. Se manda el código y no la frase para que nadie pueda
 * escribirle a otro el mensaje que quiera en una pantalla de su cuenta.
 */
export async function confirmarQueSoyYo(datos: FormData): Promise<void> {
  const perfil = await requireProfile();

  const clave = String(datos.get('clave') ?? '');
  const escrito = String(datos.get('escrito') ?? '');

  const resultado = await confirmarSoyYo({
    profileId: perfil.profileId,
    clave,
    nombreEscrito: escrito,
  });

  if (!resultado.ok) {
    redirect(
      `/alta?q=${encodeURIComponent(escrito)}&fallo=${resultado.motivo}`,
    );
  }

  // Una ficha nueva cambia media aplicación: el mismo barrido de rutas que el
  // alta por licencia, y por el mismo motivo.
  for (const ruta of ['/alta', '/', '/estado', '/ranking', '/perfil']) {
    revalidatePath(ruta);
  }

  redirect('/alta?hecha=1');
}
