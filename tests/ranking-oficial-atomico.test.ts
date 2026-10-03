import { afterEach, describe, expect, it } from 'vitest';
import { escribirPublicacion, MAX_RANKING_ENTRIES_D1 } from '@/lib/ingest/ranking-oficial-db';
import type { FilaEntradaRanking } from '@/lib/ingest/ranking-oficial-persist';
import type { PublicacionRanking } from '@/lib/ingest/sources/ranking-oficial-historico';
import { reclamarSportLease, dbConSportLease } from '@/lib/ingest/sport-incremental/lease';
import { leerRankingOficial } from '@/lib/sport/ranking-oficial-db';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const abiertos: ReturnType<typeof fixtureDeportivaD1>[] = [];
afterEach(() => { abiertos.splice(0).forEach((local) => local.close()); });
async function fixture() {
  const local = fixtureDeportivaD1();
  abiertos.push(local);
  const lease = (await reclamarSportLease(local.db))!;
  return { ...local, writer: dbConSportLease(local.db, lease) };
}
const pub = (total: number, publicadoEl = '2026-05-10'): PublicacionRanking => ({
  fuente: 'skermo_ranking', season: '2025-2026', arma: 'ESPADA', genero: 'M',
  categoria: 'M10', categoriaOriginal: 'M-10', formato: 'INDIVIDUAL', publicadoEl,
  url: 'https://app.skermo.org/fixture', total, entradas: [],
});
const fila = (n: number, personId: string | null = null): FilaEntradaRanking => ({
  sourceRef: `ref-${n}`, personId, sourceName: `Fixture ${n}`, countryCode: 'ESP', position: n, points: '10.000',
});
const filas = (n: number) => Array.from({ length: n }, (_, i) => fila(i + 1));
const UUID = '11111111-1111-4111-8111-111111111111';

describe('escritura atómica de una publicación oficial en D1', () => {
  it('guarda cabecera y todos los lotes con un UUID previo y hasta cien binds por sentencia', async () => {
    const local = await fixture();
    expect(await escribirPublicacion(local.writer, pub(120), filas(120), UUID))
      .toEqual({ estado: 'creada', publicationId: UUID, personasIncorporadas: 0 });
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_entry').get()!.n).toBe(120);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_publication').get()!.n).toBe(1);
    expect(local.calls.every((q) => q.parameters <= 100)).toBe(true);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
  });

  it('un fallo de un lote no deja cabecera, entradas ni contexto', async () => {
    const local = await fixture();
    local.sqlite.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON sport_ranking_entry WHEN NEW.source_ref='ref-12' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END");
    await expect(escribirPublicacion(local.writer, pub(30), filas(30), UUID)).rejects.toThrow();
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_publication').get()!.n).toBe(0);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_entry').get()!.n).toBe(0);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()!.n).toBe(0);
  });

  it('otra fecha de la temporada crea publicación sin tocar la anterior', async () => {
    const local = await fixture();
    await escribirPublicacion(local.writer, pub(3, '2026-05-03'), filas(3), UUID);
    const result = await escribirPublicacion(local.writer, pub(4), filas(4));
    expect(result.publicationId).not.toBe(UUID);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_publication').get()!.n).toBe(2);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_entry WHERE publication_id=?').get(UUID)!.n).toBe(3);
  });

  it('corrige el mismo día y retira obsoletas solo de esa publicación', async () => {
    const local = await fixture();
    await escribirPublicacion(local.writer, pub(3), filas(3), UUID);
    expect((await escribirPublicacion(local.writer, pub(2), [fila(1), fila(9)])).publicationId).toBe(UUID);
    expect(local.sqlite.prepare('SELECT source_ref FROM sport_ranking_entry WHERE publication_id=? ORDER BY source_ref').all(UUID))
      .toEqual([{ source_ref: 'ref-1' }, { source_ref: 'ref-9' }]);
    expect(local.sqlite.prepare('SELECT revision,published_total FROM sport_ranking_publication WHERE id=?').get(UUID))
      .toEqual({ revision: 2, published_total: 2 });
  });

  it('un fallo en una corrección conserva íntegramente el snapshot anterior', async () => {
    const local = await fixture();
    await escribirPublicacion(local.writer, pub(3), filas(3), UUID);
    const before = local.sqlite.prepare('SELECT * FROM sport_ranking_entry ORDER BY source_ref').all();
    local.sqlite.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON sport_ranking_entry WHEN NEW.source_ref='ref-9' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END");
    await expect(escribirPublicacion(local.writer, pub(2), [fila(1), fila(9)])).rejects.toThrow();
    expect(local.sqlite.prepare('SELECT * FROM sport_ranking_entry ORDER BY source_ref').all()).toEqual(before);
    expect(local.sqlite.prepare('SELECT revision FROM sport_ranking_publication WHERE id=?').get(UUID)!.revision).toBe(1);
  });

  it('la repetición idéntica no crea evolución y solo adjunta una persona confirmada', async () => {
    const local = await fixture();
    await escribirPublicacion(local.writer, pub(2), filas(2), UUID);
    expect(await escribirPublicacion(local.writer, pub(2), filas(2))).toMatchObject({ estado: 'sin_cambios', publicationId: UUID });
    await local.writer.execute((await import('drizzle-orm')).sql`INSERT INTO sport_person(id,display_name,name_normalized) VALUES('persona','Fixture','fixture')`);
    const result = await escribirPublicacion(local.writer, pub(2), [fila(1, 'persona'), fila(2)]);
    expect(result.personasIncorporadas).toBe(1);
    expect(local.sqlite.prepare('SELECT revision FROM sport_ranking_publication WHERE id=?').get(UUID)!.revision).toBe(1);
  });

  it('rechaza publicaciones mayores del límite atómico sin truncar ni crear cabecera', async () => {
    const local = await fixture();
    await expect(escribirPublicacion(local.writer, pub(MAX_RANKING_ENTRIES_D1 + 1), filas(MAX_RANKING_ENTRIES_D1 + 1)))
      .rejects.toThrow('shape_invalid');
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_ranking_publication').get()!.n).toBe(0);
  });
});

describe('lectura de un snapshot oficial en D1 real', () => {
  const filtro = { source: 'skermo_ranking', season: '2025-2026', weapon: 'ESPADA', gender: 'M' };
  it('lee cabecera y filas de una sola sentencia y una temporada exacta', async () => {
    const local = await fixture();
    await escribirPublicacion(local.writer, pub(3), filas(3), UUID);
    const before = local.calls.length;
    const result = await leerRankingOficial(local.db, filtro);
    expect(local.calls.length - before).toBe(1);
    expect(result?.publicacion).toMatchObject({ id: UUID, season: '2025-2026', format: 'INDIVIDUAL', category: 'M10' });
    expect(result?.publicacion).not.toHaveProperty('filas');
    expect(result?.filas.map((f) => f.sourceRef)).toEqual(['ref-1', 'ref-2', 'ref-3']);
    expect(await leerRankingOficial(local.db, { ...filtro, season: '2099-2100' })).toBeNull();
  });

  it('separa equipos y categoría literal y acota la página sin mezclar modalidades', async () => {
    const local = await fixture();
    await escribirPublicacion(local.writer, pub(3), filas(3), UUID);
    await escribirPublicacion(local.writer, { ...pub(1), formato: 'EQUIPOS' }, filas(1));
    const result = await leerRankingOficial(local.db, { ...filtro, format: 'EQUIPOS', categoryRaw: 'M-10', hasta: '2026-06-01' }, { limite: 9999, desde: 20 });
    expect(result?.publicacion.format).toBe('EQUIPOS');
    expect(result?.filas).toEqual([]);
    expect(await leerRankingOficial(local.db, { ...filtro, categoryRaw: 'otra' })).toBeNull();
  });
});
