import { afterEach, describe, expect, it, vi } from 'vitest';
import { leerFotoOficial, LIMITES_FOTO, resolverFotoOficial } from '@/lib/sport/explorar/foto-fuente';
import {
  anchoRetratoPara, fotoPublicadaValida, retratoAncho, urlFotoOriginal, urlRetratoOficial,
} from '@/lib/sport/explorar/foto-contrato';

const ORIGINAL = 'https://static.fie.org/portraits/sintetico.jpg';
const SRC = `https://fie.org/cdn-cgi/image/width=320,quality=80,format=auto/${ORIGINAL}`;
const DIA = '2026-10-03';
const perfil = (sobre: Record<string, unknown> = {}) =>
  Response.json({ id: 123, countryCode: 'ESP', date: '1990-01-01', image: ORIGINAL, ...sobre });
const imagen = (sobre: Record<string, string> = {}) =>
  new Response(null, { headers: { 'content-type': 'image/jpeg', 'content-length': '3000', ...sobre } });
const redireccion = (url: string) => new Response(null, { status: 302, headers: { location: url } });
const simular = (...respuestas: Response[]) => vi.fn<typeof fetch>().mockImplementation(async () => {
  const respuesta = respuestas.shift();
  if (!respuesta) throw new Error('Petición adicional no autorizada en la prueba');
  return respuesta;
});

afterEach(() => vi.useRealTimers());

describe('contrato y política del lector oficial', () => {
  it('usa el ID singular observado y HEAD sin píxeles, credenciales, optimizador ni caché', async () => {
    const fetch = simular(perfil(), imagen());
    expect(await leerFotoOficial(123, DIA, { fetch })).toEqual({
      src: SRC, fichaUrl: 'https://fie.org/athletes/123',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://fie.org/api/fie/fencer/123');
    expect(fetch.mock.calls[1][0]).toBe(SRC);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store' });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'HEAD', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it.each([0, -1, 1.1, NaN, Number.MAX_SAFE_INTEGER])('rechaza ID inválido %s antes de la red', async (id) => {
    const fetch = simular();
    expect(await leerFotoOficial(id, DIA, { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { image: null }, { image: undefined }, { image: '' }, { image: 'https://otro.test/a.jpg' },
    { image: 'http://static.fie.org/a.jpg' }, { image: 'https://usuario:clave@static.fie.org/a.jpg' },
    { image: 'https://static.fie.org:444/a.jpg' }, { image: 'https://static.fie.org/a.svg' },
    { image: 'https://static.fie.org/a.html' }, { image: 'https://static.fie.org/a.jpg?token=secreto' },
    { id: 124 }, { id: '123' }, { date: '2008-01-01' }, { countryCode: 'FRA', date: '2010-05-05' },
  ])('rechaza metadata ausente, insegura, ajena o posiblemente menor: %j', async (sobre) => {
    const fetch = simular(perfil(sobre));
    expect(await leerFotoOficial(123, DIA, { fetch })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['FRA', 'ITA', 'HUN', null])('enlaza el retrato de un adulto de cualquier nacionalidad (%s) con el mismo contrato', async (countryCode) => {
    const fetch = simular(perfil({ countryCode }), imagen());
    expect(await leerFotoOficial(123, DIA, { fetch })).toEqual({
      src: SRC, fichaUrl: 'https://fie.org/athletes/123',
    });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'HEAD', credentials: 'omit' });
  });

  it.each<Record<string, string>>([
    { 'content-type': 'image/svg+xml' }, { 'content-type': 'text/html' },
    { 'content-length': '0' }, { 'content-length': '-1' }, { 'content-length': 'no' },
    { 'content-length': String(LIMITES_FOTO.imagenBytes + 1) },
  ])('no enlaza una imagen cuyo HEAD no demuestra seguridad: %j', async (headers) => {
    expect(await leerFotoOficial(123, DIA, { fetch: simular(perfil(), imagen(headers)) })).toBeNull();
  });

  it('sin content-length de imagen queda fallback sin descargar bytes para averiguarlo', async () => {
    const fetch = simular(perfil(), new Response(null, { headers: { 'content-type': 'image/jpeg' } }));
    expect(await leerFotoOficial(123, DIA, { fetch })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
    new Response('[]', { headers: { 'content-type': 'application/json' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response(null, { status: 404 }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(LIMITES_FOTO.perfilBytes + 1) } }),
  ])('fuente ausente, mal formada, tipo incorrecto o demasiado grande no es un error de app', async (respuesta) => {
    expect(await leerFotoOficial(123, DIA, { fetch: simular(respuesta) })).toBeNull();
  });

  it('acota bytes leídos aunque el servidor no publique content-length', async () => {
    let cancelada = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(LIMITES_FOTO.perfilBytes + 1)); },
      cancel() { cancelada = true; },
    });
    const fetch = simular(new Response(cuerpo, { headers: { 'content-type': 'application/json' } }));
    expect(await leerFotoOficial(123, DIA, { fetch })).toBeNull();
    expect(cancelada).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['https://otro.test/ficha', 'http://fie.org/api/fie/fencer/123', 'https://fie.org/api/fie/fencer/124'])(
    'no sigue un redirect de metadata a %s', async (url) => {
      const fetch = simular(redireccion(url));
      expect(await leerFotoOficial(123, DIA, { fetch })).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['https://otro.test/a.jpg', ORIGINAL, `${SRC}?x=1`, SRC.replace('sintetico', 'otra')])(
    'no sigue redirect de imagen a %s', async (url) => {
      const fetch = simular(perfil(), redireccion(url));
      expect(await leerFotoOficial(123, DIA, { fetch })).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('permite como máximo dos redirecciones totales sin cambiar de recurso', async () => {
    const api = 'https://fie.org/api/fie/fencer/123';
    const fetch = simular(redireccion(api), perfil(), redireccion(SRC), imagen());
    expect(await leerFotoOficial(123, DIA, { fetch })).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
    const bucle = simular(redireccion(api), redireccion(api), redireccion(api));
    expect(await leerFotoOficial(123, DIA, { fetch: bucle })).toBeNull();
    expect(bucle).toHaveBeenCalledTimes(3);
  });

  it('acota seis segundos incluyendo un fetch que no respeta abort', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    const pendiente = leerFotoOficial(123, DIA, { fetch });
    await vi.advanceTimersByTimeAsync(LIMITES_FOTO.tiempoMs);
    expect(await pendiente).toBeNull();
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('acota también un cuerpo JSON que deja de enviar bytes', async () => {
    vi.useFakeTimers();
    const fetch = simular(new Response(new ReadableStream<Uint8Array>(), { headers: { 'content-type': 'application/json' } }));
    const pendiente = leerFotoOficial(123, DIA, { fetch });
    await vi.advanceTimersByTimeAsync(LIMITES_FOTO.tiempoMs);
    expect(await pendiente).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancelación de petición y errores de red producen fallback', async () => {
    const controlador = new AbortController();
    controlador.abort();
    const fetch = simular();
    expect(await leerFotoOficial(123, DIA, { fetch, signal: controlador.signal })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const error = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Detalle privado'));
    expect(await leerFotoOficial(123, DIA, { fetch: error })).toBeNull();
  });
});

describe('ausencia definitiva frente a fallo pasajero', () => {
  it('publicada informa el peso del HEAD para medir, sin cambiar el contrato público', async () => {
    expect(await resolverFotoOficial(123, DIA, { fetch: simular(perfil(), imagen()) })).toEqual({
      tipo: 'publicada', foto: { src: SRC, fichaUrl: 'https://fie.org/athletes/123' }, bytes: 3000,
    });
  });

  it.each([
    ['ficha 404', () => simular(new Response(null, { status: 404 }))],
    ['ficha 410', () => simular(new Response(null, { status: 410 }))],
    ['sin imagen', () => simular(perfil({ image: null }))],
    ['otro ID', () => simular(perfil({ id: 124 }))],
    ['posible menor', () => simular(perfil({ date: '2010-01-01' }))],
    ['redirección ajena', () => simular(redireccion('https://otro.test/ficha'))],
    ['imagen 404', () => simular(perfil(), new Response(null, { status: 404 }))],
    ['imagen SVG', () => simular(perfil(), imagen({ 'content-type': 'image/svg+xml' }))],
  ])('%s es sin_foto: se puede recordar', async (_caso, fetch) => {
    expect(await resolverFotoOficial(123, DIA, { fetch: fetch() })).toEqual({ tipo: 'sin_foto' });
  });

  it.each([
    ['ficha 503', () => simular(new Response(null, { status: 503 }))],
    ['ficha 429', () => simular(new Response(null, { status: 429 }))],
    ['desafío HTML', () => simular(new Response('<html/>', { headers: { 'content-type': 'text/html' } }))],
    ['JSON cortado', () => simular(new Response('{', { headers: { 'content-type': 'application/json' } }))],
    ['imagen 502', () => simular(perfil(), new Response(null, { status: 502 }))],
    ['HEAD sin tamaño', () => simular(perfil(), new Response(null, { headers: { 'content-type': 'image/jpeg' } }))],
    ['error de red', () => vi.fn<typeof fetch>().mockRejectedValue(new Error('red'))],
  ])('%s es fallo: nunca se recuerda como ausencia', async (_caso, fetch) => {
    expect(await resolverFotoOficial(123, DIA, { fetch: fetch() })).toEqual({ tipo: 'fallo' });
  });

  it('ID inválido es sin_foto sin red; petición ya cancelada es fallo', async () => {
    const fetch = simular();
    expect(await resolverFotoOficial(0, DIA, { fetch })).toEqual({ tipo: 'sin_foto' });
    const controlador = new AbortController();
    controlador.abort();
    expect(await resolverFotoOficial(123, DIA, { fetch, signal: controlador.signal })).toEqual({ tipo: 'fallo' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('el tiempo agotado es fallo', async () => {
    vi.useFakeTimers();
    const pendiente = resolverFotoOficial(123, DIA, {
      fetch: vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {})),
    });
    await vi.advanceTimersByTimeAsync(LIMITES_FOTO.tiempoMs);
    expect(await pendiente).toEqual({ tipo: 'fallo' });
  });
});

describe('anchos del redimensionador de la FIE', () => {
  const MINI = SRC.replace('width=320', 'width=96');

  it('sólo 96 y 320, que son los que ya pide el resto de la aplicación', () => {
    expect(urlRetratoOficial(MINI)).not.toBeNull();
    for (const ancho of [95, 97, 192, 640]) {
      expect(urlRetratoOficial(SRC.replace('width=320', `width=${ancho}`))).toBeNull();
    }
    expect(fotoPublicadaValida({ src: MINI, fichaUrl: 'https://fie.org/athletes/123' })).toBe(true);
  });

  it('cambia el ancho sin tocar el original, ni siquiera sus acentos codificados', () => {
    expect(retratoAncho(SRC, 96)).toBe(MINI);
    expect(retratoAncho(MINI, 320)).toBe(SRC);
    const acentos = SRC.replace('sintetico', 'sint%C3%A9tico');
    expect(retratoAncho(acentos, 96)).toBe(MINI.replace('sintetico', 'sint%C3%A9tico'));
    expect(retratoAncho('https://otro.test/a.jpg', 96)).toBeNull();
    expect(retratoAncho(SRC, 640 as 96)).toBeNull();
  });

  it('96 px para avatares de hasta 48 px CSS (2x), 320 para el resto', () => {
    expect([44, 48].map(anchoRetratoPara)).toEqual([96, 96]);
    expect([49, 96, 120, 144].map(anchoRetratoPara)).toEqual([320, 320, 320, 320]);
  });
});

describe('validación del contrato en el cliente', () => {
  it('acepta únicamente el retrato oficial y su ficha pública', () => {
    expect(fotoPublicadaValida({ src: SRC, fichaUrl: 'https://fie.org/athletes/123' })).toBe(true);
    expect(fotoPublicadaValida({ src: ORIGINAL, fichaUrl: 'https://fie.org/athletes/123' })).toBe(false);
    expect(fotoPublicadaValida({ src: SRC, fichaUrl: 'https://otro.test/123' })).toBe(false);
    expect(fotoPublicadaValida(null)).toBe(false);
    expect(urlFotoOriginal('https://static.fie.org/a.jpg#x')).toBeNull();
    expect(urlRetratoOficial(SRC.replace('width=320', 'width=99999'))).toBeNull();
    expect(urlFotoOriginal('https://static.fie.org/portraits/sint%C3%A9tico.jpg')).not.toBeNull();
  });
});
