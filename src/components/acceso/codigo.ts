export const CIFRAS_CODIGO = 6;

/**
 * Sigue siendo texto: nunca convertir a número ni perder los ceros iniciales.
 * NFKC convierte las cifras de ancho completo (１２３) de algunos teclados
 * asiáticos y pegados en cifras normales en vez de borrarlas.
 */
export function limpiarCodigo(valor: string) {
  return valor.normalize('NFKC').replace(/[^0-9]/g, '').slice(0, CIFRAS_CODIGO);
}
