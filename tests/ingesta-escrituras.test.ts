import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import type { NormalizedEvent } from '@/lib/ingest/types';

/**
 * Lo que la ingesta del calendario escribe en una noche sin cambios: nada que
 * se vea. Sobre SQLite con la migración real (0000 + 0012) y el `db` de la
 * aplicación apuntando a ella.
 */
const local = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/db', () => ({
  get db() {
    return local.db;
  },
}));
vi.mock('@/lib/sport/esquema-db', () => ({ esquemaDeportivo: async () => ({ identidad: false, referencias: false }) }));

const { cambiosVisibles, renovarVistosSinCambios, upsertEvents, upsertListasDeInscritos } = await import(
  '@/lib/ingest/upsert'
);
const { guardarHuellas, huellaEntera, leerHuellas, puedeSaltarPagina } = await import('@/lib/cron/huellas');

let base: ReturnType<typeof localD1>;
const AHORA = new Date('2026-10-08T03:00:00Z');
const dia = (n: number) => new Date(AHORA.getTime() + n * 86_400_000).toISOString().slice(0, 10);

function evento(opciones: { fecha: string; inscritos: string[]; cierre?: string | null; recuento?: number }): NormalizedEvent {
  return {
    source: 'skermo_rfee',
    sourceId: 'skermo-RFEE-copa',
    sourceUrl: 'https://app.skermo.org/calendario',
    name: 'Copa de España',
    startDate: opciones.fecha,
    endDate: opciones.fecha,
    venue: null,
    venueAddress: null,
    city: 'MADRID',
    country: 'ES',
    timezone: 'Europe/Madrid',
    officialSite: null,
    imageUrl: null,
    circuit: 'TNR',
    scope: 'NACIONAL',
    regionalFederation: null,
    sourceModifiedAt: null,
    notes: null,
    documents: [],
    liveLinks: [],
    competitions: [
      {
        weapon: 'ESPADA',
        gender: 'F',
        category: 'ABS',
        categoryRaw: 'Absoluta',
        format: 'INDIVIDUAL',
        competitionDate: opciones.fecha,
        installationOpen: null,
        callTime: null,
        scratchTime: null,
        startTime: null,
        registrationCount: opciones.recuento ?? opciones.inscritos.length,
        registrations: opciones.inscritos.map((n) => ({ sourceAthleteName: n, sourceTeam: '' })),
        feeEur: null,
        sourceId: '1',
        sourceUrl: 'https://app.skermo.org/calendario#detail1',
        registrationCloseDate: opciones.cierre === undefined ? dia(1) : opciones.cierre,
      },
    ],
  } as NormalizedEvent;
}

const escriturasEn = (tabla: string) =>
  base.calls.filter((c) => new RegExp(`^(insert into|update|delete from) "?${tabla}"?`, 'i').test(c.sql.trim())).length;
const inscritos = () =>
  base.sqlite
    .prepare('SELECT source_athlete_name n, withdrawn_at w, last_seen_at s FROM competition_registration ORDER BY n')
    .all() as { n: string; w: number | null; s: number }[];

async function pasada(e: NormalizedEvent, cuando: Date) {
  vi.setSystemTime(cuando);
  base.calls.length = 0;
  return upsertEvents([e]);
}

beforeEach(() => {
  base = localD1();
  base.sqlite.exec(readFileSync(new URL('../drizzle-d1/0012_refresco_programado.sql', import.meta.url), 'utf8'));
  local.db = createD1Database(base.binding);
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('inscritos: solo se escribe lo que cambia', () => {
  it('una segunda pasada igual no escribe inscritos ni plazos y no cuenta como cambio', async () => {
    const e = evento({ fecha: dia(40), inscritos: ['ANA', 'BEA'] });
    const primera = await pasada(e, AHORA);
    expect(primera.registrationsChanged).toBe(2);
    expect(primera.deadlinesWritten).toBe(1);
    expect(cambiosVisibles(primera)).toBeGreaterThan(0);

    const segunda = await pasada(e, new Date(AHORA.getTime() + 86_400_000));
    expect(escriturasEn('competition_registration')).toBe(0);
    expect(escriturasEn('event_deadline')).toBe(0);
    expect(segunda.registrationsChanged).toBe(0);
    expect(segunda.deadlinesWritten).toBe(0);
    expect(cambiosVisibles(segunda)).toBe(0);
  });

  it('las bajas salen de lo leído en la pasada, no de la fecha de lectura', async () => {
    await pasada(evento({ fecha: dia(40), inscritos: ['ANA', 'BEA'] }), AHORA);
    const sinBea = await pasada(evento({ fecha: dia(40), inscritos: ['ANA'] }), new Date(AHORA.getTime() + 86_400_000));
    expect(sinBea.registrationsWithdrawn).toBe(1);
    expect(inscritos().map((f) => [f.n, f.w !== null])).toEqual([['ANA', false], ['BEA', true]]);
    // Sin cambios en la lista, la baja no se repite ni se renueva.
    const igual = await pasada(evento({ fecha: dia(40), inscritos: ['ANA'] }), new Date(AHORA.getTime() + 2 * 86_400_000));
    expect(igual.registrationsWithdrawn).toBe(0);
    expect(escriturasEn('competition_registration')).toBe(0);
    // Vuelve: se deshace la baja.
    const vuelve = await pasada(evento({ fecha: dia(40), inscritos: ['ANA', 'BEA'] }), new Date(AHORA.getTime() + 3 * 86_400_000));
    expect(vuelve.registrationsChanged).toBe(1);
    expect(inscritos().every((f) => f.w === null)).toBe(true);
  });

  it('una lista vacía publicada da de baja a todos', async () => {
    await pasada(evento({ fecha: dia(40), inscritos: ['ANA', 'BEA'] }), AHORA);
    const vacia = await pasada(evento({ fecha: dia(40), inscritos: [] }), new Date(AHORA.getTime() + 86_400_000));
    expect(vacia.registrationsWithdrawn).toBe(2);
  });

  it('la lista de otra fuente en la misma prueba no da de baja a nadie de Skermo', async () => {
    await pasada(evento({ fecha: dia(40), inscritos: ['ANA'] }), AHORA);
    const [{ id }] = base.sqlite.prepare('SELECT id FROM event_competition').all() as { id: string }[];
    const r = await upsertListasDeInscritos(
      [{ eventCompetitionId: id, source: 'fie', sourceUrl: null, rows: [{ sourceAthleteName: 'GARCIA Ana', sourceTeam: '' }] }],
      new Date(AHORA.getTime() + 3_600_000),
    );
    expect(r.withdrawn).toBe(0);
    expect(inscritos().map((f) => [f.n, f.w])).toEqual([['ANA', null], ['GARCIA Ana', null]]);
  });

  it('la fecha de lectura se renueva a diario en pruebas inminentes y cada semana en las demás', async () => {
    const cerca = evento({ fecha: dia(5), inscritos: ['ANA'] });
    await pasada(cerca, AHORA);
    const otraNoche = await pasada(cerca, new Date(AHORA.getTime() + 86_400_000));
    expect(otraNoche.registrationsChanged).toBe(0);
    expect(escriturasEn('competition_registration')).toBe(1);

    base = localD1();
    local.db = createD1Database(base.binding);
    const lejos = evento({ fecha: dia(60), inscritos: ['ANA'] });
    await pasada(lejos, AHORA);
    await pasada(lejos, new Date(AHORA.getTime() + 3 * 86_400_000));
    expect(escriturasEn('competition_registration')).toBe(0);
    await pasada(lejos, new Date(AHORA.getTime() + 7 * 86_400_000));
    expect(escriturasEn('competition_registration')).toBe(1);
  });
});

describe('plazos publicados', () => {
  it('se reescriben solo si la fuente mueve el cierre', async () => {
    await pasada(evento({ fecha: dia(40), inscritos: [], cierre: dia(30) }), AHORA);
    const movido = await pasada(evento({ fecha: dia(40), inscritos: [], cierre: dia(31) }), new Date(AHORA.getTime() + 86_400_000));
    expect(movido.deadlinesWritten).toBe(1);
    expect(base.sqlite.prepare('SELECT count(*) n FROM event_deadline').get()).toEqual({ n: 1 });
  });

  it('un plazo que no se puede guardar no tumba la pasada del calendario', async () => {
    base.sqlite.exec(`CREATE TRIGGER rompe_plazos BEFORE INSERT ON event_deadline BEGIN SELECT RAISE(ABORT, 'plazo roto'); END;`);
    const r = await pasada(evento({ fecha: dia(40), inscritos: ['ANA'] }), AHORA);
    expect(r.deadlinesError).toMatch(/plazo roto|event_deadline/);
    expect(r.created).toBe(1);
    expect(inscritos()).toHaveLength(1);
  });
});

describe('página idéntica a la última lectura completa', () => {
  it('huella: entera de 52 bits, y solo se salta si es igual y la lectura completa tiene menos de 7 días', () => {
    const h = huellaEntera('f'.repeat(64));
    expect(h).toBe(2 ** 52 - 1);
    expect(Number.isSafeInteger(h)).toBe(true);
    const leida = new Date(AHORA.getTime() - 3 * 86_400_000);
    expect(puedeSaltarPagina({ huella: 5, leida }, 5, AHORA)).toBe(true);
    expect(puedeSaltarPagina({ huella: 5, leida }, 6, AHORA)).toBe(false);
    expect(puedeSaltarPagina({ huella: 5, leida: new Date(AHORA.getTime() - 7 * 86_400_000) }, 5, AHORA)).toBe(false);
    expect(puedeSaltarPagina(undefined, 5, AHORA)).toBe(false);
  });

  it('se guarda y se lee en refresco_programado, una sentencia cada vez', async () => {
    base.calls.length = 0;
    await guardarHuellas([{ clave: 'skermo_rfee:RFEE', huella: 123 }, { clave: 'skermo_regional:FCE', huella: 9 }], AHORA);
    const leidas = await leerHuellas(['skermo_rfee:RFEE', 'skermo_regional:FCE', 'skermo_regional:FME']);
    expect(base.calls).toHaveLength(2);
    expect(leidas.get('skermo_rfee:RFEE')).toEqual({ huella: 123, leida: AHORA });
    expect(leidas.has('skermo_regional:FME')).toBe(false);
  });

  it('al saltarla, se renueva la lectura de lo que se tira ya y de las listas inminentes', async () => {
    await pasada(evento({ fecha: dia(3), inscritos: ['ANA'] }), AHORA);
    const despues = new Date(AHORA.getTime() + 86_400_000);
    await renovarVistosSinCambios('skermo_rfee', 'skermo-RFEE-', despues);
    expect(base.sqlite.prepare('SELECT last_seen_at s FROM event').get()).toEqual({ s: despues.getTime() });
    expect(inscritos()[0].s).toBe(despues.getTime());
    // Otra federación no se toca.
    await renovarVistosSinCambios('skermo_rfee', 'skermo-FCE-', new Date(despues.getTime() + 1000));
    expect(inscritos()[0].s).toBe(despues.getTime());
  });
});
