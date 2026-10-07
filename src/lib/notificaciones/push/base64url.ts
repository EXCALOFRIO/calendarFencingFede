/** base64url sin relleno (RFC 4648 §5), que es como viajan claves y cuerpos de Web Push. */

export function aBase64url(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deBase64url(texto: string): Uint8Array<ArrayBuffer> {
  const limpio = texto.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*$/.test(limpio)) throw new Error('base64url no válido');
  const binario = atob(limpio + '='.repeat((4 - (limpio.length % 4)) % 4));
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

export function concatenar(...partes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const salida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let desplazamiento = 0;
  for (const p of partes) {
    salida.set(p, desplazamiento);
    desplazamiento += p.length;
  }
  return salida;
}

export const utf8 = (texto: string) => new TextEncoder().encode(texto);
