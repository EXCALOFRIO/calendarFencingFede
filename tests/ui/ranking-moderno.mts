/**
 * /ranking sin servidor: mide las lecturas de la página (las mismas que hace
 * `page.tsx`, vía `cargarPantallaRanking`) con una latencia simulada por
 * sentencia, y captura la vista a 320, 393 y 1440 px.
 *
 *   $env:PERF_DB=<copia SQLite de D1>
 *   $env:INTERNACIONALES=<dir con NN-*.sql>   (opcional)
 *   $env:RANKING_SQL=<dir con ranking-*.sql>  (opcional)
 *   $env:FASE=antes | despues                 (subcarpeta de salida)
 *   $env:LATENCIA=25                          (ms por viaje a D1; 0 = sólo cálculo)
 *   $env:SONDA_DIR='ranking-moderno'
 *   npx tsx --import ./tests/ui/auditoria-sonda.mts tests/ui/ranking-moderno.mts
 *
 * La copia se abre en sólo lectura; con SQL, las tablas de ranking van a un
 * SQLite temporal (igual que `diseno-perfil.mts`). Salida en
 * `capturas/ranking-moderno/<FASE>/`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { D1Binding, D1Statement } from '@/db/d1/binding';
import type { SessionProfile } from '@/lib/auth/session';
import { cargarPantallaRanking, leerVistaRanking } from '@/app/(app)/ranking/datos';
import { VistaRanking } from '@/app/(app)/ranking/vista';
import { CabeceraCompacta } from '@/components/sistema/cabecera-compacta';
import { leerFiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { bindingDeLectura, type Medida } from './d1-lectura.mts';

const RAIZ = process.cwd();
const FASE = process.env.FASE ?? 'antes';
const SALIDA = process.env.SALIDA ? path.resolve(process.env.SALIDA) : path.join(RAIZ, 'capturas', 'ranking-moderno', FASE);
const LATENCIA = Number(process.env.LATENCIA ?? 25);
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const DIRS = [
  process.env.INTERNACIONALES ? { dir: process.env.INTERNACIONALES, patron: /^\d{2}-.*\.sql$/ } : null,
  process.env.RANKING_SQL ? { dir: process.env.RANKING_SQL, patron: /^ranking-.*\.sql$/ } : null,
].filter((d) => d !== null);

function abrir(): { sqlite: DatabaseSync; temporal: string | null } {
  if (DIRS.length === 0) return { sqlite: new DatabaseSync(BASE!, { readOnly: true }), temporal: null };
  const destino = path.join(tmpdir(), `ranking-moderno-${process.pid}.sqlite`);
  if (existsSync(destino)) rmSync(destino);
  const db = new DatabaseSync(destino, { enableForeignKeyConstraints: false });
  db.exec(`ATTACH DATABASE 'file:${BASE!.replace(/\\/g, '/')}?mode=ro' AS src`);
  const ddl = db.prepare(`SELECT type, sql FROM src.sqlite_master
    WHERE sql IS NOT NULL AND tbl_name IN ('sport_ranking_publication','sport_ranking_entry') AND type IN ('table','index')
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, CASE tbl_name WHEN 'sport_ranking_publication' THEN 0 ELSE 1 END`).all() as { sql: string }[];
  for (const d of ddl) db.exec(d.sql);
  db.exec('INSERT INTO main.sport_ranking_publication SELECT * FROM src.sport_ranking_publication');
  db.exec('INSERT INTO main.sport_ranking_entry SELECT * FROM src.sport_ranking_entry');
  db.exec('BEGIN');
  for (const { dir, patron } of DIRS) {
    for (const f of readdirSync(dir).filter((x) => patron.test(x)).sort()) {
      for (const linea of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (/^INSERT INTO sport_ranking_(publication|entry)\b/.test(linea)) db.exec(linea);
      }
    }
  }
  db.exec('COMMIT');
  return { sqlite: db, temporal: destino };
}

const traza: { t: number; sql: string }[] = [];
let origen = 0;
const espera = (ms: number, sql = '') => {
  if (process.env.TRAZA) traza.push({ t: Math.round(performance.now() - origen), sql: sql.replace(/\s+/g, ' ').slice(0, 70) });
  return new Promise<void>((ok) => setTimeout(ok, ms));
};

/** Cada viaje a D1 cuesta `LATENCIA` ms antes de ejecutarse: así cuentan las tandas en serie. */
function conLatencia(base: D1Binding): D1Binding {
  const envolver = (st: D1Statement, sql: string): D1Statement => {
    const s = st as unknown as Record<string, (...a: unknown[]) => unknown>;
    return {
      ...st,
      _x: s._x,
      bind: (...p: unknown[]) => envolver(s.bind(...p) as D1Statement, sql),
      all: async () => { await espera(LATENCIA, sql); return s.all(); },
      run: async () => { await espera(LATENCIA); return s.run(); },
      raw: async () => { await espera(LATENCIA, sql); return s.raw(); },
      first: async (c?: string) => { await espera(LATENCIA, sql); return s.first(c); },
    } as never;
  };
  return {
    prepare: (q) => envolver(base.prepare(q), q),
    batch: async (sts) => { await espera(LATENCIA, 'batch'); return base.batch(sts); },
  };
}

const { sqlite, temporal } = abrir();
const medidas: Medida[] = [];
const binding = conLatencia(bindingDeLectura(sqlite, medidas));
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };

const perfilDe = (nombre: string): SessionProfile => {
  const fila = sqlite.prepare(`SELECT p.id, p.role FROM athlete a JOIN user_profile p ON p.id = a.user_profile_id
    WHERE a.active = 1 AND a.first_name || ' ' || a.last_name LIKE ? LIMIT 1`).get(`${nombre}%`) as { id: string; role: SessionProfile['role'] } | undefined;
  if (!fila) throw new Error(`sin perfil: ${nombre}`);
  return {
    authUserId: 'arnes', email: 'arnes@example.test', profileId: fila.id, fullName: nombre, role: fila.role,
    clubId: null, clubName: null, icalToken: 'x', weapons: [],
  };
};
const perfil = perfilDe(process.env.TIRADOR ?? 'Carlos Llavador');

const variantes: { nombre: string; consulta: string }[] = [
  { nombre: 'internacional', consulta: '' },
  { nombre: 'nacional', consulta: process.env.CONSULTA_NACIONAL ?? 'arma=FLORETE&genero=M&categoria=ABS' },
  { nombre: 'jjoo', consulta: 'jjoo=1' },
  { nombre: 'europeo', consulta: 'ambito=europeo' },
  { nombre: 'historica', consulta: 'temporada=2021-2022&arma=SABLE&genero=M&categoria=M20' },
];

const informe: string[] = [`fase ${FASE}, latencia ${LATENCIA} ms por sentencia`];
const tiempos: Record<string, { ms: number; sentencias: number; html: number; props: number }> = {};

async function medir(consulta: string) {
  const filtro = leerFiltroRankingNacional(Object.fromEntries(new URLSearchParams(consulta)));
  const muestras: number[] = [];
  let sentencias = 0;
  let datos: Awaited<ReturnType<typeof cargarPantallaRanking>> | null = null;
  for (let i = 0; i < 3; i++) {
    medidas.length = 0;
    traza.length = 0;
    const t0 = performance.now();
    origen = t0;
    datos = await cargarPantallaRanking(perfil, filtro, leerVistaRanking(Object.fromEntries(new URLSearchParams(consulta))));
    muestras.push(performance.now() - t0);
    sentencias = medidas.length;
  }
  if (process.env.TRAZA) console.log(consulta, traza.map((x) => `${x.t} ${x.sql}`).join('\n'));
  muestras.sort((a, b) => a - b);
  return { datos: datos!, ms: Math.round(muestras[1]!), sentencias, lentas: [...medidas].sort((a, b) => b.ms - a.ms).slice(0, 3) };
}

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
const css = await compilarCss();

function documento(cuerpo: React.ReactElement, consulta: string): string {
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

const paginas: { nombre: string; html: string }[] = [];
const cargar = async () => null;
for (const v of variantes) {
  const r = await medir(v.consulta);
  const vista = React.createElement(VistaRanking, { datos: r.datos, cargar: cargar as never, cargarNacional: cargar as never, cargarEuropeo: cargar as never });
  const html = documento(React.createElement(React.Fragment, null, React.createElement(CabeceraCompacta, { variante: 'raiz', titulo: 'Ranking' }), vista), v.consulta);
  paginas.push({ nombre: `ranking-${v.nombre}`, html });
  if (v.nombre === 'internacional') informe.push(`  reparto: ${Object.entries(r.datos).map(([k, x]) => [k, Math.round(Buffer.byteLength(JSON.stringify(x) ?? '') / 1024)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n} kB`).join(', ')}`);
  tiempos[v.nombre] = { ms: r.ms, sentencias: r.sentencias, html: Math.round(Buffer.byteLength(html) / 1024), props: Math.round(Buffer.byteLength(JSON.stringify(r.datos)) / 1024) };
  informe.push(`${v.nombre}${v.consulta ? ` ?${v.consulta}` : ''}: ${r.ms} ms, ${r.sentencias} sentencias, HTML ${tiempos[v.nombre]!.html} kB (CSS incluido), datos serializados ${tiempos[v.nombre]!.props} kB; más lentas: ${r.lentas.map((m) => `${m.ms.toFixed(1)} ms/${m.filas} filas «${m.sql.replace(/\s+/g, ' ').slice(0, 60)}»`).join(' | ')}`);
}

// Piezas extra que sólo existen tras el rediseño (la hoja de filtros abierta, pintada fuera del portal).
const extra = process.env.EXTRA ? (await import(pathToFileURL(path.resolve(process.env.EXTRA)).href)) as { paginasExtra?: (doc: typeof documento) => Promise<{ nombre: string; html: string }[]> } : null;
if (extra?.paginasExtra) paginas.push(...await extra.paginasExtra(documento));

mkdirSync(SALIDA, { recursive: true });
writeFileSync(path.join(SALIDA, 'tiempos.json'), JSON.stringify({ latencia: LATENCIA, tiempos }, null, 2));

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

if (process.env.SIN_CAPTURAS) {
  console.log(informe.join('\n'));
  servidor.close();
  sqlite.close();
  if (temporal && existsSync(temporal)) rmSync(temporal);
  process.exit(0);
}
const navegador = await chromium.launch();
const anchos = [
  { sufijo: '320', viewport: { width: 320, height: 700 }, escala: 2 },
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
];
const problemas: string[] = [];
let capturas = 0;
try {
  for (const p of paginas) {
    for (const a of anchos) {
      const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (ancho > a.viewport.width) problemas.push(`${p.nombre} @${a.viewport.width}: scrollWidth ${ancho}`);
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      const alto = Math.min(1500, total);
      await pagina.setViewportSize({ width: a.viewport.width, height: Math.max(a.viewport.height, alto) });
      await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`), clip: { x: 0, y: 0, width: a.viewport.width, height: alto } });
      capturas += 1;
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
  if (temporal && existsSync(temporal)) rmSync(temporal);
}

console.log(`${capturas} capturas en ${path.relative(RAIZ, SALIDA)}`);
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
