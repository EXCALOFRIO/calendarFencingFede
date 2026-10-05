/**
 * Capturas sin servidor de la ficha (pestañas Resultados con etiquetas,
 * Temporadas con Internacional/Nacional, Rivales con curiosidades) y del feed
 * «Siguiendo», con datos reales.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/perfil-v3.mts
 *
 * Igual que `perfil-v2.mts`: la base se abre en sólo lectura, se usan los
 * cargadores de las páginas y se pinta con `renderToStaticMarkup` y el CSS
 * compilado. El feed necesita personas seguidas: se crea una tabla TEMPORAL
 * `sport_favorite` (la base temporal de SQLite es de la conexión y tapa a la
 * de `main` en los nombres sin esquema), así que no se escribe nada en la copia.
 * Salida en `capturas/perfil-v3/`, a 393 y 1440 px.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { BotonFavorito } from '@/components/explorar/boton-favorito';
import { FichaCompleta, VolverAExplorar } from '@/components/explorar/ficha-deportiva';
import { CabeceraSiguiendo, EnlaceSiguiendo, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { cargarConteoSiguiendo, cargarSiguiendo, sqlDestacadosRanking } from '@/lib/sport/explorar/siguiendo-pantalla';
import type { CriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { crearContexto, perfil } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'perfil-v3');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = process.env.PERSONA_A ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RAMIREZ = process.env.PERSONA_B ?? '58671832-da43-4fc9-bafa-4354747a347e';
/** La ficha con más resultados de la copia: la que marca el tiempo. */
const PESADA = process.env.PERSONA_C ?? '513f3cc3-1eb1-4a69-868f-7ef24bef5657';
const CUENTA = '00000000-0000-4000-8000-0000000000a1';
const CUENTA_VACIA = '00000000-0000-4000-8000-0000000000b2';

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
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };
const ctxVacio = { ...crearContexto({ perfil: perfil({ profileId: CUENTA_VACIA }) }).ctx, db };

// Lista sintética de seguidas: Zabala, Ramírez Larena y los españoles mejor
// situados en el ranking FIE. Sólo en la base TEMPORAL de esta conexión.
const { sql: textoDestacados, params } = new SQLiteSyncDialect().sqlToQuery(sqlDestacadosRanking(12) as never);
const destacados = (sqlite.prepare(textoDestacados).all(...(params as SQLInputValue[])) as { id: string }[]).map((f) => f.id);
const seguidas = [...new Set([ZABALA, RAMIREZ, ...destacados])].slice(0, 12);
sqlite.exec('CREATE TEMP TABLE sport_favorite (profile_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at INTEGER NOT NULL)');
const alta = sqlite.prepare('INSERT INTO temp.sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)');
seguidas.forEach((id, i) => alta.run(CUENTA, id, 1_700_000_000_000 + i));

async function medir<T>(pantalla: string, f: () => Promise<T>): Promise<T> {
  const antes = consultas;
  const t = performance.now();
  const r = await f();
  tiempos.push({ pantalla, ms: Math.round(performance.now() - t), consultas: consultas - antes });
  return r;
}

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

async function paginaFicha(id: string) {
  const vista = await medir(`ficha ${id.slice(0, 8)}`, () => cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS));
  if (vista.tipo !== 'ok') throw new Error(`ficha ${id}: ${vista.tipo}`);
  const nombre = nombreVisible(vista.ficha.nombre) || vista.ficha.nombre;
  return React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
    React.createElement(VolverAExplorar, { volver: '' }),
    React.createElement(FichaCompleta, {
      ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${id}`,
      criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina',
      acciones: React.createElement(BotonFavorito, {
        personaId: id, nombre, inicial: id === ZABALA, lectura: {}, variante: 'perfil',
      }),
    }));
}

async function paginaFeed(c: typeof ctx, criterios: CriteriosSiguiendo, nombre: string) {
  const [vista, siguiendo] = await medir(nombre, () => Promise.all([
    cargarSiguiendo(c, { cursor: criterios.cursor || undefined, soloMedallas: criterios.soloMedallas }),
    cargarConteoSiguiendo(c),
  ]));
  if (vista.tipo === 'sin_sesion') throw new Error('sin sesión');
  return {
    vista,
    elemento: React.createElement('div', { className: 'flex min-w-0 flex-col gap-6' },
      React.createElement('nav', { className: 'flex gap-5' }, React.createElement(EnlaceSiguiendo, { siguiendo })),
      React.createElement(CabeceraSiguiendo, { siguiendo, criterios }),
      vista.tipo === 'ok' && !vista.sinResultados
        ? React.createElement(FeedSiguiendo, { items: vista.items, siguiente: vista.siguiente, criterios })
        : React.createElement(EstadoSiguiendo, { vista, criterios, siguiendo })),
  };
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

type Pagina = { nombre: string; html: string; ficha?: boolean };
const paginas: Pagina[] = [];
paginas.push({ nombre: 'ficha-zabala', html: documento(css, await paginaFicha(ZABALA)), ficha: true });
paginas.push({ nombre: 'ficha-ramirez', html: documento(css, await paginaFicha(RAMIREZ)), ficha: true });
paginas.push({ nombre: 'ficha-pesada', html: documento(css, await paginaFicha(PESADA)), ficha: true });

const feed = await paginaFeed(ctx, { cursor: '', soloMedallas: false }, 'feed');
paginas.push({ nombre: 'siguiendo-feed', html: documento(css, feed.elemento) });
if (feed.vista.tipo === 'ok' && feed.vista.siguiente) {
  const p2 = await paginaFeed(ctx, { cursor: feed.vista.siguiente, soloMedallas: false }, 'feed página 2');
  paginas.push({ nombre: 'siguiendo-feed-p2', html: documento(css, p2.elemento) });
}
paginas.push({ nombre: 'siguiendo-medallas', html: documento(css, (await paginaFeed(ctx, { cursor: '', soloMedallas: true }, 'feed medallas')).elemento) });
paginas.push({ nombre: 'siguiendo-vacio', html: documento(css, (await paginaFeed(ctxVacio, { cursor: '', soloMedallas: false }, 'feed vacío')).elemento) });
paginas.push({ nombre: 'siguiendo-cursor-invalido', html: documento(css, (await paginaFeed(ctx, { cursor: 'no-vale', soloMedallas: false }, 'feed cursor inválido')).elemento) });

const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
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
  res.writeHead(200, { 'content-type': fichero.endsWith('.png') ? 'image/png' : 'application/octet-stream' }).end(readFileSync(fichero));
});
await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
const puerto = (servidor.address() as AddressInfo).port;

const navegador = await chromium.launch();
const anchos = [
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];

type Pag = Awaited<ReturnType<typeof navegador.newPage>>;
async function pestana(pagina: Pag, valor: string) {
  await pagina.evaluate((v) => {
    for (const el of document.querySelectorAll<HTMLElement>('[role="tab"], [role="tabpanel"]')) {
      const propio = el.getAttribute('role') === 'tab' ? el.id.endsWith(`-trigger-${v}`) : el.id.endsWith(`-content-${v}`);
      el.dataset.state = propio ? 'active' : 'inactive';
      if (el.getAttribute('role') === 'tab') el.setAttribute('aria-selected', String(propio));
    }
  }, valor);
  await pagina.waitForTimeout(250);
}
async function irA(pagina: Pag, selector: string): Promise<boolean> {
  return pagina.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -16);
    return true;
  }, selector);
}

const capturas: string[] = [];
async function foto(pagina: Pag, nombre: string, completa = false) {
  const destino = path.join(SALIDA, `${nombre}.png`);
  await pagina.screenshot({ path: destino, fullPage: completa });
  capturas.push(path.relative(RAIZ, destino));
}

for (const p of paginas) {
  for (const a of anchos) {
    const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready);
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (desborde > 0) console.warn(`  ${p.nombre} @${a.sufijo}: desborda ${desborde}px en horizontal`);
    const base = `${p.nombre}-${a.sufijo}`;
    if (!p.ficha) {
      await foto(pagina, base);
      await foto(pagina, `${base}-completa`, true);
      await pagina.close();
      continue;
    }
    await foto(pagina, `${base}-cabecera`);
    await pestana(pagina, 'resultados');
    await irA(pagina, '#historial');
    await foto(pagina, `${base}-resultados`);

    await pestana(pagina, 'temporadas');
    if (await irA(pagina, '#ficha-ambito')) {
      for (const ambito of ['total', 'internacional', 'nacional']) {
        await pagina.evaluate((v) => { (document.getElementById(`ficha-ambito-${v}`) as HTMLInputElement).checked = true; }, ambito);
        await irA(pagina, '#ficha-ambito');
        await foto(pagina, `${base}-ambito-${ambito}`);
      }
      await pagina.evaluate(() => { (document.getElementById('ficha-ambito-total') as HTMLInputElement).checked = true; });
    }

    await pestana(pagina, 'rivales');
    await irA(pagina, '[role="tablist"]');
    await foto(pagina, `${base}-rivales`);
    if (await irA(pagina, '#ficha-curiosidades')) await foto(pagina, `${base}-curiosidades`);
    await foto(pagina, `${base}-rivales-completa`, true);
    await pagina.close();
  }
}
await navegador.close();
servidor.close();

console.log(`Seguidas sintéticas (${seguidas.length}):`, seguidas.join(', '));
console.table(tiempos);
console.log(capturas.join('\n'));
