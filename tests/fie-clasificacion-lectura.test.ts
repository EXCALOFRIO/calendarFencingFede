import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { describe, expect, it, vi } from 'vitest';
import { fieClasificacion } from '@/db/schema';
import {
  cerrarLecturaGrupo,
  escritorLecturaD1,
  type EscritorLecturaFie,
  type GrupoClasificacionFie,
} from '@/lib/ingest/sources/fie-clasificacion-lectura';

const GRUPO: GrupoClasificacionFie = {
  season: 2027,
  format: 'INDIVIDUAL',
  weapon: 'ESPADA',
  gender: 'M',
  categoryRaw: 'S',
};

function falso(guardadas: number) {
  const e = {
    contarGuardadas: vi.fn(async () => guardadas),
    borrarAusentes: vi.fn(async (_g: GrupoClasificacionFie, presentes: readonly number[]) => guardadas - presentes.length),
    registrarLectura: vi.fn(async () => {}),
  } satisfies EscritorLecturaFie;
  return e;
}

describe('cerrarLecturaGrupo', () => {
  it('una lectura fallida no borra ni registra nada', async () => {
    const e = falso(10);
    const r = await cerrarLecturaGrupo(e, GRUPO, { ok: false });
    expect(r).toEqual({ borradas: 0, registrada: false, podaOmitida: true });
    expect(e.contarGuardadas).not.toHaveBeenCalled();
    expect(e.borrarAusentes).not.toHaveBeenCalled();
    expect(e.registrarLectura).not.toHaveBeenCalled();
  });

  it('una respuesta vacía no borra ni registra nada', async () => {
    const e = falso(10);
    const r = await cerrarLecturaGrupo(e, GRUPO, { ok: true, fieIds: [], sourceUrl: null });
    expect(r.registrada).toBe(false);
    expect(e.borrarAusentes).not.toHaveBeenCalled();
    expect(e.registrarLectura).not.toHaveBeenCalled();
  });

  it('una respuesta con menos de la mitad de las filas guardadas registra pero no borra', async () => {
    const e = falso(10);
    const r = await cerrarLecturaGrupo(e, GRUPO, { ok: true, fieIds: [1, 2, 3, 4], sourceUrl: 'u' });
    expect(r).toEqual({ borradas: 0, registrada: true, podaOmitida: true });
    expect(e.borrarAusentes).not.toHaveBeenCalled();
    expect(e.registrarLectura).toHaveBeenCalledOnce();
  });

  it('una lectura buena borra las ausentes (sin repetir ids) y registra la hora', async () => {
    const e = falso(4);
    const ahora = new Date('2026-10-06T05:00:00Z');
    const r = await cerrarLecturaGrupo(e, GRUPO, { ok: true, fieIds: [1, 2, 2, 3], sourceUrl: 'u' }, ahora);
    expect(e.borrarAusentes).toHaveBeenCalledWith(GRUPO, [1, 2, 3]);
    expect(e.registrarLectura).toHaveBeenCalledWith(GRUPO, { filas: 3, borradas: 1, leidoEn: ahora, sourceUrl: 'u' });
    expect(r).toEqual({ borradas: 1, registrada: true, podaOmitida: false });
  });
});

const MIGRACIONES = readdirSync(new URL('../drizzle-d1/', import.meta.url))
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

function base(hasta: string) {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRACIONES.filter((m) => m <= hasta)) {
    sqlite.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  const dialecto = new SQLiteSyncDialect();
  const db = {
    async execute(query: SQL) {
      const q = dialecto.sqlToQuery(query);
      return { rows: sqlite.prepare(q.sql).all(...(q.params as (string | number | null)[])) };
    },
  };
  const ins = sqlite.prepare(`INSERT INTO fie_clasificacion
    (season, weapon, gender, category, category_raw, format, fie_id, position, points, content_hash)
    VALUES (?, ?, ?, 'ABS', ?, ?, ?, ?, '1.000', 'h')`);
  for (const id of [1, 2, 3, 4]) ins.run(2027, 'ESPADA', 'M', 'S', 'INDIVIDUAL', id, id);
  // Otro grupo: no se toca.
  for (const id of [1, 9]) ins.run(2027, 'ESPADA', 'M', 'S', 'EQUIPOS', id, id);
  return { sqlite, db };
}

describe('escritor sobre SQLite con las migraciones reales', () => {
  it('0009 crea la tabla; la poda solo borra del grupo y la lectura se guarda', async () => {
    const { sqlite, db } = base('0009_zzz');
    const escritor = escritorLecturaD1(db, fieClasificacion);
    const r = await cerrarLecturaGrupo(
      escritor,
      GRUPO,
      { ok: true, fieIds: [1, 2, 4], sourceUrl: 'https://fie.org/x' },
      new Date(1_790_000_000_000),
    );
    expect(r.borradas).toBe(1);
    const quedan = sqlite
      .prepare('SELECT format, fie_id FROM fie_clasificacion ORDER BY format, fie_id')
      .all()
      .map((f) => `${f.format}:${f.fie_id}`);
    expect(quedan).toEqual(['EQUIPOS:1', 'EQUIPOS:9', 'INDIVIDUAL:1', 'INDIVIDUAL:2', 'INDIVIDUAL:4']);
    expect(sqlite.prepare('SELECT * FROM fie_clasificacion_lectura').all()).toEqual([
      {
        season: 2027,
        format: 'INDIVIDUAL',
        weapon: 'ESPADA',
        gender: 'M',
        category_raw: 'S',
        row_count: 3,
        deleted_count: 1,
        read_at: 1_790_000_000_000,
        source_url: 'https://fie.org/x',
      },
    ]);

    // Segunda lectura del mismo grupo: actualiza, no duplica.
    await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 4], sourceUrl: null }, new Date(1_790_000_100_000));
    expect(sqlite.prepare('SELECT count(*) n, max(read_at) r, max(deleted_count) d FROM fie_clasificacion_lectura').get()).toEqual({
      n: 1,
      r: 1_790_000_100_000,
      d: 0,
    });
  });

  it('sin la migración 0009 la poda funciona y registrar la lectura no rompe la ingestión', async () => {
    const { sqlite, db } = base('0008_zzz');
    const escritor = escritorLecturaD1(db, fieClasificacion);
    const r = await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3], sourceUrl: null });
    expect(r).toMatchObject({ borradas: 1, registrada: true });
    expect(sqlite.prepare("SELECT count(*) n FROM fie_clasificacion WHERE format = 'INDIVIDUAL'").get()).toEqual({ n: 3 });
  });

  it('una lectura vacía no borra nada en la base', async () => {
    const { sqlite, db } = base('0009_zzz');
    await cerrarLecturaGrupo(escritorLecturaD1(db, fieClasificacion), GRUPO, { ok: true, fieIds: [], sourceUrl: null });
    expect(sqlite.prepare('SELECT count(*) n FROM fie_clasificacion').get()).toEqual({ n: 6 });
    expect(sqlite.prepare('SELECT count(*) n FROM fie_clasificacion_lectura').get()).toEqual({ n: 0 });
  });
});
