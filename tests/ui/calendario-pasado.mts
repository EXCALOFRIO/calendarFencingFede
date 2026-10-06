/**
 * Capturas sin servidor del calendario hacia atrás: un mes ya pasado con los
 * torneos del calendario («Terminada», ganador y «Resultados») y un mes de 2019,
 * que solo existe en Explorar.
 *
 *   PERF_DB=<ruta a una copia SQLite de D1> npx tsx tests/ui/calendario-pasado.mts
 *
 * Como `perfil-v4.mts`: la copia se abre en solo lectura, se usan los mismos
 * cargadores que la página (`listEvents` y `cargarTramoPasado`, con el `db` de
 * la aplicación apuntando a la copia) y se pinta con `renderToStaticMarkup` y el
 * CSS compilado. Salida en `capturas/calendario-pasado/`, a 393 y 1440 px.
 * Falla si a 393 px hay desplazamiento horizontal.
 *
 * MESES=2026-09,2019-03 elige los meses; VISTA=trimestre, la vista.
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
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { VistaCalendario } from '@/components/calendario/vista';
import { ResultadosPasados } from '@/components/calendario/pasado/resultados-pasados';
import { hoyMadrid } from '@/lib/callups/fechas';
import { listEvents, type Scope } from '@/lib/queries/calendar';
import { cargarTramoPasado, edicionesExplorarDeEvento } from '@/lib/queries/calendario-pasado';
import { tramoDeMeses, tramoPasadoDe } from '@/lib/queries/calendario-pasado-tramo';
import { aplicarDirectos, fijarHoy } from './_directos.mts';

const RAIZ = process.cwd();
const SALIDA = carpetaCapturas(RAIZ, 'calendario-pasado');
const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const MESES = (process.env.MESES ?? '2026-09,2019-03').split(',');
const VISTA = process.env.VISTA === 'trimestre' ? 'trimestre' : 'mes';
const SCOPE: Scope[] = ['NACIONAL', 'INTERNACIONAL'];

const sqlite = new DatabaseSync(BASE, { readOnly: true });
fijarHoy();
aplicarDirectos(sqlite);
let consultas = 0;

function valor(v: unknown): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
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
// El `db` perezoso de la aplicación lee el binding de aquí (ver `resolveD1Binding`).
(globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = {
  env: { DB: binding },
  cf: {},
  ctx: { waitUntil: () => {} },
};

const tiempos: { carga: string; ms: number; consultas: number }[] = [];
async function medir<T>(carga: string, f: () => Promise<T>): Promise<T> {
  const antes = consultas;
  const t = performance.now();
  const r = await f();
  tiempos.push({ carga, ms: Math.round(performance.now() - t), consultas: consultas - antes });
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
</head><body class="antialiased"><main class="ancho-app flex min-h-dvh flex-1 flex-col px-4 py-4">${renderToStaticMarkup(cuerpo)}</main></body></html>`;
}

// EVENTOS=<id,id> solo mide `edicionesExplorarDeEvento` y sale, sin capturas.
if (process.env.EVENTOS) {
  for (const id of process.env.EVENTOS.split(',')) {
    const ediciones = await medir(`evento ${id.slice(0, 8)}`, () => edicionesExplorarDeEvento(id));
    console.log(id, ediciones.map((e) => `${e.fuente} ${e.nombre} (${e.pruebas.length} pruebas, ${e.pruebas.filter((p) => p.conResultados).length} con resultados)`));
  }
  console.table(tiempos);
  process.exit(0);
}

const hoy = hoyMadrid();
const css = await compilarCss();
mkdirSync(SALIDA, { recursive: true });

const eventos = await medir('calendario de hoy en adelante', () => listEvents({ limit: 500, scope: SCOPE }));
const sinAccion = async () => {
  throw new Error('sin servidor');
};

type Pagina = { nombre: string; html: string };
const paginas: Pagina[] = [];
const resumen: Record<string, unknown>[] = [];

for (const mes of MESES) {
  const [anio, m] = mes.split('-').map(Number);
  const t = tramoDeMeses(anio, m - 1, VISTA === 'mes' ? 1 : 3);
  const pasado = tramoPasadoDe(t.desde, t.hasta, hoy);
  const tramo = pasado
    ? await medir(`tramo ${pasado.desde} → ${pasado.hasta}`, () => cargarTramoPasado({ ...pasado, hoy, scope: SCOPE }))
    : null;
  const conResultados = tramo
    ? Object.values(tramo.resultados).filter((ps) => ps.some((p) => p.conResultados)).length
    : 0;
  resumen.push({
    mes,
    calendario: tramo ? tramo.eventos.length - tramo.importados.length : 0,
    importados: tramo?.importados.length ?? 0,
    conResultados,
    kB: tramo ? Math.round(JSON.stringify(tramo).length / 1024) : 0,
  });

  paginas.push({
    nombre: `${mes}-${VISTA}`,
    html: documento(
      css,
      React.createElement(VistaCalendario, {
        inicial: { vista: VISTA, mes },
        eventos,
        perfil: { role: 'admin', weapons: [] },
        tiradores: [],
        inscripciones: {},
        temporada: '2026-2027',
        actualizado: null,
        solicitarInscripcion: sinAccion,
        cargarInscritos: sinAccion,
        pasadoInicial: tramo,
        cargarPasado: sinAccion,
      }),
    ),
  });

  // La hoja de resultados del torneo con más pruebas, pintada sola: en la
  // página va dentro de un `Sheet` cerrado y el marcado estático no la abre.
  if (tramo) {
    const elegido = [...tramo.eventos]
      .filter((e) => (tramo.resultados[e.id] ?? []).some((p) => p.conResultados))
      .sort((a, b) => (tramo.resultados[b.id]?.length ?? 0) - (tramo.resultados[a.id]?.length ?? 0))[0];
    if (elegido) {
      paginas.push({
        nombre: `${mes}-resultados`,
        html: documento(
          css,
          React.createElement(
            'div',
            { className: 'mx-auto w-full max-w-xl rounded-lg border border-filete bg-background' },
            React.createElement('p', { className: 'px-4 pt-4 text-2xl' }, elegido.name),
            React.createElement(ResultadosPasados, {
              evento: elegido,
              pruebas: tramo.resultados[elegido.id] ?? [],
              retorno: `/?vista=mes&mes=${mes}`,
              onAbrirFicha: tramo.importados.includes(elegido.id) ? undefined : () => {},
            }),
          ),
        ),
      });
    }
  }
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

const capturas: string[] = [];
const desbordes: string[] = [];
for (const p of paginas) {
  for (const a of anchos) {
    const pagina = await navegador.newPage({ viewport: a.viewport, deviceScaleFactor: a.escala });
    await pagina.goto(`http://127.0.0.1:${puerto}/${p.nombre}`, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready);
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (desborde > 0) desbordes.push(`${p.nombre} @${a.sufijo}: ${desborde}px`);
    const medidas = await pagina.evaluate(() => ({
      terminadas: document.querySelectorAll('[data-terminado]').length,
      conResultados: document.querySelectorAll('[data-resultados]').length,
      vacios: [...document.querySelectorAll('p')].filter((x) => /Sin competiciones cargadas/.test(x.textContent ?? '') && (x as HTMLElement).offsetParent !== null).length,
    }));
    console.log(`${p.nombre} @${a.sufijo}`, medidas);
    for (const completa of [false, true]) {
      const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}${completa ? '-completa' : ''}.png`);
      await pagina.screenshot({ path: destino, fullPage: completa });
      capturas.push(path.relative(RAIZ, destino));
    }
    // Con DIRECTOS, además, las tarjetas que llevan pastilla de directo, sueltas.
    if (process.env.DIRECTOS) {
      const enVivo = pagina.locator('article:has([data-directo="directo"]):visible');
      const despues = pagina.locator('article:has([data-directo="resultados"]):visible');
      const elegidas = [
        ...(await enVivo.count()) > 0 ? [['vivo', enVivo.first()] as const] : [],
        ...(await despues.count()) > 0 ? [['resultados', despues.first()] as const] : [],
      ];
      for (const [clave, tarjeta] of elegidas) {
        const destino = path.join(SALIDA, `${p.nombre}-${a.sufijo}-directo-${clave}.png`);
        await tarjeta.screenshot({ path: destino });
        capturas.push(path.relative(RAIZ, destino));
      }
    }
    await pagina.close();
  }
}
await navegador.close();
servidor.close();

console.table(tiempos);
console.table(resumen);
console.log(capturas.join('\n'));
if (desbordes.some((d) => d.includes('@393') || d.includes('@320'))) {
  console.error(`Desplazamiento horizontal a 393 px:\n${desbordes.join('\n')}`);
  process.exit(1);
}
