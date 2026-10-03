import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { conMantenimiento } from '@/lib/cron/mantenimiento';
import corte from '../worker/mantenimiento-corte';

describe('corte D1 sin perder escrituras posteriores al snapshot', () => {
  const ctx = { waitUntil: vi.fn() };
  const event = { cron: '0 7 * * *', scheduledTime: 0 };
  it.each(['true', 'TRUE', '', 'valor-no-valido'])(
    'con %s bloquea GET, POST y HEAD antes de tocar el runtime o los crons',
    async (flag) => {
      const fetch = vi.fn(async () => new Response('fixture'));
      const scheduled = vi.fn(async () => {});
      const worker = conMantenimiento(fetch, scheduled);
      for (const method of ['GET', 'POST', 'HEAD']) {
        const response = await worker.fetch(new Request('https://fixture.test/api/auth/sign-in/email-otp', { method }), { MIGRATION_MAINTENANCE: flag }, ctx);
        expect(response.status).toBe(503);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Retry-After')).toBe('120');
        if (method === 'HEAD') expect(await response.text()).toBe('');
      }
      await worker.scheduled(event, { MIGRATION_MAINTENANCE: flag }, ctx);
      expect(fetch).not.toHaveBeenCalled();
      expect(scheduled).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 'false'])('fuera del corte conserva fetch y scheduled sin cambiar rutas', async (flag) => {
    const fetch = vi.fn(async () => new Response('fixture'));
    const scheduled = vi.fn(async () => {});
    const worker = conMantenimiento(fetch, scheduled);
    const response = await worker.fetch(new Request('https://fixture.test/'), { MIGRATION_MAINTENANCE: flag }, ctx);
    expect(await response.text()).toBe('fixture');
    await worker.scheduled(event, { MIGRATION_MAINTENANCE: flag }, ctx);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });
  it.each(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'])('el corte independiente bloquea %s sin cargar la aplicación', async (method) => {
    const request = new Request('https://fixture.test/api/auth/sign-in/email-otp', { method });
    const response = corte.fetch(request);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Estamos actualizando el calendario. Vuelve a intentarlo en unos minutos.');
    await expect(corte.scheduled()).resolves.toBeUndefined();
    const source = readFileSync(new URL('../worker/mantenimiento-corte.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/import[^;\n]*(?:open-next|\/db|\/auth|programado)/);
  });
  it('la configuración de corte no instala D1, assets, secretos ni disparos programados', () => {
    const text = readFileSync(new URL('../wrangler.mantenimiento.jsonc', import.meta.url), 'utf8');
    const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
    expect(config.name).toBe('calendario-fie-fede');
    expect(config.account_id).toBe('52d39cf14bc17b94754729436036124d');
    expect(config.main).toBe('worker/mantenimiento-corte.ts');
    expect(config.keep_vars).toBe(true);
    expect(config.triggers.crons).toEqual([]);
    for (const binding of ['assets', 'd1_databases', 'r2_buckets', 'vars']) expect(config).not.toHaveProperty(binding);
  });
});
