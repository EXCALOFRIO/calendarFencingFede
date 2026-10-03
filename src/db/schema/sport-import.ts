import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** One DB-clock lease for ALL corpus writers, not one lease per cron/source. */
export const sportWriteLease = pgTable('sport_write_lease', {
  key: text('key').primaryKey(),
  owner: uuid('owner').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [check('sport_write_lease_global', sql`${t.key} = 'global'`)]);

/** Bounded current-season work, separate from the historical coverage backlog. */
export const sportIncrementalTask = pgTable('sport_incremental_task', {
  key: text('key').primaryKey(),
  season: text('season').notNull(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  status: text('status').notNull().default('pendiente'),
  attempts: integer('attempts').notNull().default(0),
}, (t) => [
  index('sport_incremental_due_idx').on(t.season, t.nextCheckAt),
  check('sport_incremental_kind', sql`${t.kind} in ('fie_index','rfee_index','fie_result','rfee_result','rfee_pdf','fie_standing','rfee_standing','cooldown')`),
]);
