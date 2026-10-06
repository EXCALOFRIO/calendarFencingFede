import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EstadisticasDeportistaVista } from '@/components/explorar/estadisticas-deportista';
import {
  aDetalleEstadistico,
  agruparDesglose,
  segmentosCronologia,
  type FilaAgregadoEstadistico,
} from '@/lib/sport/explorar/estadisticas';
import type { EstadisticasDeportista } from '@/lib/sport/explorar/tipos';

const agregado = (extra: Partial<FilaAgregadoEstadistico> = {}): FilaAgregadoEstadistico => ({
  clase: 'total', tipo: null, categoria: null, categoriaRaw: null, arma: null, genero: null,
  temporada: null, pruebas: 3, clasificaciones: 2, mejorPuesto: 1, podios: 1, victorias: 1,
  sinPuesto: 1, conflictos: 0, sinFecha: 1, desde: '2025-01-01', hasta: '2026-03-01', ...extra,
});

const detalle = () => aDetalleEstadistico([
  agregado(),
  agregado({ clase: 'categoria', tipo: 'CTO_ESPANA', categoria: 'M20', categoriaRaw: 'Junior', arma: 'ESPADA', genero: 'F', pruebas: 2, sinPuesto: 0, sinFecha: 0 }),
  agregado({ clase: 'categoria', tipo: null, categoria: 'VET', categoriaRaw: '+50', arma: 'ESPADA', genero: 'F', pruebas: 1, clasificaciones: 0, mejorPuesto: null, podios: 0, victorias: 0 }),
  agregado({ clase: 'temporada', temporada: '2026', pruebas: 2, clasificaciones: 1 }),
  agregado({ clase: 'temporada', temporada: '2025', pruebas: 1, clasificaciones: 1, sinPuesto: 0, sinFecha: 0, podios: 0, victorias: 0 }),
]);
const pintar = (d: EstadisticasDeportista) =>
  renderToStaticMarkup(React.createElement(EstadisticasDeportistaVista, { detalle: d }));

describe('desglose del historial por categoría', () => {
  it('pinta una tarjeta por categoría normalizada, con pruebas, mejor puesto y podios', () => {
    const html = pintar(detalle());
    expect(html).toContain('Por categoría');
    expect(html).toContain('data-categoria="M20"');
    expect(html).toContain('data-categoria="VET"');
    expect(html).not.toContain('Junior');
    expect(html).not.toContain('+50');
    expect(html.match(/data-categoria=/g)).toHaveLength(2);
    expect(html).toContain('Podios');
    expect(html).not.toMatch(/role="tab"|<details|<select/);
  });

  it('un mejor puesto ausente sale como raya, no como cero', () => {
    const html = pintar(detalle());
    const vet = html.slice(html.indexOf('data-categoria="VET"'));
    expect(vet).toMatch(/Mejor<\/dt><dd[^>]*>—<\/dd>/);
    expect(html).not.toMatch(/>0º</);
  });

  it('agrupa por un solo eje sin duplicar pruebas y conserva el mínimo del mejor puesto', () => {
    const porArma = agruparDesglose(detalle(), 'arma');
    expect(porArma).toHaveLength(1);
    expect(porArma[0]).toMatchObject({ arma: 'ESPADA', pruebas: 3, conPuesto: 2, mejorPuesto: 1, podios: 1 });
    const porTipo = agruparDesglose(detalle(), 'tipo');
    expect(porTipo.map((g) => g.tipo)).toEqual(['CTO_ESPANA', null]);
    expect(porTipo[1].mejorPuesto).toBeNull();
    expect(agruparDesglose(detalle(), 'categoria').map((g) => g.categoria?.codigo)).toEqual(['M20', 'VET']);
  });

  it('dos literales de la misma categoría son una sola tarjeta', () => {
    const d = aDetalleEstadistico([
      agregado(),
      agregado({ clase: 'categoria', tipo: 'TNR', categoria: 'ABS', categoriaRaw: 'Senior', arma: 'FLORETE', genero: 'F', pruebas: 2, mejorPuesto: 5 }),
      agregado({ clase: 'categoria', tipo: 'TNR', categoria: 'ABS', categoriaRaw: 'S', arma: 'FLORETE', genero: 'F', pruebas: 1, mejorPuesto: 2 }),
    ]);
    const grupos = agruparDesglose(d, 'categoria');
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ pruebas: 3, mejorPuesto: 2 });
    expect(grupos[0].categoria).toMatchObject({ codigo: 'ABS', raw: null });
    expect(pintar(d).match(/data-categoria="ABS"/g)).toHaveLength(1);
  });

  it('el contrato de 320 px no fija anchos mínimos ni desborda en horizontal', () => {
    const html = pintar(detalle());
    expect(html).toContain('min-w-0');
    expect(html).not.toMatch(/overflow-x|min-w-\[|width="(?:320|600|800)"/);
    expect(segmentosCronologia(detalle().resumen, 3)).toEqual({ conPuesto: 160, sinPuesto: 80 });
  });

  it('sin pruebas lo dice como ausencia, sin tarjetas vacías', () => {
    const vacio = pintar(aDetalleEstadistico([]));
    expect(vacio).toContain('role="status"');
    expect(vacio).not.toContain('data-categoria');
  });

  it('no añade paquetes de gráficos, estado de cliente propio ni movimiento', () => {
    const ruta = new URL('../src/components/explorar/estadisticas-deportista.tsx', import.meta.url);
    const fuente = readFileSync(ruta, 'utf8');
    expect(fuente).not.toMatch(/use client|useEffect|useState|recharts|chart\.js|animation|animate-/);
  });
});
