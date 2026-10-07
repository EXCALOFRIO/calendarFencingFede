import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `getCurrentSeason` y `getDataFreshness` (el armazón de todas las pantallas)
 * van por la caché compartida. Aquí la caché es un registro de definiciones
 * que llama al cargador, y la base, una cadena de Drizzle de mentira.
 */
const h = vi.hoisted(() => ({
  definiciones: [] as { espacio: string; depende: readonly string[]; frescoMs: number; caducaMs: number; anteriorMientrasRevalida?: boolean; cargar: (...p: unknown[]) => Promise<unknown> }[],
  filas: [] as unknown[][],
}));

vi.mock('@/lib/cache', () => ({
  MINUTO: 60_000,
  DIA: 86_400_000,
  cacheCompartida: {
    definir: (d: (typeof h.definiciones)[number]) => {
      h.definiciones.push(d);
      return Object.assign((...p: unknown[]) => d.cargar(...p), { espacio: d.espacio });
    },
  },
}));

vi.mock('@/db', () => {
  const cadena = (): unknown => new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then'
      ? (ok: (v: unknown) => void, ko: (e: unknown) => void) => Promise.resolve(h.filas.shift() ?? []).then(ok, ko)
      : () => cadena()),
    apply: () => cadena(),
  });
  return { db: { select: () => cadena() } };
});

const { getCurrentSeason, getDataFreshness } = await import('../src/lib/queries/calendar');

afterEach(() => { h.filas.length = 0; vi.useRealTimers(); });

describe('armazón en la caché compartida', () => {
  it('temporada y frescura dependen de `calendario`; la temporada no sirve la anterior tras invalidar', () => {
    const temporada = h.definiciones.find((d) => d.espacio === 'temporada-actual')!;
    const frescura = h.definiciones.find((d) => d.espacio === 'calendario-frescura')!;
    expect(temporada.depende).toEqual(['calendario']);
    expect(temporada.anteriorMientrasRevalida).toBe(false);
    expect(frescura.depende).toEqual(['calendario']);
    expect(frescura.frescoMs).toBeLessThanOrEqual(10 * 60_000);
  });

  it('la frescura guarda la fecha y calcula la edad al leer', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 10, 12) });
    const vista = new Date(Date.UTC(2026, 9, 8, 6));
    h.filas.push([{ lastSeenAt: vista }]);
    const frescura = h.definiciones.find((d) => d.espacio === 'calendario-frescura')!;
    const guardado = await frescura.cargar();
    expect(guardado).toEqual(vista);
    h.filas.push([{ lastSeenAt: vista }]);
    expect(await getDataFreshness()).toEqual({ lastSeenAt: vista, ageHours: 54, stale: true });
    h.filas.push([]);
    expect(await getDataFreshness()).toEqual({ lastSeenAt: null, ageHours: null, stale: true });
  });

  it('la temporada sale con sus categorías, sin datos de cuenta', async () => {
    h.filas.push(
      [{ id: 's1', label: '2026-2027', startDate: '2026-09-01', endDate: '2027-08-31', current: true }],
      [{ id: 'c1', seasonId: 's1', code: 'M17', birthYearMin: 2010, birthYearMax: 2012, rank: 2, laddered: true }],
    );
    const t = await getCurrentSeason();
    expect(t).toMatchObject({ label: '2026-2027', categories: [{ code: 'M17', rank: 2 }] });
    h.filas.push([]);
    expect(await getCurrentSeason()).toBeNull();
  });
});
