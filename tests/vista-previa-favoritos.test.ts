import { describe, expect, it } from 'vitest';
import { consultarFavorito, guardarFavorito, listarFavoritos, quitarFavorito } from '@/lib/sport/explorar/favoritos';
import { crearContexto, perfil, personaSimple, UUID_A } from './helpers/explorar';

describe('favoritos en vista previa: lecturas sí, escrituras no', () => {
  it.each(['admin', 'coach', 'athlete'] as const)('%s no puede guardar ni quitar, tampoco por llamada directa', async (role) => {
    for (const accion of [guardarFavorito, quitarFavorito]) {
      const { ctx, sentencias } = crearContexto({
        perfil: perfil({ role, preview: { adminProfileId: 'admin', expiresAt: Date.now() + 1000 } }),
        respuestas: personaSimple(UUID_A),
      });
      await expect(accion(ctx, { personaId: UUID_A })).rejects.toMatchObject({
        digest: 'VISTA_PREVIA_SOLO_LECTURA',
      });
      expect(sentencias).toHaveLength(0);
    }
  });

  it('consultar y listar siguen funcionando, sin prohibir todos los POST de lectura', async () => {
    const { ctx, sentencias } = crearContexto({
      perfil: perfil({ preview: { adminProfileId: 'admin', expiresAt: Date.now() + 1000 } }),
      respuestas: personaSimple(UUID_A),
    });
    expect(await consultarFavorito(ctx, { personaId: UUID_A })).toMatchObject({ estado: 'ok' });
    expect(await listarFavoritos(ctx, {})).toMatchObject({ estado: 'ok' });
    expect(sentencias.length).toBeGreaterThan(0);
    expect(sentencias.every((s) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(s.text))).toBe(true);
  });
});
