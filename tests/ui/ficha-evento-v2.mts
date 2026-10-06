/**
 * Capturas sin servidor de la ficha de un torneo del calendario: la hora de la
 * sede y la tuya, los datos de la convocatoria por grupos y, en un torneo ya
 * terminado, el podio de cada prueba.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/ficha-evento-v2.mts
 *
 * Como `perfil-v4.mts`: la copia se abre en sólo lectura, se usan las mismas
 * lecturas que la aplicación (`getEvent`, `cargarPodiosEvento`) y se pinta con `renderToStaticMarkup` y el CSS
 * compilado. Salida en `capturas/ficha-evento-v2/`, a 393 y 1440 px.
 *
 * Dos cosas que no son como en la aplicación, a propósito:
 *
 *  · Sin JavaScript en el navegador no hay efectos, así que la ficha no pide
 *    sus resultados: el cuerpo del podio se pinta aparte con los datos ya
 *    leídos y se pone donde va la banda: antes de la primera banda de la
 *    ficha (sin plazo, que en un torneo terminado no sale).
 *  · La copia no tiene ninguna edición vinculada a un torneo del calendario
 *    (`sport_edition.event_id` vacío). Para ver el podio se vincula una en una
 *    tabla TEMPORAL que tapa a la de verdad solo en esta conexión; la base no
 *    se toca. `VINCULOS=edicion:evento,...` cambia cuáles.
 *
 * Y el huso «del dispositivo» es siempre el del servidor (`Europe/Madrid`):
 * es lo que pinta el HTML antes de hidratar.
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
import { crearContexto } from '../helpers/explorar';
import { aplicarDirectos, fijarHoy } from './_directos.mts';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'ficha-evento-v2');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');

const TORNEOS = (
  process.env.TORNEOS ??
  [
    'takamatsu:85f9a75e-7014-458c-9290-f18c1d3d73f8',
    'samsun-terminado:0a0f5913-7059-4c14-addc-323adeab3711',
    'medina-terminado:5564641d-700e-483a-a51c-c47e379dc5a9',
    // Terminado y sin nada vinculado: la banda de resultados no tiene que salir.
    'belgrado-sin-vinculo:8e4e3460-7ccf-4cb2-a7d3-5fecdecd9f1e',
  ].join(',')
)
  .split(',')
  .map((t) => t.split(':') as [string, string]);

const VINCULOS = (
  process.env.VINCULOS ??
  [
    '91cfc2f8-50e1-43d5-872d-c4e9b96c77f8:0a0f5913-7059-4c14-addc-323adeab3711',
    'ce277afb-7287-4265-996e-95a8c814884c:5564641d-700e-483a-a51c-c47e379dc5a9',
  ].join(',')
)
  .split(',')
  .filter(Boolean)
  .map((v) => v.split(':') as [string, string]);

const sqlite = new DatabaseSync(BASE, { readOnly: true });
fijarHoy();
aplicarDirectos(sqlite);
// Una tabla temporal con el mismo nombre tapa a la de la base en esta conexión.
sqlite.exec('CREATE TEMP TABLE sport_edition AS SELECT * FROM main.sport_edition');
for (const [edicion, evento] of VINCULOS) {
  sqlite.prepare('UPDATE temp.sport_edition SET event_id = ? WHERE id = ?').run(evento, edicion);
}

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
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
// `@/db` resuelve el binding de OpenNext en cada acceso: se le da este.
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: binding }, cf: {}, ctx: {} };
const ctx = { ...crearContexto().ctx, db: createD1Database(binding) };

const { getEvent } = await import('@/lib/queries/calendar');
const { cargarPodiosEvento } = await import('@/lib/queries/evento-resultados');
const { FichaEvento } = await import('@/components/calendario/ficha-evento');
const { CabeceraFicha } = await import('@/components/calendario/cabecera-ficha');
const { CuerpoPodios } = await import('@/components/calendario/ficha/resultados-torneo');
const { torneoTerminado } = await import('@/components/calendario/ficha/terminado');
const { Sheet } = await import('@/components/ui/sheet');

async function compilarCss(): Promise<string> {
  const origen = path.join(RAIZ, 'src', 'app', 'globals.css');
  const r = await postcss([tailwind({ base: RAIZ })]).process(readFileSync(origen, 'utf8'), { from: origen });
  return r.css;
}

/** La raíz de `FichaEvento`; la banda de resultados va antes de su primera `<section>`. */
const RAIZ_FICHA = 'class="flex flex-col gap-4 px-4 pt-2 pb-10"';

function documento(css: string, cuerpo: string): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<style>body{--font-display:'Barlow Condensed';--font-sans-ui:'Inter'}</style>
</head><body class="antialiased bg-muted/30"><div class="ml-auto min-h-screen w-full bg-background sm:max-w-xl sm:border-l">${cuerpo}</div></body></html>`;
}

async function pagina(id: string): Promise<string> {
  const evento = await getEvent(id);
  if (!evento) throw new Error(`no existe el torneo ${id}`);
  let html = renderToStaticMarkup(
    React.createElement(
      Sheet,
      { open: true },
      React.createElement(CabeceraFicha, { evento }),
      React.createElement(FichaEvento, {
        evento,
        tirador: null,
        // La lista de inscritos exige sesión: aquí se pinta vacía.
        inscritos: { oficiales: [], estados: {}, pendientes: [] },
      }),
    ),
  );
  if (torneoTerminado(evento)) {
    const vista = await cargarPodiosEvento(ctx, id);
    const podios = renderToStaticMarkup(React.createElement(CuerpoPodios, { vista }));
    const raiz = html.indexOf(RAIZ_FICHA);
    const hueco = raiz < 0 ? -1 : html.indexOf('<section', raiz);
    if (hueco < 0) throw new Error('no se encontró dónde va la banda de resultados');
    html = html.slice(0, hueco) + podios + html.slice(hueco);
    const n = vista.tipo === 'ok' ? Object.keys(vista.podios).length : 0;
    console.log(`  ${id.slice(0, 8)} terminado · ${vista.tipo} · podios: ${n}`);
  }
  return html;
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const html = new Map<string, string>();
for (const [nombre, id] of TORNEOS) html.set(`/${nombre}`, documento(css, await pagina(id)));

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

const BANDAS: [clave: string, selector: string][] = [
  ['resultados', 'section[aria-labelledby="resultados-torneo"]'],
  ['inscripcion', 'section:has(> header > h3:text-is("Inscripción"))'],
  ['donde', 'section:has(> header > h3:text-is("Dónde y cuándo"))'],
  ['convocatoria', 'section:has(> header > h3:text-is("Convocatoria"))'],
];

const capturas: string[] = [];
let desbordes = 0;
for (const [nombre] of TORNEOS) {
  for (const a of anchos) {
    const p = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala, timezoneId: 'Europe/Madrid', locale: 'es-ES' });
    await p.goto(`http://127.0.0.1:${puerto}/${nombre}`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (desborde > 0) {
      desbordes += 1;
      console.warn(`  ${nombre} @${a.sufijo}: desborda ${desborde}px en horizontal`);
    }
    const destino = path.join(SALIDA, `${nombre}-${a.sufijo}.png`);
    await p.screenshot({ path: destino, fullPage: true });
    capturas.push(path.relative(RAIZ, destino));
    // Y cada banda por separado: la página entera en un móvil mide cinco
    // pantallas y a ese tamaño no se juzga nada.
    for (const [clave, selector] of BANDAS) {
      const banda = p.locator(selector).first();
      if ((await banda.count()) === 0) continue;
      const archivo = path.join(SALIDA, `${nombre}-${a.sufijo}-${clave}.png`);
      await banda.screenshot({ path: archivo });
      capturas.push(path.relative(RAIZ, archivo));
    }
    await p.close();
  }
}
await navegador.close();
servidor.close();

console.log(capturas.join('\n'));
if (desbordes > 0) process.exitCode = 1;
