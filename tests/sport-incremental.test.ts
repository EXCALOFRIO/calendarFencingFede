import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ejecutarIncremento, type DepsIncremento } from '@/lib/ingest/sport-incremental/runner';
import { DAY, esFutura, IncrementoDetenido, intervaloRevision, LIMITES_INCREMENTO,
  PresupuestoIncremento, temporadasActuales, UnidadIncrementalDiferida, type Task } from '@/lib/ingest/sport-incremental/policy';
import { redIncremento } from '@/lib/ingest/sport-incremental/http';
import { cargarMigracionesLocales } from '@/lib/db/migracion-aditiva';
import { preflightIncremento } from '@/lib/ingest/sport-incremental/migration';

const now = new Date('2026-10-03T08:15:00Z');
const task = (kind: Task['kind'] = 'fie_result', payload: Task['payload'] = { date: '2026-10-02' }): Task =>
  ({ key: `${kind}|2027|1`, season: '2027', kind, payload });
function deps() {
  const release = vi.fn(async () => {});
  const d: DepsIncremento = {
    claim: vi.fn(async () => ({ release })),
    capacity: vi.fn(async () => true),
    seed: vi.fn(async () => {}),
    due: vi.fn(async () => [task(), task('fie_standing')]),
    execute: vi.fn(async () => ({ status: 'completo', facts: 10 })),
    finish: vi.fn(async () => {}),
    cooldown: vi.fn(async () => {}),
    now: () => now,
  };
  return { d, release };
}
afterEach(() => vi.restoreAllMocks());

describe('bounded sport maintenance', () => {
  it('is default-off without DB, leases or any source reads', async () => {
    const { d } = deps();
    expect(await ejecutarIncremento(false, d)).toEqual({ ok: true, status: 'deshabilitado', tasks: 0, requests: 0, facts: 0 });
    expect(d.claim).not.toHaveBeenCalled();
  });
  it('does nothing when another global writer owns the lease', async () => {
    const { d } = deps();
    d.claim = vi.fn(async () => null);
    expect((await ejecutarIncremento(true, d)).status).toBe('ocupado');
    expect(d.capacity).not.toHaveBeenCalled();
    expect(d.execute).not.toHaveBeenCalled();
  });
  it('fails closed before seeds/HTTP when capacity cannot authorize', async () => {
    const { d, release } = deps();
    d.capacity = vi.fn(async () => false);
    expect((await ejecutarIncremento(true, d)).status).toBe('capacidad');
    expect(d.seed).not.toHaveBeenCalled();
    expect(d.execute).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
  it('runs no more than two tasks even if storage supplies a longer list', async () => {
    const { d, release } = deps();
    d.due = vi.fn(async () => Array.from({ length: 20 }, () => task()));
    const r = await ejecutarIncremento(true, d);
    expect(r).toEqual({ ok: true, status: 'ok', tasks: 2, requests: 0, facts: 20 });
    expect(d.seed).toHaveBeenCalledWith({ fie: '2027', rfee: '2026-2027' });
    expect(d.due).toHaveBeenCalledWith({ fie: '2027', rfee: '2026-2027' }, 2);
    expect(d.execute).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledOnce();
  });
  it('keeps upcoming events pending with zero source requests', async () => {
    const { d } = deps();
    d.due = vi.fn(async () => [task('fie_result', { date: '2026-11-01' })]);
    await ejecutarIncremento(true, d);
    expect(d.execute).not.toHaveBeenCalled();
    expect(d.finish).toHaveBeenCalledWith(expect.anything(), { status: 'pendiente', facts: 0 },
      new Date(now.getTime() + DAY));
  });
  it('revisits complete AND empty source checkpoints, never treating them as permanent', async () => {
    for (const status of ['completo', 'sin_resultados']) {
      expect(intervaloRevision(task(), { status, facts: 0 }, now)).toBe(DAY);
      expect(intervaloRevision(task('fie_result', { date: '2026-09-01' }), { status, facts: 0 }, now)).toBe(7 * DAY);
      expect(intervaloRevision(task('fie_standing'), { status, facts: 0 }, now)).toBe(DAY);
    }
  });
  it('respects Retry-After even when a reader swallowed the HTTP exception', async () => {
    const { d, release } = deps();
    const budget = new PresupuestoIncremento();
    d.execute = vi.fn(async () => {
      budget.remote = new IncrementoDetenido('limite_remoto', 120_000);
      return { status: 'sin_resultados', facts: 0 };
    });
    expect((await ejecutarIncremento(true, d, budget)).status).toBe('limite_remoto');
    expect(d.finish).not.toHaveBeenCalled();
    expect(d.cooldown).toHaveBeenCalledWith(new Date(now.getTime() + 120_000));
    expect(release).toHaveBeenCalledOnce();
  });
  it('defers oversized/unreadable units without starving the rest of the queue', async () => {
    const { d } = deps();
    d.execute = vi.fn(async () => { throw new UnidadIncrementalDiferida(); });
    expect((await ejecutarIncremento(true, d)).tasks).toBe(2);
    expect(d.finish).toHaveBeenCalledTimes(2);
    expect(d.cooldown).not.toHaveBeenCalled();
  });
  it('does not persist a reader error when the ninth HTTP reservation was swallowed', async () => {
    const { d } = deps();
    const budget = new PresupuestoIncremento();
    d.execute = vi.fn(async () => {
      for (let i = 0; i < 8; i++) budget.reservar();
      try { budget.reservar(); } catch { /* existing safe readers return an error result */ }
      return { status: 'error', facts: 0 };
    });
    expect((await ejecutarIncremento(true, d, budget)).status).toBe('peticiones');
    expect(d.finish).not.toHaveBeenCalled();
    expect(d.cooldown).not.toHaveBeenCalled();
  });
  it('does not disguise unknown DB/config failure as successful empty results or expose errors', async () => {
    const { d, release } = deps();
    d.execute = vi.fn(async () => { throw new Error('password=do-not-expose person=do-not-expose'); });
    const r = await ejecutarIncremento(true, d);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('configuracion_o_db');
    expect(JSON.stringify(r)).not.toContain('do-not-expose');
    expect(d.finish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
  it('checks the clock after reading, before declaring/persisting success', async () => {
    const { d } = deps();
    let clock = 0;
    const budget = new PresupuestoIncremento(() => clock);
    d.execute = vi.fn(async () => {
      clock = LIMITES_INCREMENTO.maxMs;
      return { status: 'completo', facts: 1 };
    });
    expect((await ejecutarIncremento(true, d, budget)).status).toBe('tiempo');
    expect(d.finish).not.toHaveBeenCalled();
  });
  it('makes failure to release visible without force-deleting another owner', async () => {
    const { d, release } = deps();
    release.mockRejectedValueOnce(new Error('lost DB response'));
    expect((await ejecutarIncremento(true, d)).ok).toBe(false);
  });
});

describe('shared source budgets', () => {
  it('permits eight GETs and reserves nothing for a ninth request', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ value: 1 }));
    const budget = new PresupuestoIncremento();
    const red = redIncremento(budget, transport);
    for (let i = 0; i < 8; i++) await red.json('https://fie.org/api/fie/competitions');
    await expect(red.json('https://fie.org/api/fie/competitions')).rejects.toMatchObject({ reason: 'peticiones' });
    expect(transport).toHaveBeenCalledTimes(8);
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });
  it('propagates Retry-After without sleeping or retrying', async () => {
    const transport = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '180' } }));
    const budget = new PresupuestoIncremento();
    await expect(redIncremento(budget, transport).html('https://app.skermo.org/calendar/public/RFEE/results'))
      .rejects.toMatchObject({ reason: 'limite_remoto', retryAfterMs: 180_000 });
    expect(transport).toHaveBeenCalledOnce();
    expect(budget.remote?.reason).toBe('limite_remoto');
  });
  it('rejects outside hosts and non-HTTPS before reserving any HTTP', async () => {
    const transport = vi.fn();
    const budget = new PresupuestoIncremento();
    for (const url of ['http://fie.org/api', 'https://evil.invalid/p.pdf', 'https://app.skermo.org.evil.invalid/p.pdf']) {
      await expect(redIncremento(budget, transport).bytes(url)).rejects.toThrow();
    }
    expect(transport).not.toHaveBeenCalled();
    expect(budget.requests).toBe(0);
  });
  it('caps declared and streamed response sizes', async () => {
    const budget = new PresupuestoIncremento();
    const red = redIncremento(budget, vi.fn(async () => new Response('12345')));
    await expect(red.bytes('https://app.skermo.org/client/p.pdf', 4)).rejects.toBeInstanceOf(UnidadIncrementalDiferida);
    const declared = redIncremento(budget, vi.fn(async () => new Response('1', { headers: { 'content-length': '99' } })));
    await expect(declared.bytes('https://app.skermo.org/client/p.pdf', 4)).rejects.toBeInstanceOf(UnidadIncrementalDiferida);
  });
});

describe('season and migration provenance', () => {
  it('rolls seasons on UTC September 1 and never imports every historical season', () => {
    expect(temporadasActuales(new Date('2026-08-31T23:59:59Z'))).toEqual({ fie: '2026', rfee: '2025-2026' });
    expect(temporadasActuales(new Date('2026-09-01T00:00:00Z'))).toEqual({ fie: '2027', rfee: '2026-2027' });
    expect(esFutura(task('fie_result', { date: '2026-10-03' }), now)).toBe(false);
  });
  it('requires a complete exact ledger through 0020 and no partial 0021 schema', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    const locals = cargarMigracionesLocales(journal, (tag) => readFileSync(`drizzle/${tag}.sql`, 'utf8'));
    const ledger = locals.slice(0, -1).map((m) => ({ hash: m.hash, created_at: m.when }));
    expect(preflightIncremento(locals, ledger, false)).toBe(true);
    expect(preflightIncremento(locals, ledger, true)).toBe(false);
    expect(preflightIncremento(locals, ledger.slice(0, -1), false)).toBe(false);
    expect(preflightIncremento(locals, [...ledger, { hash: 'unexpected', created_at: 1 }], false)).toBe(false);
    expect(preflightIncremento(locals, ledger.map((e) => ({ ...e, hash: 'bad' })), false)).toBe(false);
    const source = readFileSync('scripts/aplicar-migracion-incremento.ts', 'utf8');
    expect(source).toContain('process.exitCode = 2');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain('query.transaction');
    expect(source).not.toContain('target.sentencias');
    expect(source).not.toContain('console.error(error');
  });
  it.each([{ args: [] }, { args: ['--aplicar', '--writers-stopped'] }])('cannot enable the retired Neon 0021 writer with $args', ({ args }) => {
    const workspace = fileURLToPath(new URL('..', import.meta.url));
    const script = fileURLToPath(new URL('../scripts/aplicar-migracion-incremento.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: workspace, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, DATABASE_URL: 'postgresql://fixture:PRIVATE_CREDENTIAL@invalid.invalid/fixture' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no se aplica 0021 a Neon');
    expect(result.stderr).not.toContain('PRIVATE_CREDENTIAL');
  });
  it('retires generic PostgreSQL writers and removes credentials from the offline Drizzle config', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const command of ['db:migrate', 'db:push', 'db:studio']) {
      expect(pkg.scripts[command]).toBe('tsx scripts/db-postgres-retirado.ts');
    }
    const source = readFileSync('scripts/db-postgres-retirado.ts', 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).toContain('process.exitCode = 2');
    const config = readFileSync('drizzle.config.ts', 'utf8');
    expect(config).not.toContain('dbCredentials');
    expect(config).not.toContain('DATABASE_URL');
    expect(config).not.toContain('dotenv');
  });
  it('keeps observed dates explicit and the import gate additive and DB-enforced', () => {
    const ddl = readFileSync('drizzle/0021_incremento_deportivo.sql', 'utf8');
    expect(ddl).toContain('"date_basis" text NOT NULL DEFAULT \'observed\'');
    expect(ddl).toContain('FOR UPDATE');
    expect(ddl).toContain("current_setting('app.sport_write_owner', true)");
    expect(ddl).toContain('held.expires_at <= clock_timestamp()');
    expect(ddl).toContain("USING ERRCODE = '55000'");
    expect(ddl).toContain('BEFORE INSERT OR UPDATE OR DELETE');
    expect(ddl).not.toMatch(/\b(DROP|TRUNCATE)\b/);
  });
});
