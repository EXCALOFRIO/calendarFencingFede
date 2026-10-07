import { describe, expect, it, vi } from 'vitest';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache } from '@/lib/cache/cache';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { versionDe, type Dependencia } from '@/lib/cache/versiones';
import type { EstadoLista } from '@/lib/entries/lectura';
import type { FilaUnida } from '@/lib/entries/union';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';
import type { TramoPasado } from '@/lib/queries/calendario-pasado-modelo';

const managed = vi.hoisted(() => ({ porCuenta: {} as Record<string, { id: string }[]> }));
vi.mock('@/lib/auth/session', () => ({
  getManagedAthletes: async (profileId: string) => managed.porCuenta[profileId] ?? [],
}));

const { crearCachesCalendario, recortarParaRejilla, aListaPublica, idDeEventoValido } = await import(
  '@/lib/queries/calendario-cache-modelo'
);
const { quienVaDelEvento } = await import('@/lib/queries/quien-va');

const prueba = (id: string): CompetitionView => ({
  id, weapon: 'FLORETE', gender: 'M', category: 'ABS', categoryRaw: 'Senior', format: 'INDIVIDUAL',
  competitionDate: '2026-11-01', installationOpen: '08:00', callTime: '08:30', scratchTime: null, startTime: '09:00',
  registrationCount: 40, feeEur: '30', sourceUrl: 'https://example.test/prueba', deadlines: [],
  status: {
    state: 'verde', label: 'Inscripción abierta hasta el 20 de octubre', next: null, daysLeft: 12,
    currentSurchargeEur: null, nextSurchargeEur: null, closed: false, hasEstimates: false,
  },
  datosExtraidos: [],
});

const evento = (id: string, sobre: Partial<EventView> = {}): EventView => ({
  id, source: 'skermo_rfee', sourceUrl: 'https://example.test/e', name: 'TNR', startDate: '2026-11-01',
  endDate: '2026-11-02', venue: 'Pabellón', venueAddress: 'Calle 1', city: 'Madrid', country: 'ESP',
  geoLat: '40', geoLon: '-3', timezone: 'Europe/Madrid', officialSite: 'https://example.test', imageUrl: null,
  circuit: 'TNR', scope: 'NACIONAL', regionalFederation: 'FMEsgrima', notes: 'Observaciones',
  lastSeenAt: new Date('2026-10-07T10:00:00Z'), disappearedAt: null, competitions: [prueba(`${id}-p1`)],
  documents: [{ id: 'd1', title: 'Convocatoria', url: 'https://example.test/c.pdf', kind: 'convocatoria' }],
  liveLinks: [], linkedEvents: [{
    id: 'fie-1', source: 'fie', sourceId: 'fie-2027-1', sourceUrl: null, name: 'TNR FIE', startDate: '2026-11-01',
    endDate: '2026-11-02', city: 'Madrid', venue: null, timezone: null, imageUrl: null, circuit: 'SATELITE',
  }],
  sources: [{ source: 'skermo_rfee', name: 'TNR', url: 'https://example.test/e' }],
  imageSource: { source: 'fie', sourceUrl: null }, circuitFie: 'SATELITE', datosExtraidos: [],
  ...sobre,
});

const fila = (o: Partial<FilaUnida> & Pick<FilaUnida, 'nombre'>): FilaUnida => ({
  competitionId: 'p1', equipo: null, club: 'Club', athleteIds: [], retiradoEn: null,
  observaciones: [{
    competitionId: 'p1', nombre: o.nombre, equipo: '', club: null, athleteId: 'ath-x', retiradoEn: null,
    fuente: 'skermo_rfee', sourceUrl: 'https://skermo.test/lista', leidoEl: null,
  }] as FilaUnida['observaciones'],
  ...o,
});

function entorno() {
  const memoria = almacenMemoria();
  const cache = crearCache({
    almacen: () => memoria,
    versiones: { de: async (deps: readonly Dependencia[]) => versionDe({ ledger: 1, calendario: 3 }, deps), olvidar() {} },
    esperar: () => {},
  });
  const cuentas = { eventos: 0, tramo: [] as { desde: string; hasta: string; hoy: string }[], detalle: 0, inscritos: 0, podios: 0 };
  let hoy = '2026-10-08';
  const caches = crearCachesCalendario({
    cache,
    leer: {
      eventos: async () => {
        cuentas.eventos++;
        return [evento('e1'), evento('e2')];
      },
      tramo: async (t) => {
        cuentas.tramo.push(t);
        return { desde: t.desde, hasta: t.hasta, disponible: true, eventos: [evento('p1')], importados: [], resultados: {} } satisfies TramoPasado;
      },
      detalle: async (id) => {
        cuentas.detalle++;
        return id === 'nada' ? null : evento(id);
      },
      inscritos: async (id): Promise<{ filas: FilaUnida[]; estados: Record<string, EstadoLista> }> => {
        cuentas.inscritos++;
        if (id === 'nada') return { filas: [], estados: {} };
        return {
          filas: [fila({ nombre: 'MIA', athleteIds: ['ath-1'] }), fila({ nombre: 'OTRA', athleteIds: ['ath-2'] })],
          estados: { p1: 'con_datos' },
        };
      },
      podios: async () => {
        cuentas.podios++;
        return { tipo: 'ok', ediciones: [], podios: {} };
      },
      hoy: () => hoy,
    },
  });
  return { caches, cuentas, memoria, cambiarDia: (d: string) => { hoy = d; } };
}

describe('recorte de la temporada para la rejilla', () => {
  it('vacía lo que el cliente no lee y conserva lo que pinta la ficha', () => {
    const [e] = recortarParaRejilla([evento('e1')]);
    expect(e.linkedEvents).toEqual([]);
    expect([e.imageSource, e.circuitFie, e.regionalFederation, e.notes]).toEqual([null, null, null, null]);
    expect(e.competitions[0].status).toMatchObject({ state: 'verde', daysLeft: 12, closed: false, label: '', next: null });
    // La ficha se abre con esto: no puede perder documentos, horarios, cuota ni enlaces.
    expect(e.documents).toHaveLength(1);
    expect(e.sources).toHaveLength(1);
    expect(e.competitions[0]).toMatchObject({ feeEur: '30', startTime: '09:00', sourceUrl: 'https://example.test/prueba' });
    expect(e.timezone).toBe('Europe/Madrid');
    expect(JSON.stringify(e).length).toBeLessThan(JSON.stringify(evento('e1')).length);
  });
});

describe('calendario compartido', () => {
  it('la temporada se calcula una vez para todas las cuentas', async () => {
    const { caches, cuentas } = entorno();
    const a = await caches.eventosDelCalendario();
    const b = await caches.eventosDelCalendario();
    expect(cuentas.eventos).toBe(1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    expect(a[0].lastSeenAt).toBeInstanceOf(Date);
    expect(a[0].linkedEvents).toEqual([]);
  });

  it('un tramo antiguo no depende del día; uno reciente, sí', async () => {
    const { caches, cuentas } = entorno();
    await caches.tramoPasado({ desde: '2019-01-01', hasta: '2019-03-31', hoy: '2026-10-08' });
    await caches.tramoPasado({ desde: '2019-01-01', hasta: '2019-03-31', hoy: '2026-10-09' });
    expect(cuentas.tramo).toHaveLength(1);
    await caches.tramoPasado({ desde: '2026-10-01', hasta: '2026-10-07', hoy: '2026-10-08' });
    await caches.tramoPasado({ desde: '2026-10-01', hasta: '2026-10-07', hoy: '2026-10-08' });
    await caches.tramoPasado({ desde: '2026-10-01', hasta: '2026-10-07', hoy: '2026-10-09' });
    expect(cuentas.tramo).toHaveLength(3);
    const t = await caches.tramoPasado({ desde: '2019-01-01', hasta: '2019-03-31', hoy: '2026-10-08' });
    expect(t.eventos[0].linkedEvents).toEqual([]);
  });

  it('el detalle de un torneo que no existe no se guarda', async () => {
    const { caches, cuentas } = entorno();
    expect(await caches.detalle('nada')).toBeNull();
    expect(await caches.detalle('nada')).toBeNull();
    expect(cuentas.detalle).toBe(2);
    await caches.detalle('e1');
    await caches.detalle('e1');
    expect(cuentas.detalle).toBe(3);
  });

  it('la lista oficial guardada no lleva evidencias ni procedencia, y una vacía no se guarda', async () => {
    const { caches, cuentas } = entorno();
    const l = await caches.listaPublica('e1');
    await caches.listaPublica('e1');
    expect(cuentas.inscritos).toBe(1);
    const texto = JSON.stringify(l);
    expect(texto).not.toContain('observaciones');
    expect(texto).not.toContain('skermo.test');
    await caches.listaPublica('nada');
    await caches.listaPublica('nada');
    expect(cuentas.inscritos).toBe(3);
  });

  it('los identificadores de torneo que llegan del cliente se validan antes de ser clave', () => {
    expect(idDeEventoValido('8b7e0f7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(idDeEventoValido('fie-2027-186')).toBe(true);
    expect(idDeEventoValido('../x')).toBe(false);
    expect(idDeEventoValido('a'.repeat(81))).toBe(false);
    expect(idDeEventoValido(42)).toBe(false);
  });
});

describe('quién va: la lista es común, «es mío» es de cada cuenta', () => {
  it('dos cuentas con la misma entrada ven marcados sólo sus tiradores', async () => {
    const { caches, cuentas } = entorno();
    managed.porCuenta = { a: [{ id: 'ath-1' }], b: [{ id: 'ath-2' }] };
    const deA = await quienVaDelEvento({ profileId: 'a', role: 'athlete' }, 'e1', caches.listaPublica('e1'));
    const deB = await quienVaDelEvento({ profileId: 'b', role: 'athlete' }, 'e1', caches.listaPublica('e1'));
    expect(cuentas.inscritos).toBe(1);
    expect(deA.oficiales.map((o) => [o.nombre, o.esMio])).toEqual([['MIA', true], ['OTRA', false]]);
    expect(deB.oficiales.map((o) => [o.nombre, o.esMio])).toEqual([['MIA', false], ['OTRA', true]]);
    // Lo que se devuelve a la cuenta no lleva fichas ni procedencia.
    expect(JSON.stringify(deA)).not.toMatch(/ath-1|skermo\.test|observaciones/);
  });

  it('lo guardado nunca lleva la marca de la cuenta, y la guarda rechazaría guardarla', async () => {
    const { caches } = entorno();
    managed.porCuenta = { a: [{ id: 'ath-1' }] };
    await quienVaDelEvento({ profileId: 'a', role: 'athlete' }, 'e1', caches.listaPublica('e1'));
    const guardada = await caches.listaPublica('e1');
    expect(buscarDatoDeCuenta(guardada)).toBeNull();
    expect(JSON.stringify(guardada)).not.toContain('esMio');
    const vista = await quienVaDelEvento({ profileId: 'a', role: 'athlete' }, 'e1', Promise.resolve(guardada));
    expect(buscarDatoDeCuenta(vista)).not.toBeNull();
  });

  it('aListaPublica proyecta sólo lo que necesita la ficha', () => {
    const l = aListaPublica({ filas: [fila({ nombre: 'X', athleteIds: ['a'] })], estados: { p1: 'con_datos' } });
    expect(Object.keys(l.filas[0]).sort()).toEqual(['athleteIds', 'club', 'competitionId', 'equipo', 'nombre', 'retiradoEn']);
  });
});
