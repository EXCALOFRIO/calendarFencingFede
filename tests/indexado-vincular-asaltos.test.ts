import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { palabrasNombre, quitarGuardia } from '../scripts/indexado/comun';
import {
  coincidencia,
  elegirPuesto,
  nombresCompatibles,
  vincularAsaltos,
  type Puesto,
} from '../scripts/indexado/vincular-asaltos';

const p = (nombre: string) => palabrasNombre(nombre);

describe('coincidencia de nombres', () => {
  it('distingue exacto, subconjunto y última palabra truncada', () => {
    expect(coincidencia(p('ROMERO ORTIN Pablo'), p('PABLO ORTIN ROMERO'))).toEqual({ nivel: 'exacto', fuerza: 3 });
    expect(coincidencia(p('ZABALA GUTIERREZ'), p('ZABALA GUTIERREZ Juan'))).toEqual({ nivel: 'subconjunto', fuerza: 2 });
    expect(coincidencia(p('RAMIREZ LARENA Al'), p('RAMIREZ LARENA Alejandro'))).toEqual({ nivel: 'prefijo', fuerza: 3 });
    expect(coincidencia(p('RAMIREZ LARENA Alejandro'), p('RAMIREZ LARENA Aleja'))).toEqual({ nivel: 'prefijo', fuerza: 3 });
    expect(coincidencia(p('PEREZ PEREZ Luis An'), p('PEREZ PEREZ Luis'))).toEqual({ nivel: 'subconjunto', fuerza: 3 });
  });

  it('no casa con una sola palabra significativa ni con dos palabras distintas', () => {
    expect(coincidencia(p('DE LA FUENTE Ana'), p('DE LA FUENTE GARCIA Maria'))).toBeNull();
    expect(coincidencia(p('GARCIA Ana'), p('GARCIA LOPEZ Ana Maria'))).toEqual({ nivel: 'subconjunto', fuerza: 2 });
    expect(coincidencia(p('RAMON LOPEZ Manue'), p('RAMON LOPEZ Pablo'))).toBeNull();
    expect(coincidencia(p('LOPEZ Ma'), p('LOPEZ Maria'))).toBeNull();
    expect(coincidencia(p('SANCHEZ RUIZ Mario Luis'), p('SANCHEZ RUIZ Maria Lucia'))).toBeNull();
  });

  it('acepta una errata en una sola palabra para nombres compatibles', () => {
    expect(nombresCompatibles(p('GONZALEZ ALMANCHA Sergio'), p('GONZALEZ ALMARCHA Sergio'))).toBe(true);
    expect(nombresCompatibles(p('GOMEZ ULLATE DOMINGUEZ Julia'), p('GOMEZ ULLATE DOMINGUEZ Carmen'))).toBe(false);
    expect(nombresCompatibles(p('ECHEVERRIA Jorge'), p('MONJE ARTOLA Endika'))).toBe(false);
  });
});

describe('elegirPuesto', () => {
  const puestos: Puesto[] = [
    { id: 'r1', palabras: p('RAMIREZ LARENA Alejandro'), raiz: 'ale' },
    { id: 'r2', palabras: p('LACASTA AREN Sergio'), raiz: 'ser' },
    { id: 'r3', palabras: p('LACASTA AREN Daniel'), raiz: 'dan' },
    { id: 'r4', palabras: p('GARCIA LOPEZ'), raiz: 'gl' },
    { id: 'r5', palabras: p('GARCIA LOPEZ Ana'), raiz: 'ana' },
  ];

  it('elige el único puesto que casa', () => {
    expect(elegirPuesto(p('RAMIREZ LARENA Al'), puestos)).toMatchObject({ tipo: 'unico', nivel: 'prefijo', puesto: { raiz: 'ale' } });
  });

  it('es ambiguo con dos personas en el mejor nivel o con un exacto débil y otros parciales', () => {
    expect(elegirPuesto(p('LACASTA AREN'), puestos)).toEqual({ tipo: 'ambiguo', candidatos: 2 });
    expect(elegirPuesto(p('GARCIA LOPEZ'), puestos)).toEqual({ tipo: 'ambiguo', candidatos: 2 });
    expect(elegirPuesto(p('PEREZ SOLA'), puestos)).toEqual({ tipo: 'ninguno' });
  });
});

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

function persona(db: DatabaseSync, id: string, nombre: string, genero: string, pais: string | null, fuente: string, externo?: [string, string, string?]) {
  const norm = palabrasNombre(nombre).sort().join(' ');
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES (?,?,?,?,?)`).run(id, nombre, norm, genero, pais);
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`).run(id, fuente, nombre, norm);
  if (externo) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, scope_season, link_status) VALUES (?,?,?,?,?, 'CONFIRMADO')`)
      .run(id, externo[0], externo[1], externo[0] === 'fie_addr_id' ? 'fie' : 'skermo_rfee', externo[2] ?? '');
  }
}

let n = 0;
function puesto(db: DatabaseSync, comp: string, fuente: string, nombre: string, personaId: string | null, clave = `k${(n += 1)}`) {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, occurred_on, content_hash)
    VALUES (?,?,?,?,?,?, '2024-01-01', 'h')`).run(`r${(n += 1)}`, comp, fuente, clave, personaId, nombre);
}

function asalto(db: DatabaseSync, comp: string, fuente: string, ronda: string, a: [string, string, string | null], b: [string, string, string | null]) {
  const [x, y] = a[0] < b[0] ? [a, b] : [b, a];
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name,
    fencer_a_person_id, fencer_b_person_id, score_a, score_b, content_hash) VALUES (?,?,?,'POULE',?,?,?,?,?,?,?,5,3,'h')`)
    .run(`b${(n += 1)}`, comp, fuente, ronda, x[0], y[0], x[1], y[1], x[2], y[2]);
}

function fixture(): DatabaseSync {
  const db = crearBase();
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
      ('e1', 'rfee_pdf', '2022-2023', 'pdf:1', 'Copa'), ('e2', 'engarde', '2012-2013', 'eg:1', 'Torneo');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category) VALUES
      ('c1', 'e1', 'rfee_pdf', '2022-2023', 'pdf:1:1', 'FLORETE', 'M', 'ABS'),
      ('c2', 'e1', 'rfee_pdf', '2022-2023', 'pdf:1:2', 'FLORETE', 'M', 'M23'),
      ('c3', 'e2', 'engarde', '2012-2013', 'eg:1:1', 'FLORETE', 'M', 'ABS'),
      ('c4', 'e2', 'engarde', '2012-2013', 'eg:1:2', 'FLORETE', 'M', 'VET');`);
  persona(db, 'ale', 'RAMIREZ LARENA Alejandro', 'M', 'ESP', 'fie', ['fie_addr_id', '51361']);
  persona(db, 'juan', 'ZABALA Juan', 'M', 'ESP', 'fie', ['fie_addr_id', '49385']);
  persona(db, 'pepe', 'PEREZ SOLA Pepe', 'M', null, 'rfee_pdf');
  // Persona creada sólo por el nombre truncado de una poule.
  persona(db, 'fantasma', 'RAMIREZ LARENA Al', 'M', null, 'rfee_pdf');

  // c1: clasificación completa; la poule trae nombres truncados.
  puesto(db, 'c1', 'rfee_pdf', 'RAMIREZ LARENA Alejandro', 'ale');
  puesto(db, 'c1', 'rfee_pdf', 'ZABALA GUTIERREZ Juan', 'juan');
  puesto(db, 'c1', 'rfee_pdf', 'PEREZ SOLA Pepe', 'pepe');
  asalto(db, 'c1', 'rfee_pdf', 'P1', ['n:RAMIREZ-LARENA-AL', 'RAMIREZ LARENA Al', 'fantasma'], ['n:ZABALA-GUTIERREZ', 'ZABALA GUTIERREZ', null]);
  asalto(db, 'c1', 'rfee_pdf', 'P1', ['n:PEREZ-SOLA-PEPE', 'PEREZ SOLA Pepe', 'pepe'], ['n:ZABALA-GUTIERREZ', 'ZABALA GUTIERREZ', null]);

  // c2: clasificación parcial. Falta GOMEZ GIL (no impide nada) y falta un hermano
  // ZABALA GUTIERREZ Pedro, que tira: «ZABALA GUTIERREZ» puede ser él o Juan.
  puesto(db, 'c2', 'rfee_pdf', 'RAMIREZ LARENA Alejandro', 'ale');
  puesto(db, 'c2', 'rfee_pdf', 'ZABALA GUTIERREZ Juan', 'juan');
  asalto(db, 'c2', 'rfee_pdf', 'P1', ['n:RAMIREZ-LARENA-ALE', 'RAMIREZ LARENA Ale', null], ['n:X-Y', 'GOMEZ GIL Luis', null]);
  asalto(db, 'c2', 'rfee_pdf', 'P2', ['n:ZABALA-GUTIERREZ', 'ZABALA GUTIERREZ', null], ['n:ZABALA-GUTIERREZ-PEDRO', 'ZABALA GUTIERREZ Pedro', null]);
  return db;
}

const fila = (db: DatabaseSync, sql: string, ...a: string[]) => db.prepare(sql).get(...a) as Record<string, unknown>;

describe('vincularAsaltos', () => {
  it('vincula por la prueba, sustituye a la persona fantasma y no elige entre homónimos', () => {
    const db = fixture();
    const { informe } = vincularAsaltos(db);
    const lados = db.prepare(`SELECT fencer_a_name an, fencer_a_person_id ap, fencer_b_name bn, fencer_b_person_id bp
      FROM sport_bout WHERE competition_id = ? ORDER BY round_key, fencer_a_ref`);
    expect(lados.all('c1')).toEqual([
      { an: 'PEREZ SOLA Pepe', ap: 'pepe', bn: 'ZABALA GUTIERREZ', bp: 'juan' },
      { an: 'RAMIREZ LARENA Al', ap: 'ale', bn: 'ZABALA GUTIERREZ', bp: 'juan' },
    ]);
    expect(lados.all('c2')).toEqual([
      { an: 'RAMIREZ LARENA Ale', ap: 'ale', bn: 'GOMEZ GIL Luis', bp: null },
      { an: 'ZABALA GUTIERREZ', ap: null, bn: 'ZABALA GUTIERREZ Pedro', bp: null },
    ]);
    expect(informe.prueba).toMatchObject({
      vinculados: { referencia: 0, exacto: 0, subconjunto: 1, prefijo: 2 },
      ladosVinculados: 3,
      ladosRevinculados: 1,
      descartadosHomonimo: 1,
    });
  });

  it('reasigna en la prueba los lados de una persona sólo por nombre aunque tenga puestos en otras', () => {
    const db = fixture();
    persona(db, 'gr', 'GOMEZ RUIZ Mario', 'M', 'ESP', 'fie', ['fie_addr_id', '777']);
    persona(db, 'pnom', 'GOMEZ RUIZ', 'M', null, 'rfee_pdf');
    puesto(db, 'c1', 'rfee_pdf', 'GOMEZ RUIZ Mario', 'gr');
    puesto(db, 'c2', 'rfee_pdf', 'GOMEZ RUIZ', 'pnom');
    asalto(db, 'c1', 'rfee_pdf', 'P3', ['n:GOMEZ-RUIZ', 'GOMEZ RUIZ', 'pnom'], ['n:PEREZ-SOLA-PEPE', 'PEREZ SOLA Pepe', 'pepe']);
    asalto(db, 'c2', 'rfee_pdf', 'P3', ['n:GOMEZ-RUIZ', 'GOMEZ RUIZ', 'pnom'], ['n:RAMIREZ-LARENA-ALE', 'RAMIREZ LARENA Ale', null]);
    vincularAsaltos(db);
    expect(fila(db, `SELECT fencer_a_person_id a FROM sport_bout WHERE competition_id='c1' AND round_key='P3'`)).toEqual({ a: 'gr' });
    // En c2 su puesto es el de la persona por nombre: no cambia.
    expect(fila(db, `SELECT fencer_a_person_id a FROM sport_bout WHERE competition_id='c2' AND round_key='P3'`)).toEqual({ a: 'pnom' });
  });

  it('no deja a una persona dos veces en la misma ronda', () => {
    const db = fixture();
    // Dos referencias distintas de la misma poule que casarían con Alejandro.
    asalto(db, 'c1', 'rfee_pdf', 'P2', ['n:RAMIREZ-LARENA-ALEJ', 'RAMIREZ LARENA Alej', null], ['n:RAMIREZ-LARENA-ALEJAN', 'RAMIREZ LARENA Alejan', null]);
    const { informe } = vincularAsaltos(db);
    expect(fila(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE round_key='P2' AND competition_id='c1'`))
      .toEqual({ a: null, b: null });
    expect(informe.prueba.descartadosRonda).toBe(2);
  });

  it('hereda la persona por la licencia Engarde y por la misma referencia en la prueba', () => {
    const db = fixture();
    persona(db, 'luis', 'GOMEZ GIL Luis', 'M', null, 'engarde');
    puesto(db, 'c3', 'engarde', 'GOMEZ GIL Luis', 'luis', 'lic:N-1');
    puesto(db, 'c4', 'engarde', 'GOMEZ GIL Luis', null, 'lic:N-1');
    asalto(db, 'c4', 'engarde', 'P1', ['lic:N-1', 'GOMEZ GIL Luis', null], ['engarde:otro|', 'OTRO Tirador', null]);
    asalto(db, 'c3', 'engarde', 'P1', ['lic:N-1', 'GOMEZ GIL Luis', 'luis'], ['lic:N-2', 'PEREZ SOLA Pepe', 'pepe']);
    asalto(db, 'c3', 'engarde', 'P2', ['lic:N-1', 'GOMEZ GIL Luis', null], ['lic:N-3', 'RUIZ Tomas', null]);
    const { informe } = vincularAsaltos(db);
    expect(informe.licencias).toMatchObject({ refsUnaPersona: 2, ladosVinculados: 2, puestosVinculados: 1 });
    expect(fila(db, `SELECT person_id p FROM sport_result WHERE competition_id='c4'`)).toEqual({ p: 'luis' });
    expect(fila(db, `SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE competition_id='c4'`)).toEqual({ a: null, b: 'luis' });
  });

  it('funde el mismo nombre completo sin coincidencias y propone el resto', () => {
    const db = fixture();
    persona(db, 'oab1', 'OSCAR ARRIBAS BURGOS', 'M', null, 'skermo_rfee', ['rfee_license', 'OAB00828', '2023-2024']);
    persona(db, 'oab2', 'OSCAR ARRIBAS BURGOS', 'M', null, 'skermo_rfee', ['rfee_license', 'OAB09652', '2024-2025']);
    persona(db, 'dos1', 'MARIA LOPEZ RUIZ', 'F', null, 'skermo_rfee', ['rfee_license', 'L1', '2024-2025']);
    persona(db, 'dos2', 'MARIA LOPEZ RUIZ', 'F', null, 'skermo_rfee', ['rfee_license', 'L2', '2024-2025']);
    persona(db, 'tres1', 'PABLO DIAZ SOTO', 'M', null, 'skermo_rfee', ['rfee_license', 'L3', '2022-2023']);
    persona(db, 'tres2', 'PABLO DIAZ SOTO', 'M', null, 'rfee_pdf');
    persona(db, 'horno', 'HORNO Gracia', 'F', 'ESP', 'fie', ['fie_addr_id', '20583']);
    persona(db, 'hornop', 'HORNO PEREZ Gracia', 'F', null, 'engarde');
    puesto(db, 'c1', 'rfee_pdf', 'OSCAR ARRIBAS BURGOS', 'oab1');
    puesto(db, 'c3', 'engarde', 'OSCAR ARRIBAS BURGOS', 'oab2');
    puesto(db, 'c1', 'rfee_pdf', 'MARIA LOPEZ RUIZ', 'dos1');
    puesto(db, 'c3', 'engarde', 'MARIA LOPEZ RUIZ', 'dos2');
    puesto(db, 'c3', 'engarde', 'PABLO DIAZ SOTO', 'tres1');
    puesto(db, 'c3', 'engarde', 'PABLO DIAZ SOTO', 'tres2');
    puesto(db, 'c2', 'rfee_pdf', 'HORNO Gracia', 'horno');
    puesto(db, 'c3', 'engarde', 'HORNO PEREZ Gracia', 'hornop');
    const { informe, propuestas } = vincularAsaltos(db);
    expect(informe.fusiones.nombreIdentico).toBe(1);
    expect(fila(db, `SELECT count(*) n FROM sport_person WHERE id IN ('oab1','oab2') AND merged_into_person_id IS NOT NULL`)).toEqual({ n: 1 });
    // Dos licencias en la misma temporada: dos personas, ni se funden ni se proponen.
    expect(fila(db, `SELECT count(*) n FROM sport_person WHERE id IN ('dos1','dos2') AND merged_into_person_id IS NULL`)).toEqual({ n: 2 });
    // Coinciden en la misma prueba: propuesta, no fusión.
    expect(fila(db, `SELECT count(*) n FROM sport_person WHERE id IN ('tres1','tres2') AND merged_into_person_id IS NULL`)).toEqual({ n: 2 });
    expect(propuestas.filter((x) => !x.aplicada).map((x) => [x.tipo, x.origen.id, x.destino.id])).toEqual(
      expect.arrayContaining([
        ['nombre_identico_con_coincidencia', 'tres2', 'tres1'],
        ['apellido_fie', 'hornop', 'horno'],
      ]),
    );
    expect(fila(db, `SELECT count(*) n FROM sport_link_candidate WHERE source='fusion_vincular_asaltos' AND status='CONFIRMADO'`)).toEqual({ n: 1 });
  });

  it('propone los truncados de una misma persona y no los de dos hermanos', () => {
    const db = fixture();
    persona(db, 'juanl', 'JUAN ZABALA GUTIERREZ', 'M', null, 'skermo_rfee', ['rfee_license', 'JZG1', '2024-2025']);
    persona(db, 'zg', 'ZABALA GUTIERREZ', 'M', null, 'rfee_pdf');
    persona(db, 'zgju', 'ZABALA GUTIERREZ Ju', 'M', null, 'rfee_pdf');
    persona(db, 'zgjua', 'ZABALA GUTIERREZ Jua', 'M', null, 'rfee_pdf');
    // Su ficha RFEE ya está fundida en la FIE, como la deja unificar-personas.
    db.exec(`UPDATE sport_person SET merged_into_person_id = 'juan' WHERE id = 'juanl'`);
    puesto(db, 'c3', 'engarde', 'JUAN ZABALA GUTIERREZ', 'juanl');
    asalto(db, 'c4', 'rfee_pdf', 'P1', ['n:ZG', 'ZABALA GUTIERREZ', 'zg'], ['n:O1', 'OTRO Uno', null]);
    asalto(db, 'c4', 'rfee_pdf', 'P2', ['n:ZGJU', 'ZABALA GUTIERREZ Ju', 'zgju'], ['n:O2', 'OTRO Dos', null]);
    asalto(db, 'c4', 'rfee_pdf', 'P3', ['n:ZGJUA', 'ZABALA GUTIERREZ Jua', 'zgjua'], ['n:O3', 'OTRO Tres', null]);
    const truncados = (ps: ReturnType<typeof vincularAsaltos>['propuestas']) =>
      ps.filter((x) => x.tipo === 'nombre_truncado').map((x) => `${x.origen.id}>${x.destino.id}`).sort();
    expect(truncados(vincularAsaltos(db).propuestas)).toEqual(['zg>juan', 'zgju>juan', 'zgjua>juan']);

    persona(db, 'pedro', 'ZABALA GUTIERREZ Pedro', 'M', null, 'rfee_pdf');
    asalto(db, 'c4', 'rfee_pdf', 'P4', ['n:ZGP', 'ZABALA GUTIERREZ Pedro', 'pedro'], ['n:O4', 'OTRO Cuatro', null]);
    expect(truncados(vincularAsaltos(db).propuestas)).toEqual(['zgju>juan', 'zgjua>juan']);
  });

  it('valida las propuestas externas sin aplicarlas', () => {
    const db = fixture();
    persona(db, 'padf', 'PADURA M.jose', 'F', 'ESP', 'fie', ['fie_addr_id', '20623']);
    persona(db, 'padr', 'MARÍA JOSÉ PADURA MÚGICA', 'F', null, 'skermo_rfee', ['rfee_license', 'MPM1', '2024-2025']);
    persona(db, 'otra', 'ANA RUIZ SOLER', 'F', null, 'skermo_rfee', ['rfee_license', 'ARS1', '2024-2025']);
    puesto(db, 'c3', 'engarde', 'PADURA M.jose', 'padf');
    puesto(db, 'c4', 'engarde', 'MARÍA JOSÉ PADURA MÚGICA', 'padr');
    puesto(db, 'c4', 'engarde', 'ANA RUIZ SOLER', 'otra');
    const { propuestas } = vincularAsaltos(db, {
      externas: [
        { origen: 'padr', destino: 'padf', evidencia: 'fecha_nacimiento:1965-03-18' },
        { origen: 'otra', destino: 'padf', evidencia: 'fecha_nacimiento:1965-03-18' },
      ],
    });
    expect(propuestas.filter((x) => x.tipo.startsWith('externa')).map((x) => [x.tipo, x.origen.id, x.evidencia])).toEqual([
      ['externa_valida', 'padr', 'fecha_nacimiento:1965-03-18'],
      ['externa_rechazada', 'otra', 'fecha_nacimiento:1965-03-18:nombre'],
    ]);
    expect(fila(db, `SELECT merged_into_person_id m FROM sport_person WHERE id='padr'`)).toEqual({ m: null });
  });

  it('es idempotente', () => {
    const db = fixture();
    vincularAsaltos(db);
    const segunda = vincularAsaltos(db).informe;
    expect(segunda.prueba.ladosVinculados + segunda.prueba.ladosRevinculados + segunda.licencias.ladosVinculados).toBe(0);
    expect(segunda.fusiones).toEqual({ licenciaEngarde: 0, nombreIdentico: 0, omitidasAtleta: 0 });
    expect(segunda.despues).toEqual(segunda.antes);
  });
});
