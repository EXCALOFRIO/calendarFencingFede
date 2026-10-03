import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { sportIncrementalTask } from '@/db/schema';
import { reclamarSportLease, dbConSportLease, SportLeaseLost } from '@/lib/ingest/sport-incremental/lease';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const abiertos: ReturnType<typeof fixtureDeportivaD1>[] = [];
afterEach(() => { abiertos.splice(0).forEach((local) => local.close()); });
function fixture() {
  const local = fixtureDeportivaD1();
  abiertos.push(local);
  return local;
}

describe('lease deportivo persistente nativo D1', () => {
  it('reclama solo un singleton caducado de forma atómica y con reloj de la base', async () => {
    const local = fixture();
    const lease = await reclamarSportLease(local.db, OWNER);
    expect(lease?.owner).toBe(OWNER);
    expect(await reclamarSportLease(local.db, SECOND)).toBeNull();
    const row = local.sqlite.prepare('SELECT owner,expires_at,lease_version FROM sport_write_lease').get()!;
    expect(row.owner).toBe(OWNER);
    expect(row.expires_at).toBeGreaterThan(Date.now());
    expect(row.lease_version).toBe(1);
    expect(local.calls.some((q) => /on conflict\(key\)/i.test(q.sql))).toBe(true);
  });

  it('un lease activo no autoriza ninguna mutación deportiva sin su contexto', async () => {
    const local = fixture();
    await reclamarSportLease(local.db, OWNER);
    expect(await reclamarSportLease(local.db, SECOND)).toBeNull();
    await expect(local.db.insert(sportIncrementalTask).values({
      key: 'test', kind: 'fie_index', season: '2027', payload: {},
    })).rejects.toThrow();
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_incremental_task').get()!.n).toBe(0);
  });

  it('renueva y libera solo propietario y versión, sin revivir caducados ni borrar', async () => {
    const local = fixture();
    const first = (await reclamarSportLease(local.db, OWNER))!;
    await first.renovar();
    await first.liberar();
    await expect(first.renovar()).rejects.toBeInstanceOf(SportLeaseLost);
    const second = (await reclamarSportLease(local.db, SECOND))!;
    expect(second.version).toBe(first.version + 1);
    await first.liberar();
    expect(local.sqlite.prepare('SELECT owner,lease_version FROM sport_write_lease').get())
      .toEqual({ owner: SECOND, lease_version: second.version });
    expect(local.calls.some((q) => /^delete.*sport_write_lease/i.test(q.sql))).toBe(false);
  });

  it('un propietario perdido falla antes de confirmar hechos', async () => {
    const local = fixture();
    const lease = (await reclamarSportLease(local.db, OWNER))!;
    const writer = dbConSportLease(local.db, lease);
    local.sqlite.exec("UPDATE sport_write_lease SET expires_at=0 WHERE key='global'");
    await expect(writer.insert(sportIncrementalTask).values({
      key: 'test', kind: 'fie_index', season: '2027', payload: {},
    })).rejects.toBeInstanceOf(SportLeaseLost);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_incremental_task').get()!.n).toBe(0);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
  });

  it('una mutación encadenada se confirma con contexto efímero dentro del mismo batch', async () => {
    const local = fixture();
    const lease = (await reclamarSportLease(local.db, OWNER))!;
    const writer = dbConSportLease(local.db, lease);
    const rows = await writer.insert(sportIncrementalTask).values({
      key: 'test', kind: 'fie_index', season: '2027', payload: {},
    }).onConflictDoNothing().returning();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('test');
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
    expect(local.calls.every((q) => q.parameters <= 100)).toBe(true);
    expect(local.calls.some((q) => /set_config|pg_advisory|clock_timestamp/.test(q.sql))).toBe(false);
  });

  it('incluye SQL crudo en el batch y revierte toda la unidad si la segunda sentencia falla', async () => {
    const local = fixture();
    const lease = (await reclamarSportLease(local.db, OWNER))!;
    const writer = dbConSportLease(local.db, lease);
    await writer.batch([
      writer.execute(sql`insert into sport_person(id,display_name,name_normalized) values('fixture','Fixture','fixture')`),
      writer.execute(sql`update sport_person set display_name='Fixture actualizado' where id='fixture'`),
    ]);
    expect(local.sqlite.prepare("SELECT display_name FROM sport_person WHERE id='fixture'").get()!.display_name)
      .toBe('Fixture actualizado');
    await expect(writer.batch([
      writer.execute(sql`update sport_person set display_name='No confirmar' where id='fixture'`),
      writer.execute(sql`insert into sport_person(id,display_name,name_normalized) values('fixture','Duplicado','duplicado')`),
    ])).rejects.toThrow();
    expect(local.sqlite.prepare("SELECT display_name FROM sport_person WHERE id='fixture'").get()!.display_name)
      .toBe('Fixture actualizado');
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
  });
});
