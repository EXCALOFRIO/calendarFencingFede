import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import { aplicarCorrecciones, buscarCorrecciones, errata } from '../scripts/indexado/corregir-fechas-pdf';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  quitarGuardia(db);
  return db;
}

const H1 = 'a'.repeat(32);
const H2 = 'b'.repeat(32);
const H3 = 'c'.repeat(32);
const url = (h: string) => `https://app.skermo.org/client/1/${h}.pdf`;

describe('corregir-fechas-pdf', () => {
  it('sólo reconoce erratas claras', () => {
    expect(errata('2018-01-13', '2019-01-13')).toBe('anio_desplazado');
    expect(errata('2018-01-13', '2019-01-12')).toBe('anio_desplazado');
    expect(errata('2021-05-06', '2021-06-05')).toBe('dia_mes_intercambiados');
    expect(errata('2109-10-09', '2019-11-09')).toBe('anio_permutado');
    expect(errata('2021-10-02', '2022-03-26')).toBeNull();
    expect(errata('2024-01-21', '2024-05-11')).toBeNull();
    expect(errata('2019-06-16', '2019-06-15')).toBeNull();
  });

  it('corrige la prueba, sus puestos, sus asaltos y la edición sólo con una fila de catálogo única', () => {
    const db = crearBase();
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date, end_date) VALUES
      ('e1', 'rfee_pdf', '2018-2019', 'pdf:1', 'TNR', '2018-01-13', '2018-01-13'),
      ('e2', 'rfee_pdf', '2018-2019', 'pdf:2', 'Liga', '2018-10-02', '2018-10-02'),
      ('e3', 'rfee_pdf', '2018-2019', 'pdf:3', 'Dos filas', '2018-02-02', '2018-02-02');
    INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, competition_date) VALUES
      ('c1', 'e1', 'rfee_pdf', '2018-2019', 'pdf:${H1}:x:FLORETE:F', 'FLORETE', 'F', 'M20', '2018-01-13'),
      ('c2', 'e2', 'rfee_pdf', '2018-2019', 'pdf:${H2}:x:FLORETE:F', 'FLORETE', 'F', 'ABS', '2018-10-02'),
      ('c3', 'e3', 'rfee_pdf', '2018-2019', 'pdf:${H3}:x:FLORETE:F', 'FLORETE', 'F', 'ABS', '2018-02-02');
    INSERT INTO sport_result (id, competition_id, source, source_fact_key, source_name, occurred_on, content_hash) VALUES
      ('r1', 'c1', 'rfee_pdf', 'pdf:1', 'A', '2018-01-13', 'h');
    INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name,
      score_a, score_b, occurred_on, content_hash) VALUES ('b1', 'c1', 'rfee_pdf', 'POULE', 'P1', 'a', 'b', 'A', 'B', 5, 3, '2018-01-13', 'h');`);
    const fila = (fecha: string, h: string) => ({ temporada: '2018-2019', fecha, arma: 'FLORETE', genero: 'F', formato: 'INDIVIDUAL', enlaces: [{ url: url(h) }] });
    const catalogo = [fila('2019-01-13', H1), fila('2019-03-26', H2), fila('2019-02-02', H3), fila('2019-02-03', H3)];

    const correcciones = buscarCorrecciones(db, catalogo);
    expect(correcciones.map((c) => [c.competicion, c.despues, c.motivo])).toEqual([['c1', '2019-01-13', 'anio_desplazado']]);
    expect(aplicarCorrecciones(db, correcciones)).toEqual({ puestos: 1, asaltos: 1, ediciones: 1 });
    const v = (sql: string) => Object.values(db.prepare(sql).get() as Record<string, unknown>);
    expect(v(`SELECT competition_date FROM sport_competition WHERE id='c1'`)).toEqual(['2019-01-13']);
    expect(v(`SELECT occurred_on FROM sport_result WHERE id='r1'`)).toEqual(['2019-01-13']);
    expect(v(`SELECT occurred_on FROM sport_bout WHERE id='b1'`)).toEqual(['2019-01-13']);
    expect(v(`SELECT start_date, end_date FROM sport_edition WHERE id='e1'`)).toEqual(['2019-01-13', '2019-01-13']);
    expect(buscarCorrecciones(db, catalogo)).toEqual([]);
  });
});
