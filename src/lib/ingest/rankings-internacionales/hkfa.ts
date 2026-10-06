import { normalizeSportName } from '@/lib/identity/resolver';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking de la Fencing Association of Hong Kong, China (`hkfa.org.hk`, sin
 * robots.txt). Un PDF por lista, sólo la vigente (no hay archivo de temporadas):
 * `/ranking/<prefijo><genero><arma>.pdf` con prefijo '' (open), 'u20', 'u17',
 * género m/l y arma f/e/s. Cada fila: puesto, nombre latino, nombre chino,
 * resultados por prueba y el total al final. Sin id ni nacimiento.
 */

export const HKFA_BASE = 'http://www.hkfa.org.hk/ranking';
const PREFIJOS: Record<string, { categoria: Categoria; raw: string }> = {
  '': { categoria: 'ABS', raw: 'Open' },
  u20: { categoria: 'M20', raw: 'Junior' },
  u17: { categoria: 'M17', raw: 'Cadet' },
};
const ARMAS: Record<string, Arma> = { f: 'FLORETE', e: 'ESPADA', s: 'SABLE' };
const GENEROS: Record<string, Genero> = { m: 'M', l: 'F' };

export type ComboHkfa = { prefijo: string; genero: 'm' | 'l'; arma: 'f' | 'e' | 's' };

export const COMBOS_HKFA: ComboHkfa[] = Object.keys(PREFIJOS).flatMap((prefijo) =>
  (['m', 'l'] as const).flatMap((genero) => (['f', 'e', 's'] as const).map((arma) => ({ prefijo, genero, arma }))));

export const archivoHkfa = (c: ComboHkfa) => `${c.prefijo}${c.genero}${c.arma}.pdf`;
export const urlHkfa = (c: ComboHkfa) => `${HKFA_BASE}/${archivoHkfa(c)}`;

const CJK = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Temporada a partir de la primera prueba del encabezado: la fecha dd.mm.aaaa
 * más antigua (la temporada empieza en septiembre) o, en las listas que sólo
 * nombran pruebas locales («JFC 2025», «AG 2026»), el año más antiguo, que es
 * el de inicio. La más reciente no sirve: algunas listas traen fechas de la
 * temporada siguiente.
 */
export function temporadaHkfa(texto: string): string | null {
  const cabecera = texto.split(/\r?\n/).filter((l) => !/^\d{1,4}\s+[A-Za-z]/.test(l.trim())).join('\n');
  let primera: { y: number; m: number } | null = null;
  for (const m of cabecera.matchAll(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g)) {
    const f = { y: Number(m[3]), m: Number(m[2]) };
    if (!primera || f.y * 12 + f.m < primera.y * 12 + primera.m) primera = f;
  }
  if (primera) {
    const inicio = primera.m >= 9 ? primera.y : primera.y - 1;
    return `${inicio}-${inicio + 1}`;
  }
  const anios = [...cabecera.matchAll(/\b[A-Z][A-Za-z0-9]{1,5} ((?:19|20)\d\d)\b/g)].map((m) => Number(m[1]));
  if (!anios.length) return null;
  const inicio = Math.min(...anios);
  return `${inicio}-${inicio + 1}`;
}

export type FilaHkfa = { puesto: number; nombre: string; total: string | null; anioNacimiento: number | null };

export function parseTextoHkfa(texto: string): FilaHkfa[] {
  const conNacimiento = /Year of Birth/i.test(texto);
  const salida: FilaHkfa[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^(\d{1,4})\s+([A-Za-z][A-Za-z' .-]*?)\s+(?=\S*[\p{Script=Han}]|\d)(.*)$/u.exec(linea.trim());
    if (!m) continue;
    const resto = m[3].replace(new RegExp(`${CJK.source}+`, 'gu'), ' ').trim();
    if (resto && !/^[\d.\s-]+$/.test(resto)) continue;
    const numeros = resto.split(/\s+/).filter((x) => /^\d+(\.\d+)?$/.test(x));
    const nombre = m[2].replace(/\s+/g, ' ').trim();
    if (nombre.split(' ').length < 2) continue;
    const anio = conNacimiento && /^(19[4-9]\d|20[0-2]\d)$/.test(numeros[0] ?? '') ? Number(numeros.shift()) : null;
    salida.push({ puesto: Number(m[1]), nombre, total: numeros.length ? numeros[numeros.length - 1] : null, anioNacimiento: anio });
  }
  return salida;
}

export function listaHkfa(c: ComboHkfa, texto: string, hoy: string): ListaInternacional | null {
  const temporada = temporadaHkfa(texto);
  const filas = parseTextoHkfa(texto);
  if (!temporada || !filas.length) return null;
  const vistos = new Set<string>();
  const convertidas: FilaInternacional[] = [];
  for (const f of filas) {
    let ref = `hkfa:${normalizeSportName(f.nombre).replace(/ /g, '_')}`;
    if (vistos.has(ref)) ref = `${ref}#${f.puesto}`;
    vistos.add(ref);
    convertidas.push({ ref, nombre: f.nombre, pais: null, puesto: f.puesto, puntos: f.total, anioNacimiento: f.anioNacimiento });
  }
  const p = PREFIJOS[c.prefijo];
  return {
    fuente: 'hkfa_ranking',
    temporada,
    arma: ARMAS[c.arma],
    genero: GENEROS[c.genero],
    categoria: p.categoria,
    categoriaRaw: p.raw,
    publicadoEl: hoy,
    baseFecha: 'observed',
    url: urlHkfa(c),
    total: filas.length,
    filas: convertidas,
  };
}
