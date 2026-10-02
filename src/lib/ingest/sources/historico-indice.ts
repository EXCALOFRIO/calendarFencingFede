import { z } from 'zod';
import { mapCategory, mapCategoryPublicada, mapFormat, mapGender, mapWeapon } from '../mappers';
import type {
  SkermoResultsIndexRow,
  SkermoSeasonOption,
} from './skermo-results';

/**
 * Inventario histórico de FUENTES: qué temporadas, federaciones, pruebas y
 * documentos publican FIE y Skermo, sin importar todavía sus resultados.
 *
 * Es código puro: la red entra por `DepsInventario`, de modo que se prueba con
 * HTML/JSON reales minimizados y se ejecuta sólo desde lotes (nunca desde una
 * búsqueda de usuario). Cuatro reglas lo gobiernan:
 *
 *  - Sin corte arbitrario. Las temporadas salen de los selectores de la
 *    fuente (Skermo) o de su índice de temporadas declaradas (FIE); lo único
 *    fijo es el inicio histórico de Skermo (2017-18), sin fecha final. Un
 *    tope de peticiones por ejecución sólo aplaza: lo que no se leyó queda
 *    `pendiente` o `parcial`, jamás vacío.
 *  - Descubierto no es importado. Cada fila lleva `estado: 'descubierta' |
 *    'importada'` según las claves que le pase quien llama.
 *  - Ausencia explícita. Una fila sin documento, una categoría que el mapa no
 *    reconoce, una federación inaccesible o sin verificar y una temporada con
 *    índice vacío se cuentan con su nombre; no se esconden ni se rellenan.
 *  - Temporada FIE = la que declara la fuente. El año de calendario no vale:
 *    Bogotá de septiembre de 2026 es la temporada 2027.
 */

export type FuenteHistorica = 'fie' | 'skermo_rfee' | 'skermo_regional';

export type TipoEnlace = 'html' | 'pdf' | 'api' | 'externo';

export type EnlaceCatalogo = { tipo: TipoEnlace; url: string; etiqueta: string };

export type HuecoCatalogo =
  | 'sin_html'
  | 'sin_pdf'
  | 'sin_externo'
  | 'sin_documento'
  | 'sin_resultados_declarados'
  | 'fecha_no_publicada'
  | 'arma_no_reconocida'
  | 'genero_no_reconocido'
  | 'formato_no_reconocido'
  | 'categoria_no_reconocida';

export type FilaCatalogo = {
  fuente: FuenteHistorica;
  /** Código de federación que publica el índice (`RFEE`, `FCE`…) o `FIE`. */
  federacion: string;
  /** Skermo: «2025-2026». FIE: el año que declara la fuente («2027»). */
  temporada: string;
  /**
   * Clave de la prueba en la fuente (FIE: `competitionId`; Skermo: `FED:id` de
   * la clasificación HTML). `null` si la fila no publica identificador: el
   * documento existe, pero no hay prueba importable por clave.
   */
  clavePrueba: string | null;
  claveCatalogo: string;
  nombre: string;
  fecha: string | null;
  arma: string | null;
  genero: string | null;
  categoria: string | null;
  /** Texto literal de la fuente; no se pierde aunque la categoría colapse o no case. */
  categoriaOriginal: string | null;
  formato: 'INDIVIDUAL' | 'EQUIPOS' | null;
  enlaces: EnlaceCatalogo[];
  huecos: HuecoCatalogo[];
  estado: 'descubierta' | 'importada';
};

export type EstadoUnidad =
  | 'pendiente'
  | 'leido'
  | 'sin_filas'
  | 'parcial'
  | 'error'
  | 'inaccesible'
  | 'no_verificado';

export type RecuentoEnlaces = { html: number; pdf: number; api: number; externo: number };

export type UnidadInventario = {
  fuente: FuenteHistorica;
  federacion: string;
  /** `''` = unidad de federación (todavía sin conocer sus temporadas). */
  temporada: string;
  estado: EstadoUnidad;
  /** Filas descubiertas en esta unidad. */
  filas: number;
  /** Total que publica la fuente, si lo da (FIE `totalFound`). */
  publicado: number | null;
  enlaces: RecuentoEnlaces;
  /** Filas sin ningún documento enlazado. */
  sinDocumento: number;
  /** Filas cuyo nº de celdas no cuadra con la cabecera (marcado cambiado). */
  descuadradas: number;
  /** FIE: siguiente página por leer cuando la unidad quedó parcial. */
  siguientePagina: number | null;
  url: string;
  error: string | null;
};

export const SIN_ENLACES: RecuentoEnlaces = { html: 0, pdf: 0, api: 0, externo: 0 };

export function claveUnidad(u: Pick<UnidadInventario, 'fuente' | 'federacion' | 'temporada'>): string {
  return `${u.fuente}|${u.federacion}|${u.temporada}`;
}

/** Clave con la que una prueba descubierta se casa con una ya importada. */
export function claveImportacion(fuente: FuenteHistorica, temporada: string, clavePrueba: string): string {
  return `${fuente}|${temporada}|${clavePrueba}`;
}

function recuento(filas: readonly FilaCatalogo[]): { enlaces: RecuentoEnlaces; sinDocumento: number } {
  const enlaces = { ...SIN_ENLACES };
  let sinDocumento = 0;
  for (const f of filas) {
    const tipos = new Set(f.enlaces.map((e) => e.tipo));
    for (const t of tipos) enlaces[t] += 1;
    if (f.huecos.includes('sin_documento')) sinDocumento += 1;
  }
  return { enlaces, sinDocumento };
}

function unidadBase(
  fuente: FuenteHistorica,
  federacion: string,
  temporada: string,
  url: string,
): UnidadInventario {
  return {
    fuente,
    federacion,
    temporada,
    estado: 'pendiente',
    filas: 0,
    publicado: null,
    enlaces: { ...SIN_ENLACES },
    sinDocumento: 0,
    descuadradas: 0,
    siguientePagina: null,
    url,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Skermo
// ---------------------------------------------------------------------------

const TEMPORADA_SKERMO = /^(\d{4})-(\d{4})$/;

/** Primera temporada que el inventario RFEE/Skermo recorre. No hay límite superior. */
export const SKERMO_DESDE = '2017-2018';

/**
 * Temporadas del selector desde `desde`, ordenadas de la más antigua a la más
 * reciente. Una etiqueta que no sigue «AAAA-AAAA» no se descarta (no se sabe
 * que sea anterior): se conserva al final.
 */
export function temporadasSkermoDesde(
  opciones: readonly SkermoSeasonOption[],
  desde: string = SKERMO_DESDE,
): SkermoSeasonOption[] {
  const inicio = Number(desde.match(TEMPORADA_SKERMO)?.[1] ?? Number.NaN);
  const normales: SkermoSeasonOption[] = [];
  const raras: SkermoSeasonOption[] = [];
  for (const o of opciones) {
    const anio = Number(o.label.match(TEMPORADA_SKERMO)?.[1] ?? Number.NaN);
    if (Number.isNaN(anio)) raras.push(o);
    else if (Number.isNaN(inicio) || anio >= inicio) normales.push(o);
  }
  normales.sort((a, b) => a.label.localeCompare(b.label));
  return [...normales, ...raras];
}

export function fuenteDeFederacionSkermo(codigo: string): FuenteHistorica {
  return codigo === 'RFEE' ? 'skermo_rfee' : 'skermo_regional';
}

/** Clave de prueba Skermo: `FED:id`. El id sólo es único dentro de su federación. */
export function clavePruebaSkermo(federacion: string, competitionId: string): string {
  return `${federacion}:${competitionId}`;
}

/**
 * Una fila del índice de resultados de Skermo como entrada del catálogo.
 *
 * `competitionId` y `documents` ya los extrae `parseSkermoResultsIndex`; aquí
 * sólo se clasifican. Una fila sin ID ni documento queda con el hueco
 * `sin_documento`, que NO equivale a «no hubo prueba».
 */
export function filaCatalogoSkermo(
  fila: SkermoResultsIndexRow,
  contexto: {
    federacion: string;
    temporada: string;
    orden: number;
    importadas?: ReadonlySet<string>;
  },
): FilaCatalogo {
  const fuente = fuenteDeFederacionSkermo(contexto.federacion);
  const enlaces: EnlaceCatalogo[] = [];
  if (fila.competitionId && fila.resultsUrl) {
    enlaces.push({ tipo: 'html', url: fila.resultsUrl, etiqueta: 'Clasificación (HTML)' });
  }
  for (const d of fila.documents) enlaces.push({ tipo: 'pdf', url: d.url, etiqueta: d.title });
  const vistos = new Set<string>();
  for (const url of [...fila.externalUrls, ...fila.liveLinks.map((l) => l.url)]) {
    if (vistos.has(url)) continue;
    vistos.add(url);
    enlaces.push({ tipo: 'externo', url, etiqueta: 'Enlace externo' });
  }

  const huecos: HuecoCatalogo[] = [];
  const tipos = new Set(enlaces.map((e) => e.tipo));
  if (!tipos.has('html')) huecos.push('sin_html');
  if (!tipos.has('pdf')) huecos.push('sin_pdf');
  if (!tipos.has('externo')) huecos.push('sin_externo');
  if (enlaces.length === 0) huecos.push('sin_documento');
  if (!fila.date) huecos.push('fecha_no_publicada');
  if (!fila.weapon) huecos.push('arma_no_reconocida');
  if (!fila.gender) huecos.push('genero_no_reconocido');
  if (!fila.format) huecos.push('formato_no_reconocido');
  const categoria = mapCategoryPublicada(fila.categoryRaw) ?? fila.category;
  if (!categoria) huecos.push('categoria_no_reconocida');

  const clavePrueba = fila.competitionId
    ? clavePruebaSkermo(contexto.federacion, fila.competitionId)
    : null;
  const claveCatalogo = clavePrueba
    ? claveImportacion(fuente, contexto.temporada, clavePrueba)
    : // Sin ID de clasificación no hay clave natural: posición dentro del índice leído.
      `${fuente}|${contexto.temporada}|fila:${contexto.federacion}:${contexto.orden}`;

  return {
    fuente,
    federacion: contexto.federacion,
    temporada: contexto.temporada,
    clavePrueba,
    claveCatalogo,
    nombre: fila.name,
    fecha: fila.date,
    arma: fila.weapon,
    genero: fila.gender,
    categoria,
    categoriaOriginal: fila.categoryRaw,
    formato: fila.format,
    enlaces,
    huecos,
    estado: contexto.importadas?.has(claveCatalogo) ? 'importada' : 'descubierta',
  };
}

export type IndiceSkermoLeido = {
  rows: SkermoResultsIndexRow[];
  rowsSeen: number;
  mismatches: number;
};

export type DepsInventarioSkermo = {
  /** HTML del índice de resultados; lanza si la fuente no responde. */
  indice: (federacion: string, temporadaId?: string) => Promise<string>;
  temporadas: (html: string) => SkermoSeasonOption[];
  parsear: (html: string, federacion: string) => IndiceSkermoLeido;
  esperar?: (ms: number) => Promise<void>;
};

export type FederacionSkermo = {
  codigo: string;
  /** `false` = código sin comprobar: se informa, no se pide. */
  verificada: boolean;
};

export type OpcionesInventario = {
  /** Tope de peticiones de esta ejecución. Lo no leído queda pendiente. */
  maxPeticiones?: number;
  delayMs?: number;
  /** Unidades de una ejecución previa; las ya leídas no se piden de nuevo. */
  previas?: readonly UnidadInventario[];
  /** Releer también lo ya leído (resultados corregidos). */
  releer?: boolean;
  importadas?: ReadonlySet<string>;
  /**
   * Se espera tras cerrar cada unidad (temporada o federación) y ANTES de pasar a la siguiente: es
   * donde quien llama persiste el checkpoint y las pruebas descubiertas de esa unidad.
   */
  alUnidad?: (unidad: UnidadInventario, filas: readonly FilaCatalogo[]) => Promise<void>;
  /**
   * Distingue un fallo técnico de la fuente (429, 5xx, red). Con uno, la enumeración se detiene: lo
   * que falta queda pendiente y el fallo sube en `tecnico`, con su `Retry-After` si lo hubo.
   */
  clasificarFallo?: (e: unknown) => FalloTecnicoInventario | null;
};

export type FalloTecnicoInventario = { status: number | null; retryAfterMs: number | null };

export type ResultadoInventario = {
  unidades: UnidadInventario[];
  catalogo: FilaCatalogo[];
  /** Unidades que aún necesitan otra ejecución (pendiente, parcial, error, inaccesible). */
  pendientes: UnidadInventario[];
  peticiones: number;
  /** La enumeración se cortó por un fallo técnico de la fuente; lo no leído sigue pendiente. */
  tecnico?: FalloTecnicoInventario;
};

const LEIDA = new Set<EstadoUnidad>(['leido', 'sin_filas']);

/** Una unidad con página guardada tras un fallo conserva lo ya leído: se reanuda, no se empieza de cero. */
const reanudable = (u: UnidadInventario | undefined): u is UnidadInventario =>
  u !== undefined && (u.estado === 'parcial' || (u.estado === 'error' && u.filas > 0)) && (u.siguientePagina ?? 0) > 1;

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function inventariarSkermo(
  deps: DepsInventarioSkermo,
  federaciones: readonly FederacionSkermo[],
  opciones: OpcionesInventario & { desde?: string; temporadas?: readonly string[] } = {},
): Promise<ResultadoInventario> {
  const { maxPeticiones = Number.POSITIVE_INFINITY, delayMs = 0, releer = false } = opciones;
  const previas = new Map((opciones.previas ?? []).map((u) => [claveUnidad(u), u]));
  const unidades: UnidadInventario[] = [];
  const catalogo: FilaCatalogo[] = [];
  let peticiones = 0;
  let tecnico: FalloTecnicoInventario | undefined;

  const pedir = async (federacion: string, temporadaId?: string): Promise<string> => {
    if (peticiones > 0 && delayMs > 0) await (deps.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(delayMs);
    peticiones += 1;
    return deps.indice(federacion, temporadaId);
  };
  const cerrar = async (u: UnidadInventario, filas: readonly FilaCatalogo[] = []) => {
    unidades.push(u);
    await opciones.alUnidad?.(u, filas);
  };
  const detener = (e: unknown) => {
    tecnico ??= opciones.clasificarFallo?.(e) ?? undefined;
  };

  for (const fed of federaciones) {
    const urlFed = `skermo:${fed.codigo}`;
    const fuente = fuenteDeFederacionSkermo(fed.codigo);

    if (!fed.verificada) {
      unidades.push({ ...unidadBase(fuente, fed.codigo, '', urlFed), estado: 'no_verificado' });
      continue;
    }
    if (peticiones >= maxPeticiones || tecnico) {
      unidades.push(unidadBase(fuente, fed.codigo, '', urlFed));
      continue;
    }

    let base: string;
    try {
      base = await pedir(fed.codigo);
    } catch (e) {
      detener(e);
      await cerrar({ ...unidadBase(fuente, fed.codigo, '', urlFed), estado: 'inaccesible', error: mensaje(e) });
      continue;
    }

    const opcionesSelector = deps.temporadas(base);
    if (opcionesSelector.length === 0) {
      await cerrar({
        ...unidadBase(fuente, fed.codigo, '', urlFed),
        estado: 'error',
        error: 'El índice no trae selector de temporadas: no se puede enumerar',
      });
      continue;
    }

    for (const t of temporadasSkermoDesde(opcionesSelector, opciones.desde)) {
      // Una temporada pedida de forma explícita no gasta peticiones en las demás.
      if (opciones.temporadas?.length && !opciones.temporadas.includes(t.label)) continue;
      const url = `skermo:${fed.codigo}:${t.label}`;
      const previa = previas.get(claveUnidad({ fuente, federacion: fed.codigo, temporada: t.label }));
      if (!releer && previa && LEIDA.has(previa.estado)) {
        unidades.push(previa);
        continue;
      }
      // La temporada marcada ya viene en la página base: no cuesta petición.
      if (!t.selected && (peticiones >= maxPeticiones || tecnico)) {
        unidades.push(previa ?? unidadBase(fuente, fed.codigo, t.label, url));
        continue;
      }

      let html: string;
      try {
        html = t.selected ? base : await pedir(fed.codigo, t.value);
      } catch (e) {
        detener(e);
        await cerrar({ ...unidadBase(fuente, fed.codigo, t.label, url), estado: 'error', error: mensaje(e) });
        continue;
      }

      const leido = deps.parsear(html, fed.codigo);
      const filas = leido.rows.map((r, i) =>
        filaCatalogoSkermo(r, {
          federacion: fed.codigo,
          temporada: t.label,
          orden: i + 1,
          importadas: opciones.importadas,
        }),
      );
      catalogo.push(...filas);
      const r = recuento(filas);
      await cerrar(
        {
          ...unidadBase(fuente, fed.codigo, t.label, url),
          // Cero filas es «índice vacío publicado», no «sin pruebas ese año».
          estado: leido.rowsSeen === 0 ? 'sin_filas' : 'leido',
          filas: filas.length,
          publicado: leido.rowsSeen,
          enlaces: r.enlaces,
          sinDocumento: r.sinDocumento,
          descuadradas: leido.mismatches,
          error:
            leido.mismatches > 0
              ? `${leido.mismatches} filas no cuadran con la cabecera: el marcado pudo cambiar`
              : null,
        },
        filas,
      );
    }
  }

  return {
    unidades,
    catalogo,
    pendientes: unidades.filter((u) => !LEIDA.has(u.estado) && u.estado !== 'no_verificado'),
    peticiones,
    ...(tecnico ? { tecnico } : {}),
  };
}

// ---------------------------------------------------------------------------
// FIE
// ---------------------------------------------------------------------------

const FIE_API = 'https://fie.org/api/fie';
const TAMANO_PAGINA_FIE = 100;
const MAX_PAGINAS_FIE = 50;

const temporadasFieSchema = z.object({
  totalFound: z.number().int().nonnegative().optional(),
  items: z.array(z.object({ label: z.number().int() })),
});

/**
 * Temporadas declaradas por `/api/fie/competitions/seasons`, de la más
 * reciente a la más antigua. `completa` es falso si el total publicado no
 * coincide con lo recibido: entonces faltan temporadas y se dice.
 */
export function normalizarTemporadasFie(entrada: unknown): { temporadas: number[]; completa: boolean } {
  const p = temporadasFieSchema.parse(entrada);
  const temporadas = [...new Set(p.items.map((i) => i.label))].sort((a, b) => b - a);
  return { temporadas, completa: p.totalFound === undefined || p.totalFound === temporadas.length };
}

/** Temporada deportiva FIE (septiembre–agosto, año en que acaba) de una fecha ISO. */
export function temporadaFieDeFecha(dia: string): number | null {
  const m = dia.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (!m) return null;
  return Number(m[2]) >= 9 ? Number(m[1]) + 1 : Number(m[1]);
}

const texto = z.string().nullable().optional();
const pruebaFieSchema = z.object({
  competitionId: z.number().int(),
  season: z.number().int(),
  name: texto,
  type: texto,
  category: texto,
  federation: texto,
  startDate: texto,
  weapon: texto,
  gender: texto,
  invitationUrl: texto,
  officialSite: texto,
  livestreamLink: texto,
  livestreamResultsLink: texto,
  hasResults: z.number().nullable().optional(),
});
const paginaFieSchema = z.object({
  totalFound: z.number().int().nonnegative(),
  items: z.array(z.unknown()),
});

export function urlPruebasFie(season: number, pagina: number): string {
  return `${FIE_API}/competitions?season=${season}&page=${pagina}&pageSize=${TAMANO_PAGINA_FIE}`;
}

export function filaCatalogoFie(
  entrada: unknown,
  contexto: { importadas?: ReadonlySet<string> } = {},
): FilaCatalogo | null {
  const p = pruebaFieSchema.safeParse(entrada);
  if (!p.success) return null;
  const f = p.data;
  const temporada = String(f.season);
  const clavePrueba = String(f.competitionId);
  const enlaces: EnlaceCatalogo[] = [
    {
      tipo: 'api',
      url: `${FIE_API}/competition/${f.season}/${f.competitionId}/results/ranking`,
      etiqueta: 'Clasificación (JSON de la FIE)',
    },
  ];
  const externo = (url: string | null | undefined, etiqueta: string) => {
    if (url && /^https?:\/\//i.test(url.trim())) {
      const limpia = url.trim();
      enlaces.push({ tipo: /\.pdf(\?|$)/i.test(limpia) ? 'pdf' : 'externo', url: limpia, etiqueta });
    }
  };
  externo(f.invitationUrl, 'Invitación');
  externo(f.officialSite, 'Web oficial');
  externo(f.livestreamResultsLink, 'Resultados en directo');
  externo(f.livestreamLink, 'Directo');

  const arma = mapWeapon(f.weapon);
  const genero = mapGender(f.gender);
  const formato = mapFormat(f.type);
  const categoria = mapCategory(f.category);
  const huecos: HuecoCatalogo[] = [];
  if (!f.startDate) huecos.push('fecha_no_publicada');
  if (!arma) huecos.push('arma_no_reconocida');
  if (!genero) huecos.push('genero_no_reconocido');
  if (!formato) huecos.push('formato_no_reconocido');
  if (!categoria) huecos.push('categoria_no_reconocida');
  // Es sólo el indicador de la ficha: no prueba que haya (ni que falte) clasificación.
  if (f.hasResults === 0) huecos.push('sin_resultados_declarados');

  const claveCatalogo = claveImportacion('fie', temporada, clavePrueba);
  return {
    fuente: 'fie',
    federacion: 'FIE',
    temporada,
    clavePrueba,
    claveCatalogo,
    nombre: f.name?.trim() ?? '',
    fecha: f.startDate ?? null,
    arma,
    genero,
    categoria,
    categoriaOriginal: f.category ?? null,
    formato,
    enlaces,
    huecos,
    estado: contexto.importadas?.has(claveCatalogo) ? 'importada' : 'descubierta',
  };
}

export type DepsInventarioFie = {
  json: (url: string) => Promise<unknown>;
  esperar?: (ms: number) => Promise<void>;
};

export async function inventariarFie(
  deps: DepsInventarioFie,
  opciones: OpcionesInventario & { temporadas?: readonly number[] } = {},
): Promise<ResultadoInventario & { temporadasCompletas: boolean }> {
  const { maxPeticiones = Number.POSITIVE_INFINITY, delayMs = 0, releer = false } = opciones;
  const previas = new Map((opciones.previas ?? []).map((u) => [claveUnidad(u), u]));
  const unidades: UnidadInventario[] = [];
  const catalogo: FilaCatalogo[] = [];
  let peticiones = 0;
  let tecnico: FalloTecnicoInventario | undefined;

  const pedir = async (url: string): Promise<unknown> => {
    if (peticiones > 0 && delayMs > 0) await (deps.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(delayMs);
    peticiones += 1;
    return deps.json(url);
  };

  const urlTemporadas = `${FIE_API}/competitions/seasons`;
  let declaradas: number[];
  let temporadasCompletas = true;
  if (opciones.temporadas) {
    declaradas = [...opciones.temporadas].sort((a, b) => b - a);
  } else {
    try {
      const t = normalizarTemporadasFie(await pedir(urlTemporadas));
      declaradas = t.temporadas;
      temporadasCompletas = t.completa;
    } catch (e) {
      const fallida = { ...unidadBase('fie', 'FIE', '', urlTemporadas), estado: 'inaccesible' as const, error: mensaje(e) };
      const fallo = opciones.clasificarFallo?.(e);
      return {
        unidades: [fallida],
        catalogo,
        pendientes: [fallida],
        peticiones,
        temporadasCompletas: false,
        ...(fallo ? { tecnico: fallo } : {}),
      };
    }
  }

  for (const season of declaradas) {
    const temporada = String(season);
    const url = urlPruebasFie(season, 1);
    const previa = previas.get(claveUnidad({ fuente: 'fie', federacion: 'FIE', temporada }));
    if (!releer && previa && LEIDA.has(previa.estado)) {
      unidades.push(previa);
      continue;
    }

    const retoma = !releer && reanudable(previa);
    let pagina = retoma ? (previa?.siguientePagina ?? 1) : 1;
    let leidas = retoma ? (previa?.filas ?? 0) : 0;
    let publicado: number | null = retoma ? (previa?.publicado ?? null) : null;
    const filas: FilaCatalogo[] = [];
    let estado: EstadoUnidad = 'pendiente';
    let error: string | null = null;
    let siguiente: number | null = pagina > 1 ? pagina : null;
    let invalidas = 0;
    const reanudada = retoma;

    for (;;) {
      if (peticiones >= maxPeticiones || tecnico) {
        estado = leidas > 0 || filas.length > 0 ? 'parcial' : 'pendiente';
        siguiente = pagina;
        break;
      }
      try {
        const cuerpo = paginaFieSchema.parse(await pedir(urlPruebasFie(season, pagina)));
        publicado = cuerpo.totalFound;
        for (const item of cuerpo.items) {
          const fila = filaCatalogoFie(item, { importadas: opciones.importadas });
          if (fila) filas.push(fila);
          else invalidas += 1;
        }
        leidas += cuerpo.items.length;
        if (leidas >= cuerpo.totalFound || cuerpo.items.length === 0) {
          estado = cuerpo.totalFound === 0 ? 'sin_filas' : leidas >= cuerpo.totalFound ? 'leido' : 'parcial';
          siguiente = estado === 'parcial' ? pagina + 1 : null;
          break;
        }
        pagina += 1;
        if (pagina > MAX_PAGINAS_FIE) {
          estado = 'parcial';
          siguiente = pagina;
          break;
        }
      } catch (e) {
        estado = 'error';
        error = mensaje(e);
        siguiente = pagina;
        tecnico ??= opciones.clasificarFallo?.(e) ?? undefined;
        break;
      }
    }

    catalogo.push(...filas);
    const r = recuento(filas);
    const antes = reanudada && previa ? previa : null;
    const enlaces = { ...r.enlaces };
    if (antes) for (const k of Object.keys(enlaces) as (keyof RecuentoEnlaces)[]) enlaces[k] += antes.enlaces[k];
    const descuadradas = invalidas + (antes?.descuadradas ?? 0);
    const unidad: UnidadInventario = {
      ...unidadBase('fie', 'FIE', temporada, url),
      estado,
      filas: leidas,
      publicado,
      enlaces,
      sinDocumento: r.sinDocumento + (antes?.sinDocumento ?? 0),
      descuadradas,
      siguientePagina: siguiente,
      error: error ?? (descuadradas > 0 ? `${descuadradas} pruebas no cumplen el esquema esperado` : null),
    };
    unidades.push(unidad);
    // Una temporada que el tope o un fallo técnico dejó sin tocar no tiene nada nuevo que anotar.
    if (filas.length > 0 || estado === 'error' || estado === 'leido' || estado === 'sin_filas') {
      await opciones.alUnidad?.(unidad, filas);
    }
  }

  return {
    unidades,
    catalogo,
    pendientes: unidades.filter((u) => !LEIDA.has(u.estado)),
    peticiones,
    temporadasCompletas,
    ...(tecnico ? { tecnico } : {}),
  };
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export type ResumenInventario = {
  unidades: number;
  porEstado: Partial<Record<EstadoUnidad, number>>;
  filas: number;
  descubiertas: number;
  importadas: number;
  enlaces: RecuentoEnlaces;
  sinDocumento: number;
  categoriaNoReconocida: number;
  /** Federaciones/temporadas sin leer del todo, para decidir la siguiente ejecución. */
  pendientes: string[];
};

export function resumirInventario(r: Pick<ResultadoInventario, 'unidades' | 'catalogo'>): ResumenInventario {
  const porEstado: Partial<Record<EstadoUnidad, number>> = {};
  const enlaces = { ...SIN_ENLACES };
  for (const u of r.unidades) {
    porEstado[u.estado] = (porEstado[u.estado] ?? 0) + 1;
    for (const k of Object.keys(enlaces) as (keyof RecuentoEnlaces)[]) enlaces[k] += u.enlaces[k];
  }
  return {
    unidades: r.unidades.length,
    porEstado,
    filas: r.catalogo.length,
    descubiertas: r.catalogo.filter((f) => f.estado === 'descubierta').length,
    importadas: r.catalogo.filter((f) => f.estado === 'importada').length,
    enlaces,
    sinDocumento: r.unidades.reduce((n, u) => n + u.sinDocumento, 0),
    categoriaNoReconocida: r.catalogo.filter((f) => f.huecos.includes('categoria_no_reconocida')).length,
    pendientes: r.unidades
      .filter((u) => !LEIDA.has(u.estado) && u.estado !== 'no_verificado')
      .map((u) => `${u.fuente}/${u.federacion}/${u.temporada || '*'}:${u.estado}`),
  };
}
