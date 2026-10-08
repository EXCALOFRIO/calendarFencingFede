import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManagedAuth, type ProviderSession } from '@/lib/auth/managed-auth';
import { allowOtpRequest } from '@/lib/auth/rate-limit';
import { createSessionCache } from '@/lib/auth/session-cache';
import { localAuthDatabase } from './d1-auth-local';

const ORIGIN = 'https://auth.example.test';
const SECRET = 'clave-local-de-pruebas-con-mas-de-32-caracteres';
const SEND = 'email-otp/send-verification-otp';
const TOKEN = 'synthetic-session-value';
const EMAIL = 'coach@example.test';

let local: ReturnType<typeof localAuthDatabase>;
let provider: ReturnType<typeof vi.fn>;
let active: boolean;
let failing: boolean;
let queries: string[];

const cookie = (value = TOKEN) => new Headers({ cookie: `__Secure-neon-auth.session_token=${value}; other=1` });
const sessionReads = () => provider.mock.calls.filter(([, path]) => path === 'get-session').length;

function invite(email = EMAIL, role = 'coach', authUserId: string | null = 'neon-coach') {
  const id = crypto.randomUUID();
  local.sqlite.prepare(`INSERT INTO user_profile (id,email,auth_user_id,full_name,role,invite_status,updated_at,ical_token)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, email, authUserId, 'Perfil sintético', role, 'aceptada', Date.now(), crypto.randomUUID());
  return id;
}

beforeEach(() => {
  local = localAuthDatabase();
  active = true; failing = false; queries = [];
  local.state.beforeQuery = (query) => { queries.push(query); };
  provider = vi.fn(async (_req: Request, path: string) => {
    if (path === 'get-session') {
      if (failing) return Response.json({ message: 'private' }, { status: 500 });
      return Response.json(active ? {
        user: { id: 'neon-coach', email: EMAIL, emailVerified: true },
        session: { id: 's', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      } : null);
    }
    if (path === 'sign-out') { active = false; return Response.json({ success: true }); }
    if (path === SEND) return Response.json({ success: true });
    return Response.json({}, { status: 400 });
  });
});
afterEach(() => {
  local.sqlite.close();
  vi.useRealTimers();
});

function auth(cache = createSessionCache<ProviderSession>()) {
  return createManagedAuth(local.db, { secret: SECRET, origin: ORIGIN, request: provider, sessionCache: cache });
}

describe('sesión sin cookie', () => {
  it('no llama al proveedor ni a D1 cuando no hay cookie de sesión', async () => {
    invite();
    const a = auth();
    for (const headers of [new Headers(), new Headers({ cookie: 'other=1; __Secure-neon-auth.session_token=' })]) {
      expect(await a.api.getSession({ headers })).toBeNull();
    }
    const http = await a.handler(new Request(`${ORIGIN}/api/auth/get-session`));
    expect(await http.json()).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it('sobre https ignora el nombre sin __Secure- (no lo valida ni lo cachea)', async () => {
    invite();
    expect(await auth().api.getSession({ headers: new Headers({ cookie: `neon-auth.session_token=${TOKEN}` }) })).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('caché de sesiones validadas', () => {
  it('una sola lectura remota por sesión dentro del TTL; D1 en cada petición', async () => {
    invite();
    const a = auth();
    for (let i = 0; i < 3; i++) expect((await a.api.getSession({ headers: cookie() }))?.user.id).toBe('neon-coach');
    expect(sessionReads()).toBe(1);
    expect(queries.filter((q) => q.includes('"user_profile"'))).toHaveLength(3);
  });

  it('peticiones simultáneas comparten la misma lectura remota', async () => {
    invite();
    const a = auth();
    await Promise.all(Array.from({ length: 5 }, () => a.api.getSession({ headers: cookie() })));
    expect(sessionReads()).toBe(1);
  });

  it('otra cookie es otra sesión', async () => {
    invite();
    const a = auth();
    await a.api.getSession({ headers: cookie() });
    await a.api.getSession({ headers: cookie('otro-valor') });
    expect(sessionReads()).toBe(2);
  });

  it('la revocación en la aplicación echa en la siguiente petición aunque el proveedor esté en caché', async () => {
    const id = invite();
    const a = auth();
    expect(await a.api.getSession({ headers: cookie() })).not.toBeNull();
    local.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(id);
    expect(await a.api.getSession({ headers: cookie() })).toBeNull();
    local.sqlite.prepare(`UPDATE user_profile SET invite_status = 'aceptada', role = 'guardian' WHERE id = ?`).run(id);
    expect(await a.api.getSession({ headers: cookie() })).toBeNull();
    expect(sessionReads()).toBe(1);
  });

  it('caduca a los 30 s y vuelve a preguntar al proveedor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    invite();
    const a = auth();
    await a.api.getSession({ headers: cookie() });
    vi.setSystemTime(Date.now() + 29_000);
    await a.api.getSession({ headers: cookie() });
    expect(sessionReads()).toBe(1);
    vi.setSystemTime(Date.now() + 2_000);
    active = false;
    expect(await a.api.getSession({ headers: cookie() })).toBeNull();
    expect(sessionReads()).toBe(2);
  });

  it('no guarda fallos ni sesiones vacías', async () => {
    invite();
    const a = auth();
    failing = true;
    await expect(a.api.getSession({ headers: cookie() })).rejects.toThrow('ACCESO_NO_PERMITIDO');
    failing = false; active = false;
    expect(await a.api.getSession({ headers: cookie() })).toBeNull();
    active = true;
    expect(await a.api.getSession({ headers: cookie() })).not.toBeNull();
    expect(sessionReads()).toBe(3);
  });

  it('cerrar sesión la olvida al instante, también para lecturas que estaban en curso', async () => {
    invite();
    const a = auth();
    await a.api.getSession({ headers: cookie() });
    await a.api.signOut({ headers: new Headers({ origin: ORIGIN, cookie: `__Secure-neon-auth.session_token=${TOKEN}` }) });
    expect(await a.api.getSession({ headers: cookie() })).toBeNull();
    expect(sessionReads()).toBe(3);
  });

  it('una lectura que empezó antes del desalojo no vuelve a guardar la sesión', async () => {
    const cache = createSessionCache<string>();
    let resolver!: (v: { value: string; expiresAt: number }) => void;
    const lenta = cache.read('k', () => new Promise((r) => { resolver = r; }));
    cache.evict('k');
    resolver({ value: 'vieja', expiresAt: Date.now() + 60_000 });
    expect(await lenta).toBe('vieja');
    const load = vi.fn(async () => ({ value: 'nueva', expiresAt: Date.now() + 60_000 }));
    expect(await cache.read('k', load)).toBe('nueva');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('nunca guarda más allá de la caducidad de la sesión y está acotada en tamaño', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cache = createSessionCache<number>({ ttlMs: 30_000, max: 3 });
    const load = vi.fn(async () => ({ value: 1, expiresAt: Date.now() + 5_000 }));
    await cache.read('a', load);
    vi.setSystemTime(Date.now() + 6_000);
    await cache.read('a', load);
    expect(load).toHaveBeenCalledTimes(2);
    const largo = vi.fn(async () => ({ value: 2, expiresAt: Date.now() + 60_000 }));
    for (const k of ['b', 'c', 'd', 'e']) await cache.read(k, largo);
    await cache.read('b', largo);
    expect(largo).toHaveBeenCalledTimes(5);
  });

  it('la respuesta HTTP no lleva el perfil ni el feed privado', async () => {
    invite();
    const response = await auth().handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: cookie() }));
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['session', 'user']);
    expect(JSON.stringify(body)).not.toContain('Perfil sintético');
  });
});

describe('perfil en una sola consulta', () => {
  it('club y armas del seleccionador llegan con la sesión, en una sola lectura de D1', async () => {
    const id = invite();
    local.sqlite.prepare(`INSERT INTO club (id,name,created_at) VALUES ('c1','Club Sintético',?)`).run(Date.now());
    local.sqlite.prepare(`UPDATE user_profile SET club_id = 'c1' WHERE id = ?`).run(id);
    for (const w of ['FLORETE', 'SABLE']) local.sqlite.prepare('INSERT INTO profile_weapon (profile_id, weapon) VALUES (?, ?)').run(id, w);
    queries = [];
    const session = await auth().api.getSession({ headers: cookie() });
    expect(session?.profile).toMatchObject({ id, role: 'coach', clubName: 'Club Sintético' });
    expect([...session!.profile.weapons].sort()).toEqual(['FLORETE', 'SABLE']);
    expect(queries).toHaveLength(1);
  });

  it('un tirador no recibe armas de perfil', async () => {
    const id = invite(EMAIL, 'athlete');
    local.sqlite.prepare('INSERT INTO profile_weapon (profile_id, weapon) VALUES (?, ?)').run(id, 'ESPADA');
    expect((await auth().api.getSession({ headers: cookie() }))?.profile.weapons).toEqual([]);
  });

  it('otra identidad gestionada para el mismo correo no obtiene perfil', async () => {
    invite(EMAIL, 'coach', 'otra-identidad');
    expect(await auth().api.getSession({ headers: cookie() })).toBeNull();
  });
});

describe('límites de códigos para IP compartidas, sin revelar invitaciones', () => {
  const desde = (ip: string) => new Headers({ 'cf-connecting-ip': ip });

  it('treinta personas tras la misma IP en una hora reciben su código', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i < 30; i++) {
      if (i % 5 === 0) vi.setSystemTime(Date.now() + 61_000);
      expect(await allowOtpRequest(local.db, SECRET, `p${i}@example.test`, desde('203.0.113.7'), true, { invited: true })).toBe('permitido');
    }
  });

  it('el tope por IP + correo llega en la misma petición exista o no la invitación', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const invited of [true, false]) {
      const email = invited ? 'real@example.test' : 'inventada@example.test';
      const decisiones: string[] = [];
      for (let i = 0; i < 6; i++) {
        vi.setSystemTime(Date.now() + 61_000);
        decisiones.push(await allowOtpRequest(local.db, SECRET, email, desde(invited ? '198.51.100.1' : '198.51.100.2'), true, { invited }));
      }
      expect(decisiones.at(-1)).toBe('limitado');
      expect(decisiones.slice(0, 5)).not.toContain('limitado');
    }
  });

  it('el techo por IP es 120 por hora', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const resultados: string[] = [];
    for (let i = 0; i < 121; i++) {
      if (i % 5 === 0) vi.setSystemTime(Date.now() + 61_000);
      resultados.push(await allowOtpRequest(local.db, SECRET, `x${i}@example.test`, desde('192.0.2.50'), true, { invited: false }));
    }
    expect(resultados.slice(0, 120)).not.toContain('limitado');
    expect(resultados[120]).toBe('limitado');
  });

  it('el endpoint responde 429 igual a invitadas e inventadas', async () => {
    invite('real@example.test', 'athlete', null);
    const a = auth();
    const pedir = (email: string, ip: string) => a.handler(new Request(`${ORIGIN}/api/auth/${SEND}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ email, type: 'sign-in' }),
    }));
    const cuerpos: string[] = [];
    for (const [email, ip] of [['real@example.test', '198.51.100.9'], ['nadie@example.test', '198.51.100.10']]) {
      for (let i = 0; i < 5; i++) await pedir(email, ip);
      const r = await pedir(email, ip);
      expect(r.status).toBe(429);
      cuerpos.push(await r.text());
    }
    expect(cuerpos[0]).toBe(cuerpos[1]);
    expect(cuerpos[0]).toContain('DEMASIADOS_CODIGOS');
  });
});
