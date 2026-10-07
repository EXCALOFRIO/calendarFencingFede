import { createDecipheriv, createECDH, createHmac, hkdfSync, randomBytes, type ECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aBase64url, deBase64url, utf8 } from '@/lib/notificaciones/push/base64url';
import {
  cifrarMensajePush, derivarClaves, descifrarMensajePush, importarPrivadaEcdh, importarPublicaNavegador,
} from '@/lib/notificaciones/push/cifrado';
import { enviarPush, type MensajePush } from '@/lib/notificaciones/push/enviar';
import { cabeceraVapid, firmarJwtVapid, generarClavesVapid, leerClavesVapid } from '@/lib/notificaciones/push/vapid';

/*
 * Keys are generated on every run (no key material in the repository) and every value is checked
 * against an independent RFC 8291 implementation written with node:crypto (HMAC/HKDF, ECDH and
 * AES-128-GCM), so the WebCrypto code under test is never only compared with itself.
 */
const TEXTO = 'When I grow up, I want to be a watermelon';

const concatenar = (...partes: Uint8Array[]) => Buffer.concat(partes.map((p) => Buffer.from(p)));
const hmac = (clave: Uint8Array, datos: Uint8Array) => createHmac('sha256', clave).update(datos).digest();
const infoClave = (ua: Uint8Array, as: Uint8Array) => concatenar(utf8('WebPush: info'), new Uint8Array([0]), ua, as);
const INFO_CEK = concatenar(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0]));
const INFO_NONCE = concatenar(utf8('Content-Encoding: nonce'), new Uint8Array([0]));

/** RFC 8291 §3.4 step by step with HMAC (extract) and one-block HKDF-Expand. */
function derivacionDeReferencia(ecdh: Uint8Array, auth: Uint8Array, ua: Uint8Array, as: Uint8Array, sal: Uint8Array) {
  const prkClave = hmac(auth, ecdh);
  const ikm = hmac(prkClave, concatenar(infoClave(ua, as), new Uint8Array([1])));
  const prk = hmac(sal, ikm);
  return {
    prkClave, ikm, prk,
    cek: hmac(prk, concatenar(INFO_CEK, new Uint8Array([1]))).subarray(0, 16),
    nonce: hmac(prk, concatenar(INFO_NONCE, new Uint8Array([1]))).subarray(0, 12),
  };
}

/** A browser-side decryptor (RFC 8188 + 8291, one record) built only on node:crypto. */
function descifrarConNode(cuerpo: Uint8Array, ua: ECDH, auth: Uint8Array): string {
  const b = Buffer.from(cuerpo);
  const sal = b.subarray(0, 16);
  const idlen = b[20];
  const as = b.subarray(21, 21 + idlen);
  const ecdh = ua.computeSecret(as);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh, auth, infoClave(ua.getPublicKey(), as), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, sal, INFO_CEK, 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, sal, INFO_NONCE, 12));
  const registro = b.subarray(21 + idlen);
  const descifrador = createDecipheriv('aes-128-gcm', cek, nonce);
  descifrador.setAuthTag(registro.subarray(registro.length - 16));
  const claro = Buffer.concat([descifrador.update(registro.subarray(0, registro.length - 16)), descifrador.final()]);
  let fin = claro.length - 1;
  while (fin >= 0 && claro[fin] === 0) fin -= 1;
  if (claro[fin] !== 2) throw new Error('falta el delimitador del último registro');
  return claro.subarray(0, fin).toString('utf8');
}

function navegadorNode() {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = new Uint8Array(randomBytes(16));
  return { ua, auth, sub: { p256dh: aBase64url(ua.getPublicKey()), auth: aBase64url(auth) } };
}

async function parServidor() {
  const par = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  return { publica, privada: await importarPrivadaEcdh(jwk.d!, publica) };
}

describe('cifrado Web Push (RFC 8291) frente a una implementación independiente', () => {
  it('cada valor intermedio coincide con la derivación de referencia, y los dos extremos llegan al mismo secreto', async () => {
    const { ua, auth, sub } = navegadorNode();
    const servidor = await parServidor();
    const navegador = await importarPublicaNavegador(sub.p256dh);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: navegador.clave }, servidor.privada, 256));
    expect(Buffer.from(ecdh).equals(ua.computeSecret(servidor.publica))).toBe(true);
    const sal = new Uint8Array(randomBytes(16));
    const d = await derivarClaves(ecdh, auth, navegador.bytes, servidor.publica, sal);
    const r = derivacionDeReferencia(ecdh, auth, navegador.bytes, servidor.publica, sal);
    for (const k of ['prkClave', 'ikm', 'prk', 'cek', 'nonce'] as const) {
      expect(Buffer.from(d[k]).equals(Buffer.from(r[k])), k).toBe(true);
    }
    expect([d.cek.length, d.nonce.length]).toEqual([16, 12]);
  });

  it('con sal y par de servidor fijos el cuerpo es determinista, con la cabecera de RFC 8188 y el tamaño de §5', async () => {
    const { ua, auth, sub } = navegadorNode();
    const servidor = await parServidor();
    const sal = new Uint8Array(randomBytes(16));
    const cuerpo = await cifrarMensajePush(utf8(TEXTO), sub, { salt: sal, servidor });
    const otra = await cifrarMensajePush(utf8(TEXTO), sub, { salt: sal, servidor });
    expect(aBase64url(cuerpo)).toBe(aBase64url(otra));
    // 16 salt + 4 rs + 1 idlen + 65 key + 41 text + 1 delimiter + 16 tag, as in the RFC example.
    expect(cuerpo.length).toBe(144);
    expect(Buffer.from(cuerpo.subarray(0, 16)).equals(Buffer.from(sal))).toBe(true);
    expect(new DataView(cuerpo.buffer, cuerpo.byteOffset).getUint32(16)).toBe(4096);
    expect(cuerpo[20]).toBe(65);
    expect(Buffer.from(cuerpo.subarray(21, 86)).equals(Buffer.from(servidor.publica))).toBe(true);
    expect(descifrarConNode(cuerpo, ua, auth)).toBe(TEXTO);
  });

  it('un mensaje con sal y par aleatorios lo descifran el receptor independiente y el propio', async () => {
    const { ua, auth, sub } = navegadorNode();
    const nuevo = await cifrarMensajePush(utf8('{"titulo":"Hola"}'), sub, { relleno: 7 });
    expect(nuevo[20]).toBe(65);
    expect(new DataView(nuevo.buffer, nuevo.byteOffset).getUint32(16)).toBe(4096);
    expect(descifrarConNode(nuevo, ua, auth)).toBe('{"titulo":"Hola"}');
    const uaPrivada = await importarPrivadaEcdh(aBase64url(ua.getPrivateKey()), ua.getPublicKey());
    expect(new TextDecoder().decode(await descifrarMensajePush(nuevo, uaPrivada, ua.getPublicKey(), auth))).toBe('{"titulo":"Hola"}');
    const otro = await cifrarMensajePush(utf8('{"titulo":"Hola"}'), sub, { relleno: 7 });
    expect(aBase64url(otro.subarray(0, 16))).not.toBe(aBase64url(nuevo.subarray(0, 16)));
  });

  it('rechaza claves de suscripción mal formadas y puntos fuera de la curva', async () => {
    const { ua, sub } = navegadorNode();
    await expect(cifrarMensajePush(utf8('x'), { p256dh: 'AAAA', auth: sub.auth })).rejects.toThrow();
    await expect(cifrarMensajePush(utf8('x'), { p256dh: sub.p256dh, auth: 'AAAA' })).rejects.toThrow();
    const fuera = new Uint8Array(ua.getPublicKey());
    fuera[64] ^= 1;
    await expect(cifrarMensajePush(utf8('x'), { p256dh: aBase64url(fuera), auth: sub.auth })).rejects.toThrow();
  });
});

function decodificarJwt(jwt: string) {
  const [h, c, f] = jwt.split('.');
  return {
    cabecera: JSON.parse(new TextDecoder().decode(deBase64url(h))),
    claims: JSON.parse(new TextDecoder().decode(deBase64url(c))),
    firmado: `${h}.${c}`,
    firma: deBase64url(f),
  };
}

describe('VAPID (RFC 8292)', () => {
  it('firma un JWT ES256 que verifica la clave pública, con aud = origen y exp ≤ 24 h', async () => {
    const claves = { ...(await generarClavesVapid()), asunto: 'mailto:avisos@example.test' };
    const ahora = new Date('2026-03-01T07:00:00Z');
    const jwt = await firmarJwtVapid('https://fcm.googleapis.com', claves, ahora);
    const { cabecera, claims, firmado, firma } = decodificarJwt(jwt);
    expect(cabecera).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:avisos@example.test');
    expect(claims.exp - ahora.getTime() / 1000).toBeGreaterThan(0);
    expect(claims.exp - ahora.getTime() / 1000).toBeLessThanOrEqual(24 * 3600);
    expect(firma.length).toBe(64);
    const publica = await crypto.subtle.importKey('raw', deBase64url(claves.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publica, firma, utf8(firmado))).toBe(true);
  });

  it('la cabecera es «vapid t=…, k=…» y la audiencia nunca lleva la ruta del endpoint', async () => {
    const claves = { ...(await generarClavesVapid()), asunto: 'https://app.example.test' };
    const cabecera = await cabeceraVapid('https://web.push.apple.com/QGuQyavXutnMH/abc?x=1', claves, new Date());
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(cabecera)!;
    expect(m[2]).toBe(claves.publica);
    expect(decodificarJwt(m[1]).claims.aud).toBe('https://web.push.apple.com');
  });

  it('sin claves o sin asunto válido no hay configuración', () => {
    expect(leerClavesVapid({})).toBeNull();
    expect(leerClavesVapid({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'http://inseguro' })).toBeNull();
    expect(leerClavesVapid({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', NEXT_PUBLIC_APP_URL: 'https://x.test' }))
      .toEqual({ publica: 'a', privada: 'b', asunto: 'https://x.test' });
  });
});

describe('envío al servicio de push', () => {
  const mensaje: MensajePush = { titulo: 'Resultados', cuerpo: 'Ana García, 3.º', url: '/notificaciones', etiqueta: 'resultados:x' };

  async function suscripcionDePrueba() {
    const par = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    return { par, publica, auth, sub: { endpoint: 'https://push.example.test/abc', p256dh: aBase64url(publica), auth: aBase64url(auth) } };
  }

  it('manda las cabeceras de RFC 8030/8291/8292 y un cuerpo que el navegador descifra', async () => {
    const claves = { ...(await generarClavesVapid()), asunto: 'mailto:a@example.test' };
    const { par, publica, auth, sub } = await suscripcionDePrueba();
    let peticion: { url: string; init: RequestInit } | null = null;
    const r = await enviarPush(sub, mensaje, claves, {
      fetch: (async (url: string, init: RequestInit) => {
        peticion = { url, init };
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(r).toEqual({ estado: 'enviada', status: 201 });
    const h = peticion!.init.headers as Record<string, string>;
    expect(peticion!.url).toBe(sub.endpoint);
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.TTL).toMatch(/^\d+$/);
    expect(h.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    const claro = await descifrarMensajePush(peticion!.init.body as Uint8Array<ArrayBuffer>, par.privateKey, publica, auth);
    expect(JSON.parse(new TextDecoder().decode(claro))).toEqual(mensaje);
  });

  it('404 y 410 son caducadas; 403 rechazada; 429 y 5xx, error reintentable; un fallo de red, también', async () => {
    const claves = { ...(await generarClavesVapid()), asunto: 'mailto:a@example.test' };
    const { sub } = await suscripcionDePrueba();
    const con = (status: number) => ({ fetch: (async () => new Response(null, { status })) as unknown as typeof fetch });
    expect((await enviarPush(sub, mensaje, claves, con(410))).estado).toBe('caducada');
    expect((await enviarPush(sub, mensaje, claves, con(404))).estado).toBe('caducada');
    expect((await enviarPush(sub, mensaje, claves, con(403))).estado).toBe('rechazada');
    expect((await enviarPush(sub, mensaje, claves, con(429))).estado).toBe('error');
    expect((await enviarPush(sub, mensaje, claves, con(503))).estado).toBe('error');
    expect((await enviarPush(sub, mensaje, claves, { fetch: (async () => { throw new Error('red'); }) as unknown as typeof fetch })).estado).toBe('error');
    expect((await enviarPush({ ...sub, endpoint: 'http://inseguro.test/x' }, mensaje, claves, con(201))).estado).toBe('rechazada');
  });

  it('un cuerpo muy largo se recorta para caber en un registro en vez de fallar', async () => {
    const claves = { ...(await generarClavesVapid()), asunto: 'mailto:a@example.test' };
    const { sub } = await suscripcionDePrueba();
    let largo = 0;
    const r = await enviarPush(sub, { ...mensaje, cuerpo: 'x'.repeat(10_000) }, claves, {
      fetch: (async (_u: string, init: RequestInit) => {
        largo = (init.body as Uint8Array).length;
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(r.estado).toBe('enviada');
    expect(largo).toBeLessThanOrEqual(4096);
  });
});
