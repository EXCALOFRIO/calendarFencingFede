import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { abrirD1Local, destinoD1Local } from '../src/lib/ingest/sport-incremental/local';
import { dbConSportLease, reclamarSportLease } from '../src/lib/ingest/sport-incremental/lease';
import { sportPerson } from '../src/db/schema';

const cleanups: (() => void)[] = [];
function file() {
  const dir = mkdtempSync(join(tmpdir(), 'd1-ingest-fixture-')), path = join(dir, 'local.sqlite');
  const sqlite = new DatabaseSync(path);
  sqlite.exec('BEGIN');
  sqlite.exec(readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle-d1/0005_presupuesto_8gib.sql', import.meta.url), 'utf8'));
  sqlite.exec('COMMIT');
  sqlite.close();
  cleanups.push(() => { unlinkSync(path); rmdirSync(dir); });
  return path;
}
afterEach(() => cleanups.splice(0).reverse().forEach((f) => f()));
describe('explicit local D1 CLI targets, no network or Neon', () => {
  it('rejects absent/repeated/relative/remote/Neon targets before any connection', () => {
    const path = file();
    for (const args of [[], ['--d1-local', 'relative.sqlite'], ['--d1-local', path, '--d1-local', path],
      ['--d1-local', path, '--remote'], ['--d1-local', path, '--plan-neon', 'free']]) {
      expect(() => destinoD1Local(args, true, {})).toThrow();
    }
    expect(() => destinoD1Local(['--d1-local', path], true, { DATABASE_URL: 'unused-fixture' })).toThrow('remove_database_url');
    expect(destinoD1Local(['--d1-local', path, '--aplicar'], true, {})).toMatchObject({ args: ['--aplicar'] });
  });
  it('opens a verified existing SQLite file read-only in simulation and atomically fences writes', async () => {
    const path = file(), readonly = abrirD1Local(path, false), writer = abrirD1Local(path, true);
    cleanups.push(readonly.close, writer.close);
    await expect(readonly.db.execute(sql`insert into sport_write_lease(key,owner,expires_at) values('global','fixture',0)`)).rejects.toThrow();
    const lease = await reclamarSportLease(writer.db);
    const owned = dbConSportLease(writer.db, lease!);
    await owned.insert(sportPerson).values({ displayName: 'Fixture', nameNormalized: 'fixture' });
    expect(await readonly.db.select().from(sportPerson)).toHaveLength(1);
    await expect(writer.db.insert(sportPerson).values({ displayName: 'Unfenced', nameNormalized: 'unfenced' })).rejects.toThrow();
    expect((await writer.db.execute(sql`select count(*) as n from sport_write_context`)).rows[0].n).toBe(0);
    await lease!.liberar();
  });
  it('runs the actual backfill simulation on a generated local fixture without changing one byte', () => {
    const path = file(), before = readFileSync(path);
    const output = execFileSync(process.execPath, [
      '--import', 'tsx', 'scripts/backfill.ts', '--d1-local', path, '--sin-descubrir',
    ], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, DATABASE_URL: 'unused-fixture', NODE_OPTIONS: '' } });
    expect(output).toContain('SIMULACIÓN');
    expect(output).toContain('no se ha escrito nada');
    expect(readFileSync(path).equals(before)).toBe(true);
  }, 25_000);
});
