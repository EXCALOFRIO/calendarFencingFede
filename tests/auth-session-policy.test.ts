import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { COOKIE_VISTA_PREVIA, DURACION_VISTA_PREVIA, firmarVistaPrevia } from '@/lib/auth/preview-token';
import { COOKIE_ACCESO_QA, firmarSesionQa, hashClaveQa } from '@/lib/auth/qa-token';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  rows: [] as unknown[][],
  wheres: [] as unknown[],
  linked: true,
  cookie: '',
  qaCookie: '',
  emptyCookie: '',
}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => {
    if (name === h.emptyCookie) return { value: '' };
    const value = name === COOKIE_VISTA_PREVIA ? h.cookie : name === COOKIE_ACCESO_QA ? h.qaCookie : '';
    return value ? { value } : undefined;
  } }),
}));
vi.mock('@/lib/auth/server', () => ({ getAuth: () => ({ api: { getSession: h.getSession } }) }));
vi.mock('@/db', () => ({ db: { select: h.select, update: h.update } }));
import {
  getAuthenticatedProfile,
  getSessionProfile,
  requireWritableProfile,
  requireWritableRole,
} from '@/lib/auth/session';

const SECRET = 'clave-ficticia-para-los-tests-mas-de-32';
const ID = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const ROW = {
  profileId: ID,
  authUserId: 'auth-admin',
  email: 'admin@example.test',
  fullName: 'Administrador de prueba',
  role: 'admin',
  clubId: null,
  clubName: null,
  icalToken: 'feed-privado-no-copiar',
  inviteStatus: 'aceptada',
};

beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
  h.cookie = '';
  h.qaCookie = '';
  h.emptyCookie = '';
  vi.stubEnv('ACCESO_QA_CONCESION', '');
  h.linked = true;
  h.wheres = [];
  h.rows = [[ROW]];
  h.getSession.mockReset().mockResolvedValue({
    user: { id: ROW.authUserId, email: ROW.email, emailVerified: true },
  });
  h.select.mockReset().mockImplementation(() => {
    const query = {
      from: () => query,
      leftJoin: () => query,
      where: (where: unknown) => { h.wheres.push(where); return query; },
      limit: async () => h.rows.shift() ?? [],
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(h.rows.shift() ?? []).then(resolve),
    };
    return query;
  });
  h.update.mockReset().mockImplementation(() => ({
    set: () => ({
      where: (where: unknown) => {
        h.wheres.push(where);
        return { returning: async () => h.linked ? [{ id: ID }] : [] };
      },
    }),
  }));
});

function activar(role: 'admin' | 'coach' | 'athlete' = 'athlete', expires = Date.now() + 100_000) {
  h.cookie = firmarVistaPrevia({
    version: 1,
    adminAuthUserId: ROW.authUserId,
    adminProfileId: ID,
    profileId: TARGET,
    role,
    issuedAt: expires - DURACION_VISTA_PREVIA * 1000,
    expiresAt: expires,
  }, SECRET);
  h.rows.push([{ ...ROW, profileId: TARGET, role, fullName: 'Perfil elegido' }]);
  if (role === 'coach') h.rows.push([{ weapon: 'FLORETE' }]);
}

describe('identidad real y enlace verificado de invitaciones', () => {
  it.each([false, undefined])('deniega correo sin verificar (%s), sin leer ni escribir perfiles', async (emailVerified) => {
    h.getSession.mockResolvedValue({ user: { id: 'atacante', email: ROW.email, emailVerified } });
    expect(await getAuthenticatedProfile()).toBeNull();
    expect(h.select).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('leer la sesión requiere el ID gestionado conservado y el email verificado, nunca reclama otro perfil', async () => {
    await getAuthenticatedProfile();
    const query = new SQLiteSyncDialect().sqlToQuery(h.wheres[0] as never);
    expect(query.sql).not.toContain('"auth_user_id" is null');
    expect(query.sql).toContain('"auth_user_id" =');
    expect(query.sql).toContain('lower(trim(');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('una sesión sin enlace previamente verificado no escribe ni devuelve permisos', async () => {
    h.rows = [[{ ...ROW, authUserId: null, inviteStatus: 'pendiente' }]];
    expect(await getAuthenticatedProfile()).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('un enlace perteneciente a otra identidad nunca otorga permisos', async () => {
    h.rows = [[{ ...ROW, authUserId: 'other-active-identity' }]];
    expect(await getAuthenticatedProfile()).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('falla cerrada ante una sesión inválida o un error del proveedor', async () => {
    h.getSession.mockRejectedValue(new Error('unavailable'));
    expect(await getAuthenticatedProfile()).toBeNull();
    expect(h.select).not.toHaveBeenCalled();
  });

  it('un error SQL de perfil no alcanza Next ni concede permisos', async () => {
    h.select.mockImplementation(() => { throw new Error('synthetic-provider-private-parameters'); });
    expect(await getAuthenticatedProfile()).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each(['club', 'guardian'])('excluye el papel retirado %s', async (role) => {
    h.rows = [[{ ...ROW, role }]];
    expect(await getAuthenticatedProfile()).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('una revocación corta incluso una identidad ya enlazada', async () => {
    h.rows = [[{ ...ROW, inviteStatus: 'revocada' }]];
    expect(await getAuthenticatedProfile()).toBeNull();
  });
});

describe('vista previa sin alterar identidad ni cuenta', () => {
  it.each(['admin', 'coach', 'athlete'] as const)('aplica el papel %s y no entrega su feed privado', async (role) => {
    activar(role);
    const p = await getSessionProfile();
    expect(p).toMatchObject({ profileId: TARGET, role, authUserId: ROW.authUserId, icalToken: '', preview: { adminProfileId: ID } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('una firma caducada nunca recupera silenciosamente los permisos de admin', async () => {
    activar('athlete', Date.now() - 1);
    await expect(getSessionProfile()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_CADUCADA' });
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([COOKIE_VISTA_PREVIA, COOKIE_ACCESO_QA])('una cookie vacía sigue siendo una vista inválida, no un admin normal (%s)', async (name) => {
    h.emptyCookie = name;
    await expect(requireWritableProfile()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_CADUCADA' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('una cuenta degradada no puede seguir usando una vista previa ya firmada', async () => {
    activar();
    h.rows[0] = [{ ...ROW, role: 'athlete' }];
    await expect(getSessionProfile()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_CADUCADA' });
  });

  it('un objetivo retirado o revocado se deniega antes de devolver una vista', async () => {
    activar();
    h.rows[1] = [];
    await expect(getSessionProfile()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_CADUCADA' });
  });

  it('un error SQL de preview se convierte en el fallo público de solo lectura', async () => {
    activar();
    const readReal = h.select.getMockImplementation()!;
    h.select.mockImplementationOnce(readReal).mockImplementationOnce(() => {
      throw new Error('synthetic-provider-private-parameters');
    });
    await expect(getSessionProfile()).rejects.toMatchObject({
      digest: 'VISTA_PREVIA_CADUCADA',
      message: 'La vista previa ha caducado o ya no está autorizada.',
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([requireWritableProfile, () => requireWritableRole('athlete')])('las guardas de mutación rechazan la vista en el servidor', async (guard) => {
    activar();
    await expect(guard()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_SOLO_LECTURA' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('la cookie privada no cambia la identidad que gestiona o termina las vistas', async () => {
    activar();
    expect(await getAuthenticatedProfile()).toMatchObject({ profileId: ID, role: 'admin' });
    expect(COOKIE_VISTA_PREVIA).toBe('calendario_vista_previa');
  });
});

function activarQa() {
  const issuedAt = Date.now() - 1_000;
  const grantId = '33333333-3333-4333-8333-333333333333';
  const expiresAt = issuedAt + 30 * 60 * 1_000;
  vi.stubEnv('ACCESO_QA_CONCESION', JSON.stringify({
    version: 1, id: grantId, adminProfileId: ID,
    keyHash: hashClaveQa('A'.repeat(43)), issuedAt, expiresAt,
  }));
  h.qaCookie = firmarSesionQa({
    version: 1, grantId, adminProfileId: ID, issuedAt, expiresAt,
  }, SECRET);
  return { grantId, expiresAt };
}

describe('identidad de QA efímera y separada de Neon Auth', () => {
  it('no inicia sesión como el usuario ni vincula su email; devuelve siempre solo lectura', async () => {
    const qa = activarQa();
    const p = await getSessionProfile();
    expect(p).toMatchObject({ profileId: ID, role: 'admin', authUserId: `qa:${qa.grantId}`, icalToken: '', qa });
    expect(p?.preview).toMatchObject({ adminProfileId: ID, expiresAt: qa.expiresAt });
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([requireWritableProfile, () => requireWritableRole('admin')])('ni su papel admin permite escribir', async (guard) => {
    activarQa();
    await expect(guard()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_SOLO_LECTURA' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('rotación o revocación no recupera una sesión personal subyacente', async () => {
    activarQa();
    vi.stubEnv('ACCESO_QA_CONCESION', '');
    await expect(getSessionProfile()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_CADUCADA' });
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
  });

  it('un error SQL de QA no revela parámetros ni recupera la identidad personal', async () => {
    activarQa();
    h.select.mockImplementation(() => { throw new Error('synthetic-provider-private-parameters'); });
    await expect(getSessionProfile()).rejects.toMatchObject({
      digest: 'VISTA_PREVIA_CADUCADA',
      message: 'La vista previa ha caducado o ya no está autorizada.',
    });
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('la revocación o degradación del admin también invalida la identidad técnica', async () => {
    activarQa();
    h.rows = [];
    await expect(getSessionProfile()).rejects.toMatchObject({ digest: 'VISTA_PREVIA_CADUCADA' });
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    const sql = new SQLiteSyncDialect().sqlToQuery(h.wheres[0] as never);
    expect(sql.params).toEqual([ID, 'admin', 'revocada']);
  });

  it.each(['coach', 'athlete'] as const)('conserva la barrera de QA al elegir %s', async (role) => {
    const qa = activarQa();
    const expiresAt = Date.now() + 30 * 60 * 1_000;
    h.cookie = firmarVistaPrevia({
      version: 1, adminAuthUserId: `qa:${qa.grantId}`, adminProfileId: ID,
      profileId: TARGET, role, issuedAt: expiresAt - DURACION_VISTA_PREVIA * 1000, expiresAt,
    }, SECRET);
    h.rows.push([{ ...ROW, profileId: TARGET, role }]);
    if (role === 'coach') h.rows.push([{ weapon: 'FLORETE' }]);
    expect(await getSessionProfile()).toMatchObject({
      profileId: TARGET, role, qa, icalToken: '',
      preview: { expiresAt: qa.expiresAt },
    });
    expect(h.update).not.toHaveBeenCalled();
  });
});
