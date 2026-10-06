import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BurbujaOlimpica, ContenidoBurbujaOlimpica } from '@/components/olimpica/burbuja-olimpica';
import { FiltroOlimpico } from '@/components/olimpica/filtro-olimpico';
import { InsigniaOlimpica } from '@/components/olimpica/insignia-olimpica';
import type { AnotacionOlimpica } from '@/lib/ranking/olimpica';

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

function anot(parcial: Partial<AnotacionOlimpica>): AnotacionOlimpica {
  return {
    estado: null,
    camino: null,
    zona: null,
    contra: null,
    faltan: null,
    margen: null,
    sobre: null,
    puestoFuera: null,
    motivo: null,
    sinVeto: null,
    ...parcial,
  };
}

const CLASIFICADO = anot({
  estado: 'clasificado',
  camino: 'EQUIPO_ZONA',
  zona: 'EUROPA',
  margen: 12.5,
  sobre: { noc: 'POL', nombre: null, posicion: 9, puntos: 320 },
});

const CERCA = anot({
  estado: 'cerca',
  camino: 'AOR_ZONA',
  zona: 'EUROPA',
  contra: { noc: 'ISR', nombre: 'FREILICH Yuval', posicion: 6, puntos: 225 },
  faltan: 30,
  margen: 4,
  sobre: { noc: 'GER', nombre: 'HEINE Lukas', posicion: 14, puntos: 191 },
  puestoFuera: 2,
});

const PENDIENTE = anot({
  estado: 'pendiente',
  motivo: 'PARTICIPACION_SIN_DECIDIR',
  sinVeto: { estado: 'clasificado', camino: 'EQUIPO_TOP', zona: null },
});

const FECHA = '2026-10-01T06:00:00.000Z';

describe('InsigniaOlimpica', () => {
  it('siempre dorada; el estado lo dice el icono: ✓, los puntos o un reloj; etiqueta accesible', () => {
    const v = html(h(InsigniaOlimpica, { anotacion: CLASIFICADO }));
    expect(v).toContain('data-olimpica="clasificado"');
    expect(v).toContain('text-gold');
    expect(v).toContain('lucide-check');
    expect(v).toContain('role="img"');
    expect(v).toContain('aria-label="JJOO LA 2028: clasificado, Equipo de Europa"');
    expect(v).toContain('data-icono="laurel"');

    const a = html(h(InsigniaOlimpica, { anotacion: CERCA }));
    expect(a).toContain('text-gold');
    expect(a).not.toContain('text-warn');
    expect(a).toContain('−30');
    expect(a).toContain('a 30 puntos');

    const g = html(h(InsigniaOlimpica, { anotacion: PENDIENTE }));
    expect(g).toContain('text-gold');
    expect(g).toContain('lucide-clock');
    expect(g).toContain('Participación sin decidir');
  });

  it('sin estado no pinta nada; nunca los anillos ni «Mundial»', () => {
    expect(html(h(InsigniaOlimpica, { anotacion: anot({ camino: 'TORNEO_ZONAL' }) }))).toBe('');
    expect(html(h(InsigniaOlimpica, { anotacion: null }))).toBe('');
    expect(html(h(InsigniaOlimpica, { anotacion: CERCA }))).not.toContain('Mundial');
  });
});

describe('ContenidoBurbujaOlimpica', () => {
  it('clasificado: vía, margen y fecha provisional', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: CLASIFICADO, fechaRanking: FECHA }));
    expect(o).toContain('Clasificado');
    expect(o).toContain('Equipo de Europa');
    expect(o).toContain('+12,5');
    expect(o).toContain('POL');
    expect(o).toContain('Provisional');
    expect(o).toContain(`dateTime="${FECHA}"`);
    expect(o).not.toMatch(/<p[\s>]/);
  });

  it('cerca: rival, puntos que faltan y margen', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: CERCA, fechaRanking: FECHA }));
    expect(o).toContain('Mejor de Europa');
    expect(o).toContain('Rival');
    expect(o).toContain('FREILICH Yuval');
    expect(o).toContain('Faltan');
    expect(o).toContain('>30<');
    expect(o).toContain('+4');
    expect(o).toContain('HEINE Lukas');
  });

  it('pendiente: motivo y qué tendría si contara, sin vía ni rival', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: PENDIENTE, fechaRanking: null }));
    expect(o).toContain('Pendiente');
    expect(o).toContain('Participación sin decidir');
    expect(o).toContain('Si contara');
    expect(o).toContain('Top 4 equipos');
    expect(o).not.toContain('Rival');
    expect(o).not.toContain('<time');
  });
});

describe('BurbujaOlimpica y FiltroOlimpico', () => {
  it('la burbuja es un botón con la insignia y la etiqueta accesible', () => {
    const o = html(h(BurbujaOlimpica, { anotacion: CERCA, fechaRanking: FECHA }));
    expect(o).toContain('<button');
    expect(o).toContain('aria-label="JJOO LA 2028: cerca, Mejor de Europa, a 30 puntos"');
    expect(o).toContain('after:-inset-3');
    expect(html(h(BurbujaOlimpica, { anotacion: null, fechaRanking: FECHA }))).toBe('');
  });

  it('el filtro es un conmutador «Solo JJOO» con su recuento', () => {
    const off = html(h(FiltroOlimpico, { activo: false, onCambio: () => {}, cuantos: 13 }));
    expect(off).toContain('Solo JJOO');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('>13<');
    const on = html(h(FiltroOlimpico, { activo: true, onCambio: () => {} }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('data-state="on"');
  });
});
