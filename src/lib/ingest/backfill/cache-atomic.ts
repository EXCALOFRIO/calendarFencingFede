import { randomUUID } from 'node:crypto';
import { open, rename, rm, link } from 'node:fs/promises';

export type CacheIoOperation =
  | 'checkpoint_open' | 'checkpoint_write' | 'checkpoint_sync' | 'checkpoint_close'
  | 'checkpoint_rename' | 'checkpoint_cleanup'
  | 'blob_read' | 'blob_mkdir' | 'blob_write' | 'blob_link' | 'blob_cleanup';
export class CacheLocalIoError extends Error {
  readonly code: string;
  constructor(readonly operation: CacheIoOperation, error: unknown) {
    super('cache_local_io_failed');
    const code = (error as NodeJS.ErrnoException | null)?.code;
    this.code = typeof code === 'string' && /^[A-Z_]{2,32}$/.test(code) ? code : 'UNCLASSIFIED';
  }
}
/** Preserve only a whitelisted stage and errno, never a caught path/body/message. */
export async function cacheIo<T>(operation: CacheIoOperation, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof CacheLocalIoError) throw error;
    throw new CacheLocalIoError(operation, error);
  }
}

type RenameDependencies = {
  rename: typeof rename;
  wait: (milliseconds: number) => Promise<void>;
};
const RENAME_DELAYS_MS = [50, 100, 200, 400, 800, 1000, 1000, 1000] as const;

/** Windows sharing locks can outlast 300ms. Retry only the LOCAL rename,
 * for at most 4.55s. Never repeat a GET or delete the previous checkpoint.
 */
export async function renameCacheCheckpoint(
  temporary: string,
  destination: string,
  dependencies: RenameDependencies = {
    rename,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await dependencies.rename(temporary, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= RENAME_DELAYS_MS.length) {
        throw error;
      }
      await dependencies.wait(RENAME_DELAYS_MS[attempt]);
    }
  }
}

/** Atomic, no-clobber blob publication. Only the local link may be retried. */
export async function linkCacheBlob(
  temporary: string, destination: string,
  dependencies: { link: typeof link; wait: (milliseconds: number) => Promise<void> } = {
    link, wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await dependencies.link(temporary, destination); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= RENAME_DELAYS_MS.length) throw error;
      await dependencies.wait(RENAME_DELAYS_MS[attempt]);
    }
  }
}

export async function writeAtomicCacheJson(destination: string, value: unknown): Promise<void> {
  const temp = `${destination}.${randomUUID()}.tmp`;
  const handle = await cacheIo('checkpoint_open', () => open(temp, 'wx'));
  try {
    await cacheIo('checkpoint_write', () => handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
    await cacheIo('checkpoint_sync', () => handle.sync());
  } finally {
    await cacheIo('checkpoint_close', () => handle.close());
  }
  try {
    await cacheIo('checkpoint_rename', () => renameCacheCheckpoint(temp, destination));
  } finally {
    await cacheIo('checkpoint_cleanup', () => rm(temp, { force: true }));
  }
}
