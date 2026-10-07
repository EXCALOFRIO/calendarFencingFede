import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { quitarGuardia, restaurarGuardia } from '../scripts/indexado/comun';
import { refrescarEspejo, type ConsultaRemota, type OpcionesRefresco } from '../scripts/indexado/espejo-refrescar';
import { compararBases } from '../scripts/indexado/sincronizar-d1';

const MIGRACION = (n: string) => readFileSync(new URL(`../drizzle-d1/${n}`, import.meta.url), 'utf8');
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

const SIEMBRA = `
  INSERT INTO user_profile(id,email,full_name,ical_token) VALUES('u1','u@x','U','tok');
  INSERT INTO athlete(id,first_name,last_name,birth_date,gender) VALUES('a1','Ana','Pérez','2000-01-01','F');
  INSERT INTO sport_edition(id,source,season,tournament_key,name,updated_at) VALUES('e1','fie','2025','k1','Copa',1000);
  INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,updated_at)
    VALUES('c1','e1','fie','2025','c1','ESPADA','M','ABS',1000);
  INSERT INTO sport_person(id,display_name,name_normalized,athlete_id,created_at,updated_at) VALUES
    ('p1','Uno','uno',NULL,1,1),('p2','Dos','dos','a1',1,1),('p3','Tres','tres',NULL,1,1),
    ('p4','Cuatro','cuatro',NULL,1,1),('p5','Cinco','cinco',NULL,1,1),('p6','Seis','seis',NULL,1,1);
  INSERT INTO sport_person_alias(id,person_id,source,name_original,name_normalized,first_seen_at) VALUES
    ('al1','p1','fie','Uno','uno',1),('al5','p5','fie','Cinco','cinco',1),('al6','p6','fie','Seis','seis',1);
  INSERT INTO sport_external_id(id,person_id,scheme,value,scope_source,created_at,updated_at)
    VALUES('x1','p1','fie_license','L1','fie',1,1);
  INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,official_points,content_hash,first_seen_at,revised_at) VALUES
    ('r1','c1','fie','f1',NULL,'Uno',1,12.0,'h1',1,1),('r2','c1','fie','f2','p5','Cinco',2,NULL,'h2',1,1),
    ('r3','c1','fie','f3',NULL,'Tres',3,NULL,'h3',1,1);
  INSERT INTO sport_bout(id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_name,fencer_b_name,score_a,score_b,content_hash,first_seen_at,revised_at) VALUES
    ('b1','c1','fie','POULE','1','a','b','Uno','Dos',5,3,'hb1',1,1),('b2','c1','fie','POULE','1','a','c','Uno','Tres',5,1,'hb2',1,1);
  INSERT INTO sport_import_coverage(id,source,season,fact_kind,competition_key,competition_id,status,updated_at)
    VALUES('cov1','fie','2025','ranking','c1','c1','pendiente',1000);
  INSERT INTO sport_favorite(profile_id,person_id,created_at) VALUES('u1','p4',1);
  INSERT INTO perfil_deportista(person_id,club_code,updated_at) VALUES('p1','CLUB-A',1000);
`;

const T = 5000;

/**
 * "Producción" y copia local con el mismo esquema (guardas 0002 incluidas). La copia, como la
 * real, no tiene las tablas de 0017. `cron` se ejecuta sólo en producción, con la guarda
 * retirada como haría el lease del cron.
 */
function escenario(cron: string) {
  const dir = mkdtempSync(join(tmpdir(), 'espejo-refrescar-'));
  carpetas.push(dir);
  const prod = join(dir, 'prod.sqlite');
  const db = new DatabaseSync(prod);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRACION('0000_aplicacion.sql'));
  db.exec(MIGRACION('0007_perfil_deportista.sql'));
  db.exec(SIEMBRA);
  db.exec(MIGRACION('0002_guardia_deportiva.sql'));
  db.exec(MIGRACION('0005_presupuesto_8gib.sql'));
  db.exec(MIGRACION('0013_pruebas_conjuntas.sql'));
  db.close();
  const copia = join(dir, 'copia.sqlite');
  copyFileSync(prod, copia);
  const p = new DatabaseSync(prod);
  p.exec(MIGRACION('0017_resultados_automaticos.sql'));
  p.exec('PRAGMA foreign_keys = ON');
  quitarGuardia(p);
  p.exec(cron);
  restaurarGuardia(p);
  p.close();
  const sqls: string[] = [];
  const consultar: ConsultaRemota = (sql) => {
    expect(sql.length).toBeLessThan(30_000);
    sqls.push(sql);
    // Sólo lectura de verdad: la "producción" se abre en modo lectura en cada llamada.
    const r = new DatabaseSync(prod, { readOnly: true });
    try {
      return sql.split(';\n').map((s) => {
        expect(s.trimStart()).toMatch(/^SELECT /);
        // Como wrangler --json: números JSON, sin distinguir entero de real.
        return { results: JSON.parse(JSON.stringify(r.prepare(s).all())) as Record<string, unknown>[] };
      });
    } finally {
      r.close();
    }
  };
  const refrescar = (o: Partial<OpcionesRefresco> = {}) => refrescarEspejo({ copia, consultar, log: () => {}, ...o });
  return { dir, prod, copia, sqls, refrescar };
}

const huella = (ruta: string) => createHash('sha256').update(readFileSync(ruta)).digest('hex');

function guardas(ruta: string) {
  const db = new DatabaseSync(ruta, { readOnly: true });
  try {
    const n = db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND (name LIKE 'sport_fence_%' OR name LIKE 'sport_charge_%')`).get()!.n;
    const respaldo = db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name='_indexado_guardia'`).get()!.n;
    const fk = db.prepare('PRAGMA foreign_key_check').all().length;
    return { n: Number(n), respaldo: Number(respaldo), fk };
  } finally {
    db.close();
  }
}

function esIdentica(copia: string, prod: string) {
  for (const d of compararBases(copia, prod)) {
    expect(d, d.tabla).toEqual({ tabla: d.tabla, soloA: 0, soloB: 0, agregadosIguales: true });
  }
}

const CRON_NUEVA = `
  INSERT INTO sport_edition(id,source,season,tournament_key,name,updated_at) VALUES('e2','fie','2026','k2','Nueva',${T});
  INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,updated_at)
    VALUES('c2','e2','fie','2026','c2','SABLE','F','M20',${T});
  INSERT INTO sport_person(id,display_name,name_normalized,created_at,updated_at) VALUES('p10','Diez','diez',${T},${T});
  INSERT INTO sport_person_alias(id,person_id,source,name_original,name_normalized,first_seen_at) VALUES('al10','p10','fie','Diez','diez',${T});
  INSERT INTO sport_external_id(id,person_id,scheme,value,scope_source,created_at,updated_at) VALUES('x10','p10','fie_license','L10','fie',${T},${T});
  INSERT INTO sport_link_candidate(id,source,source_ref,source_name,person_id,status,evidence,created_at)
    VALUES('lc10','fie','ref10','Diez','p3','PROPUESTO','{}',${T});
  INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,official_points,content_hash,first_seen_at,revised_at) VALUES
    ('r10','c2','fie','g1','p10','Diez',1,24.5,'h10',${T},${T}),('r11','c2','fie','g2','p1','Uno',2,8.0,'h11',${T},${T});
  INSERT INTO sport_bout(id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_person_id,fencer_b_person_id,fencer_a_name,fencer_b_name,score_a,score_b,content_hash,first_seen_at,revised_at)
    VALUES('b10','c2','fie','TABLEAU','T2','x','y','p10','p1','Diez','Uno',15,9,'hb10',${T},${T});
  INSERT INTO sport_import_coverage(id,source,season,fact_kind,competition_key,competition_id,status,imported_total,updated_at)
    VALUES('cov2','fie','2026','ranking','c2','c2','completo',2,${T});
  INSERT INTO perfil_deportista(person_id,birth_year,club_code,updated_at) VALUES('p10',2008,'CLUB-B',${T});
  UPDATE perfil_deportista SET club_code='CLUB-C', updated_at=${T} WHERE person_id='p1';
  INSERT INTO resultado_auto_evento(tipo,competition_id,person_id,posicion,datos,creado_en) VALUES('prueba_publicada','c2',NULL,NULL,'{}',${T});
`;

describe('espejo-refrescar', { timeout: 60_000 }, () => {
  it('trae una competición nueva del cron con puestos, asaltos, personas y perfiles', () => {
    const e = escenario(CRON_NUEVA);
    const antes = guardas(e.copia);
    const r = e.refrescar({ aplicar: true });
    expect(r.desde).toBe(1000);
    expect(r.competiciones).toEqual(['c2']);
    expect(r.filas.sport_edition).toMatchObject({ insertar: 1, actualizar: 0, borrar: 0 });
    expect(r.filas.sport_competition).toMatchObject({ insertar: 1 });
    expect(r.filas.sport_result).toMatchObject({ insertar: 2, actualizar: 0, borrar: 0 });
    expect(r.filas.sport_bout).toMatchObject({ insertar: 1 });
    expect(r.filas.sport_import_coverage).toMatchObject({ insertar: 1 });
    expect(r.filas.sport_person).toMatchObject({ insertar: 1, actualizar: 0 });
    expect(r.filas.sport_person_alias).toMatchObject({ insertar: 1 });
    expect(r.filas.sport_external_id).toMatchObject({ insertar: 1 });
    expect(r.filas.sport_link_candidate).toMatchObject({ insertar: 1 });
    expect(r.filas.perfil_deportista).toMatchObject({ insertar: 1, actualizar: 1 });
    expect(r.aplicado).toBe(true);
    expect(r.identica).toBe(true);
    esIdentica(e.copia, e.prod);
    expect(guardas(e.copia)).toEqual({ n: antes.n, respaldo: 0, fk: 0 });
    expect(antes.n).toBeGreaterThan(0);
    // Tipo exacto de cada valor igual que en producción (JSON no distingue 8 de 8.0).
    const tipos = (ruta: string) => {
      const db = new DatabaseSync(ruta, { readOnly: true });
      try {
        return db.prepare(`SELECT id, typeof(official_points) AS t, official_points AS o, typeof(position) AS p,
            typeof(first_seen_at) AS f FROM sport_result WHERE id IN ('r10','r11') ORDER BY id`).all();
      } finally {
        db.close();
      }
    };
    expect(tipos(e.copia)).toEqual(tipos(e.prod));
    expect(tipos(e.copia)[1]).toMatchObject({ t: 'text', o: '8.0', p: 'integer', f: 'integer' });
    // Una segunda pasada no encuentra nada que cambiar.
    const otra = e.refrescar({ aplicar: true, desde: T });
    expect(otra.competiciones).toEqual([]);
    expect(otra.aplicado).toBe(false);
    expect(otra.identica).toBe(true);
  });

  it('sin --aplicar abre la copia en sólo lectura e informa de lo pendiente', () => {
    const e = escenario(CRON_NUEVA);
    const h = huella(e.copia);
    const r = e.refrescar();
    expect(r.aplicado).toBe(false);
    expect(r.filas.sport_result).toMatchObject({ insertar: 2 });
    expect(r.identica).toBe(false);
    expect(r.verificacion.diferencias.map((d) => d.tabla)).toContain('sport_result');
    expect(huella(e.copia)).toBe(h);
  });

  it('trae los enlaces de person_id que el cron hace sin tocar marcas de tiempo', () => {
    // Como cargar.ts: update ... set person_id=? where person_id is null, sin revised_at;
    // la prueba sólo queda marcada por el evento resultado_persona.
    const e = escenario(`
      UPDATE sport_result SET person_id='p1' WHERE id='r1' AND person_id IS NULL;
      UPDATE sport_bout SET fencer_a_person_id='p1', fencer_b_person_id='p2' WHERE id='b1';
      INSERT INTO resultado_auto_evento(tipo,competition_id,person_id,posicion,datos,creado_en) VALUES('resultado_persona','c1','p1',1,'{}',${T});
    `);
    const r = e.refrescar({ aplicar: true });
    expect(r.competiciones).toEqual(['c1']);
    expect(r.origenes['resultado_auto_evento.creado_en']).toBe(1);
    expect(r.filas.sport_result).toMatchObject({ insertar: 0, actualizar: 1, borrar: 0, iguales: 2 });
    expect(r.filas.sport_bout).toMatchObject({ insertar: 0, actualizar: 1, borrar: 0, iguales: 1 });
    expect(r.filas.sport_competition).toMatchObject({ insertar: 0, actualizar: 0, iguales: 1 });
    expect(r.identica).toBe(true);
    esIdentica(e.copia, e.prod);
  });

  it('actualiza la cobertura, reemplaza puestos y asaltos de la prueba y trae la cobertura sin prueba', () => {
    const e = escenario(`
      UPDATE sport_import_coverage SET status='completo', imported_total=2, published_total=2, last_checked_at=${T}, updated_at=${T} WHERE id='cov1';
      DELETE FROM sport_result WHERE id='r3';
      DELETE FROM sport_bout WHERE id='b2';
      INSERT INTO sport_import_coverage(id,source,season,fact_kind,competition_key,competition_id,status,imported_total,updated_at)
        VALUES('covdoc','rfee_pdf','2025','pdf','doc:x',NULL,'completo',4,${T});
    `);
    const r = e.refrescar({ aplicar: true });
    expect(r.competiciones).toEqual(['c1']);
    expect(r.filas.sport_import_coverage).toMatchObject({ insertar: 1, actualizar: 1, borrar: 0 });
    expect(r.filas.sport_result).toMatchObject({ borrar: 1, iguales: 2 });
    expect(r.filas.sport_bout).toMatchObject({ borrar: 1, iguales: 1 });
    expect(r.identica).toBe(true);
    esIdentica(e.copia, e.prod);
  });

  it('un asalto que pasa a una prueba no tocada se actualiza en vez de borrarse', () => {
    const e = escenario(`
      INSERT INTO sport_edition(id,source,season,tournament_key,name,updated_at) VALUES('e5','fie','2024','k5','Vieja',10);
      INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,updated_at)
        VALUES('c5','e5','fie','2024','c5','ESPADA','M','ABS',10);
      UPDATE sport_bout SET competition_id='c5' WHERE id='b2';
      INSERT INTO resultado_auto_evento(tipo,competition_id,person_id,posicion,datos,creado_en) VALUES('fases_publicadas','c1',NULL,NULL,'{}',${T});
    `);
    const r = e.refrescar({ aplicar: true });
    // e5/c5 tienen marcas antiguas: llegan como padres del asalto trasladado.
    expect(r.filas.sport_bout).toMatchObject({ insertar: 0, actualizar: 1, borrar: 0 });
    expect(r.filas.sport_competition).toMatchObject({ insertar: 1 });
    expect(r.filas.sport_edition).toMatchObject({ insertar: 1 });
    expect(r.identica).toBe(true);
    esIdentica(e.copia, e.prod);
  });

  it('la verificación detecta una deriva sin marcas y --bisecar la localiza por tramos', () => {
    const e = escenario(`
      UPDATE sport_person SET display_name='Dos Corregido' WHERE id='p2';
      DELETE FROM sport_person_alias WHERE id='al6';
    `);
    const h = huella(e.copia);
    const ensayo = e.refrescar({ umbralParticion: 0, bisecar: true, listaMax: 2 });
    expect(ensayo.competiciones).toEqual([]);
    expect(ensayo.identica).toBe(false);
    expect(ensayo.verificacion.diferencias.map((d) => [d.tabla, d.particion])).toEqual([
      ['sport_person', "id >= 'f'"],
      ['sport_person_alias', "'a' <= id < 'b'"],
    ]);
    expect(ensayo.localizadas).toMatchObject({
      upserts: { sport_person: ['p2'] }, borrar: { sport_person_alias: ['al6'] }, agotado: false,
    });
    expect(huella(e.copia)).toBe(h);

    const r = e.refrescar({ umbralParticion: 0, bisecar: true, listaMax: 2, aplicar: true });
    expect(r.filasBisecado!.sport_person).toMatchObject({ actualizar: 1 });
    expect(r.filasBisecado!.sport_person_alias).toMatchObject({ borrar: 1 });
    expect(r.verificacionFinal!.identica).toBe(true);
    expect(r.identica).toBe(true);
    esIdentica(e.copia, e.prod);
    expect(guardas(e.copia)).toMatchObject({ respaldo: 0, fk: 0 });
  });

  it('la bisección respeta el presupuesto de consultas', () => {
    const e = escenario(`UPDATE sport_person SET display_name='Dos Corregido' WHERE id='p2';`);
    const r = e.refrescar({ umbralParticion: 0, bisecar: true, listaMax: 1, maxConsultasBisecar: 3 });
    expect(r.localizadas!.agotado).toBe(true);
    expect(r.localizadas!.pendientes[0]).toMatch(/^sport_person /);
    expect(r.identica).toBe(false);
  });

  it('si falla la aplicación no cambia nada y la guarda queda repuesta', () => {
    const e = escenario(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,content_hash,first_seen_at,revised_at)
        VALUES('r20','c1','fie','f20','fantasma','Nadie',4,'h20',${T},${T});
    `);
    const antes = guardas(e.copia);
    const foto = join(e.dir, 'antes.sqlite');
    copyFileSync(e.copia, foto);
    expect(() => e.refrescar({ aplicar: true })).toThrow(/foreign_key_check/);
    expect(guardas(e.copia)).toEqual({ n: antes.n, respaldo: 0, fk: 0 });
    esIdentica(e.copia, foto);
  });

  it('sólo lee en remoto y con consultas por debajo del límite', () => {
    const e = escenario(CRON_NUEVA);
    e.refrescar({ aplicar: true, bisecar: true });
    expect(e.sqls.length).toBeGreaterThan(0);
    for (const s of e.sqls) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i);
  });
});
