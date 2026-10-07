import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { limpiarRegistrosIngesta } from '@/lib/ingest/retencion';

const DIA = 86_400_000;
let local: ReturnType<typeof localD1>;
let db: ReturnType<typeof createD1Database>;
beforeEach(() => { local = localD1(); db = createD1Database(local.binding); });
afterEach(() => local.close());

const ahora = () => Number((local.sqlite.prepare("SELECT cast(round((julianday('now') - 2440587.5) * 86400000) as integer) AS t").get() as { t: number }).t);
function ejecucion(id: string, dias: number, o: { source?: string; status?: string; vistos?: number } = {}) {
  local.sqlite.prepare('INSERT INTO ingest_run (id, source, started_at, status, items_seen) VALUES (?, ?, ?, ?, ?)')
    .run(id, o.source ?? 'fie', ahora() - dias * DIA, o.status ?? 'error', o.vistos ?? 0);
}
function cuarentena(id: string, run: string, resueltaHaceDias: number | null) {
  local.sqlite.prepare(`INSERT INTO ingest_quarantine (id, ingest_run_id, source, raw_payload, validation_errors, resolved_at)
    VALUES (?, ?, 'fie', '{}', '[]', ?)`).run(id, run, resueltaHaceDias === null ? null : ahora() - resueltaHaceDias * DIA);
}
const ids = (tabla: string) => (local.sqlite.prepare(`SELECT id FROM ${tabla} ORDER BY id`).all() as { id: string }[]).map((r) => r.id);

describe('retención de ingest_run e ingest_quarantine', () => {
  it('borra la cuarentena resuelta antigua y las ejecuciones antiguas sin cuarentena, nunca lo pendiente', async () => {
    ejecucion('r-vieja', 200);
    ejecucion('r-vieja-pendiente', 199);
    ejecucion('r-vieja-resuelta-reciente', 198);
    ejecucion('r-vieja-resuelta-antigua', 197);
    ejecucion('r-reciente', 10);
    cuarentena('q-pendiente-antigua', 'r-vieja-pendiente', null);
    cuarentena('q-resuelta-reciente', 'r-vieja-resuelta-reciente', 5);
    cuarentena('q-resuelta-antigua', 'r-vieja-resuelta-antigua', 31);
    cuarentena('q-resuelta-29', 'r-reciente', 29);

    expect(await limpiarRegistrosIngesta(db)).toEqual({ cuarentenaResuelta: 1, ejecuciones: 2 });
    expect(ids('ingest_quarantine')).toEqual(['q-pendiente-antigua', 'q-resuelta-29', 'q-resuelta-reciente']);
    // Ninguna cuarentena se borra en cascada: una ejecución con cuarentena se conserva.
    expect(ids('ingest_run')).toEqual(['r-reciente', 'r-vieja-pendiente', 'r-vieja-resuelta-reciente']);
    expect(await limpiarRegistrosIngesta(db)).toEqual({ cuarentenaResuelta: 0, ejecuciones: 0 });
  });

  it('conserva la última ejecución de cada fuente y su última lectura útil aunque sean antiguas', async () => {
    ejecucion('fie-1', 300, { status: 'ok', vistos: 5 });
    ejecucion('fie-2', 200, { status: 'ok', vistos: 3 });
    ejecucion('fie-3', 150, { status: 'ok', vistos: 0 });
    ejecucion('fie-4', 100, { status: 'error' });
    ejecucion('rank-1', 400, { source: 'skermo_ranking', status: 'ok', vistos: 9 });
    ejecucion('efc-1', 500, { source: 'efc', status: 'error' });
    ejecucion('efc-2', 120, { source: 'efc', status: 'error' });
    expect(await limpiarRegistrosIngesta(db)).toEqual({ cuarentenaResuelta: 0, ejecuciones: 3 });
    // fie-4: última de fie; fie-2: última `ok` con elementos; rank-1 y efc-2: últimas de su fuente.
    expect(ids('ingest_run')).toEqual(['efc-2', 'fie-2', 'fie-4', 'rank-1']);
  });

  it('respeta el tope por pasada y continúa en la siguiente', async () => {
    for (let i = 0; i < 7; i++) {
      ejecucion(`r-${i}`, 100 + i);
      ejecucion(`c-${i}`, 10);
      cuarentena(`q-${i}`, `c-${i}`, 40 + i);
    }
    ejecucion('r-ultima', 1);
    expect(await limpiarRegistrosIngesta(db, 3)).toEqual({ cuarentenaResuelta: 3, ejecuciones: 3 });
    expect(await limpiarRegistrosIngesta(db, 3)).toEqual({ cuarentenaResuelta: 3, ejecuciones: 3 });
    expect(await limpiarRegistrosIngesta(db, 3)).toEqual({ cuarentenaResuelta: 1, ejecuciones: 1 });
    expect(await limpiarRegistrosIngesta(db, 3)).toEqual({ cuarentenaResuelta: 0, ejecuciones: 0 });
    expect(ids('ingest_quarantine')).toEqual([]);
    expect(ids('ingest_run')).toHaveLength(8);
    expect(local.calls.every((c) => c.parameters <= 100 && !/sport_/.test(c.sql))).toBe(true);
  });

  it.each([0, -1, 501, Number.NaN, 1.5])('rechaza límites no válidos: %s', async (limite) => {
    await expect(limpiarRegistrosIngesta(db, limite)).rejects.toThrow('no válido');
    expect(local.calls).toEqual([]);
  });
});
