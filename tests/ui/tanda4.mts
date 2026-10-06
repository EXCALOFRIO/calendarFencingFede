/**
 * Capturas sin servidor de la tanda de la EFC, a 393, 320 y 1440 px: la página
 * de una prueba del circuito europeo cadete (con la insignia del organizador y
 * el tipo), las dos caras de una prueba conjunta (la parte con su enlace a
 * poules y cuadro; la conjunta con sus clasificaciones oficiales), Buscar con
 * el filtro «Organizador = EFC» aplicado (el panel plegado: sin hidratación no
 * se abre) y la cara internacional de un español con
 * resultados de la EFC. El calendario ya celebrado lo pinta
 * `calendario-pasado.mts` con la misma copia.
 *
 *   PERF_DB=<copia SQLite con lote 7 de la EFC y 0013> npx tsx tests/ui/tanda4.mts
 *
 * La copia se abre en sólo lectura. Salida en `capturas/tanda4/`. Falla si algo
 * se desborda en horizontal a 393 o 320 px.
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
import { EdicionCompleta } from '@/components/explorar/ediciones';
import { CabeceraFicha } from '@/components/explorar/ficha-deportiva';
import { FormularioFiltros } from '@/components/explorar/formulario-filtros';
import { ChipsActivos, EstadoSinCoincidencias, ListaDeportistas } from '@/components/explorar/resultados';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { leerCriteriosEdicion } from '@/lib/sport/explorar/edicion-url';
import { cargarEdicion } from '@/lib/sport/explorar/ediciones-pantalla';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { leerCriterios, opcionesTemporada } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'tanda4');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const binding = bindingDeLectura(sqlite);
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

function una<T>(consulta: string, ...valores: string[]): T {
  const fila = sqlite.prepare(consulta).get(...valores) as T | undefined;
  if (!fila) throw new Error(`sin fila: ${consulta}`);
  return fila;
}

type Prueba = { prueba: string; edicion: string };
const segovia = una<Prueba>(`SELECT c.id AS prueba, c.edition_id AS edicion FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
  WHERE c.source = 'efc' AND e.city = 'Segovia' LIMIT 1`);
const tesalonica = una<Prueba>(`SELECT c.id AS prueba, c.edition_id AS edicion FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
  WHERE c.source = 'efc' AND e.city = 'Thessaloniki' AND c.format = 'INDIVIDUAL' LIMIT 1`);
const enlace = una<{ parte: string; conjunta: string }>(`SELECT part_competition_id AS parte, combined_competition_id AS conjunta
  FROM sport_competition_combined ORDER BY created_at LIMIT 1`);
const edicionDe = (prueba: string) => una<{ e: string }>(`SELECT edition_id AS e FROM sport_competition WHERE id = ?`, prueba).e;
const espanol = una<{ id: string }>(`SELECT r.person_id AS id FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
  WHERE c.source = 'efc' AND r.person_id IS NOT NULL
  ORDER BY (SELECT count(*) FROM sport_result x WHERE x.person_id = r.person_id) DESC LIMIT 1`).id;

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, marcado: string): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${marcado}</main></body></html>`;
}

function pintar(cuerpo: React.ReactElement, ruta: string): string {
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: ruta },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams('') }, cuerpo))));
}

type Pagina = { nombre: string; marcado: string; recorte?: number };
const paginas: Pagina[] = [];
const informe: string[] = [];

async function paginaEdicion(nombre: string, { prueba, edicion }: Prueba) {
  const criterios = leerCriteriosEdicion({ prueba });
  const vista = await cargarEdicion(ctx, edicion, criterios);
  if (vista.tipo !== 'ok') throw new Error(`${nombre}: ${vista.tipo}`);
  informe.push(`${nombre}: ${vista.edicion.nombre} (${vista.edicion.fuente}); conjunta: ${vista.conjunta ? (vista.conjunta.esConjunta ? `es conjunta de ${vista.conjunta.partes.length}` : 'es parte') : 'no'}`);
  paginas.push({
    nombre,
    recorte: 1400,
    marcado: pintar(React.createElement(EdicionCompleta, { edicion: vista.edicion, criterios, conjunta: vista.conjunta ?? null }), `/explorar/ediciones/${edicion}`),
  });
}

await paginaEdicion('edicion-segovia', segovia);
await paginaEdicion('edicion-tesalonica', tesalonica);
await paginaEdicion('conjunta-parte', { prueba: enlace.parte, edicion: edicionDe(enlace.parte) });
await paginaEdicion('conjunta-conjunta', { prueba: enlace.conjunta, edicion: edicionDe(enlace.conjunta) });

{
  const { criterios, cursor } = leerCriterios({ organizador: 'EFC', ambito: 'INTERNACIONAL' });
  const vista = await cargarExplorar(ctx, criterios, cursor);
  informe.push(`buscar EFC: ${vista.tipo}${vista.tipo === 'ok' ? ` ${vista.items.length} deportistas` : ''}`);
  const contenido = vista.tipo === 'ok' && !vista.sinResultados
    ? React.createElement(ListaDeportistas, { items: vista.items, siguiente: vista.siguiente, cursorActual: cursor, criterios })
    : React.createElement(EstadoSinCoincidencias, { criterios });
  const marcado = pintar(React.createElement(FormularioFiltros, {
    criterios, temporadas: opcionesTemporada('2026-12-01'), atajoEspana: true,
  }, React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
    React.createElement(ChipsActivos, { criterios }), contenido)), '/explorar');
  paginas.push({ nombre: 'buscar-organizador-efc', marcado, recorte: 1800 });
}

{
  const [vista, extras] = await Promise.all([
    cargarFichaPantalla(ctx, espanol, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    cargarExtrasPerfil(ctx, espanol),
  ]);
  if (vista.tipo !== 'ok') throw new Error(`perfil: ${vista.tipo}`);
  const chips = chipsRanking({
    nacional: extras.rankingNacional, mundial: extras.rankingMundial, resumenMundial: extras.resumenMundial,
    ambitos: extras.rankingAmbitos ?? null, olimpica: extras.olimpica,
  });
  const ambito = vista.ficha.perfil?.ambito;
  informe.push(`perfil ${vista.ficha.nombre}: internacional ${ambito?.internacional.competiciones ?? 0} pruebas, nacional ${ambito?.nacional.competiciones ?? 0}`);
  for (const [cara, nombre] of [[0, 'perfil-cabecera'], [1, 'perfil-cara-internacional']] as const) {
    paginas.push({
      nombre,
      marcado: pintar(React.createElement(CabeceraFicha, { ficha: vista.ficha, datos: extras.datos, chips, caraInicial: cara }), `/explorar/${espanol}`),
    });
  }
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });
const html = new Map(paginas.map((p) => [`/${p.nombre}`, documento(css, p.marcado)]));
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
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];

const capturas: string[] = [];
const problemas: string[] = [];
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (a.viewport.width < 768 && ancho > a.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 80)}`), a.viewport.width);
        problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}\n    ${culpables.join('\n    ')}`);
      }
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`);
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      const alto = Math.min(p.recorte ?? total, total);
      await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
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
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
