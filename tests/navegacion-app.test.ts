import { readdirSync, readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});
const ruta = vi.hoisted(() => ({ pathname: '/', busqueda: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => ruta.pathname,
  useSearchParams: () => new URLSearchParams(ruta.busqueda),
  useRouter: () => ({ push() {}, replace() {}, back() {}, refresh() {}, prefetch() {} }),
}));

const { DESTINOS_APP, cabeceraDeRuta, hayBusqueda, pestanaDeRuta } = await import('@/components/navegacion-app');
const { hrefDePestana, toquePestana, CLAVE_RECORDADAS } = await import('@/components/sistema/navegacion');
const { NavMovil, NavEscritorio } = await import('@/components/nav');
const { CabeceraApp } = await import('@/components/cabecera-app');
const { seccionesDeTu } = await import('@/components/tu/filas');
const { ListaTu } = await import('@/components/tu/lista-tu');

const h = React.createElement;
const pintar = (el: React.ReactElement) => renderToStaticMarkup(el);
const destino = (clave: string) => DESTINOS_APP.find((d) => d.clave === clave)!;
const ir = (pathname: string, busqueda = '') => {
  ruta.pathname = pathname;
  ruta.busqueda = busqueda;
};
afterEach(() => ir('/'));

describe('pestaña activa', () => {
  it.each([
    ['/', '', 'calendario'],
    ['/explorar', '', 'explorar'],
    ['/explorar', 'q=garcia', 'buscar'],
    ['/explorar', 'medallas=1', 'explorar'],
    ['/explorar/buscar', '', 'buscar'],
    ['/explorar/ediciones/abc', '', 'buscar'],
    ['/explorar/00000000-0000-4000-8000-000000000001', '', 'explorar'],
    ['/explorar/00000000-0000-4000-8000-000000000001/rivales', '', 'explorar'],
    ['/ranking', '', 'ranking'],
    ['/explorar/yo', '', 'tu'],
    ['/explorar/siguiendo', '', 'tu'],
    ['/explorar/favoritos', '', 'tu'],
    ['/perfil', '', 'tu'],
    ['/estado', '', 'tu'],
    ['/ajustes/notificaciones', '', 'tu'],
    ['/admin/usuarios', '', 'tu'],
    ['/convocatorias', '', 'tu'],
    ['/notificaciones', '', null],
  ])('%s?%s marca %s', (pathname, busqueda, esperada) => {
    expect(pestanaDeRuta(pathname, hayBusqueda(new URLSearchParams(busqueda)))).toBe(esperada);
  });

  it('la barra la marca con aria-current y la tocada se pinta al instante (useLinkStatus)', () => {
    ir('/ranking');
    const html = pintar(h(NavMovil, {}));
    expect(html).toMatch(/<a(?=[^>]*data-pestana="ranking")(?=[^>]*aria-current="page")/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(readFileSync('src/components/nav.tsx', 'utf8')).toContain('useLinkStatus');
    expect(readFileSync('src/components/sistema/barra-inferior.tsx', 'utf8')).toContain('useLinkStatus');
  });
});

describe('tocar la pestaña activa', () => {
  it('en su raíz sube al principio; en una subpantalla vuelve a la raíz; otra pestaña cambia con fundido', () => {
    expect(toquePestana('/', destino('calendario'), 'calendario')).toEqual({ accion: 'subir' });
    expect(toquePestana('/explorar', destino('explorar'), 'explorar')).toEqual({ accion: 'subir' });
    expect(toquePestana('/explorar/abc', destino('explorar'), 'explorar')).toEqual({ accion: 'navegar', tipos: ['nav-volver'] });
    expect(toquePestana('/estado', destino('tu'), 'tu')).toEqual({ accion: 'navegar', tipos: ['nav-volver'] });
    expect(toquePestana('/explorar', destino('buscar'), 'buscar')).toEqual({ accion: 'navegar', tipos: ['nav-volver'] });
    expect(toquePestana('/', destino('ranking'), 'calendario')).toEqual({ accion: 'navegar', tipos: ['nav-pestana'] });
  });

  it('la pestaña activa apunta siempre a su raíz', () => {
    const recordadas = { tu: '/estado', calendario: '/?mes=2026-11' };
    expect(hrefDePestana(destino('tu'), 'tu', recordadas)).toBe('/explorar/yo');
    ir('/estado');
    expect(pintar(h(NavMovil, {}))).toMatch(/<a(?=[^>]*data-pestana="tu")(?=[^>]*href="\/explorar\/yo")/);
  });
});

describe('cada pestaña recuerda dónde la dejaste', () => {
  it('las demás pestañas vuelven a su última URL, sin salir de la aplicación', () => {
    const recordadas = { calendario: '/?mes=2026-11&arma=SABLE', tu: '/estado', explorar: '//malo.example' };
    expect(hrefDePestana(destino('calendario'), 'ranking', recordadas)).toBe('/?mes=2026-11&arma=SABLE');
    expect(hrefDePestana(destino('tu'), 'ranking', recordadas)).toBe('/estado');
    expect(hrefDePestana(destino('explorar'), 'ranking', recordadas)).toBe('/explorar');
  });

  it('la memoria se comparte entre la barra del móvil y la del escritorio, en sessionStorage', async () => {
    const almacen = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => almacen.get(k) ?? null,
        setItem: (k: string, v: string) => void almacen.set(k, v),
      },
      location: { pathname: '/', search: '?mes=2026-11' },
    });
    try {
      vi.resetModules();
      const memoria = await import('@/components/sistema/memoria-pestanas');
      memoria.recordarPestana('calendario', memoria.urlActual());
      memoria.recordarPestana('tu', '/estado');
      expect(JSON.parse(almacen.get(CLAVE_RECORDADAS)!)).toEqual({ calendario: '/?mes=2026-11', tu: '/estado' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('el HTML del servidor apunta a las raíces (sin desajuste de hidratación)', () => {
    ir('/ranking');
    const html = pintar(h(NavMovil, {}));
    for (const d of DESTINOS_APP) expect(html).toContain(`href="${d.href}"`);
  });
});

describe('precarga por intención y sin esqueletos', () => {
  it('ni la barra ni la campana precargan al pintarse', () => {
    for (const f of ['src/components/nav.tsx', 'src/components/sistema/barra-inferior.tsx', 'src/components/notificaciones/campana-cliente.tsx']) {
      const fuente = readFileSync(f, 'utf8');
      expect(fuente).toContain('prefetch={intencion}');
      expect(fuente).toMatch(/onPointerEnter=\{avisar\}[\s\S]*onPointerDown=\{avisar\}[\s\S]*onFocus=\{avisar\}/);
    }
  });

  it('Explorar, Buscar y Siguiendo no tienen loading.tsx ni esqueletos', () => {
    for (const carpeta of ['src/app/(app)/explorar', 'src/app/(app)/explorar/buscar', 'src/app/(app)/explorar/siguiendo', 'src/app/(app)/explorar/favoritos']) {
      expect(readdirSync(carpeta)).not.toContain('loading.tsx');
    }
    expect(readdirSync('src/components/explorar')).not.toContain('esqueletos.tsx');
    expect(readFileSync('src/app/(app)/explorar/pantalla-buscar.tsx', 'utf8')).toContain('<Suspense fallback={null}>');
  });

  it('la transición de página va en plantillas, que se remontan al navegar', () => {
    for (const f of ['src/app/(app)/template.tsx', 'src/app/(app)/explorar/template.tsx']) {
      expect(readFileSync(f, 'utf8')).toContain('<TransicionPagina>');
    }
    expect(readFileSync('src/app/globals.css', 'utf8')).toContain("@import '../components/sistema/sistema.css';");
  });
});

describe('cabecera compacta por pantalla', () => {
  it('raíz de cada pestaña: título a la izquierda; subpantalla: volver', () => {
    expect(cabeceraDeRuta('/', false)).toMatchObject({ variante: 'raiz', marca: true, campana: true });
    expect(cabeceraDeRuta('/explorar', false)).toMatchObject({ variante: 'raiz', titulo: 'Explorar', campana: true });
    expect(cabeceraDeRuta('/explorar', true)).toMatchObject({ variante: 'raiz', titulo: 'Buscar' });
    expect(cabeceraDeRuta('/explorar/buscar', false)).toMatchObject({ variante: 'raiz', titulo: 'Buscar' });
    expect(cabeceraDeRuta('/explorar/yo', false)).toMatchObject({ variante: 'raiz', titulo: 'Tú' });
    expect(cabeceraDeRuta('/explorar/siguiendo', false)).toEqual({ variante: 'subpantalla', titulo: 'Siguiendo', volverA: '/explorar/yo' });
    expect(cabeceraDeRuta('/estado', false)).toMatchObject({ variante: 'subpantalla', volverA: '/explorar/yo' });
    expect(cabeceraDeRuta('/notificaciones', false)).toMatchObject({ variante: 'subpantalla', volverA: '/' });
    expect(cabeceraDeRuta('/admin/usuarios', false)).toMatchObject({ variante: 'subpantalla', volverA: '/admin' });
    expect(cabeceraDeRuta('/explorar/abc/cara-a-cara', false)).toEqual({ variante: 'subpantalla', titulo: 'Cara a cara', volverA: '/explorar/abc' });
    expect(cabeceraDeRuta('/explorar/ediciones/abc', false)).toEqual({ variante: 'subpantalla', titulo: 'Competición', volverA: '/explorar/ediciones' });
    expect(cabeceraDeRuta('/ranking', false)).toEqual({ variante: 'raiz', titulo: 'Ranking' });
  });

  it('el calendario lleva la marca y la campana, y el aviso de datos viejos sólo en él', () => {
    const campana = h('a', { href: '/notificaciones', 'data-campana': '' }, 'campana');
    const aviso = h('p', { 'data-aviso': '' }, 'Sin actualizar');
    ir('/');
    const calendario = pintar(h(CabeceraApp, { campana, aviso }));
    expect(calendario).toContain('data-variante="raiz"');
    expect(calendario).toContain('Calendar');
    expect(calendario).toContain('data-campana');
    expect(calendario).toContain('data-aviso');
    expect(calendario).toContain('h-[48px]');

    ir('/explorar/siguiendo');
    const sub = pintar(h(CabeceraApp, { campana, aviso }));
    expect(sub).toContain('data-variante="subpantalla"');
    expect(sub).toContain('aria-label="Volver"');
    expect(sub).toContain('>Siguiendo</h1>');
    expect(sub).not.toContain('data-aviso');
    expect(sub).not.toContain('data-campana');
  });

  it('el armazón ya no tiene la barra de Explorar, el botón de salir ni el avatar en la cabecera del móvil', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(layout).not.toContain('BotonAtras');
    expect(layout).not.toContain('action={salir}');
    expect(layout).toContain('<CampanaNotificaciones');
    expect(layout).toContain('<CabeceraEscritorio');
    expect(layout).not.toMatch(/bg-warn\/\d+/);
    // La cabecera de 56 px sólo existe desde 1024 px.
    expect(readFileSync('src/components/cabecera-escritorio.tsx', 'utf8')).toMatch(/className="sticky top-0 z-30 hidden [^"]*lg:block"/);
  });
});

describe('roles en «Tú»', () => {
  const claves = (role: 'admin' | 'coach' | 'athlete', fichaPropia: string | null = null, convocatorias = 0) =>
    seccionesDeTu({ role, fichaPropia, convocatorias }).flatMap((s) => s.filas.map((f) => f.clave));

  it('el tirador ve su ficha, Siguiendo, Mi estado y los ajustes; Convocatorias sólo si tiene alguna', () => {
    expect(claves('athlete')).toEqual(['perfil-deportivo', 'siguiendo', 'estado', 'notificaciones', 'cuenta']);
    expect(claves('athlete', null, 2)).toEqual(['perfil-deportivo', 'siguiendo', 'estado', 'convocatorias', 'notificaciones', 'cuenta']);
  });

  it('el seleccionador ve Convocatorias y Tiradores, pero no Mi estado ni Gestión', () => {
    expect(claves('coach')).toEqual(['siguiendo', 'convocatorias', 'tiradores', 'notificaciones', 'cuenta']);
  });

  it('la dirección técnica ve además Gestión', () => {
    expect(claves('admin', '/explorar/abc')).toEqual(['perfil-deportivo', 'siguiendo', 'convocatorias', 'tiradores', 'gestion', 'notificaciones', 'cuenta']);
  });

  it('cada fila es un enlace de 48 px a su subpantalla, con Ajustes › Notificaciones', () => {
    const html = pintar(h(ListaTu, { secciones: seccionesDeTu({ role: 'athlete', fichaPropia: '/explorar/abc', convocatorias: 0 }) }));
    expect(html).toContain('href="/explorar/abc"');
    expect(html).toContain('href="/explorar/siguiendo"');
    expect(html).toContain('href="/estado"');
    expect(html).toContain('href="/ajustes/notificaciones"');
    expect(html).not.toContain('href="/admin"');
    expect(html.match(/min-h-\[48px\]/g)?.length).toBe(5);
    expect(html).toContain('>Ajustes</h2>');
  });

  it('el escritorio lleva los mismos cinco destinos para todos', () => {
    ir('/explorar/yo');
    const html = pintar(h(NavEscritorio, {}));
    for (const d of DESTINOS_APP) expect(html).toContain(`>${d.etiqueta}<`);
    expect(html).toMatch(/<a(?=[^>]*data-pestana="tu")(?=[^>]*aria-current="page")/);
  });
});
