/**
 * Capturas sin servidor del perfil por secciones a 320, 393 y 1440 px con
 * datos reales: Llavador, Zabala, Ramírez Larena, una persona sólo EFC y una
 * sólo RFEE. Falla si algo se desborda en horizontal.
 *
 *   $env:PERF_DB=<copia SQLite de D1>
 *   $env:FASE=antes | despues
 *   npx tsx tests/ui/perfil-secciones.mts
 *
 * `antes` pinta la ficha de siempre (todas las pestañas en el HTML y el
 * rendimiento aparte); `despues`, la cabecera compacta con las pestañas y una
 * sección cada vez. Salida en `capturas/perfil-secciones/<FASE>/`.
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
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
const FASE = process.env.FASE ?? 'despues';
const SALIDA = path.join(RAIZ, 'capturas', 'perfil-secciones', process.env.SALIDA_SUB ?? FASE);
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const binding = bindingDeLectura(sqlite);
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

const SOLO = process.env.SOLO?.split(',');
const PERSONAS: [string, string][] = ([
  ['llavador', 'b40372bf-0b56-4faf-a603-4e0b7f351739'],
  ['zabala', '8bf5062e-5677-4540-b2bc-1ae911cda424'],
  ['ramirez', '58671832-da43-4fc9-bafa-4354747a347e'],
  ['solo-efc', 'a9f13ae8-cd72-4c93-924d-f169fdb63ebd'],
  ['solo-rfee', '3cf0939d-9d9b-4754-8777-1e443fea1f47'],
] as [string, string][]).filter(([clave]) => !SOLO || SOLO.includes(clave));

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

/** Sin `LayoutRouterContext` el segmento activo es `null`: la pestaña la fija `activa`. */
function documento(css: string, cuerpo: React.ReactElement, ruta: string, _segmento: string | null = null): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams() }, cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

type Pagina = { nombre: string; html: string; recorte?: number };
const paginas: Pagina[] = [];
const informe: string[] = [];
const css = await compilarCss();

for (const [clave, id] of PERSONAS) {
  const base = `${RUTA_EXPLORAR}/${id}`;
  const [vista, extras] = await Promise.all([
    cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: FASE !== 'antes' }),
    cargarExtrasPerfil(ctx, id),
  ]);
  if (vista.tipo !== 'ok') throw new Error(`${clave}: ${vista.tipo}`);
  const chips = chipsRanking({
    nacional: extras.rankingNacional, mundial: extras.rankingMundial, resumenMundial: extras.resumenMundial,
    ambitos: extras.rankingAmbitos ?? null, olimpica: extras.olimpica,
  });
  if (FASE === 'antes') {
    const { FichaCompleta } = await import('@/components/explorar/ficha-deportiva');
    const { SeccionRendimiento } = await import('@/components/explorar/graficos/seccion-rendimiento');
    paginas.push({
      nombre: `${clave}-perfil`, recorte: 9000,
      html: documento(css, React.createElement(FichaCompleta, {
        ficha: vista.ficha, historial: vista.historial, base, criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina', extras,
      }), base),
    });
    if (extras.rendimiento) {
      paginas.push({
        nombre: `${clave}-rendimiento`, recorte: 9000,
        html: documento(css, React.createElement(SeccionRendimiento, { datos: extras.rendimiento, nivel: 'pagina', tituloOculto: true }), base),
      });
    }
    continue;
  }
  const secciones = await import('@/components/explorar/perfil/secciones-perfil');
  const datos = await import('@/lib/sport/explorar/perfil-diferido');
  const cabecera = (seccion: string) => React.createElement(secciones.CabeceraPerfil, {
    ficha: vista.ficha, datos: extras.datos, chips, extras, activa: seccion as never,
    acciones: React.createElement('button', { type: 'button' }, React.createElement('span', { className: 'inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm' }, 'Seguir')),
  });
  informe.push(`${clave}: pestañas ${secciones.seccionesDisponibles(vista.ficha, extras).join(', ')}`);
  const [rendimiento, rivales, curiosidades, europeo, relevos] = await Promise.all([
    datos.cargarRendimientoPerfil(ctx, id),
    datos.cargarRivalesPerfil(ctx, id),
    datos.cargarCuriosidadesPerfil(ctx, id),
    datos.cargarEuropeoPerfil(ctx, id),
    datos.cargarRelevosPerfil(ctx, id),
  ]);
  const contenido: Record<string, React.ReactElement> = {
    resultados: React.createElement(secciones.SeccionResultados, { ficha: vista.ficha, historial: vista.historial, base, criterios: CRITERIOS_FICHA_VACIOS }),
    estadisticas: React.createElement(secciones.SeccionEstadisticas, { rendimiento, ficha: vista.ficha }),
    rivales: React.createElement(secciones.SeccionRivales, { personaId: id, datos: rivales, relevos }),
    curiosidades: React.createElement(secciones.SeccionCuriosidades, { personaId: id, stats: curiosidades }),
    ranking: React.createElement(secciones.SeccionRanking, { extras, europeo }),
  };
  for (const [seccion, cuerpo] of Object.entries(contenido)) {
    const segmento = seccion === 'resultados' ? null : seccion;
    paginas.push({
      nombre: `${clave}-${seccion}`, recorte: 9000,
      html: documento(css, React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' }, cabecera(seccion),
        React.createElement(secciones.CuerpoSeccion, null, cuerpo)), segmento ? `${base}/${segmento}` : base, segmento),
    });
  }
  informe.push(`${clave}: categorías ${rendimiento?.vistas.todo.porCategoria.map((c) => `${c.clave} mejor ${c.mejor ?? '—'}`).join(', ') ?? 'sin rendimiento'}`);
}

mkdirSync(SALIDA, { recursive: true });
const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const servidor = createServer((pet, res) => {
  const url = new URL(pet.url ?? '/', 'http://x');
  const pagina = html.get(decodeURIComponent(url.pathname));
  if (pagina) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina);
    return;
  }
  const fichero = path.join(RAIZ, 'public', path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
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
const problemas: string[] = [];
let n = 0;
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'load' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (ancho > a.viewport.width) problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}`);
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      if (a.sufijo === '393') informe.push(`  ${p.nombre}: alto ${total} px`);
      const alto = Math.min(p.recorte ?? total, total);
      await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
      await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`), clip: { x: 0, y: 0, width: a.viewport.width, height: alto } });
      n += 1;
      // Los paneles Internacional y Nacional del rendimiento, que sólo se ven al elegirlos.
      for (const ambito of ['internacional', 'nacional']) {
        const radio = pagina.locator(`label:visible:has(input[type=radio][value=${ambito}])`).first();
        if (a.sufijo !== '393' || (await radio.count()) === 0) continue;
        await radio.click();
        const t = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
        const h = Math.min(p.recorte ?? t, t);
        await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, h) });
        await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${ambito}-${a.sufijo}.png`), clip: { x: 0, y: 0, width: a.viewport.width, height: h } });
        n += 1;
      }
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
}
console.log(`${n} capturas en ${path.relative(RAIZ, SALIDA)}`);
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
