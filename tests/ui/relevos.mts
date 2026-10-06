/**
 * Capturas sin servidor de los relevos a 320, 393 y 1440 px: el cara a cara
 * de dos tiradoras con relevos entre ellas (cabecera, asaltos y la sección
 * «Relevos») y la pestaña Rivales del perfil, que acaba en «Relevos». Falla si
 * algo se desborda en horizontal a 393 o 320 px.
 *
 *   PERF_DB=<copia SQLite con la 0010 y el SQL de scripts/relevos.ts> npx tsx tests/ui/relevos.mts
 *   PERF_DB=<copia sin relevos> RELEVOS_SQL=<dir con NN-*.sql> npx tsx tests/ui/relevos.mts
 *
 * Sin NOMBRE_A/NOMBRE_B toma la pareja con más relevos entre las dos y, para
 * el perfil, la persona con relevos en más pruebas. La copia se abre en sólo
 * lectura. Salida en `capturas/relevos/`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
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
import { CabeceraCaraACara, CaraACaraCompleto } from '@/components/explorar/cara-a-cara';
import { CabeceraFicha, PanelRivales } from '@/components/explorar/ficha-deportiva';
import { cargarDiferidosPerfil } from '@/lib/sport/explorar/perfil-diferido';
import { RelevosCaraACaraVista, RelevosPerfilVista } from '@/components/explorar/relevos';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { cargarRelevosCaraACara, leerRelevosPerfilDe } from '@/lib/sport/explorar/relevos';
import { resolverPersona } from '@/lib/sport/explorar/personas';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura } from './d1-lectura.mts';

const RAIZ = process.cwd();
// `SALIDA` también manda los recortes de la sección, que la sonda de auditoría no redirige.
const SALIDA = process.env.SALIDA ? path.resolve(process.env.SALIDA) : path.join(RAIZ, 'capturas', 'relevos');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

/**
 * Con `RELEVOS_SQL` (dir con NN-*.sql de scripts/relevos.ts), un SQLite
 * temporal con sólo las tablas de la 0010 cargadas con esos SQL y la copia
 * adjunta en sólo lectura para todo lo demás: la copia no se toca.
 */
function abrir(): { sqlite: DatabaseSync; temporal: string | null } {
  const dir = process.env.RELEVOS_SQL;
  if (!dir) return { sqlite: new DatabaseSync(BASE!, { readOnly: true }), temporal: null };
  const destino = path.join(tmpdir(), `relevos-${process.pid}.sqlite`);
  if (existsSync(destino)) rmSync(destino);
  const db = new DatabaseSync(destino, { enableForeignKeyConstraints: false });
  db.exec(`ATTACH DATABASE 'file:${BASE!.replace(/\\/g, '/')}?mode=ro' AS src`);
  // Sólo tablas e índices: los disparadores de la 0010 exigen el lease de escritura.
  const migracion = readFileSync(path.join(RAIZ, 'drizzle-d1', '0010_relevos.sql'), 'utf8');
  for (const m of migracion.matchAll(/^CREATE (?:UNIQUE )?(?:TABLE|INDEX)[\s\S]*?;(?=\r?$)/gm)) db.exec(m[0]);
  db.exec('BEGIN');
  for (const f of readdirSync(dir).filter((x) => /^\d{2}-.*\.sql$/.test(x)).sort()) {
    for (const linea of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (/^INSERT INTO sport_(team_match|relay)\b/.test(linea)) db.exec(linea);
    }
  }
  db.exec('COMMIT');
  return { sqlite: db, temporal: destino };
}

const { sqlite, temporal } = abrir();
const binding = bindingDeLectura(sqlite);
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, ctx: {}, cf: {} };
const db = createD1Database(binding);
const ctx = { ...crearContexto().ctx, db };

function personaPorNombre(nombre: string): string {
  const fila = sqlite.prepare(`SELECT id FROM sport_person WHERE display_name = ? AND merged_into_person_id IS NULL LIMIT 1`).get(nombre) as { id: string } | undefined;
  if (!fila) throw new Error(`sin persona: ${nombre}`);
  return fila.id;
}

function pareja(): [string, string] {
  if (process.env.NOMBRE_A && process.env.NOMBRE_B) return [personaPorNombre(process.env.NOMBRE_A), personaPorNombre(process.env.NOMBRE_B)];
  const f = sqlite.prepare(`SELECT min(fencer_a_person_id, fencer_b_person_id) AS a, max(fencer_a_person_id, fencer_b_person_id) AS b, count(*) AS n
    FROM sport_relay WHERE fencer_a_person_id IS NOT NULL AND fencer_b_person_id IS NOT NULL
    GROUP BY 1, 2 ORDER BY n DESC, 1 LIMIT 1`).get() as { a: string; b: string } | undefined;
  if (!f) throw new Error('la copia no tiene relevos con las dos personas');
  return [f.a, f.b];
}

function conMasPruebas(): string {
  if (process.env.NOMBRE_PERFIL) return personaPorNombre(process.env.NOMBRE_PERFIL);
  const f = sqlite.prepare(`SELECT x.id AS id FROM (SELECT fencer_a_person_id AS id, match_id FROM sport_relay UNION ALL SELECT fencer_b_person_id, match_id FROM sport_relay) x
    JOIN sport_team_match m ON m.id = x.match_id WHERE x.id IS NOT NULL GROUP BY x.id ORDER BY count(DISTINCT m.competition_id) DESC, count(*) DESC, x.id LIMIT 1`).get() as { id: string };
  return f.id;
}

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

const ROUTER = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };

function documento(css: string, cuerpo: React.ReactElement, ruta = '/explorar'): string {
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

type Pagina = { nombre: string; cuerpo: React.ReactElement; ruta?: string };
const informe: string[] = [];

async function paginaCaraACara(a: string, b: string): Promise<Pagina> {
  const vista = await cargarCaraACaraPantalla(ctx, a, { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: b });
  if (vista.tipo !== 'ok') throw new Error(`cara a cara: ${vista.tipo}`);
  const relevos = await cargarRelevosCaraACara(ctx, a, b);
  const { yo, rival } = vista.datos.personas;
  informe.push(`cara a cara ${yo.nombre} – ${rival.nombre}: ${vista.datos.resumen.asaltos} asaltos, ${relevos?.resumen.relevos ?? 0} relevos (${relevos?.resumen.tocadosFavor}–${relevos?.resumen.tocadosContra})`);
  return {
    nombre: 'cara-a-cara',
    ruta: `/explorar/${a}/cara-a-cara`,
    cuerpo: React.createElement('div', { className: 'mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4' },
      React.createElement(CabeceraCaraACara, { datos: vista.datos, criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: b } }),
      React.createElement(CaraACaraCompleto, { datos: vista.datos, criterios: { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: b } }),
      React.createElement(RelevosCaraACaraVista, { datos: relevos, yo, rival })),
  };
}

async function paginaPerfil(id: string): Promise<Pagina> {
  const [vista, extras, persona] = await Promise.all([
    cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: true }),
    cargarExtrasPerfil(ctx, id),
    resolverPersona(db, id),
  ]);
  if (vista.tipo !== 'ok' || !persona) throw new Error(`perfil: ${vista.tipo}`);
  const relevos = await leerRelevosPerfilDe(db, persona.ids);
  informe.push(`perfil ${vista.ficha.nombre}: ${relevos?.relevos ?? 0} relevos en ${relevos?.pruebas.length ?? 0} pruebas, ${relevos?.dados}–${relevos?.recibidos} (índice ${relevos?.indice})`);
  const rivales = await cargarDiferidosPerfil(ctx, id).rivales;
  const perfil = vista.ficha.perfil!;
  // La pestaña Rivales tal como la monta `FichaCompleta`: los relevos son su último bloque.
  return {
    nombre: 'perfil',
    ruta: `/explorar/${id}`,
    cuerpo: React.createElement('div', { className: 'flex min-w-0 flex-col gap-6' },
      React.createElement(CabeceraFicha, { ficha: vista.ficha, datos: extras.datos, chips: [] }),
      React.createElement('div', { className: 'flex min-w-0 flex-col gap-8 pt-5' },
        React.createElement(PanelRivales, { ficha: vista.ficha, perfil: { ...perfil, rivalesStats: rivales.stats }, enfrentados: rivales.enfrentados, nivel: 'pagina' }),
        React.createElement(RelevosPerfilVista, { datos: relevos, personaId: vista.ficha.id, nivel: 'pagina' }))),
  };
}

const [a, b] = pareja();
const paginas: Pagina[] = [await paginaCaraACara(a, b), await paginaPerfil(conMasPruebas())];

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
const problemas: string[] = [];
try {
  for (const p of paginas) {
    for (const an of anchos) {
      const pagina = await navegador.newPage({ viewport: an.viewport, deviceScaleFactor: an.escala });
      await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
      await pagina.evaluate(() => document.fonts.ready);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (an.viewport.width < 768 && ancho > an.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 80)}`), an.viewport.width);
        problemas.push(`${p.nombre} @${an.viewport.width}: scrollWidth ${ancho}\n    ${culpables.join('\n    ')}`);
      }
      const total = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
      await pagina.setViewportSize({ width: an.viewport.width, height: Math.max(an.viewport.height, total) });
      const destino = path.join(SALIDA, `${p.nombre}-${an.sufijo}.png`);
      await pagina.screenshot({ path: destino, clip: { x: 0, y: 0, width: an.viewport.width, height: total } });
      capturas.push(path.relative(RAIZ, destino));
      // La sección sola, para revisarla sin desplazarse por el resto de la pantalla.
      const seccion = pagina.locator('section[aria-labelledby="h2h-relevos"], section[aria-labelledby="perfil-relevos"]').first();
      if (await seccion.count()) {
        const solo = path.join(SALIDA, `${p.nombre}-seccion-${an.sufijo}.png`);
        await seccion.screenshot({ path: solo });
        capturas.push(path.relative(RAIZ, solo));
      } else {
        problemas.push(`${p.nombre} @${an.viewport.width}: sin sección de relevos`);
      }
      await pagina.close();
    }
  }
} finally {
  await navegador.close();
  servidor.close();
  sqlite.close();
  if (temporal && existsSync(temporal)) rmSync(temporal);
}

console.log(capturas.join('\n'));
console.log(informe.join('\n'));
if (problemas.length > 0) {
  console.error(`Problemas:\n${problemas.join('\n')}`);
  process.exitCode = 1;
}
