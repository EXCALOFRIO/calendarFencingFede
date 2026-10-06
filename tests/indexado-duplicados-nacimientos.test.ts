import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import {
  fechaPublicada,
  fechasChocan,
  fundirPorFechaNacimiento,
  nacimientosPorPersona,
  nombresCompatiblesPorFecha,
  partirNombreFie,
  partirPorFechaNacimiento,
  type FechasNacimiento,
  type FilaSkermoFecha,
} from '../scripts/indexado/dedupe-nacimientos';
import { unificarPersonas } from '../scripts/indexado/unificar-personas';
import { vincularAsaltos } from '../scripts/indexado/vincular-asaltos';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES
      ('es', 'skermo_rfee', '2023-2024', 'RFEE:1', 'TNR'), ('ep', 'rfee_pdf', '2023-2024', 'pdf:x', 'TNR'),
      ('ef', 'fie', '2023-2024', 'fie:x', 'Copa del Mundo');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('s1', 'es', 'skermo_rfee', '2023-2024', 'RFEE:1', 'ESPADA', 'M', 'ABS', '2024-01-01'),
      ('s2', 'es', 'skermo_rfee', '2023-2024', 'RFEE:2', 'ESPADA', 'M', 'ABS', '2024-02-01'),
      ('s3', 'es', 'skermo_rfee', '2023-2024', 'RFEE:3', 'ESPADA', 'M', 'ABS', '2024-03-01'),
      ('p1', 'ep', 'rfee_pdf', '2023-2024', 'k1', 'ESPADA', 'M', 'ABS', '2024-04-01'),
      ('p2', 'ep', 'rfee_pdf', '2023-2024', 'k2', 'ESPADA', 'M', 'ABS', '2024-05-01'),
      ('f1', 'ef', 'fie', '2023-2024', 'fie:1', 'ESPADA', 'M', 'ABS', '2024-06-01'),
      ('f2', 'ef', 'fie', '2023-2024', 'fie:2', 'ESPADA', 'M', 'ABS', '2024-07-01');`);
  return db;
}

type OpcionesPersona = { genero?: 'M' | 'F'; fie?: string; licencia?: string; temporada?: string; en?: string; fuente?: string };
function persona(db: DatabaseSync, id: string, nombre: string, o: OpcionesPersona = {}) {
  const fuente = o.fuente ?? (o.fie ? 'fie' : o.licencia ? 'skermo_rfee' : 'rfee_pdf');
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code, merged_into_person_id) VALUES (?,?,?,?,?,?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero ?? 'M', o.fie ? 'ESP' : null, o.en ?? null);
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`)
    .run(id, fuente, nombre, normalizarNombre(nombre));
  if (o.fie) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'fie_addr_id', ?, 'fie', 'CONFIRMADO')`)
      .run(id, o.fie);
  }
  if (o.licencia) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, scope_season, link_status)
      VALUES (?, 'rfee_license', ?, 'skermo_rfee', ?, 'CONFIRMADO')`).run(id, o.licencia, o.temporada ?? '2023-2024');
  }
}
let n = 0;
/** Puesto Skermo de la prueba `comp` (`s1` → Skermo 1) con su licencia. */
function puestoSkermo(db: DatabaseSync, comp: string, licencia: string, nombre: string, p: string | null, sufijo = '') {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, source_url, content_hash)
    VALUES (?,?, 'skermo_rfee', ?,?,?,?,?, 'h')`)
    .run(`r${(n += 1)}`, comp, `lic:${licencia}${sufijo}`, p, nombre, n, `https://app.skermo.org/ranking/public/RFEE/competition/${comp.slice(1)}?setLang=es`);
  return `r${n}`;
}
function puesto(db: DatabaseSync, comp: string, nombre: string, p: string | null, source = 'rfee_pdf') {
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash)
    VALUES (?,?,?,?,?,?,?, 'h')`).run(`r${(n += 1)}`, comp, source, `k${n}`, p, nombre, n);
  return `r${n}`;
}
function asalto(db: DatabaseSync, comp: string, an: string, ap: string | null, bn: string, bp: string | null) {
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id,
    fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?,?,'rfee_pdf','POULE','P1',?,?,?,?,?,?,5,3,?)`)
    .run(`b${(n += 1)}`, comp, `ref:a${n}`, `ref:b${n}`, ap, bp, an, bn, `h${n}`);
  return `b${n}`;
}
const fechasDe = (fie: Record<string, string>, skermo: Record<string, FilaSkermoFecha[]>): FechasNacimiento => ({
  fie: new Map(Object.entries(fie)),
  skermo: new Map(Object.entries(skermo)),
});
const fila = (licencia: string, nombre: string, apellidos: string, fecha: string): FilaSkermoFecha => ({ licencia, nombre, apellidos, fecha });
const raiz = (db: DatabaseSync, id: string) =>
  (db.prepare(`SELECT coalesce(merged_into_person_id, id) r FROM sport_person WHERE id = ?`).get(id) as { r: string }).r;
const personaDe = (db: DatabaseSync, tabla: 'sport_result' | 'sport_bout', id: string, col = 'person_id') =>
  (db.prepare(`SELECT ${col} p FROM ${tabla} WHERE id = ?`).get(id) as { p: string | null }).p;

describe('nombres y fechas', () => {
  it('compara nombres FIE y nacionales cuando la fecha ya identifica', () => {
    const c = (fie: string, nombre: string, apellidos: string) =>
      nombresCompatiblesPorFecha(partirNombreFie(fie)!, { nombre: nombre.toLowerCase().split(' '), apellidos: apellidos.toLowerCase().split(/[\s-]+/) });
    expect(c('CODON MIRAVALLE Roberto', 'ROBERTO', 'CODON MIRAVALLES')).toBe(true);
    expect(c('PADURA M.jose', 'MARIA JOSE', 'PADURA MUGICA')).toBe(true);
    expect(c('MORENO Pablo', 'PABLO', 'MORENO SANCHEZ')).toBe(true);
    expect(c('LUQUE Ana', 'ANA', 'LUQUE LOPEZ-MINGO')).toBe(true);
    expect(c('LUQUE Ana', 'MARTA', 'LUQUE LOPEZ')).toBe(false);
    expect(c('LUCAS Ana', 'ANA', 'LUQUE LOPEZ')).toBe(false);
  });

  it('dos fechas chocan si difieren en más de un año', () => {
    expect(fechasChocan(['1992-09-30'], ['1981-10-04'])).toBe(true);
    expect(fechasChocan(['1992-09-30'], ['1993-03-01'])).toBe(false);
    expect(fechasChocan([], ['1981-10-04'])).toBe(false);
  });

  it('la fila de Skermo de un puesto sale de su prueba y licencia; con licencia repetida decide el nombre', () => {
    const f = fechasDe({}, { 7: [fila('CAD01100', 'CLARA', 'ALVAREZ DE TOLEDO PENA', '1998-02-12'), fila('CAD01100', 'CARLOTA', 'ALVAREZ DE TOLEDO PENA', '2002-04-30')] });
    const url = 'https://app.skermo.org/ranking/public/RFEE/competition/7?setLang=es';
    expect(fechaPublicada(f, { source_url: url, source_fact_key: 'lic:CAD01100#2', source_name: 'CARLOTA ALVAREZ DE TOLEDO PENA' })?.fecha).toBe('2002-04-30');
    expect(fechaPublicada(f, { source_url: url, source_fact_key: 'lic:CAD01100', source_name: 'OTRA PERSONA' })).toBeNull();
  });
});

describe('partir por fecha de nacimiento', () => {
  /** «ESCOBAR Javier» (FIE, 1992) se quedó los puestos de «JAVIER ALONSO ESCOBAR» (1981), que también está en la FIE. */
  const caso = () => {
    const db = crearBase();
    persona(db, 'fe', 'ESCOBAR Javier', { fie: '26791' });
    persona(db, 'fa', 'ALONSO ESCOBAR Javier', { fie: '41937' });
    persona(db, 'l1', 'JAVIER ALONSO ESCOBAR', { licencia: 'JAE00441', temporada: '2022-2023', en: 'fe' });
    persona(db, 'l2', 'JAVIER ALONSO ESCOBAR', { licencia: 'JAE00441', temporada: '2023-2024', en: 'fe' });
    db.exec(`INSERT INTO sport_link_candidate (source, source_ref, source_name, person_id, status, evidence)
      VALUES ('fusion_fie_rfee', 'l1', 'JAVIER ALONSO ESCOBAR', 'fe', 'CONFIRMADO', 'nombre_superconjunto_unico')`);
    const filas = {
      s1: puestoSkermo(db, 's1', 'JAE00441', 'JAVIER ALONSO ESCOBAR', 'l1'),
      s2: puestoSkermo(db, 's2', 'JAE00441', 'JAVIER ALONSO ESCOBAR', 'l2'),
      pdfDeG: puesto(db, 'p1', 'ALONSO ESCOBAR Javier', 'fe'),
      pdfFie: puesto(db, 'p2', 'ESCOBAR Javier', 'fe'),
      fie: puesto(db, 'f1', 'ESCOBAR Javier', 'fe', 'fie'),
      asaltoPrueba: asalto(db, 's1', 'ALONSO ESCOBAR J', 'fe', 'OTRO Rival', null),
      asaltoNombre: asalto(db, 'p1', 'ALONSO ESCOBAR Javier', 'fe', 'OTRO Rival', null),
      asaltoFie: asalto(db, 'p2', 'ESCOBAR Javier', 'fe', 'OTRO Rival', null),
    };
    const fechas = fechasDe({ 26791: '1992-09-30', 41937: '1981-10-04' }, {
      1: [fila('JAE00441', 'JAVIER', 'ALONSO ESCOBAR', '1981-10-04')],
      2: [fila('JAE00441', 'JAVIER', 'ALONSO ESCOBAR', '1981-10-04')],
    });
    return { db, filas, fechas };
  };

  it('pasa los puestos, fichas, alias y asaltos a la persona con esa fecha exacta y nombre compatible', () => {
    const { db, filas, fechas } = caso();
    const inf = partirPorFechaNacimiento(db, fechas);
    expect(inf).toMatchObject({ personasPartidas: 1, grupos: 1, aPersonaExistente: 1, personasNuevas: 0, miembrosMovidos: 2 });
    expect([raiz(db, 'l1'), raiz(db, 'l2')]).toEqual(['fa', 'fa']);
    expect(personaDe(db, 'sport_result', filas.pdfDeG)).toBe('fa');
    // Lo que publica el nombre FIE se queda: no se sabe que no sea él.
    expect(personaDe(db, 'sport_result', filas.pdfFie)).toBe('fe');
    expect(personaDe(db, 'sport_result', filas.fie)).toBe('fe');
    expect(personaDe(db, 'sport_bout', filas.asaltoPrueba, 'fencer_a_person_id')).toBe('fa');
    expect(personaDe(db, 'sport_bout', filas.asaltoNombre, 'fencer_a_person_id')).toBe('fa');
    expect(personaDe(db, 'sport_bout', filas.asaltoFie, 'fencer_a_person_id')).toBe('fe');
    expect(db.prepare(`SELECT status FROM sport_link_candidate WHERE source = 'fusion_fie_rfee'`).get()).toEqual({ status: 'RECHAZADO' });
    expect(db.prepare(`SELECT count(*) n FROM sport_link_candidate WHERE source = 'particion_fecha_nacimiento' AND person_id = 'fa'`).get())
      .toEqual({ n: 2 });
    // Idempotente.
    expect(partirPorFechaNacimiento(db, fechas).personasPartidas).toBe(0);
  });

  it('el género del destino es el de la prueba del puesto (hermanos con la misma licencia)', () => {
    const db = crearBase();
    persona(db, 'mt', 'DIAZ Maria Teresa', { fie: '34259', genero: 'F' });
    persona(db, 'mo', 'DIAZ ESCALONA Mario', { fie: '46064', genero: 'M' });
    persona(db, 'lt', 'MARIA TERESA DIAZ ESCALONA', { licencia: 'MDE00001', genero: 'F', en: 'mt' });
    const suyo = puestoSkermo(db, 's1', 'MDE00001', 'MARIA TERESA DIAZ ESCALONA', 'lt');
    const delHermano = puestoSkermo(db, 's2', 'MDE00001', 'MARIO DIAZ ESCALONA', 'lt');
    const fechas = fechasDe({ 34259: '1997-12-12', 46064: '2002-12-27' }, {
      1: [fila('MDE00001', 'MARIA TERESA', 'DIAZ ESCALONA', '1997-12-12')],
      2: [fila('MDE00001', 'MARIO', 'DIAZ ESCALONA', '2002-12-27')],
    });
    expect(partirPorFechaNacimiento(db, fechas)).toMatchObject({ aPersonaExistente: 1, personasNuevas: 0, miembrosMovidos: 0, resultadosMovidos: 1 });
    expect(personaDe(db, 'sport_result', delHermano)).toBe('mo');
    expect(personaDe(db, 'sport_result', suyo)).toBe('lt');
  });

  it('sin persona con esa fecha, la ficha de licencia más reciente pasa a ser la persona', () => {
    const { db, fechas } = caso();
    fechas.fie.delete('41937');
    const inf = partirPorFechaNacimiento(db, fechas);
    expect(inf).toMatchObject({ personasNuevas: 1, aPersonaExistente: 0 });
    expect([raiz(db, 'l1'), raiz(db, 'l2')]).toEqual(['l2', 'l2']);
  });

  it('con la misma licencia y nombre también con una fecha que casa es una errata: no parte', () => {
    const { db, fechas } = caso();
    fechas.skermo.set('3', [fila('JAE00441', 'JAVIER', 'ALONSO ESCOBAR', '1992-09-30')]);
    puestoSkermo(db, 's3', 'JAE00441', 'JAVIER ALONSO ESCOBAR', 'l2');
    expect(partirPorFechaNacimiento(db, fechas)).toMatchObject({ grupos: 0, omitidosErrata: 1 });
    expect(raiz(db, 'l1')).toBe('fe');
  });

  it('sin FIE, separa dos grupos de fechas con nombres de pila distintos (hermanas con la misma licencia)', () => {
    const db = crearBase();
    db.exec("UPDATE sport_competition SET gender = 'F'");
    persona(db, 'ca', 'CARLOTA ALVAREZ DE TOLEDO PENA', { genero: 'F', licencia: 'CAD01100' });
    const carlota = [puestoSkermo(db, 's1', 'CAD01100', 'CARLOTA ALVAREZ DE TOLEDO PENA', 'ca'), puestoSkermo(db, 's2', 'CAD01100', 'CARLOTA ALVAREZ DE TOLEDO PENA', 'ca')];
    const clara = puestoSkermo(db, 's3', 'CAD01100', 'CLARA ALVAREZ DE TOLEDO PENA', 'ca');
    const fechas = fechasDe({}, {
      1: [fila('CAD01100', 'CARLOTA', 'ALVAREZ DE TOLEDO PENA', '2002-04-30')],
      2: [fila('CAD01100', 'CARLOTA', 'ALVAREZ DE TOLEDO PENA', '2002-04-30')],
      3: [fila('CAD01100', 'CLARA', 'ALVAREZ DE TOLEDO PENA', '1998-02-12')],
    });
    const inf = partirPorFechaNacimiento(db, fechas);
    expect(inf).toMatchObject({ personasPartidas: 1, personasNuevas: 1, resultadosMovidos: 1 });
    const nueva = personaDe(db, 'sport_result', clara)!;
    expect(nueva).not.toBe('ca');
    expect(db.prepare(`SELECT display_name n, gender g FROM sport_person WHERE id = ?`).get(nueva)).toEqual({ n: 'CLARA ALVAREZ DE TOLEDO PENA', g: 'F' });
    expect(carlota.map((r) => personaDe(db, 'sport_result', r))).toEqual(['ca', 'ca']);
  });

  it('dos fechas lejanas con nombres de pila compatibles no se parten (errata de año)', () => {
    const db = crearBase();
    persona(db, 'ma', 'MARIA JOSE PEREZ LOPEZ', { genero: 'F', licencia: 'MPL00001' });
    puestoSkermo(db, 's1', 'MPL00001', 'MARIA JOSE PEREZ LOPEZ', 'ma');
    puestoSkermo(db, 's2', 'MPL00002', 'M JOSE PEREZ LOPEZ', 'ma');
    const fechas = fechasDe({}, { 1: [fila('MPL00001', 'MARIA JOSE', 'PEREZ LOPEZ', '1990-01-01')], 2: [fila('MPL00002', 'M JOSE', 'PEREZ LOPEZ', '2000-01-01')] });
    expect(partirPorFechaNacimiento(db, fechas).personasPartidas).toBe(0);
  });

  it('vincula un puesto Skermo sin persona a la única con ese nombre y sin fecha que choque', () => {
    const db = crearBase();
    db.exec("UPDATE sport_competition SET gender = 'F'");
    persona(db, 'ca', 'CARLOTA ALVAREZ DE TOLEDO PENA', { genero: 'F', licencia: 'CAD01100' });
    persona(db, 'cl', 'ALVAREZ DE TOLEDO PENA Clara', { genero: 'F' });
    puestoSkermo(db, 's1', 'CAD01100', 'CARLOTA ALVAREZ DE TOLEDO PENA', 'ca');
    puesto(db, 'p1', 'ALVAREZ DE TOLEDO PENA Clara', 'cl');
    const sinPersona = puestoSkermo(db, 's2', 'CAD01100', 'CLARA ALVAREZ DE TOLEDO PENA', null);
    const fechas = fechasDe({}, {
      1: [fila('CAD01100', 'CARLOTA', 'ALVAREZ DE TOLEDO PENA', '2002-04-30')],
      2: [fila('CAD01100', 'CLARA', 'ALVAREZ DE TOLEDO PENA', '1998-02-12'), fila('CAD01100', 'CARLOTA', 'ALVAREZ DE TOLEDO PENA', '2002-04-30')],
    });
    expect(partirPorFechaNacimiento(db, fechas).sinPersonaVinculados).toBe(1);
    expect(personaDe(db, 'sport_result', sinPersona)).toBe('cl');
  });
});

describe('fundir por fecha de nacimiento exacta', () => {
  const caso = () => {
    const db = crearBase();
    persona(db, 'fc', 'CODON MIRAVALLE Roberto', { fie: '427' });
    persona(db, 'nc', 'ROBERTO CODON MIRAVALLES', { licencia: 'RCM00001' });
    puesto(db, 'f1', 'CODON MIRAVALLE Roberto', 'fc', 'fie');
    puestoSkermo(db, 's1', 'RCM00001', 'ROBERTO CODON MIRAVALLES', 'nc');
    // Asaltos en otras pruebas no son coincidir.
    asalto(db, 'p1', 'CODON MIRAVALLES Roberto', 'nc', 'OTRO Rival', null);
    asalto(db, 'f2', 'CODON MIRAVALLE Roberto', 'fc', 'OTRO Rival', null);
    const fechas = fechasDe({ 427: '1965-03-02' }, { 1: [fila('RCM00001', 'ROBERTO', 'CODON MIRAVALLES', '1965-03-02')] });
    return { db, fechas };
  };

  it('funde la persona nacional en la FIE con la misma fecha y nombre compatible', () => {
    const { db, fechas } = caso();
    expect(fundirPorFechaNacimiento(db, fechas)).toMatchObject({ candidatas: 1, fusiones: 1 });
    expect(raiz(db, 'nc')).toBe('fc');
    expect(fundirPorFechaNacimiento(db, fechas).fusiones).toBe(0);
  });

  it('no funde si hay otra persona nacional con esa fecha y nombre compatible', () => {
    const { db, fechas } = caso();
    persona(db, 'n2', 'ROBERTO CODON MIRAVALLE', { licencia: 'RCM00002' });
    puestoSkermo(db, 's2', 'RCM00002', 'ROBERTO CODON MIRAVALLE', 'n2');
    fechas.skermo.set('2', [fila('RCM00002', 'ROBERTO', 'CODON MIRAVALLE', '1965-03-02')]);
    expect(fundirPorFechaNacimiento(db, fechas).rechazos).toEqual({ varias_nacionales: 1 });
  });

  it('no funde si coinciden en una prueba, ni con otra fecha o nombre', () => {
    const { db, fechas } = caso();
    puesto(db, 's1', 'CODON MIRAVALLE Roberto', 'fc', 'fie');
    expect(fundirPorFechaNacimiento(db, fechas).rechazos).toEqual({ coinciden: 1 });
    const otro = caso();
    otro.fechas.fie.set('427', '1965-03-03');
    expect(fundirPorFechaNacimiento(otro.db, otro.fechas).candidatas).toBe(0);
  });
});

describe('salvaguarda de fecha en las fusiones por nombre', () => {
  it('la fusión FIE ↔ licencia por nombre no une fechas que chocan', () => {
    const db = crearBase();
    persona(db, 'fe', 'ALONSO Javier', { fie: '26791' });
    persona(db, 'l1', 'JAVIER ALONSO ESCOBAR', { licencia: 'JAE00441' });
    puesto(db, 'f1', 'ALONSO Javier', 'fe', 'fie');
    puestoSkermo(db, 's1', 'JAE00441', 'JAVIER ALONSO ESCOBAR', 'l1');
    const fechas = fechasDe({ 26791: '1992-09-30' }, { 1: [fila('JAE00441', 'JAVIER', 'ALONSO ESCOBAR', '1981-10-04')] });
    const inf = unificarPersonas(db, { fechas });
    expect(inf.fusionFieRfee).toMatchObject({ fusiones: 0, omitidasPorFecha: 1 });
    expect(raiz(db, 'l1')).toBe('l1');
    // Sin fechas, la regla por nombre sí los une.
    const sin = crearBase();
    persona(sin, 'fe', 'ALONSO Javier', { fie: '26791' });
    persona(sin, 'l1', 'JAVIER ALONSO ESCOBAR', { licencia: 'JAE00441' });
    expect(unificarPersonas(sin).fusionFieRfee.fusiones).toBe(1);
  });

  it('la fusión FIE ↔ licencia por nombre exige que el apellido FIE sea el primero', () => {
    const db = crearBase();
    persona(db, 'fe', 'ESCOBAR Javier', { fie: '26791' });
    persona(db, 'l1', 'JAVIER ALONSO ESCOBAR', { licencia: 'JAE00441' });
    expect(unificarPersonas(db).fusionFieRfee).toMatchObject({ fusiones: 0, omitidasPorOrden: 1 });
  });

  it('una persona FIE que ya tiene su ficha nacional no se queda otra que también la contiene', () => {
    const db = crearBase();
    persona(db, 'fc', 'FLOREZ Carlos', { fie: '45875' });
    persona(db, 'l1', 'CARLOS FLOREZ DE VARGAS', { licencia: 'CFV00001', en: 'fc' });
    persona(db, 'l2', 'CARLOS FLOREZ GONZALEZ', { licencia: 'CFG00001' });
    const inf = unificarPersonas(db);
    expect(inf.fusionFieRfee).toMatchObject({ fusiones: 0, omitidasYaVinculada: 1 });
    expect(raiz(db, 'l2')).toBe('l2');
  });

  it('vincular-asaltos no funde dos nombres idénticos con fechas que chocan', () => {
    const db = crearBase();
    persona(db, 'a', 'GARCIA LOPEZ Juan Carlos');
    persona(db, 'b', 'GARCIA LOPEZ Juan Carlos');
    puesto(db, 'p1', 'GARCIA LOPEZ Juan Carlos', 'a');
    puesto(db, 'p2', 'GARCIA LOPEZ Juan Carlos', 'b');
    const choque = vincularAsaltos(db, { nacimientos: new Map([['a', ['1970-01-01']], ['b', ['2005-01-01']]]) });
    expect(choque.informe.fusiones.nombreIdentico).toBe(0);
    expect(choque.propuestas.map((p) => p.tipo)).toContain('fecha_nacimiento_distinta');
    expect(vincularAsaltos(db).informe.fusiones.nombreIdentico).toBe(1);
  });

  it('las fechas por persona salen de la ficha FIE y de los puestos Skermo', () => {
    const db = crearBase();
    persona(db, 'fe', 'ESCOBAR Javier', { fie: '26791' });
    persona(db, 'l1', 'JAVIER ALONSO ESCOBAR', { licencia: 'JAE00441' });
    puestoSkermo(db, 's1', 'JAE00441', 'JAVIER ALONSO ESCOBAR', 'l1');
    const m = nacimientosPorPersona(db, fechasDe({ 26791: '1992-09-30' }, { 1: [fila('JAE00441', 'JAVIER', 'ALONSO ESCOBAR', '1981-10-04')] }));
    expect(Object.fromEntries(m)).toEqual({ fe: ['1992-09-30'], l1: ['1981-10-04'] });
  });
});
