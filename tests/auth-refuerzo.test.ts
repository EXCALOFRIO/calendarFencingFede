import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManagedAuth } from '@/lib/auth/managed-auth';
import { OTP_DAILY_LIMIT_DEFAULT, otpDailyLimit, privateAuthKey, takeAuthLimit } from '@/lib/auth/rate-limit';
import { ERROR_SOLO_LECTURA, exigirEscritura } from '@/lib/auth/read-only';
import { COOKIE_VISTA_PREVIA, DURACION_VISTA_PREVIA, firmarVistaPrevia } from '@/lib/auth/preview-token';
import { localAuthDatabase } from './d1-auth-local';

/**
 * Sesión simulada sólo en «quién ha iniciado sesión» (el proveedor); perfil,
 * rol y revocación salen de una SQLite real con el esquema de la aplicación.
 */
const h = vi.hoisted(() => ({
  db: null as unknown,
  usuario: null as null | { id: string; email: string; emailVerified: boolean },
  cookies: new Map<string, string>(),
}));
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T>(fn: T) => fn }));
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (n: string) => (h.cookies.has(n) ? { value: h.cookies.get(n)! } : undefined) }),
}));
vi.mock('@/lib/auth/server', () => ({ getAuth: () => ({ api: { getSession: async () => (h.usuario ? { user: h.usuario } : null) } }) }));
vi.mock('@/db', () => ({ get db() { return h.db; } }));

const ORIGIN = 'https://auth.example.test';
const SECRET = 'clave-local-de-pruebas-con-mas-de-32-caracteres';
const SEND = 'email-otp/send-verification-otp';
const VERIFY = 'sign-in/email-otp';

let local: ReturnType<typeof localAuthDatabase>;
let provider: ReturnType<typeof vi.fn>;
let ipN = 0;

function invitar(email: string, opciones: { role?: string; status?: string; authUserId?: string | null } = {}) {
  const id = crypto.randomUUID();
  local.sqlite.prepare(`INSERT INTO user_profile (id,email,auth_user_id,full_name,role,invite_status,updated_at,ical_token)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, email, opciones.authUserId ?? null, `Perfil ${email}`, opciones.role ?? 'athlete',
    opciones.status ?? 'pendiente', Date.now(), crypto.randomUUID());
  return id;
}

function peticion(auth: ReturnType<typeof createManagedAuth>, path: string, body: unknown, ip = `192.0.2.${(ipN++ % 250) + 1}`) {
  return auth.handler(new Request(`${ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  }));
}

const filasThrottle = () => Number(local.sqlite.prepare('SELECT count(*) AS n FROM auth_throttle').get()!.n);
const contador = (scope: string, valor: string) =>
  (local.sqlite.prepare('SELECT count FROM auth_throttle WHERE key = ?').get(privateAuthKey(SECRET, scope, valor)) as { count: number } | undefined)?.count ?? 0;

beforeEach(() => {
  local = localAuthDatabase();
  h.db = local.db;
  h.usuario = null;
  h.cookies.clear();
  provider = vi.fn(async (req: Request, path: string) => {
    if (path === SEND) return Response.json({ success: true });
    if (path === VERIFY) {
      const body = await req.clone().json() as { email: string };
      const r = Response.json({ user: { id: `neon-${body.email}`, email: body.email, emailVerified: true } });
      r.headers.append('set-cookie', '__Secure-neon-auth.session_token=tok; Path=/; HttpOnly; Secure');
      return r;
    }
    if (path === 'get-session') return Response.json(h.usuario ? {
      user: h.usuario, session: { id: 's', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    } : null);
    return Response.json({}, { status: 400 });
  });
});
afterEach(() => {
  local.sqlite.close();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------ cupo diario de códigos

describe('cupo de códigos: sólo lo gastan los invitados', () => {
  it('cien direcciones inventadas no escriben contadores por dirección ni tocan el cupo global', async () => {
    const auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider, otpDailyLimit: 1 });
    for (let i = 0; i < 100; i++) {
      const r = await peticion(auth, SEND, { email: `inventada-${i}@example.test`, type: 'sign-in' });
      expect(await r.json()).toEqual({ success: true });
    }
    expect(provider).not.toHaveBeenCalled();
    expect(contador('send-global-day', 'all')).toBe(0);
    expect(contador('send-email-hour', 'inventada-0@example.test')).toBe(0);
    // Sólo quedan los contadores por IP y por IP + dirección (HMAC, acotados por
    // el tope de cada IP): ninguno es un contador de la dirección sola.
    expect(filasThrottle()).toBe(300);
    // El cupo sigue intacto para una invitada real.
    invitar('real@example.test');
    await peticion(auth, SEND, { email: 'real@example.test', type: 'sign-in' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(contador('send-global-day', 'all')).toBe(1);
  });

  it('agotado el cupo, una invitada más recibe la MISMA respuesta y no llega al proveedor', async () => {
    const auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider, otpDailyLimit: 2 });
    for (const e of ['a', 'b', 'c']) invitar(`${e}@example.test`);
    const respuestas: unknown[] = [];
    for (const e of ['a', 'b', 'c']) respuestas.push(await (await peticion(auth, SEND, { email: `${e}@example.test`, type: 'sign-in' })).json());
    expect(new Set(respuestas.map((r) => JSON.stringify(r)))).toEqual(new Set(['{"success":true}']));
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.map((c) => (c[0] as Request).url)).toEqual([`${ORIGIN}/api/auth/${SEND}`, `${ORIGIN}/api/auth/${SEND}`]);
  });

  it('la misma dirección con otras mayúsculas o espacios cuenta como la misma (no se esquiva el «un código por minuto»)', async () => {
    const auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider });
    invitar('Ana@Example.test');
    await peticion(auth, SEND, { email: 'ana@example.test', type: 'sign-in' });
    await peticion(auth, SEND, { email: '  ANA@EXAMPLE.TEST ', type: 'sign-in' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('el cupo global se renueva a las 24 h exactas, no antes', async () => {
    const t0 = 1_000_000;
    const dia = 24 * 3_600_000;
    expect(await takeAuthLimit(local.db, SECRET, 'send-global-day', 'all', 1, dia, t0)).toBe(true);
    expect(await takeAuthLimit(local.db, SECRET, 'send-global-day', 'all', 1, dia, t0 + dia - 1)).toBe(false);
    expect(await takeAuthLimit(local.db, SECRET, 'send-global-day', 'all', 1, dia, t0 + dia)).toBe(true);
  });

  it('el contador no crece sin fin con peticiones denegadas (se queda en máximo + 1)', async () => {
    for (let i = 0; i < 50; i++) await takeAuthLimit(local.db, SECRET, 'x', 'v', 3, 60_000, 5_000);
    expect(contador('x', 'v')).toBe(4);
  });

  it.each([
    [undefined, OTP_DAILY_LIMIT_DEFAULT], ['', OTP_DAILY_LIMIT_DEFAULT], ['0', OTP_DAILY_LIMIT_DEFAULT], ['-3', OTP_DAILY_LIMIT_DEFAULT],
    ['abc', OTP_DAILY_LIMIT_DEFAULT], ['50', 50], ['9007199254740993', OTP_DAILY_LIMIT_DEFAULT],
  ])('AUTH_OTP_DAILY_LIMIT=%j → %i', (valor, esperado) => {
    expect(otpDailyLimit(valor)).toBe(esperado);
  });

  it('las claves del contador no llevan la dirección en claro y dependen del secreto', () => {
    const k = privateAuthKey(SECRET, 'send-email-hour', 'ana@example.test');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toBe(privateAuthKey(`${SECRET}-otro`, 'send-email-hour', 'ana@example.test'));
    expect(k).not.toBe(privateAuthKey(SECRET, 'verify-email-hour', 'ana@example.test'));
  });
});

// ------------------------------------------------------------------ cuenta revocada

describe('cuenta revocada', { timeout: 30_000 }, () => {
  it('revocar entre pedir el código y canjearlo impide entrar y no enlaza la identidad', async () => {
    const auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider });
    const id = invitar('rev@example.test');
    await peticion(auth, SEND, { email: 'rev@example.test', type: 'sign-in' });
    local.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(id);
    const r = await peticion(auth, VERIFY, { email: 'rev@example.test', otp: '123456' });
    expect(r.ok).toBe(false);
    expect(r.headers.has('set-cookie')).toBe(false);
    expect(local.sqlite.prepare('SELECT auth_user_id FROM user_profile WHERE id = ?').get(id)).toEqual({ auth_user_id: null });
  });

  it('una cuenta ya enlazada y revocada: get-session devuelve null y no se le mandan más códigos', async () => {
    const auth = createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider });
    const id = invitar('ya@example.test', { status: 'aceptada', authUserId: 'neon-ya' });
    h.usuario = { id: 'neon-ya', email: 'ya@example.test', emailVerified: true };
    const headers = () => new Headers({ cookie: '__Secure-neon-auth.session_token=tok' });
    expect(await auth.api.getSession({ headers: headers() })).not.toBeNull();
    local.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(id);
    expect(await auth.api.getSession({ headers: headers() })).toBeNull();
    provider.mockClear();
    await peticion(auth, SEND, { email: 'ya@example.test', type: 'sign-in' });
    expect(provider.mock.calls.filter((c) => c[1] === SEND)).toHaveLength(0);
  });

  it('la sesión de la aplicación también la echa en la siguiente carga (getSessionProfile → null)', async () => {
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
    const { getSessionProfile, requireProfile } = await import('@/lib/auth/session');
    const id = invitar('coach@example.test', { role: 'coach', status: 'aceptada', authUserId: 'neon-coach' });
    h.usuario = { id: 'neon-coach', email: 'coach@example.test', emailVerified: true };
    expect((await getSessionProfile())?.profileId).toBe(id);
    local.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(id);
    expect(await getSessionProfile()).toBeNull();
    await expect(requireProfile()).rejects.toThrow('NO_AUTENTICADO');
  });

  it('con el correo sin verificar o con otra identidad para el mismo correo, tampoco hay sesión', async () => {
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
    const { getSessionProfile } = await import('@/lib/auth/session');
    invitar('ok@example.test', { status: 'aceptada', authUserId: 'neon-ok' });
    h.usuario = { id: 'neon-ok', email: 'ok@example.test', emailVerified: false };
    expect(await getSessionProfile()).toBeNull();
    h.usuario = { id: 'neon-impostor', email: 'ok@example.test', emailVerified: true };
    expect(await getSessionProfile()).toBeNull();
  });
});

// ------------------------------------------------------------------ rol sin permiso

// La primera importación de las acciones de administración arrastra muchos módulos.
describe('acciones de administración con un rol sin permiso', { timeout: 60_000 }, () => {
  async function entrar(role: string, status = 'aceptada') {
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
    const email = `${role}-${crypto.randomUUID().slice(0, 8)}@example.test`;
    const authId = `neon-${email}`;
    const id = invitar(email, { role, status, authUserId: authId });
    h.usuario = { id: authId, email, emailVerified: true };
    return id;
  }

  it.each(['coach', 'athlete'])('%s: requireRole y requireWritableRole("admin") lanzan', async (role) => {
    const { requireRole, requireWritableRole } = await import('@/lib/auth/session');
    await entrar(role);
    await expect(requireRole('admin')).rejects.toThrow(/admin/);
    await expect(requireWritableRole('admin')).rejects.toThrow(/admin/);
  });

  it.each(['club', 'guardian'])('el papel retirado %s ni siquiera tiene sesión', async (role) => {
    const { getSessionProfile } = await import('@/lib/auth/session');
    await entrar(role);
    expect(await getSessionProfile()).toBeNull();
  });

  it.each(['coach', 'athlete'])('%s no puede crear clubes: la acción lanza y no se escribe nada', async (role) => {
    const { crearClub } = await import('@/app/(app)/admin/usuarios/actions');
    await entrar(role);
    const datos = new FormData();
    datos.set('name', 'Club Pirata');
    await expect(crearClub(datos)).rejects.toThrow();
    expect(local.sqlite.prepare(`SELECT count(*) AS n FROM club`).get()).toEqual({ n: 0 });
  });

  it.each(['coach', 'athlete'])('%s no puede marcar la cuarentena como revisada', async (role) => {
    const { resolverCuarentena, contarPendientes } = await import('@/app/(app)/admin/cuarentena/actions');
    await entrar(role);
    await expect(resolverCuarentena('x')).rejects.toThrow();
    await expect(contarPendientes()).rejects.toThrow();
  });

  it('un admin sí puede (control), y un admin revocado ya no', async () => {
    const { crearClub } = await import('@/app/(app)/admin/usuarios/actions');
    const id = await entrar('admin');
    const datos = new FormData();
    datos.set('name', 'Club Bueno');
    expect(await crearClub(datos)).toMatchObject({ ok: true });
    local.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(id);
    datos.set('name', 'Club Tras Revocar');
    await expect(crearClub(datos)).rejects.toThrow('NO_AUTENTICADO');
    expect(local.sqlite.prepare(`SELECT name FROM club`).all()).toEqual([{ name: 'Club Bueno' }]);
  });

  it('un admin en vista previa como tirador no puede escribir como admin', async () => {
    const { crearClub } = await import('@/app/(app)/admin/usuarios/actions');
    const adminId = await entrar('admin');
    const tirador = invitar('tirador-vista@example.test', { status: 'aceptada' });
    const ahora = Date.now();
    h.cookies.set(COOKIE_VISTA_PREVIA, firmarVistaPrevia({
      version: 1, adminAuthUserId: h.usuario!.id, adminProfileId: adminId, profileId: tirador, role: 'athlete',
      issuedAt: ahora, expiresAt: ahora + DURACION_VISTA_PREVIA * 1000,
    }, SECRET));
    const datos = new FormData();
    datos.set('name', 'Club Desde Vista');
    await expect(crearClub(datos)).rejects.toThrow();
    expect(local.sqlite.prepare(`SELECT count(*) AS n FROM club`).get()).toEqual({ n: 0 });
  });

  it('exigirEscritura corta con el código de solo lectura tanto en vista previa como en QA', () => {
    for (const perfil of [{ preview: { adminProfileId: 'a', expiresAt: 1 } }, { qa: { grantId: 'g', expiresAt: 1 } }]) {
      try {
        exigirEscritura(perfil);
        throw new Error('no lanzó');
      } catch (e) {
        expect((e as { digest?: string }).digest).toBe(ERROR_SOLO_LECTURA);
      }
    }
    expect(() => exigirEscritura({})).not.toThrow();
  });
});
