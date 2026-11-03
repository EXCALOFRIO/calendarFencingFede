import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_VISTA_CADUCADA } from '@/lib/auth/read-only';

/**
 * LA RUTA `/api/inscritos-fie`.
 *
 * Sesión delante siempre, entrada estricta (los dos números de la ruta de la
 * FIE y nada más) y estados honestos: `sin_lista` cuando la FIE aún no ha
 * publicado, `no_disponible` cuando falla, y nunca un stack ni un nombre en
 * el cuerpo del error.
 */

const sesion = vi.hoisted(() => ({
  perfil: null as null | { profileId: string; role: string },
  lanzar: null as null | Error,
}));
const leer = vi.hoisted(() =>
  vi.fn(async (_t: number, _c: number): Promise<unknown> => ({ estado: 'ok', total: 0, inscritos: [] })),
);

vi.mock('@/lib/auth/session', () => ({
  getSessionProfile: vi.fn(async () => {
    if (sesion.lanzar) throw sesion.lanzar;
    return sesion.perfil;
  }),
}));
vi.mock('@/lib/entries/inscritos-fie', () => ({ leerInscritosFie: leer }));
// La caché compartida se queda fuera del test: la ruta sólo tiene que usar `cargar`.
vi.mock('@/lib/cache', () => ({
  MINUTO: 60_000,
  HORA: 3_600_000,
  cacheCompartida: {
    definir: (def: { cargar: unknown }) => def.cargar,
  },
}));

const { GET } = await import('@/app/api/inscritos-fie/route');

const url = (q: string) => new Request(`https://example.test/api/inscritos-fie${q}`);

sesion.perfil = { profileId: 'p1', role: 'coach' };

afterEach(() => {
  sesion.perfil = { profileId: 'p1', role: 'coach' };
  sesion.lanzar = null;
  leer.mockClear();
  leer.mockResolvedValue({ estado: 'ok' as const, total: 0, inscritos: [] });
});

describe('ruta /api/inscritos-fie', () => {
  it('sin sesión no se pide nada a la FIE', async () => {
    sesion.perfil = null;
    const r = await GET(url('?temporada=2027&competicion=1410'));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ estado: 'no_autenticado' });
    expect(leer).not.toHaveBeenCalled();
  });

  it('una vista previa caducada es un 401, no un 503', async () => {
    sesion.lanzar = Object.assign(new Error('caducada'), { digest: ERROR_VISTA_CADUCADA });
    const r = await GET(url('?temporada=2027&competicion=1410'));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ estado: 'no_autenticado' });
  });

  it('entrada estricta: sin los dos números, o con cosas de más, es 400', async () => {
    for (const q of [
      '',
      '?temporada=2027',
      '?competicion=1410',
      '?temporada=abc&competicion=1410',
      '?temporada=2027&competicion=x',
      '?temporada=2027&temporada=2028&competicion=1410',
      '?temporada=2027&competicion=1410&otra=1',
      '?temporada=2027&competicion=1410;drop',
    ]) {
      const r = await GET(url(q));
      expect(r.status, q).toBe(400);
      expect(await r.json()).toEqual({ estado: 'entrada_invalida' });
    }
    expect(leer).not.toHaveBeenCalled();
  });

  it('con sesión y los dos números devuelve la lista, privada y sin cachear en el navegador', async () => {
    const inscritos = [{ nombre: 'PETIT Lea', equipo: '', pais: 'FRA' }];
    leer.mockResolvedValueOnce({ estado: 'ok' as const, total: 6, inscritos });

    const r = await GET(url('?temporada=2027&competicion=1410'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: 'ok', total: 6, inscritos });
    expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(leer).toHaveBeenCalledWith(2027, 1410);
  });

  it('la lista no publicada llega como «sin_lista» y con 200', async () => {
    leer.mockResolvedValueOnce({ estado: 'sin_lista' as const });
    const r = await GET(url('?temporada=2027&competicion=1410'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: 'sin_lista' });
  });

  it('si la FIE falla se contesta «no disponible», sin el error por dentro', async () => {
    leer.mockRejectedValueOnce(new Error('HTTP 503 al pedir https://fie.org/... (traza interna)'));
    const r = await GET(url('?temporada=2027&competicion=1410'));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ estado: 'no_disponible' });
  });
});
