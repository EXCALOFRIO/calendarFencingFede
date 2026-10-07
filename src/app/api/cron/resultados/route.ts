import { secretoCronValido } from '@/lib/cron/secreto';
import { runResultadosAuto } from '@/lib/ingest/resultados-auto/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Ingesta automática de resultados: pasada acotada (≤45 s por defecto) con lease global. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed even in development: this route writes sport_* facts.
  if (!secret?.trim()) return Response.json({ ok: false, status: 'configuracion' }, { status: 503 });
  if (!secretoCronValido(request.headers.get('authorization'), secret)) {
    return Response.json({ ok: false, status: 'no_autorizado' }, { status: 401 });
  }
  const r = await runResultadosAuto();
  // The detail names only unit keys (source ids), never people or page contents.
  return Response.json({ ...r, detalle: r.detalle.slice(0, 20) });
}
