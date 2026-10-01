import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fila = Record<string, unknown>;

const h = vi.hoisted(() => ({
  esquema: { identidad: false, referencias: false },
  tablas: {} as Record<string, unknown[]>,
  lecturas: [] as string[],
  inserciones: [] as { tabla: string; valores: Fila[] }[],
}));

vi.mock('@/lib/sport/esquema-db', () => ({ esquemaDeportivo: async () => h.esquema }));

vi.mock('@/db', async () => {
  const { getTableName } = await import('drizzle-orm');
  const cadena = (filas: unknown[]): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) =>
        prop === 'then' ? (resolve: (v: unknown) => void) => resolve(filas) : () => cadena(filas),
    });
  return {
    db: {
      select: () => ({
        from: (tabla: Parameters<typeof getTableName>[0]) => {
          const nombre = getTableName(tabla);
          h.lecturas.push(nombre);
          return cadena(h.tablas[nombre] ?? []);
        },
      }),
      selectDistinct: () => ({
        from: (tabla: Parameters<typeof getTableName>[0]) => {
          const nombre = getTableName(tabla);
          h.lecturas.push(nombre);
          return cadena(h.tablas[nombre] ?? []);
        },
      }),
      insert: (tabla: Parameters<typeof getTableName>[0]) => ({
        values: (valores: Fila[]) => {
          h.inserciones.push({ tabla: getTableName(tabla), valores });
          const devuelve = valores.map((v, i) => ({ ...v, id: `reg-${i}` }));
          return {
            onConflictDoUpdate: () => ({
              returning: async () => devuelve,
              then: (resolve: (v: unknown) => void) => resolve([]),
            }),
          };
        },
      }),
      update: () => cadena([]),
    },
  };
});

const AHORA = new Date('2026-10-01T10:00:00Z');
const base = { sourceTeam: '', sourceClub: null, sourceRegisteredAt: null };

async function escribir(filas: Fila[], source: 'fie' | 'skermo_rfee' = 'fie', dia = '2026-10-16') {
  const { upsertListasDeInscritos } = await import('@/lib/ingest/upsert');
  return upsertListasDeInscritos(
    [
      {
        eventCompetitionId: 'comp-1',
        source,
        sourceUrl: 'https://fie.org/competition/2027/1478/entries',
        dia,
        rows: filas.map((f) => ({ ...base, ...f })) as never,
      },
    ],
    AHORA,
  );
}

const registrosInsertados = () =>
  h.inserciones.filter((i) => i.tabla === 'competition_registration').flatMap((i) => i.valores);

beforeEach(() => {
  h.esquema = { identidad: false, referencias: false };
  h.tablas = {};
  h.lecturas = [];
  h.inserciones = [];
});

describe('escritura de inscritos: emparejado por evidencia, sin puente por nombre', () => {
  it('un nombre igual al del ranking no asigna athlete_id ni consulta el ranking', async () => {
    h.tablas.official_ranking_entry = [{ nombre: 'ANA GARCIA', athleteId: 'ath-ranking' }];
    await escribir([{ sourceAthleteName: 'ANA GARCIA', sourceLicense: null, sourceFieId: null }], 'skermo_rfee');
    expect(registrosInsertados()[0].athleteId).toBeUndefined();
    expect(h.lecturas).not.toContain('official_ranking_entry');
  });

  it('el ID FIE de una ficha confirmada asigna la ficha', async () => {
    h.tablas.fie_fencer = [{ fieId: 54066, fieLicense: null, athleteId: 'ath-1' }];
    const r = await escribir([{ sourceAthleteName: 'PRUEBA Uno', sourceLicense: null, sourceFieId: 54066 }]);
    expect(registrosInsertados()[0].athleteId).toBe('ath-1');
    expect(r.matched).toBe(1);
  });

  it('una licencia que pertenece a dos tiradores no se resuelve con el último', async () => {
    h.tablas.athlete = [
      { id: 'ath-a', rfeeLicense: 'CLF01835', rfeeValidUntil: null, fieLicense: null, fieValidUntil: null },
      { id: 'ath-b', rfeeLicense: 'CLF-01835', rfeeValidUntil: null, fieLicense: null, fieValidUntil: null },
    ];
    await escribir([{ sourceAthleteName: 'X', sourceLicense: 'clf 01835', sourceFieId: null }], 'skermo_rfee');
    expect(registrosInsertados()[0].athleteId).toBeUndefined();
  });

  it('una licencia caducada el día de la prueba no empareja', async () => {
    h.tablas.athlete = [
      { id: 'ath-a', rfeeLicense: 'CLF01835', rfeeValidUntil: '2026-08-31', fieLicense: null, fieValidUntil: null },
    ];
    await escribir([{ sourceAthleteName: 'X', sourceLicense: 'CLF01835', sourceFieId: null }], 'skermo_rfee');
    expect(registrosInsertados()[0].athleteId).toBeUndefined();
  });
});

describe('retención de referencias publicadas', () => {
  it('con la tabla de referencias aplicada guarda ID FIE y licencia con ámbito y día', async () => {
    h.esquema = { identidad: true, referencias: true };
    await escribir([{ sourceAthleteName: 'PRUEBA Uno', sourceLicense: '09122006000', sourceFieId: 54066 }]);
    const refs = h.inserciones.find((i) => i.tabla === 'sport_registration_ref')!.valores;
    expect(refs).toHaveLength(2);
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registrationId: 'reg-0', scheme: 'fie_addr_id', value: '54066', scopeSource: 'fie',
          scopeFederation: '', observedOn: '2026-10-16',
        }),
        expect.objectContaining({
          registrationId: 'reg-0', scheme: 'fie_license', value: '09122006000', scopeSource: 'fie',
          scopeFederation: 'FIE', observedOn: '2026-10-16',
        }),
      ]),
    );
  });

  it('sin la migración la pasada funciona igual y no toca la tabla ausente', async () => {
    h.esquema = { identidad: false, referencias: false };
    const r = await escribir([{ sourceAthleteName: 'PRUEBA Uno', sourceLicense: null, sourceFieId: 54066 }]);
    expect(r.seen).toBe(1);
    expect(h.inserciones.some((i) => i.tabla === 'sport_registration_ref')).toBe(false);
    expect(h.lecturas).not.toContain('sport_external_id');
    expect(h.lecturas).not.toContain('sport_person');
  });

  it('esquema migrado: el ID confirmado de una persona enlazada asigna la ficha', async () => {
    h.esquema = { identidad: true, referencias: true };
    h.tablas.sport_external_id = [
      {
        personId: 'p1', scheme: 'fie_addr_id', value: '54066', scopeSource: 'fie', scopeFederation: '',
        scopeSeason: '', scopeWeapon: '', validFrom: '1900-01-01', validTo: null, linkStatus: 'CONFIRMADO',
      },
    ];
    h.tablas.sport_person = [{ id: 'p1', athleteId: 'ath-7', mergedIntoPersonId: null }];
    await escribir([{ sourceAthleteName: 'PRUEBA Uno', sourceLicense: null, sourceFieId: 54066 }]);
    expect(registrosInsertados()[0].athleteId).toBe('ath-7');
  });

});
