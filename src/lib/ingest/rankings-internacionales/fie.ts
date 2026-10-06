import { fieDetailedRankingUrl } from '../sources/fie-tiradores';
import type { Arma, Categoria, FilaInternacional, ListaInternacional } from './tipos';

/**
 * Histórico del ranking mundial FIE: `GET /api/fie/fencers/detailed-ranking`
 * acepta temporadas pasadas (comprobado: absoluto y júnior desde 2003-2004,
 * cadete y veterano después) y devuelve la lista con el `addrId` de cada
 * tirador, que es el mismo identificador que `sport_external_id.fie_addr_id`.
 * La `season` FIE es el año en que acaba la temporada (2024 = 2023-2024).
 *
 * Entran todas las naciones: el usuario confirmó que el permiso cubre todo el
 * contenido de la FIE (*«todos tenemos todo esto y los permisos para todo»*).
 * Solo nombre, país, puesto y puntos; la FIE no publica más en esta lista.
 */

export const ARMAS_FIE = { F: 'FLORETE', E: 'ESPADA', S: 'SABLE' } as const satisfies Record<string, Arma>;
export const CATEGORIAS_FIE = { S: 'ABS', J: 'M20', C: 'M17', V: 'VET' } as const satisfies Record<string, Categoria>;

export type ComboFie = { season: number; weapon: keyof typeof ARMAS_FIE; gender: 'M' | 'F'; category: keyof typeof CATEGORIAS_FIE };

export function combosFie(desde: number, hasta: number): ComboFie[] {
  const salida: ComboFie[] = [];
  for (let season = desde; season <= hasta; season += 1) {
    for (const weapon of ['F', 'E', 'S'] as const) {
      for (const gender of ['M', 'F'] as const) {
        for (const category of ['S', 'J', 'C', 'V'] as const) salida.push({ season, weapon, gender, category });
      }
    }
  }
  return salida;
}

export const urlFie = (c: ComboFie) => fieDetailedRankingUrl({ ...c, tipo: 'I' });
export const archivoFie = (c: ComboFie) => `dr-${c.season}-${c.weapon}${c.gender}${c.category}.json`;

type FilaBruta = { rank?: unknown; addrId?: unknown; name?: unknown; countryCode?: unknown; points?: unknown };

/** `null` si la respuesta no es la lista pedida (otra temporada, arma o género) o no tiene la forma esperada. */
export function parseRankingFie(json: unknown, c: ComboFie, hoy: string): ListaInternacional | null {
  const d = json as { season?: unknown; weapon?: unknown; gender?: unknown; type?: unknown; fencers?: unknown } | null;
  if (!d || d.season !== c.season || d.weapon !== c.weapon || d.gender !== c.gender || d.type !== 'I' || !Array.isArray(d.fencers)) return null;
  const vistos = new Set<number>();
  const filas: FilaInternacional[] = [];
  for (const f of d.fencers as FilaBruta[]) {
    if (typeof f.addrId !== 'number' || !Number.isInteger(f.addrId) || f.addrId <= 0 || vistos.has(f.addrId)) continue;
    vistos.add(f.addrId);
    const nombre = typeof f.name === 'string' ? f.name.trim() : '';
    filas.push({
      ref: `fie:${f.addrId}`,
      nombre,
      pais: typeof f.countryCode === 'string' && /^[A-Z]{3}$/.test(f.countryCode.trim()) ? f.countryCode.trim() : null,
      puesto: typeof f.rank === 'number' && Number.isInteger(f.rank) && f.rank > 0 ? f.rank : null,
      puntos: f.points === null || f.points === undefined || String(f.points).trim() === '' ? null : String(f.points).trim(),
      fieId: f.addrId,
    });
  }
  return {
    fuente: 'fie_historico',
    temporada: String(c.season),
    arma: ARMAS_FIE[c.weapon],
    genero: c.gender,
    categoria: CATEGORIAS_FIE[c.category],
    categoriaRaw: c.category,
    publicadoEl: hoy,
    baseFecha: 'observed',
    url: urlFie(c),
    total: d.fencers.length,
    filas,
  };
}
