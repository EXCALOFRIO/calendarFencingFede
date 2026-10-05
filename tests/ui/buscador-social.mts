/**
 * Capturas del buscador social de Explorar con datos reales y el formulario
 * real en marcha (escritura en vivo, recientes, filtros).
 *
 *   PERF_DB=<ruta a una copia SQLite de D1 con el índice v2> npx tsx tests/ui/buscador-social.mts
 *
 * Como `perfil-v3.mts`, no hay servidor de Next: la base se abre en sólo
 * lectura y el contenido de la página (cabecera, lista completa o sugerencias
 * para seguir) se pinta con los componentes y cargadores de `page.tsx`. Para
 * que se pueda escribir, el formulario se empaqueta con esbuild y se monta en
 * el navegador; `/api/explorar/sugerencias` y la foto responden con los mismos
 * lectores que las rutas reales. `next/link`, `next/navigation` y las acciones
 * de favoritos se sustituyen por equivalentes mínimos (Seguir no escribe).
 * Las personas seguidas son una tabla TEMPORAL de la conexión.
 * Salida en `capturas/buscador-social/`, a 393 y 1440 px. Con SOLO_LISTA=1
 * sólo se captura la lista completa de «alejandro» y se comprueba que abrir una
 * ficha desde ella la apunta en Recientes.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Page } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { PropuestasBuscador } from '@/components/explorar/buscador-social-fila';
import { EnlaceEdiciones } from '@/components/explorar/ediciones';
import { EnlaceFavoritos } from '@/components/explorar/favoritos';
import { ChipsActivos, EstadoSinCoincidencias, EstadoSinLista, ListaDeportistas } from '@/components/explorar/resultados';
import { EnlaceSiguiendo } from '@/components/explorar/siguiendo';
import { leerFotoDeportista } from '@/lib/sport/explorar/foto';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { claveRecientes, type PerfilReciente } from '@/lib/sport/explorar/recientes';
import { cargarConteoSiguiendo, leerPropuestasParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { hayCriterios, leerCriterios, opcionesTemporada } from '@/lib/sport/explorar/url';
import { crearContexto, perfil } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'buscador-social');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const CUENTA = '00000000-0000-4000-8000-0000000000a1';
const ZABALA = process.env.PERSONA_SEGUIDA ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';

const sqlite = new DatabaseSync(BASE, { readOnly: true });
sqlite.exec('CREATE TEMP TABLE sport_favorite (profile_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at INTEGER NOT NULL)');
sqlite.prepare('INSERT INTO temp.sport_favorite VALUES (?, ?, ?)').run(CUENTA, ZABALA, 1_700_000_000_000);

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
const ctx = {
  ...crearContexto({ perfil: perfil({ profileId: CUENTA, role: 'coach' }) }).ctx,
  db: createD1Database(binding),
  indiceExplorar: async () => true,
};

const STUBS: Record<string, string> = {
  'next/link': `import * as React from 'react';
    export default React.forwardRef(function Link({ href, prefetch, replace, scroll, ...p }, ref) {
      return React.createElement('a', { ...p, ref, href: typeof href === 'string' ? href : String(href) });
    });`,
  'next/navigation': `export function useRouter() { return { push: (u) => { location.href = u; }, replace: (u) => { location.href = u; }, refresh() {}, back() { history.back(); }, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }`,
  acciones: `const ok = (e, favorito) => ({ estado: 'ok', personaId: e && e.personaId, favorito });
    export async function guardarFavoritoAccion(e) { return ok(e, true); }
    export async function quitarFavoritoAccion(e) { return ok(e, false); }
    export async function consultarFavoritoAccion(e) { return ok(e, false); }
    export async function listarFavoritosAccion() { return { estado: 'ok', items: [], siguiente: null }; }`,
};
const sustitutos: Plugin = {
  name: 'sustitutos',
  setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onResolve({ filter: /favoritos-acciones$/ }, () => ({ path: 'acciones', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'jsx', resolveDir: RAIZ }));
  },
};

async function empaquetar(): Promise<string> {
  const r = await build({
    entryPoints: [path.join(RAIZ, 'tests', 'ui', '_buscador-social-cliente.tsx')],
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

const hoy = new Date().toISOString().slice(0, 10);
const tiempos: { que: string; ms: number }[] = [];

/** Lo mismo que pinta `page.tsx`, con el formulario montado después en el navegador. */
async function paginaExplorar(css: string, buscar: URLSearchParams): Promise<string> {
  const t = performance.now();
  const { criterios, cursor } = leerCriterios(Object.fromEntries(buscar));
  const inicio = !hayCriterios(criterios);
  const [vista, siguiendo, propuestas] = await Promise.all([
    cargarExplorar(ctx, criterios, cursor),
    cargarConteoSiguiendo(ctx),
    inicio ? leerPropuestasParaSeguir(ctx).catch(() => null) : Promise.resolve(null),
  ]);
  tiempos.push({ que: `página ${buscar.toString() || '(inicio)'}`, ms: Math.round(performance.now() - t) });
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  const contenido = vista.tipo === 'ok' ? (
    vista.sinResultados
      ? React.createElement(EstadoSinCoincidencias, { criterios })
      : React.createElement(ListaDeportistas, { items: vista.items, siguiente: vista.siguiente, cursorActual: cursor, criterios })
  ) : inicio && vista.tipo === 'sin_criterio' && propuestas?.length !== 0
    ? React.createElement(PropuestasBuscador, { propuestas, className: 'lg:max-w-2xl' })
    : React.createElement(EstadoSinLista, { vista, criterios });
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    inicio ? null : React.createElement('div', { className: 'flex flex-col gap-3' }, React.createElement(ChipsActivos, { criterios })),
    contenido));
  const cabecera = renderToStaticMarkup(
    React.createElement('header', { className: 'flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-4' },
      React.createElement('div', { className: 'flex min-w-0 flex-col gap-1' },
        React.createElement('h1', { className: 'text-3xl leading-tight sm:text-4xl' }, 'Explorar'),
        React.createElement('p', { className: 'text-sm text-muted-foreground' }, 'Encuentra deportistas, resultados y rankings publicados.')),
      React.createElement('nav', { 'aria-label': 'Colecciones de Explorar', className: 'flex flex-wrap items-center gap-x-5 gap-y-1' },
        React.createElement(EnlaceSiguiendo, { siguiendo }),
        React.createElement(EnlaceEdiciones),
        React.createElement(EnlaceFavoritos))));
  const datos = { criterios, temporadas: opcionesTemporada(hoy), atajoEspana: true, profileId: CUENTA, contenido: html };
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4"><div class="flex flex-col gap-6">${cabecera}<div id="formulario-explorar"></div></div></main>
<script>window.__DATOS=${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>
<script type="module" src="/cliente.js"></script></body></html>`;
}

const [css, cliente] = await Promise.all([compilarCss(), empaquetar()]);

const json = (res: import('node:http').ServerResponse, cuerpo: unknown, estado = 200) =>
  res.writeHead(estado, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));

const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  void (async () => {
    try {
      if (url.pathname === '/cliente.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(cliente);
      } else if (url.pathname === '/explorar') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await paginaExplorar(css, url.searchParams));
      } else if (url.pathname === '/api/explorar/sugerencias') {
        const t = performance.now();
        const limite = url.searchParams.get('limite');
        const r = await sugerirPersonas(ctx, { q: url.searchParams.get('q'), ...(limite ? { limite: Number(limite) } : {}) });
        tiempos.push({ que: `sugerencias «${url.searchParams.get('q')}»`, ms: Math.round(performance.now() - t) });
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

async function primero(q: string): Promise<PerfilReciente> {
  const r = await sugerirPersonas(ctx, { q });
  if (r.estado !== 'ok' || !r.items[0]) throw new Error(`sin perfil para ${q}`);
  const { id, nombre, pais } = r.items[0];
  return { id, nombre, pais };
}
const recientes = [await primero('jorgensen patrick'), await primero('limardo gascon'), await primero('cheung ka long')];

const navegador = await chromium.launch();
const anchos = [
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
mkdirSync(SALIDA, { recursive: true });
const capturas: string[] = [];
const avisos: string[] = [];

/** Espera a que dejen de pedirse fotos (lazy, de tres en tres) o a que pase el tope. */
async function calma(p: Page, tope = 15_000) {
  const fin = Date.now() + tope;
  let pendientes = 0;
  let ultima = Date.now();
  const sumar = (r: { url(): string }) => { if (r.url().includes('/foto')) { pendientes++; ultima = Date.now(); } };
  const restar = (r: { url(): string }) => { if (r.url().includes('/foto')) { pendientes--; ultima = Date.now(); } };
  p.on('request', sumar);
  p.on('requestfinished', restar);
  p.on('requestfailed', restar);
  await p.waitForTimeout(700);
  while (Date.now() < fin && (pendientes > 0 || Date.now() - ultima < 900)) await p.waitForTimeout(150);
  p.off('request', sumar);
  p.off('requestfinished', restar);
  p.off('requestfailed', restar);
  await p.evaluate(() => document.fonts.ready);
}

async function foto(p: Page, nombre: string, completa = false) {
  const destino = path.join(SALIDA, `${nombre}.png`);
  await p.screenshot({ path: destino, fullPage: completa });
  capturas.push(path.relative(RAIZ, destino));
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (desborde > 0) avisos.push(`${nombre}: desborda ${desborde}px en horizontal`);
}

async function abrir(a: (typeof anchos)[number], ruta: string, conRecientes = true) {
  const p = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
  p.on('pageerror', (e) => avisos.push(`${ruta} @${a.sufijo}: ${e.message}`));
  if (conRecientes) {
    await p.addInitScript(([clave, valor]) => localStorage.setItem(clave, valor), [claveRecientes(CUENTA), JSON.stringify(recientes)] as const);
  }
  await p.goto(`${origen}${ruta}`, { waitUntil: 'load' });
  await p.waitForSelector('#explorar-q');
  return p;
}

async function escribir(p: Page, texto: string) {
  await p.locator('#explorar-q').click();
  await p.locator('#explorar-q').pressSequentially(texto, { delay: 40 });
  await p.waitForFunction((q) => {
    const s = document.querySelector(`#explorar-perfiles section[aria-label="Perfiles para «${q}»"]`);
    return Boolean(s?.querySelector('[data-fila-perfil]')) || /Ningún perfil/.test(s?.textContent ?? '');
  }, texto, { timeout: 15_000 });
  await calma(p);
  return p.locator('#explorar-perfiles [data-fila-perfil] .truncate.font-semibold').allInnerTexts();
}

/** Abrir una ficha desde la lista completa la apunta en Recientes, como desde el desplegable. */
async function comprobarRecientesDesdeLista(p: Page) {
  const fila = p.locator('[aria-label="Deportistas encontrados"] [data-fila-perfil]').nth(1);
  const id = await fila.getAttribute('data-persona');
  await p.evaluate(() => document.addEventListener('click', (e) => e.preventDefault(), { capture: true, once: true }));
  await fila.click();
  const guardados = await p.evaluate((clave) => JSON.parse(localStorage.getItem(clave) ?? '[]') as { id: string }[], claveRecientes(CUENTA));
  if (guardados[0]?.id !== id) avisos.push(`la fila ${id} de la lista completa no pasó a Recientes`);
  else console.log(`Recientes tras abrir desde la lista completa: ${guardados.length}, la primera ${id}`);
}

const ordenes: Record<string, string[]> = {};
for (const a of process.env.SOLO_LISTA ? [] : anchos) {
  let p = await abrir(a, '/explorar');
  await calma(p);
  await foto(p, `vacio-${a.sufijo}`);
  await foto(p, `vacio-${a.sufijo}-completa`, true);
  await p.close();

  for (const q of ['zabal', 'alejandro', 'zabla']) {
    p = await abrir(a, '/explorar');
    ordenes[q] = await escribir(p, q);
    await foto(p, `${q}-${a.sufijo}`);
    await foto(p, `${q}-${a.sufijo}-completa`, true);
    await p.close();
  }

  p = await abrir(a, '/explorar');
  await escribir(p, 'alejandro');
  await Promise.all([p.waitForURL(/q=alejandro/), p.locator('#explorar-q').press('Enter')]);
  await p.waitForSelector('#explorar-q');
  await calma(p);
  await foto(p, `resultados-completos-${a.sufijo}`);
  await foto(p, `resultados-completos-${a.sufijo}-completa`, true);
  await p.close();

  p = await abrir(a, '/explorar?q=zabala&arma=ESPADA');
  await p.getByRole('button', { name: /^Filtros/ }).click();
  await p.waitForSelector('#explorar-panel-filtros[data-state="open"]');
  await calma(p, 4000);
  await foto(p, `filtros-${a.sufijo}`);
  await foto(p, `filtros-${a.sufijo}-completa`, true);
  await p.close();
}
// SOLO_LISTA=1: sólo la lista completa de «alejandro» (por popularidad) y Recientes desde ella.
for (const a of process.env.SOLO_LISTA ? anchos : []) {
  const p = await abrir(a, '/explorar');
  await escribir(p, 'alejandro');
  await Promise.all([p.waitForURL(/q=alejandro/), p.locator('#explorar-q').press('Enter')]);
  await p.waitForSelector('#explorar-q');
  await calma(p);
  await foto(p, `lista-popular-alejandro-${a.sufijo}`);
  await foto(p, `lista-popular-alejandro-${a.sufijo}-completa`, true);
  ordenes[`lista completa @${a.sufijo}`] = await p.locator('[aria-label="Deportistas encontrados"] [data-fila-perfil] .text-base.font-semibold').allInnerTexts();
  await comprobarRecientesDesdeLista(p);
  await p.close();
}
await navegador.close();
servidor.close();

console.log('Recientes sembrados:', recientes.map((r) => r.nombre).join(', '));
for (const [q, filas] of Object.entries(ordenes)) console.log(`«${q}»:`, filas.slice(0, 10).join(' | '));
console.table(tiempos.slice(0, 40));
if (avisos.length) console.warn(avisos.join('\n'));
console.log(capturas.join('\n'));
