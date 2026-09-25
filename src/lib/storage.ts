import { put } from '@vercel/blob';

/**
 * Almacenamiento de ficheros: PDFs de convocatoria y snapshots de HTML.
 *
 * Hay dos backends posibles y se elige por variables de entorno, sin que el
 * resto del código sepa cuál está activo:
 *
 * 1. **Vercel Blob** si existe `BLOB_READ_WRITE_TOKEN`. Plan Hobby: 1 GB,
 *    10.000 operaciones simples y 2.000 avanzadas (`put`/`list`) al mes.
 * 2. **Neon Object Storage** (compatible con S3) si existen las claves
 *    `AWS_*`. Es lo que ya está aprovisionado en este proyecto, así que
 *    funciona sin dar de alta nada más.
 *
 * Si no hay ninguno configurado no se lanza un error: se devuelve `null` y la
 * app sigue funcionando sin snapshots. Un snapshot es una ayuda para depurar,
 * no un requisito para que el calendario se vea.
 */

export type StoredFile = {
  url: string;
  pathname: string;
  backend: 'vercel-blob' | 'neon-s3';
};

function hasVercelBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function hasNeonStorage(): boolean {
  return Boolean(
    process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function storageBackend(): StoredFile['backend'] | null {
  if (hasVercelBlob()) return 'vercel-blob';
  if (hasNeonStorage()) return 'neon-s3';
  return null;
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
  const backend = storageBackend();
  if (!backend) return null;

  const bytes =
    typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const contentType = options.contentType ?? 'application/octet-stream';

  if (backend === 'vercel-blob') {
    // `put` de Vercel Blob acepta Buffer/Blob/stream; un Uint8Array suelto no
    // encaja en su tipo, así que se envuelve sin copiar los datos.
    const result = await put(pathname, Buffer.from(bytes), {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { url: result.url, pathname: result.pathname, backend };
  }

  return putToNeonStorage(pathname, bytes, contentType);
}

/**
 * Guarda el HTML crudo de una ejecución del scraper.
 *
 * Comprimido con gzip, porque el calendario de la RFEE son 2,5 MB en crudo y
 * 105 KB comprimido: la diferencia entre gastarse la cuota de Blob en una
 * semana y no notarla.
 */
export async function storeIngestSnapshot(
  source: string,
  runId: string,
  html: string,
): Promise<StoredFile | null> {
  if (process.env.INGEST_SNAPSHOT_HTML === 'false') return null;

  const { gzipSync } = await import('node:zlib');
  const compressed = gzipSync(Buffer.from(html, 'utf8'));
  const day = new Date().toISOString().slice(0, 10);

  return storeFile(
    `ingest/${source}/${day}/${runId}.html.gz`,
    new Uint8Array(compressed),
    { contentType: 'application/gzip' },
  );
}
