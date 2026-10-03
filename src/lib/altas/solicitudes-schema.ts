import { sql } from 'drizzle-orm';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { athlete, userProfile } from '@/db/schema';
import { timestampMilliseconds } from '@/db/d1/columns';

/** Application authorization records, not managed authentication identities. */
export const athleteLinkRequest = sqliteTable('athlete_link_request', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => userProfile.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  claimedName: text('claimed_name').notNull(),
  state: text('state', { enum: ['PENDIENTE', 'APROBADA', 'RECHAZADA'] }).notNull().default('PENDIENTE'),
  requestedAt: timestampMilliseconds('requested_at').notNull(),
  reviewedAt: timestampMilliseconds('reviewed_at'),
  reviewedByProfileId: text('reviewed_by_profile_id').references(() => userProfile.id, { onDelete: 'restrict' }),
  athleteId: text('athlete_id').references(() => athlete.id, { onDelete: 'set null' }),
  evidence: text('evidence'),
}, (t) => [
  uniqueIndex('athlete_link_request_pending_profile_idx').on(t.profileId).where(sql`${t.state} = 'PENDIENTE'`),
  index('athlete_link_request_review_idx').on(t.state, t.requestedAt),
  index('athlete_link_request_rate_idx').on(t.profileId, t.requestedAt),
]);
