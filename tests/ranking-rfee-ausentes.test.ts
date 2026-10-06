import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { officialRankingEntry } from '@/db/schema';
import { lotesDeInsercion } from '@/lib/sqlite';
import { parseSkermoNationalRanking } from '@/lib/ingest/sources/skermo-results';
import {
  borrarAusentesDelRanking,
  claveFilaRanking,
  type LecturaDeGrupo,
} from '@/lib/ingest/sources/ranking-rfee';

const EN_CURSO = '17';
const CERRADA = '16';

describe('quien desaparece de la lista de Skermo pierde su fila', () => {
  const abiertos: ReturnType<typeof localD1>[] = [];
  afterEach(() => { abiertos.splice(0).forEach((l) => l.close()); });

  function base() {
    const local = localD1();
    abiertos.push(local);
    const db = createD1Database(local.binding);
    const fila = (skermoSeasonId: string, skermoAthleteId: string, categoryRaw = 'M20') => ({
      seasonLabel: skermoSeasonId === EN_CURSO ? '2026-2027' : '2025-2026',
      skermoSeasonId,
      weapon: 'ESPADA' as const,
      gender: 'F' as const,
      category: 'M20' as const,
      categoryRaw,
      position: 1,
      skermoAthleteId,
      sourceAthleteName: `Tiradora ${skermoAthleteId}`,
      contentHash: 'h',
    });
    return { local, db, fila };
  }

  async function guardadas(db: ReturnType<typeof createD1Database>, season: string) {
    const filas = await db.select().from(officialRankingEntry);
    return filas
      .filter((f) => f.skermoSeasonId === season)
      .map((f) => claveFilaRanking(f.weapon, f.gender, f.categoryRaw, f.skermoAthleteId ?? ''));
  }

  async function ids(db: ReturnType<typeof createD1Database>) {
    const filas = await db.select().from(officialRankingEntry);
    return filas.map((f) => `${f.skermoSeasonId}:${f.categoryRaw}:${f.skermoAthleteId}`).sort();
  }

  const lectura = (presentes: string[], completa = true): LecturaDeGrupo => ({
    weapon: 'ESPADA', gender: 'F', categoryRaw: 'M20', completa, presentes,
  });

  it('borra solo al ausente del grupo leído, y la segunda pasada no escribe', async () => {
    const { db, fila, local } = base();
    await db.insert(officialRankingEntry).values([
      fila(EN_CURSO, 'a'), fila(EN_CURSO, 'b'), fila(EN_CURSO, 'c'),
      fila(EN_CURSO, 'x', 'M17'),
      fila(CERRADA, 'b'),
    ]);

    const opciones = async () => ({
      skermoSeasonId: EN_CURSO,
      temporadaEnCurso: true,
      lecturas: [lectura(['a', 'c'])],
      guardadas: await guardadas(db, EN_CURSO),
    });

    expect(await borrarAusentesDelRanking(db, officialRankingEntry, await opciones())).toBe(1);
    expect(await ids(db)).toEqual(['16:M20:b', '17:M17:x', '17:M20:a', '17:M20:c']);

    const antes = local.calls.filter((c) => /^delete/i.test(c.sql)).length;
    expect(await borrarAusentesDelRanking(db, officialRankingEntry, await opciones())).toBe(0);
    expect(local.calls.filter((c) => /^delete/i.test(c.sql)).length).toBe(antes);
  });

  it('una lectura fallida, incompleta o vacía no borra nada', async () => {
    const { db, fila } = base();
    await db.insert(officialRankingEntry).values([fila(EN_CURSO, 'a'), fila(EN_CURSO, 'b')]);
    const g = await guardadas(db, EN_CURSO);

    for (const lecturas of [[], [lectura(['a'], false)], [lectura([])]]) {
      expect(
        await borrarAusentesDelRanking(db, officialRankingEntry, {
          skermoSeasonId: EN_CURSO, temporadaEnCurso: true, lecturas, guardadas: g,
        }),
      ).toBe(0);
    }
    expect(await ids(db)).toEqual(['17:M20:a', '17:M20:b']);
  });

  it('otra temporada queda intacta, aunque se lea entera', async () => {
    const { db, fila } = base();
    await db.insert(officialRankingEntry).values([
      fila(CERRADA, 'a'), fila(CERRADA, 'b'), fila(EN_CURSO, 'b'),
    ]);
    expect(
      await borrarAusentesDelRanking(db, officialRankingEntry, {
        skermoSeasonId: CERRADA,
        temporadaEnCurso: false,
        lecturas: [lectura(['a'])],
        guardadas: await guardadas(db, CERRADA),
      }),
    ).toBe(0);
    expect(await ids(db)).toEqual(['16:M20:a', '16:M20:b', '17:M20:b']);
  });

  async function grupoDe(total: number, faltan: number) {
    const { db, fila } = base();
    const todos = Array.from({ length: total }, (_, i) => `t${i}`);
    for (const lote of lotesDeInsercion(todos.map((id) => fila(EN_CURSO, id)), officialRankingEntry)) {
      await db.insert(officialRankingEntry).values(lote);
    }
    const notas: string[] = [];
    const borradas = await borrarAusentesDelRanking(db, officialRankingEntry, {
      skermoSeasonId: EN_CURSO,
      temporadaEnCurso: true,
      lecturas: [lectura(todos.slice(faltan))],
      guardadas: await guardadas(db, EN_CURSO),
      alSospechar: (d) => notas.push(d),
    });
    return { borradas, notas, quedan: (await ids(db)).length };
  }

  it('una baja masiva no borra nada y se anota', async () => {
    const r = await grupoDe(89, 37);
    expect(r).toEqual({
      borradas: 0,
      notas: ['espada F M20: faltan 37 de 89, no se borra'],
      quedan: 89,
    });
  });

  it('justo en el umbral sí se borra', async () => {
    // 11 de 44 es exactamente el 25 %: no lo supera.
    expect(await grupoDe(44, 11)).toEqual({ borradas: 11, notas: [], quedan: 33 });
    // 10 de 20 es el 50 %, pero no pasa de 10 tiradores.
    expect(await grupoDe(20, 10)).toEqual({ borradas: 10, notas: [], quedan: 10 });
  });

  it('el fixture real de Skermo se lee entero: cuenta como lectura completa', () => {
    const html = gunzipSync(
      readFileSync(new URL('./fixtures/skermo-ranking-rfee-espada-m20-f.html.gz', import.meta.url)),
    ).toString('utf8');
    const { rows, rowsSeen, mismatches } = parseSkermoNationalRanking(html, { federationCode: 'RFEE' });
    expect(rowsSeen).toBeGreaterThan(0);
    expect(rows.length).toBe(rowsSeen);
    expect(mismatches).toBe(0);
  });
});
