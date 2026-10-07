import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1Database, type Db } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { athlete, fieClasificacion, fieFencer, userProfile } from '@/db/schema';
import { solicitarVinculo } from '@/lib/altas/solicitudes';
import { athleteLinkRequest } from '@/lib/altas/solicitudes-schema';
import { resolverSolicitudVinculo } from '@/app/(app)/admin/usuarios/actions';
import { cancelarSolicitudVinculo, confirmarQueSoyYo } from '@/app/(app)/alta/acciones';
import { SolicitudesVinculo } from '@/components/admin/solicitudes-vinculo';
import type { SessionProfile } from '@/lib/auth/session';

const contexto = vi.hoisted(() => ({
  database: null as Db | null,
  perfil: null as SessionProfile | null,
}));
vi.mock('@/db', () => ({
  db: new Proxy({}, {
    get(_target, key) {
      if (!contexto.database) throw new Error('fixture_database_missing');
      const value = Reflect.get(contexto.database, key);
      return typeof value === 'function' ? value.bind(contexto.database) : value;
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const cache = vi.hoisted(() => ({ invalidarCacheSinFallar: vi.fn(async () => {}) }));
vi.mock('@/lib/cache', () => cache);
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw Object.assign(new Error('TEST_REDIRECT'), { url }); },
}));
vi.mock('@/lib/auth/session', () => {
  const requireProfile = async () => {
    if (!contexto.perfil) throw new Error('NO_AUTENTICADO');
    return contexto.perfil;
  };
  const requireWritableProfile = async () => {
    const profile = await requireProfile();
    if (profile.preview || profile.qa) throw new Error('SOLO_LECTURA');
    return profile;
  };
  const requireRole = async (...roles: string[]) => {
    const profile = await requireProfile();
    if (!roles.includes(profile.role)) throw new Error('NO_PERMITIDO');
    return profile;
  };
  return {
    requireProfile, requireWritableProfile, requireRole,
    requireWritableRole: async (...roles: string[]) => {
      await requireRole(...roles);
      return requireWritableProfile();
    },
    newIcalToken: () => 'synthetic-token',
  };
});

let local: ReturnType<typeof localD1>;
let database: Db;
function sesion(id: string, role: SessionProfile['role'] = 'athlete'): SessionProfile {
  return { profileId: id, role, authUserId: `provider-${id}`, email: `${id}@example.invalid`,
    fullName: 'Persona sintética', clubId: null, clubName: null, icalToken: '', weapons: [] };
}
beforeEach(async () => {
  local = localD1();
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0003_vinculos_revisados.sql', import.meta.url), 'utf8'));
  database = createD1Database(local.binding);
  contexto.database = database;
  contexto.perfil = sesion('a');
  await database.insert(userProfile).values([
    { id: 'a', email: 'a@example.invalid', fullName: 'Persona sintética A', role: 'athlete', icalToken: 'ical-a' },
    { id: 'b', email: 'b@example.invalid', fullName: 'Persona sintética B', role: 'athlete', icalToken: 'ical-b' },
    { id: 'admin', email: 'admin@example.invalid', fullName: 'Admin sintético', role: 'admin', icalToken: 'ical-admin' },
  ]);
  await database.insert(athlete).values({ id: 'tirador', firstName: 'Persona', lastName: 'Sintética',
    gender: 'M', birthDate: '2000-01-01' });
  await database.insert(fieFencer).values({
    fieId: 101, athleteId: 'tirador', sourceName: 'PERSONA SINTETICA', countryCode: 'ESP',
    sourceBirthDate: '2000-01-01', profileUrl: 'https://fie.org/athletes/101', contentHash: 'fixture',
  });
  await database.insert(fieClasificacion).values({
    fieId: 101, season: 2026, weapon: 'ESPADA', gender: 'M', category: 'ABS',
    categoryRaw: 'ABS', format: 'INDIVIDUAL', contentHash: 'fixture',
  });
});
afterEach(() => { contexto.database = null; contexto.perfil = null; local.close(); });

async function solicitud(profileId = 'a') {
  const result = await solicitarVinculo({ profileId, clave: 'fie:101', nombreEscrito: '' }, database);
  if (!result.ok) throw new Error('fixture_request_failed');
  return result.solicitudId;
}
function formulario(id: string, decision = 'aprobar') {
  const datos = new FormData();
  datos.set('solicitudId', id);
  datos.set('decision', decision);
  datos.set('evidencia', 'Identidad verificada mediante un canal independiente sintético.');
  datos.set('verificada', 'si');
  return datos;
}

describe('frontera de acciones para revisión de identidad', () => {
  it('la declaración propia ignora perfiles y aprobadores falsificados en el formulario', async () => {
    const datos = new FormData();
    datos.set('clave', 'fie:101');
    datos.set('escrito', 'Persona sintética');
    datos.set('profileId', 'b');
    datos.set('adminProfileId', 'admin');
    await expect(confirmarQueSoyYo(datos)).rejects.toMatchObject({ url: '/alta?q=Persona%20sint%C3%A9tica&pendiente=1' });
    expect(await database.select().from(athleteLinkRequest)).toMatchObject([{ profileId: 'a', state: 'PENDIENTE' }]);
    expect(await database.select().from(athlete)).toMatchObject([{ userProfileId: null }]);
  });

  it.each([null, sesion('a'), { ...sesion('admin', 'admin'), preview: { adminProfileId: 'admin', expiresAt: Date.now() + 60_000 } }])
  ('una sesión ausente, no admin o de solo lectura no puede revisar', async (perfil) => {
    const id = await solicitud();
    contexto.perfil = perfil;
    local.calls.length = 0;
    await expect(resolverSolicitudVinculo(formulario(id))).rejects.toThrow();
    expect(local.calls).toEqual([]);
  });

  it('el administrador no puede cambiar destinatario ni fuente con campos adicionales', async () => {
    const id = await solicitud();
    contexto.perfil = sesion('admin', 'admin');
    const datos = formulario(id);
    datos.set('profileId', 'b');
    datos.set('clave', 'rfee:otro');
    datos.set('adminProfileId', 'b');
    cache.invalidarCacheSinFallar.mockClear();
    expect(await resolverSolicitudVinculo(datos)).toMatchObject({ ok: true });
    // Ha escrito athlete y fie_fencer: las fichas y el ranking FIE cacheados dejan de servirse.
    expect(cache.invalidarCacheSinFallar).toHaveBeenCalledWith(['deporte', 'ranking-fie'], 'vinculo');
    expect(await database.select().from(athlete)).toMatchObject([{ userProfileId: 'a', linkedByProfileId: 'admin' }]);
    expect(await database.select().from(athleteLinkRequest)).toMatchObject([{
      state: 'APROBADA', reviewedByProfileId: 'admin', sourceKey: 'fie:101',
    }]);
  });

  it('aprobar exige verificación independiente y una explicación suficientemente concreta', async () => {
    const id = await solicitud();
    contexto.perfil = sesion('admin', 'admin');
    const datos = formulario(id);
    datos.delete('verificada');
    expect(await resolverSolicitudVinculo(datos)).toMatchObject({ ok: false });
    datos.set('verificada', 'si');
    datos.set('evidencia', 'nombre igual');
    expect(await resolverSolicitudVinculo(datos)).toMatchObject({ ok: false });
    expect(await database.select().from(athlete)).toMatchObject([{ userProfileId: null }]);
  });

  it('rechazar deja un rastro sin modificar ficha, armas o enlaces', async () => {
    const id = await solicitud();
    contexto.perfil = sesion('admin', 'admin');
    cache.invalidarCacheSinFallar.mockClear();
    expect(await resolverSolicitudVinculo(formulario(id, 'rechazar'))).toMatchObject({ ok: true });
    expect(cache.invalidarCacheSinFallar).not.toHaveBeenCalled();
    expect(await database.select().from(athlete)).toMatchObject([{ userProfileId: null }]);
    expect(await database.select().from(athleteLinkRequest)).toMatchObject([{
      state: 'RECHAZADA', reviewedByProfileId: 'admin', athleteId: null,
    }]);
  });

  it('cancelar solo afecta a la solicitud de la sesión y conserva el rastro', async () => {
    await solicitud('a');
    await solicitud('b');
    await expect(cancelarSolicitudVinculo()).rejects.toMatchObject({ url: '/alta' });
    const rows = await database.select().from(athleteLinkRequest);
    expect(rows.find((row) => row.profileId === 'a')).toMatchObject({ state: 'RECHAZADA', reviewedByProfileId: 'a' });
    expect(rows.find((row) => row.profileId === 'b')).toMatchObject({ state: 'PENDIENTE', reviewedByProfileId: null });
  });

  it('la bandeja muestra evidencia, estado y controles accesibles sin afirmar una vinculación inmediata', () => {
    const html = renderToStaticMarkup(createElement(SolicitudesVinculo, { solicitudes: [{
      id: crypto.randomUUID(), profileId: 'a', cuenta: 'Cuenta sintética', email: 'a@example.invalid',
      clave: 'fie:101', solicitada: Date.now(), nombreFuente: 'Persona sintética', anio: 2000,
    }] }));
    expect(html).toContain('Verifica la identidad por una vía independiente');
    expect(html).toContain('Aprobar vinculación');
    expect(html).toContain('Rechazar solicitud');
    expect(html).toContain('name="evidencia"');
    expect(html).toContain('name="verificada"');
    expect(html).not.toContain('2000-01-01');
  });
});
