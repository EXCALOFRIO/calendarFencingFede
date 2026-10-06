import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Qué temporada usa el motor olímpico en cada prueba. `@/db` devuelve, en
 * orden, lo que haya en la cola; sin tabla de lecturas (execute falla) la
 * fecha sale de `updated_at`.
 */
const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[][] };
  const cadena: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return (ok: (v: unknown) => unknown) => ok(state.queue.shift() ?? []);
        return () => cadena;
      },
    },
  );
  return { state, cadena };
});

vi.mock('@/db', () => ({
  db: {
    select: () => h.cadena,
    selectDistinct: () => h.cadena,
    execute: async () => {
      throw new Error('sin fie_clasificacion_lectura');
    },
  },
}));

import { elegirTemporadasOlimpicas, getEntradasOlimpicas } from '@/lib/queries/olimpica';

beforeEach(() => {
  h.state.queue = [];
});

describe('elegirTemporadasOlimpicas', () => {
  it('por prueba, la última temporada con individual Y selecciones', () => {
    const t = elegirTemporadasOlimpicas([
      { season: 2026, weapon: 'FLORETE', gender: 'M', format: 'INDIVIDUAL' },
      { season: 2026, weapon: 'FLORETE', gender: 'M', format: 'EQUIPOS' },
      // Cambio de temporada: el individual nuevo ya está, el de selecciones no.
      { season: 2027, weapon: 'FLORETE', gender: 'M', format: 'INDIVIDUAL' },
      { season: 2027, weapon: 'ESPADA', gender: 'F', format: 'INDIVIDUAL' },
      { season: 2027, weapon: 'ESPADA', gender: 'F', format: 'EQUIPOS' },
      // Sólo individual en todas sus temporadas: pendiente.
      { season: 2027, weapon: 'SABLE', gender: 'M', format: 'INDIVIDUAL' },
    ]);
    expect(Object.fromEntries(t)).toEqual({ 'FLORETE|M': 2026, 'ESPADA|F': 2027 });
  });
});

describe('getEntradasOlimpicas', () => {
  const fila = (season: number, format: string, extra: Record<string, unknown> = {}) => ({
    season, format, weapon: 'FLORETE', gender: 'M', fieId: 1, position: 1, points: '100',
    nombre: 'X', pais: 'ITA', updatedAt: new Date('2026-09-01T00:00:00Z'), ...extra,
  });

  it('no calcula con el individual nuevo y sin equipos: usa la temporada completa anterior', async () => {
    h.state.queue = [
      [
        { season: 2026, weapon: 'FLORETE', gender: 'M', format: 'INDIVIDUAL' },
        { season: 2026, weapon: 'FLORETE', gender: 'M', format: 'EQUIPOS' },
        { season: 2027, weapon: 'FLORETE', gender: 'M', format: 'INDIVIDUAL' },
      ],
      [fila(2026, 'EQUIPOS'), fila(2026, 'INDIVIDUAL'), fila(2027, 'INDIVIDUAL', { fieId: 2, pais: 'FRA' })],
    ];
    const r = await getEntradasOlimpicas({ arma: 'FLORETE', genero: 'M' });
    expect(r.season).toBe(2026);
    expect(r.pendientes).toEqual([]);
    expect(r.entradas).toHaveLength(1);
    expect(r.entradas[0].equipos).toHaveLength(1);
    expect(r.entradas[0].individual.map((i) => i.fieId)).toEqual([1]);
  });

  it('sin selecciones en ninguna temporada, la prueba sale pendiente y sin entrada', async () => {
    h.state.queue = [
      [{ season: 2027, weapon: 'SABLE', gender: 'F', format: 'INDIVIDUAL' }],
    ];
    const r = await getEntradasOlimpicas({ arma: 'SABLE', genero: 'F' });
    expect(r).toEqual({ season: null, entradas: [], pendientes: [{ arma: 'SABLE', genero: 'F' }] });
  });
});
