import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import {
  casarUnico,
  fundirDuplicados,
  nombresCompatiblesRecorte,
  prepararNombre,
  revincularAsaltosPorPuesto,
} from '../scripts/indexado/dedupe-pruebas';
import { unificarPersonas } from '../scripts/indexado/unificar-personas';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let n = 0;
function puesto(db: DatabaseSync, comp: string, source: string, nombre: string, posicion: number | null, persona: string | null = null) {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash)
    VALUES (?,?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, `k${n}`, persona, nombre, posicion);
}
function asalto(db: DatabaseSync, comp: string, fase: 'POULE' | 'TABLEAU', ronda: string, an: string, sa: number, bn: string, sb: number,
  opciones: { id?: string; source?: string; a?: string | null; b?: string | null } = {}) {
  const id = opciones.id ?? `b${(n += 1)}`;
  const [ra, rb] = [`ref:${an}`, `ref:${bn}`];
  const [x, y] = ra < rb ? [{ r: ra, n: an, s: sa, p: opciones.a ?? null }, { r: rb, n: bn, s: sb, p: opciones.b ?? null }]
    : [{ r: rb, n: bn, s: sb, p: opciones.b ?? null }, { r: ra, n: an, s: sa, p: opciones.a ?? null }];
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id,
    fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, comp, opciones.source ?? 'rfee_pdf', fase, ronda, x.r, y.r, x.p, y.p, x.n, y.n, x.s, y.s, `h:${an}:${bn}:${sa}:${sb}`);
}
const cobertura = (db: DatabaseSync, source: string, kind: string, key: string, comp: string, status = 'completo') =>
  db.prepare(`INSERT INTO sport_import_coverage (source, season, fact_kind, competition_key, competition_id, status)
    VALUES (?, '2023-2024', ?, ?, ?, ?)`).run(source, kind, key, comp, status);

const SKERMO = ['ALEJANDRO RAMIREZ LARENA', 'JUAN ZABALA GUTIERREZ', 'MARIO DIAZ ESCALONA', 'SAHEL BRAVO FERNANDEZ', 'SAN KIM YUOM', 'ARNAU GUMA LEAL'];

/**
 * TNR del 3 de marzo: Skermo publica la clasificación con licencias (sin el extranjero del
 * puesto 5) y el PDF del día siguiente trae las poules y el cuadro con los nombres recortados
 * por la columna, más los puestos que `depurarSolapes` no supo atribuir.
 */
function fixture(): DatabaseSync {
  const db = crearBase();
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES
      ('es', 'skermo_rfee', '2023-2024', 'RFEE:1', 'TNR ABS (3/3)', '2024-03-03'),
      ('ep', 'rfee_pdf', '2023-2024', 'pdf:doc', 'TNR ABS', '2024-03-03'),
      ('eo', 'skermo_rfee', '2023-2024', 'RFEE:2', 'Otro TNR', '2024-03-03');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('cs', 'es', 'skermo_rfee', '2023-2024', 'RFEE:1', 'FLORETE', 'M', 'ABS', '2024-03-03'),
      ('cp', 'ep', 'rfee_pdf', '2023-2024', 'pdf:doc:FLORETE:M', 'FLORETE', 'M', 'ABS', '2024-03-04'),
      ('co', 'eo', 'skermo_rfee', '2023-2024', 'RFEE:2', 'SABLE', 'M', 'ABS', '2024-03-03');
    INSERT INTO sport_person (id, display_name, name_normalized, gender) VALUES
      ('p1','ALEJANDRO RAMIREZ LARENA','alejandro larena ramirez','M'), ('p2','JUAN ZABALA GUTIERREZ','gutierrez juan zabala','M'),
      ('p3','MARIO DIAZ ESCALONA','diaz escalona mario','M'), ('p4','SAHEL BRAVO FERNANDEZ','bravo fernandez sahel','M'),
      ('p5','SAN KIM YUOM','kim san yuom','M'), ('p6','ARNAU GUMA LEAL','arnau guma leal','M'),
      ('trunc','RAMIREZ LARENA Al','al larena ramirez','M');
    INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES
      ('p1','rfee_license','L1','skermo_rfee','CONFIRMADO'), ('p2','rfee_license','L2','skermo_rfee','CONFIRMADO');
    INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES
      ('trunc', 'rfee_pdf', 'RAMIREZ LARENA Al', 'al larena ramirez');`);
  SKERMO.forEach((nombre, i) => puesto(db, 'cs', 'skermo_rfee', nombre, i < 4 ? i + 1 : i + 2, `p${i + 1}`));
  cobertura(db, 'skermo_rfee', 'results', 'RFEE:1', 'cs');
  // Restos del PDF: el extranjero (puesto libre en Skermo), un nombre con errata en un puesto ocupado.
  puesto(db, 'cp', 'rfee_pdf', 'NAPOLITANO Isaia', 5);
  puesto(db, 'cp', 'rfee_pdf', 'KIM YOUM San', 6);
  puesto(db, 'cp', 'rfee_pdf', 'ZABALA GUTIERREZ Juan', 2);
  asalto(db, 'cp', 'POULE', 'P1', 'RAMIREZ LARENA Al', 5, 'ZABALA GUTIERREZ', 3, { a: 'trunc' });
  asalto(db, 'cp', 'POULE', 'P1', 'DIAZ ESCALONA M', 5, 'BRAVO FERNAND', 2);
  asalto(db, 'cp', 'POULE', 'P1', 'NAPOLITANO Isaia', 4, 'GUMA LEAL Arnau', 5);
  asalto(db, 'cp', 'TABLEAU', 'A2', 'ZABALA GUTIERRE', 15, 'RAMIREZ LARENA', 11, { b: 'trunc' });
  asalto(db, 'cp', 'TABLEAU', 'A4', 'RAMIREZ LARENA', 15, 'DIAZ ESCALONA M', 9);
  cobertura(db, 'rfee_pdf', 'results', 'pdf:doc:FLORETE:M', 'cp');
  cobertura(db, 'rfee_pdf', 'pools', 'pdf:doc:FLORETE:M', 'cp');
  cobertura(db, 'rfee_pdf', 'tableau', 'pdf:doc:FLORETE:M', 'cp', 'parcial');
  // Otra arma el mismo día: no es el mismo evento.
  SKERMO.forEach((nombre, i) => puesto(db, 'co', 'skermo_rfee', nombre, i + 1));
  return db;
}

const filas = (db: DatabaseSync, sql: string, ...p: string[]) => db.prepare(sql).all(...p);

describe('nombres recortados', () => {
  it('casa el nombre que el PDF corta al ancho de la columna con el completo', () => {
    const c = (a: string, b: string) => nombresCompatiblesRecorte(prepararNombre(a), prepararNombre(b));
    expect(c('RAMIREZ LARENA Al', 'ALEJANDRO RAMIREZ LARENA')).toBe(true);
    expect(c('ZABALA GUTIERRE', 'JUAN ZABALA GUTIERREZ')).toBe(true);
    expect(c('GARCIA LOPEZ', 'LOPEZ GARCIA')).toBe(true);
    expect(c('GARCIA', 'MARIA GARCIA LOPEZ')).toBe(false);
    expect(c('ZABALA GUTIERRE', 'JUAN ZABALA PEREZ')).toBe(false);
    // Sólo la última palabra puede venir recortada.
    expect(c('RAMIR LARENA', 'ALEJANDRO RAMIREZ LARENA')).toBe(false);
  });

  it('elige el exacto y descarta el recorte ambiguo', () => {
    const cands = ['MARIA GARCIA LOPEZ', 'MARTA GARCIA LOPEZ', 'GARCIA LOPEZ'].map(prepararNombre);
    expect(casarUnico(prepararNombre('LOPEZ GARCIA'), cands)).toBe(2);
    expect(casarUnico(prepararNombre('GARCIA LOPEZ M'), cands)).toBeNull();
    // «GARCIA LOPEZ» también cabe en «GARCIA LOPEZ Mari»: sin él, sólo queda María.
    expect(casarUnico(prepararNombre('GARCIA LOPEZ Mari'), cands)).toBeNull();
    expect(casarUnico(prepararNombre('GARCIA LOPEZ Mari'), cands.slice(0, 2))).toBe(0);
  });
});

describe('fundirDuplicados', () => {
  it('deja una prueba con los puestos de Skermo y los asaltos del PDF', () => {
    const db = fixture();
    const inf = fundirDuplicados(db);
    expect(inf).toMatchObject({
      grupos: 1, fasesTrasladadas: 2, asaltosTrasladados: 5, resultadosDuplicadosBorrados: 2, resultadosTrasladados: 1,
      resultadosPuestoOcupado: 1, competicionesBorradas: 1, edicionesBorradas: 1,
    });
    expect(filas(db, `SELECT id FROM sport_competition ORDER BY id`)).toEqual([{ id: 'co' }, { id: 'cs' }]);
    expect(filas(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cs'`)).toEqual([{ n: 5 }]);
    // El extranjero que Skermo no lista entra en su puesto; la errata «KIM YOUM» del puesto 6 sobra.
    expect(filas(db, `SELECT source, source_name, position FROM sport_result WHERE competition_id='cs' AND source='rfee_pdf'`))
      .toEqual([{ source: 'rfee_pdf', source_name: 'NAPOLITANO Isaia', position: 5 }]);
    // La cobertura de poules y cuadro pasa a la prueba que queda; la de puestos del PDF desaparece.
    expect(filas(db, `SELECT source, fact_kind, status, imported_total FROM sport_import_coverage WHERE competition_id='cs' ORDER BY fact_kind, source`))
      .toEqual([
        { source: 'rfee_pdf', fact_kind: 'pools', status: 'completo', imported_total: 3 },
        { source: 'skermo_rfee', fact_kind: 'results', status: 'completo', imported_total: 0 },
        { source: 'rfee_pdf', fact_kind: 'tableau', status: 'parcial', imported_total: 2 },
      ]);
    expect(filas(db, `SELECT count(*) n FROM sport_import_coverage WHERE competition_key='pdf:doc:FLORETE:M' AND fact_kind='results'`)).toEqual([{ n: 0 }]);
    // La final se vincula con los puestos de Skermo, también por encima de la persona creada por el nombre recortado.
    const final = filas(db, `SELECT fencer_a_name, fencer_a_person_id a, fencer_b_name, fencer_b_person_id b FROM sport_bout WHERE round_key='A2'`)[0] as Record<string, string>;
    const porNombre = { [final.fencer_a_name]: final.a, [final.fencer_b_name]: final.b };
    expect(porNombre).toEqual({ 'ZABALA GUTIERRE': 'p2', 'RAMIREZ LARENA': 'p1' });
    expect(inf.revinculo.ladosRevinculados).toBe(2);
    expect(filas(db, `SELECT count(*) n FROM sport_bout WHERE fencer_a_person_id='trunc' OR fencer_b_person_id='trunc'`)).toEqual([{ n: 0 }]);
    expect(filas(db, `SELECT count(*) n FROM sport_result WHERE competition_id='co'`)).toEqual([{ n: 6 }]);
  });

  it('es idempotente aunque el cargador vuelva a crear la prueba del PDF', () => {
    const db = fixture();
    fundirDuplicados(db);
    const ids = filas(db, `SELECT id FROM sport_bout WHERE competition_id='cs' ORDER BY id`);
    expect(fundirDuplicados(db)).toMatchObject({ grupos: 0, competicionesBorradas: 0 });
    // Recarga: la misma lectura del PDF con las mismas claves en una prueba nueva.
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES ('ep2', 'rfee_pdf', '2023-2024', 'pdf:doc', 'TNR ABS', '2024-03-03');
      INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('cp2', 'ep2', 'rfee_pdf', '2023-2024', 'pdf:doc:FLORETE:M', 'FLORETE', 'M', 'ABS', '2024-03-04');`);
    puesto(db, 'cp2', 'rfee_pdf', 'NAPOLITANO Isaia', 5);
    asalto(db, 'cp2', 'POULE', 'P1', 'RAMIREZ LARENA Al', 5, 'ZABALA GUTIERREZ', 3);
    asalto(db, 'cp2', 'POULE', 'P1', 'DIAZ ESCALONA M', 5, 'BRAVO FERNAND', 2);
    asalto(db, 'cp2', 'POULE', 'P1', 'NAPOLITANO Isaia', 4, 'GUMA LEAL Arnau', 5);
    asalto(db, 'cp2', 'TABLEAU', 'A2', 'ZABALA GUTIERRE', 15, 'RAMIREZ LARENA', 11);
    asalto(db, 'cp2', 'TABLEAU', 'A4', 'RAMIREZ LARENA', 15, 'DIAZ ESCALONA M', 9);
    db.prepare(`UPDATE sport_import_coverage SET competition_id='cp2' WHERE competition_key='pdf:doc:FLORETE:M'`).run();
    const inf = fundirDuplicados(db);
    expect(inf).toMatchObject({ grupos: 1, fasesTrasladadas: 0, asaltosTrasladados: 0, competicionesBorradas: 1, resultadosDuplicadosBorrados: 1 });
    expect(filas(db, `SELECT id FROM sport_bout WHERE competition_id='cs' ORDER BY id`)).toEqual(ids);
    expect(filas(db, `SELECT count(*) n FROM sport_import_coverage WHERE competition_id='cs' AND source='rfee_pdf'`)).toEqual([{ n: 2 }]);
  });

  it('no une dos pruebas cuyas poules no se parecen (rondas distintas)', () => {
    const db = fixture();
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('eq', 'rfee_pdf', '2023-2024', 'pdf:otro', 'TNR 2ª vuelta');
      INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('cq', 'eq', 'rfee_pdf', '2023-2024', 'pdf:otro:FLORETE:M', 'FLORETE', 'M', 'ABS', '2024-03-03');`);
    asalto(db, 'cq', 'POULE', 'P1', 'GUMA LEAL Arnau', 1, 'KIM YUOM San', 5);
    asalto(db, 'cq', 'POULE', 'P1', 'GUMA LEAL Arnau', 2, 'BRAVO FERNANDEZ Sahel', 5);
    asalto(db, 'cq', 'POULE', 'P1', 'KIM YUOM San', 0, 'BRAVO FERNANDEZ Sahel', 5);
    asalto(db, 'cq', 'POULE', 'P1', 'ZABALA GUTIERREZ Juan', 4, 'DIAZ ESCALONA Mario', 5);
    const inf = fundirDuplicados(db);
    expect(inf.gruposOmitidosRondasDistintas).toBe(1);
    expect(filas(db, `SELECT count(*) n FROM sport_competition WHERE id IN ('cp','cq')`)).toEqual([{ n: 2 }]);
    expect(filas(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cs'`)).toEqual([{ n: 0 }]);
  });

  it('no toca dos pruebas de Engarde del mismo torneo (primera fase y fase final)', () => {
    const db = crearBase();
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
        ('e1', 'engarde', '2015-2016', 'engarde:fce/t1', 'TNR'), ('e2', 'engarde', '2015-2016', 'engarde:fce/t2', 'TNR');
      INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
        ('g1', 'e1', 'engarde', '2015-2016', 'engarde:fce/t1/em1', 'ESPADA', 'M', 'ABS', '2016-02-06'),
        ('g2', 'e2', 'engarde', '2015-2016', 'engarde:fce/t2/em2', 'ESPADA', 'M', 'ABS', '2016-02-06');`);
    SKERMO.forEach((nombre, i) => {
      puesto(db, 'g1', 'engarde', nombre, i + 1);
      puesto(db, 'g2', 'engarde', nombre, i + 1);
    });
    expect(fundirDuplicados(db).grupos).toBe(0);
  });

  it('va dentro de unificar-personas, después de depurar los solapes', () => {
    const db = fixture();
    const inf = unificarPersonas(db);
    expect(inf.duplicados).toMatchObject({ grupos: 1, competicionesBorradas: 1 });
    expect(filas(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cs'`)).toEqual([{ n: 5 }]);
    // La persona que sólo existía por el nombre recortado se queda sin nada y se borra.
    expect(filas(db, `SELECT id FROM sport_person WHERE id='trunc'`)).toEqual([]);
    const segunda = unificarPersonas(db);
    expect(segunda.duplicados).toMatchObject({ grupos: 0, competicionesBorradas: 0 });
    expect(segunda.revinculo.ladosRevinculados + segunda.revinculo.ladosVinculadosNuevos).toBe(0);
  });
});

describe('revincularAsaltosPorPuesto', () => {
  it('no sustituye un vínculo a una persona con identificador', () => {
    const db = fixture();
    asalto(db, 'cs', 'POULE', 'P9', 'ZABALA GUTIERREZ', 5, 'RAMIREZ LARENA Al', 1, { source: 'rfee_pdf', a: 'p1', b: null });
    const inf = revincularAsaltosPorPuesto(db, ['cs']);
    expect(inf).toMatchObject({ pruebas: 0, ladosRevinculados: 0, ladosVinculadosNuevos: 0 });
    const b = filas(db, `SELECT fencer_a_name an, fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE round_key='P9'`)[0] as Record<string, string>;
    // p1 (con licencia) se queda aunque el nombre diga Zabala, y el otro lado no puede repetir persona.
    expect(b.an === 'ZABALA GUTIERREZ' ? [b.a, b.b] : [b.b, b.a]).toEqual(['p1', null]);
  });
});
