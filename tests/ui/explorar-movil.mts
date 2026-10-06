/**
 * Capturas de la pantalla principal de Explorar en móvil y escritorio, con
 * datos reales y la cabecera y las barras de la app alrededor.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/explorar-movil.mts
 *
 * No hay servidor de Next: la base se abre en
 * sólo lectura, el contenido se pinta con los componentes y cargadores de las
 * páginas y el formulario (con la lista completa viva, «Ver más» incluido) se
 * empaqueta con esbuild y se monta en el navegador. Si la copia no tiene el
 * índice de palabras (`explorar_*`), se construye en tablas TEMP de la
 * conexión con las mismas sentencias que en producción; SIN_INDICE=1 usa la
 * búsqueda sin índice. Seguir no escribe: las acciones de favoritos están
 * sustituidas y las personas seguidas son una tabla TEMP.
 *
 * Salida en `capturas/explorar-movil/`, a 393 y 1440 px (la app sólo tiene
 * tema oscuro). Falla si alguna pantalla a 393 px tiene desplazamiento
 * horizontal o si «Ver más» repite a alguien.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import { anchosCapturas, carpetaCapturas, ES_MOVIL } from './pasada.mts';
import { build, type Plugin } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Page } from 'playwright';
import { ChevronLeft } from 'lucide-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { Marca } from '@/components/marca';
import { PropuestasBuscador } from '@/components/explorar/buscador-social-fila';
import { CabeceraExplorar } from '@/components/explorar/cabecera-explorar';
import { PantallaEdiciones } from '@/components/explorar/catalogo-ediciones';
import { EstadoFavoritos, ListaFavoritos } from '@/components/explorar/favoritos';
import { ChipsActivos, EstadoSinCoincidencias, EstadoSinLista } from '@/components/explorar/resultados';
import { CabeceraSiguiendo, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { cargarCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import { leerCriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { cargarFavoritos } from '@/lib/sport/explorar/favoritos-pantalla';
import { leerFotoDeportista } from '@/lib/sport/explorar/foto';
import { SENTENCIAS_INDICE } from '@/lib/sport/explorar/indice-sql';
import { cargarExplorar, cargarPaginaExplorar } from '@/lib/sport/explorar/pantalla';
import { claveRecientes, type PerfilReciente } from '@/lib/sport/explorar/recientes';
import { cargarConteoSiguiendo, cargarSiguiendo, leerPropuestasParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import { leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { hayCriterios, leerCriterios, opcionesTemporada } from '@/lib/sport/explorar/url';
import { crearContexto, perfil } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'explorar-movil');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const CUENTA = '00000000-0000-4000-8000-0000000000a1';
/** Cuenta sin nadie seguido: el feed vacío con propuestas. */
const CUENTA_NUEVA = '00000000-0000-4000-8000-0000000000a2';
const ZABALA = process.env.PERSONA_SEGUIDA ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';

const sqlite = new DatabaseSync(BASE, { readOnly: true });
sqlite.exec('CREATE TEMP TABLE sport_favorite (profile_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at INTEGER NOT NULL)');

const tieneIndice = Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'explorar_indice_estado'").get());
if (!tieneIndice && !process.env.SIN_INDICE) {
  const t = performance.now();
  const ddl = readFileSync(path.join(RAIZ, 'drizzle-d1', '0004_indice_explorar.sql'), 'utf8')
    .replace(/CREATE TABLE /g, 'CREATE TEMP TABLE ')
    .replace(/CREATE UNIQUE INDEX (\w+) ON/g, 'CREATE UNIQUE INDEX temp.$1 ON');
  sqlite.exec(ddl);
  sqlite.exec('BEGIN');
  for (const s of SENTENCIAS_INDICE) sqlite.exec(s);
  sqlite.exec('COMMIT');
  console.log(`índice TEMP construido en ${Math.round(performance.now() - t)} ms`);
}
const conIndice = tieneIndice || !process.env.SIN_INDICE;

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}
function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
  const ejecutar = (): D1QueryResult<unknown> => {
    if (!/^\s*(SELECT|WITH)\b/i.test(query)) throw new Error(`sólo lectura: ${query.slice(0, 60)}`);
    const rows = sqlite.prepare(query).all(...values.map(valor));
    return { success: true, results: rows, meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 } } as D1QueryResult<unknown>;
  };
  return {
    _x: ejecutar,
    bind: (...p: unknown[]) => sentencia(query, p),
    all: async <T>() => ejecutar() as D1QueryResult<T>,
    run: async <T>() => ejecutar() as D1QueryResult<T>,
    raw: async <T>() => ejecutar().results.map((x) => Object.values(x as object)) as unknown as T[],
    first: async <T>(columna?: string) => {
      const fila = ejecutar().results[0] as Record<string, unknown> | undefined;
      return (fila ? (columna ? fila[columna] : fila) : null) as T | null;
    },
  } as never;
}
const binding: D1Binding = {
  prepare: (q) => sentencia(q),
  batch: async <T>(sts: D1Statement[]) => sts.map((s) => (s as unknown as { _x: () => D1QueryResult<T> })._x()),
};
const contexto = (profileId: string) => ({
  ...crearContexto({ perfil: perfil({ profileId, role: 'coach' }) }).ctx,
  db: createD1Database(binding),
  indiceExplorar: async () => conIndice,
});
const ctx = contexto(CUENTA);
const ctxNueva = contexto(CUENTA_NUEVA);

async function primero(q: string): Promise<PerfilReciente> {
  const r = await sugerirPersonas(ctx, { q });
  if (r.estado !== 'ok' || !r.items[0]) throw new Error(`sin perfil para ${q}`);
  const { id, nombre, pais } = r.items[0];
  return { id, nombre, pais };
}
const recientes = [await primero('jorgensen patrick'), await primero('limardo gascon'), await primero('cheung ka long')];
const seguir = sqlite.prepare('INSERT INTO temp.sport_favorite VALUES (?, ?, ?)');
[ZABALA, ...recientes.map((r) => r.id)].forEach((id, i) => seguir.run(CUENTA, id, 1_700_000_000_000 + i));

const STUBS: Record<string, string> = {
  'next/link': `import * as React from 'react';
    export default React.forwardRef(function Link({ href, prefetch, replace, scroll, ...p }, ref) {
      return React.createElement('a', { ...p, ref, href: typeof href === 'string' ? href : String(href) });
    });`,
  'next/navigation': `export function useRouter() { return { push: (u) => { location.href = u; }, replace: (u) => { location.href = u; }, refresh() {}, back() { history.back(); }, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }`,
  favoritos: `const ok = (e, favorito) => ({ estado: 'ok', personaId: e && e.personaId, favorito });
    export async function guardarFavoritoAccion(e) { return ok(e, true); }
    export async function quitarFavoritoAccion(e) { return ok(e, false); }
    export async function consultarFavoritoAccion(e) { return ok(e, false); }
    export async function listarFavoritosAccion() { return { estado: 'ok', items: [], siguiente: null }; }`,
  acciones: `export async function masDeportistasAccion(e) {
      const r = await fetch('/api/mas', { method: 'POST', body: JSON.stringify(e) });
      return r.json();
    }`,
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
    entryPoints: [path.join(RAIZ, 'tests', 'ui', '_explorar-movil-cliente.tsx')],
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
const html = (e: React.ReactElement) => renderToStaticMarkup(e);
const hoy = new Date().toISOString().slice(0, 10);

/** La cabecera de `(app)/layout.tsx` con sus mismas clases; las barras se montan en el navegador. */
function documento(css: string, cuerpo: string, datos: object = {}, atras = false): string {
  const marca = html(h(Marca, { className: 'size-7' }));
  // La flecha de `BotonAtras` sólo sale en subpantallas, con su mismo tamaño.
  const flecha = atras
    ? `<button aria-label="Volver" class="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md">${html(h(ChevronLeft, { className: 'size-6', 'aria-hidden': true }))}</button>`
    : '';
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><div class="hueco-barra flex min-h-dvh flex-col">
<header class="sticky top-0 z-30 border-b bg-card"><div class="ancho-app flex h-14 items-center gap-4 px-4">${flecha}
<a href="/" class="-mx-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 px-2">${marca}<span class="hidden font-semibold tracking-tight sm:inline">Calendar<span class="text-primary">Fencing</span></span></a>
<div class="mx-auto" id="nav-escritorio"></div>
<div class="flex shrink-0 items-center gap-1"><a href="/perfil" class="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md p-1 pr-2"><span class="flex size-8 items-center justify-center rounded-full bg-muted text-xs">AR</span><span class="hidden min-w-0 flex-col leading-tight md:flex"><span class="max-w-36 truncate text-xs font-medium">Alejandro Ramírez</span><span class="max-w-36 truncate text-[11px] text-muted-foreground">Dirección técnica</span></span></a><button class="inline-flex size-11 items-center justify-center" aria-label="Salir">⎋</button></div>
</div></header>
<main id="contenido" class="ancho-app flex flex-1 flex-col px-4 py-4">${cuerpo}</main>
<div id="nav-movil"></div></div>
<script>window.__DATOS=${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>
<script type="module" src="/cliente.js"></script></body></html>`;
}

/** Lo mismo que pinta `explorar/page.tsx`; el formulario se monta en el navegador. */
async function paginaExplorar(css: string, buscar: URLSearchParams): Promise<string> {
  const { criterios, cursor } = leerCriterios(Object.fromEntries(buscar));
  const inicio = !hayCriterios(criterios);
  const [vista, siguiendo, propuestas] = await Promise.all([
    cargarExplorar(ctx, criterios, cursor),
    cargarConteoSiguiendo(ctx),
    inicio ? leerPropuestasParaSeguir(ctx).catch(() => null) : Promise.resolve(null),
  ]);
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  const contenido = vista.tipo === 'ok'
    ? (vista.sinResultados ? html(h(EstadoSinCoincidencias, { criterios })) : '')
    : inicio && vista.tipo === 'sin_criterio' && propuestas?.length !== 0
      ? html(h(PropuestasBuscador, { propuestas, className: 'lg:max-w-2xl' }))
      : html(h(EstadoSinLista, { vista, criterios }));
  const datos = {
    criterios, temporadas: opcionesTemporada(hoy), atajoEspana: true, profileId: CUENTA, contenido,
    cabeza: inicio ? '' : html(h(ChipsActivos, { criterios })),
    ...(vista.tipo === 'ok' && !vista.sinResultados ? { lista: { items: vista.items, siguiente: vista.siguiente, cursor } } : {}),
  };
  const cuerpo = `<div class="flex min-w-0 flex-col gap-4">${html(h(CabeceraExplorar, { siguiendo }))}<div id="formulario-explorar"></div></div>`;
  return documento(css, cuerpo, datos);
}

async function paginaSiguiendo(css: string, buscar: URLSearchParams, c = ctx): Promise<string> {
  const criterios = leerCriteriosSiguiendo(Object.fromEntries(buscar));
  const [vista, siguiendo] = await Promise.all([
    cargarSiguiendo(c, { cursor: criterios.cursor || undefined, soloMedallas: criterios.soloMedallas }),
    cargarConteoSiguiendo(c),
  ]);
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  const cuerpo = html(h('div', { className: 'flex min-w-0 flex-col gap-4' },
    h(CabeceraSiguiendo, { siguiendo, criterios }),
    vista.tipo === 'ok' && !vista.sinResultados
      ? h(FeedSiguiendo, { items: vista.items, siguiente: vista.siguiente, criterios })
      : h(EstadoSiguiendo, { vista, criterios, siguiendo })));
  return documento(css, cuerpo, {}, true);
}

async function paginaFavoritos(css: string, buscar: URLSearchParams): Promise<string> {
  const cursor = buscar.get('cursor') || undefined;
  const vista = await cargarFavoritos(ctx, cursor);
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  const cuerpo = html(h('div', { className: 'flex min-w-0 flex-col gap-4' },
    h('h1', { className: 'text-3xl leading-none sm:text-4xl' }, 'Favoritos'),
    vista.tipo === 'ok' && !vista.sinResultados
      ? h(ListaFavoritos, { items: vista.items, siguiente: vista.siguiente, cursorActual: cursor })
      : h(EstadoFavoritos, { vista, cursorActual: cursor })));
  return documento(css, cuerpo, {}, true);
}

/** Lo mismo que `explorar/ediciones/page.tsx` (fichero de otra pantalla: aquí sólo se mira). */
async function paginaEdiciones(css: string, buscar: URLSearchParams): Promise<string> {
  const { criterios, cursor } = leerCriteriosCatalogo(Object.fromEntries(buscar));
  const entrada = Object.fromEntries(Object.entries(criterios).filter(([, v]) => v));
  const [vista, catalogo] = await Promise.all([
    cargarSeries(ctx),
    cargarCatalogoEdiciones(ctx, { ...entrada, ...(cursor ? { cursor } : {}) }),
  ]);
  if (vista.tipo === 'sin_sesion' || catalogo.estado === 'sin_sesion') throw new Error('sin sesión');
  // La misma pantalla que la página: si cambia, la captura cambia con ella.
  const cuerpo = html(h(PantallaEdiciones, { catalogo, criterios, cursor, series: vista }));
  return documento(css, cuerpo, {}, true);
}

const [css, cliente] = await Promise.all([compilarCss(), empaquetar()]);

const json = (res: import('node:http').ServerResponse, cuerpo: unknown, estado = 200) =>
  res.writeHead(estado, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
const leerCuerpo = (pet: IncomingMessage) => new Promise<string>((ok) => {
  let texto = '';
  pet.on('data', (c) => { texto += c; });
  pet.on('end', () => ok(texto));
});
const paginas: Record<string, (b: URLSearchParams) => Promise<string>> = {
  '/explorar': (b) => paginaExplorar(css, b),
  '/explorar/siguiendo': (b) => paginaSiguiendo(css, b, b.get('cuenta') === 'nueva' ? ctxNueva : ctx),
  '/explorar/favoritos': (b) => paginaFavoritos(css, b),
  '/explorar/ediciones': (b) => paginaEdiciones(css, b),
};

const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  void (async () => {
    try {
      const pagina = paginas[url.pathname];
      if (url.pathname === '/cliente.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(cliente);
      } else if (pagina) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await pagina(url.searchParams));
      } else if (url.pathname === '/api/mas') {
        json(res, await cargarPaginaExplorar(ctx, JSON.parse(await leerCuerpo(pet))));
      } else if (url.pathname === '/api/explorar/sugerencias') {
        const limite = url.searchParams.get('limite');
        const r = await sugerirPersonas(ctx, { q: url.searchParams.get('q'), ...(limite ? { limite: Number(limite) } : {}) });
        json(res, r, r.estado === 'ok' ? 200 : 400);
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

/** Espera a que dejen de pedirse fotos (lazy) o a que pase el tope. */
async function calma(p: Page, tope = 12_000) {
  const fin = Date.now() + tope;
  let pendientes = 0;
  let ultima = Date.now();
  const sumar = (r: { url(): string }) => { if (r.url().includes('/foto')) { pendientes++; ultima = Date.now(); } };
  const restar = (r: { url(): string }) => { if (r.url().includes('/foto')) { pendientes--; ultima = Date.now(); } };
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

/** Textos de una línea que se han partido: nombres y líneas de filas, pastillas y botones. */
async function partidos(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const sel = '[data-fila-perfil] .truncate, ol[aria-label^="Resultados"] .truncate, [aria-label="Deportistas guardados"] .truncate, nav[aria-label^="Colecciones"] a, nav[aria-label="Filtrar el feed"] a, [data-estado], #explorar-panel-filtros label, [aria-label="Filtros activos"] a';
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((e) => e.offsetParent !== null)
      .filter((e) => {
        // Líneas reales del texto visible (sin los `sr-only`): una caja por línea con tops distintos.
        const tops: number[] = [];
        const recorrer = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        for (let n = recorrer.nextNode(); n; n = recorrer.nextNode()) {
          if (!n.textContent?.trim() || n.parentElement?.closest('.sr-only')) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const caja of r.getClientRects()) if (caja.width > 0) tops.push(caja.top);
        }
        // Más de media línea de diferencia: el texto ha bajado de línea (no sólo un desfase de alineación).
        return tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 10;
      })
      .map((e) => (e.textContent ?? '').trim().slice(0, 50));
  });
}

async function foto(p: Page, nombre: string, a: (typeof anchos)[number]) {
  for (const completa of [false, true]) {
    const destino = path.join(SALIDA, `${nombre}-${a.sufijo}${completa ? '-completa' : ''}.png`);
    await p.screenshot({ path: destino, fullPage: completa });
    capturas.push(path.relative(RAIZ, destino));
  }
  const ancho = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, cuerpo: document.body.scrollWidth, vista: window.innerWidth }));
  if (Math.max(ancho.doc, ancho.cuerpo) > ancho.vista) {
    const culpables = await p.evaluate((vista) => [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => e.getBoundingClientRect().right > vista + 0.5)
      .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}`), ancho.vista);
    fallos.push(`${nombre}@${a.sufijo}: scrollWidth ${Math.max(ancho.doc, ancho.cuerpo)} > ${ancho.vista} (${culpables.join(' | ')})`);
  }
  if (a.sufijo === '393') {
    const rotos = await partidos(p);
    if (rotos.length) avisos.push(`${nombre}@393: texto en dos líneas: ${rotos.slice(0, 6).join(' | ')}`);
    // Los rótulos de navegación y de los botones no se pueden cortar con puntos suspensivos.
    const cortados = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('nav[aria-label^="Colecciones"] .truncate, [data-estado] span:not(.sr-only), nav[aria-label="Filtrar el feed"] a')]
      .filter((e) => e.offsetParent !== null && e.scrollWidth > e.clientWidth + 1)
      .map((e) => (e.textContent ?? '').trim()));
    if (cortados.length) fallos.push(`${nombre}@393: rótulo cortado: ${cortados.slice(0, 4).join(' | ')}`);
  }
}

async function abrir(a: (typeof anchos)[number], ruta: string, esperar = '#contenido') {
  const p = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
  p.on('pageerror', (e) => fallos.push(`${ruta} @${a.sufijo}: ${e.message}`));
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

/** «Ver más» en la lista completa: filas nuevas, ninguna repetida, las anteriores en el mismo orden. */
async function comprobarVerMas(p: Page, a: (typeof anchos)[number]) {
  const filas = '[aria-label="Deportistas encontrados"] [data-fila-perfil]';
  const ids = () => p.locator(filas).evaluateAll((es) => es.map((e) => e.getAttribute('data-persona') ?? ''));
  const antes = await ids();
  const alturas = await p.locator(filas).evaluateAll((es) => es.slice(0, 5).map((e) => Math.round(e.closest('li')!.getBoundingClientRect().height)));
  console.log(`Altura de fila @${a.sufijo}: ${alturas.join(', ')} px (5 filas = ${alturas.reduce((s, x) => s + x, 0)} px)`);
  if (alturas.some((x) => x > 64)) fallos.push(`filas @${a.sufijo}: alguna mide más de 64 px (${alturas.join(', ')})`);
  const boton = p.getByRole('link', { name: 'Ver más' });
  if (!(await boton.count())) { avisos.push(`ver más @${a.sufijo}: no hay segunda página`); return; }
  const url = p.url();
  await boton.click();
  await p.waitForFunction(([s, n]) => document.querySelectorAll(s as string).length > (n as number), [filas, antes.length] as const, { timeout: 20_000 });
  const despues = await ids();
  if (p.url() !== url) fallos.push(`ver más @${a.sufijo}: navegó a ${p.url()}`);
  if (new Set(despues).size !== despues.length) fallos.push(`ver más @${a.sufijo}: filas repetidas`);
  if (despues.slice(0, antes.length).join() !== antes.join()) fallos.push(`ver más @${a.sufijo}: cambió el orden de lo ya pintado`);
  await p.waitForTimeout(150);
  const foco = await p.evaluate(() => document.activeElement?.getAttribute('data-persona'));
  if (foco !== despues[antes.length]) avisos.push(`ver más @${a.sufijo}: el foco no pasó a la primera fila nueva`);
  console.log(`Ver más @${a.sufijo}: ${antes.length} → ${despues.length} filas, sin repetidas`);
}

for (const a of anchos) {
  let p = await abrir(a, '/explorar', '#explorar-q');
  await calma(p);
  await foto(p, 'vacio', a);
  await p.close();

  for (const q of ['alejandro', 'zabal']) {
    p = await abrir(a, `/explorar?q=${q}`, '#explorar-q');
    await calma(p);
    await foto(p, `lista-${q}`, a);
    if (q === 'alejandro') {
      await comprobarVerMas(p, a);
      await calma(p, 6000);
      await foto(p, 'lista-alejandro-mas', a);
    }
    await p.close();
  }

  p = await abrir(a, '/explorar', '#explorar-q');
  await escribir(p, 'zabal');
  await calma(p);
  await foto(p, 'vivo-zabal', a);
  await p.close();

  p = await abrir(a, '/explorar?q=zabala&arma=ESPADA&categoria=ABS&torneo=campeonato%20de%20espa%C3%B1a%20absoluto', '#explorar-q');
  await p.getByRole('button', { name: /^Filtros/ }).click();
  await p.waitForSelector('#explorar-panel-filtros[data-state="open"]');
  await calma(p, 4000);
  await foto(p, 'filtros', a);
  await p.close();

  for (const [nombre, ruta] of [
    ['siguiendo', '/explorar/siguiendo'],
    ['siguiendo-medallas', '/explorar/siguiendo?medallas=1'],
    ['siguiendo-vacio', '/explorar/siguiendo?cuenta=nueva'],
    ['favoritos', '/explorar/favoritos'],
    ['ediciones', '/explorar/ediciones'],
  ] as const) {
    p = await abrir(a, ruta);
    await calma(p, 3000);
    await foto(p, nombre, a);
    await p.close();
  }
}
await navegador.close();
servidor.close();

console.log(capturas.join('\n'));
if (avisos.length) console.warn(`\nAvisos:\n${avisos.join('\n')}`);
if (fallos.length) {
  console.error(`\nFallos:\n${fallos.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nNinguna pantalla desborda a 393 px.');
}
