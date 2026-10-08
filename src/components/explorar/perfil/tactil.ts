/**
 * Botones compactos del perfil: se ven de 32 px pero el área táctil es de
 * 44 px, con un pseudoelemento invisible centrado sobre el botón. Necesita un
 * elemento posicionable (`relative`) y que nada lo recorte. Para lo nuevo,
 * `AREA_TACTIL` de `sistema/tactil` hace lo mismo.
 */
export const TACTIL = "relative after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";
