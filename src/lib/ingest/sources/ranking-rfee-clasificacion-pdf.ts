import * as cheerio from 'cheerio';
import { mapCategoryPublicada } from '../mappers';
import type { LecturaRanking } from './ranking-oficial-historico';
import { claveRanking } from './ranking-oficial-historico';
import { SKERMO_BASE_URL } from './skermo';

/**
 * Ranking nacional de la RFEE de 2017-2018 a 2020-2021.
 *
 * Esas temporadas no tienen filas en el ranking dinámico de Skermo: sólo se
 * publican como PDF en la página de clasificaciones
 * (`/classification/public/RFEE?season=<id>`), un documento por arma, género
 * y categoría con puesto, apellidos y nombre, club, año de nacimiento, los
 * puntos de cada prueba y el total.
 *
 * El PDF no publica licencia ni id de Skermo, así que estas filas se guardan
 * SIN persona: el proyecto no empareja por nombre. Sirven para consultar la
 * clasificación de esas temporadas, no para el perfil.
 */

export function skermoClasificacionUrl(code: string, seasonValue: string): string {
  return `${SKERMO_BASE_URL}/classification/public/${code}?setLang=es&season=${seasonValue}`;
}

export type DocumentoClasificacion = {
  nombre: string;
  arma: 'ESPADA' | 'FLORETE' | 'SABLE' | null;
  genero: 'M' | 'F' | null;
  categoriaRaw: string;
  individual: boolean;
  /** Fecha de referencia publicada (YYYY-MM-DD) o `null`. */
  fecha: string | null;
  url: string;
  /** Nombre del fichero en la fuente (hash), para la caché. */
  archivo: string;
  esRankingIndividual: boolean;
};

const ARMA: Record<string, DocumentoClasificacion['arma']> = { espada: 'ESPADA', florete: 'FLORETE', sable: 'SABLE' };
const GENERO: Record<string, DocumentoClasificacion['genero']> = { masculino: 'M', femenino: 'F' };

const limpio = (s: string) => s.replace(/\s+/g, ' ').trim();

function fechaIso(texto: string): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(texto);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseSkermoClasificaciones(html: string): DocumentoClasificacion[] {
  const $ = cheerio.load(html);
  const salida: DocumentoClasificacion[] = [];
  $('table.table tbody tr').each((_, tr) => {
    const celdas = $(tr).children('td').toArray();
    if (celdas.length < 7) return;
    const primera = $(celdas[0]).clone();
    primera.find('small').remove();
    const nombre = limpio(primera.text());
    const texto = (i: number) => limpio($(celdas[i]).text());
    const href = $(tr).find('a[href$=".pdf"]').attr('href') ?? '';
    if (!href) return;
    const url = new URL(href, SKERMO_BASE_URL).toString();
    const arma = ARMA[texto(1).toLowerCase()] ?? null;
    const genero = GENERO[texto(3).toLowerCase()] ?? null;
    const individual = texto(4).toLowerCase() === 'individual';
    salida.push({
      nombre,
      arma,
      genero,
      categoriaRaw: texto(2).toUpperCase(),
      individual,
      fecha: fechaIso(texto(6)),
      url,
      archivo: url.split('/').pop() ?? url,
      esRankingIndividual: /^ranking nacional$/i.test(nombre) && individual && arma !== null && genero !== null,
    });
  });
  return salida;
}

// --------------------------------------------------------------- PDF ---

export type FilaPdf = {
  puesto: number;
  nombre: string;
  club: string | null;
  anio: number | null;
  total: string;
};

const SIN_LICENCIA = /\(Sin Licencia\s*-\s*\d{4}\)/gi;
const MARCA_SIN_LICENCIA = '§SINLICENCIA';
const PIE = /^(RANKING TEMPORADA\b|(Espada|Florete|Sable)\s+(Masculin|Femenin)|Generar Ranking|Encont|rados:|P[aá]gina\s+\d)/i;
const NUMERO = /^\(?\d[\d.]*(,\d+)?\)?$/;

/** Número publicado («9.571,35») como texto decimal con punto («9571.35»). */
export function numeroPdf(t: string): string | null {
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) return null;
  return t.replace(/\./g, '').replace(',', '.');
}

const CLUB = /^[A-Z0-9ÑÇ]+(-[A-Z0-9ÑÇ]+)+$/;

/** Guiones tipográficos (U+2010…U+2015, U+2212) de los PDF antiguos como guion normal. */
const normalizarGuiones = (s: string) => s.replace(/[\u2010-\u2015\u2212]/g, '-');

const SALTO = '¶';
/** «####» es una celda que no cabía en el PDF: ocupa su sitio, pero no es un total. */
const cifra = (t: string | undefined) => t !== undefined && (NUMERO.test(t) || /^#+$/.test(t));

/**
 * Una fila: puesto, nombre, [club], [país], año de nacimiento y cifras. Las
 * cifras pueden seguir en la línea siguiente si esa línea sólo trae cifras;
 * una línea con texto (pies de página pegados a la última fila) ya no es de
 * la fila. El total es la última cifra.
 */
export function parseFilaPdf(texto: string | readonly string[]): FilaPdf | null {
  const lineas = typeof texto === 'string' ? [texto] : texto;
  const tokens = lineas
    .flatMap((l, i) => [...(i > 0 ? [SALTO] : []), ...normalizarGuiones(l).replace(SIN_LICENCIA, MARCA_SIN_LICENCIA).split(/\s+/)])
    .filter(Boolean);
  const puesto = Number(tokens[0]);
  if (!Number.isInteger(puesto) || puesto < 1) return null;
  const esAnio = (t: string) => /^(19|20)\d{2}$/.test(t);
  const sigueCifra = (k: number) => cifra(tokens[k + 1]) || (tokens[k + 1] === SALTO && cifra(tokens[k + 2]));
  // El año de nacimiento; si no se publica, la primera cifra tras el club o el país.
  let i = tokens.findIndex((t, k) => k >= 2 && esAnio(t) && sigueCifra(k));
  const conAnio = i >= 0;
  if (!conAnio) {
    i = tokens.findIndex((t, k) => k >= 2 && NUMERO.test(t)
      && (CLUB.test(tokens[k - 1]) || /^[A-Z]{3}$/.test(tokens[k - 1]) || tokens[k - 1] === MARCA_SIN_LICENCIA || tokens[k - 1] === 'Independiente')) - 1;
    if (i < 1) return null;
  }
  // Cortes posibles: el final de cada línea de cifras seguida.
  const cortes: number[] = [];
  let fin = i + 1;
  while (fin < tokens.length) {
    if (tokens[fin] === SALTO) {
      cortes.push(fin);
      let k = fin + 1;
      while (k < tokens.length && tokens[k] !== SALTO && cifra(tokens[k])) k += 1;
      // Sólo se sigue si la línea entera son cifras, y no una leyenda de años («2004 2005 2006»).
      if (k === fin + 1 || (k < tokens.length && tokens[k] !== SALTO)) break;
      if (tokens.slice(fin + 1, k).every(esAnio)) break;
      fin += 1;
      continue;
    }
    if (!cifra(tokens[fin])) break;
    fin += 1;
  }
  cortes.push(fin);
  const cifrasHasta = (corte: number) => tokens.slice(i + 1, corte).filter((t) => t !== SALTO);
  const candidatos = [...new Set(cortes)].filter((c) => {
    const cifras = cifrasHasta(c);
    return cifras.length > 0 && numeroPdf(cifras[cifras.length - 1]) !== null;
  });
  // Con varias líneas posibles, el total no puede ser menor que los puntos de antes: así
  // una fila de cifras sueltas que venga detrás (cabeceras) no pasa por total. Con una
  // sola línea vale tal cual (hay listas con coeficientes que reducen el total).
  const valido = (corte: number) => {
    const cifras = cifrasHasta(corte);
    const total = Number(numeroPdf(cifras[cifras.length - 1]));
    return cifras.slice(0, -1).map(numeroPdf).filter((v): v is string => v !== null).every((v) => Number(v) <= total + 0.005);
  };
  const corte = candidatos.length === 1 ? candidatos[0] : [...candidatos].reverse().find(valido);
  if (corte === undefined) return null;
  const cifrasFila = tokens.slice(i + 1, corte).filter((t) => t !== SALTO);
  const total = numeroPdf(cifrasFila[cifrasFila.length - 1])!;
  const antes = tokens.slice(1, conAnio ? i : i + 1).filter((t) => t !== SALTO);
  // Código de club partido por espacios («UTB - Z»).
  const n = antes.length;
  if (n > 3 && antes[n - 2] === '-' && /^[A-Z0-9ÑÇ]+$/.test(antes[n - 3]) && /^[A-Z0-9ÑÇ]+$/.test(antes[n - 1])) {
    antes.splice(n - 3, 3, `${antes[n - 3]}-${antes[n - 1]}`);
  }
  // País de tres letras (PDF antiguos) entre el club y el año.
  if (antes.length > 2 && /^[A-Z]{3}$/.test(antes[antes.length - 1]) && CLUB.test(antes[antes.length - 2])) antes.pop();
  const ultimo = antes[antes.length - 1];
  const esClub = ultimo === MARCA_SIN_LICENCIA || ultimo === 'Independiente' || CLUB.test(ultimo);
  const nombre = (esClub ? antes.slice(0, -1) : antes).join(' ');
  if (nombre.length < 2 || !/\p{L}/u.test(nombre)) return null;
  return {
    puesto,
    nombre,
    club: esClub && ultimo !== MARCA_SIN_LICENCIA && ultimo !== 'Independiente' ? ultimo : null,
    anio: conAnio ? Number(tokens[i]) : null,
    total,
  };
}

export type LecturaPdf = {
  filas: FilaPdf[];
  /** Líneas que parecían una fila y no se pudieron leer. */
  descuadradas: number;
  fallidas: string[];
  /**
   * Año que declara el PDF: «RANKING TEMPORADA 2021» (año final),
   * «RANKING NACIONAL 2017/2018» (el final) o «1819» (dos y dos cifras).
   */
  anioTemporada: number | null;
  /** El documento trae varias listas seguidas (los puestos vuelven a empezar). */
  varias: boolean;
  /** Rótulo «Espada Masculina - ABSOLUTA» del pie. */
  rotulo: string | null;
};

/**
 * Filas del ranking a partir del texto del PDF. Una fila empieza por el
 * puesto siguiente (o el mismo, en un empate) y puede partirse en dos líneas
 * cuando el nombre es largo; los pies de página no son filas.
 */
export function parseRankingPdf(texto: string): LecturaPdf {
  const lineas = normalizarGuiones(texto).split(/\r?\n/).map(limpio).filter(Boolean);
  const temporada = /RANKING (?:TEMPORADA|NACIONAL)\s+(\d{4})(?:\/(\d{4}))?/i.exec(lineas.join('\n'));
  const rotulo = lineas.find((l) => /^(Espada|Florete|Sable)\s+(Masculin|Femenin)\S*\s+-\s+\S/i.test(l)) ?? null;
  const brutas: string[][] = [];
  let anterior = 0;
  let empezado = false;
  let reinicios = 0;
  for (const l of lineas) {
    if (PIE.test(l)) continue;
    // Una fila empieza por un puesto seguido de una letra: «210 220 193» es una cabecera, no una fila.
    const n = /^(\d+)\s+\p{L}/u.exec(l);
    const puesto = n ? Number(n[1]) : NaN;
    if (!empezado) {
      if (puesto !== 1) continue;
      empezado = true;
    }
    if (puesto === anterior + 1 || (puesto === anterior && puesto > 0)) {
      brutas.push([l]);
      anterior = puesto;
    } else if (puesto === 1 && brutas.length > 0) {
      // Otra lista en el mismo documento (tramos de veteranos).
      reinicios += 1;
      brutas.push([l]);
      anterior = 1;
    } else if (brutas.length > 0) {
      brutas[brutas.length - 1].push(l);
    }
  }
  const filas: FilaPdf[] = [];
  const fallidas: string[] = [];
  for (const b of brutas) {
    const f = parseFilaPdf(b);
    if (f) filas.push(f);
    else fallidas.push(b.join(' / '));
  }
  const anio = temporada ? Number(temporada[2] ?? temporada[1]) : null;
  return { filas, descuadradas: fallidas.length, fallidas, anioTemporada: anio, rotulo, varias: reinicios > 0 };
}

/** «2018-2019» casa con 2019 y con «1819»; sin año declarado no hay contradicción. */
export function temporadaCoincide(anio: number | null, season: string): boolean {
  if (anio === null) return true;
  const corta = Number(`${season.slice(2, 4)}${season.slice(7, 9)}`);
  return anio === Number(season.slice(5, 9)) || anio === corta;
}

const ROTULO_ARMA: Record<string, string> = { espada: 'ESPADA', florete: 'FLORETE', sable: 'SABLE' };

/** ¿Dice el pie del PDF el mismo arma y género que la fila del índice? */
function rotuloCoincide(rotulo: string | null, d: DocumentoClasificacion): boolean {
  if (!rotulo) return true;
  const m = /^(Espada|Florete|Sable)\s+(Masculin|Femenin)/i.exec(rotulo);
  if (!m) return true;
  return ROTULO_ARMA[m[1].toLowerCase()] === d.arma && (m[2].toLowerCase().startsWith('masc') ? 'M' : 'F') === d.genero;
}

/**
 * Lectura de un PDF como lista de ranking, con la misma forma que la del
 * ranking dinámico. Sólo es `completo` si todas las filas se leyeron, los
 * puestos son consecutivos, los totales no crecen y el PDF declara la misma
 * temporada, arma y género que el índice.
 */
export function lecturaDePdf(
  season: string,
  d: DocumentoClasificacion,
  texto: string,
  hoy: string,
): LecturaRanking {
  const categoriaRaw = d.categoriaRaw;
  const base = {
    fuente: 'skermo_ranking' as const,
    season,
    clave: claveRanking(d.arma ?? '?', d.genero ?? '?', categoriaRaw, 'INDIVIDUAL'),
    url: d.url,
  };
  const categoria = mapCategoryPublicada(categoriaRaw);
  const vacia = (estado: LecturaRanking['cobertura']['estado'], error: string | null, publicado: number | null = null) => ({
    ...base,
    publicacion: null,
    cobertura: { estado, publicado, importado: 0, error },
    excluidas: { descuadradas: 0, sinId: 0, repetidas: 0 },
  });
  if (!d.arma || !d.genero || !categoria) return vacia('error', `Lista sin equivalencia: ${d.arma}/${d.genero}/${categoriaRaw}`);

  const leida = parseRankingPdf(texto);
  if (!temporadaCoincide(leida.anioTemporada, season)) {
    return vacia('conflicto', `El PDF declara la temporada ${leida.anioTemporada}, no ${season}`);
  }
  if (!rotuloCoincide(leida.rotulo, d)) return vacia('conflicto', `El PDF es de «${leida.rotulo}»`);
  const publicado = leida.filas.length + leida.descuadradas;
  if (publicado === 0) return vacia('sin_resultados', null, 0);
  // Varias listas en un documento (tramos de veteranos sin rótulo legible): no se mezclan.
  if (leida.varias) return vacia('parcial', 'El documento trae varias listas', publicado);

  let ordenado = true;
  for (let i = 1; i < leida.filas.length; i += 1) {
    const a = leida.filas[i - 1];
    const b = leida.filas[i];
    if (b.puesto < a.puesto || Number(b.total) > Number(a.total) + 0.005) ordenado = false;
  }
  if (leida.descuadradas > 0 || !ordenado) {
    return {
      ...vacia('parcial', `descuadradas=${leida.descuadradas} ordenado=${ordenado}`, publicado),
      excluidas: { descuadradas: leida.descuadradas, sinId: 0, repetidas: 0 },
    };
  }

  return {
    ...base,
    publicacion: {
      fuente: 'skermo_ranking',
      season,
      arma: d.arma,
      genero: d.genero,
      categoria,
      categoriaOriginal: categoriaRaw,
      formato: 'INDIVIDUAL',
      publicadoEl: d.fecha ?? hoy,
      url: d.url,
      total: publicado,
      entradas: leida.filas.map((f, i) => ({
        // Sin id en la fuente: la referencia es la fila del documento.
        sourceRef: `pdf:${d.archivo.replace(/\.pdf$/i, '')}:${i + 1}`,
        nombre: f.nombre,
        pais: null,
        posicion: f.puesto,
        puntos: f.total,
        referencia: null,
      })),
    },
    cobertura: { estado: 'completo', publicado, importado: leida.filas.length, error: null },
    excluidas: { descuadradas: 0, sinId: 0, repetidas: 0 },
  };
}
