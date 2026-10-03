import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COOKIE_ACCESO_QA,
  hashClaveQa,
  leerConcesionQa,
  verificarSesionQa,
} from '@/lib/auth/qa-token';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

const h = vi.hoisted(() => ({
  select: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  rows: [] as { id: string }[],
  where: undefined as unknown,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: h.set, delete: h.remove }) }));
vi.mock('@/db', () => ({ db: { select: h.select } }));
import { POST } from '@/app/api/acceso-qa/route';

const ORIGIN = 'https://app.example.test';
const KEY = 'A'.repeat(43);
const SECRET = 'clave-de-tests-no-real-con-mas-de-32-caracteres';
const ID = '22222222-2222-4222-8222-222222222222';
let concesion: string;
function llamar(
  body = JSON.stringify({ clave: KEY }),
  origin = ORIGIN,
  contentType = 'application/json',
) {
  return POST(new Request(`${ORIGIN}/api/acceso-qa`, {
    method: 'POST',
    headers: { origin, 'content-type': contentType },
    body,
  }));
}

beforeEach(() => {
  concesion = JSON.stringify({
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    adminProfileId: ID,
    keyHash: hashClaveQa(KEY),
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60 * 60 * 1_000,
  });
  vi.stubEnv('ACCESO_QA_CONCESION', concesion);
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
  vi.stubEnv('NODE_ENV', 'production');
  h.rows = [{ id: ID }];
  h.set.mockReset();
  h.remove.mockReset();
  h.select.mockReset().mockImplementation(() => ({
    from: () => ({
      where: (where: unknown) => { h.where = where; return { limit: async () => h.rows }; },
    }),
  }));
});

describe('entrada privada sin crear identidades ni exponer credenciales', () => {
  it.each(['', '{}', 'null'])('apagada sin concesión válida: %s', async (value) => {
    vi.stubEnv('ACCESO_QA_CONCESION', value);
    expect((await llamar()).status).toBe(404);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('deniega Origin ajeno o ausente y clave en la URL en vez del cuerpo', async () => {
    expect((await llamar(undefined, 'https://externo.example.test')).status).toBe(404);
    expect((await llamar(undefined, '')).status).toBe(404);
    expect((await POST(new Request(`${ORIGIN}/api/acceso-qa?clave=${KEY}`, {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}',
    }))).status).toBe(404);
    expect(h.select).not.toHaveBeenCalled();
  });

  it.each(['{}', 'null', '[]', 'no-json', 'x'.repeat(513), JSON.stringify({ clave: 'B'.repeat(43) })])(
    'rechaza un cuerpo inválido antes de consultar perfiles', async (body) => {
      expect((await llamar(body)).status).toBe(404);
      expect(h.select).not.toHaveBeenCalled();
      expect(h.set).not.toHaveBeenCalled();
    },
  );

  it('exige JSON y una clave de firma configurada', async () => {
    expect((await llamar(undefined, ORIGIN, 'text/plain')).status).toBe(404);
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', '');
    expect((await llamar()).status).toBe(404);
    expect(h.select).not.toHaveBeenCalled();
  });

  it('limita bytes, también con cuerpos fragmentados sin content-length', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(300)));
        controller.enqueue(new TextEncoder().encode('b'.repeat(300)));
        controller.close();
      },
    });
    const req = new Request(`${ORIGIN}/api/acceso-qa`, {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body, duplex: 'half',
    } as RequestInit);
    expect((await POST(req)).status).toBe(404);
    expect(h.select).not.toHaveBeenCalled();
  });

  it('comprueba un admin activo y no crea cuenta si no existe o fue revocado', async () => {
    h.rows = [];
    expect((await llamar()).status).toBe(404);
    const sql = new SQLiteSyncDialect().sqlToQuery(h.where as never);
    expect(sql.params).toEqual([ID, 'admin', 'revocada']);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('emite una cookie httpOnly y strict, sin credenciales en la respuesta o la URL', async () => {
    const result = await llamar();
    expect(result.status).toBe(204);
    expect(await result.text()).toBe('');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
    expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(h.set).toHaveBeenCalledWith(COOKIE_ACCESO_QA, expect.any(String), {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/',
    });
    const cookie = h.set.mock.calls[0][1] as string;
    expect(verificarSesionQa(cookie, leerConcesionQa(concesion), SECRET))
      .toMatchObject({ adminProfileId: ID });
    expect(cookie).not.toContain(KEY);
  });

  it('un fallo D1 al comprobar el admin deniega sin filtrar SQL o crear cookies', async () => {
    h.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: async () => { throw new Error('synthetic-provider-private-parameters'); } }),
      }),
    }));
    const result = await llamar();
    expect(result.status).toBe(404);
    expect(await result.text()).toBe('');
    expect(h.set).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
});
