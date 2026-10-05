/**
 * Capturas sin servidor de la ficha, el cara a cara y el buscador de Explorar
 * con datos reales.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/perfil-v2.mts
 *
 * Usa los mismos cargadores que las páginas (`cargarFichaPantalla`,
 * `cargarCaraACaraPantalla`, `cargarExplorar`, `sugerirPersonas`) sobre la
 * base abierta en sólo lectura, pinta los componentes con
 * `renderToStaticMarkup` y el CSS compilado de `globals.css`, y fotografía a
 * 393 y 1440 px en `capturas/perfil-v2/`. Sin JavaScript en la página: el
 * favorito es una réplica estática y las pestañas se cambian tocando
 * `data-state` desde Playwright. La foto FIE no se pide (es de cliente): sale
 * con iniciales.
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
import { Star } from 'lucide-react';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FichaCompleta, VolverAExplorar } from '@/components/explorar/ficha-deportiva';
import { CabeceraCaraACara, CaraACaraCompleto } from '@/components/explorar/cara-a-cara';
import { ContenidoSugerencia } from '@/components/explorar/buscador-personas';
import { ListaDeportistas } from '@/components/explorar/resultados';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { leerCriteriosCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { leerCriterios, RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'perfil-v2');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = process.env.PERSONA_A ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RAMIREZ = process.env.PERSONA_B ?? '58671832-da43-4fc9-bafa-4354747a347e';
const BUSCAR = process.env.BUSCAR ?? 'zabala';

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
const ctx = { ...crearContexto().ctx, db: createD1Database(binding) };

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

const favorito = React.createElement(
  Button,
  { type: 'button', variant: 'outline', className: 'min-h-11 w-full px-2 sm:px-4', 'aria-pressed': false },
  React.createElement(Star, { className: 'size-4', 'aria-hidden': true }),
  'Favorito',
);

async function paginaFicha(id: string) {
  const vista = await medir(`ficha ${id.slice(0, 8)}`, () => cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS));
  if (vista.tipo !== 'ok') throw new Error(`ficha ${id}: ${vista.tipo}`);
  return React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
    React.createElement(VolverAExplorar, { volver: '' }),
    React.createElement(FichaCompleta, {
      ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${id}`,
      criterios: CRITERIOS_FICHA_VACIOS, nivel: 'pagina', acciones: favorito,
    }));
}

async function paginaCaraACara(yo: string, rival: string) {
  const criterios = leerCriteriosCaraACara({ rival });
  const vista = await medir(`h2h ${yo.slice(0, 8)}`, () => cargarCaraACaraPantalla(ctx, yo, criterios));
  if (vista.tipo !== 'ok') throw new Error(`h2h ${yo}: ${vista.tipo}`);
  return {
    resumen: vista.datos.resumen,
    elemento: React.createElement('div', { className: 'flex flex-col gap-6' },
      React.createElement(CabeceraCaraACara, { datos: vista.datos, criterios }),
      React.createElement(CaraACaraCompleto, { datos: vista.datos, criterios })),
  };
}

async function paginaBuscar(q: string) {
  const { criterios, cursor } = leerCriterios({ q });
  const [vista, sugeridas] = await Promise.all([
    medir('buscar', () => cargarExplorar(ctx, criterios, cursor)),
    medir('sugerencias', () => sugerirPersonas(ctx, { q })),
  ]);
  if (vista.tipo !== 'ok' || sugeridas.estado !== 'ok') throw new Error(`buscar: ${vista.tipo}`);
  // Réplica estática del desplegable abierto: mismo contenido y mismas clases que `BuscadorPersonas`.
  const desplegable = React.createElement('div', { className: 'relative flex min-w-0 flex-col gap-1.5 pb-[26rem]' },
    React.createElement(Input, { className: 'min-h-11 bg-secondary pr-12 pl-8', defaultValue: q, 'aria-label': 'Nombre o alias' }),
    React.createElement('ul', {
      role: 'listbox', 'aria-label': 'Fichas con nombres parecidos',
      className: 'absolute top-12 right-0 left-0 z-30 mt-1 max-h-96 overflow-y-auto rounded-md border bg-popover text-popover-foreground',
    }, sugeridas.items.map((p, i) => React.createElement('li', { key: p.id, role: 'presentation' },
      React.createElement(Button, {
        type: 'button', variant: 'ghost', role: 'option', 'aria-selected': i === 0,
        className: `h-auto min-h-11 w-full justify-start rounded-none border-b px-3 py-2 text-left whitespace-normal ${i === 0 ? 'bg-accent text-accent-foreground' : ''}`,
      }, React.createElement(ContenidoSugerencia, { p }))))));
  return {
    lista: React.createElement(ListaDeportistas, { items: vista.items, siguiente: vista.siguiente, cursorActual: cursor, criterios }),
    desplegable,
  };
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const paginas: { nombre: string; html: string; pestanas?: boolean }[] = [];
paginas.push({ nombre: 'ficha-zabala', html: documento(css, await paginaFicha(ZABALA)), pestanas: true });
paginas.push({ nombre: 'ficha-ramirez', html: documento(css, await paginaFicha(RAMIREZ)), pestanas: true });
const ida = await paginaCaraACara(ZABALA, RAMIREZ);
const vuelta = await paginaCaraACara(RAMIREZ, ZABALA);
paginas.push({ nombre: 'h2h-zabala-ramirez', html: documento(css, ida.elemento) });
paginas.push({ nombre: 'h2h-ramirez-zabala', html: documento(css, vuelta.elemento) });
const busqueda = await paginaBuscar(BUSCAR);
paginas.push({ nombre: 'buscar-lista', html: documento(css, busqueda.lista) });
paginas.push({ nombre: 'buscar-desplegable', html: documento(css, busqueda.desplegable) });

// Un servidor mínimo: las banderas se piden como `/banderas/xx.png` y desde
// file:// esa ruta absoluta no llega a `public/`.
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
for (const p of paginas) {
  for (const a of anchos) {
    const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready);
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (desborde > 0) console.warn(`  ${p.nombre} @${a.sufijo}: desborda ${desborde}px en horizontal`);
    await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}.png`), fullPage: !p.pestanas && !p.nombre.startsWith('h2h') });
    if (p.nombre.startsWith('h2h')) {
      await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}-completa.png`), fullPage: true });
      await pagina.evaluate(() => { document.getElementById('h2h-asaltos')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); });
      await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}-asaltos.png`) });
    }
    if (p.pestanas) {
      await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}-completa.png`), fullPage: true });
      const sugeridos = await pagina.$('#ficha-sugeridos');
      if (sugeridos) {
        await sugeridos.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); });
        await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}-sugeridos.png`) });
      }
      for (const pestana of ['resultados', 'temporadas', 'rivales']) {
        await pagina.evaluate((valor) => {
          for (const el of document.querySelectorAll<HTMLElement>('[role="tab"], [role="tabpanel"]')) {
            const propio = el.getAttribute('role') === 'tab'
              ? el.id.endsWith(`-trigger-${valor}`)
              : el.id.endsWith(`-content-${valor}`);
            el.dataset.state = propio ? 'active' : 'inactive';
            if (el.getAttribute('role') === 'tab') el.setAttribute('aria-selected', String(propio));
          }
        }, pestana);
        await pagina.evaluate(() => {
          document.querySelector('[role="tablist"]')?.scrollIntoView({ block: 'start' });
          window.scrollBy(0, -24);
        });
        // El subrayado de la pestaña tiene transición de opacidad.
        await pagina.waitForTimeout(250);
        await pagina.screenshot({ path: path.join(SALIDA, `${p.nombre}-${a.sufijo}-${pestana}.png`) });
      }
    }
    await pagina.close();
  }
}
await navegador.close();
servidor.close();

console.log('Simetría del cara a cara:',
  `ida ${ida.resumen.victorias}-${ida.resumen.derrotas} (${ida.resumen.tantosFavor}-${ida.resumen.tantosContra}),`,
  `vuelta ${vuelta.resumen.victorias}-${vuelta.resumen.derrotas} (${vuelta.resumen.tantosFavor}-${vuelta.resumen.tantosContra})`);
console.table(tiempos);
console.log(`Capturas en ${SALIDA}`);
