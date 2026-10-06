import { fixDoubleEncodedUtf8 } from '../../src/lib/ingest/fetcher';
import type { AsaltoHecho } from '../../src/lib/ingest/hechos/formato';
import { normalizarCuadro, normalizarPoules, realinearPoule } from '../../src/lib/ingest/sources/fie-resultados';

/**
 * Análisis puro de las poules y el cuadro que publica la API FIE: cuántos
 * asaltos hubo (teóricos y disputados), cuáles se pueden leer (los del lector
 * de producción más las victorias por prioridad con marcador igualado) y por
 * qué no se leen los demás. Lo usan la auditoría y el paso a hechos.
 */

export const MAX_TOCADOS = 45;

/** Estados FIE de quien pierde sin disputar (copia de `ESTADO_RETIRADA` del lector). */
const ESTADO_RETIRADA = /^(A|M|N|E|F|MED|DNF|DNS|EXC)$/;

/** Motivos por los que un asalto disputado no se puede importar: el dato publicado está roto. */
export type MotivoIlegible =
  | 'sin_celdas'
  | 'no_reciproco'
  | 'sin_marcador'
  | 'sin_ganador'
  | 'incoherente'
  | 'sin_id'
  | 'fuera_de_rango'
  | 'poule_sin_datos';

/** Cruces que no se disputaron: retirada, abandono antes de tirar, incomparecencia. */
export type MotivoNoDisputado = 'cero_cero' | 'cero_cero_con_victoria' | 'retirada' | 'arrastrado';

export type AnalisisFase = {
  /** La FIE publica grupos (poules o cuadros) con filas. */
  publicado: boolean;
  grupos: number;
  /** Poules: Σ n·(n−1)/2 por poule; cuadro: cruces sin BYE (sin contar el cuadro repetido). */
  teorico: number;
  noDisputados: Partial<Record<MotivoNoDisputado, number>>;
  /** Asaltos importables: los del lector de producción + prioridad. */
  asaltos: AsaltoHecho[];
  prioridad: number;
  ilegibles: Partial<Record<MotivoIlegible, number>>;
  /** Ejemplos de ilegibles para el informe. */
  ejemplos: string[];
  /** IDs FIE que aparecen en la fase. */
  tiradores: Set<string>;
  /** Poules: la FIE repite poolId (dos vueltas) o desordena la matriz. */
  vueltas: number;
  realineadas: number;
};

const limpio = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = fixDoubleEncodedUtf8(v).trim();
  return t || null;
};
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const sumar = <K extends string>(m: Partial<Record<K, number>>, k: K, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};
export const total = (m: Partial<Record<string, number>>): number => Object.values(m).reduce<number>((a, b) => a + (b ?? 0), 0);
export const claveAsalto = (b: Pick<AsaltoHecho, 'phase' | 'roundKey' | 'aRef' | 'bRef'>): string =>
  `${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`;

function vacia(): AnalisisFase {
  return {
    publicado: false, grupos: 0, teorico: 0, noDisputados: {}, asaltos: [], prioridad: 0, ilegibles: {}, ejemplos: [],
    tiradores: new Set(), vueltas: 0, realineadas: 0,
  };
}

function orientado(
  phase: AsaltoHecho['phase'], roundKey: string, id1: number, id2: number, n1: string, n2: string, s1: number, s2: number,
  winner1: boolean | null,
): AsaltoHecho {
  const a = String(id1);
  const b = String(id2);
  const giro = a > b;
  const w = winner1 === null ? null : winner1 !== giro ? 'A' : 'B';
  return {
    phase, roundKey, aRef: giro ? b : a, bRef: giro ? a : b, aName: giro ? n2 : n1, bName: giro ? n1 : n2,
    scoreA: giro ? s2 : s1, scoreB: giro ? s1 : s2, winner: w,
  };
}

type Celda = { score?: number | null; v?: boolean | null } | null | undefined;
type Fila = { fencerId?: number | null; name?: string | null; matches?: Celda[] };

export function analizarPoules(cuerpo: unknown): AnalisisFase {
  const res = vacia();
  const pools = (cuerpo as { pools?: unknown })?.pools;
  if (!Array.isArray(pools)) return res;
  const lector = normalizarPoules(cuerpo, { individual: true });
  const normales = lector.ok ? lector.parte.asaltos : [];
  for (const a of normales) {
    if (a.puntosA > MAX_TOCADOS || a.puntosB > MAX_TOCADOS) continue;
    res.asaltos.push({
      phase: 'POULE', roundKey: a.ronda, aRef: a.refA, bRef: a.refB, aName: a.nombreA, bName: a.nombreB,
      scoreA: a.puntosA, scoreB: a.puntosB, winner: null,
    });
  }
  const vistos = new Set(res.asaltos.map(claveAsalto));
  const vueltas = new Map<number, number>();
  const cruzados = new Set<string>();
  for (const poule of pools as { poolId?: number; rows?: Fila[] }[]) {
    const poolId = entero(poule?.poolId);
    const filasOriginales = Array.isArray(poule?.rows) ? poule.rows.map((f) => ({ ...f, matches: Array.isArray(f?.matches) ? f.matches : [] })) : [];
    if (poolId === null || filasOriginales.length === 0) continue;
    res.publicado = true;
    res.grupos += 1;
    const vuelta = (vueltas.get(poolId) ?? 0) + 1;
    vueltas.set(poolId, vuelta);
    res.vueltas = Math.max(res.vueltas, vuelta);
    const ronda = vuelta === 1 ? `P${poolId}` : `V${vuelta}P${poolId}`;
    const filas = realinearPoule(filasOriginales);
    // Los asaltos contra un tirador quitado de la poule quedan anulados y no cuentan en el teórico.
    if (filas.some((f, i) => f.matches !== filasOriginales[i].matches)) res.realineadas += 1;
    const n = filas.length;
    res.teorico += (n * (n - 1)) / 2;
    for (const f of filas) if (entero(f.fencerId) !== null) res.tiradores.add(String(f.fencerId));
    const disputada = filas.some((f) => f.matches.some((c) => c?.v === true));
    // Fila y columna enteras vacías: se retiró antes de tirar ningún asalto.
    const sinAsaltos = new Set<number>();
    for (let k = 0; k < n; k += 1) {
      let vaciaEntera = true;
      for (let o = 0; o < n && vaciaEntera; o += 1) if (o !== k && (filas[k].matches[o] || filas[o].matches[k])) vaciaEntera = false;
      if (vaciaEntera) sinAsaltos.add(k);
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const ij = filas[i].matches[j];
        const ji = filas[j].matches[i];
        const ejemplo = (m: string) => {
          if (res.ejemplos.length < 6) res.ejemplos.push(`${ronda} ${limpio(filas[i].name)} ${JSON.stringify(ij)} / ${limpio(filas[j].name)} ${JSON.stringify(ji)}: ${m}`);
        };
        if (!disputada) {
          sumar(res.ilegibles, 'poule_sin_datos');
          continue;
        }
        if (!ij && !ji && (sinAsaltos.has(i) || sinAsaltos.has(j))) {
          sumar(res.noDisputados, 'retirada');
          continue;
        }
        const par = [String(filas[i].fencerId), String(filas[j].fencerId)].sort().join('|');
        // En la segunda vuelta no se repite el asalto de dos tiradores que ya se cruzaron en la
        // primera: su resultado se arrastra y la celda queda vacía.
        if (!ij && !ji && vuelta > 1 && cruzados.has(par)) {
          sumar(res.noDisputados, 'arrastrado');
          continue;
        }
        if (ij || ji) cruzados.add(par);
        if (!ij && !ji) {
          sumar(res.ilegibles, 'sin_celdas');
          ejemplo('sin_celdas');
          continue;
        }
        if (!ij || !ji) {
          sumar(res.ilegibles, 'no_reciproco');
          ejemplo('no_reciproco');
          continue;
        }
        const si = entero(ij.score);
        const sj = entero(ji.score);
        if (si === null || sj === null || typeof ij.v !== 'boolean' || typeof ji.v !== 'boolean') {
          sumar(res.ilegibles, 'sin_marcador');
          continue;
        }
        if (si === 0 && sj === 0) {
          sumar(res.noDisputados, ij.v === ji.v ? 'cero_cero' : 'cero_cero_con_victoria');
          continue;
        }
        if (ij.v === ji.v) {
          sumar(res.ilegibles, 'sin_ganador');
          ejemplo('sin_ganador');
          continue;
        }
        const ganador = ij.v ? si : sj;
        const perdedor = ij.v ? sj : si;
        if (ganador < perdedor) {
          sumar(res.ilegibles, 'incoherente');
          ejemplo('incoherente');
          continue;
        }
        const idI = entero(filas[i].fencerId);
        const idJ = entero(filas[j].fencerId);
        if (idI === null || idJ === null || idI === idJ) {
          sumar(res.ilegibles, 'sin_id');
          continue;
        }
        if (si > MAX_TOCADOS || sj > MAX_TOCADOS) {
          sumar(res.ilegibles, 'fuera_de_rango');
          continue;
        }
        if (si !== sj) continue; // ya lo emite el lector
        const b = orientado('POULE', ronda, idI, idJ, limpio(filas[i].name) ?? `FIE ${idI}`, limpio(filas[j].name) ?? `FIE ${idJ}`,
          si, sj, ij.v === true);
        const k = claveAsalto(b);
        if (vistos.has(k)) continue;
        vistos.add(k);
        res.asaltos.push(b);
        res.prioridad += 1;
      }
    }
  }
  return res;
}

type Tirador = { id?: number | null; name?: string | null; isWinner?: boolean | null; score?: number | null; status?: string | null; newStatus?: string | null } | null | undefined;

const esBye = (t: Tirador) => !t || (entero(t.id) === null && /^\s*-?\s*bye\s*-?\s*$/i.test(t.name ?? ''));
const retirado = (t: Tirador) => [t?.status, t?.newStatus].some((s) => typeof s === 'string' && ESTADO_RETIRADA.test(s.trim().toUpperCase()));

export function analizarCuadro(cuerpo: unknown): AnalisisFase {
  const res = vacia();
  const tableau = (cuerpo as { tableau?: unknown })?.tableau;
  if (!Array.isArray(tableau)) return res;
  const lector = normalizarCuadro(cuerpo, { individual: true });
  for (const a of lector.ok ? lector.parte.asaltos : []) {
    if (a.puntosA > MAX_TOCADOS || a.puntosB > MAX_TOCADOS) continue;
    res.asaltos.push({
      phase: 'TABLEAU', roundKey: a.ronda, aRef: a.refA, bRef: a.refB, aName: a.nombreA, bName: a.nombreB,
      scoreA: a.puntosA, scoreB: a.puntosB, winner: null,
    });
  }
  // El mismo cruce publicado en dos cuadros (A64..A2 y F64..F1) cuenta una vez, como en el lector.
  const pares = new Set<string>();
  const prioridad: AsaltoHecho[] = [];
  for (const t of tableau as { rounds?: Record<string, unknown> }[]) {
    if (!t?.rounds || typeof t.rounds !== 'object') continue;
    let filas = 0;
    for (const [ronda, cruces] of Object.entries(t.rounds)) {
      if (!Array.isArray(cruces)) continue;
      for (const c of cruces as { fencer1?: Tirador; fencer2?: Tirador; isBye?: boolean | null }[]) {
        filas += 1;
        const f1 = c?.fencer1;
        const f2 = c?.fencer2;
        for (const f of [f1, f2]) if (entero(f?.id) !== null) res.tiradores.add(String(f!.id));
        if (c?.isBye === true || esBye(f1) || esBye(f2)) continue;
        const id1 = entero(f1?.id);
        const id2 = entero(f2?.id);
        const s1 = entero(f1?.score);
        const s2 = entero(f2?.score);
        const w1 = f1?.isWinner === true;
        const w2 = f2?.isWinner === true;
        // Firma de par y marcador para no contar dos veces el cuadro repetido.
        const par = id1 !== null && id2 !== null
          ? `${Math.min(id1, id2)}|${Math.max(id1, id2)}|${[s1, s2].sort().join('|')}`
          : null;
        if (par && pares.has(par)) continue;
        if (par) pares.add(par);
        res.teorico += 1;
        if (s1 !== null && s1 === s2 && w1 !== w2 && retirado(w1 ? f2 : f1)) {
          sumar(res.noDisputados, 'retirada');
          continue;
        }
        if (id1 === null || id2 === null || id1 === id2) {
          sumar(res.ilegibles, 'sin_id');
          continue;
        }
        if (s1 === null || s2 === null) {
          sumar(res.ilegibles, 'sin_marcador');
          continue;
        }
        if (w1 === w2) {
          sumar(res.ilegibles, 'sin_ganador');
          if (res.ejemplos.length < 6) res.ejemplos.push(`${ronda} ${limpio(f1?.name)} ${s1} / ${limpio(f2?.name)} ${s2}: sin_ganador`);
          continue;
        }
        if (s1 === 0 && s2 === 0) {
          sumar(res.noDisputados, 'cero_cero_con_victoria');
          continue;
        }
        if ((w1 ? s1 : s2) < (w1 ? s2 : s1)) {
          // Ganador con menos tocados: abandono a mitad de asalto u error de la fuente.
          sumar(res.ilegibles, 'incoherente');
          if (res.ejemplos.length < 6) res.ejemplos.push(`${ronda} ${limpio(f1?.name)} ${s1}${w1 ? 'V' : ''} ${f1?.status ?? ''} / ${limpio(f2?.name)} ${s2}${w2 ? 'V' : ''} ${f2?.status ?? ''}: incoherente`);
          continue;
        }
        if (s1 > MAX_TOCADOS || s2 > MAX_TOCADOS) {
          sumar(res.ilegibles, 'fuera_de_rango');
          continue;
        }
        if (s1 !== s2) continue; // ya lo emite el lector
        prioridad.push(orientado('TABLEAU', ronda, id1, id2, limpio(f1?.name) ?? `FIE ${id1}`, limpio(f2?.name) ?? `FIE ${id2}`, s1, s2, w1));
      }
    }
    if (filas > 0) {
      res.publicado = true;
      res.grupos += 1;
    }
  }
  const vistos = new Set(res.asaltos.map(claveAsalto));
  const porPar = new Map<string, AsaltoHecho>();
  for (const b of prioridad) {
    const k = `${b.aRef}|${b.bRef}|${b.scoreA}`;
    const previo = porPar.get(k);
    if (!previo || (/^A\d+$/.test(b.roundKey) && !/^A\d+$/.test(previo.roundKey))) porPar.set(k, b);
  }
  for (const b of porPar.values()) {
    if (vistos.has(claveAsalto(b))) continue;
    vistos.add(claveAsalto(b));
    res.asaltos.push(b);
    res.prioridad += 1;
  }
  return res;
}

/** Disputados según la fuente = teóricos − no disputados. */
export const disputados = (a: AnalisisFase): number => a.teorico - total(a.noDisputados);
