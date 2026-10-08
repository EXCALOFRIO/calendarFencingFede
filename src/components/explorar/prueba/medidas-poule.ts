/**
 * Anchos de la tarjeta de poule, en px. La tarjeta es un contenedor CSS
 * (`@container`) y las casillas de los asaltos se reparten su ancho real con
 * `clamp()` sobre `cqw`: a 360 px la matriz cabe entera sin desplazar nada y,
 * en pantallas más anchas, lo que sobra va al nombre. Sin imports de React:
 * se prueba sola.
 */

/** Tarjeta a 360 px: página con 16 px por lado y 1 px de borde por lado. */
export const ANCHO_TARJETA_360 = 360 - 2 * 16 - 2;

/** Desde este ancho de tarjeta la matriz y el resumen van juntos, sin girar. */
export const ANCHO_AMPLIO = 480;

/** Relleno lateral de las filas (8 px por lado). */
const RELLENO = 16;
const PUESTO = 20;
const VICTORIAS = 24;
/** TD, TR e índice. */
const TOTALES = [28, 28, 32] as const;
const ANCHO_TOTALES = TOTALES.reduce((s, t) => s + t, 0);
/** Lo mínimo que se reserva al nombre compacto («Salcedo M.»). */
export const NOMBRE_MIN = 66;
const NOMBRE_MIN_AMPLIO = 120;

export const CASILLA_MAX = 30;
/** Por debajo de esto se recorta el nombre, nunca se desplaza la tarjeta. */
export const CASILLA_MIN = 14;
/** «V5» en `text-xs` necesita unos 15 px; con menos casilla sólo va el número. */
const CASILLA_CON_LETRA = 20;

const FIJOS_ESTRECHO = RELLENO + PUESTO + VICTORIAS + NOMBRE_MIN;
const FIJOS_AMPLIO = RELLENO + PUESTO + VICTORIAS + ANCHO_TOTALES + NOMBRE_MIN_AMPLIO;

const limitar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Ancho de casilla (px) de una poule de `n` en una tarjeta estrecha de `ancho` px. */
export function casillaEstrecha(n: number, ancho: number = ANCHO_TARJETA_360): number {
  if (n <= 0) return CASILLA_MAX;
  return limitar((ancho - FIJOS_ESTRECHO) / n, CASILLA_MIN, CASILLA_MAX);
}

/** Lo que queda para el nombre con las casillas de `casillaEstrecha`. */
export function nombreEstrecho(n: number, ancho: number = ANCHO_TARJETA_360): number {
  return ancho - RELLENO - PUESTO - VICTORIAS - n * casillaEstrecha(n, ancho);
}

/** Si «V5» / «D3» cabe en la casilla de 360 px; si no, sólo el número (y el color). */
export function conLetra(n: number): boolean {
  return casillaEstrecha(n) >= CASILLA_CON_LETRA;
}

const casillaCss = (n: number, fijos: number, min: number, max: number) =>
  `clamp(${min}px, calc((100cqw - ${fijos}px) / ${n}), ${max}px)`;

const RESUMEN = `${PUESTO}px minmax(0,1fr) ${VICTORIAS}px ${TOTALES.map((t) => `${t}px`).join(' ')}`;

/**
 * Plantillas de columnas de las filas de una poule de `n`:
 *  - `resumen`: puesto, nombre, V, TD, TR, índice.
 *  - `asaltos`: número, nombre, una casilla por rival y V.
 *  - `amplia`: todo junto (con `matriz` falsa, el resumen: aún no hay casillas).
 */
export function columnasPoule(n: number, matriz: boolean): { resumen: string; asaltos: string; amplia: string } {
  const asaltos = `${PUESTO}px minmax(0,1fr) repeat(${n}, ${casillaCss(n, FIJOS_ESTRECHO, CASILLA_MIN, CASILLA_MAX)}) ${VICTORIAS}px`;
  const amplia = matriz
    ? `${PUESTO}px minmax(0,1fr) repeat(${n}, ${casillaCss(n, FIJOS_AMPLIO, 20, 32)}) ${VICTORIAS}px ${TOTALES.map((t) => `${t}px`).join(' ')}`
    : RESUMEN;
  return { resumen: RESUMEN, asaltos, amplia };
}

/** Ancho mínimo que ocupan las columnas fijas y las casillas (sin el nombre). */
export function anchoSinNombre(n: number, ancho: number = ANCHO_TARJETA_360): number {
  return RELLENO + PUESTO + VICTORIAS + n * casillaEstrecha(n, ancho);
}

/** Alto estimado de la tarjeta para `contain-intrinsic-size`: cabecera, rótulos y una fila de 44 px por tirador. */
export function altoPoule(n: number): number {
  return 44 + 24 + n * 44;
}
