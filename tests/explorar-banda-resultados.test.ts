import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UUID_A, UUID_B } from './helpers/explorar';

vi.mock('@/app/(app)/explorar/resultados-evento', () => ({ resultadosDelEvento: vi.fn() }));

const { BandaResultados, CuerpoResultados } = await import('@/components/calendario/banda-resultados');
const { EnlaceVolverAEdicion } = await import('@/components/explorar/ediciones');

/**
 * Banda «Resultados» de la ficha del calendario. Render estático de cada vista:
 * no hay navegador autenticado ni lectura real.
 */

const GUID = '0a1b2c3d-1111-4222-8333-444455556666';
const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

const edicion = {
  id: UUID_A,
  nombre: 'Jeux Olympiques Paris 2024',
  temporada: '2024',
  fuente: 'fie',
  ciudad: 'Paris',
  pais: 'FRA',
  inicio: '2024-07-27',
  fin: null,
  pruebas: 1,
  armas: ['ESPADA' as const],
  formatos: ['INDIVIDUAL' as const],
  serie: 'juegos_olimpicos' as const,
  pruebasDetalle: [
    {
      id: UUID_B,
      arma: 'ESPADA' as const,
      genero: 'F' as const,
      categoria: { codigo: 'ABS', raw: 'Senior' },
      formato: 'INDIVIDUAL' as const,
      fecha: null,
      fuente: 'fie',
      pruebaCalendarioId: null,
      resultados: { estado: 'parcial' as const, importados: 4 },
      enlaces: [
        {
          proveedor: 'ftl' as const,
          tipo: 'solo_enlace' as const,
          url: `https://www.fencingtimelive.com/events/results/${GUID}`,
        },
      ],
    },
  ],
};

describe('banda de resultados del calendario', () => {
  it('la ficha no espera: el primer render es un estado de lectura, no «sin resultados»', () => {
    const marcado = html(React.createElement(BandaResultados, { eventoId: UUID_A }));
    expect(marcado).toContain('Resultados');
    expect(marcado).toContain('Leyendo resultados');
    expect(marcado).not.toMatch(/no tiene todavía una edición/);
  });

  it('cada vista sin datos tiene su propio texto y el error nunca se lee como vacío', () => {
    const vistas = ['sin_sesion', 'no_disponible', 'entrada_invalida', 'error'] as const;
    const textos = vistas.map((tipo) => html(React.createElement(CuerpoResultados, { vista: { tipo } })));
    const vacio = html(React.createElement(CuerpoResultados, { vista: { tipo: 'ok', ediciones: [] } }));
    const fallo = html(React.createElement(CuerpoResultados, { vista: 'fallo' }));
    expect(new Set([...textos, vacio]).size).toBe(5);
    expect(vacio).toMatch(/no tiene todavía una edición deportiva vinculada/);
    expect(textos[3]).toMatch(/Que no se vean no significa que no existan/);
    expect(fallo).toBe(textos[3]);
    expect(textos[3]).toContain('role="alert"');
  });

  it('con edición vinculada enlaza a la edición, a la clasificación y a Explorar de la prueba', () => {
    const marcado = html(
      React.createElement(CuerpoResultados, { vista: { tipo: 'ok', ediciones: [edicion] } }),
    );
    expect(marcado).toContain(`href="/explorar/ediciones/${UUID_A}"`);
    expect(marcado).toContain(`href="/explorar/ediciones/${UUID_A}?prueba=${UUID_B}"`);
    expect(marcado).toContain(`edicionId=${UUID_A}`);
    expect(marcado).toContain('formato=INDIVIDUAL');
    expect(marcado).toContain('categoriaRaw=Senior');
  });

  it('un resultado parcial y un enlace de Fencing Time Live no se presentan como importación completa', () => {
    const marcado = html(
      React.createElement(CuerpoResultados, { vista: { tipo: 'ok', ediciones: [edicion] } }),
    );
    expect(marcado).toContain('Clasificación parcial');
    expect(marcado).not.toContain('Clasificación importada');
    expect(marcado).toContain('Seguir el torneo en Fencing Time Live');
    expect(marcado).toMatch(/exige cuenta/);
  });

  it('una edición sin pruebas lo dice sin inventarlas', () => {
    const marcado = html(
      React.createElement(CuerpoResultados, {
        vista: { tipo: 'ok', ediciones: [{ ...edicion, pruebasDetalle: [] }] },
      }),
    );
    expect(marcado).toMatch(/todavía no tiene pruebas importadas/);
  });
});

describe('vuelta desde Explorar a la edición', () => {
  it('Explorar acotado a una edición ofrece volver a su clasificación', () => {
    const marcado = html(React.createElement(EnlaceVolverAEdicion, { edicionId: UUID_A }));
    expect(marcado).toContain(`href="/explorar/ediciones/${UUID_A}"`);
  });
});
