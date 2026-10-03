import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Almacenamiento de ficheros: PDFs de convocatoria y snapshots de HTML.
 *
 * Solo Cloudflare R2, con el binding privado `ARCHIVOS`. No hay respaldo
 * silencioso en Neon ni un dominio público que eluda el control de acceso.
 * Los scripts locales preparan su caché y la suben explícitamente a R2.
 *
 * Sin binding se devuelve `null` para los snapshots opcionales. Un archivo
 * obligatorio debe comprobar el resultado y no publicar una referencia vacía.
 */

export type StoredFile = {
  url: string;
  pathname: string;
  backend: 'r2';
};

/**
 * Lo mínimo del binding de R2 que aquí se usa, escrito a mano en lugar de
 * traerse `@cloudflare/workers-types`: ese paquete redefine `Response`,
 * `fetch` y compañía y choca con la `lib: ["dom"]` del tsconfig, que sí
 * necesitan los componentes de React.
 */
export type CuboR2 = {
  put(
    clave: string,
    valor: ArrayBuffer,
    opciones?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(clave: string): Promise<ObjetoR2 | null>;
};

export type ObjetoR2 = {
  body: ReadableStream<Uint8Array> | null;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
};

declare global {
  interface CloudflareEnv {
    /** Cubo de R2 con los PDFs y los snapshots. Ver `wrangler.jsonc`. */
    ARCHIVOS?: CuboR2;
  }
}

/**
 * Devuelve el cubo de R2, o `null` si no estamos dentro de un Worker.
 *
 * `getCloudflareContext()` lanza fuera del contexto de Cloudflare, que es
 * exactamente lo que pasa con `next dev`, con los scripts de `tsx` y con
 * Vitest. Por eso el `try`: aquí no tener R2 no es un error, es el caso
 * normal en local.
 */
export function r2Bucket(): CuboR2 | null {
  try {
    return getCloudflareContext().env.ARCHIVOS ?? null;
  } catch {
    return null;
  }
}

export function storageBackend(): StoredFile['backend'] | null {
  return r2Bucket() ? 'r2' : null;
}

/**
 * URL pública de un objeto de R2.
 *
 * Por defecto se sirve a través de la propia aplicación
 * (`/api/archivos/<ruta>`) y NO exponiendo el cubo: los PDFs de convocatoria
 * llevan nombres de convocados, y un cubo con URL pública de r2.dev es un
 * listado de datos personales a un `curl` de distancia.
 *
 * Se sirve siempre a través de la aplicación. Un dominio público permitiría
 * saltarse la comprobación de sesión.
 */
function urlPublicaR2(pathname: string): string {
  const base = (
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/archivos`
  ).replace(/\/+$/, '');

  return `${base}/${pathname}`;
}

async function putToR2(
  cubo: CuboR2,
  pathname: string,
  body: Uint8Array,
  contentType: string,
): Promise<StoredFile> {
  // `put` quiere un ArrayBuffer limpio; el Uint8Array puede ser una vista
  // parcial de un buffer mayor, así que se recorta antes de mandarlo.
  const buffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;

  await cubo.put(pathname, buffer, { httpMetadata: { contentType } });

  return { url: urlPublicaR2(pathname), pathname, backend: 'r2' };
}

/**
 * Sube un fichero. Devuelve `null` si no hay almacenamiento configurado, en
 * lugar de romper: así el scraper funciona igual sin Blob.
 */
export async function storeFile(
  pathname: string,
  body: Uint8Array | string,
  options: { contentType?: string; public?: boolean } = {},
): Promise<StoredFile | null> {
  if (!pathname || pathname.startsWith('/') || pathname.includes('..') || pathname.includes('\\')) {
    throw new Error('La ruta del archivo no es válida.');
  }
  const cubo = r2Bucket();
  if (!cubo) return null;

  const bytes =
    typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const contentType = options.contentType ?? 'application/octet-stream';

  return putToR2(cubo, pathname, bytes, contentType);
}

/**
 * Guarda el HTML crudo de una ejecución del scraper.
 *
 * Comprimido con gzip, porque el calendario de la RFEE son 2,5 MB en crudo y
 * 105 KB comprimido: la diferencia entre gastarse la cuota de almacenamiento
 * en una semana y no notarla.
 *
 * Se comprime con `CompressionStream`, que es API web estándar y existe igual
 * en Node y en el runtime de Workers, en lugar de con `gzipSync` de
 * `node:zlib`: una dependencia menos de la capa de compatibilidad de Node en
 * Cloudflare, y encima no bloquea el hilo.
 */
export async function storeIngestSnapshot(
  source: string,
  runId: string,
  html: string,
): Promise<StoredFile | null> {
  if (process.env.INGEST_SNAPSHOT_HTML === 'false') return null;

  const compressed = new Uint8Array(
    await new Response(
      new Blob([html]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
  const day = new Date().toISOString().slice(0, 10);

  return storeFile(`ingest/${source}/${day}/${runId}.html.gz`, compressed, {
    contentType: 'application/gzip',
  });
}
