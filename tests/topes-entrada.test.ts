import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ requireWritableProfile: vi.fn(), consultas: 0 }));

vi.mock('@/db', () => ({
  db: new Proxy({}, {
    get() {
      h.consultas++;
      throw new Error('no debería consultar la base');
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  requireWritableProfile: h.requireWritableProfile,
  requireProfile: vi.fn(),
  getManagedAthletes: vi.fn(),
}));

import { transitionEntries } from '@/lib/entries/actions';
import { leerRelevosPerfilDe } from '@/lib/sport/explorar/relevos';

afterEach(() => { vi.restoreAllMocks(); h.consultas = 0; });

describe('transitionEntries: lote acotado', () => {
  it('rechaza más de 100 ids sin tocar la base', async () => {
    h.requireWritableProfile.mockResolvedValue({ profileId: 'p' });
    const ids = Array.from({ length: 101 }, (_, i) => `entrada-${i}`);
    const r = await transitionEntries(ids, 'club_approved');
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('100') });
    expect(h.consultas).toBe(0);
  });

  it.each([['no-es-lista'], [[1, 2]], [['x'.repeat(65)]], [null]])('rechaza una selección mal formada %j', async (ids) => {
    h.requireWritableProfile.mockResolvedValue({ profileId: 'p' });
    expect((await transitionEntries(ids as never, 'club_approved')).ok).toBe(false);
    expect(h.consultas).toBe(0);
  });

  it('exige sesión con escritura antes de validar', async () => {
    h.requireWritableProfile.mockRejectedValue(new Error('NO_AUTENTICADO'));
    await expect(transitionEntries([], 'club_approved')).rejects.toThrow('NO_AUTENTICADO');
  });
});

describe('relevos: el registro de errores no lleva SQL ni parámetros', () => {
  it('registra el tipo de error, no el mensaje', async () => {
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      execute: async () => {
        throw new RangeError("D1_ERROR: near 'SELECT': id IN ('persona-privada-1')");
      },
    };
    expect(await leerRelevosPerfilDe(db as never, ['persona-privada-1'])).toBeNull();
    expect(registro).toHaveBeenCalledOnce();
    const salida = JSON.stringify(registro.mock.calls);
    expect(salida).toContain('RangeError');
    expect(salida).not.toContain('persona-privada-1');
    expect(salida).not.toContain('SELECT');
  });
});
