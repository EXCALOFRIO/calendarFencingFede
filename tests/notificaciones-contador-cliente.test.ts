import { describe, expect, it, vi } from 'vitest';
import { crearContadorAvisos, INTERVALO_AVISOS_MS } from '@/components/notificaciones/contador-cliente';

describe('contador de avisos sin una consulta por pantalla', () => {
  it('usa el contador SSR, comparte dos campanas y no repite una lectura reciente', async () => {
    let ahora = 10;
    const obtener = vi.fn(async () => 4);
    const c = crearContadorAvisos({ obtener, ahora: () => ahora });
    const movil = vi.fn(); const escritorio = vi.fn();
    c.suscribir('a', { numero: 2, revision: 1 }, movil);
    c.suscribir('a', { numero: 2, revision: 1 }, escritorio);
    for (let n = 0; n < 20; n += 1) { ahora += 1_000; await c.refrescar(); }
    expect(obtener).not.toHaveBeenCalled();
    expect(movil).toHaveBeenLastCalledWith(2);
    ahora += INTERVALO_AVISOS_MS;
    await Promise.all([c.refrescar(), c.refrescar(), c.refrescar()]);
    expect(obtener).toHaveBeenCalledTimes(1);
    expect(movil).toHaveBeenLastCalledWith(4);
    expect(escritorio).toHaveBeenLastCalledWith(4);
  });

  it('una revalidación SSR puede volver a cero sin pedirlo otra vez', async () => {
    const obtener = vi.fn(async () => 3);
    const c = crearContadorAvisos({ obtener });
    const listener = vi.fn();
    c.suscribir('a', { numero: 0, revision: 1 }, listener);
    await c.refrescar(true);
    expect(listener).toHaveBeenLastCalledWith(3);
    c.lecturaServidor('a', { numero: 0, revision: 2 });
    expect(listener).toHaveBeenLastCalledWith(0);
    await c.refrescar();
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it('aborta al cambiar de cuenta y una respuesta antigua no llega a la nueva', async () => {
    let resolver!: (n: number) => void;
    let signal!: AbortSignal;
    const c = crearContadorAvisos({ obtener: (s) => { signal = s; return new Promise((r) => { resolver = r; }); } });
    const a = vi.fn(); const b = vi.fn();
    const quitar = c.suscribir('a', { numero: 5, revision: 1 }, a);
    const pedido = c.refrescar(true);
    quitar();
    expect(signal.aborted).toBe(true);
    c.suscribir('b', { numero: 0, revision: 2 }, b);
    resolver(99);
    await pedido;
    expect(b).toHaveBeenLastCalledWith(0);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('una lectura en vuelo no sobrescribe una revalidación más nueva', async () => {
    let resolver!: (n: number) => void;
    const c = crearContadorAvisos({ obtener: () => new Promise((r) => { resolver = r; }) });
    const listener = vi.fn();
    c.suscribir('a', { numero: 4, revision: 1 }, listener);
    const pedido = c.refrescar(true);
    c.lecturaServidor('a', { numero: 0, revision: 2 });
    resolver(4);
    await pedido;
    expect(listener).toHaveBeenLastCalledWith(0);
  });

  it('sólo consulta para la cuenta actual aunque quede una campana anterior montada', async () => {
    const obtener = vi.fn(async () => 7);
    const c = crearContadorAvisos({ obtener });
    const a = vi.fn(); const b = vi.fn();
    c.suscribir('a', { numero: 2, revision: 1 }, a);
    c.suscribir('b', { numero: 0, revision: 2 }, b);
    await c.refrescar(true);
    expect(obtener).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenLastCalledWith(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenLastCalledWith(7);
  });

  it('mantiene el número si falla y permite actualizar al recuperar conexión o recibir push', async () => {
    const obtener = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(1);
    const c = crearContadorAvisos({ obtener });
    const listener = vi.fn();
    c.suscribir('a', { numero: 2, revision: 1 }, listener);
    await c.refrescar(true);
    expect(listener).toHaveBeenLastCalledWith(2);
    await c.refrescar(true);
    expect(listener).toHaveBeenLastCalledWith(1);
  });

  it.each([null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('ignora una respuesta inválida: %s', async (numero) => {
    const c = crearContadorAvisos({ obtener: async () => numero });
    const listener = vi.fn();
    const quitar = c.suscribir('a', { numero: 2, revision: 1 }, listener);
    await c.refrescar(true);
    expect(listener).toHaveBeenLastCalledWith(2);
    expect(listener).toHaveBeenCalledTimes(1);
    quitar();
    await c.refrescar(true);
  });

  it('un fallo síncrono tampoco deja una promesa retenida para siempre', async () => {
    const obtener = vi.fn<() => Promise<number | null>>().mockImplementationOnce(() => { throw new Error('red'); }).mockResolvedValue(1);
    const c = crearContadorAvisos({ obtener });
    const listener = vi.fn();
    c.suscribir('a', { numero: 0, revision: 1 }, listener);
    await c.refrescar(true);
    await c.refrescar(true);
    expect(obtener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(1);
  });
});
