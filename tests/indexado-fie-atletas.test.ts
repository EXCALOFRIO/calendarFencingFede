import { describe, expect, it } from 'vitest';
import { crearCompuerta, idsEnJsonl } from '../scripts/indexado/fie-atletas';

describe('idsEnJsonl', () => {
  it('lee los fieId de cada línea e ignora vacías y valores no válidos', () => {
    const texto = '{"fieId":12,"personaId":"a"}\r\n\n{"fieId":"34"}\n{"fieId":0}\n{"otro":1}\n';
    expect([...idsEnJsonl(texto)].sort((a, b) => a - b)).toEqual([12, 34]);
  });
});

describe('crearCompuerta', () => {
  it('separa el inicio de peticiones simultáneas al menos el intervalo', async () => {
    let t = 1000;
    const esperas: number[] = [];
    const turno = crearCompuerta(500, () => t, async (ms) => { esperas.push(ms); });
    await Promise.all([turno(), turno(), turno()]);
    expect(esperas).toEqual([500, 1000]);
    t = 5000;
    await turno();
    expect(esperas).toEqual([500, 1000]);
  });
});
