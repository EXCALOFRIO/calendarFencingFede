/**
 * Capturas sin servidor del ranking nacional por temporadas: pestaña Ranking
 * del perfil (/explorar/[personaId]) y la clasificación de temporadas
 * pasadas (/ranking?temporada=…), a 393, 320 y 1440 px. A 393 y 320 px falla
 * si la página se desborda en horizontal.
 *
 *   PERF_DB=<copia SQLite de D1> RANKING_SQL=<dir con ranking-*.sql> npx tsx tests/ui/rankings.mts
 *
 * La copia se abre en sólo lectura y adjunta a un SQLite temporal con las dos
 * tablas de ranking ya cargadas (`ranking-superposicion.mts`); se usan los
 * cargadores de la página y se pinta con `renderToStaticMarkup` y el CSS
 * compilado, como `perfil-v5.mts`. Salida en `capturas/rankings/`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import type { SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { ControlFavoritoFicha } from '@/components/explorar/favoritos';
import { FichaCompleta } from '@/components/explorar/ficha-deportiva';
import { SelectorTemporada } from '@/components/ranking/selector-temporada';
import { TablaTemporada } from '@/components/ranking/tabla-temporada';
import { elegirGrupo, leerTablaNacional, listarGruposNacionales, listarTemporadasNacionales } from '@/lib/queries/ranking-temporadas';
import type { FiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';
import { abrirSuperposicion } from './ranking-superposicion.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'rankings');
const BASE = process.env.PERF_DB;
const DIR_SQL = process.env.RANKING_SQL;
if (!BASE || !DIR_SQL) throw new Error('Faltan PERF_DB y RANKING_SQL');
/** Absoluto, con mundial y seis temporadas nacionales. */
const LLAVADOR = process.env.PERSONA_C ?? 'b40372bf-0b56-4faf-a603-4e0b7f351739';
/** Menor, cuatro categorías en seis temporadas. */
const JOVEN = process.env.PERSONA_J ?? '066153f4-064c-4935-b1c1-85a6dc6d11ee';
/** Con puesto en el ranking mundial de la FIE además del nacional. */
const MUNDIAL = process.env.PERSONA_M ?? '35dbc935-5039-4e53-a4a7-3eb86f362837';

const sqlite = abrirSuperposicion(BASE, DIR_SQL, path.join(tmpdir(), 'rankings-superposicion.sqlite'));

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
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, cuerpo: React.ReactElement): string {
  const conRouter = React.createElement(AppRouterContext.Provider, { value: ROUTER as never }, cuerpo);
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conRouter)}</main></body></html>`;
}

async function paginaFicha(id: string) {
  const [vista, extras] = await Promise.all([cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS), cargarExtrasPerfil(ctx, id)]);
  if (vista.tipo !== 'ok') throw new Error(`ficha ${id}: ${vista.tipo}`);
  if (!extras.rankingNacional?.mejor) throw new Error(`ficha ${id}: sin ranking nacional`);
  return React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
    React.createElement(FichaCompleta, {
      ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${id}`, criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina', extras,
      acciones: React.createElement(ControlFavoritoFicha, {
        estado: { tipo: 'ok', favorito: false, personaId: id }, nombre: vista.ficha.nombre, reintentar: '#',
      }),
    }));
}

/** Lo mismo que pinta `/ranking` para una temporada pasada. */
async function paginaTemporada(filtro: FiltroRankingNacional) {
  const temporadas = await listarTemporadasNacionales(db);
  const temporada = filtro.temporada!;
  const grupos = await listarGruposNacionales(db, temporada);
  const grupo = elegirGrupo(grupos, filtro);
  if (!grupo) throw new Error(`sin grupos en ${temporada}`);
  const tabla = await leerTablaNacional(db, temporada, grupo);
  const misPersonas = tabla.filas.slice(2, 3).flatMap((f) => (f.personaId ? [f.personaId] : []));
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'mb-6 flex flex-wrap items-center gap-x-3 gap-y-2' },
      React.createElement('h1', { className: 'text-3xl sm:text-4xl' }, 'Ranking'),
      React.createElement(SelectorTemporada, { temporadas, vigente: temporadas[0], actual: filtro, grupos, grupo })),
    React.createElement(TablaTemporada, { tabla, mios: misPersonas }));
}

const fusionada = (sqlite.prepare('SELECT id FROM sport_person WHERE merged_into_person_id = ? LIMIT 1').get(LLAVADOR) as { id: string } | undefined)?.id;

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

type Pagina = { nombre: string; html: string; pestana?: string };
const paginas: Pagina[] = [
  { nombre: 'perfil-llavador', html: documento(css, await paginaFicha(LLAVADOR)), pestana: 'ranking' },
  { nombre: 'perfil-joven', html: documento(css, await paginaFicha(JOVEN)), pestana: 'ranking' },
  { nombre: 'perfil-mundial', html: documento(css, await paginaFicha(MUNDIAL)), pestana: 'ranking' },
  ...(fusionada ? [{ nombre: 'perfil-fusionada', html: documento(css, await paginaFicha(fusionada)), pestana: 'ranking' }] : []),
  { nombre: 'temporada-2022-2023', html: documento(css, await paginaTemporada({ temporada: '2022-2023', arma: 'FLORETE', genero: 'M', categoria: 'ABS' })) },
  { nombre: 'temporada-2019-2020-pdf', html: documento(css, await paginaTemporada({ temporada: '2019-2020', arma: 'SABLE', genero: 'F', categoria: 'M20' })) },
  { nombre: 'temporada-2024-2025-vet', html: documento(css, await paginaTemporada({ temporada: '2024-2025', arma: 'ESPADA', genero: 'M', categoria: 'VET50' })) },
];

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
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];

const capturas: string[] = [];
const desbordes: string[] = [];
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      if (p.pestana) {
        await pagina.evaluate((v) => {
          for (const el of document.querySelectorAll<HTMLElement>('[role="tab"], [role="tabpanel"]')) {
            const propio = el.getAttribute('role') === 'tab' ? el.id.endsWith(`-trigger-${v}`) : el.id.endsWith(`-content-${v}`);
            el.dataset.state = propio ? 'active' : 'inactive';
            if (el.getAttribute('role') === 'tab') el.setAttribute('aria-selected', String(propio));
          }
        }, p.pestana);
        await pagina.waitForTimeout(250);
      }
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (a.viewport.width < 768 && ancho > a.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 80)}`), a.viewport.width);
        desbordes.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}\n    ${culpables.join('\n    ')}`);
      }
      const cortados = await pagina.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="tab"], [data-lista] span, [aria-label="Temporadas"] a')]
        .filter((e) => e.offsetParent !== null && !e.classList.contains('sr-only') && e.scrollWidth > e.clientWidth + 1)
        .map((e) => (e.textContent ?? '').trim()));
      if (cortados.length) desbordes.push(`${p.nombre} @${a.viewport.width}: rótulo cortado: ${cortados.slice(0, 6).join(' | ')}`);
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`);
      if (p.pestana) {
        // La cabecera y la pestaña de ranking, que es lo que se revisa.
        const panel = await pagina.evaluate(() => {
          const el = document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { y: r.bottom + window.scrollY };
        });
        const alto = Math.ceil(panel?.y ?? 2000) + 16;
        await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
        await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: a.viewport.width, height: alto } });
      } else {
        await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: a.viewport.width, height: Math.min(1400, await pagina.evaluate(() => document.scrollingElement!.scrollHeight)) } });
      }
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
if (desbordes.length > 0) {
  console.error(`Problemas:\n${desbordes.join('\n')}`);
  process.exitCode = 1;
}
