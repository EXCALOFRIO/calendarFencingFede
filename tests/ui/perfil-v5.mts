/**
 * Capturas sin servidor del perfil v5 (/explorar/[personaId]): cabecera con
 * medallas de color, Resultados con buscador y filtros, Estadísticas por
 * categoría y Rivales, a 393 y 1440 px. A 393 px falla si la página se
 * desborda en horizontal en cualquiera de las pestañas.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/perfil-v5.mts
 *
 * Igual que `perfil-v4.mts`: la copia se abre en sólo lectura, se usan los
 * cargadores de la página y se pinta con `renderToStaticMarkup` y el CSS
 * compilado. Salida en `capturas/perfil-v5/`.
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
import { ControlFavoritoFicha } from '@/components/explorar/favoritos';
import { FichaCompleta } from '@/components/explorar/ficha-deportiva';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS, type CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { crearContexto } from '../helpers/explorar';
import { anchosCapturas, carpetaCapturas, ES_MOVIL } from './pasada.mts';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'perfil-v5');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ZABALA = process.env.PERSONA_A ?? '8bf5062e-5677-4540-b2bc-1ae911cda424';
/** Muchos resultados FIE y nacionales, zurdo, con código de club. */
const LLAVADOR = process.env.PERSONA_C ?? 'b40372bf-0b56-4faf-a603-4e0b7f351739';

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

async function paginaFicha(id: string, criterios: CriteriosFicha) {
  const [vista, extras] = await Promise.all([cargarFichaPantalla(ctx, id, criterios), cargarExtrasPerfil(ctx, id)]);
  if (vista.tipo !== 'ok') throw new Error(`ficha ${id}: ${vista.tipo}`);
  return React.createElement('div', { className: 'flex min-w-0 flex-col gap-4' },
    React.createElement(FichaCompleta, {
      ficha: vista.ficha, historial: vista.historial, base: `${RUTA_EXPLORAR}/${id}`, criterios, nivel: 'pagina', extras,
      acciones: React.createElement(ControlFavoritoFicha, {
        estado: { tipo: 'ok', favorito: false, personaId: id }, nombre: vista.ficha.nombre, reintentar: '#',
      }),
    }));
}

const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const paginas: { nombre: string; html: string }[] = [];
for (const [clave, id] of [['zabala', ZABALA], ['llavador', LLAVADOR]] as const) {
  paginas.push({ nombre: `ficha-${clave}`, html: documento(css, await paginaFicha(id, CRITERIOS_FICHA_VACIOS)) });
}

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
const anchos = anchosCapturas([
  { sufijo: '393', viewport: { width: 393, height: 852 }, escala: 2 },
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, escala: 1 },
]);

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

const capturas: string[] = [];
const desbordes: string[] = [];
for (const p of paginas) {
  for (const a of anchos) {
    const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready);
    for (const tab of ['resultados', 'estadisticas', 'rivales']) {
      await pestana(pagina, tab);
      const ancho = await pagina.evaluate(() => document.scrollingElement!.scrollWidth);
      if (ES_MOVIL(a.viewport.width) && ancho > a.viewport.width) {
        const culpables = await pagina.evaluate((w) => [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.offsetParent !== null)
          .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 80)}`), a.viewport.width);
        desbordes.push(`${p.nombre} ${tab} @${a.viewport.width}: scrollWidth ${ancho}\n    ${culpables.join('\n    ')}`);
      }
      if (tab === 'resultados') {
        // Un <select> no desborda en scrollWidth: se mide el rótulo elegido contra su hueco.
        const cortados = await pagina.evaluate(() => [...document.querySelectorAll<HTMLSelectElement>('#historial-completo select')]
          .map((s) => {
            const e = getComputedStyle(s);
            const c = document.createElement('canvas').getContext('2d')!;
            c.font = `${e.fontWeight} ${e.fontSize} ${e.fontFamily}`;
            const hueco = s.clientWidth - parseFloat(e.paddingLeft) - parseFloat(e.paddingRight);
            const texto = s.selectedOptions[0]?.text ?? '';
            const ancho = c.measureText(texto).width;
            return ancho > hueco ? `${texto} (${ancho.toFixed(1)} > ${hueco.toFixed(1)} px)` : '';
          })
          .filter(Boolean));
        if (cortados.length) desbordes.push(`${p.nombre} @${a.viewport.width}: filtro cortado: ${cortados.join(', ')}`);
        const rotulos = await pagina.evaluate(() => [...document.querySelectorAll<HTMLElement>(
          'header dl dt, nav .truncate, nav a, [role="tab"]',
        )]
          .filter((e) => e.offsetParent !== null && (e.scrollWidth > e.clientWidth + 1
            || (e.className.includes('line-clamp') && e.scrollHeight > e.clientHeight + 3)))
          .map((e) => (e.textContent ?? '').trim()));
        if (rotulos.length) desbordes.push(`${p.nombre} @${a.viewport.width}: rótulo cortado: ${rotulos.join(' | ')}`);
      }
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}-${tab}.png`);
      await pagina.screenshot({ path: destino, fullPage: true });
      capturas.push(path.relative(RAIZ, destino));
      // La página entera a 393 px es demasiado alta para revisarla de un vistazo: también por tramos.
      if (a.viewport.width < 768) {
        const alto = await pagina.evaluate(() => document.scrollingElement!.scrollHeight);
        const TRAMO = 1100;
        for (let i = 0; i * TRAMO < alto && i < 8; i++) {
          const tramo = path.join(SALIDA, `${p.nombre}-${a.sufijo}-${tab}-${i + 1}.png`);
          await pagina.screenshot({
            path: tramo, fullPage: true,
            clip: { x: 0, y: i * TRAMO, width: a.viewport.width, height: Math.min(TRAMO, alto - i * TRAMO) },
          });
          capturas.push(path.relative(RAIZ, tramo));
        }
      }
    }
    await pagina.close();
  }
}
await navegador.close();
servidor.close();

console.log(capturas.join('\n'));
if (desbordes.length > 0) {
  console.error(`Desbordes horizontales:\n${desbordes.join('\n')}`);
  process.exitCode = 1;
}
