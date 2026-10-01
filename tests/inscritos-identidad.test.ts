import { describe, expect, it, vi } from 'vitest';
import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  EVIDENCIA_VACIA,
  identificarObservacion,
  refsPublicadas,
  type EvidenciaExterna,
  type RefPublicada,
} from '@/lib/entries/identidad';
import { aListaVisible } from '@/lib/entries/union';
import type { ExternalIdRow } from '@/lib/identity/resolver';
import {
  descubrirTarjetas,
  leerListaUnida,
  type DepsDescubrimiento,
  type DepsLector,
  type FilaCruda,
  type PruebaCruda,
} from '@/lib/queries/inscritos-lector';

const DIA = '2026-10-16';

const externo = (o: Partial<ExternalIdRow> & Pick<ExternalIdRow, 'scheme' | 'value' | 'personId'>): ExternalIdRow => ({
  scopeSource: 'fie',
  scopeFederation: '',
  scopeSeason: '',
  scopeWeapon: '',
  validFrom: '1900-01-01',
  validTo: null,
  linkStatus: 'CONFIRMADO',
  ...o,
});

const evidencia = (o: Partial<EvidenciaExterna>): EvidenciaExterna => ({ ...EVIDENCIA_VACIA, ...o });

const refsFie = (fieId: number | null, licencia: string | null = null) =>
  refsPublicadas({ fuente: 'fie', fieId, licencia, observadoEl: DIA });

describe('identidad de una observación: sólo cuenta lo que ella demuestra', () => {
  it('un athlete_id guardado sin prueba no es identidad: el puente por nombre no atribuye', () => {
    // La fila no trae ID ni licencia: lo único que hay es un nombre y un athlete_id antiguo.
    const r = identificarObservacion({ fuente: 'skermo_rfee', refs: [], arma: 'FLORETE', dia: DIA }, EVIDENCIA_VACIA);
    expect(r.athleteId).toBeNull();
    expect(r.resolucion).toEqual({ kind: 'none' });
  });

  it('el ID FIE publicado, enlazado a un tirador por una persona, prueba la ficha', () => {
    const r = identificarObservacion(
      { fuente: 'fie', refs: refsFie(54066), arma: 'FLORETE', dia: DIA },
      evidencia({ fichasFie: [{ fieId: 54066, fieLicense: null, athleteId: 'ath-1' }] }),
    );
    expect(r.athleteId).toBe('ath-1');
  });

  it('una licencia vigente de un único tirador prueba la ficha; caducada, no', () => {
    const atleta = (hasta: string | null) => ({
      id: 'ath-2',
      rfeeLicense: 'CLF 01835',
      rfeeValidUntil: hasta,
      fieLicense: null,
      fieValidUntil: null,
    });
    const obs = { fuente: 'skermo_rfee', refs: [{ ...refsPublicadas({ fuente: 'skermo_rfee', licencia: 'clf-01835', observadoEl: DIA })[0] }], arma: 'FLORETE', dia: DIA };
    expect(identificarObservacion(obs, evidencia({ atletas: [atleta('2027-08-31')] })).athleteId).toBe('ath-2');
    expect(identificarObservacion(obs, evidencia({ atletas: [atleta('2026-08-31')] })).athleteId).toBeNull();
  });

  it('una licencia compartida por dos tiradores no se resuelve con el último: nadie', () => {
    const base = { rfeeValidUntil: null, fieLicense: null, fieValidUntil: null };
    const r = identificarObservacion(
      { fuente: 'skermo_rfee', refs: refsPublicadas({ fuente: 'skermo_rfee', licencia: 'CLF01835', observadoEl: DIA }), arma: 'FLORETE', dia: DIA },
      evidencia({
        atletas: [
          { id: 'ath-a', rfeeLicense: 'CLF01835', ...base },
          { id: 'ath-b', rfeeLicense: 'CLF-01835', ...base },
        ],
      }),
    );
    expect(r.athleteId).toBeNull();
    expect(r.resolucion.kind).toBe('conflict');
  });

  it('la persona confirmada enlazada a una cuenta atribuye aunque la inscripción no traiga athlete_id', () => {
    const r = identificarObservacion(
      { fuente: 'fie', refs: refsFie(777), arma: 'FLORETE', dia: DIA },
      evidencia({
        externos: [externo({ scheme: 'fie_addr_id', value: '777', personId: 'p1' })],
        personas: new Map([['p1', { athleteId: 'ath-9', mergedIntoPersonId: null }]]),
      }),
    );
    expect(r.resolucion).toEqual({ kind: 'confirmed', personId: 'p1' });
    expect(r.athleteId).toBe('ath-9');
  });

  it('conflict entre personas confirmadas no atribuye propiedad', () => {
    const r = identificarObservacion(
      { fuente: 'fie', refs: refsFie(777), arma: 'FLORETE', dia: DIA },
      evidencia({
        externos: [
          externo({ scheme: 'fie_addr_id', value: '777', personId: 'p1', validFrom: '2020-01-01' }),
          externo({ scheme: 'fie_addr_id', value: '777', personId: 'p2', validFrom: '2024-01-01' }),
        ],
        personas: new Map([
          ['p1', { athleteId: 'ath-1', mergedIntoPersonId: null }],
          ['p2', { athleteId: 'ath-2', mergedIntoPersonId: null }],
        ]),
      }),
    );
    expect(r.athleteId).toBeNull();
    expect(r.resolucion.kind).toBe('conflict');
  });

  it('enlaces contradictorios (persona→tirador A, ficha FIE→tirador B) no atribuyen a nadie', () => {
    const r = identificarObservacion(
      { fuente: 'fie', refs: refsFie(777), arma: 'FLORETE', dia: DIA },
      evidencia({
        externos: [externo({ scheme: 'fie_addr_id', value: '777', personId: 'p1' })],
        personas: new Map([['p1', { athleteId: 'ath-A', mergedIntoPersonId: null }]]),
        fichasFie: [{ fieId: 777, fieLicense: null, athleteId: 'ath-B' }],
      }),
    );
    expect(r.athleteId).toBeNull();
    expect(r.resolucion.kind).toBe('conflict');
  });

  it('un ID con vigencia sólo vale el día del hecho; fuera de ella no confirma', () => {
    const e = evidencia({
      externos: [externo({ scheme: 'fie_addr_id', value: '777', personId: 'p1', validFrom: '2026-11-01' })],
      personas: new Map([['p1', { athleteId: 'ath-1', mergedIntoPersonId: null }]]),
    });
    expect(identificarObservacion({ fuente: 'fie', refs: refsFie(777), arma: 'FLORETE', dia: DIA }, e).resolucion.kind).toBe('none');
    expect(identificarObservacion({ fuente: 'fie', refs: refsFie(777), arma: 'FLORETE', dia: '2026-11-02' }, e).resolucion.kind).toBe('confirmed');
  });

  it('una persona fusionada resuelve a la que prevalece', () => {
    const r = identificarObservacion(
      { fuente: 'fie', refs: refsFie(5), arma: 'FLORETE', dia: DIA },
      evidencia({
        externos: [externo({ scheme: 'fie_addr_id', value: '5', personId: 'viejo' })],
        personas: new Map([
          ['viejo', { athleteId: null, mergedIntoPersonId: 'nuevo' }],
          ['nuevo', { athleteId: 'ath-n', mergedIntoPersonId: null }],
        ]),
      }),
    );
    expect(r.resolucion).toEqual({ kind: 'confirmed', personId: 'nuevo' });
    expect(r.athleteId).toBe('ath-n');
  });
});

/* ------------------------------------------------------------------ lector */

const prueba = (o: Partial<PruebaCruda> = {}): PruebaCruda => ({
  id: 'c-fm',
  prueba: 'FLORETE|M|ABS|INDIVIDUAL',
  tarjeta: 't1',
  propia: true,
  consultada: true,
  ...o,
});

const cruda = (o: Partial<FilaCruda> & Pick<FilaCruda, 'registrationId' | 'nombre' | 'fuente'>): FilaCruda => ({
  competitionId: 'c-fm',
  prueba: 'FLORETE|M|ABS|INDIVIDUAL',
  tarjeta: 't1',
  arma: 'FLORETE',
  dia: DIA,
  equipo: '',
  clubPublicado: null,
  licencia: null,
  athleteIdGuardado: null,
  retiradoEn: null,
  sourceUrl: `https://ejemplo.test/${o.fuente}`,
  leidoEl: new Date('2026-10-01T00:00:00Z'),
  ...o,
});

function deps(
  crudas: FilaCruda[],
  o: {
    esquema?: { identidad: boolean; referencias: boolean };
    refs?: Record<string, RefPublicada[]>;
    evidencia?: Partial<DepsEvidencia>;
    clubes?: Record<string, string | null>;
  } = {},
) {
  const esquema = o.esquema ?? { identidad: false, referencias: false };
  const evid: DepsEvidencia = {
    esquema: vi.fn(async () => esquema),
    atletasPorLicencia: vi.fn(async () => []),
    fichasFie: vi.fn(async () => []),
    externos: vi.fn(async () => []),
    personas: vi.fn(async () => new Map()),
    ...o.evidencia,
  };
  const lector: DepsLector = {
    observaciones: vi.fn(async () => ({ crudas, pruebas: [prueba()] })),
    referencias: vi.fn(async () => new Map(Object.entries(o.refs ?? {}))),
    clubesDe: vi.fn(async () => new Map(Object.entries(o.clubes ?? {}))),
    evidencia: evid,
  };
  return { lector, evid };
}

describe('lector de inscritos: camino legacy (esquema sin migrar)', () => {
  it('no consulta tablas ausentes y no promueve el athlete_id antiguo ni las URLs al visible', async () => {
    const { lector, evid } = deps([
      cruda({ registrationId: 'r1', nombre: 'ANA GARCIA', fuente: 'skermo_rfee', athleteIdGuardado: 'ath-puente', clubPublicado: 'CLUB X' }),
      cruda({ registrationId: 'r2', nombre: 'GARCIA Ana', fuente: 'fie', athleteIdGuardado: 'ath-puente' }),
    ]);
    const { filas } = await leerListaUnida(lector, ['t1']);

    expect(lector.referencias).not.toHaveBeenCalled();
    expect(evid.externos).not.toHaveBeenCalled();
    expect(evid.personas).not.toHaveBeenCalled();
    // Mismo athlete_id guardado y dos filas: sin prueba independiente no se funden ni son «mías».
    expect(filas).toHaveLength(2);
    expect(filas.flatMap((f) => f.athleteIds)).toEqual([]);
    expect(filas.flatMap((f) => f.observaciones.map((o) => o.candidatoAthleteId))).toEqual(['ath-puente', 'ath-puente']);
    expect(aListaVisible(filas, new Set(['ath-puente'])).some((v) => v.esMio)).toBe(false);
  });

  it('con la licencia publicada probada, la ficha sí cuenta y aporta su club', async () => {
    const { lector } = deps(
      [cruda({ registrationId: 'r1', nombre: 'LUIS RUIZ', fuente: 'fie', licencia: '09122006000' })],
      {
        evidencia: {
          atletasPorLicencia: vi.fn(async () => [
            { id: 'ath-3', rfeeLicense: null, rfeeValidUntil: null, fieLicense: '09122006000', fieValidUntil: '2027-01-01' },
          ]),
        },
        clubes: { 'ath-3': 'CLUB PROPIO' },
      },
    );
    const { filas } = await leerListaUnida(lector, ['t1']);
    expect(filas[0].athleteIds).toEqual(['ath-3']);
    expect(filas[0].club).toBe('CLUB PROPIO');
    expect(aListaVisible(filas, new Set(['ath-3']))[0].esMio).toBe(true);
  });

  it('el club de una ficha sin probar no se cuela por el athlete_id guardado', async () => {
    const { lector } = deps(
      [cruda({ registrationId: 'r1', nombre: 'OTRA', fuente: 'skermo_rfee', athleteIdGuardado: 'ath-ajeno' })],
      { clubes: { 'ath-ajeno': 'CLUB AJENO' } },
    );
    const { filas } = await leerListaUnida(lector, ['t1']);
    expect(filas[0].club).toBeNull();
    expect(lector.clubesDe).not.toHaveBeenCalled();
  });

  it('un fallo de la base no se convierte en «esquema ausente»: la lectura entera falla', async () => {
    const { lector } = deps(
      [cruda({ registrationId: 'r1', nombre: 'X', fuente: 'fie', licencia: 'AB123' })],
      { evidencia: { atletasPorLicencia: vi.fn(async () => { throw new Error('neon caído'); }) } },
    );
    await expect(leerListaUnida(lector, ['t1'])).rejects.toThrow('neon caído');

    const roto = deps([cruda({ registrationId: 'r1', nombre: 'X', fuente: 'fie', licencia: 'AB123' })], {
      evidencia: { esquema: vi.fn(async () => { throw new Error('catálogo no responde'); }) },
    });
    await expect(leerListaUnida(roto.lector, ['t1'])).rejects.toThrow('catálogo no responde');
  });
});

describe('lector de inscritos: esquema migrado', () => {
  const fieP = (id: number) => ({ ...refsPublicadas({ fuente: 'fie', fieId: id, observadoEl: DIA })[0] });

  it('carga todos los IDs pertinentes en un lote y une FIE y Skermo por la persona confirmada', async () => {
    const externos = vi.fn(async () => [
      externo({ scheme: 'fie_addr_id', value: '54066', personId: 'p1' }),
      externo({ scheme: 'rfee_license', value: 'CLF01835', personId: 'p1', scopeSource: 'skermo_rfee', scopeFederation: 'RFEE' }),
    ]);
    const { lector, evid } = deps(
      [
        cruda({ registrationId: 'r1', nombre: 'PRUEBA UNO Jorge', fuente: 'fie' }),
        cruda({ registrationId: 'r2', nombre: 'JORGE PRUEBA UNO', fuente: 'skermo_rfee', licencia: 'clf 01835' }),
        cruda({ registrationId: 'r3', nombre: 'SOLO SKERMO', fuente: 'skermo_rfee' }),
        cruda({ registrationId: 'r4', nombre: 'SOLO FIE', fuente: 'fie' }),
      ],
      {
        esquema: { identidad: true, referencias: true },
        refs: { r1: [fieP(54066)], r4: [fieP(1)] },
        evidencia: {
          externos,
          personas: vi.fn(async () => new Map([['p1', { athleteId: 'ath-1', mergedIntoPersonId: null }]])),
        },
      },
    );
    const { filas } = await leerListaUnida(lector, ['t1']);

    expect(externos).toHaveBeenCalledTimes(1);
    const valores = (externos.mock.calls as unknown as [string[]][])[0][0];
    expect(valores.sort()).toEqual(['1', '54066', 'CLF01835']);
    expect(filas).toHaveLength(3);
    const unida = filas.find((f) => f.athleteIds.includes('ath-1'))!;
    expect(unida.observaciones.map((o) => o.fuente).sort()).toEqual(['fie', 'skermo_rfee']);
    expect(filas.map((f) => f.nombre)).toEqual(expect.arrayContaining(['SOLO SKERMO', 'SOLO FIE']));
  });

  it('esMio llega con athlete_id de inscripción null; un conflict no marca ni suprime', async () => {
    const { lector } = deps(
      [
        cruda({ registrationId: 'r1', nombre: 'MIA', fuente: 'fie' }),
        cruda({ registrationId: 'r2', nombre: 'DUDOSA', fuente: 'fie', athleteIdGuardado: 'ath-1' }),
      ],
      {
        esquema: { identidad: true, referencias: true },
        refs: { r1: [fieP(10)], r2: [fieP(20)] },
        evidencia: {
          externos: vi.fn(async () => [
            externo({ scheme: 'fie_addr_id', value: '10', personId: 'p1' }),
            externo({ scheme: 'fie_addr_id', value: '20', personId: 'p2', validFrom: '2020-01-01' }),
            externo({ scheme: 'fie_addr_id', value: '20', personId: 'p3', validFrom: '2021-01-01' }),
          ]),
          personas: vi.fn(async () =>
            new Map([
              ['p1', { athleteId: 'ath-1', mergedIntoPersonId: null }],
              ['p2', { athleteId: 'ath-1', mergedIntoPersonId: null }],
              ['p3', { athleteId: null, mergedIntoPersonId: null }],
            ]),
          ),
        },
      },
    );
    const { filas } = await leerListaUnida(lector, ['t1']);
    const visibles = aListaVisible(filas, new Set(['ath-1']));
    expect(visibles.find((v) => v.nombre === 'MIA')?.esMio).toBe(true);
    expect(visibles.find((v) => v.nombre === 'DUDOSA')?.esMio).toBe(false);
    expect(filas.find((f) => f.nombre === 'DUDOSA')?.athleteIds).toEqual([]);
  });

  it('homónimos: mismo nombre y dos personas confirmadas son dos filas con historiales separados', async () => {
    const { lector } = deps(
      [
        cruda({ registrationId: 'r1', nombre: 'ANA GARCIA', fuente: 'fie' }),
        cruda({ registrationId: 'r2', nombre: 'ANA GARCIA', fuente: 'skermo_rfee', licencia: 'AAA111' }),
        cruda({ registrationId: 'r3', nombre: 'ANA GARCIA', fuente: 'skermo_regional', licencia: 'BBB222' }),
      ],
      {
        esquema: { identidad: true, referencias: true },
        refs: { r1: [fieP(1)] },
        evidencia: {
          externos: vi.fn(async () => [
            externo({ scheme: 'fie_addr_id', value: '1', personId: 'pA' }),
            externo({ scheme: 'rfee_license', value: 'AAA111', personId: 'pA', scopeSource: 'skermo_rfee', scopeFederation: 'RFEE' }),
            externo({ scheme: 'rfee_license', value: 'BBB222', personId: 'pB', scopeSource: 'skermo_regional', scopeFederation: 'RFEE' }),
          ]),
          personas: vi.fn(async () => new Map([
            ['pA', { athleteId: null, mergedIntoPersonId: null }],
            ['pB', { athleteId: null, mergedIntoPersonId: null }],
          ])),
        },
      },
    );
    const { filas } = await leerListaUnida(lector, ['t1']);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.observaciones.length).sort()).toEqual([1, 2]);
  });

  it('un error al leer las referencias se propaga y no deja una lista parcial', async () => {
    const { lector } = deps([cruda({ registrationId: 'r1', nombre: 'X', fuente: 'fie' })], {
      esquema: { identidad: true, referencias: true },
    });
    (lector.referencias as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fallo de red'));
    await expect(leerListaUnida(lector, ['t1'])).rejects.toThrow('fallo de red');
  });
});

describe('carga de evidencia', () => {
  it('sigue las fusiones de persona y no consulta nada sin referencias', async () => {
    const personas = vi.fn(async (ids: string[]) =>
      ids.includes('a')
        ? new Map([['a', { athleteId: null, mergedIntoPersonId: 'b' }]])
        : new Map([['b', { athleteId: 'ath', mergedIntoPersonId: null }]]),
    );
    const d: DepsEvidencia = {
      esquema: async () => ({ identidad: true, referencias: true }),
      atletasPorLicencia: vi.fn(async () => []),
      fichasFie: vi.fn(async () => []),
      externos: vi.fn(async () => [externo({ scheme: 'fie_addr_id', value: '1', personId: 'a' })]),
      personas,
    };
    const ev = await cargarEvidencia(d, refsFie(1));
    expect(ev.personas.get('b')?.athleteId).toBe('ath');

    const vacio = await cargarEvidencia(d, []);
    expect(vacio.externos).toEqual([]);
    expect(d.externos).toHaveBeenCalledTimes(1);
  });
});

describe('descubrimiento de Mi estado', () => {
  it('pasa a la consulta las licencias, IDs FIE y IDs externos confirmados de la persona enlazada', async () => {
    const tarjetas = vi.fn(async () => ['t9']);
    const d: DepsDescubrimiento = {
      esquema: async () => ({ identidad: true, referencias: true }),
      pistas: async () => ({ licencias: ['CLF01835'], fieIds: [54066], valores: ['54066', 'CLF01835', '777'] }),
      tarjetas,
    };
    expect(await descubrirTarjetas(d, ['ath-1'], '2026-10-01')).toEqual(['t9']);
    expect(tarjetas).toHaveBeenCalledWith({
      athleteIds: ['ath-1'],
      pistas: { licencias: ['CLF01835'], fieIds: [54066], valores: ['54066', 'CLF01835', '777'] },
      conReferencias: true,
      hoy: '2026-10-01',
    });
    expect(await descubrirTarjetas(d, [], '2026-10-01')).toEqual([]);
  });

  it('en legacy no pide la tabla de referencias', async () => {
    const tarjetas = vi.fn(async () => []);
    await descubrirTarjetas(
      {
        esquema: async () => ({ identidad: false, referencias: false }),
        pistas: async () => ({ licencias: [], fieIds: [], valores: [] }),
        tarjetas,
      },
      ['ath-1'],
      '2026-10-01',
    );
    expect((tarjetas.mock.calls as unknown as { conReferencias: boolean }[][])[0][0].conReferencias).toBe(false);
  });
});
