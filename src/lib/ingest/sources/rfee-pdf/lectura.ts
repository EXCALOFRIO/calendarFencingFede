import { motivoHttp, parsearRetryAfter } from '../../http-retry';
import { createHash } from 'node:crypto';
import { leerResultadosPdf } from './resultados';
import type { ItemTexto, LecturaPdf, PaginaTexto, PerfilLectura } from './tipos';

/**
 * Lectura de un PDF de resultados: bytes → texto posicionado por página →
 * `leerResultadosPdf`. Todo en memoria y sólo lectura: el PDF no se guarda
 * (ni en Postgres) y no se envía a ningún OCR ni modelo; se conserva su
 * huella SHA-256 para detectar una versión corregida.
 */

export const LIMITES_PDF = {
  /** Un PDF de Engarde de 138 tiradores pesa ~190 KB; 25 MiB ya es otra cosa. */
  maxBytes: 25 * 1024 * 1024,
  maxPaginas: 400,
  maxItemsPagina: 30_000,
  timeoutMs: 60_000,
} as const;

/** Hosts desde los que se descargan PDFs de resultados. */
export const HOSTS_PDF_PERMITIDOS: readonly string[] = ['app.skermo.org'];

export type DepsLecturaPdf = {
  bytes: (url: string) => Promise<Uint8Array>;
};

export function docIdDeUrl(url: string): string {
  const original = new URL(url);
  if (original.protocol !== 'https:' || original.username || original.password) throw new Error('pdf_document_url_invalid');
  original.hash = '';
  return `url-${createHash('sha256').update(original.href).digest('hex')}`;
}

/** Compatibility lookup only. Never use a filename alone to assign a new namespace. */
export function docIdLegadoDeUrl(url: string): string {
  try {
    const ultimo = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return ultimo.replace(/\.pdf$/i, '').slice(0, 40) || 'doc';
  } catch {
    return 'doc';
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const huella = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(huella)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class PdfNoLeible extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'PdfNoLeible';
  }
}

const formatoCaja = (n: number): string => String(Number(n.toFixed(4)));

/**
 * PDF.js omite en `getTextContent` los glifos que empiezan fuera de la caja de la página.
 * Los PDF de Engarde impresos con «Microsoft Print to PDF» dejan la última columna del
 * cuadro pegada al borde derecho y PDF.js lee «15/1» y «RAM» donde el contenido dice
 * «15/13» y «RAMIREZ LARENA Alejandro». Se reescribe cada `/MediaBox` y `/CropBox` con el
 * borde derecho ampliado y exactamente la misma longitud, para no mover los offsets de la
 * tabla xref. Devuelve `null` si no hay ninguna caja que ampliar (p. ej. cajas dentro de
 * flujos de objetos comprimidos).
 */
export function ampliarBordeDerecho(bytes: Uint8Array): Uint8Array | null {
  const texto = new TextDecoder('latin1').decode(bytes);
  const re = /\/(?:MediaBox|CropBox)\s*\[([^\]]{1,120})\]/g;
  const salida = new Uint8Array(bytes);
  let cambios = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const interior = m[1];
    const numeros = interior.trim().split(/\s+/).map(Number);
    if (numeros.length !== 4 || numeros.some((n) => !Number.isFinite(n))) continue;
    const [x0, y0, x1, y1] = numeros.map(formatoCaja);
    const libre = interior.length - (x0.length + y0.length + y1.length + 3);
    if (libre < 1) continue;
    const ancho = '9'.repeat(Math.min(libre, 6));
    if (Number(ancho) <= numeros[2]) continue;
    const nuevo = `${x0} ${y0} ${ancho} ${y1}`.padEnd(interior.length, ' ');
    const inicio = m.index + m[0].indexOf('[') + 1;
    for (let i = 0; i < nuevo.length; i += 1) salida[inicio + i] = nuevo.charCodeAt(i);
    cambios += 1;
  }
  return cambios > 0 ? salida : null;
}

const heapMb = (): number | null =>
  typeof process !== 'undefined' && typeof process.memoryUsage === 'function' ? process.memoryUsage().heapUsed / 1048576 : null;

/** Texto posicionado de cada página, con límites de tamaño, páginas y elementos. */
export async function extraerPaginas(
  bytes: Uint8Array,
  limites: { [K in keyof typeof LIMITES_PDF]?: number } & { comprobar?: () => void } = {},
): Promise<{ paginas: PaginaTexto[]; perfil: PerfilLectura }> {
  const { maxBytes, maxPaginas, maxItemsPagina } = { ...LIMITES_PDF, ...limites };
  if (bytes.length > maxBytes) throw new PdfNoLeible(`El PDF pesa ${bytes.length} bytes y el límite es ${maxBytes}`);
  const firma = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
  if (!firma.startsWith('%PDF')) throw new PdfNoLeible('El fichero no es un PDF');

  const inicio = Date.now();
  const heapAntes = heapMb();
  let heapMax = heapAntes;
  const { getDocumentProxy } = await import('unpdf');
  // PDF.js puede tomar posesión del buffer; se le da una copia.
  const documento = await getDocumentProxy(new Uint8Array(bytes));
  const ampliado = ampliarBordeDerecho(bytes);
  // El texto sale del documento con el borde ampliado; las medidas de página, del original.
  const conTexto = ampliado ? await getDocumentProxy(ampliado) : documento;
  const paginas: PaginaTexto[] = [];
  let items = 0;
  try {
    if (documento.numPages > maxPaginas) {
      throw new PdfNoLeible(`El PDF tiene ${documento.numPages} páginas y el límite es ${maxPaginas}`);
    }
    if (conTexto.numPages !== documento.numPages) throw new PdfNoLeible('El PDF cambia de páginas al ampliar su caja');
    for (let n = 1; n <= documento.numPages; n += 1) {
      limites.comprobar?.();
      const original = await documento.getPage(n);
      const [, , ancho, alto] = original.view;
      if (conTexto !== documento) original.cleanup();
      const pagina = conTexto === documento ? original : await conTexto.getPage(n);
      const contenido = await pagina.getTextContent();
      const lista: ItemTexto[] = [];
      for (const it of contenido.items) {
        if (!('str' in it) || it.str.trim() === '') continue;
        lista.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height });
      }
      if (lista.length > maxItemsPagina) throw new PdfNoLeible(`La página ${n} tiene ${lista.length} textos y el límite es ${maxItemsPagina}`);
      items += lista.length;
      paginas.push({ numero: n, ancho, alto, items: lista });
      pagina.cleanup();
      const h = heapMb();
      if (h !== null && (heapMax === null || h > heapMax)) heapMax = h;
    }
  } finally {
    if (conTexto !== documento) await conTexto.loadingTask.destroy();
    await documento.loadingTask.destroy();
  }

  return {
    paginas,
    perfil: {
      bytes: bytes.length,
      paginas: paginas.length,
      items,
      ms: Date.now() - inicio,
      heapMb: heapAntes !== null && heapMax !== null ? Math.round((heapMax - heapAntes) * 10) / 10 : null,
    },
  };
}

/** Descarga en memoria con tope de tamaño; sólo https y sólo hosts permitidos. */
export async function descargarPdf(
  url: string,
  opciones: { hosts?: readonly string[]; maxBytes?: number; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const { hosts = HOSTS_PDF_PERMITIDOS, maxBytes = LIMITES_PDF.maxBytes, timeoutMs = LIMITES_PDF.timeoutMs } = opciones;
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) {
    throw new PdfNoLeible(`Origen no permitido para un PDF de resultados: ${u.hostname}`);
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)',
      Accept: 'application/pdf',
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!res.ok || !res.body) throw new PdfNoLeible(motivoHttp(res.status, parsearRetryAfter(res.headers.get('retry-after')), ' al pedir el PDF'));
  const declarado = Number(res.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > maxBytes) throw new PdfNoLeible(`El PDF declara ${declarado} bytes y el límite es ${maxBytes}`);

  const trozos: Uint8Array[] = [];
  let total = 0;
  const lector = res.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await lector.cancel();
      throw new PdfNoLeible(`El PDF supera el límite de ${maxBytes} bytes`);
    }
    trozos.push(value);
  }
  const salida = new Uint8Array(total);
  let desplazamiento = 0;
  for (const t of trozos) {
    salida.set(t, desplazamiento);
    desplazamiento += t.length;
  }
  return salida;
}

export const depsLecturaPdfRed: DepsLecturaPdf = { bytes: (url) => descargarPdf(url) };

/**
 * Lee un PDF de resultados. Un fallo técnico (red, formato, límites) devuelve
 * `estado: 'error'` con el motivo, nunca una lectura parcial disfrazada.
 */
export async function leerPdfRfee(url: string, deps: DepsLecturaPdf = depsLecturaPdfRed): Promise<LecturaPdf> {
  const docId = docIdDeUrl(url);
  try {
    const bytes = await deps.bytes(url);
    return await leerBytesPdf(bytes, { url, docId });
  } catch (e) {
    return {
      url,
      docId,
      sha256: null,
      perfil: null,
      paginas: [],
      pruebas: [],
      rechazos: [],
      ocr: { necesario: false, paginas: [], ejecutado: false, motivo: null },
      estado: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function leerBytesPdf(bytes: Uint8Array, contexto: { url: string; docId: string },
  limites: { [K in keyof typeof LIMITES_PDF]?: number } & { comprobar?: () => void } = {}): Promise<LecturaPdf> {
  const huella = await sha256Hex(bytes);
  const { paginas, perfil } = await extraerPaginas(bytes, limites);
  return { ...leerResultadosPdf(paginas, contexto), sha256: huella, perfil };
}
