'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { CLAVE_RECORDADAS } from './navegacion';

/**
 * Última URL de cada pestaña, compartida por la barra del móvil y la del
 * escritorio (las dos están montadas a la vez y una se oculta por CSS). Vive
 * en `sessionStorage`: sobrevive a recargar, no a cerrar la pestaña.
 *
 * En el servidor y durante la hidratación vale `{}`, así que el HTML siempre
 * apunta a las raíces y no hay desajuste de hidratación.
 */
type Recordadas = Readonly<Record<string, string>>;

const VACIAS: Recordadas = Object.freeze({});
let actuales: Recordadas | null = null;
const oyentes = new Set<() => void>();

function leer(): Recordadas {
  if (actuales) return actuales;
  try {
    const leido: unknown = JSON.parse(window.sessionStorage.getItem(CLAVE_RECORDADAS) ?? '{}');
    actuales = leido && typeof leido === 'object' && !Array.isArray(leido) ? (leido as Recordadas) : VACIAS;
  } catch {
    // Sin almacenamiento (modo privado estricto): cada pestaña abre su raíz.
    actuales = VACIAS;
  }
  return actuales;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function recordarPestana(clave: string, url: string): void {
  const previas = leer();
  if (previas[clave] === url) return;
  actuales = { ...previas, [clave]: url };
  try {
    window.sessionStorage.setItem(CLAVE_RECORDADAS, JSON.stringify(actuales));
  } catch {
    // Se pierde el recuerdo entre recargas, no la navegación.
  }
  for (const o of oyentes) o();
}

export function useRecordadas(): [Recordadas, (clave: string, url: string) => void] {
  const recordadas = useSyncExternalStore(suscribir, leer, () => VACIAS);
  const guardar = useCallback((clave: string, url: string) => recordarPestana(clave, url), []);
  return [recordadas, guardar];
}

export function urlActual(): string {
  return `${window.location.pathname}${window.location.search}`;
}
