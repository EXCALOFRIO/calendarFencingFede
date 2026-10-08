import { afterEach, describe, expect, it, vi } from 'vitest';
import { sportPerson } from '@/db/schema';
import { crearDepsPersistenciaFieDb } from '@/lib/ingest/fie-resultados-db';
import type { FilaResultado } from '@/lib/ingest/fie-resultados-persist';
import { dbConSportLease, reclamarSportLease } from '@/lib/ingest/sport-incremental/lease';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const abiertos: ReturnType<typeof fixtureDeportivaD1>[] = [];
afterEach(() => abiertos.splice(0).forEach((local) => local.close()));

async function database() {
  const local = fixtureDeportivaD1();
  abiertos.push(local);
  const lease = await reclamarSportLease(local.db);
  const owned = dbConSportLease(local.db, lease!);
  const deps = crearDepsPersistenciaFieDb(owned);
  const competitionId = await deps.upsertPrueba({
    season: 2027, competitionId: 1478, tournamentId: 1,
    nombre: 'Prueba sintética', ciudad: 'Madrid', federacion: 'ESP',
    inicio: '2026-09-25', fin: '2026-09-25', fecha: '2026-09-25',
    arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: 'S',
    formato: 'INDIVIDUAL', url: 'https://fie.org/competitions/2027/1478',
  });
  return { ...local, lease, owned, deps, competitionId };
}

const resultado: FilaResultado = {
  sourceFactKey: '70490',
  personId: null,
  sourceName: 'FIE 70490',
  sourceCountryCode: 'USA',
  position: 1,
  positionRaw: '1',
  officialPoints: '32',
  occurredOn: '2026-09-25',
  sourceUrl: 'https://fie.org/api/fie/competition/2027/1478/results/ranking',
  contentHash: 'h',
};

describe('persistencia FIE con SQLite real y guardia D1, sin red', () => {
  it('los puestos van por la clave natural y sólo se reescriben si cambia el contenido o llega la persona', async () => {
    const local = await database();
    const write = (row = resultado) => local.deps.upsertResultados(local.competitionId, [row]);
    expect(await write()).toEqual({ nuevos: 1, revisados: 0, sinCambios: 0 });
    const original = local.sqlite.prepare('SELECT id,revision,revised_at FROM sport_result').get()!;
    expect(await write()).toEqual({ nuevos: 0, revisados: 0, sinCambios: 1 });
    expect(await write({ ...resultado, position: 2, contentHash: 'corregido' }))
      .toEqual({ nuevos: 0, revisados: 1, sinCambios: 0 });
    const corrected = local.sqlite.prepare('SELECT id,revision,revised_at,position FROM sport_result').get()!;
    expect(corrected).toMatchObject({ id: original.id, revision: Number(original.revision) + 1, position: 2 });
    expect(Number(corrected.revised_at)).toBeGreaterThan(1_700_000_000_000);
    await local.owned.insert(sportPerson).values({ id: 'persona', displayName: 'Sintética', nameNormalized: 'sintetica' });
    expect(await write({ ...resultado, position: 2, contentHash: 'corregido', personId: 'persona' }))
      .toEqual({ nuevos: 0, revisados: 1, sinCambios: 0 });
    expect(local.sqlite.prepare('SELECT id,revision,revised_at,person_id FROM sport_result').get())
      .toMatchObject({ id: original.id, revision: corrected.revision, revised_at: corrected.revised_at, person_id: 'persona' });
    await write({ ...resultado, position: 2, contentHash: 'corregido' });
    expect(local.sqlite.prepare('SELECT person_id FROM sport_result').get()!.person_id).toBe('persona');
    expect(local.calls.some(({ sql }) => /\bxmax\b|pg_|::uuid/.test(sql))).toBe(false);
    await local.lease!.liberar();
  });

  it('con tournamentId la edición abarca las fechas de todas sus pruebas, no las de la última', async () => {
    const local = await database();
    await local.deps.upsertPrueba({
      season: 2027, competitionId: 1479, tournamentId: 1,
      nombre: 'Prueba sintética', ciudad: 'Madrid', federacion: 'ESP',
      inicio: '2026-09-27', fin: '2026-09-27', fecha: '2026-09-27',
      arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaOriginal: 'S',
      formato: 'EQUIPOS', url: 'https://fie.org/competitions/2027/1479',
    });
    await local.deps.upsertPrueba({
      season: 2027, competitionId: 1480, tournamentId: 1,
      nombre: 'Prueba sintética', ciudad: 'Madrid', federacion: 'ESP',
      inicio: '2026-09-26', fin: '2026-09-26', fecha: '2026-09-26',
      arma: 'ESPADA', genero: 'F', categoria: 'ABS', categoriaOriginal: 'S',
      formato: 'INDIVIDUAL', url: 'https://fie.org/competitions/2027/1480',
    });
    expect(local.sqlite.prepare("SELECT count(*) n, min(start_date) i, max(end_date) f FROM sport_edition WHERE source = 'fie'").get())
      .toEqual({ n: 1, i: '2026-09-25', f: '2026-09-27' });
    await local.lease!.liberar();
  });

  it('cuenta como sin cambios las filas que el upsert no devuelve', async () => {
    const local = await database();
    const rows = [resultado, { ...resultado, sourceFactKey: '2' }];
    expect(await local.deps.upsertResultados(local.competitionId, rows)).toEqual({ nuevos: 2, revisados: 0, sinCambios: 0 });
    expect(await local.deps.upsertResultados(local.competitionId, rows)).toEqual({ nuevos: 0, revisados: 0, sinCambios: 2 });
    expect(await local.deps.contarResultados!(local.competitionId)).toEqual({ total: 2, sinPersona: 2 });
    await local.lease!.liberar();
  });

  it('los asaltos van por prueba, fase, ronda y el par canónico', async () => {
    const local = await database();
    const row = {
      phase: 'TABLEAU' as const, roundKey: 'A2', fencerARef: '3', fencerBRef: '5',
      fencerAPersonId: null, fencerBPersonId: null, fencerAName: 'FIE 3', fencerBName: 'FIE 5',
      scoreA: 11, scoreB: 15, occurredOn: '2026-09-25', sourceUrl: 'u', contentHash: 'h',
    };
    const write = (rows = [row]) => local.deps.upsertAsaltos(local.competitionId, rows);
    expect(await write()).toEqual({ nuevos: 1, revisados: 0, sinCambios: 0 });
    expect(await write()).toEqual({ nuevos: 0, revisados: 0, sinCambios: 1 });
    expect(await write([{ ...row, scoreA: 12, contentHash: 'corregido' }]))
      .toEqual({ nuevos: 0, revisados: 1, sinCambios: 0 });
    expect(local.sqlite.prepare('SELECT count(*) AS n,max(revision) AS revision,max(score_a) AS score FROM sport_bout').get())
      .toEqual({ n: 1, revision: 2, score: 12 });
    expect(await write([{ ...row, roundKey: 'A4' }])).toEqual({ nuevos: 1, revisados: 0, sinCambios: 0 });
    expect(local.calls.every(({ parameters }) => parameters <= 100)).toBe(true);
    await local.lease!.liberar();
  });

  it('confirma identidad en un batch owner-bound y un fallo revierte también el contexto', async () => {
    const local = await database();
    await local.owned.insert(sportPerson).values({ id: 'persona', displayName: 'Sintética', nameNormalized: 'sintetica' });
    const batch = vi.spyOn(local.binding, 'batch');
    const candidate = {
      personId: 'persona',
      scheme: 'fie_addr_id',
      value: '70490',
      scopeSource: 'fie',
      scopeFederation: '',
      scopeSeason: '',
      scopeWeapon: '',
      validFrom: '1900-01-01',
      validTo: null,
      linkedVia: 'fie_resultados',
      evidence: 'prueba',
    };
    expect(await local.deps.guard.confirmar(candidate)).toBe(true);
    expect(batch).toHaveBeenCalledTimes(2); // one read batch, then one fenced mutation batch
    expect(batch.mock.calls.at(-1)![0].length).toBeGreaterThanOrEqual(3);
    expect(local.sqlite.prepare('SELECT person_id,link_status FROM sport_external_id').get())
      .toEqual({ person_id: 'persona', link_status: 'CONFIRMADO' });
    local.sqlite.exec(`CREATE TEMP TRIGGER fallo_identidad BEFORE INSERT ON sport_external_id
      BEGIN SELECT RAISE(ABORT, 'FALLO_SINTETICO'); END`);
    await expect(local.deps.guard.confirmar({ ...candidate, value: 'otro' })).rejects.toThrow('FALLO_SINTETICO');
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_external_id').get()!.n).toBe(1);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
    await local.lease!.liberar();
  });

  it('una lectura fallida no pisa las cifras de cobertura; una buena sí', async () => {
    const local = await database();
    const base = {
      season: '2027',
      factKind: 'ranking' as const,
      competitionKey: '1478',
      competitionId: local.competitionId,
      sourceUrl: 'u',
    };
    await local.deps.upsertCobertura({ ...base, status: 'completo', publishedTotal: 28, importedTotal: 28, lastError: null });
    await local.deps.upsertCobertura({ ...base, status: 'error', lastError: 'HTTP 503' });
    expect(local.sqlite.prepare('SELECT status,published_total,imported_total,attempts FROM sport_import_coverage').get())
      .toEqual({ status: 'error', published_total: 28, imported_total: 28, attempts: 2 });
    await local.deps.upsertCobertura({ ...base, status: 'completo', publishedTotal: 27, importedTotal: 27, lastError: null });
    expect(local.sqlite.prepare('SELECT status,published_total,imported_total,attempts FROM sport_import_coverage').get())
      .toEqual({ status: 'completo', published_total: 27, imported_total: 27, attempts: 3 });
    await local.lease!.liberar();
  });
});
