/**
 * Capturas sin servidor de la página de una prueba (v2): clasificación,
 * poules y directas con el selector de prueba, en tres ediciones reales (Copa
 * del Mundo FIE con poules y cuadro, un Mundial FIE grande con muchas pruebas y
 * un Campeonato de España con individual y equipos) y una prueba RFEE
 * publicada por partes.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/prueba-v2.mts
 *
 * Igual que `perfil-v4.mts`: la copia se abre en sólo lectura, se usa el
 * cargador de la página y se pinta con `renderToStaticMarkup` y el CSS
 * compilado. Sin hidratar, así que cada vista sale de los parámetros de la
 * dirección (`vista`, `persona`). Salida en `capturas/prueba-v2/`, a 393 y
 * 1440 px. Falla si algo desborda en horizontal a 393 px.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import { anchosCapturas, carpetaCapturas } from './pasada.mts';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { PantallaEdiciones } from '@/components/explorar/catalogo-ediciones';
import { EdicionCompleta } from '@/components/explorar/ediciones';
import { cargarCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import { leerCriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { leerCriteriosEdicion } from '@/lib/sport/explorar/edicion-url';
import { cargarEdicion, cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { leerEventoDeEdicion, urlEventoCalendario } from '@/lib/sport/explorar/enlaces-calendario';
import { crearContexto } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'prueba-v2');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

/** Copa del Mundo FIE de espada masculina con poules y cuadro. */
const COPA = process.env.EDICION_COPA ?? 'a8f16016-15ed-4f33-b5c6-beb73548a37c';
/** Mundial júnior y cadete FIE: muchas pruebas (arma, género, categoría, formato). */
const MUNDIAL = process.env.EDICION_MUNDIAL ?? 'afb32a95-23a5-4ba1-8163-1968a36c73d8';
/** Campeonato de España Absoluto (Engarde), individual y equipos. */
const ESPANA = process.env.EDICION_ESPANA ?? 'ff0a8a38-fdc2-4124-97df-caaaa66fe711';
/** TNR RFEE con clasificación, poules y cuadro en PDFs separados. */
const PARTES = process.env.EDICION_PARTES ?? '0ac84162-699e-4f8c-ab2a-2d5c27181c90';

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const tiempos: { pantalla: string; ms: number; consultas: number }[] = [];
let consultas = 0;

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  throw new TypeError(`valor no admitido: ${typeof v}`);
}

function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => D1QueryResult<unknown> } {
  const ejecutar = (): D1QueryResult<unknown> => {
    consultas += 1;
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
const ctx = { ...crearContexto().ctx, db: createD1Database(binding) };

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

function documento(css: string, cuerpo: React.ReactElement): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(cuerpo)}</main></body></html>`;
}

async function pagina(nombre: string, edicionId: string, consulta: Record<string, string> = {}) {
  const criterios = leerCriteriosEdicion(consulta);
  const antes = consultas;
  const t = performance.now();
  const vista = await cargarEdicion(ctx, edicionId, criterios);
  tiempos.push({ pantalla: nombre, ms: Math.round(performance.now() - t), consultas: consultas - antes });
  if (vista.tipo !== 'ok') throw new Error(`${nombre}: ${vista.tipo}`);
  // El enlace al torneo del calendario, como en la página (`enlaces-calendario.ts`).
  const evento = await leerEventoDeEdicion(ctx.db, edicionId);
  const calendario = evento ? urlEventoCalendario(evento, criterios.origen) : null;
  return { vista, html: (css: string) => documento(css, React.createElement(EdicionCompleta, { edicion: vista.edicion, criterios, calendario })) };
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

type Pagina = { nombre: string; html: string; resaltar?: boolean };
const paginas: Pagina[] = [];

// Copa del Mundo: las tres vistas, y las directas con el ganador resaltado
// (la ventana llega a cuartos, semis y final y no puede avanzar más).
const copa = await pagina('copa', COPA);
paginas.push({ nombre: 'copa-clasificacion', html: copa.html(css) });
const elegidaCopa = copa.vista.edicion.pruebaElegida ?? '';
paginas.push({ nombre: 'copa-poules', html: (await pagina('copa poules', COPA, { prueba: elegidaCopa, vista: 'poules' })).html(css) });
paginas.push({ nombre: 'copa-directas', html: (await pagina('copa directas', COPA, { prueba: elegidaCopa, vista: 'directas' })).html(css) });
const ganador = copa.vista.edicion.clasificacion?.filas.find((f) => f.personaId)?.personaId;
const quinto = copa.vista.edicion.clasificacion?.filas.filter((f) => f.personaId)[6]?.personaId;
if (ganador) {
  paginas.push({
    nombre: 'copa-directas-final',
    resaltar: true,
    html: (await pagina('copa directas ganador', COPA, { prueba: elegidaCopa, vista: 'directas', persona: ganador })).html(css),
  });
}
if (quinto) {
  paginas.push({
    nombre: 'copa-persona-poules',
    resaltar: true,
    html: (await pagina('copa poules persona', COPA, { prueba: elegidaCopa, vista: 'poules', persona: quinto })).html(css),
  });
  paginas.push({
    nombre: 'copa-persona-clasificacion',
    resaltar: true,
    html: (await pagina('copa clasificación persona', COPA, { prueba: elegidaCopa, persona: quinto })).html(css),
  });
}
const equiposCopa = copa.vista.edicion.pruebasDetalle.find((p) => p.formato === 'EQUIPOS');
if (equiposCopa) {
  paginas.push({ nombre: 'copa-equipos-directas', html: (await pagina('copa equipos', COPA, { prueba: equiposCopa.id, vista: 'directas' })).html(css) });
}

// Mundial: selector con varias dimensiones.
const mundial = await pagina('mundial', MUNDIAL);
paginas.push({ nombre: 'mundial-clasificacion', html: mundial.html(css) });
paginas.push({
  nombre: 'mundial-directas',
  html: (await pagina('mundial directas', MUNDIAL, { prueba: mundial.vista.edicion.pruebaElegida ?? '', vista: 'directas' })).html(css),
});

// Campeonato de España: individual y equipos.
const espana = await pagina('españa', ESPANA);
paginas.push({ nombre: 'espana-clasificacion', html: espana.html(css) });
const elegidaEspana = espana.vista.edicion.pruebaElegida ?? '';
paginas.push({ nombre: 'espana-poules', html: (await pagina('españa poules', ESPANA, { prueba: elegidaEspana, vista: 'poules' })).html(css) });
paginas.push({ nombre: 'espana-directas', html: (await pagina('españa directas', ESPANA, { prueba: elegidaEspana, vista: 'directas' })).html(css) });
const equiposEspana = espana.vista.edicion.pruebasDetalle.find((p) => p.formato === 'EQUIPOS');
if (equiposEspana) {
  paginas.push({ nombre: 'espana-equipos', html: (await pagina('españa equipos', ESPANA, { prueba: equiposEspana.id })).html(css) });
}

// Prueba RFEE por partes: una sola prueba con clasificación, poules y cuadro.
const partes = await pagina('partes', PARTES);
paginas.push({ nombre: 'partes-clasificacion', html: partes.html(css) });
paginas.push({
  nombre: 'partes-poules',
  html: (await pagina('partes poules', PARTES, { prueba: partes.vista.edicion.pruebaElegida ?? '', vista: 'poules' })).html(css),
});
console.log(
  'partes:',
  partes.vista.edicion.pruebasDetalle.map((p) => `${p.arma}/${p.genero}/${p.fecha} miembros=${p.miembros?.length} puestos=${p.resultados.importados} asaltos=${p.asaltos}`),
);

// Índice de ediciones: catálogo y series, sin filtros y filtrado por fuente. `SIN_CATALOGO=1` lo salta
// (la matriz sólo mide las páginas de la prueba).
for (const [nombre, consulta] of process.env.SIN_CATALOGO === '1' ? [] : ([['ediciones', {}], ['ediciones-fie', { fuente: 'fie' }]] as const)) {
  const { criterios, cursor } = leerCriteriosCatalogo(consulta);
  const entrada = Object.fromEntries(Object.entries(criterios).filter(([, v]) => v));
  const antes = consultas;
  const t = performance.now();
  const [series, catalogo] = await Promise.all([cargarSeries(ctx), cargarCatalogoEdiciones(ctx, entrada)]);
  tiempos.push({ pantalla: nombre, ms: Math.round(performance.now() - t), consultas: consultas - antes });
  paginas.push({
    nombre,
    html: documento(css, React.createElement(PantallaEdiciones, { catalogo, criterios, cursor, series })),
  });
}

const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const servidor = createServer((pet, res) => {
  const ruta = decodeURIComponent(new URL(pet.url ?? '/', 'http://x').pathname);
  const contenido = html.get(ruta);
  if (contenido) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(contenido);
    return;
  }
  const fichero = path.join(RAIZ, 'public', path.normalize(ruta).replace(/^([/\\])+/, ''));
  if (!fichero.startsWith(path.join(RAIZ, 'public')) || !existsSync(fichero)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': fichero.endsWith('.png') ? 'image/png' : 'application/octet-stream' }).end(readFileSync(fichero));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

const navegador = await chromium.launch();
const anchos = anchosCapturas([
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
]);

const capturas: string[] = [];
const desbordes: string[] = [];
for (const p of paginas) {
  for (const a of anchos) {
    const pag = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    await pag.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
    await pag.evaluate(() => document.fonts.ready);
    const desborde = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (desborde > 0) {
      const culpables = await pag.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
      );
      desbordes.push(`${p.nombre} @${a.sufijo}: ${desborde}px → ${culpables.join(' | ')}`);
    }
    const base = path.join(SALIDA, `${p.nombre}-${a.sufijo}`);
    await pag.screenshot({ path: `${base}.png` });
    capturas.push(path.relative(RAIZ, `${base}.png`));
    if (p.resaltar) {
      await pag.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('[data-resaltado="true"]')].find((x) => x.getClientRects().length > 0);
        el?.scrollIntoView({ block: 'center' });
      });
      await pag.screenshot({ path: `${base}-resaltado.png` });
      capturas.push(path.relative(RAIZ, `${base}-resaltado.png`));
    } else {
      // Un segundo pantallazo más abajo: el contenido de la vista.
      await pag.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 0.8)));
      await pag.screenshot({ path: `${base}-abajo.png` });
      capturas.push(path.relative(RAIZ, `${base}-abajo.png`));
    }
    await pag.close();
  }
}
await navegador.close();
servidor.close();

console.table(tiempos);
console.log(capturas.join('\n'));
if (desbordes.length > 0) {
  console.error(`Desborde horizontal:\n${desbordes.join('\n')}`);
  process.exitCode = 1;
}
