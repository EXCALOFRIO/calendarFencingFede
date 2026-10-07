import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  comprobarLimites, cookieDeSesion, LIMITADORES, REGLAS, respuestaDemasiadas, rutaNormalizada,
  type EntornoLimites, type Limitador, type NombreLimitador,
} from '@/lib/seguridad/limites';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';
import { TAREAS_CRON } from '@/lib/cron/programado';

const BASE = 'https://app.example.test';
const SESION = '__Secure-neon-auth.session_token=token-a.firma';

const app = vi.hoisted(() => ({ fetch: vi.fn(async (_r: Request) => new Response('{"ok":true}', { status: 200 })) }));
vi.mock('../.open-next/worker.js', () => ({ default: { fetch: app.fetch } }));
const cron = vi.hoisted(() => ({ reclamar: vi.fn(async () => true), cerrar: vi.fn(async () => {}) }));
vi.mock('../src/lib/cron/almacen-d1', () => ({ crearAlmacenCronD1: async () => cron }));

function limitador(maximo: number) {
  const cuentas = new Map<string, number>();
  const limit = vi.fn(async ({ key }: { key: string }) => {
    const n = (cuentas.get(key) ?? 0) + 1;
    cuentas.set(key, n);
    return { success: n <= maximo };
  });
  return { limit } satisfies Limitador;
}

type Env = Required<{ [K in NombreLimitador]: ReturnType<typeof limitador> }>;
function entorno(maximos: Partial<Record<NombreLimitador, number>> = {}): Env {
  const env: Record<string, ReturnType<typeof limitador>> = {};
  for (const nombre of LIMITADORES) env[nombre] = limitador(maximos[nombre] ?? 1000);
  return env as Env;
}

function peticion(ruta: string, init: RequestInit & { ip?: string; cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', init.ip ?? '198.51.100.7');
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(`${BASE}${ruta}`, { ...init, headers });
}

const claveDe = (env: Env, nombre: NombreLimitador) => env[nombre].limit.mock.calls.map((c) => c[0].key);

describe('cada ruta con su limitador y su clave', () => {
  const casos: [string, RequestInit & { cookie?: string }, NombreLimitador, RegExp][] = [
    ['/api/auth/get-session', {}, 'LIMITE_ACCESO', /^acceso:ip:198\.51\.100\.7$/],
    ['/api/auth/sign-in/email-otp', { method: 'POST', cookie: SESION }, 'LIMITE_ACCESO', /^acceso:ip:198\.51\.100\.7$/],
    ['/entrar', { method: 'POST', headers: { 'next-action': 'a' }, cookie: SESION }, 'LIMITE_ACCESO', /^acceso:ip:/],
    ['/api/cron/ingest/fie', {}, 'LIMITE_CRON', /^cron:ip:198\.51\.100\.7$/],
    ['/_next/image?url=%2Fx.png&w=64&q=75', { cookie: SESION }, 'LIMITE_IMAGENES', /^imagenes:ip:198\.51\.100\.7$/],
    ['/api/explorar/sugerencias?q=gar', { cookie: SESION }, 'LIMITE_SUGERENCIAS', /^sugerencias:s:[0-9a-f]{32}$/],
    ['/api/explorar/deportistas/abc/foto', { cookie: SESION }, 'LIMITE_FOTOS', /^fotos:s:[0-9a-f]{32}$/],
    ['/api/explorar/fotos', { method: 'POST', cookie: SESION }, 'LIMITE_FOTOS', /^fotos:s:[0-9a-f]{32}$/],
    ['/api/archivos/normativa/x.pdf', { cookie: SESION }, 'LIMITE_ARCHIVOS', /^archivos:s:[0-9a-f]{32}$/],
    ['/calendario', { method: 'POST', headers: { 'next-action': 'b' }, cookie: SESION }, 'LIMITE_ACCIONES', /^acciones:s:[0-9a-f]{32}$/],
    ['/calendario', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1', cookie: SESION }, 'LIMITE_ACCIONES', /^acciones:s:[0-9a-f]{32}$/],
    ['/calendario', { cookie: SESION }, 'LIMITE_PAGINAS', /^paginas:ip:198\.51\.100\.7$/],
    ['/api/notificaciones', { cookie: SESION }, 'LIMITE_PAGINAS', /^paginas:ip:198\.51\.100\.7$/],
  ];

  it.each(casos)('%s → %s', async (ruta, init, nombre, clave) => {
    const env = entorno();
    expect(await comprobarLimites(peticion(ruta, init), env)).toBeNull();
    for (const otro of LIMITADORES) {
      if (otro === nombre || otro === 'LIMITE_IP_SESION') continue;
      expect(env[otro].limit, otro).not.toHaveBeenCalled();
    }
    expect(claveDe(env, nombre)).toHaveLength(1);
    expect(claveDe(env, nombre)[0]).toMatch(clave);
  });

  it('las reglas tienen nombres únicos y cada limitador salvo el de IP por sesión tiene su regla', () => {
    const nombres = REGLAS.map((r) => r.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
    const usados = new Set(REGLAS.map((r) => r.limitador));
    expect(LIMITADORES.filter((l) => !usados.has(l))).toEqual(['LIMITE_IP_SESION']);
  });

  it('una foto de un deportista con barras de más en el id no escapa a la regla', async () => {
    expect(rutaNormalizada(new URL(`${BASE}/api//explorar///deportistas/abc/foto`))).toBe('/api/explorar/deportistas/abc/foto');
    const env = entorno({ LIMITE_FOTOS: 0 });
    expect((await comprobarLimites(peticion('/api//explorar///deportistas/abc/foto', { cookie: SESION }), env))?.status).toBe(429);
  });

  it('una ruta con un %xx mal formado se compara tal cual y sigue limitada', async () => {
    expect(rutaNormalizada(new URL(`${BASE}/api/auth/%E0%A4%A`))).toBe('/api/auth/%E0%A4%A');
    const env = entorno({ LIMITE_ACCESO: 0 });
    expect((await comprobarLimites(peticion('/api/auth/%E0%A4%A'), env))?.status).toBe(429);
  });

  it('sin cookie, una ruta por sesión cuenta por IP; con cookie vacía, también', async () => {
    const env = entorno();
    await comprobarLimites(peticion('/api/archivos/a.pdf'), env);
    await comprobarLimites(peticion('/api/archivos/a.pdf', { cookie: '__Secure-neon-auth.session_token=' }), env);
    expect(claveDe(env, 'LIMITE_ARCHIVOS')).toEqual(['archivos:ip:198.51.100.7', 'archivos:ip:198.51.100.7']);
  });

  it('la cookie de QA y la de sesión local (http) también cuentan como sesión, cada una con su huella', async () => {
    const qa = peticion('/api/archivos/a.pdf', { cookie: `otra=1; ${COOKIE_ACCESO_QA}=qa-token` });
    const local = peticion('/api/archivos/a.pdf', { cookie: 'neon-auth.session_token=local-token' });
    expect(cookieDeSesion(qa)).toBe('qa-token');
    expect(cookieDeSesion(local)).toBe('local-token');
    const env = entorno();
    await comprobarLimites(qa, env);
    await comprobarLimites(local, env);
    const [a, b] = claveDe(env, 'LIMITE_ARCHIVOS');
    expect(a).toMatch(/^archivos:s:/);
    expect(b).toMatch(/^archivos:s:/);
    expect(a).not.toBe(b);
  });

  it('el nombre de la cookie se compara entero: «x__Secure-neon-auth.session_token» no es una sesión', () => {
    expect(cookieDeSesion(peticion('/', { cookie: 'x__Secure-neon-auth.session_token=falsa' }))).toBeNull();
  });
});

describe('cookie inventada en cada petición frente al tope por IP', () => {
  it('cuando salta el tope por IP no se llega a consultar el limitador de la ruta', async () => {
    const env = entorno({ LIMITE_IP_SESION: 2 });
    let i = 0;
    const crear = () => peticion('/api/explorar/sugerencias?q=x', { cookie: `__Secure-neon-auth.session_token=inv-${i++}` });
    const estados: number[] = [];
    for (let n = 0; n < 5; n++) estados.push((await comprobarLimites(crear(), env))?.status ?? 200);
    expect(estados).toEqual([200, 200, 429, 429, 429]);
    expect(env.LIMITE_SUGERENCIAS.limit).toHaveBeenCalledTimes(2);
    // Cinco cookies distintas: cinco claves de sesión nuevas, y aun así cortadas.
    expect(new Set(claveDe(env, 'LIMITE_SUGERENCIAS')).size).toBe(2);
  });

  it('el tope por IP es común a todas las rutas por sesión', async () => {
    const env = entorno({ LIMITE_IP_SESION: 3 });
    const rutas = ['/api/explorar/fotos', '/api/archivos/a.pdf', '/api/explorar/sugerencias', '/api/explorar/deportistas/x/foto'];
    const estados: number[] = [];
    for (const ruta of rutas) estados.push((await comprobarLimites(peticion(ruta, { cookie: SESION }), env))?.status ?? 200);
    expect(estados).toEqual([200, 200, 200, 429]);
  });

  it('otra IP con su propia cookie no queda afectada', async () => {
    const env = entorno({ LIMITE_IP_SESION: 1 });
    expect((await comprobarLimites(peticion('/api/archivos/a.pdf', { cookie: SESION, ip: '203.0.113.1' }), env))).toBeNull();
    expect((await comprobarLimites(peticion('/api/archivos/a.pdf', { cookie: SESION, ip: '203.0.113.1' }), env))?.status).toBe(429);
    expect((await comprobarLimites(peticion('/api/archivos/a.pdf', { cookie: SESION, ip: '203.0.113.2' }), env))).toBeNull();
  });

  it('las rutas por IP (acceso, cron) no pasan por el tope por sesión', async () => {
    const env = entorno({ LIMITE_IP_SESION: 0 });
    expect(await comprobarLimites(peticion('/api/auth/get-session', { cookie: SESION }), env)).toBeNull();
    expect(await comprobarLimites(peticion('/api/cron/notify'), env)).toBeNull();
    expect(env.LIMITE_IP_SESION.limit).not.toHaveBeenCalled();
  });

  it('sin cf-connecting-ip, todas comparten el contador «sin-ip» (no se fía de x-forwarded-for)', async () => {
    const env = entorno({ LIMITE_ACCESO: 1 });
    const sinIp = (xff: string) => new Request(`${BASE}/api/auth/get-session`, { headers: { 'x-forwarded-for': xff } });
    expect(await comprobarLimites(sinIp('1.1.1.1'), env)).toBeNull();
    expect((await comprobarLimites(sinIp('2.2.2.2'), env))?.status).toBe(429);
    expect(claveDe(env, 'LIMITE_ACCESO')[0]).toBe('acceso:ip:sin-ip');
  });
});

describe('429 con Retry-After', () => {
  it.each([
    ['/api/archivos/a.pdf', {}, 'application/json'],
    ['/_next/image?url=x', { cookie: SESION }, 'application/json'],
    ['/calendario', { method: 'POST', headers: { 'next-action': 'x' } }, 'application/json'],
    ['/entrar', { method: 'POST' }, 'text/plain'],
  ] as const)('%s responde 429 con Retry-After en segundos y sin caché', async (ruta, init, tipo) => {
    const env = entorno();
    for (const n of LIMITADORES) env[n] = limitador(0);
    const r = (await comprobarLimites(peticion(ruta, init as RequestInit & { cookie?: string }), env))!;
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Content-Type')).toContain(tipo);
  });

  it('a un HEAD de página se le responde sin cuerpo', async () => {
    const r = respuestaDemasiadas(new Request(`${BASE}/entrar`, { method: 'HEAD' }), '/entrar');
    expect(r.status).toBe(429);
    expect(await r.text()).toBe('');
  });

  it('el cuerpo JSON no lleva la clave, la IP ni la cookie', async () => {
    const env = entorno({ LIMITE_ARCHIVOS: 0 });
    const r = (await comprobarLimites(peticion('/api/archivos/a.pdf', { cookie: SESION }), env))!;
    const texto = await r.text();
    expect(texto).not.toMatch(/198\.51|token-a|archivos:s:/);
    expect(JSON.parse(texto)).toEqual({ ok: false, estado: 'demasiadas_peticiones', error: expect.any(String) });
  });

  it('un limitador que tarda en contestar con error deja pasar (falla abierto: es un freno, no una cuota)', async () => {
    const env: EntornoLimites = { LIMITE_ACCESO: { limit: async () => Promise.reject(new Error('timeout')) } };
    expect(await comprobarLimites(peticion('/api/auth/get-session'), env)).toBeNull();
  });
});

describe.skipIf(!existsSync(new URL('../.open-next/worker.js', import.meta.url)))('worker/index.ts', () => {
  beforeEach(() => {
    app.fetch.mockClear();
    cron.reclamar.mockClear();
    cron.cerrar.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const db = { prepare: () => ({}) };
  const ctx = { waitUntil: () => {} };

  it('el fetch HTTP pasa por los límites antes de llegar a la aplicación', async () => {
    const worker = (await import('../worker/index')).default;
    const env = { ...entorno({ LIMITE_CRON: 0 }) };
    const r = await worker.fetch(peticion('/api/cron/notify'), env as never, ctx);
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('60');
    expect(app.fetch).not.toHaveBeenCalled();
    expect((await worker.fetch(peticion('/'), env as never, ctx)).status).toBe(200);
    expect(app.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(Object.entries(TAREAS_CRON))('el cron programado «%s» llama a %s sin pasar por ningún limitador', async (expresion, ruta) => {
    const worker = (await import('../worker/index')).default;
    const env = { ...entorno(Object.fromEntries(LIMITADORES.map((n) => [n, 0]))), DB: db, CRON_SECRET: 'secreto-cron', NEXT_PUBLIC_APP_URL: 'https://app.example.test/' };
    await worker.scheduled({ cron: expresion, scheduledTime: Date.UTC(2026, 2, 1, 7) }, env as never, ctx);
    expect(app.fetch).toHaveBeenCalledTimes(1);
    const pedida = app.fetch.mock.calls[0][0];
    expect(new URL(pedida.url).pathname).toBe(ruta);
    expect(pedida.headers.get('authorization')).toBe('Bearer secreto-cron');
    for (const n of LIMITADORES) expect(env[n].limit).not.toHaveBeenCalled();
    expect(cron.cerrar).toHaveBeenCalledWith(expect.objectContaining({ tarea: ruta }), expect.objectContaining({ estado: 'completada' }));
  });

  it('en mantenimiento, el HTTP responde 503 sin consultar límites y el cron no se ejecuta', async () => {
    const worker = (await import('../worker/index')).default;
    const env = { ...entorno(), MIGRATION_MAINTENANCE: 'true', DB: db, CRON_SECRET: 's' };
    const r = await worker.fetch(peticion('/api/auth/get-session'), env as never, ctx);
    expect(r.status).toBe(503);
    expect(env.LIMITE_ACCESO.limit).not.toHaveBeenCalled();
    await worker.scheduled({ cron: '0 7 * * *', scheduledTime: Date.UTC(2026, 2, 1, 7) }, env as never, ctx);
    expect(app.fetch).not.toHaveBeenCalled();
  });
});
