import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  comprobarLimites, conLimites, LIMITADORES, rutaNormalizada, type EntornoLimites, type Limitador,
} from '@/lib/seguridad/limites';

const BASE = 'https://app.example.test';
const SESION = '__Secure-neon-auth.session_token=token-sintetico.firma';

/** Limitador en memoria con la misma semántica que el binding: N por clave. */
function limitador(maximo: number) {
  const cuentas = new Map<string, number>();
  const limit = vi.fn(async ({ key }: { key: string }) => {
    const n = (cuentas.get(key) ?? 0) + 1;
    cuentas.set(key, n);
    return { success: n <= maximo };
  });
  return { limit } satisfies Limitador;
}

function entorno(maximos: Partial<Record<(typeof LIMITADORES)[number], number>> = {}) {
  const env: Record<string, ReturnType<typeof limitador>> = {};
  for (const nombre of LIMITADORES) env[nombre] = limitador(maximos[nombre] ?? 1000);
  return env as Required<{ [K in keyof EntornoLimites]: ReturnType<typeof limitador> }>;
}

function peticion(ruta: string, init: RequestInit & { ip?: string; cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', init.ip ?? '192.0.2.10');
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(`${BASE}${ruta}`, { ...init, headers });
}

async function repetir(n: number, crear: () => Request, env: EntornoLimites) {
  const estados: number[] = [];
  for (let i = 0; i < n; i++) estados.push((await comprobarLimites(crear(), env))?.status ?? 200);
  return estados;
}

describe('límites de peticiones del Worker', () => {
  it('acceso: por IP en /api/auth/* y en el POST de /entrar, no en el GET', async () => {
    const env = entorno({ LIMITE_ACCESO: 2 });
    expect(await repetir(3, () => peticion('/api/auth/email-otp/send-verification-otp', { method: 'POST' }), env))
      .toEqual([200, 200, 429]);
    expect(await repetir(1, () => peticion('/entrar', { method: 'POST', headers: { 'next-action': 'x' } }), env))
      .toEqual([429]);
    expect(await repetir(1, () => peticion('/entrar', { method: 'POST', ip: '192.0.2.11' }), env)).toEqual([200]);
    expect(await repetir(5, () => peticion('/entrar'), env)).toEqual([200, 200, 200, 200, 200]);
    expect(env.LIMITE_ACCIONES.limit).not.toHaveBeenCalled();
  });

  it('la clave por IP sale de cf-connecting-ip, no de x-forwarded-for', async () => {
    const env = entorno({ LIMITE_CRON: 1 });
    await comprobarLimites(peticion('/api/cron/notify', { headers: { 'x-forwarded-for': '1.1.1.1' } }), env);
    const r = await comprobarLimites(peticion('/api/cron/notify', { headers: { 'x-forwarded-for': '2.2.2.2' } }), env);
    expect(r?.status).toBe(429);
    expect(env.LIMITE_CRON.limit.mock.calls[0][0].key).toBe('cron:ip:192.0.2.10');
  });

  it('las rutas por sesión cuentan por la huella de la cookie y nunca la guardan en claro', async () => {
    const env = entorno({ LIMITE_SUGERENCIAS: 2 });
    const crear = (ip: string) => peticion('/api/explorar/sugerencias?q=abc', { cookie: SESION, ip });
    expect(await repetir(2, () => crear('192.0.2.1'), env)).toEqual([200, 200]);
    // Otra IP, misma sesión: mismo contador.
    expect((await comprobarLimites(crear('192.0.2.2'), env))?.status).toBe(429);
    const clave = env.LIMITE_SUGERENCIAS.limit.mock.calls[0][0].key;
    expect(clave).toMatch(/^sugerencias:s:[0-9a-f]{32}$/);
    expect(clave).not.toContain('token-sintetico');
  });

  it.each([
    ['/api/explorar/deportistas/0b6c3c43-0000-4000-8000-000000000000/foto', 'LIMITE_FOTOS'],
    ['/api/explorar/fotos', 'LIMITE_FOTOS'],
    ['/api/archivos/convocatorias/e/x.pdf', 'LIMITE_ARCHIVOS'],
    ['/api/explorar/sugerencias', 'LIMITE_SUGERENCIAS'],
  ] as const)('%s usa %s', async (ruta, binding) => {
    const env = entorno();
    await comprobarLimites(peticion(ruta, { cookie: SESION }), env);
    expect(env[binding].limit).toHaveBeenCalledTimes(1);
    expect(env.LIMITE_IP_SESION.limit).toHaveBeenCalledTimes(1);
  });

  it('una cookie inventada en cada petición no evita el tope por IP', async () => {
    const env = entorno({ LIMITE_IP_SESION: 3 });
    let i = 0;
    const estados = await repetir(4, () => peticion('/api/archivos/convocatorias/e/x.pdf', {
      cookie: `__Secure-neon-auth.session_token=inventada-${i++}`,
    }), env);
    expect(estados).toEqual([200, 200, 200, 429]);
  });

  it('acciones de servidor: POST con Next-Action, por sesión', async () => {
    const env = entorno({ LIMITE_ACCIONES: 1 });
    const crear = () => peticion('/explorar', { method: 'POST', headers: { 'next-action': 'abc' }, cookie: SESION });
    expect(await repetir(2, crear, env)).toEqual([200, 429]);
    expect(await repetir(2, () => peticion('/explorar', { cookie: SESION }), env)).toEqual([200, 200]);
  });

  it('/_next/image exige cookie de sesión y limita por IP', async () => {
    const env = entorno({ LIMITE_IMAGENES: 1 });
    const anonima = await comprobarLimites(peticion('/_next/image?url=x&w=640&q=75'), env);
    expect(anonima?.status).toBe(401);
    expect(env.LIMITE_IMAGENES.limit).not.toHaveBeenCalled();
    expect(await repetir(2, () => peticion('/_next/image?url=x&w=640&q=75', { cookie: SESION }), env)).toEqual([200, 429]);
  });

  it.each(['/api/%61uth/sign-out', '/api//auth/sign-out', '//api/auth/get-session'])(
    'una ruta disfrazada (%s) cae en la misma regla', async (ruta) => {
      expect(rutaNormalizada(new URL(`${BASE}${ruta}`))).toMatch(/^\/api\/auth\//);
      const env = entorno({ LIMITE_ACCESO: 0 });
      expect((await comprobarLimites(peticion(ruta), env))?.status).toBe(429);
    },
  );

  it('el 429 es limpio: JSON en la API, texto en páginas, sin caché y con Retry-After', async () => {
    const env = entorno({ LIMITE_ACCESO: 0 });
    const api = (await comprobarLimites(peticion('/api/auth/get-session'), env))!;
    expect(api.status).toBe(429);
    expect(api.headers.get('Retry-After')).toBe('60');
    expect(api.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await api.json()).toMatchObject({ ok: false, estado: 'demasiadas_peticiones' });
    const pagina = (await comprobarLimites(peticion('/entrar', { method: 'POST' }), env))!;
    expect(pagina.headers.get('Content-Type')).toContain('text/plain');
    expect(await pagina.text()).toContain('Espera un minuto');
  });

  it('sin bindings (local, pruebas) o si la API falla, se sirve', async () => {
    expect(await comprobarLimites(peticion('/api/auth/get-session'), {})).toBeNull();
    const roto = { limit: vi.fn(async () => { throw new Error('caida'); }) };
    expect(await comprobarLimites(peticion('/api/auth/get-session'), { LIMITE_ACCESO: roto })).toBeNull();
  });

  it('el resto de rutas no consulta ningún limitador', async () => {
    const env = entorno();
    for (const ruta of ['/', '/explorar', '/calendario', '/api/calendario/abc.ics']) {
      expect(await comprobarLimites(peticion(ruta, { cookie: SESION }), env)).toBeNull();
    }
    for (const nombre of LIMITADORES) expect(env[nombre].limit).not.toHaveBeenCalled();
  });

  it('conLimites corta antes de servir', async () => {
    const servir = vi.fn(async () => new Response('ok'));
    const worker = conLimites(servir);
    const env = entorno({ LIMITE_CRON: 0 });
    expect((await worker(peticion('/api/cron/notify'), env, {})).status).toBe(429);
    expect(servir).not.toHaveBeenCalled();
    expect((await worker(peticion('/'), env, {})).status).toBe(200);
    expect(servir).toHaveBeenCalledTimes(1);
  });

  it('wrangler.jsonc declara cada binding con periodo válido y un techo de CPU', () => {
    const texto = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    for (const nombre of LIMITADORES) {
      expect(texto).toMatch(new RegExp(`"name": "${nombre}", "namespace_id": "\\d+", "simple": \\{ "limit": \\d+, "period": 60 \\}`));
    }
    expect(texto).toMatch(/"limits": \{\s*"cpu_ms": \d+\s*\}/);
    const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
    expect(worker).toContain('conLimites(servir)');
    // El scheduled sigue llamando a la aplicación sin pasar por los límites.
    expect(worker).toContain('crearManejadorProgramado({ servir,');
  });
});
