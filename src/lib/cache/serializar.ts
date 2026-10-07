/**
 * JSON que conserva `Map`, `Set` y `Date`, que los cargadores devuelven (p. ej.
 * `leerCabeceras` da un `Map`). Cada lectura de la caché deserializa de nuevo,
 * así que dos peticiones nunca comparten el mismo objeto y una no puede
 * modificar lo que verá la otra.
 */
const TIPO = '__tipo_cache';

export function serializar(valor: unknown): string {
  return JSON.stringify(valor, function (this: Record<string, unknown>, clave, v) {
    const original = this[clave];
    if (original instanceof Date) return { [TIPO]: 'Date', v: original.getTime() };
    if (original instanceof Map) return { [TIPO]: 'Map', v: [...original.entries()] };
    if (original instanceof Set) return { [TIPO]: 'Set', v: [...original.values()] };
    if (typeof original === 'bigint') return { [TIPO]: 'BigInt', v: original.toString() };
    return v;
  });
}

export function deserializar<T>(texto: string): T {
  return JSON.parse(texto, (_clave, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v[TIPO] === 'string') {
      switch (v[TIPO]) {
        case 'Date': return new Date(v.v);
        case 'Map': return new Map(v.v);
        case 'Set': return new Set(v.v);
        case 'BigInt': return BigInt(v.v);
      }
    }
    return v;
  }) as T;
}
