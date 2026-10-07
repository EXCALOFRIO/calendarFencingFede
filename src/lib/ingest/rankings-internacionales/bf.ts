import { desescaparXml } from './xlsx';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking de British Fencing (`britishfencing.com`, robots.txt sin exclusiones). Cada lista
 * publicada es una entrada del blog («/senior-mens-epee-01-10-2026-0511/», antes
 * «/senior-mens-epee-march-2020/») con una tabla: puesto, nombre («BROOKE Alec»), club, número
 * de licencia de BF y total. Las entradas se enumeran con los `post-sitemap*.xml` del sitio.
 *
 * Temporada de septiembre a agosto. De cada temporada terminada se toma la última lista
 * publicada; de la temporada en curso, la más reciente. Sin id FIE ni nacimiento: vínculo por
 * nombre, país GBR y género.
 */

export const BF_BASE = 'https://www.britishfencing.com';
export const urlsSitemapBf = (n = 10) => Array.from({ length: n }, (_, i) => `${BF_BASE}/post-sitemap${i === 0 ? '' : i + 1}.xml`);

const CATEGORIAS: Record<string, { categoria: Categoria; raw: string }> = {
  senior: { categoria: 'ABS', raw: 'Senior' },
  u23: { categoria: 'M23', raw: 'U23' },
  junior: { categoria: 'M20', raw: 'Junior' },
  cadet: { categoria: 'M17', raw: 'Cadet' },
  'under-14': { categoria: 'M14', raw: 'U14' },
};
const ARMAS: Record<string, Arma> = { epee: 'ESPADA', foil: 'FLORETE', sabre: 'SABLE' };
const MESES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export type EntradaBf = {
  url: string;
  slug: string;
  categoria: string;
  genero: Genero;
  arma: Arma;
  /** Día de la lista (YYYY-MM-DD), del propio nombre de la entrada o de su fecha de publicación. */
  fecha: string;
};

/** Temporada de BF (septiembre-agosto) de un día. */
export function temporadaBf(fecha: string): string {
  const y = Number(fecha.slice(0, 4));
  const inicio = Number(fecha.slice(5, 7)) >= 9 ? y : y - 1;
  return `${inicio}-${inicio + 1}`;
}

/** Entradas de lista individual del ranking en un `post-sitemap*.xml`. */
export function entradasSitemapBf(xml: string): EntradaBf[] {
  const salida: EntradaBf[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) {
    const url = desescaparXml(m[1]).trim();
    const slug = url.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
    const t = /^(senior|u23|junior|cadet|under-14)-(mens|womens)-(epee|foil|sabre)-(.+)$/.exec(slug);
    if (!t) continue;
    const resto = t[4];
    let fecha: string | null = null;
    const d = /^(\d{2})-(\d{2})-(\d{4})(?:-\d{4})?$/.exec(resto);
    const mes = /^(?:\d{1,2}(?:st|nd|rd|th)-)?([a-z]+)-(\d{4})$/.exec(resto);
    if (d) fecha = `${d[3]}-${d[2]}-${d[1]}`;
    else if (mes && MESES.includes(mes[1])) fecha = `${mes[2]}-${String(MESES.indexOf(mes[1]) + 1).padStart(2, '0')}-01`;
    if (!fecha || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) continue;
    salida.push({ url, slug, categoria: t[1], genero: t[2] === 'mens' ? 'M' : 'F', arma: ARMAS[t[3]], fecha });
  }
  return salida;
}

/**
 * Listas que se leen: la última de cada temporada terminada y la más reciente de la temporada
 * en curso (la de `hoy`), por categoría, género y arma.
 */
export function elegirListasBf(entradas: readonly EntradaBf[], hoy: string): (EntradaBf & { temporada: string; cerrada: boolean })[] {
  const actual = temporadaBf(hoy);
  const mejor = new Map<string, EntradaBf>();
  for (const e of entradas) {
    if (e.fecha > hoy) continue;
    const k = `${e.categoria}|${e.genero}|${e.arma}|${temporadaBf(e.fecha)}`;
    const p = mejor.get(k);
    if (!p || e.fecha > p.fecha || (e.fecha === p.fecha && e.slug > p.slug)) mejor.set(k, e);
  }
  return [...mejor.values()].map((e) => ({ ...e, temporada: temporadaBf(e.fecha), cerrada: temporadaBf(e.fecha) < actual }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export const archivoBf = (e: Pick<EntradaBf, 'slug'>) => `${e.slug}.html`;

const limpiar = (s: string) => desescaparXml(s.replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/g, ' ').replace(/&#8217;|&#039;/g, "'").replace(/\s+/g, ' ').trim();

/** Filas de la primera tabla con columnas de puesto y nombre; columnas por su cabecera. */
export function filasTablaBf(html: string): { puesto: number | null; nombre: string; licencia: string | null; puntos: string | null }[] {
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const tabla = t[0];
    const cab = [...(/<thead>[\s\S]*?<\/thead>/i.exec(tabla)?.[0] ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => limpiar(m[1]).toLowerCase());
    const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
    const iPuesto = col(/^(rank|position|pos)\b/);
    const iNombre = col(/name|surname/);
    const iLicencia = col(/licen|bf number|bf no/);
    const iPuntos = col(/total|points/);
    if (iPuesto < 0 || iNombre < 0) continue;
    const cuerpo = /<tbody>([\s\S]*?)<\/tbody>/i.exec(tabla)?.[1] ?? '';
    const filas = [];
    for (const tr of cuerpo.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const c = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => limpiar(m[1]));
      const nombre = c[iNombre] ?? '';
      if (!nombre) continue;
      const puesto = Number(c[iPuesto]);
      const lic = iLicencia >= 0 ? c[iLicencia] ?? '' : '';
      const pts = iPuntos >= 0 ? (c[iPuntos] ?? '').replace(/,/g, '') : '';
      filas.push({
        puesto: Number.isInteger(puesto) && puesto > 0 ? puesto : null,
        nombre,
        licencia: /^\d{1,7}$/.test(lic) ? lic : null,
        puntos: /^-?\d+(\.\d+)?$/.test(pts) ? pts : null,
      });
    }
    if (filas.length) return filas;
  }
  return [];
}

export function listaBf(e: EntradaBf & { temporada: string }, html: string): ListaInternacional | null {
  const filas = filasTablaBf(html);
  if (!filas.length) return null;
  const vistos = new Set<string>();
  const convertidas: FilaInternacional[] = [];
  for (const f of filas) {
    let ref = f.licencia ? `bf:${f.licencia}` : `bf:${f.nombre.toLowerCase().replace(/\s+/g, '_')}`;
    if (vistos.has(ref)) ref = `${ref}#${f.puesto ?? convertidas.length + 1}`;
    vistos.add(ref);
    convertidas.push({ ref, nombre: f.nombre, pais: null, puesto: f.puesto, puntos: f.puntos });
  }
  const c = CATEGORIAS[e.categoria];
  return {
    fuente: 'bf_ranking',
    temporada: e.temporada,
    arma: e.arma,
    genero: e.genero,
    categoria: c.categoria,
    categoriaRaw: c.raw,
    publicadoEl: e.fecha,
    baseFecha: 'source',
    url: e.url,
    total: filas.length,
    filas: convertidas,
  };
}
