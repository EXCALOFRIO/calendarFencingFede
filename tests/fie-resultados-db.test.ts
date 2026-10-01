import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import type { Db } from '@/db';

vi.mock('@/db', () => ({ db: {} }));

const { crearDepsPersistenciaFieDb } = await import('@/lib/ingest/fie-resultados-db');

/**
 * Cliente Neon falso que sólo registra el SQL que Drizzle genera. No hay base
 * ni red: se comprueba la forma de las sentencias, no su efecto en Postgres.
 */
function dbRegistradora(devolver: (sql: string) => unknown[] = () => []) {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const cliente = Object.assign(
    async (sql: string, params: unknown[], opciones?: { arrayMode?: boolean }) => {
      consultas.push({ sql, params });
      const filas = devolver(sql);
      return opciones?.arrayMode ? { rows: filas.map((f) => Object.values(f as object)), fields: [] } : { rows: filas, fields: [] };
    },
    { transaction: async () => [] },
  );
  const db = drizzle(cliente as never, { schema }) as unknown as Db;
  return { db, consultas };
}

const resultado = {
  sourceFactKey: '70490',
  personId: null,
  sourceName: 'FIE 70490',
  sourceCountryCode: 'USA',
  position: 1,
  positionRaw: '1',
  officialPoints: '32',
  occurredOn: '2026-09-25',
  sourceUrl: 'https://fie.org/api/fie/competition/2027/1478/results/ranking',
  contentHash: 'h',
};

describe('SQL de la persistencia FIE (cliente Neon registrador, sin base)', () => {
  it('los puestos van por la clave natural y sólo se reescriben si cambia el contenido o llega la persona', async () => {
    const { db, consultas } = dbRegistradora(() => [{ insertado: true }]);
    const r = await crearDepsPersistenciaFieDb(db).upsertResultados('comp-1', [resultado]);
    expect(r).toEqual({ nuevos: 1, revisados: 0, sinCambios: 0 });
    const { sql } = consultas[0];
    expect(sql).toMatch(/insert into "sport_result"/i);
    expect(sql).toMatch(/on conflict \("competition_id",\s*"source",\s*"source_fact_key"\) do update/i);
    expect(sql).toMatch(/where .*content_hash.* <> excluded\.content_hash or/i);
    expect(sql).toMatch(/coalesce\(excluded\.person_id/i);
    expect(sql).toMatch(/xmax = 0/);
    expect(sql).not.toMatch(/delete/i);
  });

  it('cuenta como sin cambios las filas que el upsert no devuelve', async () => {
    const { db } = dbRegistradora(() => []);
    const r = await crearDepsPersistenciaFieDb(db).upsertResultados('comp-1', [resultado, { ...resultado, sourceFactKey: '2' }]);
    expect(r).toEqual({ nuevos: 0, revisados: 0, sinCambios: 2 });
  });

  it('los asaltos van por prueba, fase, ronda y el par canónico', async () => {
    const { db, consultas } = dbRegistradora(() => [{ insertado: false }]);
    const r = await crearDepsPersistenciaFieDb(db).upsertAsaltos('comp-1', [
      {
        phase: 'TABLEAU',
        roundKey: 'A2',
        fencerARef: '3',
        fencerBRef: '5',
        fencerAPersonId: null,
        fencerBPersonId: null,
        fencerAName: 'FIE 3',
        fencerBName: 'FIE 5',
        scoreA: 11,
        scoreB: 15,
        occurredOn: '2026-09-25',
        sourceUrl: 'u',
        contentHash: 'h',
      },
    ]);
    expect(r).toEqual({ nuevos: 0, revisados: 1, sinCambios: 0 });
    expect(consultas[0].sql).toMatch(
      /on conflict \("competition_id",\s*"source",\s*"phase",\s*"round_key",\s*"fencer_a_ref",\s*"fencer_b_ref"\) do update/i,
    );
  });

  it('el guard va por db.batch real de Drizzle: cerrojo y escritura en una misma transacción', async () => {
    const consultas: string[] = [];
    let transacciones = 0;
    const cliente = Object.assign(
      async (sql: string) => {
        consultas.push(sql);
        return { rows: [], fields: [] };
      },
      {
        transaction: async (lote: unknown[]) => {
          transacciones += 1;
          return lote.map((_, i) => ({ rows: i === 1 ? [{ id: 'nuevo' }] : [], fields: [] }));
        },
      },
    );
    const db = drizzle(cliente as never, { schema }) as unknown as Db;
    const guard = crearDepsPersistenciaFieDb(db).guard;
    const ok = await guard.confirmar({
      personId: '00000000-0000-4000-8000-000000000001',
      scheme: 'fie_addr_id',
      value: '70490',
      scopeSource: 'fie',
      scopeFederation: '',
      scopeSeason: '',
      scopeWeapon: '',
      validFrom: '1900-01-01',
      validTo: null,
      linkedVia: 'fie_resultados',
      evidence: 'prueba',
    });
    expect(ok).toBe(true);
    expect(transacciones).toBe(1);
    expect(consultas[0]).toMatch(/pg_advisory_xact_lock/);
    expect(consultas[1]).toMatch(/INSERT INTO sport_external_id/);
  });

  it('una lectura fallida no pisa las cifras de cobertura; una buena sí', async () => {
    const { db, consultas } = dbRegistradora();
    const deps = crearDepsPersistenciaFieDb(db);
    const base = {
      season: '2027',
      factKind: 'ranking' as const,
      competitionKey: '1478',
      competitionId: 'comp-1',
      sourceUrl: 'u',
    };
    await deps.upsertCobertura({ ...base, status: 'error', lastError: 'HTTP 503' });
    await deps.upsertCobertura({ ...base, status: 'completo', publishedTotal: 28, importedTotal: 28, lastError: null });
    const [fallo, bueno] = consultas.map((c) => c.sql);
    expect(fallo).not.toMatch(/"published_total" = excluded/);
    expect(fallo).toMatch(/"attempts" = "sport_import_coverage"\."attempts" \+ 1/);
    expect(bueno).toMatch(/"published_total" = excluded\.published_total/);
    expect(bueno).toMatch(/"imported_total" = excluded\.imported_total/);
  });
});
