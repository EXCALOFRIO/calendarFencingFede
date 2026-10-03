import { describe, expect, it } from 'vitest';
import {
  DURACION_MAXIMA_CONCESION_QA,
  DURACION_SESION_QA,
  comprobarClaveQa,
  firmarSesionQa,
  hashClaveQa,
  leerConcesionQa,
  verificarSesionQa,
  type ConcesionQa,
  type SesionQa,
} from '@/lib/auth/qa-token';
import { exigirEscritura } from '@/lib/auth/read-only';

const NOW = 1_790_000_000_000;
const KEY = 'A'.repeat(43);
const SECRET = 'clave-de-tests-no-real-con-mas-de-32-caracteres';
const CONCESION: ConcesionQa = {
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  adminProfileId: '22222222-2222-4222-8222-222222222222',
  keyHash: hashClaveQa(KEY),
  issuedAt: NOW - 1_000,
  expiresAt: NOW + 60 * 60 * 1_000,
};
const SESION: SesionQa = {
  version: 1,
  grantId: CONCESION.id,
  adminProfileId: CONCESION.adminProfileId,
  issuedAt: NOW,
  expiresAt: NOW + DURACION_SESION_QA,
};

describe('concesión técnica apagada, acotada y revocable', () => {
  it('solo admite una concesión bien formada que aún esté vigente', () => {
    expect(leerConcesionQa(JSON.stringify(CONCESION), NOW)).toEqual(CONCESION);
    for (const value of ['', 'no-json', 'null', '[]', '{}', 'x'.repeat(2049)]) {
      expect(leerConcesionQa(value, NOW)).toBeNull();
    }
  });

  it.each([
    { version: 2 },
    { id: 'incorrecto' },
    { adminProfileId: 'incorrecto' },
    { keyHash: 'no-es-un-hash' },
    { issuedAt: -1 },
    { issuedAt: NOW + 1 },
    { issuedAt: NOW - 0.5 },
    { expiresAt: NOW },
    { expiresAt: NOW - 1 },
    { expiresAt: CONCESION.issuedAt + DURACION_MAXIMA_CONCESION_QA + 1 },
  ])('rechaza concesiones fuera de política: %j', (change) => {
    expect(leerConcesionQa(JSON.stringify({ ...CONCESION, ...change }), NOW)).toBeNull();
  });

  it('compara únicamente claves aleatorias de 32 bytes contra su hash', () => {
    expect(comprobarClaveQa(KEY, CONCESION)).toBe(true);
    for (const key of [null, 1, {}, '', 'contraseña', 'B'.repeat(43), `${KEY}=`, `${KEY}/`]) {
      expect(comprobarClaveQa(key, CONCESION)).toBe(false);
    }
  });
});

describe('cookie firmada de QA sin permisos de escritura', () => {
  it('verifica identidad de concesión y caducidad', () => {
    const cookie = firmarSesionQa(SESION, SECRET);
    expect(verificarSesionQa(cookie, CONCESION, SECRET, NOW)).toEqual(SESION);
    expect(verificarSesionQa(cookie, CONCESION, SECRET, SESION.expiresAt)).toBeNull();
  });

  it('revocar o rotar la concesión invalida una cookie que aún no ha caducado', () => {
    const cookie = firmarSesionQa(SESION, SECRET);
    expect(verificarSesionQa(cookie, null, SECRET, NOW)).toBeNull();
    expect(verificarSesionQa(cookie, { ...CONCESION, id: '33333333-3333-4333-8333-333333333333' }, SECRET, NOW)).toBeNull();
    expect(verificarSesionQa(cookie, { ...CONCESION, expiresAt: NOW }, SECRET, NOW)).toBeNull();
  });

  it.each([
    { version: 2 },
    { grantId: 'otra-concesion' },
    { adminProfileId: 'otro-perfil' },
    { issuedAt: CONCESION.issuedAt - 1 },
    { issuedAt: NOW + 1 },
    { issuedAt: NOW - 0.5 },
    { expiresAt: NOW },
    { expiresAt: NOW + DURACION_SESION_QA + 1 },
    { expiresAt: CONCESION.expiresAt + 1 },
  ])('ni una firma válida amplía los límites: %j', (change) => {
    expect(verificarSesionQa(firmarSesionQa({ ...SESION, ...change } as SesionQa, SECRET), CONCESION, SECRET, NOW)).toBeNull();
  });

  it('deniega firma manipulada, secreta corta y cookies mal formadas', () => {
    const cookie = firmarSesionQa(SESION, SECRET);
    for (const value of ['', '.', 'a.b.c', 'a.=b', cookie + 'x', 'x'.repeat(2049)]) {
      expect(verificarSesionQa(value, CONCESION, SECRET, NOW)).toBeNull();
    }
    expect(verificarSesionQa(cookie, CONCESION, SECRET + 'otra', NOW)).toBeNull();
    expect(verificarSesionQa(cookie, CONCESION, 'corta', NOW)).toBeNull();
    expect(() => firmarSesionQa(SESION, 'corta')).toThrow();
  });

  it('bloquea QA incluso si una futura llamada omite el indicador de preview', () => {
    expect(() => exigirEscritura({ qa: { grantId: CONCESION.id } }))
      .toThrow('solo lectura');
  });
});
