import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { quitarGuardia } from '../scripts/indexado/comun';
import { emparejarDuplicados, fundirDuplicados, mismoEvento, prepararNombre, type PruebaNacional } from '../scripts/indexado/dedupe-pruebas';
import { paresTresDias } from '../scripts/indexado/lote13-duplicados';

const nombres = (k: number, desde = 0) => Array.from({ length: k }, (_, i) => `APELLIDO${String.fromCharCode(65 + ((i + desde) % 26))}${i + desde} SEGUNDO Nombre${i + desde}`);

function p(id: string, o: Partial<PruebaNacional> & { lista: string[] }): PruebaNacional {
  return {
    id, source: 'engarde', season: '2020-2021', competition_key: `k:${id}`, edition_id: `e:${id}`, weapon: 'ESPADA', gender: 'F', category: 'M20',
    fecha: '2020-12-08', url: null, resultados: o.lista.length, conPuesto: o.lista.length, asaltos: { POULE: 0, TABLEAU: 0 },
    nombres: o.lista.map(prepararNombre), ...o,
  };
}

describe('lote 13: duplicados a 3 días', () => {
  // Campeonato de España junior 2020: el PDF de la RFEE lo fecha el 5-12 y Engarde el 8-12.
  const pdf = p('0c07078a', { source: 'rfee_pdf', season: '2019-2020', fecha: '2020-12-05', lista: nombres(28) });
  const engarde = p('6f06c861', { lista: nombres(28) });

  it('funde a 3 días con el mismo género y categoría y casi todos los tiradores', () => {
    expect(mismoEvento(pdf, engarde)).toBe(28);
    expect(emparejarDuplicados([pdf, engarde]).grupos.map((g) => [g.destino.id, g.otras.map((o) => o.id)])).toEqual([['0c07078a', ['6f06c861']]]);
    expect(paresTresDias([pdf, engarde]).map((x) => [x.a, x.b, x.comunes])).toEqual([['0c07078a', '6f06c861', 28]]);
  });

  it('a 3 días no basta la mitad de los tiradores, ni un género mixto, ni otra categoría, ni pocas personas', () => {
    expect(mismoEvento(pdf, p('x', { lista: [...nombres(24), ...nombres(10, 40)] }))).toBe(0);
    // A 2 días esa misma prueba sí casa con la regla normal.
    expect(mismoEvento({ ...pdf, fecha: '2020-12-06' }, p('x', { lista: [...nombres(24), ...nombres(10, 40)] }))).toBe(24);
    expect(mismoEvento(pdf, { ...engarde, gender: 'MIXTO' })).toBe(0);
    expect(mismoEvento({ ...pdf, fecha: '2020-12-07' }, { ...engarde, gender: 'MIXTO' })).toBe(28);
    expect(mismoEvento(pdf, { ...engarde, category: 'ABS' }, 0.5, true)).toBe(0);
    expect(mismoEvento(p('a', { source: 'rfee_pdf', fecha: '2020-12-05', lista: nombres(6) }), p('b', { lista: nombres(6) }))).toBe(0);
    // A 4 días nunca.
    expect(mismoEvento({ ...pdf, fecha: '2020-12-04' }, engarde)).toBe(0);
  });

  it('90 % en común en los dos sentidos (TNR con unos pocos que sólo salen en una lectura)', () => {
    const a = p('a', { source: 'rfee_pdf', fecha: '2021-10-07', lista: nombres(95) });
    const b = p('b', { fecha: '2021-10-10', lista: [...nombres(90), ...nombres(8, 200)] });
    expect(mismoEvento(a, b)).toBe(90);
    const c = p('c', { fecha: '2021-10-10', lista: [...nombres(80), ...nombres(18, 200)] });
    expect(mismoEvento(a, c)).toBe(0);
  });

  it('fundirDuplicados con soloCon sólo toca los grupos pedidos', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
      db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
    }
    quitarGuardia(db);
    const comp = (id: string, source: string, fecha: string, cat: string) => {
      db.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, start_date) VALUES (?,?,'2020-2021',?,?,?)`).run(`e${id}`, source, `t${id}`, id, fecha);
      db.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
        VALUES (?,?,?,'2020-2021',?,'ESPADA','F',?,'INDIVIDUAL',?)`).run(id, `e${id}`, source, `k${id}`, cat, fecha);
    };
    comp('pdf', 'rfee_pdf', '2020-12-05', 'M20');
    comp('eng', 'engarde', '2020-12-08', 'M20');
    comp('pdf2', 'rfee_pdf', '2020-12-05', 'M17');
    comp('eng2', 'engarde', '2020-12-06', 'M17');
    let k = 0;
    for (const [c, s] of [['pdf', 'rfee_pdf'], ['eng', 'engarde'], ['pdf2', 'rfee_pdf'], ['eng2', 'engarde']]) {
      nombres(10).forEach((nm, i) => db.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, source_name, position, content_hash)
        VALUES (?,?,?,?,?,?, 'h')`).run(`r${(k += 1)}`, c, s, `f${k}`, nm, i + 1));
    }
    const inf = fundirDuplicados(db, { soloCon: new Set(['eng']) });
    expect(inf.grupos).toBe(1);
    expect((db.prepare(`SELECT id FROM sport_competition ORDER BY id`).all() as { id: string }[]).map((r) => r.id)).toEqual(['eng2', 'pdf', 'pdf2']);
    expect(fundirDuplicados(db, { soloCon: new Set(['eng']) }).grupos).toBe(0);
  });
});
