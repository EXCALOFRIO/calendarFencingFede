import { aBase64url, concatenar, deBase64url, utf8 } from './base64url';

/**
 * Cifrado de un mensaje Web Push: RFC 8291 sobre la codificación `aes128gcm`
 * de RFC 8188. Solo WebCrypto (`crypto.subtle`), que es lo que hay en un
 * Worker de Cloudflare y también en Node: nada de `node:crypto`.
 *
 * Un único registro, como exige RFC 8291 §4, con `rs` = 4096.
 */

const CURVA = { name: 'ECDH', namedCurve: 'P-256' } as const;
const RS = 4096;
/** Cabecera (86) + delimitador (1) + etiqueta GCM (16) dentro de 4096 octetos (RFC 8291 §4). */
export const MAX_TEXTO_PUSH = 3993;

export type ClavesSuscripcion = {
  /** Clave pública del navegador, punto P-256 sin comprimir en base64url. */
  p256dh: string;
  /** Secreto de autenticación de 16 octetos en base64url. */
  auth: string;
};

/** Par ECDH del servidor para un mensaje. Solo se fija en las pruebas con los vectores del RFC. */
export type ParServidor = { publica: Uint8Array<ArrayBuffer>; privada: CryptoKey };

export type OpcionesCifrado = {
  salt?: Uint8Array<ArrayBuffer>;
  servidor?: ParServidor;
  /** Octetos de relleno con cero tras el delimitador; ocultan la longitud. */
  relleno?: number;
};

async function hmac(clave: Uint8Array<ArrayBuffer>, datos: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, datos));
}

const UNO = new Uint8Array([1]);
const CERO = new Uint8Array([0]);

export type ClavesDerivadas = {
  ecdh: Uint8Array<ArrayBuffer>;
  prkClave: Uint8Array<ArrayBuffer>;
  ikm: Uint8Array<ArrayBuffer>;
  prk: Uint8Array<ArrayBuffer>;
  cek: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
};

/** RFC 8291 §3.4 paso a paso, expuesto para comprobar cada valor intermedio del apéndice A. */
export async function derivarClaves(
  ecdh: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
  uaPublica: Uint8Array<ArrayBuffer>,
  asPublica: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<ClavesDerivadas> {
  const prkClave = await hmac(auth, ecdh);
  const info = concatenar(utf8('WebPush: info'), CERO, uaPublica, asPublica);
  const ikm = await hmac(prkClave, concatenar(info, UNO));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concatenar(utf8('Content-Encoding: aes128gcm'), CERO, UNO))).slice(0, 16);
  const nonce = (await hmac(prk, concatenar(utf8('Content-Encoding: nonce'), CERO, UNO))).slice(0, 12);
  return { ecdh, prkClave, ikm, prk, cek, nonce };
}

export async function importarPublicaNavegador(p256dh: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; clave: CryptoKey }> {
  const bytes = deBase64url(p256dh);
  if (bytes.length !== 65 || bytes[0] !== 0x04) throw new Error('p256dh no es un punto P-256 sin comprimir');
  // importKey valida que el punto está en la curva (RFC 8291 §7).
  const clave = await crypto.subtle.importKey('raw', bytes, CURVA, false, []);
  return { bytes, clave };
}

export async function generarParServidor(): Promise<ParServidor> {
  const par = (await crypto.subtle.generateKey(CURVA, true, ['deriveBits'])) as CryptoKeyPair;
  return { publica: new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey)), privada: par.privateKey };
}

/** Cuerpo `aes128gcm` listo para el POST al servicio de push. */
export async function cifrarMensajePush(
  texto: Uint8Array<ArrayBuffer>,
  claves: ClavesSuscripcion,
  opciones: OpcionesCifrado = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const relleno = opciones.relleno ?? 0;
  if (texto.length + relleno > MAX_TEXTO_PUSH) throw new Error('mensaje push demasiado largo');
  const auth = deBase64url(claves.auth);
  if (auth.length !== 16) throw new Error('auth no tiene 16 octetos');
  const navegador = await importarPublicaNavegador(claves.p256dh);
  const servidor = opciones.servidor ?? (await generarParServidor());
  const salt = opciones.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('salt no tiene 16 octetos');

  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: navegador.clave }, servidor.privada, 256));
  const { cek, nonce } = await derivarClaves(ecdh, auth, navegador.bytes, servidor.publica, salt);

  const registro = concatenar(texto, new Uint8Array([2]), new Uint8Array(relleno));
  const clave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, clave, registro));

  const cabecera = new Uint8Array(16 + 4 + 1 + servidor.publica.length);
  cabecera.set(salt, 0);
  new DataView(cabecera.buffer).setUint32(16, RS, false);
  cabecera[20] = servidor.publica.length;
  cabecera.set(servidor.publica, 21);
  return concatenar(cabecera, cifrado);
}

/**
 * El camino inverso, del lado del navegador. Solo lo usan las pruebas, para
 * comprobar que lo que sale de `cifrarMensajePush` lo abre el receptor.
 */
export async function descifrarMensajePush(
  cuerpo: Uint8Array<ArrayBuffer>,
  uaPrivada: CryptoKey,
  uaPublica: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = cuerpo.slice(0, 16);
  const largo = cuerpo[20];
  const asPublica = cuerpo.slice(21, 21 + largo);
  const asClave = await crypto.subtle.importKey('raw', asPublica, CURVA, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asClave }, uaPrivada, 256));
  const { cek, nonce } = await derivarClaves(ecdh, auth, uaPublica, asPublica, salt);
  const clave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const registro = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, clave, cuerpo.slice(21 + largo)));
  let fin = registro.length - 1;
  while (fin >= 0 && registro[fin] === 0) fin--;
  if (registro[fin] !== 2) throw new Error('delimitador de relleno no válido');
  return registro.slice(0, fin);
}

/** Clave privada ECDH P-256 desde `d` y la pública sin comprimir (para fijar el par en las pruebas). */
export async function importarPrivadaEcdh(d: string, publica: Uint8Array<ArrayBuffer>, uso: 'deriveBits'[] = ['deriveBits']): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwkPrivada(d, publica), CURVA, false, uso);
}

export function jwkPrivada(d: string, publica: Uint8Array<ArrayBuffer>): JsonWebKey {
  if (publica.length !== 65 || publica[0] !== 0x04) throw new Error('clave pública P-256 no válida');
  return { kty: 'EC', crv: 'P-256', d, x: aBase64url(publica.slice(1, 33)), y: aBase64url(publica.slice(33, 65)), ext: false };
}
