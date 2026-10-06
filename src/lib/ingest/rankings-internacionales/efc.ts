import { normalizeSportName } from '@/lib/identity/resolver';
import type { HojaXlsx } from './xlsx';
import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking europeo de la EFC en su web propia (`fencing-efc.eu/rankings`,
 * robots.txt sin restricciones). La página pública tiene un botón «Download»
 * que pide la misma URL con `download_action=download` y devuelve la lista
 * entera en .xlsx (Rank, Points, Name, Country COI, Hand, Year of birth): una
 * petición por lista en vez de una por cada 10 filas.
 * Filtros por GET: season (año de inicio, desde 2006), age, gender, weapon, team.
 * La EFC sólo publica ranking propio de U14, cadete (circuito europeo) y U23;
 * júnior y absoluto europeos se rigen por el ranking FIE.
 */

export const EFC_BASE = 'https://www.fencing-efc.eu/rankings';
export const EDADES_EFC = { cadet: 'M17', u23: 'M23', u14: 'M14' } as const satisfies Record<string, Categoria>;
const ARMAS_EFC = { foil: 'FLORETE', epee: 'ESPADA', sabre: 'SABLE' } as const satisfies Record<string, Arma>;
const GENEROS_EFC = { men: 'M', women: 'F' } as const satisfies Record<string, Genero>;

export type ComboEfc = { season: number; age: keyof typeof EDADES_EFC; weapon: keyof typeof ARMAS_EFC; gender: keyof typeof GENEROS_EFC };

export function combosEfc(temporadas: readonly number[], edades: readonly ComboEfc['age'][] = Object.keys(EDADES_EFC) as ComboEfc['age'][]): ComboEfc[] {
  return temporadas.flatMap((season) =>
    edades.flatMap((age) =>
      (Object.keys(ARMAS_EFC) as ComboEfc['weapon'][]).flatMap((weapon) =>
        (Object.keys(GENEROS_EFC) as ComboEfc['gender'][]).map((gender) => ({ season, age, weapon, gender })))));
}

export function urlEfc(c: ComboEfc, descarga: boolean): string {
  const q = new URLSearchParams({ season: String(c.season), age: c.age, gender: c.gender, weapon: c.weapon, team: 'individual' });
  if (descarga) q.set('download_action', 'download');
  return `${EFC_BASE}?${q.toString()}`;
}

export const archivoEfc = (c: ComboEfc) => `${c.season}-${c.age}-${c.weapon}-${c.gender}.xlsx`;

/** Temporadas que ofrece el selector de la página (año de inicio). */
export function temporadasEfc(html: string): number[] {
  return [...new Set([...html.matchAll(/js-select-option[^"]*js-click-form"\s+data-value="(\d{4})"/g)].map((m) => Number(m[1])))].sort();
}

/** `null` si la hoja no tiene la cabecera esperada. Una hoja sin filas es una lista vacía. */
export function listaEfc(c: ComboEfc, hojas: readonly HojaXlsx[], hoy: string): ListaInternacional | null {
  const hoja = hojas[0];
  if (!hoja) return null;
  const cab = (hoja.filas[0] ?? []).map((x) => x.toLowerCase());
  const col = (n: string) => cab.indexOf(n);
  const [iRank, iPts, iNom, iPais, iNac] = [col('rank'), col('points'), col('name'), col('country'), col('year of birth')];
  if (iRank < 0 || iNom < 0 || iPais < 0) return null;
  const filas: FilaInternacional[] = [];
  const vistos = new Set<string>();
  for (const f of hoja.filas.slice(1)) {
    const nombre = (f[iNom] ?? '').trim();
    if (!nombre) continue;
    const pais = /^[A-Z]{3}$/.test(f[iPais] ?? '') ? f[iPais] : null;
    const nacimiento = iNac >= 0 && /^(19|20)\d\d$/.test(f[iNac] ?? '') ? Number(f[iNac]) : null;
    // La EFC no publica un id en la descarga: la referencia es nombre + país + año.
    let ref = `efc:${pais ?? ''}:${normalizeSportName(nombre).replace(/ /g, '_')}:${nacimiento ?? ''}`;
    if (vistos.has(ref)) ref = `${ref}#${filas.length + 1}`;
    vistos.add(ref);
    const puesto = Number(f[iRank]);
    const puntos = iPts >= 0 ? (f[iPts] ?? '').trim() : '';
    filas.push({
      ref,
      nombre,
      pais,
      puesto: Number.isInteger(puesto) && puesto > 0 ? puesto : null,
      puntos: puntos === '' ? null : puntos,
      anioNacimiento: nacimiento,
    });
  }
  return {
    fuente: 'efc_ranking',
    temporada: `${c.season}-${c.season + 1}`,
    arma: ARMAS_EFC[c.weapon],
    genero: GENEROS_EFC[c.gender],
    categoria: EDADES_EFC[c.age],
    categoriaRaw: c.age,
    publicadoEl: hoy,
    baseFecha: 'observed',
    url: urlEfc(c, false),
    total: filas.length,
    filas,
  };
}
