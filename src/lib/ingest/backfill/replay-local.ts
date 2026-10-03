/** Local historical replay. No discovery, download, campaign reset or remote writer. */
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import * as cheerio from 'cheerio';
import type { Db } from '@/db';
import { prepararSeleccionArchivoLocal, leerBlobArchivadoLocal, type PlanArchivo, type SeleccionArchivoLocal } from '../archivo-local';
import type { CacheManifest, CacheEndpoint } from './cache-local';
import { idUnidadNacional, validarUrlNacional, type ManifiestoCacheNacional, type UnidadCacheNacional } from './cache-nacional';
import { leerPruebaFie, type LecturaPruebaFie, type EstadoCobertura } from '../sources/fie-resultados';
import { leerFinalSkermo, type LecturaSkermo } from '../sources/skermo-finales';
import { parseSkermoCompetitionResults, skermoCompetitionResultsUrl, type SkermoResultsIndexRow } from '../sources/skermo-results';
import { leerBytesPdf, docIdDeUrl } from '../sources/rfee-pdf/lectura';
import type { LecturaPdf } from '../sources/rfee-pdf/tipos';
import { persistirLecturaFie } from '../fie-resultados-persist';
import { crearDepsPersistenciaFieDb } from '../fie-resultados-db';
import { persistirLecturaSkermo } from '../skermo-finales-persist';
import { crearDepsPersistenciaSkermoDb } from '../skermo-finales-db';
import { persistirLecturaPdf, type ContextoPdf } from './pdf-persist';
import { crearDepsPersistenciaPdfDb } from './pdf-db';
import { MAX_RANKING_ENTRIES_D1 } from '../ranking-oficial-db';
import { dbConSportLease, reclamarSportLease, type SportLease } from '../sport-incremental/lease';
import { verificarEsquemaD1 } from '../sport-incremental/schema';

export const LIMITES_REPLAY_LOCAL = {
  unidades: 10, milisegundos: 300_000, sentencias: 1_000,
  puestos: MAX_RANKING_ENTRIES_D1, asaltos: 2_000, paginasRanking: 6,
  bytesSeleccionados: 64 * 1024 * 1024,
} as const;

export type SeleccionReplay =
  | { tipo: 'fie'; season: number; competitionId: number }
  | { tipo: 'html' | 'pdf'; id: string };
export type OpcionesReplayLocal = {
  aplicar: boolean;
  cacheFie?: string;
  cacheNacional?: string;
  cacheFieSha256?: string;
  cacheNacionalSha256?: string;
  selecciones: SeleccionReplay[];
  maxUnidades: number;
  maxMs: number;
  /** Explicit facts-first mode: reuse confirmed IDs, defer creation for later review. */
  soloHechos?: boolean;
};
export type CodigoReplay =
  | 'cache_miss' | 'source_partial' | 'malformed_document' | 'hash_mismatch'
  | 'invalid_cache' | 'unsupported_context' | 'oversized_ranking' | 'fact_limit'
  | 'time_limit' | 'statement_limit' | 'schema_required' | 'lease_unavailable'
  | 'capacity' | 'write_failed' | 'release_failed' | 'local_target_failed';
export class ErrorReplayLocal extends Error {
  constructor(readonly codigo: CodigoReplay) { super(codigo); }
}
export type ResumenReplayLocal = {
  modo: 'simulacion' | 'aplicar';
  seleccionadas: number;
  leidas: number;
  persistidas: number;
  hechosLeidos: { puestos: number; asaltos: number };
  cobertura: Partial<Record<EstadoCobertura, number>>;
  coberturaPersistida: Partial<Record<EstadoCobertura, number>>;
  incidencias: Partial<Record<CodigoReplay, number>>;
  sentenciasReservadas: number;
  /** A stopped unit is not an atomic corpus transaction; never claim rollback. */
  escrituraIncompletaPosible: boolean;
  detenido: boolean;
};
export type DepsReplayLocal = {
  abrir: (write: boolean) => { db: Db; close: () => void } | Promise<{ db: Db; close: () => void }>;
  /** Deterministic budget seam, not a source or persistence override. */
  ahora?: () => number;
};
type UnidadPreparada =
  | { tipo: 'fie'; lectura: LecturaPruebaFie }
  | { tipo: 'html'; lectura: LecturaSkermo }
  | { tipo: 'pdf'; lectura: LecturaPdf; contexto: ContextoPdf };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fail = (code: CodigoReplay): never => { throw new ErrorReplayLocal(code); };

function validarOpciones(o: OpcionesReplayLocal) {
  if (!o || typeof o.aplicar !== 'boolean' || (o.soloHechos !== undefined && typeof o.soloHechos !== 'boolean') ||
    !Array.isArray(o.selecciones) ||
    !Number.isInteger(o.maxUnidades) || o.maxUnidades < 1 || o.maxUnidades > LIMITES_REPLAY_LOCAL.unidades ||
    !Number.isInteger(o.maxMs) || o.maxMs < 1 || o.maxMs > LIMITES_REPLAY_LOCAL.milisegundos ||
    o.selecciones.length < 1 || o.selecciones.length > o.maxUnidades) throw new Error('replay_invalid_arguments');
  const keys = new Set<string>();
  for (const s of o.selecciones) {
    if (!s || !['fie', 'html', 'pdf'].includes(s.tipo)) throw new Error('replay_invalid_arguments');
    if (s.tipo === 'fie') {
      if (!Number.isSafeInteger(s.season) || s.season < 2000 || s.season > 2100 ||
        !Number.isSafeInteger(s.competitionId) || s.competitionId < 1 || !o.cacheFie) throw new Error('replay_invalid_arguments');
    } else if (!new RegExp(`^${s.tipo}-[a-f0-9]{64}$`).test(s.id) || !o.cacheNacional) {
      throw new Error('replay_invalid_arguments');
    }
    const key = s.tipo === 'fie' ? `fie:${s.season}:${s.competitionId}` : `${s.tipo}:${s.id}`;
    if (keys.has(key)) throw new Error('replay_invalid_arguments');
    keys.add(key);
  }
  for (const root of [o.cacheFie, o.cacheNacional]) {
    if (root !== undefined && !isAbsolute(root)) throw new Error('replay_invalid_arguments');
  }
  for (const digest of [o.cacheFieSha256, o.cacheNacionalSha256]) {
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) throw new Error('replay_invalid_arguments');
  }
}

/** Strict grammar. --d1-local is separately validated by the existing local-only target guard. */
export function parsearArgsReplayLocal(args: readonly string[]): OpcionesReplayLocal {
  const o: OpcionesReplayLocal = { aplicar: false, selecciones: [], maxUnidades: 10, maxMs: 300_000 };
  const single = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--aplicar' || flag === '--solo-hechos') {
      if (single.has(flag)) throw new Error('replay_invalid_arguments');
      single.add(flag);
      if (flag === '--aplicar') o.aplicar = true; else o.soloHechos = true;
      continue;
    }
    if (!['--cache-fie', '--cache-nacional', '--fie', '--html', '--pdf', '--max-unidades', '--max-segundos'].includes(flag)) {
      throw new Error('replay_invalid_arguments');
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('replay_invalid_arguments');
    if (flag === '--fie') {
      const match = /^(\d{4}):([1-9]\d*)$/.exec(value);
      if (!match) throw new Error('replay_invalid_arguments');
      o.selecciones.push({ tipo: 'fie', season: Number(match[1]), competitionId: Number(match[2]) });
    } else if (flag === '--html' || flag === '--pdf') {
      o.selecciones.push({ tipo: flag === '--html' ? 'html' : 'pdf', id: value });
    } else {
      if (single.has(flag)) throw new Error('replay_invalid_arguments');
      single.add(flag);
      if (flag === '--cache-fie') o.cacheFie = value;
      else if (flag === '--cache-nacional') o.cacheNacional = value;
      else {
        if (!/^[1-9]\d*$/.test(value)) throw new Error('replay_invalid_arguments');
        if (flag === '--max-unidades') o.maxUnidades = Number(value);
        else o.maxMs = Number(value) * 1_000;
      }
    }
  }
  validarOpciones(o);
  return o;
}

function codigoError(error: unknown, fallback: CodigoReplay): CodigoReplay {
  if (error instanceof ErrorReplayLocal) return error.codigo;
  // Only known constant codes are inspected; no exception reaches output.
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('sport_capacity')) return 'capacity';
  if (message === 'sport_migration_required') return 'schema_required';
  if (message === 'sport_lease_unavailable') return 'lease_unavailable';
  if (message === 'archive_local_integrity_failure') return 'hash_mismatch';
  if (message === 'archive_local_reference_missing') return 'cache_miss';
  return fallback;
}

async function archivo(root: string, source: 'fie' | 'rfee',
  selections: readonly SeleccionArchivoLocal[], check: () => void, sourceHash?: string) {
  check();
  try {
    const plan = await prepararSeleccionArchivoLocal(root, source, selections,
      { maxBytes: LIMITES_REPLAY_LOCAL.bytesSeleccionados, comprobar: check, manifiestoOrigenSha256: sourceHash });
    check();
    return plan;
  } catch (error) {
    throw new ErrorReplayLocal(codigoError(error, 'invalid_cache'));
  }
}

/** Retain only selected, independently rehashed bytes. No TOCTOU reread during writes. */
async function snapshot(plan: PlanArchivo, hash: string, size: number, check: () => void) {
  check();
  const blob = plan.blobs.find((b) => b.hash === hash);
  if (!blob) return fail('cache_miss');
  const bytes = await leerBlobArchivadoLocal(blob);
  if (size !== bytes.length || sha256(bytes) !== hash) return fail('hash_mismatch');
  check();
  return bytes;
}

function statuses(u: UnidadPreparada): EstadoCobertura[] {
  if (u.tipo === 'fie') {
    if (!u.lectura.prueba) return ['error'];
    return [u.lectura.ranking, u.lectura.poules, u.lectura.cuadro]
      .flatMap((p) => p ? [p.cobertura.estado] : []);
  }
  return u.tipo === 'html' ? [u.lectura.cobertura.estado] : [u.lectura.estado];
}
function facts(u: UnidadPreparada) {
  if (u.tipo === 'fie') return {
    puestos: u.lectura.ranking?.puestos.length ?? 0,
    asaltos: (u.lectura.poules?.asaltos.length ?? 0) + (u.lectura.cuadro?.asaltos.length ?? 0),
  };
  if (u.tipo === 'html') return { puestos: u.lectura.puestos.length, asaltos: 0 };
  return {
    puestos: u.lectura.pruebas.reduce((n, p) => n + p.puestos.length, 0),
    asaltos: u.lectura.pruebas.reduce((n, p) => n + p.asaltos.length, 0),
  };
}

async function prepararFie(plan: PlanArchivo, s: Extract<SeleccionReplay, { tipo: 'fie' }>,
  check: () => void, issue: (c: CodigoReplay) => void): Promise<UnidadPreparada> {
  const manifest = JSON.parse(new TextDecoder().decode(plan.manifest)) as CacheManifest;
  if (!manifest.units || typeof manifest.units !== 'object') return fail('invalid_cache');
  const units = Object.values(manifest.units).filter((u) => u.season === s.season && u.competitionId === s.competitionId);
  if (units.length !== 1) return fail(units.length ? 'unsupported_context' : 'cache_miss');
  const unit = units[0];
  if (!Array.isArray(unit.endpoints)) return fail('invalid_cache');
  const records = Object.values(manifest.endpoints).filter((r) => r.unitKey === unit.key);
  const bodies = new Map<string, { record: CacheEndpoint; body?: unknown; invalid?: boolean }>();
  for (const record of records) {
    check();
    const url = new URL(record.url);
    const base = `/api/fie/competition/${s.season}/${s.competitionId}`;
    if (url.origin !== 'https://fie.org' || url.username || url.password || url.hash ||
      !(url.pathname === base || url.pathname.startsWith(`${base}/results/`)) ||
      record.key !== `${unit.key}|${record.endpoint}` || !unit.endpoints.includes(record.endpoint) ||
      manifest.endpoints[record.key] !== record || bodies.has(record.url)) return fail('invalid_cache');
    const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    if (record.endpoint !== `${url.pathname}${query ? `?${query}` : ''}`) return fail('invalid_cache');
    const entry: { record: CacheEndpoint; body?: unknown; invalid?: boolean } = { record };
    if (record.blobSha256) {
      const bytes = await snapshot(plan, record.blobSha256, record.bytes, check);
      try { entry.body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { entry.invalid = true; }
    }
    bodies.set(record.url, entry);
  }
  const deps = {
    fetchJson: async (url: string): Promise<unknown> => {
      check();
      const cached = bodies.get(url);
      if (!cached || !cached.record.blobSha256) { issue('cache_miss'); return fail('cache_miss'); }
      if (cached.record.status < 200 || cached.record.status >= 300) { issue('source_partial'); return fail('source_partial'); }
      if (cached.invalid) { issue('malformed_document'); return fail('malformed_document'); }
      return cached.body;
    },
  };
  // Capture campaign used exact pageSize=200 URLs. Never canonicalize to a different cached URL.
  const lectura = await leerPruebaFie(s.season, s.competitionId, deps,
    { tamanoPagina: 200, maxPaginas: LIMITES_REPLAY_LOCAL.paginasRanking });
  check(); // Reader catches source errors; budget failures must still stop the run.
  return { tipo: 'fie', lectura };
}

function asociacion(unit: UnidadCacheNacional) {
  // One document can occur in several seasons; do not guess an ownership context.
  if (!Array.isArray(unit.asociaciones) || unit.asociaciones.length !== 1) return fail('unsupported_context');
  const a = unit.asociaciones[0];
  if (a.fuente !== 'skermo_rfee' || a.federacion !== 'RFEE' ||
    !/^\d{4}-\d{4}$/.test(a.temporada) || typeof a.claveCatalogo !== 'string' || !a.claveCatalogo) {
    return fail('unsupported_context');
  }
  return a;
}

async function prepararNacional(plan: PlanArchivo, s: Extract<SeleccionReplay, { tipo: 'html' | 'pdf' }>,
  check: () => void): Promise<UnidadPreparada> {
  const manifest = JSON.parse(new TextDecoder().decode(plan.manifest)) as ManifiestoCacheNacional;
  const matches = manifest.unidades.filter((u) => u.id === s.id);
  if (matches.length !== 1) return fail(matches.length ? 'invalid_cache' : 'cache_miss');
  const unit = matches[0];
  validarUrlNacional(unit.url, s.tipo);
  if (unit.tipo !== s.tipo || unit.id !== idUnidadNacional(s.tipo, unit.url)) return fail('invalid_cache');
  const a = asociacion(unit);
  if (unit.estado !== 'cached' && unit.estado !== 'empty') {
    return fail(unit.estado === 'partial' ? 'source_partial' : unit.estado === 'invalid_payload' ? 'malformed_document' : 'cache_miss');
  }
  if (!unit.sha256 || unit.bytes === null) return fail('cache_miss');
  if (unit.httpStatus === null || unit.httpStatus < 200 || unit.httpStatus >= 300) return fail('source_partial');
  const bytes = await snapshot(plan, unit.sha256, unit.bytes, check);
  if (s.tipo === 'pdf') {
    const lectura = await leerBytesPdf(bytes, { url: unit.url, docId: docIdDeUrl(unit.url) },
      { maxPaginas: 100, maxItemsPagina: 10_000, comprobar: check });
    check();
    return { tipo: 'pdf', lectura, contexto: {
      season: a.temporada, refOriginal: a.claveCatalogo, sourceUrl: unit.url,
    } };
  }
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const $ = cheerio.load(html);
  const headers = $('table').first().find('thead th').toArray()
    .map((th) => $(th).text().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase());
  if (!headers.includes('nombre') || !headers.includes('posicion')) return fail('malformed_document');
  const id = /^\/ranking\/public\/RFEE\/competition\/(\d+)\/?$/.exec(new URL(unit.url).pathname)?.[1];
  if (!id || unit.url !== skermoCompetitionResultsUrl('RFEE', id) || a.clavePrueba !== `RFEE:${id}`) return fail('unsupported_context');
  const { meta } = parseSkermoCompetitionResults(html, { federationCode: 'RFEE', competitionId: id });
  // The cache intentionally omits raw index rows. No index name/date is invented:
  // require them in the cached document itself, then use nullable original association fields.
  if (!meta.name || !meta.date) return fail('unsupported_context');
  if (![null, 'ESPADA', 'FLORETE', 'SABLE'].includes(a.arma) ||
    ![null, 'M', 'F', 'MIXTO'].includes(a.genero) ||
    ![null, 'INDIVIDUAL', 'EQUIPOS'].includes(a.formato)) return fail('unsupported_context');
  const row: SkermoResultsIndexRow = {
    competitionId: id, resultsUrl: unit.url, name: meta.name, date: meta.date,
    weapon: a.arma as SkermoResultsIndexRow['weapon'],
    gender: a.genero as SkermoResultsIndexRow['gender'],
    category: a.categoria, categoryRaw: a.categoriaOriginal,
    format: a.formato as SkermoResultsIndexRow['format'],
    city: null, country: null, documents: [], liveLinks: [], externalUrls: [],
  };
  const lectura = await leerFinalSkermo(row, { federacion: 'RFEE', season: a.temporada },
    { html: async (url) => { check(); if (url !== unit.url) return fail('cache_miss'); return html; } });
  check();
  return { tipo: 'html', lectura };
}

/** Preflight every selected source before opening ANY writable target. Defaults remain read-only. */
export async function ejecutarReplayLocal(o: OpcionesReplayLocal, deps: DepsReplayLocal): Promise<ResumenReplayLocal> {
  validarOpciones(o);
  const now = deps.ahora ?? Date.now, deadline = now() + o.maxMs;
  const check = () => { if (now() >= deadline) fail('time_limit'); };
  const r: ResumenReplayLocal = {
    modo: o.aplicar ? 'aplicar' : 'simulacion', seleccionadas: o.selecciones.length,
    leidas: 0, persistidas: 0, hechosLeidos: { puestos: 0, asaltos: 0 }, cobertura: {},
    coberturaPersistida: {},
    incidencias: {}, sentenciasReservadas: 0, escrituraIncompletaPosible: false, detenido: false,
  };
  const issue = (code: CodigoReplay) => { r.incidencias[code] = (r.incidencias[code] ?? 0) + 1; };
  const prepared: UnidadPreparada[] = [];
  let local: Awaited<ReturnType<DepsReplayLocal['abrir']>> | undefined;
  let lease: SportLease | null = null;
  try {
    const seleccionFie = o.selecciones.filter((s) => s.tipo === 'fie');
    const seleccionNacional = o.selecciones.filter((s) => s.tipo !== 'fie');
    const fie = seleccionFie.length ? await archivo(o.cacheFie!, 'fie', seleccionFie, check, o.cacheFieSha256) : null;
    const nacional = seleccionNacional.length ? await archivo(o.cacheNacional!, 'rfee', seleccionNacional, check, o.cacheNacionalSha256) : null;
    if ((fie?.bytes ?? 0) + (nacional?.bytes ?? 0) > LIMITES_REPLAY_LOCAL.bytesSeleccionados) fail('fact_limit');
    for (const s of o.selecciones) {
      check();
      try {
        const unidadIssues = new Set<CodigoReplay>();
        const u = s.tipo === 'fie' ? await prepararFie(fie!, s, check, (c) => unidadIssues.add(c))
          : await prepararNacional(nacional!, s, check);
        const f = facts(u), states = statuses(u);
        if (f.puestos > LIMITES_REPLAY_LOCAL.puestos ||
          (u.tipo === 'fie' && (u.lectura.ranking?.cobertura.publicado ?? 0) > LIMITES_REPLAY_LOCAL.puestos)) fail('oversized_ranking');
        if (f.asaltos > LIMITES_REPLAY_LOCAL.asaltos) fail('fact_limit');
        if (states.includes('parcial') ||
          (u.tipo === 'pdf' && (u.lectura.ocr.necesario || u.lectura.rechazos.length > 0))) unidadIssues.add('source_partial');
        if (states.includes('error') && !unidadIssues.size) unidadIssues.add('malformed_document');
        for (const c of unidadIssues) issue(c);
        for (const state of states) r.cobertura[state] = (r.cobertura[state] ?? 0) + 1;
        r.hechosLeidos.puestos += f.puestos; r.hechosLeidos.asaltos += f.asaltos;
        r.leidas++; prepared.push(u);
      } catch (error) {
        const code = codigoError(error, 'malformed_document');
        if (['hash_mismatch', 'time_limit', 'invalid_cache'].includes(code)) throw new ErrorReplayLocal(code);
        issue(code);
      }
    }
    check();
    local = await deps.abrir(false);
    await verificarEsquemaD1(local.db);
    check();
    if (!o.aplicar || !prepared.length) return r;
    local.close(); local = undefined;
    check();
    local = await deps.abrir(true);
    lease = await reclamarSportLease(local.db);
    if (!lease) throw new ErrorReplayLocal('lease_unavailable');
    const db = dbConSportLease(local.db, lease, check, (n) => {
      if (r.sentenciasReservadas + n > LIMITES_REPLAY_LOCAL.sentencias) fail('statement_limit');
      r.sentenciasReservadas += n;
    });
    for (const u of prepared) {
      check();
      const before = r.sentenciasReservadas;
      try {
        // Only existing pure persistence functions, with the fenced owner facade.
        const outcome = u.tipo === 'fie' ? await persistirLecturaFie({
          ...crearDepsPersistenciaFieDb(db), ...(o.soloHechos ? { crearIdentidades: false } : {}),
        }, u.lectura)
          : u.tipo === 'html' ? await persistirLecturaSkermo({
            ...crearDepsPersistenciaSkermoDb(db), ...(o.soloHechos ? { crearIdentidades: false } : {}),
          }, u.lectura)
            : await persistirLecturaPdf(crearDepsPersistenciaPdfDb(db), u.lectura, u.contexto);
        if (outcome.estado === 'esquema_no_aplicado') fail('schema_required');
        const coverage = 'documento' in outcome ? outcome.documento ? [outcome.documento] : []
          : typeof outcome.cobertura === 'object' && outcome.cobertura !== null ? Object.values(outcome.cobertura)
            : outcome.cobertura ? [outcome.cobertura] : [];
        for (const state of coverage) {
          if (state) r.coberturaPersistida[state] = (r.coberturaPersistida[state] ?? 0) + 1;
        }
        r.persistidas++;
      } catch (error) {
        r.escrituraIncompletaPosible = r.sentenciasReservadas > before;
        throw error;
      }
    }
  } catch (error) {
    issue(codigoError(error, local ? 'write_failed' : 'local_target_failed'));
    r.detenido = true;
  } finally {
    if (lease) {
      try { await lease.liberar(); }
      catch { issue('release_failed'); r.detenido = true; }
    }
    if (local) {
      try { local.close(); }
      catch { issue('local_target_failed'); r.detenido = true; }
    }
  }
  return r;
}

export const USO_REPLAY_LOCAL = [
  'tsx scripts/replay-historico-d1.ts --d1-local <SQLite absoluto existente>',
  '  [--cache-fie <directorio absoluto> --fie <temporada:id> ...]',
  '  [--cache-nacional <directorio absoluto> --html <html-sha256> | --pdf <pdf-sha256> ...]',
  '  [--max-unidades 1..10] [--max-segundos 1..300] [--solo-hechos] [--aplicar]',
  'Simulación por defecto. Sólo fuentes cacheadas exactas. Sin red, descubrimiento ni destinos remotos.',
].join('\n');
