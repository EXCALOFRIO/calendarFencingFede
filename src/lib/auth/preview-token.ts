import { createHmac, timingSafeEqual } from 'node:crypto';
import { esRolAplicacion } from './access-policy';

export const COOKIE_VISTA_PREVIA = 'calendario_vista_previa';
export const DURACION_VISTA_PREVIA = 30 * 60;
const CONTEXTO_FIRMA = 'calendario:vista-previa:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VistaPreviaToken = {
  version: 1;
  adminAuthUserId: string;
  adminProfileId: string;
  profileId: string;
  role: 'admin' | 'coach' | 'athlete';
  issuedAt: number;
  expiresAt: number;
};

function firma(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(CONTEXTO_FIRMA + payload).digest();
}

export function firmarVistaPrevia(token: VistaPreviaToken, secret: string): string {
  if (secret.length < 32) throw new Error('Falta la clave de firma de la vista previa.');
  const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
  return `${payload}.${firma(payload, secret).toString('base64url')}`;
}

export function verificarVistaPrevia(
  value: string,
  secret: string,
  admin: { authUserId: string; profileId: string; role: string },
  now = Date.now(),
): VistaPreviaToken | null {
  if (secret.length < 32 || value.length > 2048 || admin.role !== 'admin') return null;
  const partes = value.split('.');
  if (partes.length !== 2 || !partes.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const [payload, signature] = partes;
  const recibida = Buffer.from(signature, 'base64url');
  const esperada = firma(payload, secret);
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;

  try {
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as VistaPreviaToken;
    if (
      token.version !== 1 ||
      token.adminAuthUserId !== admin.authUserId ||
      token.adminProfileId !== admin.profileId ||
      !UUID.test(token.profileId) ||
      !esRolAplicacion(token.role) ||
      !Number.isSafeInteger(token.issuedAt) ||
      !Number.isSafeInteger(token.expiresAt) ||
      token.issuedAt > now ||
      token.expiresAt <= now ||
      token.expiresAt - token.issuedAt !== DURACION_VISTA_PREVIA * 1000
    ) return null;
    return token;
  } catch {
    return null;
  }
}
