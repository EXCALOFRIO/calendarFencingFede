import { afterEach, describe, expect, it, vi } from 'vitest';
import { localD1 } from '@/db/d1/testing';
import { bindingD1 } from '@/lib/migracion-cloudflare/binding';
import type { D1Binding } from '@/db/d1/binding';

const databaseId = '11111111-1111-4111-8111-111111111111';
const abiertos: ReturnType<typeof localD1>[] = [];
afterEach(() => { for (const local of abiertos.splice(0)) local.close(); });
function local() {
  const value = localD1();
  abiertos.push(value);
  return value;
}

describe('transporte de migración por binding D1', () => {
  it('mantiene la guarda de sólo lectura antes de contactar el binding', async () => {
    const fixture = local();
    const executor = bindingD1(databaseId, fixture.binding);
    await expect(executor.execute({ sql: 'DELETE FROM club', params: [] }))
      .rejects.toThrow('readonly');
    expect(fixture.calls).toEqual([]);
    expect(await executor.execute({ sql: 'SELECT count(*) AS n FROM club', params: [] }))
      .toEqual([{ n: 0 }]);
  });

  it('ejecuta un batch real y lo revierte íntegramente al fallar una sentencia', async () => {
    const fixture = local();
    const executor = bindingD1(databaseId, fixture.binding, true);
    await expect(executor.executeBatch!([
      { sql: "INSERT INTO club (id,name) VALUES ('uno','Fixture')", params: [] },
      { sql: "INSERT INTO club (id,name) VALUES ('dos',NULL)", params: [] },
    ])).rejects.toThrow('d1_binding_batch_failed');
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM club').get()!.n).toBe(0);
    await executor.executeBatch!([
      { sql: 'INSERT INTO club (id,name) VALUES (?,?)', params: ['uno', 'Fixture'] },
      { sql: 'INSERT INTO club (id,name) VALUES (?,?)', params: ['dos', 'Fixture dos'] },
    ]);
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM club').get()!.n).toBe(2);
  });

  it('acota parámetros, cantidad y bytes de un batch antes de preparar SQL', async () => {
    const prepare = vi.fn();
    const executor = bindingD1(databaseId, { prepare } as unknown as D1Binding, true);
    await expect(executor.execute({ sql: 'SELECT ?', params: Array(101).fill(1) }))
      .rejects.toThrow('parameter_limit');
    await expect(executor.executeBatch!([])).rejects.toThrow('batch_limit');
    await expect(executor.executeBatch!(Array(101).fill({ sql: 'SELECT 1', params: [] })))
      .rejects.toThrow('batch_limit');
    await expect(executor.executeBatch!([
      { sql: 'SELECT ?', params: ['x'.repeat(500 * 1024)] },
      { sql: 'SELECT ?', params: ['x'.repeat(500 * 1024)] },
    ])).rejects.toThrow('payload_limit');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('no propaga errores que contienen valores privados', async () => {
    const executor = bindingD1(databaseId, {
      prepare: () => ({
        bind: () => ({ all: async () => { throw new Error('PRIVATE-VALUE'); } }),
      }),
    } as unknown as D1Binding);
    await expect(executor.execute({ sql: 'SELECT 1', params: [] }))
      .rejects.toThrow(/^d1_binding_query_failed$/);
  });
});
