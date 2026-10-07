/**
 * Guarda de la caché compartida: lo que se guarda lo verá cualquier cuenta,
 * así que un valor con datos de la cuenta que mira (quién es, a quién sigue,
 * cuáles son «sus» tiradores) no se guarda nunca.
 *
 * Es la red de seguridad, no el diseño: el diseño es que el cargador cacheado
 * no recibe la sesión (sólo parámetros públicos) y que lo personal se añade
 * DESPUÉS de leer de la caché, en la petición. Esto atrapa el error de pasar
 * por la caché un DTO que ya venía marcado para alguien.
 */
export const CLAVES_DE_CUENTA: readonly string[] = [
  // Identidad y credenciales de la cuenta.
  'email', 'correo', 'profileId', 'userProfileId', 'guardianProfileId', 'authUserId',
  'icalToken', 'token', 'cookie', 'sesion', 'session', 'consentSignedAt', 'preview', 'qa',
  // Relación de la cuenta con lo que mira. `mios` NO está: en cara a cara y
  // relevos son los tocados de la persona de la ficha, no de la cuenta.
  'favorito', 'esFavorito', 'siguiendo', 'sigues', 'seguida', 'esMio',
  'misPersonas', 'misTiradores', 'propios', 'athleteIdsPropios', 'inscripciones',
];

/** Ruta de la primera clave de cuenta que aparezca en `valor`, o `null`. */
export function buscarDatoDeCuenta(
  valor: unknown,
  prohibidas: readonly string[] = CLAVES_DE_CUENTA,
  ruta = '$',
  vistos = new Set<object>(),
): string | null {
  if (!valor || typeof valor !== 'object') return null;
  if (vistos.has(valor)) return null;
  vistos.add(valor);
  if (valor instanceof Map) {
    for (const [k, v] of valor) {
      if (typeof k === 'string' && prohibidas.includes(k)) return `${ruta}.${k}`;
      const r = buscarDatoDeCuenta(v, prohibidas, `${ruta}.${String(k)}`, vistos);
      if (r) return r;
    }
    return null;
  }
  if (valor instanceof Set || Array.isArray(valor)) {
    let i = 0;
    for (const v of valor) {
      const r = buscarDatoDeCuenta(v, prohibidas, `${ruta}[${i++}]`, vistos);
      if (r) return r;
    }
    return null;
  }
  if (valor instanceof Date) return null;
  for (const [k, v] of Object.entries(valor)) {
    if (prohibidas.includes(k)) return `${ruta}.${k}`;
    const r = buscarDatoDeCuenta(v, prohibidas, `${ruta}.${k}`, vistos);
    if (r) return r;
  }
  return null;
}
