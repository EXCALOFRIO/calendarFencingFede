import { createHash } from 'node:crypto';
import { lstat, realpath, open, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, parse } from 'node:path';

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export function contained(root: string, file: string): string {
  const path = resolve(root, file), rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('factory_path_invalid');
  }
  return path;
}
export async function noLinks(path: string): Promise<void> {
  if (!isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('factory_path_invalid');
  let current = resolve(path);
  for (;;) {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('factory_path_invalid');
    if (current === parse(current).root) break;
    current = dirname(current);
  }
  if (await realpath(path) !== resolve(path)) throw new Error('factory_path_invalid');
}
export async function readBounded(path: string, max: number): Promise<Buffer> {
  await noLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.size > max) throw new Error('factory_file_invalid');
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) {
      throw new Error('factory_file_invalid');
    }
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== before.size || (await handle.stat()).size !== before.size) throw new Error('factory_file_changed');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
/** No overwrite, including locks, plans, starts, outputs and receipts. */
export async function writeNew(path: string, data: string | Uint8Array): Promise<void> {
  await noLinks(dirname(path));
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
export async function newDirectory(root: string, name: string): Promise<string> {
  const path = contained(root, name);
  await noLinks(root);
  await mkdir(path, { mode: 0o700 });
  return path;
}
export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export const jobDirectory = (root: string, id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('factory_job_id_invalid');
  return join(root, 'jobs', id);
};
