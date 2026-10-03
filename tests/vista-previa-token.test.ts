import { describe, expect, it } from 'vitest';
import {
  DURACION_VISTA_PREVIA,
  firmarVistaPrevia,
  verificarVistaPrevia,
  type VistaPreviaToken,
} from '@/lib/auth/preview-token';
import { exigirEscritura, ERROR_SOLO_LECTURA } from '@/lib/auth/read-only';

const SECRET = 'clave-de-prueba-no-real-32-caracteres';
const NOW = 1_800_000_000_000;
const ADMIN = {
  authUserId: 'auth-admin',
  profileId: '11111111-1111-4111-8111-111111111111',
  role: 'admin',
};
const TOKEN: VistaPreviaToken = {
  version: 1,
  adminAuthUserId: ADMIN.authUserId,
  adminProfileId: ADMIN.profileId,
  profileId: '22222222-2222-4222-8222-222222222222',
  role: 'athlete',
  issuedAt: NOW,
  expiresAt: NOW + DURACION_VISTA_PREVIA * 1000,
};

describe('firma privada de la vista previa', () => {
  it.each(['admin', 'coach', 'athlete'] as const)('acepta %s solo con la sesión administradora original', (role) => {
    const token = { ...TOKEN, role };
    const value = firmarVistaPrevia(token, SECRET);
    expect(verificarVistaPrevia(value, SECRET, ADMIN, NOW)).toEqual(token);
  });

  it('deniega otra sesión, otro perfil administrador y un admin degradado', () => {
    const value = firmarVistaPrevia(TOKEN, SECRET);
    for (const admin of [
      { ...ADMIN, authUserId: 'otro' },
      { ...ADMIN, profileId: TOKEN.profileId },
      { ...ADMIN, role: 'coach' },
      { ...ADMIN, role: 'athlete' },
    ]) expect(verificarVistaPrevia(value, SECRET, admin, NOW)).toBeNull();
  });

  it('caduca en 30 minutos, incluso en el instante exacto de expiración', () => {
    const value = firmarVistaPrevia(TOKEN, SECRET);
    expect(verificarVistaPrevia(value, SECRET, ADMIN, TOKEN.expiresAt - 1)).toEqual(TOKEN);
    expect(verificarVistaPrevia(value, SECRET, ADMIN, TOKEN.expiresAt)).toBeNull();
    expect(verificarVistaPrevia(value, SECRET, ADMIN, NOW - 1)).toBeNull();
  });

  it('deniega payload manipulado, firma ajena, formato inválido y clave ausente', () => {
    const value = firmarVistaPrevia(TOKEN, SECRET);
    const [payload, signature] = value.split('.');
    const changed = Buffer.from(JSON.stringify({ ...TOKEN, role: 'admin' })).toString('base64url');
    for (const bad of ['', '.', `${changed}.${signature}`, `${payload}.AA`, `${value}.extra`, '!'.repeat(3000)]) {
      expect(verificarVistaPrevia(bad, SECRET, ADMIN, NOW)).toBeNull();
    }
    expect(verificarVistaPrevia(value, SECRET + 'otra', ADMIN, NOW)).toBeNull();
    expect(verificarVistaPrevia(value, '', ADMIN, NOW)).toBeNull();
    expect(() => firmarVistaPrevia(TOKEN, '')).toThrow();
  });

  it('deniega un perfil no UUID, papeles retirados y duraciones alteradas aunque estén firmados', () => {
    for (const token of [
      { ...TOKEN, profileId: '../../admin' },
      { ...TOKEN, role: 'club' },
      { ...TOKEN, version: 2 },
      { ...TOKEN, expiresAt: TOKEN.expiresAt + 1 },
    ]) {
      const value = firmarVistaPrevia(token as VistaPreviaToken, SECRET);
      expect(verificarVistaPrevia(value, SECRET, ADMIN, NOW)).toBeNull();
    }
  });
});

describe('guarda de escritura independiente de la interfaz', () => {
  it('permite una cuenta normal y deniega todos los papeles de vista previa con un digest público', () => {
    expect(() => exigirEscritura({})).not.toThrow();
    for (const role of ['admin', 'coach', 'athlete']) {
      try {
        exigirEscritura({ preview: { role } });
        expect.fail('Una vista previa no debe poder escribir');
      } catch (error) {
        expect(error).toMatchObject({ digest: ERROR_SOLO_LECTURA });
      }
    }
  });
});
