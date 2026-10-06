import { hoyMadrid } from '@/lib/callups/fechas';

/**
 * ¿El torneo ya se ha tirado? En hora de España, como el resto del
 * calendario (ver `hoyMadrid`): el último día todavía no está terminado.
 */
export function torneoTerminado(evento: { endDate: string }, hoy: string = hoyMadrid()): boolean {
  return evento.endDate < hoy;
}
