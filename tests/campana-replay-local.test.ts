import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ejecutarReplayLocal, type ResumenReplayLocal } from '@/lib/ingest/backfill/replay-local';
import { ejecutarCampanaReplay, prepararCampanaReplay, type PlanCampanaReplay } from '@/lib/ingest/backfill/campana-replay-local';
import { hashArchivo } from '@/lib/ingest/archivo-r2';

vi.mock('@/lib/ingest/backfill/replay-local', async (original) => ({
  ...await original<typeof import('@/lib/ingest/backfill/replay-local')>(), ejecutarReplayLocal: vi.fn(),
}));
const roots: string[] = [];
async function cache(value: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'campana-replay-')); roots.push(root);
  const bytes = Buffer.from(JSON.stringify(value)); await writeFile(join(root, 'manifest.json'), bytes);
  return { root, hash: hashArchivo(bytes) };
}
const plan: PlanCampanaReplay = {
  cacheFie: 'C:\\synthetic', cacheFieSha256: 'a'.repeat(64),
  selecciones: Array.from({ length: 3 }, (_, i) => ({ tipo: 'fie', season: 2027, competitionId: i + 1 })),
};
const options = { aplicar: false, soloHechos: true, maxUnidades: 6000, maxMs: 1_800_000, maxSentencias: 500_000 };
function result(changes: Partial<ResumenReplayLocal> = {}): ResumenReplayLocal {
  return { modo: 'simulacion', seleccionadas: 1, leidas: 1, persistidas: 0,
    hechosLeidos: { puestos: 10, asaltos: 20 }, cobertura: {}, coberturaPersistida: {},
    incidencias: {}, sentenciasReservadas: 100, escrituraIncompletaPosible: false, detenido: false, ...changes };
}
const abrir = vi.fn(() => { throw new Error('mock_must_not_open_database'); });
beforeEach(() => { vi.mocked(ejecutarReplayLocal).mockReset().mockResolvedValue(result()); abrir.mockClear(); });
afterEach(async () => { expect(abrir).not.toHaveBeenCalled(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('immutable bounded offline campaign selection', () => {
  it('selects only cached FIE competition identities, pins source digest and orders official keys', async () => {
    const c = await cache({ version: 1, endpoints: {}, units: {
      index: { competitionId: null, season: 2027 },
      b: { competitionId: 2, season: 2027 }, a: { competitionId: 1, season: 2026 },
    } });
    expect(await prepararCampanaReplay('fie', c.root)).toEqual({
      cacheFie: c.root, cacheFieSha256: c.hash,
      selecciones: [{ tipo: 'fie', season: 2026, competitionId: 1 }, { tipo: 'fie', season: 2027, competitionId: 2 }],
    });
  });
  it('retains invalid source payloads as explicit deferred selections instead of hiding inventory gaps', async () => {
    const id = `pdf-${'b'.repeat(64)}`, c = await cache({ version: 1, unidades: [
      { tipo: 'pdf', id, estado: 'invalid_payload' }, { tipo: 'html', id: `html-${'c'.repeat(64)}`, estado: 'cached' },
    ] });
    const p = await prepararCampanaReplay('pdf', undefined, c.root);
    expect(p.selecciones).toEqual([{ tipo: 'pdf', id }]); expect(p.cacheNacionalSha256).toBe(c.hash);
  });
  it('rejects duplicate official competition identities, unbounded and unknown selections', async () => {
    const c = await cache({ version: 1, endpoints: {}, units: {
      a: { competitionId: 1, season: 2027 }, b: { competitionId: 1, season: 2027 },
    } });
    await expect(prepararCampanaReplay('fie', c.root)).rejects.toThrow('selection_limit');
    await expect(prepararCampanaReplay('unknown' as 'fie', c.root)).rejects.toThrow('arguments');
    await expect(prepararCampanaReplay('fie')).rejects.toThrow('cache_required');
  });
});
describe('finite campaign execution and honest partial outcomes', () => {
  it('preflights one unit at a time with original digest and durable callbacks', async () => {
    const checkpoint = vi.fn(async () => {});
    const r = await ejecutarCampanaReplay(plan, options, { abrir, checkpoint });
    expect(r).toMatchObject({ procesadas: 3, hechosLeidos: { puestos: 30, asaltos: 60 },
      sentenciasReservadas: 300, motivoParada: 'inventario_procesado' });
    expect(ejecutarReplayLocal).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ejecutarReplayLocal).mock.calls[0][0]).toMatchObject({
      selecciones: [plan.selecciones[0]], maxUnidades: 1, soloHechos: true, cacheFieSha256: plan.cacheFieSha256,
    });
    expect(checkpoint).toHaveBeenCalledTimes(3);
  });
  it('does not reset the cumulative statement budget at unit boundaries', async () => {
    vi.mocked(ejecutarReplayLocal).mockResolvedValue(result({ sentenciasReservadas: 1000 }));
    const r = await ejecutarCampanaReplay(plan, { ...options, maxSentencias: 1000 }, { abrir });
    expect(r).toMatchObject({ procesadas: 1, sentenciasReservadas: 1000, motivoParada: 'limite_sentencias' });
  });
  it('uses one original deadline and stops before opening another unit', async () => {
    let calls = 0;
    const r = await ejecutarCampanaReplay(plan, options, { abrir, ahora: () => ++calls < 3 ? 0 : 1_800_001 });
    expect(r).toMatchObject({ procesadas: 1, motivoParada: 'limite_tiempo' });
  });
  it('continues source-level review cases, but never automatically retries a stopped writer', async () => {
    vi.mocked(ejecutarReplayLocal).mockResolvedValueOnce(result({ incidencias: { source_partial: 1 } }))
      .mockResolvedValueOnce(result({ detenido: true, escrituraIncompletaPosible: true, incidencias: { capacity: 1 } }));
    const r = await ejecutarCampanaReplay(plan, options, { abrir });
    expect(r).toMatchObject({ procesadas: 2, motivoParada: 'replay_detenido', escrituraIncompletaPosible: true,
      incidencias: { source_partial: 1, capacity: 1 } });
    expect(ejecutarReplayLocal).toHaveBeenCalledTimes(2);
  });
  it('uses an explicit offset and finite count, never silently claims the entire inventory', async () => {
    const r = await ejecutarCampanaReplay(plan, { ...options, offset: 1, maxUnidades: 1 }, { abrir });
    expect(r).toMatchObject({ seleccionadas: 1, procesadas: 1, motivoParada: 'limite_unidades' });
    expect(vi.mocked(ejecutarReplayLocal).mock.calls[0][0].selecciones).toEqual([plan.selecciones[1]]);
  });
  it.each([
    { maxUnidades: 6001 }, { maxMs: 1_800_001 }, { maxSentencias: 500_001 },
    { maxUnidades: 0 }, { maxMs: Number.NaN }, { offset: -1 }, { offset: 3 },
  ])('rejects invalid budget %# without any replay', async (override) => {
    await expect(ejecutarCampanaReplay(plan, { ...options, ...override }, { abrir })).rejects.toThrow('arguments');
    expect(ejecutarReplayLocal).not.toHaveBeenCalled();
  });
});
