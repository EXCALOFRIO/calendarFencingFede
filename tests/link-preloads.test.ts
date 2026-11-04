import { describe, expect, it } from 'vitest';
import { conLinkSoloEnPaginas } from '../worker/link-preloads';

const LINK = '</_next/static/chunks/a.css>; rel=preload; as="style", </f.woff2>; rel=preload; as="font"';

const servirCon = (respuesta: Response) =>
  conLinkSoloEnPaginas(async () => respuesta);

describe('conLinkSoloEnPaginas', () => {
  it('quita la cabecera Link en una redirección', async () => {
    const respuesta = new Response('<html/>', {
      status: 307,
      headers: { Link: LINK, Location: '/entrar' },
    });
    const salida = await servirCon(respuesta)(new Request('https://x/'), {}, {});
    expect(salida.status).toBe(307);
    expect(salida.headers.get('Link')).toBeNull();
    expect(salida.headers.get('Location')).toBe('/entrar');
    expect(await salida.text()).toBe('<html/>');
  });

  it('conserva la cabecera Link en una página normal', async () => {
    const respuesta = new Response('<html/>', { status: 200, headers: { Link: LINK } });
    const salida = await servirCon(respuesta)(new Request('https://x/'), {}, {});
    expect(salida.headers.get('Link')).toBe(LINK);
  });

  it('conserva la cabecera Link en un error de servidor', async () => {
    // Los errores pintan el diseño de verdad: su CSS y sus fuentes sí se usan.
    const respuesta = new Response('<html/>', { status: 500, headers: { Link: LINK } });
    const salida = await servirCon(respuesta)(new Request('https://x/'), {}, {});
    expect(salida.headers.get('Link')).toBe(LINK);
  });

  it('devuelve la misma respuesta si un 3xx no trae Link', async () => {
    const respuesta = new Response(null, { status: 302, headers: { Location: '/x' } });
    const salida = await servirCon(respuesta)(new Request('https://x/'), {}, {});
    expect(salida).toBe(respuesta);
  });
});
