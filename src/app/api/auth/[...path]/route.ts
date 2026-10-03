import { getAuth } from '@/lib/auth/server';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';

type Contexto = { params: Promise<{ path: string[] }> };
const PRIVADO = { 'Cache-Control': 'private, no-store' };
const SEND = 'email-otp/send-verification-otp';
const VERIFY = 'sign-in/email-otp';

function denegar(status = 403) {
  return Response.json(
    { code: 'ACCESO_NO_PERMITIDO', message: 'No se ha podido entrar. Pide un código nuevo.' },
    { status, headers: PRIVADO },
  );
}

function names(request: Request) {
  return new Set((request.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('=')[0]));
}

async function responder(request: Request, send = false) {
  try {
    const response = await getAuth().handler(request);
    if (send) return Response.json({ success: true }, { headers: PRIVADO });
    if (!response.ok) return denegar(400);
    response.headers.set('Cache-Control', PRIVADO['Cache-Control']);
    return response;
  } catch {
    // No provider messages, addresses, OTPs or tokens in error responses/logs.
    return send ? Response.json({ success: true }, { headers: PRIVADO }) : denegar(503);
  }
}

export async function GET(request: Request, contexto: Contexto) {
  const { path } = await contexto.params;
  if (path.join('/') !== 'get-session') return denegar(404);
  if (names(request).has(COOKIE_ACCESO_QA)) return denegar();
  return responder(request);
}

export async function POST(request: Request, contexto: Contexto) {
  const { path } = await contexto.params;
  const ruta = path.join('/');
  if (![SEND, VERIFY, 'sign-out'].includes(ruta)) return denegar();
  const cookieNames = names(request);
  if (cookieNames.has(COOKIE_ACCESO_QA) || (cookieNames.has(COOKIE_VISTA_PREVIA) && ruta !== 'sign-out')) return denegar();
  if (request.headers.get('origin') !== new URL(request.url).origin) return denegar();
  if (!request.headers.get('content-type')?.startsWith('application/json')) return denegar(415);
  // Bound the stream before JSON parsing, including chunked bodies.
  if (!request.body) return denegar(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return denegar(413);
      }
      chunks.push(value);
    }
    const body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return denegar(400);
    if (ruta === SEND && body.type !== 'sign-in') return denegar();
    return responder(new Request(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify(body),
    }), ruta === SEND);
  } catch {
    return denegar(400);
  } finally {
    reader.releaseLock();
  }
}

export const dynamic = 'force-dynamic';
