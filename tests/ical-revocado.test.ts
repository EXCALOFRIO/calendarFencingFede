import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localAuthDatabase } from './d1-auth-local';

const h = vi.hoisted(() => ({
  local: null as null | ReturnType<typeof import('./d1-auth-local').localAuthDatabase>,
  requireWritableRole: vi.fn(),
}));

vi.mock('@/db', () => ({
  get db() {
    return h.local!.db;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  getManagedAthletes: vi.fn(async () => []),
  requireWritableRole: h.requireWritableRole,
  newIcalToken: () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().slice(0, 8),
}));
vi.mock('@/lib/queries/calendar', () => ({
  getCurrentSeason: vi.fn(async () => null),
  listEvents: vi.fn(async () => []),
}));

import { GET } from '@/app/api/calendario/[token]/route';
import { revocarAcceso } from '@/app/(app)/admin/ajustes/actions';

const TOKEN = 'a'.repeat(32);

function perfil(id: string, role: string, status: string, token = `${id}-${'x'.repeat(24)}`) {
  h.local!.sqlite.prepare(`INSERT INTO user_profile (id,email,full_name,role,invite_status,ical_token)
    VALUES (?,?,?,?,?,?)`).run(id, `${id}@example.test`, `Perfil ${id}`, role, status, token);
}

function feed(token: string) {
  return GET(new Request(`https://app.example.test/api/calendario/${token}.ics`), {
    params: Promise.resolve({ token: `${token}.ics` }),
  });
}

beforeEach(() => {
  h.local = localAuthDatabase();
  h.requireWritableRole.mockResolvedValue({ profileId: 'admin-1', role: 'admin' });
});
afterEach(() => h.local!.sqlite.close());

describe('feed iCal de cuentas revocadas o sin rol válido', () => {
  it.each(['admin', 'coach', 'athlete'])('una cuenta %s activa recibe su feed', async (role) => {
    perfil('p1', role, 'aceptada', TOKEN);
    const res = await feed(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
  });

  it('una cuenta revocada recibe 404 aunque conserve el token', async () => {
    perfil('p1', 'athlete', 'revocada', TOKEN);
    const res = await feed(TOKEN);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('BEGIN:VCALENDAR');
  });

  it.each(['club', 'guardian'])('un rol sin acceso a la app (%s) recibe 404', async (role) => {
    perfil('p1', role, 'aceptada', TOKEN);
    expect((await feed(TOKEN)).status).toBe(404);
  });

  it('revocar el acceso rota el token y la URL suscrita deja de servir', async () => {
    perfil('admin-1', 'admin', 'aceptada');
    perfil('admin-2', 'admin', 'aceptada');
    perfil('p1', 'athlete', 'aceptada', TOKEN);
    expect((await feed(TOKEN)).status).toBe(200);

    const r = await revocarAcceso('p1');
    expect(r.ok).toBe(true);
    const fila = h.local!.sqlite.prepare("SELECT ical_token, invite_status FROM user_profile WHERE id='p1'").get()!;
    expect(fila.invite_status).toBe('revocada');
    expect(fila.ical_token).not.toBe(TOKEN);
    expect(String(fila.ical_token).length).toBeGreaterThanOrEqual(32);
    expect((await feed(TOKEN)).status).toBe(404);
    // El registro de cambios no guarda el token nuevo.
    const log = h.local!.sqlite.prepare('SELECT * FROM config_change_log').all();
    expect(JSON.stringify(log)).not.toContain(String(fila.ical_token));
  });
});
