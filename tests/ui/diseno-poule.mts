/**
 * Capturas y medidas del arreglo de diseño de la poule y del buscador: la
 * matriz de la poule abierta a pantalla completa (7 tiradores y la mayor de la
 * prueba), la lista de poules de móvil, la clasificación de equipos de un
 * Campeonato de España y la lista de «Buscar» con el botón «Seguir».
 *
 *   $env:PERF_DB=<copia SQLite de D1>; $env:FASE='antes'
 *   npx tsx tests/ui/diseno-poule.mts
 *
 * Igual que `tanda1.mts`: base en sólo lectura, `renderToStaticMarkup` con el
 * CSS compilado y un servidor `node:http` en un puerto efímero. Salida en
 * `capturas/diseno-poule/<FASE>/` con `medidas.json`, a 320, 393 y 1440 px.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { EdicionCompleta } from '@/components/explorar/ediciones';
import { PoulesDePrueba } from '@/components/explorar/asaltos-prueba';
import { BotonIcono } from '@/components/sistema/boton';
import { X } from 'lucide-react';
import { enlaceFichaDePrueba } from '@/components/explorar/prueba/enlaces';
import { ListaDeportistas } from '@/components/explorar/resultados';
import { leerCriteriosEdicion } from '@/lib/sport/explorar/edicion-url';
import { cargarEdicion } from '@/lib/sport/explorar/ediciones-pantalla';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { leerCriterios } from '@/lib/sport/explorar/url';
import type { PouleDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { ES_MOVIL } from './pasada.mts';
import { crearContexto, perfil } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'diseno-poule', process.env.FASE ?? 'despues');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = '8bf5062e-5677-4540-b2bc-1ae911cda424';
/** Campeonato de España Absoluto 2024: poule de 7 con Zabala. */
const PRUEBA = '058e6244';
/** Campeonato de España Absoluto 2017, con equipos de nombre en código. */
const ESPANA = 'ff0a8a38-fdc2-4124-97df-caaaa66fe711';
const CUENTA = '00000000-0000-4000-8000-0000000000a1';

const sqlite = new DatabaseSync(BASE, { readOnly: true });
sqlite.exec('CREATE TEMP TABLE sport_favorite (profile_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at INTEGER NOT NULL)');
const tieneIndice = Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'explorar_indice_estado'").get());

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
  indiceExplorar: async () => tieneIndice,
};

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
const poules = edicion.edicion.asaltos?.poules ?? [];
const poulePropia = poules.find((p) => p.filas.some((f) => f.personaId === ZABALA));
if (!poulePropia) throw new Error('Zabala no está en ninguna poule de la prueba');
/** Ninguna poule de la prueba pasa de 7: una de 9 con tiradores reales y tantos inventados para el caso ancho. */
const nueve = poules.flatMap((p) => p.filas).slice(0, 9);
const pouleMayor: PouleDePrueba = {
  ronda: 'P9',
  etiqueta: 'Poule de 9 (sintética)',
  filas: nueve.map((f, i) => {
    const celdas = nueve.map((_, j) => (i === j ? null : i < j ? { tantos: 5, victoria: true } : { tantos: (i + j) % 5, victoria: false }));
    const tocados = celdas.reduce((s, c) => s + (c?.tantos ?? 0), 0);
    const recibidos = nueve.reduce((s, _, j) => s + (i === j ? 0 : j < i ? 5 : (i + j) % 5), 0);
    return { ...f, clave: `s${i}`, celdas, victorias: celdas.filter((c) => c?.victoria).length, asaltos: 8, tocados, recibidos };
  }),
};
const paginaPrueba = React.createElement(EdicionCompleta, { edicion: edicion.edicion, criterios: criteriosPrueba });
const enlace = enlaceFichaDePrueba(fila.edicion, { prueba: fila.id, cursor: '' }, 'poules');

/** La superficie de `SheetContent side="bottom"` abierta, con el velo debajo. */
function hoja(poule: PouleDePrueba) {
  return React.createElement(
    React.Fragment,
    null,
    paginaPrueba,
    React.createElement('div', { className: 'fixed inset-0 z-50 bg-velo' }),
    React.createElement(
      'div',
      { role: 'dialog', className: 'fixed inset-0 z-50 flex h-dvh max-h-dvh flex-col gap-0 overscroll-contain bg-popover' },
      React.createElement(
        'div',
        { className: 'flex h-[52px] shrink-0 flex-row items-center gap-2 border-b pr-[8px] pl-3' },
        React.createElement('h2', { className: 'min-w-0 truncate text-[16px] leading-[20px] font-semibold text-foreground' }, poule.etiqueta),
        React.createElement('span', { className: 'text-xs text-muted-foreground' }, poule.filas.length),
        React.createElement(BotonIcono, { etiqueta: 'Cerrar', tamano: 'md', className: 'ml-auto' }, React.createElement(X, { 'aria-hidden': true })),
      ),
      React.createElement(PoulesDePrueba, { poules: [poule], enlace, filtro: { consulta: '', persona: ZABALA }, caraInicial: 'asaltos' }),
    ),
  );
}

const espana = await cargarEdicion(ctx, ESPANA, leerCriteriosEdicion({}));
if (espana.tipo !== 'ok') throw new Error(`españa: ${espana.tipo}`);
const equipos = espana.edicion.pruebasDetalle.find((p) => p.formato === 'EQUIPOS');
if (!equipos) throw new Error('el Campeonato de España no tiene equipos');
const criteriosEquipos = leerCriteriosEdicion({ prueba: equipos.id });
const vistaEquipos = await cargarEdicion(ctx, ESPANA, criteriosEquipos);
if (vistaEquipos.tipo !== 'ok') throw new Error(`equipos: ${vistaEquipos.tipo}`);

const { criterios: criteriosBuscar } = leerCriterios({ q: 'alejandro' });
const buscar = await cargarExplorar(ctx, criteriosBuscar, undefined);
if (buscar.tipo !== 'ok') throw new Error(`buscar: ${buscar.tipo}`);
const listaBuscar = React.createElement(
  'div',
  { className: 'flex min-w-0 flex-col gap-3' },
  React.createElement(ListaDeportistas, { items: buscar.items, siguiente: buscar.siguiente, cursorActual: undefined, criterios: criteriosBuscar }),
);

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const paginas: { nombre: string; tipo: 'hoja' | 'lista' | 'equipos' | 'buscar'; html: string }[] = [
  { nombre: `hoja-${poulePropia.filas.length}`, tipo: 'hoja', html: documento(css, hoja(poulePropia)) },
  ...(pouleMayor.filas.length > poulePropia.filas.length
    ? [{ nombre: `hoja-${pouleMayor.filas.length}`, tipo: 'hoja' as const, html: documento(css, hoja(pouleMayor)) }]
    : []),
  { nombre: 'poules-lista', tipo: 'lista', html: documento(css, paginaPrueba) },
  { nombre: 'equipos', tipo: 'equipos', html: documento(css, React.createElement(EdicionCompleta, { edicion: vistaEquipos.edicion, criterios: criteriosEquipos })) },
  { nombre: 'buscar', tipo: 'buscar', html: documento(css, listaBuscar) },
];

const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const servidor = createServer((pet, res) => {
  const ruta = decodeURIComponent(new URL(pet.url ?? '/', 'http://x').pathname);
  if (/^\/banderas\/[a-z]{2}\.png$/.test(ruta)) {
    res.writeHead(200, { 'content-type': 'image/png' }).end(readFileSync(path.join(RAIZ, 'public', ruta)));
    return;
  }
  const contenido = html.get(ruta);
  if (contenido) res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(contenido);
  else res.writeHead(404).end();
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

// Se ejecuta en el navegador: no puede usar nada de fuera de la función.
function medir(tipo: string) {
  const vw = window.innerWidth;
  const caja = (el: Element) => el.getBoundingClientRect();
  const visible = (el: Element) => {
    const r = caja(el);
    return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  };
  const alturas = (els: Element[]) => {
    const h = els.filter(visible).map((e) => Math.round(caja(e).height));
    return h.length ? { n: h.length, min: Math.min(...h), max: Math.max(...h) } : { n: 0 };
  };
  const salida: Record<string, unknown> = { desborde: document.documentElement.scrollWidth - vw };
  if (tipo === 'hoja') {
    const cont = document.querySelector('[data-matriz-poule]') as HTMLElement;
    const tabla = cont.querySelector('table')!;
    const limite = caja(cont);
    salida.tabla = Math.round(caja(tabla).width);
    salida.contenedor = Math.round(limite.width);
    salida.desplazable = cont.scrollWidth > cont.clientWidth + 1;
    const totales: Record<string, boolean> = {};
    for (const abbr of cont.querySelectorAll('thead abbr')) {
      const r = caja(abbr.closest('th')!);
      totales[abbr.textContent ?? '?'] = r.left >= limite.left - 1 && r.right <= limite.right + 1;
    }
    salida.totalesVisibles = totales;
    // La última columna de rivales, para ver si hay que desplazar para llegar a ella.
    const rivales = [...cont.querySelectorAll('thead th')].filter((th) => /^\s*Contra el/.test(th.textContent ?? ''));
    const ultima = rivales.at(-1);
    salida.ultimoRivalVisible = ultima ? caja(ultima).right <= limite.right + 1 : null;
    salida.enlaces = alturas([...cont.querySelectorAll('tbody a')]);
    salida.filas = alturas([...cont.querySelectorAll('tbody tr')]);
    salida.columnaNombre = Math.round(caja(cont.querySelector('tbody th')!).width);
  } else if (tipo === 'lista') {
    const listas = [...document.querySelectorAll('ol.divide-y')].filter(visible);
    salida.enlaces = alturas(listas.flatMap((l) => [...l.querySelectorAll('a')]));
    salida.filas = alturas(listas.flatMap((l) => [...l.querySelectorAll(':scope > li')]));
    const tablas = [...document.querySelectorAll('section table')].filter(visible);
    salida.enlacesTabla = alturas(tablas.flatMap((t) => [...t.querySelectorAll('tbody a')]));
    salida.filasTabla = alturas(tablas.flatMap((t) => [...t.querySelectorAll('tbody tr')]));
  } else if (tipo === 'equipos') {
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const filas = [...document.querySelectorAll('ol[aria-label="Clasificación"] > li')];
    let repetidos = 0;
    for (const li of filas) {
      const nombre = li.querySelector('.font-medium, .font-semibold')?.textContent ?? '';
      const sub = [...li.querySelectorAll('.text-xs span')].map((s) => s.textContent ?? '');
      if (sub.some((s) => norm(s) === norm(nombre))) repetidos++;
    }
    salida.filas = filas.length;
    salida.subtitulosRepetidos = repetidos;
  } else if (tipo === 'buscar') {
    const botones = [...document.querySelectorAll('button[data-estado]')].filter(visible);
    const anchos = botones.map((b) => Math.round(caja(b).width));
    const altos = botones.map((b) => Math.round(caja(b).height));
    salida.seguir = { n: botones.length, anchoMin: Math.min(...anchos), anchoMax: Math.max(...anchos), alto: Math.min(...altos), etiqueta: botones[0]?.getAttribute('aria-label') };
    const nombres = [...document.querySelectorAll('a[data-persona] .truncate.font-semibold')].filter(visible).slice(0, 12) as HTMLElement[];
    salida.nombresTruncados = `${nombres.filter((n) => n.scrollWidth > n.clientWidth + 1).length}/${nombres.length}`;
    salida.anchoNombre = Math.round(Math.min(...nombres.map((n) => caja(n).width)));
    salida.codigosPaisVisibles = [...document.querySelectorAll('a[data-persona] abbr')].filter(visible).length;
  }
  return salida;
}

const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
const medidas: Record<string, unknown> = {};
const desbordes: string[] = [];
const navegador = await chromium.launch();
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pag = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      // tsx envuelve las funciones con `__name` y `medir` viaja al navegador tal cual.
      await pag.addInitScript('window.__name = (f) => f');
      await pag.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pag.evaluate(() => document.fonts.ready);
      if (p.tipo === 'lista') {
        await pag.evaluate(() => document.querySelector('[data-resaltado="true"]')?.scrollIntoView({ block: 'center' }));
      }
      const m = await pag.evaluate(medir, p.tipo);
      medidas[`${p.nombre}-${a.sufijo}`] = m;
      if (ES_MOVIL(a.viewport.width) && (m.desborde as number) > 0) desbordes.push(`${p.nombre}@${a.sufijo}: ${m.desborde}`);
      await pag.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`) });
      await pag.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
}

writeFileSync(path.join(SALIDA, 'medidas.json'), `${JSON.stringify(medidas, null, 1)}\n`);
console.log(JSON.stringify(medidas, null, 1));
if (desbordes.length > 0) {
  console.error(`Desborde horizontal en móvil:\n${desbordes.join('\n')}`);
  process.exitCode = 1;
}
