import { createHash } from 'node:crypto';
import { lstat, realpath, statfs, mkdtemp, chmod, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertRecordMatchesTable, rowHashUpdate, type ExportRecord } from './codec';
import type { ManifestTable } from './manifest';
import type { SqliteTable } from './schema';
import { COLUMN_POLICIES } from './schema';

const exec = promisify(execFile);
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const keyOf = (row: ExportRecord, table: SqliteTable) => table.primaryKey.map((name) => row[name]!);
export function compareKeys(a: (string | number | null)[], b: (string | number | null)[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (typeof x !== typeof y || x === null || y === null) throw new Error('primary_key_type_invalid');
    const result = typeof x === 'number' ? x - (y as number) : Buffer.compare(Buffer.from(x), Buffer.from(y as string));
    if (result) return result < 0 ? -1 : 1;
  }
  return 0;
}
export async function assertCapacity(directory: string, requiredBytes: number): Promise<void> {
  const disk = await statfs(directory);
  const available = Number(disk.bavail) * Number(disk.bsize);
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0 || available < requiredBytes + 512 * 1024 * 1024) {
    throw new Error('export_disk_capacity_insufficient');
  }
}
export async function createPrivateExportDirectory(workspace: string): Promise<string> {
  const root = await realpath(tmpdir());
  const repo = await realpath(workspace);
  const rel = relative(repo, root);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('export_temp_inside_workspace');
  await assertCapacity(root, 16 * 1024 * 1024);
  const directory = await mkdtemp(join(root, 'calendario-neon-d1-'));
  await chmod(directory, 0o700);
  if (process.platform === 'win32') {
    // Node permission bits alone do not protect private exports on Windows.
    const { stdout } = await exec('whoami.exe', [], { windowsHide: true });
    const user = stdout.trim();
    if (!user || /[\r\n]/.test(user)) throw new Error('export_acl_identity_invalid');
    try {
      await exec('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
    } catch { throw new Error('export_private_acl_failed'); }
  }
  return directory;
}
export async function* readExportRows(directory: string, entry: ManifestTable, table: SqliteTable): AsyncGenerator<ExportRecord> {
  const hash = createHash('sha256');
  let rows = 0, bytes = 0;
  let previous: ReturnType<typeof keyOf> | undefined;
  for (const chunk of entry.chunks) {
    const path = resolve(directory, chunk.file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== chunk.byteCount || info.size > 8 * 1024 * 1024) {
      throw new Error('export_chunk_file_invalid');
    }
    // A bounded immutable buffer closes the hash/read TOCTOU gap: never stream
    // rows from a second file read after accepting a different byte hash.
    const handle = await open(path, 'r');
    let contents: Buffer;
    try {
      const buffer = Buffer.alloc(chunk.byteCount + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size !== chunk.byteCount || bytesRead !== chunk.byteCount) throw new Error('export_chunk_file_invalid');
      contents = buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
    if (sha256(contents) !== chunk.sha256 || contents.length !== chunk.byteCount) throw new Error('export_chunk_hash_mismatch');
    if (contents.at(-1) !== 10) throw new Error('export_chunk_newline_missing');
    let chunkRows = 0, first: string | null = null, last: string | null = null;
    const lines = contents.toString('utf8').slice(0, -1).split('\n');
    for (const line of lines) {
      if (Buffer.byteLength(line) > 880 * 1024 || !line) throw new Error('export_row_size_invalid');
      let record: ExportRecord;
      try { record = JSON.parse(line); } catch { throw new Error('export_row_json_invalid'); }
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('export_row_invalid');
      assertRecordMatchesTable(record, table);
      for (const [field, value] of Object.entries(record)) {
        const policy = COLUMN_POLICIES[`${table.name}.${field}`];
        if ((policy === 'null' && value !== null) || (policy === 'zero' && value !== 0) ||
          (policy === 'rotate' && (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(value)))) throw new Error('export_credential_policy_violation');
      }
      const canonical = Object.fromEntries(table.columns.map((c) => [c.name, record[c.name]!]));
      if (JSON.stringify(canonical) !== line) throw new Error('export_row_not_canonical');
      const key = keyOf(record, table);
      if (previous && compareKeys(previous, key) >= 0) throw new Error('export_keys_not_ordered');
      previous = key;
      last = sha256(JSON.stringify(key)); first ??= last;
      bytes += rowHashUpdate(hash, canonical).length;
      rows++; chunkRows++;
      yield canonical;
    }
    if (chunkRows !== chunk.rowCount || first !== chunk.firstKeyHash || last !== chunk.lastKeyHash) {
      throw new Error('export_chunk_keys_mismatch');
    }
  }
  if (rows !== entry.rowCount || bytes !== entry.byteCount || hash.digest('hex') !== entry.sha256) {
    throw new Error('export_table_hash_mismatch');
  }
}

export function sanitizedError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/^[0-9A-Z]{5}$/.test(code)) return `source_sqlstate_${code}`;
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{2,100}$/.test(message) ? message : 'migration_operation_failed';
}
