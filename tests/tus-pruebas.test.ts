import { describe, expect, it } from 'vitest';
import {
  CIERRE_PRONTO_DIAS,
  filasDeTusPruebas,
  type SolicitudDeCuenta,
  type TiradorDeCuenta,
} from '@/lib/calendario/tus-pruebas';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';

/**
 * «Tus pruebas», la franja que va encima del calendario: qué le toca a la
 * cuenta sin consultar nada más que lo que la pantalla ya cargó.
 *
 * Lo que se fija aquí, porque se puede romper sin que salte ningún error:
 *
 *  1. Sin tiradores vinculados, nada —la sección ni se pinta.
 *  2. Una solicitud sale como `inscrito` y su prueba no se repite como plazo.
 *  3. «Cierra pronto» tiene tope; un plazo de dentro de un trimestre no llena
 *    la franja.
 *  4. Lo que le toca a cada uno respeta arma, género, categoría y formato.
 */

let seq = 0;

function prueba(over: Partial<CompetitionView> = {}): CompetitionView {
  return {
    id: `c-${(seq += 1)}`,
    weapon: 'FLORETE',
    gender: 'F',
    category: 'M17',
    categoryRaw: null,
    format: 'INDIVIDUAL',
    competitionDate: null,
    installationOpen: null,
    callTime: null,
    scratchTime: null,
    startTime: null,
    registrationCount: null,
    feeEur: null,
    sourceUrl: null,
    deadlines: [],
    status: {
      state: 'verde',
      label: 'Plazo abierto',
      next: null,
      daysLeft: null,
      currentSurchargeEur: null,
      nextSurchargeEur: null,
      closed: false,
      hasEstimates: false,
    },
    datosExtraidos: [],
    ...over,
  };
}

function evento(over: Partial<EventView> = {}): EventView {
  return {
    id: `e-${(seq += 1)}`,
    source: 'skermo_rfee',
    sourceUrl: null,
    name: 'Torneo de prueba',
    startDate: '2026-10-03',
    endDate: '2026-10-04',
    venue: null,
    venueAddress: null,
    city: 'León',
    country: 'ESP',
    geoLat: null,
    geoLon: null,
    timezone: null,
    officialSite: null,
    imageUrl: null,
    circuit: 'OTRO',
    scope: 'NACIONAL',
    regionalFederation: null,
    notes: null,
    lastSeenAt: new Date(),
    disappearedAt: null,
    cancelled: false,
    competitions: [prueba()],
    documents: [],
    liveLinks: [],
    linkedEvents: [],
    sources: [{ source: 'skermo_rfee', name: 'Torneo de prueba', url: null }],
    imageSource: null,
    circuitFie: null,
    datosExtraidos: [],
    ...over,
  };
}

const TIRADORA: TiradorDeCuenta = {
  id: 'a-1',
  fullName: 'María López',
  gender: 'F',
  weapons: ['FLORETE'],
  eligibleCategories: ['M17', 'M20', 'ABS'],
};

function solicitud(over: Partial<SolicitudDeCuenta> = {}): SolicitudDeCuenta {
  return {
    competitionId: 'c-1',
    athleteId: 'a-1',
    status: 'submitted',
    ...over,
  };
}

describe('sin tiradores no hay sección', () => {
  it('una cuenta sin fichas vinculadas no produce filas', () => {
    expect(
      filasDeTusPruebas({ eventos: [evento()], tiradores: [], solicitudes: [] }),
    ).toEqual([]);
  });
});

describe('las inscripciones se ven como inscripciones', () => {
  it('una solicitud sale como fila `inscrito` con su estado', () => {
    const c = prueba({ id: 'c-9' });
    const e = evento({ id: 'e-9', name: 'COPA DE ESPAÑA M17', competitions: [c] });
    const filas = filasDeTusPruebas({
      eventos: [e],
      tiradores: [TIRADORA],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].tipo).toBe('inscrito');
    expect(filas[0].solicitud).toBe('submitted');
    expect(filas[0].eventId).toBe('e-9');
    expect(filas[0].athleteName).toBe('María López');
  });

  it('una prueba ya solicitada no se repite como plazo para el mismo tirador', () => {
    const c = prueba({ id: 'c-9', status: { ...prueba().status, daysLeft: 3 } });
    const e = evento({ competitions: [c] });
    const filas = filasDeTusPruebas({
      eventos: [e],
      tiradores: [TIRADORA],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    expect(filas.map((f) => f.tipo)).toEqual(['inscrito']);
  });

  it('…pero sí avisa del plazo al hermano que aún no la ha pedido', () => {
    const c = prueba({ id: 'c-9', status: { ...prueba().status, daysLeft: 3 } });
    const e = evento({ competitions: [c] });
    const hermano: TiradorDeCuenta = { ...TIRADORA, id: 'a-2', fullName: 'Pablo López', gender: 'M' };
    const cMasc = prueba({ id: 'c-10', gender: 'M', status: { ...prueba().status, daysLeft: 3 } });
    const e2 = evento({ id: 'e-10', name: 'Otro torneo', competitions: [cMasc] });
    const filas = filasDeTusPruebas({
      eventos: [e, e2],
      tiradores: [TIRADORA, hermano],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    const plazo = filas.find((f) => f.tipo === 'plazo');
    expect(plazo?.athleteName).toBe('Pablo López');
    expect(plazo?.diasCierre).toBe(3);
  });
});

describe('los plazos que cierran pronto', () => {
  it('una prueba que le toca con `daysLeft` dentro del tope sale como `plazo`', () => {
    const pedida = prueba({ id: 'c-9' });
    const suya = prueba({ id: 'c-11', status: { ...prueba().status, daysLeft: 5 } });
    const e1 = evento({ id: 'e-1', competitions: [pedida] });
    const e2 = evento({ id: 'e-2', name: 'TNR', competitions: [suya] });
    const filas = filasDeTusPruebas({
      eventos: [e1, e2],
      tiradores: [TIRADORA],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    expect(filas.map((f) => f.tipo)).toEqual(['inscrito', 'plazo']);
    expect(filas[1].diasCierre).toBe(5);
  });

  it(`un plazo de más de ${CIERRE_PRONTO_DIAS} días no es «pronto»`, () => {
    const pedida = prueba({ id: 'c-9' });
    const lejana = prueba({ id: 'c-11', status: { ...prueba().status, daysLeft: CIERRE_PRONTO_DIAS + 1 } });
    const filas = filasDeTusPruebas({
      eventos: [evento({ competitions: [pedida] }), evento({ id: 'e-2', competitions: [lejana] })],
      tiradores: [TIRADORA],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    expect(filas.map((f) => f.tipo)).toEqual(['inscrito']);
  });

  it('un torneo cancelado no es plazo ni próxima; una solicitud suya se queda, marcada', () => {
    const pedida = prueba({ id: 'c-9' });
    const caida = prueba({ id: 'c-11', status: { ...prueba().status, daysLeft: 5 } });
    const filas = filasDeTusPruebas({
      eventos: [
        evento({ id: 'e-1', cancelled: true, competitions: [pedida] }),
        evento({ id: 'e-2', cancelled: true, competitions: [caida] }),
      ],
      tiradores: [TIRADORA],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    // Estabas dentro cuando cayó: la fila se queda, pero marcada y sin plazo.
    expect(filas.map((f) => f.tipo)).toEqual(['inscrito']);
    expect(filas[0].cancelada).toBe(true);
    expect(filas[0].diasCierre).toBeNull();
  });

  it('una prueba ya cerrada no se anuncia', () => {
    const pedida = prueba({ id: 'c-9' });
    const cerrada = prueba({
      id: 'c-11',
      status: { ...prueba().status, daysLeft: null, closed: true },
    });
    const filas = filasDeTusPruebas({
      eventos: [evento({ competitions: [pedida] }), evento({ id: 'e-2', competitions: [cerrada] })],
      tiradores: [TIRADORA],
      solicitudes: [solicitud({ competitionId: 'c-9' })],
    });
    expect(filas).toHaveLength(1);
  });
});

describe('sin inscripciones, las próximas que le tocan', () => {
  it('salen por fecha y con su arma y categoría', () => {
    const tarde = evento({ id: 'e-1', name: 'Después', startDate: '2026-11-14', endDate: '2026-11-15' });
    const pronto = evento({ id: 'e-2', name: 'Antes', startDate: '2026-10-10', endDate: '2026-10-11' });
    const filas = filasDeTusPruebas({
      eventos: [tarde, pronto],
      tiradores: [TIRADORA],
      solicitudes: [],
    });
    expect(filas.map((f) => f.eventName)).toEqual(['Antes', 'Después']);
    expect(filas.every((f) => f.tipo === 'proxima')).toBe(true);
  });

  it('ni otra arma, ni otro género, ni otra categoría, ni equipos', () => {
    const c = prueba({
      id: 'c-1',
      weapon: 'ESPADA',
    });
    const c2 = prueba({ id: 'c-2', gender: 'M' });
    const c3 = prueba({ id: 'c-3', category: 'VET' });
    const c4 = prueba({ id: 'c-4', format: 'EQUIPOS' });
    const mia = prueba({ id: 'c-5', competitionDate: '2026-10-04' });
    const e = evento({ competitions: [c, c2, c3, c4, mia] });
    const filas = filasDeTusPruebas({ eventos: [e], tiradores: [TIRADORA], solicitudes: [] });
    expect(filas).toHaveLength(1);
    expect(filas[0].prueba).toContain('M17');
  });

  it('una prueba de género mixto la ven todos, como en el calendario', () => {
    const mixta = prueba({ id: 'c-1', gender: 'MIXTO' });
    const e = evento({ competitions: [mixta] });
    const filas = filasDeTusPruebas({ eventos: [e], tiradores: [TIRADORA], solicitudes: [] });
    expect(filas).toHaveLength(1);
  });
});
