/**
 * Capturas de Explorar como «otra app»: Inicio (feed), Buscar, Siguiendo
 * (lista) y Competiciones, con su barra propia, datos reales y la cabecera de
 * la app alrededor.
 *
 *   PERF_DB=<copia SQLite de D1> npx tsx tests/ui/explorar-app.mts
 *   (con la sonda: npx tsx --import ./tests/ui/auditoria-sonda.mts tests/ui/explorar-app.mts)
 *
 * Sin servidor de Next: la base se abre en sólo lectura (`_explorar-base.mts`),
 * Inicio y Siguiendo se pintan en el servidor con los mismos componentes y
 * cargadores que sus páginas y el navegador los hidrata; el formulario de
 * Buscar se monta en el navegador. Seguir no escribe: las acciones están
 * sustituidas. Cada página se sirve con la cabecera `Server-Timing` del tiempo
 * que tardan sus cargadores.
 *
 * Salida en `capturas/explorar-app/` (CAPTURAS cambia la carpeta), a 393 y 1440
 * px y, con PASADA=1, también a 320. Falla si algo desborda en el móvil.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { Marca } from '@/components/marca';
import { cargarCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import { entradaCatalogo, leerCriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { construirIndiceEdiciones, leerDatosIndiceEdiciones, type IndiceEdiciones } from '@/lib/sport/explorar/indice-ediciones';
import { cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { leerFotoDeportista } from '@/lib/sport/explorar/foto';
import { leerFotosDeportistas } from '@/lib/sport/explorar/foto-lote';
import { cargarBuscarVacio, cargarInicio, cargarListaSiguiendo } from '@/lib/sport/explorar/inicio-pantalla';
import { cargarExplorar, cargarPaginaExplorar } from '@/lib/sport/explorar/pantalla';
import { claveRecientes } from '@/lib/sport/explorar/recientes';
import { leerFeedSiguiendo } from '@/lib/sport/explorar/seguidos';
import { LIMITE_FEED } from '@/lib/sport/explorar/siguiendo-pantalla';
import { leerListaSiguiendo } from '@/lib/sport/explorar/siguiendo-lista';
import { leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { CRITERIOS_VACIOS, esBusqueda, leerCriterios, opcionesTemporada } from '@/lib/sport/explorar/url';
import { anchosCapturas, carpetaCapturas } from './pasada.mts';
import { contenidoExplorar, type DatosExplorarApp } from './_explorar-app-vista.tsx';
import { CUENTA, ctx, ctxMuchas, ctxNueva, RAIZ, recientes, type Ctx } from './_explorar-base.mts';

const SALIDA = carpetaCapturas(RAIZ, 'explorar-app');

const cuentaDe = (b: URLSearchParams): Ctx => (b.get('cuenta') === 'nueva' ? ctxNueva : b.get('cuenta') === 'muchas' ? ctxMuchas : ctx);

const STUBS: Record<string, string> = {
  'next/link': `import * as React from 'react';
    export default React.forwardRef(function Link({ href, prefetch, replace, scroll, transitionTypes, onNavigate, ...p }, ref) {
      return React.createElement('a', { ...p, ref, href: typeof href === 'string' ? href : String(href) });
    });
    export function useLinkStatus() { return { pending: false }; }`,
  'next/navigation': `export function useRouter() { return { push: (u) => { location.href = u; }, replace: (u) => { location.href = u; }, refresh() {}, back() { history.back(); }, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }`,
  favoritos: `const ok = (e, favorito) => ({ estado: 'ok', personaId: e && e.personaId, favorito });
    export async function guardarFavoritoAccion(e) { return ok(e, true); }
    export async function quitarFavoritoAccion(e) { return ok(e, false); }
    export async function consultarFavoritoAccion(e) { return ok(e, false); }
    export async function listarFavoritosAccion() { return { estado: 'ok', items: [], siguiente: null }; }`,
  acciones: `const pedir = (ruta, e) => fetch(ruta + location.search, { method: 'POST', body: JSON.stringify(e) }).then((r) => r.json());
    export const masDeportistasAccion = (e) => pedir('/api/mas', e);
    export const masFeedAccion = (e) => pedir('/api/feed', e);
    export const masSiguiendoAccion = (e) => pedir('/api/siguiendo', e);`,
};
const sustitutos: Plugin = {
  name: 'sustitutos',
  setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onResolve({ filter: /favoritos-acciones$/ }, () => ({ path: 'favoritos', namespace: 'stub' }));
    b.onResolve({ filter: /explorar\/acciones$/ }, () => ({ path: 'acciones', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'jsx', resolveDir: RAIZ }));
  },
};

async function empaquetar(): Promise<string> {
  const r = await build({
    entryPoints: [path.join(RAIZ, 'tests', 'ui', '_explorar-app-cliente.tsx')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', minify: true, logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: path.join(RAIZ, 'tsconfig.json'),
    plugins: [sustitutos],
  });
  return r.outputFiles[0].text;
}

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const h = React.createElement;
const hoy = new Date().toISOString().slice(0, 10);

/** La cabecera de `(app)/layout.tsx` con sus mismas clases; las barras se montan en el navegador. */
function documento(css: string, cuerpo: string, datos: object | null): string {
  const marca = renderToStaticMarkup(h(Marca, { className: 'size-7' }));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><div class="hueco-barra flex min-h-dvh flex-col">
<header class="sticky top-0 z-30 border-b bg-card"><div class="ancho-app flex h-14 items-center gap-4 px-4">
<a href="/" class="-mx-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 px-2">${marca}<span class="hidden font-semibold tracking-tight sm:inline">Calendar<span class="text-primary-text">Fencing</span></span></a>
<div class="mx-auto" id="nav-escritorio"></div>
<div class="flex shrink-0 items-center gap-1"><a href="/perfil" class="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md p-1 pr-2"><span class="flex size-8 items-center justify-center rounded-full bg-muted text-xs">AR</span><span class="hidden min-w-0 flex-col leading-tight md:flex"><span class="max-w-36 truncate text-xs font-medium">Alejandro Ramírez</span><span class="max-w-36 truncate text-[12px] text-muted-foreground">Dirección técnica</span></span></a><button class="inline-flex size-11 items-center justify-center" aria-label="Salir">⎋</button></div>
</div></header>
<main id="contenido" class="ancho-app flex flex-1 flex-col px-4 py-4"><div id="isla" class="flex min-w-0 flex-col">${cuerpo}</div></main>
<div id="nav-movil"></div></div>
<script>window.__DATOS=${JSON.stringify(datos ?? { vista: 'ninguna' }).replace(/</g, '\\u003c')}</script>
<script type="module" src="/cliente.js"></script></body></html>`;
}

type Pintada = { html: string; ms: number };

async function paginaExplorar(css: string, b: URLSearchParams): Promise<Pintada> {
  const params = Object.fromEntries(b);
  const c = cuentaDe(b);
  const t = performance.now();
  if (esBusqueda(params)) {
    const { criterios, cursor } = leerCriterios(params);
    const explorar = await cargarExplorar(c, criterios, cursor);
    if (explorar.tipo === 'sin_sesion') throw new Error('sin sesión');
    const ms = performance.now() - t;
    const datos: DatosExplorarApp = { vista: 'buscar', cuenta: CUENTA, criterios, cursor, explorar, temporadas: opcionesTemporada(hoy), propuestas: null };
    return { html: documento(css, '', datos), ms };
  }
  const criterios = leerCriteriosSiguiendo(params);
  const { vista, siguiendo } = await cargarInicio(c, { cursor: criterios.cursor || undefined, soloMedallas: criterios.soloMedallas });
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  const ms = performance.now() - t;
  const datos: DatosExplorarApp = { vista: 'inicio', cuenta: CUENTA, criterios, inicio: vista, siguiendo, limite: LIMITE_FEED };
  return { html: documento(css, renderToString(contenidoExplorar(datos)), datos), ms };
}

async function paginaBuscar(css: string, b: URLSearchParams): Promise<Pintada> {
  const t = performance.now();
  const propuestas = await cargarBuscarVacio(cuentaDe(b));
  const ms = performance.now() - t;
  const datos: DatosExplorarApp = {
    vista: 'buscar', cuenta: CUENTA, criterios: CRITERIOS_VACIOS, explorar: { tipo: 'sin_criterio' },
    temporadas: opcionesTemporada(hoy), propuestas,
  };
  return { html: documento(css, '', datos), ms };
}

async function paginaSiguiendo(css: string, b: URLSearchParams): Promise<Pintada> {
  const t = performance.now();
  const lista = await cargarListaSiguiendo(cuentaDe(b), b.get('cursor') || undefined);
  if (lista.tipo === 'sin_sesion') throw new Error('sin sesión');
  const ms = performance.now() - t;
  const datos: DatosExplorarApp = { vista: 'siguiendo', cuenta: CUENTA, lista };
  return { html: documento(css, renderToString(contenidoExplorar(datos)), datos), ms };
}

/** El índice de ediciones, como la caché compartida: se lee una vez y se reutiliza. */
let indiceEdiciones: Promise<IndiceEdiciones | null> | null = null;
const indice = () => (indiceEdiciones ??= leerDatosIndiceEdiciones(ctx).then((d) => (d ? construirIndiceEdiciones(d) : null)));

async function paginaEdiciones(css: string, b: URLSearchParams): Promise<Pintada> {
  const { criterios, cursor } = leerCriteriosCatalogo(Object.fromEntries(b));
  const t = performance.now();
  const [series, catalogo] = await Promise.all([cargarSeries(ctx), cargarCatalogoEdiciones(ctx, entradaCatalogo(criterios, cursor), { indice })]);
  if (series.tipo === 'sin_sesion' || catalogo.estado === 'sin_sesion') throw new Error('sin sesión');
  const ms = performance.now() - t;
  const datos: DatosExplorarApp = { vista: 'ediciones', cuenta: CUENTA, catalogo, criterios, cursor, series, anioActual: Number(hoy.slice(0, 4)) };
  return { html: documento(css, '', datos), ms };
}

async function paginaBuscarOPaises(css: string, b: URLSearchParams): Promise<Pintada> {
  if (b.get('ver') !== 'paises') return paginaBuscar(css, b);
  const datos: DatosExplorarApp = { vista: 'paises', cuenta: CUENTA, q: b.get('q') ?? '' };
  return { html: documento(css, '', datos), ms: 0 };
}

const [css, cliente] = await Promise.all([compilarCss(), empaquetar()]);

const json = (res: import('node:http').ServerResponse, cuerpo: unknown, estado = 200) =>
  res.writeHead(estado, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
const leerCuerpo = (pet: IncomingMessage) => new Promise<string>((ok) => {
  let texto = '';
  pet.on('data', (c) => { texto += c; });
  pet.on('end', () => ok(texto));
});
const paginas: Record<string, (b: URLSearchParams) => Promise<Pintada>> = {
  '/explorar': (b) => paginaExplorar(css, b),
  '/explorar/buscar': (b) => paginaBuscarOPaises(css, b),
  '/explorar/siguiendo': (b) => paginaSiguiendo(css, b),
  '/explorar/ediciones': (b) => paginaEdiciones(css, b),
};
const tiempos: Record<string, number[]> = {};

const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  void (async () => {
    try {
      const pagina = paginas[url.pathname];
      if (url.pathname === '/cliente.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(cliente);
      } else if (pagina) {
        const { html, ms } = await pagina(url.searchParams);
        (tiempos[`${url.pathname}${url.search}`] ??= []).push(ms);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'server-timing': `datos;dur=${ms.toFixed(1)}` }).end(html);
      } else if (url.pathname === '/api/mas') {
        json(res, await cargarPaginaExplorar(cuentaDe(url.searchParams), JSON.parse(await leerCuerpo(pet))));
      } else if (url.pathname === '/api/feed') {
        json(res, await leerFeedSiguiendo(cuentaDe(url.searchParams), JSON.parse(await leerCuerpo(pet))));
      } else if (url.pathname === '/api/siguiendo') {
        json(res, await leerListaSiguiendo(cuentaDe(url.searchParams), JSON.parse(await leerCuerpo(pet))));
      } else if (url.pathname === '/api/explorar/sugerencias') {
        const limite = url.searchParams.get('limite');
        const r = await sugerirPersonas(ctx, { q: url.searchParams.get('q'), ...(limite ? { limite: Number(limite) } : {}) });
        json(res, r, r.estado === 'ok' ? 200 : 400);
      } else if (url.pathname === '/api/explorar/fotos') {
        // El lote de fotos de las filas visibles, como `src/app/api/explorar/fotos/route.ts`.
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
        const r = await leerFotosDeportistas(ctx, ids, { signal: AbortSignal.timeout(6000) })
          .catch(() => ({ estado: 'no_disponible' as const }));
        json(res, r, r.estado === 'ok' ? 200 : 503);
      } else {
        const foto = /^\/api\/explorar\/deportistas\/([^/]+)\/foto$/.exec(url.pathname);
        if (foto) {
          const r = await leerFotoDeportista(ctx, decodeURIComponent(foto[1]), { signal: AbortSignal.timeout(6000) })
            .catch(() => ({ estado: 'no_disponible' as const }));
          json(res, r, r.estado === 'no_disponible' ? 503 : 200);
        } else {
          const fichero = path.join(RAIZ, 'public', path.normalize(url.pathname).replace(/^([/\\])+/, ''));
          if (fichero.startsWith(path.join(RAIZ, 'public')) && existsSync(fichero) && statSync(fichero).isFile()) {
            res.writeHead(200, { 'content-type': fichero.endsWith('.png') ? 'image/png' : 'application/octet-stream' })
              .end(readFileSync(fichero));
          } else {
            res.writeHead(404).end();
          }
        }
      }
    } catch (error) {
      console.error(url.pathname, error);
      res.writeHead(500).end();
    }
  })();
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const origen = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

const navegador = await chromium.launch();
const anchos = anchosCapturas([
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
]);
mkdirSync(SALIDA, { recursive: true });
const capturas: string[] = [];
const fallos: string[] = [];
const avisos: string[] = [];
const medidas: string[] = [];

/** Espera a que dejen de pedirse fotos (lazy) o a que pase el tope. */
async function calma(p: Page, tope = 10_000) {
  const fin = Date.now() + tope;
  let pendientes = 0;
  let ultima = Date.now();
  const sumar = (r: { url(): string }) => { if (/\/foto|\/api\//.test(r.url())) { pendientes++; ultima = Date.now(); } };
  const restar = (r: { url(): string }) => { if (/\/foto|\/api\//.test(r.url())) { pendientes--; ultima = Date.now(); } };
  p.on('request', sumar);
  p.on('requestfinished', restar);
  p.on('requestfailed', restar);
  await p.waitForTimeout(600);
  while (Date.now() < fin && (pendientes > 0 || Date.now() - ultima < 800)) await p.waitForTimeout(150);
  p.off('request', sumar);
  p.off('requestfinished', restar);
  p.off('requestfailed', restar);
  await p.evaluate(() => document.fonts.ready);
}

async function foto(p: Page, nombre: string, a: (typeof anchos)[number]) {
  for (const completa of [false, true]) {
    const destino = path.join(SALIDA, `${nombre}-${a.sufijo}${completa ? '-completa' : ''}.png`);
    await p.screenshot({ path: destino, fullPage: completa });
    capturas.push(path.relative(RAIZ, destino));
  }
  const ancho = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vista: window.innerWidth }));
  if (ancho.vista < 768 && ancho.doc > ancho.vista) {
    const culpables = await p.evaluate((vista) => [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => e.getBoundingClientRect().right > vista + 0.5)
      .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}`), ancho.vista);
    fallos.push(`${nombre}@${a.sufijo}: scrollWidth ${ancho.doc} > ${ancho.vista} (${culpables.join(' | ')})`);
  }
  if (a.viewport.width < 768) {
    // Lo que se ve: alto de la barra de abajo y de la cabecera, y cuántos objetivos táctiles miden menos de 24 px.
    const m = await p.evaluate(() => {
      const barra = document.querySelector('nav[data-barra="explorar"]')?.getBoundingClientRect().height ?? null;
      const cabecera = document.querySelector('header')?.getBoundingClientRect().height ?? null;
      const pequenos = [...document.querySelectorAll<HTMLElement>('a[href], button')]
        .filter((e) => e.offsetParent !== null && !e.closest('.sr-only'))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.height < 24; }).length;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
      return { barra, cabecera, pequenos, fcp: fcp === null ? null : Math.round(fcp), dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null };
    });
    if (m.barra !== null && m.barra > 50) fallos.push(`${nombre}@${a.sufijo}: la barra mide ${m.barra} px`);
    medidas.push(`${nombre}@${a.sufijo}: barra ${m.barra ?? '—'} px, cabecera ${m.cabecera} px, FCP ${m.fcp} ms, DCL ${m.dcl} ms, enlaces < 24 px: ${m.pequenos}`);
  }
}

async function abrir(a: (typeof anchos)[number], ruta: string, esperar = '#isla') {
  const p = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
  p.on('pageerror', (e) => {
    fallos.push(`${ruta} @${a.sufijo}: ${e.message}`);
    console.error(`[navegador] ${ruta} @${a.sufijo}: ${e.message}`);
  });
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    avisos.push(`${ruta} @${a.sufijo}: ${m.text().slice(0, 160)}`);
    if (process.env.DEPURAR) console.error(`[consola] ${ruta}: ${m.text().slice(0, 400)}`);
  });
  await p.addInitScript(([clave, v]) => localStorage.setItem(clave, v), [claveRecientes(CUENTA), JSON.stringify(recientes)] as const);
  await p.goto(`${origen}${ruta}`, { waitUntil: 'load' });
  await p.waitForSelector(esperar);
  return p;
}

async function escribir(p: Page, texto: string) {
  await p.locator('#explorar-q').click();
  await p.locator('#explorar-q').pressSequentially(texto, { delay: 40 });
  await p.waitForFunction((q) => {
    const s = document.querySelector(`#explorar-perfiles section[aria-label="Perfiles para «${q}»"]`);
    return Boolean(s?.querySelector('[data-fila-perfil]')) || /Ningún perfil/.test(s?.textContent ?? '');
  }, texto, { timeout: 15_000 });
}

const SOLO = process.env.SOLO ? new RegExp(process.env.SOLO) : null;

for (const a of anchos) {
  for (const [nombre, ruta, esperar] of ([
    ['inicio', '/explorar', 'ol[aria-label^="Resultados"]'],
    ['inicio-muchas', '/explorar?cuenta=muchas', 'ol[aria-label^="Resultados"]'],
    ['inicio-medallas', '/explorar?medallas=1&cuenta=muchas', '#isla'],
    ['inicio-vacio', '/explorar?cuenta=nueva', '#isla'],
    ['buscar', '/explorar/buscar', '#explorar-q'],
    ['lista-alejandro', '/explorar?q=alejandro', '[aria-label="Deportistas encontrados"]'],
    ['siguiendo', '/explorar/siguiendo', '[aria-label="Personas que sigues"]'],
    ['siguiendo-muchas', '/explorar/siguiendo?cuenta=muchas', '[aria-label="Personas que sigues"]'],
    ['siguiendo-vacio', '/explorar/siguiendo?cuenta=nueva', '#isla'],
    ['competiciones', '/explorar/ediciones', '#catalogo-q'],
    ['competiciones-mndial', '/explorar/ediciones?q=mndial', '[aria-label="Competiciones"]'],
    ['competiciones-filtros', '/explorar/ediciones?q=copa%20del%20mun&arma=ESPADA&categoria=M20&desde=2018&hasta=2024', '[aria-label="Competiciones"]'],
    ['paises', '/explorar/buscar?ver=paises', '#paises-lista'],
  ] as const).filter(([nombre]) => !SOLO || SOLO.test(nombre))) {
    const p = await abrir(a, ruta, esperar);
    await calma(p);
    await foto(p, nombre, a);
    if (nombre === 'siguiendo') {
      // Dejar de seguir: el botón pasa a «Seguir» (que es el deshacer) y la fila se queda.
      const boton = p.locator('[aria-label="Personas que sigues"] [data-estado="favorito"]').first();
      await boton.click();
      await p.waitForSelector('[aria-label="Personas que sigues"] [data-estado="sin-guardar"]');
      await foto(p, 'siguiendo-dejar', a);
    }
    await p.close();
  }

  if (SOLO && !SOLO.test('vivo-zabal filtros')) continue;
  let p = await abrir(a, '/explorar/buscar', '#explorar-q');
  await escribir(p, 'zabal');
  await calma(p);
  await foto(p, 'vivo-zabal', a);
  await p.close();

  p = await abrir(a, '/explorar/buscar', '#explorar-q');
  await escribir(p, 'italia');
  await calma(p);
  await foto(p, 'vivo-italia', a);
  await p.close();

  // Los chips abren su hoja: la de un tirador (arma) y la de una competición (fechas).
  p = await abrir(a, '/explorar?q=zabala&arma=ESPADA&categoria=ABS', '#explorar-q');
  await p.locator('[data-slot="sistema-chip"][data-tipo="menu"]', { hasText: 'Espada' }).click();
  await p.waitForSelector('[data-slot="sistema-hoja"]');
  await calma(p, 3000);
  await foto(p, 'filtros', a);
  await p.close();

  p = await abrir(a, '/explorar/ediciones?q=turin', '[aria-label="Competiciones"]');
  await p.locator('[data-slot="sistema-chip"][data-tipo="menu"]', { hasText: 'Fechas' }).click();
  await p.waitForSelector('[data-slot="sistema-hoja"]');
  await calma(p, 1500);
  await foto(p, 'competiciones-fechas', a);
  await p.close();
}
await navegador.close();
servidor.close();

console.log(capturas.join('\n'));
console.log(`\nMedidas (móvil):\n${medidas.join('\n')}`);
console.log('\nTiempo de los cargadores por página (mediana, ms):');
for (const [ruta, xs] of Object.entries(tiempos)) {
  const orden = [...xs].sort((x, y) => x - y);
  console.log(`  ${ruta.padEnd(44)} ${orden[Math.floor(orden.length / 2)]!.toFixed(1).padStart(7)}  (${xs.length} cargas)`);
}
if (avisos.length) console.warn(`\nAvisos:\n${avisos.join('\n')}`);
if (fallos.length) {
  console.error(`\nFallos:\n${fallos.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nNinguna pantalla desborda en el móvil.');
}
