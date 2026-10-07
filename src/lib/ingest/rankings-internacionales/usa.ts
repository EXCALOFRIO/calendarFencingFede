import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * «National Rolling Point Standings» de USA Fencing (Estados Unidos).
 *
 * - Temporada en curso o recién terminada: el directorio público
 *   `usfencingresults.org/rankings/` (el que incrusta la página «Point
 *   Standings» de usafencing.org; `robots.txt` lo permite con
 *   `Crawl-delay: 10`). Una carpeta por arma y género con un PDF por
 *   categoría y día («ME Sr R 2026 07 27.pdf»).
 * - Temporadas anteriores: los zip de `usafencing.org/rankings-archive`, con
 *   todos los PDF de la temporada. De cada arma, género y categoría se lee el
 *   último con la cabecera de esa temporada: es la clasificación final.
 *
 * Las páginas «ROLLING POINT CALCULATIONS» traen
 * `RANK NAME BTH DIVISION TOTAL ...`: «2 # Imrek, Elijah 2007 Gulf Coast
 * 4,588.500 935 ...». La división es estadounidense; si en su lugar va un
 * código de país («CAN», «TPE») es un tirador de fuera, que entra con ese
 * país. «FIE» (sin país) no se lee. Las páginas de resultados que siguen no se
 * leen. Las cuentas «member.usafencing.org» (puntos del sistema nuevo) las
 * prohíbe su `robots.txt`.
 */

export const USA_ARCHIVO = 'https://www.usafencing.org/rankings-archive';
export const USA_ACTUAL = 'https://usfencingresults.org/rankings/';
/** `usfencingresults.org` pide `Crawl-delay: 10`. */
export const USA_PAUSA_MS = 10_000;

const CODIGOS: Record<string, { arma: Arma; genero: Genero }> = {
  ME: { arma: 'ESPADA', genero: 'M' }, MF: { arma: 'FLORETE', genero: 'M' }, MS: { arma: 'SABLE', genero: 'M' },
  WE: { arma: 'ESPADA', genero: 'F' }, WF: { arma: 'FLORETE', genero: 'F' }, WS: { arma: 'SABLE', genero: 'F' },
};
const CATEGORIAS: Record<string, { categoria: Categoria; raw: string }> = {
  Cdt: { categoria: 'M17', raw: 'Cadet' },
  Jr: { categoria: 'M20', raw: 'Junior' },
  Sr: { categoria: 'ABS', raw: 'Senior' },
};

export type ArchivoUsa = { temporada: string; url: string };

/** Zip de cada temporada del archivo («2024-25» → «2024-2025»). */
export function archivosUsa(html: string): ArchivoUsa[] {
  const salida: ArchivoUsa[] = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.zip)"[^>]*>\s*(\d{4})-(\d{2})\s*<\/a>/gi)) {
    const inicio = Number(m[2]);
    if ((inicio + 1) % 100 !== Number(m[3])) continue;
    const temporada = `${inicio}-${inicio + 1}`;
    if (!salida.some((a) => a.temporada === temporada)) salida.push({ temporada, url: m[1].replace(/&amp;/g, '&') });
  }
  return salida;
}

export type PdfUsa = { nombre: string; codigo: string; cat: string; dia: string };

const decodificar = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** «ME Sr R 2026 07 27.pdf» (con o sin carpeta delante, con o sin escapar como en el directorio). */
export function pdfUsa(ruta: string): PdfUsa | null {
  const nombre = decodificar(ruta.split('/').pop() ?? '');
  const m = /^(ME|MF|MS|WE|WF|WS) (Cdt|Jr|Sr) R (\d{4}) (\d{2}) (\d{2})\.pdf$/i.exec(nombre.trim());
  if (m) {
    const cat = Object.keys(CATEGORIAS).find((c) => c.toLowerCase() === m[2].toLowerCase())!;
    return { nombre, codigo: m[1].toUpperCase(), cat, dia: `${m[3]}-${m[4]}-${m[5]}` };
  }
  // Hasta 2013-14: «CME R End of Season 0408 2014.pdf», «SWF R 0118 2014 (2).pdf» o «CME R 2010 1221.pdf».
  const v = /^([CJS])(ME|MF|MS|WE|WF|WS) R (?:End of Season )?(?:(0[1-9]|1[0-2])([0-3]\d) ((?:19|20)\d{2})|((?:19|20)\d{2}) (0[1-9]|1[0-2])([0-3]\d))(?: \(\d\))?\.pdf$/i.exec(nombre.trim());
  if (!v) return null;
  const cat = { C: 'Cdt', J: 'Jr', S: 'Sr' }[v[1].toUpperCase() as 'C' | 'J' | 'S'];
  const dia = v[5] ? `${v[5]}-${v[3]}-${v[4]}` : `${v[6]}-${v[7]}-${v[8]}`;
  return { nombre, codigo: v[2].toUpperCase(), cat, dia };
}

export const claveCombosUsa = (p: PdfUsa) => `${p.codigo}|${p.cat}`;

/** Los `porCombo` PDF más recientes de cada arma, género y categoría, del más nuevo al más viejo. */
export function elegirPdfsUsa(rutas: readonly string[], porCombo = 1): string[] {
  const grupos = new Map<string, { ruta: string; dia: string }[]>();
  for (const ruta of rutas) {
    if (ruta.includes('__MACOSX')) continue;
    const p = pdfUsa(ruta);
    if (!p) continue;
    grupos.set(claveCombosUsa(p), [...(grupos.get(claveCombosUsa(p)) ?? []), { ruta, dia: p.dia }]);
  }
  return [...grupos.keys()].sort().flatMap((k) => grupos.get(k)!
    .sort((a, b) => b.dia.localeCompare(a.dia) || b.ruta.localeCompare(a.ruta))
    .slice(0, porCombo)
    .map((v) => v.ruta));
}

/**
 * La lista final de una temporada del archivo: la más reciente cuya cabecera
 * es de esa temporada. Tras el final de temporada, el zip suele traer ya
 * las primeras listas de la siguiente (cabecera «2025-2026» en un PDF del
 * archivo 2024-25), y alguna con la cabecera de una temporada vieja.
 */
export function finalTemporadaUsa(candidatas: readonly (ListaInternacional | null)[], temporada: string): ListaInternacional | null {
  return candidatas.find((l) => l?.temporada === temporada) ?? null;
}

/** Carpetas de arma y género del directorio actual. */
export function carpetasUsa(html: string): string[] {
  return [...html.matchAll(/data-href="\?dir=((?:Men|Women)%27s%20[^"]+)"/g)].map((m) => m[1]).filter((d, i, a) => a.indexOf(d) === i);
}

/** Ficheros de una carpeta del directorio actual: ruta relativa a `USA_ACTUAL`. */
export function ficherosCarpetaUsa(html: string): string[] {
  return [...html.matchAll(/data-href="([^"?][^"]*\.pdf)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}

const FECHA = /(?:CURRENT|CORRECTED|UPDATED) (?:AS OF )?(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

/** «Ewart Jr., Stephen P» → «EWART Stephen»: sin iniciales, apodos ni sufijos. */
export function nombreUsa(apellidos: string, nombre: string): string {
  const limpiar = (s: string) => s
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !/^[A-Za-z]\.?$/.test(p) && !/^(jr|sr|ii|iii|iv)\.?$/i.test(p))
    .join(' ');
  return `${limpiar(apellidos).toUpperCase()} ${limpiar(nombre)}`.trim();
}

/** Hasta 2013-14 el país de los de fuera se escribe entero en la columna de la división. */
const PAISES_TEXTO: Record<string, string> = {
  CANADA: 'CAN', MEXICO: 'MEX', 'PUERTO RICO': 'PUR', ISRAEL: 'ISR', 'GREAT BRITAIN': 'GBR', CHINA: 'CHN', KOREA: 'KOR', JAPAN: 'JPN',
  BRAZIL: 'BRA', VENEZUELA: 'VEN', COLOMBIA: 'COL', ARGENTINA: 'ARG', FRANCE: 'FRA', ITALY: 'ITA', GERMANY: 'GER', RUSSIA: 'RUS',
  UKRAINE: 'UKR', HUNGARY: 'HUN', POLAND: 'POL', EGYPT: 'EGY', 'HONG KONG': 'HKG', TAIWAN: 'TPE', 'CHINESE TAIPEI': 'TPE',
};

const puntos = (v: string) => String(Math.round(Number(v.replace(/,/g, '')) * 1000) / 1000);

const FILA = /^(\d+)T?\s+(?:#\s+)?([^,]+),\s*(.+?)\s+((?:19|20)\d{2})\s+(.+?)\s+(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s|$)/;

/**
 * Una lista desde el texto de las páginas del PDF. Devuelve `null` si no es
 * una clasificación «rolling» individual de las categorías que se leen.
 */
export function listaUsa(paginas: readonly string[], archivo: string, url: string): ListaInternacional | null {
  const p = pdfUsa(archivo);
  if (!p) return null;
  const ag = CODIGOS[p.codigo];
  const cat = CATEGORIAS[p.cat];
  let temporada: string | null = null;
  let dia: string | null = null;
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  let total = 0;
  for (const pagina of paginas) {
    const lineas = pagina.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
    if (!lineas.some((l) => /^(RANK|PLACE) NAME BTH\b/.test(l))) continue;
    // Si la cabecera dice otra arma, género o categoría que el nombre del fichero, no se lee.
    const cabecera = lineas.slice(0, 4).join(' ');
    const g = /\b(Men|Women)'s (Epee|Foil|Sabre|Saber)\b/i.exec(cabecera);
    if (g && (CODIGOS[`${g[1][0].toUpperCase()}${g[2][0].toUpperCase()}`] !== ag)) return null;
    const c = /\b(Cadet|Junior|Senior)\b/i.exec(cabecera);
    if (c && c[1].toLowerCase() !== cat.raw.toLowerCase()) return null;
    const t = /^(\d{4})-(\d{4})\b/.exec(lineas[0] ?? '');
    if (t && Number(t[2]) === Number(t[1]) + 1) temporada ??= `${t[1]}-${t[2]}`;
    const fecha = lineas.map((l) => FECHA.exec(l)).find(Boolean);
    if (fecha) dia ??= `${fecha[3]}-${fecha[1].padStart(2, '0')}-${fecha[2].padStart(2, '0')}`;
    for (const l of lineas) {
      const m = FILA.exec(l);
      if (!m) continue;
      total += 1;
      const region = m[5].trim();
      let pais: string | null = PAISES_TEXTO[region.toUpperCase()] ?? null;
      if (/^[A-Z]{3}$/.test(region)) {
        if (region === 'FIE') continue;
        if (region !== 'USA') pais = region;
      }
      const nombre = nombreUsa(m[2], m[3]);
      if (!nombre.includes(' ')) continue;
      const anio = Number(m[4]);
      let ref = `usa:${nombre}_${anio}`.replace(/\s+/g, '_');
      if (refs.has(ref)) ref = `${ref}#${m[1]}`;
      refs.add(ref);
      filas.push({ ref, nombre, pais, puesto: Number(m[1]), puntos: puntos(m[6]), anioNacimiento: anio });
    }
  }
  if (!temporada || !filas.length) return null;
  return {
    fuente: 'usa_points', temporada, arma: ag.arma, genero: ag.genero, categoria: cat.categoria, categoriaRaw: cat.raw,
    publicadoEl: dia ?? p.dia, baseFecha: 'source', url, total, filas,
  };
}
