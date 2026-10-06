import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  RUTA_CALENDARIO,
  construirUrlCalendario,
  leerContextoCalendario,
  sanitizarRetornoCalendario,
  type ContextoCalendario,
} from '@/lib/calendario/contexto-url';
import {
  construirUrlEdicion,
  leerCriteriosEdicion,
  sanitizarRetornoEdicion,
} from '@/lib/sport/explorar/edicion-url';
import { leerCriteriosFicha, rutaFichaConRetorno, sanitizarRetorno } from '@/lib/sport/explorar/ficha-url';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));

const { ClasificacionDePrueba, EdicionCompleta, PruebasDeEdicion } = await import('@/components/explorar/ediciones');
const { VolverAExplorar } = await import('@/components/explorar/ficha-deportiva');
const { CuerpoResultados } = await import('@/components/calendario/banda-resultados');

/**
 * El calendario guarda su estado en el cliente: sin una referencia en la URL,
 * recorrer torneo → prueba → persona → favorito → atrás devolvía el calendario
 * por defecto. Todo puro o renderizado estático: ni sesión ni base de datos.
 */

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);
const escapado = (texto: string) => texto.replace(/&/g, '&amp;');

const CONTEXTO: ContextoCalendario = {
  vista: 'mes',
  mes: '2026-11',
  ambito: 'INTERNACIONAL',
  armas: ['ESPADA', 'FLORETE'],
  generos: ['F'],
  categorias: ['ABS', 'M17'],
  busqueda: 'copa mundo',
  tiradorId: UUID_C,
};

const resumen = {
  id: UUID_A,
  nombre: 'Jeux Olympiques Paris 2024',
  temporada: '2024',
  fuente: 'fie',
  ciudad: 'Paris',
  pais: 'FRA',
  inicio: '2024-07-27',
  fin: '2024-08-04',
  pruebas: 1,
  armas: ['ESPADA' as const],
  formatos: ['INDIVIDUAL' as const],
  serie: 'juegos_olimpicos' as const,
};

const prueba = {
  id: UUID_B,
  arma: 'ESPADA' as const,
  genero: 'F' as const,
  categoria: { codigo: 'ABS', raw: 'Senior' },
  formato: 'INDIVIDUAL' as const,
  fecha: '2024-07-28',
  fuente: 'fie',
  pruebaCalendarioId: null,
  resultados: { estado: 'completo' as const, importados: 2 },
  enlaces: [],
};

describe('contexto del calendario en la URL', () => {
  it('construye y lee de vuelta periodo, ámbito, arma, género, categoría, búsqueda y tirador', () => {
    const url = construirUrlCalendario(CONTEXTO);
    expect(url.startsWith(`${RUTA_CALENDARIO}?`)).toBe(true);
    const consulta = Object.fromEntries(new URL(url, 'http://x').searchParams);
    expect(leerContextoCalendario(consulta)).toEqual(CONTEXTO);
  });

  it('sin nada que recordar es la ruta desnuda y «todo» no se escribe', () => {
    expect(construirUrlCalendario({})).toBe(RUTA_CALENDARIO);
    expect(construirUrlCalendario({ ambito: 'TODO' })).toBe(RUTA_CALENDARIO);
    expect(leerContextoCalendario({})).toEqual({});
  });

  it('cada valor se valida por separado y lo que no se entiende se descarta sin tirar el resto', () => {
    const leido = leerContextoCalendario({
      vista: 'año',
      mes: '2026-13',
      ambito: 'GALAXIA',
      armas: 'ESPADA,LASER,espada',
      generos: 'X',
      categorias: 'ABS,<script>,M17',
      q: 'x'.repeat(500),
      tirador: 'no-es-id',
    });
    expect(leido.vista).toBeUndefined();
    expect(leido.mes).toBeUndefined();
    expect(leido.ambito).toBeUndefined();
    expect(leido.armas).toEqual(['ESPADA']);
    expect(leido.generos).toBeUndefined();
    expect(leido.categorias).toEqual(['ABS', 'M17']);
    expect(leido.busqueda).toHaveLength(60);
    expect(leido.tiradorId).toBeUndefined();
  });

  it('una selección vacía escrita a propósito se conserva y no se confunde con basura', () => {
    const url = construirUrlCalendario({ armas: [], generos: ['M'] });
    const consulta = Object.fromEntries(new URL(url, 'http://x').searchParams);
    expect(leerContextoCalendario(consulta)).toMatchObject({ armas: [], generos: ['M'] });
  });

  it('la referencia está acotada: pocas categorías, búsqueda corta y una URL de longitud máxima', () => {
    const muchas = Array.from({ length: 80 }, (_, i) => `C${i}`);
    const url = construirUrlCalendario({ ...CONTEXTO, categorias: muchas, busqueda: 'ñ'.repeat(400) });
    expect(url.length).toBeLessThanOrEqual(700);
    expect(leerContextoCalendario(Object.fromEntries(new URL(url, 'http://x').searchParams)).categorias).toHaveLength(20);
  });

  it('sanitizarRetornoCalendario sólo acepta la raíz y la reconstruye con claves conocidas', () => {
    expect(sanitizarRetornoCalendario(RUTA_CALENDARIO)).toBe(RUTA_CALENDARIO);
    expect(sanitizarRetornoCalendario(`/?mes=2026-11&vista=mes&desconocido=1&ambito=NACIONAL`)).toBe(
      '/?vista=mes&mes=2026-11&ambito=NACIONAL',
    );
    for (const malo of [
      '',
      '/perfil',
      '/explorar?mes=2026-11',
      '//evil.example/',
      'https://evil.example/?mes=2026-11',
      'javascript:alert(1)',
      '/\\evil.example',
      '/?mes=2026-11\n',
      `/?q=${'a'.repeat(800)}`,
      '/#fragmento',
    ]) {
      expect(sanitizarRetornoCalendario(malo), malo).toBe('');
    }
  });
});

describe('el origen del calendario recorre edición → persona → favorito → volver', () => {
  const origen = construirUrlCalendario(CONTEXTO);

  it('la URL de edición lleva el origen y lo recupera acotado; un origen ajeno se descarta', () => {
    const url = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'c1', origen });
    const consulta = Object.fromEntries(new URL(url, 'http://x').searchParams);
    expect(leerCriteriosEdicion(consulta)).toEqual({ prueba: UUID_B, cursor: 'c1', origen });
    expect(leerCriteriosEdicion({ prueba: UUID_B, origen: 'https://evil.example/' }).origen).toBeUndefined();
    expect(leerCriteriosEdicion({ prueba: UUID_B, origen: '/perfil' }).origen).toBeUndefined();
    expect(sanitizarRetornoEdicion(url)).toBe(url);
  });

  it('cambiar de página o de prueba no pierde el origen', () => {
    const marcado = html(
      React.createElement(ClasificacionDePrueba, {
        edicion: resumen,
        prueba,
        criterios: { prueba: UUID_B, cursor: 'c0', origen },
        clasificacion: {
          pruebaId: UUID_B,
          fuente: 'fie',
          siguiente: 'c2',
          otrasFuentes: [],
          filas: [
            { id: 'r1', puesto: 1, puestoPublicado: null, nombre: 'Ana', pais: 'ESP', club: null, personaId: UUID_C },
          ],
        },
      }),
    );
    const siguiente = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'c2', origen });
    const principio = construirUrlEdicion(UUID_A, { prueba: UUID_B, origen });
    expect(marcado).toContain(`href="${escapado(siguiente)}"`);
    expect(marcado).toContain(`href="${escapado(principio)}"`);
    const volver = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'c0', origen, persona: UUID_C });
    expect(marcado).toContain(escapado(`/explorar/${UUID_C}?volver=${encodeURIComponent(volver)}`));
  });

  it('los botones del selector de prueba conservan el origen', () => {
    const equipos = { ...prueba, id: UUID_C, formato: 'EQUIPOS' as const };
    const marcado = html(
      React.createElement(PruebasDeEdicion, {
        edicion: { ...resumen, pruebasDetalle: [prueba, equipos], pruebaDesconocida: false, clasificacion: null },
        seleccionada: UUID_B,
        origen,
      }),
    );
    expect(marcado).toContain(`href="${escapado(construirUrlEdicion(UUID_A, { prueba: UUID_B, origen }))}"`);
    expect(marcado).toContain(`href="${escapado(construirUrlEdicion(UUID_A, { prueba: UUID_C, origen }))}"`);
  });

  it('la ficha vuelve a la edición con el origen intacto, y la edición lo conserva sin enlaces de vuelta propios', () => {
    const edicionUrl = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'c0', origen });
    const ruta = rutaFichaConRetorno(UUID_C, edicionUrl);
    const consulta = Object.fromEntries(new URL(ruta, 'http://x').searchParams);
    const { volver } = leerCriteriosFicha(consulta);
    expect(volver).toBe(edicionUrl);
    expect(sanitizarRetorno(volver)).toBe(edicionUrl);

    const enlaceFicha = html(React.createElement(VolverAExplorar, { volver }));
    expect(enlaceFicha).toContain(`href="${escapado(edicionUrl)}"`);
    expect(enlaceFicha).toContain('Volver a la edición');

    const criterios = leerCriteriosEdicion(Object.fromEntries(new URL(volver, 'http://x').searchParams));
    const pagina = html(
      React.createElement(EdicionCompleta, {
        edicion: { ...resumen, pruebasDetalle: [prueba], pruebaDesconocida: false, clasificacion: null },
        criterios,
      }),
    );
    // Volver es la flecha de la cabecera: la página no repite enlaces de vuelta.
    expect(pagina).not.toContain('Volver a');
    expect(leerContextoCalendario(Object.fromEntries(new URL(criterios.origen ?? '', 'http://x').searchParams))).toEqual(
      CONTEXTO,
    );
  });

  it('sin origen la edición no inventa un retorno al calendario', () => {
    const pagina = html(
      React.createElement(EdicionCompleta, {
        edicion: { ...resumen, pruebasDetalle: [prueba], pruebaDesconocida: false, clasificacion: null },
        criterios: { prueba: '', cursor: '' },
      }),
    );
    expect(pagina).not.toContain('Volver a');
  });

  it('la ficha acepta como retorno una edición con origen de calendario incluso con prueba y cursor largos', () => {
    const edicionUrl = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'k'.repeat(300), origen });
    expect(sanitizarRetorno(edicionUrl)).toBe(edicionUrl);

    const peor = construirUrlCalendario({ ...CONTEXTO, busqueda: 'ñ'.repeat(60) });
    const peorUrl = construirUrlEdicion(UUID_A, { prueba: UUID_B, cursor: 'k'.repeat(600), origen: peor });
    expect(sanitizarRetorno(peorUrl)).toBe(peorUrl);
  });
});

describe('el calendario recuerda y recupera su contexto', () => {
  const leerFuente = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

  it('la vista reabre con el contexto recibido y la ficha del torneo lo lleva a sus resultados', () => {
    const vista = leerFuente('src/components/calendario/vista.tsx');
    expect(vista).toMatch(/inicial\?\.vista/);
    expect(vista).toMatch(/inicial\.mes\.split/);
    expect(vista).toMatch(/construirUrlCalendario\(\{/);
    expect(vista).toMatch(/retornoCalendario=\{retornoCalendario\}/);
    expect(leerFuente('src/components/calendario/ficha-evento.tsx')).toMatch(
      /<ResultadosTorneo\s+eventoId=\{evento\.id\}\s+retorno=\{retornoCalendario\}/,
    );
    const pagina = leerFuente('src/app/(app)/page.tsx');
    expect(pagina.indexOf('requireProfile()')).toBeLessThan(pagina.indexOf('leerContextoCalendario('));
  });

  it('recordar el contexto no añade la ficha abierta: volver no obliga a reabrir el torneo', () => {
    const url = construirUrlCalendario(CONTEXTO);
    expect(new URL(url, 'http://x').searchParams.has('evento')).toBe(false);
    expect(Object.keys(leerContextoCalendario({ evento: UUID_A, mes: '2026-11' }))).toEqual(['mes']);
  });
});

describe('banda de resultados del calendario', () => {
  const origen = construirUrlCalendario(CONTEXTO);
  const vista = { tipo: 'ok' as const, ediciones: [{ ...resumen, pruebasDetalle: [prueba] }] };

  it('los enlaces a la edición y a su clasificación llevan el origen del calendario', () => {
    const marcado = html(React.createElement(CuerpoResultados, { vista, retorno: origen }));
    expect(marcado).toContain(`href="${escapado(construirUrlEdicion(UUID_A, { origen }))}"`);
    expect(marcado).toContain(`href="${escapado(construirUrlEdicion(UUID_A, { prueba: UUID_B, origen }))}"`);
  });

  it('sin referencia los enlaces son los de siempre', () => {
    const marcado = html(React.createElement(CuerpoResultados, { vista }));
    expect(marcado).toContain(`href="/explorar/ediciones/${UUID_A}"`);
    expect(marcado).toContain(`href="/explorar/ediciones/${UUID_A}?prueba=${UUID_B}"`);
  });

  it('un origen que no es del calendario no viaja en los enlaces', () => {
    const marcado = html(
      React.createElement(CuerpoResultados, { vista, retorno: 'https://evil.example/?mes=2026-11' }),
    );
    expect(marcado).not.toContain('evil.example');
    expect(marcado).not.toContain('origen=');
  });
});
