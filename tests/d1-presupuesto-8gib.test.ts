import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { CAPACITY_DEFINITIONS, CAPACITY_MAX_BUDGET_BYTES } from '@/lib/ingest/sport-incremental/capacity';
import { verificarEsquemaD1 } from '@/lib/ingest/sport-incremental/schema';

const MIGRACION = (n: string) => readFileSync(new URL(`../drizzle-d1/${n}`, import.meta.url), 'utf8');
const SQL0002 = MIGRACION('0002_guardia_deportiva.sql');
const SQL0005 = MIGRACION('0005_presupuesto_8gib.sql');
const REHECHOS = ['sport_write_context', 'sport_write_authorized', 'sport_context_claim',
  'sport_context_reserve', 'sport_context_close', 'sport_context_immutable'] as const;
const AHORA = "(cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))";
const LEDGER_PRODUCCION = 3_658_565_984;

const cierres: (() => void)[] = [];
afterEach(() => { while (cierres.length) cierres.pop()!(); });

function base() {
  const local = localD1();
  cierres.push(local.close);
  local.sqlite.exec(SQL0002);
  return { ...local, db: createD1Database(local.binding) };
}
/** wrangler aplica cada migración como una unidad atómica. */
function aplicar0005(sqlite: ReturnType<typeof localD1>['sqlite']) {
  sqlite.exec('BEGIN');
  try { sqlite.exec(SQL0005); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
}
function fijarLedger(sqlite: ReturnType<typeof localD1>['sqlite'], bytes: number) {
  sqlite.exec('DROP TRIGGER sport_ledger_update');
  sqlite.exec(`UPDATE sport_capacity_ledger SET accounted_bytes=${bytes} WHERE key='global'`);
  sqlite.exec(CAPACITY_DEFINITIONS.sport_ledger_update);
}
const ledger = (sqlite: ReturnType<typeof localD1>['sqlite']) =>
  sqlite.prepare("SELECT accounted_bytes AS a, blocked AS b FROM sport_capacity_ledger WHERE key='global'").get();
function contexto(sqlite: ReturnType<typeof localD1>['sqlite'], presupuesto: number, proyectado: number) {
  sqlite.exec(`INSERT INTO sport_write_lease(key,owner,expires_at,lease_version) VALUES('global','w',${AHORA}+60000,1)
    ON CONFLICT(key) DO UPDATE SET owner='w', expires_at=excluded.expires_at, lease_version=sport_write_lease.lease_version+1`);
  sqlite.exec(`INSERT INTO sport_write_context(key,owner,lease_version,budget_bytes,projected_bytes,measured_bytes)
    SELECT 'global',owner,lease_version,${presupuesto},${proyectado},1 FROM sport_write_lease WHERE key='global'`);
}

describe('0005: asignación D1 de 8 GiB', () => {
  it('deja exactamente las definiciones vigentes y el verificador estricto las acepta', async () => {
    const f = base();
    await expect(verificarEsquemaD1(f.db)).rejects.toThrow('sport_migration_required');
    aplicar0005(f.sqlite);
    for (const nombre of REHECHOS) {
      const fila = f.sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(nombre) as { sql: string };
      expect(fila.sql).toBe(CAPACITY_DEFINITIONS[nombre]);
    }
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='_guardia_0005'").get()).toEqual({ n: 0 });
    expect(CAPACITY_MAX_BUDGET_BYTES).toBe(8589934592);
    await expect(verificarEsquemaD1(f.db)).resolves.toEqual({ identidad: true, referencias: true });
  });

  it('conserva el ledger y admite contextos que superan 4 GiB pero no 8 GiB', () => {
    const f = base();
    fijarLedger(f.sqlite, LEDGER_PRODUCCION);
    aplicar0005(f.sqlite);
    expect(ledger(f.sqlite)).toEqual({ a: LEDGER_PRODUCCION, b: 0 });
    const cabe = 2 * 1024 ** 3;
    expect(LEDGER_PRODUCCION + cabe).toBeGreaterThan(4 * 1024 ** 3);
    contexto(f.sqlite, CAPACITY_MAX_BUDGET_BYTES, cabe);
    f.sqlite.exec("DELETE FROM sport_write_context WHERE key='global'");
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM sport_write_charge').get()).toEqual({ n: 0 });
    const tras = Number((ledger(f.sqlite) as { a: number }).a);
    expect(tras).toBe(LEDGER_PRODUCCION + 16_384);
    expect(() => contexto(f.sqlite, CAPACITY_MAX_BUDGET_BYTES, CAPACITY_MAX_BUDGET_BYTES - tras)).toThrow('sport_capacity');
    expect(() => contexto(f.sqlite, CAPACITY_MAX_BUDGET_BYTES + 1, 16_384)).toThrow('CHECK constraint failed');
    expect(ledger(f.sqlite)).toEqual({ a: tras, b: 0 });
  });

  it('aborta sin tocar nada si hay un contexto de escritura abierto', () => {
    const f = base();
    contexto(f.sqlite, 4 * 1024 ** 3, 16_384);
    const antes = f.sqlite.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
    const ledgerAntes = ledger(f.sqlite);
    expect(() => aplicar0005(f.sqlite)).toThrow('CHECK constraint failed');
    expect(f.sqlite.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all()).toEqual(antes);
    expect(ledger(f.sqlite)).toEqual(ledgerAntes);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()).toEqual({ n: 1 });
  });

  it('los triggers de otras tablas que usan la vista siguen funcionando tras reconstruirla', () => {
    const f = base();
    aplicar0005(f.sqlite);
    expect(() => f.sqlite.exec("INSERT INTO sport_person(id,display_name,name_normalized) VALUES('p','P','p')"))
      .toThrow('sport_write_lease_required');
    contexto(f.sqlite, CAPACITY_MAX_BUDGET_BYTES, 1024 * 1024);
    f.sqlite.exec("INSERT INTO sport_person(id,display_name,name_normalized) VALUES('p','P','p')");
    f.sqlite.exec("DELETE FROM sport_write_context WHERE key='global'");
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM sport_person').get()).toEqual({ n: 1 });
  });
});
