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
vi.mock('next/navigation', () => ({
  usePathname: () => (globalThis as { __ruta?: string }).__ruta ?? '/',
  useRouter: () => ({ push() {}, replace() {}, back() {}, refresh() {}, prefetch() {} }),
}));

const { CalendarDays, Search, Trophy, CircleUserRound, Compass } = await import('lucide-react');
const { Boton, BotonIcono } = await import('@/components/sistema/boton');
const { ChipFiltro, FilaChips } = await import('@/components/sistema/chip-filtro');
const { BarraInferior } = await import('@/components/sistema/barra-inferior');
const { CabeceraCompacta } = await import('@/components/sistema/cabecera-compacta');
const { TransicionPagina, CLASES_PAGINA } = await import('@/components/sistema/transicion');
const { decidirCierre, conResistencia } = await import('@/components/sistema/gesto-hoja');
const nav = await import('@/components/sistema/navegacion');
const { AREA_TACTIL, SIN_MINIMO } = await import('@/components/sistema/tactil');

const h = React.createElement;
const pintar = (el: React.ReactElement) => renderToStaticMarkup(el);
const ruta = (r: string) => {
  (globalThis as { __ruta?: string }).__ruta = r;
};

const DESTINOS = [
  { clave: 'calendario', href: '/', etiqueta: 'Calendario', icono: CalendarDays },
  { clave: 'explorar', href: '/explorar', etiqueta: 'Explorar', icono: Compass },
  { clave: 'buscar', href: '/explorar/buscar', etiqueta: 'Buscar', icono: Search, prefijos: ['/explorar/ediciones'] },
  { clave: 'ranking', href: '/ranking', etiqueta: 'Ranking', icono: Trophy },
  { clave: 'tu', href: '/explorar/yo', etiqueta: 'Tú', icono: CircleUserRound, insignia: true },
] as const;

describe('navegación', () => {
  it('marca la pestaña del prefijo más largo; `/` sólo en la portada', () => {
    expect(nav.pestanaActiva('/', DESTINOS)).toBe('calendario');
    expect(nav.pestanaActiva('/explorar', DESTINOS)).toBe('explorar');
    expect(nav.pestanaActiva('/explorar/buscar', DESTINOS)).toBe('buscar');
    expect(nav.pestanaActiva('/explorar/ediciones/abc', DESTINOS)).toBe('buscar');
    expect(nav.pestanaActiva('/explorar/123e4567', DESTINOS)).toBe('explorar');
    expect(nav.pestanaActiva('/ranking?arma=SABLE', DESTINOS)).toBe('ranking');
    expect(nav.pestanaActiva('/rankingx', DESTINOS)).toBeNull();
    expect(nav.pestanaActiva('/ajustes', DESTINOS)).toBeNull();
  });

  it('tocar la pestaña activa sube arriba en su raíz y vuelve a la raíz desde una subpantalla', () => {
    const ranking = DESTINOS[3];
    expect(nav.toquePestana('/', ranking, 'calendario')).toEqual({ accion: 'navegar', tipos: ['nav-pestana'] });
    expect(nav.toquePestana('/ranking', ranking, 'ranking')).toEqual({ accion: 'subir' });
    expect(nav.toquePestana('/ranking/historico', ranking, 'ranking')).toEqual({ accion: 'raiz', tipos: ['nav-volver'] });
  });

  it('cada pestaña vuelve a donde se dejó, salvo la activa, que va a su raíz', () => {
    const [calendario, explorar, buscar, ranking] = DESTINOS;
    const recordadas = { calendario: '/?mes=2026-11&arma=SABLE', explorar: '/explorar/abc', buscar: '//malo.test' };
    expect(nav.hrefDePestana(calendario, 'explorar', recordadas)).toBe('/?mes=2026-11&arma=SABLE');
    expect(nav.hrefDePestana(explorar, 'explorar', recordadas)).toBe('/explorar');
    expect(nav.hrefDePestana(buscar, 'calendario', recordadas)).toBe('/explorar/buscar');
    expect(nav.hrefDePestana(ranking, 'calendario', recordadas)).toBe('/ranking');
  });

  it('bajar en el árbol es avanzar, subir es volver y un salto lateral no lleva dirección', () => {
    expect(nav.tiposEntre('/explorar', '/explorar/abc')).toEqual(['nav-avanzar']);
    expect(nav.tiposEntre('/', '/torneo/1')).toEqual(['nav-avanzar']);
    expect(nav.tiposEntre('/explorar/abc/cara-a-cara', '/explorar/abc')).toEqual(['nav-volver']);
    expect(nav.tiposEntre('/ranking', '/explorar')).toEqual([]);
    expect(nav.rutaMadre('/explorar/ediciones/abc')).toBe('/explorar/ediciones');
    expect(nav.rutaMadre('/ranking')).toBe('/');
  });

  it('vuelve en el historial sólo si la entrada anterior es de la aplicación', () => {
    const conApi = (urls: string[], indice: number) => ({
      location: { origin: 'https://app.test' },
      navigation: { currentEntry: { index: indice }, entries: () => urls.map((url) => ({ url })) },
    });
    expect(nav.anteriorEsDeLaApp(conApi(['https://app.test/', 'https://app.test/ranking'], 1), 0)).toBe(true);
    expect(nav.anteriorEsDeLaApp(conApi(['https://google.com/', 'https://app.test/ranking'], 1), 9)).toBe(false);
    expect(nav.anteriorEsDeLaApp(conApi(['https://app.test/ranking'], 0), 9)).toBe(false);
    expect(nav.anteriorEsDeLaApp({ location: { origin: 'x' } }, 1)).toBe(false);
    expect(nav.anteriorEsDeLaApp({ location: { origin: 'x' } }, 2)).toBe(true);
  });
});

describe('gesto de la hoja', () => {
  it('cierra con un tirón o pasado un tercio, y no con un toque', () => {
    expect(decidirCierre({ desplazamiento: 4, alto: 500, velocidad: 2 })).toBe(false);
    expect(decidirCierre({ desplazamiento: 30, alto: 500, velocidad: 0.8 })).toBe(true);
    expect(decidirCierre({ desplazamiento: 120, alto: 500, velocidad: 0.1 })).toBe(false);
    expect(decidirCierre({ desplazamiento: 170, alto: 500, velocidad: 0 })).toBe(true);
    expect(decidirCierre({ desplazamiento: 70, alto: 200, velocidad: 0 })).toBe(true);
    expect(decidirCierre({ desplazamiento: -80, alto: 500, velocidad: 3 })).toBe(false);
  });

  it('hacia arriba cede cada vez menos', () => {
    expect(conResistencia(40)).toBe(40);
    expect(conResistencia(-100)).toBe(-20);
    expect(Math.abs(conResistencia(-400))).toBeLessThan(400 / 4);
  });
});

describe('botones', () => {
  it('se ven de 28, 32 o 36 px y se tocan en 44 sin ocupar sitio', () => {
    for (const [tamano, alto] of [['sm', 28], ['md', 32], ['lg', 36]] as const) {
      const html = pintar(h(Boton, { tamano }, 'Seguir'));
      expect(html).toContain(`h-[${alto}px]`);
      expect(html).toContain('after:h-[max(100%,44px)]');
      expect(html).toContain('min-h-0!');
      expect(html).toContain('type="button"');
      expect(html).not.toMatch(/\bh-1[0-2]\b|\bh-11\b/);
    }
    expect(AREA_TACTIL).toContain('after:w-[max(100%,44px)]');
    expect(SIN_MINIMO).toBe('min-h-0! min-w-0!');
  });

  it('ninguna variante usa alfa en la superficie', () => {
    for (const variante of ['primario', 'secundario', 'claro', 'contorno', 'fantasma'] as const) {
      const clase = pintar(h(Boton, { variante }, 'x')).match(/class="([^"]+)"/)?.[1] ?? '';
      expect(clase).not.toMatch(/\bbg-[a-z-]+\/\d+/);
    }
  });

  it('el botón de icono lleva nombre accesible y el icono a 18-20 px', () => {
    const html = pintar(h(BotonIcono, { etiqueta: 'Notificaciones', tamano: 'md' }, h(Search, { 'aria-hidden': true })));
    expect(html).toContain('aria-label="Notificaciones"');
    expect(html).toContain('size-[32px]');
    expect(html).toContain('[&amp;_svg]:size-[20px]');
  });

  it('con asChild pinta el enlace con el aspecto del botón, sin type', () => {
    const html = pintar(h(Boton, { asChild: true, variante: 'primario' }, h('a', { href: '/alta' }, 'Darse de alta')));
    expect(html).toMatch(/^<a [^>]*href="\/alta"/);
    expect(html).not.toContain('type=');
    expect(html).toContain('bg-primary');
  });
});

describe('chips', () => {
  it('alternar lleva aria-pressed; menú, aria-haspopup y flecha; quitar, aspa y nombre', () => {
    const alternar = pintar(h(ChipFiltro, { marcado: true, children: 'Florete' }));
    expect(alternar).toContain('aria-pressed="true"');
    expect(alternar).toContain('bg-foreground text-background');
    expect(alternar).toContain('h-[32px]');

    const menu = pintar(h(ChipFiltro, { tipo: 'menu', contador: 2, children: 'Categoría' }));
    expect(menu).toContain('aria-haspopup="dialog"');
    expect(menu).not.toContain('aria-pressed');
    expect(menu).toContain('lucide-chevron-down');
    expect(menu).toMatch(/>2<\/span>/);

    const quitar = pintar(h(ChipFiltro, { tipo: 'quitar', children: 'Sable' }));
    expect(quitar).toContain('aria-label="Quitar Sable"');
    expect(quitar).toContain('data-marcado="true"');
    expect(quitar).toContain('lucide-x');
  });

  it('un contador a cero no se pinta', () => {
    expect(pintar(h(ChipFiltro, { tipo: 'menu', contador: 0, children: 'Arma' }))).not.toContain('cifra');
  });

  it('la fila de chips salta de línea, sin desplazamiento horizontal', () => {
    const html = pintar(h(FilaChips, { etiqueta: 'Filtros', children: h(ChipFiltro, { children: 'A' }) }));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Filtros"');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('gap-y-3');
    expect(html).not.toMatch(/overflow-x|snap-x/);
  });
});

describe('barra inferior', () => {
  it('iconos sin texto, nombre en aria-label y la pestaña de la ruta marcada', () => {
    ruta('/ranking');
    const html = pintar(h(BarraInferior, { destinos: DESTINOS }));
    expect(html).toContain('data-slot="sistema-barra-inferior"');
    expect(html).toContain('h-[50px]');
    expect(html).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(html).toContain('view-transition-name:barra-inferior');
    expect(html).toMatch(/<a [^>]*aria-label="Ranking"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*aria-label="Ranking"/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Tú, con novedades"');
    expect(html).not.toMatch(/>(Calendario|Explorar|Buscar|Ranking)</);
    expect(html).toContain('size-[22px]');
  });

  it('cristal por defecto; la sólida (muestras) no lleva cristal', () => {
    ruta('/');
    expect(pintar(h(BarraInferior, { destinos: DESTINOS }))).toMatch(/class="[^"]*\bcristal\b/);
    const html = pintar(h(BarraInferior, { destinos: DESTINOS, fondo: 'solido' }));
    expect(html).toMatch(/class="[^"]*\bbg-background\b/);
    expect(html).not.toMatch(/class="[^"]*\bcristal\b/);
  });

  it('con rótulos visibles el texto sustituye al aria-label', () => {
    ruta('/');
    const html = pintar(h(BarraInferior, { destinos: DESTINOS, rotulos: 'visibles', posicion: 'estatica' }));
    expect(html).toMatch(/>Calendario</);
    expect(html).not.toContain('aria-label="Calendario"');
    expect(html).not.toContain('fixed');
  });
});

describe('cabecera compacta', () => {
  it('subpantalla: flecha de volver y título centrado de 16 px', () => {
    ruta('/explorar/abc');
    const html = pintar(h(CabeceraCompacta, { titulo: 'Carlos Llavador' }));
    expect(html).toContain('<h1');
    expect(html).toMatch(/<h1 class="[^"]*\btext-base\b/);
    expect(html).toContain('aria-label="Volver"');
    expect(html).toContain('h-[48px]');
    expect(html).toContain('view-transition-name:cabecera');
    expect(html).toContain('sticky top-0');
  });

  it('raíz: título a la izquierda de 20 px, sin flecha', () => {
    ruta('/ranking');
    const html = pintar(h(CabeceraCompacta, { titulo: 'Ranking', variante: 'raiz' }));
    expect(html).toMatch(/<h1 class="[^"]*\btext-xl\b/);
    expect(html).not.toContain('aria-label="Volver"');
  });
});

describe('transiciones', () => {
  it('el contenedor no añade marcado y cada tipo tiene su clase', () => {
    expect(pintar(h(TransicionPagina, null, h('p', null, 'hola')))).toBe('<p>hola</p>');
    expect(CLASES_PAGINA).toEqual({
      'nav-avanzar': 'nav-avanzar',
      'nav-volver': 'nav-volver',
      'nav-pestana': 'nav-pestana',
      default: 'nav-historial',
    });
  });

  it('la CSS ancla cabecera y barra, deja pasar los toques y respeta el movimiento reducido', () => {
    const css = readFileSync('src/components/sistema/sistema.css', 'utf8');
    expect(css).toMatch(/::view-transition\s*\{\s*pointer-events:\s*none/);
    for (const clase of ['nav-avanzar', 'nav-volver', 'nav-pestana', 'nav-historial', 'sis-fundido']) {
      expect(css).toContain(`::view-transition-old(.${clase})`);
      expect(css).toContain(`::view-transition-new(.${clase})`);
    }
    expect(css).toContain('::view-transition-group(barra-inferior)');
    expect(css).toContain("data-navegacion='atras'");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*--sis-recorrido: 0px/);
    // Ninguna duración pasa de 260 ms.
    for (const ms of css.match(/\b\d+ms\b/g) ?? []) expect(Number.parseInt(ms, 10)).toBeLessThanOrEqual(260);
  });
});
