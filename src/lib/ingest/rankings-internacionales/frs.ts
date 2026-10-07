import { puntosPdf, type Celda } from './pdf-celdas';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * «Ranking Național» de la Federația Română de Scrimă (`frscrima.ro`,
 * robots.txt sin exclusiones). La página enlaza un PDF por categoría, género
 * y arma con la fecha de actualización en el título («Actualizare 3 februarie
 * 2025»); sólo se publica la última. Columnas: `Loc`, `Total`, `Nume si
 * Prenume` (apellido primero), `Anul Nasterii`, `Club` y el desglose.
 * Sin ranking sénior publicado: cadetes y júniores.
 */

export const FRS_PAGINA = 'https://frscrima.ro/ranking-national/';

const CATEGORIAS: Record<string, { categoria: Categoria; raw: string }> = {
  cadeti: { categoria: 'M17', raw: 'Cadeti' },
  juniori: { categoria: 'M20', raw: 'Juniori' },
};
const ARMAS: Record<string, Arma> = { floreta: 'FLORETE', spada: 'ESPADA', sabie: 'SABLE' };
const GENEROS: Record<string, Genero> = { masculin: 'M', feminin: 'F' };
const MESES: Record<string, number> = {
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4, mai: 5, iunie: 6, iulie: 7, august: 8, septembrie: 9, octombrie: 10, noiembrie: 11, decembrie: 12,
};

export type DocumentoFrs = { url: string; arma: Arma; genero: Genero; categoria: Categoria; categoriaRaw: string; publicadoEl: string; temporada: string };

const sinAcentos = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
const texto = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&#8211;|&ndash;/g, '–').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const archivoFrs = (d: DocumentoFrs) => `${d.publicadoEl}-${d.categoriaRaw}-${d.genero}-${d.arma}.pdf`;

export function documentosFrs(html: string): DocumentoFrs[] {
  const f = /Actualizare\s+(\d{1,2})\s+([A-Za-zăâîșşțţ]+)\s+(\d{4})/i.exec(sinAcentos(texto(html)));
  const mes = f && MESES[sinAcentos(f[2]).toLowerCase()];
  if (!f || !mes) return [];
  const publicadoEl = `${f[3]}-${String(mes).padStart(2, '0')}-${f[1].padStart(2, '0')}`;
  const [a, m] = [Number(f[3]), mes];
  const temporada = m >= 8 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
  const salida: DocumentoFrs[] = [];
  for (const l of html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const e = /^(cadeti|juniori)\s*[–-]\s*(masculin|feminin)\s*[–-]\s*(floreta|spada|sabie)$/i.exec(sinAcentos(texto(l[2])));
    if (!e) continue;
    const c = CATEGORIAS[e[1].toLowerCase()];
    const d: DocumentoFrs = {
      url: new URL(l[1], FRS_PAGINA).toString(), arma: ARMAS[e[3].toLowerCase()], genero: GENEROS[e[2].toLowerCase()],
      categoria: c.categoria, categoriaRaw: c.raw, publicadoEl, temporada,
    };
    if (!salida.some((x) => archivoFrs(x) === archivoFrs(d))) salida.push(d);
  }
  return salida;
}

export function listaFrs(d: DocumentoFrs, paginas: readonly (readonly Celda[][])[]): ListaInternacional | null {
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  for (const pagina of paginas) {
    for (const f of pagina) {
      // Loc, Total, «Apellido Nombre», año de nacimiento, club...
      if (f.length < 4 || !/^\d+$/.test(f[0].s) || puntosPdf(f[1].s) === null || !/^(19|20)\d\d$/.test(f[3].s)) continue;
      const nombre = f[2].s.trim();
      if (!/\p{L}/u.test(nombre) || !nombre.includes(' ')) continue;
      const i = nombre.indexOf(' ');
      const visible = `${nombre.slice(0, i).toUpperCase()} ${nombre.slice(i + 1)}`;
      const anio = Number(f[3].s);
      const puesto = Number(f[0].s);
      let ref = `frs:${nombre}_${anio}`.replace(/\s+/g, '_');
      if (refs.has(ref)) ref = `${ref}#${puesto}`;
      refs.add(ref);
      filas.push({ ref, nombre: visible, pais: null, puesto: puesto > 0 ? puesto : null, puntos: puntosPdf(f[1].s), anioNacimiento: anio });
    }
  }
  if (!filas.length) return null;
  return {
    fuente: 'frs_ranking', temporada: d.temporada, arma: d.arma, genero: d.genero, categoria: d.categoria, categoriaRaw: d.categoriaRaw,
    publicadoEl: d.publicadoEl, baseFecha: 'source', url: d.url, total: filas.length, filas,
  };
}
