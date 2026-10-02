import { z } from 'zod';

/**
 * Cursores de paginación por clave (keyset) ligados a la consulta que los
 * emitió.
 *
 * El cursor lleva una huella de la clase de consulta y de sus filtros
 * normalizados. Si llega con otros filtros (o de otra clase de lista, o de
 * otra persona) se rechaza en lugar de saltar a una posición sin sentido: así
 * cambiar un filtro obliga a empezar de la primera página y un cursor copiado
 * de otra búsqueda no reutiliza su posición. La huella no es un secreto ni
 * autentica nada: la clave de posición sólo acota la misma consulta ya
 * autorizada.
 */

export type ClaveCursor = readonly (string | number)[];

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, ordenar(v)]),
    );
  }
  return valor;
}

/** cyrb53: determinista, sin dependencias de entorno (Node y Workers). */
function cyrb53(texto: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function huellaConsulta(clase: string, filtros: unknown): string {
  return cyrb53(JSON.stringify([clase, ordenar(filtros)]));
}

function aBase64Url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto: string): string {
  const base = texto.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
}

const forma = z.object({
  v: z.literal(1),
  h: z.string().max(32),
  k: z.array(z.union([z.string().max(300), z.number()])).max(4),
});

export function codificarCursor(clase: string, filtros: unknown, clave: ClaveCursor): string {
  return aBase64Url(JSON.stringify({ v: 1, h: huellaConsulta(clase, filtros), k: clave }));
}

/** `null` = cursor ilegible o emitido para otra consulta. */
export function decodificarCursor(
  clase: string,
  filtros: unknown,
  cursor: string,
  longitud: number,
): ClaveCursor | null {
  try {
    const analizado = forma.safeParse(JSON.parse(deBase64Url(cursor)));
    if (!analizado.success) return null;
    if (analizado.data.h !== huellaConsulta(clase, filtros)) return null;
    return analizado.data.k.length === longitud ? analizado.data.k : null;
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
