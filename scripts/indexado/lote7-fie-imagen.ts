/**
 * Poules y cuadro de pruebas FIE cuya única publicación es un PDF de Fencing
 * Time impreso con «Microsoft Print to PDF»: las matrices de poule y los
 * cuadros son imagen, pero el PDF conserva una capa de texto parcial (lista de
 * cada poule en orden, tabla «Seeding for Round #2» con V, TS, TR e Ind de cada
 * tirador y la clasificación final).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-imagen.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-imagen.ts leer [--solo 2025-937,...] [--modelos gpt-6-luna,gpt-6-sol]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-imagen.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * Dos modelos distintos transcriben las imágenes (`droid exec`, sólo Read). Nada
 * del modelo se acepta si no:
 *  - Poule: las dos lecturas son idénticas; la matriz es recíproca (una V y una D
 *    menor o igual por pareja) y V, TS, TR e Ind impresos salen de los asaltos;
 *    los tiradores y su orden son los de la capa de texto de esa poule; y V, TS,
 *    TR e Ind de cada tirador son los de la tabla de texto «Seeding for Round #2».
 *  - Cuadro: cada asalto (dos casillas de una columna y la casilla del ganador en
 *    la siguiente) es idéntico en las dos lecturas; el ganador es uno de los dos;
 *    el marcador va del ganador al perdedor (≤ 15); la cabeza de serie de cada
 *    casilla es la posición del tirador en «Seeding for Round #2»; el perdedor de
 *    la ronda de N tiene en la clasificación final un puesto entre N/2+1 y N; y
 *    la columna «Table of 8» del cuadro grande coincide con la del cuadro de 8.
 * Lo que no cumple se descarta y la fase queda `parcial`. Las referencias son
 * siempre las `source_fact_key` de la clasificación de la prueba.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { abrirBase, puestosDeBase } from './fie-completar-comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, enCache, obtener, SALIDA_LOTE7 } from './lote7-fie-red';
import { compacto, extraerJson, lanzarDroid, textoPdf } from './pdf-droids';

type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];

const CRUDOS = join(CARPETA_LOTE7, 'imagen-raw');
const TRABAJO = join(CARPETA_LOTE7, 'imagen-work');
const INFORME = join(CARPETA_LOTE7, 'imagen-informe.json');

/** PDF Fencing Time de la EFC sin XML capturado (Antalya 2025, ids EFC 3809–3816). */
export const OBJETIVOS: { season: string; competitionKey: string; url: string; efc: string }[] = [
  { season: '2025', competitionKey: '937', efc: '3814', url: "https://efc-prod.s3.amazonaws.com/documents/tur/bib/shd/Women's Epee.pdf" },
  { season: '2025', competitionKey: '938', efc: '3812', url: "https://efc-prod.s3.amazonaws.com/documents/tur/jpr/hth/Men's Epee.pdf" },
  { season: '2025', competitionKey: '939', efc: '3813', url: "https://efc-prod.s3.amazonaws.com/documents/tur/gmv/nkz/Women's Foil.pdf" },
  { season: '2025', competitionKey: '940', efc: '3816', url: "https://efc-prod.s3.amazonaws.com/documents/tur/hkb/ror/Men's Foil.pdf" },
  { season: '2025', competitionKey: '941', efc: '3809', url: "https://efc-prod.s3.amazonaws.com/documents/tur/cod/jqz/Women's Saber ind.pdf" },
  { season: '2025', competitionKey: '942', efc: '3815', url: "https://efc-prod.s3.amazonaws.com/documents/tur/xgn/fmh/Men's Saber.pdf" },
];
const urlDescarga = (u: string) => encodeURI(u);

// ---------------------------------------------------------------- capa de texto

export type FilaSeeding = { seed: number; nombre: string; pais: string; v: number; ts: number; tr: number; ind: number };
export type CapaTexto = {
  poules: { nombre: string; pais: string }[][];
  seeding: FilaSeeding[];
  clasificacion: { puesto: number; nombre: string; pais: string }[];
  arma: 'ESPADA' | 'FLORETE' | 'SABLE' | null;
  genero: 'M' | 'F' | null;
};

const PAIS = /^(.+?) ([A-Z]{3})$/;

export function capaDeTexto(paginas: readonly string[], titulo = ''): CapaTexto {
  const poules: { nombre: string; pais: string }[][] = [];
  const seeding: FilaSeeding[] = [];
  const clasificacion: CapaTexto['clasificacion'] = [];
  for (const pagina of paginas) {
    const lineas = pagina.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lineas.includes('Referee(s):') && !lineas.some((l) => /^Table of \d+$/.test(l))) {
      let actual: { nombre: string; pais: string }[] | null = null;
      let arbitros = false;
      for (const l of lineas) {
        if (/^Strip\b/.test(l)) {
          actual = [];
          poules.push(actual);
          arbitros = false;
          continue;
        }
        if (l === 'Referee(s):') {
          arbitros = true;
          continue;
        }
        if (!actual) continue;
        if (arbitros && /\([A-Z]{3}\)$/.test(l)) continue;
        arbitros = false;
        const m = PAIS.exec(l);
        if (m) actual.push({ nombre: m[1], pais: m[2] });
      }
      continue;
    }
    if (lineas.some((l) => /V V\/M TS TR Ind/.test(l))) {
      for (const l of lineas) {
        const m = /^(\d+)T? (.+) ([A-Z]{3}) (\d+) (\d,\d\d) (\d+) (\d+) ([+-]?\d+)\b/.exec(l);
        if (m) seeding.push({ seed: seeding.length + 1, nombre: m[2], pais: m[3], v: +m[4], ts: +m[6], tr: +m[7], ind: +m[8] });
      }
      continue;
    }
    if (lineas.some((l) => /^Place Name Country/.test(l))) {
      for (const l of lineas) {
        const m = /^(\d+)T? (.+) ([A-Z]{3})(?: \d\d\/\d\d\/\d{4})?$/.exec(l);
        if (m) clasificacion.push({ puesto: +m[1], nombre: m[2], pais: m[3] });
      }
    }
  }
  const t = titulo.toLowerCase();
  const arma = /epee/.test(t) ? 'ESPADA' : /foil/.test(t) ? 'FLORETE' : /sab(re|er)/.test(t) ? 'SABLE' : null;
  const genero = /women/.test(t) ? 'F' : /\bmen/.test(t) ? 'M' : null;
  return { poules, seeding, clasificacion, arma, genero };
}

// ---------------------------------------------------------------- lectura de los modelos

export type PouleModelo = { pool: number; rows: { name: string; country: string; cells: string[]; v: string; vm: string; ts: string; tr: string; ind: string }[] };
export type Casilla = { seed: number | null; name: string; score: string | null };
export type PaginaCuadro = { bracket: number; columns: { table: number; slots: Casilla[] }[] };
export type LecturaModelo = { title: string; pools: PouleModelo[]; brackets: PaginaCuadro[] };

const PROMPT = `You are a data-extraction tool. Read, with your Read tool, EVERY one of these page images of a fencing results PDF, in this order:

{{IMAGENES}}

They are the pool sheets ("Round #1 Pool Results") and the direct-elimination brackets ("Round #2 - DE (Table of N)").

Copy everything EXACTLY as printed. Never correct, complete, compute or guess. If something is unreadable write "?".

Answer with ONE JSON object and nothing else:
{
  "title": string,                       // event name printed at the top, e.g. "Cadet Women's Epee"
  "pools": [                              // every pool of "Round #1 Pool Results", in order
    {
      "pool": number,                     // the big pool number
      "rows": [                           // every row, top to bottom
        {
          "name": string,                 // as printed in the Name column
          "country": string,              // Affiliation column
          "cells": [string],              // one string per numbered column 1..n, INCLUDING the grey diagonal cell as "", e.g. ["", "V4", "V3", "D3", ...]
          "v": string, "vm": string, "ts": string, "tr": string, "ind": string   // V, V/M, TS, TR, Ind as printed
        }
      ]
    }
  ],
  "brackets": [                           // one entry per bracket PAGE, in page order
    {
      "bracket": number,                  // N of "(Table of N)" in the page title
      "columns": [                        // every column of the page, left to right ("Table of 128", ..., "Table of 8", "Semi-Finals" = 4, "Finals" = 2, and the final winner line at the far right = 1)
        {
          "table": number,                // 128, 64, 32, 16, 8, 4 (Semi-Finals), 2 (Finals), 1 (winner line)
          "slots": [                      // every name line of the column, top to bottom
            { "seed": number | null,      // the number in parentheses before the name, null if none
              "name": string,             // name as printed, "-BYE-" for a bye
              "score": string | null }    // the score printed just under the name, e.g. "15 - 6"; null if there is none
          ]
        }
      ]
    }
  ]
}`;

/** Páginas que son imagen en el PDF de Fencing Time: hojas de poule y cuadros (1 = primera). */
export function paginasImagen(paginas: readonly string[], tipo: 'todas' | 'poules' | 'cuadro' = 'todas'): number[] {
  return paginas.flatMap((t, i) => {
    const l = t.split(/\r?\n/).map((x) => x.trim());
    const poule = l.includes('Referee(s):') && !l.some((x) => /^Table of \d+$/.test(x));
    const cuadro = l.some((x) => /^Table of \d+$/.test(x)) && !l.some((x) => /^Place Name/.test(x));
    return (tipo !== 'cuadro' && poule) || (tipo !== 'poules' && cuadro) ? [i + 1] : [];
  });
}

/**
 * Lectura de un modelo: de una vez, o (si es la que hay en caché o si la de una
 * vez falla por tamaño) en dos llamadas, una con las poules y otra con el cuadro.
 */
async function leerConModelo(modelo: string, pdf: Uint8Array, paginas: readonly string[], clave: string, soloCache = false): Promise<LecturaModelo | null> {
  const entera = await leerParte(modelo, pdf, paginas, clave, 'todas', soloCache || existsSync(join(CRUDOS, `${clave}__${modelo}__poules.json`)));
  if (entera) return entera;
  const poules = await leerParte(modelo, pdf, paginas, clave, 'poules', soloCache);
  const cuadro = await leerParte(modelo, pdf, paginas, clave, 'cuadro', soloCache);
  if (!poules || !cuadro) return null;
  return { title: poules.title || cuadro.title, pools: poules.pools ?? [], brackets: cuadro.brackets ?? [] };
}

/** `droid exec` vivos en la máquina (de este u otros procesos). */
function droidsVivos(): number {
  const r = spawnSync('pwsh', ['-NoProfile', '-Command',
    "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'droid.* exec ' }).Count"], { windowsHide: true, encoding: 'utf8' });
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : 0;
}

/** El equipo es compartido: no se lanza un droid mientras haya ya tres vivos. */
async function esperarTurno(maximo = 3) {
  while (droidsVivos() >= maximo) await new Promise((ok) => setTimeout(ok, 30_000));
}

// `droid exec` no admite el PDF entero con Read («Exec failed»): se le dan las páginas en PNG.
export async function leerParte(modelo: string, pdf: Uint8Array, paginas: readonly string[], clave: string, tipo: 'todas' | 'poules' | 'cuadro', soloCache: boolean, etiqueta = ''): Promise<LecturaModelo | null> {
  const crudo = join(CRUDOS, `${clave}__${modelo}${tipo === 'todas' ? '' : `__${tipo}`}${etiqueta ? `__${etiqueta}` : ''}.json`);
  // Las lecturas repetidas van a más resolución: los errores de la primera son casillas pequeñas mal alineadas.
  const dpi = etiqueta ? '170' : '130';
  let stdout: string | null = existsSync(crudo) ? readFileSync(crudo, 'utf8') : null;
  if (stdout === null && (soloCache || existsSync(`${crudo}.fallo`))) return null;
  if (stdout === null) {
    const dir = join(TRABAJO, `${clave}__${modelo}__${tipo}${etiqueta}`);
    mkdirSync(dir, { recursive: true });
    const ruta = join(dir, 'documento.pdf');
    writeFileSync(ruta, pdf);
    const imagenes: string[] = [];
    for (const n of paginasImagen(paginas, tipo)) {
      const base = join(dir, `pagina-${String(n).padStart(2, '0')}`);
      let r = spawnSync('pdftoppm', ['-r', dpi, '-png', '-singlefile', '-f', String(n), '-l', String(n), ruta, base], { windowsHide: true });
      // El pdftoppm de MiKTeX falla de vez en cuando al arrancar; un segundo intento basta.
      for (let i = 0; i < 2 && r.status !== 0; i += 1) {
        r = spawnSync('pdftoppm', ['-r', dpi, '-png', '-singlefile', '-f', String(n), '-l', String(n), ruta, base], { windowsHide: true });
      }
      if (r.status !== 0) throw new Error(`pdftoppm falló en la página ${n}: ${r.error?.message ?? ''} ${String(r.stderr)}`);
      imagenes.push(`${base}.png`);
    }
    const prompt = join(dir, 'prompt.md');
    writeFileSync(prompt, PROMPT.replaceAll('{{IMAGENES}}', imagenes.map((x, i) => `${i + 1}. ${x}`).join('\n')), 'utf8');
    await esperarTurno();
    const r = await lanzarDroid(modelo, dir, prompt, 2_400_000);
    rmSync(dir, { recursive: true, force: true });
    if (!r.ok) {
      console.log(`  ${clave} ${modelo} ${tipo}: ${r.motivo} ${r.stdout.slice(-300)}`);
      // La lectura de una vez que falla no se repite: se pasa a leer poules y cuadro por separado.
      if (tipo === 'todas') writeFileSync(`${crudo}.fallo`, r.stdout, 'utf8');
      return null;
    }
    writeFileSync(crudo, r.stdout, 'utf8');
    stdout = r.stdout;
  }
  try {
    const sobre = JSON.parse(stdout) as { is_error?: boolean; result?: string };
    if (sobre.is_error || typeof sobre.result !== 'string') return null;
    return extraerJson(sobre.result) as LecturaModelo;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- validación

const s = (x: unknown) => String(x ?? '').trim();
const n = (x: unknown) => Number(s(x).replace(',', '.').replace(/^\+/, ''));

function celda(t: string): { v: boolean; toques: number } | null {
  const m = /^([VD])(\d{1,2})$/.exec(s(t).toUpperCase());
  return m ? { v: m[1] === 'V', toques: Number(m[2]) } : null;
}

const formaPoule = (p: PouleModelo) => JSON.stringify((p.rows ?? []).map((r) =>
  [compacto(s(r.name)), s(r.country), (r.cells ?? []).map((c) => s(c).toUpperCase()), n(r.v), n(r.vm), n(r.ts), n(r.tr), n(r.ind)]));

function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = t;
    }
  }
  return d[b.length];
}

/** El nombre de la capa de texto (`candidatos`) a ≤ 2 letras del leído, si es único; si no, el leído. */
function nombreDeTexto(leido: string, candidatos: readonly string[]): string {
  const k = compacto(leido);
  const exacto = candidatos.find((c) => compacto(c) === k);
  if (exacto) return exacto;
  const cerca = candidatos.filter((c) => distancia(compacto(c), k) <= 2);
  return cerca.length === 1 ? cerca[0] : leido;
}

/**
 * Los nombres sí están en la capa de texto del PDF y de ahí se toman: un
 * modelo que lee «Aleksija» por «Aleksiia» no debe tumbar una poule cuyas
 * celdas coinciden. Lo que sólo está en la imagen (celdas, totales,
 * marcadores) se sigue comparando tal cual. En el cuadro, fuera de la primera
 * columna el número entre paréntesis es el de la casilla y no se usa.
 */
export function normalizarNombres(l: LecturaModelo, capa: CapaTexto): LecturaModelo {
  const todos = capa.seeding.map((x) => x.nombre);
  const mayor = Math.max(0, ...(l.brackets ?? []).map((p) => n(p.bracket)));
  return {
    ...l,
    pools: (l.pools ?? []).map((q) => {
      const texto = (capa.poules[n(q.pool) - 1] ?? []).map((x) => x.nombre);
      return { ...q, rows: (q.rows ?? []).map((r) => ({ ...r, name: nombreDeTexto(s(r.name), texto) })) };
    }),
    brackets: (l.brackets ?? []).map((p) => ({
      ...p,
      columns: (p.columns ?? []).map((c) => ({
        ...c,
        slots: (c.slots ?? []).map((x) => ({
          ...x,
          seed: n(p.bracket) === mayor && n(c.table) === mayor ? x.seed : null,
          name: /BYE/i.test(s(x.name)) ? s(x.name) : nombreDeTexto(s(x.name), todos),
        })),
      })),
    })),
  };
}

/** Asaltos de una poule si cumple todas las comprobaciones; si no, el motivo. */
export function validarPoule(
  p: PouleModelo, otra: PouleModelo | undefined, texto: { nombre: string; pais: string }[] | undefined, seeding: Map<string, FilaSeeding>,
): { bouts: BoutLeido[] } | { motivo: string } {
  if (!otra || formaPoule(p) !== formaPoule(otra)) return { motivo: 'lecturas_distintas' };
  const filas = p.rows ?? [];
  const k = filas.length;
  if (k < 3 || filas.some((r) => (r.cells ?? []).length !== k)) return { motivo: 'matriz_no_cuadrada' };
  if (!texto || texto.length !== k || texto.some((t, i) => compacto(t.nombre) !== compacto(s(filas[i].name)) || t.pais !== s(filas[i].country))) {
    return { motivo: 'tiradores_distintos_de_la_capa_de_texto' };
  }
  const tot = filas.map(() => ({ v: 0, ts: 0, tr: 0 }));
  const bouts: BoutLeido[] = [];
  for (let i = 0; i < k; i += 1) {
    if (s(filas[i].cells[i]) !== '') return { motivo: 'diagonal_no_vacia' };
    for (let j = i + 1; j < k; j += 1) {
      const a = celda(filas[i].cells[j]);
      const b = celda(filas[j].cells[i]);
      if (!a || !b) return { motivo: 'celda_ilegible' };
      if (a.v === b.v) return { motivo: 'pareja_sin_un_ganador' };
      const [g, q] = a.v ? [a, b] : [b, a];
      if (g.toques > 5 || q.toques > g.toques) return { motivo: 'marcador_imposible' };
      tot[i].v += a.v ? 1 : 0;
      tot[j].v += b.v ? 1 : 0;
      tot[i].ts += a.toques;
      tot[i].tr += b.toques;
      tot[j].ts += b.toques;
      tot[j].tr += a.toques;
      bouts.push({
        phase: 'POULE', roundKey: `P${p.pool}`,
        a: { nombre: s(filas[i].name), pais: s(filas[i].country) }, b: { nombre: s(filas[j].name), pais: s(filas[j].country) },
        scoreA: a.toques, scoreB: b.toques, winner: a.toques === b.toques ? (a.v ? 'A' : 'B') : null,
      });
    }
  }
  for (let i = 0; i < k; i += 1) {
    const r = filas[i];
    const t = tot[i];
    if (n(r.v) !== t.v || n(r.ts) !== t.ts || n(r.tr) !== t.tr || n(r.ind) !== t.ts - t.tr || Math.abs(n(r.vm) - t.v / (k - 1)) > 0.006) {
      return { motivo: 'totales_no_cuadran' };
    }
    const sd = seeding.get(compacto(s(r.name)));
    if (!sd || sd.v !== t.v || sd.ts !== t.ts || sd.tr !== t.tr || sd.ind !== t.ts - t.tr) return { motivo: 'distinto_de_seeding_round_2' };
  }
  return { bouts };
}

/** Columnas del cuadro: las páginas de un mismo cuadro, concatenadas en orden. */
export function columnas(paginas: readonly PaginaCuadro[], bracket: number): Map<number, Casilla[]> {
  const m = new Map<number, Casilla[]>();
  for (const p of paginas.filter((x) => n(x.bracket) === bracket)) {
    for (const c of p.columns ?? []) {
      const t = n(c.table);
      m.set(t, [...(m.get(t) ?? []), ...(c.slots ?? []).map((x) => ({ seed: x.seed === null || x.seed === undefined ? null : n(x.seed), name: s(x.name), score: x.score === null || x.score === undefined || s(x.score) === '' ? null : s(x.score) }))]);
    }
  }
  return m;
}

const esBye = (c: Casilla | undefined) => !c || /BYE/i.test(c.name);
const formaCasilla = (c: Casilla | undefined) => (c ? `${c.seed ?? ''}|${compacto(c.name)}|${(c.score ?? '').replace(/\s+/g, '')}` : '-');

/**
 * Asaltos del cuadro (cuadro grande + cuadro de 8) que cumplen todas las
 * comprobaciones. Con varias lecturas por modelo (`--repetir`), un asalto vale
 * si alguna lectura del primero es idéntica a alguna del segundo.
 */
export function validarCuadro(
  as: LecturaModelo | LecturaModelo[], bs: LecturaModelo | LecturaModelo[], capa: CapaTexto,
): { bouts: BoutLeido[]; esperados: number; descartados: Record<string, number>; completo: boolean } {
  const la = Array.isArray(as) ? as : [as];
  const lb = Array.isArray(bs) ? bs : [bs];
  const a = la[0];
  const descartados: Record<string, number> = {};
  const fuera = (m: string) => (descartados[m] = (descartados[m] ?? 0) + 1);
  const grandes = [...new Set((a.brackets ?? []).map((p) => n(p.bracket)))].sort((x, y) => y - x);
  const mayor = grandes[0];
  if (!mayor) return { bouts: [], esperados: 0, descartados: { sin_cuadro: 1 }, completo: false };
  // Columnas fusionadas: las del cuadro grande hasta 8 (incluida) y las del cuadro de 8 desde 4.
  const fusion = (l: LecturaModelo) => {
    const g = columnas(l.brackets ?? [], mayor);
    const ocho = grandes.includes(8) && mayor !== 8 ? columnas(l.brackets ?? [], 8) : null;
    const m = new Map<number, Casilla[]>();
    for (const [t, c] of g) if (t >= 8 || !ocho) m.set(t, c);
    if (ocho) for (const [t, c] of ocho) if (t < 8) m.set(t, c);
    return { m, ocho };
  };
  const fas = la.map(fusion);
  const fbs = lb.map(fusion);
  const fa = fas[0];
  let completo = true;
  if (fa.ocho) {
    const igual = (x: Map<number, Casilla[]>, y: Map<number, Casilla[]>) =>
      JSON.stringify((x.get(8) ?? []).map((c) => compacto(c.name))) === JSON.stringify((y.get(8) ?? []).map((c) => compacto(c.name)));
    const alguna = [...la, ...lb].some((l, i) => {
      const f = i < la.length ? fas[i] : fbs[i - la.length];
      return f.ocho && igual(columnas(l.brackets ?? [], mayor), f.ocho);
    });
    if (!alguna) {
      fuera('tabla_de_8_distinta_entre_cuadros');
      completo = false;
    }
  }
  const porSeed = new Map(capa.seeding.map((x) => [x.seed, x]));
  const paisDe = new Map(capa.seeding.map((x) => [compacto(x.nombre), x.pais]));
  const puestoDe = new Map(capa.clasificacion.map((x) => [compacto(x.nombre), x.puesto]));
  const bouts: BoutLeido[] = [];
  let esperados = 0;
  for (let t = mayor; t >= 2; t /= 2) {
    const ca0 = fa.m.get(t) ?? [];
    if (ca0.length !== t || (fa.m.get(t / 2) ?? []).length !== t / 2) {
      completo = false;
      fuera(`ronda_${t}_incompleta`);
    }
    const terna = (f: { m: Map<number, Casilla[]> }, k: number) => {
      const c = f.m.get(t) ?? [];
      const sig = f.m.get(t / 2) ?? [];
      return { x: c[2 * k], y: c[2 * k + 1], g: sig[k], forma: [c[2 * k], c[2 * k + 1], sig[k]].map(formaCasilla).join() };
    };
    for (let k = 0; k < t / 2; k += 1) {
      if (esBye(ca0[2 * k]) || esBye(ca0[2 * k + 1])) continue;
      esperados += 1;
      const deB = new Set(fbs.map((f) => terna(f, k).forma));
      const elegida = fas.map((f) => terna(f, k)).find((x) => deB.has(x.forma));
      if (!elegida) {
        fuera('lecturas_distintas');
        continue;
      }
      const { x, y, g } = elegida;
      if (esBye(x) || esBye(y)) {
        fuera('lecturas_distintas');
        continue;
      }
      if (!g) {
        fuera('sin_ganador');
        continue;
      }
      // Fuera de la primera columna Fencing Time imprime la cabeza de serie de la casilla, no la del tirador.
      const ganaX = compacto(g.name) === compacto(x.name);
      const ganaY = compacto(g.name) === compacto(y.name);
      if (ganaX === ganaY) {
        fuera('ganador_no_es_uno_de_los_dos');
        continue;
      }
      const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(g.score ?? '');
      if (!m || +m[1] < +m[2] || +m[1] > 15) {
        fuera('marcador_imposible');
        continue;
      }
      // Entre empatados (2T, 2T) el orden de la tabla y el del cuadro pueden diferir: basta con los mismos V, TS, TR.
      const propia = (c: Casilla) => capa.seeding.find((f) => compacto(f.nombre) === compacto(c.name));
      const seedOk = t !== mayor || [x, y].every((c) => {
        const enSeed = c.seed !== null ? porSeed.get(c.seed) : undefined;
        const suya = propia(c);
        return !!enSeed && !!suya && (enSeed === suya || (enSeed.v === suya.v && enSeed.ts === suya.ts && enSeed.tr === suya.tr));
      });
      if (!seedOk) {
        fuera('cabeza_de_serie_distinta_de_seeding');
        continue;
      }
      const perdedor = ganaX ? y : x;
      const puesto = puestoDe.get(compacto(perdedor.name));
      const minimo = t === 2 ? 2 : t / 2 + 1;
      if (puesto === undefined || puesto < minimo || puesto > t) {
        fuera('puesto_final_incoherente');
        continue;
      }
      if (t === 2 && puestoDe.get(compacto(g.name)) !== 1) {
        fuera('puesto_final_incoherente');
        continue;
      }
      const [pg, pp] = [+m[1], +m[2]];
      bouts.push({
        phase: 'TABLEAU', roundKey: `A${t}`,
        a: { nombre: x.name, pais: paisDe.get(compacto(x.name)) ?? null }, b: { nombre: y.name, pais: paisDe.get(compacto(y.name)) ?? null },
        scoreA: ganaX ? pg : pp, scoreB: ganaX ? pp : pg, winner: pg === pp ? (ganaX ? 'A' : 'B') : null,
      });
    }
  }
  return { bouts, esperados, descartados, completo };
}

// ---------------------------------------------------------------- órdenes

async function descargar() {
  for (const o of OBJETIVOS) {
    const d = await obtener(urlDescarga(o.url));
    console.log(`${o.season}-${o.competitionKey} HTTP ${d.status} ${d.bytes?.length ?? 0} B`);
  }
}

async function leer() {
  const modelos = argumento('modelos', 'gpt-6-luna,gpt-6-sol').split(',');
  if (modelos.length !== 2 || modelos[0] === modelos[1]) throw new Error('hacen falta dos modelos distintos');
  const solo = argumento('solo', '').split(',').filter(Boolean);
  mkdirSync(CRUDOS, { recursive: true });
  for (const o of OBJETIVOS.filter((x) => solo.length === 0 || solo.includes(`${x.season}-${x.competitionKey}`))) {
    const d = enCache(urlDescarga(o.url));
    if (!d?.bytes) {
      console.log(`${o.season}-${o.competitionKey}: no está en caché (ejecuta «descargar»)`);
      continue;
    }
    const paginas = await textoPdf(d.bytes);
    const clave = `${o.season}-${o.competitionKey}-${d.sha256!.slice(0, 12)}`;
    const t0 = Date.now();
    // Un droid tras otro: con `esperarTurno` nunca pasan de tres los vivos en el equipo.
    const r: (LecturaModelo | null)[] = [];
    for (const m of modelos) r.push(await leerConModelo(m, d.bytes!, paginas, clave));
    // Lecturas extra del cuadro (`--repetir r2,r3`) de los dos modelos, para los asaltos en que no coincidieron.
    for (const e of argumento('repetir', '').split(',').filter(Boolean)) {
      for (const m of modelos) await leerParte(m, d.bytes!, paginas, clave, 'cuadro', false, e);
    }
    console.log(`${clave}: ${r.map((x, i) => `${modelos[i]}=${x ? 'ok' : 'fallo'}`).join(' ')} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}

async function hechos() {
  const modelos = argumento('modelos', 'gpt-6-luna,gpt-6-sol').split(',');
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  const pendientes = new Map(objetivos(db).map((p) => [`${p.season}-${p.competitionKey}`, p]));
  const informe: Record<string, unknown>[] = [];
  for (const o of OBJETIVOS) {
    const id = `${o.season}-${o.competitionKey}`;
    const p = pendientes.get(id);
    const d = enCache(urlDescarga(o.url));
    if (!p || !d?.bytes) {
      informe.push({ id, motivo: !p ? 'la prueba ya tiene poules y cuadro en la base' : 'PDF no está en caché' });
      continue;
    }
    const clave = `${id}-${d.sha256!.slice(0, 12)}`;
    const lecturas = await Promise.all(modelos.map((m) => leerConModelo(m, d.bytes!, [], clave, true).catch(() => null)));
    const [la, lb] = lecturas;
    if (!la || !lb) {
      informe.push({ id, motivo: `sin lectura de ${modelos.filter((_, i) => !lecturas[i]).join(', ')}` });
      continue;
    }
    const capa = capaDeTexto(await textoPdf(d.bytes), la.title);
    const puestos = puestosDeBase(db, p.id);
    const coincidencia = solape(puestos, capa.clasificacion.map((x) => ({ nombre: x.nombre, pais: x.pais })));
    if (coincidencia < 0.8 || capa.arma !== p.weapon || capa.genero !== p.gender) {
      informe.push({ id, motivo: `el PDF no es esta prueba (solape ${coincidencia.toFixed(2)}, ${capa.arma}/${capa.genero})` });
      continue;
    }
    const seeding = new Map(capa.seeding.map((x) => [compacto(x.nombre), x]));
    const poulesB = new Map((normalizarNombres(lb, capa).pools ?? []).map((q) => [n(q.pool), q]));
    const pb: BoutLeido[] = [];
    const descP: Record<string, number> = {};
    let esperadosP = 0;
    capa.poules.forEach((t) => (esperadosP += (t.length * (t.length - 1)) / 2));
    const vistas = new Set<number>();
    for (const q of normalizarNombres(la, capa).pools ?? []) {
      const num = n(q.pool);
      vistas.add(num);
      const r = validarPoule(q, poulesB.get(num), capa.poules[num - 1], seeding);
      if ('motivo' in r) descP[`P${num}:${r.motivo}`] = ((q.rows ?? []).length * ((q.rows ?? []).length - 1)) / 2;
      else pb.push(...r.bouts);
    }
    capa.poules.forEach((t, i) => {
      if (!vistas.has(i + 1)) descP[`P${i + 1}:no_leida`] = (t.length * (t.length - 1)) / 2;
    });
    const extras = async (m: string) => {
      const etiquetas = readdirSync(CRUDOS).flatMap((f) => {
        const x = new RegExp(`^${clave}__${m}__cuadro__(\\w+)\\.json$`).exec(f);
        return x ? [x[1]] : [];
      });
      const ls = await Promise.all(etiquetas.map((e) => leerParte(m, d.bytes!, [], clave, 'cuadro', true, e)));
      return ls.filter((x): x is LecturaModelo => x !== null).map((x) => normalizarNombres(x, capa));
    };
    const c = validarCuadro(
      [normalizarNombres(la, capa), ...(await extras(modelos[0]))], [normalizarNombres(lb, capa), ...(await extras(modelos[1]))], capa,
    );
    const lectura: Lectura = {
      arma: capa.arma, genero: capa.genero,
      puestos: capa.clasificacion.map((x) => ({ t: { nombre: x.nombre, pais: x.pais }, puesto: x.puesto })),
      poules: { bouts: pb, esperados: esperadosP, descartados: descP },
      cuadro: { bouts: c.bouts, esperados: c.esperados, completo: c.completo, descartados: c.descartados },
    };
    const r = anadirAsaltos(hechosBase(p, puestos), lectura, {
      nombre: 'pdf_imagen_droids', url: o.url,
      descripcion: `PDF Fencing Time publicado por la EFC (resultado ${o.efc}); matrices y cuadro en imagen leídos por ${modelos.join(' y ')} con lecturas idénticas, validados con la capa de texto del propio PDF (poules, Seeding for Round #2 y clasificación final)`,
    });
    const h = soloFasesQueFaltan(hechosPrueba.parse({ ...r.hechos, extractor: 'lote7_imagen_droids', sourceUrl: o.url, sourceSha256: d.sha256! }), p);
    const fila = {
      id, solape: Number(coincidencia.toFixed(2)),
      pools: { importados: h.bouts.filter((x) => x.phase === 'POULE').length, esperados: esperadosP, estado: h.status.pools, descartados: r.informe.pools.descartados },
      tableau: { importados: h.bouts.filter((x) => x.phase === 'TABLEAU').length, esperados: c.esperados, estado: h.status.tableau, descartados: r.informe.tableau.descartados },
      sinCasar: r.informe.tiradores.sinCasar,
    };
    informe.push(fila);
    console.log(JSON.stringify(fila));
    if (h.bouts.length > 0) writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
  }
  db.close();
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), pruebas: informe }, null, 1)}\n`);
  for (const i of informe.filter((x) => 'motivo' in x)) console.log(JSON.stringify(i));
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'leer') await leer();
  else if (orden === 'hechos') await hechos();
  else throw new Error('uso: lote7-fie-imagen.ts descargar|leer|hechos');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
