'use server';

import {
  consultarFavorito,
  guardarFavorito,
  listarFavoritos,
  quitarFavorito,
} from '@/lib/sport/explorar/favoritos';
import { contextoReal } from '@/lib/sport/explorar/real';

/**
 * Acciones de servidor de favoritos. La cuenta sale siempre de la sesión
 * vigente dentro de cada función (antes de validar o tocar datos); la entrada
 * sólo puede nombrar a la persona deportiva. Guardar y quitar son idempotentes
 * y no generan avisos ni permisos.
 */

export async function guardarFavoritoAccion(entrada: unknown) {
  return guardarFavorito(contextoReal(), entrada);
}

export async function quitarFavoritoAccion(entrada: unknown) {
  return quitarFavorito(contextoReal(), entrada);
}

export async function consultarFavoritoAccion(entrada: unknown) {
  return consultarFavorito(contextoReal(), entrada);
}

export async function listarFavoritosAccion(entrada: unknown) {
  return listarFavoritos(contextoReal(), entrada);
}
