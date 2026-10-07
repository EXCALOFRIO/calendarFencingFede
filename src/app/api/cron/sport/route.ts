import { runSportIncremental } from '@/lib/ingest/sport-incremental/runtime';
import { estadoCron } from '@/lib/cron/secreto';

export const dynamic = 'force-dynamic';
export const maxDuration = 50;

/**
 * OBSOLETO: sin franja en `TAREAS_CRON` ni en `triggers.crons`, y apagado
 * (`SPORT_INCREMENTAL_ENABLED`). Los resultados los mantiene
 * `/api/cron/resultados`, que no reescribe lo que ya está (huella por prueba).
 * Se conserva sólo como ejecución manual de las clasificaciones históricas de
 * ranking (`fie_standing`, RFEE), que la ingesta automática no cubre; no debe
 * activarse junto a ella sin revisar antes su huella de hechos.
 * Ver docs/tareas-programadas.md.
 */
export async function GET(request: Request) {
  // Fail closed even locally: no development bypass for this route.
  const estado = estadoCron(request);
  if (estado === 'sin_secreto') return Response.json({ ok: false, status: 'configuracion' }, { status: 503 });
  if (estado !== 'autorizado') {
    return Response.json({ ok: false, status: 'no_autorizado' }, { status: 401 });
  }
  return Response.json(await runSportIncremental());
}
