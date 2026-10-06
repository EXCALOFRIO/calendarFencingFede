/**
 * Capturas sin servidor de las gráficas de rendimiento: la sección del
 * perfil (Todo / Internacional / Nacional) y la del cara a cara.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/graficos.mts
 *
 * Igual que `perfil-v4.mts`: la copia se abre en sólo lectura, se leen los
 * datos con los cargadores reales (`leerRendimiento*`) y se pinta con
 * `renderToStaticMarkup` y el CSS compilado. Salida en `capturas/graficos/`,
 * a 393 y 1440 px. Falla si algo desborda en horizontal a 393 px.
 */
import { mkdirSync, readFileSync } from 'node:fs';
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
import { SeccionRendimiento } from '@/components/explorar/graficos/seccion-rendimiento';
import { SeccionRendimientoCaraACara } from '@/components/explorar/graficos/seccion-rendimiento-cara-a-cara';
import { leerRendimiento, leerRendimientoCaraACara } from '@/lib/sport/explorar/rendimiento';
import { crearContexto } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'graficos');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const LLAVADOR = process.env.PERSONA_A ?? 'b40372bf-0b56-4faf-a603-4e0b7f351739';
const ZABALA = process.env.PERSONA_B ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RAMIREZ = process.env.PERSONA_C ?? '58671832-da43-4fc9-bafa-4354747a347e';

const sqlite = new DatabaseSync(BASE, { readOnly: true });
const tiempos: { lectura: string; ms: number; consultas: number }[] = [];
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

/** Primera lectura en frío (caché de páginas de 2 MB de node:sqlite) y luego tres en caliente, como en D1. */
async function medir<T>(lectura: string, f: () => Promise<T>): Promise<T> {
  const antes = consultas;
  let t = performance.now();
  let r = await f();
  tiempos.push({ lectura: `${lectura} (frío)`, ms: Math.round(performance.now() - t), consultas: consultas - antes });
  sqlite.exec('PRAGMA cache_size = -200000');
  await f();
  t = performance.now();
  for (let i = 0; i < 3; i++) r = await f();
  tiempos.push({ lectura: `${lectura} (caliente)`, ms: Math.round((performance.now() - t) / 3), consultas: (consultas - antes) / 5 });
  sqlite.exec('PRAGMA cache_size = -2000');
  return r;
}

const nombre = (id: string) =>
  (sqlite.prepare('SELECT display_name AS n FROM sport_person WHERE id = ?').get(id) as { n: string } | undefined)?.n ?? '';

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

async function paginaPerfil(id: string, clave: string) {
  const r = await medir(`rendimiento ${clave}`, () => leerRendimiento(ctx, { personaId: id }));
  if (r.estado !== 'ok') throw new Error(`rendimiento ${clave}: ${r.estado}`);
  return React.createElement(SeccionRendimiento, { datos: r.datos });
}

async function paginaCaraACara(a: string, b: string, clave: string, sinResumen = false) {
  const r = await medir(`cara a cara ${clave}`, () => leerRendimientoCaraACara(ctx, { personaId: a, rivalId: b }));
  if (r.estado !== 'ok') throw new Error(`cara a cara ${clave}: ${r.estado}`);
  return React.createElement(SeccionRendimientoCaraACara, {
    datos: r.datos, yo: { nombre: nombre(r.personaId) }, rival: { nombre: nombre(r.rivalId) }, sinResumen,
  });
}

/** El rival con más asaltos contra `id`: un duelo largo para ver el balance acumulado lleno. */
function rivalMasHabitual(id: string): string | null {
  const fila = sqlite.prepare(`
    WITH RECURSIVE g(id, s) AS (SELECT ?, 0 UNION ALL SELECT p.id, g.s + 1 FROM sport_person p JOIN g ON p.merged_into_person_id = g.id WHERE g.s < 3),
    rivales AS (
      SELECT b.fencer_b_person_id AS r FROM sport_bout b WHERE b.fencer_a_person_id IN (SELECT id FROM g)
      UNION ALL
      SELECT b.fencer_a_person_id FROM sport_bout b WHERE b.fencer_b_person_id IN (SELECT id FROM g)
    )
    SELECT coalesce(p.merged_into_person_id, p.id) AS id, count(*) AS n
    FROM rivales x JOIN sport_person p ON p.id = x.r
    WHERE coalesce(p.merged_into_person_id, p.id) <> ?
    GROUP BY 1 ORDER BY n DESC LIMIT 1`).get(id, id) as { id: string } | undefined;
  return fila?.id ?? null;
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const paginas: { nombre: string; html: string; ambitos: boolean }[] = [
  { nombre: 'perfil-llavador', ambitos: true, html: documento(css, await paginaPerfil(LLAVADOR, 'llavador')) },
  { nombre: 'perfil-zabala', ambitos: true, html: documento(css, await paginaPerfil(ZABALA, 'zabala')) },
  { nombre: 'cara-a-cara-zabala-ramirez', ambitos: false, html: documento(css, await paginaCaraACara(ZABALA, RAMIREZ, 'zabala-ramirez')) },
];
const habitual = rivalMasHabitual(ZABALA);
if (habitual) {
  paginas.push({
    nombre: 'cara-a-cara-zabala-habitual', ambitos: false,
    html: documento(css, await paginaCaraACara(ZABALA, habitual, 'zabala-rival habitual')),
  });
  // Como va en la página del cara a cara, debajo de sus propias cifras.
  paginas.push({
    nombre: 'cara-a-cara-zabala-habitual-sin-resumen', ambitos: false,
    html: documento(css, await paginaCaraACara(ZABALA, habitual, 'zabala-rival habitual sin resumen', true)),
  });
}

const html = new Map(paginas.map((p) => [`/${p.nombre}`, p.html]));
const servidor = createServer((pet, res) => {
  const pagina = html.get(new URL(pet.url ?? '/', 'http://x').pathname);
  if (pagina) res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina);
  else res.writeHead(404).end();
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
    const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    // `load` y no `networkidle`: las fuentes de Google a veces no cierran la conexión a tiempo.
    await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'load', timeout: 60_000 });
    await pagina.evaluate(() => Promise.race([document.fonts.ready, new Promise((ok) => setTimeout(ok, 5000))]));
    const vistas = p.ambitos ? ['todo', 'internacional', 'nacional'] : [''];
    for (const v of vistas) {
      if (v) {
        const radio = pagina.locator(`input.rend-${v}`);
        if ((await radio.count()) === 0) continue;
        await radio.check({ force: true });
      }
      const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth);
      if (ancho > a.viewport.width) desbordes.push(`${p.nombre}${v ? `-${v}` : ''} @${a.sufijo}: scrollWidth ${ancho}`);
      const destino = path.join(SALIDA, `${p.nombre}${v ? `-${v}` : ''}-${a.sufijo}.png`);
      await pagina.screenshot({ path: destino, fullPage: true });
      capturas.push(path.relative(RAIZ, destino));
      // TROZOS=1: la página en tramos de una pantalla, para mirarla al tamaño real.
      if (process.env.TROZOS) {
        const alto = await pagina.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0, i = 1; y < alto; y += a.viewport.height, i++) {
          await pagina.screenshot({
            path: destino.replace(/\.png$/, `-tramo${i}.png`),
            fullPage: true,
            clip: { x: 0, y, width: a.viewport.width, height: Math.min(a.viewport.height, alto - y) },
          });
        }
      }
    }
    await pagina.close();
  }
}
await navegador.close();
servidor.close();

console.table(tiempos);
console.log(capturas.join('\n'));
if (desbordes.length) {
  console.error(`Desborde horizontal:\n${desbordes.join('\n')}`);
  process.exitCode = 1;
}
