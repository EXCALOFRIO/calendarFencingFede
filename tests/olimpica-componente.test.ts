import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PruebaOlimpica } from '@/components/olimpica/prueba-olimpica';
import {
  anotarRankingOlimpico,
  calcularClasificacionOlimpica,
  ordenarSoloJjoo,
  type EntradaPrueba,
  type FilaIndividualFie,
} from '@/lib/ranking/olimpica';
import type { PersonaOlimpica } from '@/lib/queries/olimpica';

const NOCS = [
  'ITA', 'FRA', 'JPN', 'HUN', 'KOR', 'ESP', 'CHN', 'EGY', 'POL', 'CAN',
  'UKR', 'SUI', 'ISR', 'KAZ', 'GER', 'VEN', 'HKG', 'EST', 'BRA', 'TUR',
  'ARG', 'AUS', 'MEX', 'ALG', 'USA',
];

const individuales: [string, string][] = [
  ['ITA', 'SANTARELLI Andrea'],
  ['UKR', 'REIZLIN Roman'],
  // En el puesto 3, un ruso: hoy no cuenta (participación sin decidir) pero,
  // sin el veto, sería el mejor de Europa — sale gris al final de la lista.
  ['RUS', 'PETROV Ivan'],
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

/** Lo mismo que arma el panel de `/olimpica`: las filas con su marca, en orden. */
function personasDe(e: EntradaPrueba): PersonaOlimpica[] {
  const a = anotarRankingOlimpico(e, { nocsSeguidos: ['ESP'] });
  return ordenarSoloJjoo(e.individual, (f) => ({
    anotacion: a.individual[String(f.fieId)],
    posicion: f.posicion,
  })).map((f) => ({ ...f, anotacion: a.individual[String(f.fieId)] }));
}

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('PruebaOlimpica', () => {
  const e = entrada();
  const resultado = calcularClasificacionOlimpica(e);
  const out = html(React.createElement(PruebaOlimpica, { resultado, personas: personasDe(e) }));

  it('pinta la sección con su título, la pastilla provisional y la fecha del ranking', () => {
    // El titular de página («Clasificación olímpica · LA 2028») lo pone la
    // ruta; la tarjeta sólo nombra su prueba.
    expect(out).toContain('Espada masculina');
    expect(out).toContain('data-provisional');
    expect(out).toContain('Provisional');
    expect(out).toContain('dateTime="2026-09-28T10:00:00.000Z"');
    expect(out).toMatch(/28 sept?( 2026)?</);
  });

  it('la lista es de personas: entra quien entra, con su camino dicho', () => {
    // Verde: los que tienen la plaza. El de Italia va «con su equipo» (ITA es
    // top 4); el resto, por el ranking individual o como mejor de su zona.
    expect(out).toContain('data-estado="dentro"');
    expect(out).toContain('Con su equipo');
    expect(out).toContain('2 primeros individuales');
    expect(out).toContain('Mejor de Europa');
    expect(out).toContain('Mejor de Asia-Oceanía');
    expect(out).toContain('Mejor de América');
    expect(out).toContain('Mejor de África');
    // Ni una tabla de países: no hay sección «Por equipos».
    expect(out).not.toContain('Por equipos');
    // España, 6.ª por equipos, entra como mejor europea: el rótulo lo dice.
    expect(resultado.equipos.find((x) => x.noc === 'ESP')?.via).toBe('ZONA');
    expect(out).toContain('data-estado-equipo="dentro"');
  });

  it('los amarillos dicen cuánto les falta por su camino más corto', () => {
    expect(out).toContain('data-estado="fuera"');
    // ISR es el reserva de Europa y TUN el de África: salen con «A X pts».
    expect(out).toContain('FREILICH Yuval');
    expect(out).toContain('BEN Ali');
    expect(out).toMatch(/A \d+(,\d)? pts/);
  });

  it('los pendientes salen en gris al final, con el motivo', () => {
    expect(out).toContain('PETROV Ivan');
    expect(out).toContain('data-estado="dudoso"');
    expect(out).toContain('Participación sin decidir');
    // Y van detrás de verdes y amarillos.
    expect(out.indexOf('PETROV Ivan')).toBeGreaterThan(out.indexOf('BEN Ali'));
  });

  it('las plazas individuales cubren a todos: AOR, zonas y el torneo zonal', () => {
    expect(out).not.toContain('Mundial');
    expect(out).toContain('REIZLIN Roman');
    expect(out).toContain('MEHDI Salim');
    expect(out).toContain('data-zonales');
    expect(out).toContain('plaza');
  });

  it('marca al anfitrión cuando no está entre los equipos', () => {
    expect(resultado.anfitrion.conEquipo).toBe(false);
    expect(out).toContain('data-anfitrion');
  });

  it('pensado para 320 px: nombres a dos líneas, sin desbordes ni frases', () => {
    expect(out).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(out).toContain('line-clamp-2');
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
    const o = html(React.createElement(PruebaOlimpica, { resultado: r, personas: personasDe(sinEsp) }));
    expect(o).toContain('data-estado-equipo="fuera"');
    expect(o).toMatch(/a \d+(,\d)? pts/);
  });
});

