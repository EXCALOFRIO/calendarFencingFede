import { runSportIncremental } from '@/lib/ingest/sport-incremental/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 50;

/** Dedicated bounded run, not appended to a potentially long legacy ingestion. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) return Response.json({ ok: false, status: 'configuracion' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, status: 'no_autorizado' }, { status: 401 });
  }
  return Response.json(await runSportIncremental());
}
