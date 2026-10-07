import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BurbujaOlimpica,
  ContenidoBurbujaOlimpica,
  MarcaOlimpicaPersona,
} from '@/components/olimpica/burbuja-olimpica';
import { FiltroOlimpico } from '@/components/olimpica/filtro-olimpico';
import { IconoAros } from '@/components/olimpica/icono-aros';
import { InsigniaOlimpica } from '@/components/olimpica/insignia-olimpica';
import { PastillaOlimpica } from '@/components/olimpica/pastilla-olimpica';
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
  puesto: 5,
  puntos: 332.5,
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
  puestosFaltan: 2,
  puesto: 12,
  puntos: 195,
});

const PENDIENTE = anot({
  estado: 'pendiente',
  motivo: 'PARTICIPACION_SIN_DECIDIR',
  sinVeto: { estado: 'clasificado', camino: 'EQUIPO_TOP', zona: null },
  puesto: 2,
});

const FECHA = '2026-10-01T06:00:00.000Z';

describe('IconoAros', () => {
  it('cinco aros de trazo, de un solo color (currentColor), sin relleno ni colores fijos', () => {
    const svg = html(h(IconoAros));
    expect(svg.match(/<circle/g)).toHaveLength(5);
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).not.toMatch(/stroke="#/);
    expect(svg).not.toContain('<path');
    for (const [cx, cy] of [['10.316', '20.832'], ['24', '20.832'], ['37.684', '20.832'], ['17.158', '27.168'], ['30.842', '27.168']]) {
      expect(svg).toContain(`cx="${cx}" cy="${cy}" r="5.816"`);
    }
    expect(svg).toContain('data-icono="aros"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('el viewBox encuadra los aros con su trazo, sin recortarlos ni dejar aire de más', () => {
    const svg = html(h(IconoAros));
    const [x, y, w, alto] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
    const grosor = Number(/stroke-width="([^"]+)"/.exec(svg)![1]);
    // Aros de 4,5 a 43,5 en horizontal y de 15,016 a 32,984 en vertical.
    expect(x).toBeCloseTo(4.5 - grosor / 2, 2);
    expect(y).toBeCloseTo(15.016 - grosor / 2, 2);
    expect(x + w).toBeCloseTo(43.5 + grosor / 2, 2);
    expect(y + alto).toBeCloseTo(32.984 + grosor / 2, 2);
    // Cerca de «4 14.5 40 19».
    expect(Math.abs(x - 4)).toBeLessThan(1);
    expect(Math.abs(w - 40)).toBeLessThan(2);
    // A 14 px de ancho el trazo sigue por encima de 0,7 px.
    expect((grosor * 14) / w).toBeGreaterThan(0.7);
  });
});

describe('PastillaOlimpica: verde, amarillo y gris, sin check', () => {
  it('verde = clasificado; amarillo = por asegurar, con lo que falta; gris = RUS/BLR con opción', () => {
    const v = html(h(PastillaOlimpica, { anotacion: CLASIFICADO }));
    expect(v).toContain('data-color-olimpico="verde"');
    expect(v).toContain('text-ok');
    // Tinte opaco sobre `--card` y sin borde (diseno-sistema § 9).
    expect(v).toContain('var(--card)');
    expect(v).not.toMatch(/\bborder(-ok)?\b|bg-ok\/\d+/);
    expect(v).toContain('data-icono="aros"');
    expect(v).not.toContain('lucide-check');
    expect(v).not.toContain('laurel');
    expect(v).toContain('role="img"');
    expect(v).toContain('aria-label="JJOO LA 2028: clasificado, Equipo de Europa, 12,5 puntos de margen"');

    const a = html(h(PastillaOlimpica, { anotacion: CERCA }));
    expect(a).toContain('data-color-olimpico="amarillo"');
    expect(a).toContain('text-warn');
    expect(a).toContain('−30');
    expect(a).toContain('le faltan 30 puntos');

    // Los aros toman el color del estado (currentColor dentro de text-ok/text-warn).
    expect(v).toContain('stroke="currentColor"');

    const g = html(h(PastillaOlimpica, { anotacion: PENDIENTE }));
    expect(g).toContain('data-color-olimpico="gris"');
    expect(g).toContain('text-muted-foreground');
    expect(g).toContain('opacity-60');
    expect(g).not.toContain('lucide-clock');
    expect(g).toContain('Participación sin decidir');
  });

  it('sin color no pinta nada: sin estado, torneo zonal o pendiente sin opción', () => {
    expect(html(h(PastillaOlimpica, { anotacion: anot({ camino: 'TORNEO_ZONAL' }) }))).toBe('');
    expect(html(h(PastillaOlimpica, { anotacion: null }))).toBe('');
    expect(html(h(PastillaOlimpica, { anotacion: anot({ estado: 'pendiente', motivo: 'NEUTRAL' }) }))).toBe('');
  });

  it('compacta: por debajo de 360 px una baldosa de 16 px, sin los puntos pero con el color', () => {
    const c = html(h(PastillaOlimpica, { anotacion: CERCA, compacta: true }));
    expect(c).toContain('max-[359px]:hidden');
    expect(c).toContain('max-[359px]:w-4');
    expect(c).toContain('bg-warn-tinte');
    expect(c).not.toContain('bg-transparent');
    expect(html(h(PastillaOlimpica, { anotacion: CERCA }))).not.toContain('max-[359px]');
  });
});

describe('ContenidoBurbujaOlimpica', () => {
  it('verde: vía, puesto que cuenta, margen sobre el primero fuera y fecha', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: CLASIFICADO, fechaRanking: FECHA }));
    expect(o).toContain('Clasificado');
    expect(o).toContain('Equipo de Europa');
    expect(o).toContain('5.º');
    expect(o).toContain('ranking por equipos');
    expect(o).toContain('+12,5');
    expect(o).toContain('Sobre');
    expect(o).toContain('POL');
    expect(o).toContain('Provisional');
    expect(o).toContain(`dateTime="${FECHA}"`);
    expect(o).not.toContain('Le faltan');
  });

  it('amarillo: puntos y puestos que le faltan y a quién pasar; sin margen', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: CERCA, fechaRanking: FECHA }));
    expect(o).toContain('Por asegurar');
    expect(o).toContain('Mejor de Europa');
    expect(o).toContain('12.º');
    expect(o).toContain('ranking individual');
    expect(o).toContain('Le faltan');
    expect(o).toContain('>30<');
    expect(o).toContain('· 2 puestos');
    expect(o).toContain('Rival');
    expect(o).toContain('FREILICH Yuval');
    expect(o).not.toContain('Margen');
  });

  it('amarillo de anfitrión: lo que falta es la decisión de EE. UU.', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: anot({ estado: 'cerca', camino: 'ANFITRION', puesto: 30 }) }));
    expect(o).toContain('Plaza de anfitrión');
    expect(o).toContain('Que EE. UU. le dé plaza');
    expect(o).toContain('30.º');
  });

  it('gris: motivo y qué tendría si contara, con el puesto del ranking de ese camino', () => {
    const o = html(h(ContenidoBurbujaOlimpica, { anotacion: PENDIENTE, fechaRanking: null }));
    expect(o).toContain('Pendiente');
    expect(o).toContain('Participación sin decidir');
    expect(o).toContain('Si contara');
    expect(o).toContain('Top 4 equipos');
    expect(o).toContain('ranking por equipos');
    expect(o).not.toContain('Rival');
    expect(o).not.toContain('<time');
  });

  it('la fecha y la prueba pueden venir dentro de la anotación (perfil, Buscar)', () => {
    const o = html(h(ContenidoBurbujaOlimpica, {
      anotacion: { ...CERCA, fechaRanking: FECHA, prueba: { arma: 'ESPADA', genero: 'F' } },
    }));
    expect(o).toContain(`dateTime="${FECHA}"`);
    expect(o).toContain('LA 2028 · Espada fem.');
  });
});

describe('BurbujaOlimpica, InsigniaOlimpica, MarcaOlimpicaPersona y FiltroOlimpico', () => {
  it('la burbuja es un botón con la pastilla decorativa y la etiqueta accesible', () => {
    const o = html(h(BurbujaOlimpica, { anotacion: CERCA, fechaRanking: FECHA }));
    expect(o).toContain('<button');
    expect(o).toContain('aria-label="JJOO LA 2028: por asegurar, Mejor de Europa, le faltan 30 puntos"');
    // 44 px de alto de verdad (lo que mide un dedo y la sonda), sin agrandar la fila.
    expect(o).toContain('h-[44px]');
    expect(o).toContain('-my-[12px]');
    expect(o).toContain('data-color-olimpico="amarillo"');
    expect(o).not.toContain('role="img"');
    expect(html(h(BurbujaOlimpica, { anotacion: null, fechaRanking: FECHA }))).toBe('');
  });

  it('InsigniaOlimpica es la misma burbuja: también se toca en el perfil', () => {
    expect(html(h(InsigniaOlimpica, { anotacion: CLASIFICADO }))).toBe(html(h(BurbujaOlimpica, { anotacion: CLASIFICADO })));
  });

  it('con varias armas, Buscar enseña la mejor: verde antes que amarillo, y el amarillo más cercano', () => {
    const marcas = [
      { anotacion: { ...CERCA, faltan: 80 } },
      { anotacion: CERCA },
      { anotacion: PENDIENTE },
    ];
    const o = html(h(MarcaOlimpicaPersona, { marcas }));
    expect(o).toContain('−30');
    expect(html(h(MarcaOlimpicaPersona, { marcas: [...marcas, { anotacion: CLASIFICADO }] }))).toContain('data-color-olimpico="verde"');
    expect(html(h(MarcaOlimpicaPersona, { marcas: [] }))).toBe('');
  });

  it('el filtro «Solo JJOO» lleva los aros y su recuento', () => {
    const off = html(h(FiltroOlimpico, { activo: false, onCambio: () => {}, cuantos: 13 }));
    expect(off).toContain('Solo JJOO');
    expect(off).toContain('data-icono="aros"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('>13<');
    const on = html(h(FiltroOlimpico, { activo: true, onCambio: () => {} }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('data-state="on"');
  });
});
