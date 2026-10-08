'use client';

type Conexion = { saveData?: boolean; effectiveType?: string };

function conexion(): Conexion | undefined {
  return (navigator as Navigator & { connection?: Conexion }).connection;
}

/** Sólo trabajo especulativo; las acciones explícitas nunca se bloquean. */
export function ahorrarDatos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const red = conexion();
  return navigator.onLine === false || Boolean(red?.saveData) ||
    red?.effectiveType === 'slow-2g' || red?.effectiveType === '2g';
}

/**
 * Red declarada como 4G y sin ahorro de datos: el único caso en que se
 * precarga algo que nadie ha pedido todavía. Sin la Network Information API
 * (Safari, Firefox) no se sabe, y la respuesta es no.
 */
export function redHolgada(): boolean {
  if (typeof navigator === 'undefined' || navigator.onLine === false) return false;
  const red = conexion();
  return red?.effectiveType === '4g' && !red.saveData;
}
