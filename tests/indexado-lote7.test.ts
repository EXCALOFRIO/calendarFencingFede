import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cargarHechos, estadosDocumento, type EntradaHechos } from '../scripts/indexado/cargar-hechos';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { anomaliasLectura, elegirLectura, type AsaltoLectura, type Lectura } from '../scripts/indexado/dedupe-lecturas';
import { detectarConjuntas, registrarConjuntas } from '../scripts/indexado/dedupe-conjuntas';
import { cargarPruebasNacionales, fundirDuplicados } from '../scripts/indexado/dedupe-pruebas';
import { depurarSolapesEngarde } from '../scripts/indexado/medir-solapes';
import { abrirComparacion, tablasPresentes } from '../scripts/indexado/sincronizar-d1';
import { ALIAS_EFC, unificarPersonas } from '../scripts/indexado/unificar-personas';
import { vincularAsaltos } from '../scripts/indexado/vincular-asaltos';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let n = 0;
function edicion(db: DatabaseSync, id: string, source: string, fecha: string) {
  db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES (?,?,'2023-2024',?,?,?)`)
    .run(id, source, `t:${id}`, `Torneo ${id}`, fecha);
}
function prueba(db: DatabaseSync, id: string, ed: string, source: string, o: { arma?: string; genero?: string; cat?: string; fecha?: string } = {}) {
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
    VALUES (?,?,?,'2023-2024',?,?,?,?,'INDIVIDUAL',?)`).run(id, ed, source, `k:${id}`, o.arma ?? 'SABLE', o.genero ?? 'M', o.cat ?? 'VET', o.fecha ?? '2024-01-31');
}
function puesto(db: DatabaseSync, comp: string, source: string, nombre: string, pos: number | null, o: { persona?: string | null; clave?: string; pais?: string | null } = {}) {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_country_code, position, content_hash)
    VALUES (?,?,?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, o.clave ?? `ref:${nombre}`, o.persona ?? null, nombre, o.pais ?? 'ESP', pos);
}
function asalto(db: DatabaseSync, comp: string, source: string, fase: 'POULE' | 'TABLEAU', ronda: string, an: string, sa: number, bn: string, sb: number) {
  const [ra, rb] = [`ref:${an}`, `ref:${bn}`];
  const [x, y] = ra < rb ? [{ r: ra, n: an, s: sa }, { r: rb, n: bn, s: sb }] : [{ r: rb, n: bn, s: sb }, { r: ra, n: an, s: sa }];
  const id = `b${(n += 1)}`;
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name,
    score_a, score_b, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, comp, source, fase, ronda, x.r, y.r, x.n, y.n, x.s, y.s, `h${id}`);
  return id;
}
const uno = <T>(db: DatabaseSync, sql: string, ...p: string[]) => db.prepare(sql).get(...p) as T;
const todas = <T>(db: DatabaseSync, sql: string, ...p: string[]) => db.prepare(sql).all(...p) as T[];

const A = (fase: 'POULE' | 'TABLEAU', ronda: string, a: string, sa: number, b: string, sb: number): AsaltoLectura =>
  ({ fase, ronda, a, b, nombreA: a, nombreB: b, tocadosA: sa, tocadosB: sb });

describe('lecturas: marcadores imposibles y elección', () => {
  it('detecta 5-5, empate, perdedor que sigue y perdedor por delante', () => {
    expect(anomaliasLectura([A('POULE', 'P1', 'X', 5, 'Y', 5), A('POULE', 'P1', 'X', 3, 'Z', 3), A('POULE', 'P1', 'Y', 5, 'Z', 2)]))
      .toEqual({ asaltos: 2, tipos: { ambos_cinco: 1, empate: 1 } });
    // Relevos de equipos en poule (a 45): 45-38 no es un marcador imposible.
    expect(anomaliasLectura([A('POULE', 'P1', 'ESP', 45, 'ITA', 38), A('POULE', 'P1', 'FRA', 40, 'ESP', 45)]).asaltos).toBe(0);
    // B pierde el T4 y tira el T2; A gana el T4 y no sale en el T2 completo.
    const cuadro = [A('TABLEAU', 'T4', 'A', 10, 'B', 5), A('TABLEAU', 'T4', 'C', 10, 'D', 2), A('TABLEAU', 'T2', 'B', 10, 'C', 8)];
    expect(anomaliasLectura(cuadro)).toEqual({ asaltos: 1, tipos: { ganador_incoherente: 1 } });
    // Final con ganador y perdedor cambiados: el campeón figura como perdedor.
    const puestos = new Map([['DE FRANCISCO', 1], ['VICO', 2]]);
    const puestoDe = (nm: string) => (puestos.has(nm) ? { grupo: 'c', puesto: puestos.get(nm)! } : null);
    expect(anomaliasLectura([A('TABLEAU', 'T2', 'VICO', 10, 'DE FRANCISCO', 5)], puestoDe).tipos).toEqual({ perdedor_por_delante: 1 });
    expect(anomaliasLectura([A('TABLEAU', 'T2', 'DE FRANCISCO', 10, 'VICO', 5)], puestoDe).asaltos).toBe(0);
  });

  it('ordena por asaltos válidos, anomalías, Engarde y destino', () => {
    const l = (ref: string, asaltos: number, anomalias: number, engarde: boolean, destino = false): Lectura<string> =>
      ({ ref, asaltos, anomalias, engarde, destino });
    expect(elegirLectura([l('pdf', 15, 0, false, true), l('eng', 15, 0, true)])).toMatchObject({ ganadora: { ref: 'eng' }, motivo: 'engarde' });
    expect(elegirLectura([l('pdf', 5, 1, false, true), l('eng', 5, 0, true)])).toMatchObject({ ganadora: { ref: 'eng' }, motivo: 'anomalias' });
    expect(elegirLectura([l('pdf', 16, 0, false), l('eng', 15, 0, true)])).toMatchObject({ ganadora: { ref: 'pdf' }, motivo: 'mas_asaltos' });
    expect(elegirLectura([l('pdf', 16, 2, false), l('eng', 15, 0, true)])).toMatchObject({ ganadora: { ref: 'eng' }, motivo: 'anomalias' });
    expect(elegirLectura([l('ya', 15, 0, true, true), l('otra', 15, 0, true)])).toMatchObject({ ganadora: { ref: 'ya' }, motivo: 'destino' });
  });
});

/**
 * Sable masculino veteranos (31/1): Skermo publica la clasificación; la lectura del PDF (ya en
 * la prueba de Skermo) trae la final con ganador y perdedor cambiados; Engarde trae lo mismo bien.
 */
const VETERANOS = ['DE FRANCISCO GONZALEZ Cesar', 'VICO GOMEZ Pedro', 'REDONDO BERMEJO Jose Luis', 'CARNICER ALFONSO Pedro', 'ROSADO OLARAN Jose'];
function veteranos(db: DatabaseSync, comp: string, source: string, finalBien: boolean) {
  const [a, b, c, d, e] = VETERANOS;
  asalto(db, comp, source, 'POULE', 'P1', a, 5, b, 4);
  asalto(db, comp, source, 'POULE', 'P1', c, 5, d, 1);
  asalto(db, comp, source, 'POULE', 'P1', e, 5, c, 2);
  asalto(db, comp, source, 'TABLEAU', 'T4', b, 10, c, 7);
  asalto(db, comp, source, 'TABLEAU', 'T4', a, 10, d, 6);
  if (finalBien) asalto(db, comp, source, 'TABLEAU', 'T2', a, 10, b, 5);
  else asalto(db, comp, source, 'TABLEAU', 'T2', b, 10, a, 5);
}

describe('fundirDuplicados: lectura de cada fase', () => {
  it('a igualdad prefiere Engarde y nunca una final imposible', () => {
    const db = crearBase();
    edicion(db, 'es', 'skermo_rfee', '2024-01-31');
    edicion(db, 'ee', 'engarde', '2024-01-31');
    prueba(db, 'cs', 'es', 'skermo_rfee');
    prueba(db, 'ce', 'ee', 'engarde');
    VETERANOS.forEach((nm, i) => puesto(db, 'cs', 'skermo_rfee', nm.toUpperCase(), i === 3 ? 3 : i + 1));
    VETERANOS.forEach((nm, i) => puesto(db, 'ce', 'engarde', nm, i === 3 ? 3 : i + 1));
    veteranos(db, 'cs', 'rfee_pdf', false);
    veteranos(db, 'ce', 'engarde', true);
    const inf = fundirDuplicados(db);
    expect(inf.grupos).toBe(1);
    expect(inf.lecturas.porMotivo).toEqual({ engarde: 1, anomalias: 1 });
    expect(inf.lecturas.anomalias).toEqual({ perdedor_por_delante: 1 });
    expect(inf.lecturas.anomaliasConservadas).toBe(0);
    expect(todas(db, `SELECT phase, source, count(*) n FROM sport_bout WHERE competition_id='cs' GROUP BY 1,2 ORDER BY 1`))
      .toEqual([{ phase: 'POULE', source: 'engarde', n: 3 }, { phase: 'TABLEAU', source: 'engarde', n: 3 }]);
    // Recarga: Engarde vuelve con la misma lectura y la destino ya la tiene.
    edicion(db, 'ee2', 'engarde', '2024-01-31');
    prueba(db, 'ce2', 'ee2', 'engarde');
    VETERANOS.forEach((nm, i) => puesto(db, 'ce2', 'engarde', nm, i + 1));
    veteranos(db, 'ce2', 'engarde', true);
    const ids = todas<{ id: string }>(db, `SELECT id FROM sport_bout WHERE competition_id='cs' ORDER BY id`);
    const otra = fundirDuplicados(db);
    expect(otra.lecturas.porMotivo).toEqual({ destino: 2 });
    expect(todas(db, `SELECT id FROM sport_bout WHERE competition_id='cs' ORDER BY id`)).toEqual(ids);
  });
});

describe('depurarSolapesEngarde: empate de lecturas', () => {
  it('Engarde sustituye a una lectura del PDF igual de completa, pero no a otra de Engarde', () => {
    const db = crearBase();
    edicion(db, 'es', 'skermo_rfee', '2024-01-31');
    edicion(db, 'ee', 'engarde', '2024-01-31');
    prueba(db, 'cs', 'es', 'skermo_rfee');
    prueba(db, 'ce', 'ee', 'engarde');
    VETERANOS.forEach((nm, i) => puesto(db, 'cs', 'skermo_rfee', nm, i + 1));
    VETERANOS.forEach((nm, i) => puesto(db, 'ce', 'engarde', nm, i + 1));
    veteranos(db, 'cs', 'rfee_pdf', true);
    veteranos(db, 'ce', 'engarde', true);
    const inf = depurarSolapesEngarde(db);
    expect(inf).toMatchObject({ fasesSustituidas: 2, fasesDescartadas: 0, competicionesBorradas: 1 });
    expect(inf.lecturas.porMotivo).toEqual({ engarde: 2 });
    expect(uno(db, `SELECT count(*) n FROM sport_bout WHERE competition_id='cs' AND source='engarde'`)).toEqual({ n: 6 });
    const ids = todas(db, `SELECT id FROM sport_bout ORDER BY id`);
    edicion(db, 'ee2', 'engarde', '2024-01-31');
    prueba(db, 'ce2', 'ee2', 'engarde');
    VETERANOS.forEach((nm, i) => puesto(db, 'ce2', 'engarde', nm, i + 1));
    veteranos(db, 'ce2', 'engarde', true);
    const otra = depurarSolapesEngarde(db);
    expect(otra).toMatchObject({ fasesSustituidas: 0, fasesDescartadas: 2 });
    expect(todas(db, `SELECT id FROM sport_bout ORDER BY id`)).toEqual(ids);
  });
});

const NINOS = ['PABLO ARIAS MORA', 'LUIS BENITEZ CANO', 'HUGO CASTRO DIEZ', 'IKER DURAN ESTEBAN'];
const NINAS = ['ANA ESPINOSA FUENTES', 'EVA FERRER GALAN', 'SOL GARRIDO HERRERO', 'LUZ HIDALGO IBANEZ'];

/** Criterium M11 que Engarde tira mixto y el PDF clasifica por sexo, con las dos partes vinculadas. */
function criterium(db: DatabaseSync) {
  edicion(db, 'ep', 'rfee_pdf', '2024-06-15');
  edicion(db, 'ee', 'engarde', '2024-06-15');
  prueba(db, 'pm', 'ep', 'rfee_pdf', { genero: 'M', cat: 'M11', fecha: '2024-06-15' });
  prueba(db, 'pf', 'ep', 'rfee_pdf', { genero: 'F', cat: 'M11', fecha: '2024-06-15' });
  prueba(db, 'cj', 'ee', 'engarde', { genero: 'MIXTO', cat: 'M11', fecha: '2024-06-15' });
  [...NINOS, ...NINAS].forEach((nm, i) => {
    const g = i < 4 ? 'M' : 'F';
    db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,?,'ESP')`)
      .run(`p${i}`, nm, normalizarNombre(nm), g);
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'rfee_license', ?, 'skermo_rfee', 'CONFIRMADO')`)
      .run(`p${i}`, `L${i}`);
    puesto(db, i < 4 ? 'pm' : 'pf', 'rfee_pdf', nm, (i % 4) + 1, { persona: `p${i}` });
    puesto(db, 'cj', 'engarde', nm.split(' ').reverse().join(' '), i + 1);
  });
  const ids = [
    asalto(db, 'cj', 'engarde', 'POULE', 'P1', 'MORA ARIAS PABLO', 5, 'FUENTES ESPINOSA ANA', 3),
    asalto(db, 'cj', 'engarde', 'POULE', 'P1', 'CANO BENITEZ LUIS', 2, 'GALAN FERRER EVA', 5),
    asalto(db, 'cj', 'engarde', 'POULE', 'P1', 'MORA ARIAS PABLO', 5, 'CANO BENITEZ LUIS', 4),
    asalto(db, 'cj', 'engarde', 'TABLEAU', 'T2', 'MORA ARIAS PABLO', 10, 'GALAN FERRER EVA', 8),
  ];
  return ids;
}

describe('pruebas conjuntas', () => {
  it('detecta las partes de un Criterium mixto y no confunde un duplicado normal', () => {
    const db = crearBase();
    criterium(db);
    // Duplicado normal: la clasificación de Engarde es la misma que la del PDF.
    edicion(db, 'ep2', 'rfee_pdf', '2024-06-16');
    edicion(db, 'ee2', 'engarde', '2024-06-16');
    prueba(db, 'px', 'ep2', 'rfee_pdf', { genero: 'M', cat: 'M13', fecha: '2024-06-16' });
    prueba(db, 'ex', 'ee2', 'engarde', { genero: 'M', cat: 'M13', fecha: '2024-06-16' });
    NINOS.forEach((nm, i) => { puesto(db, 'px', 'rfee_pdf', nm, i + 1); puesto(db, 'ex', 'engarde', nm, i + 1); });
    const det = detectarConjuntas(cargarPruebasNacionales(db));
    expect(det.conjuntas.map((c) => ({ id: c.conjunta.id, regla: c.regla, partes: c.partes.map((x) => x.prueba.id).sort() })))
      .toEqual([{ id: 'cj', regla: 'partes', partes: ['pf', 'pm'] }]);
  });

  it('contenida: una clasificación dentro de una lectura mucho mayor que el duplicado no funde', () => {
    const db = crearBase();
    edicion(db, 'ep', 'rfee_pdf', '2022-06-04');
    edicion(db, 'ee', 'engarde', '2022-06-04');
    prueba(db, 'p9', 'ep', 'rfee_pdf', { cat: 'M13', fecha: '2022-06-04' });
    prueba(db, 'c9', 'ee', 'engarde', { cat: 'M13', fecha: '2022-06-04' });
    const nombres = Array.from({ length: 20 }, (_, i) => `TIRADOR${String.fromCharCode(65 + i)} APELLIDO${String.fromCharCode(65 + i)}`);
    nombres.forEach((nm, i) => { if (i < 9) puesto(db, 'p9', 'rfee_pdf', nm, i + 1); puesto(db, 'c9', 'engarde', nm, i + 1); });
    const det = detectarConjuntas(cargarPruebasNacionales(db));
    expect(det.conjuntas.map((c) => [c.conjunta.id, c.regla, c.partes.length])).toEqual([['c9', 'contenida', 1]]);
    expect([...registrarConjuntas(db).ids]).toEqual(['c9']);
    // La parte cambia (otra lectura con nombres que no están en Engarde): registrada, se mantiene.
    ['OTRO UNO', 'OTRO DOS', 'OTRO TRES'].forEach((nm, i) => puesto(db, 'p9', 'rfee_pdf', `${nm} APELLIDO`, 10 + i));
    expect(detectarConjuntas(cargarPruebasNacionales(db)).conjuntas).toEqual([]);
    expect([...registrarConjuntas(db).ids]).toEqual(['c9']);
    expect(uno(db, `SELECT count(*) n FROM sport_competition_combined`)).toEqual({ n: 1 });
    // En absoluto es un TNR dentro de un satélite con extranjeros: lo resuelve el duplicado normal.
    db.exec(`UPDATE sport_competition SET category = 'ABS'`);
    expect(detectarConjuntas(cargarPruebasNacionales(db)).conjuntas).toEqual([]);
  });

  it('dos partes que se solapan a medias: ambigua, no se toca', () => {
    const db = crearBase();
    criterium(db);
    // Una niña sale también en la parte masculina (PDF mal partido): comparten 1 de 4.
    puesto(db, 'pm', 'rfee_pdf', NINAS[0], 5);
    const det = detectarConjuntas(cargarPruebasNacionales(db));
    expect(det.conjuntas).toEqual([]);
    expect(det.ambiguas).toEqual(['cj']);
  });

  it('unificar: la conjunta queda aparte, enlazada, con puestos sin persona y asaltos vinculados', () => {
    const db = crearBase();
    const ids = criterium(db);
    const inf = unificarPersonas(db);
    expect(inf.conjuntas).toMatchObject({ conjuntas: 1, partes: 2, porRegla: { partes: 1 }, filasInsertadas: 2 });
    expect(todas(db, `SELECT part_competition_id p, combined_competition_id c, rule r, shared_names s FROM sport_competition_combined ORDER BY p`))
      .toEqual([{ p: 'pf', c: 'cj', r: 'partes', s: 4 }, { p: 'pm', c: 'cj', r: 'partes', s: 4 }]);
    // Engarde no se emparejó con las partes ni se borró; sus puestos no llevan persona.
    expect(uno(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cj'`)).toEqual({ n: 8 });
    expect(uno(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cj' AND person_id IS NOT NULL`)).toEqual({ n: 0 });
    expect(uno(db, `SELECT count(*) n FROM sport_bout WHERE competition_id IN ('pm','pf')`)).toEqual({ n: 0 });
    expect(todas(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE id IN (${ids.map((i) => `'${i}'`).join(',')}) ORDER BY id`)
      .every((b: unknown) => (b as { a: string | null }).a && (b as { b: string | null }).b)).toBe(true);
    // Cada persona tiene un solo puesto (el de su parte).
    expect(uno(db, `SELECT count(*) n FROM sport_result WHERE person_id IS NOT NULL`)).toEqual({ n: 8 });
    expect(uno(db, `SELECT count(*) n FROM sport_person`)).toEqual({ n: 8 });
    vincularAsaltos(db);
    expect(uno(db, `SELECT count(*) n FROM sport_result WHERE competition_id='cj' AND person_id IS NOT NULL`)).toEqual({ n: 0 });
    const otra = unificarPersonas(db);
    expect(otra.conjuntas).toMatchObject({ conjuntas: 1, filasInsertadas: 0, filasActualizadas: 0, filasBorradas: 0 });
  });

  it('una parte que se funde en su copia de Skermo deja el vínculo a la destino', () => {
    const db = crearBase();
    criterium(db);
    edicion(db, 'es', 'skermo_rfee', '2024-06-15');
    prueba(db, 'sm', 'es', 'skermo_rfee', { genero: 'M', cat: 'M11', fecha: '2024-06-15' });
    NINOS.forEach((nm, i) => puesto(db, 'sm', 'skermo_rfee', nm, i + 1, { persona: `p${i}` }));
    const { ids } = registrarConjuntas(db);
    expect([...ids]).toEqual(['cj']);
    expect(todas(db, `SELECT part_competition_id p FROM sport_competition_combined ORDER BY p`)).toEqual([{ p: 'pf' }, { p: 'pm' }, { p: 'sm' }]);
    const inf = fundirDuplicados(db, { excluir: ids });
    expect(inf.pruebasExcluidas).toBe(1);
    expect(inf.competicionesBorradas).toBe(1);
    expect(todas(db, `SELECT part_competition_id p FROM sport_competition_combined ORDER BY p`)).toEqual([{ p: 'pf' }, { p: 'sm' }]);
  });
});

describe('EFC: extranjeros por licencia', () => {
  function base() {
    const db = crearBase();
    edicion(db, 'e1', 'efc', '2024-11-10');
    edicion(db, 'e2', 'efc', '2025-02-10');
    db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
      VALUES ('c1','e1','efc','2024-2025','efc:1','FLORETE','M','M17','INDIVIDUAL','2024-11-10'),
             ('c2','e2','efc','2024-2025','efc:2','FLORETE','M','M17','INDIVIDUAL','2025-02-10')`).run();
    const fie = (id: string, nombre: string, pais: string, valor: string) => {
      db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,'M',?)`)
        .run(id, nombre, normalizarNombre(nombre), pais);
      db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'fie_addr_id', ?, 'fie', 'CONFIRMADO')`)
        .run(id, valor);
    };
    fie('f1', 'DUPONT Jean', 'FRA', '9001');
    fie('f2', 'MARTIN Paul', 'FRA', '9002');
    fie('f3', 'MARTIN Paul', 'FRA', '9003');
    fie('f4', 'ROSSI Marco', 'ITA', '9004');
    fie('f5', 'DUPONT Jean', 'BEL', '9005');
    const efc = (comp: string, nombre: string, pais: string, clave: string, pos: number) => puesto(db, comp, 'efc', nombre, pos, { clave, pais });
    efc('c1', 'DUPONT Jean', 'FRA', 'efc:lic:111', 1);
    efc('c1', 'MARTIN Paul', 'FRA', 'efc:lic:222', 2);
    efc('c1', 'ROSSI Marco', 'ITA', 'efc:lic:555', 3);
    efc('c1', 'DUPONT Jean', 'FRA', 'efc:lic:112', 4);
    efc('c2', 'MARTIN Paul', 'FRA', 'efc:lic:222', 1);
    efc('c2', 'DUPONT Jean', 'FRA', 'fww:athlete:77', 2);
    efc('c2', 'NOVAK Petr', 'CZE', 'efc:lic:666', 3);
    efc('c2', 'GARCIA Luis', 'ESP', 'efc:lic:777', 4);
    return db;
  }
  const opciones = {
    fechas: { fie: new Map([['9004', '1990-05-01']]), skermo: new Map() },
    nacimientosEfc: new Map([['555', 2008], ['111', 2008]]),
  };

  it('vincula con la FIE única y crea una persona por licencia en los demás casos', () => {
    const db = base();
    const inf = unificarPersonas(db, opciones);
    expect(inf.efc).toMatchObject({ filas: 7, licencias: 5, licenciasFie: 1, licenciasNuevas: 4, sinLicencia: { grupos: 1, fie: 1 } });
    expect(inf.efc.rechazos).toMatchObject({ fie_ambigua: 1, nacimiento: 1, misma_prueba: 1 });
    const persona = (clave: string, comp: string) =>
      uno<{ p: string | null }>(db, `SELECT person_id p FROM sport_result WHERE source_fact_key=? AND competition_id=?`, clave, comp).p;
    expect(persona('efc:lic:111', 'c1')).toBe('f1');
    expect(persona('fww:athlete:77', 'c2')).toBe('f1');
    // Dos DUPONT Jean FRA en la misma prueba: el segundo no es la FIE.
    expect(persona('efc:lic:112', 'c1')).not.toBe('f1');
    // Homónimos FIE: una persona propia, la misma en las dos pruebas.
    const martin = persona('efc:lic:222', 'c1');
    expect(martin).not.toBeNull();
    expect(persona('efc:lic:222', 'c2')).toBe(martin);
    expect(uno(db, `SELECT country_code c, gender g FROM sport_person WHERE id=?`, martin!)).toEqual({ c: 'FRA', g: 'M' });
    expect(uno(db, `SELECT source s FROM sport_person_alias WHERE person_id=?`, martin!)).toEqual({ s: ALIAS_EFC });
    // Nacido en 1990 no tira cadete en 2025.
    expect(persona('efc:lic:555', 'c1')).not.toBe('f4');
    // El español va por el paso por nombre (aquí sin candidata: persona por nombre, sin país).
    expect(uno(db, `SELECT p.country_code c FROM sport_result r JOIN sport_person p ON p.id = r.person_id WHERE r.source_fact_key='efc:lic:777'`))
      .toEqual({ c: null });
    // Ninguna fusión por nombre o evidencia toca a las personas de licencia.
    expect(uno(db, `SELECT merged_into_person_id m FROM sport_person WHERE id=?`, martin!)).toEqual({ m: null });
  });

  it('una persona de licencia se funde en la FIE cuando ésta pasa a ser única', () => {
    const db = base();
    unificarPersonas(db, opciones);
    const martin = uno<{ p: string }>(db, `SELECT person_id p FROM sport_result WHERE source_fact_key='efc:lic:222' AND competition_id='c1'`).p;
    db.exec(`DELETE FROM sport_external_id WHERE person_id='f3'; DELETE FROM sport_person WHERE id='f3'`);
    const inf = unificarPersonas(db, opciones);
    expect(inf.efc.fusionesFie).toBe(1);
    expect(uno(db, `SELECT merged_into_person_id m FROM sport_person WHERE id=?`, martin)).toEqual({ m: 'f2' });
    // Idempotente.
    expect(unificarPersonas(db, opciones).efc).toMatchObject({ fusionesFie: 0, licenciasNuevas: 0, filasVinculadas: 0 });
  });
});

describe('sincronizar-d1: tabla de la migración 0013', () => {
  it('se omite si no está en ninguna copia y pide la migración si sólo está en una', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lote7-sinc-'));
    try {
      const crear = (nombre: string, con0013: boolean) => {
        const ruta = join(dir, nombre);
        const db = new DatabaseSync(ruta);
        db.exec(readFileSync(new URL('../drizzle-d1/0000_aplicacion.sql', import.meta.url), 'utf8'));
        if (con0013) {
          const m = readFileSync(new URL('../drizzle-d1/0013_pruebas_conjuntas.sql', import.meta.url), 'utf8');
          db.exec(m.slice(0, m.indexOf('CREATE TRIGGER')));
        }
        db.close();
        return ruta;
      };
      const [sin, sin2, con] = [crear('a.sqlite', false), crear('b.sqlite', false), crear('c.sqlite', true)];
      const presentes = (a: string, b: string) => {
        const db = abrirComparacion(a, b);
        try { return tablasPresentes(db); } finally { db.close(); }
      };
      expect(presentes(sin, sin2)).not.toContain('sport_competition_combined');
      expect(presentes(con, con)).toContain('sport_competition_combined');
      expect(() => presentes(sin, con)).toThrow(/migracion_pendiente:sport_competition_combined/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cargar-hechos: cobertura por documento', () => {
  // Cada prueba del documento es de otro sexo: con los mismos atributos el cargador las tomaría por una.
  const hechos = (clave: string, nombres: string[]) => ({
    version: 1, source: 'rfee_pdf', extractor: 'lector_pdf', sourceUrl: 'https://app.skermo.org/client/1/doc77.pdf', sourceSha256: 'a'.repeat(64),
    edition: { season: '2024', tournamentKey: 'pdf:doc77', name: 'Copa', startDate: '2024-01-10', endDate: null, city: null, countryCode: null },
    competition: {
      competitionKey: clave, weapon: 'ESPADA', gender: clave.endsWith('B') ? 'M' : 'F', category: 'ABS', categoryRaw: null,
      format: 'INDIVIDUAL', date: '2024-01-11',
    },
    status: { results: 'completo', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null, notes: [] },
    results: nombres.map((nm, i) => ({ factKey: `${clave}:${i}`, name: nm, position: i + 1 })),
    bouts: [],
  });
  const entrada = (obj: unknown): EntradaHechos => ({ ruta: `f${(n += 1)}.json`, carpeta: 'pdf-lector', leer: () => obj });
  const doc = (db: DatabaseSync) => uno<{ status: string }>(db, `SELECT status FROM sport_import_coverage WHERE fact_kind='pdf'`).status;

  it('una carga con una sola prueba de un documento completo no lo degrada', () => {
    const db = crearBase();
    cargarHechos(db, [entrada(hechos('pdf:doc77:A', ['ANA GARCIA', 'EVA LOPEZ'])), entrada(hechos('pdf:doc77:B', ['SOL RUIZ', 'PAZ DIAZ']))]);
    expect(doc(db)).toBe('completo');
    cargarHechos(db, [entrada(hechos('pdf:doc77:A', ['ANA GARCIA', 'EVA LOPEZ']))]);
    expect(doc(db)).toBe('completo');
  });

  it('el estado sale de todas las pruebas de la edición en la base', () => {
    const db = crearBase();
    cargarHechos(db, [entrada({ ...hechos('pdf:doc77:A', ['ANA GARCIA']), status: { ...hechos('x', []).status, results: 'parcial' } })]);
    expect(doc(db)).toBe('parcial');
    // La otra prueba del documento llega completa en otro lote; A sigue parcial en la base.
    cargarHechos(db, [entrada(hechos('pdf:doc77:B', ['SOL RUIZ']))]);
    expect(doc(db)).toBe('parcial');
    cargarHechos(db, [entrada(hechos('pdf:doc77:A', ['ANA GARCIA', 'EVA LOPEZ']))]);
    expect(doc(db)).toBe('completo');
    expect(estadosDocumento(['completo', null])).toBe('parcial');
    expect(estadosDocumento(['sin_resultados', 'sin_resultados'])).toBe('sin_resultados');
  });
});
