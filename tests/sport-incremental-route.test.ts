import { afterEach, describe, expect, it, vi } from 'vitest';

const run = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 'deshabilitado', tasks: 0, requests: 0, facts: 0 })));
vi.mock('@/lib/ingest/sport-incremental/runtime', () => ({ runSportIncremental: run }));
import { GET, maxDuration } from '@/app/api/cron/sport/route';
afterEach(() => { vi.unstubAllEnvs(); run.mockClear(); });
describe('dedicated fail-closed sport cron route', () => {
  it('never allows a missing secret, even locally', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const r = await GET(new Request('https://example.test/api/cron/sport'));
    expect(r.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects absent/wrong authorization without calling ingestion', async () => {
    vi.stubEnv('CRON_SECRET', 'fake-test-secret');
    const r = await GET(new Request('https://example.test/api/cron/sport', { headers: { authorization: 'Bearer wrong' } }));
    expect(r.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it('returns only the aggregate outcome and has a 50 second runtime ceiling', async () => {
    vi.stubEnv('CRON_SECRET', 'fake-test-secret');
    const r = await GET(new Request('https://example.test/api/cron/sport', {
      headers: { authorization: 'Bearer fake-test-secret' },
    }));
    expect(await r.json()).toEqual({ ok: true, status: 'deshabilitado', tasks: 0, requests: 0, facts: 0 });
    expect(run).toHaveBeenCalledOnce();
    expect(maxDuration).toBe(50);
  });
});
