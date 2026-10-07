/**
 * Asaltos de los Juegos Olímpicos (y de la Juventud) que la base tiene sin
 * poules o sin cuadro, desde Olympedia (olympedia.org, base de datos de los
 * historiadores olímpicos OlyMADMen). Cada prueba de Olympedia publica en una
 * sola página la clasificación final y, ronda a ronda, las poules (tabla de
 * posiciones con victorias-derrotas y tocados dados-recibidos, y cada asalto) y
 * los cruces de eliminación directa con su marcador.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-olympedia.ts descargar [--db <sqlite>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-olympedia.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * robots.txt de Olympedia: todo permitido con `Crawl-delay: 10` (la red del
 * lote lo respeta). `descargar` pide la lista de ediciones, la página de
 * esgrima de cada edición objetivo y la de cada prueba objetivo; `hechos`
 * trabaja sólo con la caché.
 *
 * Validación (lo que no cumple no se escribe y queda en el informe):
 * - prueba: misma arma, género y modalidad; el campeón y el subcampeón de
 *   Olympedia son los de la clasificación FIE y al menos el 80 % de los
 *   clasificados FIE casan con un tirador de Olympedia con el mismo puesto;
 * - poule: los asaltos reproducen la tabla publicada (victorias, derrotas,
 *   tocados dados y recibidos) y no hay empates sin ganador; si no, fuera;
 * - cuadro: rondas regulares de eliminación directa (sin repesca ni
 *   desempates), coherente (nadie pierde y sigue) y con los puestos oficiales
 *   (final = 1.º y 2.º, semifinales = 3.º, perdedor de la ronda de N entre
 *   N/2+1 y N); si no, fuera.
 * Las referencias son los `factKey` de la clasificación guardada. Un tirador
 * de Olympedia sin fila en ella sólo se admite si su puesto queda por debajo
 * del último clasificado que guarda la FIE (clasificación truncada):
 * referencia `olympedia:<id de atleta>` y nombre de Olympedia.
 */
import * as cheerio from 'cheerio';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AsaltoHecho, HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import {
  abrirBase, cuadroContraClasificacion, escribirHechos, hechosAsaltos, HOY, mapaPuestos, plegar, pruebasFie, puestosDeBase,
  totalesPoule, type PruebaBase, type PuestoBase,
} from './lote10-fie-comun';
import { CACHE_LOTE10_FIE, enCache, NUEVO9, obtener, salidaLote10Fie, texto } from './lote10-fie-red';

const BASE = 'https://www.olympedia.org';
const MANIFIESTO = join(CACHE_LOTE10_FIE, 'olympedia-manifiesto.json');
const INFORME = join(CACHE_LOTE10_FIE, 'olympedia-informe.json');

type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];
type Formato = HechosPrueba['competition']['format'];

// ---------------------------------------------------------------------------
// Objetivos
// ---------------------------------------------------------------------------

const OLIMPICOS = /^juegos_olimpicos\|/;
const JUVENTUD = /Olympiques de la Jeunesse|^JOJ\b/i;

export type Juegos = 'verano' | 'juventud';

export function juegosDe(p: Pick<PruebaBase, 'tournamentKey' | 'editionName'>): Juegos | null {
  if (OLIMPICOS.test(p.tournamentKey)) return 'verano';
  if (JUVENTUD.test(p.editionName) && !/mixed|mixte/i.test(p.editionName)) return 'juventud';
  return null;
}

/**
 * Pruebas olímpicas sin cuadro, o sin poules hasta 1992: desde 1996 la prueba
 * individual olímpica es eliminación directa desde el primer asalto.
 */
export function objetivosOlimpicos(pruebas: readonly PruebaBase[]): PruebaBase[] {
  return pruebas.filter((p) => {
    const fecha = p.date ?? p.startDate;
    if (!fecha || fecha >= HOY || p.resultados === 0 || !juegosDe(p)) return false;
    const conPoules = juegosDe(p) === 'juventud' || Number(fecha.slice(0, 4)) <= 1992;
    return p.tableau === 0 || (p.format === 'INDIVIDUAL' && conPoules && p.poule === 0);
  });
}

// ---------------------------------------------------------------------------
// Páginas de Olympedia
// ---------------------------------------------------------------------------

export type EdicionOly = { id: string; anio: number; ciudad: string; juegos: Juegos | 'otros' };

/** Ediciones de la página `/editions`: la sección «Olympic Games» y la de los Juegos de la Juventud. */
export function parsearEdiciones(html: string): EdicionOly[] {
  const $ = cheerio.load(html);
  const salida: EdicionOly[] = [];
  $('h2').each((_, h) => {
    const titulo = $(h).text().trim();
    const juegos: EdicionOly['juegos'] = /^Olympic Games$/i.test(titulo) ? 'verano' : /^Youth Olympic Games$/i.test(titulo) ? 'juventud' : 'otros';
    const tabla = $(h).nextAll('table').first();
    tabla.find('tr').each((__, tr) => {
      const celdas = $(tr).children('td');
      const enlace = /^\/editions\/(\d+)$/.exec($(tr).find('a[href^="/editions/"]').first().attr('href') ?? '');
      const anio = celdas.toArray().map((c) => $(c).text().trim()).find((t) => /^\d{4}$/.test(t));
      if (!enlace || !anio) return;
      salida.push({ id: enlace[1], anio: Number(anio), ciudad: celdas.eq(2).text().trim(), juegos });
    });
  });
  return salida;
}

export type EventoOly = { id: string; nombre: string; arma: Arma | null; genero: Genero | null; formato: Formato | null };

export function atributosEvento(nombre: string): Pick<EventoOly, 'arma' | 'genero' | 'formato'> {
  const t = nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const arma: Arma | null = /\bfoil\b/.test(t) ? 'FLORETE' : /\bepee\b/.test(t) ? 'ESPADA' : /\bsab(re|er)\b/.test(t) ? 'SABLE' : null;
  const genero: Genero | null = /\b(women|girls)\b/.test(t) ? 'F' : /\bmixed\b/.test(t) ? 'MIXTO' : /\b(men|boys)\b/.test(t) ? 'M' : null;
  const formato: Formato | null = /\bindividual\b/.test(t) ? 'INDIVIDUAL' : /\bteam\b/.test(t) ? 'EQUIPOS' : null;
  return { arma, genero, formato };
}

/** Pruebas de esgrima de una edición (`/editions/<id>/sports/FEN`). */
export function parsearEventosEsgrima(html: string): EventoOly[] {
  const $ = cheerio.load(html);
  const vistos = new Map<string, EventoOly>();
  $('table a[href^="/results/"]').each((_, a) => {
    const id = /^\/results\/(\d+)$/.exec($(a).attr('href') ?? '')?.[1];
    const nombre = $(a).text().replace(/\s+/g, ' ').trim();
    if (!id || vistos.has(id)) return;
    const at = atributosEvento(nombre);
    if (!at.arma || !at.formato) return;
    vistos.set(id, { id, nombre, ...at });
  });
  return [...vistos.values()];
}

export type Competidor = { nombre: string; noc: string | null; atleta: string | null };
export type FilaFinal = Competidor & { puesto: number | null; puestoTexto: string };
/** `etiqueta`: primera columna («Bout #3», «Match 1/2» = final, «Match 3/4» = bronce...). */
export type AsaltoOly = { etiqueta: string; a: Competidor; b: Competidor; sa: number | null; sb: number | null; bye: boolean; texto: string };
export type PouleOly = { numero: number; tabla: (Competidor & { v: number | null; d: number | null; ts: number | null; tr: number | null })[]; asaltos: AsaltoOly[] };
export type RondaOly = { titulo: string; poules: PouleOly[]; asaltos: AsaltoOly[] };
export type EventoLeido = { titulo: string; final: FilaFinal[]; rondas: RondaOly[] };

const limpio = (s: string) => s.replace(/\s+/g, ' ').trim();

function competidor($: cheerio.CheerioAPI, celdaNombre: cheerio.Cheerio<any>, celdaNoc: cheerio.Cheerio<any>): Competidor {
  const atleta = /^\/athletes\/(\d+)$/.exec(celdaNombre.find('a[href^="/athletes/"]').first().attr('href') ?? '')?.[1] ?? null;
  const noc = limpio(celdaNoc.text());
  return { nombre: limpio(celdaNombre.text()), noc: /^[A-Z]{3}$/.test(noc) ? noc : null, atleta };
}

const cabeceras = ($: cheerio.CheerioAPI, tabla: cheerio.Cheerio<any>) => tabla.find('thead th').toArray().map((th) => limpio($(th).text()));

function asaltosDeTabla($: cheerio.CheerioAPI, tabla: cheerio.Cheerio<any>): AsaltoOly[] {
  const cab = cabeceras($, tabla);
  const iRes = cab.indexOf('Result');
  const iA = cab.findIndex((c) => /^Competitors?$/.test(c));
  if (iRes < 0 || iA < 0) return [];
  const iB = cab.findIndex((c, i) => i > iRes && /^Competitors?$/.test(c));
  const salida: AsaltoOly[] = [];
  tabla.find('tr').each((_, tr) => {
    const td = $(tr).children('td');
    if (td.length < iRes + 1) return;
    const etiqueta = limpio(td.eq(0).text());
    const a = competidor($, td.eq(iA), td.eq(iA + 1));
    const res = limpio(td.eq(iRes).text());
    // Exento: «bye», o resultado y rival vacíos.
    if (/^bye$/i.test(res) || (iB >= 0 && !limpio(td.eq(iB).text()) && (/bye/i.test(res) || res === ''))) {
      salida.push({ etiqueta, a, b: { nombre: '', noc: null, atleta: null }, sa: null, sb: null, bye: true, texto: res });
      return;
    }
    const b = iB >= 0 ? competidor($, td.eq(iB), td.eq(iB + 1)) : { nombre: '', noc: null, atleta: null };
    const m = /^(\d{1,2})\s*[–-]\s*(\d{1,2})$/.exec(res);
    salida.push({ etiqueta, a, b, sa: m ? Number(m[1]) : null, sb: m ? Number(m[2]) : null, bye: false, texto: res });
  });
  return salida;
}

const par = (s: string): [number, number] | null => {
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
};

function tablaPoule($: cheerio.CheerioAPI, tabla: cheerio.Cheerio<any>): PouleOly['tabla'] {
  const cab = cabeceras($, tabla);
  const iC = cab.findIndex((c) => /^Competitors?$/.test(c));
  const iB = cab.indexOf('Bouts');
  const iT = cab.indexOf('Touches');
  const salida: PouleOly['tabla'] = [];
  tabla.find('tr').each((_, tr) => {
    const td = $(tr).children('td');
    if (td.length <= iC) return;
    const vd = iB >= 0 ? par(td.eq(iB).text()) : null;
    const t = iT >= 0 ? par(td.eq(iT).text()) : null;
    salida.push({ ...competidor($, td.eq(iC), td.eq(iC + 1)), v: vd?.[0] ?? null, d: vd?.[1] ?? null, ts: t?.[0] ?? null, tr: t?.[1] ?? null });
  });
  return salida;
}

const NUMEROS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Número de una poule titulada «Pool #3» o «Pool #Three»; null si el título no es una poule. */
export function numeroPoule(titulo: string): number | null {
  const m = /^Pool\s*#?\s*(\d+|[A-Za-z]+)$/i.exec(titulo.trim());
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return Number(m[1]);
  const i = NUMEROS.indexOf(m[1].toLowerCase());
  return i >= 0 ? i + 1 : null;
}

/** Página de una prueba (`/results/<id>`): clasificación final y rondas con poules y cruces. */
export function parsearEvento(html: string): EventoLeido {
  const $ = cheerio.load(html);
  const titulo = limpio($('h1').first().text());
  const final: FilaFinal[] = [];
  // La clasificación final es la tabla «Pos / Competitor / NOC» anterior a la primera ronda.
  const tablaFinal = $('table.table').filter((_, t) => {
    const cab = cabeceras($, $(t));
    return cab[0] === 'Pos' && cab.includes('NOC') && !cab.includes('Bouts') && $(t).prevAll('h2').length === 0;
  }).first();
  if (tablaFinal.length) {
    const cab = cabeceras($, tablaFinal);
    const iC = cab.findIndex((c) => /^(Competitor|Team)s?$/.test(c) || c === 'Competitor(s)');
    const iCol = iC >= 0 ? iC : 1;
    tablaFinal.find('tr').each((_, tr) => {
      const td = $(tr).children('td');
      if (td.length <= iCol + 1) return;
      const pt = limpio(td.eq(0).text());
      const n = /^=?(\d+)$/.exec(pt);
      final.push({ ...competidor($, td.eq(iCol), td.eq(iCol + 1)), puesto: n ? Number(n[1]) : null, puestoTexto: pt });
    });
  }
  const rondas: RondaOly[] = [];
  $('h2').each((_, h) => {
    const ronda: RondaOly = { titulo: limpio($(h).text()), poules: [], asaltos: [] };
    // Juegos de la Juventud: cada poule de la primera vuelta es un `<h2>Pool #One</h2>`.
    const suelta = numeroPoule(ronda.titulo);
    let poule: PouleOly | null = suelta ? { numero: suelta, tabla: [], asaltos: [] } : null;
    if (poule) ronda.poules.push(poule);
    // Tras un «Barrage» (desempate) se ignoran sus tablas hasta la siguiente poule.
    let ignorar = false;
    for (let n = $(h).next(); n.length && !n.is('h2'); n = n.next()) {
      if (n.is('h3')) {
        const t = n.text();
        const m = /Pool\s*#?\s*(\d+)/i.exec(t);
        ignorar = /barrage|fence-?off|jump-?off|play-?off/i.test(t);
        poule = m && !ignorar ? { numero: Number(m[1]), tabla: [], asaltos: [] } : null;
        if (poule) ronda.poules.push(poule);
        continue;
      }
      if (ignorar || !n.is('table') || !n.hasClass('table')) continue;
      const cab = cabeceras($, n);
      // Poule única sin subtítulo («Final Pool»).
      if (cab.includes('Bouts') && !poule && ronda.poules.length === 0) {
        poule = { numero: 1, tabla: [], asaltos: [] };
        ronda.poules.push(poule);
      }
      if (cab.includes('Bouts') && poule) poule.tabla = tablaPoule($, n);
      else if (cab.includes('Result')) {
        const asaltos = asaltosDeTabla($, n);
        if (poule) poule.asaltos.push(...asaltos);
        else ronda.asaltos.push(...asaltos);
      }
    }
    if (ronda.poules.length || ronda.asaltos.length) rondas.push(ronda);
  });
  return { titulo, final, rondas };
}

// ---------------------------------------------------------------------------
// Emparejamiento con la clasificación FIE
// ---------------------------------------------------------------------------

/**
 * Olympedia conserva el código histórico del CON (URS, FRG, GDR, EUA, TCH,
 * YUG, UAR...) y la FIE guarda el del país actual (RUS, GER, CZE...).
 */
const GRUPOS_NOC: string[][] = [
  ['RUS', 'URS', 'EUN', 'ROC', 'AIN'], ['GER', 'FRG', 'GDR', 'EUA'], ['CZE', 'TCH', 'BOH'], ['SVK', 'TCH'],
  ['SRB', 'YUG', 'SCG', 'IOP'], ['EGY', 'UAR'], ['UKR', 'URS', 'EUN'], ['BLR', 'URS', 'EUN'], ['KAZ', 'URS', 'EUN'],
  ['GEO', 'URS', 'EUN'], ['EST', 'URS'], ['LTU', 'URS'], ['LAT', 'URS'], ['CRO', 'YUG'], ['SLO', 'YUG'], ['BIH', 'YUG'],
];
export function mismaNacion(a: string | null, b: string | null): boolean {
  if (!a || !b || a === b) return true;
  return GRUPOS_NOC.some((g) => g.includes(a) && g.includes(b));
}

function similitud(a: string, b: string): number {
  if (!a || !b) return 0;
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = t;
    }
  }
  return 1 - d[b.length] / Math.max(a.length, b.length);
}

/** Apellidos (palabras iniciales en mayúsculas) y nombres de un nombre FIE «APELLIDO Nombre». */
export function partesFie(nombre: string): { apellidos: string[]; nombres: string[] } {
  const palabras = nombre.trim().split(/\s+/);
  let corte = palabras.findIndex((p) => p !== p.toUpperCase() || !/\p{L}/u.test(p));
  if (corte < 0) corte = palabras.length;
  if (corte === 0) corte = 1;
  const f = (xs: string[]) => plegar(xs.join(' ')).split(' ').filter(Boolean);
  return { apellidos: f(palabras.slice(0, corte)), nombres: f(palabras.slice(corte)) };
}

const fichasOly = (nombre: string) => plegar(nombre.replace(/,\s*(Jr|Sr|II|III)\.?$/i, '')).split(' ').filter(Boolean);

function contiene(fichas: readonly string[], palabra: string, umbral = 0.85): boolean {
  if (fichas.includes(palabra)) return true;
  if (fichas.join('').includes(palabra) && palabra.length >= 4) return true;
  return fichas.some((x) => x.length >= 4 && similitud(x, palabra) >= umbral);
}

export type Casado = { ref: string; nombre: string; metodo: 'nombre' | 'puesto' | 'equipo' };

/**
 * Casa los competidores de Olympedia (nombre «Nombre Apellido», nación,
 * atleta) con las filas de la clasificación FIE, de forma inyectiva:
 * 1. apellidos FIE presentes en el nombre de Olympedia, algún nombre de pila
 *    común (o inicial) y nación compatible, candidato único en los dos sentidos;
 * 2. mismo puesto final, misma nación y apellido parecido.
 * En equipos, la nación del equipo.
 */
export function emparejar(
  fie: readonly PuestoBase[],
  oly: readonly Competidor[],
  puestosOly: ReadonlyMap<string, number | null>,
  formato: Formato,
): Map<string, Casado> {
  const clave = (c: Competidor) => c.atleta ?? `${c.nombre}|${c.noc ?? ''}`;
  const unicos = new Map<string, Competidor>();
  for (const c of oly) if (c.nombre) unicos.set(clave(c), c);
  const salida = new Map<string, Casado>();
  const tomadas = new Set<string>();
  if (formato === 'EQUIPOS') {
    for (const [k, c] of unicos) {
      const cand = fie.filter((r) => c.noc && r.countryCode === c.noc);
      if (cand.length === 1 && !tomadas.has(cand[0].factKey)) {
        salida.set(k, { ref: cand[0].factKey, nombre: cand[0].name, metodo: 'equipo' });
        tomadas.add(cand[0].factKey);
      }
    }
    return salida;
  }
  const filas = fie.map((r) => ({ r, ...partesFie(r.name) }));
  const pasada = (metodo: Casado['metodo'], cand: (c: Competidor, f: (typeof filas)[number]) => boolean) => {
    const propuestas = new Map<string, string[]>();
    for (const [k, c] of unicos) {
      if (salida.has(k)) continue;
      const cs = filas.filter((f) => !tomadas.has(f.r.factKey) && cand(c, f));
      if (cs.length === 1) propuestas.set(cs[0].r.factKey, [...(propuestas.get(cs[0].r.factKey) ?? []), k]);
    }
    for (const [ref, ks] of propuestas) {
      // El mismo tirador puede aparecer con y sin enlace de atleta (tabla de poule sin enlace): varias claves
      // con el mismo nombre y nación son una sola persona.
      const personas = new Set(ks.map((k) => `${plegar(unicos.get(k)!.nombre)}|${unicos.get(k)!.noc ?? ''}`));
      if (personas.size !== 1) continue;
      const f = filas.find((x) => x.r.factKey === ref)!;
      for (const k of ks) salida.set(k, { ref, nombre: f.r.name, metodo });
      tomadas.add(ref);
    }
  };
  pasada('nombre', (c, f) => {
    if (!mismaNacion(c.noc, f.r.countryCode)) return false;
    const fichas = fichasOly(c.nombre);
    if (!f.apellidos.length) return false;
    const pila = !f.nombres.length || f.nombres.some((n) => contiene(fichas, n) || fichas.some((x) => x === n.charAt(0)));
    // Nombre de pila transliterado («LELEIKO Olga» / «Olha Leleiko», «JEON Hee Sook» / «Jeon Hui-Suk»): apellido
    // idéntico, misma nación declarada y la misma inicial.
    const resto = fichas.filter((x) => !f.apellidos.includes(x));
    const inicial = f.apellidos.every((a) => fichas.includes(a)) && !!c.noc && !!f.r.countryCode
      && f.nombres.some((n) => resto.some((x) => x.charAt(0) === n.charAt(0)));
    if (!pila) return inicial;
    if (f.apellidos.every((a) => contiene(fichas, a))) return true;
    // Apellido compuesto recortado («PIEKARSKA-TWARDOCHEL» / «Piekarska», «BRAVO ARANGUIZ» / «Bravo») o
    // transliterado («PANTELYEYEVA» / «Panteleieva»): mismo nombre de pila completo y la misma nación declarada.
    const pilaExacta = f.nombres.some((n) => n.length >= 3 && fichas.includes(n));
    if (!pilaExacta || !c.noc || !f.r.countryCode) return false;
    if (f.apellidos.length > 1) return f.apellidos.some((a) => a.length >= 4 && contiene(fichas, a));
    return fichas.some((x) => x.length >= 4 && similitud(x, f.apellidos[0]) >= 0.75);
  });
  pasada('puesto', (c, f) => {
    const pos = puestosOly.get(clave(c));
    if (pos == null || f.r.position !== pos || !mismaNacion(c.noc, f.r.countryCode)) return false;
    const fichas = fichasOly(c.nombre);
    return f.apellidos.some((a) => fichas.some((x) => similitud(x, a) >= 0.6));
  });
  // Apellido de casada, diminutivo o transliteración («DONALDSON Gillian Mary» / «Gillian Sheen», «GRACHEVA Inna» /
  // «Inna Deriglazova», «JUNG Gil Ok» / «Jeong Gil-Ok»): puesto FIE dentro del tramo del puesto de Olympedia (los
  // empatados en =17 ocupan 17..32, que la FIE numera uno a uno), misma nación y el mismo nombre de pila;
  // la unicidad en los dos sentidos la impone `pasada`.
  const empatados = new Map<number, number>();
  for (const p of puestosOly.values()) if (p != null) empatados.set(p, (empatados.get(p) ?? 0) + 1);
  pasada('puesto', (c, f) => {
    const pos = puestosOly.get(clave(c));
    if (pos == null || f.r.position == null || f.r.position < pos || f.r.position > pos + (empatados.get(pos) ?? 1) - 1) return false;
    if (!c.noc || !f.r.countryCode || !mismaNacion(c.noc, f.r.countryCode)) return false;
    const fichas = fichasOly(c.nombre);
    return f.nombres.some((n) => n.length >= 3 && contiene(fichas, n, 0.8))
      || (f.apellidos.some((a) => fichas.some((x) => similitud(x, a) >= 0.8)) && f.nombres.some((n) => fichas.some((x) => similitud(x, n) >= 0.7)));
  });
  return salida;
}

// ---------------------------------------------------------------------------
// Lectura de asaltos
// ---------------------------------------------------------------------------

const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);

/** Ronda de eliminación directa principal: la ronda de N (byes incluidos), final, semifinales y bronce. */
export function rondaDirecta(titulo: string, cruces: number, formato: Formato): string | null {
  const t = titulo.toLowerCase();
  if (/rep[eê]chage|barrage|fence-?off|classification|placing|places?\b|qualif/.test(t)) return null;
  if (/bronze|third/.test(t)) return formato === 'INDIVIDUAL' ? 'C2' : 'B2';
  if (/^final$|^final round$/.test(t)) return cruces === 1 ? 'A2' : null;
  if (/semi/.test(t)) return cruces === 2 ? 'A4' : null;
  if (/quarter/.test(t)) return cruces === 4 ? 'A8' : null;
  if (/^round (one|two|three|four|five|six|\d+)$|^(round of|table of) \d+$|^elimination/.test(t) && cruces > 0) {
    const n = 2 * cruces;
    return (n & (n - 1)) === 0 && n >= 4 ? `A${n}` : null;
  }
  return null;
}

export type Lectura = {
  bouts: AsaltoHecho[];
  pools: { esperados: number; escritos: number; descartados: Record<string, number> };
  tableau: { esperados: number; escritos: number; descartados: Record<string, number>; problemas: string[] };
  casados: number;
  sinFila: string[];
};

/**
 * Asaltos de la prueba con referencias de la clasificación FIE. `truncada`:
 * puesto a partir del cual la FIE no guarda clasificados (los competidores de
 * Olympedia por debajo de él se admiten con referencia propia).
 */
export function leerAsaltos(ev: EventoLeido, fie: readonly PuestoBase[], formato: Formato): Lectura {
  const clave = (c: Competidor) => c.atleta ?? `${c.nombre}|${c.noc ?? ''}`;
  const puestosOly = new Map<string, number | null>();
  for (const f of ev.final) puestosOly.set(clave(f), f.puesto);
  const todos: Competidor[] = [
    ...ev.final,
    ...ev.rondas.flatMap((r) => [...r.asaltos.flatMap((b) => [b.a, b.b]), ...r.poules.flatMap((p) => [...p.tabla, ...p.asaltos.flatMap((b) => [b.a, b.b])])]),
  ].filter((c) => c.nombre);
  const casados = emparejar(fie, todos, puestosOly, formato);
  const ultimoFie = Math.max(0, ...fie.map((r) => r.position ?? 0));
  // Clasificación FIE truncada (sólo los primeros puestos): los demás competidores no tienen fila con la que casar.
  const compitieron = ev.final.filter((f) => !/^(DNS|DNF|DQ|WD|AC)$/i.test(f.puestoTexto)).length;
  const truncada = fie.length < 0.6 * compitieron;
  const sinFila = new Set<string>();
  const tomadas = new Set([...casados.values()].map((m) => m.ref));
  const empatados = new Map<number, number>();
  for (const p of puestosOly.values()) if (p != null) empatados.set(p, (empatados.get(p) ?? 0) + 1);
  // En una clasificación truncada o con huecos (la FIE de 1996 guarda los puestos 1, 2, 3 y 37), un competidor
  // sin casar sólo puede ser una fila FIE libre con puesto dentro de su tramo; si no hay ninguna, no tiene fila.
  const sinFilaPosible = (pos: number | null | undefined) => {
    if (pos == null) return true;
    const hasta = pos + (empatados.get(pos) ?? 1) - 1;
    return !fie.some((r) => !tomadas.has(r.factKey) && (r.position == null || (r.position >= pos && r.position <= hasta)));
  };
  const ref = (c: Competidor): { ref: string; nombre: string } | null => {
    const m = casados.get(clave(c));
    if (m) return { ref: m.ref, nombre: m.nombre };
    const pos = puestosOly.get(clave(c));
    if (formato === 'INDIVIDUAL' && truncada && c.atleta && sinFilaPosible(pos)) {
      return { ref: `olympedia:${c.atleta}`, nombre: c.nombre };
    }
    sinFila.add(`${c.nombre} (${c.noc ?? '?'})`);
    return null;
  };

  const bouts: AsaltoHecho[] = [];
  const pools = { esperados: 0, escritos: 0, descartados: {} as Record<string, number> };
  const tableau = { esperados: 0, escritos: 0, descartados: {} as Record<string, number>, problemas: [] as string[] };
  const maxPoule = formato === 'INDIVIDUAL' ? 10 : 45;
  const maxCuadro = formato === 'INDIVIDUAL' ? 15 : 45;

  let rondaPoule = 0;
  let previaSuelta = false;
  const cuadro: AsaltoHecho[] = [];
  for (const r of ev.rondas) {
    if (r.poules.length) {
      if (formato !== 'INDIVIDUAL') continue;
      // Las poules sueltas consecutivas («Pool #One», «Pool #Two») son la misma vuelta.
      const suelta = numeroPoule(r.titulo) !== null;
      if (!(suelta && previaSuelta)) rondaPoule += 1;
      previaSuelta = suelta;
      for (const p of r.poules) {
        const n = p.tabla.length;
        pools.esperados += p.asaltos.length;
        if (n < 2) {
          sumar(pools.descartados, 'poule_sin_tabla_publicada', p.asaltos.length);
          continue;
        }
        const valida = p.asaltos.every((b) => !b.bye && b.sa !== null && b.sb !== null && b.sa !== b.sb && Math.max(b.sa, b.sb) <= maxPoule);
        if (!valida) {
          sumar(pools.descartados, 'marcador_sin_ganador_o_imposible', p.asaltos.length);
          continue;
        }
        // Los totales de la tabla publicada deben salir de los asaltos (abandonos y anulaciones no cuadran).
        const tot = totalesPoule(p.asaltos.map((b) => ({ a: clave(b.a), b: clave(b.b), sa: b.sa!, sb: b.sb!, ganador: b.sa! > b.sb! ? 'A' : 'B' })));
        const cuadra = p.tabla.every((f) => {
          const t = tot.get(clave(f));
          if (!t || f.v === null) return false;
          return t.v === f.v && (f.d === null || t.d === f.d) && (f.ts === null || t.ts === f.ts) && (f.tr === null || t.tr === f.tr);
        }) && p.asaltos.length === (n * (n - 1)) / 2;
        if (!cuadra) {
          sumar(pools.descartados, 'totales_no_cuadran', p.asaltos.length);
          continue;
        }
        const rk = rondaPoule === 1 ? `P${p.numero}` : `V${rondaPoule}P${p.numero}`;
        const filas = p.asaltos.map((b) => ({ b, ra: ref(b.a), rb: ref(b.b) }));
        if (filas.some((x) => !x.ra || !x.rb)) {
          sumar(pools.descartados, 'tirador_sin_referencia', p.asaltos.length);
          continue;
        }
        for (const { b, ra, rb } of filas) {
          bouts.push({ phase: 'POULE', roundKey: rk, aRef: ra!.ref, bRef: rb!.ref, aName: ra!.nombre, bName: rb!.nombre, scoreA: b.sa!, scoreB: b.sb!, winner: null });
          pools.escritos += 1;
        }
      }
      continue;
    }
    previaSuelta = false;
    const rondaSeccion = rondaDirecta(r.titulo, r.asaltos.length, formato);
    const reales = r.asaltos.filter((b) => !b.bye);
    for (const b of reales) {
      // «Match 1/2» es la final y «Match 3/4» el bronce; los demás partidos de puesto no son cuadro principal.
      const puesto = /^(?:Match|Bout)\s+(\d+)\/(\d+)$/i.exec(b.etiqueta);
      const rk = puesto ? (puesto[1] === '1' ? 'A2' : puesto[1] === '3' ? (formato === 'INDIVIDUAL' ? 'C2' : 'B2') : null) : rondaSeccion;
      if (!rk) {
        sumar(tableau.descartados, 'ronda_no_regular');
        continue;
      }
      tableau.esperados += 1;
      if (b.sa === null || b.sb === null || b.sa === b.sb || Math.max(b.sa, b.sb) > maxCuadro) {
        sumar(tableau.descartados, 'marcador_sin_ganador_o_imposible');
        continue;
      }
      const ra = ref(b.a);
      const rb = ref(b.b);
      if (!ra || !rb || ra.ref === rb.ref) {
        sumar(tableau.descartados, 'tirador_sin_referencia');
        continue;
      }
      cuadro.push({ phase: 'TABLEAU', roundKey: rk, aRef: ra.ref, bRef: rb.ref, aName: ra.nombre, bName: rb.nombre, scoreA: b.sa, scoreB: b.sb, winner: null });
    }
  }
  if (cuadro.length) {
    const problemas = cuadroContraClasificacion(cuadro, mapaPuestos(fie), formato === 'INDIVIDUAL' ? 'C2' : 'B2');
    if (problemas.length) {
      tableau.problemas = problemas;
      sumar(tableau.descartados, 'cuadro_contradice_clasificacion', cuadro.length);
    } else {
      bouts.push(...cuadro);
      tableau.escritos = cuadro.length;
    }
  }
  return { bouts, pools, tableau, casados: casados.size, sinFila: [...sinFila] };
}

export type Coincidencia = { ok: boolean; motivo: string | null; casados: number; mismoPuesto: number };

/**
 * La clasificación de Olympedia frente a la guardada: campeón y subcampeón
 * iguales, al menos el 70 % de los clasificados FIE identificados y, entre los
 * identificados con puesto numérico en las dos (Olympedia no numera a los
 * eliminados en poules: «7 p2 r1/3»), al menos el 80 % con el mismo puesto.
 */
export function compararClasificacion(ev: EventoLeido, fie: readonly PuestoBase[], formato: Formato): Coincidencia {
  const clave = (c: Competidor) => c.atleta ?? `${c.nombre}|${c.noc ?? ''}`;
  const puestosOly = new Map(ev.final.map((f) => [clave(f), f.puesto]));
  const casados = emparejar(fie, ev.final, puestosOly, formato);
  const porRef = new Map([...casados].map(([k, m]) => [m.ref, puestosOly.get(k) ?? null]));
  // Olympedia empata a los eliminados de cada ronda («=5», «=9»); la FIE los desempata: 5, 6, 7, 8.
  const empatados = new Map<number, number>();
  for (const f of ev.final) if (f.puesto !== null && f.puestoTexto.startsWith('=')) empatados.set(f.puesto, (empatados.get(f.puesto) ?? 0) + 1);
  let mismoPuesto = 0;
  let comparables = 0;
  for (const r of fie) {
    const o = porRef.get(r.factKey);
    if (r.position === null || o == null) continue;
    comparables += 1;
    if (o === r.position || (empatados.has(o) && r.position >= o && r.position < o + empatados.get(o)!)) mismoPuesto += 1;
  }
  const podio = (n: number) => fie.filter((r) => r.position === n).every((r) => porRef.get(r.factKey) === n);
  let motivo: string | null = null;
  if (ev.final.length === 0) motivo = 'sin_clasificacion_en_olympedia';
  else if (!podio(1) || !podio(2)) motivo = 'campeon_o_subcampeon_distinto';
  else if (casados.size < 0.7 * fie.length) motivo = `solo_${casados.size}_de_${fie.length}_identificados`;
  else if (comparables === 0 || mismoPuesto / comparables < 0.8) motivo = `solo_${mismoPuesto}_de_${comparables}_puestos_iguales`;
  return { ok: motivo === null, motivo, casados: casados.size, mismoPuesto };
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

type Manifiesto = {
  generado: string;
  ediciones: { anio: number; juegos: Juegos; edicion: string; eventos: EventoOly[] }[];
};

const anioDe = (p: PruebaBase) => Number((p.date ?? p.startDate ?? p.season).slice(0, 4));

async function descargar() {
  const db = abrirBase(argumento('db', NUEVO9));
  const obj = objetivosOlimpicos(pruebasFie(db));
  db.close();
  console.log(`${obj.length} pruebas olímpicas objetivo`);
  const eds = parsearEdiciones(texto(await obtener(`${BASE}/editions`)) ?? '');
  const man: Manifiesto = { generado: new Date().toISOString(), ediciones: [] };
  const claves = [...new Set(obj.map((p) => `${anioDe(p)}|${juegosDe(p)}`))].sort();
  for (const k of claves) {
    const [anio, juegos] = k.split('|') as [string, Juegos];
    for (const e of eds.filter((x) => x.anio === Number(anio) && x.juegos === juegos)) {
      const d = await obtener(`${BASE}/editions/${e.id}/sports/FEN`);
      const eventos = d.status === 200 ? parsearEventosEsgrima(texto(d) ?? '') : [];
      console.log(`${anio} ${juegos} edición ${e.id} ${e.ciudad}: ${eventos.length} pruebas de esgrima`);
      if (!eventos.length) continue;
      man.ediciones.push({ anio: Number(anio), juegos, edicion: e.id, eventos });
      for (const p of obj.filter((x) => `${anioDe(x)}|${juegosDe(x)}` === k)) {
        const ev = eventos.filter((x) => x.arma === p.weapon && x.genero === p.gender && x.formato === p.format);
        if (ev.length === 1) await obtener(`${BASE}/results/${ev[0].id}`);
      }
    }
  }
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO}`);
}

type FilaInforme = {
  season: string; competitionKey: string; prueba: string; olympedia?: string; motivo: string;
  poules?: Lectura['pools']; cuadro?: Lectura['tableau']; sinFila?: string[]; clasificacion?: Coincidencia;
};

function hechos() {
  const db = abrirBase(argumento('db', NUEVO9));
  const salida = argumento('salida', salidaLote10Fie('olympedia'));
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const obj = objetivosOlimpicos(pruebasFie(db));
  const informe: FilaInforme[] = [];
  let escritos = 0;
  let nPoules = 0;
  let nCuadro = 0;
  for (const p of obj) {
    const nombre = `${p.season} ${p.editionName} ${p.weapon} ${p.gender} ${p.format}`;
    const base = { season: p.season, competitionKey: p.competitionKey, prueba: nombre };
    const ed = man.ediciones.find((e) => e.anio === anioDe(p) && e.juegos === juegosDe(p));
    const ev = ed?.eventos.filter((x) => x.arma === p.weapon && x.genero === p.gender && x.formato === p.format) ?? [];
    if (ev.length !== 1) {
      informe.push({ ...base, motivo: ed ? `pruebas_olympedia_compatibles:${ev.length}` : 'sin_edicion_en_olympedia' });
      continue;
    }
    const url = `${BASE}/results/${ev[0].id}`;
    const d = enCache(url);
    const html = texto(d);
    if (!html || !d?.sha256) {
      informe.push({ ...base, olympedia: url, motivo: 'pagina_no_descargada' });
      continue;
    }
    const leido = parsearEvento(html);
    const fie = puestosDeBase(db, p.id);
    const coincide = compararClasificacion(leido, fie, p.format);
    if (!coincide.ok) {
      informe.push({ ...base, olympedia: url, motivo: `clasificacion_no_cuadra:${coincide.motivo}`, clasificacion: coincide });
      continue;
    }
    const l = leerAsaltos(leido, fie, p.format);
    const bouts = l.bouts.filter((b) => (b.phase === 'POULE' ? p.poule === 0 : p.tableau === 0));
    const poules = bouts.filter((b) => b.phase === 'POULE').length;
    const cuadro = bouts.filter((b) => b.phase === 'TABLEAU').length;
    const fila: FilaInforme = { ...base, olympedia: url, motivo: 'escrita', poules: l.pools, cuadro: l.tableau, sinFila: l.sinFila, clasificacion: coincide };
    if (!bouts.length) {
      informe.push({ ...fila, motivo: 'ningun_asalto_valido_de_una_fase_que_falte' });
      continue;
    }
    const estado = (n: number, esperados: number, desc: Record<string, number>) =>
      n === 0 ? 'parcial' : n === esperados && Object.keys(desc).length === 0 ? 'completo' : 'parcial';
    const notas = [
      `Lote 10: asaltos de Olympedia (${url}, prueba «${ev[0].nombre}»), la misma prueba que la FIE publica sin asaltos; results vacío a propósito`,
      `Validado contra la clasificación FIE: campeón y subcampeón iguales, ${coincide.mismoPuesto} de ${fie.filter((r) => r.position !== null).length} puestos iguales; ${l.casados} competidores identificados por nombre y nación`,
      `Poules ${poules} de ${l.pools.esperados} asaltos (tablas de posiciones reproducidas); cuadro ${cuadro} de ${l.tableau.esperados} cruces (coherente con los puestos oficiales)`,
      ...(Object.keys(l.pools.descartados).length ? [`Poules fuera: ${JSON.stringify(l.pools.descartados)}`] : []),
      ...(Object.keys(l.tableau.descartados).length ? [`Cuadro fuera: ${JSON.stringify(l.tableau.descartados)}${l.tableau.problemas.length ? ` (${l.tableau.problemas.join(', ')})` : ''}`] : []),
      ...(bouts.some((b) => b.aRef.startsWith('olympedia:') || b.bRef.startsWith('olympedia:'))
        ? ['Tiradores sin fila en la clasificación FIE (truncada) referidos como olympedia:<id de atleta>'] : []),
    ];
    const h = hechosAsaltos(p, {
      extractor: 'lote10_olympedia', sourceUrl: url, sourceSha256: d.sha256,
      pools: poules ? estado(poules, l.pools.esperados, l.pools.descartados) : 'parcial',
      tableau: cuadro ? estado(cuadro, l.tableau.esperados, l.tableau.descartados) : 'parcial',
      notas, bouts,
    });
    escribirHechos(salida, h);
    escritos += 1;
    nPoules += poules;
    nCuadro += cuadro;
    informe.push(fila);
  }
  db.close();
  const motivos: Record<string, number> = {};
  for (const i of informe) sumar(motivos, i.motivo.split(':')[0]);
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, poules: nPoules, cuadro: nCuadro, motivos, pruebas: informe }, null, 1)}\n`);
  for (const i of informe) console.log(`${i.season} ${i.competitionKey} ${i.prueba}: ${i.motivo}${i.poules ? ` poules ${i.poules.escritos}/${i.poules.esperados} ${JSON.stringify(i.poules.descartados)}` : ''}${i.cuadro ? ` cuadro ${i.cuadro.escritos}/${i.cuadro.esperados} ${JSON.stringify(i.cuadro.descartados)} ${i.cuadro.problemas.join(',')}` : ''}${i.sinFila?.length ? ` sin fila: ${i.sinFila.slice(0, 5).join('; ')}` : ''}`);
  console.log(`${escritos} ficheros (${nPoules} asaltos de poule, ${nCuadro} de cuadro) en ${salida}; informe en ${INFORME}`);
  console.log(JSON.stringify(motivos));
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote10-fie-olympedia.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
