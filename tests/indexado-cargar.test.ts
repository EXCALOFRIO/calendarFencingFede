import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  cargarHechos, contarAsaltosPdfDuplicados, firmaAsalto, rangoExtractor, repetidosEntreRondas, type EntradaHechos,
} from '../scripts/indexado/cargar-hechos';
import { quitarGuardia, restaurarGuardia } from '../scripts/indexado/comun';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

type Parcial = {
  source?: 'fie' | 'rfee_pdf';
  extractor?: string;
  key?: string;
  status?: Partial<{ results: string; pools: string; tableau: string; publishedParticipants: number | null }>;
  results?: unknown[];
  bouts?: unknown[];
};

function hechos(p: Parcial) {
  const source = p.source ?? 'fie';
  return {
    version: 1,
    source,
    extractor: p.extractor ?? 'lector_fie',
    sourceUrl: source === 'fie' ? 'https://fie.org/competition/2024/10' : 'https://app.skermo.org/client/1/abc123.pdf',
    sourceSha256: 'a'.repeat(64),
    edition: {
      season: '2024', tournamentKey: source === 'fie' ? 'competition:10' : 'pdf:abc123', name: 'Copa',
      startDate: '2024-01-10', endDate: null, city: null, countryCode: null,
    },
    competition: {
      competitionKey: p.key ?? '10', weapon: 'ESPADA', gender: 'F', category: 'ABS', categoryRaw: null,
      format: 'INDIVIDUAL', date: '2024-01-11',
    },
    status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: null, notes: [], ...p.status },
    results: p.results ?? [],
    bouts: p.bouts ?? [],
  };
}

const res = (factKey: string, name: string, position: number) => ({ factKey, name, position });
const asalto = (phase: string, roundKey: string, aRef: string, bRef: string, aName: string, bName: string, scoreA: number, scoreB: number) =>
  ({ phase, roundKey, aRef, bRef, aName, bName, scoreA, scoreB });

let n = 0;
const entrada = (obj: unknown, carpeta = 'fie'): EntradaHechos => ({ ruta: `f${(n += 1)}.json`, carpeta, leer: () => obj });

describe('cargar-hechos', () => {
  it('inserta, ordena los asaltos y es idempotente', () => {
    const db = crearBase();
    quitarGuardia(db);
    const h = hechos({
      results: [res('100', 'GARCIA Ana', 1), res('200', 'LOPEZ Eva', 2), res('300', 'RUIZ Sol', 3)],
      bouts: [asalto('POULE', 'P1', '300', '100', 'RUIZ Sol', 'GARCIA Ana', 5, 3), asalto('TABLEAU', 'T2', '100', '200', 'GARCIA Ana', 'LOPEZ Eva', 15, 10)],
    });
    const i1 = cargarHechos(db, [entrada(h)]);
    expect(i1.tablas.sport_result.fie.insertadas).toBe(3);
    expect(i1.tablas.sport_bout.fie.insertadas).toBe(2);
    const poule = db.prepare(`SELECT * FROM sport_bout WHERE phase='POULE'`).get() as Record<string, unknown>;
    expect(poule).toMatchObject({ fencer_a_ref: '100', fencer_b_ref: '300', fencer_a_name: 'GARCIA Ana', score_a: 3, score_b: 5 });
    const cov = db.prepare(`SELECT fact_kind, status, imported_total FROM sport_import_coverage ORDER BY fact_kind`).all();
    expect(cov).toEqual([
      { fact_kind: 'pools', status: 'completo', imported_total: 1 },
      { fact_kind: 'ranking', status: 'completo', imported_total: 3 },
      { fact_kind: 'tableau', status: 'completo', imported_total: 1 },
    ]);

    const i2 = cargarHechos(db, [entrada(h)]);
    expect(i2.tablas.sport_result.fie).toEqual({ sinCambios: 3 });
    expect(i2.tablas.sport_bout.fie).toEqual({ sinCambios: 2 });
    expect(i2.tablas.sport_import_coverage['fie:ranking']).toEqual({ sinCambios: 1 });

    // Un vínculo de persona existente sobrevive a una revisión del hecho.
    db.exec(`INSERT INTO sport_person (id, display_name, name_normalized) VALUES ('p1', 'GARCIA Ana', 'ana garcia')`);
    db.exec(`UPDATE sport_result SET person_id='p1' WHERE source_fact_key='100'`);
    const h3 = hechos({ ...h, results: [res('100', 'GARCIA Ana', 2), res('200', 'LOPEZ Eva', 1), res('300', 'RUIZ Sol', 3)], bouts: h.bouts });
    const i3 = cargarHechos(db, [entrada(h3)]);
    expect(i3.tablas.sport_result.fie).toEqual({ actualizadas: 2, sinCambios: 1 });
    expect(db.prepare(`SELECT person_id, position, revision FROM sport_result WHERE source_fact_key='100'`).get())
      .toEqual({ person_id: 'p1', position: 2, revision: 2 });
    expect(db.prepare(`SELECT count(*) n FROM sport_edition`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT count(*) n FROM sport_competition`).get()).toEqual({ n: 1 });
  });

  it('no revisa puntos que sólo cambian de formato', () => {
    const db = crearBase();
    quitarGuardia(db);
    cargarHechos(db, [entrada(hechos({ results: [{ ...res('1', 'A Uno', 1), points: '30' }] }))]);
    db.exec(`UPDATE sport_result SET official_points='30.000', content_hash='viejo'`);
    const i = cargarHechos(db, [entrada(hechos({ results: [{ ...res('1', 'A Uno', 1), points: '30' }] }))]);
    expect(i.tablas.sport_result.fie).toEqual({ sinCambios: 1 });
    expect(db.prepare(`SELECT official_points, revision FROM sport_result`).get()).toEqual({ official_points: '30.000', revision: 1 });
  });

  it('FIE parcial con IDs estables fusiona sin borrar', () => {
    const db = crearBase();
    quitarGuardia(db);
    cargarHechos(db, [entrada(hechos({ results: [res('1', 'A Uno', 1), res('2', 'B Dos', 2)] }))]);
    const i = cargarHechos(db, [entrada(hechos({ status: { results: 'parcial' }, results: [res('3', 'C Tres', 3)] }))]);
    expect(i.secciones.results.fie.fusion).toBe(1);
    expect(db.prepare(`SELECT count(*) n FROM sport_result`).get()).toEqual({ n: 3 });
    expect(db.prepare(`SELECT status FROM sport_import_coverage WHERE fact_kind='ranking'`).get()).toEqual({ status: 'completo' });
  });

  it('PDF: conserva lo existente salvo reemplazo completo con al menos tantas filas', () => {
    const db = crearBase();
    quitarGuardia(db);
    const pdf = (extractor: string, estado: string, nombres: string[], prefijo: string) =>
      hechos({
        source: 'rfee_pdf', extractor, key: 'pdf:abc123:ESPADA:F', status: { results: estado, pools: 'sin_resultados', tableau: 'sin_resultados' },
        results: nombres.map((nm, i) => res(`${prefijo}:${i}`, nm, i + 1)),
      });
    cargarHechos(db, [entrada(pdf('lector_pdf', 'parcial', ['ANA GARCIA', 'EVA LOPEZ', 'SOL RUIZ'], 'pdf:p1'), 'pdf-lector')]);
    db.exec(`INSERT INTO sport_person (id, display_name, name_normalized) VALUES ('p1', 'ANA GARCIA', 'ana garcia')`);
    db.exec(`UPDATE sport_result SET person_id='p1' WHERE source_name='ANA GARCIA'`);

    const parcial = cargarHechos(db, [entrada(pdf('droid:x', 'parcial', ['GARCIA Ana', 'LOPEZ Eva'], 'pdf:p9'), 'pdf-droid')]);
    expect(parcial.secciones.results.rfee_pdf.conservado).toBe(1);
    expect(db.prepare(`SELECT count(*) n FROM sport_result`).get()).toEqual({ n: 3 });

    const completo = cargarHechos(db, [
      entrada(pdf('droid:x', 'parcial', ['GARCIA Ana'], 'pdf:p8'), 'pdf-droid'),
      entrada(pdf('lector_pdf', 'completo', ['GARCIA Ana', 'LOPEZ Eva', 'RUIZ Sol', 'DIAZ Paz'], 'pdf:p2'), 'pdf-lector'),
    ]);
    expect(completo.secciones.results.rfee_pdf.reemplazo).toBe(1);
    expect(completo.tablas.sport_result.rfee_pdf).toMatchObject({ insertadas: 4, borradas: 3, personaHeredada: 1 });
    expect(db.prepare(`SELECT person_id FROM sport_result WHERE source_name='GARCIA Ana'`).get()).toEqual({ person_id: 'p1' });
    expect(db.prepare(`SELECT status, imported_total FROM sport_import_coverage WHERE fact_kind='results'`).get())
      .toEqual({ status: 'completo', imported_total: 4 });
    expect(db.prepare(`SELECT competition_key, status FROM sport_import_coverage WHERE fact_kind='pdf'`).get())
      .toEqual({ competition_key: 'doc:abc123', status: 'completo' });
  });

  describe('asaltos rfee_pdf con referencias antiguas', () => {
    const K = 'pdf:abc123:ESPADA:F';
    function previa(db: DatabaseSync) {
      db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('e1', 'rfee_pdf', '2024', 'pdf:abc123', 'Copa');
        INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category)
          VALUES ('c1', 'e1', 'rfee_pdf', '2024', '${K}', 'ESPADA', 'F', 'ABS'),
                 ('c2', 'e1', 'rfee_pdf', '2024', '${K}~2', 'ESPADA', 'F', 'ABS');
        INSERT INTO sport_person (id, display_name, name_normalized) VALUES ('pa', 'ANA GARCIA', 'ana garcia');
        INSERT INTO sport_import_coverage (source, season, fact_kind, competition_key, competition_id, status)
          VALUES ('rfee_pdf', '2024', 'pools', '${K}~2', 'c2', 'parcial');`);
      const ins = db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
        fencer_a_person_id, fencer_a_name, fencer_b_name, score_a, score_b, content_hash) VALUES (?,?, 'rfee_pdf', 'POULE', 'P1', ?, ?, ?, ?, ?, ?, ?, 'h')`);
      ins.run('v1', 'c1', 'd:k:p0001', 'd:k:p0002', 'pa', 'GARCIA Ana', 'LOPEZ Eva', 5, 3);
      ins.run('v2', 'c1', 'd:k:p0001', 'd:k:p0003', 'pa', 'GARCIA Ana', 'RUIZ Sol', 5, 1);
      ins.run('v3', 'c2', 'd:k:p0002', 'd:k:p0003', null, 'LOPEZ Eva', 'RUIZ Sol', 2, 5);
    }
    const pdf = (bouts: unknown[], pools = 'parcial') => hechos({
      source: 'rfee_pdf', extractor: 'lector_pdf', key: K,
      status: { results: 'sin_resultados', pools, tableau: 'sin_resultados' }, bouts,
    });

    it('con menos asaltos nuevos quita sólo los antiguos repetidos y absorbe la división vacía', () => {
      const db = crearBase();
      quitarGuardia(db);
      previa(db);
      // Mismo asalto que v1 con otras referencias y los nombres en otro orden; v2 y v3 no llegan.
      const i = cargarHechos(db, [entrada(pdf([asalto('POULE', 'P1', 'pdf:2', 'pdf:1', 'LOPEZ Eva', 'GARCIA Ana', 3, 5)]), 'pdf-lector')]);
      expect(i.asaltosPdfDuplicados).toEqual({ antes: 0, despues: 0 });
      expect(i.secciones.pools.rfee_pdf.deduplicado).toBe(1);
      expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ insertadas: 1, duplicadasBorradas: 1, conservadas: 2 });
      expect(i.tablas.divisiones.rfee_pdf).toMatchObject({ encontradas: 1, asaltosMovidos: 1, competicionesBorradas: 1, coberturasBorradas: 1 });
      expect(db.prepare(`SELECT id FROM sport_bout ORDER BY id`).all().map((r) => r.id).filter((id) => id === 'v1')).toEqual([]);
      expect(db.prepare(`SELECT count(*) n FROM sport_competition WHERE id='c2'`).get()).toEqual({ n: 0 });
      expect(db.prepare(`SELECT fencer_a_person_id a, fencer_b_person_id b FROM sport_bout WHERE fencer_a_ref='pdf:1'`).get())
        .toEqual({ a: 'pa', b: null });
    });

    it('no absorbe una parte ~n que trae su propio fichero de hechos', () => {
      const db = crearBase();
      quitarGuardia(db);
      previa(db);
      const parte = hechos({
        source: 'rfee_pdf', extractor: 'lector_pdf', key: `${K}~2`,
        status: { results: 'sin_resultados', pools: 'completo', tableau: 'sin_resultados' },
        bouts: [asalto('POULE', 'P1', 'pdf:2', 'pdf:3', 'LOPEZ Eva', 'RUIZ Sol', 2, 5)],
      });
      const i = cargarHechos(db, [
        entrada(parte, 'pdf-lector'),
        entrada(pdf([asalto('POULE', 'P1', 'pdf:2', 'pdf:1', 'LOPEZ Eva', 'GARCIA Ana', 3, 5)]), 'pdf-lector'),
      ]);
      expect(i.tablas.divisiones.rfee_pdf).toEqual({ conFicheroPropio: 1 });
      expect(db.prepare(`SELECT competition_id c, fencer_a_ref a FROM sport_bout WHERE competition_id='c2'`).all())
        .toEqual([{ c: 'c2', a: 'pdf:2' }]);
      expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE competition_id='c1'`).get()).toEqual({ n: 2 });
    });

    it('con tantos o más asaltos nuevos sustituye la fase aunque sea parcial', () => {
      const db = crearBase();
      quitarGuardia(db);
      previa(db);
      const i = cargarHechos(db, [entrada(pdf([
        asalto('POULE', 'P1', 'pdf:1', 'pdf:2', 'GARCIA Ana', 'LOPEZ Eva', 5, 3),
        asalto('POULE', 'P1', 'pdf:1', 'pdf:3', 'GARCIA Ana', 'RUIZ Sol', 5, 1),
        asalto('POULE', 'P1', 'pdf:2', 'pdf:3', 'LOPEZ Eva', 'RUIZ Sol', 2, 5),
      ]), 'pdf-lector')]);
      expect(i.secciones.pools.rfee_pdf.reemplazo).toBe(1);
      expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ insertadas: 3, borradas: 3 });
      expect(db.prepare(`SELECT count(*) n FROM sport_bout WHERE fencer_a_person_id='pa'`).get()).toEqual({ n: 2 });
      expect(db.prepare(`SELECT count(*) n FROM sport_competition`).get()).toEqual({ n: 1 });
    });

    it('deja una sola copia del asalto de cuadro repetido en dos rondas', () => {
      const a = (r: string, an: string, bn: string, sa: number, sb: number) => ({ roundKey: r, aName: an, bName: bn, scoreA: sa, scoreB: sb });
      // Semifinales copiadas como final: se queda A4.
      const semis = [a('A4', 'UNO', 'DOS', 15, 9), a('A4', 'TRES', 'CUATRO', 15, 12), a('A2', 'UNO', 'DOS', 15, 9), a('A2', 'CUATRO', 'TRES', 12, 15)];
      expect(repetidosEntreRondas(semis).map((b) => b.roundKey)).toEqual(['A2', 'A2']);
      // La final copiada en A4, donde UNO y TRES ya tienen su semifinal: se queda A2.
      const final = [a('A4', 'UNO', 'DOS', 15, 9), a('A4', 'TRES', 'CUATRO', 15, 12), a('A4', 'UNO', 'TRES', 15, 14), a('A2', 'TRES', 'UNO', 14, 15)];
      expect(repetidosEntreRondas(final)).toEqual([final[2]]);
      expect(repetidosEntreRondas([a('A8', 'UNO', 'DOS', 15, 9), a('A8', 'TRES', 'CUATRO', 15, 9)])).toEqual([]);

      const db = crearBase();
      quitarGuardia(db);
      const i = cargarHechos(db, [entrada(hechos({
        source: 'rfee_pdf', extractor: 'lector_pdf', key: K,
        status: { results: 'sin_resultados', pools: 'sin_resultados', tableau: 'completo' },
        bouts: [
          asalto('TABLEAU', 'A4', 'pdf:1', 'pdf:2', 'GARCIA Ana', 'LOPEZ Eva', 15, 9),
          asalto('TABLEAU', 'A2', 'pdf:1', 'pdf:2', 'GARCIA Ana', 'LOPEZ Eva', 15, 9),
        ],
      }), 'pdf-lector')]);
      expect(i.tablas.sport_bout.rfee_pdf).toMatchObject({ insertadas: 1, repetidasEntreRondas: 1 });
      expect(db.prepare(`SELECT round_key r FROM sport_bout`).all()).toEqual([{ r: 'A4' }]);
    });

    it('cuenta los asaltos repetidos', () => {
      const db = crearBase();
      quitarGuardia(db);
      previa(db);
      db.exec(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name,
        fencer_b_name, score_a, score_b, content_hash) VALUES ('v9', 'c1', 'rfee_pdf', 'POULE', 'P1', 'x:1', 'x:2', 'LOPEZ Eva', 'GARCIA Ana', 3, 5, 'h'),
        ('v10', 'c1', 'rfee_pdf', 'POULE', 'V2P1', 'x:1', 'x:2', 'LOPEZ Eva', 'GARCIA Ana', 3, 5, 'h'),
        ('v11', 'c1', 'rfee_pdf', 'TABLEAU', 'A8', 'x:1', 'x:2', 'LOPEZ Eva', 'GARCIA Ana', 3, 5, 'h'),
        ('v12', 'c1', 'rfee_pdf', 'TABLEAU', 'T8', 'x:3', 'x:4', 'LOPEZ Eva', 'GARCIA Ana', 3, 5, 'h')`);
      // v9 repite v1 en la misma poule; v10 es la revancha de la segunda vuelta; v12 repite v11 con la ronda renombrada.
      expect(contarAsaltosPdfDuplicados(db)).toBe(2);
      expect(firmaAsalto('GARCIA Ana', 5, 'LOPEZ Eva', 3)).toBe(firmaAsalto('Eva López', 3, 'ana garcia', 5));
    });
  });

  it('elige por sección la extracción de mayor rango', () => {
    expect(rangoExtractor('lector_fie', 'parcial')).toBeGreaterThan(rangoExtractor('lector_pdf', 'completo'));
    expect(rangoExtractor('lector_pdf', 'completo')).toBeGreaterThan(rangoExtractor('droid:opus', 'completo'));
    expect(rangoExtractor('droid:opus', 'parcial')).toBeGreaterThan(rangoExtractor('lector_pdf', 'parcial'));

    const db = crearBase();
    quitarGuardia(db);
    const base = { source: 'rfee_pdf' as const, key: 'k1' };
    const i = cargarHechos(db, [
      entrada(hechos({ ...base, extractor: 'lector_pdf', status: { results: 'parcial' }, results: [res('pdf:1', 'ANA GARCIA', 1)] }), 'pdf-lector'),
      entrada(hechos({ ...base, extractor: 'droid:opus', status: { results: 'completo' }, results: [res('d:1', 'ANA GARCIA', 1), res('d:2', 'EVA LOPEZ', 2)] }), 'pdf-droid'),
    ]);
    expect(i.secciones.results.rfee_pdf['extractor:droid:opus']).toBe(1);
    expect(db.prepare(`SELECT count(*) n FROM sport_result`).get()).toEqual({ n: 2 });
  });

  it('rechaza ficheros inválidos y repone la guardia', () => {
    const db = crearBase();
    expect(quitarGuardia(db)).toBeGreaterThan(30);
    const i = cargarHechos(db, [entrada({ version: 2 })]);
    expect(i.ficheros.rechazados).toBe(1);
    restaurarGuardia(db);
    expect(() => db.exec(`INSERT INTO sport_person (id, display_name, name_normalized) VALUES ('x', 'x', 'x')`))
      .toThrow(/sport_write_lease_required/);
  });
});
