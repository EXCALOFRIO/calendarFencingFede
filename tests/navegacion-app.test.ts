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
const { hrefDePestana, toquePestana, CLAVE_RECORDADAS, raizRecordada, indiceRaizEnHistorial, hayCapaAbierta } = await import(
  '@/components/sistema/navegacion'
);
const { esRutaNeutra, pestanaQueRecuerda, sinFichaPropiaAjena } = await import('@/components/navegacion-app');
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
    expect(toquePestana('/explorar/abc', destino('explorar'), 'explorar')).toEqual({ accion: 'raiz', tipos: ['nav-volver'] });
    expect(toquePestana('/estado', destino('tu'), 'tu')).toEqual({ accion: 'raiz', tipos: ['nav-volver'] });
    expect(toquePestana('/explorar', destino('buscar'), 'buscar')).toEqual({ accion: 'raiz', tipos: ['nav-volver'] });
    expect(toquePestana('/', destino('ranking'), 'calendario')).toEqual({ accion: 'navegar', tipos: ['nav-pestana'] });
  });

  it('la pestaña activa apunta siempre a su raíz', () => {
    const recordadas = { tu: '/estado', calendario: '/?mes=2026-11' };
    expect(hrefDePestana(destino('tu'), 'tu', recordadas)).toBe('/explorar/yo');
    ir('/estado');
    expect(pintar(h(NavMovil, {}))).toMatch(/<a(?=[^>]*data-pestana="tu")(?=[^>]*href="\/explorar\/yo")/);
  });
});

describe('la brújula no se queda con la ficha propia (bucle Explorar → ficha → Explorar)', () => {
  const PROPIA = '/explorar/00000000-0000-4000-8000-0000000000aa';

  it('causa: sin saber aún cuál es la ficha propia, su primer pintado marca Explorar y la memoria la guardaba', () => {
    // Sin la ficha propia apuntada, la ruta cuelga de /explorar.
    expect(pestanaDeRuta(PROPIA, false, null)).toBe('explorar');
    // Con lo guardado, la brújula llevaba siempre a la ficha propia.
    expect(hrefDePestana(destino('explorar'), 'tu', { explorar: PROPIA })).toBe(PROPIA);
  });

  it('arreglo: con la ficha propia ya conocida, Explorar no la recuerda y la memoria vieja se limpia', () => {
    expect(pestanaQueRecuerda({ marcada: 'explorar', pathname: PROPIA, conBusqueda: false, fichaPropia: PROPIA, heredada: null })).toBeNull();
    expect(pestanaQueRecuerda({ marcada: 'tu', pathname: PROPIA, conBusqueda: false, fichaPropia: PROPIA, heredada: null })).toBe('tu');
    const limpia = sinFichaPropiaAjena({ explorar: PROPIA, tu: PROPIA, buscar: `${PROPIA}/temporadas`, ranking: `${PROPIA}/cara-a-cara?rival=x` }, PROPIA);
    expect(limpia).toEqual({ tu: PROPIA, ranking: `${PROPIA}/cara-a-cara?rival=x` });
    expect(hrefDePestana(destino('explorar'), 'tu', limpia)).toBe('/explorar');
  });

  it('una persona, una edición o un país abiertos desde una pestaña se quedan en ella', () => {
    expect(esRutaNeutra('/explorar/abc')).toBe(true);
    expect(esRutaNeutra('/explorar/abc/cara-a-cara')).toBe(true);
    expect(esRutaNeutra('/explorar/ediciones/abc')).toBe(true);
    expect(esRutaNeutra('/explorar/pais/ESP')).toBe(true);
    for (const r of ['/', '/explorar', '/explorar/buscar', '/explorar/yo', '/explorar/siguiendo', '/explorar/ediciones', '/ranking']) {
      expect(esRutaNeutra(r)).toBe(false);
    }
    for (const clave of ['calendario', 'explorar', 'buscar', 'ranking', 'tu']) {
      expect(pestanaDeRuta('/explorar/abc', false, null, clave)).toBe(clave);
      expect(pestanaDeRuta('/explorar/pais/ESP', false, null, clave)).toBe(clave);
    }
    // Las pantallas propias de una pestaña no heredan nada.
    expect(pestanaDeRuta('/ranking', false, null, 'buscar')).toBe('ranking');
    expect(pestanaDeRuta('/explorar/abc', false, null, 'inventada')).toBe('explorar');
  });

  it('la herencia: un enlace hereda la pestaña anterior; atrás y recargar usan lo anotado; un enlace directo no hereda', async () => {
    const almacen = new Map<string, string>();
    const oyentes: (() => void)[] = [];
    vi.stubGlobal('window', {
      sessionStorage: { getItem: (k: string) => almacen.get(k) ?? null, setItem: (k: string, v: string) => void almacen.set(k, v) },
      addEventListener: (tipo: string, f: () => void) => tipo === 'popstate' && oyentes.push(f),
    });
    try {
      vi.resetModules();
      const herencia = await import('@/components/sistema/herencia-pestanas');
      expect(herencia.pestanaHeredada('/explorar/abc', true)).toBeNull();
      herencia.confirmarPestana('/ranking', 'ranking', false);
      expect(herencia.pestanaHeredada('/explorar/abc', true)).toBe('ranking');
      expect(herencia.pestanaHeredada('/ranking', false)).toBeNull();
      herencia.confirmarPestana('/explorar/abc', 'ranking', true);
      herencia.confirmarPestana('/explorar/buscar', 'buscar', false);
      // Atrás hasta la persona: manda lo anotado, no la pantalla de la que se viene.
      for (const f of oyentes) f();
      expect(herencia.pestanaHeredada('/explorar/abc', true)).toBe('ranking');
      expect(herencia.pestanaAnotada('/explorar/abc')).toBe('ranking');
      // Recargar: lo anotado sigue en sessionStorage.
      herencia.reiniciarHerencia();
      expect(herencia.pestanaHeredada('/explorar/abc', true)).toBe('ranking');
      expect(herencia.pestanaHeredada('/explorar/otra', true)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('tocar la pestaña activa vacía su pila', () => {
  const deExplorar = (u: string) => pestanaDeRuta(u.split('?')[0], false, null) === 'explorar';

  it('vuelve a la raíz del historial si todo lo de en medio es de la pestaña', () => {
    const urls = ['/', '/explorar', '/explorar/abc', '/explorar/abc/temporadas'];
    expect(indiceRaizEnHistorial(urls, 3, destino('explorar'), deExplorar)).toBe(1);
  });

  it('sin raíz detrás, o con otra pestaña en medio, sustituye la entrada actual', () => {
    expect(indiceRaizEnHistorial(['/explorar/abc'], 0, destino('explorar'), deExplorar)).toBeNull();
    expect(indiceRaizEnHistorial(['/explorar', '/ranking', '/explorar/abc'], 2, destino('explorar'), deExplorar)).toBeNull();
    expect(indiceRaizEnHistorial(['/explorar', null, '/explorar/abc'], 2, destino('explorar'), deExplorar)).toBeNull();
  });

  it('en cada pestaña: raíz → subir; subpantalla → raíz; otra → cambiar', () => {
    const casos: [string, string, string][] = [
      ['calendario', '/', '/notificaciones'],
      ['explorar', '/explorar', '/explorar/abc'],
      ['buscar', '/explorar/buscar', '/explorar/ediciones/abc'],
      ['ranking', '/ranking', '/explorar/abc'],
      ['tu', '/explorar/yo', '/explorar/siguiendo'],
    ];
    for (const [clave, raiz, sub] of casos) {
      expect(destino(clave).href).toBe(raiz);
      expect(toquePestana(raiz, destino(clave), clave)).toEqual({ accion: 'subir' });
      expect(toquePestana(sub, destino(clave), clave)).toEqual({ accion: 'raiz', tipos: ['nav-volver'] });
      const otra = clave === 'ranking' ? 'tu' : 'ranking';
      expect(toquePestana(sub, destino(otra), clave)).toEqual({ accion: 'navegar', tipos: ['nav-pestana'] });
    }
  });

  it('la raíz conserva la consulta con la que se dejó (el mes del calendario), sin aceptar otra ruta', () => {
    expect(hrefDePestana(destino('calendario'), 'calendario', { [raizRecordada('calendario')]: '/?mes=2026-11' })).toBe('/?mes=2026-11');
    expect(hrefDePestana(destino('calendario'), 'calendario', { [raizRecordada('calendario')]: '/notificaciones' })).toBe('/');
    expect(hrefDePestana(destino('calendario'), 'calendario', { [raizRecordada('calendario')]: '//malo.example' })).toBe('/');
  });

  it('en la raíz con la ficha del calendario o una poule abiertas, el toque cierra la capa', () => {
    expect(hayCapaAbierta({ fichaCalendario: 'abc' })).toBe(true);
    expect(hayCapaAbierta({ hojaPoule: 1 })).toBe(true);
    expect(hayCapaAbierta({ __NA: true })).toBe(false);
    expect(hayCapaAbierta(null)).toBe(false);
  });
});

describe('cabecera del país', () => {
  it('la ficha de un país vuelve a Buscar y el cara a cara de selecciones al país', () => {
    expect(cabeceraDeRuta('/explorar/pais/ESP', false)).toMatchObject({ variante: 'subpantalla', titulo: 'País' });
    expect(cabeceraDeRuta('/explorar/pais/ESP/contra/FRA', false)).toMatchObject({
      variante: 'subpantalla',
      titulo: 'Selecciones',
      volverA: '/explorar/pais/ESP',
    });
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
      expect(fuente).toContain('<EnlacePrecarga');
      expect(fuente).not.toContain('prefetch={true}');
    }
    const enlace = readFileSync('src/components/sistema/enlace-precarga.tsx', 'utf8');
    expect(enlace).toContain('useState<string | null>(null)');
    expect(enlace).toContain('prefetch={intencion === destino}');
    expect(enlace).toContain("e.pointerType === 'mouse'");
    expect(enlace).toContain("matches(':focus-visible')");
    expect(enlace).toContain('ahorrarDatos()');
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
    expect(cabeceraDeRuta('/explorar/abc/cara-a-cara', false)).toEqual({ variante: 'subpantalla', titulo: 'Cara a cara', volverA: '/explorar/abc', encabezado: false });
    expect(cabeceraDeRuta('/explorar/ediciones/abc', false)).toEqual({ variante: 'subpantalla', titulo: 'Competición', volverA: '/explorar/ediciones', encabezado: false });
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
