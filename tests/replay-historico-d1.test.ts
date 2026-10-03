import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ejecutarReplayLocal, parsearArgsReplayLocal, LIMITES_REPLAY_LOCAL,
  type OpcionesReplayLocal, type DepsReplayLocal,
} from '../src/lib/ingest/backfill/replay-local';
import { abrirD1Local, destinoD1Local } from '../src/lib/ingest/sport-incremental/local';
import { reclamarSportLease } from '../src/lib/ingest/sport-incremental/lease';
import { urlPrueba, urlRanking, urlPoules, urlCuadro } from '../src/lib/ingest/sources/fie-resultados';
import { idUnidadNacional, type UnidadCacheNacional } from '../src/lib/ingest/backfill/cache-nacional';
import type { CacheManifest, CacheEndpoint } from '../src/lib/ingest/backfill/cache-local';
import { skermoCompetitionResultsUrl } from '../src/lib/ingest/sources/skermo-results';

const roots: string[] = [];
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const fetched = vi.fn(() => { throw new Error('fixture_network_forbidden'); });
async function root(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir); return dir;
}
async function database(schema = true) {
  const dir = await root('offline-replay-db-'), path = join(dir, 'fixture.sqlite');
  const sqlite = new DatabaseSync(path);
  if (schema) {
    sqlite.exec('BEGIN');
    sqlite.exec(readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8'));
    sqlite.exec(readFileSync(new URL('../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8'));
    sqlite.exec('COMMIT');
  }
  sqlite.close(); return path;
}
function inspect(path: string, query: string) {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  try { return sqlite.prepare(query).all(); } finally { sqlite.close(); }
}
async function diskSnapshot(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of await readdir(dir, { withFileTypes: true })) {
    if (name.isDirectory()) {
      for (const [file, digest] of Object.entries(await diskSnapshot(join(dir, name.name)))) result[`${name.name}/${file}`] = digest;
    } else result[name.name] = hash(await readFile(join(dir, name.name)));
  }
  return result;
}
const metadata = {
  competitionId: 77, season: 2027, name: 'SYNTHETIC PRIVATE EVENT',
  type: 'I', category: 'S', competitionCategory: 'A',
  location: 'Fixture', federation: 'Fixture', startDate: '2026-10-01',
  endDate: '2026-10-01', weapon: 'E', gender: 'M', tournamentId: 7, hasResults: 1,
};
const ranking = (count = 1, total = count) => ({
  totalFound: total, items: Array.from({ length: count }, (_, i) => ({
    rank: i + 1, points: 10,
    fencer: { id: 1234 + i, name: `SYNTHETIC PRIVATE ATHLETE ${i}`, countryCode: 'ESP', gender: 'M' },
  })),
});
async function fieCache(overrides: { missing?: string[]; bodies?: Map<string, unknown>; raw?: Map<string, string> } = {}) {
  const dir = await root('offline-replay-fie-');
  await mkdir(join(dir, 'blobs'));
  const unitKey = 'fie|FIE|2027|77';
  const m: CacheManifest = {
    version: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    requestCount: 2000, bytesStored: 0, cooldownUntil: { 'fie.org': '2100-01-01T00:00:00Z' },
    units: { [unitKey]: { key: unitKey, season: 2027, competitionId: 77, importCompleteness: 'not_assessed', endpoints: [] } },
    endpoints: {},
  };
  const docs = overrides.bodies ?? new Map<string, unknown>([
    [urlPrueba(2027, 77), metadata], [urlRanking(2027, 77, 1, 200), ranking()],
    [urlPoules(2027, 77), { pools: [] }], [urlCuadro(2027, 77), { tableau: [] }],
  ]);
  for (const [url, body] of docs) {
    if (overrides.missing?.includes(url)) continue;
    const bytes = Buffer.from(overrides.raw?.get(url) ?? JSON.stringify(body));
    const sha = hash(bytes), parsed = new URL(url);
    const query = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`).join('&');
    const endpoint = `${parsed.pathname}${query ? `?${query}` : ''}`, key = `${unitKey}|${endpoint}`;
    const record: CacheEndpoint = {
      key, unitKey, endpoint, url, status: 200, fetchedAt: '2026-10-01T00:00:00Z',
      contentType: 'application/json', retryAfterMs: null, retryAfterUntil: null,
      blobSha256: sha, bytes: bytes.length, completeness: 'complete', errorCode: null,
    };
    m.endpoints[key] = record; m.units[unitKey].endpoints.push(endpoint);
    await mkdir(join(dir, 'blobs', sha.slice(0, 2)), { recursive: true });
    await writeFile(join(dir, 'blobs', sha.slice(0, 2), `${sha}.blob`), bytes);
    m.bytesStored += bytes.length;
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(m));
  await writeFile(join(dir, 'campaign.json'), JSON.stringify({ exhausted: true, requests: 2000 }));
  return { dir, manifest: m };
}
const html = (partial = false) => `<html>
  <div class="panel-heading"><h3>Resultado Competición SYNTHETIC PRIVATE EVENT 2026-2027</h3></div>
  <div class="row hidden-xs"><h3>ESPADA</h3><h3>MASCULINO</h3><h3>ABS</h3>
  <h3>INDIVIDUAL</h3><h3>01/10/2026</h3></div>
  <table><thead><tr><th>Posición</th><th>Nombre</th><th>Apellidos</th><th>Licencia</th><th>Puntuación</th></tr></thead>
  <tbody><tr><td>1</td><td>SYNTHETIC PRIVATE</td><td>ATHLETE</td><td>TST00001</td><td>10</td></tr>
  ${partial ? '<tr><td>2</td></tr>' : ''}</tbody></table></html>`;
async function nationalCache(tipo: 'html' | 'pdf', body: string | Uint8Array, changes: Partial<UnidadCacheNacional> = {}) {
  const dir = await root('offline-replay-national-');
  await mkdir(join(dir, 'blobs'));
  const url = tipo === 'html' ? skermoCompetitionResultsUrl('RFEE', '77') : 'https://app.skermo.org/client/1/fixture.pdf';
  const bytes = typeof body === 'string' ? Buffer.from(body) : body, sha = hash(bytes);
  const u: UnidadCacheNacional = {
    id: idUnidadNacional(tipo, url), tipo, url,
    asociaciones: [{
      fuente: 'skermo_rfee', federacion: 'RFEE', temporada: '2026-2027',
      clavePrueba: tipo === 'html' ? 'RFEE:77' : null, claveCatalogo: 'skermo_rfee|RFEE|2026-2027|fixture',
      arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: 'ABS', formato: 'INDIVIDUAL',
    }],
    estado: 'cached', intentos: 1, consultadoEn: '2026-10-01T00:00:00Z', httpStatus: 200,
    contentType: tipo === 'html' ? 'text/html' : 'application/pdf', declaredBytes: bytes.length,
    receivedBytes: bytes.length, bytes: bytes.length, sha256: sha, retryAfterMs: null, motivo: null, ...changes,
  };
  await writeFile(join(dir, 'blobs', `${sha}.bin`), bytes);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    version: 1, tipo: 'evidencia-publica-rfee', generadoEn: '2026-10-01T00:00:00Z',
    soloDescarga: true, aviso: 'fixture', peticionesIniciadas: 2000, bytesPayload: bytes.length, unidades: [u],
  }));
  await writeFile(join(dir, 'state.json'), JSON.stringify({ peticionesIniciadas: 2000, campanaInicio: 1 }));
  return { dir, unit: u };
}
function options(cache: string, aplicar = false): OpcionesReplayLocal {
  return { aplicar, cacheFie: cache, selecciones: [{ tipo: 'fie', season: 2027, competitionId: 77 }], maxUnidades: 10, maxMs: 300_000 };
}
function target(path: string) {
  const calls: boolean[] = [];
  const deps: DepsReplayLocal = { abrir: (write) => { calls.push(write); return abrirD1Local(path, write); } };
  return { deps, calls };
}
function tinyPdf(): Uint8Array {
  // Synthetic PDF with a textless page: existing reader must defer, never OCR.
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let text = '%PDF-1.4\n', offsets = [0];
  objs.forEach((obj, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
beforeEach(() => { fetched.mockClear(); vi.stubGlobal('fetch', fetched); });
afterEach(async () => {
  expect(fetched).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('strict offline local historical replay', () => {
  it('simulates real native SQLite read-only without changing database or cache bytes', async () => {
    const f = await fieCache(), path = await database(), t = target(path);
    const dbBefore = await readFile(path), cacheBefore = await diskSnapshot(f.dir);
    const r = await ejecutarReplayLocal(options(f.dir), t.deps);
    expect(r).toMatchObject({ modo: 'simulacion', leidas: 1, persistidas: 0, detenido: false,
      hechosLeidos: { puestos: 1, asaltos: 0 }, incidencias: {}, sentenciasReservadas: 0 });
    expect(t.calls).toEqual([false]);
    expect(await readFile(path)).toEqual(dbBefore);
    expect(await diskSnapshot(f.dir)).toEqual(cacheBefore);
  }, 20_000);
  it('runs the actual CLI default simulation with sanitized aggregate output', async () => {
    const f = await fieCache(), path = await database(), before = await readFile(path);
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/replay-historico-d1.ts',
      '--d1-local', path, '--cache-fie', f.dir, '--fie', '2027:77'],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, DATABASE_URL: 'fixture-do-not-use', NODE_OPTIONS: '' } });
    expect(JSON.parse(output)).toMatchObject({ modo: 'simulacion', persistidas: 0 });
    expect(output).not.toMatch(/PRIVATE|fixture-do-not-use|https:|manifest|fencers/i);
    expect(await readFile(path)).toEqual(before);
  }, 35_000);
  it('persists idempotent accepted facts with original provenance and releases owner context', async () => {
    const f = await fieCache(), path = await database(), t = target(path), before = await diskSnapshot(f.dir);
    const a = await ejecutarReplayLocal(options(f.dir, true), t.deps);
    expect(a).toMatchObject({ persistidas: 1, detenido: false, incidencias: {} });
    expect(a.sentenciasReservadas).toBeGreaterThan(0);
    const facts = inspect(path, 'select source_fact_key,source_url,revision,person_id from sport_result');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ source_fact_key: '1234', source_url: urlRanking(2027, 77), revision: 1 });
    const b = await ejecutarReplayLocal(options(f.dir, true), t.deps);
    expect(b.persistidas).toBe(1);
    expect(inspect(path, 'select source_fact_key,source_url,revision,person_id from sport_result')).toEqual(facts);
    expect(inspect(path, 'select count(*) as n from sport_person')[0].n).toBe(1);
    expect(inspect(path, 'select count(*) as n from sport_write_context')[0].n).toBe(0);
    expect(inspect(path, "select expires_at <= (cast(strftime('%s','now') as integer)*1000+1000) as released from sport_write_lease")[0].released).toBe(1);
    expect(await diskSnapshot(f.dir)).toEqual(before);
  });
  it('hash failure in any selected blob aborts before opening even a read-only target', async () => {
    const f = await fieCache(), path = await database(), t = target(path), before = await readFile(path);
    const rec = Object.values(f.manifest.endpoints)[0];
    await writeFile(join(f.dir, 'blobs', rec.blobSha256!.slice(0, 2), `${rec.blobSha256}.blob`), 'SYNTHETIC PRIVATE corrupt');
    const r = await ejecutarReplayLocal(options(f.dir, true), t.deps);
    expect(r).toMatchObject({ detenido: true, incidencias: { hash_mismatch: 1 }, persistidas: 0 });
    expect(t.calls).toEqual([]);
    expect(await readFile(path)).toEqual(before);
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  }, 20_000);
  it('rejects exact cached URL/endpoint mismatch before writes', async () => {
    const f = await fieCache(), path = await database(), t = target(path);
    const rec = Object.values(f.manifest.endpoints)[0]; rec.url += '?page=1';
    await writeFile(join(f.dir, 'manifest.json'), JSON.stringify(f.manifest));
    const r = await ejecutarReplayLocal(options(f.dir, true), t.deps);
    expect(r.incidencias).toEqual({ invalid_cache: 1 });
    expect(t.calls).toEqual([]);
  });
  it('rejects a changed pinned campaign manifest before even opening the target', async () => {
    const f = await fieCache(), path = await database(), t = target(path);
    const r = await ejecutarReplayLocal({ ...options(f.dir, true), cacheFieSha256: 'a'.repeat(64) }, t.deps);
    expect(r).toMatchObject({ detenido: true, incidencias: { invalid_cache: 1 } });
    expect(t.calls).toEqual([]);
  });
  it('executes the actual bounded campaign CLI against a native local target, without network', async () => {
    const f = await fieCache(), path = await database(), before = await readFile(path);
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/importar-campana-historica-local.ts',
      '--d1-local', path, '--cache-fie', f.dir, '--fuente', 'fie', '--max-unidades', '1', '--solo-hechos'],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, DATABASE_URL: 'fixture-do-not-use', NODE_OPTIONS: '' } });
    expect(JSON.parse(output)).toMatchObject({ modo: 'simulacion', procesadas: 1, persistidas: 0, recibosPrivados: null });
    expect(output).not.toMatch(/PRIVATE|fixture-do-not-use|https:/i);
    expect(await readFile(path)).toEqual(before);
  }, 35_000);
  it('cache miss never fetches and preserves published facts from valid phases as partial coverage', async () => {
    const docs = new Map<string, unknown>([
      [urlPrueba(2027, 77), metadata], [urlRanking(2027, 77, 1, 200), ranking(1, 201)],
      [urlPoules(2027, 77), { pools: [] }], [urlCuadro(2027, 77), { tableau: [] }],
    ]);
    const f = await fieCache({ bodies: docs }), path = await database(), complete = await fieCache();
    expect((await ejecutarReplayLocal(options(complete.dir, true), target(path).deps)).persistidas).toBe(1);
    expect(inspect(path, "select status from sport_import_coverage where fact_kind='ranking'")[0].status).toBe('completo');
    const r = await ejecutarReplayLocal(options(f.dir, true), target(path).deps);
    expect(r).toMatchObject({ persistidas: 1, incidencias: { cache_miss: 1, source_partial: 1 } });
    expect(inspect(path, 'select count(*) as n from sport_result')[0].n).toBe(1);
    expect(inspect(path, "select status,imported_total,published_total from sport_import_coverage where fact_kind='ranking'")[0])
      .toMatchObject({ status: 'parcial', imported_total: 1, published_total: 201 });
  });
  it('never merges distinct published IDs because two participants have the same name', async () => {
    const list = ranking(2);
    list.items[1].fencer.name = list.items[0].fencer.name;
    const docs = new Map<string, unknown>([
      [urlPrueba(2027, 77), metadata], [urlRanking(2027, 77, 1, 200), list],
      [urlPoules(2027, 77), { pools: [] }], [urlCuadro(2027, 77), { tableau: [] }],
    ]);
    const f = await fieCache({ bodies: docs }), path = await database();
    expect((await ejecutarReplayLocal(options(f.dir, true), target(path).deps)).persistidas).toBe(1);
    expect(inspect(path, 'select count(distinct person_id) as n from sport_result')[0].n).toBe(2);
    expect(inspect(path, 'select count(*) as n from sport_external_id')[0].n).toBe(2);
  });
  it('records error coverage for malformed cached metadata without inserting competitions', async () => {
    const f = await fieCache({ raw: new Map([[urlPrueba(2027, 77), '{SYNTHETIC PRIVATE malformed']]) }), path = await database();
    const r = await ejecutarReplayLocal(options(f.dir, true), target(path).deps);
    expect(r).toMatchObject({ persistidas: 1, incidencias: { malformed_document: 1 }, coberturaPersistida: { error: 1 } });
    expect(inspect(path, 'select count(*) as n from sport_competition')[0].n).toBe(0);
    expect(inspect(path, 'select status,last_error from sport_import_coverage')[0]).toMatchObject({ status: 'error', last_error: 'malformed_document' });
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  });
  it('missing selected unit is deferred without claiming a lease', async () => {
    const f = await fieCache(), path = await database(), t = target(path);
    const o = options(f.dir, true); o.selecciones = [{ tipo: 'fie', season: 2027, competitionId: 78 }];
    const r = await ejecutarReplayLocal(o, t.deps);
    expect(r).toMatchObject({ incidencias: { cache_miss: 1 }, persistidas: 0 });
    expect(t.calls).toEqual([false]);
    expect(inspect(path, 'select * from sport_write_lease')).toEqual([]);
  });
  it('defers an oversized ranking unit before any target write; never truncates a list', async () => {
    const docs = new Map<string, unknown>([
      [urlPrueba(2027, 77), metadata], [urlRanking(2027, 77, 1, 200), ranking(1, LIMITES_REPLAY_LOCAL.puestos + 1)],
      [urlPoules(2027, 77), { pools: [] }], [urlCuadro(2027, 77), { tableau: [] }],
    ]);
    const f = await fieCache({ bodies: docs }), path = await database(), t = target(path);
    const r = await ejecutarReplayLocal(options(f.dir, true), t.deps);
    expect(r).toMatchObject({ incidencias: { oversized_ranking: 1 }, leidas: 0, persistidas: 0 });
    expect(t.calls).toEqual([false]);
    expect(inspect(path, 'select * from sport_ranking_publication')).toEqual([]);
    expect(inspect(path, 'select * from sport_ranking_entry')).toEqual([]);
    expect(inspect(path, 'select * from sport_result')).toEqual([]);
  });
  it('bounds every owner-facade application batch against the complete 1000-statement budget', async () => {
    const docs = new Map<string, unknown>([
      [urlPrueba(2027, 77), metadata], [urlRanking(2027, 77, 1, 200), ranking(200)],
      [urlPoules(2027, 77), { pools: [] }], [urlCuadro(2027, 77), { tableau: [] }],
    ]);
    const f = await fieCache({ bodies: docs }), path = await database();
    const r = await ejecutarReplayLocal(options(f.dir, true), target(path).deps);
    expect(r).toMatchObject({ detenido: true, persistidas: 0,
      incidencias: { statement_limit: 1 }, escrituraIncompletaPosible: true });
    expect(r.sentenciasReservadas).toBeLessThanOrEqual(LIMITES_REPLAY_LOCAL.sentencias);
    expect(inspect(path, 'select count(*) as n from sport_write_context')[0].n).toBe(0);
    expect(inspect(path, 'select * from sport_ranking_publication')).toEqual([]);
  }, 30_000);
  it('explicit facts-first mode imports a large list without creating or name-merging identities', async () => {
    const docs = new Map<string, unknown>([
      [urlPrueba(2027, 77), metadata], [urlRanking(2027, 77, 1, 200), ranking(200)],
      [urlPoules(2027, 77), { pools: [] }], [urlCuadro(2027, 77), { tableau: [] }],
    ]);
    const f = await fieCache({ bodies: docs }), path = await database();
    const r = await ejecutarReplayLocal({ ...options(f.dir, true), soloHechos: true }, target(path).deps);
    expect(r).toMatchObject({ persistidas: 1, detenido: false, incidencias: {} });
    expect(r.sentenciasReservadas).toBeLessThanOrEqual(LIMITES_REPLAY_LOCAL.sentencias);
    expect(inspect(path, 'select count(*) as n from sport_result')[0].n).toBe(200);
    expect(inspect(path, 'select count(*) as n from sport_person')[0].n).toBe(0);
    expect(inspect(path, "select status from sport_import_coverage where fact_kind='ranking'")[0].status).toBe('conflicto');
    const facts = inspect(path, 'select source_fact_key,content_hash,revision from sport_result order by source_fact_key');
    await ejecutarReplayLocal({ ...options(f.dir, true), soloHechos: true }, target(path).deps);
    expect(inspect(path, 'select source_fact_key,content_hash,revision from sport_result order by source_fact_key')).toEqual(facts);
  }, 30_000);
  it('refuses DATABASE_URL or a remote target for --aplicar using the existing local guard', async () => {
    const path = await database();
    expect(() => destinoD1Local(['--d1-local', path, '--aplicar'], true, { DATABASE_URL: 'fixture-do-not-use' }))
      .toThrow('sport_cli_remove_database_url_before_write');
    expect(() => destinoD1Local(['--d1-local', path, '--aplicar', '--remote'], true, {}))
      .toThrow('sport_cli_remote_or_neon_refused');
    expect(() => destinoD1Local(['--d1-local', 'relative.sqlite'], false, {}))
      .toThrow('sport_cli_invalid_d1_local');
  });
  it('fails closed on missing schema before a writable open', async () => {
    const f = await fieCache(), path = await database(false), t = target(path);
    const r = await ejecutarReplayLocal(options(f.dir, true), t.deps);
    expect(r).toMatchObject({ detenido: true, incidencias: { schema_required: 1 } });
    expect(t.calls).toEqual([false]);
  });
  it('refuses a competing lease without touching sporting facts or releasing another owner', async () => {
    const f = await fieCache(), path = await database(), raw = abrirD1Local(path, true);
    const lease = await reclamarSportLease(raw.db);
    try {
      const r = await ejecutarReplayLocal(options(f.dir, true), target(path).deps);
      expect(r).toMatchObject({ detenido: true, incidencias: { lease_unavailable: 1 } });
      expect(inspect(path, 'select owner from sport_write_lease')[0].owner).toBe(lease!.owner);
      expect(inspect(path, 'select * from sport_result')).toEqual([]);
    } finally { await lease!.liberar(); raw.close(); }
  });
  it('owner/version fencing stops writes after a reclaim and stale finally cannot release the new owner', async () => {
    const f = await fieCache(), path = await database(), foreignOwner = '11111111-1111-4111-8111-111111111111';
    let writing = false, checks = 0;
    const deps: DepsReplayLocal = {
      abrir: (write) => { writing = write; return abrirD1Local(path, write); },
      ahora: () => {
        if (writing && ++checks === 2) {
          const sqlite = new DatabaseSync(path);
          sqlite.prepare("update sport_write_lease set owner=?,lease_version=lease_version+1,expires_at=4102444800000 where key='global'").run(foreignOwner);
          sqlite.close();
        }
        return 0;
      },
    };
    const r = await ejecutarReplayLocal(options(f.dir, true), deps);
    expect(r).toMatchObject({ detenido: true, incidencias: { lease_unavailable: 1 } });
    expect(inspect(path, 'select * from sport_result')).toEqual([]);
    expect(inspect(path, 'select owner,expires_at from sport_write_lease')[0]).toMatchObject({ owner: foreignOwner, expires_at: 4102444800000 });
    expect(inspect(path, 'select count(*) as n from sport_write_context')[0].n).toBe(0);
  });
  it('enforces elapsed budget before cache preflight or target opening', async () => {
    const f = await fieCache(), path = await database(), t = target(path);
    let calls = 0;
    const r = await ejecutarReplayLocal(options(f.dir, true), { ...t.deps, ahora: () => calls++ ? 300_001 : 0 });
    expect(r).toMatchObject({ detenido: true, incidencias: { time_limit: 1 } });
    expect(t.calls).toEqual([]);
  });
  it('checks the deadline through the owner facade before mutations and releases its lease', async () => {
    const f = await fieCache(), path = await database();
    let writing = false, checks = 0;
    const r = await ejecutarReplayLocal(options(f.dir, true), {
      abrir: (write) => { writing = write; return abrirD1Local(path, write); },
      ahora: () => writing && ++checks > 1 ? 300_001 : 0,
    });
    expect(r).toMatchObject({ detenido: true, incidencias: { time_limit: 1 } });
    expect(inspect(path, 'select * from sport_result')).toEqual([]);
    expect(inspect(path, "select expires_at < 4102444800000 as released from sport_write_lease")[0].released).toBe(1);
  });
  it('replays national HTML from exact URL, original association and source-only header', async () => {
    const f = await nationalCache('html', html(true)), path = await database();
    const o = options(f.dir, true); delete o.cacheFie; o.cacheNacional = f.dir;
    o.selecciones = [{ tipo: 'html', id: f.unit.id }];
    const r = await ejecutarReplayLocal(o, target(path).deps);
    expect(r).toMatchObject({ leidas: 1, persistidas: 1, incidencias: { source_partial: 1 } });
    expect(inspect(path, 'select source,source_url from sport_result')[0]).toMatchObject({ source: 'skermo_rfee', source_url: f.unit.url });
    expect(inspect(path, 'select status from sport_import_coverage')[0].status).toBe('parcial');
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  });
  it('does not invent a missing national index date or name', async () => {
    const f = await nationalCache('html', html().replace('<h3>01/10/2026</h3>', '')), path = await database();
    const o = options(f.dir, true); delete o.cacheFie; o.cacheNacional = f.dir; o.selecciones = [{ tipo: 'html', id: f.unit.id }];
    const t = target(path), r = await ejecutarReplayLocal(o, t.deps);
    expect(r.incidencias).toEqual({ unsupported_context: 1 });
    expect(t.calls).toEqual([false]);
  });
  it('distinguishes a malformed national document from source partial or cache miss', async () => {
    const f = await nationalCache('html', '<html>SYNTHETIC PRIVATE not a classification</html>'), path = await database();
    const o = options(f.dir, true); delete o.cacheFie; o.cacheNacional = f.dir; o.selecciones = [{ tipo: 'html', id: f.unit.id }];
    expect((await ejecutarReplayLocal(o, target(path).deps)).incidencias).toEqual({ malformed_document: 1 });
  });
  it('defers partial national transport payload rather than treating a truncated source as complete', async () => {
    const f = await nationalCache('html', html(), { estado: 'partial' }), path = await database();
    const o = options(f.dir, true); delete o.cacheFie; o.cacheNacional = f.dir; o.selecciones = [{ tipo: 'html', id: f.unit.id }];
    const t = target(path), r = await ejecutarReplayLocal(o, t.deps);
    expect(r.incidencias).toEqual({ source_partial: 1 });
    expect(t.calls).toEqual([false]);
  });
  it('reads a synthetic cached PDF without OCR and persists truthful deferred checkpoint provenance', async () => {
    const f = await nationalCache('pdf', tinyPdf()), path = await database();
    const o = options(f.dir, true); delete o.cacheFie; o.cacheNacional = f.dir; o.selecciones = [{ tipo: 'pdf', id: f.unit.id }];
    const r = await ejecutarReplayLocal(o, target(path).deps);
    expect(r).toMatchObject({ leidas: 1, persistidas: 1, incidencias: { source_partial: 1 } });
    const coverage = inspect(path, "select status,source_url,cursor from sport_import_coverage where fact_kind='pdf'")[0];
    expect(coverage).toMatchObject({ status: 'pendiente', source_url: f.unit.url });
    const checkpoint = JSON.parse(String(coverage.cursor));
    expect(checkpoint.ocr.necesario).toBe(true);
    expect(checkpoint.origen).toMatchObject({ refOriginal: f.unit.asociaciones[0].claveCatalogo, sourceUrl: f.unit.url });
    expect(inspect(path, 'select * from sport_result')).toEqual([]);
  });
  it('does not match two national documents or seasons by a display name', async () => {
    const f = await nationalCache('html', html()), path = await database();
    f.unit.asociaciones.push({ ...f.unit.asociaciones[0], temporada: '2025-2026' });
    const manifestPath = join(f.dir, 'manifest.json');
    const m = JSON.parse(await readFile(manifestPath, 'utf8')); m.unidades = [f.unit];
    await writeFile(manifestPath, JSON.stringify(m));
    const o = options(f.dir, true); delete o.cacheFie; o.cacheNacional = f.dir; o.selecciones = [{ tipo: 'html', id: f.unit.id }];
    expect((await ejecutarReplayLocal(o, target(path).deps)).incidencias).toEqual({ unsupported_context: 1 });
    expect(inspect(path, 'select * from sport_person')).toEqual([]);
  });
});

describe('explicit bounded argument grammar', () => {
  const cache = fileURLToPath(new URL('../', import.meta.url));
  it('allows at most ten explicit units and a smaller positive bounded budget', () => {
    const args = ['--cache-fie', cache, '--max-unidades', '10', '--max-segundos', '1',
      ...Array.from({ length: 10 }, (_, i) => ['--fie', `2027:${i + 1}`]).flat()];
    expect(parsearArgsReplayLocal(args)).toMatchObject({ aplicar: false, maxUnidades: 10, maxMs: 1000 });
    expect(() => parsearArgsReplayLocal([...args, '--fie', '2027:11'])).toThrow('replay_invalid_arguments');
    expect(parsearArgsReplayLocal([...args, '--solo-hechos'])).toMatchObject({ soloHechos: true, aplicar: false });
    expect(() => parsearArgsReplayLocal([...args, '--solo-hechos', '--solo-hechos'])).toThrow('replay_invalid_arguments');
  });
  it.each([
    [], ['--aplicar'], ['--all'], ['--fie', '2027:77'],
    ['--cache-fie', 'relative', '--fie', '2027:77'],
    ['--cache-fie', cache, '--fie', '2027:77', '--fie', '2027:77'],
    ['--cache-fie', cache, '--fie', '2027:0'],
    ['--cache-fie', cache, '--fie', '2027:1e3'],
    ['--cache-fie', cache, '--fie', '2027:77', '--max-unidades', '11'],
    ['--cache-fie', cache, '--fie', '2027:77', '--max-segundos', '301'],
    ['--cache-fie', cache, '--fie', '2027:77', '--max-segundos', '0'],
    ['--cache-fie', cache, '--fie', '2027:77', '--max-segundos', 'NaN'],
    ['--cache-fie', cache, '--fie', '2027:77', '--aplicar', '--aplicar'],
    ['--cache-fie', cache, '--cache-fie', cache, '--fie', '2027:77'],
    ['--cache-nacional', cache, '--pdf', '../private'],
    ['--cache-fie', cache, '--fie', '2027:77', '--remote'],
    ['--cache-fie', cache, '--fie', '2027:77', '--ranking-fie', '2027:E:M:S:I'],
  ].map((args) => [args]))('rejects malformed/implicit/remote/unsupported arguments %#', (args) => {
    expect(() => parsearArgsReplayLocal(args)).toThrow('replay_invalid_arguments');
  });
});
