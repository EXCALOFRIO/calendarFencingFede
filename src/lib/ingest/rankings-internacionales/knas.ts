import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranglijsten de la Koninklijke Nederlandse Algemene Schermbond
 * (`knas.onzeranglijsten.net`; su robots.txt sólo excluye a bots con nombre y
 * a todos `/signin`, `/change-locale` y los informes de errores). La portada
 * agrupa los enlaces `/pag/8094/rls/<id>` en «Individueel» y
 * «Verenigingsequipes»; cada lista dice en su `<h1>` arma, género, categoría
 * y día («Individueel - sabel heren senioren - 01-09-2026») y su tabla trae
 * `Plaats`, número de licencia, `SURNAME Given`, club y `Punten`. Sólo se
 * publica la lista vigente.
 */

export const KNAS_BASE = 'https://knas.onzeranglijsten.net';

const CATEGORIAS: readonly { re: RegExp; categoria: Categoria; raw: string }[] = [
  { re: /^senioren$/, categoria: 'ABS', raw: 'senioren' },
  { re: /^u23$/, categoria: 'M23', raw: 'U23' },
  { re: /^junioren\b/, categoria: 'M20', raw: 'junioren' },
  { re: /^cadetten\b/, categoria: 'M17', raw: 'cadetten' },
  { re: /^pupillen\b/, categoria: 'M14', raw: 'pupillen' },
];
const ARMAS: Record<string, Arma> = { degen: 'ESPADA', floret: 'FLORETE', sabel: 'SABLE' };
const GENEROS: Record<string, Genero> = { heren: 'M', dames: 'F' };

const texto = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

const categoriaKnas = (etiqueta: string) => CATEGORIAS.find((c) => c.re.test(etiqueta.trim().toLowerCase())) ?? null;

/** Ids de las listas individuales de las categorías que se leen, sin repetir (la portada las pinta dos veces). */
export function documentosKnas(html: string): string[] {
  const inicio = html.search(/<h2 class="rank-list-group-name">\s*Individueel\s*<\/h2>/);
  if (inicio < 0) return [];
  const resto = html.slice(inicio + 1);
  const fin = resto.search(/<h2 class="rank-list-group-name">/);
  const grupo = fin < 0 ? resto : resto.slice(0, fin);
  const ids: string[] = [];
  for (const m of grupo.matchAll(/href="\/pag\/8094\/rls\/([0-9a-f]+)"[^>]*>([^<]*)</g)) {
    if (categoriaKnas(texto(m[2])) && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export const urlKnas = (id: string) => `${KNAS_BASE}/pag/8094/rls/${id}`;

/** Temporada de septiembre a agosto, como la FIE. */
export const temporadaKnas = (dia: string) => {
  const [a, m] = dia.split('-').map(Number);
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
};

export function listaKnas(id: string, html: string): ListaInternacional | null {
  const h1 = /<h1 class="title">([^<]*)<\/h1>/.exec(html);
  const t = h1 && /^Individueel - (.+?) - (\d{2})-(\d{2})-(\d{4})$/.exec(texto(h1[1]));
  if (!t) return null;
  // El orden cambia según la lista: «sabel heren senioren», «U23 heren sabel».
  const palabras = t[1].split(' ');
  const iArma = palabras.findIndex((p) => ARMAS[p.toLowerCase()]);
  const iGenero = palabras.findIndex((p) => GENEROS[p.toLowerCase()]);
  if (iArma < 0 || iGenero < 0) return null;
  const arma = ARMAS[palabras[iArma].toLowerCase()];
  const genero = GENEROS[palabras[iGenero].toLowerCase()];
  const c = categoriaKnas(palabras.filter((_, i) => i !== iArma && i !== iGenero).join(' '));
  if (!c) return null;
  const dia = `${t[4]}-${t[3]}-${t[2]}`;
  const tbody = /<tbody class="ot-tbody">([\s\S]*?)<\/tbody>/.exec(html);
  if (!tbody) return null;
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  for (const tr of tbody[1].split(/<tr class="[^"]*ot-row[^"]*">/).slice(1)) {
    const celdas = [...tr.matchAll(/<td class="ot-cell[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => texto(m[1]));
    if (celdas.length < 6) continue;
    const [plaats, licentie, nombre, , , punten] = celdas;
    if (!/^\d+$/.test(licentie) || !/\p{L}/u.test(nombre)) continue;
    const ref = `knas:${licentie}`;
    if (refs.has(ref)) continue;
    refs.add(ref);
    const puesto = /^\d+$/.test(plaats) && Number(plaats) > 0 ? Number(plaats) : null;
    filas.push({ ref, nombre, pais: null, puesto, puntos: /^\d+(\.\d+)?$/.test(punten) ? String(Number(punten)) : null });
  }
  if (!filas.length) return null;
  return {
    fuente: 'knas_ranglijst', temporada: temporadaKnas(dia), arma, genero, categoria: c.categoria, categoriaRaw: c.raw,
    publicadoEl: dia, baseFecha: 'source', url: urlKnas(id), total: filas.length, filas,
  };
}
