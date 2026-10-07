import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { AsaltoPdf } from '../src/lib/ingest/sources/rfee-pdf/tipos';
import { quitarGuardia } from '../scripts/indexado/comun';
import type { CuadroPdf } from '../scripts/indexado/lote12-pdf-auditar';
import { aplicarRondas, mismaRonda, planRondas, rondaEnBase, type AsaltoGuardado } from '../scripts/indexado/lote13-rondas';

const T = ['RUIZ VAZQUEZ Pablo', 'RAMI ROZPIDE Rayan', 'FALCON PAISER Jose Francesco', 'JIA HUAN KENTON Hsu', 'OLANGUA FERNANDEZ Dario',
  'VERDE ALONSO Manuel', 'MORA AMBRONA Hector', 'BAJRACHARYA Hugo'];

const pdf = (ronda: string, original: string, a: number, pa: number, b: number, pb: number): AsaltoPdf => ({
  fase: 'TABLEAU', ronda, rondaOriginal: original, refA: `pdf:${a}`, refB: `pdf:${b}`, nombreA: T[a], nombreB: T[b], puntosA: pa, puntosB: pb,
  marcador: 'explicito', region: { pagina: 15, yMax: 0, yMin: 0 },
} as AsaltoPdf);

let n = 0;
/** Con el orden canónico de la base (`fencer_a_ref < fencer_b_ref`). */
const guardado = (ronda: string, a0: number, sa0: number, b0: number, sb0: number): AsaltoGuardado => {
  const [a, sa, b, sb] = a0 < b0 ? [a0, sa0, b0, sb0] : [b0, sb0, a0, sa0];
  return {
    id: `b${(n += 1)}`, competicion: 'c1', competitionKey: 'pdf:x', fase: 'TABLEAU', ronda, aRef: `r:${a}`, bRef: `r:${b}`, aNombre: T[a], bNombre: T[b],
    aPersona: null, bPersona: null, sa, sb, url: 'https://app.skermo.org/client/1/x.pdf',
  };
};

/** Cuadro de 8 del PDF releído: las semifinales («Semi-finals») el lector antiguo las guardó como A2. */
const cuadroPdf: CuadroPdf = {
  clave: 'x:ESPADA:M:INDIVIDUAL:M15:', completo: true, puestos: [], fallos: [],
  cuadro: [pdf('A8', 'Tableau of 8', 0, 15, 7, 3), pdf('A8', 'Tableau of 8', 2, 15, 6, 9), pdf('A8', 'Tableau of 8', 1, 15, 5, 4), pdf('A8', 'Tableau of 8', 3, 15, 4, 11),
    pdf('A4', 'Semi-finals', 2, 6, 1, 15), pdf('A4', 'Semi-finals', 3, 12, 0, 15), pdf('A2', 'Final', 0, 15, 1, 13)],
};
const fiables = new Set(cuadroPdf.cuadro.map((_, i) => i));

function base() {
  const g = [guardado('A8', 0, 15, 7, 3), guardado('A8', 2, 15, 6, 9), guardado('A8', 1, 15, 5, 4), guardado('A8', 3, 15, 4, 11),
    guardado('A2', 2, 6, 1, 15), guardado('A2', 3, 12, 0, 15), guardado('A2', 0, 15, 1, 13)];
  return g;
}

describe('lote 13: rondas del cuadro mal rotuladas', () => {
  it('la ronda del PDF con el prefijo guardado: T16 y A16 son la misma ronda', () => {
    expect(rondaEnBase('T16', 'A16')).toBe('T16');
    expect(mismaRonda('T16', 'A16')).toBe(true);
    expect(rondaEnBase('A2', 'A4')).toBe('A4');
    expect(rondaEnBase('T2', 'A4')).toBe('T4');
  });

  it('corrige sólo las semifinales guardadas como final, con su evidencia', () => {
    const g = base();
    const r = planRondas(g, g, cuadroPdf, fiables);
    expect(r.dudas).toEqual([]);
    expect(r.cambios.map((c) => [c.asalto, c.antes, c.despues, c.evidencia.rondaOriginal, c.evidencia.pagina])).toEqual([
      [g[4].id, 'A2', 'A4', 'Semi-finals', 15], [g[5].id, 'A2', 'A4', 'Semi-finals', 15],
    ]);
  });

  it('no corrige un cruce del PDF que no es fiable ni si el cuadro queda peor', () => {
    const g = base();
    const sinFiable = new Set([...fiables].filter((i) => i !== 4));
    const r = planRondas(g, g, cuadroPdf, sinFiable);
    expect(r.cambios.map((c) => c.asalto)).toEqual([g[5].id]);
    expect(r.dudas.map((d) => [d.asalto, d.motivo])).toEqual([[g[4].id, 'cruce_pdf_no_fiable']]);
    // Ya hay otra semifinal entre los mismos en A4: no se duplica.
    const otra = [...g, guardado('A4', 2, 6, 1, 15)];
    expect(planRondas(otra, otra, cuadroPdf, fiables).dudas.map((d) => d.motivo.split(':')[0])).toContain('pareja_ya_en_la_ronda_nueva');
  });

  it('aplica por id, recalcula el hash y es idempotente', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
      db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
    }
    quitarGuardia(db);
    db.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('e1','rfee_pdf','2024-2025','t','T');
      INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category) VALUES ('c1','e1','rfee_pdf','2024-2025','pdf:x','ESPADA','M','M15');`);
    const g = base();
    for (const b of g) {
      db.prepare(`INSERT INTO sport_bout (id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref, fencer_a_name, fencer_b_name, score_a, score_b, content_hash)
        VALUES (?, 'c1', 'rfee_pdf', 'TABLEAU', ?, ?, ?, ?, ?, ?, ?, 'viejo')`).run(b.id, b.ronda, b.aRef, b.bRef, b.aNombre, b.bNombre, b.sa, b.sb);
    }
    const { cambios } = planRondas(g, g, cuadroPdf, fiables);
    expect(aplicarRondas(db, cambios)).toMatchObject({ aplicadas: 2, yaAplicadas: 0, obsoletas: [] });
    expect(db.prepare(`SELECT round_key r, revision v, content_hash <> 'viejo' h FROM sport_bout WHERE id IN (?, ?) ORDER BY id`).all(g[4].id, g[5].id))
      .toEqual([{ r: 'A4', v: 2, h: 1 }, { r: 'A4', v: 2, h: 1 }]);
    expect(aplicarRondas(db, cambios)).toMatchObject({ aplicadas: 0, yaAplicadas: 2, obsoletas: [] });
    db.prepare(`UPDATE sport_bout SET score_a = 9 WHERE id = ?`).run(g[4].id);
    expect(aplicarRondas(db, cambios).obsoletas).toEqual([{ asalto: g[4].id, motivo: 'asalto_distinto' }]);
  });
});
