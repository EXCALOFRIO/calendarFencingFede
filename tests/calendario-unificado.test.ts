import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(app)/detalle-evento', () => ({ detalleDelEvento: vi.fn() }));
vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));
vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});

const { TarjetaBloque, DivisorHueco } = await import('@/components/calendario/tarjeta-bloque');
const { VistaCalendario } = await import('@/components/calendario/vista');
const { agruparEnBloques } = await import('@/lib/calendario/bloques');
const { pruebasDe, plazoDe } = await import('@/lib/calendario/rotulos');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

afterEach(() => vi.useRealTimers());

const estado = (daysLeft: number | null): CompetitionView['status'] => ({
  state: daysLeft === null ? 'sin_datos' : daysLeft <= 3 ? 'rojo' : 'ambar',
  label: '',
  next: null,
  daysLeft,
  currentSurchargeEur: null,
  nextSurchargeEur: null,
  closed: false,
  hasEstimates: false,
});

const prueba = (parcial: Partial<CompetitionView> = {}): CompetitionView => ({
  id: 'p1',
  weapon: 'FLORETE',
  gender: 'M',
  category: 'ABS',
  categoryRaw: null,
  format: 'INDIVIDUAL',
  competitionDate: '2026-10-17',
  installationOpen: null,
  callTime: null,
  scratchTime: null,
  startTime: null,
  registrationCount: null,
  feeEur: null,
  sourceUrl: null,
  deadlines: [],
  status: estado(2),
  datosExtraidos: [],
  ...parcial,
});

const evento = (parcial: Partial<EventView> = {}): EventView =>
  ({
    id: 'ev1',
    source: 'fie',
    sourceUrl: null,
    name: 'Copa del Mundo de Florete',
    startDate: '2026-10-15',
    endDate: '2026-10-18',
    venue: null,
    venueAddress: null,
    city: 'TAKAMATSU',
    country: 'JP',
    geoLat: null,
    geoLon: null,
    timezone: null,
    officialSite: null,
    imageUrl: null,
    imageSource: null,
    circuit: 'COPA_MUNDO',
    circuitFie: null,
    scope: 'INTERNACIONAL',
    regionalFederation: null,
    notes: null,
    lastSeenAt: new Date(0),
    disappearedAt: null,
    competitions: [prueba({ id: 'p1', competitionDate: '2026-10-15' }), prueba({ id: 'p2', competitionDate: '2026-10-18' })],
    documents: [],
    liveLinks: [],
    linkedEvents: [],
    sources: [],
    datosExtraidos: [],
    ...parcial,
  }) as EventView;

const tarjeta = (eventos: EventView[], inscripciones: Record<string, string> = {}) =>
  html(
    React.createElement(TarjetaBloque, {
      bloque: agruparEnBloques(eventos)[0],
      inscripciones,
      resaltados: new Set<string>(),
      proximo: null,
      mostrarArma: false,
      mostrarGenero: true,
      mostrarCategoria: false,
      onAbrir: vi.fn(),
      pasado: { hoy: '2026-10-01', resultados: {}, onVer: vi.fn() },
    }),
  );

describe('la fila de competición, una para todo', () => {
  it('fecha en bloque, nombre, sede con bandera y el estado a la derecha', () => {
    const marcado = tarjeta([evento()], { p1: 'pendiente' });
    const fecha = marcado.indexOf('data-slot="sistema-bloque-fecha"');
    const nombre = marcado.indexOf('Copa del Mundo de Florete');
    const estadoFila = marcado.indexOf('data-slot="estado-competicion"');
    expect(fecha).toBeGreaterThan(-1);
    expect(fecha).toBeLessThan(nombre);
    expect(nombre).toBeLessThan(estadoFila);
    expect(marcado).toContain('15–18');
    expect(marcado).toContain('OCT');
    expect(marcado).toContain('Takamatsu');
    // El plazo y «Inscrito» juntos: la inscripción no sustituye al plazo.
    const estadoHtml = marcado.slice(estadoFila);
    expect(estadoHtml).toContain('Cierra en 2 días');
    expect(estadoHtml).toContain('Inscrito');
    expect(estadoHtml).toContain('data-tono-plazo="peligro"');
    // La fila entera es el botón, y es pulsable.
    expect(marcado).toMatch(/<button[^>]*data-barra="torneo"[^>]*class="[^"]*pulsable/);
  });

  it('un bloque múltiple pinta una fila igual por torneo, cada una con su fecha', () => {
    const marcado = tarjeta([
      evento(),
      evento({ id: 'ev2', name: 'Torneo Nacional', source: 'skermo_rfee', scope: 'NACIONAL', circuit: 'NACIONAL', city: 'SABADELL', country: 'ES' }),
    ]);
    expect(marcado).toContain('torneos coinciden');
    expect(marcado.match(/data-slot="sistema-bloque-fecha"/g)).toHaveLength(2);
    expect(marcado.match(/data-slot="estado-competicion"/g)).toHaveLength(2);
    expect(marcado).toContain('Sabadell');
  });

  it('las pruebas salen como pastillas de `rotuloPrueba`, sólo con lo que el filtro deja variar', () => {
    const e = evento({ competitions: [prueba({ id: 'a', gender: 'M' }), prueba({ id: 'b', gender: 'F' }), prueba({ id: 'c', gender: 'F' })] });
    expect(pruebasDe(e, { arma: false, genero: true, categoria: false })).toEqual(['Masculino', 'Femenino']);
    expect(pruebasDe(e, { arma: true, genero: true, categoria: false })).toEqual(['Florete masculino', 'Florete femenino']);
    expect(pruebasDe(evento({ competitions: [prueba({ weapon: 'ESPADA', gender: 'F', category: 'M17' })] }), { arma: true, genero: true, categoria: true })).toEqual(['Espada Fem. M17']);
    expect(pruebasDe(e, { arma: false, genero: false, categoria: false })).toEqual([]);
  });

  it('el plazo dice «día» en singular y tiene tono de semáforo', () => {
    expect(plazoDe(evento({ competitions: [prueba({ status: estado(1) })] }))).toMatchObject({ texto: 'Cierra en 1 día', tono: 'peligro' });
    expect(plazoDe(evento({ competitions: [prueba({ status: estado(9) })] }))).toMatchObject({ texto: 'Cierra en 9 días', tono: 'aviso' });
    expect(plazoDe(evento({ competitions: [prueba({ status: estado(0) })] }))).toMatchObject({ texto: 'Cierra hoy' });
  });
});

describe('el divisor de semanas libres', () => {
  it('es un separador neutro, no un control, y su texto puede saltar de línea', () => {
    const marcado = html(React.createElement(DivisorHueco, { texto: '1 semana libre', rango: '19–25 oct' }));
    expect(marcado).toContain('role="separator"');
    expect(marcado).toContain('1 semana libre · 19–25 oct');
    expect(marcado).not.toMatch(/<button|<a |hover:|cursor-pointer|<svg/);
    expect(marcado).not.toContain('shrink-0');
  });
});

describe('la vista del calendario', () => {
  const vista = (props: Record<string, unknown>) =>
    html(
      React.createElement(VistaCalendario, {
        eventos: [evento()],
        perfil: { role: 'admin', weapons: [] },
        tiradores: [],
        inscripciones: {},
        temporada: '2026-2027',
        actualizado: null,
        solicitarInscripcion: vi.fn(),
        cargarInscritos: vi.fn(),
        ...props,
      } as React.ComponentProps<typeof VistaCalendario>),
    );

  it('sin `?mes=`, el mes de arranque sale del «hoy» del servidor, no del reloj del que pinta', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 30 sep a las 22:30 UTC: en Madrid ya es 1 de octubre; un Worker en UTC aún está en septiembre.
    vi.setSystemTime(new Date('2026-09-30T22:30:00Z'));
    const octubre = vista({ hoy: '2026-10-01', inicial: { vista: 'mes' } });
    expect(octubre).toMatch(/<h2[^>]*>Octubre/);
    // El servidor manda aunque el reloj diga otra cosa: el primer pintado del cliente coincide con el suyo.
    const noviembre = vista({ hoy: '2026-11-01', inicial: { vista: 'mes' } });
    expect(noviembre).toMatch(/<h2[^>]*>Noviembre/);
  });

  it('los filtros son un botón «Filtros» con su cuenta y chips que se quitan; sin carriles horizontales', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const marcado = vista({
      hoy: '2026-10-03',
      inicial: { mes: '2026-10', vista: 'trimestre', ambito: 'INTERNACIONAL', armas: ['FLORETE'] },
    });
    expect(marcado).toContain('aria-label="Filtros del calendario"');
    expect(marcado).toMatch(/data-tipo="menu"[^>]*>[\s\S]*?Filtros/);
    expect(marcado).toContain('aria-label="Quitar Internacional"');
    expect(marcado).toContain('aria-label="Quitar Florete"');
    expect(marcado).not.toMatch(/overflow-x-(auto|scroll)|snap-x/);
    // Sin filtros puestos no hay chips que quitar.
    const limpio = vista({ hoy: '2026-10-03', inicial: { mes: '2026-10', vista: 'trimestre' } });
    expect(limpio).not.toContain('aria-label="Quitar ');
  });
});
