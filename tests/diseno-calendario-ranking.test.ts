import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Browser, BrowserContext, BrowserServer, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventView, CompetitionView } from '@/lib/queries/calendar';
import type { RankingGroupKey, RankingTableView, TablaOficial } from '@/lib/queries/ranking';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import type { ComputedDeadline } from '@/lib/deadlines';
import type { QuienVa } from '@/app/(app)/inscritos';
import { esperarSalidaPropia, perfilPropio, terminarNavegadorPropio, terminarRestosDelPerfil } from './helpers/proceso-navegador';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(app)/detalle-evento', () => ({ detalleDelEvento: vi.fn() }));
vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));

// Mismas implementaciones reales, por su entrada CommonJS. Evita que Vite
// recorra los miles de reexports ESM de estos paquetes durante la colección.
vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const postcss = require('postcss') as typeof import('postcss').default;
const tailwind = require('@tailwindcss/postcss') as typeof import('@tailwindcss/postcss').default;

const { VistaCalendario } = await import('@/components/calendario/vista');
const { TarjetaBloque } = await import('@/components/calendario/tarjeta-bloque');
const { NavEscritorio, NavMovil } = await import('@/components/nav');
const { DESTINOS_APP } = await import('@/components/navegacion-app');
const { TablaRankingOficial } = await import('@/components/ranking/tabla-oficial');
const { TablaRankingFie } = await import('@/components/ranking/tabla-fie');
const { TablaRanking } = await import('@/components/ranking/tabla-ranking');
const { TiraTemporadas } = await import('@/components/ranking/tira-temporadas');
const { FichaEvento, BandaEstasDentro } = await import('@/components/calendario/ficha-evento');
const { BarraPlazos } = await import('@/components/calendario/barra-plazos');
const { Button } = await import('@/components/ui/button');
const { Input } = await import('@/components/ui/input');
const { agruparEnBloques } = await import('@/lib/calendario/bloques');

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const salida = join(tmpdir(), 'qa-prod-calendario', 'droids', 'diseno-offline');
const fuente = (ruta: string) => readFileSync(join(raiz, ruta), 'utf8');
const html = (nodo: React.ReactElement) => {
  // La fecha solo pertenece al render. Playwright necesita el reloj real
  // también para cerrar su proceso y limpiar el perfil temporal en Windows.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  try {
    return renderToStaticMarkup(nodo);
  } finally {
    vi.useRealTimers();
  }
};
const grupo = { weapon: 'FLORETE', gender: 'F', category: 'ABS' } as const satisfies RankingGroupKey;
const clave = 'FLORETE|F|ABS';
const nombre = 'Lucía García de la Torre Fernández';
const prueba: CompetitionView = {
  id: 'prueba-diseno',
  ...grupo,
  categoryRaw: null,
  format: 'INDIVIDUAL',
  competitionDate: '2026-10-03',
  installationOpen: null,
  callTime: null,
  scratchTime: null,
  startTime: null,
  registrationCount: null,
  feeEur: '80',
  sourceUrl: null,
  deadlines: [],
  status: {
    state: 'sin_datos',
    label: 'Plazo no publicado',
    next: null,
    daysLeft: null,
    currentSurchargeEur: null,
    nextSurchargeEur: null,
    closed: false,
    hasEstimates: false,
  },
  datosExtraidos: [],
};
const evento: EventView = {
  id: 'evento-diseno',
  source: 'skermo_rfee',
  sourceUrl: null,
  name: 'TORNEO NACIONAL ABSOLUTO DE FLORETE',
  startDate: '2026-10-03',
  endDate: '2026-10-04',
  venue: null,
  venueAddress: null,
  city: 'SABADELL',
  country: 'ESP',
  geoLat: null,
  geoLon: null,
  timezone: null,
  officialSite: null,
  imageUrl: null,
  imageSource: null,
  circuit: 'NACIONAL',
  circuitFie: null,
  scope: 'NACIONAL',
  regionalFederation: null,
  notes: null,
  lastSeenAt: new Date('2026-10-01T12:00:00Z'),
  disappearedAt: null,
  competitions: [prueba],
  documents: [],
  liveLinks: [],
  linkedEvents: [],
  sources: [{ source: 'skermo_rfee', name: 'Torneo nacional', url: null }],
  datosExtraidos: [],
};
const oficial: TablaOficial = {
  group: grupo,
  seasonLabel: '2026-2027',
  rows: [{
    id: 'fila-diseno', nombre, athleteId: null, position: null,
    totalPoints: null, club: 'CNE-NA', anioNacimiento: 2006,
  }],
  clasificados: 0,
  actualizadoEl: new Date('2026-10-01T12:00:00Z'),
  sourceUrl: 'https://example.test/rfee',
  rule: null,
};
const mundial: TablaFieCompleta = {
  group: grupo,
  format: 'INDIVIDUAL',
  season: 2026,
  rows: [{
    fieId: 123, nombre, athleteId: null, esMio: false, position: 123,
    pais: 'ESP', paisNombre: 'España', points: null, eventCount: 0,
    fichaUrl: 'https://example.test/fie/123',
  }],
  espanoles: 1,
  actualizadoEl: new Date('2026-10-01T12:00:00Z'),
  sourceUrl: 'https://example.test/fie',
  olimpica: null,
  personas: {},
};
const calendario = () => React.createElement(VistaCalendario, {
  eventos: [evento], perfil: { role: 'admin', weapons: [] }, tiradores: [],
  inscripciones: {}, temporada: '2026-2027', actualizado: '1 oct 2026',
  inicial: { mes: '2026-10', vista: 'trimestre' },
  solicitarInscripcion: vi.fn(), cargarInscritos: vi.fn(),
});
const nacional = () => React.createElement(TablaRankingOficial, {
  grupos: [{ ...grupo, tiradores: 1 }], tablas: { [clave]: oficial },
  cortes: {}, desgloses: {}, internos: {}, mios: [], grupoInicial: clave,
});
const fie = () => React.createElement(TablaRankingFie, {
  grupos: [{ ...grupo, format: 'INDIVIDUAL', tiradores: 1 }],
  inicial: { ...grupo, format: 'INDIVIDUAL' }, primeraTabla: mundial,
  mios: [], cargar: vi.fn(),
});
const tablaInterna: RankingTableView = {
  group: grupo,
  rows: [{
    ...grupo, athleteId: 'tiradora-diseno', athleteName: nombre,
    clubName: 'Club Nacional de Esgrima de Navarra', position: 3,
    totalPoints: 1234.5, countedEvents: 2, change: null,
  }],
  computedAt: new Date('2026-10-01T12:00:00Z'),
  previousComputedAt: null,
  rule: null,
};
const interno = () => React.createElement(TablaRanking, {
  grupos: [{ ...grupo, athletes: 1 }], tablas: { [clave]: tablaInterna },
  cortes: {}, desgloses: {}, mios: ['tiradora-diseno'], grupoInicial: clave,
});
const plazos: ComputedDeadline[] = [
  { type: 'L1', label: 'Límite ordinario', deadlineAt: new Date('2026-10-02T21:59:00Z'), surchargeEur: '15', blocking: false, origin: 'PUBLICADO', sourceDocument: 'Circular de inscripción', sourceUrl: 'https://example.test/circular' },
  { type: 'L2', label: 'Segundo plazo', deadlineAt: new Date('2026-10-03T16:00:00Z'), surchargeEur: '30', blocking: false, origin: 'CALCULADO', sourceDocument: null, sourceUrl: null },
  { type: 'L3', label: 'Tercer plazo', deadlineAt: new Date('2026-10-04T21:59:00Z'), surchargeEur: null, blocking: true, origin: 'CALCULADO', sourceDocument: null, sourceUrl: null },
];
const estadoPlazos: CompetitionView['status'] = {
  ...prueba.status, state: 'ambar', label: 'Segundo plazo: cierra hoy',
  next: plazos[1], daysLeft: 0, currentSurchargeEur: '15', nextSurchargeEur: '30',
  hasEstimates: true,
};
const lista: QuienVa = {
  oficiales: [{ competitionId: prueba.id, nombre, equipo: null, club: 'Club Nacional de Esgrima de Navarra', esMio: true, retiradoEn: null }],
  estados: { [prueba.id]: 'con_datos' },
  pendientes: [],
};
const ficha = () => React.createElement('div', { className: 'calendario' }, React.createElement(FichaEvento, {
  evento, tirador: null, inscripciones: {}, inscritos: null, onSolicitar: vi.fn(),
}));
const temporadas = () => React.createElement(TiraTemporadas, {
  temporadas: [
    { id: 'actual', temporada: '2026-2027', puesto: 123, puntos: null, categoria: 'Absoluto' },
    { id: 'anterior', temporada: '2025-2026', puesto: null, puntos: null, categoria: 'Menores de 20 años' },
    { id: 'previa', temporada: '2024-2025', puesto: 145, puntos: 120, categoria: 'Menores de 17 años' },
  ],
});

describe('calendario, navegación y ranking: contrato de presentación', () => {
  it('una sola barra con los mismos cuatro destinos para todos, sin submenús', () => {
    expect(DESTINOS_APP.map((d) => d.href)).toEqual(['/', '/explorar', '/ranking', '/explorar/yo']);
    for (const Nav of [NavEscritorio, NavMovil]) {
      const marcado = html(React.createElement(Nav, { role: 'admin' }));
      expect(marcado).toContain('aria-current="page"');
      expect(marcado).toContain('focus-visible:ring');
      expect(marcado).not.toContain('truncate');
      expect(marcado).not.toContain('/admin');
    }
    // La celda de la barra es el área táctil entera; la pastilla del escritorio se toca en 44.
    expect(html(React.createElement(NavMovil, { role: 'admin' }))).toContain('h-[50px]');
    expect(html(React.createElement(NavEscritorio, { role: 'admin' }))).toContain('h-[44px]');
  });

  it('no vuelve a limitar el área táctil al puntero grueso ni permite excepciones', () => {
    const css = fuente('src/app/globals.css');
    expect(css).not.toContain('@media (pointer: coarse)');
    expect(css).not.toContain(':not(.objetivo-libre)');
    // Área táctil invisible de 44 px en todos los botones, sin agrandar lo que se ve.
    expect(css).toMatch(/:where\(button[\s\S]*?\)::after \{[\s\S]*?width: max\(100%, 44px\);[\s\S]*?height: max\(100%, 44px\);/);
    expect(css).not.toMatch(/:where\([^)]*button[\s\S]*?\) \{\s*min-height: 44px;/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/overflow-x:\s*(hidden|clip)/);
  });

  it('las herramientas anuncian qué periodo cambian y conservan el contexto', () => {
    const marcado = html(calendario());
    expect(marcado).toContain('aria-label="Trimestre anterior"');
    expect(marcado).toContain('aria-label="Trimestre siguiente"');
    expect(marcado).toContain('Buscar un torneo o una sede');
    expect(marcado).toContain('aria-label="Filtros del calendario"');
    expect(marcado).toContain('Ir a octubre 2026');
    // Lo marcado es el del sistema (invertido), no un rojo propio de la pantalla.
    expect(fuente('src/components/calendario/vista.tsx')).toContain('<ChipFiltro');
    expect(marcado).not.toContain('objetivo-libre');
  });

  it('la fecha manda y cada torneo conserva el nombre, la sede y la acción', () => {
    const segundo = { ...evento, id: 'otro-evento', name: 'COPA DEL MUNDO DE FLORETE', source: 'fie', scope: 'INTERNACIONAL' as const, city: 'PARIS', country: 'FRA' };
    const bloque = agruparEnBloques([evento, segundo])[0];
    {
      const marcado = html(React.createElement(TarjetaBloque, {
        bloque, inscripciones: {}, resaltados: new Set<string>(),
        proximo: null, mostrarArma: true, mostrarGenero: true, mostrarCategoria: true, onAbrir: vi.fn(),
      }));
      expect(marcado).toContain('torneos coinciden');
      expect(marcado).toContain('Sabadell');
      expect(marcado).toContain('Paris');
      // El botón se nombra por lo que enseña (WCAG 2.5.3), sin aria-label que lo tape.
      expect(marcado).toContain('data-barra="torneo"');
      expect(marcado).not.toContain('Abrir la ficha.');
      expect(marcado).toContain('data-slot="sistema-bloque-fecha"');
      expect(marcado).not.toMatch(/uppercase|tracking-widest|truncate|objetivo-libre/);
    }
  });

  it('el ranking mantiene las ausencias, la fuente y las limitaciones, sin notas de reparación', () => {
    const nacionalHtml = html(nacional());
    expect(nacionalHtml).toContain(nombre);
    expect(nacionalHtml).toContain('</span> sin ficha</p>');
    expect(nacionalHtml).toContain('sin plazos ni inscripciones');
    expect(nacionalHtml).not.toContain('ni cálculo interno');
    // Sin «Fuente: …» ni la sigla como rótulo (docs/diseno-sistema.md § 6): temporada, fecha y el enlace al original.
    expect(nacionalHtml).not.toContain('clasificación oficial de la RFEE');
    expect(nacionalHtml).toContain('Original');
    expect(nacionalHtml).toContain('https://example.test/rfee');
    expect(nacionalHtml).not.toContain('Se arregla de uno en uno');
    const mundialHtml = html(fie());
    expect(mundialHtml).toContain(nombre);
    expect(mundialHtml).not.toContain('· FIE');
    expect(mundialHtml).not.toMatch(/[Mm]undial/);
    expect(mundialHtml).toContain('Temporada');
    expect(mundialHtml).toContain('123');
    expect(mundialHtml).not.toContain('checked=""');
  });

  it('no inventa tendencias ni puntos cuando la fuente no los publica', () => {
    const marcado = html(React.createElement(TiraTemporadas, {
      temporadas: [{ id: 'temporada', temporada: '2026', puesto: null, puntos: null, categoria: 'Absoluto' }],
    }));
    expect(marcado).toContain('sin clasificar');
    expect(marcado).toContain('puntos no publicados');
    expect(marcado).toContain('sin temporada anterior con la que comparar');
    // Rejilla, no carrusel: nada se desplaza en horizontal y el resto va detrás de «Ver más».
    expect(marcado).not.toMatch(/carousel|overflow-x/);
    const muchas = html(React.createElement(TiraTemporadas, {
      temporadas: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, temporada: String(2026 - i), puesto: i + 1, puntos: 10, categoria: 'Absoluto' })),
    }));
    expect(muchas.match(/<article/g)).toHaveLength(6);
    expect(muchas).toContain('Ver más (2)');
  });

  it('conserva cuota, recargos, horas, procedencia y fechas estimadas sin elipsis', () => {
    expect(html(ficha())).toContain('Cuota de inscripción');
    expect(html(ficha())).toMatch(/80\s*€/);
    const marcado = html(React.createElement(BarraPlazos, { plazos, estado: estadoPlazos }));
    expect(marcado).toMatch(/\+15\s*€/);
    expect(marcado).toMatch(/\+30\s*€/);
    expect(marcado).toContain('18:00');
    expect(marcado).toContain('Segundo plazo: cierra hoy');
    expect(marcado).toContain('estimadas según la normativa, no publicadas');
    expect(marcado).toContain('https://example.test/circular');
    expect(marcado).not.toContain('truncate');
  });

  it('distingue lista en lectura, no publicada, vacía y lectura fallida sin ocultar datos retenidos', () => {
    const banda = (inscritos: QuienVa | null, fallo = false) =>
      html(React.createElement(BandaEstasDentro, { evento, prueba, inscritos, fallo }));
    // Mientras llega no se pinta nada (ni esqueleto): llega precargada con la intención.
    expect(banda(null)).toBe('');
    // Sin lista publicada la banda no se pinta: no hay nada que mirar todavía.
    expect(banda({ oficiales: [], pendientes: [], estados: {} })).toBe('');
    expect(banda({ oficiales: [], pendientes: [], estados: { [prueba.id]: 'vacia' } })).toContain('Lista vacía');
    expect(banda(null, true)).toContain('No se ha podido leer la lista');
    expect(banda(lista, true)).toContain('La última lectura falló');
    expect(banda(lista, true)).toContain(nombre);
    expect(banda(lista, true)).toContain('Estás en la lista oficial');
  });
});

describe('renderizado offline a 320, 393, 768 y 1440 px', () => {
  let browser: Browser;
  let server: BrowserServer;
  let context: BrowserContext;
  let page: Page;
  let css: string;

  beforeAll(async () => {
    // Compila el CSS vigente, no el de un build anterior. Limita el escaneo a
    // src y a este test; no recorre artefactos ni otros trabajos en paralelo.
    const entrada = fuente('src/app/globals.css').replace(
      "@import 'tailwindcss';",
      "@import 'tailwindcss' source(none);\n@source '../';\n@source '../../tests/diseno-calendario-ranking.test.ts';",
    );
    css = (await postcss([tailwind({ base: raiz })]).process(entrada, {
      from: join(raiz, 'src/app/globals.css'),
    })).css;
    // Fuentes ya compiladas, locales. No se descarga nada ni se requiere build.
    const carpeta = join(raiz, '.next/static/chunks');
    let fuentes = '';
    try {
      for (const archivo of readdirSync(carpeta).filter((f) => f.endsWith('.css'))) {
        const bloques = readFileSync(join(carpeta, archivo), 'utf8').match(/@font-face\s*\{[^}]*\}/g) ?? [];
        for (const bloque of bloques.filter((b) => /Barlow Condensed|Inter/.test(b))) {
          fuentes += bloque.replace(/url\(([^)]+)\)/g, (original, url: string) => {
            const nombreArchivo = url.replace(/["']/g, '').split('/').pop();
            if (!nombreArchivo?.endsWith('.woff2')) return original;
            return `url(data:font/woff2;base64,${readFileSync(join(raiz, '.next/static/media', nombreArchivo)).toString('base64')})`;
          });
        }
      }
    } catch {
      // Sin compilación previa se comprueba el fallback del producto, sin red.
    }
    css += fuentes;
    // Servidor efímero propio, solo en loopback; jamás CDP ni sesión guardada.
    server = await chromium.launchServer({ headless: true, host: '127.0.0.1' });
    browser = await chromium.connect(server.wsEndpoint());
    context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', (route) => {
      const ruta = new URL(route.request().url()).pathname;
      // Solo imágenes del repositorio; cualquier petición externa se aborta.
      if (/^\/banderas\/[a-z]{2}\.png$/.test(ruta)) {
        return route.fulfill({ path: join(raiz, 'public', ruta.slice(1)), contentType: 'image/png' });
      }
      return route.abort();
    });
    page = await context.newPage();
    await page.setContent(`<html lang="es" class="dark"><head><base href="https://offline.invalid/"><style>${css}</style></head><body style="--font-display:'Barlow Condensed',sans-serif;--font-sans-ui:Inter,sans-serif"><header class="ancho-app px-3 py-2">${html(React.createElement(NavEscritorio, { role: 'admin' }))}</header><main class="ancho-app hueco-barra px-4 py-3"></main>${html(React.createElement(NavMovil, { role: 'admin' }))}</body></html>`, { waitUntil: 'domcontentloaded' });
    mkdirSync(salida, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    if (!server) return;
    const acotado = async (operacion: Promise<unknown>, ms: number, etiqueta: string) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([operacion, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Limpieza aislada agotada: ${etiqueta}`)), ms);
        })]);
      } finally {
        clearTimeout(timer);
      }
    };
    // Libera primero el cliente WebSocket y sus rutas. Si no responde, el
    // cierre del servidor termina igualmente el navegador.
    try {
      if (context) await acotado(context.close(), 2_000, 'contexto');
      if (browser) await acotado(browser.close(), 2_000, 'cliente aislado');
    } catch {
      // El servidor se cierra a continuación y arrastra contexto y cliente.
    }
    const proceso = server.process();
    // Playwright solo borra el perfil tras el evento `close` del proceso, que
    // exige que se cierren todos sus pipes. En Windows los hijos de Chromium
    // heredan esos pipes y pueden mantenerlos abiertos tras salir el padre, y
    // el borrado del perfil reintenta durante varios segundos si hay ficheros
    // bloqueados. Por eso se separa «el proceso ha salido» de «perfil borrado».
    const cierre = server.close();
    try {
      await esperarSalidaPropia(proceso, 15_000);
    } catch {
      // Solo sobre el árbol del proceso que lanzó esta suite.
      if (process.platform === 'win32') await terminarNavegadorPropio(proceso);
      server.kill().catch(() => {});
      await esperarSalidaPropia(proceso, 15_000).catch(() => {
        throw new Error('Limpieza aislada agotada: salida forzada del navegador');
      });
    }
    const perfil = perfilPropio(proceso);
    if (process.platform === 'win32' && perfil) await terminarRestosDelPerfil(perfil);
    for (const stream of proceso.stdio) stream?.destroy();
    // Playwright borra el perfil solo cuando llega `close`, que en la batería
    // completa a veces no llega nunca. Con el navegador ya muerto, el borrado
    // se hace aquí y se comprueba, sin depender de ese evento.
    cierre.catch(() => {});
    if (perfil) {
      await acotado(rm(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }), 30_000, 'borrado del perfil temporal');
      if (existsSync(perfil)) throw new Error(`Limpieza aislada incompleta: perfil temporal ${perfil}`);
    } else {
      await acotado(cierre, 30_000, 'borrado del perfil temporal');
    }
  }, 90_000);

  const pantallas = {
    calendario,
    nacional,
    mundial: fie,
    interno,
    ficha,
    inscritos: () => React.createElement('div', { className: 'calendario' },
      React.createElement(BandaEstasDentro, { evento, prueba, inscritos: lista })),
    plazos: () => React.createElement('div', { className: 'calendario' },
      React.createElement(BarraPlazos, { plazos, estado: estadoPlazos })),
    temporadas,
    tamanos: () => React.createElement('div', { className: 'flex flex-wrap gap-2' },
      // Sin `min-w-0`: ya no hay regla global que lo anule; el mínimo del campo es suyo (`ui/input.tsx`).
      React.createElement(Input, { className: 'h-8 w-8', 'aria-label': 'Entrada compacta' }),
      ...(['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const).map((size) =>
        React.createElement(Button, { size, key: size, className: 'h-8 w-8', 'aria-label': size }, 'X'))),
  };

  for (const ancho of [320, 393, 768, 1440]) {
    for (const [pantalla, pintar] of Object.entries(pantallas)) {
      it(`${pantalla} a ${ancho}: sin desborde, controles de 44 px y nombres completos`, async () => {
          await page.setViewportSize({ width: ancho, height: 1000 });
          await page.locator('main').evaluate((el, marcado) => { el.innerHTML = marcado; }, html(pintar()));
          await page.evaluate(() => document.fonts.ready);
          const medicion = await page.evaluate(() => {
            const visibles = (elemento: HTMLElement) => elemento.getClientRects().length > 0;
            const targets = [...document.querySelectorAll<HTMLElement>('button,a[href],input:not([type=hidden]),[tabindex="0"]')]
              // Radix añade inputs invisibles, aria-hidden y tabindex=-1 para
              // formularios: no son controles que el usuario pueda tocar.
              .filter((el) => !el.closest('[aria-hidden="true"],[hidden],[inert]') && visibles(el));
            /*
              El área que recibe el toque. La etiqueta del Switch y la que
              envuelve un campo son el objetivo real; y un control que se ve
              pequeño pero amplía su área con un `::after` transparente
              (`src/components/filtros/chips.tsx`) cuenta con esa ampliación.
            */
            const areaTactil = (el: HTMLElement) => {
              const caja = el.getAttribute('role') === 'switch' || el.matches('input') ? el.closest('label') ?? el : el;
              const r = caja.getBoundingClientRect();
              const tras = getComputedStyle(caja, '::after');
              if (tras.content === 'none' || tras.position !== 'absolute') return { width: r.width, height: r.height };
              const px = (v: string) => (v.endsWith('px') ? Number.parseFloat(v) : 0);
              return {
                width: Math.max(r.width, r.width - px(tras.left) - px(tras.right)),
                height: Math.max(r.height, r.height - px(tras.top) - px(tras.bottom)),
              };
            };
            const pequenos = targets.flatMap((el) => {
              const r = areaTactil(el);
              return r.width < 43.99 || r.height < 43.99
                ? [{ etiqueta: el.getAttribute('aria-label') ?? el.textContent, ancho: r.width, alto: r.height }]
                : [];
            });
            const areas = targets.map(areaTactil);
            const truncados = [...document.querySelectorAll<HTMLElement>('td, [data-barra="torneo"], [data-plazo], [data-slot="item-title"], [data-slot="item-actions"]')].filter(visibles).filter((el) =>
              el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis',
            ).map((el) => el.textContent);
            // Las tablas de ranking van en una línea por tirador: el nombre puede recortarse a la vista, pero entero en el texto y en 	itle.
            const celdaNombre = [...document.querySelectorAll<HTMLElement>('td, [data-nombre]')].find((el) => el.textContent?.includes('Lucía García de la Torre Fernández'));
            return {
              ancho: innerWidth, documento: document.documentElement.scrollWidth,
              targets: targets.length, pequenos, truncados,
              minimoAncho: Math.min(...areas.map((r) => r.width)),
              minimoAlto: Math.min(...areas.map((r) => r.height)),
              anchoNombre: celdaNombre?.getBoundingClientRect().width ?? null,
            };
          });
          writeFileSync(join(salida, `${pantalla}-${ancho}.json`), JSON.stringify(medicion, null, 2));
          await page.screenshot({ path: join(salida, `${pantalla}-${ancho}.png`), fullPage: true });
          expect(medicion.documento).toBeLessThanOrEqual(ancho);
          expect(medicion.targets).toBeGreaterThan(0);
          expect(medicion.pequenos).toEqual([]);
          expect(medicion.truncados).toEqual([]);
          if (pantalla === 'nacional' || pantalla === 'mundial' || pantalla === 'interno') {
            expect(medicion.anchoNombre).toBeGreaterThanOrEqual(120);
            if (pantalla === 'interno') {
              await expect(page.locator('td', { hasText: nombre }).count()).resolves.toBe(1);
            } else {
              await expect(page.locator('[data-nombre]', { hasText: nombre }).count()).resolves.toBe(1);
              await expect(page.locator('[data-nombre]').first().getAttribute('title')).resolves.toBe(nombre);
            }
          }
      }, 30_000);
    }
  }
});
