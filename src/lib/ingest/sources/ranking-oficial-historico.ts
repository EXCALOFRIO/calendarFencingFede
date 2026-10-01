import { z } from 'zod';
import { mapCategoryPublicada, type CategoriaPublicada } from '../mappers';
import type { EstadoCobertura } from './fie-resultados';
import { COMBINACIONES_FIE, fieDetailedRankingUrl, type TipoRankingFie } from './fie-tiradores';
import { puestoPublicado, rankingCombos, type RankingCombo, type SkermoCategoryOption } from './ranking-rfee';
import {
  parseSkermoNationalRanking,
  SKERMO_GENDER_CODE,
  SKERMO_WEAPON_CODE,
  skermoNationalRankingUrl,
} from './skermo-results';

/**
 * RANKINGS OFICIALES (RFEE en Skermo y mundial de la FIE) POR TEMPORADA.
 *
 * Una publicación es la lista que la fuente da para una temporada, arma,
 * género, categoría y modalidad. Se guarda como tal, sin mezclarla con nada:
 *
 *  - no es el puesto final de ningún torneo (esos son `sport_result`) ni el
 *    cálculo interno privado (`ranking_snapshot`/`ranking_point`);
 *  - la temporada es la que se pide y, en la FIE, la que la respuesta declara:
 *    si no coinciden no se importa nada, y nunca se sustituye por la última;
 *  - ninguna de las dos fuentes publica la fecha del ranking, así que
 *    `publicadoEl` es el día en que se leyó. La evolución sólo existe si hay
 *    varias lecturas reales; aquí no se calcula ni se rellena ninguna;
 *  - individual y selecciones/equipos son modalidades distintas (en la FIE,
 *    `type=I` frente a `type=E`; el `addrId` de un equipo es del equipo);
 *  - `null` es «la fuente no publica puntos», y `0` es cero: no se confunden;
 *  - no se guarda fecha de nacimiento, club, foto ni ficha, aunque la fuente
 *    los publique junto al puesto.
 */

export type FuenteRanking = 'skermo_ranking' | 'fie_tiradores';

export type EntradaRanking = {
  /** ID del participante en la fuente: `skermo:<id>`, `fie:<id>` o `team:<id>`. */
  sourceRef: string;
  nombre: string | null;
  pais: string | null;
  /** Puesto publicado; `null` si la fuente no clasifica a esa fila (Skermo: 9999). */
  posicion: number | null;
  puntos: string | null;
  /** Referencia con la que se buscaría una persona ya confirmada. Nunca el nombre. */
  referencia: { tipo: 'fie'; fieId: number } | { tipo: 'skermo'; skermoId: string } | null;
};

export type PublicacionRanking = {
  fuente: FuenteRanking;
  /** Temporada en el vocabulario de la fuente: «2021-2022» (RFEE) o «2024» (FIE). */
  season: string;
  arma: 'FLORETE' | 'ESPADA' | 'SABLE';
  genero: 'M' | 'F';
  categoria: CategoriaPublicada;
  categoriaOriginal: string;
  formato: 'INDIVIDUAL' | 'EQUIPOS';
  /** Día (YYYY-MM-DD) en que se leyó: las fuentes no publican la fecha. */
  publicadoEl: string;
  url: string;
  /** Filas que publica la lista. */
  total: number;
  entradas: EntradaRanking[];
};

export type LecturaRanking = {
  fuente: FuenteRanking;
  season: string;
  /** `arma|género|categoría original|modalidad`: clave de cobertura de la lista. */
  clave: string;
  url: string;
  publicacion: PublicacionRanking | null;
  cobertura: {
    estado: EstadoCobertura;
    publicado: number | null;
    importado: number;
    error: string | null;
  };
  excluidas: { descuadradas: number; sinId: number; repetidas: number };
};

const SIN_EXCLUIDAS = { descuadradas: 0, sinId: 0, repetidas: 0 };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function claveRanking(
  arma: string,
  genero: string,
  categoriaOriginal: string,
  formato: string,
): string {
  return `${arma}|${genero}|${categoriaOriginal}|${formato}`;
}

function sinPublicacion(
  base: Pick<LecturaRanking, 'fuente' | 'season' | 'clave' | 'url'>,
  estado: EstadoCobertura,
  error: string | null,
  extra: { publicado?: number | null; excluidas?: LecturaRanking['excluidas'] } = {},
): LecturaRanking {
  return {
    ...base,
    publicacion: null,
    cobertura: { estado, publicado: extra.publicado ?? null, importado: 0, error },
    excluidas: extra.excluidas ?? SIN_EXCLUIDAS,
  };
}

function estadoDe(publicado: number, e: LecturaRanking['excluidas']): EstadoCobertura {
  if (publicado === 0) return 'sin_resultados';
  if (e.descuadradas + e.sinId > 0) return 'parcial';
  return e.repetidas > 0 ? 'conflicto' : 'completo';
}

function errorDe(estado: EstadoCobertura, e: LecturaRanking['excluidas']): string | null {
  return estado === 'completo' || estado === 'sin_resultados'
    ? null
    : `descuadradas=${e.descuadradas} sinId=${e.sinId} repetidas=${e.repetidas}`;
}

// ------------------------------------------------------------------ RFEE ---

export type DepsRankingRfee = { html: (url: string) => Promise<string> };

/** Todas las combinaciones arma × género × categoría que ofrece el formulario. */
export function combinacionesRfee(categorias: SkermoCategoryOption[]): RankingCombo[] {
  return rankingCombos(categorias);
}

export async function leerRankingRfee(
  entrada: {
    season: { value: string; label: string };
    combo: RankingCombo;
    federacion?: string;
    /** Día de lectura (YYYY-MM-DD). */
    hoy: string;
  },
  deps: DepsRankingRfee,
): Promise<LecturaRanking> {
  const { season, combo, hoy } = entrada;
  const federacion = entrada.federacion ?? 'RFEE';
  const url = skermoNationalRankingUrl(federacion, {
    season: season.value,
    weapon: SKERMO_WEAPON_CODE[combo.weapon],
    category: combo.categoryValue,
    gender: SKERMO_GENDER_CODE[combo.gender],
  });
  const base = {
    fuente: 'skermo_ranking' as const,
    season: season.label,
    clave: claveRanking(combo.weapon, combo.gender, combo.categoryRaw, 'INDIVIDUAL'),
    url,
  };

  const categoria = mapCategoryPublicada(combo.categoryRaw);
  if (!categoria) {
    return sinPublicacion(
      base,
      'error',
      `Categoría sin equivalencia («${combo.categoryRaw}»): no se importa ni se aproxima`,
    );
  }
  if (!ISO.test(hoy)) return sinPublicacion(base, 'error', 'Día de lectura no válido');

  let html: string;
  try {
    html = await deps.html(url);
  } catch (e) {
    return sinPublicacion(base, 'error', e instanceof Error ? e.message : String(e));
  }

  const leida = parseSkermoNationalRanking(html, { federationCode: federacion });
  const publicado = leida.rowsSeen + leida.mismatches;
  const excluidas = { descuadradas: leida.mismatches, sinId: 0, repetidas: 0 };
  const vistos = new Set<string>();
  const entradas: EntradaRanking[] = [];

  for (const fila of leida.rows) {
    if (!fila.skermoAthleteId) {
      excluidas.sinId += 1;
      continue;
    }
    if (vistos.has(fila.skermoAthleteId)) {
      excluidas.repetidas += 1;
      continue;
    }
    vistos.add(fila.skermoAthleteId);
    entradas.push({
      sourceRef: `skermo:${fila.skermoAthleteId}`,
      nombre: fila.sourceAthleteName.trim() || null,
      pais: null,
      posicion: puestoPublicado(fila.position),
      puntos: fila.totalPoints,
      referencia: { tipo: 'skermo', skermoId: fila.skermoAthleteId },
    });
  }

  const estado = estadoDe(publicado, excluidas);
  if (publicado === 0) return sinPublicacion(base, estado, null, { publicado: 0, excluidas });

  return {
    ...base,
    publicacion: {
      fuente: 'skermo_ranking',
      season: season.label,
      arma: combo.weapon,
      genero: combo.gender,
      categoria,
      categoriaOriginal: combo.categoryRaw,
      formato: 'INDIVIDUAL',
      publicadoEl: hoy,
      url,
      total: publicado,
      entradas,
    },
    cobertura: { estado, publicado, importado: entradas.length, error: errorDe(estado, excluidas) },
    excluidas,
  };
}

// ------------------------------------------------------------------- FIE ---

export type DepsRankingFie = { json: (url: string) => Promise<unknown> };

export type TareaRankingFie = {
  season: number;
  weapon: string;
  gender: string;
  category: string;
  tipo: TipoRankingFie;
};

/** Las 48 listas (individual y equipos) de una temporada FIE. Algunas vienen vacías. */
export function tareasRankingFie(season: number): TareaRankingFie[] {
  return (['I', 'E'] as const).flatMap((tipo) =>
    COMBINACIONES_FIE.map((c) => ({ season, ...c, tipo })),
  );
}

const textoFie = z.string().nullable().optional();
const respuestaFie = z.object({
  season: z.number().int(),
  weapon: z.string(),
  gender: z.string(),
  type: z.string(),
  fencers: z.array(z.unknown()),
});
// Sólo los campos que se guardan: el resto de la fila (foto, bandera, desglose
// de pruebas) no pasa el borde.
const filaFie = z.object({
  rank: z.number().int().positive().nullable().optional(),
  addrId: z.number().int().positive(),
  name: textoFie,
  country: textoFie,
  countryCode: textoFie,
  points: z.union([z.string(), z.number()]).nullable().optional(),
});

const ARMA_FIE = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' } as const;

function puntosFie(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

export async function leerRankingFie(
  tarea: TareaRankingFie,
  hoy: string,
  deps: DepsRankingFie,
): Promise<LecturaRanking> {
  const url = fieDetailedRankingUrl(tarea);
  const arma = ARMA_FIE[tarea.weapon as keyof typeof ARMA_FIE];
  const genero = tarea.gender === 'M' || tarea.gender === 'F' ? tarea.gender : null;
  const formato = tarea.tipo === 'E' ? 'EQUIPOS' : 'INDIVIDUAL';
  const base = {
    fuente: 'fie_tiradores' as const,
    season: String(tarea.season),
    clave: claveRanking(arma ?? tarea.weapon, tarea.gender, tarea.category, formato),
    url,
  };

  const categoria = mapCategoryPublicada(tarea.category);
  if (!arma || !genero || !categoria) {
    return sinPublicacion(
      base,
      'error',
      `Arma «${tarea.weapon}», género «${tarea.gender}» o categoría «${tarea.category}» sin equivalencia: no se importa`,
    );
  }
  if (!ISO.test(hoy)) return sinPublicacion(base, 'error', 'Día de lectura no válido');

  let cuerpo: unknown;
  try {
    cuerpo = await deps.json(url);
  } catch (e) {
    return sinPublicacion(base, 'error', e instanceof Error ? e.message : String(e));
  }

  const r = respuestaFie.safeParse(cuerpo);
  if (!r.success) return sinPublicacion(base, 'error', 'La respuesta de la FIE no tiene la forma esperada');
  const { data } = r;
  if (
    data.season !== tarea.season ||
    data.weapon !== tarea.weapon ||
    data.gender !== tarea.gender ||
    data.type !== tarea.tipo
  ) {
    return sinPublicacion(
      base,
      'conflicto',
      `Pedida ${tarea.season}/${tarea.weapon}/${tarea.gender}/${tarea.tipo}, la FIE devuelve ` +
        `${data.season}/${data.weapon}/${data.gender}/${data.type}: no se importa`,
    );
  }

  const publicado = data.fencers.length;
  const excluidas = { descuadradas: 0, sinId: 0, repetidas: 0 };
  const vistos = new Set<number>();
  const entradas: EntradaRanking[] = [];
  const equipos = formato === 'EQUIPOS';

  for (const bruta of data.fencers) {
    const f = filaFie.safeParse(bruta);
    if (!f.success) {
      excluidas.descuadradas += 1;
      continue;
    }
    const { addrId } = f.data;
    if (vistos.has(addrId)) {
      excluidas.repetidas += 1;
      continue;
    }
    vistos.add(addrId);
    const nombre = f.data.name?.trim() || null;
    entradas.push({
      sourceRef: equipos ? `team:${addrId}` : `fie:${addrId}`,
      // La FIE manda un espacio como nombre de un equipo: se nombra por su país.
      nombre: equipos ? (f.data.country?.trim() ?? null) : nombre,
      pais: f.data.countryCode?.trim() || null,
      posicion: f.data.rank ?? null,
      puntos: puntosFie(f.data.points),
      referencia: equipos ? null : { tipo: 'fie', fieId: addrId },
    });
  }

  const estado = estadoDe(publicado, excluidas);
  if (publicado === 0) return sinPublicacion(base, estado, null, { publicado: 0, excluidas });

  return {
    ...base,
    publicacion: {
      fuente: 'fie_tiradores',
      season: String(tarea.season),
      arma,
      genero,
      categoria,
      categoriaOriginal: tarea.category,
      formato,
      publicadoEl: hoy,
      url,
      total: publicado,
      entradas,
    },
    cobertura: { estado, publicado, importado: entradas.length, error: errorDe(estado, excluidas) },
    excluidas,
  };
}
