'use client';

import { useSyncExternalStore } from 'react';

/**
 * Pestaña de las rutas neutras (una persona, una edición, un país), que se
 * quedan en la pestaña desde la que se abrieron, como en Instagram: un perfil
 * abierto desde Buscar sigue en Buscar y la brújula no se lo queda.
 *
 * - Al llegar a una ruta neutra con un enlace, hereda la pestaña de la
 *   pantalla anterior (`ultima`, la última confirmada).
 * - Al volver a ella por el historial (atrás, gesto de borde), o al recargar,
 *   manda lo que se anotó para esa ruta (`sessionStorage`).
 * - Abierta con un enlace directo, sin nada anotado, no hereda nada.
 *
 * Se lee durante el render: la decisión es de la navegación que se está
 * pintando, no un dato que cambie solo. En el servidor y al hidratar no se
 * hereda nada (`useHerenciaLista`), así que el HTML coincide; la barra
 * comprueba al guardar (`pestanaQueRecuerda`) con los datos ya leídos.
 */

const CLAVE = 'sistema:pestana-de-ruta';
const MAXIMO = 200;

let ultima: { ruta: string; clave: string } | null = null;
let porHistorial = false;
let anotadas: Record<string, string> | null = null;

if (typeof window !== 'undefined') {
  // Llega antes de que el router pinte la ruta a la que se vuelve.
  window.addEventListener('popstate', () => {
    porHistorial = true;
  });
}

function leer(): Record<string, string> {
  if (anotadas) return anotadas;
  try {
    const v: unknown = JSON.parse(window.sessionStorage.getItem(CLAVE) ?? '{}');
    anotadas = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    anotadas = {};
  }
  return anotadas;
}

/** La pestaña de una ruta neutra, o `null` para que decida su prefijo. */
export function pestanaHeredada(ruta: string, esNeutra: boolean): string | null {
  if (!esNeutra || typeof window === 'undefined') return null;
  const recien = ultima && ultima.ruta !== ruta && !porHistorial ? ultima.clave : null;
  return recien ?? leer()[ruta] ?? null;
}

/** Sólo lo anotado (para mirar entradas del historial que no son la actual). */
export function pestanaAnotada(ruta: string): string | null {
  return typeof window === 'undefined' ? null : (leer()[ruta] ?? null);
}

/** La pantalla ya pintada y su pestaña: lo que heredará la siguiente ruta neutra. */
export function confirmarPestana(ruta: string, clave: string | null, esNeutra: boolean): void {
  porHistorial = false;
  if (!clave) return;
  ultima = { ruta, clave };
  if (!esNeutra) return;
  const previas = leer();
  if (previas[ruta] === clave) return;
  const claves = Object.keys(previas);
  // Lo más antiguo sale primero: la sesión de una tarde no llena el almacenamiento.
  const recortadas = claves.length >= MAXIMO ? Object.fromEntries(claves.slice(-MAXIMO + 1).map((k) => [k, previas[k]])) : previas;
  anotadas = { ...recortadas, [ruta]: clave };
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(anotadas));
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

const sinOyentes = () => () => {};

/**
 * `false` en el servidor y durante la hidratación, `true` después: quien pinte
 * con `pestanaHeredada` lo hace sólo con `true`, así el HTML del servidor (que
 * no sabe nada de la sesión del navegador) coincide y React repinta al acabar.
 */
export function useHerenciaLista(): boolean {
  return useSyncExternalStore(sinOyentes, () => true, () => false);
}

/** Sólo para las pruebas. */
export function reiniciarHerencia(): void {
  ultima = null;
  porHistorial = false;
  anotadas = null;
}
