import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createD1Database, type Db } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import type { D1Statement } from '@/db/d1/binding';
import { athlete, athleteWeapon, club, fieClasificacion, fieFencer, officialRankingEntry, userProfile } from '@/db/schema';
import { confirmarSoyYo, aprobarVinculoPorNombre } from '@/lib/altas/por-nombre';
import { vincularFichaDesdeRanking } from '@/lib/altas/desde-ranking';
import { claveVinculoValida, solicitarVinculo, solicitudPendiente, listarSolicitudesVinculo } from '@/lib/altas/solicitudes';
import { athleteLinkRequest } from '@/lib/altas/solicitudes-schema';

const abiertos: ReturnType<typeof localD1>[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network_forbidden'); }));
});
afterEach(() => {
  abiertos.splice(0).forEach((local) => local.close());
  vi.unstubAllGlobals();
});

async function fixture(existing = true) {
  const local = localD1();
  abiertos.push(local);
  local.sqlite.exec(readFileSync(new URL('../drizzle-d1/0003_vinculos_revisados.sql', import.meta.url), 'utf8'));
  const db = createD1Database(local.binding);
  await db.insert(userProfile).values([
    { id: 'a', email: 'a@example.invalid', fullName: 'Cuenta sintética A', role: 'athlete', icalToken: 'ical-a' },
    { id: 'b', email: 'b@example.invalid', fullName: 'Cuenta sintética B', role: 'athlete', icalToken: 'ical-b' },
    { id: 'admin', email: 'admin@example.invalid', fullName: 'Dirección sintética', role: 'admin', icalToken: 'ical-admin' },
    { id: 'coach', email: 'coach@example.invalid', fullName: 'Seleccionador sintético', role: 'coach', icalToken: 'ical-coach' },
    { id: 'guardian', email: 'guardian@example.invalid', fullName: 'Papel retirado', role: 'guardian', icalToken: 'ical-guardian' },
  ]);
  if (existing) {
    await db.insert(athlete).values({
      id: 'tirador-rfee', firstName: 'Persona', lastName: 'Sintética RFEE',
      birthDate: '2000-01-01', gender: 'M', rfeeLicense: 'TEST0001',
      notes: 'Datos originales sin propietario.',
    });
    await db.insert(athlete).values({
      id: 'tirador-fie', firstName: 'Persona', lastName: 'Sintética FIE',
      birthDate: '2000-01-01', gender: 'M',
    });
  }
  await db.insert(officialRankingEntry).values([
    {
      id: 'fila-rfee-1', seasonLabel: '2026-2027', skermoSeasonId: 's1',
      weapon: 'ESPADA', gender: 'M', category: 'ABS', categoryRaw: 'ABS',
      skermoAthleteId: 'fixture-rfee', sourceLicense: 'TEST0001',
      sourceAthleteName: 'PERSONA SINTETICA RFEE', sourceFirstName: 'Persona',
      sourceLastName: 'Sintética RFEE', sourceBirthDate: '2000-01-01',
      sourceClub: 'CLUB-SINTETICO', contentHash: 'fixture-1',
    },
    {
      id: 'fila-rfee-2', seasonLabel: '2026-2027', skermoSeasonId: 's1',
      weapon: 'SABLE', gender: 'M', category: 'ABS', categoryRaw: 'ABS',
      skermoAthleteId: 'fixture-rfee', sourceLicense: 'TEST0001',
      sourceAthleteName: 'PERSONA SINTETICA RFEE', sourceFirstName: 'Persona',
      sourceLastName: 'Sintética RFEE', sourceBirthDate: '2000-01-01',
      sourceClub: 'CLUB-SINTETICO', contentHash: 'fixture-2',
    },
  ]);
  await db.insert(fieFencer).values({
    id: 'fila-fie', fieId: 90001, athleteId: existing ? 'tirador-fie' : null,
    sourceName: 'PERSONA SINTETICA FIE', sourceFirstName: 'Persona', sourceLastName: 'Sintética FIE',
    sourceBirthDate: '2000-01-01', countryCode: 'ESP', profileUrl: 'https://fie.org/athletes/90001',
    contentHash: 'fixture-fie',
  });
  await db.insert(fieClasificacion).values({
    season: 2026, weapon: 'SABLE', gender: 'M', category: 'ABS', categoryRaw: 'ABS',
    format: 'INDIVIDUAL', fieId: 90001, contentHash: 'fixture-clasificacion',
  });
  return { ...local, db };
}

async function pedir(db: Db, profileId = 'a', clave = 'rfee:fixture-rfee') {
  const resultado = await solicitarVinculo({ profileId, clave, nombreEscrito: 'Persona sintética' }, db);
  expect(resultado.ok).toBe(true);
  if (!resultado.ok) throw new Error('fixture_request_failed');
  return resultado.solicitudId;
}

function aprobacion(solicitudId: string, adminProfileId = 'admin') {
  return { solicitudId, adminProfileId, evidencia: 'Identidad verificada mediante un canal independiente sintético.' };
}

function antesDelBatch(
  local: Awaited<ReturnType<typeof fixture>>,
  change: () => void | Promise<void>,
): Db {
  return createD1Database({
    ...local.binding,
    batch: async <T>(statements: D1Statement[]) => {
      await change();
      return local.binding.batch<T>(statements);
    },
  });
}

async function estado(db: Db) {
  return {
    atletas: await db.select().from(athlete),
    armas: await db.select().from(athleteWeapon),
    ranking: await db.select().from(officialRankingEntry),
    fie: await db.select().from(fieFencer),
    clubes: await db.select().from(club),
    perfiles: await db.select().from(userProfile),
    solicitudes: await db.select().from(athleteLinkRequest),
  };
}

describe('solicitudes por nombre sin escalada de permisos', () => {
  it.each(['rfee:fixture-rfee', 'fie:90001'])('reconocerse en %s solo guarda una solicitud pendiente', async (clave) => {
    const local = await fixture();
    const antes = await estado(local.db);
    expect(await confirmarSoyYo({ profileId: 'a', clave, nombreEscrito: 'Nombre público de otra persona' }, local.db))
      .toMatchObject({ ok: false, motivo: 'REVISION_PENDIENTE' });
    const despues = await estado(local.db);
    const { solicitudes: _antes, ...datosAntes } = antes;
    const { solicitudes, ...datosDespues } = despues;
    expect(datosDespues).toEqual(datosAntes);
    expect(solicitudes).toHaveLength(1);
    expect(solicitudes[0]).toMatchObject({ state: 'PENDIENTE', athleteId: null, reviewedByProfileId: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('conocer una licencia tampoco otorga la propiedad sin revisión', async () => {
    const local = await fixture();
    expect(await vincularFichaDesdeRanking({
      profileId: 'a', clave: 'fixture-rfee', licencia: 'TEST0001', origen: 'autoservicio',
    }, local.db)).toMatchObject({ ok: false, motivo: 'REVISION_PENDIENTE' });
    expect((await local.db.select().from(athlete)).every((a) => a.userProfileId === null)).toBe(true);
  });

  it('idempotencia y una sola solicitud pendiente por cuenta incluso con llamadas concurrentes', async () => {
    const local = await fixture();
    const argumentos = { profileId: 'a', clave: 'fie:90001', nombreEscrito: 'Persona' };
    const solicitudes = await Promise.all([
      solicitarVinculo(argumentos, local.db), solicitarVinculo(argumentos, local.db),
    ]);
    expect(solicitudes[0]).toEqual(solicitudes[1]);
    expect(await solicitarVinculo({ ...argumentos, clave: 'rfee:fixture-rfee' }, local.db))
      .toEqual({ ok: false, motivo: 'SOLICITUD_PENDIENTE' });
    expect(await local.db.select().from(athleteLinkRequest)).toHaveLength(1);
  });

  it.each(['coach', 'guardian'])('el papel %s no puede solicitar una ficha', async (profileId) => {
    const local = await fixture();
    expect(await solicitarVinculo({ profileId, clave: 'fie:90001', nombreEscrito: '' }, local.db))
      .toEqual({ ok: false, motivo: 'CUENTA_NO_ELEGIBLE' });
    expect(await local.db.select().from(athleteLinkRequest)).toEqual([]);
  });

  it('niega cuentas revocadas y cuentas con una ficha activa en cualquiera de las columnas', async () => {
    const local = await fixture();
    await local.db.update(userProfile).set({ inviteStatus: 'revocada' }).where(eq(userProfile.id, 'a'));
    expect(await solicitarVinculo({ profileId: 'a', clave: 'fie:90001', nombreEscrito: '' }, local.db))
      .toMatchObject({ ok: false, motivo: 'CUENTA_NO_ELEGIBLE' });
    await local.db.update(athlete).set({ guardianProfileId: 'b' }).where(eq(athlete.id, 'tirador-fie'));
    expect(await solicitarVinculo({ profileId: 'b', clave: 'rfee:fixture-rfee', nombreEscrito: '' }, local.db))
      .toMatchObject({ ok: false, motivo: 'YA_TIENES_FICHA' });
  });

  it('el límite de cinco solicitudes diarias persiste después de cancelarlas', async () => {
    const local = await fixture();
    for (let i = 0; i < 5; i++) {
      const id = await pedir(local.db);
      local.sqlite.prepare(`update athlete_link_request set state='RECHAZADA', reviewed_at=?,
        reviewed_by_profile_id='a', evidence='Cancelación sintética de la solicitud.' where id=?`).run(Date.now(), id);
    }
    expect(await solicitarVinculo({ profileId: 'a', clave: 'fie:90001', nombreEscrito: '' }, local.db))
      .toMatchObject({ ok: false, motivo: 'DEMASIADOS_INTENTOS' });
    expect(await local.db.select().from(athleteLinkRequest)).toHaveLength(5);
  });

  it.each([
    'fie:90001junk', 'fie:-1', 'fie:0', 'fie:2147483648', 'fie:1/2',
    'rfee:../unsafe', 'rfee:', 'fie:90001?admin=1', 'other:fixture',
  ])('rechaza la clave no canónica %s', (clave) => {
    expect(claveVinculoValida(clave)).toBe(false);
  });

  it('los DTO propios y de revisión no incluyen nacimiento completo, licencias o material de sesión', async () => {
    const local = await fixture();
    const id = await pedir(local.db);
    expect(await solicitudPendiente('a', local.db)).toMatchObject({ id, clave: 'rfee:fixture-rfee' });
    expect(await solicitudPendiente('b', local.db)).toBeNull();
    const filas = await listarSolicitudesVinculo(local.db);
    expect(filas[0]).toMatchObject({ id, anio: 2000, nombreFuente: 'PERSONA SINTETICA RFEE' });
    expect(JSON.stringify(filas)).not.toMatch(/2000-01-01|TEST0001|ical-admin/);
  });

  it('la base rechaza una resolución sin evidencia o timestamps no enteros', async () => {
    const local = await fixture();
    const id = await pedir(local.db);
    const antes = await estado(local.db);
    expect(() => local.sqlite.prepare(`update athlete_link_request set state='APROBADA',
      reviewed_at=?, reviewed_by_profile_id='admin', evidence=NULL where id=?`).run(Date.now(), id))
      .toThrow();
    expect(() => local.sqlite.prepare(`update athlete_link_request set requested_at='fecha_no_valida'
      where id=?`).run(id)).toThrow();
    expect(() => local.sqlite.prepare(`update athlete_link_request set state='RECHAZADA',
      reviewed_at='fecha_no_valida', reviewed_by_profile_id='admin',
      evidence='Rechazo sintético para verificar constraints.' where id=?`).run(id)).toThrow();
    expect(await estado(local.db)).toEqual(antes);
  });
});

describe('aprobación humana y propiedad atómica en D1', () => {
  it.each(['rfee:fixture-rfee', 'fie:90001'])('la revisión de %s no crea autoservicio para menores de 14', async (clave) => {
    const local = await fixture();
    const birthDate = `${new Date().getUTCFullYear() - 10}-01-01`;
    await local.db.update(athlete).set({ birthDate });
    await local.db.update(officialRankingEntry).set({ sourceBirthDate: birthDate });
    await local.db.update(fieFencer).set({ sourceBirthDate: birthDate });
    const id = await pedir(local.db, 'a', clave);
    const antes = await estado(local.db);
    expect(await aprobarVinculoPorNombre(aprobacion(id), local.db))
      .toMatchObject({ ok: false, motivo: 'CUENTA_NO_ELEGIBLE' });
    expect(await estado(local.db)).toEqual(antes);
  });

  it.each(['rfee:fixture-rfee', 'fie:90001'])('un tirador no puede fabricar una aprobación de %s', async (clave) => {
    const local = await fixture();
    const id = await pedir(local.db, 'a', clave);
    const antes = await estado(local.db);
    expect(await aprobarVinculoPorNombre(aprobacion(id, 'b'), local.db)).toMatchObject({ ok: false });
    expect(await estado(local.db)).toEqual(antes);
  });

  it('la aprobación RFEE enlaza ficha, armas, fuentes, club y rastro en un solo batch', async () => {
    const local = await fixture();
    const id = await pedir(local.db);
    expect(await aprobarVinculoPorNombre(aprobacion(id), local.db)).toMatchObject({
      ok: true, alta: { atletaId: 'tirador-rfee', armas: ['ESPADA', 'SABLE'], filasEmparejadas: 2 },
    });
    expect(await local.db.select().from(athlete).where(eq(athlete.id, 'tirador-rfee'))).toMatchObject([{
      userProfileId: 'a', guardianProfileId: null, linkedVia: 'direccion_tecnica', linkedByProfileId: 'admin',
    }]);
    expect((await local.db.select().from(officialRankingEntry)).every((fila) => fila.athleteId === 'tirador-rfee')).toBe(true);
    expect(await local.db.select().from(athleteWeapon)).toHaveLength(2);
    expect(await local.db.select().from(athleteLinkRequest)).toMatchObject([{
      state: 'APROBADA', athleteId: 'tirador-rfee', reviewedByProfileId: 'admin',
    }]);
    expect(local.calls.every((call) => call.parameters <= 100)).toBe(true);
  });

  it.each([true, false])('la aprobación FIE usa propietario protegido, también al crear (%s)', async (existing) => {
    const local = await fixture(existing);
    const id = await pedir(local.db, 'a', 'fie:90001');
    const resultado = await aprobarVinculoPorNombre(aprobacion(id), local.db);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(await local.db.select().from(fieFencer)).toMatchObject([{
      athleteId: resultado.alta.atletaId, linkStatus: 'CONFIRMADO', linkedVia: 'direccion_tecnica',
    }]);
    expect(await local.db.select().from(athleteLinkRequest)).toMatchObject([{
      state: 'APROBADA', athleteId: resultado.alta.atletaId, reviewedByProfileId: 'admin',
    }]);
    expect(await local.db.select().from(athleteWeapon)).toMatchObject([{
      athleteId: resultado.alta.atletaId, weapon: 'SABLE',
    }]);
    expect(local.calls.every((call) => call.parameters <= 100)).toBe(true);
  });

  it.each(['user_profile_id', 'guardian_profile_id'])('no pisa %s ganado por otra cuenta después de la precomprobación', async (column) => {
    const local = await fixture();
    const id = await pedir(local.db);
    const raced = antesDelBatch(local, () => {
      local.sqlite.prepare(`update athlete set ${column}='b' where id='tirador-rfee'`).run();
    });
    expect(await aprobarVinculoPorNombre(aprobacion(id), raced)).toMatchObject({
      ok: false, motivo: 'VINCULO_CAMBIO',
    });
    const fila = local.sqlite.prepare('select user_profile_id,guardian_profile_id from athlete where id=?').get('tirador-rfee')!;
    expect(fila[column]).toBe('b');
    expect(await local.db.select().from(athleteWeapon)).toEqual([]);
    expect(await local.db.select().from(club)).toEqual([]);
    expect((await local.db.select().from(officialRankingEntry)).every((fila) => fila.athleteId === null)).toBe(true);
    expect(await local.db.select().from(athleteLinkRequest)).toMatchObject([{ state: 'PENDIENTE' }]);
  });

  it('no concede dos fichas a una cuenta que adquiere otra antes del CAS', async () => {
    const local = await fixture();
    const id = await pedir(local.db);
    const raced = antesDelBatch(local, () => {
      local.sqlite.prepare("update athlete set user_profile_id='a' where id='tirador-fie'").run();
    });
    expect(await aprobarVinculoPorNombre(aprobacion(id), raced)).toMatchObject({ ok: false, motivo: 'VINCULO_CAMBIO' });
    expect(local.sqlite.prepare("select user_profile_id from athlete where id='tirador-rfee'").get()!.user_profile_id).toBeNull();
    expect(await local.db.select().from(athleteWeapon)).toEqual([]);
  });

  it.each(['a', 'admin'])('recomprueba la revocación de %s dentro del batch de aprobación', async (idRevocado) => {
    const local = await fixture();
    const id = await pedir(local.db);
    const raced = antesDelBatch(local, () => {
      local.sqlite.prepare("update user_profile set invite_status='revocada' where id=?").run(idRevocado);
    });
    expect(await aprobarVinculoPorNombre(aprobacion(id), raced)).toMatchObject({ ok: false });
    expect((await local.db.select().from(athlete)).every((fila) => fila.userProfileId === null)).toBe(true);
    expect(await local.db.select().from(athleteLinkRequest)).toMatchObject([{ state: 'PENDIENTE' }]);
  });

  it.each(['rfee:fixture-rfee', 'fie:90001'])('un fallo tardío revierte todos los cambios de %s', async (clave) => {
    const local = await fixture();
    const id = await pedir(local.db, 'a', clave);
    local.sqlite.exec(`create trigger synthetic_failure before update on athlete_link_request
      when new.state='APROBADA' begin select raise(abort,'synthetic_private_driver_data'); end`);
    const antes = await estado(local.db);
    const resultado = await aprobarVinculoPorNombre(aprobacion(id), local.db);
    expect(resultado).toMatchObject({ ok: false, motivo: 'VINCULO_CAMBIO' });
    expect(JSON.stringify(resultado)).not.toContain('synthetic_private_driver_data');
    expect(await estado(local.db)).toEqual(antes);
  });

  it.each(['rfee:fixture-rfee', 'fie:90001'])('dos aprobaciones concurrentes para una fuente nueva %s solo conceden una propiedad', async (clave) => {
    const local = await fixture(false);
    const a = await pedir(local.db, 'a', clave);
    const b = await pedir(local.db, 'b', clave);
    const raced = antesDelBatch(local, async () => {
      expect(await aprobarVinculoPorNombre(aprobacion(b), local.db)).toMatchObject({ ok: true });
    });
    expect(await aprobarVinculoPorNombre(aprobacion(a), raced)).toMatchObject({ ok: false, motivo: 'VINCULO_CAMBIO' });
    const atletas = await local.db.select().from(athlete);
    expect(atletas).toHaveLength(1);
    expect(atletas[0].userProfileId).toBe('b');
    expect(await local.db.select().from(athleteLinkRequest).where(eq(athleteLinkRequest.id, a)))
      .toMatchObject([{ state: 'PENDIENTE' }]);
  });

  it('la fuente que cambia su nacimiento entre lectura y escritura no se vincula', async () => {
    const local = await fixture();
    const id = await pedir(local.db, 'a', 'fie:90001');
    const raced = antesDelBatch(local, () => {
      local.sqlite.prepare("update fie_fencer set source_birth_date='2001-01-01' where fie_id=90001").run();
    });
    expect(await aprobarVinculoPorNombre(aprobacion(id), raced)).toMatchObject({ ok: false });
    expect(local.sqlite.prepare("select user_profile_id from athlete where id='tirador-fie'").get()!.user_profile_id).toBeNull();
  });
});
