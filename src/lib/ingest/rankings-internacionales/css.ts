import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Žebříček (Český pohár) del Český šermířský svaz (`czechfencing.cz`; sin
 * robots.txt, así que no hay exclusiones). La web lee la API pública
 * `/api/public-zone/...` en su mismo anfitrión:
 *
 * - `seasons`: temporadas (`2025 - 2026`, `validTill`, `stateId` ARCHIVED o
 *   ACTIVE) con un UUID cada una.
 * - `tournaments/stat-ranks/{temporada}/{categoría}/{disciplina}`: el ranking
 *   de esa temporada; `totals[]` con `personId`, `personFullName` («Jurka
 *   Jakub», apellido primero), `personBirthYear`, `cpRank` y `cpTotalPoints`.
 *   `log.startDateTime` es el último cálculo.
 *
 * El listado `tournaments/rankings/list` que también describe el swagger
 * contesta 404: la federación no usa ese módulo y la web no lo pide.
 */

export const CSS_BASE = 'https://www.czechfencing.cz';
export const CSS_PAGINA = `${CSS_BASE}/zebricky`;
export const CSS_TEMPORADAS = `${CSS_BASE}/api/public-zone/seasons`;

/** `ageCategoryId` del codebook (`/api/global-zone/codebook`). Mini y mladší žáci no se leen. */
export const CATEGORIAS_CSS: readonly { id: number; genero: Genero; categoria: Categoria; raw: string }[] = [
  { id: 4, genero: 'M', categoria: 'ABS', raw: 'Senioři' },
  { id: 3, genero: 'F', categoria: 'ABS', raw: 'Seniorky' },
  { id: 1, genero: 'M', categoria: 'M20', raw: 'Junioři' },
  { id: 2, genero: 'F', categoria: 'M20', raw: 'Juniorky' },
  { id: 5, genero: 'M', categoria: 'M17', raw: 'Kadeti' },
  { id: 6, genero: 'F', categoria: 'M17', raw: 'Kadetky' },
  { id: 9, genero: 'M', categoria: 'M15', raw: 'Žáci' },
  { id: 10, genero: 'F', categoria: 'M15', raw: 'Žačky' },
];

export const DISCIPLINAS_CSS: readonly { id: number; arma: Arma }[] = [
  { id: 1, arma: 'ESPADA' },
  { id: 2, arma: 'FLORETE' },
  { id: 3, arma: 'SABLE' },
];

export type TemporadaCss = { id: string; temporada: string; fin: string; activa: boolean };

export function temporadasCss(json: unknown, desde: number): TemporadaCss[] {
  if (!Array.isArray(json)) return [];
  const salida: TemporadaCss[] = [];
  for (const s of json as { id?: unknown; name?: unknown; validTill?: unknown; stateId?: unknown }[]) {
    const m = typeof s.name === 'string' ? /^(\d{4})\s*-\s*(\d{4})$/.exec(s.name.trim()) : null;
    if (!m || typeof s.id !== 'string' || Number(m[2]) !== Number(m[1]) + 1 || Number(m[1]) < desde) continue;
    const fin = typeof s.validTill === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.validTill) ? s.validTill.slice(0, 10) : `${m[2]}-08-31`;
    salida.push({ id: s.id, temporada: `${m[1]}-${m[2]}`, fin, activa: s.stateId === 'ACTIVE' });
  }
  return salida.sort((a, b) => a.temporada.localeCompare(b.temporada));
}

export type ComboCss = { temporada: TemporadaCss; categoria: (typeof CATEGORIAS_CSS)[number]; disciplina: (typeof DISCIPLINAS_CSS)[number] };

export function combosCss(temporadas: readonly TemporadaCss[]): ComboCss[] {
  return temporadas.flatMap((temporada) => CATEGORIAS_CSS.flatMap((categoria) => DISCIPLINAS_CSS.map((disciplina) => ({ temporada, categoria, disciplina }))));
}

export const urlCss = (c: ComboCss) => `${CSS_BASE}/api/public-zone/tournaments/stat-ranks/${c.temporada.id}/${c.categoria.id}/${c.disciplina.id}`;

/** Las temporadas abiertas se recalculan cada noche: su fichero lleva el día de lectura. */
export const archivoCss = (c: ComboCss, dia: string) =>
  `${c.temporada.activa ? `${dia}-` : ''}${c.temporada.temporada}-${c.categoria.id}-${c.disciplina.id}.json`;

function puntos(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return String(Math.round(v * 100) / 100);
}

export function listaCss(c: ComboCss, json: unknown, diaLectura: string): ListaInternacional | null {
  const datos = json as { totals?: unknown; log?: { startDateTime?: unknown } | null } | null;
  if (!datos || !Array.isArray(datos.totals)) return null;
  const filas: FilaInternacional[] = [];
  const refs = new Set<string>();
  for (const t of datos.totals as { personId?: unknown; personFullName?: unknown; personBirthYear?: unknown; cpRank?: unknown; cpTotalPoints?: unknown }[]) {
    if (typeof t.personId !== 'string' || typeof t.personFullName !== 'string' || !/\p{L}/u.test(t.personFullName)) continue;
    const ref = `css:${t.personId}`;
    if (refs.has(ref)) continue;
    refs.add(ref);
    const anio = typeof t.personBirthYear === 'number' && t.personBirthYear > 1900 ? t.personBirthYear : null;
    const puesto = typeof t.cpRank === 'number' && Number.isInteger(t.cpRank) && t.cpRank > 0 ? t.cpRank : null;
    filas.push({ ref, nombre: t.personFullName.replace(/\s+/g, ' ').trim(), pais: null, puesto, puntos: puntos(t.cpTotalPoints), anioNacimiento: anio });
  }
  if (!filas.length) return null;
  const calculo = typeof datos.log?.startDateTime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(datos.log.startDateTime) ? datos.log.startDateTime.slice(0, 10) : null;
  // Una temporada archivada ya no cambia: su lista es la del final de la temporada.
  const dia = c.temporada.activa ? (calculo ?? diaLectura) : c.temporada.fin;
  return {
    fuente: 'css_zebricek', temporada: c.temporada.temporada, arma: c.disciplina.arma, genero: c.categoria.genero, categoria: c.categoria.categoria,
    categoriaRaw: c.categoria.raw, publicadoEl: dia, baseFecha: c.temporada.activa && !calculo ? 'observed' : 'source',
    url: CSS_PAGINA, total: filas.length, filas,
  };
}
