import { desescaparXml } from './xlsx';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranglista de la Magyar Vívó Szövetség (Hungría) en su base pública
 * `versenyinfo.hunfencing.hu` (sin robots.txt). Formulario GET
 * `index.php?p=pRanglista&szezon&kor&nem&fegyver` con temporadas desde
 * 2011/2012; la tabla trae puesto, nombre (con el `sorszam` de la ficha del
 * tirador), club, fecha de nacimiento y total.
 */

export const MVSZ_BASE = 'https://versenyinfo.hunfencing.hu/index.php';
export const urlFormularioMvsz = () => `${MVSZ_BASE}?p=pRanglista`;
export const KOR_MVSZ: Record<string, { categoria: Categoria; raw: string }> = {
  '10': { categoria: 'ABS', raw: 'felnőtt' },
  '13': { categoria: 'M23', raw: 'U23' },
  '9': { categoria: 'M20', raw: 'junior' },
  '8': { categoria: 'M17', raw: 'kadét' },
};
const NEM: Record<string, Genero> = { '1': 'M', '2': 'F' };
const FEGYVER: Record<string, Arma> = { '1': 'SABLE', '2': 'FLORETE', '3': 'ESPADA' };

export type ComboMvsz = { szezon: string; temporada: string; kor: string; nem: string; fegyver: string };

/** Temporadas del selector: valor interno → «2025-2026». */
export function temporadasMvsz(html: string): { szezon: string; temporada: string }[] {
  const select = /<select name='szezon'[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
  return [...select.matchAll(/<option value='(\d+)'[^>]*>(\d{4})\/(\d{4})<\/option>/g)]
    .map((m) => ({ szezon: m[1], temporada: `${m[2]}-${m[3]}` }))
    .filter((t) => Number(t.temporada.slice(5)) === Number(t.temporada.slice(0, 4)) + 1);
}

export function combosMvsz(temporadas: readonly { szezon: string; temporada: string }[]): ComboMvsz[] {
  return temporadas.flatMap((t) => Object.keys(KOR_MVSZ).flatMap((kor) => Object.keys(NEM).flatMap((nem) =>
    Object.keys(FEGYVER).map((fegyver) => ({ ...t, kor, nem, fegyver })))));
}

export const urlMvsz = (c: ComboMvsz) => `${MVSZ_BASE}?p=pRanglista&szezon=${c.szezon}&kor=${c.kor}&nem=${c.nem}&fegyver=${c.fegyver}&submit=Mutat`;
export const archivoMvsz = (c: ComboMvsz) => `${c.temporada}-${c.kor}-${c.nem}-${c.fegyver}.html`;

const limpiar = (s: string) => desescaparXml(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function listaMvsz(c: ComboMvsz, html: string, hoy: string): ListaInternacional | null {
  const filas: FilaInternacional[] = [];
  const vistos = new Set<string>();
  for (const tr of html.matchAll(/<tr><td>([\s\S]*?)<\/tr>/g)) {
    const celdas = [...`<td>${tr[1]}`.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (celdas.length < 6) continue;
    const puesto = Number(limpiar(celdas[0]));
    const sorszam = /sorszam=(\d+)/.exec(celdas[1])?.[1];
    const nombre = limpiar(celdas[1]);
    const nacimiento = /^((?:19|20)\d\d)-\d\d-\d\d$/.exec(limpiar(celdas[3]))?.[1];
    const total = limpiar(celdas[5]);
    if (!nombre) continue;
    const ref = sorszam ? `mvsz:${sorszam}` : `mvsz:${nombre}`;
    if (vistos.has(ref)) continue;
    vistos.add(ref);
    filas.push({
      ref,
      nombre,
      pais: null,
      puesto: Number.isInteger(puesto) && puesto > 0 ? puesto : null,
      puntos: total === '' ? null : total,
      anioNacimiento: nacimiento ? Number(nacimiento) : null,
    });
  }
  if (!filas.length) return null;
  const k = KOR_MVSZ[c.kor];
  return {
    fuente: 'mvsz_ranglista',
    temporada: c.temporada,
    arma: FEGYVER[c.fegyver],
    genero: NEM[c.nem],
    categoria: k.categoria,
    categoriaRaw: k.raw,
    publicadoEl: hoy,
    baseFecha: 'observed',
    url: urlMvsz(c),
    total: filas.length,
    filas,
  };
}
