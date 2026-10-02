import { z } from 'zod';
import { checkBout } from '@/lib/identity/resolver';
import { fetchJson, fixDoubleEncodedUtf8 } from '../fetcher';
import { mapCategory, mapFormat, mapGender, mapWeapon } from '../mappers';

/**
 * Adaptador de RESULTADOS de la FIE: puestos finales y asaltos individuales.
 *
 * Son tres documentos JSON públicos distintos por prueba, y ninguno lo
 * sustituye la metadata, `/entries` ni el ranking mundial:
 *
 *   /competition/{season}/{competitionId}/results/ranking?page=&pageSize=
 *   /competition/{season}/{competitionId}/results/pools
 *   /competition/{season}/{competitionId}/results/tableau
 *
 * La prueba se identifica por `(season, competitionId)`. `hasResults` y los
 * `pools:null`/`resultTabs:null` de la metadata NO dicen si hay cuerpo de datos
 * (los Juegos de París traen `pools` apuntando a un PDF y el endpoint de poules
 * vacío), así que los tres documentos se piden siempre en las individuales.
 *
 * Qué se guarda de cada uno, y qué no:
 *  - puesto: `rank` y `points` de LA PRUEBA, nunca `overallRanking` (que es el
 *    puesto de la persona en el ranking mundial). Zod descarta el resto del
 *    objeto, así que fecha de nacimiento, foto, altura y licencia no pasan.
 *  - poule: cada par aparece dos veces en la matriz, una por perspectiva. Sólo
 *    sale un asalto cuando AMBAS celdas existen, son coherentes (un ganador, el
 *    ganador con más tocados) y llevan marcador.
 *  - cuadro: un asalto por cruce con dos IDs y marcador final. BYE, cruces sin
 *    marcador o sin ganador marcado y todo lo de equipos quedan fuera.
 *  - equipos: el `fencer.id` de una prueba por equipos es el del EQUIPO. Se
 *    conserva su clasificación, no se piden poules ni cuadro y nunca producen
 *    un asalto individual.
 */

const FIE_API = 'https://fie.org/api/fie';
export const TAMANO_PAGINA_RANKING = 24;
/**
 * Páginas que una lectura pide como máximo. No es el final de la prueba: al
 * agotarlo la lectura queda parcial con `siguientePagina` y la siguiente
 * ejecución continúa ahí con otro tanto, sin volver a la 1.
 */
export const MAX_PAGINAS = 100;

export function urlPrueba(season: number, competitionId: number): string {
  return `${FIE_API}/competition/${season}/${competitionId}`;
}
export function urlRanking(season: number, competitionId: number, pagina?: number): string {
  const base = `${urlPrueba(season, competitionId)}/results/ranking`;
  return pagina ? `${base}?page=${pagina}&pageSize=${TAMANO_PAGINA_RANKING}` : base;
}
export function urlPoules(season: number, competitionId: number): string {
  return `${urlPrueba(season, competitionId)}/results/pools`;
}
export function urlCuadro(season: number, competitionId: number): string {
  return `${urlPrueba(season, competitionId)}/results/tableau`;
}

// ---------------------------------------------------------------------------
// Esquemas en el borde. Los campos desconocidos se descartan.
// ---------------------------------------------------------------------------

const texto = z.string().nullable().optional();

const metadataSchema = z.object({
  competitionId: z.number().int(),
  season: z.number().int(),
  name: texto,
  type: texto,
  category: texto,
  location: texto,
  federation: texto,
  startDate: texto,
  endDate: texto,
  weapon: texto,
  gender: texto,
  tournamentId: z.number().int().nullable().optional(),
  hasResults: z.number().nullable().optional(),
});

const participanteRanking = z.object({
  id: z.number().int(),
  name: texto,
  countryCode: texto,
  gender: texto,
});

const paginaRankingSchema = z.object({
  totalFound: z.number().int().nonnegative(),
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  items: z.array(
    z.object({
      rank: z.number().int().positive().nullable().optional(),
      points: z.number().nullable().optional(),
      fencer: participanteRanking,
    }),
  ),
});

const celdaPoule = z
  .object({ score: z.number().int().nullable().optional(), v: z.boolean().nullable().optional() })
  .nullable();

const poulesSchema = z.object({
  pools: z.array(
    z.object({
      poolId: z.number().int(),
      rows: z.array(
        z.object({
          fencerId: z.number().int().nullable(),
          name: texto,
          nationality: texto,
          matches: z.array(celdaPoule.optional()),
        }),
      ),
    }),
  ),
});

const tiradorCuadro = z
  .object({
    id: z.number().int().nullable().optional(),
    name: texto,
    nationality: texto,
    isWinner: z.boolean().nullable().optional(),
    score: z.number().int().nullable().optional(),
  })
  .nullable()
  .optional();

const cuadroSchema = z.object({
  tableau: z.array(
    z.object({
      suiteTableId: z.string(),
      rounds: z.record(
        z.string(),
        z.array(
          z.object({
            fencer1: tiradorCuadro,
            fencer2: tiradorCuadro,
            isBye: z.boolean().nullable().optional(),
          }),
        ),
      ),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Tipos normalizados
// ---------------------------------------------------------------------------

export type EstadoCobertura =
  | 'pendiente'
  | 'completo'
  | 'parcial'
  | 'sin_resultados'
  | 'error'
  | 'conflicto';

export type PruebaFie = {
  season: number;
  competitionId: number;
  /** `null` históricamente (los Juegos de París); la edición usa entonces la prueba. */
  tournamentId: number | null;
  nombre: string | null;
  ciudad: string | null;
  federacion: string | null;
  inicio: string | null;
  fin: string | null;
  arma: 'FLORETE' | 'ESPADA' | 'SABLE';
  genero: 'M' | 'F' | 'MIXTO';
  categoria: NonNullable<ReturnType<typeof mapCategory>>;
  categoriaOriginal: string | null;
  formato: 'INDIVIDUAL' | 'EQUIPOS';
  fecha: string | null;
  url: string;
};

export type PuestoFie = {
  /** ID FIE del tirador; en una prueba por equipos, el ID del EQUIPO. */
  fieId: number;
  nombre: string;
  paisCodigo: string | null;
  genero: 'M' | 'F' | null;
  /** `rank` de la prueba. `null` si la fuente no publica puesto numérico. */
  posicion: number | null;
  puntosPrueba: number | null;
};

export type AsaltoFie = {
  fase: 'POULE' | 'TABLEAU';
  /** `P{poolId}` en poule; el `tableId` de la FIE (`A32`, `A2`, `C2` bronce) en cuadro. */
  ronda: string;
  /** Orden canónico: `refA < refB`, con el marcador orientado a cada uno. */
  refA: string;
  refB: string;
  nombreA: string;
  nombreB: string;
  puntosA: number;
  puntosB: number;
};

export type Exclusiones = {
  bye: number;
  equipo: number;
  sinId: number;
  sinMarcador: number;
  sinGanador: number;
  noReciproco: number;
  incoherente: number;
  empate: number;
  duplicado: number;
};

export type CoberturaParte = {
  estado: EstadoCobertura;
  /** Total que la fuente publica (hechos candidatos), si se pudo saber. */
  publicado: number | null;
  importado: number;
  error: string | null;
};

export type ParteRanking = {
  url: string;
  puestos: PuestoFie[];
  paginasLeidas: number;
  /** Primera página pedida en esta lectura (>1 al continuar un checkpoint). */
  paginaDesde: number;
  /**
   * Página por la que seguir: la siguiente al tope por lectura, o la que
   * falló para reintentarla. `null` si la lectura terminó o no se puede
   * continuar (total cambiado, página sin puestos nuevos).
   */
  siguientePagina: number | null;
  tamanoPagina: number;
  cobertura: CoberturaParte;
};

export type ParteAsaltos = {
  url: string;
  asaltos: AsaltoFie[];
  excluidos: Exclusiones;
  /** Grupos (poules) o cuadros publicados; 0 con respuesta correcta es «vacío publicado». */
  grupos: number;
  cobertura: CoberturaParte;
};

export type LecturaPruebaFie = {
  season: number;
  competitionId: number;
  /** `null` con `errorPrueba` si la metadata no se pudo leer o no es utilizable. */
  prueba: PruebaFie | null;
  errorPrueba: string | null;
  ranking: ParteRanking | null;
  /** `null` en equipos: no se piden. */
  poules: ParteAsaltos | null;
  cuadro: ParteAsaltos | null;
};

// ---------------------------------------------------------------------------
// Normalización pura
// ---------------------------------------------------------------------------

const limpio = (v: string | null | undefined): string | null => {
  const t = v ? fixDoubleEncodedUtf8(v).trim() : '';
  return t || null;
};

export function exclusionesVacias(): Exclusiones {
  return {
    bye: 0,
    equipo: 0,
    sinId: 0,
    sinMarcador: 0,
    sinGanador: 0,
    noReciproco: 0,
    incoherente: 0,
    empate: 0,
    duplicado: 0,
  };
}

export function normalizarPrueba(
  entrada: unknown,
  season: number,
  competitionId: number,
): { prueba: PruebaFie } | { error: string } {
  const r = metadataSchema.safeParse(entrada);
  if (!r.success) return { error: 'La metadata de la prueba no tiene la forma esperada' };
  const m = r.data;
  if (m.season !== season || m.competitionId !== competitionId) {
    return { error: 'La metadata devuelta no es de la prueba pedida' };
  }
  const arma = mapWeapon(m.weapon);
  const genero = mapGender(m.gender);
  const categoria = mapCategory(m.category);
  const formato = mapFormat(m.type);
  if (!arma || !genero || !categoria || !formato) {
    return { error: 'Arma, género, categoría o modalidad no reconocidos; no se inventan' };
  }
  return {
    prueba: {
      season,
      competitionId,
      tournamentId: m.tournamentId ?? null,
      nombre: limpio(m.name),
      ciudad: limpio(m.location),
      federacion: limpio(m.federation),
      inicio: m.startDate ?? null,
      fin: m.endDate ?? null,
      arma,
      genero,
      categoria,
      categoriaOriginal: limpio(m.category),
      formato,
      fecha: m.startDate ?? null,
      url: urlPrueba(season, competitionId),
    },
  };
}

/** Une las páginas por ID FIE: una página repetida o solapada no duplica a nadie. */
export function normalizarPaginaRanking(entrada: unknown):
  | { ok: true; total: number; puestos: PuestoFie[] }
  | { ok: false } {
  const r = paginaRankingSchema.safeParse(entrada);
  if (!r.success) return { ok: false };
  return {
    ok: true,
    total: r.data.totalFound,
    puestos: r.data.items.map((i) => ({
      fieId: i.fencer.id,
      nombre: limpio(i.fencer.name) ?? `FIE ${i.fencer.id}`,
      paisCodigo: limpio(i.fencer.countryCode),
      genero: i.fencer.gender === 'M' || i.fencer.gender === 'F' ? i.fencer.gender : null,
      posicion: i.rank ?? null,
      puntosPrueba: i.points ?? null,
    })),
  };
}

type Celda = { score: number; v: boolean };

function celdaValida(c: z.infer<typeof celdaPoule> | undefined): Celda | 'vacia' | 'incompleta' {
  if (!c) return 'vacia';
  if (c.score === null || c.score === undefined || c.v === null || c.v === undefined) {
    return 'incompleta';
  }
  return { score: c.score, v: c.v };
}

/** Un solo ganador y con más tocados. Devuelve el motivo de exclusión si no. */
function ganadorCoherente(
  a: { score: number; win: boolean },
  b: { score: number; win: boolean },
): 'ok' | 'sinGanador' | 'empate' | 'incoherente' {
  if (a.win === b.win) return 'sinGanador';
  if (a.score === b.score) return 'empate';
  const ganador = a.win ? a : b;
  const perdedor = a.win ? b : a;
  return ganador.score > perdedor.score ? 'ok' : 'incoherente';
}

export function normalizarPoules(
  entrada: unknown,
  opciones: { individual: boolean },
): { ok: true; parte: Omit<ParteAsaltos, 'url'> } | { ok: false } {
  const r = poulesSchema.safeParse(entrada);
  if (!r.success) return { ok: false };
  const excluidos = exclusionesVacias();
  const asaltos: AsaltoFie[] = [];
  let publicados = 0;

  const vistos = new Set<string>();
  for (const poule of r.data.pools) {
    const filas = poule.rows;
    for (let i = 0; i < filas.length; i += 1) {
      for (let j = i + 1; j < filas.length; j += 1) {
        const ij = celdaValida(filas[i].matches[j]);
        const ji = celdaValida(filas[j].matches[i]);
        if (ij === 'vacia' && ji === 'vacia') continue;
        if (!opciones.individual) {
          excluidos.equipo += 1;
          continue;
        }
        publicados += 1;
        if (ij === 'vacia' || ji === 'vacia') {
          excluidos.noReciproco += 1;
          continue;
        }
        if (ij === 'incompleta' || ji === 'incompleta') {
          excluidos.sinMarcador += 1;
          continue;
        }
        const coherencia = ganadorCoherente(
          { score: ij.score, win: ij.v },
          { score: ji.score, win: ji.v },
        );
        if (coherencia !== 'ok') {
          excluidos[coherencia] += 1;
          continue;
        }
        const idI = filas[i].fencerId;
        const idJ = filas[j].fencerId;
        const chequeo = checkBout({
          individual: true,
          fencerARef: idI === null ? null : String(idI),
          fencerBRef: idJ === null ? null : String(idJ),
          scoreA: ij.score,
          scoreB: ji.score,
        });
        if (!chequeo.ok) {
          excluidos[chequeo.reason === 'missing_fencer' ? 'sinId' : 'incoherente'] += 1;
          continue;
        }
        const ronda = `P${poule.poolId}`;
        const clave = `${ronda}|${chequeo.fencerARef}|${chequeo.fencerBRef}`;
        if (vistos.has(clave)) {
          excluidos.duplicado += 1;
          continue;
        }
        vistos.add(clave);
        const nI = limpio(filas[i].name) ?? `FIE ${idI}`;
        const nJ = limpio(filas[j].name) ?? `FIE ${idJ}`;
        asaltos.push({
          fase: 'POULE',
          ronda,
          refA: chequeo.fencerARef,
          refB: chequeo.fencerBRef,
          nombreA: chequeo.swapped ? nJ : nI,
          nombreB: chequeo.swapped ? nI : nJ,
          puntosA: chequeo.swapped ? ji.score : ij.score,
          puntosB: chequeo.swapped ? ij.score : ji.score,
        });
      }
    }
  }

  return {
    ok: true,
    parte: {
      asaltos,
      excluidos,
      grupos: r.data.pools.length,
      cobertura: coberturaDeAsaltos(
        opciones.individual,
        r.data.pools.length,
        publicados,
        asaltos.length,
      ),
    },
  };
}

export function normalizarCuadro(
  entrada: unknown,
  opciones: { individual: boolean },
): { ok: true; parte: Omit<ParteAsaltos, 'url'> } | { ok: false } {
  const r = cuadroSchema.safeParse(entrada);
  if (!r.success) return { ok: false };
  const excluidos = exclusionesVacias();
  const asaltos: AsaltoFie[] = [];
  let publicados = 0;
  const vistos = new Set<string>();

  for (const cuadro of r.data.tableau) {
    for (const [ronda, cruces] of Object.entries(cuadro.rounds)) {
      for (const cruce of cruces) {
        if (!opciones.individual) {
          excluidos.equipo += 1;
          continue;
        }
        const f1 = cruce.fencer1 ?? null;
        const f2 = cruce.fencer2 ?? null;
        if (cruce.isBye) {
          excluidos.bye += 1;
          continue;
        }
        publicados += 1;
        const id1 = f1?.id ?? null;
        const id2 = f2?.id ?? null;
        if (id1 === null || id2 === null) {
          excluidos.sinId += 1;
          continue;
        }
        const s1 = f1?.score ?? null;
        const s2 = f2?.score ?? null;
        if (s1 === null || s2 === null) {
          excluidos.sinMarcador += 1;
          continue;
        }
        const coherencia = ganadorCoherente(
          { score: s1, win: f1?.isWinner === true },
          { score: s2, win: f2?.isWinner === true },
        );
        if (coherencia !== 'ok') {
          excluidos[coherencia] += 1;
          continue;
        }
        const chequeo = checkBout({
          individual: true,
          fencerARef: String(id1),
          fencerBRef: String(id2),
          scoreA: s1,
          scoreB: s2,
        });
        if (!chequeo.ok) {
          excluidos.incoherente += 1;
          continue;
        }
        const clave = `${ronda}|${chequeo.fencerARef}|${chequeo.fencerBRef}`;
        if (vistos.has(clave)) {
          excluidos.duplicado += 1;
          continue;
        }
        vistos.add(clave);
        const n1 = limpio(f1?.name) ?? `FIE ${id1}`;
        const n2 = limpio(f2?.name) ?? `FIE ${id2}`;
        asaltos.push({
          fase: 'TABLEAU',
          ronda,
          refA: chequeo.fencerARef,
          refB: chequeo.fencerBRef,
          nombreA: chequeo.swapped ? n2 : n1,
          nombreB: chequeo.swapped ? n1 : n2,
          puntosA: chequeo.swapped ? s2 : s1,
          puntosB: chequeo.swapped ? s1 : s2,
        });
      }
    }
  }

  return {
    ok: true,
    parte: {
      asaltos,
      excluidos,
      grupos: r.data.tableau.length,
      cobertura: coberturaDeAsaltos(
        opciones.individual,
        r.data.tableau.length,
        publicados,
        asaltos.length,
      ),
    },
  };
}

/**
 * Sin grupos publicados es un vacío publicado, no un error ni «completo». En
 * equipos no hay asaltos individuales que importar, y ese estado no se persiste.
 */
function coberturaDeAsaltos(
  individual: boolean,
  grupos: number,
  publicados: number,
  importados: number,
): CoberturaParte {
  if (!individual) return { estado: 'sin_resultados', publicado: null, importado: 0, error: null };
  if (grupos === 0 || publicados === 0) {
    return { estado: 'sin_resultados', publicado: 0, importado: 0, error: null };
  }
  return {
    estado: importados === publicados ? 'completo' : 'parcial',
    publicado: publicados,
    importado: importados,
    error: null,
  };
}

function coberturaDeRanking(
  total: number | null,
  puestos: number,
  errorTardio: string | null,
): CoberturaParte {
  if (total === null) {
    return { estado: 'error', publicado: null, importado: 0, error: errorTardio };
  }
  if (total === 0 && errorTardio === null) {
    return { estado: 'sin_resultados', publicado: 0, importado: 0, error: null };
  }
  return {
    estado: puestos === total && errorTardio === null ? 'completo' : 'parcial',
    publicado: total,
    importado: puestos,
    error: errorTardio,
  };
}

// ---------------------------------------------------------------------------
// Lectura de red
// ---------------------------------------------------------------------------

export type DepsLecturaFie = {
  fetchJson: (url: string) => Promise<unknown>;
};

const depsReales: DepsLecturaFie = { fetchJson: (url) => fetchJson<unknown>(url) };

/** Mensaje sin cuerpo de respuesta ni datos de personas, apto para guardar. */
function mensajeDeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 300);
}

export type OpcionesRanking = {
  /** Página por la que seguir (checkpoint). Por defecto, la primera. */
  desdePagina?: number;
  /** Tope de páginas de ESTA lectura; agotarlo deja la lectura parcial, no cerrada. */
  maxPaginas?: number;
};

/**
 * Pagina hasta el total publicado. Si una página posterior falla, o el total
 * no se alcanza, se conserva lo leído como cobertura PARCIAL: nunca se pasa por
 * completo ni se descartan los puestos ya publicados.
 *
 * `siguientePagina` es el checkpoint: la que falló (se reintenta ella, no se
 * vuelve a la 1) o la siguiente al tope de la lectura (100 → 101). Una lectura
 * con `desdePagina > 1` sólo trae sus páginas: los totales acumulados y
 * deduplicados los calcula quien persiste, contando lo ya guardado.
 */
export async function leerRanking(
  season: number,
  competitionId: number,
  deps: DepsLecturaFie = depsReales,
  opciones: OpcionesRanking = {},
): Promise<ParteRanking> {
  const url = urlRanking(season, competitionId);
  const desde = Math.max(1, Math.trunc(opciones.desdePagina ?? 1));
  const maxPaginas = Math.max(1, Math.trunc(opciones.maxPaginas ?? MAX_PAGINAS));
  const porId = new Map<number, PuestoFie>();
  let total: number | null = null;
  let paginas = 0;
  let errorTardio: string | null = null;
  let siguiente: number | null = null;

  for (let pagina = desde; pagina < desde + maxPaginas; pagina += 1) {
    let cuerpo: unknown;
    try {
      cuerpo = await deps.fetchJson(urlRanking(season, competitionId, pagina));
    } catch (e) {
      errorTardio = mensajeDeError(e);
      siguiente = pagina;
      break;
    }
    const n = normalizarPaginaRanking(cuerpo);
    if (!n.ok) {
      errorTardio = `La página ${pagina} del ranking no tiene la forma esperada`;
      siguiente = pagina;
      break;
    }
    if (total !== null && n.total !== total) {
      // Si el listado se movió, lo ya leído no es de la misma versión: no se continúa.
      errorTardio = `El total publicado cambió durante la lectura (${total} → ${n.total})`;
      total = n.total;
    } else {
      total = n.total;
    }
    paginas += 1;
    const antes = porId.size;
    for (const p of n.puestos) if (!porId.has(p.fieId)) porId.set(p.fieId, p);
    if (errorTardio !== null) break;
    if (n.puestos.length === 0 || pagina * TAMANO_PAGINA_RANKING >= n.total) break;
    if (porId.size >= n.total && desde === 1) break;
    if (porId.size === antes) {
      errorTardio = `La página ${pagina} no aporta puestos nuevos: no se puede continuar`;
      break;
    }
    if (pagina === desde + maxPaginas - 1) {
      siguiente = pagina + 1;
      errorTardio = `Se alcanzó el tope de ${maxPaginas} páginas por lectura; continúa en la ${siguiente}`;
    }
  }

  const puestos = [...porId.values()];
  return {
    url,
    puestos,
    paginasLeidas: paginas,
    paginaDesde: desde,
    siguientePagina: siguiente,
    tamanoPagina: TAMANO_PAGINA_RANKING,
    cobertura: coberturaDeRanking(total, puestos.length, errorTardio),
  };
}

async function leerAsaltos(
  url: string,
  normalizar: typeof normalizarPoules,
  individual: boolean,
  deps: DepsLecturaFie,
): Promise<ParteAsaltos> {
  const fallo = (error: string): ParteAsaltos => ({
    url,
    asaltos: [],
    excluidos: exclusionesVacias(),
    grupos: 0,
    cobertura: { estado: 'error', publicado: null, importado: 0, error },
  });
  let cuerpo: unknown;
  try {
    cuerpo = await deps.fetchJson(url);
  } catch (e) {
    return fallo(mensajeDeError(e));
  }
  const n = normalizar(cuerpo, { individual });
  if (!n.ok) return fallo('La respuesta no tiene la forma esperada');
  return { url, ...n.parte };
}

export type OpcionesLecturaPrueba = OpcionesRanking & {
  /**
   * Al continuar un ranking paginado, poules y cuadro (documentos únicos, no
   * paginados) ya se leyeron en la primera lectura: no se piden otra vez.
   */
  omitirAsaltos?: boolean;
  /**
   * Fases que esta lectura pide. Una fase ya completa en una ejecución anterior (el ranking
   * cuando sólo faltan poules o cuadro) no se vuelve a leer: `false` la deja en `null`.
   * Ausente = todas, salvo lo que diga `omitirAsaltos`.
   */
  fases?: { ranking?: boolean; poules?: boolean; cuadro?: boolean };
};

export async function leerPruebaFie(
  season: number,
  competitionId: number,
  deps: DepsLecturaFie = depsReales,
  opciones: OpcionesLecturaPrueba = {},
): Promise<LecturaPruebaFie> {
  const vacia = (errorPrueba: string): LecturaPruebaFie => ({
    season,
    competitionId,
    prueba: null,
    errorPrueba,
    ranking: null,
    poules: null,
    cuadro: null,
  });

  let metadata: unknown;
  try {
    metadata = await deps.fetchJson(urlPrueba(season, competitionId));
  } catch (e) {
    return vacia(mensajeDeError(e));
  }
  const n = normalizarPrueba(metadata, season, competitionId);
  if ('error' in n) return vacia(n.error);
  const individual = n.prueba.formato === 'INDIVIDUAL';

  const fases = opciones.fases;
  const ranking = fases?.ranking === false ? null : await leerRanking(season, competitionId, deps, opciones);
  const quierePoules = individual && !opciones.omitirAsaltos && fases?.poules !== false;
  const quiereCuadro = individual && !opciones.omitirAsaltos && fases?.cuadro !== false;
  const poules = quierePoules
    ? await leerAsaltos(urlPoules(season, competitionId), normalizarPoules, true, deps)
    : null;
  const cuadro = quiereCuadro
    ? await leerAsaltos(urlCuadro(season, competitionId), normalizarCuadro, true, deps)
    : null;
  return { season, competitionId, prueba: n.prueba, errorPrueba: null, ranking, poules, cuadro };
}
