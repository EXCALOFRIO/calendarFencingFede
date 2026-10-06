import { describe, expect, it } from 'vitest';
import type { HechosPrueba } from '../src/lib/ingest/hechos/formato';
import {
  afinidad,
  compatibles,
  construirUnidades,
  esMarcadorFie,
  esNacional,
  especieEfcPendiente,
  evaluar,
  evaluarUnidades,
  filasCatalogo,
  fundir,
  grupoVet,
  huecos,
  matriz,
  registroDeHechos,
  type FilaCatalogo,
  type Registro,
} from '../scripts/indexado/cobertura';
import { encuentrosCuadroFie, validarCuadroEquipos, type EquipoClasificado } from '../scripts/indexado/lote8-fie-equipos';
import { Turnos } from '../scripts/indexado/lote8-red';
import { reconstruirRondas, rondaDeSalida } from '../scripts/indexado/lote8b-fie-equipos-rondas';
import { atributosDeCodigo, identificar } from '../scripts/indexado/lote8b-fie-mediterraneo';
import {
  asaltosPouleOphardt,
  cuadroCoherente,
  filaPouleOphardt,
  generadorDe,
  leerTablaClasificacion,
  marcadorImposible,
  paisDeEquipo,
  puestosCoherentes,
  sinColumnasAjenas,
  traducirItem,
} from '../scripts/indexado/lote8b-efc-pdf';
import type { AsaltoHecho } from '../src/lib/ingest/hechos/formato';

const reg = (r: Partial<Registro>): Registro => ({
  origen: 'nuevo7', foto: 'antes', source: 'skermo_rfee', season: '2023-2024', key: 'RFEE:1', edicion: 'TNR ABS', categoriaRaw: null,
  weapon: 'ESPADA', gender: 'M', category: 'ABS', format: 'INDIVIDUAL', fecha: '2023-11-11', url: null, res: 0, conPuesto: 0, esp: 0,
  pb: 0, tb: 0, poulesRondas: 0, poulesTiradores: 0, publicados: null, parcial: { results: false, pools: false, tableau: false }, soloCompleta: false, ...r,
});

const fila = (f: Partial<FilaCatalogo>): FilaCatalogo => ({
  fuente: 'skermo_rfee', temporada: '2023-2024', claveCatalogo: 'skermo_rfee|2023-2024|fila:RFEE:1', clavePrueba: null, nombre: 'TNR ABS',
  fecha: '2023-11-11', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: 'ABS', formato: 'INDIVIDUAL', enlaces: [], ...f,
});

describe('cobertura: fases que aplican', () => {
  it('individual sin poules ni cuadro: falta todo lo que aplica', () => {
    const ev = evaluar([reg({ res: 40, conPuesto: 40 })]);
    expect(ev).toMatchObject({ clasificacion: true, poules: 'no', cuadro: 'no', completa: false });
  });

  it('poule única con todos los clasificados: el cuadro no aplica', () => {
    const ev = evaluar([reg({ res: 6, conPuesto: 6, pb: 15, poulesRondas: 1, poulesTiradores: 6 })]);
    expect(ev).toMatchObject({ poules: 'si', cuadro: 'na', completa: true });
  });

  it('equipos: poules sólo si alguna lectura las trae; el cuadro siempre', () => {
    expect(evaluar([reg({ format: 'EQUIPOS', res: 8, conPuesto: 8 })])).toMatchObject({ poules: 'na', cuadro: 'no', completa: false });
    expect(evaluar([reg({ format: 'EQUIPOS', res: 8, conPuesto: 8, tb: 7 })])).toMatchObject({ poules: 'na', cuadro: 'si', completa: true });
  });

  it('eliminación directa declarada o Juegos Olímpicos: sin poules', () => {
    expect(evaluar([reg({ res: 32, conPuesto: 32, tb: 31 })], 'TNR M-20 ELIMINACION DIRECTA').completa).toBe(true);
    expect(evaluar([reg({ res: 32, conPuesto: 32, tb: 31 })], 'Jeux Olympiques').poules).toBe('na');
    expect(evaluar([reg({ res: 32, conPuesto: 32, tb: 31 })], 'Jeux Olympiques de la Jeunesse').poules).toBe('no');
  });

  it('las fases se suman entre lecturas de la misma prueba', () => {
    const ev = evaluar([reg({ res: 30, conPuesto: 30 }), reg({ source: 'engarde', pb: 80, poulesRondas: 5, poulesTiradores: 30, tb: 31 })]);
    expect(ev.completa).toBe(true);
  });

  it('marca las completas con alguna sección parcial declarada', () => {
    const ev = evaluar([reg({ res: 30, conPuesto: 30, pb: 80, poulesRondas: 5, poulesTiradores: 30, tb: 31, parcial: { results: false, pools: true, tableau: false } })]);
    expect(ev).toMatchObject({ completa: true, parcialDeclarado: true });
  });
});

describe('cobertura: emparejado y universo', () => {
  it('grupo de veteranos de varias formas de escribirlo', () => {
    expect(grupoVet('VET60')).toBe('60');
    expect(grupoVet('+40')).toBe('40');
    expect(grupoVet(null, 'pdf:x:x:ESPADA:M:INDIVIDUAL:VET:50')).toBe('50');
    expect(grupoVet('VETERANOS')).toBeNull();
  });

  it('compatibles: ±2 días, género mixto y grupo de veteranos', () => {
    const a = { weapon: 'ESPADA', gender: 'M', category: 'VET', format: 'INDIVIDUAL', fecha: '2024-06-01', vet: '50' };
    expect(compatibles(a, { ...a, fecha: '2024-06-03' })).toBe(true);
    expect(compatibles(a, { ...a, fecha: '2024-06-04' })).toBe(false);
    expect(compatibles(a, { ...a, gender: 'MIXTO' })).toBe(true);
    expect(compatibles(a, { ...a, vet: '60' })).toBe(false);
    expect(compatibles(a, { ...a, vet: null })).toBe(true);
  });

  it('afinidad distingue la división de la liga', () => {
    expect(afinidad('LIGA NACIONAL ORO 1ª JORNADA', 'engarde:rfee/sabadell/l_oro')).toBeGreaterThan(afinidad('LIGA NACIONAL PLATA 1ª JORNADA', 'engarde:rfee/sabadell/l_oro'));
  });

  it('RFEE nacional: fuera las autonómicas y las internacionales', () => {
    expect(esNacional(reg({ source: 'engarde', key: 'engarde:fce/x/y', edicion: 'Campionat de Catalunya M20 Espasa' }))).toBe(false);
    expect(esNacional(reg({ source: 'engarde', key: 'engarde:fce/x/y', edicion: 'Torneo Nacional de Ránquing M20 Florete' }))).toBe(true);
    expect(esNacional(reg({ source: 'engarde', key: 'engarde:rfee/med2024/em15', edicion: 'MEDITERRANEAN CHAMPIONSHIP 2024' }))).toBe(false);
    expect(esNacional(reg({ source: 'engarde', key: 'engarde:rfee/cto/x', edicion: 'Campeonato de España Abs' }))).toBe(true);
    expect(esNacional(reg({ source: 'fie' }))).toBe(false);
  });

  it('catálogo: sin anuladas ni futuras y con todas las filas de veteranos', () => {
    const inv = {
      ownRfeeCatalog: [
        fila({ claveCatalogo: 'a', categoria: 'VET', categoriaOriginal: 'VET40' }),
        fila({ claveCatalogo: 'b', categoria: 'VET', categoriaOriginal: 'VET50' }),
        fila({ claveCatalogo: 'c', nombre: 'TNR CANCELADO' }),
        fila({ claveCatalogo: 'd', fecha: '2099-01-01' }),
      ],
      catalog: [fila({ claveCatalogo: 'e', nombre: 'COPA MUNDO' }), fila({ claveCatalogo: 'f', nombre: 'TNR ABS (1/3)' })],
    };
    expect(filasCatalogo(inv, '2026-10-06').map((f) => f.claveCatalogo)).toEqual(['a', 'b', 'f']);
  });

  it('marcador FIE: fechas anteriores al inicio de la temporada', () => {
    expect(esMarcadorFie('2027', '2026-02-20')).toBe(true);
    expect(esMarcadorFie('2027', '2026-10-01')).toBe(false);
  });

  it('prueba EFC pendiente del inventario', () => {
    expect(especieEfcPendiente('Sabre Female Cadets Individual', '23/09 - 24/09/2017')).toMatchObject({
      weapon: 'SABLE', gender: 'F', category: 'M17', format: 'INDIVIDUAL', fecha: '2017-09-23', temporada: '2017-2018',
    });
    expect(especieEfcPendiente('Epee Male Cadets Team', '30/12 - 02/01/2018')).toMatchObject({ fecha: '2017-12-30', format: 'EQUIPOS', gender: 'M' });
  });

  it('fundir: por fase gana la lectura con más filas', () => {
    const f = fundir(reg({ res: 10, conPuesto: 10, tb: 5 }), reg({ origen: 'lote7-x', foto: 'lote7', pb: 20, poulesRondas: 2, poulesTiradores: 10, tb: 3 }));
    expect(f).toMatchObject({ conPuesto: 10, pb: 20, tb: 5, foto: 'lote7' });
  });

  it('construye unidades con el mismo universo en todas las fotos y prioriza los huecos', () => {
    const catalogo = [fila({ claveCatalogo: 'r1', clavePrueba: 'RFEE:1' }), fila({ claveCatalogo: 'r2', arma: 'SABLE' })];
    const nuevo7 = [
      reg({ key: 'RFEE:1', res: 30, conPuesto: 30 }),
      reg({ source: 'fie', season: '2024', key: '7', category: 'M20', format: 'EQUIPOS', fecha: '2024-01-10', res: 10, conPuesto: 10, esp: 1 }),
      reg({ source: 'fie', season: '2027', key: '8', fecha: '2026-02-01' }),
    ];
    const lote7 = [reg({ origen: 'lote7-engarde-rfee', foto: 'lote7', source: 'engarde', key: 'engarde:rfee/x/em', edicion: 'TNR ABS', pb: 60, poulesRondas: 5, poulesTiradores: 30, tb: 31 })];
    const lote8 = [reg({ origen: 'lote8-fie-equipos', foto: 'lote8', source: 'fie', season: '2024', key: '7', format: 'EQUIPOS', category: 'M20', fecha: '2024-01-10', tb: 9 })];
    const us = evaluarUnidades(construirUnidades({ nuevo7, lote7, lote8, catalogo, efcPendientes: [], hoy: '2026-10-06' }));
    expect(us.map((u) => u.id).sort()).toEqual(['fie:2024:7', 'rfee:r1', 'rfee:r2']);
    const m = matriz(us, (u) => u.fuente);
    expect(m.get('RFEE')).toMatchObject({ antes: { pruebas: 2, completas: 0, clasificacion: 1 }, lote7: { pruebas: 2, completas: 1 } });
    expect(m.get('FIE')).toMatchObject({ antes: { completas: 0 }, lote7: { completas: 0 }, lote8: { completas: 1 } });
    const hs = huecos(us, 'lote7');
    expect(hs.map((h) => [h.id, h.prioridad, h.faltan])).toEqual([
      ['rfee:r2', 1, ['clasificacion', 'poules', 'cuadro']],
      ['fie:2024:7', 2, ['cuadro']],
    ]);
  });

  it('lee un fichero de hechos como lectura', () => {
    const h = {
      version: 1, source: 'efc', extractor: 'x', sourceUrl: 'https://e.x/a', sourceSha256: 'a'.repeat(64),
      edition: { season: '2023-2024', tournamentKey: 't', name: 'Cadet Circuit', startDate: '2023-10-14', endDate: null, city: null, countryCode: null },
      competition: { competitionKey: 'k', weapon: 'ESPADA', gender: 'M', category: 'M17', categoryRaw: null, format: 'INDIVIDUAL', date: null },
      status: { results: 'completo', pools: 'parcial', tableau: 'completo', publishedParticipants: 3, notes: [] },
      results: [1, 2, 3].map((i) => ({ factKey: `k${i}`, name: `N ${i}`, countryCode: i === 1 ? 'ESP' : 'FRA', club: null, position: i, positionRaw: null, points: null, fieId: null, license: null, birthYear: null })),
      bouts: [{ phase: 'POULE', roundKey: 'P1', aRef: 'k1', bRef: 'k2', aName: 'N 1', bName: 'N 2', scoreA: 5, scoreB: 3, winner: null }],
    } as HechosPrueba;
    expect(registroDeHechos(h, 'lote7-pdf-opcional/engarde', 'lote7')).toMatchObject({
      conPuesto: 3, esp: 1, pb: 1, tb: 0, poulesRondas: 1, poulesTiradores: 2, fecha: '2023-10-14', soloCompleta: true, parcial: { pools: true },
    });
  });
});

describe('lote 8: cuadro FIE por equipos', () => {
  const equipos = new Map<string, EquipoClasificado>([
    ['team:1', { ref: 'team:1', nombre: 'Spain', puesto: 1 }],
    ['team:2', { ref: 'team:2', nombre: 'Italy', puesto: 2 }],
    ['team:3', { ref: 'team:3', nombre: 'France', puesto: 3 }],
  ]);
  const lado = (id: number | null, score: number | null, win: boolean, status = win ? 'V' : 'D') => ({ name: `T${id}`, id, score, isWinner: win, status, newStatus: status });

  it('lee encuentros, orienta referencias y descarta byes y marcadores imposibles', () => {
    const json = {
      tableau: [{ suiteTableId: 'SuiteTab_A', rounds: {
        A4: [
          { fencer1: lado(3, 40, false), fencer2: lado(1, 45, true) },
          { fencer1: lado(2, 45, true), fencer2: lado(null, null, false), isBye: true },
          { fencer1: lado(2, 30, true), fencer2: lado(3, 44, false) },
          { fencer1: lado(2, 46, true), fencer2: lado(3, 44, false) },
        ],
        A2: [{ fencer1: lado(2, 44, false), fencer2: lado(1, 44, true) }],
      } }],
    };
    const l = encuentrosCuadroFie(json, equipos);
    expect(l.bouts).toEqual([
      { phase: 'TABLEAU', roundKey: 'A4', aRef: 'team:1', bRef: 'team:3', aName: 'Spain', bName: 'France', scoreA: 45, scoreB: 40, winner: null },
      { phase: 'TABLEAU', roundKey: 'A2', aRef: 'team:1', bRef: 'team:2', aName: 'Spain', bName: 'Italy', scoreA: 44, scoreB: 44, winner: 'A' },
    ]);
    expect(l.descartes).toEqual({ bye: 1, marcador_imposible_ganador_con_menos: 1, marcador_imposible_mas_de_45: 1 });
    expect(validarCuadroEquipos(l.bouts, equipos)).toBeNull();
  });

  it('rechaza un cuadro cuya final contradice la clasificación o con equipos sin clasificar', () => {
    const final = [{ phase: 'TABLEAU' as const, roundKey: 'A2', aRef: 'team:1', bRef: 'team:2', aName: 'a', bName: 'b', scoreA: 30, scoreB: 45, winner: null }];
    expect(validarCuadroEquipos(final, equipos)).toMatch(/^final_contradice/);
    expect(validarCuadroEquipos([{ ...final[0], aRef: 'team:8', bRef: 'team:9', scoreA: 45, scoreB: 30, roundKey: 'A4' }], equipos)).toMatch(/^equipos_no_clasificados:2/);
    // Un solo equipo sin puesto publicado (retirado) se admite.
    expect(validarCuadroEquipos([{ ...final[0], bRef: 'team:9', scoreA: 45, scoreB: 30, roundKey: 'A4' }], equipos)).toBeNull();
  });

  it('el bronce publicado como «A2» en otra serie toma la letra de la serie', () => {
    const json = { tableau: [
      { suiteTableId: 'SuiteTab_A', rounds: { A2: [{ fencer1: lado(1, 45, true), fencer2: lado(2, 40, false) }] } },
      { suiteTableId: 'SuiteTab_B', rounds: { A2: [{ fencer1: lado(3, 45, true), fencer2: lado(4, 40, false) }] } },
    ] };
    const l = encuentrosCuadroFie(json, equipos);
    expect(l.bouts.map((b) => b.roundKey)).toEqual(['A2', 'B2']);
  });

  it('cuadro antiguo sin nombre de ronda: no hay encuentros que guardar', () => {
    const l = encuentrosCuadroFie({ tableau: [{ rounds: { '': [{ fencer1: lado(1, 45, true), fencer2: lado(2, 30, false) }] } }] }, equipos);
    expect(l).toMatchObject({ bouts: [], rondasSinNombre: 1 });
  });
});

describe('lote 8: turnos de red', () => {
  it('como mucho 2 en vuelo por anfitrión y pausa entre peticiones', async () => {
    let t = 0;
    const esperas: number[] = [];
    const turnos = new Turnos(2, () => 500, () => t, async (ms) => {
      esperas.push(ms);
      t += ms;
      await new Promise((r) => setTimeout(r, 0));
    });
    await turnos.entrar('a');
    const inicio1 = t;
    await turnos.entrar('a');
    expect(t - inicio1).toBeGreaterThanOrEqual(500);
    expect(turnos.enVueloDe('a')).toBe(2);
    const tercera = turnos.entrar('a');
    setTimeout(() => turnos.salir('a'), 0);
    await tercera;
    expect(turnos.enVueloDe('a')).toBe(2);
    expect(esperas.length).toBeGreaterThan(0);
  });
});

const asalto = (a: string, b: string, sa: number, sb: number, phase: 'POULE' | 'TABLEAU' = 'TABLEAU', roundKey = '?'): AsaltoHecho => ({
  phase, roundKey, aRef: a, bRef: b, aName: a, bName: b, scoreA: sa, scoreB: sb, winner: sa > sb ? 'A' : 'B',
});

describe('lote 8b: rondas del cuadro FIE por equipos', () => {
  const equipos = new Map<string, EquipoClasificado>(
    [['t1', 1], ['t2', 2], ['t3', 3], ['t4', 4], ['t5', 5], ['t6', 6], ['t7', 7], ['t8', 8]].map(([ref, puesto]) => [ref as string, { ref: ref as string, nombre: ref as string, puesto: puesto as number }]),
  );

  it('ronda de salida = potencia de 2 que contiene el puesto', () => {
    expect([1, 2, 3, 4, 5, 8, 9, 16].map(rondaDeSalida)).toEqual([1, 2, 4, 4, 8, 8, 16, 16]);
  });

  it('reconstruye A8/A4/A2 y los encuentros por puestos', () => {
    const r = reconstruirRondas([
      asalto('t1', 't8', 45, 30), asalto('t4', 't5', 45, 40), asalto('t3', 't6', 45, 41), asalto('t2', 't7', 45, 20),
      asalto('t1', 't4', 45, 44), asalto('t2', 't3', 45, 39), asalto('t1', 't2', 45, 43),
      asalto('t3', 't4', 45, 35), asalto('t5', 't6', 45, 30), asalto('t7', 't8', 45, 30),
    ], equipos);
    expect('bouts' in r).toBe(true);
    if (!('bouts' in r)) return;
    const rondas = r.bouts.map((b) => `${b.roundKey}:${b.aRef}-${b.bRef}`).sort();
    expect(rondas).toEqual(['A2:t1-t2', 'A4:t1-t4', 'A4:t2-t3', 'A8:t1-t8', 'A8:t2-t7', 'A8:t3-t6', 'A8:t4-t5', 'P3-4:t3-t4', 'P5-6:t5-t6', 'P7-8:t7-t8']);
  });

  it('rechaza un ganador que sale antes que el perdedor y una final que no es 1-2', () => {
    expect(reconstruirRondas([asalto('t5', 't2', 45, 40)], equipos)).toEqual({ motivo: 'ganador_sale_antes_que_el_perdedor' });
    expect(reconstruirRondas([asalto('t1', 't8', 45, 30)], equipos)).toEqual({ motivo: 'sin_final_unica_1_2' });
  });
});

describe('lote 8b: Juegos Mediterráneos', () => {
  it('atributos desde el código de la prueba', () => {
    expect(atributosDeCodigo('ef_cadet', null)).toEqual({ arma: 'ESPADA', genero: 'F', categoria: 'M17' });
    expect(atributosDeCodigo('sm_junior', null)).toEqual({ arma: 'SABLE', genero: 'M', categoria: 'M20' });
    expect(atributosDeCodigo('equipos', 'cadete')).toBeNull();
  });

  it('identifica por nombre y país y exige el mismo campeón', () => {
    const engarde = [
      { factKey: 'e1', name: 'ROSSI Mario', countryCode: 'ITA', club: null, position: 1, positionRaw: null, points: null, fieId: null, license: null, birthYear: null },
      { factKey: 'e2', name: 'GARCIA Juan', countryCode: 'ESP', club: null, position: 2, positionRaw: null, points: null, fieId: null, license: null, birthYear: null },
    ];
    const fie = [{ ref: 'f1', nombre: 'ROSSI Mario', pais: 'ITA', puesto: 1 }, { ref: 'f2', nombre: 'GARCIA Juan', pais: 'ESP', puesto: 2 }];
    const r = identificar(engarde, fie);
    expect('mapa' in r && [...r.mapa]).toEqual([['e1', 'f1'], ['e2', 'f2']]);
    expect(identificar(engarde, [{ ...fie[0], puesto: 2 }, { ...fie[1], puesto: 1 }])).toEqual({ motivo: 'campeon_distinto' });
  });
});

describe('lote 8b: PDF de la EFC', () => {
  it('detecta el generador', () => {
    expect(generadorDe(['Kneipp Cup', '© Ophardt Team Sportevent'])).toBe('ophardt');
    expect(generadorDe(['Poules, tour No 1'])).toBe('engarde');
    expect(generadorDe(['CDTMS', 'FE_FIE_0012', 'Place Name Country Birthdate'])).toBe('fencingtime');
  });

  it('traduce títulos de Engarde en francés e italiano', () => {
    expect(traducirItem('Classement général (ordre des rangs - 178 tireuses)')).toBe('Overall ranking (ordre des rangs - 178 fencers)');
    expect(traducirItem('Gironi, turno n° 1')).toBe('Poules, round n° 1');
    expect(traducirItem('Tableau de 64')).toBe('Tableau of 64');
    expect(traducirItem('Semi-finals')).toBe('Semifinals');
    expect(traducirItem('V/A')).toBe('V/M');
  });

  it('puestos con empates y saltos imposibles', () => {
    expect(puestosCoherentes([1, 2, 3, 3, 5, 6])).toBeNull();
    expect(puestosCoherentes([1, 2, 3, 3, 6])).toBe('salto_de_puesto_3_6');
    expect(puestosCoherentes([2, 3])).toBe('primer_puesto_no_es_1');
  });

  it('marcadores imposibles', () => {
    expect(marcadorImposible({ phase: 'POULE', scoreA: 5, scoreB: 3, winner: 'A' }, false)).toBeNull();
    expect(marcadorImposible({ phase: 'POULE', scoreA: 6, scoreB: 3, winner: 'A' }, false)).toBe('mas_de_5_tocados');
    expect(marcadorImposible({ phase: 'TABLEAU', scoreA: 16, scoreB: 3, winner: 'A' }, false)).toBe('mas_de_15_tocados');
    expect(marcadorImposible({ phase: 'TABLEAU', scoreA: 10, scoreB: 12, winner: 'A' }, false)).toBe('ganador_con_menos_tocados');
    expect(marcadorImposible({ phase: 'TABLEAU', scoreA: 45, scoreB: 40, winner: 'A' }, true)).toBeNull();
  });

  it('cuadro frente a la clasificación', () => {
    const puesto = new Map<string, number | null>([['a', 1], ['b', 2], ['c', 3], ['d', 3]]);
    expect(cuadroCoherente([asalto('a', 'c', 15, 10, 'TABLEAU', 'T4'), asalto('b', 'd', 15, 9, 'TABLEAU', 'T4'), asalto('a', 'b', 15, 14, 'TABLEAU', 'T2')], puesto)).toBeNull();
    // Semifinales tomadas por la final: el perdedor de «T2» es un 3.
    expect(cuadroCoherente([asalto('a', 'c', 15, 10, 'TABLEAU', 'T2')], puesto)).toBe('perdedor_de_T2_con_puesto_3');
    expect(cuadroCoherente([asalto('b', 'a', 15, 10, 'TABLEAU', 'T2')], new Map([['a', 2], ['b', 3]]))).toBe('ganador_de_la_final_no_es_1');
    expect(cuadroCoherente([asalto('a', 'c', 15, 10, 'TABLEAU', 'T4'), asalto('a', 'b', 15, 10, 'TABLEAU', 'T4')], puesto)).toBe('perdedor_de_T4_con_puesto_2');
  });

  it('país de una selección por su nombre', () => {
    expect(paisDeEquipo('RUSSIA 1')).toBe('RUS');
    expect(paisDeEquipo('HONGRIE')).toBe('HUN');
    expect(paisDeEquipo('ITA 2')).toBe('ITA');
    expect(paisDeEquipo('CLUB X')).toBeNull();
  });

  it('poule de Ophardt: fila con club y matriz que cuadra con V, TD y TR', () => {
    const paises = new Set(['GER', 'HUN', 'UKR']);
    const filas = [
      filaPouleOphardt('EVERS Larissa GER FC Tauber 1 V 2 1 7 8 0.500 -1 2.', 1, 3, paises, new Set()),
      filaPouleOphardt('FROMMER Eva HUN UTE 2 3 1 0 4 10 0.000 -6 3.', 2, 3, paises, new Set()),
      filaPouleOphardt('SOPIT Olga UKR 3 V V 2 10 3 1.000 7 1.', 3, 3, paises, new Set()),
    ];
    expect(filas.map((f) => f && `${f.nombre}|${f.pais}`)).toEqual(['EVERS Larissa|GER', 'FROMMER Eva|HUN', 'SOPIT Olga|UKR']);
    const r = asaltosPouleOphardt(filas.map((f) => f!), 5, 'P1');
    expect(r.motivo).toBeNull();
    expect(r.asaltos.map((a) => `${a.a.nombre}-${a.b.nombre} ${a.scoreA}:${a.scoreB} ${a.winner}`)).toEqual([
      'EVERS Larissa-FROMMER Eva 5:3 A', 'EVERS Larissa-SOPIT Olga 2:5 B', 'FROMMER Eva-SOPIT Olga 1:5 B',
    ]);
    const mal = filas.map((f) => ({ ...f!, td: f!.td + 1 }));
    expect(asaltosPouleOphardt(mal, 5, 'P1').motivo).toBe('totales_no_cuadran');
  });

  it('clasificación de FencingTime por columnas', () => {
    const it8 = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 4, h: 8 });
    const pagina = {
      numero: 1, ancho: 595, alto: 842,
      items: [
        it8('FE_FIE_0012', 221, 743),
        it8('Place', 37, 720), it8('Name', 100, 720), it8('Clubs', 250, 720), it8('Country', 372, 720), it8('Birthdate', 453, 720),
        it8('1', 37, 700), it8('LINDER, James', 100, 700), it8('KKSZ KONIN', 250, 700), it8('USA', 372, 700), it8('06.05.2002', 453, 700),
        it8('2T', 37, 690), it8('MARCIANO, Giorgio', 100, 690), it8('ITA', 372, 690), it8('09.01.2002', 453, 690),
        it8('2T', 37, 680), it8('SKEETE, Kamar', 100, 680), it8('USA', 372, 680),
      ],
    };
    const t = leerTablaClasificacion([pagina], (l) => l.some((x) => x.includes('FE_FIE_0012')));
    expect(t.rechazadas).toEqual([]);
    expect(t.puestos.map((p) => `${p.posicion}|${p.nombre}|${p.pais}|${p.club ?? ''}|${p.nacimiento ?? ''}`)).toEqual([
      '1|LINDER James|USA|KKSZ KONIN|2002', '2|MARCIANO Giorgio|ITA||2002', '2|SKEETE Kamar|USA||',
    ]);
  });

  it('quita las columnas de fecha y licencia de la clasificación de Engarde', () => {
    const it8 = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 4, h: 8 });
    const items = [
      it8('Overall ranking (ordered by ranking - 2 fencers)', 12, 760),
      it8('RANK', 22, 740), it8('NAME and first name', 51, 740), it8('NATION', 200, 740), it8('d.o.b.', 257, 740), it8('FIE lic.', 291, 740),
      it8('1', 35, 720), it8('PASTIN Andrei', 51, 720), it8('ROU', 200, 720), it8('7/5/2001', 244, 720), it8('00841761', 291, 720),
    ];
    const salida = sinColumnasAjenas(items, 760).map((i) => i.s);
    expect(salida).toEqual(['Overall ranking (ordered by ranking - 2 fencers)', 'RANK', 'NAME and first name', 'NATION', '1', 'PASTIN Andrei', 'ROU']);
  });
});
