/**
 * Download-only official FIE cache. User explicitly authorized retaining
 * original FIE responses and local history from season 2018 onward.
 *
 * Capture: node_modules/.bin/tsx scripts/descargar-historico-local.ts
 *   --root <absolute-cache-path> --units 200
 * Default cumulative request ceiling: 2,000. Additional explicitly approved
 * windows must be created by continuar-descargas-acotadas.ts; never reset it.
 * Offline: append --replay (no source requests, no database imports).
 * Use --offset 200, then --offset 400 to replay later checkpoint batches.
 *
 * Import integration (sequentially, in a separately authorized importer):
 *   const cache = new CacheLocal(root); await cache.initialize();
 *   await leerPruebaFie(season, id, { fetchJson: createOfflineFetchJson(cache) },
 *     { tamanoPagina: 200, maxPaginas: 100 });
 * This script never imports appdb, Neon, D1, R2, auth, or persistence modules.
 */
import { mkdir, open, readFile, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { CacheError, CacheLocal, createOfflineFetchJson, type CacheUnitIdentity } from '../src/lib/ingest/backfill/cache-local';
import { writeAtomicCacheJson as atomicJson, CacheLocalIoError } from '../src/lib/ingest/backfill/cache-atomic';
import { inventariarFie, normalizarTemporadasFie } from '../src/lib/ingest/sources/historico-indice';
import { leerPruebaFie, type LecturaPruebaFie } from '../src/lib/ingest/sources/fie-resultados';
import { permiteRobotsNacional } from '../src/lib/ingest/backfill/cache-nacional';
import {
  assertContinuationOwner, assertWindowBudget, downloadDiskBytes, readOpenDownloadWindow,
  validateDownloadRoot, validateWindowId, WINDOW_LIMITS, type DownloadWindow,
} from '../src/lib/ingest/backfill/download-window';

type Assessment = {
  state: 'closed' | 'partial' | 'error';
  ranking: string | null;
  pools: string | null;
  tableau: string | null;
  nextRankingPage: number | null;
  rankingRows: number;
  poolBouts: number;
  tableauBouts: number;
};
type Inventory = {
  version: 1;
  seasons: number[];
  seasonsComplete: boolean;
  units: CacheUnitIdentity[];
  indices: { season: number; state: string; discovered: number; published: number | null; nextPage: number | null }[];
  assessments: Record<string, Assessment>;
};

function assess(read: LecturaPruebaFie): Assessment {
  const rank = read.ranking;
  const ok = ['completo', 'sin_resultados'];
  const sourceFetched = read.prueba && !read.errorPrueba && rank &&
    ok.includes(rank.cobertura.estado) &&
    (!read.poules || read.poules.cobertura.estado !== 'error') &&
    (!read.cuadro || read.cuadro.cobertura.estado !== 'error');
  return {
    state: sourceFetched ? 'closed' : read.prueba ? 'partial' : 'error',
    ranking: rank?.cobertura.estado ?? null,
    pools: read.poules?.cobertura.estado ?? null,
    tableau: read.cuadro?.cobertura.estado ?? null,
    nextRankingPage: rank?.siguientePagina ?? null,
    rankingRows: rank?.puestos.length ?? 0,
    poolBouts: read.poules?.asaltos.length ?? 0,
    tableauBouts: read.cuadro?.asaltos.length ?? 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--root', '--units', '--replay', '--offset', '--window', '--dry-run']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('invalid_argument');
    if (!['--replay', '--dry-run'].includes(args[i])) i++;
  }
  const rootArg = args.indexOf('--root');
  if (rootArg < 0 || !args[rootArg + 1] || !path.isAbsolute(args[rootArg + 1])) throw new Error('absolute_root_required');
  const root = args[rootArg + 1];
  const replay = args.includes('--replay');
  const windowArg = args.indexOf('--window');
  const requestedWindow = windowArg < 0 ? undefined : validateWindowId(args[windowArg + 1] ?? '');
  if (replay && requestedWindow) throw new Error('offline_window_forbidden');
  if (args.includes('--dry-run')) {
    await validateDownloadRoot(root);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    console.log(JSON.stringify({ mode: 'dry-run', sourceRequests: 0,
      requests: manifest.requestCount, bytes: manifest.bytesStored, databaseWrites: 0 }));
    return;
  }
  const offsetArg = args.indexOf('--offset');
  const offset = offsetArg < 0 ? 0 : Number(args[offsetArg + 1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || (!replay && offset !== 0)) throw new Error('invalid_replay_offset');
  const countArg = args.indexOf('--units');
  const maxUnits = countArg < 0 ? 200 : Number(args[countArg + 1]);
  if (!Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > 200) throw new Error('units_out_of_bounds');
  const started = Date.now();
  // Reserve forty-five seconds to drain a current request before thirty minutes.
  let deadline = started + 30 * 60_000 - 45_000;
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, '.download.lock');
  const lock = await open(lockPath, 'wx');
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let stopReason: string | null = null;
  let localFailureCode: string | null = null;
  let localFailureOperation: string | null = null;
  let processed = 0;
  try {
    await validateDownloadRoot(root);
    await assertContinuationOwner(root, requestedWindow
      ? (await readOpenDownloadWindow(root, requestedWindow, 'fie')).approvalId : undefined);
    const window: DownloadWindow | undefined = requestedWindow
      ? await readOpenDownloadWindow(root, requestedWindow, 'fie') : undefined;
    if (window) deadline = Math.min(deadline, window.deadline - 45_000);
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date(started).toISOString() }));
    const diskCheck = async () => {
      const disk = await statfs(root);
      const free = disk.bavail * disk.bsize;
      // Preserve 5 GiB even while writing the maximum permitted cache growth.
      if (free < 5 * 1024 ** 3 + 512 * 1024 ** 2) throw new Error('disk_reserve');
      return free;
    };
    const initialFreeBytes = await diskCheck();
    const batchDiskBytes = window ? await downloadDiskBytes(root) : 0;
    const rawManifest = window ? JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) : null;
    const batchPayloadBytes = rawManifest?.bytesStored ?? 0;
    const payloadCeiling = window
      ? batchPayloadBytes + Math.max(0, window.growthCeiling - batchDiskBytes - WINDOW_LIMITS.metadata)
      : undefined;
    const cache = new CacheLocal(root, {
      maxInFlight: 1, // Deliberately below the allowed ceiling of two.
      maxRequests: window?.requestCeiling,
      maxBytes: payloadCeiling,
      maxResponseBytes: window ? 25 * 1024 ** 2 : undefined,
      beforeFetch: async () => {
        if (interrupted) throw new Error('interrupted');
        if (Date.now() >= deadline) throw new Error('time_limit');
        await diskCheck();
        if (Date.now() >= deadline) throw new Error('time_limit');
      },
      beforeRequest: async () => {
        if (interrupted) throw new Error('interrupted');
        if (Date.now() >= deadline) throw new Error('time_limit');
        if (window) {
          const summary = await cache.summary();
          assertWindowBudget(window, { requests: summary.requests, payloadBytes: summary.bytes,
            diskBytes: batchDiskBytes + summary.bytes - batchPayloadBytes, cooldown: null });
        }
        await diskCheck();
      },
    });
    await cache.initialize();
    const initial = await cache.summary();
    let policyText: string | null = null;
    if (!replay) {
      policyText = await cache.fetchRobotsPolicy();
      if (!permiteRobotsNacional(policyText, 'https://fie.org/api/fie/competitions/seasons')) {
        throw new Error('robots_no_permite');
      }
    }
    const officialJson = async <T>(url: string, unit: CacheUnitIdentity): Promise<T> => {
      if (policyText !== null && !permiteRobotsNacional(policyText, url)) {
        stopReason = 'robots_no_permite';
        throw new Error(stopReason);
      }
      return cache.fetchJson<T>(url, { unit });
    };
    const inventoryPath = path.join(root, 'inventory.json');
    let inventory: Inventory;
    try {
      inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
      if (inventory.version !== 1 || !Array.isArray(inventory.units)) throw new Error('invalid_inventory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || replay) throw error;
      const seasonsResult = normalizarTemporadasFie(await officialJson(
        'https://fie.org/api/fie/competitions/seasons',
        { key: 'fie|seasons', season: 0, competitionId: null },
      ));
      const seasons = seasonsResult.temporadas.filter((s) => s >= 2018).sort((a, b) => a - b);
      const rawMetadata = new Map<string, CacheUnitIdentity['metadata']>();
      const listed = await inventariarFie({
        json: async (url) => {
          const season = Number(new URL(url).searchParams.get('season'));
          const body = await officialJson<{ items?: Record<string, unknown>[] }>(url,
            { key: `fie|index|${season}`, season, competitionId: null });
          for (const item of body.items ?? []) {
            const text = (key: string) => typeof item[key] === 'string' ? item[key] as string : null;
            rawMetadata.set(`fie|${item.season}|${item.competitionId}`, {
              categoryRaw: text('category'), weaponRaw: text('weapon'),
              genderRaw: text('gender'), formatRaw: text('type'),
              category: null, weapon: null, gender: null, format: null,
            });
          }
          return body;
        },
      }, {
        temporadas: seasons,
        maxPeticiones: 150,
        clasificarFallo: (error) => ({
          status: error instanceof CacheError ? error.status : null,
          retryAfterMs: error instanceof CacheError && error.retryAfterUntil
            ? Math.max(0, Date.parse(error.retryAfterUntil) - Date.now()) : null,
        }),
      });
      inventory = {
        version: 1, seasons, seasonsComplete: seasonsResult.completa,
        units: listed.catalogo.filter((u) => u.clavePrueba !== null).map((u) => ({
          key: u.claveCatalogo, season: Number(u.temporada), competitionId: Number(u.clavePrueba),
          metadata: {
            ...rawMetadata.get(u.claveCatalogo)!,
            category: u.categoria, weapon: u.arma, gender: u.genero, format: u.formato,
          },
        })),
        indices: listed.unidades.map((u) => ({
          season: Number(u.temporada), state: u.estado, discovered: u.filas,
          published: u.publicado, nextPage: u.siguientePagina,
        })),
        assessments: {},
      };
      // Eliminate duplicate natural keys without inventing identities.
      inventory.units = [...new Map(inventory.units.map((u) => [u.key, u])).values()];
      await atomicJson(inventoryPath, inventory);
      if (listed.tecnico) stopReason = 'inventory_source_failure';
    }
    // Round-robin seasons, oldest first: representative coverage of 2018+
    // rather than spending the full budget on already imported recent units.
    const groups = inventory.seasons.map((season) => inventory.units
      .filter((u) => u.season === season)
      .sort((a, b) => a.competitionId! - b.competitionId!));
    const ordered: CacheUnitIdentity[] = [];
    for (let i = 0; groups.some((g) => i < g.length); i++) {
      for (const group of groups) if (group[i]) ordered.push(group[i]);
    }
    let replaySkipped = 0;
    for (const unit of ordered) {
      if (stopReason || processed >= maxUnits || interrupted || Date.now() >= deadline) break;
      if (!replay && inventory.assessments[unit.key]?.state === 'closed') continue;
      if (!replay && inventory.assessments[unit.key]?.state === 'error') continue;
      if (replay && !inventory.assessments[unit.key]) continue;
      if (replay && replaySkipped++ < offset) continue;
      const deps = replay ? createOfflineFetchJson(cache) : async <T>(url: string): Promise<T> => {
        // The existing readers catch endpoint errors. Latch budget/cooldown
        // stops here so a reader cannot silently continue hammering the host.
        if (stopReason) throw new Error(stopReason);
        try {
          return await officialJson<T>(url, unit);
        } catch (error) {
          if (error instanceof CacheError) {
            if (error.retryAfterUntil || ['cooldown', 'request_limit', 'cache_limit', 'integrity_error'].includes(error.code)) {
              stopReason = error.status === 429 || error.status === 503 ? `http_${error.status}` : error.code;
            }
            if (error.code === 'http_error' && (error.status === null || error.status >= 200 && error.status < 300)) {
              stopReason = 'network_failure';
            }
            if (error.code === 'invalid_json') stopReason = 'integrity_error';
          } else {
            stopReason = error instanceof Error && ['disk_reserve', 'time_limit', 'interrupted'].includes(error.message)
              ? error.message : error instanceof Error && error.message.startsWith('window_')
                ? error.message : 'local_failure';
            if (stopReason === 'local_failure') {
              const code = (error as NodeJS.ErrnoException | null)?.code;
              localFailureCode = typeof code === 'string' && /^[A-Z_]{2,32}$/.test(code)
                ? code : 'unclassified_local_failure';
              localFailureOperation = error instanceof CacheLocalIoError ? error.operation : null;
            }
          }
          throw error;
        }
      };
      const read = await leerPruebaFie(unit.season, unit.competitionId!, { fetchJson: deps }, { tamanoPagina: 200, maxPaginas: 100 });
      if (replay && JSON.stringify(assess(read)) !== JSON.stringify(inventory.assessments[unit.key])) {
        throw new Error('offline_replay_mismatch');
      }
      if (!replay) {
        inventory.assessments[unit.key] = assess(read);
        await cache.retainMetadata(unit);
      }
      processed++;
      // Every unit is a resumable checkpoint; never >200 between checkpoints.
      if (!replay) await atomicJson(inventoryPath, inventory);
      if (processed % 10 === 0) console.log(JSON.stringify({ checkpointUnits: processed, ...(await cache.summary()) }));
    }
    stopReason ??= interrupted ? 'interrupted' : Date.now() >= deadline ? 'time_limit' : processed >= maxUnits ? 'unit_checkpoint' : 'inventory_exhausted';
    const summary = await cache.summary();
    const bySeason = inventory.seasons.map((season) => {
      const units = inventory.units.filter((u) => u.season === season);
      const assessments = units.map((u) => inventory.assessments[u.key]);
      return {
        season, inventoryUnits: units.length,
        closed: assessments.filter((a) => a?.state === 'closed').length,
        partial: assessments.filter((a) => a?.state === 'partial').length,
        error: assessments.filter((a) => a?.state === 'error').length,
        pending: assessments.filter((a) => !a).length,
      };
    });
    const report = {
      startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(),
      mode: replay ? 'offline_replay' : 'download_only', root, processed, replayOffset: replay ? offset : null, stopReason,
      localFailureCode, localFailureOperation,
      windowId: window?.id ?? null, approvalId: window?.approvalId ?? null,
      sourceRequestsThisRun: summary.requests - initial.requests,
      cacheGrowthBytes: summary.bytes - initial.bytes, initialFreeBytes, finalFreeBytes: await diskCheck(),
      summary, indices: inventory.indices, bySeason, importCompleteness: 'not_assessed',
      databaseWrites: 0, cloudflareOperations: 0,
    };
    await atomicJson(path.join(root, replay ? `replay-summary-${offset}.json` : `checkpoint-${summary.requests}-${started}.json`), report);
    console.log(JSON.stringify(report));
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

main().catch((error) => {
  // No raw payloads, credentials, person data or accidental database URLs.
  const code = error instanceof CacheError ? error.code : (error as NodeJS.ErrnoException).code;
  console.error(JSON.stringify({ stopped: true, code: typeof code === 'string' && /^[a-zA-Z_]+$/.test(code) ? code : 'local_error',
    operation: error instanceof CacheLocalIoError ? error.operation : null }));
  process.exitCode = 1;
});
