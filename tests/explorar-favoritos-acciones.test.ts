import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UUID_A, crearContexto, perfil, personaSimple } from './helpers/explorar';

/**
 * Las acciones de favoritos son endpoints invocables por cualquiera: delegan en
 * funciones que exigen sesión vigente antes de validar o escribir. Contexto
 * controlado, sin Neon ni sesión real.
 */

const actual = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: () => actual.ctx }));

import {
  consultarFavoritoAccion,
  guardarFavoritoAccion,
  listarFavoritosAccion,
  quitarFavoritoAccion,
} from '@/app/(app)/explorar/favoritos-acciones';

const acciones: [string, (e: unknown) => Promise<unknown>, unknown][] = [
  ['guardarFavoritoAccion', guardarFavoritoAccion, { personaId: UUID_A }],
  ['quitarFavoritoAccion', quitarFavoritoAccion, { personaId: UUID_A }],
  ['consultarFavoritoAccion', consultarFavoritoAccion, { personaId: UUID_A }],
  ['listarFavoritosAccion', listarFavoritosAccion, {}],
];

describe('acciones de favoritos', () => {
  beforeEach(() => {
    actual.ctx = null;
  });

  it.each(acciones)('%s sin sesión o revocado no consulta ni escribe', async (_n, accion, entrada) => {
    const { ctx, sentencias } = crearContexto({ perfil: null });
    actual.ctx = ctx;
    await expect(accion(entrada)).rejects.toThrow('NO_AUTENTICADO');
    expect(sentencias).toHaveLength(0);
  });

  it('guardar y quitar usan la cuenta de la sesión, no una cuenta recibida', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    actual.ctx = ctx;
    const ajena = '00000000-0000-4000-8000-0000000000b2';
    expect(await guardarFavoritoAccion({ personaId: UUID_A, profileId: ajena })).toEqual({
      estado: 'entrada_invalida',
    });
    expect(sentencias).toHaveLength(0);

    await guardarFavoritoAccion({ personaId: UUID_A });
    await quitarFavoritoAccion({ personaId: UUID_A });
    const escritas = sentencias.filter((s) => /^\s*(INSERT|DELETE)/i.test(s.text));
    expect(escritas).toHaveLength(2);
    for (const s of escritas) {
      expect(s.params[0]).toBe(perfil().profileId);
      expect(s.params).not.toContain(ajena);
    }
  });
});
