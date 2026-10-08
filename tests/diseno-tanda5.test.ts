import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompetitionView, DatoExtraidoView, EventView } from '@/lib/queries/calendar';
import type { PruebaPasada } from '@/lib/queries/calendario-pasado-modelo';

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

const { VistaPrueba } = await import('@/components/explorar/prueba/vista-prueba');
const { SelectorPruebaPorNiveles } = await import('@/components/explorar/prueba/selector-prueba');
const { CabeceraExplorar } = await import('@/components/explorar/cabecera-explorar');
const { BandaEstasDentro } = await import('@/components/calendario/ficha-evento');
const { CabeceraFicha } = await import('@/components/calendario/cabecera-ficha');
const { HorariosTorneo } = await import('@/components/calendario/horarios-torneo');
const { LineaDireccion } = await import('@/components/calendario/ficha/datos-ficha');
const { BarraPlazos } = await import('@/components/calendario/barra-plazos');
const { TarjetaBloque } = await import('@/components/calendario/tarjeta-bloque');
const { ResultadosPasados, apellidoDe } = await import('@/components/calendario/pasado/resultados-pasados');
const { Sheet } = await import('@/components/ui/sheet');
const { agruparEnBloques } = await import('@/lib/calendario/bloques');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

const fila = { id: 'r1', puesto: 1, puestoPublicado: null, nombre: 'Ana Prueba', pais: 'ESP', club: null, personaId: null };
const asalto = (n: number) => ({ a: { nombre: `A${n}`, personaId: null, tocados: 5, gana: true }, b: { nombre: `B${n}`, personaId: null, tocados: 2, gana: false } });

const ESTADO: CompetitionView['status'] = {
  state: 'sin_datos', label: 'Plazo no publicado', next: null, daysLeft: null,
  currentSurchargeEur: null, nextSurchargeEur: null, closed: false, hasEstimates: false,
};
const prueba: CompetitionView = {
  id: 'p1', weapon: 'FLORETE', gender: 'F', category: 'ABS', categoryRaw: null, format: 'INDIVIDUAL',
  competitionDate: '2026-09-05', installationOpen: null, callTime: null, scratchTime: null, startTime: null,
  registrationCount: null, feeEur: null, sourceUrl: null, deadlines: [], status: ESTADO, datosExtraidos: [],
};
const evento: EventView = {
  id: 'ev1', source: 'fie', sourceUrl: null, name: 'Tournoi Satellite', startDate: '2026-09-05', endDate: '2026-09-05',
  venue: null, venueAddress: null, city: 'Reykjavik', country: 'IS', geoLat: null, geoLon: null, timezone: null,
  officialSite: null, imageUrl: null, imageSource: null, circuit: 'SATELITE', circuitFie: null, scope: 'INTERNACIONAL',
  regionalFederation: null, notes: null, lastSeenAt: new Date(0), disappearedAt: null, competitions: [prueba],
  documents: [], liveLinks: [], linkedEvents: [], sources: [], datosExtraidos: [],
} as EventView;
const pasada: PruebaPasada = {
  id: 'sc1', edicionId: '11111111-1111-4111-8111-111111111111', fuente: 'fie', arma: 'FLORETE', genero: 'F',
  categoria: 'ABS', categoriaRaw: null, formato: 'INDIVIDUAL', fecha: '2026-09-05', conResultados: true,
  ganador: { nombre: 'BROUSSARD Amelie', pais: 'NGR' }, urlOficial: 'https://fie.org/competitions/1',
};

describe('pantalla de prueba', () => {
  it('solo ofrece las vistas con datos, de 32 px con toque de 44 y con «Clasif.» en el móvil', () => {
    const marcado = html(React.createElement(VistaPrueba, {
      edicionId: 'e', base: { prueba: 'p', cursor: '' }, clasificacion: [fila],
      asaltos: { poules: [], cuadro: [{ ronda: 'T8', etiqueta: 'Cuartos', asaltos: [asalto(1)] }] } as never,
    }));
    // Botones con aria-current, no pestañas ARIA a medias.
    expect(marcado.match(/aria-controls=/g)).toHaveLength(2);
    expect(marcado).not.toContain('role="tab"');
    expect(marcado).not.toContain('>Poules<');
    expect(marcado).not.toContain('disabled=""');
    expect(marcado).toContain('grid-cols-2');
    // «Clasif.» se ve; «Clasificación» es lo que oye el lector (sin aria-label que tape lo visible).
    expect(marcado).toContain('<span class="truncate max-sm:sr-only">Clasificación</span>');
    expect(marcado).toContain('<span aria-hidden="true" class="sm:hidden">Clasif.</span>');
    expect(marcado).toMatch(/aria-controls="[^"]*"[^>]*class="inline-flex h-\[32px\][^"]*after:h-\[max\(100%,44px\)\]/);
    expect(marcado).not.toMatch(/\bh-10\b|\bsize-10\b/);
  });

  it('Individual y Equipos son una fila del selector por niveles, de 36 px con toque de 44', () => {
    const marcado = html(React.createElement(SelectorPruebaPorNiveles, {
      resumen: ['Espada femenina', 'Absoluto'],
      filas: [{
        dimension: 'formato', etiqueta: 'Modalidad', opciones: [
          { valor: 'INDIVIDUAL', etiqueta: 'Individual', destinoId: 'a', destinoHref: '/a', activa: true },
          { valor: 'EQUIPOS', etiqueta: 'Equipos', destinoId: 'b', destinoHref: '/b', activa: false },
        ],
      }],
    }));
    expect(marcado.match(/<a [^>]*class="[^"]*\bh-9\b[^"]*after:h-\[max\(100%,44px\)\]/g)).toHaveLength(2);
    expect(marcado).toContain('aria-label="Modalidad"');
    expect(marcado).toContain('>Espada femenina<');
    expect(marcado).not.toContain('aria-haspopup');
  });

  it('Explorar tiene cuatro ámbitos de 44 px de toque en un selector del sistema, sin pastillas de colecciones', () => {
    const marcado = html(React.createElement(CabeceraExplorar, { activa: 'competiciones' }));
    expect(marcado).toContain('data-slot="sistema-segmentado"');
    expect(marcado.match(/<a [^>]*class="[^"]*\bh-9\b[^"]*after:h-\[max\(100%,44px\)\]/g)).toHaveLength(4);
    expect(marcado).toContain('href="/explorar"');
    expect(marcado).toContain('href="/explorar/buscar"');
    expect(marcado).toContain('href="/explorar/buscar?ver=paises"');
    expect(marcado).toMatch(/<a[^>]*aria-current="page"[^>]*>(?:<[^>]+>)*Torneos</);
    expect(marcado).not.toContain('/explorar/favoritos');
  });
});

describe('ficha de evento', () => {
  it('sin lista publicada no hay banda «¿Estás dentro?»', () => {
    expect(html(React.createElement(BandaEstasDentro, { evento, prueba, inscritos: { oficiales: [], pendientes: [], estados: {} } }))).toBe('');
  });

  it('la apertura del pabellón va en el titular del día, una vez', () => {
    const d = (fecha: string, hora: string, n: number): DatoExtraidoView => ({
      id: `d${n}`, campo: `installation_open.${fecha}`, etiqueta: 'Apertura', valor: hora, estado: 'aprobado',
      pisadoPorPublicado: false, prueba: null, fecha, cita: `${hora} Venue open`, contexto: null,
      documento: { titulo: 'Inv', url: 'https://example.test' }, revisadoEn: null,
    });
    const ev = { ...evento, datosExtraidos: [d('2026-09-05', '07:00', 1), d('2026-09-06', '06:30', 2)] };
    const marcado = html(React.createElement(HorariosTorneo, { evento: ev, prueba: null }));
    expect(marcado).not.toContain('Apertura del pabellón');
    expect(marcado.match(/abre /g)).toHaveLength(2);
    expect(marcado).toContain('06:30');
  });

  it('la dirección va en una línea y abre el mapa', () => {
    const marcado = html(React.createElement(LineaDireccion, {
      pais: 'JP', texto: '6-11 Sunport, Takamatsu City', mapa: 'https://www.google.com/maps/search/?api=1&query=x',
    }));
    expect(marcado).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=x"');
    expect(marcado).toContain('truncate');
    expect(marcado).toContain('min-h-[44px]');
    expect(marcado).toContain('abrir en el mapa');
  });

  it('el enlace a la circular se ve de 32 px y se toca en 44', () => {
    const marcado = html(React.createElement(BarraPlazos, {
      plazos: [{ type: 'L1', label: 'Límite', deadlineAt: new Date('2026-10-02T21:59:00Z'), surchargeEur: null, blocking: false, origin: 'PUBLICADO', sourceDocument: 'Calendario oficial', sourceUrl: 'https://example.test/c' }],
      estado: ESTADO,
    }));
    expect(marcado).toMatch(/href="https:\/\/example\.test\/c"[^>]*class="[^"]*size-\[32px\][^"]*after:h-\[max\(100%,44px\)\]/);
  });

  it('la cabecera lleva la insignia del organismo, no una pastilla gris', () => {
    const marcado = html(React.createElement(Sheet, { open: true }, React.createElement(CabeceraFicha, { evento })));
    expect(marcado).toContain('data-organismo="FIE"');
  });
});

describe('calendario', () => {
  const tarjeta = () => html(React.createElement(TarjetaBloque, {
    bloque: agruparEnBloques([evento])[0], inscripciones: {}, resaltados: new Set<string>(),
    proximo: null, mostrarArma: true, mostrarGenero: true, mostrarCategoria: true, onAbrir: vi.fn(),
    pasado: { hoy: '2026-10-01', resultados: { ev1: [pasada] }, onVer: vi.fn() },
  }));

  it('«Terminada» y el ganador van en la misma línea, que es el enlace a los resultados', () => {
    const marcado = tarjeta();
    expect(marcado.match(/Terminada</g)).toHaveLength(1);
    const pie = marcado.slice(marcado.indexOf('data-resultados'));
    expect(pie.indexOf('Terminada')).toBeLessThan(pie.indexOf('BROUSSARD'));
    expect(pie).toMatch(/<a [^>]*href="\/explorar\/ediciones\//);
  });

  it('en el pie va el apellido del ganador, que es lo que cabe a 320 px', () => {
    expect(apellidoDe('BROU Isaora')).toBe('BROU');
    expect(apellidoDe('DE LOS MOZOS DELGADO Javier')).toBe('DE LOS MOZOS DELGADO');
    expect(apellidoDe('Koki Kano')).toBe('Koki Kano');
    expect(tarjeta()).not.toContain('Amelie');
  });

  it('una sola estructura: bloque de fecha a la izquierda, sin tira de días de la semana', () => {
    const marcado = tarjeta();
    expect(marcado).toContain('data-slot="sistema-bloque-fecha"');
    expect(marcado).not.toContain('size-[14px]');
    expect(marcado).not.toContain('text-off');
  });

  it('la tarjeta usa la misma insignia de organismo que la ficha', () => {
    expect(tarjeta()).toContain('data-organismo="FIE"');
  });

  it('«Resultados oficiales» en la hoja se ve de 32 px y se toca en 44', () => {
    const marcado = html(React.createElement(ResultadosPasados, { evento, pruebas: [pasada] }));
    expect(marcado).toMatch(/class="inline-flex size-\[32px\] [^"]*after:h-\[max\(100%,44px\)\][^"]*"[^>]*aria-label="Resultados oficiales/);
  });
});
