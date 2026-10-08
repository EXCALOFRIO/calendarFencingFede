import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const busqueda = { valor: new URLSearchParams() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/ranking',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => busqueda.valor,
}));

const { BotonFiltros, CampoBuscar, OpcionesFiltro, PieHojaFiltros } = await import('@/components/filtros/chips');
const { ChipFiltro } = await import('@/components/sistema/chip-filtro');
const { BarraFiltrosRanking } = await import('@/components/ranking/selectores-grupo');
const { ProveedorRanking, escribirUrl } = await import('@/components/ranking/estado-ranking');
const { PanelRanking } = await import('@/components/ranking/panel-ranking');
const { SelectorTemporada } = await import('@/components/ranking/selector-temporada');
const { leerVistaRanking } = await import('@/app/(app)/ranking/datos');

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const nada = () => {};
const FLORETE_M_ABS = { weapon: 'FLORETE', gender: 'M', category: 'ABS' } as const;
const grupos = [FLORETE_M_ABS, { weapon: 'FLORETE', gender: 'M', category: 'M20' }, { weapon: 'ESPADA', gender: 'F', category: 'M17' }] as const;

describe('filtros compactos: las piezas del sistema', () => {
  it('el botón Filtros es un chip del sistema que abre la hoja y dice cuántos hay', () => {
    const boton = html(React.createElement(BotonFiltros, { activos: 2 }));
    expect(boton).toContain('data-slot="sistema-chip"');
    expect(boton).toContain('aria-haspopup="dialog"');
    // El nombre sale de lo visible («Filtros 2») y el lector oye además «activos».
    expect(boton).not.toContain('aria-label=');
    expect(boton).toContain('<span class="sr-only"> activos</span>');
    expect(boton).toContain('h-[32px]');
    expect(html(React.createElement(BotonFiltros, { activos: 0 }))).not.toContain('sr-only');
  });

  it('las opciones de la hoja son grupos de radio con el aspecto del chip del sistema', () => {
    const chip = html(React.createElement(ChipFiltro, { marcado: true, children: 'Solo España' }));
    expect(chip).toContain('aria-pressed="true"');
    const opciones = html(React.createElement(OpcionesFiltro, {
      titulo: 'Arma', valor: 'FLORETE', onCambio: nada,
      opciones: [{ valor: 'ESPADA', etiqueta: 'Espada' }, { valor: 'FLORETE', etiqueta: 'Florete' }],
    }));
    expect(opciones).toContain('<legend');
    expect(opciones).toMatch(/role="radio" aria-checked="true"/);
    expect(opciones).toContain('h-[32px]');
    expect(opciones).toContain('bg-foreground');
  });

  it('el buscador mide 40 px como el de Buscar, con 16 px en el móvil y la etiqueta como área táctil', () => {
    const campo = html(React.createElement(CampoBuscar, { valor: 'llav', onCambio: nada, etiqueta: 'Buscar un tirador' }));
    expect(campo).toContain('role="search"');
    expect(campo).toContain('h-[40px]');
    expect(campo).toContain('text-base');
    expect(campo).toContain('<label class="relative block py-1">');
    expect(campo).toContain('aria-label="Vaciar la búsqueda"');
  });

  it('el pie de la hoja dice cuántos resultados quedan', () => {
    const pie = html(React.createElement(PieHojaFiltros, { resultados: 'Ver 45 tiradores', onCerrar: nada, onLimpiar: nada }));
    expect(pie).toContain('Ver 45 tiradores');
    expect(pie).toContain('Restablecer');
    expect(pie).toContain('data-slot="sistema-boton"');
  });
});

describe('barra de filtros de /ranking', () => {
  it('fuera del panel no hay chips de ranking; dentro, Nacional / Internacional / Europeo van en chips', () => {
    const barra = (extra = {}) => React.createElement(BarraFiltrosRanking, {
      grupos: [...grupos], grupo: FLORETE_M_ABS, onElegir: nada, busqueda: '', onBuscar: nada, ...extra,
    });
    const suelta = html(barra());
    expect(suelta).not.toContain('Qué ranking se enseña');
    // Dos chips de 1-2 palabras, no una cadena «A · B · C».
    expect(suelta).toContain('>Florete masculino<');
    expect(suelta).toContain('>Absoluto<');
    expect(suelta).not.toContain(' · ');
    expect(suelta).toContain('placeholder="Buscar"');
    const dentro = html(React.createElement(ProveedorRanking, { ambitoInicial: 'FIE', hayInternacional: true, hayEuropeo: true, children: () => barra({ activos: 1 }) }));
    expect(dentro).toContain('aria-label="Qué ranking se enseña"');
    expect(dentro).toMatch(/role="radio" aria-checked="true"[^>]*>.*?data-ambito="FIE">Internacional/);
    expect(dentro).toMatch(/role="radio" aria-checked="false"[^>]*>.*?data-ambito="RFEE">Nacional/);
    expect(dentro).toContain('>Europeo<');
    expect(dentro).toContain('<span class="sr-only"> activo</span>');
  });

  it('sin internacional, el proveedor se queda en Nacional y no pinta el conmutador', () => {
    const salida = html(React.createElement(ProveedorRanking, {
      ambitoInicial: 'FIE', hayInternacional: false,
      children: (a: string) => React.createElement('p', null, a, React.createElement(BarraFiltrosRanking, { grupos: [...grupos], grupo: FLORETE_M_ABS, onElegir: nada })),
    }));
    expect(salida).toContain('<p>RFEE');
    expect(salida).not.toContain('Qué ranking se enseña');
  });

  it('temporada pasada: chip quitable de la temporada y la misma barra', () => {
    const salida = html(React.createElement(SelectorTemporada, {
      temporadas: ['2025-2026', '2021-2022'], vigente: '2025-2026',
      actual: { temporada: '2021-2022', arma: 'SABLE', genero: 'M', categoria: 'M20' },
      grupos: [{ arma: 'SABLE', genero: 'M', categoria: 'M20', categoriaRaw: 'M20' }],
      grupo: { arma: 'SABLE', genero: 'M', categoria: 'M20', categoriaRaw: 'M20' },
    }));
    expect(salida).toContain('Temporada 21-22');
    expect(salida).toContain('aria-label="Quitar filtro: temporada 2021-2022"');
    expect(salida).toContain('>Sable masculino<');
    expect(salida).toContain('data-barra-filtros');
  });
});

describe('sólo viaja la tabla que se ve', () => {
  const fie = { grupos: [{ ...FLORETE_M_ABS, format: 'INDIVIDUAL', tiradores: 1 }] as never, inicial: { ...FLORETE_M_ABS, format: 'INDIVIDUAL' as const }, primeraTabla: null, mios: [], cargar: vi.fn() };
  const nacional = { datos: null, cargar: vi.fn(), grupoInicial: 'FLORETE|M|ABS', conMiFicha: false, temporadas: ['2025-2026'], vigente: '2025-2026', filtro: { temporada: null, arma: null, genero: null, categoria: null } };

  it('abriendo en Nacional sin datos todavía, ni esqueleto ni «Cargando»', () => {
    const salida = html(React.createElement(PanelRanking, { fichas: [], federacionInicial: 'RFEE', nacional, fie }));
    expect(salida).not.toContain('Cargando');
    expect(salida).not.toContain('data-slot="skeleton"');
    expect(nacional.cargar).not.toHaveBeenCalled();
  });

  it('abriendo en Internacional sin tabla pintada, la pide sin afirmar que no hay ni pintar «Cargando…»', () => {
    const salida = html(React.createElement(PanelRanking, { fichas: [], federacionInicial: 'FIE', nacional, fie }));
    expect(salida).not.toContain('Cargando');
    expect(salida).not.toContain('Sin clasificación internacional');
  });

  it('/ranking no tiene loading.tsx ni título propio: lo pone la cabecera', () => {
    const dir = path.join(process.cwd(), 'src', 'app', '(app)', 'ranking');
    expect(existsSync(path.join(dir, 'loading.tsx'))).toBe(false);
    expect(readFileSync(path.join(dir, 'vista.tsx'), 'utf8')).not.toContain('<h1');
  });

  it('la página lee la vista de la URL y pasa las acciones de las tablas', () => {
    expect(leerVistaRanking({})).toEqual({ ambito: null, formato: 'INDIVIDUAL' });
    expect(leerVistaRanking({ ambito: 'nacional', formato: 'equipos' })).toEqual({ ambito: 'RFEE', formato: 'EQUIPOS' });
    expect(leerVistaRanking({ ambito: ['internacional'], formato: 'x' })).toEqual({ ambito: 'FIE', formato: 'INDIVIDUAL' });
    expect(leerVistaRanking({ ambito: 'europeo' })).toEqual({ ambito: 'EFC', formato: 'INDIVIDUAL' });
    const pagina = readFileSync(path.join(process.cwd(), 'src', 'app', '(app)', 'ranking', 'page.tsx'), 'utf8');
    expect(pagina).toContain('cargarNacional={cargarRankingNacional}');
    expect(pagina).toContain('cargarEuropeo={cargarRankingEuropeo}');
    const consultas = readFileSync(path.join(process.cwd(), 'src', 'app', '(app)', 'ranking', 'consultas.ts'), 'utf8');
    // La acción comprueba la sesión y autoriza el cálculo interno con ella.
    expect(consultas).toMatch(/cargarRankingNacional[\s\S]*?'use server';[\s\S]*?requireProfile\(\)[\s\S]*?armasInternas\(perfil\)/);
  });
});

describe('estado en la URL sin volver al servidor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sin navegador no hace nada', () => {
    expect(() => escribirUrl({ q: 'x' })).not.toThrow();
  });

  it('mezcla, borra y usa replaceState', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/ranking', search: '?arma=FLORETE&jjoo=1', hash: '' },
      history: { replaceState },
    });
    escribirUrl({ jjoo: null, q: 'llavador', ambito: 'nacional' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/ranking?arma=FLORETE&q=llavador&ambito=nacional');
    replaceState.mockClear();
    escribirUrl({ arma: 'FLORETE' });
    expect(replaceState).not.toHaveBeenCalled();
  });
});
