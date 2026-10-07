/**
 * Capturas sin servidor de la tanda 1: poules de una prueba con la matriz de
 * móvil abierta, cara a cara (asaltos directos, gráfica de puestos) y la lista
 * de rivales con su barra de victorias.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/tanda1.mts
 *
 * Como los demás arneses: copia en sólo lectura, cargadores de la página y
 * `renderToStaticMarkup` con el CSS compilado. Sin hidratar, la hoja de la
 * poule no se puede abrir con un toque: se pinta abierta reproduciendo la
 * superficie de `SheetContent` (fija, a pantalla completa) con `MatrizPoule`
 * dentro. Salida en `capturas/tanda1/`, a 320, 393 y 1440 px. Falla si la
 * página desborda en horizontal en móvil.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { CabeceraCaraACara, CaraACaraCompleto, ElegirRival } from '@/components/explorar/cara-a-cara';
import { EdicionCompleta } from '@/components/explorar/ediciones';
import { FiltrosCaraACara } from '@/components/explorar/filtros-cara-a-cara';
import { SeccionRendimientoCaraACara } from '@/components/explorar/graficos/seccion-rendimiento-cara-a-cara';
import { MatrizPoule } from '@/components/explorar/prueba/hoja-poule';
import { enlaceFichaDePrueba } from '@/components/explorar/prueba/enlaces';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { leerCriteriosCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { leerCriteriosEdicion } from '@/lib/sport/explorar/edicion-url';
import { cargarEdicion } from '@/lib/sport/explorar/ediciones-pantalla';
import { ES_MOVIL } from './pasada.mts';
import { crearContexto } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'tanda1');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = process.env.PERSONA_A ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RAMIREZ = process.env.PERSONA_B ?? '58671832-da43-4fc9-bafa-4354747a347e';
/** Campeonato de España Absoluto 2024: Zabala y Ramírez Larena en la misma poule. */
const PRUEBA = process.env.PRUEBA ?? '058e6244';

const sqlite = new DatabaseSync(BASE, { readOnly: true });

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
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
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(
    React.createElement(AppRouterContext.Provider, { value: {} as never }, cuerpo),
  )}</main></body></html>`;
}

const fila = sqlite
  .prepare(`SELECT c.id AS id, c.edition_id AS edicion FROM sport_competition c WHERE c.id LIKE ? LIMIT 1`)
  .get(`${PRUEBA}%`) as { id: string; edicion: string } | undefined;
if (!fila) throw new Error(`no está la prueba ${PRUEBA}`);

const criteriosPrueba = leerCriteriosEdicion({ prueba: fila.id, vista: 'poules', persona: ZABALA });
const edicion = await cargarEdicion(ctx, fila.edicion, criteriosPrueba);
if (edicion.tipo !== 'ok') throw new Error(`prueba: ${edicion.tipo}`);
const poulePropia = edicion.edicion.asaltos?.poules.find((p) => p.filas.some((f) => f.personaId === ZABALA));
if (!poulePropia) throw new Error('Zabala no está en ninguna poule de la prueba');
const paginaPrueba = React.createElement(EdicionCompleta, { edicion: edicion.edicion, criterios: criteriosPrueba });
const enlace = enlaceFichaDePrueba(fila.edicion, { prueba: fila.id, cursor: '' }, 'poules');
// La superficie de `SheetContent side="bottom"` abierta, con el velo debajo.
const hoja = React.createElement(
  React.Fragment,
  null,
  paginaPrueba,
  React.createElement('div', { className: 'fixed inset-0 z-50 bg-velo' }),
  React.createElement(
    'div',
    { role: 'dialog', className: 'fixed inset-0 z-50 flex h-dvh max-h-dvh flex-col gap-0 overscroll-contain bg-popover' },
    React.createElement(
      'div',
      { className: 'flex flex-row items-center gap-2 border-b py-3 pr-16 pl-3' },
      React.createElement('h2', { className: 'min-w-0 truncate text-lg leading-tight font-semibold text-foreground' }, poulePropia.etiqueta),
      React.createElement('span', { className: 'text-xs text-muted-foreground' }, poulePropia.filas.length),
    ),
    React.createElement(MatrizPoule, { poule: poulePropia, enlace, filtro: { consulta: '', persona: ZABALA } }),
    React.createElement(
      'span',
      { className: 'cerrar-hoja absolute top-3.5 right-3.5 grid size-10 place-items-center rounded-full border border-filete-alto bg-accent text-foreground' },
      '✕',
    ),
  ),
);

async function caraACara(consulta: Record<string, string>) {
  const criterios = leerCriteriosCaraACara(consulta);
  const vista = await cargarCaraACaraPantalla(ctx, ZABALA, criterios);
  if (vista.tipo === 'elegir') {
    return React.createElement('div', { className: 'flex flex-col gap-6' },
      React.createElement('h1', { className: 'text-2xl break-words sm:text-3xl' }, 'Cara a cara de Juan Zabala'),
      React.createElement(FiltrosCaraACara, { personaId: vista.persona.id, criterios, temporadas: [] }),
      React.createElement(ElegirRival, { persona: vista.persona, rivales: vista.rivales, otros: vista.otros, criterios }));
  }
  if (vista.tipo !== 'ok') throw new Error(`cara a cara: ${vista.tipo}`);
  return React.createElement('div', { className: 'mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4' },
    React.createElement(CabeceraCaraACara, { datos: vista.datos, criterios }),
    React.createElement(CaraACaraCompleto, {
      datos: vista.datos, criterios,
      rendimiento: vista.rendimiento
        ? React.createElement(SeccionRendimientoCaraACara, { datos: vista.rendimiento, yo: vista.datos.personas.yo, rival: vista.datos.personas.rival, titulo: 'Evolución', sinResumen: true })
        : null,
    }));
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const paginas: { nombre: string; html: string; bajar?: string }[] = [
  { nombre: 'prueba-poules', html: documento(css, paginaPrueba), bajar: '[data-resaltado="true"]' },
  { nombre: 'prueba-hoja-abierta', html: documento(css, hoja) },
  { nombre: 'cara-a-cara', html: documento(css, await caraACara({ rival: RAMIREZ })) },
  { nombre: 'cara-a-cara-asaltos', html: documento(css, await caraACara({ rival: RAMIREZ })), bajar: '#h2h-asaltos' },
  { nombre: 'cara-a-cara-puestos', html: documento(css, await caraACara({ rival: RAMIREZ })), bajar: '[aria-label^="Puestos en"]' },
  { nombre: 'rivales', html: documento(css, await caraACara({})) },
  // Un enlace antiguo con temporada: se ignora y la lista sale entera.
  { nombre: 'rivales-temporada-antigua', html: documento(css, await caraACara({ temporada: '2023-2024' })) },
];

const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const PUBLICO = path.join(RAIZ, 'public');
const servidor = createServer((pet, res) => {
  const ruta = decodeURIComponent(new URL(pet.url ?? '/', 'http://x').pathname);
  const contenido = html.get(ruta);
  if (contenido) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(contenido);
    return;
  }
  // Las banderas y los iconos son ficheros estáticos de `public/`, como en producción.
  const fichero = path.join(PUBLICO, path.normalize(ruta).replace(/^([/\\])+/, ''));
  if (fichero.startsWith(PUBLICO) && existsSync(fichero) && statSync(fichero).isFile()) {
    const tipo = fichero.endsWith('.png') ? 'image/png' : fichero.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': tipo }).end(readFileSync(fichero));
  } else {
    res.writeHead(404).end();
  }
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
const capturas: string[] = [];
const desbordes: string[] = [];
const navegador = await chromium.launch();
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pag = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pag.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pag.evaluate(() => document.fonts.ready);
      const ancho = await pag.evaluate(() => document.documentElement.scrollWidth);
      if (ES_MOVIL(a.viewport.width) && ancho > a.viewport.width) desbordes.push(`${p.nombre}@${a.sufijo}: ${ancho}`);
      if (p.bajar) {
        await pag.evaluate((sel) => {
          const el = [...document.querySelectorAll<HTMLElement>(sel)].find((x) => x.getClientRects().length > 0);
          el?.scrollIntoView({ block: 'center' });
        }, p.bajar);
      }
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`);
      await pag.screenshot({ path: destino });
      capturas.push(path.relative(RAIZ, destino));
      await pag.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
}

console.log(capturas.join('\n'));
if (desbordes.length > 0) {
  console.error(`Desborde horizontal en móvil:\n${desbordes.join('\n')}`);
  process.exitCode = 1;
}
