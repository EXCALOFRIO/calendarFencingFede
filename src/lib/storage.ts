import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Almacenamiento de ficheros: PDFs de convocatoria y snapshots de HTML.
 *
 * Hay dos backends posibles y se elige solo, sin que el resto del código sepa
 * cuál está activo:
 *
 * 1. **Cloudflare R2** si el Worker trae el binding `ARCHIVOS`. Es lo que se
 *    usa en producción desde la migración a Cloudflare. Plan gratuito: 10 GB
 *    y un millón de escrituras al mes, que para unos PDFs sobra.
 * 2. **Neon Object Storage** (compatible con S3) si existen las claves
 *    `AWS_*`. Es lo que sigue usándose en local y en los scripts de `tsx`,
 *    donde no hay bindings de Workers.
 *
 * Antes había un tercer backend, Vercel Blob. Se retiró al migrar a
 * Cloudflare: era la única dependencia de la plataforma de Vercel que quedaba
 * en la ruta de subida.
 *
 * Si no hay ninguno configurado no se lanza un error: se devuelve `null` y la
 * app sigue funcionando sin snapshots. Un snapshot es una ayuda para depurar,
 * no un requisito para que el calendario se vea.
 */

export type StoredFile = {
  url: string;
  pathname: string;
  backend: 'r2' | 'neon-s3';
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

function hasNeonStorage(): boolean {
  return Boolean(
    process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function storageBackend(): StoredFile['backend'] | null {
  if (r2Bucket()) return 'r2';
  if (hasNeonStorage()) return 'neon-s3';
  return null;
}

/**
 * URL pública de un objeto de R2.
 *
 * Por defecto se sirve a través de la propia aplicación
 * (`/api/archivos/<ruta>`) y NO exponiendo el cubo: los PDFs de convocatoria
 * llevan nombres de convocados, y un cubo con URL pública de r2.dev es un
 * listado de datos personales a un `curl` de distancia.
 *
 * Si algún día se pone un dominio propio delante del cubo, basta con definir
 * `R2_PUBLIC_BASE_URL` y las URLs nuevas apuntarán ahí.
 */
function urlPublicaR2(pathname: string): string {
  const base = (
    process.env.R2_PUBLIC_BASE_URL ||
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
 * Firma AWS Signature V4 para hablar con Neon Object Storage sin arrastrar el
 * SDK de AWS (que son varios megas de dependencia para una sola operación
 * `PUT`). Es criptografía estándar con `crypto.subtle`, disponible tanto en el
 * runtime de Node como en el Edge.
 */
async function hmac(
  key: ArrayBuffer | Uint8Array,
  data: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function putToNeonStorage(
  pathname: string,
  body: Uint8Array,
  contentType: string,
): Promise<StoredFile> {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3!;
  const accessKey = process.env.AWS_ACCESS_KEY_ID!;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const region = process.env.AWS_REGION || 'auto';

  const url = new URL(`${endpoint.replace(/\/$/, '')}/${pathname}`);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);

  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  let signingKey: ArrayBuffer = await hmac(
    new TextEncoder().encode(`AWS4${secretKey}`),
    dateStamp,
  );
  signingKey = await hmac(signingKey, region);
  signingKey = await hmac(signingKey, 's3');
  signingKey = await hmac(signingKey, 'aws4_request');
  const signature = toHex(await hmac(signingKey, stringToSign));

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Content-Type': contentType,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body as BodyInit,
  });

  if (!res.ok) {
    throw new Error(
      `Neon Object Storage devolvió ${res.status} al subir ${pathname}: ` +
        `${(await res.text()).slice(0, 300)}`,
    );
  }

  return { url: url.toString(), pathname, backend: 'neon-s3' };
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
  const cubo = r2Bucket();
  const backend = cubo ? 'r2' : storageBackend();
  if (!backend) return null;

  const bytes =
    typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const contentType = options.contentType ?? 'application/octet-stream';

  if (cubo) return putToR2(cubo, pathname, bytes, contentType);

  return putToNeonStorage(pathname, bytes, contentType);
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
