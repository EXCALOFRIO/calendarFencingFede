import { describe, expect, it, vi } from 'vitest';
import { alternarFavorito } from '@/lib/sport/explorar/favorito-alternar';
import type { ResultadoFavorito } from '@/lib/sport/explorar/favoritos';
import { UUID_A } from './helpers/explorar';

/**
 * Decisión pura del control Guardar/Quitar: dado el estado visible y lo que
 * responden las acciones, qué estado y qué mensaje se muestran. El componente
 * sólo pinta este resultado, así que aquí se prueba el comportamiento sin DOM.
 */

const ok = (favorito: boolean): ResultadoFavorito => ({ estado: 'ok', personaId: UUID_A, favorito });

function acciones(
  guardar: (e: unknown) => Promise<ResultadoFavorito> = async () => ok(true),
  quitar: (e: unknown) => Promise<ResultadoFavorito> = async () => ok(false),
) {
  return { guardar: vi.fn(guardar), quitar: vi.fn(quitar) };
}

describe('alternarFavorito', () => {
  it('sin guardar → guarda con sólo el ID de la persona y queda Favorito', async () => {
    const a = acciones();
    const r = await alternarFavorito(UUID_A, false, a);
    expect(a.guardar).toHaveBeenCalledExactlyOnceWith({ personaId: UUID_A });
    expect(a.quitar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ favorito: true, resultado: 'guardado' });
  });

  it('Favorito → quita y queda Sin guardar', async () => {
    const a = acciones();
    const r = await alternarFavorito(UUID_A, true, a);
    expect(a.quitar).toHaveBeenCalledExactlyOnceWith({ personaId: UUID_A });
    expect(a.guardar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ favorito: false, resultado: 'quitado' });
  });

  it('doble guardado: la segunda respuesta idempotente sigue siendo Favorito sin error', async () => {
    const a = acciones();
    const primero = await alternarFavorito(UUID_A, false, a);
    const segundo = await alternarFavorito(UUID_A, false, a);
    expect(primero.favorito).toBe(true);
    expect(segundo).toMatchObject({ favorito: true, resultado: 'guardado' });
    expect(a.guardar).toHaveBeenCalledTimes(2);
  });

  it('doble quitado: quitar lo ya quitado queda Sin guardar sin error', async () => {
    const a = acciones();
    const r = await alternarFavorito(UUID_A, true, a);
    const otra = await alternarFavorito(UUID_A, true, a);
    expect(r.favorito).toBe(false);
    expect(otra).toMatchObject({ favorito: false, resultado: 'quitado' });
  });

  it('el estado final es el que devuelve el servidor, no el pedido', async () => {
    const a = acciones(async () => ok(true), async () => ok(true));
    const r = await alternarFavorito(UUID_A, true, a);
    expect(r.favorito).toBe(true);
  });

  it('si la acción lanza (sesión caducada, red) vuelve al estado previo y es recuperable', async () => {
    const guardar = acciones(async () => {
      throw new Error('NO_AUTENTICADO');
    });
    const r = await alternarFavorito(UUID_A, false, guardar);
    expect(r.favorito).toBe(false);
    expect(r.resultado).toBe('error');
    expect(r.mensaje).toMatch(/inténtalo de nuevo/i);

    const quitar = acciones(undefined, async () => {
      throw new Error('red');
    });
    const q = await alternarFavorito(UUID_A, true, quitar);
    expect(q).toMatchObject({ favorito: true, resultado: 'error' });
  });

  it.each([
    ['entrada_invalida' as const],
    ['no_encontrada' as const],
    ['no_disponible' as const],
  ])('respuesta %s no cambia el estado visible y se explica', async (estado) => {
    const a = acciones(async () => ({ estado }));
    const r = await alternarFavorito(UUID_A, false, a);
    expect(r).toMatchObject({ favorito: false, resultado: 'error' });
    expect(r.mensaje.length).toBeGreaterThan(10);
  });

  it('no_disponible dice que Favoritos aún no está activo, sin culpar a la persona', async () => {
    const r = await alternarFavorito(UUID_A, false, acciones(async () => ({ estado: 'no_disponible' })));
    expect(r.mensaje).toMatch(/aún no está activ/i);
  });

  it('ningún mensaje promete avisos, notificaciones ni seguimiento social', async () => {
    const a = acciones();
    const mensajes = [
      (await alternarFavorito(UUID_A, false, a)).mensaje,
      (await alternarFavorito(UUID_A, true, a)).mensaje,
      (await alternarFavorito(UUID_A, false, acciones(async () => ({ estado: 'no_encontrada' })))).mensaje,
      (await alternarFavorito(UUID_A, false, acciones(async () => ({ estado: 'no_disponible' })))).mensaje,
      (await alternarFavorito(UUID_A, false, acciones(async () => {
        throw new Error('x');
      }))).mensaje,
    ];
    for (const m of mensajes) {
      expect(m).not.toMatch(/te avis|recibir|notificar|notificaci(o|ó)n(es)? (de|cuando)|siguiendo|seguir a|suscri/i);
    }
  });
});
