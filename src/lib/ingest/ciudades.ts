/**
 * Normalización de nombres de ciudad entre fuentes.
 *
 * El problema es real y está medido contra la base: la misma competición entra
 * dos veces, una por Skermo y otra por la FIE, y las dos escriben la sede
 * distinto. Skermo publica el exónimo español en mayúsculas y con acentos
 * («DUBLÍN», «NÚREMBERG», «GANTE», «NUEVA YORK»); la FIE publica el nombre
 * local o su versión francesa/inglesa («Dublin», «Nuremberg», «Gand»).
 * Cruzando por ciudad literal solo casaban 12 de los pares posibles.
 *
 * Aquí se convierte cualquiera de esas formas en una MISMA clave canónica, que
 * es lo único que se compara después. La clave no se enseña nunca: es interna.
 * En pantalla se sigue viendo el nombre tal y como lo publica cada fuente.
 *
 * La tabla no es una lista de memoria: las entradas de la mitad de arriba
 * salen de consultar las ciudades que hay HOY en la base (214 eventos de
 * `skermo_rfee` y 60 de `fie`). Las de abajo son plazas grandes del circuito
 * que todavía no han aparecido, y están para que el día que aparezcan casen
 * solas.
 */

/**
 * Textos que una fuente usa para decir «todavía no se sabe dónde». No son una
 * ciudad y NUNCA pueden casar con nada: la FIE tiene hoy 35 eventos con la
 * sede puesta a «TBD», y tratarlos como una ciudad los fundiría todos entre sí.
 */
const SIN_SEDE = new Set([
  'tbd',
  'tba',
  'tbc',
  'por determinar',
  'sin determinar',
  'a determinar',
  'pendiente',
  'n a',
  'na',
  '-',
  '?',
]);

/**
 * Exónimos y variantes → clave canónica.
 *
 * La clave se escribe ya normalizada (minúsculas, sin acentos). La forma
 * elegida como canónica es arbitraria pero estable: lo que importa es que
 * todas las variantes de una misma plaza caigan en la misma.
 */
const EXONIMOS: Record<string, string> = {
  // --- Vistas hoy en la base, por los dos lados ---------------------------
  // Skermo         // FIE / local
  gante: 'ghent',
  gand: 'ghent',
  gent: 'ghent',
  ghent: 'ghent',

  nuremberg: 'nuremberg',
  nurnberg: 'nuremberg',
  nuernberg: 'nuremberg',

  estambul: 'istanbul',
  istanbul: 'istanbul',

  atenas: 'athens',
  athens: 'athens',
  athina: 'athens',
  athenes: 'athens',

  belgrado: 'belgrade',
  belgrade: 'belgrade',
  beograd: 'belgrade',

  basilea: 'basel',
  basel: 'basel',
  bale: 'basel',
  basle: 'basel',

  berna: 'bern',
  bern: 'bern',
  berne: 'bern',

  copenhague: 'copenhagen',
  copenhagen: 'copenhagen',
  kobenhavn: 'copenhagen',
  copenhaguen: 'copenhagen',

  cracovia: 'krakow',
  krakow: 'krakow',
  cracow: 'krakow',
  krakau: 'krakow',

  'el cairo': 'cairo',
  cairo: 'cairo',
  'le caire': 'cairo',
  'al qahirah': 'cairo',

  gotemburgo: 'gothenburg',
  gothenburg: 'gothenburg',
  goteborg: 'gothenburg',

  luxemburgo: 'luxembourg',
  luxembourg: 'luxembourg',
  luxemburg: 'luxembourg',

  praga: 'prague',
  prague: 'prague',
  praha: 'prague',
  prag: 'prague',

  seul: 'seoul',
  seoul: 'seoul',

  singapur: 'singapore',
  singapore: 'singapore',
  singapour: 'singapore',

  tesalonica: 'thessaloniki',
  thessaloniki: 'thessaloniki',
  salonica: 'thessaloniki',
  saloniki: 'thessaloniki',
  thessalonique: 'thessaloniki',

  turin: 'turin',
  torino: 'turin',

  tunez: 'tunis',
  tunis: 'tunis',
  // «TÚNEZ» en Skermo es la ciudad, no el país: el Grand Prix de sable se tira
  // en Túnez capital. El país que trae la fila (ES) está mal en origen y por
  // eso el emparejado no se fía del país cuando discrepa, solo cuando coincide.

  varsovia: 'warsaw',
  warsaw: 'warsaw',
  warszawa: 'warsaw',
  varsovie: 'warsaw',

  viena: 'vienna',
  vienna: 'vienna',
  wien: 'vienna',
  vienne: 'vienna',

  astana: 'astana',
  'nur sultan': 'astana',

  oran: 'oran',
  wahran: 'oran',

  padova: 'padua',
  padua: 'padua',
  padoue: 'padua',

  lausana: 'lausanne',
  lausanne: 'lausanne',

  tiflis: 'tbilisi',
  tbilisi: 'tbilisi',
  tbilissi: 'tbilisi',

  bucarest: 'bucharest',
  bucharest: 'bucharest',
  bucuresti: 'bucharest',

  sofia: 'sofia',
  sofya: 'sofia',

  // Erratas de la propia fuente. «ESPLUES DE LLOBREGAT» y «ESPLUGUES DE
  // LLOBREGAT» conviven hoy en la base: son el mismo sitio.
  'esplues de llobregat': 'esplugues de llobregat',
  'esplugues de llobregat': 'esplugues de llobregat',
  esplugues: 'esplugues de llobregat',

  // La FIE escribe «Takamatsu», Skermo «TAKAMATSU CITY».
  'takamatsu city': 'takamatsu',
  takamatsu: 'takamatsu',

  samorin: 'samorin',
  sammorin: 'samorin',

  'hong kong': 'hong kong',
  hongkong: 'hong kong',

  // --- Plazas del circuito que aún no han salido, para que no fallen -------
  londres: 'london',
  london: 'london',
  londra: 'london',

  ginebra: 'geneva',
  geneva: 'geneva',
  geneve: 'geneva',
  genf: 'geneva',

  amberes: 'antwerp',
  antwerp: 'antwerp',
  antwerpen: 'antwerp',
  anvers: 'antwerp',

  milan: 'milan',
  milano: 'milan',
  mailand: 'milan',

  moscu: 'moscow',
  moscow: 'moscow',
  moskva: 'moscow',
  moscou: 'moscow',

  lisboa: 'lisbon',
  lisbon: 'lisbon',
  lisbonne: 'lisbon',

  argel: 'algiers',
  algiers: 'algiers',
  alger: 'algiers',

  baku: 'baku',
  bakou: 'baku',

  tokio: 'tokyo',
  tokyo: 'tokyo',

  pekin: 'beijing',
  beijing: 'beijing',
  pequim: 'beijing',
  peking: 'beijing',

  'nueva york': 'new york',
  'new york': 'new york',
  'new york city': 'new york',
  nyc: 'new york',

  'la haya': 'the hague',
  'the hague': 'the hague',
  'den haag': 'the hague',
  'la haye': 'the hague',
  's gravenhage': 'the hague',

  bruselas: 'brussels',
  brussels: 'brussels',
  bruxelles: 'brussels',
  brussel: 'brussels',

  munich: 'munich',
  muenchen: 'munich',

  colonia: 'cologne',
  cologne: 'cologne',
  koln: 'cologne',
  koeln: 'cologne',

  francfort: 'frankfurt',
  frankfurt: 'frankfurt',
  'frankfurt am main': 'frankfurt',

  zurich: 'zurich',

  estocolmo: 'stockholm',
  stockholm: 'stockholm',

  tallin: 'tallinn',
  tallinn: 'tallinn',

  burdeos: 'bordeaux',
  bordeaux: 'bordeaux',

  marsella: 'marseille',
  marseille: 'marseille',
  marseilles: 'marseille',

  niza: 'nice',
  nice: 'nice',
  nizza: 'nice',

  paris: 'paris',

  estrasburgo: 'strasbourg',
  strasbourg: 'strasbourg',
  strassburg: 'strasbourg',

  florencia: 'florence',
  florence: 'florence',
  firenze: 'florence',

  genova: 'genoa',
  genoa: 'genoa',
  genes: 'genoa',

  napoles: 'naples',
  naples: 'naples',
  napoli: 'naples',

  roma: 'rome',
  rome: 'rome',

  venecia: 'venice',
  venice: 'venice',
  venezia: 'venice',

  'la valeta': 'valletta',
  valletta: 'valletta',

  erevan: 'yerevan',
  yerevan: 'yerevan',

  kiev: 'kyiv',
  kyiv: 'kyiv',

  bratislava: 'bratislava',
  presburgo: 'bratislava',

  liubliana: 'ljubljana',
  ljubljana: 'ljubljana',

  zagreb: 'zagreb',
  zagabria: 'zagreb',

  'san petersburgo': 'saint petersburg',
  'saint petersburg': 'saint petersburg',
  'st petersburg': 'saint petersburg',

  yeda: 'jeddah',
  jeddah: 'jeddah',
  yidda: 'jeddah',

  riad: 'riyadh',
  riyadh: 'riyadh',

  'nueva delhi': 'new delhi',
  'new delhi': 'new delhi',

  'ciudad de mexico': 'mexico city',
  'mexico city': 'mexico city',
  mexico: 'mexico city',

  'la habana': 'havana',
  havana: 'havana',

  'rio de janeiro': 'rio de janeiro',
  rio: 'rio de janeiro',

  'sao paulo': 'sao paulo',
  'san pablo': 'sao paulo',
};

/**
 * Deja un texto en minúsculas, sin acentos, sin puntuación y con los espacios
 * colapsados. Es el paso previo a mirar la tabla de exónimos: «NÚREMBERG» y
 * «Nuremberg» tienen que llegar iguales a la búsqueda.
 */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    // Quita los diacríticos que NFD ha separado (tildes, diéresis, cedillas).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // La ß alemana y la ø/đ nórdicas no se descomponen con NFD.
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    // Guiones, puntos, apóstrofos y comas hacen de espacio: «CLUJ-NAPOCA» y
    // «Cluj Napoca» son la misma ciudad.
    .replace(/[.,'`´’\-_/\\]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clave canónica de una ciudad, o `null` si no hay ciudad de la que fiarse.
 *
 * Devolver `null` es una respuesta legítima y frecuente: sin ciudad no se
 * empareja nada. Es justo lo contrario de inventarse una sede.
 */
export function claveCiudad(ciudad: string | null | undefined): string | null {
  if (!ciudad) return null;

  const base = normalizarTexto(ciudad);
  if (base.length === 0) return null;
  if (SIN_SEDE.has(base)) return null;

  const directo = EXONIMOS[base];
  if (directo) return directo;

  /**
   * Algunas fuentes añaden el país detrás de la ciudad («Budapest (HUN)»,
   * «Samsun, Turkey»). El paréntesis ya se ha ido al normalizar; aquí se
   * intenta también con solo la primera parte, por si el resto era ruido.
   */
  const sinPais = base.replace(
    /\s+(hun|fra|esp|ita|ger|deu|pol|cze|svk|srb|cro|hrv|gre|grc|tur|usa|bra|kaz|uzb|geo|kor|jpn|chn|egy|alg|dza|tun|mar|sui|che|aut|bel|ned|nld|den|dnk|swe|nor|fin|est|lat|lva|ltu|irl|gbr|por|prt|rou|bul|bgr|slo|svn|isl|isr|can|mex|col|per|arg|chi|hkg|sgp|tha|uae|qat|bhr|ksa|sau)$/,
    '',
  );
  if (sinPais !== base) {
    const porPais = EXONIMOS[sinPais];
    if (porPais) return porPais;
    return sinPais;
  }

  return base;
}

/**
 * ¿Son la misma plaza? Dos `null` NO son iguales: «no se sabe» nunca casa con
 * «no se sabe». Esa es la diferencia entre emparejar y adivinar.
 */
export function mismaCiudad(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = claveCiudad(a);
  const kb = claveCiudad(b);
  return ka !== null && kb !== null && ka === kb;
}
