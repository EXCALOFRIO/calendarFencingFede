import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { detectarPartesSueltas, nombresConjuntables, registrarConjuntas, vincularAsaltosConjuntas } from '../scripts/indexado/dedupe-conjuntas';
import { cargarPruebasNacionales } from '../scripts/indexado/dedupe-pruebas';
import { planConjuntas13 } from '../scripts/indexado/lote13-conjuntas';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let n = 0;
function prueba(db: DatabaseSync, id: string, source: string, o: { cat?: string; genero?: string; arma?: string; fecha?: string } = {}) {
  db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES (?,?,'2025-2026',?,?,?)`)
    .run(`e-${id}`, source, `t:${id}`, `Torneo ${id}`, o.fecha ?? '2026-06-27');
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
    VALUES (?,?,?,'2025-2026',?,?,?,?,'INDIVIDUAL',?)`).run(id, `e-${id}`, source, `k:${id}`, o.arma ?? 'ESPADA', o.genero ?? 'F', o.cat ?? 'VET', o.fecha ?? '2026-06-27');
}
function persona(db: DatabaseSync, id: string, nombre: string) {
  db.prepare(`INSERT OR IGNORE INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,'F','ESP')`)
    .run(id, nombre, normalizarNombre(nombre));
}
function puesto(db: DatabaseSync, comp: string, source: string, nombre: string, pos: number, personaId: string | null) {
  if (personaId) persona(db, personaId, nombre);
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash)
    VALUES (?,?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, `ref:${nombre}:${n}`, personaId, nombre, pos);
}
function asalto(db: DatabaseSync, comp: string, an: string, bn: string, sa = 5, sb = 2) {
  const [x, y] = an < bn ? [an, bn] : [bn, an];
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name,
    score_a, score_b, content_hash) VALUES (?,?,'engarde','POULE','P1',?,?,?,?,?,?,?)`).run(`b${(n += 1)}`, comp, `ref:${x}`, `ref:${y}`, x, y, sa, sb, `h${n}`);
}
/** Poule completa entre los nombres dados. */
function poule(db: DatabaseSync, comp: string, nombres: readonly string[]) {
  for (let i = 0; i < nombres.length; i += 1) for (let j = i + 1; j < nombres.length; j += 1) asalto(db, comp, nombres[i], nombres[j]);
}
const todas = <T>(db: DatabaseSync, sql: string) => db.prepare(sql).all() as T[];
const uno = <T>(db: DatabaseSync, sql: string) => db.prepare(sql).get() as T;

const V30 = ['GARCIA MARTINEZ Raquel', 'ULAN Ainur'];
const V40 = ['ALONSO ESCOBAR Cristina', 'GRAU TORRES Ana', 'ZURITA SILVESTRO Maria Pia', 'KOTOVA Irina'];
const V50 = ['VARGAS HILLA Cristina', 'DE MIGUEL GARCIA Susana', 'TEBAR MARTINEZ Nuria'];

/**
 * Campeonato de España de veteranos 2026, espada F: Engarde tiró juntos VET30 y VET40 y la
 * unificación fundió la lectura con el tramo VET40 de Skermo (asaltos y, como trasladados, los
 * puestos de las dos de VET30). VET50 se tiró aparte y no tiene asaltos leídos.
 */
function veteranosFundidos(db: DatabaseSync) {
  prueba(db, 's30', 'skermo_rfee');
  prueba(db, 's40', 'skermo_rfee');
  prueba(db, 's50', 'skermo_rfee');
  V30.forEach((nm, i) => puesto(db, 's30', 'skermo_rfee', nm, i + 1, `p30${i}`));
  V40.forEach((nm, i) => puesto(db, 's40', 'skermo_rfee', nm, i + 1, `p40${i}`));
  V50.forEach((nm, i) => puesto(db, 's50', 'skermo_rfee', nm, i + 1, `p50${i}`));
  // Trasladados por fundirDuplicados desde la lectura de Engarde: repiten el puesto de VET30.
  V30.forEach((nm, i) => puesto(db, 's40', 'engarde', nm, i + 5, `p30${i}`));
  poule(db, 's40', [...V30, ...V40]);
}

describe('lote 13: partes sueltas de veteranos', () => {
  it('tramo anfitrión de Skermo: enlaza el tramo sin asaltos, borra los puestos repetidos y conserva los propios', () => {
    const db = crearBase();
    veteranosFundidos(db);
    const plan = planConjuntas13(db);
    expect(plan.insertar.map((f) => [f.parte, f.conjunta, f.regla])).toEqual([['s30', 's40', 'partes']]);
    expect(plan.puestosBorrar).toBe(2);
    const { informe, ids } = registrarConjuntas(db);
    // La anfitriona es una clasificación oficial: sigue entrando en la fusión de duplicados.
    expect([...ids]).toEqual([]);
    expect(informe).toMatchObject({ partesSueltas: 1, filasInsertadas: 1, puestosAnfitrionaBorrados: 2, puestosDesvinculados: 0, asaltosParteRepetidos: 0 });
    expect(todas(db, `SELECT part_competition_id p, combined_competition_id c, rule r, shared_names s FROM sport_competition_combined`))
      .toEqual([{ p: 's30', c: 's40', r: 'partes', s: 2 }]);
    expect(uno(db, `SELECT count(*) n FROM sport_result WHERE competition_id='s40' AND person_id IS NOT NULL`)).toEqual({ n: 4 });
    expect(uno(db, `SELECT count(*) n FROM sport_result WHERE competition_id='s40' AND source='engarde'`)).toEqual({ n: 0 });
    // Sin asaltos nuevos ni copiados: los de la parte siguen en la anfitriona.
    expect(uno(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='s30'`)).toEqual({ n: 0 });
    expect(uno(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='s40'`)).toEqual({ n: 15 });
    const v = vincularAsaltosConjuntas(db);
    expect(v.ladosVinculados).toBeGreaterThan(0);
    expect(uno(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='s40' AND (fencer_a_name LIKE 'ULAN%' AND fencer_a_person_id='p301'
      OR fencer_b_name LIKE 'ULAN%' AND fencer_b_person_id='p301')`)).toEqual({ n: 5 });
    // Idempotente.
    const otra = registrarConjuntas(db).informe;
    expect(otra).toMatchObject({ filasInsertadas: 0, filasActualizadas: 0, filasBorradas: 0, puestosAnfitrionaBorrados: 0 });
    expect(planConjuntas13(db).insertar).toEqual([]);
  });

  it('PDF que clasifica juntos los tramos: enlaza las partes y quita la persona sólo a quien la tiene en una parte', () => {
    const db = crearBase();
    prueba(db, 'pdf', 'rfee_pdf', { arma: 'SABLE' });
    prueba(db, 'k40', 'skermo_rfee', { arma: 'SABLE' });
    prueba(db, 'k50', 'skermo_rfee', { arma: 'SABLE' });
    const todos = [...V40, ...V50, 'SOLA PDF Extranjera'];
    todos.forEach((nm, i) => puesto(db, 'pdf', 'rfee_pdf', nm, i + 1, `q${i}`));
    V40.forEach((nm, i) => puesto(db, 'k40', 'skermo_rfee', nm, i + 1, `q${i}`));
    V50.forEach((nm, i) => puesto(db, 'k50', 'skermo_rfee', nm, i + 1, `q${i + 4}`));
    poule(db, 'pdf', todos);
    const { informe } = registrarConjuntas(db);
    expect(informe).toMatchObject({ partesSueltas: 1, filasInsertadas: 2, puestosAnfitrionaBorrados: 0, puestosDesvinculados: 7 });
    expect(todas(db, `SELECT part_competition_id p, combined_competition_id c FROM sport_competition_combined ORDER BY p`))
      .toEqual([{ p: 'k40', c: 'pdf' }, { p: 'k50', c: 'pdf' }]);
    // La que sólo sale en el PDF conserva su único resultado.
    expect(todas(db, `SELECT source_name n FROM sport_result WHERE competition_id='pdf' AND person_id IS NOT NULL`)).toEqual([{ n: 'SOLA PDF Extranjera' }]);
    expect(registrarConjuntas(db).informe).toMatchObject({ filasInsertadas: 0, filasBorradas: 0, puestosDesvinculados: 0 });
  });

  it('no enlaza copias, Criterium, tramos con asaltos ni tramos que no tiraron en la anfitriona', () => {
    const db = crearBase();
    veteranosFundidos(db);
    // Copia de la clasificación del PDF (una sola parte que la cubre): es un duplicado, no una parte.
    prueba(db, 'pdf', 'rfee_pdf', { arma: 'SABLE' });
    prueba(db, 'copia', 'skermo_rfee', { arma: 'SABLE' });
    V50.forEach((nm, i) => { puesto(db, 'pdf', 'rfee_pdf', nm, i + 1, null); puesto(db, 'copia', 'skermo_rfee', nm, i + 1, null); });
    poule(db, 'pdf', V50);
    // El mismo caso que s30/s40 en Criterium M11: no se toca.
    prueba(db, 'c1', 'rfee_pdf', { cat: 'M11', genero: 'M' });
    prueba(db, 'c2', 'rfee_pdf', { cat: 'M11', genero: 'M' });
    puesto(db, 'c1', 'rfee_pdf', 'NINO UNO Pablo', 1, null);
    ['NINO DOS Luis', 'NINO TRES Hugo', 'NINO CUATRO Iker'].forEach((nm, i) => puesto(db, 'c2', 'rfee_pdf', nm, i + 1, null));
    poule(db, 'c2', ['NINO UNO Pablo', 'NINO DOS Luis', 'NINO TRES Hugo', 'NINO CUATRO Iker']);
    const { puestos, asaltos } = nombresConjuntables(db);
    const det = detectarPartesSueltas(cargarPruebasNacionales(db), puestos, asaltos);
    expect(det.conjuntas.map((c) => [c.conjunta.id, c.anfitriona, c.partes.map((x) => x.prueba.id)])).toEqual([['s40', 'tramo', ['s30']]]);
    // Con un asalto propio el tramo ya no está suelto.
    asalto(db, 's30', V30[0], V30[1]);
    const otra = detectarPartesSueltas(cargarPruebasNacionales(db), nombresConjuntables(db).puestos, nombresConjuntables(db).asaltos);
    expect(otra.conjuntas).toEqual([]);
  });

  it('un tramo que casa con dos anfitrionas queda ambiguo', () => {
    const db = crearBase();
    veteranosFundidos(db);
    prueba(db, 's40b', 'skermo_rfee');
    ['OTRA UNA Elena', 'OTRA DOS Marta'].forEach((nm, i) => puesto(db, 's40b', 'skermo_rfee', nm, i + 1, null));
    poule(db, 's40b', [...V30, 'OTRA UNA Elena', 'OTRA DOS Marta']);
    const { puestos, asaltos } = nombresConjuntables(db);
    const det = detectarPartesSueltas(cargarPruebasNacionales(db), puestos, asaltos);
    expect(det.conjuntas).toEqual([]);
    expect(det.ambiguas.sort()).toEqual(['s40', 's40b']);
  });
});
