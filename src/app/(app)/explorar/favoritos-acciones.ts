'use server';

import { revalidatePath } from 'next/cache';
import {
  consultarFavorito,
  guardarFavorito,
  listarFavoritos,
  quitarFavorito,
  type ResultadoFavorito,
} from '@/lib/sport/explorar/favoritos';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';

/**
 * Acciones de servidor de favoritos. La cuenta sale siempre de la sesión
 * vigente dentro de cada función (antes de validar o tocar datos); la entrada
 * sólo puede nombrar a la persona deportiva. Guardar y quitar son idempotentes
 * y no generan avisos ni permisos.
 */

/**
 * Tras un cambio efectivo se invalida la lista: el router del cliente reutiliza
 * las páginas ya visitadas al pulsar Atrás, y sin esto la lista volvería con la
 * persona que se acaba de quitar desde su ficha (o sin la que se acaba de
 * guardar).
 */
function invalidarLista(r: ResultadoFavorito): ResultadoFavorito {
  if (r.estado === 'ok') {
    revalidatePath(RUTA_FAVORITOS);
    revalidatePath(RUTA_SIGUIENDO);
    revalidatePath(RUTA_EXPLORAR);
  }
  return r;
}

export async function guardarFavoritoAccion(entrada: unknown) {
  return invalidarLista(await guardarFavorito(contextoReal(), entrada));
}

export async function quitarFavoritoAccion(entrada: unknown) {
  return invalidarLista(await quitarFavorito(contextoReal(), entrada));
}

export async function consultarFavoritoAccion(entrada: unknown) {
  return consultarFavorito(contextoReal(), entrada);
}

export async function listarFavoritosAccion(entrada: unknown) {
  return listarFavoritos(contextoReal(), entrada);
}
