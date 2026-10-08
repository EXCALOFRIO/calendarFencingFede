/**
 * Validated provider sessions, remembered for a few seconds inside one isolate.
 *
 * Every authenticated page used to ask the managed provider for the session
 * (one remote round trip before any rendering). Only the provider's answer is
 * remembered here; the D1 profile (invitation, revocation, role) is still read
 * on every request, so a revocation inside the application applies on the next
 * page load.
 *
 * Residual risk, accepted: a session revoked at the provider from ANOTHER
 * device (or expired early by the provider) keeps working in an isolate that
 * already validated it for at most `ttlMs`. Signing out through this
 * application evicts the entry immediately.
 *
 * Keys are HMACs of the session cookie, never the token. Failures and empty
 * sessions are never stored.
 */
export type SessionCache<T> = {
  /** Returns the cached value or runs `load` once per key, even when called concurrently. */
  read(key: string, load: () => Promise<{ value: T; expiresAt: number } | null>): Promise<T | null>;
  evict(key: string): void;
};

/** A load still in flight when its key is evicted must not store its result, however slow it is. */
const RETENER_DESALOJO_MS = 5 * 60_000;

export function createSessionCache<T>({
  ttlMs = 30_000,
  max = 1_000,
  now = () => Date.now(),
}: { ttlMs?: number; max?: number; now?: () => number } = {}): SessionCache<T> {
  const entries = new Map<string, { value: T; until: number }>();
  const loading = new Map<string, Promise<T | null>>();
  const evictedAt = new Map<string, number>();

  function store(key: string, value: T, until: number, t: number) {
    for (const [k, entry] of entries) if (entry.until <= t) entries.delete(k);
    while (entries.size >= max) entries.delete(entries.keys().next().value as string);
    entries.set(key, { value, until });
  }

  return {
    async read(key, load) {
      const started = now();
      const hit = entries.get(key);
      if (hit && hit.until > started) return hit.value;
      if (hit) entries.delete(key);
      const pending = loading.get(key);
      if (pending) return pending;

      const promise = load().then((result) => {
        if (!result) return null;
        const t = now();
        const until = Math.min(t + ttlMs, result.expiresAt);
        if (until > t && (evictedAt.get(key) ?? -Infinity) < started) store(key, result.value, until, t);
        return result.value;
      }).finally(() => {
        if (loading.get(key) === promise) loading.delete(key);
      });
      loading.set(key, promise);
      return promise;
    },
    evict(key) {
      const t = now();
      entries.delete(key);
      loading.delete(key);
      for (const [k, at] of evictedAt) if (at <= t - RETENER_DESALOJO_MS) evictedAt.delete(k);
      while (evictedAt.size >= max) evictedAt.delete(evictedAt.keys().next().value as string);
      evictedAt.set(key, t);
    },
  };
}
