import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  almacenR2, claveMarcaFie, fotoFieConCache, leerMarca, marcaVigente, MAX_FOTOS_EN_MEMORIA,
  olvidarFotosEnMemoria, VIGENCIA_FOTO, type AlmacenMarcas,
} from '@/lib/sport/explorar/fotos/cache';
import type { CuboR2, ObjetoR2 } from '@/lib/storage';

const ORIGINAL = 'https://static.fie.org/portraits/sintetico.jpg';
const SRC = `https://fie.org/cdn-cgi/image/width=320,quality=80,format=auto/${ORIGINAL}`;
const FICHA = 'https://fie.org/athletes/123';
const HOY = '2026-10-05';

const perfil = (sobre: Record<string, unknown> = {}) =>
  Response.json({ id: 123, date: '1990-01-01', image: ORIGINAL, ...sobre });
const imagen = () => new Response(null, { headers: { 'content-type': 'image/avif', 'content-length': '15638' } });
/** FIE sintética: responde según método, y cuenta cada petición. */
function fie(modo: 'foto' | 'sin_foto' | 'caida' = 'foto') {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (modo === 'caida') return new Response(null, { status: 503 });
    if (init?.method === 'HEAD') return imagen();
    return modo === 'foto' ? perfil() : perfil({ image: null });
  });
}
function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  const a: AlmacenMarcas & { datos: Map<string, string>; leer: ReturnType<typeof vi.fn>; guardar: ReturnType<typeof vi.fn> } = {
    datos,
    leer: vi.fn(async (clave: string) => datos.get(clave) ?? null),
    guardar: vi.fn(async (clave: string, json: string) => { datos.set(clave, json); }),
  };
  return a;
}
const marca = (estado: 'publicada' | 'sin_foto', comprobada: string) => JSON.stringify(
  estado === 'publicada' ? { v: 1, estado, src: SRC, comprobada } : { v: 1, estado, comprobada },
);

afterEach(() => olvidarFotosEnMemoria());

describe('marcas de R2', () => {
  it('valida la marca como si viniera de la FIE: nada de URLs ajenas ni fechas raras', () => {
    expect(leerMarca(marca('publicada', HOY))).toEqual({ v: 1, estado: 'publicada', src: SRC, comprobada: HOY });
    expect(leerMarca(marca('sin_foto', HOY))).toEqual({ v: 1, estado: 'sin_foto', comprobada: HOY });
    for (const malo of [
      null, '', '{', '[]', JSON.stringify({ v: 2, estado: 'sin_foto', comprobada: HOY }),
      JSON.stringify({ v: 1, estado: 'publicada', src: ORIGINAL, comprobada: HOY }),
      JSON.stringify({ v: 1, estado: 'publicada', src: 'https://otro.test/a.jpg', comprobada: HOY }),
      JSON.stringify({ v: 1, estado: 'sin_foto', comprobada: '05/10/2026' }),
      JSON.stringify({ v: 1, estado: 'otro', comprobada: HOY }),
      `${marca('sin_foto', HOY)}${' '.repeat(3000)}`,
    ]) expect(leerMarca(malo)).toBeNull();
  });

  it('caduca: 30 días si hay foto, 7 si no, y una marca del futuro no vale', () => {
    const p = leerMarca(marca('publicada', '2026-09-06'))!;
    expect(marcaVigente(p, '2026-10-05')).toBe(true);
    expect(marcaVigente(p, '2026-10-06')).toBe(false);
    const s = leerMarca(marca('sin_foto', '2026-09-29'))!;
    expect(marcaVigente(s, '2026-10-05')).toBe(true);
    expect(marcaVigente(s, '2026-10-06')).toBe(false);
    expect(marcaVigente(leerMarca(marca('sin_foto', '2026-10-06'))!, HOY)).toBe(false);
    expect(VIGENCIA_FOTO.publicadaDias).toBe(30);
  });

  it('almacenR2 lee texto acotado y escribe JSON con su tipo, en fotos/fie/<id>.json', async () => {
    const guardado: { clave: string; cuerpo: string; tipo?: string }[] = [];
    const objeto = (texto: string, size = texto.length): ObjetoR2 => ({
      body: new Response(texto).body, size, httpEtag: '"e"',
    });
    const cubo: CuboR2 = {
      get: vi.fn(async (clave: string) => clave.endsWith('1.json') ? objeto('{"a":1}') : clave.endsWith('2.json')
        ? objeto('x', 5000) : null),
      put: vi.fn(async (clave: string, valor: ArrayBuffer, op?: { httpMetadata?: { contentType?: string } }) => {
        guardado.push({ clave, cuerpo: new TextDecoder().decode(valor), tipo: op?.httpMetadata?.contentType });
      }),
    };
    const a = almacenR2(cubo);
    expect(await a.leer('fotos/fie/1.json')).toBe('{"a":1}');
    expect(await a.leer('fotos/fie/2.json')).toBeNull();
    expect(await a.leer('fotos/fie/3.json')).toBeNull();
    await a.guardar(claveMarcaFie(123), marca('sin_foto', HOY));
    expect(guardado).toEqual([{ clave: 'fotos/fie/123.json', cuerpo: marca('sin_foto', HOY), tipo: 'application/json' }]);
  });
});

describe('memoria -> R2 -> FIE', () => {
  it('la primera vez pregunta a la FIE y guarda la dirección; después ni R2 ni FIE', async () => {
    const fetch = fie();
    const a = almacen();
    expect(await fotoFieConCache(123, HOY, { fetch, almacen: a })).toEqual({
      foto: { src: SRC, fichaUrl: FICHA }, definitivo: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(a.datos.get('fotos/fie/123.json')!)).toEqual({ v: 1, estado: 'publicada', src: SRC, comprobada: HOY });
    // Ni el cumpleaños ni nada más de la ficha llega a la marca.
    expect(a.datos.get('fotos/fie/123.json')).not.toMatch(/1990|date|image"/);
    await fotoFieConCache(123, HOY, { fetch, almacen: a });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(a.leer).toHaveBeenCalledTimes(1);
  });

  it('otro isolate (memoria vacía) lee R2 y no toca la FIE', async () => {
    const fetch = fie();
    const a = almacen({ 'fotos/fie/123.json': marca('publicada', '2026-10-01') });
    expect((await fotoFieConCache(123, HOY, { fetch, almacen: a })).foto?.src).toBe(SRC);
    expect(fetch).not.toHaveBeenCalled();
    expect(a.guardar).not.toHaveBeenCalled();
  });

  it('«no hay foto» también se recuerda, y evita repetir peticiones externas', async () => {
    const fetch = fie('sin_foto');
    const a = almacen();
    expect(await fotoFieConCache(123, HOY, { fetch, almacen: a })).toEqual({ foto: null, definitivo: true });
    olvidarFotosEnMemoria();
    expect(await fotoFieConCache(123, HOY, { fetch, almacen: a })).toEqual({ foto: null, definitivo: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('una marca caducada se renueva con la FIE', async () => {
    const fetch = fie('sin_foto');
    const a = almacen({ 'fotos/fie/123.json': marca('publicada', '2026-08-01') });
    expect(await fotoFieConCache(123, HOY, { fetch, almacen: a })).toEqual({ foto: null, definitivo: true });
    expect(JSON.parse(a.datos.get('fotos/fie/123.json')!).estado).toBe('sin_foto');
  });

  it('si la FIE falla se sirve la última foto conocida aunque haya caducado, sin reescribirla', async () => {
    const fetch = fie('caida');
    const a = almacen({ 'fotos/fie/123.json': marca('publicada', '2026-08-01') });
    expect(await fotoFieConCache(123, HOY, { fetch, almacen: a })).toEqual({
      foto: { src: SRC, fichaUrl: FICHA }, definitivo: true,
    });
    expect(a.guardar).not.toHaveBeenCalled();
  });

  it('un fallo sin marca previa no se guarda como ausencia y se reintenta tras la pausa', async () => {
    let ahora = 1_000_000;
    const fetch = fie('caida');
    const a = almacen();
    const leer = () => fotoFieConCache(123, HOY, { fetch, almacen: a, ahora: () => ahora });
    expect(await leer()).toEqual({ foto: null, definitivo: false });
    expect(a.guardar).not.toHaveBeenCalled();
    expect(await leer()).toEqual({ foto: null, definitivo: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    ahora += VIGENCIA_FOTO.falloMs + 1;
    await leer();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('R2 roto o una escritura fallida no rompen la foto', async () => {
    const roto: AlmacenMarcas = {
      leer: async () => { throw new Error('R2'); },
      guardar: async () => { throw new Error('R2'); },
    };
    expect((await fotoFieConCache(123, HOY, { fetch: fie(), almacen: roto })).foto?.src).toBe(SRC);
  });

  it('sin almacén (local) sólo usa la memoria, que está acotada', async () => {
    const fetch = fie('sin_foto');
    for (let id = 1; id <= MAX_FOTOS_EN_MEMORIA + 1; id++) {
      await fotoFieConCache(id, HOY, { fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(perfil({ id, image: null })) });
    }
    // El primero se ha desalojado: vuelve a preguntar.
    await fotoFieConCache(1, HOY, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
