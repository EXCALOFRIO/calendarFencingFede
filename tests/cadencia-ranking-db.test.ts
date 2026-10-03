import { afterEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { consultaUltimaLecturaRanking } from '@/lib/ingest/cadencia-ranking-db';
import { tocaLeerRanking } from '@/lib/ingest/cadencia-ranking';

describe('la cadencia cuenta descargas, no ejecuciones que saltan el ranking', () => {
  const abiertos: ReturnType<typeof localD1>[] = [];
  afterEach(() => { abiertos.splice(0).forEach((local) => local.close()); });
  function database() {
    const local = localD1();
    abiertos.push(local);
    return { ...local, db: createD1Database(local.binding) };
  }
  it('genera SQL que exige éxito terminado con filas leídas, ordenado y limitado', () => {
    const { db, calls } = database();
    const query = consultaUltimaLecturaRanking(db).toSQL();
    expect(query.sql).toContain('"source" =');
    expect(query.sql).toContain('"status" =');
    expect(query.sql).toContain('"finished_at" is not null');
    expect(query.sql).toContain('"items_seen" >');
    expect(query.sql).toMatch(/order by "ingest_run"\."finished_at" desc limit/);
    expect(query.params).toEqual(['skermo_ranking', 'ok', 0, 1]);
    expect(calls).toEqual([]);
  });

  it('seis saltos diarios no aplazan la revisión semanal desde la última descarga', () => {
    const ultimaDescarga = new Date('2026-10-01T05:30:00Z');
    for (let dia = 1; dia <= 7; dia++) {
      const ahora = new Date(ultimaDescarga.getTime() + dia * 86_400_000);
      const decision = tocaLeerRanking(ahora, ultimaDescarga, []);
      expect(decision.leer, `día ${dia}`).toBe(dia === 7);
      if (decision.leer) expect(decision.motivo).toBe('mantenimiento_semanal');
    }
  });

  it('una descarga sin cambios de filas también cuenta y reinicia la semana', () => {
    // items_seen > 0, aunque items_created/items_updated sean 0: no se exige
    // una novedad de contenido para que una descarga sea válida.
    const { db } = database();
    const sql = consultaUltimaLecturaRanking(db).toSQL().sql;
    expect(sql).not.toContain('items_updated');
    expect(sql).not.toContain('items_created');
  });
});
