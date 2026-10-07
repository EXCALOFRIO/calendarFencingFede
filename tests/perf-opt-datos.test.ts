import { describe, expect, it, vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { localD1 } from '@/db/d1/testing';
import { sqlFeedSiguiendo } from '@/lib/sport/explorar/seguidos';
import type { SQLInputValue } from 'node:sqlite';
import { crearCache } from '@/lib/cache/cache';
import { almacenKv, almacenMemoria, enCascada } from '@/lib/cache/almacenes';

describe('conteos materializados del feed', () => {
  it('cuenta una prueba compartida sin filtrar participantes ni cambiar la página', () => {
    const local = localD1();
    try {
      const d = local.sqlite;
      d.exec(`
        INSERT INTO user_profile(id,email,full_name,ical_token) VALUES ('cuenta','test@example.test','Prueba','test');
        INSERT INTO sport_person(id,display_name,name_normalized) VALUES ('a','A','a'),('b','B','b');
        INSERT INTO sport_edition(id,source,season,tournament_key,name,start_date) VALUES ('e','fie','2026','e','Prueba','2026-01-01');
        INSERT INTO sport_competition(id,edition_id,source,season,competition_key,weapon,gender,category,format,competition_date)
          VALUES ('p','e','fie','2026','p','ESPADA','M','ABS','INDIVIDUAL','2026-01-01');
        INSERT INTO sport_result(id,competition_id,source,source_fact_key,person_id,source_name,position,occurred_on,content_hash)
          VALUES ('r1','p','fie','1','a','A',1,'2026-01-01','h1'),
                 ('r2','p','fie','2','b','B',5,'2026-01-01','h2'),
                 ('r3','p','fie','3',NULL,'Sin identidad',NULL,'2026-01-01','h3');
        INSERT INTO sport_favorite(profile_id,person_id,created_at) VALUES ('cuenta','a',1),('cuenta','b',2);
      `);
      for (const medallas of [true, false]) for (const limite of [1, 20]) {
        const q = new SQLiteSyncDialect().sqlToQuery(sqlFeedSiguiendo('cuenta', limite, null, medallas));
        const filas = d.prepare(q.sql).all(...q.params as SQLInputValue[]);
        const anterior = q.sql
          .replace('pagina AS MATERIALIZED (', 'pagina AS (')
          .replace(/\), conteos AS MATERIALIZED \([\s\S]*?FROM \(SELECT DISTINCT prueba FROM pagina\) pruebas/, '')
          .replace('tot.participantes AS participantes', '(SELECT count(*) FROM sport_result x WHERE x.competition_id = pg.prueba) AS participantes')
          .replace('CROSS JOIN conteos tot ON tot.prueba = pg.prueba', '');
        expect(filas).toEqual(d.prepare(anterior).all(...q.params as SQLInputValue[]));
        expect(filas.length).toBe(medallas ? 1 : 2);
        expect(filas.every(r => r.participantes === 3)).toBe(true);
        const plan = d.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params as SQLInputValue[]);
        expect(plan.some(r => String(r.detail).includes('MATERIALIZE conteos'))).toBe(true);
      }
    } finally { local.close(); }
  });
});

describe('lecturas KV compartidas en una ráfaga', () => {
  for (const n of [1, 10, 50]) for (const anterior of [true, false]) {
    it(`${n} peticiones, anterior=${anterior}: mismas operaciones que una`, async () => {
      const valores = new Map<string, string>();
      const get = vi.fn(async (k: string) => {
        await new Promise(r => setTimeout(r, 2));
        return valores.get(k) ?? null;
      });
      const put = vi.fn(async (k: string, v: string) => { valores.set(k, v); });
      const pendientes: Promise<unknown>[] = [];
      const almacen = enCascada([almacenMemoria(), almacenKv({ get, put })]);
      const cache = crearCache({
        almacen: () => almacen,
        versiones: { de: async () => 'v1', olvidar() {} },
        esperar: p => { pendientes.push(p); },
      });
      const cargar = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 2));
        return { puntos: [1, 2] };
      });
      const leer = cache.definir({
        espacio: 'prueba', depende: [], frescoMs: 1000, caducaMs: 2000,
        anteriorMientrasRevalida: anterior, cargar,
      });
      const resultados = await Promise.all(Array.from({ length: n }, () => leer()));
      await Promise.all(pendientes);
      expect(cargar).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledTimes(anterior ? 2 : 1);
      expect(put).toHaveBeenCalledTimes(anterior ? 2 : 1);
      expect(resultados.every(r => r.puntos.join(',') === '1,2')).toBe(true);
      const a = await leer(), b = await leer();
      a.puntos.push(3);
      expect(b.puntos).toEqual([1, 2]);
      expect(get).toHaveBeenCalledTimes(anterior ? 2 : 1);
    });
  }
});
