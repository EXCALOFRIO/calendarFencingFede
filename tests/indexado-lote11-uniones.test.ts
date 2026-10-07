import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { decidirFila, lote11 } from '../scripts/indexado/lote11-uniones-evidencia';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

let n = 0;
function prueba(db: DatabaseSync, id: string, source: string, o: { genero?: string; cat?: string; temporada?: string } = {}) {
  const t = o.temporada ?? '2023-2024';
  db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES (?,?,?,?,?)`).run(`e${id}`, source, t, `t:${id}`, `Torneo ${id}`);
  db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format)
    VALUES (?,?,?,?,?,'SABLE',?,?,'INDIVIDUAL')`).run(id, `e${id}`, source, t, `k:${id}`, o.genero ?? 'F', o.cat ?? 'M15');
}
function persona(db: DatabaseSync, id: string, nombre: string, o: { genero?: string; anio?: number | null; fuente?: string; licencia?: string; fie?: string } = {}) {
  db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, birth_year) VALUES (?,?,?,?,?)`)
    .run(id, nombre, normalizarNombre(nombre), o.genero ?? 'F', o.anio === undefined ? null : o.anio);
  db.prepare(`INSERT INTO sport_person_alias (person_id, source, name_original, name_normalized) VALUES (?,?,?,?)`)
    .run(id, o.fuente ?? 'skermo_rfee', nombre, normalizarNombre(nombre));
  if (o.licencia) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'rfee_license', ?, 'skermo_rfee', 'CONFIRMADO')`).run(id, o.licencia);
  }
  if (o.fie) {
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES (?, 'fie_addr_id', ?, 'fie', 'CONFIRMADO')`).run(id, o.fie);
  }
}
function puesto(db: DatabaseSync, comp: string, source: string, nombre: string, o: { persona?: string | null; club?: string | null; clave?: string } = {}) {
  const id = `r${(n += 1)}`;
  db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, source_country_code, source_club, position, content_hash)
    VALUES (?,?,?,?,?,?, 'ESP', ?, ?, 'h')`).run(id, comp, source, o.clave ?? `${source}:${id}`, o.persona ?? null, nombre, o.club ?? null, n);
  return id;
}
function asalto(db: DatabaseSync, comp: string, a: string, b: string, o: { ap?: string | null; bp?: string | null } = {}) {
  const id = `b${(n += 1)}`;
  db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_person_id, fencer_b_person_id,
      fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?,?, 'engarde', 'POULE', 'P1', ?, ?, ?, ?, ?, ?, 5, 3, 'h')`)
    .run(id, comp, `engarde:${a}`, `engarde:${b}`, o.ap ?? null, o.bp ?? null, a, b);
  return id;
}
function propuesta(db: DatabaseSync, source: string, ref: string, nombre: string, personaId: string) {
  const id = `c${(n += 1)}`;
  db.prepare(`INSERT INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence)
    VALUES (?,?,?,?,?, 'PROPUESTO', 'nombre_varias_candidatas')`).run(id, source, ref, nombre, personaId);
  return id;
}
const refNombre = (nombre: string, genero = 'F') => `nombre:${normalizarNombre(nombre)}|${genero}`;
const personaDe = (db: DatabaseSync, id: string) => (db.prepare(`SELECT person_id p FROM sport_result WHERE id = ?`).get(id) as { p: string | null }).p;
const estado = (db: DatabaseSync, id: string) => (db.prepare(`SELECT status s FROM sport_link_candidate WHERE id = ?`).get(id) as { s: string }).s;
const raiz = (db: DatabaseSync, id: string) => (db.prepare(`SELECT coalesce(merged_into_person_id, id) r FROM sport_person WHERE id = ?`).get(id) as { r: string }).r;

describe('lote11: propuestas de unión con evidencia', () => {
  it('club y año de nacimiento: vincula el puesto con la única candidata de su club; las demás, rechazadas', () => {
    const db = crearBase();
    prueba(db, 'k1', 'skermo_rfee');
    prueba(db, 'k2', 'skermo_rfee');
    prueba(db, 'eg', 'engarde');
    persona(db, 'p1', 'GARCIA LOPEZ Ana', { anio: 2010 });
    persona(db, 'p2', 'GARCIA LOPEZ Ana', { anio: 2009 });
    puesto(db, 'k1', 'skermo_rfee', 'GARCIA LOPEZ Ana', { persona: 'p1', club: 'ATENEO-M' });
    puesto(db, 'k2', 'skermo_rfee', 'GARCIA LOPEZ Ana', { persona: 'p2', club: 'SAMA-M' });
    const r = puesto(db, 'eg', 'engarde', 'GARCIA LOPEZ Ana', { club: 'ATENEO-M (ESP)' });
    const c1 = propuesta(db, 'engarde', refNombre('GARCIA LOPEZ Ana'), 'GARCIA LOPEZ Ana', 'p1');
    const c2 = propuesta(db, 'engarde', refNombre('GARCIA LOPEZ Ana'), 'GARCIA LOPEZ Ana', 'p2');

    const ensayo = lote11(db);
    expect(ensayo.decisivas.map((d) => [d.tipo, d.destino.id])).toEqual([['club_y_anio', 'p1']]);
    expect(ensayo.decisivas[0].origen.nombre).toBe('GARCIA LOPEZ Ana');
    expect(personaDe(db, r)).toBeNull();
    expect(estado(db, c1)).toBe('PROPUESTO');

    const inf = lote11(db, { aplicar: true });
    expect(inf.aplicado).toMatchObject({ puestos: 1, candidatosConfirmados: 1, candidatosRechazados: 1 });
    expect(personaDe(db, r)).toBe('p1');
    expect(estado(db, c1)).toBe('CONFIRMADO');
    expect(estado(db, c2)).toBe('RECHAZADO');
  });

  it('el mismo club sin año de nacimiento conocido no basta: queda como dudosa', () => {
    const db = crearBase();
    prueba(db, 'k1', 'skermo_rfee');
    prueba(db, 'eg', 'engarde');
    persona(db, 'p1', 'GARCIA LOPEZ Ana', { anio: null });
    persona(db, 'p2', 'ANA GARCIA LOPEZ', { anio: null });
    puesto(db, 'k1', 'skermo_rfee', 'GARCIA LOPEZ Ana', { persona: 'p1', club: 'ATENEO-M' });
    const r = puesto(db, 'eg', 'engarde', 'GARCIA LOPEZ Ana', { club: 'ATENEO-M' });
    propuesta(db, 'engarde', refNombre('GARCIA LOPEZ Ana'), 'GARCIA LOPEZ Ana', 'p1');
    propuesta(db, 'engarde', refNombre('GARCIA LOPEZ Ana'), 'GARCIA LOPEZ Ana', 'p2');
    const inf = lote11(db, { aplicar: true });
    expect(inf.decisivas).toEqual([]);
    expect(inf.dudosas.map((d) => d.motivo)).toContain('solo_club_sin_anio');
    expect(personaDe(db, r)).toBeNull();
  });

  it('apellidos cruzados: nunca sólo por el nombre; sí con club y año', () => {
    const db = crearBase();
    prueba(db, 'k1', 'skermo_rfee');
    prueba(db, 'eg1', 'engarde');
    prueba(db, 'eg2', 'engarde');
    persona(db, 'p1', 'GONZALEZ PEREZ Eva', { anio: 2010, fuente: 'efc' });
    persona(db, 'p2', 'PEREZ GONZALEZ Eva', { anio: 2003, fuente: 'efc' });
    puesto(db, 'k1', 'skermo_rfee', 'GONZALEZ PEREZ Eva', { persona: 'p1', club: 'CEB-M' });
    const sinPrueba = puesto(db, 'eg1', 'engarde', 'PEREZ GONZALEZ Eva');
    const conClub = puesto(db, 'eg2', 'engarde', 'PEREZ GONZALEZ Eva', { club: 'CEB-M' });
    propuesta(db, 'engarde', refNombre('PEREZ GONZALEZ Eva'), 'PEREZ GONZALEZ Eva', 'p1');
    const inf = lote11(db, { aplicar: true });
    // p2 (mismo orden) queda fuera por la edad (M15 en 2024); p1 sólo con club y año.
    expect(personaDe(db, sinPrueba)).toBeNull();
    expect(personaDe(db, conClub)).toBe('p1');
    expect(inf.decisivas.map((d) => d.tipo)).toEqual(['club_y_anio']);
  });

  it('fichas duplicadas (mismo nombre, año y club, nunca juntas) se funden y el puesto pendiente va a la persona fundida', () => {
    const db = crearBase();
    prueba(db, 'k1', 'skermo_rfee', { temporada: '2024-2025', cat: 'M20' });
    prueba(db, 'k2', 'skermo_rfee', { temporada: '2025-2026', cat: 'M20' });
    prueba(db, 'eg', 'engarde', { temporada: '2024-2025', cat: 'M23' });
    persona(db, 'u1', 'REESE UHRICH', { anio: 2008, licencia: 'RUH10504' });
    persona(db, 'u2', 'REESE UHRICH', { anio: 2008, licencia: 'RUH12635' });
    puesto(db, 'k1', 'skermo_rfee', 'REESE UHRICH', { persona: 'u1', club: 'ATENEO-M' });
    puesto(db, 'k1', 'skermo_rfee', 'OTRA PERSONA', { persona: null, club: 'ATENEO-M' });
    puesto(db, 'k2', 'skermo_rfee', 'REESE UHRICH', { persona: 'u2', club: 'ATENEO-M' });
    const r = puesto(db, 'eg', 'engarde', 'UHRICH Reese');
    propuesta(db, 'rfee_pdf', refNombre('UHRICH Reese'), 'UHRICH Reese', 'u1');
    propuesta(db, 'rfee_pdf', refNombre('UHRICH Reese'), 'UHRICH Reese', 'u2');
    const inf = lote11(db, { aplicar: true });
    expect(inf.porTipo).toEqual({ 'duplicada_club_anio:fundir': 1, 'nombre_unico:vincular_puesto': 1 });
    expect(raiz(db, 'u1')).toBe(raiz(db, 'u2'));
    expect(raiz(db, personaDe(db, r)!)).toBe(raiz(db, 'u1'));
    expect(inf.aplicado?.fusiones).toBe(1);
  });

  it('continuidad: el lado de asalto va a la candidata que tiene el puesto de esa prueba', () => {
    const db = crearBase();
    prueba(db, 'eg', 'engarde', { genero: 'M', cat: 'ABS' });
    prueba(db, 'eg2', 'engarde', { genero: 'M', cat: 'ABS' });
    persona(db, 'p1', 'RUIZ DIAZ Pedro', { genero: 'M', anio: 1990, fuente: 'engarde' });
    persona(db, 'p2', 'RUIZ DIAZ Pedro', { genero: 'M', anio: 1995, fuente: 'engarde' });
    puesto(db, 'eg', 'engarde', 'RUIZ DIAZ Pedro', { persona: 'p1' });
    persona(db, 'x', 'SOLER Juan', { genero: 'M', fuente: 'engarde' });
    const b1 = asalto(db, 'eg', 'RUIZ DIAZ Pedro', 'SOLER Juan', { bp: 'x' });
    const b2 = asalto(db, 'eg2', 'RUIZ DIAZ Pedro', 'SOLER Juan', { bp: 'x' });
    propuesta(db, 'engarde', refNombre('RUIZ DIAZ Pedro', 'M'), 'RUIZ DIAZ Pedro', 'p1');
    propuesta(db, 'engarde', refNombre('RUIZ DIAZ Pedro', 'M'), 'RUIZ DIAZ Pedro', 'p2');
    const inf = lote11(db, { aplicar: true });
    const lado = (id: string) => (db.prepare(`SELECT fencer_a_person_id p FROM sport_bout WHERE id = ?`).get(id) as { p: string | null }).p;
    expect(lado(b1)).toBe('p1');
    // En otra prueba sin puesto, el nombre solo no decide.
    expect(lado(b2)).toBeNull();
    expect(inf.dudosas.map((d) => d.motivo)).toContain('asalto_sin_continuidad_varias');
  });

  it('FIE↔RFEE con años de nacimiento distintos: descartada, sin fusión', () => {
    const db = crearBase();
    persona(db, 'r', 'LOPEZ GOMEZ Jose Miguel', { genero: 'M', anio: 1999, licencia: 'JLG1' });
    persona(db, 'f', 'GOMEZ Miguel', { genero: 'M', anio: 1967, fuente: 'fie', fie: '123' });
    propuesta(db, 'fusion_fie_rfee', 'r', 'LOPEZ GOMEZ Jose Miguel', 'f');
    const inf = lote11(db, { aplicar: true });
    expect(inf.descartadas.map((d) => [d.motivo, d.evidencia])).toEqual([['fie:anio', 'anio_1999_1967']]);
    expect(raiz(db, 'r')).toBe('r');
  });

  it('una sola licencia de Engarde en los dos lados decide aunque haya otra candidata', () => {
    const e = (r: string, o: Partial<Parameters<typeof decidirFila>[0][number]> = {}) => ({
      r, contra: null, relacion: 'mismo' as const, identidad: false, continuidad: false, club: false, clubYAnio: false, otroClub: false, ...o,
    });
    expect(decidirFila([e('a', { identidad: true }), e('b')])).toMatchObject({ r: 'a', tipo: 'identidad' });
    expect(decidirFila([e('a'), e('b')])).toMatchObject({ r: null, motivo: 'varias_sin_apoyo' });
    expect(decidirFila([e('a', { clubYAnio: true, club: true }), e('b')])).toMatchObject({ r: null, motivo: 'club_y_anio_con_otra_posible' });
    expect(decidirFila([e('a', { clubYAnio: true, club: true }), e('b', { otroClub: true })])).toMatchObject({ r: 'a', tipo: 'club_y_anio' });
  });
});
