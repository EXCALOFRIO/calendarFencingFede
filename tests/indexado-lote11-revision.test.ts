import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { aplicarRevisionManual, revisionManual } from '../scripts/indexado/lote11-revision-manual';
import { separarUnionesPorNombre } from '../scripts/indexado/separar-uniones';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

function persona(db: DatabaseSync, id: string, nombre: string, o: { genero?: string; alias?: string; fundida?: string } = {}) {
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code, merged_into_person_id) VALUES (?,?,?,?, 'ESP', ?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero ?? 'M', o.fundida ?? null);
  if (o.alias) {
    db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`).run(id, o.alias, nombre, normalizarNombre(nombre));
  }
}

const MARCO = '02563a42-e87f-4d3e-964f-842d70e4ec75';
const MARCO_PDF = 'c82e2e5b-96b3-42d6-9545-c9f306caebb8';
const VILORIA = 'be146791-057f-4599-b840-b8509f788d94';
const VILORIA_ENGARDE = '32558c9c-e182-4eda-8f90-7ddf5bb21930';
const PRUEBA_EF = '5a1e6bf9-f239-4a6e-b091-e56f20ae6312';
const VICANDI_M = '8d72aca2-8c13-4879-a599-e03d995e77ff';

function fixture() {
  const db = crearBase();
  persona(db, MARCO, 'MARCO NUNO GONZALEZ PEÑAS', { alias: 'skermo_rfee' });
  persona(db, MARCO_PDF, 'PEÑAS GONZALEZ Marco Nuno', { alias: 'rfee_pdf' });
  persona(db, VILORIA, 'VILORIA STEPANOVA Victor Manuel', { alias: 'skermo_rfee' });
  persona(db, VILORIA_ENGARDE, 'VILORIA Victor', { alias: 'engarde' });
  persona(db, 'vicandi-f', 'VICANDI EMBEITA Jasone', { genero: 'F' });
  persona(db, VICANDI_M, 'VICANDI EMBEITA Jasone', { fundida: 'vicandi-f' });
  db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('e1', 'engarde', '2010-2011', 't1', 'Cto. España Veteranos')`).run();
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format)
    VALUES (?, 'e1', 'engarde', '2010-2011', 'rfee-wayback:619/CTOESP-EFCATI(2011-05-14)', 'ESPADA', 'M', 'VET', 'INDIVIDUAL')`).run(PRUEBA_EF);
  return db;
}

describe('lote 11: revisión manual', () => {
  it('el ensayo informa sin escribir', () => {
    const db = fixture();
    const inf = revisionManual(db);
    expect(inf.aplicado).toBe(false);
    expect(inf.uniones.find((u) => u.origen === MARCO_PDF)?.estado).toBe('se_uniria');
    expect(inf.uniones.find((u) => u.origen === '4815462d-7a75-40ed-bece-1c5140e777d4')?.estado).toBe('falta_persona');
    expect(inf.pruebasF[0]).toMatchObject({ id: PRUEBA_EF, antes: 'M', estado: 'se_cambiaria' });
    expect(db.prepare(`SELECT merged_into_person_id m FROM sport_person WHERE id = ?`).get(MARCO_PDF)).toEqual({ m: null });
  });

  it('une con evidencia revision_manual, corrige el género, es idempotente y separar-uniones lo respeta', () => {
    const db = fixture();
    const inf = aplicarRevisionManual(db);
    expect(inf.uniones.filter((u) => u.estado === 'unida').map((u) => u.origen).sort()).toEqual([MARCO_PDF, VILORIA_ENGARDE].sort());
    expect(db.prepare(`SELECT merged_into_person_id m FROM sport_person WHERE id = ?`).get(MARCO_PDF)).toEqual({ m: MARCO });
    expect(db.prepare(`SELECT evidence e, status s FROM sport_link_candidate WHERE source_ref = ?`).get(MARCO_PDF))
      .toEqual({ e: 'revision_manual:pdf_apellidos_invertidos_mismo_club_cdaxxi', s: 'CONFIRMADO' });
    expect(db.prepare(`SELECT gender g FROM sport_competition WHERE id = ?`).get(PRUEBA_EF)).toEqual({ g: 'F' });
    expect(db.prepare(`SELECT gender g FROM sport_person WHERE id = ?`).get(VICANDI_M)).toEqual({ g: 'F' });
    // The guard triggers are back after applying.
    expect(Number((db.prepare(`SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'sport_fence_%'`).get() as { n: number }).n)).toBeGreaterThan(0);

    const otra = aplicarRevisionManual(db);
    expect(otra.uniones.filter((u) => u.estado === 'unida')).toEqual([]);
    expect(otra.pruebasF[0].estado).toBe('ya_f');

    quitarGuardia(db);
    expect(separarUnionesPorNombre(db).miembros.separados).toBe(0);
    expect(db.prepare(`SELECT merged_into_person_id m FROM sport_person WHERE id = ?`).get(MARCO_PDF)).toEqual({ m: MARCO });
  });

  it('las pruebas masculinas guardadas como F pasan a M con las fichas creadas sólo desde ellas', () => {
    const db = fixture();
    const FMIND = 'c5a78aa4-f6bb-47e7-a7e6-f90a93349d0e';
    db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('e2', 'engarde', '2015-2016', 't2', 'Cto. España absoluto')`).run();
    db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format)
      VALUES (?, 'e2', 'engarde', '2015-2016', 'engarde:fecyl/cespabs2016/fmind', 'FLORETE', 'F', 'ABS', 'INDIVIDUAL')`).run(FMIND);
    db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format)
      VALUES ('otra', 'e2', 'engarde', '2015-2016', 'engarde:fecyl/cespabs2016/ffind', 'FLORETE', 'F', 'ABS', 'INDIVIDUAL')`).run();
    persona(db, 'carlos', 'LLAVADOR FERNANDEZ Carlos', { genero: 'F' });
    persona(db, 'ana', 'GARCIA Ana', { genero: 'F' });
    const puesto = (id: string, comp: string, p: string, n: number) => db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash)
      VALUES (?, ?, 'engarde', ?, ?, ?, ?, 'h')`).run(id, comp, `k${id}`, p, p, n);
    puesto('r1', FMIND, 'carlos', 1);
    puesto('r2', FMIND, 'ana', 2);
    puesto('r3', 'otra', 'ana', 1);
    const inf = aplicarRevisionManual(db);
    expect(inf.pruebasM[0]).toMatchObject({ id: FMIND, antes: 'F', estado: 'cambiada' });
    expect(inf.fichasM.map((f) => f.id)).toEqual(['carlos']);
    expect(db.prepare(`SELECT gender g FROM sport_competition WHERE id = ?`).get(FMIND)).toEqual({ g: 'M' });
    expect(db.prepare(`SELECT gender g FROM sport_person WHERE id = 'carlos'`).get()).toEqual({ g: 'M' });
    expect(db.prepare(`SELECT gender g FROM sport_person WHERE id = 'ana'`).get()).toEqual({ g: 'F' });
    expect(aplicarRevisionManual(db).fichasM).toEqual([]);
  });

  it('separa la unión equivocada de dos «MARTIN LOPEZ RUIZ» y anula su candidato', () => {
    const db = fixture();
    const [uno, otro] = ['98a8d01c-5a98-4676-8598-f1cff141b3d8', '6426468e-be5d-4a64-8463-db338f4ccc8c'];
    persona(db, uno, 'MARTIN LOPEZ RUIZ', { alias: 'skermo_rfee' });
    persona(db, otro, 'MARTIN LOPEZ RUIZ', { alias: 'skermo_rfee', fundida: uno });
    db.prepare(`INSERT INTO sport_link_candidate (source, source_ref, source_name, person_id, status, evidence)
      VALUES ('fusion_lote11_evidencia', ?, 'MARTIN LOPEZ RUIZ', ?, 'CONFIRMADO', 'lote11:duplicada_club_anio')`).run(otro, uno);
    expect(revisionManual(db).separaciones[0].estado).toBe('se_separaria');
    const inf = aplicarRevisionManual(db);
    expect(inf.separaciones[0].estado).toBe('separada');
    expect(db.prepare(`SELECT merged_into_person_id m FROM sport_person WHERE id = ?`).get(otro)).toEqual({ m: null });
    expect(db.prepare(`SELECT status s FROM sport_link_candidate WHERE source = 'fusion_lote11_evidencia' AND source_ref = ?`).get(otro)).toEqual({ s: 'RECHAZADO' });
    expect(db.prepare(`SELECT count(*) n FROM sport_link_candidate WHERE source = 'revision_manual' AND source_ref = ? AND status = 'RECHAZADO'`).get(otro)).toEqual({ n: 1 });
    expect(aplicarRevisionManual(db).separaciones[0].estado).toBe('ya_separada');
  });
});
