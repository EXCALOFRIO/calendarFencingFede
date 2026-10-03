import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Abuse controls only. Identities, credentials, OTP values and sessions stay in Neon Auth. */
export const authThrottle = sqliteTable('auth_throttle', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: integer('window_start').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('auth_throttle_expiry_idx').on(t.expiresAt)]);

export const authOtpChallenge = sqliteTable('auth_otp_challenge', {
  key: text('key').primaryKey(),
  generation: text('generation').notNull(),
  attempts: integer('attempts').notNull(),
  ready: integer('ready', { mode: 'boolean' }).notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('auth_otp_challenge_expiry_idx').on(t.expiresAt)]);
