import { mapCategoryPublicada } from '../../mappers';
import { normalizar } from './geometria';
import type { Arma, Formato, Genero } from './tipos';

/**
 * Datos de la prueba que declara la cabecera de sus páginas. Todo lo que no
 * se lee de forma inequívoca queda en `null` con su motivo: no se completa
 * con la categoría del índice ni se aproxima una edad.
 */

export type MetadatosCabecera = {
  arma: Arma | null;
  genero: Genero | null;
  formato: Formato | null;
  categoria: string | null;
  categoriaOriginal: string | null;
  cohorte: string | null;
  categoriaPublicada: string | null;
  fecha: string | null;
  errores: string[];
};

const MESES: Record<string, string> = {
  ENE: '01', FEB: '02', MAR: '03', ABR: '04', MAY: '05', JUN: '06',
  JUL: '07', AGO: '08', SEP: '09', SET: '09', OCT: '10', NOV: '11', DIC: '12',
};

const RE_ARMA = /\b(ESPADA|FLORETE|SABLE)\b/g;
const RE_GENERO = /\b(MASCULIN[OA]S?|FEMENIN[OA]S?|MIXT[OA]S?)\b/g;
const RE_FORMATO_EQ = /\bEQUIPOS?\b/;
const RE_FORMATO_IND = /\b(INDIVIDUAL(ES)?|IND)\b/;
const RE_FECHA_LARGA = /\b(\d{1,2})\s*(?:DE\s+)?([A-Z]{3,10})\.?\s*(?:DE\s+)?(\d{4})\b/;
const RE_FECHA_CORTA = /\b(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})\b/;

const CATEGORIAS: { re: RegExp; literal: (m: RegExpMatchArray) => string }[] = [
  { re: /\bM-?(7|9|10|11|12|13|14|15|17|20|23)\b/, literal: (m) => `M${m[1]}` },
  { re: /\b(ABSOLUT[OA]S?|SENIOR)\b/, literal: (m) => m[1] },
  { re: /\bJUNIORS?\b/, literal: () => 'JUNIOR' },
  { re: /\bCADETES?\b/, literal: () => 'CADETE' },
  { re: /\bVETERAN[OA]S?\b/, literal: () => 'VETERANOS' },
];

function unico<T>(valores: T[]): T[] {
  return [...new Set(valores)];
}

export function parsearFecha(texto: string): string | null {
  const t = normalizar(texto);
  const iso = (d: string, m: string, a: string): string | null => {
    const mes = MESES[m.slice(0, 3)];
    if (!mes) return null;
    const anio = a.length === 2 ? `20${a}` : a;
    const dia = d.padStart(2, '0');
    if (Number(dia) < 1 || Number(dia) > 31) return null;
    return `${anio}-${mes}-${dia}`;
  };
  const corta = t.match(RE_FECHA_CORTA);
  if (corta) return iso(corta[1], corta[2], corta[3]);
  const larga = t.match(RE_FECHA_LARGA);
  if (larga) return iso(larga[1], larga[2], larga[3]);
  return null;
}

export function metadatosDeCabecera(lineas: readonly string[]): MetadatosCabecera {
  const errores: string[] = [];
  const norm = lineas.map(normalizar);
  const todo = norm.join(' | ');

  const armas = unico([...todo.matchAll(RE_ARMA)].map((m) => m[1]));
  const generos = unico(
    [...todo.matchAll(RE_GENERO)].map((m): Genero => (m[1].startsWith('MASC') ? 'M' : m[1].startsWith('FEM') ? 'F' : 'MIXTO')),
  );
  let arma: Arma | null = null;
  if (armas.length === 1) arma = armas[0] as Arma;
  else errores.push(armas.length === 0 ? 'La cabecera no declara arma' : 'La cabecera declara más de un arma');
  let genero: Genero | null = null;
  if (generos.length === 1) genero = generos[0];
  else errores.push(generos.length === 0 ? 'La cabecera no declara género' : 'La cabecera declara más de un género');

  const eq = RE_FORMATO_EQ.test(todo);
  const ind = RE_FORMATO_IND.test(todo);
  let formato: Formato | null = null;
  if (eq && ind) errores.push('La cabecera declara individual y equipos');
  else if (eq) formato = 'EQUIPOS';
  else if (ind) formato = 'INDIVIDUAL';

  const encontradas = CATEGORIAS.flatMap((c) => {
    const lit = todo.match(c.re);
    return lit ? [{ literal: c.literal(lit), codigo: mapCategoryPublicada(c.literal(lit)) }] : [];
  });
  const codigos = unico(encontradas.map((c) => c.codigo).filter((c): c is NonNullable<typeof c> => c !== null));
  let categoria: string | null = null;
  let categoriaOriginal: string | null = null;
  if (codigos.length === 1) {
    categoria = codigos[0];
    categoriaOriginal = encontradas.find((c) => c.codigo === categoria)?.literal ?? null;
  } else {
    errores.push(codigos.length === 0 ? 'La cabecera no declara una categoría reconocida' : 'La cabecera declara categorías contradictorias');
  }

  // Subdivisión publicada en la línea del arma: año de nacimiento o «Categoría 0-1».
  let cohorte: string | null = null;
  const iLinea = norm.findIndex((l) => /\b(ESPADA|FLORETE|SABLE)\b/.test(l));
  if (iLinea >= 0) {
    const resto = lineas[iLinea]
      .replace(/\b(espada|florete|sable)\b/gi, ' ')
      .replace(/\b(masculin[oa]s?|femenin[oa]s?|mixt[oa]s?)\b/gi, ' ')
      .replace(/\b(individual(es)?|equipos?|ind)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/[\p{L}\d]/u.test(resto)) cohorte = resto;
  }

  const fecha = [...lineas].reverse().map(parsearFecha).find((f) => f !== null) ?? null;
  const categoriaPublicada = [categoriaOriginal, cohorte].filter(Boolean).join(' ') || null;
  return { arma, genero, formato, categoria, categoriaOriginal, cohorte, categoriaPublicada, fecha, errores };
}
