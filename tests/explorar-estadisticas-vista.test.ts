import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EstadisticasDeportistaVista } from '@/components/explorar/estadisticas-deportista';
import { aDetalleEstadistico, segmentosCronologia, type FilaAgregadoEstadistico } from '@/lib/sport/explorar/estadisticas';
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

describe('estadísticas accesibles y móvil primero', () => {
  it('muestra cifras grandes, categorías publicadas, denominadores y metodología sin submenús', () => {
    const html = pintar(detalle());
    expect(html).toContain('text-5xl');
    expect(html).toContain('Campeonato de España');
    expect(html).toContain('Junior');
    expect(html).toContain('+50');
    expect(html).toContain('Tipo no publicado');
    expect(html).toContain('de 2 puestos numéricos');
    expect(html).toContain('2 de 3 pruebas importadas');
    expect(html).toContain('1 de 3 pruebas importadas');
    expect(html).toContain('no una carrera completa');
    expect(html).toContain('no siguen la temporada ni la modalidad del ranking');
    expect(html).toContain('Los equipos quedan fuera');
    expect(html).not.toMatch(/<details|<select|role="tab"|bg-gold|text-gold/);
  });

  it('expone todos los valores sin hover, oculta sólo SVG decorativo y no presenta puesto cero', () => {
    const html = pintar(detalle());
    expect(html).toContain('aria-label="Clasificaciones individuales por temporada"');
    expect(html).toContain('2 pruebas</strong>, 1 con puesto, 1 sin puesto');
    expect(html).toContain('aria-hidden="true" focusable="false"');
    expect(html).toContain('Relleno: con puesto; trama: sin puesto');
    expect(html).toContain('Mejor puesto');
    expect(html).toContain('No publicado');
    expect(html).not.toMatch(/tooltip|<title/);
    // Cero podios es un conteo válido; un «mejor puesto 0» sería inventado.
    expect(html).not.toMatch(/Mejor puesto<\/dt><dd><span[^>]*>0<\/span>/);
    expect(html.indexOf('FIE 2025')).toBeLessThan(html.indexOf('FIE 2026'));
  });

  it('el contrato de 320 px usa viewBox fluido, dos columnas y texto envolvente, sin anchos mínimos de gráfico', () => {
    const html = pintar(detalle());
    expect(html).toContain('viewBox="0 0 240 18"');
    expect(html).toContain('w-full min-w-0');
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('break-words');
    expect(html).not.toMatch(/overflow-x|whitespace-nowrap|min-w-\[|width="(?:320|600|800)"/);
    const barras = segmentosCronologia(detalle().resumen, 3);
    expect(barras).toEqual({ conPuesto: 160, sinPuesto: 80 });
    expect(segmentosCronologia({ ...detalle().resumen, conPuesto: 0, sinPuesto: 0 }, 0))
      .toEqual({ conPuesto: 0, sinPuesto: 0 });
  });

  it('las tramas tienen IDs únicos cuando se renderizan dos fichas en la misma página', () => {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(EstadisticasDeportistaVista, { detalle: detalle() }),
      React.createElement(EstadisticasDeportistaVista, { detalle: detalle() }),
    ));
    const ids = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('indica conflictos y límites visibles, y no pinta métricas vacías como cero participaciones', () => {
    const d = detalle();
    const html = pintar({ ...d, resumen: { ...d.resumen, conflictos: 1 }, categoriasRecortadas: true, temporadasRecortadas: true });
    expect(html).toContain('1 prueba con resultados en conflicto');
    expect(html).toContain('120 grupos');
    expect(html).toContain('24 temporadas');
    const vacio = pintar(aDetalleEstadistico([]));
    expect(vacio).toContain('role="status"');
    expect(vacio).toContain('no equivale a cero participaciones ni a derrotas');
    expect(vacio).not.toContain('<svg');
  });

  it('no añade paquetes de gráficos, estado de cliente ni movimiento', () => {
    const ruta = new URL('../src/components/explorar/estadisticas-deportista.tsx', import.meta.url);
    const fuente = readFileSync(ruta, 'utf8');
    expect(fuente).not.toMatch(/use client|useEffect|useState|recharts|chart\.js|animation|animate-/);
    expect(fuente).toContain('useId');
  });
});
