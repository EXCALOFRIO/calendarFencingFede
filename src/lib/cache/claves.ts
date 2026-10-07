/**
 * Claves de la caché compartida.
 *
 * Una clave es `espacio/e<ESQUEMA>/<versión>/<partes>`. La versión sale de
 * las épocas de datos (ver `versiones.ts`): cuando la ingesta escribe, la
 * versión cambia y las entradas viejas dejan de encontrarse, en todos los
 * centros de datos a la vez, sin tener que borrarlas (la Cache API sólo borra
 * en el centro de datos que lo pide).
 *
 * Las partes sólo pueden ser escalares, y nunca deben ser datos de la cuenta
 * que mira: la caché es común a todas las cuentas.
 */

/** Súbelo para descartar todas las entradas si cambia el formato de `Entrada`. */
export const ESQUEMA_CACHE = 1;

export type ParteClave = string | number | boolean | null;

const ESPACIO_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** KV admite claves de 512 bytes; se deja sitio para el prefijo. */
const MAX_CLAVE = 400;
const MAX_PARTE = 300;

export function validarEspacio(espacio: string): string {
  if (!ESPACIO_RE.test(espacio)) throw new RangeError(`Espacio de caché no válido: "${espacio}"`);
  return espacio;
}

function parte(p: ParteClave): string {
  if (p === null) return '~';
  if (typeof p === 'boolean') return p ? '1' : '0';
  if (typeof p === 'number') {
    if (!Number.isFinite(p)) throw new RangeError('Parte de clave numérica no finita.');
    return `n${p}`;
  }
  if (typeof p !== 'string') throw new TypeError('Las partes de una clave de caché son escalares.');
  if (p.length > MAX_PARTE) throw new RangeError('Parte de clave de caché demasiado larga.');
  return `s${encodeURIComponent(p)}`;
}

/** FNV-1a de 64 bits en hexadecimal: sólo acorta claves largas; la entrada guarda la clave entera. */
export function resumen64(texto: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < texto.length; i++) {
    h ^= BigInt(texto.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export type Clave = {
  /** Lo que se usa en el almacén (corta). */
  id: string;
  /** La clave completa; se guarda en la entrada y se compara al leer, así un choque del resumen nunca sirve datos ajenos. */
  completa: string;
};

export function claveCache(espacio: string, version: string, partes: readonly ParteClave[]): Clave {
  validarEspacio(espacio);
  if (!/^[\w.:-]{1,80}$/.test(version)) throw new RangeError(`Versión de caché no válida: "${version}"`);
  const completa = `${espacio}/e${ESQUEMA_CACHE}/${version}/${partes.map(parte).join('/')}`;
  const id = completa.length <= MAX_CLAVE ? completa : `${espacio}/e${ESQUEMA_CACHE}/${version}/h${resumen64(completa)}`;
  return { id, completa };
}
