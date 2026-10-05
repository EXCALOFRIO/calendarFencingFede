import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import { desvincularColisionesPdf, unificarPersonas } from '../scripts/indexado/unificar-personas';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

function persona(db: DatabaseSync, id: string, nombre: string, norm: string, genero: string, pais: string | null, licencia?: string, temporada = '2024-2025') {
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,?,?)`)
    .run(id, nombre, norm, genero, pais);
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`)
    .run(id, licencia ? 'skermo_rfee' : 'fie', nombre, norm);
  if (licencia) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, scope_federation, scope_season, link_status)
      VALUES (?, 'rfee_license', ?, 'skermo_rfee', 'RFEE', ?, 'CONFIRMADO')`).run(id, licencia, temporada);
  }
}

let r = 0;
function resultado(db: DatabaseSync, comp: string, source: string, key: string, nombre: string, pais: string | null = null, personId: string | null = null) {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_country_code,
    occurred_on, content_hash) VALUES (?,?,?,?,?,?,?, '2024-01-01', 'h')`).run(`r${(r += 1)}`, comp, source, key, personId, nombre, pais);
}

function asalto(db: DatabaseSync, comp: string, source: string, a: string, b: string, an: string, bn: string) {
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name,
    fencer_b_name, score_a, score_b, content_hash) VALUES (?,?,?,'POULE','P1',?,?,?,?,5,3,'h')`).run(`b${(r += 1)}`, comp, source, a, b, an, bn);
}

function fixture(): DatabaseSync {
  const db = crearBase();
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
    ('ef', 'fie', '2024', 'competition:1', 'Copa'), ('ep', 'rfee_pdf', '2023-2024', 'pdf:x', 'Copa PDF');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category) VALUES
    ('cf', 'ef', 'fie', '2024', '1', 'ESPADA', 'F', 'ABS'), ('cp', 'ep', 'rfee_pdf', '2023-2024', 'pdf:x:1', 'ESPADA', 'F', 'ABS');`);
  // FIE: 100 ya tiene persona; 200 es nueva y española.
  persona(db, 'pfie100', 'SMITH Jane', 'jane smith', 'F', 'USA');
  db.exec(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES ('pfie100', 'fie_addr_id', '100', 'fie', 'CONFIRMADO')`);
  resultado(db, 'cf', 'fie', '100', 'SMITH Jane', 'USA');
  resultado(db, 'cf', 'fie', '200', 'GARCIA LOPEZ Ana', 'ESP');
  resultado(db, 'cf', 'fie', 'team:9', 'ESPAÑA');
  asalto(db, 'cf', 'fie', '100', '200', 'SMITH Jane', 'GARCIA LOPEZ Ana');
  // RFEE con licencia.
  persona(db, 'plic1', 'ANA GARCIA LOPEZ', 'ana garcia lopez', 'F', null, 'L1');
  persona(db, 'plic1b', 'ANA GARCIA LOPEZ', 'ana garcia lopez', 'F', null, 'L1', '2023-2024');
  persona(db, 'plic5', 'MARIO DIAZ', 'diaz mario', 'M', null, 'L5');
  persona(db, 'plic5b', 'MARIA DIAZ', 'diaz maria', 'F', null, 'L5', '2023-2024');
  persona(db, 'plic2', 'LUCIA PEREZ SOLA', 'lucia perez sola', 'F', null, 'L2');
  persona(db, 'plic3', 'LUCIA PEREZ SOLA', 'lucia perez sola', 'F', null, 'L3');
  persona(db, 'plic4', 'LUCIA MARIA DIAZ ROS', 'diaz lucia maria ros', 'F', null, 'L4');
  // PDF sin IDs.
  resultado(db, 'cp', 'rfee_pdf', 'pdf:1', 'GARCIA LOPEZ Ana');
  resultado(db, 'cp', 'rfee_pdf', 'pdf:2', 'RUIZ Marta');
  resultado(db, 'cp', 'rfee_pdf', 'pdf:3', 'PEREZ SOLA Lucia');
  resultado(db, 'cp', 'rfee_pdf', 'pdf:4', 'PEPE');
  resultado(db, 'cp', 'rfee_pdf', 'pdf:5', 'DIAZ Lucia Maria');
  asalto(db, 'cp', 'rfee_pdf', 'p0001', 'p0002', 'GARCIA LOPEZ Ana', 'RUIZ Marta');
  return db;
}

const fila = (db: DatabaseSync, sql: string, ...p: string[]) => db.prepare(sql).get(...p) as Record<string, unknown>;

describe('unificar-personas', () => {
  it('crea personas FIE, funde FIE↔RFEE y vincula el PDF por nombre', () => {
    const db = fixture();
    const inf = unificarPersonas(db);

    expect(inf.fie).toMatchObject({ idsDistintos: 2, personasReutilizadas: 1, personasCreadas: 1, resultadosVinculados: 2, asaltosLadoVinculados: 2 });
    const nueva = fila(db, `SELECT p.* FROM sport_person p JOIN sport_external_id e ON e.person_id=p.id WHERE e.value='200'`);
    expect(nueva).toMatchObject({ display_name: 'GARCIA LOPEZ Ana', name_normalized: 'ana garcia lopez', gender: 'F', country_code: 'ESP' });
    expect(fila(db, `SELECT linked_via, link_status FROM sport_external_id WHERE value='200'`))
      .toEqual({ linked_via: 'fie_id_publicado', link_status: 'CONFIRMADO' });
    expect(fila(db, `SELECT person_id FROM sport_result WHERE source_fact_key='team:9'`)).toEqual({ person_id: null });

    // La ficha con licencia se funde en la FIE (una sola fusión, sin cadena).
    expect(inf.fusionLicencia).toEqual({ licenciasConVarias: 2, fusiones: 1, omitidas: 1 });
    expect(inf.fusionFieRfee).toMatchObject({ fusiones: 1, exactas: 1 });
    expect(fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='plic1'`)).toEqual({ m: nueva.id });
    expect(fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='plic1b'`)).toEqual({ m: nueva.id });
    expect(fila(db, `SELECT count(*) n FROM sport_person WHERE id IN ('plic5','plic5b') AND merged_into_person_id IS NULL`)).toEqual({ n: 2 });

    // PDF: exacto al grupo fundido, superconjunto único, ambiguo, corto y nuevo.
    expect(fila(db, `SELECT person_id FROM sport_result WHERE source_fact_key='pdf:1'`)).toEqual({ person_id: nueva.id });
    expect(fila(db, `SELECT person_id FROM sport_result WHERE source_fact_key='pdf:5'`)).toEqual({ person_id: 'plic4' });
    expect(fila(db, `SELECT person_id FROM sport_result WHERE source_fact_key='pdf:3'`)).toEqual({ person_id: null });
    expect(fila(db, `SELECT person_id FROM sport_result WHERE source_fact_key='pdf:4'`)).toEqual({ person_id: null });
    const marta = fila(db, `SELECT p.* FROM sport_result r JOIN sport_person p ON p.id=r.person_id WHERE r.source_fact_key='pdf:2'`);
    expect(marta).toMatchObject({ name_normalized: 'marta ruiz', gender: 'F' });
    expect(inf.pdf).toMatchObject({ vinculadosExacto: 1, vinculadosSuperconjunto: 1, personasCreadas: 1, ambiguos: 1, nombresCortos: 1, resultadosVinculados: 3 });
    expect(fila(db, `SELECT count(*) n FROM sport_link_candidate WHERE source='rfee_pdf' AND status='PROPUESTO'`)).toEqual({ n: 2 });
    expect(fila(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE source='rfee_pdf'`))
      .toEqual({ a: nueva.id, b: marta.id });
    expect(inf.despues.asaltos.rfee_pdf).toEqual({ total: 1, ambos: 1, pct: 100 });
    expect(inf.antes.resultados.fie.vinculados).toBe(0);
    expect(inf.despues.resultados.fie.vinculados).toBe(2);
  });

  it('es idempotente', () => {
    const db = fixture();
    unificarPersonas(db);
    const personas = fila(db, `SELECT count(*) n FROM sport_person`);
    const alias = fila(db, `SELECT count(*) n FROM sport_person_alias`);
    const candidatos = fila(db, `SELECT count(*) n FROM sport_link_candidate`);
    const segunda = unificarPersonas(db);
    expect(segunda.fie.personasCreadas).toBe(0);
    expect(segunda.fie.aliasNuevos).toBe(0);
    expect(segunda.pdf.personasCreadas).toBe(0);
    expect(segunda.fusionFieRfee.fusiones).toBe(0);
    expect(segunda.fusionPdf.fusiones).toBe(0);
    expect(segunda.despues).toEqual(segunda.antes);
    expect(fila(db, `SELECT count(*) n FROM sport_person`)).toEqual(personas);
    expect(fila(db, `SELECT count(*) n FROM sport_person_alias`)).toEqual(alias);
    expect(fila(db, `SELECT count(*) n FROM sport_link_candidate`)).toEqual(candidatos);
  });

  it('conserva las fichas fundidas que tienen favoritos o rankings y no deja cadenas', () => {
    const db = fixture();
    db.exec(`PRAGMA foreign_keys=OFF;
      INSERT INTO sport_favorite (profile_id, person_id) VALUES ('u1', 'plic1');
      INSERT INTO sport_ranking_entry (id, publication_id, source_ref, person_id) VALUES ('re1', 'pub1', 'x', 'plic1b');
      PRAGMA foreign_keys=ON;`);
    const ids = (db.prepare(`SELECT id FROM sport_person ORDER BY id`).all() as { id: string }[]).map((p) => p.id);
    unificarPersonas(db);
    unificarPersonas(db);
    const despues = new Set((db.prepare(`SELECT id FROM sport_person`).all() as { id: string }[]).map((p) => p.id));
    expect(ids.filter((id) => !despues.has(id))).toEqual([]);
    const raiz = fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='plic1'`).m;
    expect(raiz).toBeTruthy();
    expect(fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='plic1b'`)).toEqual({ m: raiz });
    expect(fila(db, `SELECT person_id p FROM sport_favorite`)).toEqual({ p: 'plic1' });
    expect(fila(db, `SELECT person_id p FROM sport_ranking_entry`)).toEqual({ p: 'plic1b' });
    expect(fila(db, `SELECT count(*) n FROM sport_person p JOIN sport_person q ON q.id = p.merged_into_person_id
      WHERE q.merged_into_person_id IS NOT NULL`)).toEqual({ n: 0 });
  });

  it('no encadena fusiones: lo fundido en la ficha RFEE pasa a la raíz FIE', () => {
    const db = fixture();
    persona(db, 'pvieja', 'ANA GARCIA LOPEZ', 'ana garcia lopez', 'F', null);
    db.exec(`UPDATE sport_person SET merged_into_person_id='plic1' WHERE id='pvieja'`);
    unificarPersonas(db);
    const raiz = fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='plic1'`).m;
    expect(fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='pvieja'`)).toEqual({ m: raiz });
  });

  it('dos puestos de una prueba individual con el mismo nombre no se vinculan por nombre en esa prueba', () => {
    const db = fixture();
    db.exec(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category) VALUES
      ('cp2', 'ep', 'rfee_pdf', '2023-2024', 'pdf:x:2', 'ESPADA', 'F', 'ABS'),
      ('cp3', 'ep', 'rfee_pdf', '2023-2024', 'pdf:x:3', 'ESPADA', 'F', 'M17');`);
    // «LACASTA AREN» trunca a dos tiradoras distintas; «AREN LACASTA» ordena igual.
    resultado(db, 'cp2', 'rfee_pdf', 'pdf:21', 'LACASTA AREN');
    resultado(db, 'cp2', 'rfee_pdf', 'pdf:22', 'AREN LACASTA');
    resultado(db, 'cp3', 'rfee_pdf', 'pdf:31', 'LACASTA AREN');
    asalto(db, 'cp2', 'rfee_pdf', 'pdf:21', 'pdf:22', 'LACASTA AREN', 'AREN LACASTA');
    const inf = unificarPersonas(db);
    expect(inf.pdf.puestosAmbiguosEnPrueba).toBe(2);
    expect(fila(db, `SELECT count(*) n FROM sport_result WHERE source_fact_key IN ('pdf:21','pdf:22') AND person_id IS NULL`)).toEqual({ n: 2 });
    expect(fila(db, `SELECT person_id IS NOT NULL v FROM sport_result WHERE source_fact_key='pdf:31'`)).toEqual({ v: 1 });
    expect(fila(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE competition_id='cp2'`)).toEqual({ a: null, b: null });
    expect(inf.colisionesPdf).toEqual({ pruebas: 0, resultados: 0, asaltosLado: 0 });
  });

  it('desvincula los puestos de una misma persona repetida en una prueba individual PDF', () => {
    const db = fixture();
    persona(db, 'pa', 'ROMERO ORTIN Eva', 'eva ortin romero', 'F', null);
    persona(db, 'pb', 'ORTIN ROMERO Eva', 'eva ortin romero', 'F', null);
    db.exec(`UPDATE sport_person SET merged_into_person_id='pa' WHERE id='pb'`);
    resultado(db, 'cp', 'rfee_pdf', 'pdf:8', 'ROMERO ORTIN Eva', null, 'pa');
    resultado(db, 'cp', 'rfee_pdf', 'pdf:9', 'ORTIN ROMERO Eva', null, 'pb');
    resultado(db, 'cf', 'fie', '900', 'ROMERO ORTIN Eva', null, 'pa');
    asalto(db, 'cp', 'rfee_pdf', 'pdf:8', 'pdf:9', 'ROMERO ORTIN Eva', 'ORTIN ROMERO Eva');
    db.exec(`UPDATE sport_bout SET fencer_a_person_id='pa', fencer_b_person_id='pb' WHERE fencer_a_ref='pdf:8'`);
    expect(desvincularColisionesPdf(db)).toEqual({ pruebas: 1, resultados: 2, asaltosLado: 2 });
    expect(fila(db, `SELECT count(*) n FROM sport_result WHERE source_fact_key IN ('pdf:8','pdf:9') AND person_id IS NULL`)).toEqual({ n: 2 });
    expect(fila(db, `SELECT person_id FROM sport_result WHERE source_fact_key='900'`)).toEqual({ person_id: 'pa' });
    expect(fila(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE fencer_a_ref='pdf:8'`)).toEqual({ a: null, b: null });
    expect(desvincularColisionesPdf(db)).toEqual({ pruebas: 0, resultados: 0, asaltosLado: 0 });
  });
});
