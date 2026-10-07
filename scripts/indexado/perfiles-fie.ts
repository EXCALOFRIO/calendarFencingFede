/**
 * Lectura de la ficha pública de un tirador en la FIE (`GET /api/fie/fencer/<id>`,
 * la misma que usa `fie.org/athletes/<id>`). Sin red ni base: sólo convierte la
 * respuesta cruda en los campos de perfil que interesan.
 *
 * Qué publica (comprobado el 05/10/2026 con 21966 Llavador y 49385 Zabala):
 *   id, name («LLAVADOR Carlos»), firstName, lastName, country, countryCode,
 *   gender, date (nacimiento ISO), hand (L/R), height (casi siempre null),
 *   image, club (null), fencerBiography{club, residence, birthplace, coaches},
 *   graceNoteBiography[{header, rows[{title, content}]}] («Club / Team»,
 *   «Handedness»…), licenseNumber (DDMMAAAA + 3 dígitos), licenseStatus,
 *   rank, points, weapon, category, medals, olympicMedals, worldChampionshipMedals.
 * No publica el segundo apellido en `name`; a veces sí en el nombre del archivo
 * de la foto («165113-LLAVADOR_FERNANDEZ_CARLOS_PAM478161.jpg»).
 */

export type ManoFie = 'zurdo' | 'diestro';

export type ClubFie = { nombre: string; pais: string | null };

export type AtletaFie = {
  fieId: number;
  nombrePublicado: string;
  nombre: string | null;
  apellidos: string | null;
  pais: string | null;
  genero: string | null;
  fechaNacimiento: string | null;
  mano: ManoFie | null;
  alturaCm: number | null;
  /** Clubes publicados, del más explícito (`club`) a la biografía de GraceNote. */
  clubes: ClubFie[];
  residencia: string | null;
  lugarNacimiento: string | null;
  foto: string | null;
  /**
   * Palabras del nombre del archivo de la foto, en mayúsculas y con los acentos
   * que tenga. Hay erratas («MOREALES»): sólo sirve como pista de acentos, nunca
   * para añadir apellidos.
   */
  palabrasFoto: string[];
  licenciaEstado: string | null;
  arma: string | null;
  categoria: string | null;
  puestoMundial: number | null;
  puntos: string | null;
  medallas: { olimpicas: number; mundiales: number; total: number };
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The FIE publishes 1920-01-01 when it does not know the birth date (147 athletes on 7/10/2026). */
export const FECHA_COMODIN_FIE = '1920-01-01';

/** A FIE birth date, or null when it is missing, malformed or the placeholder. */
export function fechaFieReal(fecha: unknown): string | null {
  return typeof fecha === 'string' && ISO.test(fecha) && fecha !== FECHA_COMODIN_FIE ? fecha : null;
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpio = v.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  return limpio === '' ? null : limpio;
}

function entero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Mano publicada: el campo `hand` (L/R) y, si falta, GraceNote «Handedness». */
export function manoDeFie(hand: unknown, graceNote: string | null): ManoFie | null {
  const h = typeof hand === 'string' ? hand.trim().toUpperCase() : '';
  if (h === 'L') return 'zurdo';
  if (h === 'R') return 'diestro';
  const g = (graceNote ?? '').toLowerCase();
  if (/^left/.test(g)) return 'zurdo';
  if (/^right/.test(g)) return 'diestro';
  return null;
}

/**
 * Altura en centímetros. La FIE la publica como número o texto; si viniera en
 * metros (1.85) se pasa a cm. Fuera de 120–230 cm no se cree.
 */
export function alturaCm(v: unknown): number | null {
  let n = entero(v);
  if (n === null && typeof v === 'string') {
    const m = v.match(/(\d+(?:[.,]\d+)?)\s*(cm|m)?/i);
    if (m) n = Number(m[1].replace(',', '.')) * (m[2]?.toLowerCase() === 'm' ? 100 : 1);
  }
  if (n === null) return null;
  if (n > 0 && n < 3) n = n * 100;
  n = Math.round(n);
  return n >= 120 && n <= 230 ? n : null;
}

/**
 * «Sala de Armas de Madrid [ESP] / Frascati Scherma [ITA]: » → dos clubes.
 * GraceNote separa clubes con « / » y termina a veces con «:».
 */
export function clubesDeGraceNote(contenido: string | null): ClubFie[] {
  if (!contenido) return [];
  return contenido
    .replace(/[:;\s]+$/, '')
    .split(/\s+\/\s+|;\s*/)
    .map((trozo) => {
      // «Club de Esgrima de Madrid: Spain» lleva el país detrás de los dos puntos.
      const sinPais = trozo.trim().replace(/:\s*[\p{L} ]*$/u, '').trim();
      const m = sinPais.match(/^(.*?)\s*\[([A-Z]{3})\]\s*$/);
      const nombre = (m ? m[1] : sinPais).replace(/\s*\([^)]*\)\s*$/, '').trim();
      return { nombre, pais: m ? m[2] : null };
    })
    .filter((c) => c.nombre.length >= 3);
}

/** «.../165113-LLAVADOR_FERNANDEZ_CARLOS_PAM478161.jpg» → [LLAVADOR, FERNANDEZ, CARLOS]. */
export function palabrasDeFoto(url: string | null): string[] {
  if (!url) return [];
  let archivo: string;
  try {
    archivo = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return [];
  }
  const base = archivo.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+-/, '');
  return base
    .normalize('NFC')
    .toUpperCase()
    .split(/[_\-\s.]+/)
    // Fuera códigos de archivo («PAM478161», «2», «IMG»): sólo palabras de letras.
    .filter((p) => /^\p{L}{2,}$/u.test(p) && !/^(IMG|JPG|JPEG|PNG|PHOTO|FOTO|COPY|NEW|ESP)$/.test(p));
}

function graceNote(raw: Record<string, unknown>, titulo: RegExp): string | null {
  const bloques = Array.isArray(raw.graceNoteBiography) ? raw.graceNoteBiography : [];
  for (const b of bloques) {
    const filas = b && typeof b === 'object' && Array.isArray((b as { rows?: unknown }).rows)
      ? ((b as { rows: unknown[] }).rows)
      : [];
    for (const f of filas) {
      if (!f || typeof f !== 'object') continue;
      const { title, content } = f as { title?: unknown; content?: unknown };
      if (typeof title === 'string' && titulo.test(title.trim())) return texto(content);
    }
  }
  return null;
}

function medallas(raw: Record<string, unknown>): AtletaFie['medallas'] {
  const suma = (k: string) => {
    const m = raw[k];
    if (!m || typeof m !== 'object') return 0;
    const o = m as Record<string, unknown>;
    return (entero(o.gold) ?? 0) + (entero(o.silver) ?? 0) + (entero(o.bronze) ?? 0);
  };
  const olimpicas = suma('olympicMedals') + suma('olympicTeamMedals');
  const mundiales = suma('worldChampionshipMedals') + suma('worldChampionshipTeamMedals');
  const total = Array.isArray(raw.medals) ? raw.medals.length : 0;
  return { olimpicas, mundiales, total };
}

/** `null` si la respuesta no es la ficha del ID pedido. */
export function leerAtletaFie(raw: unknown, fieId: number): AtletaFie | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.id !== fieId) return null;
  const nombrePublicado = texto(o.name);
  if (!nombrePublicado) return null;

  const bio = o.fencerBiography && typeof o.fencerBiography === 'object'
    ? (o.fencerBiography as Record<string, unknown>)
    : {};
  const clubes: ClubFie[] = [];
  const anadir = (c: ClubFie) => {
    if (!clubes.some((x) => x.nombre.toLowerCase() === c.nombre.toLowerCase())) clubes.push(c);
  };
  const clubDirecto = texto(o.club) ?? texto(bio.club);
  if (clubDirecto) for (const c of clubesDeGraceNote(clubDirecto)) anadir(c);
  for (const c of clubesDeGraceNote(graceNote(o, /^club\s*\/\s*team$/i))) anadir(c);

  const fecha = fechaFieReal(o.date);
  const foto = texto(o.image);
  return {
    fieId,
    nombrePublicado,
    nombre: texto(o.firstName),
    apellidos: texto(o.lastName),
    pais: texto(o.countryCode),
    genero: texto(o.gender),
    fechaNacimiento: fecha,
    mano: manoDeFie(o.hand, graceNote(o, /^handedness$/i)),
    alturaCm: alturaCm(o.height) ?? alturaCm(graceNote(o, /^height$/i)),
    clubes,
    residencia: texto(bio.residence) ?? graceNote(o, /^residence$/i),
    lugarNacimiento: texto(bio.birthplace) ?? graceNote(o, /^place of birth$/i),
    foto,
    palabrasFoto: palabrasDeFoto(foto),
    licenciaEstado: texto(o.licenseStatus),
    arma: texto(o.weapon),
    categoria: texto(o.category),
    puestoMundial: entero(o.rank),
    puntos: texto(o.points),
    medallas: medallas(o),
  };
}
