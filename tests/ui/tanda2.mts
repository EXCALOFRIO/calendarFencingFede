/**
 * Capturas sin servidor de la segunda tanda de ranking y perfil, a 393, 320 y
 * 1440 px: /ranking nacional e internacional (con «Solo JJOO»), la cabecera
 * del perfil con sus pastillas de ranking y las tres caras de la tarjeta de
 * cifras (y una a medio giro), y la pestaña Rivales. Falla si algo se
 * desborda en horizontal a 393 o 320 px.
 *
 *   PERF_DB=<copia SQLite de D1> RANKING_SQL=<dir con ranking-*.sql> npx tsx tests/ui/tanda2.mts
 *
 * Mismo montaje que `rankings.mts`: la copia en sólo lectura con el ranking
 * superpuesto, los cargadores reales (la D1 de `@/db` se apunta a esa copia) y
 * `renderToStaticMarkup` con el CSS compilado. Salida en `capturas/tanda2/`.
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
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { CabeceraFicha, FichaCompleta, PanelRivales } from '@/components/explorar/ficha-deportiva';
import { PanelRanking, type FichaPanel } from '@/components/ranking/panel-ranking';
import { SelectorTemporada } from '@/components/ranking/selector-temporada';
import { TablaRankingOficial } from '@/components/ranking/tabla-oficial';
import { getClasificacionFie, getRankingOficialScreenData, groupKey, listGruposClasificacionFie } from '@/lib/queries/ranking';
import { personasOficiales } from '@/lib/queries/personas-ranking';
import { listarTemporadasNacionales } from '@/lib/queries/ranking-temporadas';
import { leerFiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { cargarDiferidosPerfil } from '@/lib/sport/explorar/perfil-diferido';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { completarTablaFie } from '@/app/(app)/ranking/consultas';
import { crearContexto } from '../helpers/explorar';
import { abrirSuperposicion } from './ranking-superposicion.mts';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'tanda2');
const BASE = process.env.PERF_DB;
const DIR_SQL = process.env.RANKING_SQL;
if (!BASE || !DIR_SQL) throw new Error('Faltan PERF_DB y RANKING_SQL');
const LLAVADOR = process.env.PERSONA_C ?? 'b40372bf-0b56-4faf-a603-4e0b7f351739';

const sqlite = abrirSuperposicion(BASE, DIR_SQL, path.join(tmpdir(), 'tanda2-superposicion.sqlite'));

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
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
// Las consultas de `@/lib/queries/*` usan la D1 global (`@/db`): se le da esta copia.
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, cuerpo: React.ReactElement, consulta = ''): string {
  const conContexto = React.createElement(AppRouterContext.Provider, { value: ROUTER as never },
    React.createElement(PathnameContext.Provider, { value: '/ranking' },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(consulta) }, cuerpo)));
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(conContexto)}</main></body></html>`;
}

const grupoLlavador = new Set([LLAVADOR, ...(sqlite.prepare('SELECT id FROM sport_person WHERE merged_into_person_id = ?').all(LLAVADOR) as { id: string }[]).map((r) => r.id)]);
const atleta = (sqlite.prepare('SELECT athlete_id AS a FROM sport_person WHERE id = ?').get(LLAVADOR) as { a: string | null } | undefined)?.a ?? 'atleta-llavador';

/** /ranking tal como lo monta la página para la temporada vigente. */
async function paginaRanking(federacion: 'RFEE' | 'FIE') {
  const grupo = { weapon: 'FLORETE', gender: 'M', category: 'ABS' } as const;
  const [oficial, temporadas, mundial] = await Promise.all([getRankingOficialScreenData(), listarTemporadasNacionales(db), listGruposClasificacionFie()]);
  const personas = await personasOficiales(db, oficial.seasonLabel);
  const tabla = oficial.tables[groupKey(grupo)];
  const filaNac = tabla?.rows.find((r) => grupoLlavador.has(personas[r.id] ?? ''));
  const primera = await completarTablaFie(await getClasificacionFie({ format: 'INDIVIDUAL', ...grupo, athleteIdsPropios: [atleta] }));
  const filaFie = primera?.rows.find((r) => grupoLlavador.has(primera.personas[String(r.fieId)] ?? ''));
  const ficha: FichaPanel = {
    athleteId: atleta, nombre: 'Carlos', apellidos: 'Llavador Fernández', personaId: LLAVADOR,
    lados: [
      { federacion: 'RFEE', etiqueta: 'Nacional', mejor: filaNac ? { etiqueta: 'Florete absoluto', puesto: filaNac.position } : null },
      { federacion: 'FIE', etiqueta: 'Internacional', mejor: filaFie ? { etiqueta: 'Florete absoluto', puesto: filaFie.position } : null },
    ],
  };
  const vigente = oficial.seasonLabel ?? temporadas[0] ?? null;
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'mb-6 flex flex-wrap items-center gap-x-3 gap-y-2' },
      React.createElement('h1', { className: 'text-3xl sm:text-4xl' }, 'Ranking'),
      React.createElement('p', { className: 'text-sm text-muted-foreground' }, `Temporada ${oficial.seasonLabel}`)),
    React.createElement(PanelRanking, {
      federacionInicial: federacion,
      fichas: [ficha],
      rfee: React.createElement(TablaRankingOficial, {
        grupos: oficial.groups, tablas: oficial.tables, cortes: oficial.cutoffs, desgloses: {}, internos: {},
        mios: [atleta], grupoInicial: groupKey(grupo), conMiFicha: true, personas,
        selectorTemporada: React.createElement(SelectorTemporada, { temporadas: [...new Set([...(vigente ? [vigente] : []), ...temporadas])], vigente, actual: leerFiltroRankingNacional({}) }),
      }),
      fie: {
        grupos: mundial.grupos, inicial: { format: 'INDIVIDUAL', ...grupo }, primeraTabla: primera, mios: [atleta],
        cargar: async () => null,
      },
    }));
}

async function datosFicha() {
  const [vista, extras] = await Promise.all([
    cargarFichaPantalla(ctx, LLAVADOR, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    cargarExtrasPerfil(ctx, LLAVADOR),
  ]);
  if (vista.tipo !== 'ok') throw new Error(`ficha: ${vista.tipo}`);
  return { vista, extras };
}

const { vista, extras } = await datosFicha();
const chips = chipsRanking({ nacional: extras.rankingNacional, mundial: extras.rankingMundial, resumenMundial: extras.resumenMundial });
const cabecera = (cara: number) => React.createElement(CabeceraFicha, { ficha: vista.ficha, datos: extras.datos, chips, caraInicial: cara });
const diferidos = cargarDiferidosPerfil(ctx, LLAVADOR);
const rivales = await diferidos.rivales;
const paginaRivales = React.createElement('div', { className: 'flex min-w-0 flex-col gap-8' },
  React.createElement(PanelRivales, {
    ficha: vista.ficha, perfil: { ...vista.ficha.perfil!, rivalesStats: rivales.stats }, enfrentados: rivales.enfrentados, nivel: 'pagina',
  }));

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

type Pagina = { nombre: string; html: string; giro?: number; recorte?: number };
const paginas: Pagina[] = [
  { nombre: 'ranking-nacional', html: documento(css, await paginaRanking('RFEE')), recorte: 1500 },
  { nombre: 'ranking-internacional-jjoo', html: documento(css, await paginaRanking('FIE'), 'jjoo=1'), recorte: 1500 },
  { nombre: 'perfil-ficha', html: documento(css, React.createElement(FichaCompleta, {
    ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${LLAVADOR}`, criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina', extras,
  })), recorte: 1100 },
  { nombre: 'perfil-cara-internacional', html: documento(css, cabecera(1)) },
  { nombre: 'perfil-cara-nacional', html: documento(css, cabecera(2)) },
  { nombre: 'perfil-girando', html: documento(css, cabecera(0)), giro: 62 },
  { nombre: 'perfil-rivales', html: documento(css, paginaRivales), recorte: 2200 },
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
      if (p.giro !== undefined) {
        // Sin hidratar no hay clic: se fija el ángulo a mano para ver el 3D a medio giro.
        await pagina.evaluate((g) => {
          const el = document.querySelector<HTMLElement>('[data-giro]');
          if (el) { el.style.transition = 'none'; el.style.setProperty('--giro', `${g}deg`); }
        }, p.giro);
        await pagina.waitForTimeout(100);
      }
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (a.viewport.width < 768 && ancho > a.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 80)}`), a.viewport.width);
        problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}\n    ${culpables.join('\n    ')}`);
      }
      // Filas de ranking: una línea (44 px) y ninguna más alta que dos líneas de texto.
      const altas = await pagina.evaluate(() => [...document.querySelectorAll<HTMLElement>('ol > li[class*="grid-cols-[2rem"]')]
        .filter((li) => li.getBoundingClientRect().height > 50)
        .map((li) => `${li.getBoundingClientRect().height.toFixed(0)}px: ${[...li.querySelectorAll<HTMLElement>('*')].filter((e) => e.getBoundingClientRect().height > 46).map((e) => e.tagName + '.' + e.className.toString().slice(0, 40)).join(' | ')}`));
      if (altas.length > 0) problemas.push(`${p.nombre} @${a.viewport.width}: ${altas.length} filas de ranking de más de una línea; ${altas[0]}`);
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
console.log(`chips: ${JSON.stringify(chips)}`);
console.log(`rivales: todos=${rivales.enfrentados?.todos.rivales} nacional=${rivales.enfrentados?.nacional.rivales} internacional=${rivales.enfrentados?.internacional.rivales}`);
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
