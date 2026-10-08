import { describe, expect, it } from 'vitest';
import { filasSelectorPruebas, type ElementoSelector } from '@/lib/sport/selector-pruebas';

const p = (id: string, arma: string, genero: string, categoria: string, formato = 'INDIVIDUAL'): ElementoSelector => ({
  id, href: `/p/${id}`, arma, genero, categoria, formato,
});

const PRUEBAS = [
  p('sm-abs', 'SABLE', 'M', 'ABS'),
  p('ef-abs', 'ESPADA', 'F', 'ABS'),
  p('em-abs', 'ESPADA', 'M', 'ABS'),
  p('em-m17', 'ESPADA', 'M', 'M17'),
  p('em-vet', 'ESPADA', 'M', 'VET'),
  p('fm-abs', 'FLORETE', 'M', 'ABS'),
  p('em-abs-eq', 'ESPADA', 'M', 'ABS', 'EQUIPOS'),
];

describe('filasSelectorPruebas', () => {
  it('una fila por dimensión con dos valores o más, en orden canónico', () => {
    const filas = filasSelectorPruebas(PRUEBAS, 'em-abs');
    expect(filas.map((f) => f.dimension)).toEqual(['arma', 'genero', 'formato', 'categoria']);
    expect(filas.map((f) => f.etiqueta)).toEqual(['Arma', 'Género', 'Modalidad', 'Categoría']);
    expect(filas[0].opciones.map((o) => o.etiqueta)).toEqual(['Florete', 'Espada', 'Sable']);
    expect(filas[1].opciones.map((o) => o.etiqueta)).toEqual(['Masc.', 'Fem.']);
    expect(filas[2].opciones.map((o) => o.etiqueta)).toEqual(['Individual', 'Equipos']);
    expect(filas[3].opciones.map((o) => o.etiqueta)).toEqual(['Absoluto', 'M17', 'Veteranos']);
  });

  it('marca la actual y cada opción apunta a una prueba real', () => {
    const filas = filasSelectorPruebas(PRUEBAS, 'em-m17');
    const arma = filas.find((f) => f.dimension === 'arma')!;
    expect(arma.opciones.find((o) => o.activa)?.valor).toBe('ESPADA');
    // Sin sable M17: se conserva el género (M) antes que la categoría.
    expect(arma.opciones.find((o) => o.valor === 'SABLE')).toMatchObject({ destinoId: 'sm-abs', destinoHref: '/p/sm-abs' });
    const genero = filas.find((f) => f.dimension === 'genero')!;
    expect(genero.opciones.find((o) => o.valor === 'F')?.destinoId).toBe('ef-abs');
  });

  it('prioriza el arma, luego el género y la modalidad', () => {
    const lista = [
      p('a', 'ESPADA', 'M', 'ABS', 'EQUIPOS'),
      p('b', 'ESPADA', 'F', 'M17', 'INDIVIDUAL'),
      p('c', 'FLORETE', 'M', 'M17', 'INDIVIDUAL'),
      p('d', 'ESPADA', 'M', 'M17', 'INDIVIDUAL'),
    ];
    const cat = filasSelectorPruebas(lista, 'a').find((f) => f.dimension === 'categoria')!;
    // De ESPADA M ABS EQUIPOS a M17: «d» conserva arma y género.
    expect(cat.opciones.find((o) => o.valor === 'M17')?.destinoId).toBe('d');
  });

  it('omite las dimensiones con un solo valor y tolera datos incompletos', () => {
    const filas = filasSelectorPruebas([p('x', 'ESPADA', 'M', 'ABS'), { id: 'y', arma: 'ESPADA', genero: 'F', categoria: null }], 'x');
    expect(filas.map((f) => f.dimension)).toEqual(['genero']);
    expect(filasSelectorPruebas([], 'x')).toEqual([]);
    expect(filasSelectorPruebas([p('x', 'ESPADA', 'M', 'ABS')], 'x')).toEqual([]);
  });

  it('sin href no inventa destinoHref', () => {
    const filas = filasSelectorPruebas([{ id: '1', arma: 'ESPADA' }, { id: '2', arma: 'SABLE' }], '1');
    expect(filas[0].opciones[1]).toEqual({ valor: 'SABLE', etiqueta: 'Sable', destinoId: '2', activa: false });
  });
});
