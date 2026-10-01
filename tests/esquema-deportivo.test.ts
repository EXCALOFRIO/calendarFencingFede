import { describe, expect, it, vi } from 'vitest';
import { crearDetectorEsquema } from '@/lib/sport/esquema';

describe('detector del esquema deportivo', () => {
  it('recuerda el esquema completo y reintenta el ausente pasado un minuto', async () => {
    let t = 0;
    const consultar = vi
      .fn()
      .mockResolvedValueOnce({ identidad: false, referencias: false })
      .mockResolvedValueOnce({ identidad: true, referencias: true });
    const detectar = crearDetectorEsquema(consultar, () => t);

    expect(await detectar()).toEqual({ identidad: false, referencias: false });
    t = 30_000;
    await detectar();
    expect(consultar).toHaveBeenCalledTimes(1);

    t = 61_000;
    expect(await detectar()).toEqual({ identidad: true, referencias: true });
    t = 10_000_000;
    await detectar();
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('un error de la base se propaga y no se recuerda como «ausente»', async () => {
    const consultar = vi
      .fn()
      .mockRejectedValueOnce(new Error('neon caído'))
      .mockResolvedValueOnce({ identidad: true, referencias: false });
    const detectar = crearDetectorEsquema(consultar, () => 0);
    await expect(detectar()).rejects.toThrow('neon caído');
    expect(await detectar()).toEqual({ identidad: true, referencias: false });
  });
});
