import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Rankings nacionales de la Australian Fencing Federation (`ausfencing.org`,
 * robots.txt sin exclusiones para estas páginas). Cada página (Open, Junior,
 * Cadet) es un acordeón con una tabla por arma y género: `Rank`, `Fencer`
 * («CROOK, Jacob (QLD)» enlazado a `/biography/afb-1956`), `Pts` y el
 * desglose, seguida de «Current as of October 7, 2026 9:05 am».
 *
 * Los tiradores de fuera (sin puesto, marcados «*») llevan el país entre
 * paréntesis («BAKER, Matt (NZL)»): entran sin puesto y con ese país; si el
 * paréntesis está vacío no se leen. Sólo se publica la lista vigente.
 * Las páginas Youth y AYC no dicen a qué edad corresponden y no se leen.
 */

export const AFF_BASE = 'https://www.ausfencing.org';

export type PaginaAff = { ruta: string; categoria: Categoria; raw: string };

export const PAGINAS_AFF: readonly PaginaAff[] = [
  { ruta: 'open-rankings', categoria: 'ABS', raw: 'Open' },
  { ruta: 'junior-rankings', categoria: 'M20', raw: 'Junior' },
  { ruta: 'cadet-rankings', categoria: 'M17', raw: 'Cadet' },
];

export const urlAff = (p: PaginaAff) => `${AFF_BASE}/${p.ruta}/`;

const ESTADOS = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
const MESES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function armaGenero(etiqueta: string): { arma: Arma; genero: Genero } | null {
  const t = etiqueta.toLowerCase().replace(/[’']/g, '');
  const genero: Genero | null = /^(men|boy)s?\b/.test(t) ? 'M' : /^(women|girl)s?\b/.test(t) ? 'F' : null;
  const arma: Arma | null = /\bepee\b/.test(t) ? 'ESPADA' : /\bfoil\b/.test(t) ? 'FLORETE' : /\bsabre\b/.test(t) ? 'SABLE' : null;
  return genero && arma ? { arma, genero } : null;
}

/** «October 7, 2026» → 2026-10-07. */
export function fechaAff(s: string): string | null {
  const m = /Current as of ([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(s);
  const mes = m && MESES[m[1].toLowerCase()];
  if (!m || !mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Temporada australiana de julio a junio, como la FIE: «2026-2027» desde agosto de 2026. */
export const temporadaAff = (dia: string) => {
  const [a, m] = dia.split('-').map(Number);
  return m >= 7 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
};

/** «SO, Wing Tung (Christal) (QLD)» → apellido «SO», nombre «Wing Tung», origen «QLD». */
export function nombreAff(s: string): { nombre: string; origen: string } | null {
  const m = /^(.*)\(([A-Z]*)\)\s*$/.exec(s.trim());
  if (!m) return null;
  const limpio = m[1].replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const c = limpio.indexOf(',');
  if (c <= 0) return null;
  const apellido = limpio.slice(0, c).trim().toUpperCase();
  const nombre = limpio.slice(c + 1).trim();
  if (!apellido) return null;
  return { nombre: `${apellido} ${nombre}`.trim(), origen: m[2] };
}

function puntos(v: string): string | null {
  const t = v.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return String(Math.round(Number(t) * 100) / 100);
}

export function listasAff(p: PaginaAff, html: string, diaLectura: string): ListaInternacional[] {
  const salida: ListaInternacional[] = [];
  const bloques = html.split(/class="fl-accordion-button-label"[^>]*>/).slice(1);
  for (const bloque of bloques) {
    const ag = armaGenero(texto(bloque.slice(0, bloque.indexOf('<'))));
    const tabla = /<tbody>([\s\S]*?)<\/tbody>/.exec(bloque);
    if (!ag || !tabla) continue;
    const fecha = fechaAff(texto(bloque.slice(tabla.index + tabla[0].length)));
    const dia = fecha ?? diaLectura;
    const filas: FilaInternacional[] = [];
    const refs = new Set<string>();
    for (const tr of tabla[1].split(/<tr class="row-\d+[^"]*">/).slice(1)) {
      const celdas = [...tr.matchAll(/<td class="column-(\d+)">([\s\S]*?)<\/td>/g)];
      const celda = (n: number) => celdas.find((c) => c[1] === String(n))?.[2] ?? '';
      const rango = texto(celda(1));
      const fencerHtml = celda(2);
      const persona = nombreAff(texto(fencerHtml));
      if (!persona) continue;
      const enEstado = ESTADOS.has(persona.origen);
      const puesto = /^\d+$/.test(rango) ? Number(rango) : null;
      let pais: string | null = null;
      if (puesto === null || !enEstado) {
        // Sin puesto o sin estado australiano: sólo con un país COI explícito.
        if (!/^[A-Z]{3}$/.test(persona.origen) || ESTADOS.has(persona.origen) || persona.origen === 'AUS') continue;
        pais = persona.origen;
      }
      const id = /href="\/biography\/afb-(\d+)"/.exec(fencerHtml)?.[1] ?? /#intl-(\d+)[A-Za-z]/.exec(tr)?.[1];
      let ref = id ? `aff:${id}` : `aff:${persona.nombre}`.replace(/\s+/g, '_');
      if (refs.has(ref)) ref = `${ref}#${puesto ?? filas.length + 1}`;
      refs.add(ref);
      filas.push({ ref, nombre: persona.nombre, pais, puesto, puntos: puntos(texto(celda(3))) });
    }
    if (!filas.length) continue;
    salida.push({
      fuente: 'aff_ranking', temporada: temporadaAff(dia), arma: ag.arma, genero: ag.genero, categoria: p.categoria, categoriaRaw: p.raw,
      publicadoEl: dia, baseFecha: fecha ? 'source' : 'observed', url: urlAff(p), total: filas.length, filas,
    });
  }
  return salida;
}
