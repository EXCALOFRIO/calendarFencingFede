/**
 * Nombre para mostrar a partir de cualquier forma publicada.
 *
 * Las fuentes escriben el mismo nombre de tres maneras:
 *   FIE / PDF Engarde   «PEREZ GARCIA Juan»     apellidos en MAYÚSCULAS, nombre después
 *   Skermo / RFEE       «JUAN PEREZ GARCIA»     todo en mayúsculas, nombre primero
 *   A mano              «Juan Pérez García»
 * Se devuelve siempre «Nombre Apellidos» en formato título, sin inventar
 * acentos que la fuente no publicó.
 */

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'da', 'do', 'dos', 'di', 'van', 'von', 'der', 'den', 'du', 'le']);

function esMayusculas(palabra: string): boolean {
  return /\p{L}/u.test(palabra) && palabra === palabra.toLocaleUpperCase('es') && palabra !== palabra.toLocaleLowerCase('es');
}

function capitalizar(palabra: string, primera: boolean): string {
  const minus = palabra.toLocaleLowerCase('es');
  if (!primera && PARTICULAS.has(minus)) return minus;
  return minus.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toLocaleUpperCase('es'));
}

/** Separa «APELLIDOS Nombre» cuando la fuente marca los apellidos con mayúsculas. */
export function partesNombre(publicado: string): { nombre: string; apellidos: string } {
  const palabras = publicado.trim().split(/\s+/).filter(Boolean);
  const mayus = palabras.map(esMayusculas);
  const todasMayus = mayus.every(Boolean);
  const primeraMinus = mayus.indexOf(false);
  if (!todasMayus && primeraMinus > 0 && mayus.slice(primeraMinus).every((m) => !m)) {
    return { nombre: palabras.slice(primeraMinus).join(' '), apellidos: palabras.slice(0, primeraMinus).join(' ') };
  }
  return { nombre: '', apellidos: palabras.join(' ') };
}

export function nombreVisible(publicado: string | null | undefined): string {
  if (!publicado) return '';
  const { nombre, apellidos } = partesNombre(publicado);
  const ordenado = [nombre, apellidos].filter(Boolean).join(' ');
  const palabras = ordenado.split(/\s+/).filter(Boolean);
  const yaEnTitulo = !palabras.some(esMayusculas);
  if (yaEnTitulo) return palabras.join(' ');
  return palabras.map((p, i) => capitalizar(p, i === 0)).join(' ');
}

/** Partículas que van delante del primer apellido y forman parte de él («De la Fuente», «San Martin»). */
const PREFIJOS_APELLIDO = new Set([...PARTICULAS, 'san', 'santa']);

/**
 * Formato compacto común para donde no cabe el nombre entero (poules, cuadro):
 * primer apellido con sus partículas y la inicial del nombre, «Zabala J.» de
 * «ZABALA GUTIERREZ Juan». Si la fuente no separa apellidos y nombre
 * («JUAN PEREZ GARCIA») no se sabe cuál es el apellido y va el nombre visible
 * entero: mejor largo que equivocado.
 */
export function nombreCompacto(publicado: string | null | undefined): string {
  if (!publicado) return '';
  const { nombre, apellidos } = partesNombre(publicado);
  if (!nombre || !apellidos) return nombreVisible(publicado);
  const palabras = nombreVisible(apellidos).split(' ');
  const fin = palabras.findIndex((p) => !PREFIJOS_APELLIDO.has(p.toLocaleLowerCase('es')));
  const apellido = palabras.slice(0, fin < 0 ? palabras.length : fin + 1).join(' ');
  return `${apellido} ${nombre.charAt(0).toLocaleUpperCase('es')}.`;
}

/** Iniciales para el avatar: primera letra del nombre y del primer apellido. */
export function inicialesVisibles(publicado: string | null | undefined): string {
  const palabras = nombreVisible(publicado).split(' ').filter((p) => !PARTICULAS.has(p.toLocaleLowerCase('es')));
  return palabras.slice(0, 2).map((p) => p.charAt(0).toLocaleUpperCase('es')).join('');
}
