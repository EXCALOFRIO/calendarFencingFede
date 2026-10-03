import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { authThrottle } from './cloudflare-schema';

export type AuthDatabase = Pick<DrizzleD1Database, 'select' | 'insert' | 'delete' | 'update'>;

export function privateAuthKey(secret: string, scope: string, value: string): string {
  return createHmac('sha256', secret).update(`calendario:auth:${scope}:v1:${value}`).digest('hex');
}

/** One atomic SQLite UPSERT, not a read/increment race or an isolate-local counter. */
export async function takeAuthLimit(
  db: AuthDatabase, secret: string, scope: string, value: string,
  maximum: number, windowMs: number, now = Date.now(),
): Promise<boolean> {
  const key = privateAuthKey(secret, scope, value);
  const expired = sql`${authThrottle.windowStart} <= ${now - windowMs}`;
  const [row] = await db.insert(authThrottle).values({
    key, count: 1, windowStart: now, expiresAt: now + windowMs,
  }).onConflictDoUpdate({
    target: authThrottle.key,
    set: {
      count: sql`CASE WHEN ${expired} THEN 1 ELSE min(${authThrottle.count} + 1, ${maximum + 1}) END`,
      windowStart: sql`CASE WHEN ${expired} THEN ${now} ELSE ${authThrottle.windowStart} END`,
      expiresAt: sql`CASE WHEN ${expired} THEN ${now + windowMs} ELSE ${authThrottle.expiresAt} END`,
    },
  }).returning({ count: authThrottle.count });
  return !!row && row.count <= maximum;
}

export async function allowOtpRequest(
  db: AuthDatabase, secret: string, email: string, headers: Headers, send: boolean,
): Promise<boolean> {
  // Cloudflare overwrites this header. Never trust forwarded-for/client-supplied IP aliases.
  const ip = headers.get('cf-connecting-ip') ?? 'local-or-missing-ip';
  const minute = 60_000;
  const hour = 60 * minute;
  if (!await takeAuthLimit(db, secret, send ? 'send-ip-minute' : 'verify-ip-minute', ip, send ? 5 : 20, minute)) return false;
  if (!await takeAuthLimit(db, secret, send ? 'send-ip-hour' : 'verify-ip-hour', ip, send ? 20 : 100, hour)) return false;
  if (!await takeAuthLimit(db, secret, send ? 'send-email-hour' : 'verify-email-hour', email, send ? 5 : 20, hour)) return false;
  if (send) {
    if (!await takeAuthLimit(db, secret, 'send-delay', email, 1, minute)) return false;
    if (!await takeAuthLimit(db, secret, 'send-global-day', 'all', 80, 24 * hour)) return false;
  }
  return true;
}
