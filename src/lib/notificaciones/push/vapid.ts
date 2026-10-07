import { aBase64url, deBase64url, utf8 } from './base64url';
import { jwkPrivada } from './cifrado';

/**
 * Identificación del servidor ante el servicio de push: VAPID, RFC 8292.
 * Un JWT ES256 firmado con WebCrypto y la cabecera
 * `Authorization: vapid t=<jwt>, k=<clave pública>`.
 */

export type ClavesVapid = {
  /** Punto P-256 sin comprimir (65 octetos) en base64url. Es la `applicationServerKey`. */
  publica: string;
  /** Escalar privado `d` (32 octetos) en base64url. Secreto del Worker. */
  privada: string;
  /** `mailto:` o `https:`; Apple rechaza el JWT sin él. */
  asunto: string;
};

/** RFC 8292 §2: como mucho 24 h. Se firma para 12 h y se vuelve a firmar en cada pasada. */
const VIGENCIA_S = 12 * 3600;

export function leerClavesVapid(env: Record<string, string | undefined> = process.env): ClavesVapid | null {
  const publica = env.VAPID_PUBLIC_KEY?.trim();
  const privada = env.VAPID_PRIVATE_KEY?.trim();
  if (!publica || !privada) return null;
  const asunto = env.VAPID_SUBJECT?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || '';
  if (!/^(mailto:|https:\/\/)/.test(asunto)) return null;
  return { publica, privada, asunto };
}

export async function firmarJwtVapid(audiencia: string, claves: ClavesVapid, ahora: Date): Promise<string> {
  const publica = deBase64url(claves.publica);
  const clave = await crypto.subtle.importKey(
    'jwk', jwkPrivada(claves.privada, publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const cabecera = aBase64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = aBase64url(utf8(JSON.stringify({
    aud: audiencia,
    exp: Math.floor(ahora.getTime() / 1000) + VIGENCIA_S,
    sub: claves.asunto,
  })));
  const firmado = `${cabecera}.${cuerpo}`;
  // WebCrypto devuelve r||s (IEEE P1363), que es justo el formato JWS de ES256.
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, utf8(firmado)));
  return `${firmado}.${aBase64url(firma)}`;
}

/** La audiencia es el origen del servicio de push (esquema y host), nunca la ruta. */
export async function cabeceraVapid(endpoint: string, claves: ClavesVapid, ahora: Date): Promise<string> {
  const jwt = await firmarJwtVapid(new URL(endpoint).origin, claves, ahora);
  return `vapid t=${jwt}, k=${claves.publica}`;
}

/** Par VAPID nuevo. Lo usa `scripts/generar-vapid.mjs` por la misma vía que el envío. */
export async function generarClavesVapid(): Promise<{ publica: string; privada: string }> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  return { publica: aBase64url(publica), privada: jwk.d! };
}
