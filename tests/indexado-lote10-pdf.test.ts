import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  asignarNombres, auditarCuadro, auditarPoule, contrastarPoule, mismoNombre, topeDe, type AsaltoBase, type CorreccionFase, type PoulePdf,
} from '../scripts/indexado/lote10-pdf-auditar';
import { aplicarCorrecciones } from '../scripts/indexado/lote10-pdf-sustituir';
import { decidirMiembro, diccionarioGenero, generoDeNombre, nombresDePila } from '../scripts/indexado/separar-genero';

const asalto = (ronda: string, aRef: string, bRef: string, sa: number, sb: number, nombres: Record<string, string> = {}, id = `${ronda}${aRef}${bRef}`): AsaltoBase => ({
  id, competicion: 'c', fase: ronda.startsWith('P') ? 'POULE' : 'TABLEAU', ronda, aRef, bRef, aNombre: nombres[aRef] ?? aRef, bNombre: nombres[bRef] ?? bRef,
  aPersona: null, bPersona: null, sa, sb, url: 'u',
});

describe('coherencia interna de una poule guardada', () => {
  it('todos contra todos limpio: sin problemas; victorias por tiempo aparte', () => {
    const l = [asalto('P1', 'a', 'b', 5, 3), asalto('P1', 'a', 'c', 4, 2), asalto('P1', 'b', 'c', 5, 0)];
    expect(auditarPoule(l, 5)).toMatchObject({ tiradores: 3, asaltos: 3, esperados: 3, problemas: {}, bajoTope: 1 });
  });
  it('pareja repetida, empate, tanteo sobre el tope e incompleta', () => {
    const l = [asalto('P1', 'a', 'b', 5, 3), asalto('P1', 'b', 'a', 4, 4), asalto('P1', 'a', 'c', 6, 2)];
    expect(auditarPoule(l, 5).problemas).toEqual({ pareja_repetida: 1, empate: 1, ganador_sobre_tope: 1, incompleta: 1 });
  });
  it('el tope de la vuelta es el tanteo de victoria más repetido', () => {
    expect(topeDe([{ sa: 5, sb: 1 }, { sa: 2, sb: 5 }, { sa: 4, sb: 3 }])).toBe(5);
    expect(topeDe([{ sa: 10, sb: 1 }, { sa: 2, sb: 10 }, { sa: 4, sb: 3 }])).toBe(10);
  });
});

describe('cuadro guardado frente a la clasificación', () => {
  it('la final con el ganador en el puesto 2 no cuadra', () => {
    const puesto = (r: string) => ({ a: 1, b: 2, c: 3, d: 3 } as Record<string, number>)[r];
    const ok = auditarCuadro([asalto('A4', 'a', 'c', 15, 10), asalto('A4', 'b', 'd', 15, 3), asalto('A2', 'a', 'b', 15, 14)], puesto);
    expect(ok.problemas).toEqual({});
    const mal = auditarCuadro([asalto('A4', 'a', 'c', 15, 10), asalto('A4', 'b', 'd', 15, 3), asalto('A2', 'a', 'b', 13, 15)], puesto);
    expect(mal.problemas.final_no_cuadra).toBe(1);
  });
});

describe('casado de nombres guardados con las filas de la matriz del PDF', () => {
  it('nombre recortado, club pegado al nombre y homónimos sin asignar', () => {
    expect(mismoNombre('CUBELA MORILLO Ca', 'CUBELA MORILLO Carmen Laia')).toBe(true);
    expect(mismoNombre('TABERNA RAMON Maria', 'TABERNA RAMON Ma CEL-M')).toBe(true);
    expect(asignarNombres(['GARCIA LOPEZ Ana', 'PEREZ RUIZ'], ['PEREZ RUIZ Luis', 'GARCIA LOPEZ A'])).toEqual([1, 0]);
    expect(asignarNombres(['SANCHEZ CORBELLA', 'OTRA PERSONA'], ['SANCHEZ CORBELLA Sofia', 'SANCHEZ CORBELLA Celia'])).toEqual([null, null]);
  });
});

/** Poule de tres: A gana a B 5-3 y a C 5-1; B gana a C 5-4. */
const pdf: PoulePdf = {
  pagina: 2, yMax: 700, ronda: 'P1', sinResolver: 0,
  filas: [
    { y: 1, nombre: 'ALFA UNO Ana', club: null, celdas: [], vm: 1, ind: 6, td: 10 },
    { y: 2, nombre: 'BRAVO DOS Bea', club: null, celdas: [], vm: 0.5, ind: 1, td: 8 },
    { y: 3, nombre: 'CHARLIE TRES Cris', club: null, celdas: [], vm: 0, ind: -7, td: 5 },
  ],
  celdas: [
    [{ gana: false, puntos: null }, { gana: true, puntos: 5 }, { gana: true, puntos: 5 }],
    [{ gana: false, puntos: 3 }, { gana: false, puntos: null }, { gana: true, puntos: 5 }],
    [{ gana: false, puntos: 1 }, { gana: false, puntos: 4 }, { gana: false, puntos: null }],
  ],
};
const NOMBRES = { a: 'ALFA UNO An', b: 'BRAVO DOS Be', c: 'CHARLIE TRES Cr' };

describe('contraste de una poule guardada con la matriz del PDF', () => {
  it('coincide cuando todo es igual', () => {
    const l = [asalto('P1', 'a', 'b', 5, 3, NOMBRES), asalto('P1', 'a', 'c', 5, 1, NOMBRES), asalto('P1', 'b', 'c', 5, 4, NOMBRES)];
    expect(contrastarPoule(l, [pdf])).toMatchObject({ estado: 'coincide', completa: true, comparados: 3, diferencias: [] });
  });
  it('un marcador distinto y un asalto que falta: diferencias con la evidencia completa', () => {
    const l = [asalto('P1', 'a', 'b', 5, 4, NOMBRES), asalto('P1', 'a', 'c', 5, 1, NOMBRES)];
    const c = contrastarPoule(l, [pdf]);
    expect(c.estado).toBe('difiere');
    expect(c.completa).toBe(true);
    expect(c.diferencias).toEqual([
      { tipo: 'marcador', id: 'P1ab', aRef: 'a', bRef: 'b', antes: [5, 4], despues: [5, 3], cambiaGanador: false },
      { tipo: 'falta', aRef: 'b', bRef: 'c', aNombre: 'BRAVO DOS Bea', bNombre: 'CHARLIE TRES Cris', despues: [5, 4] },
    ]);
  });
  it('sin una matriz que case con la poule no hay contraste', () => {
    expect(contrastarPoule([asalto('P1', 'x', 'y', 5, 0)], [pdf]).estado).toBe('sin_pareja_pdf');
  });
});

describe('sustitución en una copia de trabajo', () => {
  const base = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE sport_competition (id TEXT PRIMARY KEY, source TEXT, season TEXT, competition_key TEXT);
      CREATE TABLE sport_bout (id TEXT PRIMARY KEY, competition_id TEXT, source TEXT, phase TEXT, round_key TEXT, fencer_a_ref TEXT, fencer_b_ref TEXT,
        fencer_a_person_id TEXT, fencer_b_person_id TEXT, fencer_a_name TEXT, fencer_b_name TEXT, score_a INT, score_b INT, occurred_on TEXT, source_url TEXT,
        content_hash TEXT, revision INT, first_seen_at INT, revised_at INT);
      CREATE UNIQUE INDEX k ON sport_bout (competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref);
      CREATE TABLE sport_import_coverage (id TEXT PRIMARY KEY, source TEXT, fact_kind TEXT, competition_id TEXT, status TEXT, last_error TEXT, updated_at INT);
      INSERT INTO sport_competition VALUES ('c1', 'skermo_rfee', '2026-2027', 'RFEE:1');
      INSERT INTO sport_bout VALUES ('b1', 'c1', 'rfee_pdf', 'POULE', 'P1', 'a', 'b', 'pa', 'pb', 'A', 'B', 5, 4, '2026-09-27', 'u', 'h', 1, 0, 0);
      INSERT INTO sport_bout VALUES ('b2', 'c1', 'rfee_pdf', 'POULE', 'P1', 'a', 'c', 'pa', 'pc', 'A', 'C', 5, 1, '2026-09-27', 'u', 'h', 1, 0, 0);
      INSERT INTO sport_bout VALUES ('b3', 'c1', 'rfee_pdf', 'POULE', 'P2', 'd', 'e', NULL, NULL, 'D', 'E', 5, 2, '2026-09-27', 'u', 'h', 1, 0, 0);
      INSERT INTO sport_import_coverage VALUES ('k1', 'rfee_pdf', 'pools', 'c1', 'completo', NULL, 0);`);
    return db;
  };
  const competicion = { source: 'skermo_rfee', season: '2026-2027', competitionKey: 'RFEE:1' };
  const fase: CorreccionFase = {
    competicion, url: 'u', fase: 'POULE', ronda: 'P1', extractor: 'droid',
    cambios: [
      { tipo: 'marcador', aRef: 'a', bRef: 'b', antes: [5, 4], despues: [5, 3] },
      { tipo: 'alta', aRef: 'b', bRef: 'c', aNombre: 'B', bNombre: 'C', aPersona: 'pb', bPersona: 'pc', despues: [5, 4] },
    ],
    evidencia: { pagina: 2, yMax: 700, filas: [], matriz: [] },
  };

  it('corrige el marcador, da de alta lo perdido con las personas de la poule, marca lo dudoso y es idempotente', () => {
    const db = base();
    const inf = aplicarCorrecciones(db, { generado: '', base: '', fases: [fase], parciales: [{ competicion, kind: 'pools', detalle: ['P2:incompleta'] }] });
    expect(inf).toMatchObject({ aplicadas: 1, obsoletas: [], cambios: { 'POULE:marcador': 1, 'POULE:alta': 1 }, parciales: { marcadas: 1 } });
    expect(db.prepare(`SELECT score_a, score_b, revision FROM sport_bout WHERE id='b1'`).get()).toEqual({ score_a: 5, score_b: 3, revision: 2 });
    expect(db.prepare(`SELECT fencer_a_person_id a, fencer_b_person_id b, score_a, score_b, occurred_on FROM sport_bout WHERE fencer_a_ref='b' AND fencer_b_ref='c'`).get())
      .toEqual({ a: 'pb', b: 'pc', score_a: 5, score_b: 4, occurred_on: '2026-09-27' });
    expect(db.prepare(`SELECT status FROM sport_import_coverage`).get()).toEqual({ status: 'parcial' });
    const otra = aplicarCorrecciones(db, { generado: '', base: '', fases: [fase], parciales: [] });
    expect(otra).toMatchObject({ aplicadas: 0, yaAplicadas: 1, cambios: {} });
  });

  it('si la base ya no está como la vio la auditoría, la fase entera se salta', () => {
    const db = base();
    db.exec(`UPDATE sport_bout SET score_b = 2 WHERE id = 'b1'`);
    const inf = aplicarCorrecciones(db, { generado: '', base: '', fases: [fase], parciales: [] });
    expect(inf.aplicadas).toBe(0);
    expect(inf.obsoletas).toEqual([{ prueba: 'RFEE:1', fase: 'POULE', ronda: 'P1', motivo: 'marcador_cambiado:5-2' }]);
    expect(db.prepare(`SELECT count(*) n FROM sport_bout`).get()).toEqual({ n: 3 });
  });
});

describe('género de un nombre y decisión de separar', () => {
  const dic = diccionarioGenero([
    ...Array.from({ length: 12 }, (_, i) => ({ nombre: `APELLIDO${i} UNO Maria Jose`, genero: 'F' as const })),
    ...Array.from({ length: 12 }, (_, i) => ({ nombre: `APELLIDO${i} DOS Jose Maria`, genero: 'M' as const })),
    ...Array.from({ length: 12 }, (_, i) => ({ nombre: `APELLIDO${i} TRES Julian`, genero: 'M' as const })),
    ...Array.from({ length: 12 }, (_, i) => ({ nombre: `APELLIDO${i} CUATRO Julia`, genero: 'F' as const })),
  ]);
  it('manda la primera palabra del nombre de pila; un nombre todo en mayúsculas no da género', () => {
    expect(nombresDePila('DIAZ ESCALONA Maria Teresa')).toEqual(['maria', 'teresa']);
    expect(generoDeNombre('DIAZ ESCALONA Maria Jose', dic)).toBe('F');
    expect(generoDeNombre('GARCIA Jose Maria', dic)).toBe('M');
    expect(generoDeNombre('ALDANA JULIAN NAIARA', dic)).toBeNull();
  });
  it('un nombre que puede ser el recorte de otro del otro género no decide («Julia» de «Julian»)', () => {
    expect(generoDeNombre('ROMERO REVILLA Julia', dic)).toBeNull();
  });
  it('se separa por el nombre, no por las filas: las pruebas mixtas se publican como masculinas', () => {
    const base = { esRaiz: false, genero: 'M', filas: { M: 15, F: 0 }, fieCompartido: false };
    expect(decidirMiembro({ ...base, nombre: 'F' }, 'M')).toBe('separar');
    expect(decidirMiembro({ ...base, nombre: 'F' }, 'F')).toBe('corregir_genero');
    expect(decidirMiembro({ ...base, nombre: null }, 'F')).toBe('revisar');
    expect(decidirMiembro({ ...base, nombre: 'F', fieCompartido: true }, 'M')).toBe('conflicto_fie');
  });
});
