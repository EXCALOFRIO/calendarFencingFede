import { describe, expect, it } from 'vitest';
import { pruebasDeLista } from '../scripts/indexado/fie-descargar-antiguas';

describe('lista de pruebas FIE dirigidas', () => {
  it('acepta comas, líneas y comentarios, quita repetidas y ordena', () => {
    const texto = '# veteranos\n2025:1484, 2025:1483\n2016:176 # cuadro doble\n\n2025:1483;2016:1067\r\n';
    expect(pruebasDeLista(texto)).toEqual([
      { season: 2016, id: 176 },
      { season: 2016, id: 1067 },
      { season: 2025, id: 1483 },
      { season: 2025, id: 1484 },
    ]);
  });

  it('rechaza entradas sin temporada', () => {
    expect(() => pruebasDeLista('1483')).toThrow(/temporada:id/);
    expect(() => pruebasDeLista('2025/1483')).toThrow(/temporada:id/);
  });

  it('una lista vacía no devuelve pruebas', () => {
    expect(pruebasDeLista('# nada\n')).toEqual([]);
  });
});
