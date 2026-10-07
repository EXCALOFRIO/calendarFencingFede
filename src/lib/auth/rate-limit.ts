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

/**
 * Daily ceiling for access codes across the whole application.
 *
 * The codes are e-mailed by the managed Neon Auth provider, NOT by Resend:
 * Resend (free plan: 100 e-mails/day, 3,000/month, 2 requests/second, see
 * `RESEND_DAILY_LIMIT`) only carries the notification queue. This ceiling
 * protects the provider's own sending quota and our reputation if every
 * per-IP and per-address control is bypassed at once. Only sends to invited
 * addresses count, so invented addresses cannot use it up.
 */
export const OTP_DAILY_LIMIT_DEFAULT = 2000;

export function otpDailyLimit(value = process.env.AUTH_OTP_DAILY_LIMIT): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : OTP_DAILY_LIMIT_DEFAULT;
}

export type OtpRequestOptions = {
  /** Whether the address has a live invitation; checked BEFORE any per-address counter. */
  invited: boolean;
  dailyLimit?: number;
};

export async function allowOtpRequest(
  db: AuthDatabase, secret: string, email: string, headers: Headers, send: boolean,
  { invited, dailyLimit = otpDailyLimit() }: OtpRequestOptions,
): Promise<boolean> {
  // Cloudflare overwrites this header. Never trust forwarded-for/client-supplied IP aliases.
  const ip = headers.get('cf-connecting-ip') ?? 'local-or-missing-ip';
  const minute = 60_000;
  const hour = 60 * minute;
  if (!await takeAuthLimit(db, secret, send ? 'send-ip-minute' : 'verify-ip-minute', ip, send ? 5 : 20, minute)) return false;
  if (!await takeAuthLimit(db, secret, send ? 'send-ip-hour' : 'verify-ip-hour', ip, send ? 20 : 100, hour)) return false;
  // Uninvited addresses never reach the provider: no per-address rows, no global quota.
  if (!invited) return false;
  if (!await takeAuthLimit(db, secret, send ? 'send-email-hour' : 'verify-email-hour', email, send ? 5 : 20, hour)) return false;
  if (send) {
    if (!await takeAuthLimit(db, secret, 'send-delay', email, 1, minute)) return false;
    if (!await takeAuthLimit(db, secret, 'send-global-day', 'all', dailyLimit, 24 * hour)) return false;
  }
  return true;
}
