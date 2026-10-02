import { z } from 'zod';
import {
  candidatoDeEngarde,
  candidatoDeFww,
  cotejar,
  type Cotejo,
  type MotivoCotejo,
  type PruebaCanonica,
} from './conciliar-complementario';
import { esPresupuestoAgotado } from './backfill/presupuesto-http';
import { mapCategory, mapFormat, mapGender, mapWeapon } from './mappers';
import { clasificarSerie } from './series-complementarias';
import {
  depsEngardeReales,
  esSegmentoEngarde,
  leerClasificacionEngarde,
  leerTorneoEngarde,
  urlPruebaEngarde,
  type DepsEngarde,
} from './sources/engarde';
import { parsearUrlFww, type UrlFww } from './sources/fww';
import { leerDestinoFww } from './sources/fww-asaltos';

/**
 * Enlaces de resultados publicados por FIE, Skermo u organizadores.
 *
 * Un enlace sólo se ofrece como «resultados» si es ESPECÍFICO de la prueba o
 * torneo y corresponde a esa edición. Una portada, el enlace de otro año o una
 * página de otro proveedor no cuentan. Fencing Time Live exige cuenta desde
 * abril de 2026: su URL se ofrece para seguir el torneo y NUNCA implica
 * resultados importados. los-deportes.info es sólo referencia. La ausencia de
 * enlace es «aún no publicado», no cero resultados.
 */

export type ProveedorEnlace = 'engarde' | 'fww' | 'ftl' | 'fie' | 'los_deportes' | 'otro';
export type AlcanceEnlace = 'prueba' | 'torneo' | 'generico';

export type EnlaceClasificado = {
  proveedor: ProveedorEnlace;
  alcance: AlcanceEnlace;
  /** URL sin fragmento ni parámetros de seguimiento. */
  url: string;
  engarde?: { org: string; evt: string; compe: string | null };
  fww?: UrlFww;
  ftl?: { id: string };
  fie?: { season: number; competitionId: number };
};

const GUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function host(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** `null` si no es una URL http(s) legible. */
export function clasificarEnlace(entrada: string): EnlaceClasificado | null {
  let u: URL;
  try {
    u = new URL(entrada.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = host(u);
  const tramos = u.pathname.split('/').filter(Boolean);
  const limpia = (ruta: string) => `${u.protocol}//${u.hostname}${ruta}`;

  if (h === 'engarde-service.com') {
    if (
      tramos[0] === 'competition' &&
      tramos.length >= 4 &&
      esSegmentoEngarde(tramos[1]) &&
      esSegmentoEngarde(tramos[2]) &&
      esSegmentoEngarde(tramos[3])
    ) {
      return {
        proveedor: 'engarde',
        alcance: 'prueba',
        url: limpia(`/competition/${tramos[1]}/${tramos[2]}/${tramos[3]}`),
        engarde: { org: tramos[1], evt: tramos[2], compe: tramos[3] },
      };
    }
    if (
      tramos[0] === 'tournament' &&
      tramos.length >= 3 &&
      esSegmentoEngarde(tramos[1]) &&
      esSegmentoEngarde(tramos[2])
    ) {
      return {
        proveedor: 'engarde',
        alcance: 'torneo',
        url: limpia(`/tournament/${tramos[1]}/${tramos[2]}`),
        engarde: { org: tramos[1], evt: tramos[2], compe: null },
      };
    }
    return { proveedor: 'engarde', alcance: 'generico', url: limpia(u.pathname) };
  }

  if (h === 'fencingworldwide.com') {
    const f = parsearUrlFww(u.toString());
    if (!f) return { proveedor: 'fww', alcance: 'generico', url: limpia(u.pathname) };
    const alcance: AlcanceEnlace =
      f.seccion === 'tournament' || f.seccion === 'all-medaillists' ? 'torneo' : 'prueba';
    // La ruta completa (`pools/1`, `direct/2`) es lo que se ofrece y lo que se comprueba: no se recorta a su sección.
    const cola = f.ruta === '' ? '' : `${f.ruta}${u.pathname.endsWith('/') ? '/' : ''}`;
    return {
      proveedor: 'fww',
      alcance,
      url: limpia(`/${f.idioma}/${f.id}-${f.temporada}/${cola}`),
      fww: f,
    };
  }

  if (h === 'fencingtimelive.com') {
    const [a, b, c] = tramos;
    if (a === 'tournaments' && b === 'eventSchedule' && c && GUID.test(c)) {
      return { proveedor: 'ftl', alcance: 'torneo', url: limpia(`/tournaments/eventSchedule/${c}`), ftl: { id: c } };
    }
    if (
      (a === 'events' && b === 'results' && c && GUID.test(c)) ||
      ((a === 'pools' || a === 'tableaus') && b === 'scores' && c && GUID.test(c))
    ) {
      return { proveedor: 'ftl', alcance: 'prueba', url: limpia(`/${tramos.join('/')}`), ftl: { id: c } };
    }
    return { proveedor: 'ftl', alcance: 'generico', url: limpia(u.pathname) };
  }

  if (h === 'fie.org') {
    const m =
      u.pathname.match(/^\/competitions\/(\d{4})\/(\d+)\/?$/) ??
      u.pathname.match(/^\/tournaments\/(\d{4})\/\d+\/event\/(\d+)(?:\/|$)/);
    if (m) {
      return {
        proveedor: 'fie',
        alcance: 'prueba',
        url: limpia(u.pathname),
        fie: { season: Number(m[1]), competitionId: Number(m[2]) },
      };
    }
    return { proveedor: 'fie', alcance: 'generico', url: limpia(u.pathname) };
  }

  if (h === 'los-deportes.info') {
    return { proveedor: 'los_deportes', alcance: tramos.length > 0 ? 'torneo' : 'generico', url: limpia(u.pathname) };
  }
  return { proveedor: 'otro', alcance: 'generico', url: limpia(u.pathname) };
}

export type EstadoEnlace =
  | 'verificado'
  | 'solo_enlace'
  | 'solo_referencia'
  | 'no_publicado'
  | 'rechazado'
  | 'revision'
  | 'error';

export type MotivoEnlace =
  | 'portada_generica'
  | 'otro_anio'
  | 'proveedor_no_admitido'
  | 'sin_enlace_especifico'
  | 'pagina_no_publicada'
  | 'ambiguo'
  | 'sin_pruebas'
  | 'no_comprobable'
  | MotivoCotejo;

export type ResultadoEnlace = {
  proveedor: 'engarde' | 'fww' | 'ftl';
  estado: EstadoEnlace;
  /** URL que se puede ofrecer; `null` si no hay nada que ofrecer. */
  url: string | null;
  motivos: MotivoEnlace[];
  /** Siempre `false` para FTL: su URL sigue el torneo, no trae resultados. */
  resultadosImportados: false;
};

const vacio = (proveedor: ResultadoEnlace['proveedor']): ResultadoEnlace => ({
  proveedor,
  estado: 'no_publicado',
  url: null,
  motivos: ['sin_enlace_especifico'],
  resultadosImportados: false,
});

export type EnlacePublicado = {
  url: string;
  /** Quién lo publica. Sólo fuentes oficiales o el organizador de la prueba. */
  origen: 'fie' | 'skermo' | 'organizador';
};

const metaFieSchema = z.object({
  officialSite: z.string().nullable().optional(),
  livestreamLink: z.string().nullable().optional(),
  livestreamResultsLink: z.string().nullable().optional(),
});

/** Enlaces que la FIE publica en la metadata de la prueba (JSON oficial). */
export function enlacesPublicadosFie(meta: unknown): EnlacePublicado[] {
  const r = metaFieSchema.safeParse(meta);
  if (!r.success) return [];
  return [r.data.livestreamResultsLink, r.data.livestreamLink, r.data.officialSite]
    .filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    .map((url) => ({ url: url.trim(), origen: 'fie' as const }));
}

export function enlacesPublicadosSkermo(fila: {
  externalUrls: readonly string[];
  liveLinks: readonly { url: string }[];
}): EnlacePublicado[] {
  return [...fila.externalUrls, ...fila.liveLinks.map((l) => l.url)].map((url) => ({
    url,
    origen: 'skermo' as const,
  }));
}

/** Año de la edición que declara una URL, si lo declara. */
function anioDeEnlace(c: EnlaceClasificado): number | null {
  if (c.fww) return Number(c.fww.temporada);
  if (c.engarde) {
    const largo = c.engarde.evt.match(/(20\d{2})/);
    if (largo) return Number(largo[1]);
    const corto = c.engarde.evt.match(/[a-z](\d{2})$/i);
    if (corto && Number(corto[1]) >= 10 && Number(corto[1]) <= 40) return 2000 + Number(corto[1]);
  }
  return null;
}

/**
 * ¿Declara la URL un año incompatible con la prueba? La temporada FWW y los
 * años de Engarde pueden ir uno por delante o por detrás de la fecha (una
 * prueba de enero está en la temporada anterior), pero no más.
 */
export function enlaceDeOtroAnio(c: EnlaceClasificado, fecha: string | null): boolean {
  const anio = anioDeEnlace(c);
  if (anio === null || fecha === null) return false;
  return Math.abs(anio - Number(fecha.slice(0, 4))) > 1;
}

export type DepsVerificacionEnlaces = Pick<DepsEngarde, 'get' | 'post'>;

function desdeCotejo(
  proveedor: 'engarde' | 'fww',
  url: string,
  cotejo: Cotejo,
): ResultadoEnlace {
  const estado: EstadoEnlace =
    cotejo.decision === 'aceptado' ? 'verificado' : cotejo.decision === 'rechazado' ? 'rechazado' : 'revision';
  return {
    proveedor,
    estado,
    url: estado === 'verificado' ? url : null,
    motivos: cotejo.motivos,
    resultadosImportados: false,
  };
}

async function verificarEngarde(
  c: EnlaceClasificado,
  prueba: PruebaCanonica,
  deps: DepsVerificacionEnlaces,
): Promise<ResultadoEnlace> {
  const { org, evt, compe } = c.engarde!;
  const lectura = await leerTorneoEngarde(org, evt, { ...depsEngardeReales, ...deps });
  const fallo = (estado: EstadoEnlace, motivos: MotivoEnlace[]): ResultadoEnlace => ({
    proveedor: 'engarde',
    estado,
    url: null,
    motivos,
    resultadosImportados: false,
  });
  if (lectura.estado === 'error' || lectura.estado === 'parcial') return fallo('error', ['no_comprobable']);
  if (lectura.estado === 'sin_pruebas') return fallo('no_publicado', ['sin_pruebas']);

  const candidatos = lectura.pruebas
    .filter((p) => compe === null || p.compe === compe)
    .map((p) => ({
      prueba: p,
      cotejo: cotejar(prueba, candidatoDeEngarde(p, { nombreTorneo: lectura.nombre })),
    }));
  if (candidatos.length === 0) return fallo('rechazado', ['sin_pruebas']);

  const aceptados = candidatos.filter((x) => x.cotejo.decision === 'aceptado');
  if (aceptados.length === 1) {
    // El índice sólo dice que la prueba existe: el destino que se ofrece ha de responder y repetir su contexto.
    const p = aceptados[0].prueba;
    const destino = await leerClasificacionEngarde(p, { ...depsEngardeReales, ...deps });
    if (destino.estado === 'error') return fallo('error', ['no_comprobable']);
    if (!destino.pagina || destino.pagina.tipo === 'desconocida') {
      return fallo('no_publicado', ['pagina_no_publicada']);
    }
    const cotejo = cotejar(
      prueba,
      candidatoDeEngarde(p, { nombreTorneo: lectura.nombre, pagina: destino.pagina }),
    );
    return desdeCotejo('engarde', urlPruebaEngarde(p.org, p.evt, p.compe), cotejo);
  }
  if (aceptados.length > 1) return fallo('revision', ['ambiguo']);
  // Un enlace de prueba se juzga por su prueba; uno de torneo, por la mejor de sus pruebas.
  const dudosa = candidatos.find((x) => x.cotejo.decision === 'revision');
  if (dudosa) return desdeCotejo('engarde', dudosa.prueba.url, dudosa.cotejo);
  const motivos = [...new Set(candidatos.flatMap((x) => x.cotejo.motivos))];
  return { proveedor: 'engarde', estado: 'rechazado', url: null, motivos, resultadosImportados: false };
}

async function verificarFww(
  c: EnlaceClasificado,
  prueba: PruebaCanonica,
  deps: DepsVerificacionEnlaces,
): Promise<ResultadoEnlace> {
  // Se lee EXACTAMENTE el destino ofrecido: otra sección de la misma prueba no acredita esta URL.
  const lectura = await leerDestinoFww(c.url, deps);
  const base = { proveedor: 'fww' as const, url: null, resultadosImportados: false as const };
  if (lectura.estado === 'error') return { ...base, estado: 'error', motivos: ['no_comprobable'] };
  if (lectura.estado === 'no_publicado' || !lectura.pagina) {
    return { ...base, estado: 'no_publicado', motivos: ['pagina_no_publicada'] };
  }
  const cotejo = cotejar(prueba, candidatoDeFww(c.url, `${c.fww!.id}-${c.fww!.temporada}`, lectura.pagina));
  return desdeCotejo('fww', c.url, cotejo);
}

/**
 * Evalúa los enlaces publicados para UNA prueba y devuelve el estado por
 * proveedor. Engarde y FWW sólo quedan `verificado` si el índice o la página
 * pública confirma edición, sede, fecha, arma, categoría y modalidad. FTL no se
 * puede comprobar sin cuenta: queda `solo_enlace` si la URL es específica y
 * viene de una fuente oficial.
 */
export async function evaluarEnlacesOficiales(
  prueba: PruebaCanonica,
  publicados: readonly EnlacePublicado[],
  deps: DepsVerificacionEnlaces = depsEngardeReales,
): Promise<Record<'engarde' | 'fww' | 'ftl', ResultadoEnlace>> {
  const salida = { engarde: vacio('engarde'), fww: vacio('fww'), ftl: vacio('ftl') };
  const rango: Record<EstadoEnlace, number> = {
    verificado: 6,
    solo_enlace: 6,
    revision: 4,
    error: 3,
    rechazado: 2,
    no_publicado: 1,
    solo_referencia: 0,
  };
  const guardar = (r: ResultadoEnlace) => {
    const actual = salida[r.proveedor];
    const sustituyeVacio = actual.estado === 'no_publicado' && actual.url === null && actual.motivos.includes('sin_enlace_especifico');
    if (rango[r.estado] > rango[actual.estado] || sustituyeVacio) salida[r.proveedor] = r;
  };

  const vigilada = vigilarPresupuesto(deps);
  const vistos = new Set<string>();
  for (const p of publicados) {
    const c = clasificarEnlace(p.url);
    if (!c || vistos.has(c.url)) continue;
    vistos.add(c.url);
    if (c.proveedor !== 'engarde' && c.proveedor !== 'fww' && c.proveedor !== 'ftl') continue;
    const rechazo = (motivos: MotivoEnlace[]) =>
      guardar({ proveedor: c.proveedor as 'engarde' | 'fww' | 'ftl', estado: 'rechazado', url: null, motivos, resultadosImportados: false });

    if (c.alcance === 'generico') {
      rechazo(['portada_generica']);
      continue;
    }
    if (enlaceDeOtroAnio(c, prueba.fecha)) {
      rechazo(['otro_anio']);
      continue;
    }
    if (c.proveedor === 'ftl') {
      guardar({ proveedor: 'ftl', estado: 'solo_enlace', url: c.url, motivos: [], resultadosImportados: false });
      continue;
    }
    try {
      guardar(c.proveedor === 'engarde' ? await verificarEngarde(c, prueba, vigilada.deps) : await verificarFww(c, prueba, vigilada.deps));
    } catch (e) {
      if (esPresupuestoAgotado(e)) throw e;
      guardar({ proveedor: c.proveedor, estado: 'error', url: null, motivos: ['no_comprobable'], resultadosImportados: false });
    }
    vigilada.lanzarSiDenegado();
  }
  return salida;
}

/**
 * Los lectores de Engarde y FWW convierten cualquier excepción de red en una lectura `error`: una
 * denegación del presupuesto se recuerda aquí para propagarla, porque no es un enlace «no comprobable».
 */
function vigilarPresupuesto(deps: DepsVerificacionEnlaces): { deps: DepsVerificacionEnlaces; lanzarSiDenegado: () => void } {
  let denegado: unknown = null;
  const vigilar =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (e) {
        if (esPresupuestoAgotado(e)) denegado ??= e;
        throw e;
      }
    };
  return {
    deps: { get: vigilar(deps.get), post: vigilar(deps.post) },
    lanzarSiDenegado: () => {
      if (denegado) throw denegado;
    },
  };
}

/** Texto y destino que la interfaz puede mostrar; `href: null` = no hay enlace que ofrecer. */
export function vistaEnlace(r: ResultadoEnlace): { href: string | null; texto: string } {
  const nombre = { engarde: 'Engarde', fww: 'Fencing Worldwide', ftl: 'Fencing Time Live' }[r.proveedor];
  switch (r.estado) {
    case 'verificado':
      return { href: r.url, texto: `Resultados en ${nombre}` };
    case 'solo_enlace':
      return { href: r.url, texto: `Seguir el torneo en ${nombre} (requiere cuenta; resultados no importados)` };
    case 'no_publicado':
      return { href: null, texto: 'Enlace aún no publicado' };
    case 'revision':
      return { href: null, texto: 'Enlace pendiente de revisión' };
    case 'error':
      return { href: null, texto: 'No se pudo comprobar el enlace' };
    case 'rechazado':
    case 'solo_referencia':
      return { href: null, texto: 'Sin enlace de resultados verificado' };
  }
}

// ---------------------------------------------------------------------------
// Ficha web de la FIE frente a su JSON oficial
// ---------------------------------------------------------------------------

export function urlFichaFie(season: number, competitionId: number): string {
  return `https://fie.org/competitions/${season}/${competitionId}`;
}

export type EstadoFichaFie = {
  /** `json` = hay datos oficiales utilizables; `ninguno` = ni el JSON respondió. */
  datos: 'json' | 'ninguno';
  /** Enlace que se puede mostrar como funcional (la ficha o una alternativa verificada). */
  enlaceFicha: string | null;
  jsonStatus: number | null;
  htmlStatus: number | null;
  /** `Retry-After` que acompañó a esa respuesta (429/5xx), si lo hubo. */
  jsonRetryAfterMs: number | null;
  htmlRetryAfterMs: number | null;
  aviso: string | null;
};

/**
 * La ficha HTML de la FIE puede dar 500 mientras su JSON responde (Bari
 * 2026-27). El JSON manda: sus datos se muestran sin inventar otra URL, y el
 * enlace roto no se presenta como funcional salvo que haya una alternativa
 * verificada.
 */
export function evaluarFichaFie(entrada: {
  jsonStatus: number | null;
  htmlStatus: number | null;
  urlHtml: string;
  alternativaVerificada?: string | null;
  jsonRetryAfterMs?: number | null;
  htmlRetryAfterMs?: number | null;
}): EstadoFichaFie {
  const { jsonStatus, htmlStatus, urlHtml } = entrada;
  const datos = jsonStatus === 200 ? 'json' : 'ninguno';
  const htmlOk = htmlStatus !== null && htmlStatus >= 200 && htmlStatus < 400;
  let aviso: string | null = null;
  if (!htmlOk) {
    aviso =
      htmlStatus === null
        ? 'La ficha web de la FIE no se pudo comprobar'
        : `La ficha web de la FIE no responde (HTTP ${htmlStatus})`;
    if (datos === 'json') aviso += '; se muestran los datos del JSON oficial';
  }
  if (datos === 'ninguno') {
    aviso = `${aviso ? `${aviso}. ` : ''}${jsonStatus === 404 ? 'La FIE no publica esta prueba' : 'El JSON oficial de la FIE no respondió'}`;
  }
  return {
    datos,
    enlaceFicha: htmlOk ? urlHtml : (entrada.alternativaVerificada ?? null),
    jsonStatus,
    htmlStatus,
    jsonRetryAfterMs: entrada.jsonRetryAfterMs ?? null,
    htmlRetryAfterMs: entrada.htmlRetryAfterMs ?? null,
    aviso,
  };
}

const metaCanonicaSchema = z.object({
  competitionId: z.number().int(),
  season: z.number().int(),
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  competitionCategory: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  weapon: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
});

/** Prueba canónica desde la metadata FIE, sin completar lo que la FIE no publica. */
export function canonicaDeFie(meta: unknown, season: number, competitionId: number): PruebaCanonica | null {
  const r = metaCanonicaSchema.safeParse(meta);
  if (!r.success || r.data.season !== season || r.data.competitionId !== competitionId) return null;
  const m = r.data;
  return {
    fuente: 'fie',
    season: String(season),
    clave: String(competitionId),
    serie: clasificarSerie({ nombre: m.name, categoriaCompeticion: m.competitionCategory }),
    nombreEdicion: m.name?.trim() || null,
    ciudad: m.location?.trim() || null,
    fecha: m.startDate ?? null,
    arma: mapWeapon(m.weapon),
    genero: mapGender(m.gender),
    categoria: mapCategory(m.category),
    formato: mapFormat(m.type),
  };
}

export type DescubrimientoEnlaces = {
  prueba: PruebaCanonica | null;
  ficha: EstadoFichaFie;
  publicados: EnlacePublicado[];
  enlaces: Record<'engarde' | 'fww' | 'ftl', ResultadoEnlace> | null;
};

/**
 * Enlaces específicos de una prueba FIE (metadata JSON), validados contra esa
 * misma prueba. Si el JSON no responde no hay nada que evaluar: `enlaces` es
 * `null`, que no equivale a «aún no publicado».
 */
export async function descubrirEnlacesFie(
  deps: DepsVerificacionEnlaces,
  season: number,
  competitionId: number,
): Promise<DescubrimientoEnlaces> {
  const { ficha, cuerpoJson } = await sondearFichaConCuerpo(deps, season, competitionId);
  if (ficha.datos !== 'json') return { prueba: null, ficha, publicados: [], enlaces: null };
  let meta: unknown;
  try {
    meta = JSON.parse(cuerpoJson ?? '');
  } catch {
    return { prueba: null, ficha: { ...ficha, datos: 'ninguno' }, publicados: [], enlaces: null };
  }
  const prueba = canonicaDeFie(meta, season, competitionId);
  if (!prueba) return { prueba: null, ficha, publicados: [], enlaces: null };
  const publicados = enlacesPublicadosFie(meta);
  return { prueba, ficha, publicados, enlaces: await evaluarEnlacesOficiales(prueba, publicados, deps) };
}

export async function sondearFichaFie(
  deps: Pick<DepsEngarde, 'get'>,
  season: number,
  competitionId: number,
  alternativaVerificada: string | null = null,
): Promise<EstadoFichaFie> {
  return (await sondearFichaConCuerpo(deps, season, competitionId, alternativaVerificada)).ficha;
}

/**
 * Sondeo de la ficha que conserva el cuerpo de la respuesta JSON: es la metadata, y pedirla otra vez
 * dejaría sin comprobar el estado ni el Retry-After de esa segunda respuesta.
 */
async function sondearFichaConCuerpo(
  deps: Pick<DepsEngarde, 'get'>,
  season: number,
  competitionId: number,
  alternativaVerificada: string | null = null,
): Promise<{ ficha: EstadoFichaFie; cuerpoJson: string | null }> {
  const estado = async (url: string) => {
    try {
      const r = await deps.get(url);
      return { status: r.status as number | null, retryAfterMs: r.retryAfterMs ?? null, body: r.body };
    } catch (e) {
      // Un presupuesto denegado deja la unidad pendiente; no equivale a una ficha que no respondió.
      if (esPresupuestoAgotado(e)) throw e;
      return { status: null, retryAfterMs: null, body: null };
    }
  };
  const urlHtml = urlFichaFie(season, competitionId);
  const [json, html] = await Promise.all([
    estado(`https://fie.org/api/fie/competition/${season}/${competitionId}`),
    estado(urlHtml),
  ]);
  return {
    ficha: evaluarFichaFie({
      jsonStatus: json.status,
      htmlStatus: html.status,
      jsonRetryAfterMs: json.retryAfterMs,
      htmlRetryAfterMs: html.retryAfterMs,
      urlHtml,
      alternativaVerificada,
    }),
    cuerpoJson: json.status === 200 ? json.body : null,
  };
}
