/**
 * Con sólo el año de nacimiento no se puede demostrar la mayoría de edad: quien
 * cumple 18 este mismo año podría seguir siendo menor. Se trata como menor a
 * todo el que cumple 18 o menos este año.
 */
export function posibleMenor(anioNacimiento: number | null, hoy: string): boolean {
  if (anioNacimiento === null) return false;
  return Number(hoy.slice(0, 4)) - anioNacimiento <= 18;
}

/**
 * El año de nacimiento que puede salir hacia el cliente en listas (búsqueda,
 * favoritos, homónimos): `null` si falta, no es un año válido o la persona
 * puede ser menor.
 */
export function anioNacimientoPublico(valor: unknown, hoy: string): number | null {
  if (valor === null || valor === undefined) return null;
  const anio = Number(valor);
  if (!Number.isInteger(anio) || !Number.isInteger(Number(hoy.slice(0, 4)))) return null;
  return posibleMenor(anio, hoy) ? null : anio;
}
