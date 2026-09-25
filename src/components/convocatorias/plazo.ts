/**
 * Cuenta atrás para responder una convocatoria.
 *
 * Los días se calculan SIEMPRE en el servidor y se pasan ya hechos al
 * componente. Si se calcularan en el cliente, el número pintado en el
 * servidor y el pintado al hidratar podrían no coincidir (husos distintos, o
 * simplemente que haya pasado la medianoche entre una cosa y otra) y React
 * avisaría de una discrepancia de hidratación en la cifra más importante de
 * la pantalla.
 */

export type Tono = 'ok' | 'warn' | 'danger' | 'off';

export type Plazo = {
  /** Días naturales que faltan. Negativo si ya pasó. Null si no hay plazo. */
  dias: number | null;
  vencido: boolean;
  tono: Tono;
};

export const CLASE_TONO: Record<Tono, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  off: 'text-muted-foreground',
};

export function calcularPlazo(respondBy: Date | null, ahora: Date = new Date()): Plazo {
  if (!respondBy) return { dias: null, vencido: false, tono: 'off' };

  const dias = Math.ceil((respondBy.getTime() - ahora.getTime()) / 86_400_000);
  if (dias < 0) return { dias, vencido: true, tono: 'danger' };
  if (dias <= 2) return { dias, vencido: false, tono: 'danger' };
  if (dias <= 7) return { dias, vencido: false, tono: 'warn' };
  return { dias, vencido: false, tono: 'ok' };
}

/** "3 días", "1 día", "hoy". Sin el número, que va aparte y en grande. */
export function palabraPlazo(plazo: Plazo): string {
  if (plazo.dias === null) return 'sin plazo fijado';
  if (plazo.vencido) return 'plazo vencido';
  if (plazo.dias === 0) return 'último día para responder';
  return plazo.dias === 1 ? 'día para responder' : 'días para responder';
}
