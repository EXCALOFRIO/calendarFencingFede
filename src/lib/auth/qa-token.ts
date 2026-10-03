import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_ACCESO_QA = 'calendario_acceso_qa';
export const DURACION_SESION_QA = 30 * 60 * 1000;
export const DURACION_MAXIMA_CONCESION_QA = 2 * 60 * 60 * 1000;
const CONTEXTO_FIRMA = 'calendario:acceso-qa:solo-lectura:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Se guarda en un secreto de Cloudflare, nunca en el repositorio o una URL. */
export type ConcesionQa = {
  version: 1;
  id: string;
  adminProfileId: string;
  keyHash: string;
  issuedAt: number;
  expiresAt: number;
};

export type SesionQa = {
  version: 1;
  grantId: string;
  adminProfileId: string;
  issuedAt: number;
  expiresAt: number;
};

export function hashClaveQa(clave: string): string {
  return createHash('sha256').update(clave).digest('hex');
}

export function leerConcesionQa(
  valor = process.env.ACCESO_QA_CONCESION,
  now = Date.now(),
): ConcesionQa | null {
  if (!valor || valor.length > 2048) return null;
  try {
    const c = JSON.parse(valor) as ConcesionQa;
    if (
      c.version !== 1 || !UUID.test(c.id) || !UUID.test(c.adminProfileId) ||
      !/^[0-9a-f]{64}$/.test(c.keyHash) ||
      !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) ||
      c.issuedAt < 0 || c.issuedAt > now || c.expiresAt <= now ||
      c.expiresAt <= c.issuedAt ||
      c.expiresAt - c.issuedAt > DURACION_MAXIMA_CONCESION_QA
    ) return null;
    return c;
  } catch {
    return null;
  }
}

export function comprobarClaveQa(clave: unknown, c: ConcesionQa): boolean {
  // 32 bytes aleatorios codificados en base64url; no admite contraseñas humanas.
  if (typeof clave !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(clave)) return false;
  return timingSafeEqual(Buffer.from(hashClaveQa(clave), 'hex'), Buffer.from(c.keyHash, 'hex'));
}

function firma(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(CONTEXTO_FIRMA + payload).digest();
}

export function firmarSesionQa(sesion: SesionQa, secret: string): string {
  if (secret.length < 32) throw new Error('Falta la clave de firma del acceso técnico.');
  const payload = Buffer.from(JSON.stringify(sesion)).toString('base64url');
  return `${payload}.${firma(payload, secret).toString('base64url')}`;
}

export function verificarSesionQa(
  valor: string,
  c: ConcesionQa | null,
  secret: string,
  now = Date.now(),
): SesionQa | null {
  if (!c || c.expiresAt <= now || c.issuedAt > now || secret.length < 32 || valor.length > 2048) return null;
  const partes = valor.split('.');
  if (partes.length !== 2 || !partes.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [payload, signature] = partes;
  const recibida = Buffer.from(signature, 'base64url');
  const esperada = firma(payload, secret);
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SesionQa;
    if (
      s.version !== 1 || s.grantId !== c.id || s.adminProfileId !== c.adminProfileId ||
      !Number.isSafeInteger(s.issuedAt) || !Number.isSafeInteger(s.expiresAt) ||
      s.issuedAt < c.issuedAt || s.issuedAt > now || s.expiresAt <= now ||
      s.expiresAt > c.expiresAt || s.expiresAt <= s.issuedAt ||
      s.expiresAt - s.issuedAt > DURACION_SESION_QA
    ) return null;
    return s;
  } catch {
    return null;
  }
}
