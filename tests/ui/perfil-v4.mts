/**
 * Capturas sin servidor del perfil v4: Resultados (Todo / Internacional /
 * Nacional, mejores competiciones e historial completo), el bloque Comparar
 * con sugerencias reales abiertas y el cara a cara con todos los cruces.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/perfil-v4.mts
 *
 * Igual que `perfil-v3.mts`: la copia se abre en sólo lectura, se usan los
 * cargadores de las páginas y se pinta con `renderToStaticMarkup` y el CSS
 * compilado. Salida en `capturas/perfil-v4/`, a 393 y 1440 px.
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
import { CabeceraCaraACara, CaraACaraCompleto, ElegirRival } from '@/components/explorar/cara-a-cara';
import { FichaCompleta, VolverAExplorar } from '@/components/explorar/ficha-deportiva';
import { CompararPerfil } from '@/components/explorar/perfil/comparar-perfil';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { leerCriteriosCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS, type CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';

const RAIZ = process.cwd();
const SALIDA = path.join(RAIZ, 'capturas', 'perfil-v4');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = process.env.PERSONA_A ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
/** Ficha extranjera con muchos resultados internacionales. */
const PESADA = process.env.PERSONA_C ?? '513f3cc3-1eb1-4a69-868f-7ef24bef5657';
const BUSQUEDA = process.env.BUSQUEDA ?? 'ramirez';

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

async function paginaFicha(id: string, criterios: CriteriosFicha, nombre: string) {
  const vista = await medir(nombre, () => cargarFichaPantalla(ctx, id, criterios));
  if (vista.tipo !== 'ok') throw new Error(`ficha ${id}: ${vista.tipo}`);
  return {
    vista,
    elemento: React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
      React.createElement(VolverAExplorar, { volver: '' }),
      React.createElement(FichaCompleta, {
        ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${id}`, criterios, nivel: 'pagina',
      })),
  };
}

async function paginaComparar(id: string) {
  const { vista } = await paginaFicha(id, CRITERIOS_FICHA_VACIOS, 'ficha (para comparar)');
  const sugerencias = await medir(`sugerencias «${BUSQUEDA}»`, () => sugerirPersonas(ctx, { q: BUSQUEDA }));
  if (sugerencias.estado !== 'ok') throw new Error(`sugerencias: ${sugerencias.estado}`);
  const rapidos = (vista.ficha.perfil?.rivales ?? []).slice(0, 5)
    .map(({ id: r, nombre, pais, asaltos, victorias, derrotas }) => ({ id: r, nombre, pais, asaltos, victorias, derrotas }));
  return React.createElement('div', { className: 'flex min-w-0 flex-col gap-4 pb-96' },
    React.createElement(CompararPerfil, {
      personaId: id, nombre: vista.ficha.nombre, rapidos, encabezado: 'h2',
      inicial: { texto: BUSQUEDA, items: sugerencias.items.filter((s) => s.id !== id).slice(0, 6) },
    }));
}

async function paginaCaraACara(id: string, rival: string) {
  const criterios = leerCriteriosCaraACara({ rival });
  const vista = await medir(`cara a cara ${id.slice(0, 8)}-${rival.slice(0, 8)}`, () => cargarCaraACaraPantalla(ctx, id, criterios));
  if (vista.tipo !== 'ok') throw new Error(`cara a cara: ${vista.tipo}`);
  return React.createElement('div', { className: 'flex flex-col gap-6' },
    React.createElement(CabeceraCaraACara, { datos: vista.datos, criterios }),
    React.createElement(CaraACaraCompleto, { datos: vista.datos, criterios }));
}

async function paginaElegir(id: string) {
  const criterios = leerCriteriosCaraACara({});
  const vista = await medir(`elegir ${id.slice(0, 8)}`, () => cargarCaraACaraPantalla(ctx, id, criterios));
  if (vista.tipo !== 'elegir') throw new Error(`elegir: ${vista.tipo}`);
  return {
    rival: vista.rivales.items[0]?.id ?? null,
    elemento: React.createElement(ElegirRival, { persona: vista.persona, rivales: vista.rivales, otros: vista.otros, criterios }),
  };
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

type Pagina = { nombre: string; html: string; tipo: 'ficha' | 'plana' | 'comparar' };
const paginas: Pagina[] = [];
for (const [clave, id] of [['zabala', ZABALA], ['pesada', PESADA]] as const) {
  paginas.push({ nombre: `ficha-${clave}`, tipo: 'ficha', html: documento(css, (await paginaFicha(id, CRITERIOS_FICHA_VACIOS, `ficha ${clave}`)).elemento) });
  for (const ambito of ['internacional', 'nacional'] as const) {
    paginas.push({
      nombre: `ficha-${clave}-${ambito}`, tipo: 'ficha',
      html: documento(css, (await paginaFicha(id, { ...CRITERIOS_FICHA_VACIOS, ambito }, `ficha ${clave} ${ambito}`)).elemento),
    });
  }
  paginas.push({
    nombre: `ficha-${clave}-ver-mas`, tipo: 'ficha',
    html: documento(css, (await paginaFicha(id, { ...CRITERIOS_FICHA_VACIOS, ver: 40 }, `ficha ${clave} ver=40`)).elemento),
  });
  const elegir = await paginaElegir(id);
  paginas.push({ nombre: `elegir-${clave}`, tipo: 'plana', html: documento(css, elegir.elemento) });
  if (elegir.rival) paginas.push({ nombre: `cara-a-cara-${clave}`, tipo: 'plana', html: documento(css, await paginaCaraACara(id, elegir.rival)) });
}
paginas.push({ nombre: 'comparar-zabala', tipo: 'comparar', html: documento(css, await paginaComparar(ZABALA)) });

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
    if (p.tipo === 'plana') {
      await foto(pagina, base);
      await foto(pagina, `${base}-completa`, true);
    } else if (p.tipo === 'comparar') {
      await foto(pagina, base);
    } else {
      await pestana(pagina, 'resultados');
      await irA(pagina, '[role="tablist"]');
      await foto(pagina, `${base}-resultados`);
      if (p.nombre.endsWith('-ver-mas')) {
        if (await irA(pagina, '#historial-completo')) await foto(pagina, `${base}-historial`);
      } else {
        await foto(pagina, `${base}-resultados-completa`, true);
      }
      if (!/-(internacional|nacional|ver-mas)$/.test(p.nombre)) {
        await pestana(pagina, 'rivales');
        await irA(pagina, '[role="tablist"]');
        await foto(pagina, `${base}-rivales`);
      }
    }
    await pagina.close();
  }
}
await navegador.close();
servidor.close();

console.table(tiempos);
console.log(capturas.join('\n'));
