import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Calendarios de Skermo: una página idéntica a su última lectura completa no
 * se procesa, «sin cambios» se dice cuando es verdad y el snapshot no se
 * duplica. Sin base real: `@/db` es una cadena vacía y lo demás está sustituido.
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
  const stats = (parcial: Record<string, unknown> = {}) => ({
    created: 0, updated: 0, unchanged: 1, competitionsCreated: 0, competitionsUpdated: 0,
    registrationsSeen: 0, registrationsMatched: 0, registrationsWithdrawn: 0, registrationsChanged: 0,
    competitionCountsChanged: 0, deadlinesWritten: 0, deadlinesError: null, documentsInserted: 0,
    liveLinksWritten: 0, notificationsQueued: 0, changes: [], ...parcial,
  });
  return {
    vacia,
    stats,
    huellas: new Map<string, { huella: number | null; leida: Date | null }>(),
    paginas: new Map<string, string>(),
    upsert: vi.fn(async () => stats()),
    renovar: vi.fn(async () => {}),
    marcar: vi.fn(async () => 0),
    snapshot: vi.fn(async () => ({ url: 'https://r2/x.html.gz', pathname: 'x', backend: 'r2' })),
    enlaces: vi.fn(async () => ({ enlazados: 0, cartelesHeredados: 0, dudosos: 0, escrituras: 0 })),
    actualizaciones: [] as Record<string, unknown>[],
  };
});

vi.mock('@/db', () => ({
  db: {
    insert: () => h.vacia([{ id: 'run-1' }]),
    update: () => ({ set: (v: Record<string, unknown>) => { h.actualizaciones.push(v); return h.vacia([]); } }),
    select: () => h.vacia([]),
    selectDistinct: () => h.vacia([]),
    delete: () => h.vacia([]),
    execute: async () => ({ rows: [] }),
  },
}));
vi.mock('@/lib/ingest/fetcher', () => ({
  fetchText: async (url: string) => ({ body: h.paginas.get(new URL(url).searchParams.get('federacion') ?? url) ?? h.paginas.get('*') ?? '' }),
}));
vi.mock('@/lib/ingest/sources/skermo', async (original) => ({
  ...(await original<typeof import('@/lib/ingest/sources/skermo')>()),
  parseSkermoCalendar: () => ({ candidates: [], rowsSeen: 3 }),
}));
vi.mock('@/lib/ingest/sources/skermo-results', () => ({
  ingestSkermoResults: async () => ({
    itemsSeen: 0, itemsCreated: 0, itemsUpdated: 0, itemsUnchanged: 0, itemsQuarantined: 0,
    unmatchedAthletes: 0, competitionsFetched: 0, competitionsUnmatched: 0, documentosEnlazados: 0, directosEnlazados: 0, note: null,
  }),
}));
vi.mock('@/lib/ingest/directos', () => ({
  ingestDirectosEngarde: async () => ({ torneosMirados: 0, torneosListados: 0, peticiones: 0, enlaces: 0, escritos: 0, fallos: 0 }),
}));
vi.mock('@/lib/ingest/enlazar', () => ({ recalcularEnlaces: h.enlaces }));
vi.mock('@/lib/ingest/upsert', async (original) => ({
  ...(await original<typeof import('@/lib/ingest/upsert')>()),
  upsertEvents: h.upsert,
  markMissingEvents: h.marcar,
  renovarVistosSinCambios: h.renovar,
}));
vi.mock('@/lib/storage', () => ({ storeIngestSnapshot: h.snapshot }));
vi.mock('@/lib/cron/huellas', async (original) => ({
  ...(await original<typeof import('@/lib/cron/huellas')>()),
  leerHuellas: async (claves: readonly string[]) =>
    new Map(claves.flatMap((c) => (h.huellas.has(c) ? [[c, h.huellas.get(c)!]] : []))),
  guardarHuellas: async (entradas: { clave: string; huella: number }[], cuando: Date) => {
    for (const e of entradas) h.huellas.set(e.clave, { huella: e.huella, leida: cuando });
  },
}));

const { runIngest } = await import('@/lib/ingest/runner');

beforeEach(() => {
  h.huellas.clear();
  h.paginas.clear();
  h.paginas.set('*', '<html>calendario</html>');
  h.upsert.mockReset().mockResolvedValue(h.stats());
  h.renovar.mockClear();
  h.marcar.mockClear();
  h.snapshot.mockClear();
  h.enlaces.mockClear();
  h.actualizaciones.length = 0;
});

describe('calendario de Skermo con huella', () => {
  it('la segunda pasada con la misma página no procesa nada y dice «sin cambios»', async () => {
    const primera = await runIngest('skermo_rfee');
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(primera.sinCambios).toBe(true);
    const segunda = await runIngest('skermo_rfee');
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.renovar).toHaveBeenCalledWith('skermo_rfee', 'skermo-RFEE-', expect.any(Date));
    expect(segunda.sinCambios).toBe(true);
    expect(segunda.note).toMatch(/sin procesar \(RFEE\)/);
  });

  it('una página distinta, o forzar, se procesa entera', async () => {
    await runIngest('skermo_rfee');
    h.paginas.set('*', '<html>calendario nuevo</html>');
    await runIngest('skermo_rfee');
    expect(h.upsert).toHaveBeenCalledTimes(2);
    await runIngest('skermo_rfee', { forzar: true });
    expect(h.upsert).toHaveBeenCalledTimes(3);
  });

  it('un cambio visible en el guardado quita el «sin cambios»', async () => {
    h.upsert.mockResolvedValue(h.stats({ registrationsWithdrawn: 1 }));
    expect((await runIngest('skermo_rfee')).sinCambios).toBe(false);
  });

  it('el snapshot queda apuntado en ingest_run', async () => {
    await runIngest('skermo_rfee');
    expect(h.snapshot).toHaveBeenCalledTimes(1);
    const cierre = h.actualizaciones.find((v) => 'finishedAt' in v)!;
    expect(cierre).toMatchObject({ snapshotUrl: 'https://r2/x.html.gz', snapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('por cron, el emparejado solo corre tras la última fuente de calendario', async () => {
    await runIngest('skermo_rfee');
    expect(h.enlaces).not.toHaveBeenCalled();
    await runIngest('skermo_regional');
    expect(h.enlaces).toHaveBeenCalledTimes(1);
    await runIngest('skermo_rfee', { triggeredBy: 'admin:x@example.test' });
    expect(h.enlaces).toHaveBeenCalledTimes(2);
  });

  it('las desaparecidas se marcan por federación leída entera', async () => {
    h.upsert.mockImplementation(async () => h.stats());
    await runIngest('skermo_regional');
    // parseSkermoCalendar devuelve 0 eventos válidos: sin ids vistos no se marca nada.
    expect(h.marcar).not.toHaveBeenCalled();
  });
});
