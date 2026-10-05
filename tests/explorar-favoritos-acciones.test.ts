import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UUID_A, crearContexto, perfil, personaSimple } from './helpers/explorar';

/**
 * Las acciones de favoritos son endpoints invocables por cualquiera: delegan en
 * funciones que exigen sesión vigente antes de validar o escribir. Contexto
 * controlado, sin Neon ni sesión real.
 */

const actual = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: () => actual.ctx }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

  it('doble guardado: dos acciones seguidas emiten la misma escritura idempotente de la propia cuenta', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    actual.ctx = ctx;
    expect(await guardarFavoritoAccion({ personaId: UUID_A })).toMatchObject({ estado: 'ok', favorito: true });
    expect(await guardarFavoritoAccion({ personaId: UUID_A })).toMatchObject({ estado: 'ok', favorito: true });
    const inserciones = sentencias.filter((s) => /^\s*INSERT/i.test(s.text));
    expect(inserciones).toHaveLength(2);
    for (const s of inserciones) {
      expect(s.text).toMatch(/ON CONFLICT \(profile_id, person_id\)/);
      expect(s.params[0]).toBe(perfil().profileId);
    }
    expect(inserciones[0].params).toEqual(inserciones[1].params);
  });

  it('un ID de cuenta o de relación ajena no se acepta: ni escribe ni lee', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    actual.ctx = ctx;
    const ajena = '00000000-0000-4000-8000-0000000000b2';
    for (const accion of [guardarFavoritoAccion, quitarFavoritoAccion, consultarFavoritoAccion]) {
      for (const entrada of [
        { personaId: UUID_A, profileId: ajena },
        { personaId: UUID_A, userProfileId: ajena },
        { personaId: UUID_A, favoritoId: ajena },
        { id: ajena },
      ]) {
        expect(await accion(entrada)).toEqual({ estado: 'entrada_invalida' });
      }
    }
    expect(sentencias).toHaveLength(0);
  });

  it('guardar o quitar con éxito invalida la lista para que Atrás no la devuelva obsoleta', async () => {
    const { ctx } = crearContexto({ respuestas: personaSimple(UUID_A) });
    actual.ctx = ctx;
    vi.mocked(revalidatePath).mockClear();
    await guardarFavoritoAccion({ personaId: UUID_A });
    await quitarFavoritoAccion({ personaId: UUID_A });
    // Seguir es el mismo favorito: también caducan el feed y el «Siguiendo N» de Explorar.
    const tanda = [['/explorar/favoritos'], ['/explorar/siguiendo'], ['/explorar']];
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([...tanda, ...tanda]);
  });

  it('un cambio que no se hizo (entrada inválida, persona inexistente, sin sesión) no invalida nada', async () => {
    vi.mocked(revalidatePath).mockClear();
    const sinPersona = crearContexto({ respuestas: [] });
    actual.ctx = sinPersona.ctx;
    expect(await guardarFavoritoAccion({ personaId: UUID_A })).toEqual({ estado: 'no_encontrada' });
    expect(await quitarFavoritoAccion('basura')).toEqual({ estado: 'entrada_invalida' });
    actual.ctx = crearContexto({ perfil: null }).ctx;
    await expect(guardarFavoritoAccion({ personaId: UUID_A })).rejects.toThrow('NO_AUTENTICADO');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('guardar y quitar no emiten nada de avisos: sólo la relación propia', async () => {
    const { ctx, sentencias } = crearContexto({ respuestas: personaSimple(UUID_A) });
    actual.ctx = ctx;
    await guardarFavoritoAccion({ personaId: UUID_A });
    await quitarFavoritoAccion({ personaId: UUID_A });
    for (const s of sentencias.filter((x) => /^\s*(INSERT|DELETE|UPDATE)/i.test(x.text))) {
      expect(s.text).toMatch(/sport_favorite/);
      expect(s.text).not.toMatch(/notif|push|email|alert|subscription/i);
    }
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
