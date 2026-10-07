import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { normalizarNombre, quitarGuardia } from '../scripts/indexado/comun';
import { BASES_PROTEGIDAS_13, comprobarDestino } from '../scripts/indexado/lote13-comun';
import { esLicenciaComodin, vincularAsaltos } from '../scripts/indexado/vincular-asaltos';

describe('lote 13: licencia comodín de Engarde', () => {
  it('reconoce N-000000 y sólo eso', () => {
    expect(esLicenciaComodin('lic:N-000000')).toBe(true);
    expect(esLicenciaComodin('N-000000')).toBe(true);
    expect(esLicenciaComodin('lic:NA-000000')).toBe(true);
    expect(esLicenciaComodin('lic:N-000018')).toBe(false);
    expect(esLicenciaComodin('lic:NA-000058')).toBe(false);
    expect(esLicenciaComodin('lic:N-100000')).toBe(false);
  });

  it('pasoLicencias no da a ROMERO GOMEZ Juan Pedro los puestos ni los asaltos de otro sin licencia', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
      db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
    }
    quitarGuardia(db);
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('e1','engarde','2010-2011','eg:1','Torneo'), ('e2','engarde','2010-2011','eg:2','Otro');
      INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category) VALUES
        ('c1','e1','engarde','2010-2011','engarde:627/EMACWMAD_2F_21MAY2011','ESPADA','M','ABS'),
        ('c2','e2','engarde','2010-2011','engarde:x/y','ESPADA','M','ABS');`);
    const nombre = 'ROMERO GOMEZ Juan Pedro';
    db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code) VALUES ('jp', ?, ?, 'M', 'ESP')`).run(nombre, normalizarNombre(nombre));
    db.prepare(`INSERT INTO sport_external_id (person_id, scheme, value, scope_source, link_status) VALUES ('jp','fie_addr_id','30169','fie','CONFIRMADO')`).run();
    const puesto = (id: string, comp: string, n: string, persona: string | null) => db.prepare(
      `INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash) VALUES (?,?,'engarde','lic:N-000000',?,?,1,'h')`,
    ).run(id, comp, persona, n);
    puesto('r1', 'c1', nombre, 'jp');
    puesto('r2', 'c2', 'LOPEZ OTRO Tirador', null);
    db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name, score_a, score_b, content_hash)
      VALUES ('b1','c2','engarde','POULE','P1','engarde:z|ESP','lic:N-000000','ZETA Uno','LOPEZ OTRO Tirador',5,3,'h')`).run();
    const { informe } = vincularAsaltos(db, { cuadro: false });
    expect(informe.licencias.refsComodin).toBe(3);
    expect(informe.licencias).toMatchObject({ refs: 0, refsUnaPersona: 0, ladosVinculados: 0, puestosVinculados: 0 });
    expect(db.prepare(`SELECT person_id p FROM sport_result WHERE id='r2'`).get()).toEqual({ p: null });
    expect(db.prepare(`SELECT fencer_b_person_id p FROM sport_bout WHERE id='b1'`).get()).not.toEqual({ p: 'jp' });
  });
});

describe('lote 13: bases protegidas', () => {
  it('nunca escribe en las copias exactas de producción ni en las de referencia', () => {
    for (const b of ['nuevo11.sqlite', 'nuevo12.sqlite', 'nuevo13.sqlite', 'nuevo14.sqlite', 'base.sqlite', 'remoto.sqlite']) expect(BASES_PROTEGIDAS_13.has(b)).toBe(true);
    expect(() => comprobarDestino('C:\\datos\\NUEVO13.sqlite', true)).toThrow(/protegida/);
    expect(() => comprobarDestino('C:\\datos\\nuevo13.sqlite', false)).not.toThrow();
    expect(() => comprobarDestino('C:\\datos\\lote13-trabajo.sqlite', true)).not.toThrow();
  });
});
