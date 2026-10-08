import { hoyMadrid, toCampoFecha } from './callups/fechas';

/**
 * Formatos de fecha de la interfaz. Uno por uso, todos en hora de Madrid.
 *
 * El Worker corre en UTC y el móvil en hora española: sin `timeZone` explícito
 * un instante de las 00:30 de Madrid se pinta como del día anterior en el
 * servidor y como de hoy en el navegador (desajuste de hidratación y fecha
 * equivocada). Las fechas civiles (`YYYY-MM-DD`) no tienen huso: se leen tal
 * cual, sin pasar por `new Date(iso)`.
 *
 * Las abreviaturas de mes son las que da `Intl` en es-ES («sept», «oct»).
 */

export { hoyMadrid };

export const HUSO_MADRID = 'Europe/Madrid';

export type EntradaFecha = string | Date;

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(clave: string, opciones: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = formateadores.get(clave);
  if (!f) {
    f = new Intl.DateTimeFormat('es-ES', { timeZone: HUSO_MADRID, ...opciones });
    formateadores.set(clave, f);
  }
  return f;
}

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * El día en Madrid, `YYYY-MM-DD`. Una fecha civil se devuelve igual; un
 * instante (ISO con hora o `Date`) se pasa a Madrid.
 */
export function diaMadrid(fecha: EntradaFecha): string {
  if (typeof fecha === 'string') {
    const limpio = fecha.trim();
    if (CIVIL.test(limpio)) return limpio;
    const d = new Date(limpio);
    return Number.isNaN(d.getTime()) ? '' : toCampoFecha(d);
  }
  return Number.isNaN(fecha.getTime()) ? '' : toCampoFecha(fecha);
}

/** Mediodía UTC de un día civil: en Madrid es el mismo día todo el año. */
function mediodia(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`);
}

function partesDia(dia: string): { anio: number; mes: number; dia: number } {
  const [a, m, d] = dia.split('-').map(Number);
  return { anio: a, mes: m, dia: d };
}

function mesCorto(dia: string): string {
  return formateador('mes-corto', { month: 'short' }).format(mediodia(dia)).replace('.', '');
}

export type ModoAnio = 'auto' | 'siempre' | 'nunca';

function conAnio(dia: string, modo: ModoAnio, referencia: string): boolean {
  if (modo === 'siempre') return true;
  if (modo === 'nunca') return false;
  return dia.slice(0, 4) !== referencia.slice(0, 4);
}

/**
 * «5 oct»; con año «5 oct 2026». `auto` escribe el año sólo si no es el de
 * `referencia` (hoy en Madrid si no se pasa). Vacío si la fecha no se lee.
 */
export function fechaCorta(
  fecha: EntradaFecha,
  opciones: { anio?: ModoAnio; referencia?: string } = {},
): string {
  const dia = diaMadrid(fecha);
  if (!dia) return '';
  const { dia: d, anio } = partesDia(dia);
  const base = `${d} ${mesCorto(dia)}`;
  return conAnio(dia, opciones.anio ?? 'auto', opciones.referencia ?? hoyMadrid()) ? `${base} ${anio}` : base;
}

export type BloqueRango = {
  /** «15–18», «30–2», «15». */
  dias: string;
  /** «OCT», «SEPT–OCT». */
  mes: string;
  /** El rango completo con años, para `aria-label` y `title`. */
  etiqueta: string;
};

/**
 * Rango de días.
 *
 *   linea  → «15–18 oct», «30 sept–2 oct», «30 dic 2026–2 ene 2027»
 *   bloque → { dias: '15–18', mes: 'OCT' }, { dias: '30–2', mes: 'SEPT–OCT' }
 *
 * Si el año cambia dentro del rango, la línea lo escribe siempre en los dos
 * extremos. `anio` decide el resto (por defecto `nunca`).
 */
export function rangoFechas(
  desde: EntradaFecha,
  hasta: EntradaFecha | null | undefined,
  formato: 'linea',
  opciones?: { anio?: ModoAnio; referencia?: string },
): string;
export function rangoFechas(
  desde: EntradaFecha,
  hasta: EntradaFecha | null | undefined,
  formato: 'bloque',
  opciones?: { anio?: ModoAnio; referencia?: string },
): BloqueRango;
export function rangoFechas(
  desde: EntradaFecha,
  hasta: EntradaFecha | null | undefined,
  formato: 'linea' | 'bloque',
  opciones: { anio?: ModoAnio; referencia?: string } = {},
): string | BloqueRango {
  const a = diaMadrid(desde);
  let b = hasta ? diaMadrid(hasta) : a;
  if (!b || b < a) b = a;
  if (formato === 'bloque') {
    if (!a) return { dias: '', mes: '', etiqueta: '' };
    const pa = partesDia(a);
    const pb = partesDia(b);
    const mesA = mesCorto(a).toLocaleUpperCase('es');
    const mesB = mesCorto(b).toLocaleUpperCase('es');
    return {
      dias: a === b ? String(pa.dia) : `${pa.dia}–${pb.dia}`,
      mes: mesA === mesB && pa.anio === pb.anio ? mesA : `${mesA}–${mesB}`,
      etiqueta: rangoFechas(a, b, 'linea', { anio: 'siempre' }),
    };
  }
  if (!a) return '';
  const referencia = opciones.referencia ?? hoyMadrid();
  const modo = opciones.anio ?? 'nunca';
  const pa = partesDia(a);
  const pb = partesDia(b);
  if (pa.anio !== pb.anio) {
    return `${fechaCorta(a, { anio: 'siempre' })}–${fechaCorta(b, { anio: 'siempre' })}`;
  }
  const anio = conAnio(b, modo, referencia) ? ` ${pb.anio}` : '';
  if (a === b) return `${pa.dia} ${mesCorto(a)}${anio}`;
  if (pa.mes === pb.mes) return `${pa.dia}–${pb.dia} ${mesCorto(b)}${anio}`;
  return `${pa.dia} ${mesCorto(a)}–${pb.dia} ${mesCorto(b)}${anio}`;
}

/** «5 oct, 23:59» en hora de Madrid. Con `anio: 'siempre'`, «5 oct 2026, 23:59». */
export function fechaHora(
  instante: EntradaFecha,
  opciones: { anio?: ModoAnio; referencia?: string } = {},
): string {
  const d = typeof instante === 'string' ? new Date(instante.trim()) : instante;
  if (Number.isNaN(d.getTime())) return '';
  const hora = formateador('hora', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${fechaCorta(d, opciones)}, ${hora}`;
}

/**
 * El nombre del mes en Madrid: «Octubre», «Octubre 2026»; `corto`, «oct».
 * Acepta un día/instante o el número de mes (1–12).
 */
export function nombreMes(
  fecha: EntradaFecha | number,
  opciones: { anio?: boolean; variante?: 'largo' | 'corto' } = {},
): string {
  const dia =
    typeof fecha === 'number' ? `2000-${String(Math.min(12, Math.max(1, Math.trunc(fecha)))).padStart(2, '0')}-15` : diaMadrid(fecha);
  if (!dia) return '';
  if (opciones.variante === 'corto') {
    return opciones.anio && typeof fecha !== 'number' ? `${mesCorto(dia)} ${dia.slice(0, 4)}` : mesCorto(dia);
  }
  const largo = formateador('mes-largo', { month: 'long' }).format(mediodia(dia));
  const capital = largo.charAt(0).toLocaleUpperCase('es') + largo.slice(1);
  return opciones.anio && typeof fecha !== 'number' ? `${capital} ${dia.slice(0, 4)}` : capital;
}

/** «Actualizado el 5 oct». La única redacción de la frescura de un dato. */
export function frescura(fecha: EntradaFecha | null | undefined, opciones: { referencia?: string } = {}): string {
  if (!fecha) return '';
  const texto = fechaCorta(fecha, { anio: 'auto', referencia: opciones.referencia });
  return texto ? `Actualizado el ${texto}` : '';
}

/**
 * Días naturales de `desde` a `hasta` en el calendario de Madrid (negativo si
 * `hasta` es anterior). Cuenta días, no bloques de 24 h: los días del cambio
 * de hora miden 23 o 25 h y siguen siendo uno.
 */
export function diasEntre(desde: EntradaFecha, hasta: EntradaFecha): number {
  const a = diaMadrid(desde);
  const b = diaMadrid(hasta);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
