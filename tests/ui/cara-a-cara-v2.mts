/**
 * Capturas sin servidor del cara a cara rediseñado: cabecera, cifras, filtros
 * y la lista de cruces con las pruebas fundidas.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/cara-a-cara-v2.mts
 *
 * Igual que `perfil-v4.mts`: la copia se abre en sólo lectura, se usa el
 * cargador de la página y se pinta con `renderToStaticMarkup` y el CSS
 * compilado. Salida en `capturas/cara-a-cara-v2/`, a 393 y 1440 px. Falla si
 * la página desborda en horizontal a 393 px.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import { anchosCapturas, carpetaCapturas, ES_MOVIL } from './pasada.mts';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { CabeceraCaraACara, CaraACaraCompleto } from '@/components/explorar/cara-a-cara';
import { FiltrosCaraACara } from '@/components/explorar/filtros-cara-a-cara';
import { SeccionRendimientoCaraACara } from '@/components/explorar/graficos/seccion-rendimiento-cara-a-cara';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { leerCriteriosCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { opcionesTemporada } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'cara-a-cara-v2');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = process.env.PERSONA_A ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RAMIREZ = process.env.PERSONA_B ?? '58671832-da43-4fc9-bafa-4354747a347e';

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
</head><body class="antialiased"><main class="ancho-app flex flex-1 flex-col px-4 py-4">${renderToStaticMarkup(cuerpo)}</main></body></html>`;
}

async function pagina(id: string, consulta: Record<string, string>) {
  const criterios = leerCriteriosCaraACara(consulta);
  const vista = await cargarCaraACaraPantalla(ctx, id, criterios);
  if (vista.tipo !== 'ok') throw new Error(`cara a cara: ${vista.tipo}`);
  if (process.argv.includes('--datos')) {
    for (const e of vista.datos.encuentros ?? []) {
      console.log([e.fecha, e.torneo, e.puestos.yo, e.puestos.rival, e.marcadores.map((m) => `${m.fase}:${m.ronda}:${m.mios}-${m.rival}`).join(' '), e.equivalentes.length].join(' | '));
    }
  }
  // Los filtros llaman a `useRouter`, que exige el contexto del App Router.
  return React.createElement(AppRouterContext.Provider, { value: {} as never },
    React.createElement('div', { className: 'mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4' },
      React.createElement(CabeceraCaraACara, { datos: vista.datos, criterios }),
      React.createElement(FiltrosCaraACara, { personaId: id, criterios, temporadas: opcionesTemporada('2026-05-01') }),
      React.createElement(CaraACaraCompleto, {
        datos: vista.datos, criterios,
        rendimiento: vista.rendimiento
          ? React.createElement(SeccionRendimientoCaraACara, { datos: vista.rendimiento, yo: vista.datos.personas.yo, rival: vista.datos.personas.rival, titulo: 'Evolución' })
          : null,
      })));
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const paginas = [
  { nombre: 'zabala-ramirez', html: documento(css, await pagina(ZABALA, { rival: RAMIREZ })) },
  { nombre: 'ramirez-zabala', html: documento(css, await pagina(RAMIREZ, { rival: ZABALA })) },
  { nombre: 'zabala-ramirez-poule', html: documento(css, await pagina(ZABALA, { rival: RAMIREZ, fase: 'POULE' })) },
  { nombre: 'zabala-ramirez-nacional', html: documento(css, await pagina(ZABALA, { rival: RAMIREZ, ambito: 'nacional' })) },
  { nombre: 'zabala-ramirez-internacional', html: documento(css, await pagina(ZABALA, { rival: RAMIREZ, ambito: 'internacional' })) },
];

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
    const pestana = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    await pestana.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
    await pestana.evaluate(() => document.fonts.ready);
    const ancho = await pestana.evaluate(() => document.documentElement.scrollWidth);
    if (ES_MOVIL(a.viewport.width) && ancho > a.viewport.width) desbordes.push(`${p.nombre}: scrollWidth ${ancho}`);
    for (const completa of [false, true]) {
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}${completa ? '-completa' : ''}.png`);
      await pestana.screenshot({ path: destino, fullPage: completa });
      capturas.push(path.relative(RAIZ, destino));
    }
    if (p.nombre === 'zabala-ramirez') {
      await pestana.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}-abierta.png`);
      await pestana.screenshot({ path: destino, fullPage: true });
      capturas.push(path.relative(RAIZ, destino));
    }
    await pestana.close();
  }
}
await navegador.close();
servidor.close();

console.log(capturas.join('\n'));
if (desbordes.length > 0) {
  console.error(`Desborde horizontal a 393 px:\n${desbordes.join('\n')}`);
  process.exit(1);
}
