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

describe('desglose del historial en pestañas', () => {
  it('pinta las tres pestañas en el HTML del servidor, con categorías publicadas y denominadores', () => {
    const html = pintar(detalle());
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html).toContain('Tipo de torneo');
    expect(html).toContain('Campeonato de España');
    expect(html).toContain('Junior');
    expect(html).toContain('+50');
    expect(html).toContain('Tipo no publicado');
    expect(html).toContain('Espada');
    expect(html).toContain('2 de 3 pruebas importadas');
    expect(html).toContain('1 de 3 pruebas importadas');
    expect(html).toContain('3 de 3 pruebas importadas');
    expect(html).toContain('no una carrera completa');
    expect(html).toContain('Los equipos quedan fuera');
    expect(html).not.toMatch(/<details|<select|bg-gold|text-gold/);
  });

  it('las pestañas cumplen el objetivo táctil y un mejor puesto ausente no se pinta como cero', () => {
    const html = pintar(detalle());
    expect(html.match(/role="tab"[^>]*class="[^"]*min-h-11/g)).toHaveLength(3);
    expect(html).toContain('No publicado');
    expect(html).not.toMatch(/Mejor puesto<\/dt><dd[^>]*><span[^>]*>0º?<\/span>/);
    expect(html).toContain('aria-hidden="true"');
  });

  it('agrupa por un solo eje sin duplicar pruebas y conserva el mínimo del mejor puesto', () => {
    const porArma = agruparDesglose(detalle(), 'arma');
    expect(porArma).toHaveLength(1);
    expect(porArma[0]).toMatchObject({ arma: 'ESPADA', pruebas: 3, conPuesto: 2, mejorPuesto: 1, podios: 1 });
    const porTipo = agruparDesglose(detalle(), 'tipo');
    expect(porTipo.map((g) => g.tipo)).toEqual(['CTO_ESPANA', null]);
    expect(porTipo[1].mejorPuesto).toBeNull();
    expect(agruparDesglose(detalle(), 'categoria').map((g) => g.categoria?.raw)).toEqual(['Junior', '+50']);
  });

  it('el contrato de 320 px envuelve texto y no fija anchos mínimos', () => {
    const html = pintar(detalle());
    expect(html).toContain('break-words');
    expect(html).not.toMatch(/overflow-x|min-w-\[|width="(?:320|600|800)"/);
    expect(segmentosCronologia(detalle().resumen, 3)).toEqual({ conPuesto: 160, sinPuesto: 80 });
  });

  it('indica conflictos y límites visibles, y no pinta métricas vacías como cero participaciones', () => {
    const d = detalle();
    const html = pintar({ ...d, resumen: { ...d.resumen, conflictos: 1 }, categoriasRecortadas: true });
    expect(html).toContain('1 prueba con resultados en conflicto');
    expect(html).toContain('120 grupos');
    const vacio = pintar(aDetalleEstadistico([]));
    expect(vacio).toContain('role="status"');
    expect(vacio).toContain('no equivale a cero participaciones ni a derrotas');
    expect(vacio).not.toContain('role="tab"');
  });

  it('no añade paquetes de gráficos, estado de cliente propio ni movimiento', () => {
    const ruta = new URL('../src/components/explorar/estadisticas-deportista.tsx', import.meta.url);
    const fuente = readFileSync(ruta, 'utf8');
    expect(fuente).not.toMatch(/use client|useEffect|useState|recharts|chart\.js|animation|animate-/);
    expect(fuente).toContain("from '@/components/ui/tabs'");
    expect(fuente).toContain('forceMount');
  });
});
