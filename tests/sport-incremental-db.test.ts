import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { PresupuestoIncremento, type Task } from '@/lib/ingest/sport-incremental/policy';
import { crearDepsIncrementoDb } from '@/lib/ingest/sport-incremental/db';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const abiertos: { close(): void }[] = [];
function database(fenced = true) {
  const local = fenced ? fixtureDeportivaD1() : (() => {
    const local = localD1();
    return { ...local, db: createD1Database(local.binding) };
  })();
  abiertos.push(local);
  return local;
}
const task: Task = {
  key: 'fie_result|2027|1478', season: '2027', kind: 'fie_result',
  payload: { competitionId: 1478, date: '2026-09-01' },
};
function sourceFixture() {
  const f = JSON.parse(readFileSync(new URL('./fixtures/fie-resultados/bogota-2027-1478.json', import.meta.url), 'utf8'));
  const responses = f.respuestas as Record<string, Record<string, unknown>>;
  const metadata = responses['https://fie.org/api/fie/competition/2027/1478'];
  const one = responses['https://fie.org/api/fie/competition/2027/1478/results/ranking?page=1&pageSize=24'];
  const two = responses['https://fie.org/api/fie/competition/2027/1478/results/ranking?page=2&pageSize=24'];
  return {
    metadata: { ...metadata, startDate: '2026-09-01', endDate: '2026-09-02' },
    ranking: { ...one, totalFound: Number(one.totalFound), pageSize: 200, items: [...one.items as unknown[], ...two.items as unknown[]] },
  };
}
function mockFie(f = sourceFixture()) {
  const source = vi.fn<typeof fetch>(async (input) => Response.json(
    String(input).includes('/results/ranking') ? f.ranking : f.metadata));
  vi.stubGlobal('fetch', source);
  return source;
}
afterEach(() => {
  abiertos.splice(0).forEach((local) => local.close());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('composición incremental con D1 real y fuentes simuladas', () => {
  it('falla antes de reclamar o sembrar si faltan guardias nativas', async () => {
    const local = database(false);
    const deps = crearDepsIncrementoDb(local.db, new PresupuestoIncremento());
    await expect(deps.claim()).rejects.toThrow('sport_migration_required');
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_write_lease').get()!.n).toBe(0);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_incremental_task').get()!.n).toBe(0);
  });

  it('siembra solo índices y rankings de las temporadas dadas, sin reiniciar checkpoints', async () => {
    const local = database();
    const deps = crearDepsIncrementoDb(local.db, new PresupuestoIncremento());
    const lease = await deps.claim();
    await deps.seed({ fie: '2027', rfee: '2026-2027' });
    const rows = local.sqlite.prepare('SELECT key,season FROM sport_incremental_task').all();
    expect(rows.some((row) => row.key === 'fie_index|2027|')).toBe(true);
    expect(rows.some((row) => row.key === 'rfee_index|2026-2027|')).toBe(true);
    expect(rows.filter((row) => String(row.key).startsWith('fie_standing|'))).toHaveLength(48);
    expect(rows.every((row) => ['2027', '2026-2027'].includes(String(row.season)))).toBe(true);
    const index: Task = {
      key: 'fie_index|2027|', season: '2027', kind: 'fie_index', payload: { page: 1 },
    };
    for (let i = 0; i < 7; i++) {
      await deps.finish(index, { status: 'pendiente', facts: 0, payload: { page: 3 } },
        new Date('2028-01-01T00:00:00Z'));
    }
    const checkpoint = local.sqlite.prepare(
      "SELECT attempts,payload,next_check_at FROM sport_incremental_task WHERE key='fie_index|2027|'").get();
    await deps.seed({ fie: '2027', rfee: '2026-2027' });
    expect(local.sqlite.prepare(
      "SELECT attempts,payload,next_check_at FROM sport_incremental_task WHERE key='fie_index|2027|'").get()).toEqual(checkpoint);
    expect(checkpoint).toMatchObject({ attempts: 7, payload: '{"page":3}' });
    await lease!.release();
  });

  it('lee finales completos, no pide poules/cuadro y no crea identidades por nombre', async () => {
    const source = mockFie();
    const local = database(), budget = new PresupuestoIncremento();
    const deps = crearDepsIncrementoDb(local.db, budget), lease = await deps.claim();
    expect((await deps.execute(task, budget)).facts).toBe(28);
    expect(source).toHaveBeenCalledTimes(2);
    expect(source.mock.calls.some(([url]) => /pools|tableau/.test(String(url)))).toBe(false);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_result').get()!.n).toBe(28);
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_person').get()!.n).toBe(0);
    const correction = local.calls.find((q) => /^delete from "sport_result"/i.test(q.sql))!;
    expect(correction.sql).toContain('"source"');
    expect(correction.sql).toContain('"competition_id"');
    expect(correction.sql).toContain('json_each');
    expect(correction.parameters).toBe(3);
    await lease!.release();
  });

  it('descubre solo RFEE y deduplica los PDF nacionales compartidos', async () => {
    const seasons = '<select name="season"><option value="17" selected>2026-2027</option></select>';
    const html = `${seasons}<table class="table"><thead><tr>
      <th>Fecha</th><th>Competición</th><th>Arma</th><th>Género</th><th>Categoría</th><th>Tipo</th><th>Lugar</th><th>Documento</th>
      </tr></thead><tbody>${[1, 2].map((id) => `<tr>
        <td>01/10/2026</td><td>Prueba ${id}</td><td>Espada</td><td>Masculino</td><td>ABS</td>
        <td>Individual</td><td>Madrid</td><td><a href="/ranking/public/RFEE/competition/${id}">HTML</a>
        <a href="/client/shared.pdf">PDF</a></td></tr>`).join('')}</tbody></table>`;
    const form = `${seasons}<select name="category"><option value="13">ABS</option></select>`;
    const source = vi.fn<typeof fetch>(async (input) => new Response(String(input).includes('/calendar/') ? html : form));
    vi.stubGlobal('fetch', source);
    const local = database(), budget = new PresupuestoIncremento();
    const deps = crearDepsIncrementoDb(local.db, budget), lease = await deps.claim();
    expect((await deps.execute({
      key: 'rfee_index|2026-2027|', season: '2026-2027', kind: 'rfee_index', payload: { offset: 0 },
    }, budget)).status).toBe('completo');
    expect(source).toHaveBeenCalledTimes(2);
    for (const [url] of source.mock.calls) {
      expect(String(url)).toContain('/RFEE');
      expect(String(url)).not.toContain('owa=1');
    }
    const rows = local.sqlite.prepare('SELECT key FROM sport_incremental_task').all();
    expect(rows.filter((row) => String(row.key).startsWith('rfee_result|'))).toHaveLength(2);
    expect(rows.filter((row) => String(row.key).startsWith('rfee_pdf|'))).toHaveLength(1);
    expect(rows.filter((row) => String(row.key).startsWith('rfee_standing|'))).toHaveLength(6);
    await lease!.release();
  });

  it('no importa una clasificación multipágina incompleta', async () => {
    const f = sourceFixture();
    mockFie({ ...f, ranking: { ...f.ranking, totalFound: 700 } });
    const local = database(), budget = new PresupuestoIncremento();
    const deps = crearDepsIncrementoDb(local.db, budget), lease = await deps.claim();
    expect(await deps.execute(task, budget)).toEqual({ status: 'parcial', facts: 0 });
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_result').get()!.n).toBe(0);
    await lease!.release();
  });

  it('conserva hechos y conteos publicados si una respuesta posterior queda vacía', async () => {
    mockFie();
    const local = database(), firstBudget = new PresupuestoIncremento();
    const first = crearDepsIncrementoDb(local.db, firstBudget), firstLease = await first.claim();
    await first.execute(task, firstBudget);
    await firstLease!.release();
    const f = sourceFixture();
    mockFie({ ...f, ranking: { ...f.ranking, totalFound: 0, items: [] } });
    const budget = new PresupuestoIncremento();
    const deps = crearDepsIncrementoDb(local.db, budget), lease = await deps.claim();
    expect(await deps.execute(task, budget)).toEqual({ status: 'conflicto', facts: 0 });
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_result').get()!.n).toBe(28);
    expect(local.sqlite.prepare("SELECT status,imported_total FROM sport_import_coverage WHERE fact_kind='ranking'").get())
      .toMatchObject({ status: 'conflicto', imported_total: 28 });
    await lease!.release();
  });

  it('no trata un evento de hoy como finalizado', async () => {
    const f = sourceFixture(), today = new Date().toISOString().slice(0, 10);
    mockFie({ ...f, metadata: { ...f.metadata, endDate: today } });
    const local = database(), budget = new PresupuestoIncremento();
    const deps = crearDepsIncrementoDb(local.db, budget), lease = await deps.claim();
    expect(await deps.execute(task, budget)).toEqual({ status: 'pendiente', facts: 0 });
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_result').get()!.n).toBe(0);
    await lease!.release();
  });

  it('una asignación insuficiente detiene antes de cualquier escritura de resultados', async () => {
    mockFie();
    const local = database(), budget = new PresupuestoIncremento();
    const deps = crearDepsIncrementoDb(local.db, budget), lease = await deps.claim();
    vi.stubEnv('D1_STORAGE_BUDGET_BYTES', String(await local.db.storageSize()));
    await expect(deps.execute(task, budget)).rejects.toMatchObject({ reason: 'capacidad' });
    expect(local.sqlite.prepare('SELECT count(*) AS n FROM sport_result').get()!.n).toBe(0);
    await lease!.release();
  });
});
