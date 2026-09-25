/**
 * Generador de feeds iCal (RFC 5545) suscribibles, escrito a mano.
 *
 * Sin dependencias a propósito: el formato es texto plano y lo único
 * verdaderamente delicado (plegado a 75 octetos, escapado, husos horarios) cabe
 * en este fichero. Una librería más traería su propio modelo de datos y nos
 * obligaría a traducir `EventView` a él.
 *
 * DOS DECISIONES QUE MANDAN SOBRE TODO LO DEMÁS:
 *
 * 1. UID ESTABLE POR PRUEBA (`event_competition`). Un calendario suscrito no se
 *    "reenvía": el cliente vuelve a descargar el fichero entero y compara por
 *    UID. Si el UID cambia cuando cambia la fecha o el pabellón, el usuario
 *    acaba con dos eventos y uno de los dos es mentira. Con UID estable, mover
 *    una competición de sábado a domingo ACTUALIZA la entrada que ya tenía en
 *    el móvil.
 *
 * 2. UN FEED POR TIPO, NO UN FEED CON COLORES. Ni Google Calendar ni Apple
 *    Calendar respetan de forma fiable el color ni la imagen POR EVENTO en un
 *    calendario suscrito: el color se asigna POR CALENDARIO, desde la app del
 *    usuario. Por eso se publican feeds separados (nacional, internacional,
 *    autonómico, convocatorias) y cada persona les pone el color que quiera en
 *    su teléfono. `COLOR` y `X-APPLE-CALENDAR-COLOR` se emiten como sugerencia
 *    inicial, sabiendo que muchos clientes los ignoran.
 */

import { type ComputedDeadline, DEADLINE_TYPE_LABEL } from './deadlines';
import type { CompetitionView, EventView, Scope } from './queries/calendar';
import { countryName, timezoneInfo } from './travel';
import {
  CATEGORY_LABEL,
  CIRCUIT_LABEL,
  GENDER_LABEL,
  GENDER_SHORT,
  WEAPON_LABEL,
  formatDateRangeEs,
  formatDateTimeEs,
  formatEur,
} from './utils';

/** Las líneas de un fichero iCal se separan con CRLF, no con LF (RFC 5545 §3.1). */
const CRLF = '\r\n';

/** Dominio del UID. No se usa para resolver nada: solo hace el UID único. */
const UID_DOMAIN = 'calendario-esgrima';

/**
 * Duración que se da a una prueba cuando la fuente publica hora de inicio pero
 * no de fin (que es siempre). No es un dato: es un hueco visual para que la
 * prueba ocupe el día en la vista de calendario. La descripción del evento lo
 * dice con todas las letras, para no hacerlo pasar por información oficial.
 */
const DURACION_ORIENTATIVA_HORAS = 8;

/** Días de antelación del recordatorio antes del cierre ordinario. */
const AVISO_DIAS_ANTES = 3;

export const FEED_TYPES = [
  'nacional',
  'internacional',
  'autonomico',
  'convocatorias',
  'todo',
] as const;

export type FeedType = (typeof FEED_TYPES)[number];

export function isFeedType(value: string): value is FeedType {
  return (FEED_TYPES as readonly string[]).includes(value);
}

export type FeedMeta = {
  /** Nombre que verá el usuario en su app de calendario. */
  name: string;
  description: string;
  /** Ámbitos que incluye el feed. `null` = no filtra por ámbito. */
  scopes: Scope[] | null;
  /** Nombre de color CSS3, que es lo que admite `COLOR` (RFC 7986 §5.9). */
  color: string;
  /** Apple usa su propia extensión, y con hexadecimal. */
  appleColor: string;
};

export const FEED_META: Record<FeedType, FeedMeta> = {
  nacional: {
    name: 'Esgrima · Calendario nacional',
    description:
      'Competiciones del calendario nacional de la RFEE para las que eres ' +
      'elegible por categoría y arma.',
    scopes: ['NACIONAL'],
    color: 'firebrick',
    appleColor: '#B22222',
  },
  internacional: {
    name: 'Esgrima · Calendario internacional',
    description:
      'Competiciones FIE y EFC para las que eres elegible por categoría y arma.',
    scopes: ['INTERNACIONAL'],
    color: 'navy',
    appleColor: '#1E3A8A',
  },
  autonomico: {
    name: 'Esgrima · Calendario autonómico',
    description:
      'Competiciones de las federaciones autonómicas para las que eres ' +
      'elegible por categoría y arma.',
    scopes: ['AUTONOMICO'],
    color: 'seagreen',
    appleColor: '#2E8B57',
  },
  convocatorias: {
    name: 'Esgrima · Convocatorias',
    description:
      'Solo las pruebas en las que hay una convocatoria publicada que te ' +
      'incluye.',
    scopes: null,
    color: 'darkorange',
    appleColor: '#EA8C00',
  },
  todo: {
    name: 'Esgrima · Todo el calendario',
    description:
      'Todas las competiciones para las que eres elegible, de cualquier ámbito.',
    scopes: null,
    color: 'slateblue',
    appleColor: '#6A5ACD',
  },
};

/** URL de suscripción de un feed. El token es la credencial: es revocable. */
export function feedUrl(baseUrl: string, icalToken: string, type: FeedType): string {
  const base = baseUrl.replace(/\/+$/, '');
  // Con `.ics`, igual que la URL que se enseña en "Mi perfil": había dos
  // formas distintas de la misma URL y solo una de ellas respondía.
  return `${base}/api/calendario/${icalToken}.ics?tipo=${type}`;
}

/**
 * Misma URL con esquema `webcal:`. En iOS y macOS abre directamente el diálogo
 * de suscripción en lugar de descargar un `.ics` suelto, que es el error que
 * hace que la gente acabe con un calendario congelado que no se actualiza.
 */
export function webcalUrl(baseUrl: string, icalToken: string, type: FeedType): string {
  return feedUrl(baseUrl, icalToken, type).replace(/^https?:/, 'webcal:');
}

// ---------------------------------------------------------------------------
// Primitivas del formato
// ---------------------------------------------------------------------------

/**
 * Escapado de valores TEXT (RFC 5545 §3.3.11). La contrabarra va primero: si se
 * escapa después, se duplicarían las que acaban de introducir las otras reglas.
 */
export function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Plegado de líneas (RFC 5545 §3.1): ninguna línea puede pasar de 75 OCTETOS,
 * no de 75 caracteres. La diferencia importa: "Federació Catalana d'Esgrima"
 * tiene acentos, y contar caracteres deja líneas de 80 bytes que algunos
 * clientes truncan. Se cuenta en bytes UTF-8 y nunca se parte un carácter por
 * la mitad; la continuación empieza por un espacio.
 */
export function foldIcalLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let current = '';
  let bytes = 0;

  // `for..of` recorre puntos de código, así que los emoji (pares subrogados) no
  // se parten en dos mitades inválidas.
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      chunks.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);

  return chunks.join(CRLF);
}

/** Fecha en formato DATE (`YYYYMMDD`). */
function toIcalDate(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, '');
}

/** Instante absoluto en UTC (`YYYYMMDDTHHMMSSZ`). */
function toIcalUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** Hora local "de pared", sin sufijo Z: va siempre acompañada de un TZID. */
function toIcalLocal(isoDate: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${toIcalDate(isoDate)}T${hh}${mm}00`;
}

function isoPlusDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Hora de la fuente -> hora de pared, o `null`.
 *
 * Skermo publica estos campos como texto libre y a veces trae cosas como
 * "por determinar". Si no es una hora reconocible se devuelve `null` y el
 * evento se emite como de día completo: es preferible a inventar una hora.
 */
export function parseWallTime(
  raw: string | null | undefined,
): { hour: number; minute: number } | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})[:.hH]\s*(\d{2})/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Suma horas a una hora de pared, arrastrando el cambio de día si toca. */
function addWallHours(
  isoDate: string,
  hour: number,
  minute: number,
  hours: number,
): { date: string; hour: number; minute: number } {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const moment = new Date(Date.UTC(y, m - 1, d, hour, minute) + hours * 3_600_000);
  return {
    date: moment.toISOString().slice(0, 10),
    hour: moment.getUTCHours(),
    minute: moment.getUTCMinutes(),
  };
}

/**
 * Hash FNV-1a de 32 bits. Se usa solo para derivar `SEQUENCE`; no es
 * criptográfico ni pretende serlo (`sha256` de utils es asíncrono y este
 * generador es síncrono a propósito).
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Husos horarios
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Desfase respecto a UTC, en minutos, de un huso en un instante. */
function offsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const parts = offsetFormatter(timeZone).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0; // "GMT" a secas es UTC.
    const sign = match[1] === '-' ? -1 : 1;
    return (
      sign *
      (Number.parseInt(match[2], 10) * 60 +
        (match[3] ? Number.parseInt(match[3], 10) : 0))
    );
  } catch {
    // Huso desconocido: no se inventa un desfase.
    return null;
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(
    abs % 60,
  ).padStart(2, '0')}`;
}

const vtimezoneCache = new Map<string, string[]>();

/**
 * Genera un bloque VTIMEZONE para un huso IANA.
 *
 * Hace falta porque las horas con `TZID` sin su VTIMEZONE son, según el RFC,
 * ambiguas, y algunos clientes de escritorio directamente descartan el evento.
 * En vez de arrastrar la base de datos IANA, se descubren los cambios de hora
 * preguntándole a `Intl` semana a semana (los saltos nunca están a menos de
 * siete días) y afinando después por bisección hasta el minuto. Se emiten las
 * transiciones como fechas explícitas (RDATE) en lugar de reglas de repetición:
 * es más largo, pero no puede equivocarse al extrapolar.
 */
function buildVTimezone(timeZone: string, fromYear: number, toYear: number): string[] {
  const cacheKey = `${timeZone}|${fromYear}|${toYear}`;
  const cached = vtimezoneCache.get(cacheKey);
  if (cached) return cached;

  const start = Date.UTC(fromYear, 0, 1);
  const end = Date.UTC(toYear + 1, 0, 1);

  const startOffset = offsetMinutes(timeZone, new Date(start));
  if (startOffset === null) return [];

  type Transition = { at: number; from: number; to: number };
  const transitions: Transition[] = [];

  const WEEK = 7 * 86_400_000;
  let previousOffset = startOffset;
  for (let t = start + WEEK; t <= end; t += WEEK) {
    const offset = offsetMinutes(timeZone, new Date(t));
    if (offset === null || offset === previousOffset) {
      if (offset !== null) previousOffset = offset;
      continue;
    }

    // Bisección dentro de la semana hasta acotar el salto al segundo, y
    // después se baja al minuto en punto: los cambios de hora caen siempre en
    // una hora en punto, así que truncar corrige el margen de la bisección.
    let low = t - WEEK;
    let high = t;
    while (high - low > 1_000) {
      const mid = low + Math.floor((high - low) / 2);
      const midOffset = offsetMinutes(timeZone, new Date(mid));
      if (midOffset === previousOffset) low = mid;
      else high = mid;
    }

    transitions.push({
      at: Math.floor(high / 60_000) * 60_000,
      from: previousOffset,
      to: offset,
    });
    previousOffset = offset;
  }

  const lines: string[] = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];

  if (transitions.length === 0) {
    // Huso sin cambio de hora (Canarias sí lo tiene; Reikiavik o Moscú no).
    lines.push(
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${formatOffset(startOffset)}`,
      `TZOFFSETTO:${formatOffset(startOffset)}`,
      'END:STANDARD',
    );
  } else {
    const daylight = transitions.filter((t) => t.to > t.from);
    const standard = transitions.filter((t) => t.to <= t.from);

    for (const [kind, group] of [
      ['DAYLIGHT', daylight],
      ['STANDARD', standard],
    ] as const) {
      if (group.length === 0) continue;
      const first = group[0];
      /**
       * La fecha de una observancia se expresa en hora local calculada con el
       * desfase ANTERIOR (TZOFFSETFROM), no con el nuevo: el salto de marzo en
       * España se anota como las 02:00, que es la hora que marcaba el reloj
       * justo antes de saltar, no las 03:00. Con el desfase equivocado el
       * cliente coloca las transiciones una hora corridas.
       */
      const localOf = (tr: Transition) => {
        const local = new Date(tr.at + tr.from * 60_000);
        return `${local.toISOString().slice(0, 19).replace(/[-:]/g, '')}`;
      };

      lines.push(`BEGIN:${kind}`);
      lines.push(`DTSTART:${localOf(first)}`);
      lines.push(`TZOFFSETFROM:${formatOffset(first.from)}`);
      lines.push(`TZOFFSETTO:${formatOffset(first.to)}`);
      const rest = group.slice(1);
      if (rest.length > 0) {
        lines.push(`RDATE:${rest.map(localOf).join(',')}`);
      }
      lines.push(`END:${kind}`);
    }
  }

  lines.push('END:VTIMEZONE');
  vtimezoneCache.set(cacheKey, lines);
  return lines;
}

// ---------------------------------------------------------------------------
// Construcción de los eventos
// ---------------------------------------------------------------------------

/**
 * Categoría que el nombre del circuito ya lleva implícita. Sirve solo para no
 * escribir "Copa del Mundo Junior · Florete M20 M", que es redundante. Si la
 * prueba no coincide con la categoría implícita, la categoría se escribe: nunca
 * se oculta un dato, solo se evita repetirlo.
 */
const CATEGORIA_IMPLICITA: Record<string, string> = {
  CAD_WC: 'M17',
  JUN_WC: 'M20',
  SEN_WC: 'ABS',
  SEN_GP: 'ABS',
  ECC: 'M17',
  U14_EFC: 'M14',
  SUB23_EFC: 'M23',
  EUV: 'VET',
};

/**
 * Título del evento en el calendario del usuario.
 *
 * Se prefiere el nombre del circuito al nombre publicado porque los nombres de
 * las fuentes son irregulares (unos en inglés, otros repitiendo el arma dentro
 * del propio nombre) y en una lista de calendario lo que se busca es reconocer
 * de un vistazo de qué prueba se trata. El nombre literal de la fuente va
 * siempre en la descripción, así que no se pierde.
 */
function buildSummary(ev: EventView, comp: CompetitionView): string {
  const circuitLabel = ev.circuit !== 'OTRO' ? CIRCUIT_LABEL[ev.circuit] : null;
  const title = circuitLabel ?? ev.name;

  const weapon = WEAPON_LABEL[comp.weapon];
  const gender = GENDER_SHORT[comp.gender];
  const implicit = CATEGORIA_IMPLICITA[ev.circuit];
  const categoryLabel = CATEGORY_LABEL[comp.category] ?? comp.categoryRaw ?? comp.category;
  const showCategory = !circuitLabel || implicit !== comp.category;

  const prueba = [weapon, gender, showCategory ? categoryLabel : null]
    .filter(Boolean)
    .join(' ');

  const lugar = ev.city ?? countryName(ev.country) ?? 'sede no publicada';

  const partes = [title, prueba, lugar];
  if (comp.format === 'EQUIPOS') partes.splice(2, 0, 'Equipos');

  return partes.join(' · ');
}

/**
 * LOCATION geocodificable: sede, dirección, ciudad y país en una sola línea y
 * en ese orden, que es lo que entienden Google Maps y Apple Maps cuando el
 * usuario toca la dirección desde la ficha del evento.
 */
function buildLocation(ev: EventView): string | null {
  const parts = [ev.venue, ev.venueAddress, ev.city, countryName(ev.country)]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    // La ciudad suele venir repetida dentro de la dirección completa.
    .filter((p, i, arr) => arr.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);

  return parts.length > 0 ? parts.join(', ') : null;
}

function formatDeadlineLine(d: ComputedDeadline): string {
  const label = d.label || DEADLINE_TYPE_LABEL[d.type];
  const origen = d.origin === 'CALCULADO' ? ' (estimado, no publicado)' : '';
  const recargo =
    d.surchargeEur && Number.parseFloat(d.surchargeEur) > 0
      ? ` · después, ${formatEur(d.surchargeEur)} de recargo`
      : d.blocking
        ? ' · después ya no se puede inscribir'
        : '';
  return `- ${label}: ${formatDateTimeEs(d.deadlineAt)}${origen}${recargo}`;
}

function buildDescription(
  ev: EventView,
  comp: CompetitionView,
  fichaUrl: string,
  tieneHora: boolean,
): string {
  const lines: string[] = [];

  lines.push(`Prueba: ${WEAPON_LABEL[comp.weapon]} ${GENDER_LABEL[comp.gender]} ` +
    `${CATEGORY_LABEL[comp.category] ?? comp.category} ` +
    `${comp.format === 'EQUIPOS' ? 'por equipos' : 'individual'}`);
  lines.push(`Competición: ${ev.name}`);
  lines.push(`Fechas del evento: ${formatDateRangeEs(ev.startDate, ev.endDate)}`);

  const location = buildLocation(ev);
  lines.push(`Sede: ${location ?? 'no publicada'}`);

  // Horarios del día tal y como los publica la fuente. Lo que no publica se
  // dice "no publicado"; no se rellena con una hora plausible.
  const horarios: string[] = [];
  if (comp.installationOpen) horarios.push(`apertura ${comp.installationOpen}`);
  if (comp.callTime) horarios.push(`llamada ${comp.callTime}`);
  if (comp.scratchTime) horarios.push(`scratch ${comp.scratchTime}`);
  if (comp.startTime) horarios.push(`inicio ${comp.startTime}`);
  lines.push(`Horarios: ${horarios.length > 0 ? horarios.join(' · ') : 'no publicados'}`);

  lines.push(`Cuota: ${formatEur(comp.feeEur)}`);
  lines.push(
    `Inscritos: ${
      comp.registrationCount === null ? 'no publicado' : comp.registrationCount
    }`,
  );

  lines.push('');
  if (comp.deadlines.length === 0) {
    lines.push('Plazos: no publicados.');
  } else {
    lines.push('Plazos de inscripción:');
    for (const d of comp.deadlines) lines.push(formatDeadlineLine(d));
    if (comp.status.hasEstimates) {
      lines.push(
        'Los plazos marcados como estimados salen de la normativa general, no ' +
          'de la convocatoria de esta prueba. Comprueba siempre la oficial.',
      );
    }
  }

  const tz = timezoneInfo(ev.timezone, ev.startDate, ev.endDate);
  if (tz && tz.diffHours !== 0) {
    lines.push('');
    lines.push(`Huso horario de la sede: ${tz.label}.`);
    if (tz.dstNote) lines.push(tz.dstNote);
  }

  if (tieneHora) {
    lines.push('');
    lines.push(
      `La hora de fin no la publica la fuente: se muestran ` +
        `${DURACION_ORIENTATIVA_HORAS} horas a título orientativo.`,
    );
  }

  if (ev.notes) {
    lines.push('');
    lines.push(`Observaciones de la fuente: ${ev.notes}`);
  }

  lines.push('');
  if (ev.sourceUrl) lines.push(`Fuente oficial: ${ev.sourceUrl}`);
  if (ev.officialSite) lines.push(`Web del organizador: ${ev.officialSite}`);
  lines.push(`Ficha en la app: ${fichaUrl}`);

  return lines.join('\n');
}

/**
 * Recordatorio antes del cierre. Es la razón de ser del feed: enterarse del
 * plazo sin tener que abrir nada.
 *
 * Aviso honesto: Google Calendar ignora los VALARM de los calendarios
 * SUSCRITOS (solo respeta los suyos), mientras que Apple Calendar y la mayoría
 * de clientes de escritorio sí los aplican. Se emiten igualmente porque a quien
 * los respeta le resuelven el problema, y el aviso por correo del cron cubre al
 * resto.
 */
function buildAlarms(comp: CompetitionView, now: Date): string[] {
  const lines: string[] = [];

  const candidatos = comp.deadlines.filter(
    (d) => d.type === 'L1' || d.blocking,
  );

  for (const d of candidatos) {
    const trigger = new Date(d.deadlineAt.getTime() - AVISO_DIAS_ANTES * 86_400_000);
    // Una alarma en el pasado hace que algunos clientes la disparen nada más
    // suscribirse. No aporta nada y molesta.
    if (trigger.getTime() <= now.getTime()) continue;

    const label = d.label || DEADLINE_TYPE_LABEL[d.type];
    const consecuencia = d.blocking
      ? 'Después de esa fecha ya no se puede inscribir.'
      : d.surchargeEur && Number.parseFloat(d.surchargeEur) > 0
        ? `Después son ${formatEur(d.surchargeEur)} de recargo.`
        : 'Después cambian las condiciones de inscripción.';

    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER;VALUE=DATE-TIME:${toIcalUtc(trigger)}`,
      `DESCRIPTION:${escapeIcalText(
        `${label}: ${formatDateTimeEs(d.deadlineAt)}. ${consecuencia}`,
      )}`,
      'END:VALARM',
    );
  }

  return lines;
}

type BuildEventContext = {
  baseUrl: string;
  now: Date;
  dtstamp: string;
};

function buildVEvent(
  ev: EventView,
  comp: CompetitionView,
  ctx: BuildEventContext,
): { lines: string[]; timeZone: string | null; year: number } {
  const lines: string[] = [];

  const fecha = comp.competitionDate ?? ev.startDate;
  const hora = parseWallTime(comp.startTime);
  // Si no se conoce el huso de la sede no se puede anclar una hora concreta:
  // se degrada a evento de día completo antes que colocarla en un huso que no
  // es el suyo.
  const timeZone = hora ? (ev.timezone ?? 'Europe/Madrid') : null;

  lines.push('BEGIN:VEVENT');
  lines.push(`UID:comp-${comp.id}@${UID_DOMAIN}`);
  lines.push(`DTSTAMP:${ctx.dtstamp}`);

  if (hora && timeZone) {
    const fin = addWallHours(fecha, hora.hour, hora.minute, DURACION_ORIENTATIVA_HORAS);
    lines.push(`DTSTART;TZID=${timeZone}:${toIcalLocal(fecha, hora.hour, hora.minute)}`);
    lines.push(`DTEND;TZID=${timeZone}:${toIcalLocal(fin.date, fin.hour, fin.minute)}`);
  } else {
    // DTEND de un evento de día completo es EXCLUSIVO (RFC 5545 §3.6.1): para
    // que el último día se pinte, hay que sumar uno.
    const inicio = comp.competitionDate ?? ev.startDate;
    const fin = comp.competitionDate ?? ev.endDate;
    lines.push(`DTSTART;VALUE=DATE:${toIcalDate(inicio)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcalDate(isoPlusDays(fin, 1))}`);
  }

  const fichaUrl = `${ctx.baseUrl.replace(/\/+$/, '')}/calendario?evento=${ev.id}`;

  lines.push(`SUMMARY:${escapeIcalText(buildSummary(ev, comp))}`);

  const location = buildLocation(ev);
  if (location) lines.push(`LOCATION:${escapeIcalText(location)}`);

  if (ev.geoLat && ev.geoLon) {
    // GEO no lleva escapado: son dos números separados por punto y coma.
    lines.push(`GEO:${ev.geoLat};${ev.geoLon}`);
  }

  lines.push(
    `DESCRIPTION:${escapeIcalText(
      buildDescription(ev, comp, fichaUrl, Boolean(hora)),
    )}`,
  );

  // URL apunta a nuestra ficha, que a su vez enlaza a la fuente: desde el móvil
  // es el único enlace que abre algo con todo el contexto.
  lines.push(`URL:${fichaUrl}`);

  const categorias = [
    'Esgrima',
    WEAPON_LABEL[comp.weapon],
    CATEGORY_LABEL[comp.category] ?? comp.category,
    ev.scope === 'NACIONAL'
      ? 'Nacional'
      : ev.scope === 'INTERNACIONAL'
        ? 'Internacional'
        : 'Autonómico',
  ];
  lines.push(`CATEGORIES:${categorias.map(escapeIcalText).join(',')}`);

  lines.push('TRANSP:OPAQUE');
  lines.push(ev.disappearedAt ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED');

  /**
   * SEQUENCE derivado del contenido.
   *
   * Los clientes solo aceptan una revisión de un evento ya conocido si cambia
   * algo que les indique que es nueva. No guardamos un contador de revisiones
   * por prueba, así que se deriva un número de 16 bits del contenido que le
   * importa al usuario: si cambia la fecha, la sede, la cuota o un plazo,
   * cambia SEQUENCE y el evento se actualiza; si no cambia nada, se mantiene y
   * no se genera ruido en el móvil todas las noches.
   *
   * Limitación conocida y asumida: un hash no es monótono creciente, así que un
   * cliente muy estricto podría ignorar una revisión cuyo hash sea menor que el
   * anterior. A cambio se evita el mal mayor, que es marcar como modificados
   * todos los eventos en cada ingestión.
   */
  const huella = [
    comp.id,
    fecha,
    comp.startTime ?? '',
    ev.startDate,
    ev.endDate,
    location ?? '',
    comp.feeEur ?? '',
    ev.disappearedAt ? 'cancelado' : '',
    ...comp.deadlines.map((d) => `${d.type}:${d.deadlineAt.toISOString()}`),
  ].join('|');
  lines.push(`SEQUENCE:${fnv1a(huella) % 65_536}`);

  lines.push(...buildAlarms(comp, ctx.now));
  lines.push('END:VEVENT');

  return { lines, timeZone, year: Number.parseInt(fecha.slice(0, 4), 10) };
}

// ---------------------------------------------------------------------------
// Feed completo
// ---------------------------------------------------------------------------

export type IcalFeedOptions = {
  type: FeedType;
  events: EventView[];
  /** Origen público de la app, para construir los enlaces a la ficha. */
  baseUrl: string;
  /**
   * Si se indica, solo se emiten estas pruebas. Lo usa el feed de
   * convocatorias, donde lo que interesa no es "para lo que eres elegible"
   * sino "aquello a lo que te han convocado".
   */
  onlyCompetitionIds?: ReadonlySet<string> | null;
  now?: Date;
};

/**
 * Construye el fichero .ics completo de un feed.
 *
 * Es síncrono y puro: entra una lista de eventos ya filtrada y sale texto. Toda
 * la lógica de "qué eventos le tocan a esta persona" vive en la ruta, no aquí.
 */
export function buildIcalFeed(options: IcalFeedOptions): string {
  const { type, events, baseUrl } = options;
  const now = options.now ?? new Date();
  const meta = FEED_META[type];

  const ctx: BuildEventContext = { baseUrl, now, dtstamp: toIcalUtc(now) };

  const eventLines: string[] = [];
  const usedTimeZones = new Set<string>();
  let minYear = now.getUTCFullYear();
  let maxYear = now.getUTCFullYear();

  for (const ev of events) {
    for (const comp of ev.competitions) {
      if (options.onlyCompetitionIds && !options.onlyCompetitionIds.has(comp.id)) {
        continue;
      }
      const built = buildVEvent(ev, comp, ctx);
      eventLines.push(...built.lines);
      if (built.timeZone) {
        usedTimeZones.add(built.timeZone);
        minYear = Math.min(minYear, built.year);
        maxYear = Math.max(maxYear, built.year);
      }
    }
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Calendario Esgrima//Feed iCal 1.0//ES`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcalText(meta.name)}`,
    `NAME:${escapeIcalText(meta.name)}`,
    `X-WR-CALDESC:${escapeIcalText(meta.description)}`,
    `DESCRIPTION:${escapeIcalText(meta.description)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    `COLOR:${meta.color}`,
    `X-APPLE-CALENDAR-COLOR:${meta.appleColor}`,
    /**
     * Sugerencia de frecuencia de refresco. Los datos se ingieren de madrugada,
     * así que cada 6 horas va sobrado; pedir menos solo castigaría al servidor y
     * los clientes tampoco suelen bajar de ahí.
     */
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  // Los VTIMEZONE van antes que los VEVENT que los referencian.
  for (const tz of usedTimeZones) {
    lines.push(...buildVTimezone(tz, minYear - 1, maxYear + 1));
  }

  lines.push(...eventLines);
  lines.push('END:VCALENDAR');

  // Un fichero iCal termina siempre con CRLF, también la última línea.
  return `${lines.map(foldIcalLine).join(CRLF)}${CRLF}`;
}
