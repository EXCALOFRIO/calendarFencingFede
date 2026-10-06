import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { revincularAsaltosPorPuesto } from '../scripts/indexado/dedupe-pruebas';
import {
  apellidoDeMas,
  claveGrupoNombre,
  contenidoEn,
  fusionarPorNombre,
  partirNombreFie,
  unificarPersonas,
} from '../scripts/indexado/unificar-personas';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
      ('ep', 'rfee_pdf', '2023-2024', 'pdf:x', 'TNR'), ('es', 'skermo_rfee', '2023-2024', 'RFEE:1', 'TNR'),
      ('ef', 'fie', '2023-2024', 'fie:x', 'Copa del Mundo');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('c1', 'ep', 'rfee_pdf', '2023-2024', 'k1', 'ESPADA', 'F', 'ABS', '2024-01-01'),
      ('c2', 'ep', 'rfee_pdf', '2023-2024', 'k2', 'ESPADA', 'F', 'ABS', '2024-02-01'),
      ('c3', 'ep', 'rfee_pdf', '2023-2024', 'k3', 'ESPADA', 'M', 'ABS', '2024-03-01'),
      ('cs', 'es', 'skermo_rfee', '2023-2024', 'RFEE:1', 'FLORETE', 'M', 'ABS', '2024-04-01'),
      ('cf', 'ef', 'fie', '2023-2024', 'fie:1', 'ESPADA', 'F', 'ABS', '2024-05-01');`);
  return db;
}

type OpcionesPersona = { genero?: 'M' | 'F' | null; fie?: string; licencia?: string; fuente?: string; pais?: string | null };
function persona(db: DatabaseSync, id: string, nombre: string, o: OpcionesPersona = {}) {
  const fuente = o.fuente ?? (o.fie ? 'fie' : o.licencia ? 'skermo_rfee' : 'rfee_pdf');
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,?,?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero === undefined ? 'F' : o.genero, o.pais === undefined ? (o.fie ? 'ESP' : null) : o.pais);
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`)
    .run(id, fuente, nombre, normalizarNombre(nombre));
  if (o.fie) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'fie_addr_id', ?, 'fie', 'CONFIRMADO')`)
      .run(id, o.fie);
  }
  if (o.licencia) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, scope_season, link_status)
      VALUES (?, 'rfee_license', ?, 'skermo_rfee', '2023-2024', 'CONFIRMADO')`).run(id, o.licencia);
  }
}
let n = 0;
function puesto(db: DatabaseSync, comp: string, nombre: string, p: string | null = null, source = 'rfee_pdf') {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash)
    VALUES (?,?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, `k${n}`, p, nombre, n);
}
function asalto(db: DatabaseSync, comp: string, ronda: string, an: string, bn: string, o: { a?: string | null; b?: string | null } = {}) {
  const lados = [{ n: an, p: o.a ?? null }, { n: bn, p: o.b ?? null }].sort((x, y) => (x.n < y.n ? -1 : 1));
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id,
    fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?,?,'rfee_pdf','POULE',?,?,?,?,?,?,?,5,3,?)`)
    .run(`b${(n += 1)}`, comp, ronda, `ref:${lados[0].n}`, `ref:${lados[1].n}`, lados[0].p, lados[1].p, lados[0].n, lados[1].n, `h${n}`);
}
const fusionada = (db: DatabaseSync, id: string) =>
  (db.prepare(`SELECT merged_into_person_id m FROM sport_person WHERE id = ?`).get(id) as { m: string | null }).m;

describe('piezas', () => {
  it('parte el nombre FIE en apellidos y nombre de pila', () => {
    expect(partirNombreFie('DIAZ Maria Teresa')).toEqual({ apellidos: ['diaz'], nombre: ['maria', 'teresa'] });
    expect(partirNombreFie('DE LA FUENTE Ana')).toEqual({ apellidos: ['de', 'la', 'fuente'], nombre: ['ana'] });
    expect(partirNombreFie('MARIA TERESA DIAZ')).toBeNull();
    expect(partirNombreFie('Maria DIAZ')).toBeNull();
  });

  it('sólo acepta un apellido de más, que no sea partícula', () => {
    expect(apellidoDeMas(['diaz', 'maria', 'teresa'], ['diaz', 'escalona', 'maria', 'teresa'])).toBe('escalona');
    expect(apellidoDeMas(['diaz', 'maria', 'teresa'], ['de', 'diaz', 'maria', 'teresa'])).toBeNull();
    expect(apellidoDeMas(['diaz', 'maria'], ['diaz', 'escalona', 'maria', 'teresa'])).toBeNull();
    expect(apellidoDeMas(['diaz', 'maria'], ['diaz', 'maria'])).toBeNull();
  });

  it('un nombre contenido tiene menos información que el largo', () => {
    expect(contenidoEn(['al', 'larena', 'ramirez'], ['alejandro', 'larena', 'ramirez'])?.nivel).toBe('prefijo');
    expect(contenidoEn(['alejandro', 'larena', 'ramirez'], ['al', 'larena', 'ramirez'])).toBeNull();
    expect(contenidoEn(['larena', 'ramirez'], ['larena', 'ramirez'])).toBeNull();
  });

  it('no parte por género los nombres de 3+ palabras', () => {
    expect(claveGrupoNombre(['alex', 'garcia', 'lopez'], 'M')).toBe(claveGrupoNombre(['alex', 'garcia', 'lopez'], 'F'));
    expect(claveGrupoNombre(['garcia', 'lopez'], 'M')).not.toBe(claveGrupoNombre(['garcia', 'lopez'], 'F'));
  });
});

describe('fusión por apellido FIE', () => {
  const caso = () => {
    const db = crearBase();
    persona(db, 'f1', 'DIAZ Maria Teresa', { fie: '100' });
    persona(db, 'n1', 'DIAZ ESCALONA Maria Teresa');
    puesto(db, 'cf', 'DIAZ Maria Teresa', 'f1', 'fie');
    puesto(db, 'c1', 'DIAZ ESCALONA Maria Teresa', 'n1');
    return db;
  };

  it('funde la persona nacional con un apellido más en la FIE', () => {
    const db = caso();
    const inf = fusionarPorNombre(db);
    expect(inf.apellidoFie).toMatchObject({ candidatos: 1, fusiones: 1 });
    expect(fusionada(db, 'n1')).toBe('f1');
    expect(db.prepare(`SELECT source, evidence FROM sport_link_candidate WHERE source_ref = 'n1'`).get())
      .toMatchObject({ source: 'fusion_apellido_fie' });
  });

  it('no funde si hay hermanos con los dos apellidos', () => {
    const db = caso();
    persona(db, 'n2', 'DIAZ ESCALONA Pedro', { genero: 'M' });
    puesto(db, 'c3', 'DIAZ ESCALONA Pedro', 'n2');
    expect(fusionarPorNombre(db).apellidoFie.rechazos).toEqual({ hermanos: 1 });
    expect(fusionada(db, 'n1')).toBeNull();
  });

  it('una inicial o un nombre de pila recortado con los dos apellidos no es un hermano', () => {
    const db = caso();
    persona(db, 'n2', 'DIAZ ESCALONA M');
    puesto(db, 'c2', 'DIAZ ESCALONA M', 'n2');
    expect(fusionarPorNombre(db).apellidoFie.fusiones).toBe(1);
  });

  it('el apellido FIE tiene que ser el primero del nombre nacional', () => {
    const db = crearBase();
    persona(db, 'f1', 'LOPEZ Ana', { fie: '100' });
    persona(db, 'n1', 'ANA GALLARIN LOPEZ', { licencia: 'L1' });
    puesto(db, 'cf', 'LOPEZ Ana', 'f1', 'fie');
    puesto(db, 'c1', 'ANA GALLARIN LOPEZ', 'n1');
    expect(fusionarPorNombre(db).apellidoFie.rechazos).toEqual({ no_es_el_primer_apellido: 1 });
    db.exec(`UPDATE sport_person SET display_name = 'ANA LOPEZ GALLARIN', name_normalized = 'ana gallarin lopez' WHERE id = 'n1';
      DELETE FROM sport_person_alias WHERE person_id = 'n1'`);
    expect(fusionarPorNombre(db).apellidoFie.fusiones).toBe(1);
  });

  it('no funde si hay dos personas nacionales posibles', () => {
    const db = caso();
    persona(db, 'n2', 'DIAZ GOMEZ Maria Teresa');
    puesto(db, 'c2', 'DIAZ GOMEZ Maria Teresa', 'n2');
    expect(fusionarPorNombre(db).apellidoFie.rechazos).toEqual({ varias_nacionales: 1 });
  });

  it('no funde si otra persona FIE cabe también en el nombre nacional', () => {
    const db = caso();
    persona(db, 'f2', 'ESCALONA Maria Teresa', { fie: '200' });
    puesto(db, 'cf', 'ESCALONA Maria Teresa', 'f2', 'fie');
    const inf = fusionarPorNombre(db);
    expect(inf.apellidoFie.fusiones).toBe(0);
    expect(inf.apellidoFie.rechazos).toEqual({ otra_fie_cabe: 1, no_es_el_primer_apellido: 1 });
  });

  it('no funde si coinciden en una prueba', () => {
    const db = caso();
    puesto(db, 'cf', 'DIAZ ESCALONA Maria Teresa', 'n1', 'fie');
    expect(fusionarPorNombre(db).apellidoFie.rechazos).toEqual({ coinciden: 1 });
  });

  it('usa la fecha de nacimiento como veto (más de un año) y lo anota si casa', () => {
    expect(fusionarPorNombre(caso(), new Map([['f1', ['1990-03-01']], ['n1', ['1995-03-01']]])).apellidoFie.rechazos)
      .toEqual({ fecha_nacimiento: 1 });
    expect(fusionarPorNombre(caso(), new Map([['f1', ['1990-03-01']], ['n1', ['1990-11-20']]])).apellidoFie)
      .toMatchObject({ fusiones: 1, fechaNacimientoCasa: 1 });
  });

  it('no funde una persona FIE extranjera', () => {
    const db = caso();
    db.exec(`UPDATE sport_person SET country_code = 'FRA' WHERE id = 'f1'`);
    expect(fusionarPorNombre(db).apellidoFie.candidatos).toBe(0);
  });
});

describe('fusión por nombre recortado', () => {
  const caso = () => {
    const db = crearBase();
    persona(db, 't1', 'MARCOS MUÑOZ Miguel An', { genero: 'M' });
    persona(db, 'h1', 'MIGUEL ANGEL MARCOS MUÑOZ', { genero: 'M', licencia: 'L1' });
    puesto(db, 'c3', 'MARCOS MUÑOZ Miguel An', 't1');
    puesto(db, 'cs', 'MIGUEL ANGEL MARCOS MUÑOZ', 'h1', 'skermo_rfee');
    return db;
  };

  it('funde la persona del nombre recortado en la única que lo contiene', () => {
    const db = caso();
    expect(fusionarPorNombre(db).recortado).toMatchObject({ candidatos: 1, fusiones: 1 });
    expect(fusionada(db, 't1')).toBe('h1');
  });

  it('no funde si hay dos cabezas posibles', () => {
    const db = caso();
    persona(db, 'h2', 'MIGUEL ANTONIO MARCOS MUÑOZ', { genero: 'M', licencia: 'L2' });
    puesto(db, 'c2', 'MIGUEL ANTONIO MARCOS MUÑOZ', 'h2');
    expect(fusionarPorNombre(db).recortado.rechazos).toEqual({ varias_cabezas: 1 });
    expect(fusionada(db, 't1')).toBeNull();
  });

  it('no funde si tienen puesto en la misma prueba o tiran en la misma ronda', () => {
    const db = caso();
    puesto(db, 'c3', 'MIGUEL ANGEL MARCOS MUÑOZ', 'h1');
    expect(fusionarPorNombre(db).recortado.rechazos).toEqual({ coinciden: 1 });
    const db2 = caso();
    asalto(db2, 'c1', 'P1', 'MARCOS MUÑOZ Miguel An', 'MIGUEL ANGEL MARCOS MUÑOZ', { a: 't1', b: 'h1' });
    expect(fusionarPorNombre(db2).recortado.rechazos).toEqual({ coinciden: 1 });
  });

  it('no funde a una persona con identificador', () => {
    const db = caso();
    db.exec(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES ('t1', 'fie_addr_id', '7', 'fie', 'CONFIRMADO')`);
    expect(fusionarPorNombre(db).recortado.candidatos).toBe(0);
  });
});

describe('paso por nombre', () => {
  it('no crea persona para un nombre de asalto que es un puesto recortado', () => {
    const db = crearBase();
    puesto(db, 'c3', 'RAMIREZ LARENA Alejandro');
    puesto(db, 'c3', 'ZABALA GUTIERREZ Juan');
    asalto(db, 'c3', 'P1', 'RAMIREZ LARENA Al', 'ZABALA GUTIERREZ Juan');
    const inf = unificarPersonas(db);
    expect(inf.pdf.recortadosSinPersona).toBe(1);
    expect(db.prepare(`SELECT count(*) n FROM sport_person WHERE name_normalized = 'al larena ramirez'`).get()).toEqual({ n: 0 });
    // El asalto se vincula con el puesto de su prueba.
    const b = db.prepare(`SELECT fencer_a_person_id a FROM sport_bout`).get() as { a: string };
    const r = db.prepare(`SELECT person_id p FROM sport_result WHERE source_name = 'RAMIREZ LARENA Alejandro'`).get() as { p: string };
    expect(b.a).toBe(r.p);
  });

  it('un nombre de 3+ palabras en pruebas de distinto género es una persona', () => {
    const db = crearBase();
    puesto(db, 'c1', 'GARCIA LOPEZ Alex');
    puesto(db, 'c3', 'GARCIA LOPEZ Alex');
    puesto(db, 'c1', 'GARCIA LOPEZ');
    puesto(db, 'c3', 'GARCIA LOPEZ');
    unificarPersonas(db);
    const cuenta = (norm: string) => (db.prepare(`SELECT count(*) n FROM sport_person WHERE name_normalized = ?`).get(norm) as { n: number }).n;
    expect(cuenta('alex garcia lopez')).toBe(1);
    expect(cuenta('garcia lopez')).toBe(2);
  });
});

describe('revincularAsaltosPorPuesto: salvaguardas', () => {
  const caso = () => {
    const db = crearBase();
    persona(db, 'p1', 'ALEJANDRO RAMIREZ LARENA', { genero: 'M', licencia: 'L1' });
    persona(db, 'p2', 'JUAN ZABALA GUTIERREZ', { genero: 'M', licencia: 'L2' });
    puesto(db, 'cs', 'ALEJANDRO RAMIREZ LARENA', 'p1', 'skermo_rfee');
    puesto(db, 'cs', 'JUAN ZABALA GUTIERREZ', 'p2', 'skermo_rfee');
    return db;
  };
  const lado = (db: DatabaseSync, nombre: string) => (db.prepare(
    `SELECT CASE WHEN fencer_a_name = ?1 THEN fencer_a_person_id ELSE fencer_b_person_id END p FROM sport_bout
      WHERE fencer_a_name = ?1 OR fencer_b_name = ?1`,
  ).get(nombre) as { p: string | null }).p;

  it('no resuelve un nombre si otro compatible de la prueba va a otro puesto', () => {
    const db = caso();
    asalto(db, 'cs', 'P1', 'ZABALA GUTIERREZ', 'GUMA LEAL Arnau');
    expect(revincularAsaltosPorPuesto(db, ['cs']).ladosVinculadosNuevos).toBe(1);
    expect(lado(db, 'ZABALA GUTIERREZ')).toBe('p2');

    const db2 = caso();
    asalto(db2, 'cs', 'P1', 'ZABALA GUTIERREZ', 'GUMA LEAL Arnau');
    asalto(db2, 'cs', 'P2', 'ZABALA GUTIERREZ Pedro', 'KIM San');
    expect(revincularAsaltosPorPuesto(db2, ['cs'])).toMatchObject({ ladosVinculadosNuevos: 0, descartadosHomonimo: 1 });
    expect(lado(db2, 'ZABALA GUTIERREZ')).toBeNull();
  });

  it('no deja a una persona con dos referencias en la misma ronda', () => {
    const db = caso();
    asalto(db, 'cs', 'P1', 'RAMIREZ LARENA Al', 'GUMA LEAL Arnau');
    asalto(db, 'cs', 'P1', 'RAMIREZ LARENA', 'KIM San');
    asalto(db, 'cs', 'P2', 'ZABALA GUTIERRE', 'BRAVO FERNANDEZ Sahel');
    expect(revincularAsaltosPorPuesto(db, ['cs'])).toMatchObject({ ladosVinculadosNuevos: 1, descartadosRonda: 2 });
    expect(lado(db, 'RAMIREZ LARENA Al')).toBeNull();
    expect(lado(db, 'ZABALA GUTIERRE')).toBe('p2');
  });
});
