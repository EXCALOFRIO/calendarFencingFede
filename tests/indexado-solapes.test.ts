import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import { depurarSolapes, medirSolapes } from '../scripts/indexado/medir-solapes';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let n = 0;
const res = (db: DatabaseSync, comp: string, source: string, persona: string | null) =>
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, content_hash)
    VALUES (?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, `k${n}`, persona, `NOMBRE ${n}`);
const asalto = (db: DatabaseSync, comp: string, source: string, a: string, b: string) =>
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
    fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, content_hash)
    VALUES (?,?,?, 'POULE', 'P1', ?,?,?,?, 'A', 'B', 5, 3, 'h')`).run(`b${(n += 1)}`, comp, source, `a${n}`, `b${n}`, a, b);

/**
 * cs (skermo, con asaltos) ↔ cq y cr (PDF del mismo día siguiente, dos tablas del documento).
 * ct (skermo, sin asaltos) ↔ cu (PDF). cv (PDF) tiene más vinculados que cw (skermo).
 */
function fixture(): DatabaseSync {
  const db = crearBase();
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES
      ('es', 'skermo_rfee', '2024-2025', 'RFEE:1', 'TNR', '2025-01-11'),
      ('ep', 'rfee_pdf', '2024-2025', 'pdf:x', 'TNR PDF', '2025-01-12');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('cs', 'es', 'skermo_rfee', '2024-2025', 'RFEE:1', 'ESPADA', 'F', 'ABS', '2025-01-11'),
      ('cq', 'ep', 'rfee_pdf', '2024-2025', 'pdf:x:ESPADA:F', 'ESPADA', 'F', 'ABS', '2025-01-12'),
      ('cr', 'ep', 'rfee_pdf', '2024-2025', 'pdf:x:ESPADA:F~2', 'ESPADA', 'F', 'ABS', '2025-01-12'),
      ('ct', 'es', 'skermo_rfee', '2024-2025', 'RFEE:2', 'SABLE', 'F', 'ABS', '2025-01-11'),
      ('cu', 'ep', 'rfee_pdf', '2024-2025', 'pdf:x:SABLE:F', 'SABLE', 'F', 'ABS', '2025-01-12'),
      ('cw', 'es', 'skermo_rfee', '2024-2025', 'RFEE:3', 'FLORETE', 'F', 'ABS', '2025-01-11'),
      ('cv', 'ep', 'rfee_pdf', '2024-2025', 'pdf:x:FLORETE:F', 'FLORETE', 'F', 'ABS', '2025-01-12');
    INSERT INTO sport_person (id, display_name, name_normalized) VALUES
      ('p1','A','a'), ('p2','B','b'), ('p3','C','c'), ('p4','D','d'), ('p2b','B','b');
    UPDATE sport_person SET merged_into_person_id='p2' WHERE id='p2b';
    INSERT INTO sport_import_coverage (source, season, fact_kind, competition_key, competition_id, status) VALUES
      ('rfee_pdf', '2024-2025', 'results', 'pdf:x:ESPADA:F~2', 'cr', 'completo'),
      ('rfee_pdf', '2024-2025', 'pools', 'pdf:x:ESPADA:F~2', 'cr', 'completo');`);
  for (const p of ['p1', 'p2', 'p3']) res(db, 'cs', 'skermo_rfee', p);
  asalto(db, 'cs', 'skermo_rfee', 'p1', 'p2');
  res(db, 'cq', 'rfee_pdf', 'p1');
  res(db, 'cq', 'rfee_pdf', 'p2b');
  res(db, 'cq', 'rfee_pdf', 'p4');
  res(db, 'cq', 'rfee_pdf', null);
  asalto(db, 'cq', 'rfee_pdf', 'p1', 'p2b');
  asalto(db, 'cq', 'rfee_pdf', 'p1', 'p4');
  res(db, 'cr', 'rfee_pdf', 'p3');
  asalto(db, 'cr', 'rfee_pdf', 'p3', 'p1');
  for (const p of ['p1', 'p2']) res(db, 'ct', 'skermo_rfee', p);
  res(db, 'cu', 'rfee_pdf', 'p1');
  res(db, 'cu', 'rfee_pdf', 'p2');
  asalto(db, 'cu', 'rfee_pdf', 'p1', 'p2');
  res(db, 'cw', 'skermo_rfee', 'p1');
  for (const p of ['p1', 'p2']) res(db, 'cv', 'rfee_pdf', p);
  return db;
}

const filas = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

describe('depurarSolapes', () => {
  it('quita de la PDF lo que ya está en skermo y borra la prueba que queda vacía', () => {
    const db = fixture();
    expect(medirSolapes(db).skermo_rfee.pares).toBe(4);
    const inf = depurarSolapes(db);
    expect(inf).toEqual({
      pares: 4, paresAplicados: 3, paresOmitidosPdfMayor: 1, resultadosBorrados: 5, asaltosBorrados: 2,
      paresSinAsaltosSkermo: 1, competicionesBorradas: 1, edicionesBorradas: 0, coberturasBorradas: 2,
    });
    // cq: quedan p4 y el puesto sin vincular; el asalto p1-p4 sigue porque p4 no está en skermo.
    expect(filas(db, `SELECT person_id p FROM sport_result WHERE competition_id='cq' ORDER BY p`)).toEqual([{ p: null }, { p: 'p4' }]);
    expect(filas(db, `SELECT fencer_b_person_id b FROM sport_bout WHERE competition_id='cq'`)).toEqual([{ b: 'p4' }]);
    expect(filas(db, `SELECT id FROM sport_competition WHERE id='cr'`)).toEqual([]);
    expect(filas(db, `SELECT id FROM sport_import_coverage WHERE competition_key LIKE 'pdf:x:ESPADA:F~2'`)).toEqual([]);
    // cu: skermo no trae asaltos, así que el asalto PDF se conserva.
    expect(filas(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cu'`)).toEqual([{ n: 0 }]);
    expect(filas(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cu'`)).toEqual([{ n: 1 }]);
    // cv tiene más puestos vinculados que cw: no se toca.
    expect(filas(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cv'`)).toEqual([{ n: 2 }]);
    expect(filas(db, `SELECT count(*) n FROM sport_result WHERE source='skermo_rfee'`)).toEqual([{ n: 6 }]);
  });

  it('borra también la edición que se queda sin pruebas', () => {
    const db = fixture();
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date)
        VALUES ('ep2', 'rfee_pdf', '2024-2025', 'pdf:y', 'TNR PDF 2', '2025-01-12');
      UPDATE sport_competition SET edition_id='ep2' WHERE id='cr';`);
    expect(depurarSolapes(db)).toMatchObject({ competicionesBorradas: 1, edicionesBorradas: 1 });
    expect(filas(db, `SELECT id FROM sport_edition WHERE source='rfee_pdf' ORDER BY id`)).toEqual([{ id: 'ep' }]);
  });

  it('es idempotente', () => {
    const db = fixture();
    depurarSolapes(db);
    expect(depurarSolapes(db)).toMatchObject({ paresAplicados: 0, resultadosBorrados: 0, asaltosBorrados: 0, competicionesBorradas: 0 });
  });
});
