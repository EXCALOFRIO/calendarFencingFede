import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking nacional de Fencing Singapore (`my.fencingsingapore.org.sg/showranks`,
 * el enlace «Rankings» de fencingsingapore.org.sg; `robots.txt` sin
 * exclusiones). Es un formulario GET por categoría (Cadet, Junior, Senior),
 * género, arma y año de inicio de temporada (desde 2019); el botón «Ranking
 * Only» devuelve la tabla `Ranking | Fencer | Club | School | Total`, con el
 * título «Senior Male Epee 2025-2026» y «Displaying records from 2025-06-01
 * to 2026-05-30 as at 2026-08-12 13:43:15 UTC».
 *
 * El nombre viene como «SITO, Jian Tong» y el perfil (`/profiles/100`) sirve
 * de referencia. No publica el país: todos cuentan como de Singapur.
 */

export const SGP_BASE = 'https://my.fencingsingapore.org.sg';

const CATEGORIAS: readonly { valor: string; categoria: Categoria }[] = [
  { valor: 'Senior', categoria: 'ABS' },
  { valor: 'Junior', categoria: 'M20' },
  { valor: 'Cadet', categoria: 'M17' },
];
const GENEROS: readonly { valor: string; genero: Genero }[] = [{ valor: 'Male', genero: 'M' }, { valor: 'Female', genero: 'F' }];
const ARMAS: readonly { valor: string; arma: Arma }[] = [{ valor: 'Epee', arma: 'ESPADA' }, { valor: 'Foil', arma: 'FLORETE' }, { valor: 'Sabre', arma: 'SABLE' }];

export type ComboSgp = { anio: number; categoria: (typeof CATEGORIAS)[number]; genero: (typeof GENEROS)[number]; arma: (typeof ARMAS)[number] };

/** Años de inicio de temporada que ofrece el formulario. */
export function aniosSgp(html: string): number[] {
  const select = /<select[^>]+id="rankingmethod_windowlength"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
  return [...select.matchAll(/<option[^>]*value="(\d{4})"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

export function combosSgp(anios: readonly number[]): ComboSgp[] {
  const salida: ComboSgp[] = [];
  for (const anio of anios) for (const categoria of CATEGORIAS) for (const genero of GENEROS) for (const arma of ARMAS) salida.push({ anio, categoria, genero, arma });
  return salida;
}

export const archivoSgp = (c: ComboSgp, dia: string | null) =>
  `${dia ? `${dia}-` : ''}${c.anio}-${c.categoria.valor}-${c.genero.valor}-${c.arma.valor}.html`.toLowerCase();

export const urlSgp = (c: ComboSgp) => {
  const q = new URLSearchParams({
    'rankingmethod[category]': c.categoria.valor,
    'rankingmethod[gender]': c.genero.valor,
    'rankingmethod[weapon]': c.arma.valor,
    'rankingmethod[windowlength]': String(c.anio),
    'Ranking Only': 'Ranking Only',
  });
  return `${SGP_BASE}/showranks?${q.toString()}`;
};

const texto = (s: string) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#39;|&#x27;|&rsquo;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** «SITO, Jian Tong» → «SITO Jian Tong». */
export function nombreSgp(s: string): string | null {
  const c = s.indexOf(',');
  if (c <= 0) return null;
  const apellido = s.slice(0, c).trim().toUpperCase();
  const nombre = s.slice(c + 1).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return apellido && nombre ? `${apellido} ${nombre}` : null;
}

export function listaSgp(c: ComboSgp, html: string, diaLectura: string): ListaInternacional | null {
  const titulo = texto(/<h4>([\s\S]*?)<\/h4>/.exec(html)?.[1] ?? '');
  const t = /^(\w+) (Male|Female) (\w+) (\d{4})-(\d{4})$/.exec(titulo);
  if (!t || t[1] !== c.categoria.valor || t[2] !== c.genero.valor || t[3] !== c.arma.valor || Number(t[4]) !== c.anio) return null;
  const dia = /as at (\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? null;
  const cuerpo = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  let total = 0;
  for (const tr of cuerpo.split(/<tr\b[^>]*>/).slice(1)) {
    const celdas = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (celdas.length < 5) continue;
    total += 1;
    const nombre = nombreSgp(texto(celdas[1]));
    if (!nombre) continue;
    const rango = texto(celdas[0]);
    const pts = texto(celdas[celdas.length - 1]);
    const perfil = /href="\/profiles\/(\d+)"/.exec(celdas[1])?.[1];
    const ref = perfil ? `sgp:${perfil}` : `sgp:${nombre}`.replace(/\s+/g, '_');
    if (refs.has(ref)) continue;
    refs.add(ref);
    filas.push({
      ref, nombre, pais: null, puesto: /^\d+$/.test(rango) ? Number(rango) : null,
      puntos: /^\d+(\.\d+)?$/.test(pts) ? String(Number(pts)) : null,
    });
  }
  if (!filas.length) return null;
  return {
    fuente: 'sgp_ranking', temporada: `${t[4]}-${t[5]}`, arma: c.arma.arma, genero: c.genero.genero, categoria: c.categoria.categoria,
    categoriaRaw: c.categoria.valor, publicadoEl: dia ?? diaLectura, baseFecha: dia ? 'source' : 'observed', url: urlSgp(c), total, filas,
  };
}
