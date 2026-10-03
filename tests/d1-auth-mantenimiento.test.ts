import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { localD1 } from '@/db/d1/testing';
const contexto = vi.hoisted(() => ({ binding: undefined as unknown }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { DB: contexto.binding } }) }));
import { limpiarAutenticacionCaducada } from '@/lib/auth/mantenimiento';
let local: ReturnType<typeof localD1>;
beforeEach(() => {
  local = localD1(); contexto.binding = local.binding;
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0001_auth.sql', import.meta.url), 'utf8'));
  local.sqlite.exec("INSERT INTO user_profile (id,email,full_name,role,ical_token) VALUES ('perfil','fixture@example.invalid','Fixture','admin','feed-sintetico')");
});
afterEach(() => { contexto.binding = undefined; local.close(); });
function caducados(cantidad: number) {
  const antes = Date.now() - 60_000;
  for (let i = 0; i < cantidad; i++) {
    local.sqlite.prepare('INSERT INTO auth_throttle (key,count,window_start,expires_at) VALUES (?,1,1,?)').run(`limite-${i}`, antes + i);
    local.sqlite.prepare('INSERT INTO auth_otp_challenge (key,generation,attempts,ready,expires_at) VALUES (?,?,1,1,?)').run(`reto-${i}`, `generacion-${i}`, antes + i);
  }
}
describe('bounded maintenance of app-side abuse controls, never managed auth', () => {
  it('removes expired counters without touching live rows or application profiles', async () => {
    caducados(2); const futuro = Date.now() + 60_000;
    local.sqlite.prepare('INSERT INTO auth_throttle (key,count,window_start,expires_at) VALUES (?,1,1,?)').run('vigente', futuro);
    local.sqlite.prepare('INSERT INTO auth_otp_challenge (key,generation,attempts,ready,expires_at) VALUES (?,?,1,1,?)').run('vigente', 'generacion', futuro);
    expect(await limpiarAutenticacionCaducada()).toBe(4);
    for (const tabla of ['user_profile', 'auth_throttle', 'auth_otp_challenge']) expect(local.sqlite.prepare(`SELECT count(*) AS n FROM ${tabla}`).get()!.n).toBe(1);
    expect(local.calls.every((c) => c.parameters <= 100 && !/auth_session|auth_verification|neon_auth/.test(c.sql))).toBe(true);
  });
  it('bounds each table and can continue safely', async () => {
    caducados(8);
    expect(await limpiarAutenticacionCaducada(3)).toBe(6);
    expect(await limpiarAutenticacionCaducada(3)).toBe(6);
    expect(await limpiarAutenticacionCaducada(3)).toBe(4);
    expect(await limpiarAutenticacionCaducada(3)).toBe(0);
  });
  it.each([0, -1, 501, Number.NaN, 1.5])('refuses invalid limits: %s', async (limite) => {
    await expect(limpiarAutenticacionCaducada(limite)).rejects.toThrow('no válido');
    expect(local.calls).toEqual([]);
  });
  it('fails closed without the binding', async () => {
    contexto.binding = undefined;
    await expect(limpiarAutenticacionCaducada()).rejects.toThrow('binding');
  });
  it('does not claim successful cleanup when the schema is missing', async () => {
    local.sqlite.exec('DROP TABLE auth_throttle');
    await expect(limpiarAutenticacionCaducada()).rejects.toThrow();
  });
});
