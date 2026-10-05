import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CacheEndpoint, CacheManifest } from '../../src/lib/ingest/backfill/cache-local';
import { claveEdicionFie } from '../../src/lib/ingest/fie-resultados-persist';
import {
  leerPruebaFie,
  urlCuadro,
  urlPoules,
  type EstadoCobertura,
  type LecturaPruebaFie,
  type ParteAsaltos,
} from '../../src/lib/ingest/sources/fie-resultados';
import { resultFactKey } from '../../src/lib/identity/resolver';
import {
  ficheroHechos,
  hechosPrueba,
  type AsaltoHecho,
  type HechosPrueba,
  type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';

/**
 * Convierte la caché local de la API FIE en ficheros de hechos (un JSON por
 * prueba, formato `hechosPrueba`) usando el mismo lector que la importación.
 * Las claves (temporada, competition_key, source_fact_key, refs de asalto)
 * son las de `fie-resultados-persist.ts`, para que el cargador actualice las
 * filas existentes en vez de duplicarlas.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-a-hechos.ts \
 *     [--cache <dir>] [--salida <dir>] [--base <sqlite>] [--limite N] [--concurrencia N]
 *
 * Sólo lee la caché y la base (en modo lectura); no hace peticiones de red.
 */

const TEMP = process.env.TEMP ?? process.env.TMP ?? '/tmp';
const POR_DEFECTO = {
  cache: path.join(TEMP, 'qa-prod-calendario', 'cache-fie-2018'),
  salida: path.join(TEMP, 'calendario-trabajo', 'hechos', 'fie'),
};

type Fetch = (url: string) => Promise<unknown>;

export function urlCanonica(url: string): string {
  const u = new URL(url);
  const q = [...u.searchParams.entries()]
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
}

const sha256 = (datos: Uint8Array | string) => createHash('sha256').update(datos).digest('hex');

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
    for (const poule of pools as Crudo[]) {
      const poolId = num(poule?.poolId);
      const filas = poule?.rows;
      if (poolId === null || !Array.isArray(filas)) continue;
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
          anadir(orientar('POULE', `P${poolId}`, idI, idJ, txt(fi?.name) ?? `FIE ${idI}`,
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

// ---------------------------------------------------------------------------
// Caché local
// ---------------------------------------------------------------------------

type Unidad = { season: number; competitionId: number; registros: CacheEndpoint[] };

async function cargarCache(raiz: string) {
  const manifest = JSON.parse(await readFile(path.join(raiz, 'manifest.json'), 'utf8')) as CacheManifest;
  if (manifest.version !== 1 || !manifest.units || !manifest.endpoints) throw new Error('manifest_invalido');
  const porUnidad = new Map<string, CacheEndpoint[]>();
  for (const r of Object.values(manifest.endpoints)) {
    const lista = porUnidad.get(r.unitKey) ?? [];
    lista.push(r);
    porUnidad.set(r.unitKey, lista);
  }
  const unidades: Unidad[] = Object.values(manifest.units)
    .filter((u) => u.competitionId !== null && u.season >= 2000)
    .map((u) => ({ season: u.season, competitionId: u.competitionId!, registros: porUnidad.get(u.key) ?? [] }))
    .sort((a, b) => a.season - b.season || a.competitionId - b.competitionId);
  return unidades;
}

async function fetchDeUnidad(raiz: string, u: Unidad) {
  const porUrl = new Map<string, CacheEndpoint>();
  for (const r of u.registros) porUrl.set(urlCanonica(r.url), r);
  const leidos = new Map<string, unknown>();
  const fetchJson: Fetch = async (url) => {
    const clave = urlCanonica(url);
    if (leidos.has(clave)) return leidos.get(clave);
    const r = porUrl.get(clave);
    if (!r || !r.blobSha256) throw new Error('cache_miss');
    if (r.status < 200 || r.status >= 300) throw new Error(`http_${r.status}`);
    const bytes = new Uint8Array(await readFile(path.join(raiz, 'blobs', r.blobSha256.slice(0, 2), `${r.blobSha256}.blob`)));
    if (sha256(bytes) !== r.blobSha256) throw new Error('hash_mismatch');
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new Error('malformed_document');
    }
    leidos.set(clave, cuerpo);
    return cuerpo;
  };
  const tamanos = new Set(
    u.registros
      .map((r) => new URL(r.url))
      .filter((x) => x.pathname.endsWith('/results/ranking'))
      .map((x) => Number(x.searchParams.get('pageSize')))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  const tamanoPagina = tamanos.size === 1 ? [...tamanos][0] : 200;
  const sourceSha256 = (usadas: string[]) => {
    const pares = [...new Set(usadas.map(urlCanonica))].sort()
      .map((x) => [x, porUrl.get(x)?.blobSha256 ?? null]);
    return sha256(JSON.stringify(pares));
  };
  return { fetchJson, tamanoPagina, sourceSha256 };
}

// ---------------------------------------------------------------------------
// Comparación con la base (sólo lectura)
// ---------------------------------------------------------------------------

type Recuento = { results: Set<string>; bouts: Set<string> };

async function cargarBase(ruta: string): Promise<Map<string, Recuento>> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(ruta, { readOnly: true });
  const mapa = new Map<string, Recuento>();
  const de = (k: string) => {
    let r = mapa.get(k);
    if (!r) mapa.set(k, (r = { results: new Set(), bouts: new Set() }));
    return r;
  };
  try {
    for (const c of db.prepare("select season, competition_key k from sport_competition where source = 'fie'").all()) {
      de(`${c.season}|${c.k}`);
    }
    const res = db.prepare(`select c.season, c.competition_key k, r.source_fact_key f from sport_result r
      join sport_competition c on c.id = r.competition_id where r.source = 'fie'`);
    for (const r of res.iterate()) de(`${r.season}|${r.k}`).results.add(String(r.f));
    const bts = db.prepare(`select c.season, c.competition_key k, b.phase, b.round_key, b.fencer_a_ref a, b.fencer_b_ref b
      from sport_bout b join sport_competition c on c.id = b.competition_id where b.source = 'fie'`);
    for (const b of bts.iterate()) de(`${b.season}|${b.k}`).bouts.add(`${b.phase}|${b.round_key}|${b.a}|${b.b}`);
  } finally {
    db.close();
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argumentos(argv: string[]) {
  const o = { cache: POR_DEFECTO.cache, salida: POR_DEFECTO.salida, base: null as string | null, limite: Infinity, concurrencia: 8 };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, valor] = [argv[i], argv[i + 1]];
    if (valor === undefined) throw new Error(`Falta el valor de ${flag}`);
    if (flag === '--cache') o.cache = valor;
    else if (flag === '--salida') o.salida = valor;
    else if (flag === '--base') o.base = valor;
    else if (flag === '--limite') o.limite = Number(valor);
    else if (flag === '--concurrencia') o.concurrencia = Number(valor);
    else throw new Error(`Opción desconocida ${flag}`);
  }
  return o;
}

async function main() {
  const o = argumentos(process.argv.slice(2));
  const inicio = Date.now();
  const unidades = (await cargarCache(o.cache)).slice(0, o.limite);
  await mkdir(o.salida, { recursive: true });

  const informe = {
    generadoEl: new Date().toISOString(),
    cache: o.cache,
    unidades: unidades.length,
    competitions: 0,
    results: 0,
    bouts: 0,
    boutsPrioridad: 0,
    boutsFueraDeRango: 0,
    porFormato: { INDIVIDUAL: 0, EQUIPOS: 0 } as Record<string, number>,
    estados: { results: {}, pools: {}, tableau: {} } as Record<'results' | 'pools' | 'tableau', Record<string, number>>,
    errores: [] as { season: number; competitionId: number; codigo: string; detalle: string }[],
    erroresPorCodigo: {} as Record<string, number>,
    comparacionBase: null as unknown,
    segundos: 0,
  };
  const propios = new Map<string, Recuento>();
  const ficheros = new Set<string>();

  let siguiente = 0;
  async function trabajador() {
    while (siguiente < unidades.length) {
      const u = unidades[siguiente++];
      try {
        const f = await fetchDeUnidad(o.cache, u);
        const c = await convertirPrueba(u.season, u.competitionId, f.fetchJson, f);
        if (!c.ok) {
          informe.errores.push({ season: u.season, competitionId: u.competitionId, codigo: c.codigo, detalle: c.detalle });
          continue;
        }
        const h = hechosPrueba.parse(c.hechos);
        const nombre = ficheroHechos(h);
        if (ficheros.has(nombre)) throw new Error(`fichero_duplicado ${nombre}`);
        ficheros.add(nombre);
        await writeFile(path.join(o.salida, nombre), `${JSON.stringify(h, null, 1)}\n`, 'utf8');
        informe.competitions += 1;
        informe.results += h.results.length;
        informe.bouts += h.bouts.length;
        informe.boutsPrioridad += c.prioridad;
        informe.boutsFueraDeRango += c.fueraDeRango;
        informe.porFormato[h.competition.format] += 1;
        for (const k of ['results', 'pools', 'tableau'] as const) {
          informe.estados[k][h.status[k]] = (informe.estados[k][h.status[k]] ?? 0) + 1;
        }
        propios.set(`${h.edition.season}|${h.competition.competitionKey}`, {
          results: new Set(h.results.map((r) => r.factKey)),
          bouts: new Set(h.bouts.map((b) => `${b.phase}|${b.roundKey}|${b.aRef}|${b.bRef}`)),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        informe.errores.push({ season: u.season, competitionId: u.competitionId, codigo: 'excepcion', detalle: msg.slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrencia) }, trabajador));
  for (const e of informe.errores) informe.erroresPorCodigo[e.codigo] = (informe.erroresPorCodigo[e.codigo] ?? 0) + 1;
  informe.errores.sort((a, b) => a.season - b.season || a.competitionId - b.competitionId);

  if (o.base) {
    const base = await cargarBase(o.base);
    let baseResults = 0;
    let baseBouts = 0;
    const faltanEnSalida: string[] = [];
    const inferiores: unknown[] = [];
    let resultadosBaseAusentes = 0;
    let asaltosBaseAusentes = 0;
    let resultadosNuevos = 0;
    let asaltosNuevos = 0;
    for (const [k, b] of base) {
      baseResults += b.results.size;
      baseBouts += b.bouts.size;
      const p = propios.get(k);
      if (!p) {
        faltanEnSalida.push(k);
        resultadosBaseAusentes += b.results.size;
        asaltosBaseAusentes += b.bouts.size;
        continue;
      }
      const rAus = [...b.results].filter((x) => !p.results.has(x)).length;
      const bAus = [...b.bouts].filter((x) => !p.bouts.has(x)).length;
      resultadosBaseAusentes += rAus;
      asaltosBaseAusentes += bAus;
      resultadosNuevos += [...p.results].filter((x) => !b.results.has(x)).length;
      asaltosNuevos += [...p.bouts].filter((x) => !b.bouts.has(x)).length;
      if (rAus || bAus || p.results.size < b.results.size || p.bouts.size < b.bouts.size) {
        inferiores.push({
          clave: k,
          base: { results: b.results.size, bouts: b.bouts.size },
          salida: { results: p.results.size, bouts: p.bouts.size },
          ausentes: { results: rAus, bouts: bAus },
        });
      }
    }
    const soloEnSalida = [...propios.keys()].filter((k) => !base.has(k));
    for (const k of soloEnSalida) {
      resultadosNuevos += propios.get(k)!.results.size;
      asaltosNuevos += propios.get(k)!.bouts.size;
    }
    informe.comparacionBase = {
      base: o.base,
      competitionsBase: base.size,
      resultsBase: baseResults,
      boutsBase: baseBouts,
      faltanEnSalida,
      soloEnSalida,
      resultadosBaseAusentes,
      asaltosBaseAusentes,
      resultadosNuevos,
      asaltosNuevos,
      pruebasConMenos: inferiores,
    };
  }
  informe.segundos = Math.round((Date.now() - inicio) / 1000);
  await writeFile(path.join(o.salida, '_informe.json'), `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
  const { errores: _e, comparacionBase, ...resumen } = informe;
  console.log(JSON.stringify({ ...resumen, errores: informe.errores.length }, null, 2));
  if (comparacionBase) {
    const { pruebasConMenos, faltanEnSalida, soloEnSalida, ...c } = comparacionBase as Record<string, unknown[]>;
    console.log(JSON.stringify({ ...c, faltanEnSalida: faltanEnSalida.length, soloEnSalida: soloEnSalida.length, pruebasConMenos: pruebasConMenos.length }, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
