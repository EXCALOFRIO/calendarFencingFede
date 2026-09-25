/**
 * Ayudas de viaje.
 *
 * Todo lo de aquí sale de datos que ya tenemos (sede, dirección, ciudad, país
 * y huso horario), sin pedir nada a ninguna API externa. Son las cosas que de
 * verdad hacen falta cuando estás de viaje con un torneo: abrir el pabellón en
 * el mapa del móvil de un toque, y saber qué hora es allí.
 */

export const HOME_TIMEZONE = 'Europe/Madrid';

export type VenueLike = {
  venue?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  country?: string | null;
  geoLat?: string | null;
  geoLon?: string | null;
};

export type MapsLinks = {
  /** Consulta legible, útil también para copiar y pegar. */
  query: string;
  google: string;
  apple: string;
  /** Esquema `geo:`: en Android lo abre la app de mapas que tenga el usuario. */
  geo: string;
} | null;

/**
 * Enlaces al pabellón.
 *
 * Se dan los tres porque cada plataforma abre el suyo: Apple Maps en iPhone,
 * Google Maps en Android o escritorio, y `geo:` para quien tenga otra app.
 * Devuelve `null` cuando no hay sede publicada, en lugar de un enlace a una
 * búsqueda vacía que llevaría a ninguna parte.
 */
export function mapsLinks(venueData: VenueLike): MapsLinks {
  const parts = [venueData.venue, venueData.venueAddress, venueData.city]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));

  const hasCoords = Boolean(venueData.geoLat && venueData.geoLon);
  if (parts.length === 0 && !hasCoords) return null;

  const query = parts.join(', ');
  const encoded = encodeURIComponent(query);

  if (hasCoords) {
    const coords = `${venueData.geoLat},${venueData.geoLon}`;
    return {
      query,
      google: `https://www.google.com/maps/search/?api=1&query=${coords}`,
      apple: `https://maps.apple.com/?ll=${coords}&q=${encoded}`,
      geo: `geo:${coords}?q=${coords}(${encoded})`,
    };
  }

  return {
    query,
    google: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
    apple: `https://maps.apple.com/?q=${encoded}`,
    geo: `geo:0,0?q=${encoded}`,
  };
}

/** Desfase respecto a UTC, en minutos, de un huso en un instante concreto. */
function offsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).format(at);

    const match = formatted.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0; // "GMT" a secas = UTC.

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number.parseInt(match[2], 10);
    const minutes = match[3] ? Number.parseInt(match[3], 10) : 0;
    return sign * (hours * 60 + minutes);
  } catch {
    // Huso desconocido: no se inventa un desfase.
    return null;
  }
}

export type TimezoneInfo = {
  /** Diferencia en horas respecto a la hora peninsular española. */
  diffHours: number;
  /** "2 horas más tarde que en España" o "misma hora que en España". */
  label: string;
  /** Hora local en la sede, ahora mismo. */
  localTimeNow: string;
  /**
   * Cierto si entre la víspera y el día siguiente al torneo hay un cambio de
   * hora, aquí o allí. Es el despiste clásico de los viajes de octubre y marzo.
   */
  dstChangeDuringTrip: boolean;
  dstNote: string | null;
};

/**
 * Compara el huso de la sede con el de España y avisa del cambio de hora.
 *
 * Devuelve `null` si no conocemos el huso de la sede. Preferimos no decir nada
 * antes que decir una diferencia horaria equivocada: un aviso erróneo aquí
 * hace que alguien llegue tarde a la verificación de material.
 */
export function timezoneInfo(
  timeZone: string | null | undefined,
  startDate: string,
  endDate: string,
): TimezoneInfo | null {
  if (!timeZone) return null;

  const reference = new Date(`${startDate}T12:00:00Z`);
  const venueOffset = offsetMinutes(timeZone, reference);
  const homeOffset = offsetMinutes(HOME_TIMEZONE, reference);
  if (venueOffset === null || homeOffset === null) return null;

  const diffHours = (venueOffset - homeOffset) / 60;

  let label: string;
  if (diffHours === 0) {
    label = 'Misma hora que en España';
  } else {
    const abs = Math.abs(diffHours);
    const unit = abs === 1 ? 'hora' : 'horas';
    const plural = abs === 1 ? '' : 's';
    label =
      diffHours > 0
        ? `${abs} ${unit} más que en España (allí van adelantado${plural})`
        : `${abs} ${unit} menos que en España (allí van atrasado${plural})`;
  }

  const localTimeNow = new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  // Se mira desde la víspera hasta el día siguiente: los cambios de hora caen
  // en domingo de madrugada, justo cuando la gente viaja.
  const dayBefore = new Date(`${startDate}T12:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayAfter = new Date(`${endDate}T12:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

  const venueChanges =
    offsetMinutes(timeZone, dayBefore) !== offsetMinutes(timeZone, dayAfter);
  const homeChanges =
    offsetMinutes(HOME_TIMEZONE, dayBefore) !== offsetMinutes(HOME_TIMEZONE, dayAfter);

  const dstChangeDuringTrip = venueChanges || homeChanges;
  let dstNote: string | null = null;
  if (dstChangeDuringTrip) {
    if (venueChanges && homeChanges) {
      dstNote =
        'Ojo: ese fin de semana hay cambio de hora en España y en la sede. ' +
        'Comprueba la hora de llamada el mismo día.';
    } else if (venueChanges) {
      dstNote =
        'Ojo: ese fin de semana hay cambio de hora en la sede, no en España. ' +
        'La diferencia horaria no será la misma el domingo que el sábado.';
    } else {
      dstNote =
        'Ojo: ese fin de semana hay cambio de hora en España. ' +
        'Si vuelves el domingo, revisa la hora del vuelo.';
    }
  }

  return { diffHours, label, localTimeNow, dstChangeDuringTrip, dstNote };
}

/**
 * Código de país para mostrar junto a la ciudad.
 *
 * Se descartó el emoji de bandera: en Windows y en Chrome de escritorio no hay
 * tipografía de banderas, así que se ve como dos letras sueltas y descolocadas
 * (comprobado en una captura real). El código ISO en mayúsculas se ve igual en
 * el iPhone, en Android y en el portátil, que es lo que se pedía.
 *
 * Devuelve cadena vacía si no se conoce el país, para no pintar un hueco.
 */
export function countryCode(iso2: string | null | undefined): string {
  if (!iso2 || iso2.length !== 2) return '';
  return iso2.toUpperCase();
}

/** Nombre del país en español, a partir del código. */
export function countryName(iso2: string | null | undefined): string | null {
  if (!iso2 || iso2.length !== 2) return null;
  try {
    return (
      new Intl.DisplayNames(['es'], { type: 'region' }).of(iso2.toUpperCase()) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Texto de sede listo para pintar. Si no hay nada publicado dice justo eso,
 * nunca "TBD" ni un hueco en blanco que parezca un fallo de la app.
 */
export function venueSummary(venueData: VenueLike): string {
  const parts = [venueData.city, countryName(venueData.country)]
    .filter((p): p is string => Boolean(p))
    .filter((p, i, arr) => arr.indexOf(p) === i);

  if (parts.length === 0) return 'Sede no publicada todavía';
  return parts.join(' · ');
}
