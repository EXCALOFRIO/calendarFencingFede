import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { separarUnionesPorNombre } from '../scripts/indexado/separar-uniones';
import { ALIAS_EFC, unificarPersonas } from '../scripts/indexado/unificar-personas';
import { vincularAsaltos } from '../scripts/indexado/vincular-asaltos';
import { nombreVisible } from '../src/lib/sport/nombre-visible';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let n = 0;
function prueba(db: DatabaseSync, id: string, source: string, o: { arma?: string; genero?: string; cat?: string; temporada?: string } = {}) {
  const t = o.temporada ?? '2023-2024';
  db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES (?,?,?,?,?, '2024-01-31')`)
    .run(`e${id}`, source, t, `t:${id}`, `Torneo ${id}`);
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
    VALUES (?,?,?,?,?,?,?,?,'INDIVIDUAL','2024-01-31')`).run(id, `e${id}`, source, t, `k:${id}`, o.arma ?? 'SABLE', o.genero ?? 'M', o.cat ?? 'ABS');
}
function puesto(db: DatabaseSync, comp: string, source: string, nombre: string, o: { persona?: string | null; clave?: string; pais?: string | null; club?: string } = {}) {
  const id = `r${(n += 1)}`;
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_country_code, source_club, position, content_hash)
    VALUES (?,?,?,?,?,?,?,?,?, 'h')`).run(id, comp, source, o.clave ?? `ref:${nombre}:${id}`, o.persona ?? null, nombre, o.pais ?? 'ESP', o.club ?? null, n);
  return id;
}
function persona(db: DatabaseSync, id: string, nombre: string, o: { genero?: string; pais?: string | null; fie?: string; licencia?: string; temporada?: string; alias?: string; fundida?: string } = {}) {
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code, merged_into_person_id) VALUES (?,?,?,?,?,?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero ?? 'M', o.pais === undefined ? 'ESP' : o.pais, o.fundida ?? null);
  const alias = o.alias ?? (o.fie ? 'fie' : o.licencia ? 'skermo_rfee' : null);
  if (alias) {
    db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`).run(id, alias, nombre, normalizarNombre(nombre));
  }
  if (o.fie) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'fie_addr_id', ?, 'fie', 'CONFIRMADO')`).run(id, o.fie);
  }
  if (o.licencia) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, scope_season, link_status)
      VALUES (?, 'rfee_license', ?, 'skermo_rfee', ?, 'CONFIRMADO')`).run(id, o.licencia, o.temporada ?? '2023-2024');
  }
}
const uno = <T>(db: DatabaseSync, sql: string, ...p: string[]) => db.prepare(sql).get(...p) as T;
const personaDe = (db: DatabaseSync, resultado: string) =>
  uno<{ p: string | null }>(db, `SELECT coalesce(p.merged_into_person_id, p.id) p FROM sport_result r LEFT JOIN sport_person p ON p.id = r.person_id WHERE r.id = ?`, resultado).p;

describe('paso por nombre: el orden de los apellidos separa personas', () => {
  it('«ORTIN ROMERO Hector» no se vincula con la FIE «ROMERO ORTIN Hector»', () => {
    const db = crearBase();
    persona(db, 'hector', 'ROMERO ORTIN Hector', { fie: '1001' });
    prueba(db, 'p1', 'rfee_pdf');
    prueba(db, 'p2', 'rfee_pdf');
    prueba(db, 'p3', 'rfee_pdf');
    prueba(db, 'p4', 'rfee_pdf');
    const bien = puesto(db, 'p1', 'rfee_pdf', 'ROMERO ORTIN Hector');
    const cruzado = puesto(db, 'p2', 'rfee_pdf', 'ORTIN ROMERO Hector');
    // Dos palabras: los mismos apellidos en otro orden son otra persona (otro grupo de nombre).
    const corto = puesto(db, 'p3', 'rfee_pdf', 'ROMERO ORTIN');
    const cortoCruzado = puesto(db, 'p4', 'rfee_pdf', 'ORTIN ROMERO');
    const inf = unificarPersonas(db);
    expect(personaDe(db, bien)).toBe('hector');
    const otra = personaDe(db, cruzado);
    expect(otra).not.toBeNull();
    expect(otra).not.toBe('hector');
    expect(uno(db, `SELECT display_name n FROM sport_person WHERE id = ?`, otra!)).toEqual({ n: 'ORTIN ROMERO Hector' });
    expect(personaDe(db, corto)).not.toBe(personaDe(db, cortoCruzado));
    expect(personaDe(db, cortoCruzado)).not.toBe('hector');
    expect(inf.orden.porRelacion.orden_cruzado).toBeGreaterThan(0);
    // `vincular-asaltos` tampoco las junta por «el mismo nombre de 3 palabras».
    const v = vincularAsaltos(db);
    expect(v.informe.fusiones.nombreIdentico).toBe(0);
    expect(v.informe.propuestas.nombre_identico_orden).toBe(1);
    expect(personaDe(db, cruzado)).toBe(otra);
  });

  it('nombre compuesto frente a simple sí; el compuesto con los nombres en otro orden, no', () => {
    const db = crearBase();
    persona(db, 'jm', 'GARCIA LOPEZ Jose Maria', { fie: '2001' });
    prueba(db, 'p1', 'rfee_pdf');
    prueba(db, 'p2', 'rfee_pdf');
    const jose = puesto(db, 'p1', 'rfee_pdf', 'GARCIA LOPEZ Jose');
    const mariaJose = puesto(db, 'p2', 'rfee_pdf', 'GARCIA LOPEZ Maria Jose');
    unificarPersonas(db);
    expect(personaDe(db, jose)).toBe('jm');
    expect(personaDe(db, mariaJose)).not.toBe('jm');
  });

  it('el nombre visible conserva el orden publicado de los apellidos', () => {
    expect(nombreVisible('ROMERO ORTÍN Héctor')).toMatch(/Romero Ort[ií]n/);
    expect(nombreVisible('ORTIN ROMERO Héctor')).toMatch(/Ortin Romero/);
    expect(nombreVisible('HÉCTOR ROMERO ORTÍN')).toMatch(/Romero Ort[ií]n/);
  });
});

describe('vincular-asaltos: el mismo nombre con una persona de licencia EFC', () => {
  function base(anios: Map<string, number>) {
    const db = crearBase();
    prueba(db, 'c1', 'efc', { arma: 'FLORETE', cat: 'M17', temporada: '2022-2023' });
    prueba(db, 'c2', 'efc', { arma: 'FLORETE', cat: 'M17', temporada: '2023-2024' });
    persona(db, 'l1', 'BONALAIR Lou-Anne', { genero: 'F', pais: 'FRA', alias: ALIAS_EFC });
    persona(db, 'l2', 'BONALAIR Lou-Anne', { genero: 'F', pais: 'FRA', alias: ALIAS_EFC });
    puesto(db, 'c1', 'efc', 'BONALAIR Lou-Anne', { persona: 'l1', clave: 'efc:lic:111', pais: 'FRA' });
    puesto(db, 'c2', 'efc', 'BONALAIR Lou-Anne', { persona: 'l2', clave: 'efc:lic:222', pais: 'FRA' });
    return { db, opciones: { nacimientosEfc: anios } };
  }
  it('con años EFC que casan se funden; sin años, sólo se proponen', () => {
    const a = base(new Map([['111', 2008], ['222', 2008]]));
    expect(vincularAsaltos(a.db, a.opciones).informe.fusiones.nombreIdentico).toBe(1);
    const b = base(new Map([['111', 2008]]));
    const r = vincularAsaltos(b.db, b.opciones);
    expect(r.informe.fusiones.nombreIdentico).toBe(0);
    expect(r.informe.propuestas.nombre_identico_efc_sin_anio).toBe(1);
    const c = base(new Map([['111', 2008], ['222', 2004]]));
    expect(vincularAsaltos(c.db, c.opciones).informe.fusiones.nombreIdentico).toBe(0);
  });
});

describe('separar-uniones: uniones pasadas que las reglas ya no permiten', () => {
  it('separa la fundida con apellidos cruzados y desvincula sus filas; respeta la licencia', () => {
    const db = crearBase();
    persona(db, 'hector', 'ROMERO ORTIN Hector', { fie: '1001' });
    persona(db, 'pdf', 'ORTIN ROMERO', { alias: 'rfee_pdf', fundida: 'hector' });
    persona(db, 'lic', 'HECTOR ROMERO ORTIN', { licencia: 'HRO1', fundida: 'hector' });
    persona(db, 'hermano', 'ROMERO ORTIN German', { alias: 'rfee_pdf', fundida: 'hector' });
    // Licencia compartida: aunque el nombre esté cruzado, es la misma persona.
    persona(db, 'sandra', 'SANDRA ORTIN ROMERO', { genero: 'F', licencia: 'SOR1' });
    persona(db, 'sandra2', 'SANDRA ROMERO ORTIN', { genero: 'F', licencia: 'SOR1', temporada: '2022-2023', fundida: 'sandra' });
    db.prepare(`INSERT INTO sport_link_candidate (source, source_ref, source_name, person_id, status, evidence)
      VALUES ('fusion_evidencia', 'pdf', 'ORTIN ROMERO', 'hector', 'CONFIRMADO', 'recortado:club:CESJV-B+arma+carrera')`).run();
    prueba(db, 'p1', 'rfee_pdf');
    prueba(db, 'p2', 'engarde');
    const a = puesto(db, 'p1', 'rfee_pdf', 'ORTIN ROMERO', { persona: 'pdf' });
    const b = puesto(db, 'p2', 'engarde', 'ROMERO ORTIN', { persona: 'pdf' });
    const c = puesto(db, 'p1', 'rfee_pdf', 'ROMERO ORTIN Hector', { persona: 'hector' });
    const inf = separarUnionesPorNombre(db);
    const fundida = (id: string) => uno<{ m: string | null }>(db, `SELECT merged_into_person_id m FROM sport_person WHERE id = ?`, id).m;
    expect(fundida('pdf')).toBeNull();
    expect(fundida('hermano')).toBeNull();
    expect(fundida('lic')).toBe('hector');
    expect(fundida('sandra2')).toBe('sandra');
    expect(inf.miembros).toMatchObject({ separados: 2, conservadosPorPrueba: 1, porRelacion: { orden_cruzado: 1, hermanos: 1 } });
    expect(inf.separaciones.find((s) => s.persona === 'pdf')).toMatchObject({
      nombresPersona: ['ORTIN ROMERO'], relacion: 'orden_cruzado', fusion: 'recortado:club:CESJV-B+arma+carrera',
    });
    // «ROMERO ORTIN» (Engarde) quedó en la persona «ORTIN ROMERO»: cruzado, se suelta; los demás no.
    expect(personaDe(db, a)).toBe('pdf');
    expect(personaDe(db, b)).toBeNull();
    expect(personaDe(db, c)).toBe('hector');
    expect(inf.filas.puestos).toBe(1);
    expect(uno(db, `SELECT count(*) n FROM sport_link_candidate WHERE source = 'separacion_nombre' AND status = 'RECHAZADO'`)).toEqual({ n: 2 });
    // Idempotente.
    expect(separarUnionesPorNombre(db).miembros.separados).toBe(0);
  });

  it('una unión revisada a mano (`revision_manual`) se queda, y también las filas que trajo', () => {
    const db = crearBase();
    persona(db, 'marco', 'MARCO NUNO GONZALEZ PEÑAS', { licencia: 'MPG1' });
    persona(db, 'pdf', 'PEÑAS GONZALEZ Marco Nuno', { alias: 'rfee_pdf', fundida: 'marco' });
    db.prepare(`INSERT INTO sport_link_candidate (source, source_ref, source_name, person_id, status, evidence)
      VALUES ('revision_manual', 'pdf', 'PEÑAS GONZALEZ Marco Nuno', 'marco', 'CONFIRMADO', 'revision_manual:pdf_apellidos_invertidos')`).run();
    prueba(db, 'p1', 'rfee_pdf');
    prueba(db, 'p2', 'rfee_pdf');
    const a = puesto(db, 'p1', 'rfee_pdf', 'PEÑAS GONZALEZ Marco Nuno', { persona: 'pdf' });
    const b = puesto(db, 'p2', 'rfee_pdf', 'PEÑAS GONZALEZ Marco Nuno', { persona: 'marco' });
    const inf = separarUnionesPorNombre(db);
    expect(uno(db, `SELECT merged_into_person_id m FROM sport_person WHERE id = 'pdf'`)).toEqual({ m: 'marco' });
    expect(inf.miembros.separados).toBe(0);
    expect(personaDe(db, a)).toBe('marco');
    expect(personaDe(db, b)).toBe('marco');
    expect(inf.filas.puestos).toBe(0);
  });
});
