import type { ContextoCron, DisparoCron, EntornoCron, FetchCron } from './programado';

type EntornoMantenimiento = EntornoCron & { MIGRATION_MAINTENANCE?: string };

/** Solo false o ausencia lo desactivan; una configuración dudosa no abre datos. */
export function enMantenimiento(env: EntornoMantenimiento): boolean {
  return env.MIGRATION_MAINTENANCE !== undefined && env.MIGRATION_MAINTENANCE !== 'false';
}

export function respuestaMantenimiento(request: Request): Response {
  return new Response(request.method === 'HEAD' ? null : 'Estamos actualizando el calendario. Vuelve a intentarlo en unos minutos.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'Retry-After': '120' },
  });
}

/** Corte controlado: ni peticiones manuales ni scheduled pueden escribir. */
export function conMantenimiento(
  fetch: FetchCron,
  scheduled: (event: DisparoCron, env: EntornoCron, ctx: ContextoCron) => Promise<void>,
) {
  return {
    async fetch(request: Request, env: EntornoMantenimiento, ctx: ContextoCron) {
      if (!enMantenimiento(env)) return fetch(request, env, ctx);
      return respuestaMantenimiento(request);
    },
    async scheduled(event: DisparoCron, env: EntornoMantenimiento, ctx: ContextoCron) {
      if (enMantenimiento(env)) return;
      return scheduled(event, env, ctx);
    },
  };
}
