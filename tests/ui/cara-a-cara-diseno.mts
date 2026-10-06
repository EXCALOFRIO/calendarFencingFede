/**
 * Capturas sin servidor de los ajustes de diseño del cara a cara a 320, 393 y
 * 1440 px: la cabecera (nombres de los tiradores), la elección de rival
 * (buscador y lista con país) y «Mano a mano» del perfil (píldora «Elegir
 * otro rival»). Mide las áreas táctiles y las líneas de los nombres, y falla
 * si algo se desborda en horizontal a 393 o 320 px.
 *
 *   PERF_DB=<copia SQLite> SUFIJO=antes|despues npx tsx tests/ui/cara-a-cara-diseno.mts
 *
 * La copia se abre en sólo lectura. Salida en `capturas/relevos/diseno-*`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createD1Database } from '@/db/d1/runtime';
import { CabeceraCaraACara, ElegirRival } from '@/components/explorar/cara-a-cara';
import { FiltrosCaraACara } from '@/components/explorar/filtros-cara-a-cara';
import { ManoAMano } from '@/components/explorar/perfil/rivales-perfil';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { opcionesTemporada } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'relevos');
const BASE = process.env.PERF_DB;
const SUFIJO = process.env.SUFIJO ?? 'despues';
if (!BASE) throw new Error('Falta PERF_DB');

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const binding = bindingDeLectura(sqlite);
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

function personaPorNombre(nombre: string): string {
  const fila = sqlite.prepare(`SELECT id FROM sport_person WHERE display_name = ? AND merged_into_person_id IS NULL
    ORDER BY (SELECT count(*) FROM sport_result r WHERE r.person_id = sport_person.id) DESC LIMIT 1`).get(nombre) as { id: string } | undefined;
  if (!fila) throw new Error(`sin persona: ${nombre}`);
  return fila.id;
}

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, cuerpo: React.ReactElement, ruta: string): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams('') }, cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

const yo = personaPorNombre(process.env.NOMBRE_A ?? 'ZABALA Juan');
const rival = personaPorNombre(process.env.NOMBRE_B ?? 'RAMIREZ LARENA Alejandro');
const conRival = { ...CRITERIOS_CARA_A_CARA_VACIOS, rival };

const duelo = await cargarCaraACaraPantalla(ctx, yo, conRival);
if (duelo.tipo !== 'ok') throw new Error(`cara a cara: ${duelo.tipo}`);
const eleccion = await cargarCaraACaraPantalla(ctx, yo, CRITERIOS_CARA_A_CARA_VACIOS);
if (eleccion.tipo !== 'elegir') throw new Error(`elegir: ${eleccion.tipo}`);
const ficha = await cargarFichaPantalla(ctx, yo, CRITERIOS_FICHA_VACIOS, { diferirRivales: false });
if (ficha.tipo !== 'ok' || !ficha.ficha.perfil) throw new Error(`ficha: ${ficha.tipo}`);

const paginas = [
  {
    nombre: 'cabecera',
    ruta: `/explorar/${yo}/cara-a-cara`,
    cuerpo: React.createElement('div', { className: 'mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4' },
      React.createElement(CabeceraCaraACara, { datos: duelo.datos, criterios: conRival })),
  },
  {
    nombre: 'elegir',
    ruta: `/explorar/${yo}/cara-a-cara`,
    cuerpo: React.createElement('div', { className: 'flex flex-col gap-6' },
      React.createElement('h1', { className: 'text-2xl break-words sm:text-3xl' }, 'Cara a cara de Juan Zabala'),
      React.createElement(FiltrosCaraACara, { personaId: yo, criterios: CRITERIOS_CARA_A_CARA_VACIOS, temporadas: opcionesTemporada('2026-10-06') }),
      React.createElement(ElegirRival, { persona: eleccion.persona, rivales: eleccion.rivales, otros: eleccion.otros, criterios: CRITERIOS_CARA_A_CARA_VACIOS })),
    recorte: 1100,
  },
  {
    nombre: 'mano-a-mano',
    ruta: `/explorar/${yo}`,
    cuerpo: React.createElement(ManoAMano, { personaId: yo, nombre: ficha.ficha.nombre, perfil: ficha.ficha.perfil, nivel: 'pagina' }),
  },
];

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });
const html = new Map(paginas.map((p) => [`/${p.nombre}`, documento(css, p.cuerpo, p.ruta)]));
const servidor = createServer((pet, res) => {
  const ruta = decodeURIComponent(new URL(pet.url ?? '/', 'http://x').pathname);
  const pagina = html.get(ruta);
  if (pagina) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina);
    return;
  }
  const fichero = path.join(RAIZ, 'public', path.normalize(ruta).replace(/^([/\\])+/, ''));
  if (!fichero.startsWith(path.join(RAIZ, 'public')) || !existsSync(fichero)) {
    res.writeHead(404).end();
    return;
  }
  const tipo = fichero.endsWith('.png') ? 'image/png' : fichero.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': tipo }).end(readFileSync(fichero));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

const navegador = await chromium.launch();
const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];

const capturas: string[] = [];
const medidas: string[] = [];
const problemas: string[] = [];
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (a.viewport.width < 768 && ancho > a.viewport.width) problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}`);
      // Como texto: tsx añade `__name` a las funciones y en el navegador no existe.
      const m = await pagina.evaluate(`(() => {
        const alto = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
        const nombres = [...document.querySelectorAll('header a[aria-label^="Ficha de"]')].map((el) => {
          const texto = el.querySelector('span') ?? el;
          const lh = parseFloat(getComputedStyle(texto).lineHeight) || 1;
          return alto(el) + 'px/' + Math.round(texto.getBoundingClientRect().height / lh) + 'l';
        });
        const otro = [...document.querySelectorAll('a')].find((x) => x.textContent.includes('Elegir otro rival'));
        const input = document.querySelector('#h2h-q');
        let corta = null;
        if (input) {
          const c = document.createElement('canvas').getContext('2d');
          const s = getComputedStyle(input);
          c.font = s.fontSize + ' ' + s.fontFamily;
          corta = c.measureText(input.placeholder).width > input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
        }
        const paises = [...document.querySelectorAll('ul li a')].slice(0, 1).map((x) => /ESP\\s*España/.test(x.textContent) ? 'código+nombre' : 'sin repetir');
        return { nombres, otro: alto(otro), placeholder: input ? input.placeholder : null, corta, paises };
      })()`);
      medidas.push(`${p.nombre} @${a.viewport.width}: ${JSON.stringify(m)}`);
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      const alto = Math.min(p.recorte ?? total, total);
      await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
      const destino = path.join(SALIDA, `diseno-${p.nombre}-${SUFIJO}-${a.sufijo}.png`);
      await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: a.viewport.width, height: alto } });
      capturas.push(path.relative(RAIZ, destino));
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
}

console.log(capturas.join('\n'));
console.log(medidas.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
