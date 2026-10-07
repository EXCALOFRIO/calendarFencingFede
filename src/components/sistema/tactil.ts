/**
 * Clases compartidas por las piezas del sistema (ver `docs/diseno-sistema.md`).
 *
 * El control se ve de 28-36 px y se toca en 44: el área sobrante es un
 * `::after` transparente centrado en el control, así que no ocupa sitio en
 * la maqueta. El pseudoelemento se recorta si un antepasado tiene
 * `overflow` distinto de `visible`; por eso `FilaChips` deja 6 px de margen
 * vertical dentro de su zona desplazable.
 *
 * Las medidas van en px: por debajo de 640 px la raíz son 18 px y cualquier
 * medida en rem crecería un 12,5 %.
 */

/**
 * Anula la regla global de `globals.css` que fuerza 44 px de alto y ancho en
 * todo `button`. Esa regla vive fuera de las capas de Tailwind y gana a
 * cualquier utilidad normal; sólo una utilidad `!important` la vence. Cuando
 * se aplique el parche de `docs/diseno-sistema.md` § 8 esto deja de hacer
 * falta, pero tampoco estorba.
 */
export const SIN_MINIMO = 'min-h-0! min-w-0!';

export const AREA_TACTIL =
  "relative after:absolute after:top-1/2 after:left-1/2 after:h-[max(100%,44px)] after:w-[max(100%,44px)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

export const FOCO =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Respuesta al toque: un 4 % más pequeño mientras se pulsa, sin velo gris de iOS. */
export const PULSACION =
  '[-webkit-tap-highlight-color:transparent] transition-[scale,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.96]';

/** Escala de tamaños visibles del sistema, en px. */
export const MEDIDAS = {
  control: { sm: 28, md: 32, lg: 36 },
  icono: { sm: 18, md: 20, lg: 20, barra: 22 },
  tactil: 44,
  barra: 50,
  cabecera: 48,
} as const;
