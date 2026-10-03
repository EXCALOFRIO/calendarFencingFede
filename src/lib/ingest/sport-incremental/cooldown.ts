import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportIncrementalTask } from '@/db/schema';
import { DB_NOW } from './lease';

export async function comprobarCooldownD1(db: Db) {
  const { rows } = await db.execute(sql`select 1 as blocked from sport_incremental_task
    where key='global_cooldown' and next_check_at>${DB_NOW}`);
  if (rows.length) throw new Error('sport_source_cooldown');
}

/** Caller MUST provide an owner-bound Db; never shorten a previous Retry-After. */
export async function guardarCooldownD1(db: Db, until: Date) {
  if (!Number.isSafeInteger(until.getTime())) throw new Error('sport_cooldown_invalid');
  await db.insert(sportIncrementalTask).values({
    key: 'global_cooldown', kind: 'cooldown', season: '', payload: {}, nextCheckAt: until,
  }).onConflictDoUpdate({ target: sportIncrementalTask.key, set: {
    nextCheckAt: sql`max(${sportIncrementalTask.nextCheckAt},${until.getTime()})`,
  } });
}
