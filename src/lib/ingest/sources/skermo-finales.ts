import { normalizarLicencia } from '@/lib/entries/identidad';
import { normalizeLabel } from '../mappers';
import type { EstadoCobertura } from './fie-resultados';
import { fuenteDeFederacionSkermo, clavePruebaSkermo, type FuenteHistorica } from './historico-indice';
import {
  parseSkermoCompetitionResults,
  skermoCompetitionResultsUrl,
  type SkermoResultsIndexRow,
} from './skermo-results';

/**
 * Adaptador de PUESTOS FINALES de Skermo (RFEE y federaciones autonómicas)
 * sobre el modelo deportivo, para cualquier temporada del selector.
 *
 * Reutiliza el parser de la clasificación HTML y no vuelve a decidir nada por
 * su cuenta:
 *  - la temporada es la del selector del índice del que sale la fila; si el
 *    título de la clasificación declara otra, la prueba queda en `conflicto` y
 *    no se importa;
 *  - la categoría es la de la fuente. Si no se reconoce («M10», «M12»…) la
 *    prueba no se importa ni se aproxima: queda en `error` con el literal;
 *  - los puestos son los publicados: empates repetidos, huecos y filas sin
 *    número se conservan tal cual, sin renumerar;
 *  - una clasificación por equipos se guarda como tal (clave `team:`), nunca
 *    con identidad de persona, y nada de esto alimenta el cara a cara;
 *  - una licencia es una clave de ámbito (federación y temporada), no una
 *    persona: la identidad se resuelve en la capa de persistencia con el
 *    guard compartido y jamás por nombre.
 */

export const CATEGORIAS_SKERMO = [
  'M7',
  'M9',
  'M11',
  'M13',
  'M14',
  'M15',
  'M17',
  'M20',
  'M23',
  'ABS',
  'VET',
] as const;
export type CategoriaSkermo = (typeof CATEGORIAS_SKERMO)[number];

export type PruebaSkermo = {
  fuente: FuenteHistorica;
  federacion: string;
  /** Etiqueta de temporada del selector («2025-2026»). */
  season: string;
  competitionId: string;
  /** `FED:id`: el id de Skermo sólo es único dentro de su federación. */
  competitionKey: string;
  nombre: string;
  fecha: string;
  arma: 'FLORETE' | 'ESPADA' | 'SABLE';
  genero: 'M' | 'F' | 'MIXTO';
  categoria: CategoriaSkermo;
  categoriaOriginal: string | null;
  formato: 'INDIVIDUAL' | 'EQUIPOS';
  ciudad: string | null;
  url: string;
};

export type PuestoSkermo = {
  sourceFactKey: string;
  /** Puesto publicado; `null` si la fuente no lo da como número. */
  posicion: number | null;
  posicionRaw: string | null;
  /** Licencia normalizada. Siempre `null` en equipos. */
  licencia: string | null;
  nombre: string;
  club: string | null;
  puntos: string | null;
};

export type LecturaSkermo = {
  season: string;
  federacion: string;
  competitionKey: string;
  prueba: PruebaSkermo | null;
  puestos: PuestoSkermo[];
  cobertura: {
    estado: EstadoCobertura;
    /** Filas que publica la clasificación (leídas + descuadradas). */
    publicado: number | null;
    importado: number;
    error: string | null;
  };
  /** Filas que no se importaron y por qué; nunca se descartan sin contar. */
  excluidas: { descuadradas: number; sinNombre: number; licenciaRepetida: number };
  url: string;
};

export type DepsLecturaSkermo = {
  html: (url: string) => Promise<string>;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function resultado(
  base: Pick<LecturaSkermo, 'season' | 'federacion' | 'competitionKey' | 'url'>,
  estado: EstadoCobertura,
  error: string | null,
  extra: Partial<Pick<LecturaSkermo, 'prueba' | 'puestos' | 'excluidas'>> & {
    publicado?: number | null;
  } = {},
): LecturaSkermo {
  return {
    ...base,
    prueba: extra.prueba ?? null,
    puestos: extra.puestos ?? [],
    cobertura: {
      estado,
      publicado: extra.publicado ?? null,
      importado: extra.puestos?.length ?? 0,
      error,
    },
    excluidas: extra.excluidas ?? { descuadradas: 0, sinNombre: 0, licenciaRepetida: 0 },
  };
}

/**
 * Lee la clasificación HTML de una fila del índice de resultados. Una fila
 * sin ID de clasificación no es importable aquí (su documento es PDF o
 * externo): se devuelve `pendiente`, no vacía.
 */
export async function leerFinalSkermo(
  fila: SkermoResultsIndexRow,
  contexto: { federacion: string; season: string },
  deps: DepsLecturaSkermo,
): Promise<LecturaSkermo> {
  const { federacion, season } = contexto;
  if (!fila.competitionId) {
    return resultado(
      { season, federacion, competitionKey: '', url: '' },
      'pendiente',
      'La fila no publica clasificación HTML; su documento es PDF o externo',
    );
  }

  const competitionKey = clavePruebaSkermo(federacion, fila.competitionId);
  const url = skermoCompetitionResultsUrl(federacion, fila.competitionId);
  const base = { season, federacion, competitionKey, url };

  let html: string;
  try {
    html = await deps.html(url);
  } catch (e) {
    return resultado(base, 'error', e instanceof Error ? e.message : String(e));
  }

  const leida = parseSkermoCompetitionResults(html, { federationCode: federacion, competitionId: fila.competitionId });
  const { meta } = leida;

  if (meta.seasonLabel && meta.seasonLabel !== season) {
    return resultado(
      base,
      'conflicto',
      `El título declara la temporada ${meta.seasonLabel} y el índice ${season}: no se importa`,
    );
  }

  const fecha = meta.date ?? fila.date;
  const arma = meta.weapon ?? fila.weapon;
  const genero = meta.gender ?? fila.gender;
  const formato = meta.format ?? fila.format;
  const categoriaOriginal = meta.categoryRaw ?? fila.categoryRaw;
  const categoria = (meta.category ?? fila.category) as CategoriaSkermo | null;

  if (!categoria || !CATEGORIAS_SKERMO.includes(categoria)) {
    return resultado(
      base,
      'error',
      `Categoría sin equivalencia${categoriaOriginal ? ` («${categoriaOriginal}»)` : ''}: no se importa ni se aproxima`,
    );
  }
  const faltan = [
    !fecha || !ISO.test(fecha) ? 'fecha' : null,
    !arma ? 'arma' : null,
    !genero ? 'género' : null,
    !formato ? 'modalidad' : null,
  ].filter(Boolean);
  if (faltan.length > 0 || !fecha || !arma || !genero || !formato) {
    return resultado(base, 'error', `La prueba no publica: ${faltan.join(', ')}`);
  }

  const prueba: PruebaSkermo = {
    fuente: fuenteDeFederacionSkermo(federacion),
    federacion,
    season,
    competitionId: fila.competitionId,
    competitionKey,
    nombre: meta.name || fila.name,
    fecha,
    arma,
    genero,
    categoria,
    categoriaOriginal,
    formato,
    ciudad: meta.city ?? fila.city,
    url,
  };

  const equipos = formato === 'EQUIPOS';
  const usadas = new Map<string, number>();
  const excluidas = { descuadradas: leida.mismatches, sinNombre: 0, licenciaRepetida: 0 };
  const puestos: PuestoSkermo[] = [];

  for (const r of leida.rows) {
    const nombre = r.sourceAthleteName.trim();
    if (nombre.length < 2) {
      excluidas.sinNombre += 1;
      continue;
    }
    const licencia = !equipos && r.sourceLicense ? normalizarLicencia(r.sourceLicense) : null;
    const clave = licencia ? `lic:${licencia}` : `${equipos ? 'team' : 'n'}:${normalizeLabel(nombre)}`;
    const n = (usadas.get(clave) ?? 0) + 1;
    usadas.set(clave, n);
    if (n > 1 && licencia) excluidas.licenciaRepetida += 1;
    puestos.push({
      sourceFactKey: n > 1 ? `${clave}#${n}` : clave,
      posicion: r.position,
      posicionRaw: r.positionRaw,
      licencia,
      nombre,
      club: r.sourceClub,
      puntos: r.officialPoints,
    });
  }

  // Una licencia repetida en la misma clasificación es contradictoria: se
  // conservan todos los puestos, pero ninguna de esas filas lleva identidad.
  const repetidas = new Set(puestos.filter((p) => p.sourceFactKey.includes('#')).map((p) => p.licencia));
  for (const p of puestos) if (p.licencia && repetidas.has(p.licencia)) p.licencia = null;

  const publicado = leida.rowsSeen + leida.mismatches;
  const faltantes = excluidas.descuadradas + excluidas.sinNombre;
  const estado: EstadoCobertura =
    publicado === 0
      ? 'sin_resultados'
      : faltantes > 0
        ? 'parcial'
        : excluidas.licenciaRepetida > 0
          ? 'conflicto'
          : 'completo';
  const error =
    estado === 'completo' || estado === 'sin_resultados'
      ? null
      : `descuadradas=${excluidas.descuadradas} sinNombre=${excluidas.sinNombre} licenciaRepetida=${excluidas.licenciaRepetida}`;

  return resultado(base, estado, error, { prueba, puestos, excluidas, publicado });
}
