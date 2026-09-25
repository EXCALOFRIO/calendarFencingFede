import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** SHA-256 en hexadecimal. Se usa para los `content_hash` de la ingestión. */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Año de una fecha ISO (`YYYY-MM-DD`) leyendo la cadena, no construyendo un
 * `Date`. Mezclar `Date` con horas locales produce desfases de un día, y en
 * categorías por año de nacimiento un día de desfase significa cambiar de
 * categoría. Mejor no dar la oportunidad.
 */
export function yearFromIsoDate(iso: string): number {
  const year = Number.parseInt(iso.slice(0, 4), 10);
  if (Number.isNaN(year)) throw new Error(`Fecha ISO no válida: ${iso}`);
  return year;
}

export function formatEur(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'no publicado';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return 'no publicado';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

export function formatDateEs(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(`${iso.slice(0, 10)}T12:00:00Z`) : iso;
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  }).format(d);
}

export function formatDateTimeEs(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(d);
}

/**
 * Rango de fechas, lo más corto posible sin perder información.
 *
 *   mismo día      -> "24 sept 2026"
 *   mismo mes      -> "24–27 sept 2026"
 *   mismo año      -> "28 sept – 2 oct 2026"
 *   años distintos -> "28 dic 2026 – 3 ene 2027"
 *
 * No es una floritura: la versión larga desbordaba la fila en un iPhone y
 * cortaba el año, que es justo lo que no se puede cortar.
 */
export function formatDateRangeEs(start: string, end: string): string {
  if (start === end) return formatDateEs(start);

  const [ay, am] = [start.slice(0, 4), start.slice(5, 7)];
  const [by, bm] = [end.slice(0, 4), end.slice(5, 7)];

  const dia = (iso: string) => String(Number.parseInt(iso.slice(8, 10), 10));
  const mesAnio = (iso: string) =>
    new Intl.DateTimeFormat('es-ES', {
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/Madrid',
    }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
  const diaMes = (iso: string) =>
    new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Madrid',
    }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

  if (ay === by && am === bm) return `${dia(start)}–${dia(end)} ${mesAnio(end)}`;
  if (ay === by) return `${diaMes(start)} – ${mesAnio(end)}`;
  return `${formatDateEs(start)} – ${formatDateEs(end)}`;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/** Resta días naturales a una fecha ISO y devuelve un `Date` en UTC. */
export function isoDateMinusDays(iso: string, days: number): Date {
  const base = new Date(`${iso.slice(0, 10)}T23:59:59Z`);
  return new Date(base.getTime() - days * 86_400_000);
}

export const WEAPON_LABEL = {
  FLORETE: 'Florete',
  ESPADA: 'Espada',
  SABLE: 'Sable',
} as const;

/** Abreviatura de arma para las celdas del mes, donde no cabe el nombre. */
export const WEAPON_SHORT = {
  FLORETE: 'FLO',
  ESPADA: 'ESP',
  SABLE: 'SAB',
} as const;

export const GENDER_LABEL = {
  M: 'Masculino',
  F: 'Femenino',
  MIXTO: 'Mixto',
} as const;

export const GENDER_SHORT = { M: 'M', F: 'F', MIXTO: 'Mx' } as const;

export const CATEGORY_LABEL = {
  M9: 'M9',
  M11: 'M11',
  M13: 'M13',
  M14: 'M14',
  M15: 'M15',
  M17: 'M17',
  M20: 'M20',
  M23: 'M23',
  ABS: 'Absoluto',
  VET: 'Veteranos',
} as const;

export const CIRCUIT_LABEL: Record<string, string> = {
  TNR: 'Torneo Nacional de Ranking',
  LIGA_CLUBES: 'Liga de Clubes',
  CONCENTRACION: 'Concentración',
  // Skermo etiqueta igual todas las pruebas de la FIE, sin distinguir Copa del
  // Mundo de Gran Premio o Satélite. Se dice lo que se sabe, ni más ni menos.
  FIE_CIRCUITO: 'Circuito FIE',
  SUB23_EFC: 'Circuito Europeo Sub-23',
  EFC_LEAGUE: 'EFC Eurofence League',
  LIGA_ORO: 'Liga de Oro',
  LIGA_PLATA: 'Liga de Plata',
  LIGA_IBERDROLA: 'Liga Iberdrola',
  LIGA_BRONCE: 'Liga de Bronce',
  EUR_CLUBES: 'Copa de Europa de Clubes',
  CTO_ESPANA: 'Campeonato de España',
  SATELITE: 'Satélite FIE',
  ECC: 'Circuito Europeo Cadete',
  U14_EFC: 'Circuito Europeo U14',
  EUV: 'Circuito Europeo de Veteranos',
  CAD_WC: 'Copa del Mundo Cadete',
  JUN_WC: 'Copa del Mundo Júnior',
  SEN_WC: 'Copa del Mundo Absoluta',
  SEN_GP: 'Gran Premio FIE',
  CTO_EUROPA: 'Campeonato de Europa',
  CTO_MUNDO: 'Campeonato del Mundo',
  TLM: 'Trofeo Ciudad / TLM',
  OTRO: 'Otra prueba',
};

/** Versión corta para las pastillas de las celdas del mes. */
export const CIRCUIT_SHORT: Record<string, string> = {
  TNR: 'TNR',
  LIGA_CLUBES: 'Clubes',
  CONCENTRACION: 'Concentración',
  FIE_CIRCUITO: 'Circuito FIE',
  SUB23_EFC: 'EFC Sub-23',
  EFC_LEAGUE: 'EFC League',
  LIGA_ORO: 'Liga de Oro',
  LIGA_PLATA: 'Liga de Plata',
  LIGA_IBERDROLA: 'Iberdrola',
  LIGA_BRONCE: 'Liga de Bronce',
  EUR_CLUBES: 'Copa Europa Clubes',
  CTO_ESPANA: 'Cto. España',
  SATELITE: 'Satélite',
  ECC: 'EFC Cadete',
  U14_EFC: 'EFC U14',
  EUV: 'EFC Veteranos',
  CAD_WC: 'C. Mundo Cadete',
  JUN_WC: 'C. Mundo Júnior',
  SEN_WC: 'Copa del Mundo',
  SEN_GP: 'Gran Premio',
  CTO_EUROPA: 'Cto. Europa',
  CTO_MUNDO: 'Cto. Mundo',
  TLM: 'Trofeo',
  OTRO: 'Prueba',
};

export const SOURCE_LABEL: Record<string, string> = {
  skermo_rfee: 'Skermo · RFEE',
  skermo_regional: 'Skermo · autonómica',
  fie: 'FIE',
  efc: 'EFC',
  rfee_wp: 'esgrima.es',
};

export type Organismo = 'RFEE' | 'FIE' | 'EFC' | 'AUT';

const CIRCUITOS_FIE = new Set([
  'FIE_CIRCUITO',
  'SATELITE',
  'CAD_WC',
  'JUN_WC',
  'SEN_WC',
  'SEN_GP',
  'CTO_MUNDO',
]);

const CIRCUITOS_EFC = new Set([
  'ECC',
  'U14_EFC',
  'SUB23_EFC',
  'EFC_LEAGUE',
  'EUV',
  'CTO_EUROPA',
  'EUR_CLUBES',
]);

/**
 * Quién organiza la prueba.
 *
 * Es la distinción que de verdad usa un tirador para leer el calendario de un
 * vistazo, y por eso es lo que colorea cada pastilla del mes.
 *
 * Se decide por el CIRCUITO, no por la fuente de la que se leyó. Parece un
 * detalle y no lo es: el calendario de la RFEE en Skermo republica las Copas
 * del Mundo, así que mirando la fuente todas salían marcadas como nacionales.
 * Una Copa del Mundo no es una prueba de la RFEE aunque la RFEE la publique.
 */
export function organismoDe(
  source: string,
  scope: string,
  circuit?: string,
): Organismo {
  if (circuit && CIRCUITOS_FIE.has(circuit)) return 'FIE';
  if (circuit && CIRCUITOS_EFC.has(circuit)) return 'EFC';
  if (source === 'fie') return 'FIE';
  if (source === 'efc') return 'EFC';
  if (source === 'skermo_regional' || scope === 'AUTONOMICO') return 'AUT';
  return 'RFEE';
}

/** Primera letra en mayúscula y el resto tal cual. */
export function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Siglas y códigos que NO se convierten a minúscula al titular un nombre.
 * Se amplía cuando aparezca una nueva; de momento son las del calendario real.
 */
const SIGLAS = new Set([
  'TNR','FIE','EFC','RFEE','CTO','GP','WC','PFCAR','ABS','VET','SUB23','U14',
  'M9','M11','M13','M14','M15','M17','M20','M23','I','II','III','IV','V','VI',
  'VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX',
  'XX','XXI','XXII','XXIII','XXIV','XXV','A','B','C','D',
]);

/** Palabras que van en minúscula salvo al principio. */
const MINUSCULAS = new Set([
  'de','del','la','las','el','los','y','e','en','a','al','por','para','con','o','u',
]);

/**
 * Pone en forma de título un nombre que la fuente publica en MAYÚSCULAS.
 *
 * Los calendarios federativos escriben "COPA MUNDO JÚNIOR" y
 * "LIGA NACIONAL IBERDROLA 1ª JORNADA". Una pantalla entera en mayúsculas se
 * lee peor y parece que grita. Esto es presentación, no alteración del dato:
 * el nombre original se conserva tal cual en la base y se enseña sin tocar en
 * la ficha, junto al enlace a la fuente.
 *
 * Si el nombre NO viene en mayúsculas, se devuelve intacto: no se corrige a
 * nadie que ya lo haya escrito bien.
 */
export function titular(nombre: string): string {
  const letras = nombre.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (!letras) return nombre;

  const mayusculas = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  // Menos del 85 % en mayúsculas significa que ya está escrito como texto.
  if (mayusculas / letras.length < 0.85) return nombre;

  return nombre
    .toLocaleLowerCase('es-ES')
    .split(/(\s+)/)
    .map((trozo, i) => {
      if (/^\s+$/.test(trozo)) return trozo;
      const limpio = trozo.replace(/[^\wÁÉÍÓÚÜÑáéíóúüñ]/g, '');
      const sigla = limpio.toLocaleUpperCase('es-ES');
      if (SIGLAS.has(sigla)) return trozo.toLocaleUpperCase('es-ES');
      if (i > 0 && MINUSCULAS.has(limpio)) return trozo;
      return trozo.charAt(0).toLocaleUpperCase('es-ES') + trozo.slice(1);
    })
    .join('');
}

/**
 * Nombres de la FIE, en castellano.
 *
 * La FIE publica en inglés y en francés: «Samsun World Cup 2026», «Dublin
 * Satellite Tournament 2026», «Gand Satellite Tournament». Cuando el mismo
 * torneo llega tambien por Skermo se usa el nombre español y no hace falta
 * nada de esto, pero hay 34 pruebas que solo están en la FIE y salían en
 * inglés en mitad de un calendario en castellano.
 *
 * Se traduce **la forma**, que es un patrón cerrado y corto: ciudad + tipo de
 * prueba + año. No se traduce nada más, y el nombre original se sigue
 * enseñando tal cual en la ficha, al lado del enlace a la fuente, porque es
 * como está publicado oficialmente.
 */

/** Tipos de prueba de la FIE, de más específico a más general. */
const TIPOS_FIE: [RegExp, string][] = [
  [/\bcadet\s+world\s+championships?\b/i, 'Campeonato del Mundo Cadete'],
  [/\bjunior\s+world\s+championships?\b/i, 'Campeonato del Mundo Júnior'],
  [/\bveteran\s+world\s+championships?\b/i, 'Campeonato del Mundo de Veteranos'],
  [/\bworld\s+championships?\b/i, 'Campeonato del Mundo'],
  [/\bcadet\s+european\s+championships?\b/i, 'Campeonato de Europa Cadete'],
  [/\bjunior\s+european\s+championships?\b/i, 'Campeonato de Europa Júnior'],
  [/\beuropean\s+championships?\b/i, 'Campeonato de Europa'],
  [/\bzonal\s+championships?\b/i, 'Campeonato de Zona'],
  [/\bcadet\s+world\s+cup\b/i, 'Copa del Mundo Cadete'],
  [/\bjunior\s+world\s+cup\b/i, 'Copa del Mundo Júnior'],
  [/\bsatellite\s+tournament\b/i, 'Torneo Satélite'],
  [/\bgrand\s+prix\b/i, 'Gran Premio'],
  [/\bworld\s+cup\b/i, 'Copa del Mundo'],
  [/\bolympic\s+games\b/i, 'Juegos Olímpicos'],
  [/\beuropean\s+games\b/i, 'Juegos Europeos'],
];

/**
 * Ciudades que la FIE publica con su nombre local o inglés y que en español
 * se llaman de otra forma. Solo las que aparecen de verdad en el calendario;
 * lo que no esté aquí se deja como viene, que es mejor que adivinar.
 */
const CIUDADES_ES: Record<string, string> = {
  /**
   * No todo lo que va delante del tipo de prueba es una ciudad: cuando la
   * FIE aún no tiene sede publica «Sabre World Cup 2027», donde «Sabre» es
   * el arma. Traducidas, esas tres dan un título correcto en castellano:
   * «Copa del Mundo de Sable».
   */
  sabre: 'Sable',
  saber: 'Sable',
  epee: 'Espada',
  'épée': 'Espada',
  foil: 'Florete',

  dublin: 'Dublín',
  gand: 'Gante',
  ghent: 'Gante',
  london: 'Londres',
  geneva: 'Ginebra',
  nuremberg: 'Núremberg',
  antwerp: 'Amberes',
  turin: 'Turín',
  torino: 'Turín',
  milano: 'Milán',
  milan: 'Milán',
  copenhagen: 'Copenhague',
  istanbul: 'Estambul',
  warsaw: 'Varsovia',
  prague: 'Praga',
  moscow: 'Moscú',
  athens: 'Atenas',
  bucharest: 'Bucarest',
  lisbon: 'Lisboa',
  cairo: 'El Cairo',
  algiers: 'Argel',
  tbilisi: 'Tiflis',
  seoul: 'Seúl',
  tokyo: 'Tokio',
  beijing: 'Pekín',
  'new york': 'Nueva York',
  'the hague': 'La Haya',
  brussels: 'Bruselas',
  munich: 'Múnich',
  cologne: 'Colonia',
  frankfurt: 'Fráncfort',
  basel: 'Basilea',
  zurich: 'Zúrich',
  lausanne: 'Lausana',
  stockholm: 'Estocolmo',
  gothenburg: 'Gotemburgo',
  bordeaux: 'Burdeos',
  marseille: 'Marsella',
  nice: 'Niza',
  strasbourg: 'Estrasburgo',
  bogota: 'Bogotá',
  belgrade: 'Belgrado',
  sofia: 'Sofía',
  reykjavik: 'Reikiavik',
  'sao paulo': 'São Paulo',
};

/**
 * Título de un torneo, siempre en castellano.
 *
 * Si el nombre es de la FIE y encaja con el patrón «ciudad + tipo + año», se
 * devuelve «Copa del Mundo de Samsun». Si no encaja, se devuelve el nombre
 * pasado por `titular()`, que es lo que hacía antes.
 */
export function titularTorneo(nombre: string): string {
  for (const [patron, tipo] of TIPOS_FIE) {
    const encontrado = nombre.match(patron);
    if (!encontrado) continue;

    // Lo que queda a la izquierda del tipo es la ciudad; a la derecha, el año.
    const ciudadCruda = nombre
      .slice(0, encontrado.index ?? 0)
      .replace(/\s+/g, ' ')
      .trim();

    if (!ciudadCruda) return tipo;

    const ciudad = CIUDADES_ES[ciudadCruda.toLowerCase()] ?? titular(ciudadCruda);
    // «de El Cairo» chirría, así que ese lleva su contracción.
    const enlace = /^el\s/i.test(ciudad) ? `del ${ciudad.slice(3)}` : `de ${ciudad}`;
    return `${tipo} ${enlace}`;
  }

  return titular(nombre);
}
