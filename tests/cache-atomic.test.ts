import { describe, expect, it, vi } from 'vitest';
import { renameCacheCheckpoint, linkCacheBlob, cacheIo, CacheLocalIoError } from '@/lib/ingest/backfill/cache-atomic';

describe('checkpoint replacement under Windows sharing locks', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries only local rename after %s', async (code) => {
    const busy = Object.assign(new Error('synthetic sharing lock'), { code });
    const rename = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue(undefined);
    const wait = vi.fn(async (_milliseconds: number) => {});
    await renameCacheCheckpoint('C:\\synthetic\\checkpoint.tmp', 'C:\\synthetic\\checkpoint.json', { rename, wait });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[50], [100]]);
    expect(rename.mock.calls.every((args) =>
      args[0] === 'C:\\synthetic\\checkpoint.tmp' && args[1] === 'C:\\synthetic\\checkpoint.json')).toBe(true);
  });

  it('recovers from a sharing lock longer than the old 300ms retry budget', async () => {
    const busy = Object.assign(new Error('synthetic sharing lock'), { code: 'EPERM' });
    const rename = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue(undefined);
    const wait = vi.fn(async (_milliseconds: number) => {});
    await renameCacheCheckpoint('C:\\synthetic\\checkpoint.tmp', 'C:\\synthetic\\checkpoint.json', { rename, wait });
    expect(wait.mock.calls.flat()).toEqual([50, 100, 200, 400]);
  });

  it('fails closed after a finite retry budget without replacing/deleting the old checkpoint', async () => {
    const busy = Object.assign(new Error('synthetic permanent lock'), { code: 'EPERM' });
    const rename = vi.fn().mockRejectedValue(busy);
    const wait = vi.fn(async (_milliseconds: number) => {});
    await expect(renameCacheCheckpoint('C:\\synthetic\\checkpoint.tmp', 'C:\\synthetic\\checkpoint.json',
      { rename, wait })).rejects.toBe(busy);
    expect(rename).toHaveBeenCalledTimes(9);
    expect(wait.mock.calls.flat().reduce((sum: number, ms: number) => sum + ms, 0)).toBe(4550);
  });

  it.each(['ENOSPC', 'ENOENT', 'EIO'])('does not retry non-sharing error %s', async (code) => {
    const failure = Object.assign(new Error('synthetic storage failure'), { code });
    const rename = vi.fn().mockRejectedValue(failure);
    const wait = vi.fn(async (_milliseconds: number) => {});
    await expect(renameCacheCheckpoint('C:\\synthetic\\checkpoint.tmp', 'C:\\synthetic\\checkpoint.json',
      { rename, wait })).rejects.toBe(failure);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('atomic immutable blob publication diagnostics', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a local link after %s without a new source request', async (code) => {
    const busy = Object.assign(new Error('synthetic sharing lock'), { code });
    const link = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue(undefined);
    const wait = vi.fn(async (_milliseconds: number) => {});
    await linkCacheBlob('C:\\synthetic\\blob.tmp', 'C:\\synthetic\\blob.blob', { link, wait });
    expect(link).toHaveBeenCalledTimes(3); expect(wait.mock.calls).toEqual([[50], [100]]);
  });
  it('keeps collision handling and permanent storage failures outside the retry loop', async () => {
    for (const code of ['EEXIST', 'ENOSPC', 'EIO']) {
      const error = Object.assign(new Error('synthetic failure'), { code });
      const link = vi.fn().mockRejectedValue(error), wait = vi.fn(async (_milliseconds: number) => {});
      await expect(linkCacheBlob('C:\\synthetic\\blob.tmp', 'C:\\synthetic\\blob.blob', { link, wait })).rejects.toBe(error);
      expect(link).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
    }
  });
  it('stops a permanent link lock after nine local attempts and 4.55 seconds', async () => {
    const error = Object.assign(new Error('synthetic lock'), { code: 'EPERM' });
    const link = vi.fn().mockRejectedValue(error), wait = vi.fn(async (_milliseconds: number) => {});
    await expect(linkCacheBlob('C:\\synthetic\\blob.tmp', 'C:\\synthetic\\blob.blob', { link, wait })).rejects.toBe(error);
    expect(link).toHaveBeenCalledTimes(9);
    expect(wait.mock.calls.flat().reduce((sum, n) => sum + n, 0)).toBe(4550);
  });
  it('reports only the operation and errno, never private error contents', async () => {
    const raw = Object.assign(new Error('PRIVATE PATH /fixture/token?secret=PRIVATE'), { code: 'EPERM', path: 'PRIVATE' });
    const error = await cacheIo('checkpoint_rename', async () => { throw raw; }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CacheLocalIoError);
    expect(error).toMatchObject({ operation: 'checkpoint_rename', code: 'EPERM', message: 'cache_local_io_failed' });
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(await cacheIo('blob_link', async () => 42)).toBe(42);
  });
});
