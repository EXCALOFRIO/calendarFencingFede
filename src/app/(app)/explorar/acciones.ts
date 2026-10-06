'use server';

import { buscarDeportistas } from '@/lib/sport/explorar/busqueda';
import { leerCaraACara, listarRivales } from '@/lib/sport/explorar/cara-a-cara';
import { leerFicha, leerHistorial } from '@/lib/sport/explorar/ficha';
import { cargarPaginaExplorar } from '@/lib/sport/explorar/pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';

/**
 * Acciones de servidor del explorador deportivo.
 *
 * Cada una es un endpoint invocable por cualquiera: la guarda de sesión vive
 * dentro de la lectura (`exigirPerfil`), antes de validar o consultar nada, y
 * la entrada se trata como desconocida. No reciben identificadores de cuenta ni
 * de ficha: la persona propia se resuelve en el servidor con la sesión. Las
 * respuestas son los DTO de `src/lib/sport/explorar`, construidos campo a
 * campo, sin ranking interno ni datos de cuenta.
 */

export async function buscarDeportistasAccion(entrada: unknown) {
  return buscarDeportistas(contextoReal(), entrada);
}

/** «Ver más» de la lista completa: la página siguiente, con «Seguir» de cada persona. */
export async function masDeportistasAccion(entrada: unknown) {
  return cargarPaginaExplorar(contextoReal(), entrada);
}

export async function leerFichaAccion(entrada: unknown) {
  return leerFicha(contextoReal(), entrada);
}

export async function leerHistorialAccion(entrada: unknown) {
  return leerHistorial(contextoReal(), entrada);
}

export async function leerCaraACaraAccion(entrada: unknown) {
  return leerCaraACara(contextoReal(), entrada);
}

export async function listarRivalesAccion(entrada: unknown) {
  return listarRivales(contextoReal(), entrada);
}
