/**
 * Página de muestra de las piezas de `src/components/sistema/*`, sin Next:
 * el HTML lo pinta este proceso con `renderToString` y lo sirve `node:http`;
 * el navegador lo hidrata con un paquete de esbuild. Captura a 320, 393 y
 * 1440 px la página entera y la hoja inferior abierta, y mide:
 *
 * - que cada control del sistema se ve de 28-36 px y se toca en ≥ 44 px
 *   (el `::after` transparente);
 * - que no hay desplazamiento horizontal;
 * - que no hay errores de consola ni de hidratación.
 *
 *   npx tsx tests/ui/sistema-muestra.mts
 *
 * Salida en `capturas/sistema/` (o `capturas/$CAPTURAS/sistema/`).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { carpetaCapturas } from './pasada.mts';
import { Muestra } from './_sistema-muestra-vista.tsx';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'sistema');

const STUBS: Record<string, string> = {
  'next/link': `import * as React from 'react';
    const Estado = React.createContext({ pending: false });
    export function useLinkStatus() { return React.useContext(Estado); }
    export default React.forwardRef(function Link({ href, prefetch, replace, scroll, transitionTypes, onNavigate, ...p }, ref) {
      return React.createElement('a', { ...p, ref, href: typeof href === 'string' ? href : String(href) });
    });`,
  'next/navigation': `export function useRouter() { return { push: (u) => { location.href = u; }, replace: (u) => { location.href = u; }, refresh() {}, back() { history.back(); }, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }`,
};
const sustitutos: Plugin = {
  name: 'sustitutos',
  setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'jsx', resolveDir: RAIZ }));
  },
};

async function empaquetar(): Promise<string> {
  const r = await build({
    entryPoints: [path.join(RAIZ, 'tests', 'ui', '_sistema-muestra-cliente.tsx')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', minify: true, logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    tsconfig: path.join(RAIZ, 'tsconfig.json'),
    plugins: [sustitutos],
  });
  return r.outputFiles[0]!.text;
}

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  // Lo que en la pasada final será `@import '../components/sistema/sistema.css'` en globals.css.
  return `${r.css}\n${readFileSync(path.join(RAIZ, 'src', 'components', 'sistema', 'sistema.css'), 'utf8')}`;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };

function documento(css: string, hoja: boolean): string {
  const h = React.createElement;
  const cuerpo = renderToString(
    h(AppRouterContext.Provider, { value: ROUTER as never },
      h(PathnameContext.Provider, { value: '/' },
        h(SearchParamsContext.Provider, { value: new URLSearchParams() as never }, h(Muestra, { hojaInicial: hoja })))),
  );
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><div id="raiz">${cuerpo}</div>
<script>window.__DATOS=${JSON.stringify({ hoja })}</script>
<script type="module" src="/cliente.js"></script></body></html>`;
}

const [css, cliente] = await Promise.all([compilarCss(), empaquetar()]);

const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  if (url.pathname === '/cliente.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(cliente);
  } else if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(documento(css, url.searchParams.has('hoja')));
  } else {
    res.writeHead(404).end();
  }
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

/** Se ejecuta en el navegador. */
function medirControles() {
  const fallos: string[] = [];
  let medidos = 0;
  for (const el of document.querySelectorAll<HTMLElement>('[data-slot^="sistema-boton"], [data-slot="sistema-chip"], [data-slot="sistema-barra-inferior"] a')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    medidos += 1;
    const quien = `${el.getAttribute('data-slot') ?? 'pestaña'} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}»`;
    const enBarra = Boolean(el.closest('[data-slot="sistema-barra-inferior"]'));
    if (!enBarra && r.height > 36.5) fallos.push(`${quien}: se ve de ${r.height.toFixed(1)} px de alto`);
    const despues = getComputedStyle(el, '::after');
    const ancho = enBarra ? r.width : Number.parseFloat(despues.width);
    const alto = enBarra ? r.height : Number.parseFloat(despues.height);
    if (!(ancho >= 44 && alto >= 44)) fallos.push(`${quien}: área táctil ${ancho.toFixed(1)} × ${alto.toFixed(1)} px`);
  }
  return { medidos, fallos };
}

const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch();
const problemas: string[] = [];
const informe: string[] = [];
let capturas = 0;
try {
  for (const a of anchos) {
    for (const hoja of [false, true]) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      const errores: string[] = [];
      pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
      pagina.on('pageerror', (e) => errores.push(e.message));
      await pagina.goto(`http://127.0.0.1:${puerto}/${hoja ? '?hoja=1' : ''}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const nombre = `${hoja ? 'hoja' : 'muestra'}-${a.sufijo}`;
      if (hoja) {
        await pagina.waitForSelector('[data-slot="sistema-hoja"][data-state="open"]');
        await pagina.waitForTimeout(400);
        await pagina.screenshot({ path: path.join(SALIDA, `${nombre}.png`) });
      } else {
        const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
        if (ancho > a.viewport.width) problemas.push(`${nombre}: scrollWidth ${ancho}`);
        const { medidos, fallos } = await pagina.evaluate(medirControles);
        informe.push(`${nombre}: ${medidos} controles medidos, ${fallos.length} fuera de escala`);
        problemas.push(...fallos.map((f) => `${nombre}: ${f}`));
        await pagina.screenshot({ path: path.join(SALIDA, `${nombre}.png`) });
        await pagina.screenshot({ path: path.join(SALIDA, `${nombre}-entera.png`), fullPage: true });
      }
      capturas += 1;
      problemas.push(...errores.map((e) => `${nombre}: consola: ${e.slice(0, 200)}`));
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(`${capturas} capturas en ${path.relative(RAIZ, SALIDA)}`);
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
