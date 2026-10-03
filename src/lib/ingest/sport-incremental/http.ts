import { parsearRetryAfter } from '../http-retry';
import { IncrementoDetenido, LIMITES_INCREMENTO, PresupuestoIncremento, UnidadIncrementalDiferida } from './policy';

/** Public, allowlisted, no redirects/retries, bounded body, with shared timeout. */
export function redIncremento(budget: PresupuestoIncremento, transport: typeof fetch = fetch) {
  async function bytes(url: string, maxBytes = LIMITES_INCREMENTO.maxPdfBytes) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
      !['fie.org', 'app.skermo.org'].includes(u.hostname)) {
      throw new Error('sport_source_not_allowed');
    }
    const timeout = await budget.reservarPausado();
    let res: Response;
    try {
      res = await transport(url, { signal: AbortSignal.timeout(timeout), redirect: 'error', cache: 'no-store',
        headers: { 'User-Agent': 'CalendarioEsgrima/1.0 (+public-sport-incremental)' } });
    } catch {
      budget.remote = new IncrementoDetenido('fuente');
      throw budget.remote;
    }
    if (!res.ok) {
      budget.remote = new IncrementoDetenido(res.status === 429 ? 'limite_remoto' : 'fuente',
        parsearRetryAfter(res.headers.get('retry-after')));
      await res.body?.cancel();
      throw budget.remote;
    }
    if (!res.body) throw new UnidadIncrementalDiferida();
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.cancel();
      throw new UnidadIncrementalDiferida();
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        budget.comprobar();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) throw new UnidadIncrementalDiferida();
        chunks.push(value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      if (!(e instanceof IncrementoDetenido) && !(e instanceof UnidadIncrementalDiferida)) {
        budget.remote = new IncrementoDetenido('fuente');
        throw budget.remote;
      }
      throw e;
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { body.set(c, offset); offset += c.length; }
    return body;
  }
  return { bytes, html: async (url: string) => new TextDecoder().decode(await bytes(url)),
    json: async (url: string): Promise<unknown> => {
      const body = await bytes(url);
      try { return JSON.parse(new TextDecoder().decode(body)); }
      catch { throw new UnidadIncrementalDiferida(); }
    } };
}
