import { describe, expect, it } from 'vitest';
import { columnasPoule, normalizarPoules, realinearPoule } from '@/lib/ingest/sources/fie-resultados';
import { analizarCuadro, analizarPoules, disputados, total } from '../scripts/indexado/fie-completar-analisis';
import { decidirFase } from '../scripts/indexado/fie-completar-hechos';
import { atributosEngarde, solape } from '../scripts/indexado/fie-completar-otras';

type Celda = { score: number; v: boolean } | null;
const c = (t: string): Celda => (t === '--' ? null : { v: t[0] === 'V', score: Number(t.slice(1)) });
const fila = (fencerId: number, name: string, celdas: string) => ({ fencerId, name, nationality: 'XXX', matches: celdas.split(' ').map(c) });

/** Poule 7 de la Copa del Mundo de Vancouver 2017 (2017/104): 6 filas y 7 columnas, sin la fila del tirador quitado. */
const pouleDesfasada = {
  poolId: 7,
  rows: [
    fila(4633, 'PIZZO Paolo', '-- V5 V5 D3 V5 D4 V5'),
    fila(1977, 'HABIB Farooq', 'D0 V5 -- D2 D1 D2 D3'),
    fila(23681, 'BIDA Sergey', 'V5 D4 V5 -- V5 D1 D1'),
    fila(38218, 'SCHUMACHER Cooper', 'D4 V5 V5 D2 -- D2 V5'),
    fila(15336, 'HERZBERG Fabian', 'V5 D2 V5 V5 V5 -- V5'),
    fila(26332, 'OBERSON Alexandre', 'D4 V5 V5 V5 D2 D2 --'),
  ],
};

describe('fie-resultados: poules', () => {
  it('deduce la columna de cada fila por su celda vacía cuando falta la fila de un tirador quitado', () => {
    expect(columnasPoule(pouleDesfasada.rows)).toEqual([0, 2, 3, 4, 5, 6]);
    const filas = realinearPoule(pouleDesfasada.rows);
    expect(filas[0].matches[1]).toEqual({ v: true, score: 5 });
    expect(filas[1].matches[0]).toEqual({ v: false, score: 0 });
    expect(filas.every((f, i) => f.matches[i] === null)).toBe(true);
  });

  it('no toca una matriz bien alineada', () => {
    const normal = [fila(1, 'A', '-- V5'), fila(2, 'B', 'D3 --')];
    expect(columnasPoule(normal)).toBeNull();
    expect(realinearPoule(normal)[0].matches).toBe(normal[0].matches);
  });

  it('lee los 15 asaltos de la poule desfasada, coherentes con el ganador', () => {
    const r = normalizarPoules({ pools: [pouleDesfasada] }, { individual: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parte.asaltos).toHaveLength(15);
    expect(r.parte.excluidos.noReciproco + r.parte.excluidos.sinGanador + r.parte.excluidos.incoherente).toBe(0);
    const pizzoHabib = r.parte.asaltos.find((a) => [a.refA, a.refB].sort().join() === ['1977', '4633'].join());
    expect(pizzoHabib).toMatchObject({ refA: '1977', refB: '4633', puntosA: 0, puntosB: 5 });
  });

  it('separa la segunda vuelta de poules con poolId repetido como V2P<n>', () => {
    const p1 = { poolId: 1, rows: [fila(1, 'A', '-- V5'), fila(2, 'B', 'D3 --')] };
    const p1v2 = { poolId: 1, rows: [fila(1, 'A', '-- D4'), fila(2, 'B', 'V5 --')] };
    const r = normalizarPoules({ pools: [p1, p1v2] }, { individual: true });
    expect(r.ok && r.parte.asaltos.map((a) => `${a.ronda}:${a.puntosA}-${a.puntosB}`)).toEqual(['P1:5-3', 'V2P1:4-5']);
    expect(r.ok && r.parte.excluidos.duplicado).toBe(0);
  });
});

describe('fie-completar-analisis', () => {
  it('cuenta teóricos, no disputados, prioridad y celdas rotas de las poules', () => {
    const pool = {
      poolId: 3,
      rows: [
        fila(10, 'A', '-- V4 V5 D0'),
        fila(20, 'B', 'D4 -- V5 V5'),
        fila(30, 'C', 'D2 D1 -- V5'),
        fila(40, 'D', 'D0 D3 V3 --'),
      ],
    };
    const a = analizarPoules({ pools: [pool] });
    expect(a.teorico).toBe(6);
    expect(a.noDisputados).toEqual({ cero_cero: 1 });
    expect(a.prioridad).toBe(1);
    expect(a.asaltos.find((b) => b.scoreA === b.scoreB)).toMatchObject({ aRef: '10', bRef: '20', scoreA: 4, winner: 'A' });
    expect(a.ilegibles).toEqual({ sin_ganador: 1 });
    expect(a.asaltos).toHaveLength(4);
    expect(disputados(a)).toBe(5);
  });

  it('no cuenta como ilegibles los cruces de la segunda vuelta ya disputados en la primera ni al retirado sin tirar', () => {
    const v1 = { poolId: 1, rows: [fila(1, 'A', '-- V5 V5'), fila(2, 'B', 'D3 -- V5'), fila(3, 'C', 'D1 D2 --')] };
    const v2 = { poolId: 1, rows: [fila(1, 'A', '-- -- V5 --'), fila(2, 'B', '-- -- D4 --'), fila(4, 'D', 'D2 V5 -- --'), fila(5, 'E', '-- -- -- --')] };
    const a = analizarPoules({ pools: [v1, v2] });
    expect(a.vueltas).toBe(2);
    expect(a.noDisputados).toEqual({ arrastrado: 1, retirada: 3 });
    expect(total(a.ilegibles)).toBe(0);
    expect(a.asaltos.filter((b) => b.roundKey === 'V2P1')).toHaveLength(2);
  });

  it('cuadro: retirada no disputada, prioridad con ganador y el cuadro repetido una sola vez', () => {
    const t = (id: number, score: number, win: boolean, status = '') => ({ id, name: `T${id}`, score, isWinner: win, status, newStatus: null });
    const cuerpo = {
      tableau: [
        {
          suiteTableId: 'A',
          rounds: {
            A8: [
              { fencer1: t(1, 15, true), fencer2: t(2, 10, false) },
              { fencer1: t(3, 0, true), fencer2: t(4, 0, false, 'A') },
              { fencer1: t(5, 12, true), fencer2: t(6, 12, false) },
              { fencer1: t(7, 15, true), fencer2: { id: null, name: 'BYE', score: null, isWinner: false }, isBye: true },
            ],
          },
        },
        { suiteTableId: 'F', rounds: { F8: [{ fencer1: t(1, 15, true), fencer2: t(2, 10, false) }] } },
      ],
    };
    const a = analizarCuadro(cuerpo);
    expect(a.teorico).toBe(3);
    expect(a.noDisputados).toEqual({ retirada: 1 });
    expect(a.prioridad).toBe(1);
    expect(a.asaltos.map((b) => `${b.roundKey}:${b.aRef}-${b.bRef}:${b.winner}`).sort()).toEqual(['A8:1-2:null', 'A8:5-6:A']);
  });
});

describe('fie-completar-hechos: decidirFase', () => {
  const asalto = (aRef: string, bRef: string, roundKey = 'P1') => ({
    phase: 'POULE' as const, roundKey, aRef, bRef, aName: aRef, bName: bRef, scoreA: 5, scoreB: 3, winner: null,
  });
  const fase = (asaltos: ReturnType<typeof asalto>[], ilegibles = 0) => ({
    publicado: true, grupos: 1, teorico: asaltos.length + ilegibles, noDisputados: {}, asaltos, prioridad: 0,
    ilegibles: ilegibles ? { sin_ganador: ilegibles } : {}, ejemplos: [], tiradores: new Set<string>(), vueltas: 1, realineadas: 0,
  });

  it('no incluye la fase cuando la base ya tiene todos los legibles', () => {
    const d = decidirFase(fase([asalto('1', '2')]), [asalto('1', '2')]);
    expect(d.incluir).toBe(false);
  });

  it('añade lo que falta como parcial si quedan celdas ilegibles en la FIE', () => {
    const d = decidirFase(fase([asalto('1', '2'), asalto('1', '3')], 1), [asalto('1', '2')]);
    expect(d).toMatchObject({ incluir: true, estado: 'parcial', nuevos: 1, sobrantes: 0 });
  });

  it('sustituye la fase (completo) cuando la base guarda claves que la FIE ya no publica', () => {
    const d = decidirFase(fase([asalto('1', '2'), asalto('1', '3', 'V2P1')], 2), [asalto('1', '2'), asalto('1', '3')]);
    expect(d).toMatchObject({ incluir: true, estado: 'completo', nuevos: 1, sobrantes: 1 });
  });

  it('sólo fusiona si lo que sobra no son referencias FIE', () => {
    const d = decidirFase(fase([asalto('1', '2'), asalto('1', '3')]), [asalto('ophardt:x', 'ophardt:y')]);
    expect(d).toMatchObject({ incluir: true, estado: 'parcial' });
  });
});

describe('fie-completar-otras', () => {
  it('lee arma, género y categoría de los títulos de Engarde', () => {
    expect(atributosEngarde('18th Mediterranean Fencing Championship Amman 2022 Cadet Female Epee')).toEqual({ weapon: 'ESPADA', gender: 'F', category: 'M17' });
    expect(atributosEngarde('Under 15 Male Sabe')).toEqual({ weapon: 'SABLE', gender: 'M', category: 'M15' });
    expect(atributosEngarde("Asian Cadet Fencing Championships Men's Foil Individual")).toEqual({ weapon: 'FLORETE', gender: 'M', category: 'M17' });
  });

  it('mide el solape de clasificaciones por nombre normalizado', () => {
    const guardada = [{ name: 'HSIEH Kaylin Sin Yan', countryCode: 'HKG' }, { name: 'NAGAI Anna', countryCode: 'JPN' }];
    expect(solape(guardada, [{ nombre: 'Kaylin Sin Yan HSIEH', pais: null }, { nombre: 'OTRA Persona', pais: 'JPN' }])).toBe(0.5);
  });
});
