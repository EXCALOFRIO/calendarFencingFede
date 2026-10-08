/**
 * Cada cuánto se vuelve a pedir a la fuente lo de un torneo, según lo cerca
 * que esté. Funciones puras: el reloj y la última lectura llegan de fuera.
 *
 *   del día −7 al +14      → todos los días (se tira, se inscribe, publica)
 *   del día +15 al +60     → cada semana
 *   más allá del +60       → cada 15 días
 *   acabado hace 8–13 días → nada
 *   acabado hace 14–35 días→ una única pasada final (resultados tardíos)
 *   acabado hace más       → congelado: ninguna petición
 *
 * La pasada final tiene una ventana de tres semanas, y no un día, para que un
 * cron caído ese día no la pierda: se hace la primera noche en que toque.
 */

export type Nivel = 'diario' | 'semanal' | 'quincenal' | 'espera' | 'final' | 'congelado';

const DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const dias = (desde: string, hasta: string) => Math.round((ms(hasta) - ms(desde)) / DIA);

export const LIMITES = {
  diasAtrasDiario: 7,
  diasDelanteDiario: 14,
  diasDelanteSemanal: 60,
  inicioFinal: 14,
  finFinal: 35,
} as const;

/** Nivel de un torneo que va de `desde` a `hasta` (ISO), visto el día `hoy`. */
export function nivelDeTorneo(rango: { desde: string; hasta: string }, hoy: string): Nivel {
  const hastaFin = dias(rango.hasta, hoy); // > 0: ya acabó hace N días
  const haciaInicio = dias(hoy, rango.desde); // > 0: empieza dentro de N días
  if (hastaFin > LIMITES.finFinal) return 'congelado';
  if (hastaFin >= LIMITES.inicioFinal) return 'final';
  if (hastaFin > LIMITES.diasAtrasDiario) return 'espera';
  if (haciaInicio <= LIMITES.diasDelanteDiario) return 'diario';
  if (haciaInicio <= LIMITES.diasDelanteSemanal) return 'semanal';
  return 'quincenal';
}

const PERIODO: Partial<Record<Nivel, number>> = { diario: 1, semanal: 7, quincenal: 15 };

/**
 * ¿Toca pedirlo hoy? Los crons son diarios y a hora fija, pero no exacta: se
 * resta medio día para que «hace 7 días» a las 03:31 no pierda frente a una
 * lectura de las 03:30.
 */
export function tocaRefrescar(
  rango: { desde: string; hasta: string },
  ahora: Date,
  ultimaLectura: Date | null,
): { leer: boolean; nivel: Nivel } {
  const hoy = ahora.toISOString().slice(0, 10);
  const nivel = nivelDeTorneo(rango, hoy);
  if (nivel === 'congelado' || nivel === 'espera') return { leer: false, nivel };
  if (nivel === 'final') {
    const desdeFinal = ms(rango.hasta) + LIMITES.inicioFinal * DIA - DIA / 2;
    return { leer: !ultimaLectura || ultimaLectura.getTime() < desdeFinal, nivel };
  }
  if (!ultimaLectura) return { leer: true, nivel };
  const periodo = PERIODO[nivel]!;
  return { leer: ahora.getTime() - ultimaLectura.getTime() >= periodo * DIA - DIA / 2, nivel };
}

/**
 * Tareas periódicas que no dependen de un torneo (una fuente caída, una
 * clasificación mundial): ¿han pasado `periodoDias` desde la última lectura?
 */
export function tocaPorPeriodo(ahora: Date, ultimaLectura: Date | null, periodoDias: number): boolean {
  return !ultimaLectura || ahora.getTime() - ultimaLectura.getTime() >= periodoDias * DIA - DIA / 2;
}

/**
 * ¿Hace falta reescribir `last_seen_at` de una fila que no ha cambiado?
 *
 * Los calendarios de Skermo traen la temporada entera cada noche, así que
 * cientos de eventos ya acabados se reescribían a diario solo para mover esa
 * fecha. La frescura del calendario sale del máximo de `last_seen_at` (lo
 * mantienen los eventos que vienen) y los desaparecidos se calculan con los
 * ids vistos, no con la fecha; basta con renovarla una vez por semana.
 */
export function hayQueMarcarVisto(
  fila: { endDate: string; lastSeenAt: Date | null; disappearedAt?: Date | null },
  ahora: Date,
): boolean {
  if (fila.disappearedAt) return true;
  if (!fila.lastSeenAt) return true;
  const acabadoHace = dias(fila.endDate, ahora.toISOString().slice(0, 10));
  if (acabadoHace <= LIMITES.inicioFinal) return true;
  return tocaPorPeriodo(ahora, fila.lastSeenAt, 7);
}

/**
 * ¿Hay que reescribir `last_seen_at` de una lista de inscritos que no ha
 * cambiado? La ficha enseña «leída el …» con esa fecha, así que en las pruebas
 * que se tiran ya (del día −1 al +14) se renueva a diario; en las demás, cuya
 * lista ya no se mueve o falta mucho, basta una vez por semana. Las bajas no
 * dependen de esta fecha: salen de comparar con lo leído en la pasada.
 */
export function hayQueMarcarListaVista(
  fechaPrueba: string | null | undefined,
  lastSeenAt: Date | null,
  ahora: Date,
): boolean {
  if (!lastSeenAt) return true;
  if (!fechaPrueba) return true;
  const faltan = dias(ahora.toISOString().slice(0, 10), fechaPrueba);
  if (faltan >= -1 && faltan <= LIMITES.diasDelanteDiario) return true;
  return tocaPorPeriodo(ahora, lastSeenAt, 7);
}

/**
 * La clasificación mundial de la FIE se recalcula tras cada competición, y no
 * siempre al día siguiente: en los `margenDias` posteriores a algo de la FIE
 * se lee cada dos días (el lunes y el miércoles tras un fin de semana); el
 * resto del tiempo, una vez por semana.
 */
export function tocaClasificacionFie(
  ahora: Date,
  ultimaLectura: Date | null,
  ultimoFinFie: string | null,
  margenDias = 4,
): { leer: boolean; motivo: 'primera' | 'tras_competicion' | 'semanal' | 'no_toca' } {
  if (!ultimaLectura) return { leer: true, motivo: 'primera' };
  if (ultimoFinFie) {
    const fin = ms(ultimoFinFie) + DIA / 2;
    const reciente = ahora.getTime() > fin && ahora.getTime() - fin <= margenDias * DIA;
    if (reciente && tocaPorPeriodo(ahora, ultimaLectura, 2)) return { leer: true, motivo: 'tras_competicion' };
  }
  if (tocaPorPeriodo(ahora, ultimaLectura, 7)) return { leer: true, motivo: 'semanal' };
  return { leer: false, motivo: 'no_toca' };
}
