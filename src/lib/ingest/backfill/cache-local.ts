import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { writeAtomicCacheJson, cacheIo, linkCacheBlob, CacheLocalIoError } from './cache-atomic';

/**
 * Storage-neutral FIE response cache.
 *
 * A successful HTTP response is only evidence that a body was fetched. It is
 * not evidence that a source reader imported all placements or bouts. Every
 * unit therefore remains `not_assessed` until a separate importer evaluates
 * it. Callers must obtain any required source-retention permission before
 * using the network capture path.
 */

export const DEFAULT_CACHE_LIMIT_BYTES = 512 * 1024 * 1024;
export const DEFAULT_REQUEST_LIMIT = 2_000;
export const DEFAULT_MAX_IN_FLIGHT = 2;
export const DEFAULT_MIN_START_INTERVAL_MS = 350;
export const DEFAULT_FIE_HOST = 'fie.org';

export type CacheCompleteness =
  | 'complete'
  | 'partial'
  | 'empty'
  | 'invalid_json'
  | 'http_error'
  | 'storage_limit';

export type CacheUnitMetadata = {
  categoryRaw: string | null;
  weaponRaw: string | null;
  genderRaw: string | null;
  formatRaw: string | null;
  category: string | null;
  weapon: string | null;
  gender: string | null;
  format: string | null;
};

export type CacheUnitIdentity = {
  key: string;
  season: number;
  competitionId: number | null;
  metadata?: CacheUnitMetadata;
};

export type CacheUnit = CacheUnitIdentity & {
  importCompleteness: 'not_assessed';
  endpoints: string[];
};

export type CacheEndpoint = {
  key: string;
  unitKey: string;
  endpoint: string;
  url: string;
  status: number;
  fetchedAt: string;
  contentType: string | null;
  retryAfterMs: number | null;
  retryAfterUntil: string | null;
  blobSha256: string | null;
  bytes: number;
  completeness: CacheCompleteness;
  errorCode: string | null;
};

export type CacheManifest = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  requestCount: number;
  bytesStored: number;
  cooldownUntil: Record<string, string>;
  units: Record<string, CacheUnit>;
  endpoints: Record<string, CacheEndpoint>;
};

export type CacheSummary = {
  units: number;
  endpoints: number;
  blobs: number;
  bytes: number;
  requests: number;
  byCompleteness: Partial<Record<CacheCompleteness, number>>;
};

export type CacheFetchOptions = {
  unit: CacheUnitIdentity;
  /** Optional deterministic test seam. Production should leave it undefined. */
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class CacheError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'cache_miss'
      | 'integrity_error'
      | 'cooldown'
      | 'request_limit'
      | 'cache_limit'
      | 'unsafe_url'
      | 'http_error'
      | 'invalid_json'
      | 'invalid_manifest',
    readonly status: number | null = null,
    readonly retryAfterUntil: string | null = null,
  ) {
    super(message);
    this.name = 'CacheError';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_QUERY_KEYS = new Set([
  'season',
  'page',
  'pageSize',
  'offset',
  'limit',
  'sort',
]);
const HTTP_ERROR_CODES = new Set([429, 503]);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeUrl(input: string, expectedHost = DEFAULT_FIE_HOST): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CacheError('Rejected malformed source URL', 'unsafe_url');
  }
  if (
    url.protocol !== 'https:' ||
    url.host !== expectedHost ||
    url.username !== '' || url.password !== '' ||
    !url.pathname.startsWith('/api/fie/')
  ) {
    throw new CacheError('Rejected URL outside the public FIE API', 'unsafe_url');
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new CacheError('Rejected URL with an unapproved query parameter', 'unsafe_url');
    }
  }
  url.hash = '';
  return url;
}

function endpointFor(url: URL): string {
  const query = [...url.searchParams.entries()]
    .sort(([ka, va], [kb, vb]) => ka.localeCompare(kb) || va.localeCompare(vb))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function recordKey(unitKey: string, endpoint: string): string {
  return `${unitKey}|${endpoint}`;
}

function emptyManifest(): CacheManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    requestCount: 0,
    bytesStored: 0,
    cooldownUntil: {},
    units: {},
    endpoints: {},
  };
}

function isCacheManifest(value: unknown): value is CacheManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<CacheManifest>;
  return (
    m.version === 1 &&
    typeof m.createdAt === 'string' &&
    typeof m.updatedAt === 'string' &&
    Number.isSafeInteger(m.requestCount) &&
    Number.isSafeInteger(m.bytesStored) &&
    !!m.cooldownUntil &&
    typeof m.cooldownUntil === 'object' &&
    !!m.units &&
    typeof m.units === 'object' &&
    !!m.endpoints &&
    typeof m.endpoints === 'object'
  );
}

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function jsonCompleteness(payload: unknown, url: URL): CacheCompleteness {
  if (payload === null || payload === undefined) return 'empty';
  if (typeof payload !== 'object') return 'complete';
  const value = payload as {
    totalFound?: unknown;
    items?: unknown;
    pools?: unknown;
    tableau?: unknown;
  };
  if (
    typeof value.totalFound === 'number' &&
    Array.isArray(value.items)
  ) {
    if (value.totalFound === 0) return 'empty';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? value.items.length);
    if (value.items.length === 0) return 'partial';
    return page * pageSize < value.totalFound || value.items.length < Math.min(pageSize, value.totalFound - (page - 1) * pageSize)
      ? 'partial' : 'complete';
  }
  if (Array.isArray(value.items) && value.items.length === 0) return 'empty';
  if (Array.isArray(value.pools)) return value.pools.length ? 'complete' : 'empty';
  if (Array.isArray(value.tableau)) return value.tableau.length ? 'complete' : 'empty';
  return 'complete';
}

/**
 * A pacing gate shared by all requests made through this cache instance.
 * Request starts are spaced, and active requests never exceed the configured
 * limit, even if the caller invokes fetches concurrently.
 */
class RequestGate {
  private active = 0;
  private lastStart = 0;
  private queue: Array<() => void> = [];
  private startChain: Promise<void> = Promise.resolve();
  private fetchStartChain: Promise<void> = Promise.resolve();
  private lastFetchStart = 0;

  constructor(
    private readonly maxInFlight: number,
    private readonly minStartIntervalMs: number,
  ) {}

  async run<T>(task: () => Promise<T>, now: () => number): Promise<T> {
    await this.acquire(now);
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  async startFetch<T>(task: () => Promise<T>, now: () => number): Promise<T> {
    let response!: Promise<T>;
    const turn = this.fetchStartChain.then(async () => {
      const waitMs = Math.max(0, this.lastFetchStart + this.minStartIntervalMs - now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.lastFetchStart = now();
      response = task();
      // Attach immediately so an early rejection cannot become unhandled.
      void response.catch(() => undefined);
    });
    this.fetchStartChain = turn.catch(() => undefined);
    await turn;
    return response;
  }

  private async acquire(now: () => number): Promise<void> {
    const turn = this.startChain.then(async () => {
      if (this.active >= this.maxInFlight) {
        await new Promise<void>((resolve) => this.queue.push(resolve));
      }
      const waitMs = Math.max(0, this.lastStart + this.minStartIntervalMs - now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.active += 1;
      this.lastStart = now();
    });
    this.startChain = turn.catch(() => undefined);
    await turn;
  }
}

export class CacheLocal {
  private readonly manifestPath: string;
  private readonly blobsPath: string;
  private readonly gate: RequestGate;
  private manifest: CacheManifest | null = null;
  private updateChain: Promise<void> = Promise.resolve();
  private reservedBytes = 0;

  constructor(
    readonly root: string,
    private readonly options: {
      maxBytes?: number;
      maxRequests?: number;
      maxInFlight?: number;
      minStartIntervalMs?: number;
      host?: string;
      /** Checked inside the pacing gate immediately before every live request. */
      beforeRequest?: () => Promise<void>;
      /** Recheck deadline after durable reservation, before actual dispatch. */
      beforeFetch?: () => Promise<void>;
      /** Additional response ceiling for an explicitly bounded download window. */
      maxResponseBytes?: number;
    } = {},
  ) {
    this.manifestPath = path.join(root, 'manifest.json');
    this.blobsPath = path.join(root, 'blobs');
    this.gate = new RequestGate(
      options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT,
      options.minStartIntervalMs ?? DEFAULT_MIN_START_INTERVAL_MS,
    );
  }

  async initialize(): Promise<void> {
    await mkdir(this.blobsPath, { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (!isCacheManifest(parsed)) {
        throw new CacheError('Cache manifest has an unsupported shape', 'invalid_manifest');
      }
      this.manifest = parsed;
      // Reconcile the byte count from unique immutable blobs, not from manifest
      // claims. This detects interrupted or manually altered local state.
      const diskBytes = await this.measureBlobs();
      if (diskBytes < parsed.bytesStored) {
        throw new CacheError('Stored cumulative byte count cannot decrease', 'integrity_error');
      }
      if (diskBytes !== parsed.bytesStored) {
        this.manifest.bytesStored = diskBytes;
        await this.persist();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.manifest = emptyManifest();
      await this.persist();
    }
  }

  async fetchJson<T>(input: string, options: CacheFetchOptions): Promise<T> {
    return this.fetchPayload<T>(input, options);
  }

  /** Exact public policy GET, under the same cumulative/pacing/storage gates. */
  async fetchRobotsPolicy(): Promise<string> {
    return this.fetchPayload<string>('https://fie.org/robots.txt', {
      unit: { key: 'fie|policy', season: 0, competitionId: null },
    }, true);
  }

  private async fetchPayload<T>(input: string, options: CacheFetchOptions, policy = false): Promise<T> {
    const url = policy ? new URL('https://fie.org/robots.txt') : safeUrl(input, this.options.host ?? DEFAULT_FIE_HOST);
    const parse = (body: Uint8Array, record: CacheEndpoint) => policy
      ? Promise.resolve(new TextDecoder().decode(body) as T) : this.parseJson<T>(body, record);
    const endpoint = endpointFor(url);
    const key = recordKey(options.unit.key, endpoint);
    let manifest = await this.currentManifest();
    const existing = manifest.endpoints[key];
    if (existing?.blobSha256) {
      const body = await this.readVerifiedBlob(existing.blobSha256);
      if (existing.status < 200 || existing.status >= 300) {
        throw new CacheError('Cached HTTP failure', 'http_error', existing.status, existing.retryAfterUntil);
      }
      return parse(body, existing);
    }
    if (existing) throw new CacheError('Cached endpoint failure; no automatic retry', 'http_error', existing.status || null, existing.retryAfterUntil);

    this.assertCooldown(manifest, url.hostname, options.now ?? Date.now);
    const maxRequests = this.options.maxRequests ?? DEFAULT_REQUEST_LIMIT;
    if (manifest.requestCount >= maxRequests) {
      throw new CacheError('FIE request limit reached', 'request_limit');
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    return this.gate.run(async () => {
      // Recheck after waiting in the gate; another concurrent caller may have
      // fetched this exact endpoint while this one was queued.
      manifest = await this.currentManifest();
      const cached = manifest.endpoints[key];
      if (cached?.blobSha256) {
        const body = await this.readVerifiedBlob(cached.blobSha256);
        if (cached.status < 200 || cached.status >= 300) {
          throw new CacheError('Cached HTTP failure', 'http_error', cached.status, cached.retryAfterUntil);
        }
        return parse(body, cached);
      }
      if (cached) throw new CacheError('Cached endpoint failure; no automatic retry', 'http_error', cached.status || null, cached.retryAfterUntil);
      this.assertCooldown(manifest, url.hostname, options.now ?? Date.now);
      await this.options.beforeRequest?.();
      await this.update(async (current) => {
        if (current.requestCount >= maxRequests) {
          throw new CacheError('FIE request limit reached', 'request_limit');
        }
        current.requestCount += 1;
        this.mergeUnit(current, options.unit, endpoint);
      });

      const now = options.now ?? Date.now;
      let response: Response;
      await this.options.beforeFetch?.();
      try {
        response = await this.gate.startFetch(() => fetchImpl(url.toString(), {
          headers: { Accept: policy ? 'text/plain' : 'application/json', 'User-Agent': 'CalendarioEsgrima/1.0 (authorized local historical cache)' },
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(40_000),
        }), now);
      } catch {
        await this.saveEvidence({
          key,
          unitKey: options.unit.key,
          endpoint,
          url: url.toString(),
          status: 0,
          fetchedAt: new Date(now()).toISOString(),
          contentType: null,
          retryAfterMs: null,
          retryAfterUntil: null,
          blobSha256: null,
          bytes: 0,
          completeness: 'http_error',
          errorCode: 'network_error',
        });
        throw new CacheError('FIE request failed before an HTTP response', 'http_error');
      }

      const fetchedAt = new Date(now()).toISOString();
      const status = response.status;
      const retryHeaderMs = retryAfterMs(response.headers.get('retry-after'), now());
      const retry = HTTP_ERROR_CODES.has(status) ? (retryHeaderMs ?? 60_000) : retryHeaderMs;
      const retryUntil = HTTP_ERROR_CODES.has(status)
        ? new Date(now() + retry!).toISOString()
        : null;
      const contentType = response.headers.get('content-type');
      if (retryUntil) {
        await this.update(async (current) => { current.cooldownUntil[url.hostname] = retryUntil; });
      }
      let bytes: Uint8Array;
      let digest: string;
      try {
        bytes = await this.readBoundedResponse(response, policy ? 1024 * 1024 : this.options.maxResponseBytes);
        digest = await this.writeBlobWithinLimit(bytes);
      } catch (error) {
        await this.saveEvidence({
          key, unitKey: options.unit.key, endpoint, url: url.toString(), status,
          fetchedAt, contentType, retryAfterMs: retry, retryAfterUntil: retryUntil,
          blobSha256: null, bytes: 0,
          completeness: error instanceof CacheError && error.code === 'cache_limit' ? 'storage_limit' : 'http_error',
          errorCode: error instanceof CacheError ? error.code : 'body_read_error',
        }, options.unit);
        if (error instanceof CacheError) throw error;
        if (error instanceof CacheLocalIoError) throw error;
        throw new CacheError('FIE response body could not be retained', 'http_error', status);
      }
      if (!response.ok) {
        const record: CacheEndpoint = {
          key,
          unitKey: options.unit.key,
          endpoint,
          url: url.toString(),
          status,
          fetchedAt,
          contentType,
          retryAfterMs: retry,
          retryAfterUntil: retryUntil,
          blobSha256: digest,
          bytes: bytes.byteLength,
          completeness: 'http_error',
          errorCode: `http_${status}`,
        };
        await this.saveEvidence(record);
        throw new CacheError(
          `FIE returned HTTP ${status}`,
          'http_error',
          status,
          retryUntil,
        );
      }

      let payload: unknown;
      try {
        payload = policy ? new TextDecoder().decode(bytes) : JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        const record: CacheEndpoint = {
          key,
          unitKey: options.unit.key,
          endpoint,
          url: url.toString(),
          status,
          fetchedAt,
          contentType,
          retryAfterMs: retry,
          retryAfterUntil: null,
          blobSha256: digest,
          bytes: bytes.byteLength,
          completeness: 'invalid_json',
          errorCode: 'invalid_json',
        };
        await this.saveEvidence(record);
        throw new CacheError('FIE returned invalid JSON', 'invalid_json', status);
      }

      const record: CacheEndpoint = {
        key,
        unitKey: options.unit.key,
        endpoint,
        url: url.toString(),
        status,
        fetchedAt,
        contentType,
        retryAfterMs: retry,
        retryAfterUntil: null,
        blobSha256: digest,
        bytes: bytes.byteLength,
        completeness: policy ? 'complete' : jsonCompleteness(payload, url),
        errorCode: null,
      };
      await this.saveEvidence(record, options.unit);
      return payload as T;
    }, options.now ?? Date.now);
  }

  /** Offline adapter for `DepsLecturaFie.fetchJson`; it never uses the network. */
  offlineFetchJson = async <T>(input: string): Promise<T> => {
    const url = safeUrl(input, this.options.host ?? DEFAULT_FIE_HOST);
    const endpoint = endpointFor(url);
    const manifest = await this.currentManifest();
    const matching = Object.values(manifest.endpoints).find(
      (record) => record.endpoint === endpoint,
    );
    if (!matching) throw new CacheError('Offline cache miss', 'cache_miss');
    if (!matching.blobSha256 || matching.status < 200 || matching.status >= 300) {
      throw new CacheError(
        `Cached endpoint is HTTP ${matching.status || 'unavailable'}`,
        matching.retryAfterUntil ? 'cooldown' : 'http_error',
        matching.status || null,
        matching.retryAfterUntil,
      );
    }
    if (matching.endpoint !== endpoint) {
      throw new CacheError('Offline endpoint key mismatch', 'integrity_error');
    }
    const body = await this.readVerifiedBlob(matching.blobSha256);
    return this.parseJson<T>(body, matching);
  };

  summary(): Promise<CacheSummary> {
    return this.currentManifest().then((manifest) => {
      const byCompleteness: CacheSummary['byCompleteness'] = {};
      for (const record of Object.values(manifest.endpoints)) {
        byCompleteness[record.completeness] =
          (byCompleteness[record.completeness] ?? 0) + 1;
      }
      return {
        units: Object.keys(manifest.units).length,
        endpoints: Object.keys(manifest.endpoints).length,
        blobs: new Set(
          Object.values(manifest.endpoints)
            .map((record) => record.blobSha256)
            .filter((hash): hash is string => !!hash),
        ).size,
        bytes: manifest.bytesStored,
        requests: manifest.requestCount,
        byCompleteness,
      };
    });
  }

  async readManifest(): Promise<CacheManifest> {
    return structuredClone(await this.currentManifest());
  }

  async retainMetadata(identity: CacheUnitIdentity): Promise<void> {
    await this.update(async (manifest) => {
      const previous = manifest.units[identity.key];
      if (previous) manifest.units[identity.key] = { ...previous, ...identity };
    });
  }

  private async readBoundedResponse(response: Response, responseLimit = Infinity): Promise<Uint8Array> {
    const maxBytes = this.options.maxBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
    const remaining = Math.min(responseLimit, maxBytes - (await this.currentManifest()).bytesStored - this.reservedBytes);
    const declared = Number(response.headers.get('content-length'));
    if (declared > responseLimit) {
      await response.body?.cancel();
      throw new CacheError('Response exceeds the bounded source payload ceiling', 'integrity_error');
    }
    if (declared > remaining) {
      await response.body?.cancel();
      throw new CacheError('Response exceeds remaining cache capacity', 'cache_limit');
    }
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > responseLimit) {
          await reader.cancel();
          throw new CacheError('Response exceeds the bounded source payload ceiling', 'integrity_error');
        }
        if (size > remaining) {
          await reader.cancel();
          throw new CacheError('Response exceeds remaining cache capacity', 'cache_limit');
        }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  }

  private async parseJson<T>(body: Uint8Array, record: CacheEndpoint): Promise<T> {
    try {
      return JSON.parse(new TextDecoder().decode(body)) as T;
    } catch {
      throw new CacheError(
        'Cached response is not valid JSON',
        'invalid_json',
        record.status,
      );
    }
  }

  private async readVerifiedBlob(hash: string): Promise<Uint8Array> {
    if (!SHA256.test(hash)) throw new CacheError('Invalid blob hash', 'integrity_error');
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path.join(this.blobsPath, hash.slice(0, 2), `${hash}.blob`)));
    } catch { throw new CacheError('Cached blob is missing or unreadable', 'integrity_error'); }
    if (sha256(bytes) !== hash) {
      throw new CacheError('Cached blob failed SHA-256 verification', 'integrity_error');
    }
    return bytes;
  }

  private async writeBlobWithinLimit(bytes: Uint8Array): Promise<string> {
    const digest = sha256(bytes);
    const directory = path.join(this.blobsPath, digest.slice(0, 2));
    const destination = path.join(directory, `${digest}.blob`);
    const alreadyStored = await cacheIo('blob_read', () => readFile(destination))
      .then((existing) => {
        if (sha256(existing) !== digest) {
          throw new CacheError('Existing content-addressed blob is corrupt', 'integrity_error');
        }
        return true;
      })
      .catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      });
    if (alreadyStored) return digest;

    const maxBytes = this.options.maxBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
    const manifest = await this.currentManifest();
    if (manifest.bytesStored + this.reservedBytes + bytes.byteLength > maxBytes) {
      throw new CacheError('Local cache byte limit reached', 'cache_limit');
    }
    this.reservedBytes += bytes.byteLength;
    const temp = path.join(directory, `.${digest}.${randomUUID()}.tmp`);
    try {
      await cacheIo('blob_mkdir', () => mkdir(directory, { recursive: true }));
      await cacheIo('blob_write', () => writeFile(temp, bytes, { flag: 'wx' }));
      // link() publishes a fully written file atomically and never replaces an
      // existing immutable blob, including in a concurrent cache writer.
      await cacheIo('blob_link', () => linkCacheBlob(temp, destination));
      await this.update(async (current) => { current.bytesStored += bytes.byteLength; });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = new Uint8Array(await cacheIo('blob_read', () => readFile(destination)));
      if (sha256(existing) !== digest) {
        throw new CacheError('Existing content-addressed blob is corrupt', 'integrity_error');
      }
    } finally {
      try { await cacheIo('blob_cleanup', () => rm(temp, { force: true })); }
      finally { this.reservedBytes -= bytes.byteLength; }
    }
    return digest;
  }

  private async saveEvidence(
    record: CacheEndpoint,
    identity?: CacheUnitIdentity,
  ): Promise<void> {
    await this.update(async (manifest) => {
      const previousUnit = manifest.units[record.unitKey];
      this.mergeUnit(
        manifest,
        identity ?? previousUnit ?? {
          key: record.unitKey,
          season: Number(record.endpoint.match(/season=(\d+)/)?.[1] ?? 0),
          competitionId: null,
        },
        record.endpoint,
      );
      manifest.endpoints[record.key] = record;
    });
  }

  private mergeUnit(
    manifest: CacheManifest,
    identity: CacheUnitIdentity,
    endpoint: string,
  ): void {
    const previous = manifest.units[identity.key];
    manifest.units[identity.key] = {
      key: identity.key,
      season: identity.season || previous?.season || 0,
      competitionId: identity.competitionId ?? previous?.competitionId ?? null,
      metadata: identity.metadata ?? previous?.metadata,
      importCompleteness: 'not_assessed',
      endpoints: [...new Set([...(previous?.endpoints ?? []), endpoint])].sort(),
    };
  }

  private async currentManifest(): Promise<CacheManifest> {
    if (!this.manifest) await this.initialize();
    return this.manifest!;
  }

  private async update(change: (manifest: CacheManifest) => Promise<void>): Promise<void> {
    const operation = this.updateChain.then(async () => {
      const manifest = await this.currentManifest();
      await change(manifest);
      manifest.updatedAt = new Date().toISOString();
      await this.persist();
    });
    this.updateChain = operation.catch(() => undefined);
    await operation;
  }

  private async persist(): Promise<void> {
    await writeAtomicCacheJson(this.manifestPath, this.manifest!);
  }

  private async measureBlobs(): Promise<number> {
    let total = 0;
    const prefixes = await readdir(this.blobsPath).catch(() => []);
    for (const prefix of prefixes) {
      const directory = path.join(this.blobsPath, prefix);
      for (const name of await readdir(directory)) {
        if (!SHA256.test(name.replace(/\.blob$/, '')) || !name.endsWith('.blob')) continue;
        total += (await stat(path.join(directory, name))).size;
      }
    }
    return total;
  }

  private assertCooldown(
    manifest: CacheManifest,
    host: string,
    now: () => number,
  ): void {
    const value = manifest.cooldownUntil[host];
    if (!value) return;
    const until = Date.parse(value);
    if (Number.isFinite(until) && until > now()) {
      throw new CacheError(
        'FIE host cooldown is active',
        'cooldown',
        null,
        value,
      );
    }
  }
}

/** Named adapter factory to pass directly to an existing `DepsLecturaFie`. */
export function createOfflineFetchJson(cache: CacheLocal): <T>(url: string) => Promise<T> {
  return cache.offlineFetchJson;
}
