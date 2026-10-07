/**
 * El calendario montado de verdad en el navegador (sin Next): la cabecera
 * del periodo, la fila de chips, la hoja de filtros, la ficha como
 * subpantalla y el cambio de mes. Lee el calendario de la copia SQLite
 * (`PERF_DB`, sólo lectura) y lo sirve con `node:http`; el cliente es un
 * paquete de esbuild con las acciones de servidor sustituidas.
 *
 *   PERF_DB=…\nuevo10.sqlite npx tsx tests/ui/ola2b-calendario.mts
 *
 * Mide, a 320, 393 y 1440 px:
 * - que los controles de la cabecera y los chips se ven de ≤ 36 px y se
 *   tocan en ≥ 44 (`::after`);
 * - que la ficha abre como subpantalla, con su título en la cabecera al
 *   desplazarse, y que «Atrás» la cierra sin salir del calendario;
 * - que no hay textos de menos de 12 px, desborde horizontal ni errores de
 *   consola.
 *
 * Capturas en `capturas/ola2b-calendario/` (o `$CAPTURAS`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Page } from 'playwright';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { hoyMadrid } from '@/lib/callups/fechas';
import { listEvents, type Scope } from '@/lib/queries/calendar';
import { cargarTramoPasado } from '@/lib/queries/calendario-pasado';
import { tramoDeMeses, tramoPasadoDe } from '@/lib/queries/calendario-pasado-tramo';
import { fijarHoy } from './_directos.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', process.env.CAPTURAS ?? 'ola2b-calendario');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const SCOPE: Scope[] = ['NACIONAL', 'INTERNACIONAL'];

const sqlite = new DatabaseSync(BASE, { readOnly: true });
fijarHoy();

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}
function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
  const ejecutar = (): D1QueryResult<unknown> => {
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
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, cf: {}, ctx: { waitUntil: () => {} } };

const STUBS: Record<string, string> = {
  'next/link': `import * as React from 'react';
    export function useLinkStatus() { return { pending: false }; }
    export default React.forwardRef(function Link({ href, prefetch, replace, scroll, transitionTypes, onNavigate, ...p }, ref) {
      return React.createElement('a', { ...p, ref, href: typeof href === 'string' ? href : String(href) });
    });`,
  'next/navigation': `export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() { history.back(); }, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }`,
  detalle: `export async function fichaDelEvento() { return { detalle: null, inscritos: { oficiales: [], estados: {}, pendientes: [] }, podios: null }; }
    export async function detalleDelEvento() { return null; }`,
  podios: `export async function podiosDelEvento() { return { tipo: 'no_disponible' }; }`,
  resultados: `export async function resultadosDelEvento() { return { tipo: 'no_disponible' }; }`,
};
const sustitutos: Plugin = {
  name: 'sustitutos',
  setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onResolve({ filter: /detalle-evento$/ }, () => ({ path: 'detalle', namespace: 'stub' }));
    b.onResolve({ filter: /resultados-accion$/ }, () => ({ path: 'podios', namespace: 'stub' }));
    b.onResolve({ filter: /explorar\/resultados-evento$/ }, () => ({ path: 'resultados', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'jsx', resolveDir: RAIZ }));
  },
};

async function empaquetar(): Promise<string> {
  const r = await build({
    entryPoints: [path.join(RAIZ, 'tests', 'ui', '_ola2b-calendario-cliente.tsx')],
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

const hoy = hoyMadrid();
const [anio, mes] = hoy.split('-').map(Number);
const t = tramoDeMeses(anio, mes - 1, 1);
const pasado = tramoPasadoDe(t.desde, t.hasta, hoy);
const [eventos, tramo, js, css] = await Promise.all([
  listEvents({ limit: 500, scope: SCOPE }),
  pasado ? cargarTramoPasado({ ...pasado, hoy, scope: SCOPE }) : Promise.resolve(null),
  empaquetar(),
  compilarCss(),
]);
const datos = {
  inicial: { vista: 'mes', mes: `${anio}-${String(mes).padStart(2, '0')}` },
  eventos,
  perfil: { role: 'admin', weapons: [] },
  tiradores: [],
  inscripciones: {},
  temporada: '2026-2027',
  actualizado: '07 oct, 05:00',
  pasadoInicial: tramo,
};
const html = `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
<style>${css}</style>
</head><body class="antialiased"><main class="ancho-app flex min-h-dvh flex-1 flex-col px-4 py-4"><div id="raiz" class="flex min-h-0 flex-1 flex-col"></div></main>
<script>window.__DATOS__=${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>
<script type="module" src="/cliente.js"></script></body></html>`;

const servidor = createServer((req, res) => {
  if (req.url?.startsWith('/cliente.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(js);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/`;
mkdirSync(SALIDA, { recursive: true });

type Fallo = string;
const fallos: Fallo[] = [];
const informe: Record<string, unknown>[] = [];

/** Controles del sistema: alto visible y área táctil (la caja o su `::after`, la mayor). */
async function controles(p: Page) {
  return p.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-slot^="sistema-"]:is(button,a), [data-slot="pantalla-ficha-cabecera"] button')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const d = getComputedStyle(el, '::after');
        const aw = d.content !== 'none' ? parseFloat(d.width) || 0 : 0;
        const ah = d.content !== 'none' ? parseFloat(d.height) || 0 : 0;
        return {
          nombre: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
          alto: Math.round(r.height),
          tactilAncho: Math.round(Math.max(r.width, aw)),
          tactilAlto: Math.round(Math.max(r.height, ah)),
        };
      }),
  );
}

async function textoPequeno(p: Page, raiz = 'body') {
  return p.evaluate((sel) => {
    const salida: string[] = [];
    const caminar = document.createTreeWalker(document.querySelector(sel) ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = caminar.nextNode(); n; n = caminar.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim() || el.offsetParent === null) continue;
      if (el.closest('.sr-only')) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 11.95) salida.push(`${px}px «${n.textContent.trim().slice(0, 20)}»`);
    }
    return [...new Set(salida)].slice(0, 10);
  }, raiz);
}

const navegador = await chromium.launch();
for (const [ancho, reducido] of [[320, false], [393, false], [1440, false], [393, true]] as const) {
  const movil = ancho < 640;
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: movil ? 760 : 900 },
    deviceScaleFactor: 2,
    isMobile: movil,
    hasTouch: movil,
    colorScheme: 'dark',
    reducedMotion: reducido ? 'reduce' : 'no-preference',
  });
  const p = await contexto.newPage();
  const consola: string[] = [];
  p.on('console', (m) => {
    if (m.type() === 'error') consola.push(m.text().slice(0, 200));
  });
  p.on('pageerror', (e) => consola.push(String(e).slice(0, 200)));
  await p.goto(url);
  await p.getByRole('group', { name: 'Filtros del calendario' }).waitFor();
  await p.waitForTimeout(300);
  const fila: Record<string, unknown> = { ancho, reducido };

  fila.desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if ((fila.desborde as number) > 0) fallos.push(`${ancho}: desborde horizontal de ${fila.desborde} px`);
  const cs = await controles(p);
  const grandes = cs.filter((c) => c.alto > 36);
  const pequenos = cs.filter((c) => c.tactilAncho < 44 || c.tactilAlto < 44);
  fila.controles = cs.length;
  if (grandes.length) fallos.push(`${ancho}: controles de más de 36 px: ${grandes.map((c) => `${c.nombre} ${c.alto}`).join(', ')}`);
  if (pequenos.length) fallos.push(`${ancho}: área táctil < 44: ${pequenos.map((c) => `${c.nombre} ${c.tactilAncho}x${c.tactilAlto}`).join(', ')}`);
  const pequeno = await textoPequeno(p);
  if (pequeno.length) fallos.push(`${ancho}: texto < 12 px: ${pequeno.join(', ')}`);
  await p.screenshot({ path: path.join(SALIDA, `${ancho}${reducido ? '-reducido' : ''}-calendario.png`) });

  // Hoja de filtros.
  await p.getByRole('button', { name: /^Filtros del calendario/ }).click();
  const hoja = p.locator('[data-slot="sistema-hoja"]');
  await hoja.waitFor();
  await p.waitForTimeout(350);
  const enHoja = await textoPequeno(p, '[data-slot="sistema-hoja"]');
  if (enHoja.length) fallos.push(`${ancho}: texto < 12 px en la hoja: ${enHoja.join(', ')}`);
  await p.screenshot({ path: path.join(SALIDA, `${ancho}${reducido ? '-reducido' : ''}-hoja-filtros.png`) });
  await p.keyboard.press('Escape');
  await hoja.waitFor({ state: 'detached' });

  // Cambio de mes: sin errores y con otro título.
  const antes = await p.locator('h2').first().textContent();
  await p.getByRole('button', { name: 'Mes siguiente' }).click();
  await p.waitForTimeout(400);
  const despues = await p.locator('h2').first().textContent();
  fila.mes = `${antes?.trim()} → ${despues?.trim()}`;
  if (antes === despues) fallos.push(`${ancho}: el mes no cambió`);

  // Ficha como subpantalla.
  const historialAntes = await p.evaluate(() => history.length);
  const tarjeta = p.locator('article [data-evento]:visible, li [data-evento]:visible').first();
  await tarjeta.click();
  const ficha = p.locator('[data-slot="pantalla-ficha"]');
  await ficha.waitFor();
  await p.waitForTimeout(400);
  const caja = await ficha.boundingBox();
  fila.ficha = caja ? `${Math.round(caja.width)}x${Math.round(caja.height)}` : null;
  if (movil && caja && (caja.width < ancho - 1 || caja.x > 0)) fallos.push(`${ancho}: la ficha no ocupa la pantalla`);
  const opacidadInicial = await ficha.locator('[data-slot="pantalla-ficha-cabecera"]').evaluate((h) => getComputedStyle(h.querySelector('h2')!).opacity);
  await p.screenshot({ path: path.join(SALIDA, `${ancho}${reducido ? '-reducido' : ''}-ficha.png`) });
  const enFicha = await textoPequeno(p, '[data-slot="pantalla-ficha"]');
  if (enFicha.length) fallos.push(`${ancho}: texto < 12 px en la ficha: ${enFicha.join(', ')}`);
  fila.desplazamiento = await ficha.locator('[data-slot="pantalla-ficha-cuerpo"]').evaluate(async (el) => {
    el.scrollTop = 400;
    await new Promise((ok) => setTimeout(ok, 100));
    const t = el.querySelector('[data-titulo-ficha]')?.getBoundingClientRect().bottom ?? -1;
    return `${Math.round(el.scrollTop)}/${el.scrollHeight - el.clientHeight}, título ${Math.round(t)} vs ${Math.round(el.getBoundingClientRect().top)}`;
  });
  await p.waitForTimeout(300);
  const opacidadAbajo = await ficha.locator('[data-slot="pantalla-ficha-cabecera"]').evaluate((h) => getComputedStyle(h.querySelector('h2')!).opacity);
  fila.tituloCabecera = `${opacidadInicial} → ${opacidadAbajo}`;
  // El título pequeño sale cuando el grande ha pasado por debajo de la cabecera, y sólo entonces.
  const [, tituloAbajo, cuerpoArriba] = String(fila.desplazamiento).match(/título (-?\d+) vs (-?\d+)/) ?? [];
  const tituloFuera = Number(tituloAbajo) <= Number(cuerpoArriba);
  if (tituloFuera !== (opacidadAbajo === '1')) fallos.push(`${ancho}: el título de la cabecera no sigue al título grande`);
  await p.screenshot({ path: path.join(SALIDA, `${ancho}${reducido ? '-reducido' : ''}-ficha-desplazada.png`) });

  fila.historial = `${historialAntes} → ${await p.evaluate(() => history.length)}`;
  await p.goBack();
  await ficha.waitFor({ state: 'detached', timeout: 3000 }).catch(() => fallos.push(`${ancho}: «Atrás» no cierra la ficha`));
  fila.url = new URL(p.url()).pathname;
  if (fila.url !== '/') fallos.push(`${ancho}: «Atrás» sacó del calendario (${p.url()})`);

  // Reabrir y cerrar con la flecha: deshace la entrada del historial.
  await tarjeta.click();
  await ficha.waitFor();
  await p.getByRole('button', { name: 'Volver' }).click();
  await ficha.waitFor({ state: 'detached', timeout: 3000 }).catch(() => fallos.push(`${ancho}: la flecha no cierra la ficha`));
  await p.waitForTimeout(200);
  fila.historialFinal = await p.evaluate(() => history.length);

  await p.getByRole('button', { name: 'Ir al mes actual' }).click();
  await p.waitForTimeout(400);

  fila.consola = consola.length;
  if (consola.length) fallos.push(`${ancho}: consola: ${consola.join(' | ')}`);
  informe.push(fila);
  await contexto.close();
}
await navegador.close();
servidor.close();

console.table(informe);
writeFileSync(path.join(SALIDA, 'arnes.json'), JSON.stringify({ informe, fallos }, null, 2));
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(` - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Sin fallos.');
}
