import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cuándo el runner anota una lectura programada en `refresco_programado`.
 * Sin base real: `@/db` es una cadena que no devuelve nada, y las fuentes,
 * el guardado y las lecturas están sustituidos.
 */
const h = vi.hoisted(() => {
  const vacia = (valor: unknown): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop: string) {
        if (prop === 'then') return (ok: (v: unknown) => unknown) => ok(valor);
        return () => vacia(valor);
      },
      apply: () => vacia(valor),
    });
  return {
    vacia,
    ultimas: new Map<string, Date>(),
    anotar: vi.fn(async (_tarea: string, _claves: readonly string[], _cuando?: Date) => {}),
    upsert: vi.fn(async () => ({ created: 0, updated: 0, unchanged: 0, notifications: 0 })),
    fetchFie: vi.fn(),
    fetchEfc: vi.fn(),
    tiradores: vi.fn(),
  };
});

vi.mock('@/db', () => ({
  db: {
    insert: () => h.vacia([{ id: 'run-1' }]),
    update: () => h.vacia([]),
    select: () => h.vacia([]),
    selectDistinct: () => h.vacia([]),
    delete: () => h.vacia([]),
    execute: async () => ({ rows: [] }),
  },
}));
vi.mock('@/lib/cron/refresco', () => ({
  ultimasLecturas: async (tarea: string, claves: readonly string[]) =>
    new Map(claves.flatMap((c) => (h.ultimas.has(`${tarea}:${c}`) ? [[c, h.ultimas.get(`${tarea}:${c}`)!]] : []))),
  anotarLecturas: h.anotar,
}));
vi.mock('@/lib/ingest/upsert', async (original) => ({
  ...(await original<typeof import('@/lib/ingest/upsert')>()),
  upsertEvents: h.upsert,
  markMissingEvents: async () => 0,
}));
vi.mock('@/lib/ingest/enlazar', () => ({
  recalcularEnlaces: async () => ({ enlazados: 0, cartelesHeredados: 0, dudosos: 0 }),
}));
vi.mock('@/lib/ingest/sources/fie', async (original) => ({
  ...(await original<typeof import('@/lib/ingest/sources/fie')>()),
  fetchFieSeason: h.fetchFie,
}));
vi.mock('@/lib/ingest/sources/efc', () => ({ fetchEfcCalendar: h.fetchEfc }));
vi.mock('@/lib/ingest/sources/fie-tiradores', async (original) => ({
  ...(await original<typeof import('@/lib/ingest/sources/fie-tiradores')>()),
  ingestFieTiradores: h.tiradores,
}));

import { runIngest } from '@/lib/ingest/runner';

const tareas = () => h.anotar.mock.calls.map((c) => `${c[0]}:${c[1].join(',')}`);

beforeEach(() => {
  h.ultimas.clear();
  h.anotar.mockClear();
  h.upsert.mockReset().mockResolvedValue({ created: 0, updated: 0, unchanged: 0, notifications: 0 });
  h.fetchFie.mockReset().mockResolvedValue({ candidates: [], rowsSeen: 0, futuro: { leidos: [101, 102] } });
  h.fetchEfc.mockReset();
  h.tiradores.mockReset();
});

describe('FIE: los torneos sólo cuentan como leídos si se guardaron', () => {
  it('si el guardado falla, no se anota ninguna lectura', async () => {
    h.upsert.mockRejectedValue(new Error('D1 caída'));
    const r = await runIngest('fie');
    expect(r.status).toBe('error');
    expect(tareas()).not.toContain('fie_torneo:101,102');
  });

  it('con el guardado correcto, se anotan después de guardar', async () => {
    await runIngest('fie');
    const i = h.anotar.mock.calls.findIndex((c) => c[0] === 'fie_torneo');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(h.anotar.mock.invocationCallOrder[i]).toBeGreaterThan(h.upsert.mock.invocationCallOrder[0]);
  });
});

describe('clasificación mundial: sólo cuenta como leída si respondieron todas las combinaciones', () => {
  const stats = (pedidas: number, respondidas: number) => ({
    itemsSeen: 0, itemsCreated: 0, itemsUpdated: 0, itemsUnchanged: 0, itemsQuarantined: 0,
    peticiones: 0, enlazados: 1, porLicencia: 0, propuestos: 0,
    clasificacionPedidas: pedidas, clasificacionRespondidas: respondidas, note: null,
  });

  it.each([
    [48, 48, true],
    [48, 47, false],
    [48, 0, false],
    [0, 0, false],
  ])('%i pedidas, %i respondidas → anotada: %s', async (pedidas, respondidas, anotada) => {
    h.tiradores.mockResolvedValue(stats(pedidas, respondidas));
    const r = await runIngest('fie_tiradores', { forzar: true });
    expect(tareas().includes('fie_clasificacion:mundial')).toBe(anotada);
    if (!anotada && pedidas > 0) expect(r.note).toMatch(/incompleta/);
  });
});

describe('EFC: la semana de espera sólo tras una lectura fallida', () => {
  const fallo = { candidates: [], rowsSeen: 0, unavailableReason: 'HTTP 530' };
  const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

  it('tras un fallo reciente no se vuelve a pedir hasta pasados 7 días', async () => {
    h.ultimas.set('efc:calendario', hace(2));
    const r = await runIngest('efc');
    expect(h.fetchEfc).not.toHaveBeenCalled();
    expect(r.note).toMatch(/falló/);
    h.ultimas.set('efc:calendario', hace(8));
    h.fetchEfc.mockResolvedValue(fallo);
    await runIngest('efc');
    expect(h.fetchEfc).toHaveBeenCalledTimes(1);
    expect(tareas()).toContain('efc:calendario');
  });

  it('si la última lectura trajo filas, se lee cada noche', async () => {
    h.ultimas.set('efc:calendario', hace(30));
    h.ultimas.set('efc:calendario_ok', hace(1));
    h.fetchEfc.mockResolvedValue({ candidates: [], rowsSeen: 12, unavailableReason: null });
    await runIngest('efc');
    expect(h.fetchEfc).toHaveBeenCalledTimes(1);
    expect(tareas()).toEqual(['efc:calendario_ok']);
  });

  it('un fallo que lanza también cuenta como fallo', async () => {
    h.fetchEfc.mockRejectedValue(new Error('DNS'));
    const r = await runIngest('efc');
    expect(r.status).toBe('error');
    expect(tareas()).toEqual(['efc:calendario']);
  });
});
