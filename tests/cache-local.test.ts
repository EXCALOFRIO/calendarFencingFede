import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CacheError,
  CacheLocal,
  createOfflineFetchJson,
  type CacheUnitIdentity,
} from '../src/lib/ingest/backfill/cache-local';
import {
  leerPruebaFie,
  urlCuadro,
  urlPoules,
  urlPrueba,
  urlRanking,
} from '../src/lib/ingest/sources/fie-resultados';

const roots: string[] = [];

async function newCache(options: ConstructorParameters<typeof CacheLocal>[1] = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fie-cache-test-'));
  roots.push(root);
  const cache = new CacheLocal(root, options);
  await cache.initialize();
  return { cache, root };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const identity: CacheUnitIdentity = {
  key: 'fie|2027|77',
  season: 2027,
  competitionId: 77,
  metadata: {
    categoryRaw: 'S',
    weaponRaw: 'E',
    genderRaw: 'M',
    formatRaw: 'I',
    category: 'SEN',
    weapon: 'ESPADA',
    gender: 'M',
    format: 'INDIVIDUAL',
  },
};

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('FIE local cache and offline replay', () => {
  it('reuses verified immutable blobs without a second request', async () => {
    const { cache, root } = await newCache();
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return jsonResponse({ items: [{ rank: 1 }], totalFound: 1 });
    };
    const url = urlRanking(2027, 77, 1, 200);

    const first = await cache.fetchJson<{ totalFound: number }>(url, {
      unit: identity,
      fetchImpl,
    });
    const second = await cache.fetchJson<{ totalFound: number }>(url, {
      unit: identity,
      fetchImpl,
    });

    expect(first.totalFound).toBe(1);
    expect(second.totalFound).toBe(1);
    expect(requests).toBe(1);
    expect(await cache.summary()).toMatchObject({
      units: 1,
      endpoints: 1,
      blobs: 1,
      requests: 1,
    });
    const manifest = JSON.parse(
      await readFile(path.join(root, 'manifest.json'), 'utf8'),
    );
    expect(manifest.units[identity.key].importCompleteness).toBe('not_assessed');
    expect(manifest.units[identity.key].metadata).toEqual(identity.metadata);
    expect(JSON.stringify(manifest)).not.toContain('items');

    const blob = Object.values(manifest.endpoints)[0] as { blobSha256: string };
    const blobPath = path.join(root, 'blobs', blob.blobSha256.slice(0, 2), `${blob.blobSha256}.blob`);
    await (await import('node:fs/promises')).writeFile(blobPath, 'corrupt');
    await expect(
      cache.fetchJson(url, { unit: identity, fetchImpl }),
    ).rejects.toMatchObject({ code: 'integrity_error' });
    expect(requests).toBe(1);
  });

  it('retains rate-limit evidence and blocks the host during Retry-After', async () => {
    const { cache } = await newCache({ minStartIntervalMs: 0 });
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '45' });
    };
    const url = urlRanking(2027, 77, 1, 200);

    await expect(cache.fetchJson(url, { unit: identity, fetchImpl })).rejects.toMatchObject({
      code: 'http_error',
      status: 429,
    });
    await expect(cache.fetchJson(urlPoules(2027, 77), { unit: identity, fetchImpl })).rejects.toMatchObject({
      code: 'cooldown',
    });

    expect(requests).toBe(1);
    const manifest = await cache.readManifest();
    expect(manifest.cooldownUntil['fie.org']).toBeTruthy();
    expect(Object.values(manifest.endpoints)[0]).toMatchObject({
      status: 429,
      completeness: 'http_error',
      errorCode: 'http_429',
      blobSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('replays cached responses through the existing FIE result reader without networking', async () => {
    const { cache } = await newCache({ minStartIntervalMs: 0 });
    const bodies = new Map<string, unknown>([
      [
        urlPrueba(2027, 77),
        {
          competitionId: 77,
          season: 2027,
          name: 'Synthetic cache fixture',
          type: 'I',
          category: 'S',
          competitionCategory: 'A',
          location: 'Fixture City',
          federation: 'Fixture Federation',
          startDate: '2026-10-01',
          endDate: '2026-10-01',
          weapon: 'E',
          gender: 'M',
          tournamentId: 7,
          hasResults: 1,
        },
      ],
      [
        urlRanking(2027, 77, 1, 200),
        {
          totalFound: 1,
          page: 1,
          pageSize: 200,
          items: [
            {
              rank: 1,
              points: 1,
              fencer: { id: 1234, name: 'Synthetic Athlete', countryCode: 'ESP', gender: 'M' },
            },
          ],
        },
      ],
      [urlPoules(2027, 77), { pools: [] }],
      [urlCuadro(2027, 77), { tableau: [] }],
    ]);
    let networkRequests = 0;
    const fetchImpl: typeof fetch = async (input) => {
      networkRequests += 1;
      const value = bodies.get(String(input));
      if (value === undefined) return new Response(null, { status: 404 });
      return jsonResponse(value);
    };

    for (const url of bodies.keys()) {
      await cache.fetchJson(url, { unit: identity, fetchImpl });
    }
    const read = await leerPruebaFie(
      2027,
      77,
      { fetchJson: createOfflineFetchJson(cache) },
      { tamanoPagina: 200, maxPaginas: 1 },
    );

    expect(read.errorPrueba).toBeNull();
    expect(read.prueba).toMatchObject({
      season: 2027,
      competitionId: 77,
      categoriaOriginal: 'S',
      arma: 'ESPADA',
      genero: 'M',
      formato: 'INDIVIDUAL',
    });
    expect(read.ranking?.puestos).toHaveLength(1);
    expect(read.poules?.cobertura.estado).toBe('sin_resultados');
    expect(read.cuadro?.cobertura.estado).toBe('sin_resultados');
    expect(networkRequests).toBe(4);
    expect((await cache.summary()).endpoints).toBe(4);
  });

  it('rejects non-FIE URLs and private query parameters before any request', async () => {
    const { cache } = await newCache({ minStartIntervalMs: 0 });
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return jsonResponse({});
    };

    await expect(
      cache.fetchJson('https://example.com/api/fie/competition/2027/77', {
        unit: identity,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(CacheError);
    await expect(
      cache.fetchJson('https://fie.org/api/fie/competition/2027/77?token=secret', {
        unit: identity,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'unsafe_url' });
    expect(requests).toBe(0);
  });

  it('retains invalid original bytes and refuses offline misses without networking', async () => {
    const { cache, root } = await newCache({ minStartIntervalMs: 0 });
    const original = '{invalid original';
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests++;
      return new Response(original, { headers: { 'content-type': 'application/json' } });
    };
    await expect(cache.fetchJson(urlPrueba(2027, 77), { unit: identity, fetchImpl })).rejects.toMatchObject({ code: 'invalid_json' });
    const endpoint = Object.values((await cache.readManifest()).endpoints)[0];
    expect(endpoint.completeness).toBe('invalid_json');
    expect(await readFile(path.join(root, 'blobs', endpoint.blobSha256!.slice(0, 2), `${endpoint.blobSha256}.blob`), 'utf8')).toBe(original);
    await expect(cache.offlineFetchJson(urlPrueba(2027, 77))).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(cache.offlineFetchJson(urlPrueba(2027, 78))).rejects.toMatchObject({ code: 'cache_miss' });
    expect(requests).toBe(1);
  });

  it('honors HTTP-date Retry-After on 503 and never replays an error body as success', async () => {
    const { cache } = await newCache({ minStartIntervalMs: 0 });
    const now = () => Date.parse('2026-10-03T10:00:00Z');
    const url = urlPrueba(2027, 77);
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests++;
      return jsonResponse({ error: 'unavailable' }, 503, { 'retry-after': 'Sat, 03 Oct 2026 10:02:00 GMT' });
    };
    await expect(cache.fetchJson(url, { unit: identity, fetchImpl, now })).rejects.toMatchObject({
      status: 503, retryAfterUntil: '2026-10-03T10:02:00.000Z',
    });
    await expect(cache.fetchJson(urlPoules(2027, 77), { unit: identity, fetchImpl, now })).rejects.toMatchObject({ code: 'cooldown' });
    await expect(cache.offlineFetchJson(url)).rejects.toMatchObject({ code: 'cooldown', status: 503 });
    expect(requests).toBe(1);
    expect(Object.values((await cache.readManifest()).endpoints)[0].retryAfterMs).toBe(120000);
  });

  it('enforces concurrent request starts, in-flight ceiling and request budget', async () => {
    const { cache } = await newCache({ minStartIntervalMs: 60, maxInFlight: 2, maxRequests: 4 });
    const starts: number[] = [];
    let active = 0;
    let maximum = 0;
    const fetchImpl: typeof fetch = async () => {
      starts.push(Date.now());
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 120));
      active--;
      return jsonResponse({});
    };
    const results = await Promise.allSettled(Array.from({ length: 7 }, (_, i) =>
      cache.fetchJson(urlPrueba(2027, 77 + i), {
        unit: { ...identity, key: `fie|2027|${77 + i}`, competitionId: 77 + i }, fetchImpl,
      })));
    expect(starts).toHaveLength(4);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(starts.slice(1).every((start, i) => start - starts[i] >= 60)).toBe(true);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect((await cache.summary()).requests).toBe(4);
  });

  it('retains storage-limit evidence and preserves byte ceiling', async () => {
    const { cache } = await newCache({ minStartIntervalMs: 0, maxBytes: 10 });
    await expect(cache.fetchJson(urlPrueba(2027, 77), {
      unit: identity, fetchImpl: async () => jsonResponse({ oversized: true }),
    })).rejects.toMatchObject({ code: 'cache_limit' });
    expect((await cache.summary()).bytes).toBe(0);
    expect(Object.values((await cache.readManifest()).endpoints)[0].completeness).toBe('storage_limit');
  });

  it('resumes in a new instance, deduplicates blobs, and preserves empty/partial evidence', async () => {
    const { cache, root } = await newCache({ minStartIntervalMs: 0 });
    let requests = 0;
    const fetchImpl: typeof fetch = async () => { requests++; return jsonResponse({ pools: [] }); };
    await cache.fetchJson(urlPoules(2027, 77), { unit: identity, fetchImpl });
    await cache.fetchJson(urlPoules(2027, 78), { unit: { ...identity, key: 'fie|2027|78' }, fetchImpl });
    const resumed = new CacheLocal(root, { minStartIntervalMs: 0 });
    await resumed.initialize();
    await resumed.fetchJson(urlPoules(2027, 77), { unit: identity, fetchImpl });
    expect(requests).toBe(2);
    expect(await resumed.summary()).toMatchObject({ blobs: 1, byCompleteness: { empty: 2 } });
    await resumed.fetchJson(urlRanking(2027, 77, 1, 200), {
      unit: identity, fetchImpl: async () => jsonResponse({ totalFound: 300, items: [] }),
    });
    expect((await resumed.summary()).byCompleteness.partial).toBe(1);
  });
});
