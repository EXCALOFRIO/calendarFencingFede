import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { AsaltoBase } from '../scripts/indexado/lote10-pdf-auditar';
import {
  correccionesVueltas, decidirPoule, planCobertura, separarVueltas, type Correcciones11, type Lectura11, type PoulePdf11,
} from '../scripts/indexado/lote11-pdf-auditar';
import { aplicarCorrecciones11, comprobarPoules } from '../scripts/indexado/lote11-pdf-sustituir';

/** Matriz del PDF a partir de los tocados de cada fila; `prioridad` marca ganador al de la fila en un empate. */
function poulePdf(ronda: string, nombres: string[], tocados: number[][], extra: Partial<PoulePdf11> = {}, prioridad: [number, number][] = []): PoulePdf11 {
  const n = nombres.length;
  const gana = (i: number, j: number) => tocados[i][j] > tocados[j][i] || prioridad.some(([a, b]) => a === i && b === j);
  return {
    pagina: 1, yMax: 700, ronda, sinResolver: 0, retirados: [], prioridad: prioridad.length, prueba: 'PRUEBA', ...extra,
    filas: nombres.map((nombre, i) => ({ y: i, nombre, club: null, celdas: [], vm: 0, ind: 0, td: 0 })),
    celdas: tocados.map((f, i) => f.map((t, j) => (i === j ? { gana: false, puntos: null } : { gana: gana(i, j), puntos: t }))).slice(0, n),
  };
}

const asalto = (ronda: string, aRef: string, bRef: string, sa: number, sb: number, nombres: Record<string, string>): AsaltoBase => ({
  id: `${ronda}${aRef}${bRef}`, competicion: 'c1', fase: 'POULE', ronda, aRef, bRef, aNombre: nombres[aRef], bNombre: nombres[bRef],
  aPersona: null, bPersona: null, sa, sb, url: 'u',
});
const lectura = (poules: PoulePdf11[]): Lectura11 => ({ poules, rechazadas: [], pruebas: [] });

const N = { a: 'ALFA UNO Ana', b: 'BRAVO DOS Bea', c: 'CHARLIE TRES Cris', d: 'DELTA CUATRO Dora', e: 'ECO CINCO Eva', w: 'WHISKY SEIS Wen' };
/** A gana a B 5-3 y a C 5-1; B gana a C 5-4. */
const T3 = [[0, 5, 5], [3, 0, 5], [1, 4, 0]];

describe('decisión sobre una poule guardada', () => {
  const pdf = poulePdf('P1', [N.a, N.b, N.c], T3);
  it('coincide, o se corrige con la matriz entera', () => {
    const bien = [asalto('P1', 'a', 'b', 5, 3, N), asalto('P1', 'a', 'c', 5, 1, N), asalto('P1', 'b', 'c', 5, 4, N)];
    expect(decidirPoule(bien, lectura([pdf]), false).tipo).toBe('coincide');
    const mal = [asalto('P1', 'a', 'b', 5, 2, N), ...bien.slice(1)];
    const r = decidirPoule(mal, lectura([pdf]), false);
    expect(r.tipo).toBe('corregir');
  });
  it('una victoria por prioridad con los tocados iguales deja la poule dudosa', () => {
    const empate = poulePdf('P1', [N.a, N.b, N.c], [[0, 5, 3], [3, 0, 5], [3, 4, 0]], {}, [[0, 2]]);
    const bs = [asalto('P1', 'a', 'b', 5, 3, N), asalto('P1', 'a', 'c', 4, 3, N), asalto('P1', 'b', 'c', 5, 4, N)];
    expect(decidirPoule(bs, lectura([empate]), false)).toMatchObject({ tipo: 'dudosa', motivo: 'victoria_por_prioridad_con_tocados_iguales' });
  });
  it('un tirador guardado sin fila sólo pierde sus asaltos si el PDF lo da por retirado', () => {
    const bs = [asalto('P1', 'a', 'b', 5, 3, N), asalto('P1', 'a', 'c', 5, 1, N), asalto('P1', 'b', 'c', 5, 4, N), asalto('P1', 'a', 'w', 5, 0, N)];
    expect(decidirPoule(bs, lectura([pdf]), false)).toMatchObject({ tipo: 'dudosa', motivo: 'tirador_guardado_sin_fila_en_el_pdf' });
    const conRetirado = { ...pdf, retirados: ['WHISKY SEIS W'] };
    const r = decidirPoule(bs, lectura([conRetirado]), false);
    expect(r.tipo).toBe('corregir');
    expect(r.tipo === 'corregir' && r.contraste.diferencias).toEqual([{ tipo: 'sobra', id: 'P1aw', aRef: 'a', bRef: 'w', antes: [5, 0] }]);
  });
});

describe('poule guardada que reúne dos vueltas', () => {
  // Vuelta 1: a, b, c (T3). Vuelta 2: c, d, e; C gana a D 5-2 y a E 4-3; D gana a E 5-0.
  const v1 = poulePdf('P1', [N.a, N.b, N.c], T3);
  const v2 = poulePdf('V2P1', [N.c, N.d, N.e], [[0, 5, 4], [2, 0, 5], [3, 0, 0]]);
  const guardada = [
    asalto('P1', 'a', 'b', 5, 3, N), asalto('P1', 'a', 'c', 5, 1, N), asalto('P1', 'b', 'c', 5, 4, N),
    asalto('P1', 'c', 'd', 5, 2, N), asalto('P1', 'c', 'e', 5, 3, N), asalto('P1', 'd', 'e', 5, 0, N),
  ];
  it('se separa: la parte de la otra vuelta se traslada a su ronda con el marcador del PDF', () => {
    expect(decidirPoule(guardada, lectura([v1, v2]), false)).toMatchObject({ tipo: 'dudosa', motivo: 'sin_pareja_pdf' });
    const s = separarVueltas(guardada, lectura([v1, v2]), new Set(['P1']));
    expect(typeof s).toBe('object');
    const fases = correccionesVueltas({ source: 's', season: 't', competition_key: 'k' }, 'P1', 'u', (s as Exclude<typeof s, string>).partes);
    expect(fases).toHaveLength(1);
    expect(fases[0]).toMatchObject({ ronda: 'V2P1', cambios: [
      { tipo: 'traslado', aRef: 'c', bRef: 'd', desde: 'P1', antes: [5, 2], despues: [5, 2] },
      { tipo: 'traslado', aRef: 'c', bRef: 'e', desde: 'P1', antes: [5, 3], despues: [4, 3] },
      { tipo: 'traslado', aRef: 'd', bRef: 'e', desde: 'P1', antes: [5, 0], despues: [5, 0] },
    ] });
  });
  it('no se separa si la ronda de destino ya tiene asaltos, ni con matrices de pruebas distintas', () => {
    expect(separarVueltas(guardada, lectura([v1, v2]), new Set(['P1', 'V2P1']))).toBe('ronda_de_destino_ocupada');
    expect(separarVueltas(guardada, lectura([v1, { ...v2, prueba: 'OTRA' }]), new Set(['P1']))).toBe('sin_vueltas_que_casen');
  });
  it('un asalto guardado entre tiradores de vueltas distintas lo impide', () => {
    expect(separarVueltas([...guardada, asalto('P1', 'a', 'd', 5, 1, N)], lectura([v1, v2]), new Set(['P1']))).toBe('asalto_guardado_entre_vueltas');
  });
});

describe('cobertura que deja el lote', () => {
  const comp = { source: 'rfee_pdf', season: '2024-2025', competitionKey: 'k' };
  it('vuelve a completo lo que bajó el lote 10 y ya está resuelto; no toca lo que no cambia; baja lo nuevo', () => {
    const otra = { ...comp, competitionKey: 'k2' };
    const nueva = { ...comp, competitionKey: 'k3' };
    const plan = planCobertura(
      [{ competicion: comp, kind: 'pools', detalle: ['P1:incompleta'] }, { competicion: otra, kind: 'pools', detalle: ['P2:incompleta'] }],
      new Set(['rfee_pdf|2024-2025|k|pools|P1']),
      [{ competicion: nueva, kind: 'pools', ronda: 'P3', motivo: 'victoria_por_prioridad_con_tocados_iguales' }],
    );
    expect(plan).toEqual([
      { competicion: comp, kind: 'pools', estado: 'completo', motivo: null },
      { competicion: nueva, kind: 'pools', estado: 'parcial', motivo: 'lote11: relectura del PDF sin evidencia completa (P3:victoria_por_prioridad_con_tocados_iguales)' },
    ]);
  });
});

describe('sustitución en memoria', () => {
  const base = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE sport_competition (id TEXT PRIMARY KEY, source TEXT, season TEXT, competition_key TEXT);
      CREATE TABLE sport_bout (id TEXT PRIMARY KEY, competition_id TEXT, source TEXT, phase TEXT, round_key TEXT, fencer_a_ref TEXT, fencer_b_ref TEXT,
        fencer_a_person_id TEXT, fencer_b_person_id TEXT, fencer_a_name TEXT, fencer_b_name TEXT, score_a INT, score_b INT, occurred_on TEXT, source_url TEXT,
        content_hash TEXT, revision INT, first_seen_at INT, revised_at INT);
      CREATE UNIQUE INDEX k ON sport_bout (competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref);
      CREATE TABLE sport_import_coverage (id TEXT PRIMARY KEY, source TEXT, fact_kind TEXT, competition_id TEXT, status TEXT, last_error TEXT, updated_at INT);
      INSERT INTO sport_competition VALUES ('c1', 'rfee_pdf', '2024-2025', 'k');
      INSERT INTO sport_bout VALUES ('b1', 'c1', 'rfee_pdf', 'POULE', 'P1', 'c', 'd', 'pc', 'pd', 'C', 'D', 5, 2, '2024-10-05', 'u', 'h', 1, 0, 0);
      INSERT INTO sport_bout VALUES ('b2', 'c1', 'rfee_pdf', 'POULE', 'P1', 'c', 'e', 'pc', 'pe', 'C', 'E', 5, 3, '2024-10-05', 'u', 'h', 1, 0, 0);
      INSERT INTO sport_import_coverage VALUES ('k1', 'rfee_pdf', 'pools', 'c1', 'parcial', 'lote10: relectura del PDF sin evidencia completa (P1:incompleta)', 0);`);
    return db;
  };
  const competicion = { source: 'rfee_pdf', season: '2024-2025', competitionKey: 'k' };
  const correcciones: Correcciones11 = {
    generado: '', base: '', parciales: [],
    fases: [{ competicion, url: 'u', fase: 'POULE', ronda: 'V2P1', extractor: 'droid', evidencia: { pagina: 1, yMax: 700, filas: [], matriz: [] }, cambios: [
      { tipo: 'traslado', aRef: 'c', bRef: 'd', desde: 'P1', antes: [5, 2], despues: [5, 2] },
      { tipo: 'traslado', aRef: 'c', bRef: 'e', desde: 'P1', antes: [5, 3], despues: [4, 3] },
      { tipo: 'alta', aRef: 'd', bRef: 'e', aNombre: 'D', bNombre: 'E', aPersona: 'pd', bPersona: 'pe', despues: [5, 0] },
    ] }],
    cobertura: [{ competicion, kind: 'pools', estado: 'completo', motivo: null }],
  };

  it('traslada a la otra vuelta, da de alta lo que faltaba, restaura la cobertura del lote 10 y es idempotente', () => {
    const db = base();
    const inf = aplicarCorrecciones11(db, correcciones);
    expect(inf).toMatchObject({ aplicadas: 1, obsoletas: [], cambios: { 'POULE:traslado': 2, 'POULE:alta': 1 }, cobertura: { restaurada: 1 } });
    expect(db.prepare(`SELECT id, round_key r, score_a a, score_b b, revision FROM sport_bout ORDER BY fencer_a_ref, fencer_b_ref`).all().map((x) => ({ ...x, id: x.id === 'b1' || x.id === 'b2' ? x.id : 'nuevo' })))
      .toEqual([
        { id: 'b1', r: 'V2P1', a: 5, b: 2, revision: 2 },
        { id: 'b2', r: 'V2P1', a: 4, b: 3, revision: 2 },
        { id: 'nuevo', r: 'V2P1', a: 5, b: 0, revision: 1 },
      ]);
    expect(db.prepare(`SELECT status, last_error FROM sport_import_coverage`).get()).toEqual({ status: 'completo', last_error: null });
    expect(comprobarPoules(db, correcciones.fases)).toEqual({ poules: 2, malas: [] });
    expect(aplicarCorrecciones11(db, correcciones)).toMatchObject({ aplicadas: 0, yaAplicadas: 1, cambios: {} });
  });

  it('si el destino ya tiene el asalto o el marcador cambió, la fase entera se salta', () => {
    const db = base();
    db.exec(`UPDATE sport_bout SET score_b = 1 WHERE id = 'b2'`);
    const inf = aplicarCorrecciones11(db, correcciones);
    expect(inf.aplicadas).toBe(0);
    expect(inf.obsoletas).toEqual([{ prueba: 'k', fase: 'POULE', ronda: 'V2P1', motivo: 'marcador_cambiado:5-1' }]);
    expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE round_key='P1'`).get()).toEqual({ n: 2 });
  });

  it('una alta que no se puede hacer deshace también los traslados de la fase', () => {
    const db = base();
    db.exec(`INSERT INTO sport_bout VALUES ('b3', 'c1', 'rfee_pdf', 'POULE', 'V2P1', 'd', 'e', 'pd', 'pe', 'D', 'E', 2, 5, '2024-10-05', 'u', 'h', 1, 0, 0)`);
    const inf = aplicarCorrecciones11(db, correcciones);
    expect(inf.aplicadas).toBe(0);
    expect(inf.obsoletas[0].motivo).toBe('alta_ya_existe:2-5');
    expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE round_key='P1'`).get()).toEqual({ n: 2 });
  });
});
