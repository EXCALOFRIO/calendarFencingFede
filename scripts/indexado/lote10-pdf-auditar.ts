/**
 * Auditoría de los asaltos `rfee_pdf` guardados (lecturas antiguas del lector y de los droids)
 * y contraste con una relectura determinista del PDF. Sólo lee la base y la caché de PDF.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-pdf-auditar.ts \
 *     [--db <nuevo10.sqlite>] [--cache <cache-rfee-2018>] [--salida <hechos/lote10-correccion-pdf>] \
 *     [--limite N] [--solo <url>] [--muestra 300] [--semilla 10]
 *
 * 1. Coherencia interna, sin el PDF: por poule, cada pareja una vez, nadie contra sí mismo,
 *    ganador con más tocados que el perdedor y sin pasar del tope de la vuelta (el tanteo de
 *    victoria más repetido), y n·(n−1)/2 asaltos con n−1 por tirador. Por cuadro, las reglas de
 *    `consistenciaCuadro` y la clasificación de la prueba (final 1-2, semifinal 3-4, quien pierde
 *    en la tabla de N entre N/2+1 y N).
 * 2. Relectura: cada poule guardada se casa por nombres con UNA matriz del PDF (`leerMatricesPoules`,
 *    que ya exige V/M, TD e índice cuadrados) y se compara celda a celda; el cuadro se compara con
 *    el que da el lector para la misma prueba, por ronda y pareja.
 * 3. Corrección sólo con evidencia completa: la matriz entera determinada (sin `V` sin tanteo),
 *    todas sus filas casadas con tiradores guardados distintos y alguna diferencia. Lo demás queda
 *    como dudoso. Salida en `<salida>/_correcciones.json` (lo aplica `lote10-pdf-sustituir.ts`) y
 *    `<salida>/_informe.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { consistenciaCuadro } from '../../src/lib/ingest/hechos/cuadro-consistencia';
import { nombresCompatiblesRecorte, prepararNombre } from '../../src/lib/ingest/hechos/nombres-prueba';
import { dividirPaginaPorPruebas } from '../../src/lib/ingest/sources/rfee-pdf/bloques';
import { compatibles } from '../../src/lib/ingest/sources/rfee-pdf/geometria';
import { docIdLegadoDeUrl, extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { analizarPagina, type PaginaAnalizada } from '../../src/lib/ingest/sources/rfee-pdf/paginas';
import { leerMatricesPoules, type FilaMatriz, type PouleLeida } from '../../src/lib/ingest/sources/rfee-pdf/poules';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { AsaltoPdf } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';
import { cargarManifiesto, rutaBlob } from './pdf-relectura-objetivos';

export const CARPETA_CORRECCION = join(CARPETA_TRABAJO, 'hechos', 'lote10-correccion-pdf');

// ------------------------------------------------------------------ tipos

export type AsaltoBase = {
  id: string;
  competicion: string;
  fase: 'POULE' | 'TABLEAU';
  ronda: string;
  aRef: string;
  bRef: string;
  aNombre: string;
  bNombre: string;
  aPersona: string | null;
  bPersona: string | null;
  sa: number;
  sb: number;
  url: string;
};

export type ProblemaPoule =
  | 'mismo_tirador'
  | 'pareja_repetida'
  | 'empate'
  | 'ganador_sobre_tope'
  | 'perdedor_en_tope'
  | 'incompleta';

export type AuditoriaPoule = {
  tiradores: number;
  asaltos: number;
  esperados: number;
  tope: number;
  problemas: Partial<Record<ProblemaPoule, number>>;
  /** Victorias por debajo del tope: legítimas si se acabó el tiempo, se cuentan aparte. */
  bajoTope: number;
};

export type ProblemaCuadro =
  | 'empate'
  | 'tirador_repetido_en_ronda'
  | 'pareja_repetida'
  | 'perdedor_sigue'
  | 'lecturas_mezcladas'
  | 'final_no_cuadra'
  | 'semifinal_no_cuadra'
  | 'perdedor_fuera_de_tramo'
  | 'sin_puesto';

// ------------------------------------------------------------------ coherencia interna

export const vueltaDe = (ronda: string): number => Number(/^V(\d+)P/.exec(ronda)?.[1] ?? 1);
const pareja = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Tope de una vuelta: el tanteo de victoria más repetido entre todas sus poules. */
export function topeDe(asaltos: readonly { sa: number; sb: number }[]): number {
  const cuenta = new Map<number, number>();
  for (const b of asaltos) {
    const g = Math.max(b.sa, b.sb);
    cuenta.set(g, (cuenta.get(g) ?? 0) + 1);
  }
  let mejor = 5;
  let n = -1;
  for (const [v, c] of cuenta) if (c > n || (c === n && v > mejor)) [mejor, n] = [v, c];
  return mejor;
}

export function auditarPoule(asaltos: readonly Pick<AsaltoBase, 'aRef' | 'bRef' | 'sa' | 'sb'>[], tope: number): AuditoriaPoule {
  const problemas: AuditoriaPoule['problemas'] = {};
  const anotar = (p: ProblemaPoule, n = 1) => (problemas[p] = (problemas[p] ?? 0) + n);
  const refs = new Set<string>();
  const parejas = new Map<string, number>();
  const porTirador = new Map<string, number>();
  let bajoTope = 0;
  for (const b of asaltos) {
    refs.add(b.aRef);
    refs.add(b.bRef);
    if (b.aRef === b.bRef) anotar('mismo_tirador');
    const k = pareja(b.aRef, b.bRef);
    parejas.set(k, (parejas.get(k) ?? 0) + 1);
    for (const r of new Set([b.aRef, b.bRef])) porTirador.set(r, (porTirador.get(r) ?? 0) + 1);
    const g = Math.max(b.sa, b.sb);
    const p = Math.min(b.sa, b.sb);
    if (b.sa === b.sb) anotar('empate');
    else {
      if (g > tope) anotar('ganador_sobre_tope');
      if (p >= tope) anotar('perdedor_en_tope');
      if (g < tope) bajoTope += 1;
    }
  }
  for (const n of parejas.values()) if (n > 1) anotar('pareja_repetida', n - 1);
  const k = refs.size;
  const esperados = (k * (k - 1)) / 2;
  if (asaltos.length !== esperados || [...porTirador.values()].some((n) => n !== k - 1)) anotar('incompleta');
  return { tiradores: k, asaltos: asaltos.length, esperados, tope, problemas, bajoTope };
}

const tamano = (ronda: string): number | null => {
  const m = /^[ATB](\d+)$/.exec(ronda);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 && (n & (n - 1)) === 0 ? n : null;
};
const familia = (ronda: string) => (ronda.startsWith('B') ? 'B' : ronda.startsWith('T') ? 'T' : ronda.startsWith('A') ? 'A' : '?');

/**
 * Cuadro guardado frente a sí mismo y a la clasificación. `puesto` da el puesto de un tirador
 * del cuadro (por persona o nombre) o `undefined` si no se encuentra. Con dos cuadros (`A*` previo y
 * `B*` principal) sólo el principal se mide contra la clasificación.
 */
export function auditarCuadro(
  asaltos: readonly Pick<AsaltoBase, 'ronda' | 'aRef' | 'bRef' | 'sa' | 'sb'>[],
  puesto: (ref: string) => number | null | undefined,
): { problemas: Partial<Record<ProblemaCuadro, number>>; incoherentes: Set<number> } {
  const problemas: Partial<Record<ProblemaCuadro, number>> = {};
  const anotar = (p: ProblemaCuadro, n = 1) => (problemas[p] = (problemas[p] ?? 0) + n);
  const incoherentes = new Set<number>();
  const familias = new Set(asaltos.map((b) => familia(b.ronda)));
  if (familias.has('A') && familias.has('T')) anotar('lecturas_mezcladas');
  for (const [i, b] of asaltos.entries()) if (b.sa === b.sb) { anotar('empate'); incoherentes.add(i); }
  for (const f of ['B', 'AT']) {
    const idx = asaltos.flatMap((b, i) => (f.includes(familia(b.ronda)) ? [i] : []));
    if (idx.length === 0) continue;
    const c = consistenciaCuadro(idx.map((i) => {
      const b = asaltos[i];
      return { roundKey: `A${tamano(b.ronda) ?? 'x'}`, aRef: b.aRef, bRef: b.bRef, scoreA: b.sa, scoreB: b.sb };
    }));
    for (const [m, n] of Object.entries(c.motivos)) anotar(m as ProblemaCuadro, n);
    for (const j of c.incoherentes) incoherentes.add(idx[j]);
  }
  const principal = familias.has('B') ? 'B' : 'AT';
  for (const [i, b] of asaltos.entries()) {
    if (!principal.includes(familia(b.ronda)) || b.sa === b.sb) continue;
    const n = tamano(b.ronda);
    if (n === null) continue;
    const [g, p] = b.sa > b.sb ? [b.aRef, b.bRef] : [b.bRef, b.aRef];
    const pg = puesto(g);
    const pp = puesto(p);
    if (pg === undefined || pp === undefined || pg === null || pp === null) { anotar('sin_puesto'); continue; }
    const mal = n === 2 ? pg !== 1 || pp !== 2 : n === 4 ? pp < 3 || pp > 4 || pg > 2 : pp < n / 2 + 1 || pp > n;
    if (mal) {
      anotar(n === 2 ? 'final_no_cuadra' : n === 4 ? 'semifinal_no_cuadra' : 'perdedor_fuera_de_tramo');
      incoherentes.add(i);
    }
  }
  return { problemas, incoherentes };
}

// ------------------------------------------------------------------ casado por nombres

const MINIMO = 5;
export const mismoTexto = (a: string, b: string) => compatibles(a, b, MINIMO) || nombresCompatiblesRecorte(prepararNombre(a), prepararNombre(b));

/**
 * Cuando el nombre truncado llena su columna, PDF.js entrega nombre y club en un solo texto
 * («TABERNA RAMON Ma CEL-M»): `pdf` se prueba también sin una o dos palabras finales.
 */
export function mismoNombre(guardado: string, pdf: string): boolean {
  if (mismoTexto(guardado, pdf)) return true;
  const w = pdf.trim().split(/\s+/);
  for (let k = 1; k <= 2 && w.length - k >= 1; k += 1) {
    const corto = w.slice(0, -k).join(' ');
    if (corto.length >= MINIMO && mismoTexto(guardado, corto)) return true;
  }
  return false;
}

/**
 * Asigna a cada nombre de `a` un índice distinto de `b`: primero los que sólo tienen un
 * candidato libre, hasta que no avance. Lo ambiguo queda sin asignar.
 */
export function asignarNombres(a: readonly string[], b: readonly string[]): (number | null)[] {
  // Sólo sin ningún candidato directo se prueba quitando el club pegado al nombre.
  const cand = a.map((x) => {
    const directos = b.flatMap((y, j) => (mismoTexto(x, y) ? [j] : []));
    return directos.length > 0 ? directos : b.flatMap((y, j) => (mismoNombre(x, y) ? [j] : []));
  });
  const out: (number | null)[] = a.map(() => null);
  const usados = new Set<number>();
  for (let avanza = true; avanza; ) {
    avanza = false;
    const unicos = new Map<number, number[]>();
    for (let i = 0; i < a.length; i += 1) {
      if (out[i] !== null) continue;
      const libres = cand[i].filter((j) => !usados.has(j));
      if (libres.length === 1) (unicos.get(libres[0]) ?? unicos.set(libres[0], []).get(libres[0])!).push(i);
    }
    // Dos nombres cuyo único candidato es la misma fila: ninguno se asigna.
    for (const [j, nombres] of unicos) {
      if (nombres.length !== 1) continue;
      out[nombres[0]] = j;
      usados.add(j);
      avanza = true;
    }
  }
  return out;
}

// ------------------------------------------------------------------ comparación con el PDF

export type CeldaPdf = { gana: boolean; puntos: number | null };
export type PoulePdf = { pagina: number; yMax: number; ronda: string; filas: FilaMatriz[]; celdas: CeldaPdf[][]; sinResolver: number };

export type Diferencia =
  | { tipo: 'marcador'; id: string; aRef: string; bRef: string; antes: [number, number]; despues: [number, number]; cambiaGanador: boolean }
  | { tipo: 'falta'; aRef: string | null; bRef: string | null; aNombre: string; bNombre: string; despues: [number, number] | null }
  | { tipo: 'sobra'; id: string; aRef: string; bRef: string; antes: [number, number] };

export type Contraste = {
  estado: 'coincide' | 'coincide_parcial' | 'difiere' | 'sin_pareja_pdf';
  pdf: PoulePdf | null;
  casados: number;
  comparados: number;
  diferencias: Diferencia[];
  /** La matriz entera está determinada y todas sus filas tienen tirador guardado distinto. */
  completa: boolean;
};

/** Tiradores de una poule guardada: ref → nombre (el primero que aparece). */
export function tiradoresDe(asaltos: readonly AsaltoBase[]): Map<string, { nombre: string; persona: string | null }> {
  const out = new Map<string, { nombre: string; persona: string | null }>();
  for (const b of asaltos) {
    if (!out.has(b.aRef)) out.set(b.aRef, { nombre: b.aNombre, persona: b.aPersona });
    if (!out.has(b.bRef)) out.set(b.bRef, { nombre: b.bNombre, persona: b.bPersona });
  }
  return out;
}

/** La matriz del PDF que mejor casa con la poule guardada (o `null`). */
export function elegirPoulePdf(asaltos: readonly AsaltoBase[], candidatas: readonly PoulePdf[]): { pdf: PoulePdf; asignacion: (number | null)[] } | null {
  const tiradores = [...tiradoresDe(asaltos).values()].map((t) => t.nombre);
  const ronda = asaltos[0]?.ronda;
  const orden = candidatas
    .map((pdf) => {
      const asignacion = asignarNombres(tiradores, pdf.filas.map((f) => f.nombre));
      return { pdf, asignacion, n: asignacion.filter((x) => x !== null).length, misma: pdf.ronda === ronda ? 1 : 0 };
    })
    .sort((x, y) => y.n - x.n || y.misma - x.misma);
  const [mejor, segunda] = orden;
  if (!mejor || mejor.n < Math.max(2, Math.ceil(tiradores.length * 0.75))) return null;
  if (segunda && segunda.n === mejor.n && segunda.misma === mejor.misma) return null;
  return { pdf: mejor.pdf, asignacion: mejor.asignacion };
}

export function contrastarPoule(asaltos: readonly AsaltoBase[], candidatas: readonly PoulePdf[]): Contraste {
  const sin: Contraste = { estado: 'sin_pareja_pdf', pdf: null, casados: 0, comparados: 0, diferencias: [], completa: false };
  const e = elegirPoulePdf(asaltos, candidatas);
  if (!e) return sin;
  const { pdf, asignacion } = e;
  const refs = [...tiradoresDe(asaltos).keys()];
  const refDeFila = new Map<number, string>();
  for (const [i, j] of asignacion.entries()) if (j !== null) refDeFila.set(j, refs[i]);
  const porPareja = new Map<string, AsaltoBase[]>();
  for (const b of asaltos) {
    const k = pareja(b.aRef, b.bRef);
    (porPareja.get(k) ?? porPareja.set(k, []).get(k)!).push(b);
  }
  const diferencias: Diferencia[] = [];
  const usados = new Set<string>();
  let comparados = 0;
  let indeterminadas = 0;
  const n = pdf.filas.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const ci = pdf.celdas[i][j];
      const cj = pdf.celdas[j][i];
      const determinada = ci.gana !== cj.gana && ci.puntos !== null && cj.puntos !== null;
      if (!determinada) indeterminadas += 1;
      const ri = refDeFila.get(i) ?? null;
      const rj = refDeFila.get(j) ?? null;
      const guardados = ri && rj ? porPareja.get(pareja(ri, rj)) ?? [] : [];
      if (guardados.length === 0) {
        diferencias.push({ tipo: 'falta', aRef: ri, bRef: rj, aNombre: pdf.filas[i].nombre, bNombre: pdf.filas[j].nombre,
          despues: determinada ? [ci.puntos!, cj.puntos!] : null });
        continue;
      }
      const [b, ...repetidos] = guardados;
      usados.add(b.id);
      for (const r of repetidos) {
        usados.add(r.id);
        diferencias.push({ tipo: 'sobra', id: r.id, aRef: r.aRef, bRef: r.bRef, antes: [r.sa, r.sb] });
      }
      if (!determinada) continue;
      comparados += 1;
      const [pa, pb] = b.aRef === ri ? [ci.puntos!, cj.puntos!] : [cj.puntos!, ci.puntos!];
      if (pa !== b.sa || pb !== b.sb) {
        diferencias.push({ tipo: 'marcador', id: b.id, aRef: b.aRef, bRef: b.bRef, antes: [b.sa, b.sb], despues: [pa, pb],
          cambiaGanador: Math.sign(pa - pb) !== Math.sign(b.sa - b.sb) });
      }
    }
  }
  for (const b of asaltos) if (!usados.has(b.id)) diferencias.push({ tipo: 'sobra', id: b.id, aRef: b.aRef, bRef: b.bRef, antes: [b.sa, b.sb] });
  const completa = pdf.sinResolver === 0 && indeterminadas === 0 && refDeFila.size === n;
  const estado = diferencias.length > 0 ? 'difiere' : indeterminadas > 0 ? 'coincide_parcial' : 'coincide';
  return { estado, pdf, casados: refDeFila.size, comparados, diferencias, completa };
}

/** Diferencias de un cuadro guardado frente al del lector, por tamaño de ronda y pareja de nombres. */
export function contrastarCuadro(
  asaltos: readonly AsaltoBase[],
  lector: readonly AsaltoPdf[],
): { coinciden: number; difieren: { b: AsaltoBase; pdf: AsaltoPdf; despues: [number, number] }[]; sinPareja: AsaltoBase[] } {
  const difieren: { b: AsaltoBase; pdf: AsaltoPdf; despues: [number, number] }[] = [];
  const sinPareja: AsaltoBase[] = [];
  let coinciden = 0;
  for (const b of asaltos) {
    const n = tamano(b.ronda);
    const cand = lector.filter((x) => x.fase === 'TABLEAU' && tamano(x.ronda) === n && (
      (mismoTexto(b.aNombre, x.nombreA) && mismoTexto(b.bNombre, x.nombreB)) ||
      (mismoTexto(b.aNombre, x.nombreB) && mismoTexto(b.bNombre, x.nombreA))));
    if (n === null || cand.length !== 1) { sinPareja.push(b); continue; }
    const x = cand[0];
    const directo = mismoTexto(b.aNombre, x.nombreA) && mismoTexto(b.bNombre, x.nombreB);
    const despues: [number, number] = directo ? [x.puntosA, x.puntosB] : [x.puntosB, x.puntosA];
    if (despues[0] === b.sa && despues[1] === b.sb) coinciden += 1;
    else difieren.push({ b, pdf: x, despues });
  }
  return { coinciden, difieren, sinPareja };
}

// ------------------------------------------------------------------ lectura del PDF

export type LecturaRelectura = { poules: PoulePdf[]; rechazadas: { pagina: number; motivo: string; nombres: string[] }[]; pruebas: { clave: string; cuadro: AsaltoPdf[]; cuadroCompleto: boolean; cuadroCoherente: boolean; nombres: string[] }[] };

export async function releer(bytes: Uint8Array, url: string): Promise<LecturaRelectura> {
  const { paginas } = await extraerPaginas(bytes);
  const analizadas = paginas.flatMap(dividirPaginaPorPruebas).map(analizarPagina);
  const grupos = new Map<string, PaginaAnalizada[]>();
  for (const p of analizadas) {
    if (p.firma === '' || p.tipo !== 'poules') continue;
    (grupos.get(p.firma) ?? grupos.set(p.firma, []).get(p.firma)!).push(p);
  }
  const poules: PoulePdf[] = [];
  const rechazadas: LecturaRelectura['rechazadas'] = [];
  for (const g of grupos.values()) {
    for (const l of leerMatricesPoules(g).lecturas) {
      if ('matriz' in l) {
        const p = l as PouleLeida;
        poules.push({ pagina: p.reg.pagina, yMax: p.reg.yMax, ronda: p.ronda, filas: p.filas, sinResolver: p.matriz.sinResolver,
          celdas: p.matriz.celdas.map((f) => f.map((c) => ({ gana: c.gana, puntos: c.puntos }))) });
      } else if (l.region) rechazadas.push({ pagina: l.region.pagina, motivo: l.motivo, nombres: (l.filas ?? []).map((f) => f.nombre) });
    }
  }
  const lectura = leerResultadosPdf(paginas, { url, docId: docIdLegadoDeUrl(url) });
  const pruebas = lectura.pruebas.filter((p) => p.formato === 'INDIVIDUAL').map((p) => {
    const cuadro = p.asaltos.filter((a) => a.fase === 'TABLEAU');
    const c = consistenciaCuadro(cuadro.map((a) => ({ roundKey: a.ronda, aRef: a.refA, bRef: a.refB, scoreA: a.puntosA, scoreB: a.puntosB })));
    return { clave: p.clave, cuadro, cuadroCompleto: p.cobertura.cuadro.estado === 'completo', cuadroCoherente: c.incoherentes.size === 0,
      nombres: p.puestos.map((x) => x.nombre) };
  });
  return { poules, rechazadas, pruebas };
}

// ------------------------------------------------------------------ informe

export type Competicion = { id: string; source: string; season: string; competition_key: string; weapon: string; gender: string; category: string; format: string };

export type CorreccionFase = {
  competicion: { source: string; season: string; competitionKey: string };
  url: string;
  fase: 'POULE' | 'TABLEAU';
  ronda: string;
  extractor: string;
  cambios: (
    | { tipo: 'marcador'; aRef: string; bRef: string; antes: [number, number]; despues: [number, number] }
    | { tipo: 'alta'; aRef: string; bRef: string; aNombre: string; bNombre: string; aPersona: string | null; bPersona: string | null; despues: [number, number] }
    | { tipo: 'baja'; aRef: string; bRef: string; antes: [number, number] }
  )[];
  evidencia: { pagina: number; yMax: number; filas: { nombre: string; club: string | null; vm: number; ind: number; td: number }[]; matriz: string[] } | { pagina: null; lector: string };
};

/** Fase que la relectura no pudo dejar cuadrada: su cobertura se marca «parcial». */
export type Parcial = { competicion: { source: string; season: string; competitionKey: string }; kind: 'pools' | 'tableau'; detalle: string[] };

export function extractorDe(ref: string): string {
  if (ref.includes(':pdfd:')) return 'droid';
  if (/:pdf:p\d+:y/.test(ref)) return 'lector';
  return 'otro';
}

const celdaTexto = (c: CeldaPdf) => (c.gana ? `V${c.puntos ?? '?'}` : String(c.puntos ?? '?'));

/** Wilson al 95 %. */
export function intervalo(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

function aleatorio(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo10.sqlite'));
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const salida = argumento('salida', CARPETA_CORRECCION);
  const limite = Number(argumento('limite', '0'));
  const solo = argumento('solo', '');
  const tamMuestra = Number(argumento('muestra', '300'));
  const azar = aleatorio(Number(argumento('semilla', '10')));
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const t0 = Date.now();

  const comps = new Map((db.prepare(`SELECT id, source, season, competition_key, weapon, gender, category, format FROM sport_competition
    WHERE id IN (SELECT DISTINCT competition_id FROM sport_bout WHERE source='rfee_pdf')`).all() as Competicion[]).map((c) => [c.id, c]));
  const asaltos = (db.prepare(`SELECT id, competition_id c, phase f, round_key r, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an,
      fencer_b_name bn, fencer_a_person_id ap, fencer_b_person_id bp, score_a sa, score_b sb, source_url u
    FROM sport_bout WHERE source='rfee_pdf'`).all() as Record<string, string | number | null>[]).map((r): AsaltoBase => ({
    id: String(r.id), competicion: String(r.c), fase: r.f as AsaltoBase['fase'], ronda: String(r.r), aRef: String(r.ar), bRef: String(r.br),
    aNombre: String(r.an ?? ''), bNombre: String(r.bn ?? ''), aPersona: (r.ap as string) ?? null, bPersona: (r.bp as string) ?? null,
    sa: Number(r.sa), sb: Number(r.sb), url: String(r.u ?? '').split('#')[0],
  }));
  const resultados = new Map<string, { nombre: string; persona: string | null; puesto: number | null }[]>();
  for (const r of db.prepare(`SELECT competition_id c, source_name n, person_id p, position pos FROM sport_result
      WHERE competition_id IN (SELECT DISTINCT competition_id FROM sport_bout WHERE source='rfee_pdf')`).all() as
      { c: string; n: string; p: string | null; pos: number | null }[]) {
    (resultados.get(r.c) ?? resultados.set(r.c, []).get(r.c)!).push({ nombre: r.n, persona: r.p, puesto: r.pos === null ? null : Number(r.pos) });
  }
  db.close();
  console.error(`asaltos rfee_pdf: ${asaltos.length}, pruebas: ${comps.size} (${Date.now() - t0} ms)`);

  // ---- 1. coherencia interna
  const poules = new Map<string, AsaltoBase[]>();
  const cuadros = new Map<string, AsaltoBase[]>();
  for (const b of asaltos) {
    const m = b.fase === 'POULE' ? poules : cuadros;
    const k = b.fase === 'POULE' ? `${b.competicion}|${b.ronda}` : b.competicion;
    (m.get(k) ?? m.set(k, []).get(k)!).push(b);
  }
  const topes = new Map<string, number>();
  {
    const porVuelta = new Map<string, AsaltoBase[]>();
    for (const b of asaltos) if (b.fase === 'POULE' && b.sa !== b.sb) {
      const k = `${b.competicion}|${vueltaDe(b.ronda)}`;
      (porVuelta.get(k) ?? porVuelta.set(k, []).get(k)!).push(b);
    }
    for (const [k, l] of porVuelta) topes.set(k, topeDe(l));
  }
  type FichaPoule = { clave: string; comp: Competicion; ronda: string; url: string; urls: number; extractor: string; aud: AuditoriaPoule; incoherente: boolean; equipos: boolean; contraste?: Contraste };
  const fichas: FichaPoule[] = [];
  for (const [k, l] of poules) {
    const comp = comps.get(l[0].competicion)!;
    const aud = auditarPoule(l, topes.get(`${l[0].competicion}|${vueltaDe(l[0].ronda)}`) ?? 5);
    const urls = new Set(l.map((b) => b.url));
    const extr = new Set(l.flatMap((b) => [extractorDe(b.aRef), extractorDe(b.bRef)]));
    fichas.push({ clave: k, comp, ronda: l[0].ronda, url: [...urls][0], urls: urls.size, extractor: [...extr].sort().join('+'), aud,
      incoherente: Object.keys(aud.problemas).length > 0 || urls.size > 1, equipos: comp.format !== 'INDIVIDUAL' });
  }
  type FichaCuadro = { comp: Competicion; url: string; extractor: string; asaltos: number; problemas: Partial<Record<ProblemaCuadro, number>>; incoherentes: number;
    pdf?: { coinciden: number; difieren: number; sinPareja: number } };
  const fichasCuadro: FichaCuadro[] = [];
  let cuadrosEquipos = 0;
  for (const [c, l] of cuadros) {
    const comp = comps.get(c)!;
    // En equipos se tiran los puestos: el perdedor sigue y la clasificación no sale del cuadro.
    if (comp.format !== 'INDIVIDUAL') { cuadrosEquipos += 1; continue; }
    const res = (resultados.get(c) ?? []).map((r) => ({ ...r, prep: prepararNombre(r.nombre) }));
    const tiradores = tiradoresDe(l);
    const puesto = (ref: string): number | null | undefined => {
      const t = tiradores.get(ref);
      if (!t) return undefined;
      if (t.persona) {
        const porPersona = res.filter((r) => r.persona === t.persona);
        if (porPersona.length === 1) return porPersona[0].puesto;
      }
      const porNombre = res.filter((r) => mismoTexto(t.nombre, r.nombre));
      return porNombre.length === 1 ? porNombre[0].puesto : undefined;
    };
    const a = auditarCuadro(l, puesto);
    const extr = new Set(l.flatMap((b) => [extractorDe(b.aRef), extractorDe(b.bRef)]));
    fichasCuadro.push({ comp, url: l[0].url, extractor: [...extr].sort().join('+'), asaltos: l.length, problemas: a.problemas, incoherentes: a.incoherentes.size });
  }
  console.error(`poules: ${fichas.length} (${fichas.filter((f) => f.incoherente).length} incoherentes), cuadros: ${fichasCuadro.length}`);

  // ---- 2. relectura (todas las URL en caché; la muestra se elige después entre las coherentes)
  const manifiesto = cargarManifiesto(cache);
  const urls = [...new Set(asaltos.map((b) => b.url))].filter((u) => !solo || u === solo).sort();
  const lecturas = new Map<string, LecturaRelectura | string>();
  let hechas = 0;
  for (const u of urls) {
    if (limite && hechas >= limite) break;
    const unidad = manifiesto.get(u);
    if (!unidad || !existsSync(rutaBlob(cache, unidad))) { lecturas.set(u, 'pdf_no_en_cache'); continue; }
    try {
      lecturas.set(u, await releer(new Uint8Array(readFileSync(rutaBlob(cache, unidad))), u));
    } catch (e) {
      lecturas.set(u, `error:${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
    }
    hechas += 1;
    if (hechas % 50 === 0) console.error(`  ${hechas}/${urls.length} PDF (${Math.round((Date.now() - t0) / 1000)} s)`);
  }

  const correcciones: CorreccionFase[] = [];
  const corregidas = new Set<string>();
  const dudosas: { prueba: string; ronda: string; url: string; motivo: string; detalle?: unknown }[] = [];
  for (const f of fichas) {
    const l = lecturas.get(f.url);
    // El lector no lee las poules por equipos: no hay con qué contrastarlas.
    if (l === undefined || f.equipos) continue;
    if (typeof l === 'string') { if (f.incoherente) dudosas.push({ prueba: f.comp.competition_key, ronda: f.ronda, url: f.url, motivo: l }); continue; }
    const bs = poules.get(f.clave)!;
    const c = contrastarPoule(bs, l.poules);
    f.contraste = c;
    if (c.estado === 'sin_pareja_pdf') {
      const ilegibles = l.rechazadas.filter((r) => r.nombres.length === 0 || asignarNombres([...tiradoresDe(bs).values()].map((t) => t.nombre), r.nombres).filter((x) => x !== null).length >= 2);
      if (f.incoherente || ilegibles.length > 0) dudosas.push({ prueba: f.comp.competition_key, ronda: f.ronda, url: f.url,
        motivo: ilegibles.length > 0 ? `poule_pdf_rechazada:${ilegibles[0].motivo}` : 'sin_pareja_pdf' });
      continue;
    }
    if (c.estado !== 'difiere') continue;
    if (!c.completa || f.urls > 1) {
      dudosas.push({ prueba: f.comp.competition_key, ronda: f.ronda, url: f.url,
        motivo: f.urls > 1 ? 'varias_fuentes' : c.pdf!.sinResolver > 0 ? 'pdf_con_victorias_sin_tanteo' : 'pdf_con_filas_sin_tirador_guardado',
        detalle: c.diferencias.slice(0, 8) });
      continue;
    }
    const tir = tiradoresDe(bs);
    corregidas.add(f.clave);
    correcciones.push({
      competicion: { source: f.comp.source, season: f.comp.season, competitionKey: f.comp.competition_key },
      url: f.url, fase: 'POULE', ronda: f.ronda, extractor: f.extractor,
      cambios: c.diferencias.map((d) => {
        if (d.tipo === 'marcador') return { tipo: 'marcador' as const, aRef: d.aRef, bRef: d.bRef, antes: d.antes, despues: d.despues };
        if (d.tipo === 'sobra') return { tipo: 'baja' as const, aRef: d.aRef, bRef: d.bRef, antes: d.antes };
        const [a, b, sa, sb] = d.aRef! < d.bRef! ? [d.aRef!, d.bRef!, d.despues![0], d.despues![1]] : [d.bRef!, d.aRef!, d.despues![1], d.despues![0]];
        return { tipo: 'alta' as const, aRef: a, bRef: b, aNombre: tir.get(a)!.nombre, bNombre: tir.get(b)!.nombre,
          aPersona: tir.get(a)!.persona, bPersona: tir.get(b)!.persona, despues: [sa, sb] as [number, number] };
      }),
      evidencia: { pagina: c.pdf!.pagina, yMax: c.pdf!.yMax,
        filas: c.pdf!.filas.map((x) => ({ nombre: x.nombre, club: x.club, vm: x.vm, ind: x.ind, td: x.td })),
        matriz: c.pdf!.celdas.map((fila, i) => fila.map((x, j) => (i === j ? '-' : celdaTexto(x))).join(' ')) },
    });
  }

  // ---- cuadro frente al lector
  const correccionesCuadro: CorreccionFase[] = [];
  const corregidosCuadro = new Set<string>();
  const dudasCuadro: { prueba: string; url: string; motivo: string; detalle?: unknown }[] = [];
  for (const fc of fichasCuadro) {
    const l = lecturas.get(fc.url);
    if (l === undefined || typeof l === 'string') continue;
    const bs = cuadros.get(fc.comp.id)!.filter((b) => b.url === fc.url);
    if (bs.some((b) => b.ronda.startsWith('B'))) { dudasCuadro.push({ prueba: fc.comp.competition_key, url: fc.url, motivo: 'dos_cuadros_no_comparado' }); continue; }
    const nombres = [...tiradoresDe(bs).values()].map((t) => t.nombre);
    const prueba = [...l.pruebas].map((p) => ({ p, n: nombres.filter((x) => p.nombres.some((y) => mismoTexto(x, y))).length }))
      .sort((a, b) => b.n - a.n)[0];
    if (!prueba || prueba.n < nombres.length * 0.75 || prueba.p.cuadro.length === 0) { dudasCuadro.push({ prueba: fc.comp.competition_key, url: fc.url, motivo: 'sin_cuadro_pdf' }); continue; }
    const r = contrastarCuadro(bs, prueba.p.cuadro);
    fc.pdf = { coinciden: r.coinciden, difieren: r.difieren.length, sinPareja: r.sinPareja.length };
    if (r.difieren.length === 0) continue;
    const topeCuadro = topeDe(prueba.p.cuadro.map((x) => ({ sa: x.puntosA, sb: x.puntosB })));
    const fiable = prueba.p.cuadroCoherente && r.difieren.every((d) => d.pdf.marcador === 'explicito' &&
      Math.max(...d.despues) <= topeCuadro && Math.min(...d.despues) < Math.max(...d.despues));
    // La corrección no puede dejar el cuadro guardado menos coherente.
    const cambiado = cuadros.get(fc.comp.id)!.map((b) => { const d = r.difieren.find((x) => x.b.id === b.id); return d ? { ...b, sa: d.despues[0], sb: d.despues[1] } : b; });
    const despues = auditarCuadro(cambiado, () => undefined).incoherentes.size;
    const antesSinPuesto = auditarCuadro(cuadros.get(fc.comp.id)!, () => undefined).incoherentes.size;
    if (!fiable || despues > antesSinPuesto) {
      dudasCuadro.push({ prueba: fc.comp.competition_key, url: fc.url, motivo: !fiable ? 'cuadro_pdf_no_fiable' : 'correccion_empeora_coherencia',
        detalle: r.difieren.slice(0, 5).map((d) => ({ ronda: d.b.ronda, a: d.b.aNombre, b: d.b.bNombre, antes: [d.b.sa, d.b.sb], despues: d.despues })) });
      continue;
    }
    const porRonda = new Map<string, typeof r.difieren>();
    for (const d of r.difieren) (porRonda.get(d.b.ronda) ?? porRonda.set(d.b.ronda, []).get(d.b.ronda)!).push(d);
    corregidosCuadro.add(fc.comp.id);
    for (const [ronda, grupo] of porRonda) {
      correccionesCuadro.push({
        competicion: { source: fc.comp.source, season: fc.comp.season, competitionKey: fc.comp.competition_key },
        url: fc.url, fase: 'TABLEAU', ronda, extractor: fc.extractor,
        cambios: grupo.map((d) => ({ tipo: 'marcador' as const, aRef: d.b.aRef, bRef: d.b.bRef, antes: [d.b.sa, d.b.sb] as [number, number], despues: d.despues })),
        evidencia: { pagina: null, lector: `${prueba.p.clave}: ${grupo.map((d) => `${d.pdf.nombreA} ${d.pdf.puntosA}-${d.pdf.puntosB} ${d.pdf.nombreB}`).join('; ')}` },
      });
    }
  }

  // ---- fases que quedan dudosas: su cobertura pasa a «parcial»
  const parciales = new Map<string, Parcial>();
  const marcar = (comp: Competicion, kind: 'pools' | 'tableau', detalle: string) => {
    const k = `${comp.id}|${kind}`;
    const p = parciales.get(k) ?? parciales.set(k, { competicion: { source: comp.source, season: comp.season, competitionKey: comp.competition_key }, kind, detalle: [] }).get(k)!;
    p.detalle.push(detalle);
  };
  for (const f of fichas) {
    if (corregidas.has(f.clave)) continue;
    if (f.incoherente) marcar(f.comp, 'pools', `${f.ronda}:${Object.keys(f.aud.problemas).join('+') || 'varias_fuentes'}`);
    else if (f.contraste?.estado === 'difiere') marcar(f.comp, 'pools', `${f.ronda}:distinta_del_pdf_sin_evidencia_completa`);
  }
  const ESTRUCTURALES: ProblemaCuadro[] = ['empate', 'tirador_repetido_en_ronda', 'pareja_repetida', 'perdedor_sigue', 'lecturas_mezcladas'];
  for (const fc of fichasCuadro) {
    if (corregidosCuadro.has(fc.comp.id)) continue;
    const malos = ESTRUCTURALES.filter((p) => (fc.problemas[p] ?? 0) > 0);
    if (malos.length) marcar(fc.comp, 'tableau', malos.join('+'));
    else if ((fc.pdf?.difieren ?? 0) > 0) marcar(fc.comp, 'tableau', `${fc.pdf!.difieren}_asaltos_distintos_del_pdf_sin_evidencia_completa`);
  }

  // ---- tasas
  const verificables = fichas.filter((f) => f.contraste && f.contraste.estado !== 'sin_pareja_pdf' && f.contraste.pdf!.sinResolver === 0);
  const tasa = (l: FichaPoule[]) => {
    const malas = l.filter((f) => f.contraste!.estado === 'difiere').length;
    const comparados = l.reduce((s, f) => s + f.contraste!.comparados, 0);
    const marcadores = l.reduce((s, f) => s + f.contraste!.diferencias.filter((d) => d.tipo === 'marcador').length, 0);
    const faltan = l.reduce((s, f) => s + f.contraste!.diferencias.filter((d) => d.tipo === 'falta').length, 0);
    const sobran = l.reduce((s, f) => s + f.contraste!.diferencias.filter((d) => d.tipo === 'sobra').length, 0);
    const [lo, hi] = intervalo(malas, l.length);
    const [blo, bhi] = intervalo(marcadores, comparados);
    return { poules: l.length, conDiferencias: malas, tasaPoules: +(malas / Math.max(1, l.length)).toFixed(4), ic95Poules: [+lo.toFixed(4), +hi.toFixed(4)],
      asaltosComparados: comparados, marcadoresDistintos: marcadores, tasaAsaltos: +(marcadores / Math.max(1, comparados)).toFixed(5),
      ic95Asaltos: [+blo.toFixed(5), +bhi.toFixed(5)], faltanEnBase: faltan, sobranEnBase: sobran };
  };
  const coherentes = verificables.filter((f) => !f.incoherente);
  const muestra = [...coherentes].map((f) => ({ f, k: azar() })).sort((a, b) => a.k - b.k).slice(0, tamMuestra).map((x) => x.f);
  const porExtractor: Record<string, ReturnType<typeof tasa>> = {};
  for (const e of new Set(verificables.map((f) => f.extractor))) porExtractor[e] = tasa(verificables.filter((f) => f.extractor === e));
  const cuenta = <T extends string>(l: Partial<Record<T, number>>[]) => {
    const out: Record<string, number> = {};
    for (const x of l) for (const [k, v] of Object.entries(x)) out[k] = (out[k] ?? 0) + (v as number);
    return out;
  };
  const estados = cuenta(fichas.filter((f) => f.contraste).map((f) => ({ [f.contraste!.estado]: 1 })));
  const inf = {
    generado: new Date().toISOString(),
    base: rutaDb,
    asaltos: asaltos.length,
    pdfs: { urls: urls.length, leidos: [...lecturas.values()].filter((x) => typeof x !== 'string').length,
      fallos: cuenta([...lecturas.values()].filter((x): x is string => typeof x === 'string').map((x) => ({ [x.split(':')[0]]: 1 }))) },
    poules: {
      total: fichas.length,
      incoherentes: fichas.filter((f) => f.incoherente).length,
      individuales: { total: fichas.filter((f) => !f.equipos).length, incoherentes: fichas.filter((f) => !f.equipos && f.incoherente).length,
        problemas: cuenta(fichas.filter((f) => !f.equipos).map((f) => f.aud.problemas)) },
      equipos: { total: fichas.filter((f) => f.equipos).length, incoherentes: fichas.filter((f) => f.equipos && f.incoherente).length },
      problemas: cuenta(fichas.map((f) => f.aud.problemas)),
      variasFuentes: fichas.filter((f) => f.urls > 1).length,
      victoriasBajoTope: fichas.reduce((s, f) => s + f.aud.bajoTope, 0),
      contraste: estados,
      tasaTodas: tasa(verificables),
      tasaCoherentes: tasa(coherentes),
      tasaIncoherentes: tasa(verificables.filter((f) => f.incoherente)),
      tasaMuestra: { semilla: Number(argumento('semilla', '10')), ...tasa(muestra) },
      porExtractor,
    },
    cuadros: {
      total: fichasCuadro.length,
      equiposNoAuditados: cuadrosEquipos,
      conProblemas: fichasCuadro.filter((f) => f.incoherentes > 0 || (f.problemas.lecturas_mezcladas ?? 0) > 0).length,
      problemas: cuenta(fichasCuadro.map((f) => f.problemas)),
      contraste: {
        comparados: fichasCuadro.filter((f) => f.pdf).length,
        asaltosCoinciden: fichasCuadro.reduce((s, f) => s + (f.pdf?.coinciden ?? 0), 0),
        asaltosDifieren: fichasCuadro.reduce((s, f) => s + (f.pdf?.difieren ?? 0), 0),
        asaltosSinPareja: fichasCuadro.reduce((s, f) => s + (f.pdf?.sinPareja ?? 0), 0),
      },
    },
    correcciones: {
      poules: correcciones.length,
      cuadros: correccionesCuadro.length,
      cambios: cuenta([...correcciones, ...correccionesCuadro].flatMap((c) => c.cambios.map((x) => ({ [`${c.fase}:${x.tipo}`]: 1 })))),
      pruebas: new Set([...correcciones, ...correccionesCuadro].map((c) => c.competicion.competitionKey)).size,
    },
    parciales: { pools: [...parciales.values()].filter((p) => p.kind === 'pools').length, tableau: [...parciales.values()].filter((p) => p.kind === 'tableau').length },
    dudosas: { poules: dudosas.length, cuadros: dudasCuadro.length, motivos: cuenta(dudosas.map((d) => ({ [d.motivo.split(':')[0]]: 1 }))),
      motivosCuadro: cuenta(dudasCuadro.map((d) => ({ [d.motivo]: 1 }))) },
    listaPoulesIncoherentes: fichas.filter((f) => f.incoherente).map((f) => ({
      prueba: f.comp.competition_key, temporada: f.comp.season, ronda: f.ronda, equipos: f.equipos, extractor: f.extractor, url: f.url, tiradores: f.aud.tiradores,
      asaltos: f.aud.asaltos, esperados: f.aud.esperados, tope: f.aud.tope, problemas: f.aud.problemas, contraste: f.contraste?.estado ?? 'sin_leer',
    })),
    listaCuadrosIncoherentes: fichasCuadro.filter((f) => f.incoherentes > 0 || f.problemas.lecturas_mezcladas).map((f) => ({
      prueba: f.comp.competition_key, temporada: f.comp.season, extractor: f.extractor, url: f.url, asaltos: f.asaltos, problemas: f.problemas, pdf: f.pdf ?? null,
    })),
    listaDudosas: dudosas,
    listaDudasCuadro: dudasCuadro,
    segundos: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(salida, { recursive: true });
  writeFileSync(join(salida, '_correcciones.json'), JSON.stringify({ generado: inf.generado, base: rutaDb, fases: [...correcciones, ...correccionesCuadro], parciales: [...parciales.values()] }, null, 1));
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 1));
  const { listaPoulesIncoherentes, listaCuadrosIncoherentes, listaDudosas, listaDudasCuadro, ...resumen } = inf;
  void listaPoulesIncoherentes; void listaCuadrosIncoherentes; void listaDudosas; void listaDudasCuadro;
  console.log(JSON.stringify(resumen, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
