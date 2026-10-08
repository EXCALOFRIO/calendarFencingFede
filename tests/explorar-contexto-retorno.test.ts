import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HistorialVista } from '@/lib/sport/explorar/ficha-pantalla';
import {
  construirUrlFicha,
  leerCriteriosFicha,
  rutaFichaConRetorno,
  sanitizarRetorno,
} from '@/lib/sport/explorar/ficha-url';
import {
  CRITERIOS_VACIOS,
  construirUrl,
  construirUrlBuscar,
  leerCriterios,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { UUID_A } from './helpers/explorar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/explorar',
}));

const { ListaDeportistas } = await import('@/components/explorar/resultados');
const { HistorialFicha, VolverAExplorar } = await import(
  '@/components/explorar/ficha-deportiva'
);

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);
const criterios = (parcial: Partial<CriteriosExplorar>): CriteriosExplorar => ({
  ...CRITERIOS_VACIOS,
  ...parcial,
});

const resumen = {
  id: UUID_A,
  nombre: 'Lucía García',
  alias: null,
  pais: 'ESP',
  genero: 'F' as const,
  anioNacimiento: 2001,
  resultadosImportados: 3,
  armas: ['FLORETE' as const],
  mismoNombre: 1,
};

const itemHistorial = {
  id: '00000000-0000-4000-8000-000000000001',
  puesto: 2,
  puestoPublicado: null,
  puntosOficiales: null,
  fuente: 'fie',
  enlace: null,
  torneo: { id: 'e1', nombre: 'COPA', ciudad: null, pais: 'ESP' },
  tipoDocumentado: null,
  prueba: { id: 'c1', arma: 'ESPADA', genero: 'F', categoria: { codigo: 'ABS', raw: null }, formato: 'INDIVIDUAL' },
  temporada: '2026',
  fecha: null,
} as never;

const decodificar = (href: string): string | null => {
  const m = /[?&]volver=([^&"#]*)/.exec(href);
  return m ? decodeURIComponent(m[1]) : null;
};

describe('fila de Explorar → URL de ficha → enlace de retorno', () => {
  const lista = (c: CriteriosExplorar, cursorActual?: string) =>
    html(
      React.createElement(ListaDeportistas, {
        items: [resumen],
        siguiente: 'tok-2',
        cursorActual,
        criterios: c,
      }),
    );

  it('la fila lleva la búsqueda exacta (filtros y página) como retorno local', () => {
    const c = criterios({ q: 'garcia', arma: 'SABLE', nacionalidad: 'ESP' });
    const salida = lista(c, 'tok-1');
    const href = new RegExp(`href="(/explorar/${UUID_A}[^"]*)"`).exec(salida)?.[1]?.replaceAll('&amp;', '&');
    expect(href).toBeTruthy();
    expect(href?.startsWith(`/explorar/${UUID_A}?volver=`)).toBe(true);
    // La forma de la lista (`/explorar?…`) se guarda ya como Tiradores: volver no pasa por la redirección.
    expect(decodificar(href as string)).toBe(construirUrlBuscar(c, 'tok-1'));
  });

  it('la ficha abierta desde esa fila vuelve a los mismos filtros, cursor y página', () => {
    const c = criterios({ q: 'garcia', torneo: 'Madrid', desde: '2025-01-01' });
    const salida = lista(c, 'tok-1');
    const href = new RegExp(`href="(/explorar/${UUID_A}[^"]*)"`).exec(salida)?.[1]?.replaceAll('&amp;', '&') as string;
    const leidos = leerCriteriosFicha(Object.fromEntries(new URL(href, 'http://x.test').searchParams));
    expect(leidos.volver).toBe(construirUrlBuscar(c, 'tok-1'));
    const volver = html(React.createElement(VolverAExplorar, { volver: leidos.volver }));
    expect(volver).toContain(`href="${construirUrlBuscar(c, 'tok-1').replaceAll('&', '&amp;')}"`);
    expect(volver).not.toContain('href="/explorar"');
  });

  it('en la primera página el retorno no lleva cursor', () => {
    const salida = lista(criterios({ q: 'garcia' }));
    const href = new RegExp(`href="(/explorar/${UUID_A}[^"]*)"`).exec(salida)?.[1]?.replaceAll('&amp;', '&') as string;
    expect(decodificar(href)).toBe('/explorar/buscar?q=garcia');
  });
});

describe('sanitización del retorno local', () => {
  it('acepta sólo búsquedas de Explorar y las reconstruye con claves conocidas en /explorar/buscar', () => {
    expect(sanitizarRetorno('/explorar?q=garcia&cursor=abc')).toBe('/explorar/buscar?q=garcia&cursor=abc');
    expect(sanitizarRetorno('/explorar?q=a&desconocido=1&arma=sable')).toBe('/explorar/buscar?q=a&arma=SABLE');
    expect(sanitizarRetorno('/explorar/buscar?q=garcia&cursor=abc')).toBe('/explorar/buscar?q=garcia&cursor=abc');
    expect(sanitizarRetorno('/explorar/buscar?q=a&desconocido=1&arma=sable')).toBe('/explorar/buscar?q=a&arma=SABLE');
    expect(sanitizarRetorno('/explorar/buscar')).toBe('/explorar/buscar');
    expect(sanitizarRetorno('/explorar/buscar?ver=paises&q=ita&x=1')).toBe('/explorar/buscar?ver=paises&q=ita');
    // `/explorar` a secas es «Para ti», no Tiradores.
    expect(sanitizarRetorno('/explorar')).toBe('/explorar');
  });

  it('VolverAExplorar lleva a Tiradores sin pasar por la redirección de /explorar?q=', () => {
    const salida = html(React.createElement(VolverAExplorar, { volver: '/explorar?q=ana' }));
    expect(salida).toContain('href="/explorar/buscar?q=ana"');
    expect(html(React.createElement(VolverAExplorar, { volver: '/explorar/buscar?q=ana' }))).toContain(
      'href="/explorar/buscar?q=ana"',
    );
  });

  it.each([
    ['vacío', ''],
    ['sitio externo', 'https://malicioso.example/explorar'],
    ['esquema relativo', '//malicioso.example/explorar'],
    ['barra invertida', '/\\malicioso.example'],
    ['barra invertida tras ruta', '/explorar\\..\\x'],
    ['esquema peligroso', 'javascript:alert(1)'],
    ['data', 'data:text/html,x'],
    ['otra ruta local', '/perfil'],
    ['subruta', '/explorar/otra'],
    ['subruta de Tiradores', '/explorar/buscar/x'],
    ['prefijo parecido', '/explorarx?q=a'],
    ['prefijo parecido de Tiradores', '/explorar/buscarx?q=a'],
    ['Tiradores con esquema relativo', '//explorar/buscar?q=a'],
    ['fragmento', '/explorar#x'],
    ['salto de línea', '/explorar?q=a\nSet-Cookie: x'],
    ['longitud excesiva', `/explorar?q=${'a'.repeat(5000)}`],
  ])('descarta: %s', (_motivo, valor) => {
    expect(sanitizarRetorno(valor)).toBe('');
  });

  it('un valor repetido no puede colar un destino externo', () => {
    expect(leerCriteriosFicha({ volver: ['/explorar?q=a', 'https://malicioso.example'] }).volver).toBe(
      '/explorar/buscar?q=a',
    );
    expect(leerCriteriosFicha({ volver: ['https://malicioso.example', '/explorar?q=a'] }).volver).toBe('');
  });

  it('la entrada directa no tiene retorno y vuelve a /explorar', () => {
    expect(leerCriteriosFicha({}).volver).toBe('');
    const directo = html(React.createElement(VolverAExplorar, { volver: '' }));
    expect(directo).toContain('href="/explorar"');
    const malo = html(React.createElement(VolverAExplorar, { volver: 'https://malicioso.example' }));
    expect(malo).toContain('href="/explorar"');
    expect(malo).not.toContain('malicioso');
  });

  it('Explorar sin criterios no añade ruido a la ficha', () => {
    expect(rutaFichaConRetorno(UUID_A, '/explorar')).toBe(`/explorar/${UUID_A}`);
    expect(rutaFichaConRetorno(UUID_A, 'https://malicioso.example')).toBe(`/explorar/${UUID_A}`);
  });

  it('el retorno vuelve a leerse igual que Explorar lo leería', () => {
    const c = criterios({ q: 'garcía ñ', ambito: 'NACIONAL' });
    const url = construirUrl(c, 'tok');
    const { criterios: leidos, cursor } = leerCriterios(Object.fromEntries(new URL(url, 'http://x.test').searchParams));
    expect(construirUrlBuscar(leidos, cursor)).toBe(sanitizarRetorno(url));
    expect(sanitizarRetorno(construirUrlBuscar(c, 'tok'))).toBe(sanitizarRetorno(url));
  });
});

describe('cambio de modalidad y enlaces de ficha conservan el contexto', () => {
  it('la paginación del historial conserva ranking, modalidad y retorno', () => {
    const historial: HistorialVista = { tipo: 'ok', items: [itemHistorial], siguiente: 'tok-2', sinResultados: false };
    const volver = '/explorar?q=garcia';
    const salida = html(
      React.createElement(HistorialFicha, {
        historial,
        base: '/explorar/x',
        nivel: 'pagina',
        criterios: { ranking: '2024', formato: 'EQUIPOS', cursor: 'tok-1', volver },
      }),
    );
    const codificado = 'volver=%2Fexplorar%3Fq%3Dgarcia';
    expect(salida).toContain(`href="/explorar/x?ranking=2024&amp;formato=EQUIPOS&amp;${codificado}#historial"`);
    expect(salida).toContain(`ranking=2024&amp;formato=EQUIPOS&amp;cursor=tok-2&amp;${codificado}#historial`);
  });

  it('construirUrlFicha sólo añade el retorno cuando existe', () => {
    expect(construirUrlFicha('/explorar/x', { ranking: '2024' })).toBe('/explorar/x?ranking=2024');
    expect(construirUrlFicha('/explorar/x', { volver: '/explorar?q=a' })).toBe(
      '/explorar/x?volver=%2Fexplorar%3Fq%3Da',
    );
  });
});

describe('la ruta de la ficha usa el retorno sin tocar la política de acceso', () => {
  it('deja la vuelta a la flecha global de la cabecera y no sustituye el botón Atrás del navegador', () => {
    for (const r of ['layout.tsx', 'page.tsx']) {
      const fuente = readFileSync(`src/app/(app)/explorar/[personaId]/(perfil)/${r}`, 'utf8');
      expect(fuente).not.toContain('<VolverAExplorar');
      expect(fuente).not.toMatch(/history\.back|router\.back|'use client'/);
    }
    const datos = readFileSync('src/app/(app)/explorar/[personaId]/(perfil)/datos.ts', 'utf8');
    expect(datos).toMatch(/exigirSesion[\s\S]*redirect\('\/entrar'\)/);
    for (const r of ['layout.tsx', 'page.tsx', 'estadisticas/page.tsx', 'rivales/page.tsx', 'curiosidades/page.tsx', 'ranking/page.tsx']) {
      const fuente = readFileSync(`src/app/(app)/explorar/[personaId]/(perfil)/${r}`, 'utf8');
      const guarda = fuente.indexOf('await exigirSesion()');
      const lectura = fuente.search(/(cabeceraPerfil|fichaPerfil|extrasPerfil|favoritoPerfil|cargar\w+Compartid\w*)\(/);
      expect(guarda, r).toBeGreaterThan(-1);
      if (lectura > -1) expect(guarda, r).toBeLessThan(lectura);
    }
  });
});
