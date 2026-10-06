import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DetalleFilaOficial,
  TablaRankingOficial,
} from '@/components/ranking/tabla-oficial';
import { armasInternas } from '@/lib/ranking/acceso-interno';
import type {
  BreakdownEntry,
  FilaOficial,
  RankingGroupKey,
  RankingRowView,
  TablaOficial,
} from '@/lib/queries/ranking';

/**
 * El bloque «Cálculo de esta aplicación» y la promesa «Ver tus datos y el
 * cálculo» dependen del ARMA seleccionada, no de un booleano global ni de que
 * existan desgloses. Son renders de servidor directos (sin jsdom ni sesión):
 * prueban la vista, no la autorización real, que cubre
 * `ranking-interno-acceso.test.ts`.
 */

const FLORETE: RankingGroupKey = { weapon: 'FLORETE', gender: 'M', category: 'ABS' };
const ESPADA: RankingGroupKey = { weapon: 'ESPADA', gender: 'M', category: 'ABS' };

const MIO = 'atleta-1';

function fila(parcial: Partial<FilaOficial> = {}): FilaOficial {
  return {
    id: 'fila-1',
    position: 3,
    nombre: 'PEREZ GARCIA, ANA',
    club: 'CNE-NA',
    totalPoints: 210.5,
    anioNacimiento: 2006,
    athleteId: MIO,
    ...parcial,
  };
}

function tabla(grupo: RankingGroupKey, filas: FilaOficial[]): TablaOficial {
  return {
    group: grupo,
    seasonLabel: '2026-2027',
    rows: filas,
    clasificados: filas.length,
    actualizadoEl: null,
    sourceUrl: 'https://skermo.example/ranking',
    rule: null,
  };
}

const clave = (g: RankingGroupKey) => `${g.weapon}|${g.gender}|${g.category}`;

const desglose: BreakdownEntry = {
  eventCompetitionId: 'c1',
  eventName: 'Copa de prueba',
  eventCity: 'Madrid',
  eventDate: '2026-10-01',
  circuit: 'NACIONAL',
  position: 2,
  basePoints: 100,
  coefficient: 1,
  finalPoints: 100,
  counted: true,
  explanation: null,
};

const interno = {
  ...FLORETE,
  athleteId: MIO,
  athleteName: 'Ana',
  clubName: null,
  position: 1,
  totalPoints: 100,
  countedEvents: 1,
  change: null,
} satisfies RankingRowView;

function tablaCompleta(armas: readonly ('FLORETE' | 'ESPADA' | 'SABLE')[], grupo = FLORETE) {
  return renderToStaticMarkup(
    React.createElement(TablaRankingOficial, {
      grupos: [
        { ...FLORETE, tiradores: 1 },
        { ...ESPADA, tiradores: 1 },
      ],
      tablas: {
        [clave(FLORETE)]: tabla(FLORETE, [fila()]),
        [clave(ESPADA)]: tabla(ESPADA, [fila({ id: 'fila-2', nombre: 'LOPEZ RUIZ, LUIS' })]),
      },
      cortes: {},
      desgloses: { [`${clave(FLORETE)}|${MIO}`]: [desglose] },
      internos: { [`${clave(FLORETE)}|${MIO}`]: interno },
      mios: [MIO],
      grupoInicial: clave(grupo),
      armasAutorizadas: armas,
    }),
  );
}

function detalle(verCalculo: boolean, conDesglose: boolean) {
  const grupo = FLORETE;
  return renderToStaticMarkup(
    React.createElement(DetalleFilaOficial, {
      fila: fila(),
      tabla: tabla(grupo, [fila()]),
      corte: null,
      desglose: conDesglose ? [desglose] : null,
      interno: conDesglose ? interno : null,
      esTuyo: true,
      verCalculo,
    }),
  );
}

describe('promesa «Ver tus datos y el cálculo» por arma seleccionada', () => {
  it('atleta (sin armas internas) no recibe la promesa del cálculo y conserva el dato oficial', () => {
    const html = tablaCompleta(armasInternas({ role: 'athlete', weapons: [] }));
    expect(html).not.toContain('y el cálculo');
    expect(html).toContain('Ver tus datos');
    expect(html).toContain('PEREZ GARCIA, ANA');
    expect(html).toContain('210,5');
  });

  it('coach de espada viendo florete no recibe la promesa; admin sí', () => {
    const coach = armasInternas({ role: 'coach', weapons: ['ESPADA'] });
    expect(tablaCompleta(coach, FLORETE)).not.toContain('y el cálculo');
    const admin = armasInternas({ role: 'admin', weapons: [] });
    expect(tablaCompleta(admin, FLORETE)).toContain('Ver tus datos y el cálculo');
  });

  it('coach de florete la recibe en florete pero no al cambiar a espada', () => {
    const coach = armasInternas({ role: 'coach', weapons: ['FLORETE'] });
    expect(tablaCompleta(coach, FLORETE)).toContain('Ver tus datos y el cálculo');
    const enEspada = renderToStaticMarkup(
      React.createElement(TablaRankingOficial, {
        grupos: [{ ...ESPADA, tiradores: 1 }],
        tablas: { [clave(ESPADA)]: tabla(ESPADA, [fila()]) },
        cortes: {},
        desgloses: {},
        internos: {},
        mios: [MIO],
        grupoInicial: clave(ESPADA),
        armasAutorizadas: coach,
      }),
    );
    expect(enEspada).not.toContain('y el cálculo');
    expect(enEspada).not.toContain('su cálculo interno');
  });

  it('la nota de filas sin ficha no promete cálculo cuando el arma no está autorizada', () => {
    const sinPermiso = renderToStaticMarkup(
      React.createElement(TablaRankingOficial, {
        grupos: [{ ...FLORETE, tiradores: 2 }],
        tablas: {
          [clave(FLORETE)]: tabla(FLORETE, [fila(), fila({ id: 'f2', athleteId: null })]),
        },
        cortes: {},
        desgloses: {},
        internos: {},
        mios: [],
        grupoInicial: clave(FLORETE),
        armasAutorizadas: [],
      }),
    );
    expect(sinPermiso).toContain('</span> sin ficha</p>');
    expect(sinPermiso).toContain('solo sus datos publicados por la RFEE');
    expect(sinPermiso).not.toContain('ni cálculo interno');
  });
});

describe('panel de la fila oficial', () => {
  it('sin permiso para el arma omite el bloque de cálculo y cualquier frase de «sin cálculo propio»', () => {
    const html = detalle(false, false);
    expect(html).not.toContain('Cálculo de esta aplicación');
    expect(html).not.toContain('No es el ranking de la federación');
    expect(html).not.toContain('no hay cálculo propio');
    expect(html).toContain('puntos oficiales');
    expect(html).toContain('de 1 en la clasificación oficial');
  });

  it('con permiso y desglose enseña el cálculo con su rótulo', () => {
    const html = detalle(true, true);
    expect(html).toContain('Cálculo de esta aplicación');
    expect(html).toContain('Copa de prueba');
  });

  it('con permiso y sin resultados emparejados lo dice, distinto de no tener permiso', () => {
    const html = detalle(true, false);
    expect(html).toContain('Cálculo de esta aplicación');
    expect(html).toContain('no hay cálculo propio');
  });
});
