/**
 * Una misma persona dos veces en la lista de una prueba, sólo en pantalla.
 *
 * En las Copas del Mundo la RFEE republica en Skermo la lista de la FIE: la
 * fila de la FIE llega enlazada a su ficha deportiva y la de Skermo, con el
 * nombre escrito de otra forma y sin identificador. Las identidades no se
 * funden (eso lo decide la unión de listas con pruebas, no un parecido de
 * nombre); aquí sólo se deja de pintar la copia:
 *
 *   dentro de la misma prueba, una fila SIN persona ni marca de «mía», que no
 *   es un equipo y cuyo nombre normalizado (sin tildes, mayúsculas ni orden
 *   de las palabras) es el de UNA SOLA fila enlazada (o lo contiene con el
 *   segundo apellido de más, `mismoNombre`), se oculta.
 *
 * Con dos fichas enlazadas del mismo nombre no se oculta nada: no se sabe de
 * cuál es la copia.
 */

type Fila = {
  competitionId: string;
  nombre: string;
  equipo?: string | null;
  esMio?: boolean;
  personaId?: string | null;
};

/** «GARCÍA PÉREZ, Ana» y «Ana Garcia Perez» → «ana garcia perez». */
export function nombreComparable(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * ¿Es el mismo nombre? Iguales, o el de la FIE (que publica un solo apellido:
 * «ROMAN Adrian») contenido en el de Skermo («ADRIÁN ROMÁN BLANQUE») con dos
 * palabras al menos y una o dos de más, que es el segundo apellido.
 */
export function mismoNombre(enlazado: string, suelto: string): boolean {
  if (!enlazado || !suelto) return false;
  if (enlazado === suelto) return true;
  const a = enlazado.split(' ');
  const b = suelto.split(' ');
  if (a.length < 2 || b.length - a.length < 1 || b.length - a.length > 2) return false;
  const quedan = [...b];
  for (const p of a) {
    const i = quedan.indexOf(p);
    if (i === -1) return false;
    quedan.splice(i, 1);
  }
  return true;
}

export function sinDuplicadosEnPantalla<T extends Fila>(filas: readonly T[]): T[] {
  const enlazadas = new Map<string, string[]>();
  for (const f of filas) {
    if (!f.personaId || f.equipo) continue;
    enlazadas.set(f.competitionId, [...(enlazadas.get(f.competitionId) ?? []), nombreComparable(f.nombre)]);
  }
  if (enlazadas.size === 0) return [...filas];
  return filas.filter((f) => {
    if (f.personaId || f.esMio || f.equipo) return true;
    const nombre = nombreComparable(f.nombre);
    const candidatas = (enlazadas.get(f.competitionId) ?? []).filter((e) => mismoNombre(e, nombre));
    return candidatas.length !== 1;
  });
}
