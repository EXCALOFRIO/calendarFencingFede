import type { CATEGORIES, CIRCUITS, GENDERS, WEAPONS } from './types';

type Weapon = (typeof WEAPONS)[number];
type Gender = (typeof GENDERS)[number];
type Category = (typeof CATEGORIES)[number];
type Circuit = (typeof CIRCUITS)[number];

/** Quita acentos y normaliza espacios, para comparar etiquetas con holgura. */
export function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Los mapeos devuelven `null` cuando no reconocen el valor, en vez de elegir
 * uno por defecto. Así la fila cae en cuarentena y sale en el panel de admin,
 * que es mejor que publicar una prueba con el arma equivocada.
 */
export function mapWeapon(raw: string | null | undefined): Weapon | null {
  if (!raw) return null;
  const v = normalizeLabel(raw);
  if (v.startsWith('ESPADA') || v === 'E' || v.startsWith('EPEE')) return 'ESPADA';
  if (v.startsWith('FLORETE') || v === 'F' || v.startsWith('FOIL')) return 'FLORETE';
  if (v.startsWith('SABLE') || v === 'S' || v.startsWith('SABRE')) return 'SABLE';
  return null;
}

export function mapGender(raw: string | null | undefined): Gender | null {
  if (!raw) return null;
  const v = normalizeLabel(raw);
  if (v.startsWith('MASCULINO') || v === 'M' || v.startsWith('MEN')) return 'M';
  // Skermo usa "W" para femenino en su formulario de filtros.
  if (v.startsWith('FEMENINO') || v === 'F' || v === 'W' || v.startsWith('WOMEN')) {
    return 'F';
  }
  if (v.startsWith('MIXTO') || v.startsWith('MIXED')) return 'MIXTO';
  return null;
}

/**
 * Categorías. Los veteranos vienen desglosados en Skermo (VET30, VET40, ...)
 * y en la FIE como "V": se colapsan a VET y el texto literal se guarda en
 * `category_raw` para no perder la información.
 */
export function mapCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null;
  const v = normalizeLabel(raw).replace(/[\s.]/g, '');

  if (v.startsWith('VET') || v === 'V' || v.startsWith('VETERAN')) return 'VET';
  if (v === 'ABS' || v.startsWith('ABSOLUT') || v === 'S' || v.startsWith('SENIOR')) {
    return 'ABS';
  }
  // La FIE usa J (junior) y C (cadete), que equivalen a M20 y M17.
  if (v === 'J' || v.startsWith('JUNIOR')) return 'M20';
  if (v === 'C' || v.startsWith('CADET')) return 'M17';

  const m = v.match(/^M(\d{1,2})$/);
  if (m) {
    const code = `M${m[1]}` as Category;
    if ((['M9', 'M11', 'M13', 'M14', 'M15', 'M17', 'M20', 'M23'] as string[]).includes(code)) {
      return code;
    }
  }
  // "U14" (nomenclatura EFC) -> M14.
  const u = v.match(/^U(\d{1,2})$/);
  if (u) return mapCategory(`M${u[1]}`);

  return null;
}

export function mapFormat(raw: string | null | undefined): 'INDIVIDUAL' | 'EQUIPOS' | null {
  if (!raw) return null;
  const v = normalizeLabel(raw);
  if (v.startsWith('INDIVIDUAL') || v === 'IND' || v === 'I') return 'INDIVIDUAL';
  if (v.startsWith('EQUIPO') || v === 'EQ' || v === 'E' || v.startsWith('TEAM')) {
    return 'EQUIPOS';
  }
  return null;
}

/**
 * Circuito a partir del campo "Tipo" de Skermo o del tipo de la FIE.
 * Se cae a OTRO a propósito: el circuito es una etiqueta para agrupar, no un
 * dato del que dependa nada crítico, así que no merece mandar la fila a
 * cuarentena.
 */
export function mapCircuit(raw: string | null | undefined): Circuit {
  if (!raw) return 'OTRO';
  const v = normalizeLabel(raw);

  // --- Valores literales del campo "Tipo" de Skermo (calendario RFEE) ---
  if (v === 'TNR' || v.includes('TORNEO NACIONAL')) return 'TNR';
  if (v.includes('LIGA DE CLUBES')) return 'LIGA_CLUBES';
  if (v.includes('CONCENTRA')) return 'CONCENTRACION';
  if (v.includes('EUROFENCE')) return 'EFC_LEAGUE';
  if (v.includes('CIRCUITO EUROPEO M14') || v.includes('CIRCUITO EUROPEO M-14')) {
    return 'U14_EFC';
  }
  if (v.includes('SUB23') || v.includes('SUB-23')) return 'SUB23_EFC';
  if (v.includes('CADETE EUROPEO') || v.includes('CIRCUITO CADETE')) return 'ECC';
  if (v.includes('COPA EUROPA') || v.includes('EUROPEAN CUP')) return 'ECC';

  // --- Ligas y campeonatos nacionales ---
  if (v.includes('LIGA') && v.includes('ORO')) return 'LIGA_ORO';
  if (v.includes('LIGA') && v.includes('PLATA')) return 'LIGA_PLATA';
  if (v.includes('IBERDROLA')) return 'LIGA_IBERDROLA';
  if (v.includes('CAMPEONATO DE ESPANA') || v.includes('CTO. ESPANA') || v.includes('CTO ESPANA')) {
    return 'CTO_ESPANA';
  }

  // --- Internacionales con tipo explícito (los da la API de la FIE) ---
  if (v.includes('CAMPEONATO DEL MUNDO') || v.includes('WORLD CHAMPIONSHIP')) {
    return 'CTO_MUNDO';
  }
  if (v.includes('CAMPEONATO DE EUROPA') || v.includes('EUROPEAN CHAMPIONSHIP')) {
    return 'CTO_EUROPA';
  }
  if (v.includes('GRAND PRIX') || v.includes('GRAN PREMIO')) return 'SEN_GP';
  if (v.includes('SATELLITE') || v.includes('SATELITE')) return 'SATELITE';
  if (v.includes('VETERAN')) return 'EUV';
  if (v.includes('WORLD CUP') || v.includes('COPA DEL MUNDO')) return 'SEN_WC';

  /**
   * "Circuito FIE" es la etiqueta con la que Skermo mete TODAS las pruebas de
   * la FIE (198 de 425 en el calendario actual), sin distinguir Copa del Mundo
   * de Gran Premio o Satélite. No se adivina cuál es: se marca como circuito
   * FIE genérico y, cuando el mismo evento entre por la API de la FIE (que sí
   * publica el tipo), el upsert lo precisa.
   */
  if (v.includes('CIRCUITO FIE') || v === 'FIE') return 'FIE_CIRCUITO';

  if (v.includes('CIRCUITO EUROPEO')) return 'ECC';
  if (v.includes('U14')) return 'U14_EFC';
  if (v.includes('TROFEO') || v === 'TLM') return 'TLM';

  return 'OTRO';
}

/**
 * Circuito a partir del NOMBRE que publica la fuente.
 *
 * Por qué hace falta: Skermo mete 105 de sus 214 competiciones bajo el mismo
 * "Tipo" —"Circuito FIE"—, así que `mapCircuit` las devuelve todas como
 * `FIE_CIRCUITO` y en el calendario una Copa del Mundo absoluta, un Gran
 * Premio y un satélite se pintan exactamente igual. Pero el nombre SÍ lo dice:
 * «COPA MUNDO CADETE», «GRAND PRIX», «TORNEO SATÉLITE». Esa información estaba
 * ahí y se estaba tirando.
 *
 * Tres reglas de diseño, y las tres importan:
 *
 * 1. Coincidencia EXPLÍCITA sobre el nombre normalizado, nunca heurística. La
 *    lista de patrones sale de agrupar por nombre las 214 filas que hay hoy en
 *    la base, no de imaginar cómo podría llamarse un torneo.
 * 2. El orden importa y es de más específico a más general: «COPA MUNDO
 *    CADETE» tiene que mirarse antes que «COPA MUNDO», o la cadete acabaría
 *    clasificada como absoluta.
 * 3. Lo que no encaja en ninguna regla se queda EXACTAMENTE como estaba. No se
 *    adivina. «JUEGOS EUROPEOS» no tiene código propio, así que conserva el
 *    que traía.
 */
const CIRCUITO_POR_NOMBRE: { patron: RegExp; circuito: Circuit }[] = [
  // --- Campeonatos oficiales. Van primero: «CPTO MUNDO JÚNIOR» es un
  //     campeonato del mundo, no una Copa del Mundo júnior. ---------------
  {
    patron: /^(CPTO|CTO|CAMPEONATO)\.? (DE )?EUROPA\b/,
    circuito: 'CTO_EUROPA',
  },
  {
    patron: /^(CPTO|CTO|CAMPEONATO)\.? (DEL )?MUNDO\b/,
    circuito: 'CTO_MUNDO',
  },
  {
    patron: /^(CPTO|CTO|CAMPEONATO)\.? (DE )?ESPANA\b/,
    circuito: 'CTO_ESPANA',
  },

  // --- Circuito FIE absoluto ---------------------------------------------
  { patron: /\bGRAND PRIX\b|\bGRAN PREMIO\b/, circuito: 'SEN_GP' },
  { patron: /\bTORNEO SATELITE\b|\bSATELLITE TOURNAMENT\b/, circuito: 'SATELITE' },

  // Copas del Mundo: de la más específica a la más general.
  { patron: /\bCOPA MUNDO CADETE\b|\bCOPA DEL MUNDO CADETE\b/, circuito: 'CAD_WC' },
  { patron: /\bCOPA MUNDO JUNIOR\b|\bCOPA DEL MUNDO JUNIOR\b/, circuito: 'JUN_WC' },
  { patron: /\bCOPA MUNDO VETERANO/, circuito: 'EUV' },
  { patron: /\bCOPA MUNDO\b|\bCOPA DEL MUNDO\b/, circuito: 'SEN_WC' },

  // --- Ligas nacionales de clubes ----------------------------------------
  // Skermo las publica todas con el Tipo "LIGA DE CLUBES" y la división solo
  // aparece en el nombre; sin esto, oro, plata, bronce e Iberdrola se ven
  // iguales.
  { patron: /\bLIGA NACIONAL ORO\b/, circuito: 'LIGA_ORO' },
  { patron: /\bLIGA NACIONAL PLATA\b/, circuito: 'LIGA_PLATA' },
  { patron: /\bLIGA NACIONAL BRONCE\b/, circuito: 'LIGA_BRONCE' },
  { patron: /\bLIGA NACIONAL IBERDROLA\b/, circuito: 'LIGA_IBERDROLA' },

  // --- Europeos de la EFC ------------------------------------------------
  /**
   * «COPA EUROPA CLUBES» estaba cayendo en `ECC`, que es el Circuito Europeo
   * CADETE. Son dos cosas distintas y la etiqueta de pantalla lo decía mal:
   * esta es la Copa de Europa de clubes, absoluta y por equipos de club.
   */
  {
    patron: /\bCOPA (DE )?EUROPA (DE )?CLUBES\b|\bEUROPEAN CLUB[S]? CUP\b/,
    circuito: 'EUR_CLUBES',
  },
  { patron: /\bCIRCUITO EUROPEO CADETE\b/, circuito: 'ECC' },
  { patron: /\bCIRCUITO EUROPEO M-?14\b/, circuito: 'U14_EFC' },
  { patron: /\bCIRCUITO EUROPEO SUB-?23\b/, circuito: 'SUB23_EFC' },
  { patron: /\bEUROFENCE LEAGUE\b/, circuito: 'EFC_LEAGUE' },
];

/**
 * Afina el circuito usando el nombre del torneo. Si ninguna regla encaja,
 * devuelve el circuito que ya traía: nunca degrada un dato a `OTRO`.
 */
export function refineCircuitByName(
  name: string | null | undefined,
  actual: Circuit,
): Circuit {
  if (!name) return actual;
  const v = normalizeLabel(name);
  for (const { patron, circuito } of CIRCUITO_POR_NOMBRE) {
    if (patron.test(v)) return circuito;
  }
  return actual;
}

/**
 * Para la FIE: el circuito depende del tipo Y de la categoría (una Copa del
 * Mundo cadete no es lo mismo que una absoluta).
 */
export function mapFieCircuit(type: string | null, category: Category | null): Circuit {
  const base = mapCircuit(type);
  if (base !== 'SEN_WC') return base;
  if (category === 'M17') return 'CAD_WC';
  if (category === 'M20') return 'JUN_WC';
  return 'SEN_WC';
}

/** Circuitos que implican prueba internacional. */
const INTERNATIONAL_CIRCUITS = new Set<Circuit>([
  'SATELITE',
  'FIE_CIRCUITO',
  'ECC',
  'EUR_CLUBES',
  'U14_EFC',
  'SUB23_EFC',
  'EFC_LEAGUE',
  'EUV',
  'CAD_WC',
  'JUN_WC',
  'SEN_WC',
  'SEN_GP',
  'CTO_EUROPA',
  'CTO_MUNDO',
]);

export function inferScope(
  circuit: Circuit,
  fallback: 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO',
): 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO' {
  return INTERNATIONAL_CIRCUITS.has(circuit) ? 'INTERNACIONAL' : fallback;
}

/** `dd/mm/aaaa` -> `aaaa-mm-dd`. Devuelve null si no encaja el formato. */
export function parseSpanishDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = d.padStart(2, '0');
  const month = mo.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12) return null;
  if (Number(day) < 1 || Number(day) > 31) return null;
  return `${y}-${month}-${day}`;
}

/** `dd/mm/aaaa hh:mm` -> `Date`. Se interpreta en hora peninsular española. */
export function parseSpanishDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = parseSpanishDate(raw);
  if (!date) return null;
  const t = raw.match(/(\d{1,2}):(\d{2})/);
  const time = t ? `${t[1].padStart(2, '0')}:${t[2]}` : '00:00';
  const parsed = new Date(`${date}T${time}:00+02:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Un rango "26/09/2026 - 27/09/2026" o una sola fecha.
 * Si solo hay una, inicio y fin coinciden: no se inventa un fin.
 */
export function parseSpanishDateRange(
  raw: string | null | undefined,
): { startDate: string; endDate: string } | null {
  if (!raw) return null;
  const matches = [...raw.matchAll(/(\d{1,2}[/-]\d{1,2}[/-]\d{4})/g)].map((m) =>
    parseSpanishDate(m[1]),
  );
  const valid = matches.filter((d): d is string => d !== null);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort();
  return { startDate: sorted[0], endDate: sorted[sorted.length - 1] };
}

/**
 * Sede -> ciudad y país.
 *
 * Skermo publica la población con una convención muy concreta, comprobada
 * sobre las 425 competiciones del calendario RFEE:
 *
 *   "BUDAPEST (HUN)"        -> ciudad extranjera, país en código FIE de 3 letras
 *   "SOFÍA (BUL)"           -> idem, con acentos
 *   "CIUDAD REAL (ESP)"     -> española, marcada explícitamente
 *   "MADRID"                -> española, sin marcar
 *   "TBD"                   -> la sede NO está decidida todavía
 *   "Ciudad - Provincia - ES" -> formato de la pestaña "Ubicación"
 *
 * De ahí salen tres reglas:
 * - "TBD" (32 casos) devuelve null, no la cadena "TBD". La app mostrará
 *   "sede no publicada", que es la verdad.
 * - Si hay paréntesis, el país sale de ahí.
 * - Si NO hay paréntesis, es España. No es una suposición nuestra: es la
 *   convención del propio calendario, que marca explícitamente lo extranjero.
 */
export type ParsedLocation = {
  city: string | null;
  country: string | null;
};

const UNKNOWN_LOCATIONS = new Set([
  'TBD',
  'TBC',
  'TBA',
  'POR DETERMINAR',
  'A DETERMINAR',
  'SIN DETERMINAR',
  'PENDIENTE',
  'N/A',
  'NA',
  '?',
  '-',
  '--',
]);

/**
 * ¿Es esto un "todavía no se sabe" disfrazado de sede?
 *
 * La API de la FIE publica literalmente `location: "TBD"` en las 35 pruebas de
 * la temporada 2026-2027 cuya sede aún no está decidida. Guardarlo tal cual
 * llenaba el calendario de torneos «en TBD», con botón de mapa incluido, que
 * abría una búsqueda de Google por la palabra "TBD". Eso es peor que no tener
 * el dato: es un dato falso con pinta de oficial.
 *
 * Se exporta porque lo necesitan los dos adaptadores (Skermo por la
 * "Población" del modal, la FIE por `location`/`locationName`).
 */
export function esUbicacionDesconocida(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const texto = normalizeLabel(raw).trim();
  if (!texto) return true;
  return UNKNOWN_LOCATIONS.has(texto);
}

export function parseLocation(
  raw: string | null | undefined,
  options: { assumeCountry?: string | null } = {},
): ParsedLocation {
  if (!raw) return { city: null, country: null };

  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || UNKNOWN_LOCATIONS.has(normalizeLabel(text))) {
    return { city: null, country: null };
  }

  // Formato "Ciudad - Provincia - ES" (pestaña Ubicación).
  const dashParts = text.split(' - ').map((p) => p.trim());
  if (dashParts.length >= 2) {
    const last = dashParts[dashParts.length - 1];
    if (/^[A-Za-z]{2}$/.test(last)) {
      return { city: dashParts[0] || null, country: last.toUpperCase() };
    }
  }

  // Formato "CIUDAD (COD)".
  const paren = text.match(/^(.*?)\s*\(([A-Za-z]{2,3})\)\s*$/);
  if (paren) {
    const city = paren[1].trim() || null;
    return { city, country: fieCountryToIso2(paren[2]) };
  }

  return {
    city: text,
    country: options.assumeCountry ?? null,
  };
}

/** Compatibilidad: devuelve solo el país. */
export function extractCountry(locationText: string | null | undefined): string | null {
  return parseLocation(locationText).country;
}

/** Compatibilidad: devuelve solo la ciudad. */
export function extractCity(locationText: string | null | undefined): string | null {
  return parseLocation(locationText).city;
}

/** Federación FIE (3 letras) -> ISO-3166 alfa-2, para los casos frecuentes. */
const FIE_COUNTRY_TO_ISO2: Record<string, string> = {
  ESP: 'ES',
  FRA: 'FR',
  ITA: 'IT',
  GER: 'DE',
  HUN: 'HU',
  POL: 'PL',
  GBR: 'GB',
  USA: 'US',
  CAN: 'CA',
  JPN: 'JP',
  KOR: 'KR',
  CHN: 'CN',
  TUR: 'TR',
  EGY: 'EG',
  BUL: 'BG',
  ROU: 'RO',
  CZE: 'CZ',
  SUI: 'CH',
  AUT: 'AT',
  BEL: 'BE',
  NED: 'NL',
  POR: 'PT',
  GRE: 'GR',
  ISR: 'IL',
  UKR: 'UA',
  SRB: 'RS',
  CRO: 'HR',
  SLO: 'SI',
  SVK: 'SK',
  EST: 'EE',
  LAT: 'LV',
  LTU: 'LT',
  FIN: 'FI',
  SWE: 'SE',
  NOR: 'NO',
  DEN: 'DK',
  MEX: 'MX',
  BRA: 'BR',
  ARG: 'AR',
  COL: 'CO',
  CHI: 'CL',
  AUS: 'AU',
  NZL: 'NZ',
  HKG: 'HK',
  SGP: 'SG',
  THA: 'TH',
  MAS: 'MY',
  IND: 'IN',
  KAZ: 'KZ',
  UZB: 'UZ',
  AZE: 'AZ',
  GEO: 'GE',
  ARM: 'AM',
  MAR: 'MA',
  TUN: 'TN',
  ALG: 'DZ',
  RSA: 'ZA',
  // Códigos vistos en el calendario real de la RFEE 2026-2027.
  MNE: 'ME',
  ESA: 'SV',
  CRC: 'CR',
  PER: 'PE',
  LUX: 'LU',
  MKD: 'MK',
  BIH: 'BA',
  ALB: 'AL',
  CYP: 'CY',
  MLT: 'MT',
  ISL: 'IS',
  IRL: 'IE',
  MDA: 'MD',
  BLR: 'BY',
  QAT: 'QA',
  UAE: 'AE',
  KSA: 'SA',
  KUW: 'KW',
  BRN: 'BH',
  OMA: 'OM',
  JOR: 'JO',
  LBN: 'LB',
  IRI: 'IR',
  VIE: 'VN',
  PHI: 'PH',
  INA: 'ID',
  TPE: 'TW',
  MGL: 'MN',
  URU: 'UY',
  PAR: 'PY',
  VEN: 'VE',
  ECU: 'EC',
  BOL: 'BO',
  PAN: 'PA',
  GUA: 'GT',
  DOM: 'DO',
  PUR: 'PR',
  CUB: 'CU',
  NGR: 'NG',
  SEN: 'SN',
  CIV: 'CI',
  CMR: 'CM',
  BEN: 'BJ',
  TOG: 'TG',
  BUR: 'BF',
  MRI: 'MU',
  ZIM: 'ZW',
  LBA: 'LY',
  // Códigos del COI que no coinciden con el ISO y aparecen en el calendario
  // real de la RFEE. "SINGAPUR (SIN)" se quedaba sin país y, con él, sin huso.
  SIN: 'SG',
  RUS: 'RU',
  KGZ: 'KG',
  TJK: 'TJ',
  TKM: 'TM',
  NEP: 'NP',
  SRI: 'LK',
  PAK: 'PK',
  BAN: 'BD',
  HON: 'HN',
  NCA: 'NI',
  JAM: 'JM',
  TTO: 'TT',
  BAR: 'BB',
  GUY: 'GY',
  SUR: 'SR',
  AND: 'AD',
  MON: 'MC',
  SMR: 'SM',
  LIE: 'LI',
  KOS: 'XK',
  SYR: 'SY',
  IRQ: 'IQ',
  YEM: 'YE',
  SUD: 'SD',
  ETH: 'ET',
  KEN: 'KE',
  GHA: 'GH',
  ANG: 'AO',
  MAD: 'MG',
  MOZ: 'MZ',
  NAM: 'NA',
  BOT: 'BW',
  ZAM: 'ZM',
  UGA: 'UG',
  TAN: 'TZ',
  GAB: 'GA',
  CGO: 'CG',
  COD: 'CD',
  MLI: 'ML',
  NIG: 'NE',
  GUI: 'GN',
  MTN: 'MR',
};

/**
 * Códigos que la FIE usa como "no hay país", no como país.
 *
 * `FF` es su propia bandera (la de la Fédération, `country: "FIE"`), y viaja
 * en las pruebas cuya sede todavía no está adjudicada. Pasaba el filtro de
 * "dos letras = ISO2" y acabábamos con 34 eventos cuyo país era "FF": un país
 * inexistente que, además, nunca iba a encontrar huso horario en la tabla.
 */
const NON_COUNTRY_CODES = new Set(['FF', 'FIE', 'ZZ', 'XX', 'TBD', 'TBA', 'NA']);

/**
 * Se prefiere el `flag` ISO2 que ya da la API de la FIE; esta tabla es el
 * respaldo. Si no se reconoce, null: mejor "no publicado" que un país mal.
 */
export function fieCountryToIso2(code: string | null | undefined): string | null {
  if (!code) return null;
  const v = code.trim().toUpperCase();
  if (NON_COUNTRY_CODES.has(v)) return null;
  if (v.length === 2) return v;
  return FIE_COUNTRY_TO_ISO2[v] ?? null;
}

/**
 * Huso horario por país, para los avisos de diferencia de hora y cambio
 * horario. Solo se rellena cuando se conoce con certeza; en otro caso null y
 * la app no muestra el aviso, en vez de mostrar uno equivocado.
 */
const ISO2_TIMEZONE: Record<string, string> = {
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  DE: 'Europe/Berlin',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  BE: 'Europe/Brussels',
  NL: 'Europe/Amsterdam',
  LU: 'Europe/Luxembourg',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  SK: 'Europe/Bratislava',
  HU: 'Europe/Budapest',
  SI: 'Europe/Ljubljana',
  HR: 'Europe/Zagreb',
  RS: 'Europe/Belgrade',
  RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia',
  GR: 'Europe/Athens',
  TR: 'Europe/Istanbul',
  UA: 'Europe/Kyiv',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  DK: 'Europe/Copenhagen',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki',
  EE: 'Europe/Tallinn',
  LV: 'Europe/Riga',
  LT: 'Europe/Vilnius',
  IL: 'Asia/Jerusalem',
  EG: 'Africa/Cairo',
  MA: 'Africa/Casablanca',
  TN: 'Africa/Tunis',
  DZ: 'Africa/Algiers',
  ZA: 'Africa/Johannesburg',
  US: 'America/New_York',
  CA: 'America/Toronto',
  MX: 'America/Mexico_City',
  BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  SG: 'Asia/Singapore',
  TH: 'Asia/Bangkok',
  MY: 'Asia/Kuala_Lumpur',
  IN: 'Asia/Kolkata',
  KZ: 'Asia/Almaty',
  UZ: 'Asia/Tashkent',
  AZ: 'Asia/Baku',
  GE: 'Asia/Tbilisi',
  AM: 'Asia/Yerevan',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  // Países que aparecen en el calendario 2026-2027 y no estaban en la tabla.
  // Sin ellos el huso se quedaba a null y se acababa cogiendo el de la FIE,
  // que es su valor por defecto ("Asia/Riyadh") y no el de la sede.
  IS: 'Atlantic/Reykjavik',
  SV: 'America/El_Salvador',
  CR: 'America/Costa_Rica',
  PE: 'America/Lima',
  BH: 'Asia/Bahrain',
  QA: 'Asia/Qatar',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  ME: 'Europe/Podgorica',
  /**
   * Resto de países que la tabla `FIE_COUNTRY_TO_ISO2` sabe traducir pero que
   * se quedaban sin huso. Un país sin huso no rompe nada (la app calla el
   * aviso de diferencia horaria), pero calla justo donde más falta hace: en
   * los torneos de fuera. Se añaden solo los que tienen un huso único; para
   * los países con varios se elige el de la capital, que es el criterio que ya
   * seguía la tabla con US, CA o BR, y se anota cuáles son.
   */
  MK: 'Europe/Skopje',
  BA: 'Europe/Sarajevo',
  AL: 'Europe/Tirane',
  CY: 'Asia/Nicosia',
  MT: 'Europe/Malta',
  MD: 'Europe/Chisinau',
  BY: 'Europe/Minsk',
  XK: 'Europe/Belgrade',
  AD: 'Europe/Andorra',
  MC: 'Europe/Monaco',
  SM: 'Europe/San_Marino',
  LI: 'Europe/Vaduz',
  KW: 'Asia/Kuwait',
  OM: 'Asia/Muscat',
  JO: 'Asia/Amman',
  LB: 'Asia/Beirut',
  IR: 'Asia/Tehran',
  IQ: 'Asia/Baghdad',
  SY: 'Asia/Damascus',
  YE: 'Asia/Aden',
  VN: 'Asia/Ho_Chi_Minh',
  PH: 'Asia/Manila',
  TW: 'Asia/Taipei',
  MN: 'Asia/Ulaanbaatar',
  KG: 'Asia/Bishkek',
  TJ: 'Asia/Dushanbe',
  TM: 'Asia/Ashgabat',
  NP: 'Asia/Kathmandu',
  LK: 'Asia/Colombo',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  UY: 'America/Montevideo',
  PY: 'America/Asuncion',
  VE: 'America/Caracas',
  EC: 'America/Guayaquil',
  BO: 'America/La_Paz',
  PA: 'America/Panama',
  GT: 'America/Guatemala',
  DO: 'America/Santo_Domingo',
  PR: 'America/Puerto_Rico',
  CU: 'America/Havana',
  HN: 'America/Tegucigalpa',
  NI: 'America/Managua',
  JM: 'America/Jamaica',
  TT: 'America/Port_of_Spain',
  BB: 'America/Barbados',
  GY: 'America/Guyana',
  SR: 'America/Paramaribo',
  NG: 'Africa/Lagos',
  SN: 'Africa/Dakar',
  CI: 'Africa/Abidjan',
  CM: 'Africa/Douala',
  BJ: 'Africa/Porto-Novo',
  TG: 'Africa/Lome',
  BF: 'Africa/Ouagadougou',
  ML: 'Africa/Bamako',
  NE: 'Africa/Niamey',
  GN: 'Africa/Conakry',
  MR: 'Africa/Nouakchott',
  MU: 'Indian/Mauritius',
  ZW: 'Africa/Harare',
  LY: 'Africa/Tripoli',
  SD: 'Africa/Khartoum',
  ET: 'Africa/Addis_Ababa',
  KE: 'Africa/Nairobi',
  GH: 'Africa/Accra',
  AO: 'Africa/Luanda',
  MG: 'Indian/Antananarivo',
  MZ: 'Africa/Maputo',
  NA: 'Africa/Windhoek',
  BW: 'Africa/Gaborone',
  ZM: 'Africa/Lusaka',
  UG: 'Africa/Kampala',
  TZ: 'Africa/Dar_es_Salaam',
  GA: 'Africa/Libreville',
  CG: 'Africa/Brazzaville',
  // Con varios husos: se toma el de la capital, como ya se hacía con US/CA/BR.
  RU: 'Europe/Moscow',
  ID: 'Asia/Jakarta',
  CD: 'Africa/Kinshasa',
};

export function timezoneForCountry(iso2: string | null | undefined): string | null {
  if (!iso2) return null;
  return ISO2_TIMEZONE[iso2.toUpperCase()] ?? null;
}
