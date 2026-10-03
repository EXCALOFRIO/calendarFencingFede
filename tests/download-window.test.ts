import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  acquireContinuationLock, approveDownload, assertContinuationOwner, assertWindowBudget,
  closeDownloadWindow, createDownloadWindow, downloadDiskBytes, readDownloadApproval,
  readDownloadWindow, readOpenDownloadWindow, validateDownloadRoot, validateWindowId, windowId, WINDOW_LIMITS,
  type DownloadTotals,
} from '../src/lib/ingest/backfill/download-window';
import {
  ejecutarLoteNacional, escribirEstadoCacheNacional, leerEstadoCacheNacional,
  escribirUnidadCacheNacional, leerManifiestoCacheNacional,
  prepararUnidadesNacionales, type InventarioCacheNacional,
} from '../src/lib/ingest/backfill/cache-nacional';
import { CacheLocal } from '../src/lib/ingest/backfill/cache-local';
import {
  parseContinuationArguments, renewableWindowStop, shouldContinueBatch,
} from '../scripts/continuar-descargas-acotadas';

const id = '12345678-1234-4123-8123-123456789abc';
const id2 = '12345678-1234-4123-8123-123456789abd';
const now = 1_000_000;
const initial = (): DownloadTotals => ({
  requests: 1257, payloadBytes: 100, diskBytes: 200, cooldown: now + 7_200_000,
  legacyStarted: now - 9_000_000, legacyDiskStart: 10, lastStart: now - 350,
});
let root: string;
const cleanup: string[] = [];
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'download-window-test-')));
  cleanup.push(root);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});
const inventory = (): InventarioCacheNacional => ({
  ownRfeeCatalog: [{
    fuente: 'skermo_rfee', federacion: 'RFEE', temporada: '2018-2019', clavePrueba: 'RFEE:1',
    claveCatalogo: 'synthetic', arma: null, genero: null, categoria: null,
    categoriaOriginal: null, formato: null,
    enlaces: [{ tipo: 'html', url: 'https://app.skermo.org/ranking/public/RFEE/competition/1?setLang=es' }],
  }],
});
async function approve(source: 'fie' | 'rfee' = 'rfee') {
  return approveDownload(root, source, id, source === 'fie' ? 180 : 60, initial(), now);
}
describe('explicit append-only authorization windows', () => {
  it('cannot create or renew a window without a recorded approval and explicit closed boundary', async () => {
    await expect(readDownloadWindow(root, id, 'rfee')).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    const approval = await approve();
    const first = await createDownloadWindow(approval, 1, initial(), now);
    await expect(createDownloadWindow(approval, 2, initial(), now + 1)).rejects.toThrow();
    await closeDownloadWindow(first, 'network_failure', initial(), false);
    await expect(readOpenDownloadWindow(root, first.id, 'rfee')).rejects.toThrow('window_closed');
    await expect(createDownloadWindow(approval, 2, initial(), now + 2)).rejects.toThrow('not_renewable');
  });
  it('preserves cumulative totals, legacy boundaries, cooldown and earlier immutable records', async () => {
    const approval = await approve();
    const first = await createDownloadWindow(approval, 1, initial(), now);
    const prior = await readFile(path.join(root, 'download-windows', `window-${first.id}.json`), 'utf8');
    const legacy = await readFile(path.join(root, 'download-windows', 'legacy.json'), 'utf8');
    const nextTotals = { ...initial(), requests: 3257, payloadBytes: 400, diskBytes: 500 };
    await closeDownloadWindow(first, 'presupuesto_peticiones', nextTotals, true);
    const second = await createDownloadWindow(approval, 2, nextTotals, now + 900_000);
    expect(second.requestCeiling).toBe(5257);
    expect(second.initial.cooldown).toBe(initial().cooldown);
    expect(await readFile(path.join(root, 'download-windows', `window-${first.id}.json`), 'utf8')).toBe(prior);
    await approveDownload(root, 'rfee', id2, 60, nextTotals, now + 2_000_000);
    expect(await readFile(path.join(root, 'download-windows', 'legacy.json'), 'utf8')).toBe(legacy);
    expect(await readDownloadApproval(root, id)).toEqual(approval);
    await expect(createDownloadWindow(approval, 1, nextTotals, now + 1)).rejects.toMatchObject({ code: 'EEXIST' });
  });
  it('resumes the same deadlines, request ceilings and byte ceilings across restarts', async () => {
    const approval = await approve();
    const w = await createDownloadWindow(approval, 1, initial(), now);
    expect(await approveDownload(root, 'rfee', id, 60, initial(), now + 500_000)).toEqual(approval);
    const resumed = await readDownloadWindow(root, w.id, 'rfee');
    expect(resumed).toEqual(w);
    expect(() => assertWindowBudget(resumed, { ...initial(), requests: 3256 }, now + 1000)).not.toThrow();
    expect(() => assertWindowBudget(resumed, { ...initial(), requests: 3257 }, now + 1000)).toThrow('request_limit');
    expect(() => assertWindowBudget(resumed, initial(), now + WINDOW_LIMITS.milliseconds)).toThrow('time_limit');
    expect(() => assertWindowBudget(resumed, { ...initial(),
      diskBytes: resumed.growthCeiling - WINDOW_LIMITS.metadata }, now + 1)).toThrow('byte_limit');
    expect(() => assertWindowBudget(resumed, { ...initial(), requests: 1256 }, now + 1)).toThrow('decreased');
    expect(() => assertWindowBudget(resumed, { ...initial(), payloadBytes: 99 }, now + 1)).toThrow('decreased');
  });
  it('bounds total continuation to six FIE/two RFEE windows and never reopens expired approval', async () => {
    const a = await approve();
    await expect(createDownloadWindow(a, 3, initial(), now + 1)).rejects.toThrow('exhausted');
    await expect(createDownloadWindow(a, 1, initial(), a.deadline)).rejects.toThrow('exhausted');
    await expect(approveDownload(root, 'rfee', id2, 61, initial(), now)).rejects.toThrow('duration');
    const fie = await approveDownload(root, 'fie', id2, 180, initial(), now);
    expect(fie.maxWindows).toBe(6);
    await expect(approveDownload(root, 'fie', id2, 181, initial(), now)).rejects.toThrow('duration');
  });
  it.each(['../escape', '', 'not-a-uuid', '12345678-1234-1123-8123-123456789abc',
    '12345678-1234-4123-7123-123456789abc', `${id}.json`, id.toUpperCase()])('rejects malformed IDs %s', (value) => {
    expect(() => validateWindowId(value)).toThrow('invalid_window_id');
    expect(() => windowId(value, 1)).toThrow('invalid_window_id');
  });
  it('rejects unsafe root traversal and junctions before creating sidecars', async () => {
    await expect(validateDownloadRoot('relative')).rejects.toThrow('unsafe');
    await expect(validateDownloadRoot(path.parse(root).root)).rejects.toThrow('unsafe');
    await expect(validateDownloadRoot(`${root}${path.sep}..${path.sep}escape`)).rejects.toThrow('unsafe');
    const target = await mkdtemp(path.join(tmpdir(), 'download-window-target-'));
    cleanup.push(target);
    const junction = path.join(root, 'junction');
    await symlink(target, junction, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(validateDownloadRoot(junction)).rejects.toThrow('unsafe');
    await expect(downloadDiskBytes(root)).rejects.toThrow('unsafe');
  });
  it.each(['.download.lock', 'run.lock', '.continuation.lock'])('never steals competing root lock %s', async (file) => {
    const lock = await open(path.join(root, file), 'wx');
    try {
      await lock.writeFile('synthetic existing lock');
      await expect(acquireContinuationLock(root, id)).rejects.toThrow();
      expect(await readFile(path.join(root, file), 'utf8')).toBe('synthetic existing lock');
    } finally { await lock.close(); }
  });
  it('releases only its own lock and rejects unrelated direct CLI processes', async () => {
    const release = await acquireContinuationLock(root, id);
    await expect(assertContinuationOwner(root)).rejects.toThrow('competing_root_lock');
    await expect(assertContinuationOwner(root, id)).rejects.toThrow('competing_root_lock');
    await release();
    expect(await readdir(root)).not.toContain('.continuation.lock');
  });
});
describe('offline bounded source integration', () => {
  it('default expired national campaign does not reset or auto-renew', async () => {
    const legacy = { version: 1 as const, peticionesIniciadas: 1257, bytesPayloadActuales: 0,
      cooldownHasta: null, ultimoInicioPeticion: now - 350, campanaInicio: now - 2_000_000, bytesDiscoInicio: 0 };
    await escribirEstadoCacheNacional(root, legacy);
    const network = vi.fn(async () => { throw new Error('forbidden'); });
    const result = await ejecutarLoteNacional({ root, unidades: prepararUnidadesNacionales(inventory()), aplicar: true },
      { fetch: network, ahora: () => now, libres: async () => 20 * 1024 ** 3 });
    expect(result.peticionesLote).toBe(0);
    expect(network).not.toHaveBeenCalled();
    expect((await leerEstadoCacheNacional(root)).campanaInicio).toBe(legacy.campanaInicio);
    expect((await leerEstadoCacheNacional(root)).peticionesIniciadas).toBe(1257);
    expect(await readdir(root)).not.toContain('download-windows');
  });
  it('explicit national renewal uses new ceiling without decreasing or changing old campaign state', async () => {
    let clock = now;
    await escribirEstadoCacheNacional(root, { version: 1, peticionesIniciadas: 2000, bytesPayloadActuales: 0,
      cooldownHasta: null, ultimoInicioPeticion: now - 350, campanaInicio: now - 3_000_000, bytesDiscoInicio: 10 });
    const a = await approveDownload(root, 'rfee', id, 60,
      { ...initial(), requests: 2000, payloadBytes: 0, diskBytes: await downloadDiskBytes(root), cooldown: null }, now);
    const w = await createDownloadWindow(a, 1, a.initial, now);
    const starts: number[] = [];
    const network = vi.fn(async (input: RequestInfo | URL) => {
      starts.push(clock);
      return String(input).endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow:\n')
        : new Response('<html>synthetic</html>', { headers: { 'content-type': 'text/html' } });
    });
    const deps = { fetch: network, ahora: () => clock, esperar: async (ms: number) => { clock += ms; },
      libres: async () => 20 * 1024 ** 3 };
    const result = await ejecutarLoteNacional({ root, unidades: prepararUnidadesNacionales(inventory()),
      aplicar: true, windowId: w.id }, deps);
    expect(result.peticionesCampana).toBe(2002);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(350);
    const state = await leerEstadoCacheNacional(root);
    expect(state.campanaInicio).toBe(now - 3_000_000);
    expect(state.bytesDiscoInicio).toBe(10);
    const resumed = await ejecutarLoteNacional({ root, unidades: prepararUnidadesNacionales(inventory()),
      aplicar: true, windowId: w.id }, deps);
    expect(resumed.peticionesLote).toBe(0);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('explicit renewal cannot bypass retained cooldown', async () => {
    await escribirEstadoCacheNacional(root, { version: 1, peticionesIniciadas: 2000, bytesPayloadActuales: 0,
      cooldownHasta: now + 7_200_000, ultimoInicioPeticion: now - 350, campanaInicio: now - 3_000_000 });
    const a = await approveDownload(root, 'rfee', id, 60,
      { ...initial(), requests: 2000, payloadBytes: 0, diskBytes: await downloadDiskBytes(root) }, now);
    const w = await createDownloadWindow(a, 1, a.initial, now);
    const network = vi.fn(async () => new Response('forbidden'));
    const result = await ejecutarLoteNacional({ root, unidades: prepararUnidadesNacionales(inventory()),
      aplicar: true, windowId: w.id },
      { fetch: network, ahora: () => now, libres: async () => 20 * 1024 ** 3 });
    expect(result.motivoParada).toBe('cooldown_vigente');
    expect(network).not.toHaveBeenCalled();
    expect((await leerEstadoCacheNacional(root)).cooldownHasta).toBe(now + 7_200_000);
  });
  it('recovers verified national evidence from the manifest after a failed local unit rename without GET', async () => {
    let clock = now;
    const network = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/robots.txt')
      ? new Response('User-agent: *\nDisallow:\n')
      : new Response('<html>synthetic</html>', { headers: { 'content-type': 'text/html' } }));
    const deps = { fetch: network, ahora: () => clock, esperar: async (ms: number) => { clock += ms; },
      libres: async () => 20 * 1024 ** 3 };
    const options = { root, unidades: prepararUnidadesNacionales(inventory()), aplicar: true };
    await ejecutarLoteNacional(options, deps);
    const cached = (await leerManifiestoCacheNacional(root)).unidades[0];
    await escribirUnidadCacheNacional(root, { ...cached, estado: 'downloading', sha256: null, bytes: null });
    network.mockClear();
    const result = await ejecutarLoteNacional(options, deps);
    expect(result.peticionesLote).toBe(0);
    expect(result.estados.cached).toBe(1);
    expect(network).not.toHaveBeenCalled();
  });
  it('FIE counters and payload cannot shrink on initialization or resume', async () => {
    const cache = new CacheLocal(root);
    await cache.initialize();
    const file = path.join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.bytesStored = 1;
    manifest.requestCount = 2000;
    await writeFile(file, JSON.stringify(manifest));
    await expect(new CacheLocal(root).initialize()).rejects.toMatchObject({ code: 'integrity_error' });
    expect(JSON.parse(await readFile(file, 'utf8')).requestCount).toBe(2000);
    expect(JSON.parse(await readFile(file, 'utf8')).bytesStored).toBe(1);
  });
  it('FIE policy uses the same counted gate and verified immutable cache without repeated GETs', async () => {
    const network = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://fie.org/robots.txt');
      return new Response('User-agent: *\nDisallow:\n', { headers: { 'content-type': 'text/plain' } });
    });
    vi.stubGlobal('fetch', network);
    const cache = new CacheLocal(root, { minStartIntervalMs: 0 });
    expect(await cache.fetchRobotsPolicy()).toContain('User-agent');
    expect(await cache.fetchRobotsPolicy()).toContain('User-agent');
    expect(network).toHaveBeenCalledTimes(1);
    expect((await cache.summary()).requests).toBe(1);
  });
  it('does not dispatch FIE GET if the durable reservation crosses the deadline', async () => {
    const network = vi.fn(async () => new Response('{}'));
    const cache = new CacheLocal(root, {
      minStartIntervalMs: 0, beforeFetch: async () => { throw new Error('time_limit'); },
    });
    await expect(cache.fetchJson('https://fie.org/api/fie/competitions/seasons', {
      unit: { key: 'fie|seasons', season: 0, competitionId: null }, fetchImpl: network,
    })).rejects.toThrow('time_limit');
    expect(network).not.toHaveBeenCalled();
    expect((await cache.summary()).requests).toBe(1);
  });
  it('does not renew network, robots, integrity, disk, 429/503 or child failures', () => {
    for (const reason of ['network_failure', 'http_429', 'http_503', 'robots_no_permite',
      'integrity_error', 'disk_reserve', 'local_failure', 'child_failed']) {
      expect(renewableWindowStop('fie', reason)).toBe(false);
      expect(shouldContinueBatch('fie', reason, true)).toBe(false);
    }
    for (const reason of ['cooldown_fuente', 'fallo_tecnico', 'robots_no_permite',
      'integridad_payload', 'espacio_libre', 'respuesta_parcial', 'child_deadline_or_output_limit']) {
      expect(renewableWindowStop('rfee', reason)).toBe(false);
    }
    expect(shouldContinueBatch('fie', 'unit_checkpoint', false)).toBe(false);
    expect(shouldContinueBatch('rfee', 'lote_completado', false)).toBe(false);
    expect(renewableWindowStop('rfee', 'presupuesto_peticiones')).toBe(true);
  });
  it('runner and FIE dry-runs perform zero GETs, zero writes and no implicit approval', async () => {
    await new CacheLocal(root).initialize();
    const before = await readdir(root);
    const trap = path.join(tmpdir(), `download-window-network-trap-${id}.mjs`);
    await writeFile(trap, 'globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };');
    try {
      const repo = path.resolve(import.meta.dirname, '..');
      for (const args of [
        ['scripts/continuar-descargas-acotadas.ts', '--source', 'fie', '--root', root,
          '--approval', id, '--minutes', '180'],
        ['scripts/descargar-historico-local.ts', '--root', root, '--dry-run'],
      ]) {
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(trap).href,
          '--import', 'tsx', ...args], { cwd: repo, encoding: 'utf8', timeout: 20_000 });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('dry');
        expect(await readdir(root)).toEqual(before);
      }
    } finally { await rm(trap, { force: true }); }
  }, 45_000);
  it('validates finite CLI arguments and rejects duplicate or unsafe input', () => {
    const args = ['--source', 'fie', '--root', root, '--approval', id, '--minutes', '180'];
    expect(parseContinuationArguments(args).apply).toBe(false);
    expect(() => parseContinuationArguments([...args, '--minutes', '180'])).toThrow();
    expect(() => parseContinuationArguments([...args.slice(0, -1), '181'])).toThrow();
    expect(() => parseContinuationArguments([...args, '--apply', '--apply'])).toThrow();
  });
  it('runtime import closure has no database, cloud, dotenv, auth or app persistence imports', async () => {
    const repo = path.resolve(import.meta.dirname, '..');
    const seen = new Set<string>();
    async function check(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      const text = ts.transpileModule(await readFile(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true },
      }).outputText;
      const imports = [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const module of imports) {
        expect(module).not.toMatch(/(?:neon|drizzle|dotenv|cloudflare|appdb|\/db(?:\/|$)|\/auth(?:\/|$)|\/persist|\/r2(?:\/|$))/i);
        if (module.startsWith('.') || module.startsWith('@/')) {
          const resolved = module.startsWith('@/')
            ? path.resolve(repo, 'src', module.slice(2)) : path.resolve(path.dirname(file), module);
          const candidates = [`${resolved}.ts`, `${resolved}.mts`, path.join(resolved, 'index.ts')];
          for (const candidate of candidates) {
            try { await readFile(candidate); await check(candidate); break; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
        }
      }
    }
    for (const file of ['continuar-descargas-acotadas.ts', 'descargar-historico-local.ts', 'descargar-historico-nacional.ts']) {
      await check(path.join(repo, 'scripts', file));
    }
    expect(seen.size).toBeGreaterThan(6);
  });
});
