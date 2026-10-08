import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ComputedDeadline, DeadlineStatus } from '@/lib/deadlines';
import type { InscritoPublicado } from '@/lib/entries/union';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';

vi.mock('@/app/(app)/detalle-evento', () => ({ detalleDelEvento: vi.fn() }));
vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));
vi.mock('@/components/calendario/ficha/resultados-accion', () => ({ podiosDelEvento: vi.fn() }));
vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});

const { FichaEvento } = await import('@/components/calendario/ficha-evento');
const { BarraPlazos, construirTramos, estadoDeTramo, geometria } = await import('@/components/calendario/barra-plazos');
const { FilaInscrito } = await import('@/components/calendario/fila-inscrito');
const { HorariosTorneo } = await import('@/components/calendario/horarios-torneo');
const { resumenPlazo } = await import('@/lib/deadlines');

const html = (n: React.ReactElement) => renderToStaticMarkup(n);

const SIN_PLAZO: DeadlineStatus = {
  state: 'sin_datos', label: 'Plazo no publicado', next: null, daysLeft: null,
  currentSurchargeEur: null, nextSurchargeEur: null, closed: false, hasEstimates: false,
};

let n = 0;
function dato(campo: string, valor: string, extra: Partial<DatoExtraidoView> = {}): DatoExtraidoView {
  n += 1;
  return {
    id: `d-${n}`, campo, etiqueta: campo, valor, estado: 'sin_revisar', pisadoPorPublicado: false,
    prueba: null, fecha: null, cita: valor, contexto: null,
    documento: { titulo: 'Convocatoria', url: 'https://example.test/c.pdf' }, revisadoEn: null, ...extra,
  };
}

function prueba(sobre: Partial<CompetitionView> = {}): CompetitionView {
  return {
    id: 'p-esp-f', weapon: 'ESPADA', gender: 'F', category: 'ABS', categoryRaw: null, format: 'INDIVIDUAL',
    competitionDate: '2099-10-16', installationOpen: null, callTime: null, scratchTime: null, startTime: null,
    registrationCount: null, feeEur: null, sourceUrl: null, deadlines: [], status: SIN_PLAZO, datosExtraidos: [],
    ...sobre,
  } as CompetitionView;
}

function evento(sobre: Partial<EventView> = {}): EventView {
  return {
    id: 'ev', source: 'fie', sourceUrl: null, name: 'Copa del Mundo', startDate: '2099-10-15', endDate: '2099-10-18',
    venue: null, venueAddress: null, city: 'Takamatsu', country: 'JP', geoLat: null, geoLon: null, timezone: 'Asia/Tokyo',
    officialSite: null, imageUrl: null, imageSource: null, circuit: 'COPA_MUNDO', circuitFie: null, scope: 'INTERNACIONAL',
    regionalFederation: null, notes: null, lastSeenAt: new Date(0), disappearedAt: null, competitions: [prueba()],
    documents: [], liveLinks: [], linkedEvents: [], sources: [], datosExtraidos: [], ...sobre,
  } as EventView;
}

const ficha = (e: EventView) =>
  html(React.createElement(FichaEvento, { evento: e, tirador: null, inscritos: { oficiales: [], estados: {}, pendientes: [] } }));

const DIA = 86_400_000;
function plazo(tipo: ComputedDeadline['type'], dias: number, surchargeEur: string | null, sobre: Partial<ComputedDeadline> = {}): ComputedDeadline {
  return {
    type: tipo, label: tipo, deadlineAt: new Date(Date.now() + dias * DIA), surchargeEur, blocking: false,
    origin: 'PUBLICADO', sourceDocument: null, sourceUrl: null, ...sobre,
  };
}

describe('la prueba elegida: selector por niveles y una sola línea de rótulo', () => {
  const ev = evento({
    competitions: [
      prueba({ id: 'a', weapon: 'FLORETE', gender: 'M' }),
      prueba({ id: 'b', weapon: 'FLORETE', gender: 'F', format: 'EQUIPOS' }),
      prueba({ id: 'c', weapon: 'ESPADA', gender: 'F' }),
    ],
  });

  it('una fila por dimensión que varía, sin chips hechos a mano', () => {
    const m = ficha(ev);
    expect(m).toContain('data-slot="sistema-selector-niveles"');
    expect(m).toContain('aria-label="Arma"');
    expect(m).toContain('aria-label="Género"');
    expect(m).toContain('aria-label="Modalidad"');
    // Una sola categoría en el torneo: no hay fila de categoría.
    expect(m).not.toContain('aria-label="Categoría"');
    expect(m).not.toMatch(/FLO [MF]|, equipos/);
  });

  it('la cabecera de la prueba concuerda el género y escribe la modalidad', () => {
    const m = ficha(evento({ competitions: [prueba({ format: 'EQUIPOS', category: 'M17' })] }));
    expect(m).toMatch(/data-slot="cabecera-prueba"[\s\S]*Espada femenina · Equipos/);
    expect(m).toContain('>M17<');
    // Con una sola prueba no hay nada que elegir.
    expect(m).not.toContain('data-slot="sistema-selector-niveles"');
  });
});

describe('condiciones y procedencia', () => {
  const ev = evento({
    datosExtraidos: [
      dato('fee_eur', '80.00', { prueba: 'individual', cita: 'Individual entry: 80 EUR' }),
      dato('entry_quota', '12', { etiqueta: 'Cupo por federación' }),
      dato('payment_method', 'En efectivo'),
      dato('venue', 'Kagawa Prefectural Arena'),
    ],
  });

  it('pares rótulo–valor sin ningún icono pegado al valor', () => {
    const m = ficha(ev);
    expect(m).not.toContain('lucide-scan-text');
    expect(m).toMatch(/<dt[^>]*>(?:(?!<\/dt>).)*Cuota de inscripción(?:(?!<\/dt>).)*<\/dt><dd[^>]*><span[^>]*>80\s*€<\/span><\/dd>/);
    expect(m).toMatch(/<dd[^>]*><span[^>]*>12 tiradores<\/span><\/dd>/);
    expect(m).toMatch(/<dd[^>]*><span[^>]*>En efectivo<\/span><\/dd>/);
  });

  it('la cita se abre desde UN botón por banda, nunca desde el valor', () => {
    const m = ficha(ev);
    // Inscripción y Dónde y cuándo leen del PDF: un botón cada una.
    expect(m.match(/data-slot="segun-convocatoria"/g)).toHaveLength(2);
    // Ningún botón envuelve un bloque (el antiguo div dentro de button).
    expect(m).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<div/);
  });
});

describe('la barra de plazos', () => {
  const plazos = [
    plazo('L1', 5, '0'),
    plazo('L2', 9, '15'),
    plazo('L3', 12, null, { blocking: true, origin: 'CALCULADO' }),
  ];
  const estado: DeadlineStatus = { ...SIN_PLAZO, state: 'ambar', label: 'Quedan 5 días', daysLeft: 5, next: plazos[0] };

  it('una fila por tramo, con fecha a la izquierda y estado a la derecha, y la de hoy marcada', () => {
    const m = html(React.createElement(BarraPlazos, { plazos, estado, conEstado: false }));
    const filas = m.match(/<li [^>]*data-plazo="tramo"[^>]*>/g) ?? [];
    expect(filas).toHaveLength(4);
    for (const f of filas) expect(f).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(m.match(/aria-current="step"/g)).toHaveLength(1);
    expect(m).toMatch(/data-estado="actual"[^>]*>[\s\S]*?Hasta/);
    expect(m.match(/Sin recargo/g)).toHaveLength(2);
    expect(m).toMatch(/\+15\s*€/);
    expect(m).toContain('Cerrada');
    expect(m).toContain('Después');
    expect(m).toContain('(estimada)');
    expect(m).toContain('Hoy');
    expect(m).not.toContain('truncate');
  });

  it('cada tramo dice algo o nada, nunca un espacio que encoge la fila', () => {
    const tramos = construirTramos(plazos, new Date());
    expect(tramos.map((t, i) => estadoDeTramo(t, i, plazos[2])?.replace(/\s/g, ' '))).toEqual([
      'Sin recargo',
      'Sin recargo',
      '+15 €',
      'Cerrada',
    ]);
    const { hitos, hoy } = geometria(tramos);
    expect(hitos).toHaveLength(3);
    expect(hoy).toBeGreaterThanOrEqual(0);
    expect(hoy).toBeLessThan(hitos[0]);
  });

  it('el estado corto de la cabecera', () => {
    expect(resumenPlazo({ ...estado, state: 'rojo', daysLeft: 2 })).toEqual({ texto: 'Cierra en 2 días', tono: 'peligro' });
    expect(resumenPlazo({ ...estado, daysLeft: 1 })).toEqual({ texto: 'Cierra mañana', tono: 'aviso' });
    expect(resumenPlazo({ ...estado, state: 'cerrado', closed: true })).toEqual({ texto: 'Cerrada', tono: 'neutro' });
    expect(resumenPlazo(SIN_PLAZO)).toBeNull();
  });

  it('la ficha pone el estado en una pastilla en la cabecera de «Inscripción»', () => {
    const m = ficha(evento({ competitions: [prueba({ deadlines: plazos, status: { ...estado, state: 'rojo', daysLeft: 2 } })] }));
    expect(m).toMatch(/>Inscripción<\/h3>[\s\S]*?data-slot="estado-plazo"[^>]*>Cierra en 2 días</);
  });
});

describe('los inscritos', () => {
  const base: InscritoPublicado = {
    competitionId: 'c', nombre: 'PEREZ GARCIA Ana', equipo: null, club: null, esMio: false, retiradoEn: null,
  };
  const fila = (i: InscritoPublicado) => html(React.createElement(FilaInscrito, { inscrito: i }));

  it('avatar, bandera y nombre, y los puestos a la derecha, en el mismo orden en todas las filas', () => {
    const enlazada = fila({
      ...base, personaId: '11111111-1111-4111-8111-111111111111',
      extra: { pais: 'ESP', mundial: { puesto: 126, absoluto: false }, nacional: { puesto: 2, absoluto: false } },
    });
    const avatar = enlazada.indexOf('sistema-avatar');
    const nombre = enlazada.indexOf('Ana Perez Garcia');
    const fie = enlazada.indexOf('FIE #126');
    expect(avatar).toBeGreaterThan(-1);
    expect(avatar).toBeLessThan(nombre);
    expect(nombre).toBeLessThan(fie);
    expect(fie).toBeLessThan(enlazada.indexOf('RFEE #2'));

    const suelta = fila(base);
    expect(suelta.indexOf('sistema-avatar')).toBeLessThan(suelta.indexOf('Ana Perez Garcia'));
    expect(suelta).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
    expect(enlazada).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
  });

  it('la de equipo conserva el hueco del avatar y la propia lleva «Tú»', () => {
    const equipo = fila({ ...base, nombre: 'ESPAÑA', equipo: 'ESPAÑA' });
    expect(equipo).toContain('lucide-users');
    expect(equipo).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
    const propia = fila({ ...base, esMio: true });
    expect(propia).toContain('>Tú<');
    expect(propia).not.toContain('>tú<');
  });
});

describe('el horario', () => {
  const p = prueba({
    datosExtraidos: [
      dato('pools_start.2099-10-16.x', '09:00', { fecha: '2099-10-16', cita: '09:00 Pools' }),
      dato('start_time.2099-10-16.x', '14:00', { fecha: '2099-10-16', cita: '14:00 T64 starting time' }),
    ],
  });
  const ev = evento({ competitions: [p] });

  it('tres columnas fijas en la cabecera, en el día y en cada fila', () => {
    const m = html(React.createElement(HorariosTorneo, { evento: ev, prueba: p }));
    const columnas = m.match(/grid-cols-\[3\.5rem_minmax\(0,1fr\)_3\.5rem\]/g) ?? [];
    // Cabecera + titular del día + dos filas.
    expect(columnas.length).toBe(4);
    expect(m).toContain('>JST<');
    expect(m).toContain('>Tu hora<');
    expect(m).toContain('Cuadro de 64');
    expect(m).toContain('Espada femenina');
  });

  it('la prueba elegida se destaca con fondo, sin filete que desplace el texto', () => {
    const m = html(React.createElement(HorariosTorneo, { evento: ev, prueba: p }));
    expect(m.match(/data-destacada="true"/g)).toHaveLength(2);
    expect(m).toContain('bg-marcado');
    expect(m).not.toContain('border-l-2');
    expect(m).not.toContain('lucide-scan-text');
  });
});
