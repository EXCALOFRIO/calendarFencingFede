'use client';

/** Sólo trabajo especulativo; las acciones explícitas nunca se bloquean. */
export function ahorrarDatos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const red = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return navigator.onLine === false || Boolean(red?.saveData) ||
    red?.effectiveType === 'slow-2g' || red?.effectiveType === '2g';
}
