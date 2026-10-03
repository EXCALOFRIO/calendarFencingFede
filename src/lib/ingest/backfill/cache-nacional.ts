import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  assertContinuationOwner, readOpenDownloadWindow, validateDownloadRoot,
} from './download-window';
import { renameCacheCheckpoint } from './cache-atomic';

export const CACHE_NACIONAL_VERSION = 1;
export const HOST_NACIONAL_PERMITIDO = 'app.skermo.org';

export type TipoDocumentoNacional = 'html' | 'pdf';
export type EstadoDocumentoNacional =
  | 'pending'
  | 'downloading'
  | 'cached'
  | 'empty'
  | 'http_error'
  | 'partial'
  | 'network_error'
  | 'invalid_payload'
  | 'cooldown'
  | 'deferred_budget';

export type AsociacionNacional = {
  fuente: string;
  federacion: string;
  temporada: string;
  clavePrueba: string | null;
  claveCatalogo: string;
  arma: string | null;
  genero: string | null;
  categoria: string | null;
  categoriaOriginal: string | null;
  formato: string | null;
};

export type UnidadCacheNacional = {
  id: string;
  tipo: TipoDocumentoNacional;
  url: string;
  asociaciones: AsociacionNacional[];
  estado: EstadoDocumentoNacional;
  intentos: number;
  consultadoEn: string | null;
  httpStatus: number | null;
  contentType: string | null;
  declaredBytes: number | null;
  receivedBytes: number;
  bytes: number | null;
  sha256: string | null;
  retryAfterMs: number | null;
  motivo: string | null;
};

export type EstadoCacheNacional = {
  version: typeof CACHE_NACIONAL_VERSION;
  peticionesIniciadas: number;
  ultimoInicioPeticion: number | null;
  cooldownHasta: number | null;
  bytesPayloadActuales: number;
  /** One bounded campaign survives CLI restarts; a batch cannot reset it. */
  campanaInicio?: number;
  bytesDiscoInicio?: number;
  politica?: { sha256: string; bytes: number; consultadoEn: string };
};

export type ManifiestoCacheNacional = {
  version: typeof CACHE_NACIONAL_VERSION;
  tipo: 'evidencia-publica-rfee';
  generadoEn: string;
  soloDescarga: true;
  aviso: string;
  peticionesIniciadas: number;
  bytesPayload: number;
  unidades: UnidadCacheNacional[];
};

export class LimitePayloadNacional extends Error {
  constructor(readonly bytesRecibidos: number) {
    super('Se alcanzó el límite local de payload');
    this.name = 'LimitePayloadNacional';
  }
}

export class LecturaParcialNacional extends Error {
  constructor(readonly bytesRecibidos: number) {
    super('La respuesta se interrumpió antes de completar el payload');
    this.name = 'LecturaParcialNacional';
  }
}

export class IntegridadPayloadNacional extends Error {
  constructor() {
    super('El blob local no coincide con su SHA-256');
    this.name = 'IntegridadPayloadNacional';
  }
}

export function sha256Nacional(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function idUnidadNacional(tipo: TipoDocumentoNacional, url: string): string {
  return `${tipo}-${createHash('sha256').update(url, 'utf8').digest('hex')}`;
}

export function rutaBlobNacional(root: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Hash SHA-256 inválido');
  return join(root, 'blobs', `${sha256}.bin`);
}

async function escribirAtomico(ruta: string, contenido: Uint8Array | string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp-${randomUUID()}`;
  let archivo: Awaited<ReturnType<typeof open>> | undefined;
  try {
    archivo = await open(temporal, 'wx');
    await archivo.writeFile(contenido);
    await archivo.sync();
    await archivo.close();
    archivo = undefined;
    await renameCacheCheckpoint(temporal, ruta);
  } catch (error) {
    if (archivo) await archivo.close().catch(() => undefined);
    await rm(temporal, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function escribirEstadoCacheNacional(
  root: string,
  estado: EstadoCacheNacional,
): Promise<void> {
  await escribirAtomico(join(root, 'state.json'), `${JSON.stringify(estado, null, 2)}\n`);
}

export async function leerEstadoCacheNacional(root: string): Promise<EstadoCacheNacional> {
  try {
    const raw = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) as Partial<EstadoCacheNacional>;
    if (
      raw.version !== CACHE_NACIONAL_VERSION ||
      !Number.isSafeInteger(raw.peticionesIniciadas) ||
      !Number.isSafeInteger(raw.bytesPayloadActuales) ||
      raw.peticionesIniciadas! < 0 ||
      raw.bytesPayloadActuales! < 0 ||
      (raw.campanaInicio !== undefined && !Number.isFinite(raw.campanaInicio)) ||
      (raw.bytesDiscoInicio !== undefined &&
        (!Number.isSafeInteger(raw.bytesDiscoInicio) || raw.bytesDiscoInicio < 0))
    ) {
      throw new Error('El checkpoint local no tiene un formato reconocido');
    }
    return {
      version: CACHE_NACIONAL_VERSION,
      peticionesIniciadas: raw.peticionesIniciadas as number,
      ultimoInicioPeticion: Number.isFinite(raw.ultimoInicioPeticion) ? raw.ultimoInicioPeticion! : null,
      cooldownHasta: Number.isFinite(raw.cooldownHasta) ? raw.cooldownHasta! : null,
      bytesPayloadActuales: raw.bytesPayloadActuales as number,
      campanaInicio: raw.campanaInicio,
      bytesDiscoInicio: raw.bytesDiscoInicio,
      politica: raw.politica,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        version: CACHE_NACIONAL_VERSION,
        peticionesIniciadas: 0,
        ultimoInicioPeticion: null,
        cooldownHasta: null,
        bytesPayloadActuales: 0,
      };
    }
    throw error;
  }
}

export async function escribirUnidadCacheNacional(
  root: string,
  unidad: UnidadCacheNacional,
): Promise<void> {
  if (unidad.id !== idUnidadNacional(unidad.tipo, unidad.url)) {
    throw new Error('El identificador de unidad no corresponde a su URL');
  }
  await escribirAtomico(
    join(root, 'units', `${unidad.id}.json`),
    `${JSON.stringify(unidad, null, 2)}\n`,
  );
}

export async function leerUnidadesCacheNacional(root: string): Promise<UnidadCacheNacional[]> {
  const directorio = join(root, 'units');
  let nombres: string[];
  try {
    nombres = await readdir(directorio);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const unidades: UnidadCacheNacional[] = [];
  for (const nombre of nombres.filter((n) => /^(html|pdf)-[a-f0-9]{64}\.json$/.test(n)).sort()) {
    const unidad = JSON.parse(await readFile(join(directorio, nombre), 'utf8')) as UnidadCacheNacional;
    validarUrlNacional(unidad.url, unidad.tipo);
    if (
      unidad.id !== idUnidadNacional(unidad.tipo, unidad.url) ||
      nombre !== `${unidad.id}.json` ||
      !Array.isArray(unidad.asociaciones)
    ) {
      throw new Error('Una unidad guardada no coincide con su clave local');
    }
    unidades.push(unidad);
  }
  return unidades;
}

export async function escribirManifiestoCacheNacional(
  root: string,
  manifiesto: ManifiestoCacheNacional,
): Promise<void> {
  await escribirAtomico(
    join(root, 'manifest.json'),
    `${JSON.stringify(manifiesto, null, 2)}\n`,
  );
}

export async function leerManifiestoCacheNacional(root: string): Promise<ManifiestoCacheNacional> {
  const manifiesto = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as Partial<ManifiestoCacheNacional>;
  if (
    manifiesto.version !== CACHE_NACIONAL_VERSION ||
    manifiesto.tipo !== 'evidencia-publica-rfee' ||
    manifiesto.soloDescarga !== true ||
    !Array.isArray(manifiesto.unidades)
  ) {
    throw new Error('El manifiesto local no tiene un formato reconocido');
  }
  for (const unidad of manifiesto.unidades) {
    validarUrlNacional(unidad.url, unidad.tipo);
    if (unidad.id !== idUnidadNacional(unidad.tipo, unidad.url)) {
      throw new Error('Clave de manifiesto inválida');
    }
  }
  return manifiesto as ManifiestoCacheNacional;
}

export async function bytesPayloadCacheNacional(root: string): Promise<number> {
  const directorio = join(root, 'blobs');
  let nombres: string[];
  try {
    nombres = await readdir(directorio);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const nombre of nombres.filter((n) => /^[a-f0-9]{64}\.bin$/.test(n))) {
    const info = await stat(join(directorio, nombre));
    if (info.isFile()) total += info.size;
  }
  return total;
}

export async function leerBlobVerificadoNacional(
  root: string,
  sha256: string,
  bytesEsperados?: number | null,
): Promise<Uint8Array<ArrayBuffer>> {
  const contenido = await readFile(rutaBlobNacional(root, sha256));
  if (
    sha256Nacional(contenido) !== sha256 ||
    (bytesEsperados != null && contenido.byteLength !== bytesEsperados)
  ) {
    throw new IntegridadPayloadNacional();
  }
  return new Uint8Array(contenido);
}

/**
 * Persists a streamed response as an immutable SHA-256 blob. Incomplete
 * streams and payloads over the caller's remaining byte budget are discarded.
 */
export async function guardarStreamBlobNacional(
  root: string,
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  bytesEsperados?: number | null,
): Promise<{ sha256: string; bytes: number; creado: boolean }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Límite de bytes inválido');
  const directorio = join(root, 'blobs');
  await mkdir(directorio, { recursive: true });
  const temporal = join(directorio, `.nacional-tmp-${randomUUID()}`);
  let archivo: Awaited<ReturnType<typeof open>> | undefined;
  let lector: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let recibidos = 0;
  const hash = createHash('sha256');
  try {
    archivo = await open(temporal, 'wx');
    lector = stream.getReader();
    for (;;) {
      let resultado: ReadableStreamReadResult<Uint8Array>;
      try {
        resultado = await lector.read();
      } catch {
        throw new LecturaParcialNacional(recibidos);
      }
      if (resultado.done) break;
      const trozo = resultado.value;
      if (recibidos + trozo.byteLength > maxBytes) {
        throw new LimitePayloadNacional(recibidos + trozo.byteLength);
      }
      let desplazamiento = 0;
      while (desplazamiento < trozo.byteLength) {
        const escritura = await archivo.write(trozo, desplazamiento, trozo.byteLength - desplazamiento);
        if (escritura.bytesWritten <= 0) throw new Error('No se pudo escribir el payload local');
        desplazamiento += escritura.bytesWritten;
      }
      hash.update(trozo);
      recibidos += trozo.byteLength;
    }
    if (bytesEsperados != null && recibidos !== bytesEsperados) {
      throw new LecturaParcialNacional(recibidos);
    }
    await archivo.sync();
    await archivo.close();
    archivo = undefined;
    const sha256 = hash.digest('hex');
    const destino = rutaBlobNacional(root, sha256);
    try {
      const existente = await readFile(destino);
      if (existente.byteLength !== recibidos || sha256Nacional(existente) !== sha256) {
        throw new IntegridadPayloadNacional();
      }
      await rm(temporal, { force: true });
      return { sha256, bytes: recibidos, creado: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      // Link gives the content-addressed name atomically without replacing an
      // existing immutable blob if another local process won the race.
      await link(temporal, destino);
      await rm(temporal, { force: true });
      return { sha256, bytes: recibidos, creado: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existente = await readFile(destino);
      if (existente.byteLength !== recibidos || sha256Nacional(existente) !== sha256) {
        throw new IntegridadPayloadNacional();
      }
      await rm(temporal, { force: true });
      return { sha256, bytes: recibidos, creado: false };
    }
  } catch (error) {
    if (lector) await lector.cancel().catch(() => undefined);
    if (archivo) await archivo.close().catch(() => undefined);
    await rm(temporal, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    lector?.releaseLock();
  }
}

/**
 * A strictly offline `fetch` implementation for the existing HTML/PDF
 * readers. It serves only exact URLs in a completed local manifest and never
 * falls back to the network.
 */
export function crearFetchReplayNacional(root: string): typeof fetch {
  let manifiestoPendiente: Promise<ManifiestoCacheNacional> | undefined;
  return async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const pedido = typeof Request !== 'undefined' && entrada instanceof Request ? entrada : null;
    const url = pedido ? pedido.url : String(entrada);
    const metodo = (init?.method ?? pedido?.method ?? 'GET').toUpperCase();
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      throw new Error('El replay local sólo admite GET y HEAD');
    }
    validarUrlNacional(url);
    manifiestoPendiente ??= leerManifiestoCacheNacional(root);
    const manifiesto = await manifiestoPendiente;
    const unidad = manifiesto.unidades.find((u) => u.url === url);
    if (!unidad || (unidad.estado !== 'cached' && unidad.estado !== 'empty')) {
      throw new Error(`No hay evidencia local disponible (${unidad?.estado ?? 'cache_miss'})`);
    }
    const contenido = await leerBlobVerificadoNacional(root, unidad.sha256!, unidad.bytes);
    const status = unidad.httpStatus ?? 200;
    const sinCuerpo = metodo === 'HEAD' || status === 204 || status === 205;
    const response = new Response(sinCuerpo ? null : contenido, {
      status,
      headers: unidad.contentType ? { 'content-type': unidad.contentType } : undefined,
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
}

export const LIMITES_CACHE_NACIONAL = {
  peticiones: 2000,
  minutos: 30,
  crecimientoBytes: 512 * 1024 * 1024,
  libresBytes: 5 * 1024 ** 3,
  unidadesLote: 200,
  intervaloMs: 350,
  documentoBytes: 25 * 1024 * 1024,
  timeoutMs: 60_000,
} as const;

/** Only official national classifications and linked document paths, not athlete profiles. */
export function validarUrlNacional(url: string, tipo?: TipoDocumentoNacional): URL {
  const parsed = new URL(url);
  const html = /^\/ranking\/public\/RFEE\/competition\/\d+\/?$/.test(parsed.pathname);
  // The official inventory also labels three .jpg / extensionless links as
  // PDF. Preserve those source facts; validate actual magic bytes after GET.
  const pdf = /^\/client\/\d+\/[^/]+$/.test(parsed.pathname);
  if (
    parsed.origin !== `https://${HOST_NACIONAL_PERMITIDO}` ||
    parsed.username || parsed.password || parsed.hash ||
    !(tipo === 'html' ? html : tipo === 'pdf' ? pdf : html || pdf)
  ) throw new Error('URL fuera del inventario nacional permitido');
  for (const key of parsed.searchParams.keys()) {
    if (key !== 'setLang') throw new Error('Parámetro ajeno al documento público permitido');
  }
  return parsed;
}

type FilaInventarioNacional = AsociacionNacional & {
  enlaces: { tipo: string; url: string }[];
};
export type InventarioCacheNacional = {
  ownRfeeCatalog: FilaInventarioNacional[];
  catalog?: FilaInventarioNacional[];
  publishedSeasons?: { label: string; value: string }[];
};

/** No name, licence, birthdate or raw source row is copied into the manifest. */
export function prepararUnidadesNacionales(inventario: InventarioCacheNacional): UnidadCacheNacional[] {
  if (!Array.isArray(inventario.ownRfeeCatalog)) {
    throw new Error('Se requiere el catálogo propio RFEE (índice sin owa=1)');
  }
  const unidades = new Map<string, UnidadCacheNacional>();
  for (const fila of inventario.ownRfeeCatalog) {
    if (fila.fuente !== 'skermo_rfee' || fila.federacion !== 'RFEE') {
      throw new Error('El catálogo propio contiene una federación no nacional');
    }
    const asociacion: AsociacionNacional = {
      fuente: fila.fuente, federacion: fila.federacion, temporada: fila.temporada,
      clavePrueba: fila.clavePrueba, claveCatalogo: fila.claveCatalogo,
      arma: fila.arma, genero: fila.genero, categoria: fila.categoria,
      categoriaOriginal: fila.categoriaOriginal, formato: fila.formato,
    };
    for (const enlace of fila.enlaces) {
      if (enlace.tipo !== 'html' && enlace.tipo !== 'pdf') continue;
      validarUrlNacional(enlace.url, enlace.tipo);
      const id = idUnidadNacional(enlace.tipo, enlace.url);
      let unidad = unidades.get(id);
      if (!unidad) {
        unidad = {
          id, tipo: enlace.tipo, url: enlace.url, asociaciones: [],
          estado: 'pending', intentos: 0, consultadoEn: null, httpStatus: null,
          contentType: null, declaredBytes: null, receivedBytes: 0, bytes: null,
          sha256: null, retryAfterMs: null, motivo: null,
        };
        unidades.set(id, unidad);
      }
      if (!unidad.asociaciones.some((a) =>
        a.claveCatalogo === asociacion.claveCatalogo && a.temporada === asociacion.temporada)) {
        unidad.asociaciones.push(asociacion);
      }
    }
  }
  return [...unidades.values()].sort((a, b) =>
    a.asociaciones[0].temporada.localeCompare(b.asociaciones[0].temporada) ||
    a.tipo.localeCompare(b.tipo) || a.id.localeCompare(b.id));
}

/** Retry-After is preserved without the legacy ten-minute clamp. */
export function retryAfterNacional(value: string | null, ahora: number): number | null {
  if (value === null) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  const fecha = Date.parse(value);
  return Number.isFinite(fecha) ? Math.max(0, fecha - ahora) : null;
}

/** Minimal robots groups + longest path rule. Unknown directives fail closed. */
export function permiteRobotsNacional(texto: string, url: string): boolean {
  if (!/^\s*user-agent\s*:/im.test(texto)) return false;
  const grupos: { agentes: string[]; reglas: { permitir: boolean; ruta: string }[] }[] = [];
  let actual = { agentes: [] as string[], reglas: [] as { permitir: boolean; ruta: string }[] };
  let tieneReglas = false;
  for (const original of texto.split(/\r?\n/)) {
    const linea = original.replace(/#.*$/, '').trim();
    if (!linea) continue;
    const match = /^([^:]+):\s*(.*)$/.exec(linea);
    if (!match) return false;
    const [, claveOriginal, valor] = match;
    const clave = claveOriginal.toLowerCase().trim();
    if (clave === 'user-agent') {
      if (tieneReglas) {
        grupos.push(actual);
        actual = { agentes: [], reglas: [] };
        tieneReglas = false;
      }
      actual.agentes.push(valor.toLowerCase());
    } else if (clave === 'allow' || clave === 'disallow') {
      tieneReglas = true;
      if (valor) actual.reglas.push({ permitir: clave === 'allow', ruta: valor });
    } else if (clave !== 'sitemap') {
      // e.g. Crawl-delay requires an operator to revise the pacing policy.
      return false;
    }
  }
  grupos.push(actual);
  const especificos = grupos.filter((g) => g.agentes.some((a) =>
    a !== '*' && a !== '' && 'calendarioesgrima'.includes(a)));
  const aplicables = especificos.length ? especificos : grupos.filter((g) => g.agentes.includes('*'));
  const u = new URL(url);
  const objetivo = `${u.pathname}${u.search}`;
  let mejor = { longitud: -1, permitir: true };
  for (const grupo of aplicables) for (const regla of grupo.reglas) {
    const patron = regla.ruta.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp(`^${patron}`).test(objetivo)) {
      const longitud = regla.ruta.replace(/[*$]/g, '').length;
      if (longitud > mejor.longitud || (longitud === mejor.longitud && regla.permitir)) {
        mejor = { longitud, permitir: regla.permitir };
      }
    }
  }
  return mejor.permitir;
}

export async function bytesDiscoCacheNacional(root: string): Promise<number> {
  let total = 0;
  for (const entrada of await readdir(root, { withFileTypes: true })) {
    const ruta = join(root, entrada.name);
    if (entrada.isSymbolicLink()) throw new Error('El cache no admite enlaces simbólicos');
    if (entrada.isDirectory()) total += await bytesDiscoCacheNacional(ruta);
    else if (entrada.isFile()) total += (await stat(ruta)).size;
  }
  return total;
}

export async function libresDiscoNacional(root: string): Promise<number> {
  const info = await statfs(root, { bigint: true });
  return Number(info.bavail * info.bsize);
}

export type ResumenCacheNacional = ReturnType<typeof resumirCacheNacional>;
export function resumirCacheNacional(unidades: UnidadCacheNacional[]) {
  const temporadas: Record<string, { html: number; pdf: number; cachedHtml: number; cachedPdf: number; empty: number }> = {};
  const estados: Record<string, number> = {};
  for (const unidad of unidades) {
    estados[unidad.estado] = (estados[unidad.estado] ?? 0) + 1;
    for (const temporada of new Set(unidad.asociaciones.map((a) => a.temporada))) {
      const t = temporadas[temporada] ??= { html: 0, pdf: 0, cachedHtml: 0, cachedPdf: 0, empty: 0 };
      t[unidad.tipo]++;
      if (unidad.estado === 'cached') t[unidad.tipo === 'html' ? 'cachedHtml' : 'cachedPdf']++;
      if (unidad.estado === 'empty') t.empty++;
    }
  }
  return {
    documentos: unidades.length, html: unidades.filter((u) => u.tipo === 'html').length,
    pdf: unidades.filter((u) => u.tipo === 'pdf').length, estados, temporadas,
    pendientesDeCache: unidades.filter((u) => u.estado !== 'cached' && u.estado !== 'empty').length,
    aviso: 'Cached sólo acredita bytes HTTP; no acredita importación ni resultados completos.',
  };
}

export type OpcionesLoteNacional = {
  root: string;
  unidades: UnidadCacheNacional[];
  aplicar?: boolean;
  maxUnidades?: number;
  maxPeticiones?: number;
  maxMinutos?: number;
  temporadas?: string[];
  tipos?: TipoDocumentoNacional[];
  reintentar?: boolean;
  /** Must reference an existing explicit approval; a batch never creates one. */
  windowId?: string;
};
export type DepsLoteNacional = {
  fetch?: typeof fetch;
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
  libres?: (root: string) => Promise<number>;
};
export type ResultadoLoteNacional = ResumenCacheNacional & {
  modo: 'dry-run' | 'download-only';
  motivoParada: string | null;
  codigoFallo: string | null;
  peticionesLote: number;
  peticionesCampana: number;
  unidadesLote: number;
  completadas: number;
  integridadFallida: number;
  bytesPayload: number;
  cooldownHasta: number | null;
};

/** Sequential by design: one connection, global >=350ms starts, no child processes or DB imports. */
export async function ejecutarLoteNacional(
  opciones: OpcionesLoteNacional,
  deps: DepsLoteNacional = {},
): Promise<ResultadoLoteNacional> {
  const maxUnidades = opciones.maxUnidades ?? LIMITES_CACHE_NACIONAL.unidadesLote;
  const maxPeticiones = opciones.maxPeticiones ?? LIMITES_CACHE_NACIONAL.peticiones;
  const maxMinutos = opciones.maxMinutos ?? LIMITES_CACHE_NACIONAL.minutos;
  for (const [valor, max] of [
    [maxUnidades, LIMITES_CACHE_NACIONAL.unidadesLote],
    [maxPeticiones, LIMITES_CACHE_NACIONAL.peticiones],
  ]) if (!Number.isSafeInteger(valor) || valor < 1 || valor > max) throw new Error('Límite de lote inválido');
  if (!Number.isFinite(maxMinutos) || maxMinutos <= 0 || maxMinutos > LIMITES_CACHE_NACIONAL.minutos) {
    throw new Error('Límite de tiempo inválido');
  }
  const { root } = opciones;
  const ahora = deps.ahora ?? Date.now;
  const esperar = deps.esperar ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const libres = deps.libres ?? libresDiscoNacional;
  const red = deps.fetch ?? fetch;
  const guardadas = new Map((await leerUnidadesCacheNacional(root)).map((u) => [u.id, u]));
  // A failed local unit rename can leave an older "downloading" file while
  // the final manifest retained the complete response. Reconcile offline;
  // never issue a second provider GET for already verified evidence.
  try {
    for (const unidad of (await leerManifiestoCacheNacional(root)).unidades) {
      const anterior = guardadas.get(unidad.id);
      if ((unidad.estado === 'cached' || unidad.estado === 'empty') &&
          (!anterior || anterior.estado === 'downloading' || anterior.estado === 'pending' ||
           anterior.estado === 'deferred_budget')) guardadas.set(unidad.id, unidad);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const unidades = opciones.unidades.map((original) => {
    validarUrlNacional(original.url, original.tipo);
    const anterior = guardadas.get(original.id);
    return anterior ? { ...anterior, asociaciones: original.asociaciones } : { ...original };
  });
  // Verify before skipping: missing/corrupt blobs are not a successful resume.
  let integridadFallida = 0;
  for (const unidad of unidades) if (unidad.estado === 'cached' || unidad.estado === 'empty') {
    try {
      await leerBlobVerificadoNacional(root, unidad.sha256!, unidad.bytes);
    } catch {
      unidad.estado = 'partial';
      unidad.motivo = 'integridad_local_fallida';
      integridadFallida++;
    }
  }
  const filtradas = unidades.filter((u) =>
    (!opciones.temporadas?.length || u.asociaciones.some((a) => opciones.temporadas!.includes(a.temporada))) &&
    (!opciones.tipos?.length || opciones.tipos.includes(u.tipo)));
  const seleccionadas = filtradas.filter((u) =>
    ['pending', 'downloading', 'deferred_budget'].includes(u.estado) ||
    (opciones.reintentar && !['cached', 'empty'].includes(u.estado))).slice(0, maxUnidades);
  const estado = await leerEstadoCacheNacional(root);
  if (!opciones.aplicar) {
    return { modo: 'dry-run', peticionesLote: 0, unidadesLote: seleccionadas.length,
      motivoParada: null, codigoFallo: null, completadas: 0,
      peticionesCampana: estado.peticionesIniciadas,
      bytesPayload: estado.bytesPayloadActuales, cooldownHasta: estado.cooldownHasta,
      integridadFallida, ...resumirCacheNacional(unidades) };
  }
  await mkdir(root, { recursive: true });
  const lockPath = join(root, 'run.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Hay un lote local abierto; no se roba su lock'); });
  try {
    if (opciones.windowId) await validateDownloadRoot(root);
    const ventana = opciones.windowId ? await readOpenDownloadWindow(root, opciones.windowId, 'rfee') : undefined;
    await assertContinuationOwner(root, ventana?.approvalId);
    if (JSON.stringify(await leerEstadoCacheNacional(root)) !== JSON.stringify(estado)) {
      throw new Error('El checkpoint cambió durante la preparación; repetir sin solapamiento');
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, inicio: new Date(ahora()).toISOString() }));
  } catch (error) {
    await lock.close();
    await rm(lockPath, { force: true });
    throw error;
  }
  const inicioLote = ahora();
  const peticionesInicio = estado.peticionesIniciadas;
  const ledger: { numero: number; inicio: number; tipo: string; status: number | null }[] = [];
  let motivoParada = 'lote_completado';
  let codigoFallo: string | null = null;
  const anotarFallo = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    codigoFallo = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'SIN_CODIGO';
  };
  let completadas = 0;
  // Account for atomic metadata temp files and the final aggregate manifest.
  const reservaMetadatos = 16 * 1024 * 1024;
  const abort = new AbortController();
  const detener = () => { motivoParada = 'senal_parada'; abort.abort(); };
  process.once('SIGINT', detener);
  process.once('SIGTERM', detener);
  let finCampana = Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  class Parada extends Error {}
  const parar = (motivo: string): never => { motivoParada = motivo; throw new Parada(); };
  try {
    const ventana = opciones.windowId ? await readOpenDownloadWindow(root, opciones.windowId, 'rfee') : undefined;
    const discoInicial = await bytesDiscoCacheNacional(root);
    // The lock guarantees one writer. Bound growth conservatively, including
    // each unit's metadata, rather than O(n²) rescanning every older blob.
    let crecimientoLocal = 0;
    const medidos = await bytesPayloadCacheNacional(root);
    if (medidos < estado.bytesPayloadActuales) parar('integridad_local_fallida');
    estado.bytesPayloadActuales = medidos;
    if (!ventana) {
      estado.campanaInicio ??= ahora();
      estado.bytesDiscoInicio ??= discoInicial;
    } else if (estado.peticionesIniciadas < ventana.initial.requests ||
               estado.bytesPayloadActuales < ventana.initial.payloadBytes) parar('integridad_local_fallida');
    const inicioCampana = ventana?.startedAt ?? estado.campanaInicio!;
    const bytesDiscoInicio = ventana?.initial.diskBytes ?? estado.bytesDiscoInicio!;
    const techoPeticiones = ventana ? Math.min(ventana.requestCeiling, ventana.initial.requests + maxPeticiones) : maxPeticiones;
    finCampana = Math.min(ventana?.deadline ?? Infinity, inicioCampana + maxMinutos * 60_000);
    timer = setTimeout(() => abort.abort(), Math.max(0, finCampana - ahora()));
    if (integridadFallida) parar('integridad_local_fallida');
    if (estado.cooldownHasta && estado.cooldownHasta > ahora()) parar('cooldown_vigente');
    if (!seleccionadas.length) parar('sin_unidades_pendientes_seleccionadas');
    if (ahora() >= finCampana) parar('presupuesto_tiempo');
    const iniciar = async (url: string, tipo: string, maxBytes: number): Promise<Response> => {
      if (abort.signal.aborted) parar('tiempo_o_senal');
      if (estado.peticionesIniciadas >= techoPeticiones) parar('presupuesto_peticiones');
      const espera = Math.max(0, (estado.ultimoInicioPeticion ?? -Infinity) + LIMITES_CACHE_NACIONAL.intervaloMs - ahora());
      if (ahora() + espera >= finCampana) parar('presupuesto_tiempo');
      await esperar(espera);
      if (estado.cooldownHasta && estado.cooldownHasta > ahora()) parar('cooldown_vigente');
      const ocupados = discoInicial + crecimientoLocal;
      if (ocupados - bytesDiscoInicio + maxBytes + reservaMetadatos > LIMITES_CACHE_NACIONAL.crecimientoBytes) {
        parar('presupuesto_bytes');
      }
      if (await libres(root) < LIMITES_CACHE_NACIONAL.libresBytes + maxBytes + reservaMetadatos) parar('espacio_libre');
      if (ahora() >= finCampana || abort.signal.aborted) parar('presupuesto_tiempo');
      estado.ultimoInicioPeticion = ahora();
      estado.peticionesIniciadas++;
      // Reserve durably BEFORE GET; a crash never undercounts physical attempts.
      await escribirEstadoCacheNacional(root, estado);
      // Slow local fsync must not permit a GET after the campaign deadline.
      if (ahora() >= finCampana || abort.signal.aborted) parar('presupuesto_tiempo');
      const inicio = ahora();
      estado.ultimoInicioPeticion = inicio;
      const entrada = { numero: estado.peticionesIniciadas, inicio, tipo, status: null as number | null };
      ledger.push(entrada);
      const response = await red(url, {
        method: 'GET', redirect: 'manual', cache: 'no-store',
        headers: { 'User-Agent': 'CalendarioEsgrima/1.0 (+public-national-download-only)',
          Accept: tipo === 'pdf' ? 'application/pdf' : tipo === 'policy' ? 'text/plain' : 'text/html' },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(
          Math.max(1, Math.min(LIMITES_CACHE_NACIONAL.timeoutMs, finCampana - ahora())))]),
      });
      entrada.status = response.status;
      return response;
    };
    const cooldown = async (response: Response) => {
      const retry = retryAfterNacional(response.headers.get('retry-after'), ahora());
      if (response.status === 429 || response.status === 503) {
        estado.cooldownHasta = ahora() + Math.max(60_000, retry ?? 0);
        await escribirEstadoCacheNacional(root, estado);
      }
      return retry;
    };
    // Policy GET is counted and subject to the same host/disk/time budgets.
    if (!estado.politica) {
      const policyResponse = await iniciar(`https://${HOST_NACIONAL_PERMITIDO}/robots.txt`, 'policy', 1024 * 1024);
      await cooldown(policyResponse);
      if (policyResponse.status !== 200 || !policyResponse.body) {
        await policyResponse.body?.cancel();
        return parar(policyResponse.status === 429 || policyResponse.status === 503 ? 'cooldown_fuente' : 'politica_no_verificada');
      }
      const policyBlob = await guardarStreamBlobNacional(root, policyResponse.body, 1024 * 1024);
      estado.politica = { sha256: policyBlob.sha256, bytes: policyBlob.bytes, consultadoEn: new Date(ahora()).toISOString() };
      if (policyBlob.creado) {
        crecimientoLocal += policyBlob.bytes;
        estado.bytesPayloadActuales += policyBlob.bytes;
      }
      await escribirEstadoCacheNacional(root, estado);
    }
    const policyText = new TextDecoder().decode(await leerBlobVerificadoNacional(root, estado.politica.sha256, estado.politica.bytes));
    if (seleccionadas.some((u) => !permiteRobotsNacional(policyText, u.url))) parar('robots_no_permite');
    for (const unidad of seleccionadas) {
      const antes = estado.peticionesIniciadas;
      const intentosAntes = unidad.intentos;
      try {
        unidad.estado = 'downloading';
        unidad.motivo = null;
        await escribirUnidadCacheNacional(root, unidad);
        const response = await iniciar(unidad.url, unidad.tipo, LIMITES_CACHE_NACIONAL.documentoBytes);
        unidad.intentos++;
        unidad.consultadoEn = new Date(ahora()).toISOString();
        unidad.httpStatus = response.status;
        unidad.contentType = response.headers.get('content-type');
        const declarados = response.headers.get('content-length');
        unidad.declaredBytes = declarados !== null && /^\d+$/.test(declarados) ? Number(declarados) : null;
        unidad.retryAfterMs = await cooldown(response);
        if (response.status === 206 || response.headers.has('content-range')) {
          await response.body?.cancel();
          unidad.estado = 'partial';
          unidad.motivo = 'http_payload_parcial';
          unidad.sha256 = null;
          unidad.bytes = null;
          unidad.receivedBytes = 0;
          parar('respuesta_parcial');
        }
        if (!response.ok) {
          await response.body?.cancel();
          unidad.estado = response.status === 429 || response.status === 503 ? 'cooldown' : 'http_error';
          unidad.motivo = `http_${response.status}`;
          await escribirUnidadCacheNacional(root, unidad);
          if (unidad.estado === 'cooldown') parar('cooldown_fuente');
          if (response.status >= 500) parar('error_servidor');
          continue;
        }
        if (unidad.declaredBytes !== null && unidad.declaredBytes > LIMITES_CACHE_NACIONAL.documentoBytes) {
          await response.body?.cancel();
          unidad.estado = 'deferred_budget';
          unidad.motivo = 'documento_supera_25MiB';
          continue;
        }
        const blob = await guardarStreamBlobNacional(root,
          response.body ?? new ReadableStream({ start(c) { c.close(); } }),
          LIMITES_CACHE_NACIONAL.documentoBytes,
          response.headers.get('content-encoding') ? null : unidad.declaredBytes);
        if (blob.creado) {
          crecimientoLocal += blob.bytes;
          estado.bytesPayloadActuales += blob.bytes;
        }
        unidad.sha256 = blob.sha256;
        unidad.bytes = blob.bytes;
        unidad.receivedBytes = blob.bytes;
        const contenido = await leerBlobVerificadoNacional(root, blob.sha256, blob.bytes);
        const pdfValido = new TextDecoder('latin1').decode(contenido.subarray(0, 5)).startsWith('%PDF-');
        const htmlValido = /text\/html|application\/xhtml\+xml/i.test(unidad.contentType ?? '');
        unidad.estado = blob.bytes === 0 ? 'empty'
          : (unidad.tipo === 'pdf' ? pdfValido : htmlValido) ? 'cached' : 'invalid_payload';
        if (unidad.estado === 'invalid_payload') unidad.motivo = 'respuesta_no_es_tipo_publicado';
        if (unidad.estado === 'invalid_payload') parar('integridad_payload');
        completadas++;
      } catch (error) {
        if (error instanceof Parada) {
          if (unidad.estado === 'downloading') {
            unidad.estado = 'deferred_budget';
            unidad.motivo = motivoParada;
          }
          throw error;
        }
        if (estado.peticionesIniciadas > antes && unidad.estado === 'downloading') {
          // No response was returned, but the reserved GET was physically attempted.
          if (unidad.intentos === intentosAntes) {
            unidad.intentos++;
            unidad.consultadoEn = new Date(ahora()).toISOString();
            unidad.httpStatus = null;
            unidad.contentType = null;
            unidad.declaredBytes = null;
            unidad.retryAfterMs = null;
          }
        }
        unidad.estado = error instanceof LecturaParcialNacional || error instanceof LimitePayloadNacional ? 'partial' : 'network_error';
        anotarFallo(error);
        unidad.receivedBytes = error instanceof LecturaParcialNacional || error instanceof LimitePayloadNacional ? error.bytesRecibidos : 0;
        unidad.motivo = error instanceof LimitePayloadNacional ? 'payload_supera_limite'
          : error instanceof LecturaParcialNacional ? 'stream_interrumpido' : 'red_o_almacenamiento_interrumpido';
        parar('fallo_tecnico');
      } finally {
        // One atomic unit checkpoint, not an unbounded in-memory batch.
        await escribirUnidadCacheNacional(root, unidad);
        crecimientoLocal += Buffer.byteLength(JSON.stringify(unidad, null, 2)) * 2 + 2048;
        await escribirEstadoCacheNacional(root, estado);
      }
    }
  } catch (error) {
    if (!(error instanceof Parada)) {
      anotarFallo(error);
      motivoParada = 'fallo_tecnico_politica_o_almacenamiento';
    }
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
    process.removeListener('SIGINT', detener);
    process.removeListener('SIGTERM', detener);
    try {
      await escribirEstadoCacheNacional(root, estado);
      await escribirManifiestoCacheNacional(root, {
        version: CACHE_NACIONAL_VERSION, tipo: 'evidencia-publica-rfee',
        generadoEn: new Date(ahora()).toISOString(), soloDescarga: true,
        aviso: 'Payload cacheado no equivale a resultados importados ni completos.',
        peticionesIniciadas: estado.peticionesIniciadas,
        bytesPayload: estado.bytesPayloadActuales, unidades,
      });
      const receipt = {
        pid: process.pid, inicio: new Date(inicioLote).toISOString(), fin: new Date(ahora()).toISOString(),
        motivoParada, codigoFallo, completadas, peticionesLote: estado.peticionesIniciadas - peticionesInicio,
        peticionesCampana: estado.peticionesIniciadas, ledger,
        cooldownHasta: estado.cooldownHasta, bytesPayload: estado.bytesPayloadActuales,
        bytesDisco: await bytesDiscoCacheNacional(root), libresBytes: await libres(root),
        limiteConcurrenciaReal: 1, procesosHijos: 0, escriturasDB: 0, uploadsR2: 0,
      };
      await escribirAtomico(join(root, 'batches', `${randomUUID()}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
  return {
    modo: 'download-only', motivoParada, codigoFallo, peticionesLote: estado.peticionesIniciadas - peticionesInicio,
    peticionesCampana: estado.peticionesIniciadas, unidadesLote: seleccionadas.length, completadas,
    integridadFallida,
    bytesPayload: estado.bytesPayloadActuales, cooldownHasta: estado.cooldownHasta,
    ...resumirCacheNacional(unidades),
  };
}
