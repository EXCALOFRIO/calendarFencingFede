import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FotoDeportista, fotoDe, olvidarFotos, sembrarFotos } from '@/components/explorar/foto-deportista';

describe('retrato accesible sin salto de tamaño', () => {
  it('reserva 96 px e iniciales desde SSR, sin imagen rota ni texto «Foto FIE»', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, { personaId: 'p', nombre: 'Nombre Sintético' }));
    expect(html).toContain('width:96px;height:96px');
    expect(html).toContain('NS');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/Foto FIE|FIE<\/a>/);
  });

  it('tamaño mini mantiene 48 px y el rótulo sólo para lectores de pantalla', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, {
      personaId: 'p', nombre: '', tamano: 'mini', decorativa: false,
    }));
    expect(html).toContain('width:48px;height:48px');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Foto no publicada"');
    expect(html).toContain('—');
  });

  it('el retrato de cabecera tampoco lleva sello ni título «Foto FIE»', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, { personaId: 'p', nombre: 'Ana Prueba', tamano: 'heroe' }));
    expect(html).not.toMatch(/Foto FIE|Foto oficial FIE|title=/);
  });

  it('ocultar elimina retrato y cualquier solicitud de metadata', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, {
      personaId: 'p', nombre: 'Nombre Sintético', ocultar: true,
    }));
    expect(html).toBe('');
  });

  it('usa img nativa lazy, dimensiones explícitas, referrer mínimo y fallback en error', () => {
    const codigo = readFileSync(new URL('../src/components/explorar/foto-deportista.tsx', import.meta.url), 'utf8');
    expect(codigo).toContain('key={props.personaId}');
    expect(codigo).toContain('width={medida}');
    expect(codigo).toContain('height={medida}');
    expect(codigo).toContain("'lazy'");
    expect(codigo).toContain('referrerPolicy="no-referrer"');
    expect(codigo).toContain('onError={() => { setCargada(false); setFoto(null); }}');
    expect(codigo).toContain('fotoPublicadaValida');
    expect(codigo).toContain('decoding="async"');
    // Ancho según el tamaño pintado, y la respuesta reutilizable por la caché HTTP privada.
    expect(codigo).toContain('retratoAncho(foto.src, anchoRetratoPara(medida))');
    expect(codigo).not.toContain("cache: 'no-store'");
    expect(codigo).not.toMatch(/next\/image|localStorage|sessionStorage|console\.|animate-|Foto FIE/);
  });
});

describe('una petición por foto', () => {
  const foto = { src: 'https://static.fie.org/uploads/1/2.jpg', fichaUrl: 'https://fie.org/athletes/2' };
  const respuesta = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
  afterEach(() => {
    olvidarFotos();
    vi.unstubAllGlobals();
  });

  it('la misma persona en varios sitios (cabecera, curiosidades, listas) se pide una vez', async () => {
    const pedir = vi.fn(async () => respuesta({ estado: 'foto_no_publicada' }));
    vi.stubGlobal('fetch', pedir);
    const [a, b, c] = await Promise.all([fotoDe('p1', true), fotoDe('p1'), fotoDe('p1')]);
    expect([a, b, c]).toEqual([null, null, null]);
    await fotoDe('p1');
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('un fallo pasajero no se recuerda: la siguiente vez se vuelve a pedir', async () => {
    const pedir = vi.fn()
      .mockResolvedValueOnce(respuesta({ estado: 'no_disponible' }, 503))
      .mockResolvedValueOnce(respuesta({ estado: 'publicada', foto }));
    vi.stubGlobal('fetch', pedir);
    expect(await fotoDe('p2')).toBeNull();
    const segunda = await fotoDe('p2');
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(segunda === null || typeof segunda === 'object').toBe(true);
  });
});

describe('las filas de una lista se piden en lote', () => {
  const foto = (n: number) => ({
    src: `https://fie.org/cdn-cgi/image/width=320,quality=80,format=auto/https://static.fie.org/uploads/1/${n}.jpg`,
    fichaUrl: `https://fie.org/athletes/${n}`,
  });
  const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
  afterEach(() => {
    olvidarFotos();
    vi.unstubAllGlobals();
  });

  it('varias a la vez van en una sola petición, con los ids ordenados', async () => {
    const pedir = vi.fn(async (_url: string) => json({ estado: 'ok', fotos: {
      a: { estado: 'publicada', foto: foto(1) }, b: { estado: 'foto_no_publicada' }, c: { estado: 'no_disponible' },
    } }));
    vi.stubGlobal('fetch', pedir);
    const [c, a, b] = await Promise.all([fotoDe('c'), fotoDe('a'), fotoDe('b')]);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir.mock.calls[0][0]).toBe('/api/explorar/fotos?ids=a,b,c');
    expect([a, b, c]).toEqual([foto(1), null, null]);
    // Lo definitivo se recuerda; lo pasajero (c) se vuelve a pedir, ya sola por la ruta individual.
    pedir.mockResolvedValueOnce(json({ estado: 'publicada', foto: foto(3) }));
    expect(await Promise.all([fotoDe('a'), fotoDe('b'), fotoDe('c')])).toEqual([foto(1), null, foto(3)]);
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(pedir.mock.calls[1][0]).toBe('/api/explorar/deportistas/c/foto');
  });

  it('lo que el lote deja pendiente y un despliegue sin la ruta de lote se piden una a una', async () => {
    const pedir = vi.fn(async (url: string) => {
      if (url.startsWith('/api/explorar/fotos')) {
        return url.endsWith('ids=x,y') ? json({ estado: 'ok', fotos: { x: { estado: 'pendiente' }, y: { estado: 'foto_no_publicada' } } })
          : new Response('no', { status: 404 });
      }
      return json({ estado: 'publicada', foto: foto(url.length) });
    });
    vi.stubGlobal('fetch', pedir);
    const [x, y] = await Promise.all([fotoDe('x'), fotoDe('y')]);
    expect(x).toEqual(foto('/api/explorar/deportistas/x/foto'.length));
    expect(y).toBeNull();
    expect(pedir.mock.calls.map((c) => c[0])).toEqual(['/api/explorar/fotos?ids=x,y', '/api/explorar/deportistas/x/foto']);

    pedir.mockClear();
    const [m, n] = await Promise.all([fotoDe('m'), fotoDe('n')]);
    expect(m).not.toBeNull();
    expect(n).not.toBeNull();
    expect(pedir.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/api/explorar/deportistas/m/foto', '/api/explorar/deportistas/n/foto', '/api/explorar/fotos?ids=m,n',
    ]);
  });

  it('una respuesta de lote fallida o con fotos no oficiales deja iniciales sin recordar', async () => {
    const pedir = vi.fn()
      .mockResolvedValueOnce(json({ estado: 'no_disponible' }, 503))
      .mockResolvedValueOnce(json({ estado: 'ok', fotos: { p: { estado: 'publicada', foto: { src: 'https://otro.test/x.jpg', fichaUrl: 'x' } } } }));
    vi.stubGlobal('fetch', pedir);
    expect(await Promise.all([fotoDe('p'), fotoDe('q')])).toEqual([null, null]);
    expect(await Promise.all([fotoDe('p'), fotoDe('q')])).toEqual([null, null]);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('la foto resuelta en el servidor se pinta sin pedir nada', () => {
    const pedir = vi.fn();
    vi.stubGlobal('fetch', pedir);
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, {
      personaId: 'p', nombre: 'Ana Prueba', tamano: 'lista', foto: foto(7),
    }));
    expect(html).toContain('<img');
    expect(html).toContain('static.fie.org');
    const sinFoto = renderToStaticMarkup(React.createElement(FotoDeportista, {
      personaId: 'p', nombre: 'Ana Prueba', tamano: 'lista', foto: { src: 'https://otro.test/x.jpg', fichaUrl: 'x' },
    }));
    expect(sinFoto).not.toContain('<img');
    expect(pedir).not.toHaveBeenCalled();
  });

  it('sembrarFotos ahorra la petición y no acepta fotos no oficiales', async () => {
    const pedir = vi.fn(async () => json({ estado: 'foto_no_publicada' }));
    vi.stubGlobal('fetch', pedir);
    sembrarFotos({ s1: foto(1), s2: null, s3: { src: 'https://otro.test/x.jpg', fichaUrl: 'x' } });
    expect(await fotoDe('s1')).toEqual(foto(1));
    expect(await fotoDe('s2')).toBeNull();
    expect(pedir).not.toHaveBeenCalled();
    expect(await fotoDe('s3')).toBeNull();
    expect(pedir).toHaveBeenCalledTimes(1);
  });
});

describe('caché de la ruta de la foto', () => {
  it('lo definitivo se guarda en el navegador un día, en privado; lo pasajero nunca', () => {
    const ruta = readFileSync(new URL('../src/app/api/explorar/deportistas/[id]/foto/route.ts', import.meta.url), 'utf8');
    expect(ruta).toContain("'private, max-age=86400, stale-while-revalidate=604800'");
    expect(ruta).toContain("'Cache-Control': 'private, no-store'");
    expect(ruta).toContain('status === 200 ? headersCacheables : headers');
  });
});
