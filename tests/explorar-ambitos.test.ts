import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});
const ruta = vi.hoisted(() => ({ pathname: '/explorar', busqueda: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => ruta.pathname,
  useSearchParams: () => new URLSearchParams(ruta.busqueda),
  useRouter: () => ({ push() {}, replace() {}, back() {}, refresh() {}, prefetch() {} }),
}));
// `Link` deja ver en el HTML si sustituye la entrada del historial y si conserva el desplazamiento.
vi.mock('next/link', async () => {
  const R = await import('react');
  const Link = R.forwardRef<HTMLAnchorElement, Record<string, unknown>>(function Link(
    { href, replace, scroll, prefetch: _p, transitionTypes: _t, children, ...resto },
    ref,
  ) {
    return R.createElement(
      'a',
      { ref, href: String(href), 'data-replace': replace ? '' : undefined, 'data-scroll': scroll === false ? 'no' : undefined, ...resto },
      children as React.ReactNode,
    );
  });
  return { default: Link, useLinkStatus: () => ({ pending: false }) };
});
vi.mock('@/app/(app)/explorar/acciones', () => ({ masFeedAccion: async () => ({ estado: 'ok', items: [], siguiente: null }) }));
vi.mock('@/app/(app)/explorar/favoritos-acciones', () => ({ guardarFavoritoAccion: vi.fn(), quitarFavoritoAccion: vi.fn() }));

const { DESTINOS_APP, cabeceraDeRuta, pestanaDeRuta } = await import('@/components/navegacion-app');
const { hrefDePestana, toquePestana } = await import('@/components/sistema/navegacion');
const { AMBITOS, destinoBusqueda, urlAmbito, urlPaises } = await import('@/lib/sport/explorar/ambitos-url');
const { CabeceraExplorar } = await import('@/components/explorar/cabecera-explorar');
const { CabeceraInicio, EstadoSiguiendo } = await import('@/components/explorar/siguiendo');
const { CRITERIOS_VACIOS, construirUrl, construirUrlBuscar } = await import('@/lib/sport/explorar/url');

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const explorar = DESTINOS_APP.find((d) => d.clave === 'explorar')!;

describe('Explorar es una sola pestaña: búsqueda y descubrimiento', () => {
  it('la barra tiene cuatro destinos y ninguno es «Buscar»', () => {
    expect(DESTINOS_APP.map((d) => d.clave)).toEqual(['calendario', 'explorar', 'ranking', 'tu']);
    expect(DESTINOS_APP.map((d) => d.etiqueta)).not.toContain('Buscar');
  });

  it.each([
    ['/explorar'],
    ['/explorar/buscar'],
    ['/explorar/ediciones'],
    ['/explorar/ediciones/abc'],
    ['/explorar/pais/ESP'],
    ['/explorar/00000000-0000-4000-8000-000000000001'],
  ])('%s marca Explorar', (r) => {
    expect(pestanaDeRuta(r, false)).toBe('explorar');
    expect(pestanaDeRuta(r, true)).toBe('explorar');
  });

  it('la brújula recuerda el ámbito y la búsqueda en que se dejó, y desde ahí vuelve a «Para ti»', () => {
    expect(hrefDePestana(explorar, 'ranking', { explorar: '/explorar/buscar?q=zabala' })).toBe('/explorar/buscar?q=zabala');
    expect(toquePestana('/explorar/buscar', explorar, 'explorar')).toEqual({ accion: 'raiz', tipos: ['nav-volver'] });
    expect(toquePestana('/explorar', explorar, 'explorar')).toEqual({ accion: 'subir' });
  });

  it('los cuatro ámbitos llevan la misma cabecera de la aplicación, con campana', () => {
    for (const r of ['/explorar', '/explorar/buscar', '/explorar/ediciones']) {
      expect(cabeceraDeRuta(r, false)).toEqual({ variante: 'raiz', titulo: 'Explorar', campana: true });
    }
  });
});

describe('ámbitos y sus direcciones', () => {
  it('Para ti, Tiradores, Torneos y Países, en ese orden', () => {
    expect(AMBITOS.map((a) => [a.valor, a.etiqueta, a.raiz])).toEqual([
      ['inicio', 'Para ti', '/explorar'],
      ['personas', 'Tiradores', '/explorar/buscar'],
      ['competiciones', 'Torneos', '/explorar/ediciones'],
      ['paises', 'Países', '/explorar/buscar?ver=paises'],
    ]);
  });

  it('cambiar de ámbito conserva lo escrito, salvo en «Para ti»', () => {
    expect(urlAmbito('inicio', 'ana')).toBe('/explorar');
    expect(urlAmbito('personas', ' ana  pérez ')).toBe('/explorar/buscar?q=ana+p%C3%A9rez');
    expect(urlAmbito('competiciones', 'madrid')).toBe('/explorar/ediciones?q=madrid');
    expect(urlAmbito('paises', 'ita')).toBe('/explorar/buscar?ver=paises&q=ita');
    expect(urlAmbito('personas', '')).toBe('/explorar/buscar');
    expect(urlPaises('')).toBe('/explorar/buscar?ver=paises');
  });

  it('el campo de «Para ti» busca tiradores', () => {
    expect(destinoBusqueda('inicio', 'zabala')).toBe('/explorar/buscar?q=zabala');
    expect(destinoBusqueda('paises', 'ita')).toBe('/explorar/buscar?ver=paises&q=ita');
  });

  it('se navega a Tiradores directamente; ``/explorar?…`` queda como forma de retorno de las fichas', () => {
    const c = { ...CRITERIOS_VACIOS, q: 'ana', arma: 'SABLE' };
    expect(construirUrlBuscar(c, 'tok')).toBe('/explorar/buscar?q=ana&arma=SABLE&cursor=tok');
    expect(construirUrl(c, 'tok')).toBe('/explorar?q=ana&arma=SABLE&cursor=tok');
    expect(construirUrlBuscar(CRITERIOS_VACIOS)).toBe('/explorar/buscar');
  });
});

describe('sin historial apilado: un Atrás sale de Explorar', () => {
  it('el selector de ámbitos sustituye la entrada del historial y marca el activo', () => {
    ruta.busqueda = 'q=ana';
    const marcado = html(h(CabeceraExplorar, { activa: 'personas' }));
    ruta.busqueda = '';
    const enlaces = marcado.match(/<a [^>]*>/g) ?? [];
    expect(enlaces).toHaveLength(4);
    for (const a of enlaces) expect(a).toContain('data-replace=""');
    expect(marcado).toContain('href="/explorar/ediciones?q=ana"');
    expect(marcado).toContain('href="/explorar"');
    expect(marcado).toMatch(/<a [^>]*href="\/explorar\/buscar\?q=ana"[^>]*aria-current="page"/);
  });

  it('el campo de búsqueda va encima del selector', () => {
    const marcado = html(h(CabeceraExplorar, { activa: 'inicio', buscador: h('input', { id: 'campo' }) }));
    expect(marcado.indexOf('id="campo"')).toBeLessThan(marcado.indexOf('data-slot="sistema-segmentado"'));
  });

  it('Todo / Medallas también sustituyen la entrada y no mueven el desplazamiento', () => {
    const marcado = html(h(CabeceraInicio, { criterios: { cursor: '', soloMedallas: true } }));
    const enlaces = marcado.match(/<a [^>]*>/g) ?? [];
    const filtro = enlaces.filter((a) => /href="\/explorar(\?medallas=1)?"/.test(a));
    expect(filtro).toHaveLength(2);
    for (const a of filtro) {
      expect(a).toContain('data-replace=""');
      expect(a).toContain('data-scroll="no"');
    }
    expect(marcado).toContain('href="/explorar/siguiendo"');
    expect(marcado).not.toMatch(/feed/i);
    expect(html(h(CabeceraInicio, { criterios: { cursor: '', soloMedallas: false }, conFiltro: false }))).not.toContain('medallas=1');
  });

  it('el buscador y los filtros de Tiradores, y el campo de «Para ti», sustituyen en vez de apilar', () => {
    for (const f of ['src/components/explorar/formulario-filtros.tsx', 'src/components/explorar/buscador-inicio.tsx']) {
      const fuente = readFileSync(f, 'utf8');
      expect(fuente).toContain('router.replace(');
      expect(fuente).not.toContain('router.push(');
    }
  });
});

describe('«Para ti» sin nadie a quien seguir', () => {
  it('invita a seguir y da atajos a Torneos y Países, sin la palabra «feed»', () => {
    const marcado = html(h(EstadoSiguiendo, {
      vista: { tipo: 'ok', items: [], siguiente: null, sinResultados: true, sugeridos: [{ id: 'p1', nombre: 'ZABALA Juan', pais: 'ESP', motivo: '3º FIE' }] },
      criterios: { cursor: '', soloMedallas: false },
      siguiendo: 0,
    }));
    expect(marcado).toContain('Aún no sigues a nadie');
    expect(marcado).toContain('href="/explorar/ediciones"');
    expect(marcado).toContain('href="/explorar/buscar?ver=paises"');
    expect(marcado).toContain('>Sugerencias<');
    expect(marcado).not.toMatch(/feed/i);
    const fallo = html(h(EstadoSiguiendo, { vista: { tipo: 'error' }, criterios: { cursor: '', soloMedallas: false }, siguiendo: null }));
    expect(fallo).toContain('role="alert"');
    expect(fallo).not.toMatch(/feed/i);
  });
});

describe('volver sin historial', () => {
  const persona = '/explorar/00000000-0000-4000-8000-000000000001';

  it('una ruta neutra sube a la raíz de la pestaña desde la que se abrió', () => {
    expect(cabeceraDeRuta(persona, false, null, 'ranking')).toMatchObject({ volverA: '/ranking' });
    expect(cabeceraDeRuta(persona, false, null, 'calendario')).toMatchObject({ volverA: '/' });
    expect(cabeceraDeRuta('/explorar/ediciones/abc', false, null, 'calendario')).toMatchObject({ volverA: '/' });
    expect(cabeceraDeRuta('/explorar/pais/ESP', false, null, 'ranking')).toMatchObject({ volverA: '/ranking' });
  });

  it('desde Explorar, o sin saberlo, sube al ámbito de la ruta', () => {
    expect(cabeceraDeRuta(persona, false, null, 'explorar')).toMatchObject({ volverA: '/explorar' });
    expect(cabeceraDeRuta(persona, false, null, null)).toMatchObject({ volverA: '/explorar' });
    expect(cabeceraDeRuta('/explorar/ediciones/abc', false, null, 'explorar')).toMatchObject({ volverA: '/explorar/ediciones' });
    expect(cabeceraDeRuta('/explorar/pais/ESP', false, null, null)).toMatchObject({ volverA: '/explorar/buscar?ver=paises' });
    // La pestaña «buscar» de una sesión vieja no existe: no inventa una ruta.
    expect(cabeceraDeRuta(persona, false, null, 'buscar')).toMatchObject({ volverA: '/explorar' });
  });

  it('la ficha propia sigue subiendo a Tú, venga de donde venga', () => {
    expect(cabeceraDeRuta(persona, false, persona, 'ranking')).toMatchObject({ volverA: '/explorar/yo' });
  });
});
