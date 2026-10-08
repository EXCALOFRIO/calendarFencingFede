import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClasificacionOlimpica } from '@/components/olimpica/clasificacion-olimpica';
import { PruebaOlimpica } from '@/components/olimpica/prueba-olimpica';
import {
  calcularClasificacionOlimpica,
  type EntradaPrueba,
  type FilaIndividualFie,
} from '@/lib/ranking/olimpica';

const NOCS = [
  'ITA', 'FRA', 'JPN', 'HUN', 'KOR', 'ESP', 'CHN', 'EGY', 'POL', 'CAN',
  'UKR', 'SUI', 'ISR', 'KAZ', 'GER', 'VEN', 'HKG', 'EST', 'BRA', 'TUR',
  'ARG', 'AUS', 'MEX', 'ALG', 'USA',
];

const individuales: [string, string][] = [
  ['ITA', 'SANTARELLI Andrea'],
  ['UKR', 'REIZLIN Roman'],
  ['SUI', 'HEINZER Max'],
  ['ISR', 'FREILICH Yuval'],
  ['KAZ', 'ALEXANIN Dmitriy'],
  ['GER', 'HEINE Lukas'],
  ['VEN', 'LIMARDO Ruben'],
  ['ALG', 'MEHDI Salim'],
  ['TUN', 'BEN Ali'],
];

function entrada(parcial: Partial<EntradaPrueba> = {}): EntradaPrueba {
  return {
    arma: 'ESPADA',
    genero: 'M',
    fechaRanking: '2026-09-28T10:00:00.000Z',
    equipos: NOCS.map((noc, i) => ({ noc, posicion: i + 1, puntos: 400 - i * 10 })),
    individual: individuales.map<FilaIndividualFie>(([noc, nombre], i) => ({
      fieId: 1 + i,
      nombre,
      noc,
      posicion: i + 1,
      puntos: 250 - i * 5.5,
    })),
    ...parcial,
  };
}

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('PruebaOlimpica', () => {
  const resultado = calcularClasificacionOlimpica(entrada());
  const out = html(React.createElement(PruebaOlimpica, { resultado }));

  it('pinta la prueba con pastilla provisional y la fecha del ranking', () => {
    expect(out).toContain('Espada masculina');
    expect(out).toContain('data-provisional');
    expect(out).toContain('Provisional');
    expect(out).toContain('dateTime="2026-09-28T10:00:00.000Z"');
    expect(out).toMatch(/28 sept?( 2026)?</);
  });

  it('enseña los 8 equipos con su camino y resalta España', () => {
    expect((out.match(/data-propio=""/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(out).toContain('4 primeros');
    expect(out).toContain('Europa');
    expect(out).toContain('Asia-Oceanía');
    expect(out).toContain('América');
    expect(out).toContain('África');
    // ESP es 6.º: entra entre los 4 primeros no, pero sí como mejor europeo.
    expect(resultado.equipos.find((e) => e.noc === 'ESP')?.via).toBe('ZONA');
    expect(out).toContain('data-estado-propio="dentro"');
  });

  it('dice quién es el primero fuera y por cuántos puntos', () => {
    expect(out).toContain('data-primer-fuera');
    expect(out).toContain('1.º fuera');
    const fuera = resultado.primerFuera.equipos;
    expect(fuera).not.toBeNull();
    expect(out).toContain(`−${fuera?.diferencia}`);
  });

  it('plazas individuales: top 2, zonas, siguiente por zona y los zonales', () => {
    expect(out).toContain('2 primeros');
    expect(out).not.toContain('Mundial');
    expect(out).toContain('REIZLIN Roman');
    expect(out).toContain('MEHDI Salim');
    expect(out).toContain('Sig.');
    expect(out).toContain('BEN Ali');
    expect(out).toContain('data-zonales');
  });

  it('marca al anfitrión cuando no está entre los equipos', () => {
    expect(resultado.anfitrion.conEquipo).toBe(false);
    expect(out).toContain('data-anfitrion');
  });

  it('pensado para 320 px: filas truncadas, sin desbordes ni frases', () => {
    expect(out).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(out).toContain('truncate');
    expect(out).toContain('minmax(0,1fr)');
    expect(out).not.toMatch(/<p[\s>]/);
  });

  it('España fuera: pastilla con los puntos que le faltan', () => {
    const sinEsp = entrada({
      equipos: NOCS.filter((n) => n !== 'ESP')
        .concat(['ESP'])
        .map((noc, i) => ({ noc, posicion: i + 1, puntos: 400 - i * 10 })),
    });
    const r = calcularClasificacionOlimpica(sinEsp);
    const o = html(React.createElement(PruebaOlimpica, { resultado: r }));
    expect(o).toContain('data-estado-propio="fuera"');
    expect(o).toMatch(/a \d+(,\d)? pts/);
  });
});

describe('ClasificacionOlimpica', () => {
  it('abre con la primera prueba y ofrece arma y género', () => {
    const resultados = [
      calcularClasificacionOlimpica(entrada({ arma: 'FLORETE', genero: 'F' })),
      calcularClasificacionOlimpica(entrada({ arma: 'ESPADA', genero: 'M' })),
    ];
    const out = html(React.createElement(ClasificacionOlimpica, { resultados }));
    expect(out).toContain('Florete femenino');
    expect(out).not.toContain('Espada masculina');
    expect(out).toContain('aria-label="Arma"');
    expect(out).toContain('aria-label="Género"');
  });

  it('sin datos no pinta nada', () => {
    expect(html(React.createElement(ClasificacionOlimpica, { resultados: [] }))).toBe('');
  });
});
