/**
 * Botones compactos del perfil: se ven de 32 px pero el área táctil es de
 * 44 px, con un pseudoelemento invisible centrado sobre el botón. Necesita un
 * elemento posicionable (`relative`) y que nada lo recorte. Todo en px: la
 * raíz de 18 px del móvil (y el texto grande) agrandaría una medida en rem.
 */
export const TACTIL = "relative after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-[44px] after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

/** Pastilla de acción de la cabecera: 32 px de alto a la vista, iconos de 16 px. */
export const ACCION_COMPACTA = `${TACTIL} h-[32px] min-h-[32px] gap-[6px] rounded-full px-[12px] text-[13px] [&_svg]:size-[16px]`;
