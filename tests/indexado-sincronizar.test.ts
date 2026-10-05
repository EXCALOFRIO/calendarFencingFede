import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import {
  aplicarLocal, compararBases, componerChunk, consultasAgregado, leerCuerpo, literal, planificar, proyeccion,
  type Manifiesto,
} from '../scripts/indexado/sincronizar-d1';

const MIGRACION = (n: string) => readFileSync(new URL(`../drizzle-d1/${n}`, import.meta.url), 'utf8');
const NOMBRE_RARO = "O'Brien; final\n✓ 🤺 \"x\"";
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

function carpeta() {
  const c = mkdtempSync(join(tmpdir(), 'sincronizar-d1-'));
  carpetas.push(c);
  return c;
}

/** Base con el esquema de producción (0000 + 0002 con guardas) y una siembra mínima. */
function crearBase(dir: string, extra = '') {
  const ruta = join(dir, 'base.sqlite');
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRACION('0000_aplicacion.sql'));
  db.exec(`
    INSERT INTO user_profile(id,email,full_name,ical_token) VALUES('u1','u@x','U','tok');
    INSERT INTO athlete(id,first_name,last_name,birth_date,gender) VALUES('a1','Ana','Pérez','2000-01-01','F');
    INSERT INTO sport_edition(id,source,season,tournament_key,name,updated_at) VALUES('e1','fie','2025','k1','Copa',1000);
    INSERT INTO sport_edition(id,source,season,tournament_key,name,updated_at) VALUES('e3','fie','2025','k3','Otra',1000);
    INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,updated_at)
      VALUES('c1','e1','fie','2025','c1','ESPADA','M','ABS',1000);
    INSERT INTO sport_person(id,display_name,name_normalized,athlete_id,created_at,updated_at) VALUES
      ('p1','Uno','uno',NULL,1,1),('p2','Dos','dos','a1',1,1),('p3','Tres','tres',NULL,1,1),
      ('p4','Cuatro','cuatro',NULL,1,1),('p5','Cinco','cinco',NULL,1,1),('p6','Seis','seis',NULL,1,1);
    INSERT INTO sport_person_alias(id,person_id,source,name_original,name_normalized,first_seen_at) VALUES
      ('al1','p1','fie','Uno','uno',1),('al5','p5','fie','Cinco','cinco',1),('al6','p6','fie','Seis','seis',1);
    INSERT INTO sport_external_id(id,person_id,scheme,value,scope_source,created_at,updated_at)
      VALUES('x1','p1','fie_license','L1','fie',1,1);
    INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,content_hash,first_seen_at,revised_at) VALUES
      ('r1','c1','fie','f1',NULL,'Uno',1,'h1',1,1),('r2','c1','fie','f2','p5','Cinco',2,'h2',1,1),
      ('r3','c1','fie','f3',NULL,'Tres',3,'h3',1,1);
    INSERT INTO sport_bout(id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_name,fencer_b_name,score_a,score_b,content_hash,first_seen_at,revised_at) VALUES
      ('b1','c1','fie','POULE','1','a','b','Uno','Dos',5,3,'hb1',1,1),('b2','c1','fie','POULE','1','a','c','Uno','Tres',5,1,'hb2',1,1);
    INSERT INTO sport_import_coverage(id,source,season,fact_kind,competition_id,status,updated_at)
      VALUES('cov1','fie','2025','resultados','c1','pendiente',1);
    INSERT INTO sport_favorite(profile_id,person_id,created_at) VALUES('u1','p4',1);
    ${extra}
  `);
  db.exec(MIGRACION('0002_guardia_deportiva.sql'));
  db.close();
  return ruta;
}

/** nuevo = base sin guardas + altas, cambios de person_id, unificación y borrados. */
function crearNuevo(dir: string, base: string, cambios: string) {
  const ruta = join(dir, 'nuevo.sqlite');
  copyFileSync(base, ruta);
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON');
  quitarGuardia(db);
  db.exec(cambios);
  db.close();
  return ruta;
}

const CAMBIOS = `
  INSERT INTO sport_edition(id,source,season,tournament_key,name,updated_at) VALUES('e2','fie','2026','k2',${literal(NOMBRE_RARO)},2000);
  INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,updated_at)
    VALUES('c2','e2','fie','2026','c2','SABLE','F','M20',2000);
  INSERT INTO sport_person(id,display_name,name_normalized,merged_into_person_id,created_at,updated_at) VALUES('b7','Siete','siete',NULL,2,2);
  INSERT INTO sport_person(id,display_name,name_normalized,merged_into_person_id,created_at,updated_at) VALUES('a8','Ocho','ocho','b7',2,2);
  UPDATE sport_person SET athlete_id=NULL, updated_at=2 WHERE id='p2';
  UPDATE sport_person SET athlete_id='a1', updated_at=2 WHERE id='p1';
  UPDATE sport_person SET merged_into_person_id='p3', updated_at=2 WHERE id='p4';
  INSERT INTO sport_person_alias(id,person_id,source,name_original,name_normalized,first_seen_at) VALUES('al7','b7','fie','Siete','siete',2);
  UPDATE sport_person_alias SET person_id='p3' WHERE id='al5';
  UPDATE sport_result SET person_id='p1', revised_at=2 WHERE id='r1';
  UPDATE sport_result SET person_id='p3', revised_at=2 WHERE id='r2';
  DELETE FROM sport_result WHERE id='r3';
  INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,content_hash,first_seen_at,revised_at)
    VALUES('r3b','c1','fie','f3','p3','Tres',3,'h3b',2,2);
  INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,content_hash,first_seen_at,revised_at)
    VALUES('r4','c2','fie','g1','b7',${literal(NOMBRE_RARO)},1,'h4',2,2),('r5','c2','fie','g2',NULL,'Nadie',2,'h5',2,2);
  DELETE FROM sport_bout WHERE id='b2';
  UPDATE sport_bout SET fencer_a_person_id='p1', revised_at=2 WHERE id='b1';
  UPDATE sport_import_coverage SET status='completo', imported_total=3, updated_at=2 WHERE id='cov1';
  DELETE FROM sport_person_alias WHERE id='al6';
  DELETE FROM sport_person WHERE id IN ('p5','p6');
  DELETE FROM sport_edition WHERE id='e3';
`;

function escenario(opciones: { chunkBytes?: number; extra?: string; cambios?: string } = {}) {
  const dir = carpeta();
  const base = crearBase(dir, opciones.extra);
  const nuevo = crearNuevo(dir, base, opciones.cambios ?? CAMBIOS);
  const salida = join(dir, 'salida');
  return { dir, base, nuevo, salida, plan: () => planificar({ base, nuevo, salida, chunkBytes: opciones.chunkBytes, log: () => {} }) };
}

function copiaDeBase(dir: string, base: string) {
  const ruta = join(dir, 'copia.sqlite');
  copyFileSync(base, ruta);
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON');
  return { ruta, db };
}

describe('sincronizar-d1: diff, SQL y aplicación con guardas', () => {
  it('aplicar los chunks a una copia de base (con triggers 0002) produce exactamente nuevo', () => {
    const e = escenario({ chunkBytes: 1500 });
    const m = e.plan();
    expect(m.chunks.length).toBeGreaterThan(3);
    expect(m.tablas.sport_person).toMatchObject({ insertar: 2, actualizar: 3, borrar: 2, borrarAlFinal: 1 });
    expect(m.tablas.sport_person.ordenadas).toBeGreaterThan(0);
    expect(m.tablas.sport_result).toMatchObject({ insertar: 3, actualizar: 2, borrar: 1 });
    expect(m.tablas.sport_bout).toMatchObject({ insertar: 0, actualizar: 1, borrar: 1 });
    expect(m.esperado.sport_result.n).toBe(5);
    expect(m.cargoTotalBytes).toBeGreaterThan(0);
    for (const c of m.chunks) expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);

    const { ruta, db } = copiaDeBase(e.dir, e.base);
    const r = aplicarLocal(db, e.salida, m);
    expect(r.contabilizadoBytes).toBeGreaterThan(m.cargoTotalBytes);
    expect(db.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM sport_write_charge').get()!.n).toBe(0);
    const lease = db.prepare(`SELECT lease_version, expires_at FROM sport_write_lease`).get()!;
    expect(lease.lease_version).toBe(m.chunks.length);
    expect(Number(lease.expires_at)).toBeLessThanOrEqual(Date.now());
    expect(db.prepare(`SELECT count(*) AS n FROM sport_favorite`).get()!.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
    for (const d of compararBases(ruta, e.nuevo)) {
      expect(d, d.tabla).toEqual({ tabla: d.tabla, soloA: 0, soloB: 0, agregadosIguales: true });
    }
  });

  it('el cargo estimado cubre exactamente lo que cobran los triggers en cada chunk', () => {
    const e = escenario({
      chunkBytes: 1500,
      // p5 fusionada en p6: al borrar p6 (fase 1), SET NULL actualiza p5 y cobra otra fila.
      extra: `UPDATE sport_person SET merged_into_person_id='p6' WHERE id='p5';`,
      cambios: `${CAMBIOS}
        UPDATE sport_bout SET fencer_a_person_id='p2', fencer_b_person_id='p3', revised_at=3 WHERE id='b1';
        UPDATE sport_import_coverage SET published_total=12, last_error=${literal(NOMBRE_RARO)} WHERE id='cov1';`,
    });
    const m = e.plan();
    const { db } = copiaDeBase(e.dir, e.base);
    const r = aplicarLocal(db, e.salida, m);
    db.close();
    expect(r.porChunk).toHaveLength(m.chunks.length);
    for (const c of r.porChunk) {
      expect(c.realBytes, c.archivo).toBeGreaterThan(0);
      expect(c.estimadoBytes, c.archivo).toBeGreaterThanOrEqual(c.realBytes);
      expect(c.estimadoBytes, c.archivo).toBeLessThanOrEqual(c.realBytes * 1.05);
      expect(c.proyectadoBytes - 16_384, c.archivo).toBeGreaterThanOrEqual(c.realBytes);
    }
    const real = r.porChunk.reduce((s, c) => s + c.realBytes, 0);
    // El ledger final suma el tamaño de la base al reclamar el primer contexto: no es cargo de filas.
    expect(r.contabilizadoBytes).toBe(r.medidoInicialBytes + real + 16_384 * m.chunks.length);
  });

  it('un contexto con proyección menor que el cargo real aborta el chunk sin escribir', () => {
    const e = escenario();
    const m = e.plan();
    const { db } = copiaDeBase(e.dir, e.base);
    const sql = componerChunk(leerCuerpo(e.salida, m.chunks[0]), {
      owner: '00000000-0000-4000-8000-000000000001', medidoBytes: 1, proyectadoBytes: 16_384 + 4096,
    });
    db.exec('BEGIN');
    expect(() => db.exec(sql)).toThrow(/sport_capacity_reservation_exhausted/);
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT accounted_bytes AS a FROM sport_capacity_ledger').get()!.a).toBe(0);
    db.close();
  });

  it('cada chunk es atómico: con el lease en manos de otro no se escribe nada', () => {
    const e = escenario();
    const m = e.plan();
    const { db } = copiaDeBase(e.dir, e.base);
    db.exec(`INSERT INTO sport_write_lease(key,owner,expires_at,lease_version) VALUES('global','otro',${Date.now() + 600_000},1)`);
    const antes = db.prepare('SELECT count(*) AS n FROM sport_result').get()!.n;
    expect(() => aplicarLocal(db, e.salida, m)).toThrow(/sport_write_lease_required|malformed JSON/);
    expect(db.prepare('SELECT count(*) AS n FROM sport_result').get()!.n).toBe(antes);
    expect(db.prepare('SELECT owner FROM sport_write_lease').get()!.owner).toBe('otro');
    expect(db.prepare('SELECT accounted_bytes AS a FROM sport_capacity_ledger').get()!.a).toBe(0);
    db.close();
  });

  it('sin la cabecera de lease las guardas rechazan el cuerpo', () => {
    const e = escenario();
    const m = e.plan();
    const { db } = copiaDeBase(e.dir, e.base);
    expect(() => db.exec(leerCuerpo(e.salida, m.chunks[0]))).toThrow(/sport_write_lease_required/);
    db.close();
  });

  it('un cambio concurrente en remoto aborta el chunk en vez de sobrescribirlo', () => {
    const e = escenario();
    const m = e.plan();
    const { db } = copiaDeBase(e.dir, e.base);
    // Simula que producción cambió r1 tras la copia (con su propio contexto autorizado).
    db.exec(componerChunk(`UPDATE sport_result SET person_id='p4' WHERE id='r1';\n`, {
      owner: '00000000-0000-4000-8000-000000000000', medidoBytes: 1, proyectadoBytes: proyeccion(10_000),
    }));
    expect(() => aplicarLocal(db, e.salida, m)).toThrow(/malformed JSON/);
    expect(db.prepare(`SELECT person_id FROM sport_result WHERE id='r1'`).get()!.person_id).toBe('p4');
    expect(db.prepare(`SELECT count(*) AS n FROM sport_result WHERE id='r4'`).get()!.n).toBe(0);
    db.close();
  });

  it('no borra personas referenciadas por favoritos o rankings', () => {
    const e = escenario({ cambios: `DELETE FROM sport_person WHERE id='p4'` });
    expect(() => e.plan()).toThrow(/borrado_referenciado_fuera_de_alcance:sport_favorite/);

    const f = escenario({ cambios: `DELETE FROM sport_person_alias WHERE id='al6'; DELETE FROM sport_person WHERE id='p6'` });
    const m = f.plan();
    const { db } = copiaDeBase(f.dir, f.base);
    db.exec(`INSERT INTO sport_favorite(profile_id,person_id,created_at) VALUES('u1','p6',5)`);
    expect(() => aplicarLocal(db, f.salida, m)).toThrow(/malformed JSON/);
    expect(db.prepare(`SELECT count(*) AS n FROM sport_person WHERE id='p6'`).get()!.n).toBe(1);
    db.close();
  });

  it('detecta ciclos de claves únicas y referencias a tablas fuera de alcance', () => {
    const ciclo = escenario({
      cambios: `UPDATE sport_edition SET tournament_key='tmp' WHERE id='e1';
        UPDATE sport_edition SET tournament_key='k1' WHERE id='e3';
        UPDATE sport_edition SET tournament_key='k3' WHERE id='e1';`,
    });
    expect(() => ciclo.plan()).toThrow(/ciclo_de_dependencias:sport_edition/);
    const fuera = escenario({
      cambios: `PRAGMA foreign_keys=OFF; UPDATE sport_edition SET event_id='no-existe' WHERE id='e1';`,
    });
    expect(() => fuera.plan()).toThrow(/referencia_fuera_de_alcance:sport_edition.event_id/);
  });

  it('el manifiesto lleva sha256 y un cuerpo alterado se rechaza', () => {
    const e = escenario({ chunkBytes: 1500 });
    const m: Manifiesto = e.plan();
    expect(readdirSync(e.salida).filter((f) => f.endsWith('.sql'))).toHaveLength(m.chunks.length);
    writeFileSync(join(e.salida, m.chunks[0].archivo), 'SELECT 1;\n');
    expect(() => leerCuerpo(e.salida, m.chunks[0])).toThrow(/sha256_distinto/);
  });
});

describe('sincronizar-d1: literales y checksum', () => {
  it('codifica literales exactos que SQLite relee sin cambios de tipo', () => {
    const db = new DatabaseSync(':memory:');
    // node:sqlite corta los textos leídos en el primer NUL; se comprueba en SQL.
    expect(db.prepare(`SELECT hex(${literal('a\0b')}) AS h`).get()!.h).toBe('610062');
    const valores: unknown[] = [null, 0n, -42n, 9007199254740993n, 1.5, 2, NOMBRE_RARO, '', new Uint8Array([0, 255])];
    for (const v of valores) {
      const st = db.prepare(`SELECT ${literal(v)} AS v, typeof(${literal(v)}) AS t`);
      st.setReadBigInts(true);
      const r = st.get()!;
      if (v instanceof Uint8Array) expect(Buffer.from(r.v as Uint8Array)).toEqual(Buffer.from(v));
      else if (typeof v === 'number') expect([r.v, r.t]).toEqual([v, 'real']);
      else expect(r.v).toEqual(v);
    }
    expect(literal(NOMBRE_RARO)).not.toMatch(/[;\n]/);
    expect(() => literal('\ud800')).toThrow();
    db.close();
  });

  it('el agregado no depende del orden y detecta un cambio de person_id', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE t(id TEXT PRIMARY KEY, person_id TEXT, n INTEGER, updated_at INTEGER)`);
    const [sql] = consultasAgregado('t', ['id', 'person_id', 'n', 'updated_at'], 'updated_at');
    const ids = ['0aa', '5bb', 'fcc', 'zz'];
    for (const id of ids) db.exec(`INSERT INTO t VALUES('${id}','11111111-1111-4111-8111-${id.padStart(12, '0')}',3,7)`);
    const a = db.prepare(sql).get();
    const parts = consultasAgregado('t', ['id', 'person_id', 'n', 'updated_at'], 'updated_at', true).map((s) => db.prepare(s).get()!);
    expect(parts.reduce((s, p) => s + Number(p.n), 0)).toBe(4);
    expect(parts.reduce((s, p) => s + Number(p.s), 0)).toBe(Number(a!.s));
    db.exec(`DELETE FROM t`);
    for (const id of [...ids].reverse()) db.exec(`INSERT INTO t VALUES('${id}','11111111-1111-4111-8111-${id.padStart(12, '0')}',3,7)`);
    expect(db.prepare(sql).get()).toEqual(a);
    db.exec(`UPDATE t SET person_id='22222222-1111-4111-8111-000000000abc' WHERE id='5bb'`);
    expect(db.prepare(sql).get()!.s).not.toEqual(a!.s);
    db.close();
  });
});
