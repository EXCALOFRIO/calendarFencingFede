/**
 * Conversión de una lectura de la API de resultados FIE al formato común de
 * hechos (`formato.ts`). La usan el lote manual (`scripts/indexado/fie-a-hechos.ts`,
 * desde la caché local) y la ingesta automática (`src/lib/ingest/resultados-auto`,
 * desde la red): mismas claves y mismo contenido, así que el cargador de cada
 * lado actualiza las mismas filas en vez de duplicarlas. Sin red ni disco.
 */
import { claveEdicionFie } from '../fie-resultados-persist';
import {
  leerPruebaFie,
  urlCuadro,
  urlPoules,
  type EstadoCobertura,
  type LecturaPruebaFie,
  type ParteAsaltos,
} from '../sources/fie-resultados';
import { resultFactKey } from '@/lib/identity/resolver';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from './formato';

type Fetch = (url: string) => Promise<unknown>;
// ---------------------------------------------------------------------------
// Victorias por prioridad
// ---------------------------------------------------------------------------

/**
 * Copia de `ESTADO_RETIRADA` de `fie-resultados.ts` (no exportada): un cruce de
 * cuadro igualado cuyo perdedor tiene uno de estos estados es una retirada,
 * no una victoria por prioridad.
 */
const ESTADO_RETIRADA = /^(A|M|N|E|F|MED|DNF|DNS|EXC)$/;

type Crudo = Record<string, unknown> | null | undefined;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

type Prioridad = { asaltos: AsaltoHecho[]; ceroCero: number };

function orientar(
  phase: AsaltoHecho['phase'],
  roundKey: string,
  id1: number,
  id2: number,
  n1: string,
  n2: string,
  score: number,
  gana1: boolean,
): AsaltoHecho {
  const a = String(id1);
  const b = String(id2);
  const swapped = a > b;
  return {
    phase,
    roundKey,
    aRef: swapped ? b : a,
    bRef: swapped ? a : b,
    aName: swapped ? n2 : n1,
    bName: swapped ? n1 : n2,
    scoreA: score,
    scoreB: score,
    winner: gana1 !== swapped ? 'A' : 'B',
  };
}

/**
 * Asaltos con marcador igualado y un único ganador, que el lector excluye como
 * `empate`. Un 0-0 con ganador no se toma como prioridad (suele ser una
 * incomparecencia sin estado publicado) y sólo se cuenta.
 */
export function asaltosPorPrioridad(poules: unknown, cuadro: unknown): Prioridad {
  const asaltos: AsaltoHecho[] = [];
  let ceroCero = 0;
  const vistos = new Set<string>();
  const anadir = (x: AsaltoHecho) => {
    if (x.scoreA > MAX_TOCADOS) return;
    const clave = `${x.phase}|${x.roundKey}|${x.aRef}|${x.bRef}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    asaltos.push(x);
  };

  const pools = (poules as { pools?: unknown })?.pools;
  if (Array.isArray(pools)) {
    // Misma clave de ronda que `normalizarPoules`: la segunda vuelta repite los poolId.
    const vueltas = new Map<number, number>();
    for (const poule of pools as Crudo[]) {
      const poolId = num(poule?.poolId);
      const filas = poule?.rows;
      if (poolId === null || !Array.isArray(filas)) continue;
      const vuelta = (vueltas.get(poolId) ?? 0) + 1;
      vueltas.set(poolId, vuelta);
      const ronda = vuelta === 1 ? `P${poolId}` : `V${vuelta}P${poolId}`;
      for (let i = 0; i < filas.length; i += 1) {
        for (let j = i + 1; j < filas.length; j += 1) {
          const fi = filas[i] as Crudo;
          const fj = filas[j] as Crudo;
          const ij = (Array.isArray(fi?.matches) ? fi.matches[j] : null) as Crudo;
          const ji = (Array.isArray(fj?.matches) ? fj.matches[i] : null) as Crudo;
          const si = num(ij?.score);
          const sj = num(ji?.score);
          if (si === null || sj === null || si !== sj) continue;
          if (typeof ij?.v !== 'boolean' || typeof ji?.v !== 'boolean' || ij.v === ji.v) continue;
          const idI = num(fi?.fencerId);
          const idJ = num(fj?.fencerId);
          if (idI === null || idJ === null || idI === idJ) continue;
          if (si === 0) {
            ceroCero += 1;
            continue;
          }
          anadir(orientar('POULE', ronda, idI, idJ, txt(fi?.name) ?? `FIE ${idI}`,
            txt(fj?.name) ?? `FIE ${idJ}`, si, ij.v === true));
        }
      }
    }
  }

  const tableau = (cuadro as { tableau?: unknown })?.tableau;
  if (Array.isArray(tableau)) {
    for (const t of tableau as Crudo[]) {
      const rounds = t?.rounds;
      if (!rounds || typeof rounds !== 'object') continue;
      for (const [ronda, cruces] of Object.entries(rounds as Record<string, unknown>)) {
        if (!Array.isArray(cruces)) continue;
        for (const c of cruces as Crudo[]) {
          if (c?.isBye === true) continue;
          const f1 = c?.fencer1 as Crudo;
          const f2 = c?.fencer2 as Crudo;
          const s1 = num(f1?.score);
          const s2 = num(f2?.score);
          if (s1 === null || s2 === null || s1 !== s2) continue;
          const w1 = f1?.isWinner === true;
          if (w1 === (f2?.isWinner === true)) continue;
          const perdedor = w1 ? f2 : f1;
          const retirada = [perdedor?.status, perdedor?.newStatus]
            .some((s) => typeof s === 'string' && ESTADO_RETIRADA.test(s.trim().toUpperCase()));
          if (retirada) continue;
          const id1 = num(f1?.id);
          const id2 = num(f2?.id);
          if (id1 === null || id2 === null || id1 === id2) continue;
          if (s1 === 0) {
            ceroCero += 1;
            continue;
          }
          anadir(orientar('TABLEAU', ronda, id1, id2, txt(f1?.name) ?? `FIE ${id1}`,
            txt(f2?.name) ?? `FIE ${id2}`, s1, w1));
        }
      }
    }
  }
  return { asaltos, ceroCero };
}

// ---------------------------------------------------------------------------
// Conversión de una lectura
// ---------------------------------------------------------------------------

type EstadoHecho = HechosPrueba['status']['results'];

function estadoHecho(e: EstadoCobertura): EstadoHecho {
  if (e === 'completo') return 'completo';
  if (e === 'sin_resultados') return 'sin_resultados';
  if (e === 'error') return 'ilegible';
  return 'parcial';
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PAIS = /^[A-Z]{3}$/;
const PUNTOS = /^-?\d+(\.\d+)?$/;
const MAX_TOCADOS = 45;

function fechaONull(v: string | null, campo: string, notas: string[]): string | null {
  if (v === null) return null;
  if (FECHA.test(v)) return v;
  notas.push(`${campo} publicada con formato no ISO; se deja vacía`);
  return null;
}

function estadoAsaltos(parte: ParteAsaltos, delta: number): EstadoHecho {
  const { estado, publicado, importado } = parte.cobertura;
  if ((estado === 'parcial' || estado === 'completo') && publicado !== null) {
    return importado + delta >= publicado ? 'completo' : 'parcial';
  }
  return estadoHecho(estado);
}

function notaExclusiones(nombre: string, parte: ParteAsaltos | null): string | null {
  if (!parte) return null;
  const motivos = Object.entries(parte.excluidos).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
  return motivos.length ? `${nombre} excluidos por el lector: ${motivos.join(', ')}` : null;
}

export type Conversion =
  | { ok: true; hechos: HechosPrueba; prioridad: number; fueraDeRango: number }
  | { ok: false; codigo: string; detalle: string };

export async function convertirPrueba(
  season: number,
  competitionId: number,
  fetchJson: Fetch,
  opciones: { tamanoPagina: number; sourceSha256: (usadas: string[]) => string },
): Promise<Conversion> {
  const usadas: string[] = [];
  const fetchRegistrado: Fetch = async (url) => {
    usadas.push(url);
    return fetchJson(url);
  };
  const lectura: LecturaPruebaFie = await leerPruebaFie(season, competitionId, { fetchJson: fetchRegistrado }, {
    tamanoPagina: opciones.tamanoPagina,
    maxPaginas: 100,
  });
  if (!lectura.prueba) return { ok: false, codigo: 'metadata', detalle: lectura.errorPrueba ?? 'sin metadata' };
  const p = lectura.prueba;
  const individual = p.formato === 'INDIVIDUAL';
  const notas: string[] = [];

  const results: ResultadoHecho[] = [];
  const ranking = lectura.ranking;
  if (ranking && ranking.cobertura.estado !== 'error') {
    for (const r of ranking.puestos) {
      let pais = r.paisCodigo;
      if (pais !== null && !PAIS.test(pais)) pais = null;
      let puntos = r.puntosPrueba === null ? null : String(r.puntosPrueba);
      if (puntos !== null && !PUNTOS.test(puntos)) puntos = null;
      results.push({
        factKey: individual ? resultFactKey(String(r.fieId)) : `team:${r.fieId}`,
        name: r.nombre,
        countryCode: pais,
        club: null,
        position: r.posicion,
        positionRaw: r.posicion === null ? null : String(r.posicion),
        points: puntos,
        fieId: individual ? String(r.fieId) : null,
        license: null,
        birthYear: null,
      });
    }
    const paisInvalido = ranking.puestos.filter((r) => r.paisCodigo !== null && !PAIS.test(r.paisCodigo)).length;
    if (paisInvalido) notas.push(`${paisInvalido} puestos con código de país no ISO-3; se deja vacío`);
  }
  if (ranking?.cobertura.error) notas.push(`ranking: ${ranking.cobertura.error}`);
  if (!individual) {
    notas.push('Prueba por equipos: factKey team:<id> es el ID FIE del equipo; fieId queda vacío');
  }

  const bouts: AsaltoHecho[] = [];
  const fuera = { POULE: 0, TABLEAU: 0 };
  for (const parte of [lectura.poules, lectura.cuadro]) {
    if (!parte || parte.cobertura.estado === 'error') continue;
    for (const a of parte.asaltos) {
      // The FIE has published typos such as 154-12 for 15-4; the facts schema caps scores at 45.
      if (a.puntosA > MAX_TOCADOS || a.puntosB > MAX_TOCADOS) {
        fuera[a.fase] += 1;
        continue;
      }
      bouts.push({
        phase: a.fase,
        roundKey: a.ronda,
        aRef: a.refA,
        bRef: a.refB,
        aName: a.nombreA,
        bName: a.nombreB,
        scoreA: a.puntosA,
        scoreB: a.puntosB,
        winner: null,
      });
    }
  }

  const fueraDeRango = fuera.POULE + fuera.TABLEAU;
  if (fueraDeRango) {
    notas.push(`${fueraDeRango} asaltos con marcador superior a ${MAX_TOCADOS} excluidos (errata probable de la fuente)`);
  }

  let extraPoules = 0;
  let extraCuadro = 0;
  if (individual) {
    const crudo = async (url: string, parte: ParteAsaltos | null) => {
      if (!parte || parte.cobertura.estado === 'error') return null;
      try {
        return await fetchJson(url);
      } catch {
        return null;
      }
    };
    const prioridad = asaltosPorPrioridad(
      await crudo(urlPoules(season, competitionId), lectura.poules),
      await crudo(urlCuadro(season, competitionId), lectura.cuadro),
    );
    const existentes = new Set(bouts.map((b) => `${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`));
    for (const b of prioridad.asaltos) {
      if (existentes.has(`${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`)) continue;
      bouts.push(b);
      if (b.phase === 'POULE') extraPoules += 1;
      else extraCuadro += 1;
    }
    if (extraPoules + extraCuadro) {
      notas.push(`${extraPoules + extraCuadro} asaltos con marcador igualado y ganador publicado (prioridad) añadidos con winner; el lector los excluye como empate`);
    }
    if (prioridad.ceroCero) notas.push(`${prioridad.ceroCero} asaltos 0-0 con ganador no se añaden (probable incomparecencia)`);
  }
  for (const n of [notaExclusiones('poules', lectura.poules), notaExclusiones('cuadro', lectura.cuadro)]) {
    if (n) notas.push(n);
  }
  for (const [nombre, parte] of [['poules', lectura.poules], ['cuadro', lectura.cuadro]] as const) {
    if (parte?.cobertura.error) notas.push(`${nombre}: ${parte.cobertura.error}`);
  }

  const { clave: tournamentKey } = claveEdicionFie(p);
  const federacion = p.federacion !== null && PAIS.test(p.federacion) ? p.federacion : null;
  const status: HechosPrueba['status'] = {
    results: ranking ? estadoHecho(ranking.cobertura.estado) : 'sin_resultados',
    pools: lectura.poules ? estadoAsaltos(lectura.poules, extraPoules - fuera.POULE) : 'sin_resultados',
    tableau: lectura.cuadro ? estadoAsaltos(lectura.cuadro, extraCuadro - fuera.TABLEAU) : 'sin_resultados',
    publishedParticipants: ranking?.cobertura.publicado ?? null,
    notes: notas,
  };
  const borrador = {
    version: 1 as const,
    source: 'fie' as const,
    extractor: 'lector_fie',
    sourceUrl: p.url,
    sourceSha256: opciones.sourceSha256(usadas),
    edition: {
      season: String(p.season),
      tournamentKey,
      name: p.nombre ?? `FIE ${p.season}/${p.competitionId}`,
      startDate: fechaONull(p.inicio, 'Fecha de inicio', notas),
      endDate: fechaONull(p.fin, 'Fecha de fin', notas),
      city: p.ciudad,
      countryCode: federacion,
    },
    competition: {
      competitionKey: String(p.competitionId),
      weapon: p.arma,
      gender: p.genero,
      category: p.categoria,
      categoryRaw: p.categoriaOriginal,
      format: p.formato,
      date: fechaONull(p.fecha, 'Fecha de la prueba', notas),
    },
    status,
    results,
    bouts,
  };
  const r = hechosPrueba.safeParse(borrador);
  if (!r.success) {
    const rutas = [...new Set(r.error.issues.map((i) => i.path.map((x) => (typeof x === 'number' ? '#' : String(x))).join('.')))];
    return { ok: false, codigo: 'esquema', detalle: rutas.slice(0, 10).join('; ') };
  }
  return { ok: true, hechos: r.data, prioridad: extraPoules + extraCuadro, fueraDeRango };
}

