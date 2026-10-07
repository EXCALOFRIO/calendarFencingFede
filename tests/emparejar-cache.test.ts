import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Emparejar escribe `result` y `athlete`, que no son sport_*: sin invalidar a
 * mano, las fichas y los rankings cacheados seguirían sirviendo lo de antes.
 */
const estado = vi.hoisted(() => ({
  lecturas: [] as unknown[][],
  actualizadas: [] as { id: string }[],
  falloLicencia: false,
}));

vi.mock('@/db', () => {
  const update = () => ({
    set: (valores: Record<string, unknown>) => ({
      where: () => {
        if (estado.falloLicencia && 'rfeeLicense' in valores) return Promise.reject(new Error('UNIQUE'));
        return Object.assign(Promise.resolve(), { returning: async () => estado.actualizadas });
      },
    }),
  });
  const select = () => ({ from: () => ({ where: () => ({ limit: async () => estado.lecturas.shift() ?? [] }) }) });
  return { db: { select, update } };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireWritableRole: vi.fn(async () => ({ profileId: 'admin', role: 'admin' })) }));
const cache = vi.hoisted(() => ({ invalidarCacheSinFallar: vi.fn(async () => {}) }));
vi.mock('@/lib/cache', () => cache);

const { asignarResultado, asignarTodosConEseNombre, desasignarResultado } = await import('@/app/(app)/admin/emparejar/actions');

const DEPS = ['deporte', 'ranking', 'ranking-fie'];

beforeEach(() => {
  cache.invalidarCacheSinFallar.mockClear();
  estado.lecturas = [];
  estado.actualizadas = [];
  estado.falloLicencia = false;
});

function conResultadoYTirador() {
  estado.lecturas = [
    [{ id: 'r1', sourceLicense: 'L-1', sourceAthleteName: 'PEREZ Ana', athleteId: null }],
    [{ id: 'a1', firstName: 'Ana', lastName: 'Pérez', rfeeLicense: null }],
  ];
}

describe('emparejar invalida la caché compartida tras escribir', () => {
  it('asignar un resultado (con o sin licencia) invalida deporte y rankings', async () => {
    conResultadoYTirador();
    expect(await asignarResultado('r1', 'a1', { guardarLicencia: true })).toMatchObject({ ok: true });
    expect(cache.invalidarCacheSinFallar).toHaveBeenCalledExactlyOnceWith(DEPS, 'emparejar');
  });

  it('si la licencia choca, el resultado ya está asignado y también invalida', async () => {
    conResultadoYTirador();
    estado.falloLicencia = true;
    expect(await asignarResultado('r1', 'a1', { guardarLicencia: true })).toMatchObject({ ok: true });
    expect(cache.invalidarCacheSinFallar).toHaveBeenCalledExactlyOnceWith(DEPS, 'emparejar');
  });

  it('si el resultado o el tirador no existen no escribe ni invalida', async () => {
    expect(await asignarResultado('r1', 'a1')).toMatchObject({ ok: false });
    expect(cache.invalidarCacheSinFallar).not.toHaveBeenCalled();
  });

  it('asignar todos invalida solo si ha cambiado alguna fila; desasignar, siempre', async () => {
    await asignarTodosConEseNombre('PEREZ Ana', 'a1');
    expect(cache.invalidarCacheSinFallar).not.toHaveBeenCalled();
    estado.actualizadas = [{ id: 'r1' }, { id: 'r2' }];
    await asignarTodosConEseNombre('PEREZ Ana', 'a1');
    expect(cache.invalidarCacheSinFallar).toHaveBeenCalledWith(DEPS, 'emparejar');
    cache.invalidarCacheSinFallar.mockClear();
    await desasignarResultado('r1');
    expect(cache.invalidarCacheSinFallar).toHaveBeenCalledExactlyOnceWith(DEPS, 'emparejar');
  });
});
