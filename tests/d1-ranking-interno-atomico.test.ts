import { afterEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db';
import { localD1 } from '@/db/d1/testing';
import { athlete, event, eventCompetition, rankingPoint, rankingSnapshot, season } from '@/db/schema';
import { persistRanking, type RankingGroupResult } from '@/lib/ranking/compute';

const abiertos: ReturnType<typeof localD1>[] = [];
afterEach(() => { abiertos.splice(0).forEach((local) => local.close()); });

async function fixture() {
  const local = localD1();
  abiertos.push(local);
  const db = createD1Database(local.binding);
  await db.insert(season).values({ id: 'temporada', label: 'fixture', startDate: '2026-09-01', endDate: '2027-08-31' });
  await db.insert(athlete).values({ id: 'atleta', firstName: 'Fixture', lastName: 'Prueba', birthDate: '2000-01-01', gender: 'M' });
  await db.insert(event).values({
    id: 'evento', source: 'skermo_rfee', sourceId: 'fixture', name: 'Fixture',
    startDate: '2026-10-01', endDate: '2026-10-01', scope: 'NACIONAL', contentHash: 'fixture',
  });
  await db.insert(eventCompetition).values({
    id: 'prueba', eventId: 'evento', weapon: 'ESPADA', gender: 'M', category: 'ABS', contentHash: 'fixture',
  });
  return { ...local, db };
}

function grupo(athleteId = 'atleta'): RankingGroupResult {
  return {
    weapon: 'ESPADA', gender: 'M', category: 'ABS',
    // La regla ya fue aplicada: esta prueba comprueba solo la persistencia.
    rule: {} as RankingGroupResult['rule'],
    rows: [{
      athleteId, athleteName: 'Fixture', clubId: null, position: 1, totalPoints: 12.5,
      countedEventIds: ['prueba'],
      contributions: [{
        athleteId, eventCompetitionId: 'prueba', resultId: null, eventName: 'Fixture',
        eventCity: null, eventDate: '2026-10-01', circuit: 'NACIONAL', position: 1,
        basePoints: 25, coefficient: 0.5, finalPoints: 12.5, counted: true, explanation: 'Fixture',
      }],
    }],
  };
}

describe('sustitución atómica del ranking interno en D1', () => {
  it('guarda puntos, decimales, JSON y snapshots juntos sin duplicar al repetir', async () => {
    const local = await fixture();
    expect(await persistRanking('temporada', [grupo()], local.db)).toEqual({ points: 1, snapshots: 1 });
    expect(await persistRanking('temporada', [grupo()], local.db)).toEqual({ points: 1, snapshots: 1 });
    expect(await local.db.select().from(rankingPoint)).toMatchObject([{
      finalPoints: '12.50', coefficient: '0.500', counted: '1',
    }]);
    expect(await local.db.select().from(rankingSnapshot)).toMatchObject([{
      totalPoints: '12.50', countedEventIds: ['prueba'],
    }]);
    expect(local.calls.every((call) => call.parameters <= 100)).toBe(true);
  });

  it('un fallo de FK después del borrado conserva los puntos y snapshots anteriores', async () => {
    const local = await fixture();
    await persistRanking('temporada', [grupo()], local.db);
    const beforePoints = await local.db.select().from(rankingPoint);
    const beforeSnapshots = await local.db.select().from(rankingSnapshot);
    await expect(persistRanking('temporada', [grupo('inexistente')], local.db)).rejects.toThrow();
    expect(await local.db.select().from(rankingPoint)).toEqual(beforePoints);
    expect(await local.db.select().from(rankingSnapshot)).toEqual(beforeSnapshots);
  });

  it('conserva snapshots históricos y limpia el día actual cuando no quedan puntos', async () => {
    const local = await fixture();
    await persistRanking('temporada', [grupo()], local.db);
    await local.db.insert(rankingSnapshot).values({
      seasonId: 'temporada', athleteId: 'atleta', weapon: 'ESPADA', gender: 'M', category: 'ABS',
      position: 1, totalPoints: '10.00', countedEventIds: [], computedAt: new Date('2020-01-01T00:00:00Z'),
    });
    await persistRanking('temporada', [], local.db);
    expect(await local.db.select().from(rankingPoint)).toEqual([]);
    const snapshots = await local.db.select().from(rankingSnapshot);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].computedAt).toEqual(new Date('2020-01-01T00:00:00Z'));
  });

  it('rechaza una sustitución mayor del límite atómico antes de borrar el ranking', async () => {
    const local = await fixture();
    await persistRanking('temporada', [grupo()], local.db);
    const before = await local.db.select().from(rankingPoint);
    const many = grupo();
    many.rows = Array.from({ length: 1_000 }, () => grupo().rows[0]);
    local.calls.length = 0;
    await expect(persistRanking('temporada', [many], local.db)).rejects.toThrow('1..100');
    expect(local.calls).toEqual([]);
    expect(await local.db.select().from(rankingPoint)).toEqual(before);
  });
});
