import { describe, expect, it, vi } from 'vitest';

/**
 * El año de nacimiento del ranking oficial RFEE se oculta en el servidor para
 * posibles menores y en las categorías de menores. `@/db` es una cadena que
 * devuelve, en orden, lo que haya en la cola.
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

vi.mock('@/db', () => ({ db: { select: () => h.cadena, selectDistinct: () => h.cadena } }));

import {
  anioNacimientoVisible,
  fichaFieVisible,
  getClasificacionFie,
  getRankingOficialScreenData,
} from '@/lib/queries/ranking';

const HOY = '2026-10-03';

describe('anioNacimientoVisible', () => {
  it('adulto en absoluto: se enseña', () => {
    expect(anioNacimientoVisible('1990-05-01', 'ABS', HOY)).toBe(1990);
    expect(anioNacimientoVisible('2007-01-01', 'M23', HOY)).toBe(2007);
  });

  it('posible menor por el año (cumple 18 o menos este año): nunca', () => {
    expect(anioNacimientoVisible('2008-12-31', 'ABS', HOY)).toBeNull();
    expect(anioNacimientoVisible('2012-01-01', 'VET', HOY)).toBeNull();
  });

  it.each(['M7', 'M9', 'M11', 'M13', 'M14', 'M15', 'M17', 'M20'])('categoría de menores %s: nunca, aunque sea adulto', (cat) => {
    expect(anioNacimientoVisible('2005-01-01', cat, HOY)).toBeNull();
  });

  it('sin fecha: null', () => {
    expect(anioNacimientoVisible(null, 'ABS', HOY)).toBeNull();
  });
});

describe('enlace a la ficha FIE en la clasificación mundial', () => {
  it('nunca en M17 ni M20, ni para quien pueda ser menor o no tenga fecha; sí para adultos', () => {
    expect(fichaFieVisible('M17', null, HOY)).toBe(false);
    expect(fichaFieVisible('M20', '1990-01-01', HOY)).toBe(false);
    expect(fichaFieVisible('ABS', '2009-01-01', HOY)).toBe(false);
    expect(fichaFieVisible('ABS', '1990-01-01', HOY)).toBe(true);
    // Sin fecha no se puede descartar que sea menor.
    expect(fichaFieVisible('ABS', null, HOY)).toBe(false);
    expect(fichaFieVisible('ABS', '', HOY)).toBe(false);
  });

  it('getClasificacionFie anula fichaUrl en el servidor', async () => {
    const fila = (fieId: number, nacimiento: string | null) => ({
      fieId, position: fieId, nombre: 'X', pais: 'ESP', paisNombre: 'España', points: '1', eventCount: 1,
      sourceUrl: null, updatedAt: new Date(), athleteId: null, nacimiento,
    });
    h.state.queue = [[{ season: 2027 }], [fila(1, null), fila(2, '2010-03-01'), fila(3, '1990-03-01')]];
    const abs = await getClasificacionFie({ format: 'INDIVIDUAL', weapon: 'ESPADA', gender: 'M', category: 'ABS', hoy: HOY });
    expect(abs?.rows.map((r) => r.fichaUrl === null)).toEqual([true, true, false]);
    h.state.queue = [[{ season: 2027 }], [fila(1, null), fila(3, '1990-03-01')]];
    const m20 = await getClasificacionFie({ format: 'INDIVIDUAL', weapon: 'ESPADA', gender: 'M', category: 'M20', hoy: HOY });
    expect(m20?.rows.map((r) => r.fichaUrl)).toEqual([null, null]);
  });
});

describe('getRankingOficialScreenData', () => {
  it('no manda al cliente el año de los menores ni el de las tablas de menores', async () => {
    const fila = (id: string, category: string, nacimiento: string) => ({
      id, seasonLabel: '2026-2027', weapon: 'ESPADA', gender: 'M', category, position: 1,
      totalPoints: '10', nombre: 'X', club: null, nacimiento, athleteId: null, sourceUrl: null, updatedAt: new Date(),
    });
    h.state.queue = [
      [{ id: 's1' }],
      [fila('a', 'ABS', '1990-01-01'), fila('b', 'ABS', '2009-01-01'), fila('c', 'M20', '2007-01-01')],
    ];
    const datos = await getRankingOficialScreenData(HOY);
    const filas = Object.values(datos.tables).flatMap((t) => t.rows);
    expect(Object.fromEntries(filas.map((r) => [r.id, r.anioNacimiento]))).toEqual({ a: 1990, b: null, c: null });
  });
});
