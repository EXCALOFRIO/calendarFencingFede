import { describe, expect, it } from 'vitest';
import {
  FUENTES_IMPORTADAS,
  baseDeNombre,
  componerTramo,
  type FilaPruebaImportada,
} from '@/lib/queries/calendario-pasado-modelo';

function fila(sobre: Partial<FilaPruebaImportada>): FilaPruebaImportada {
  return {
    id: 'sc-1',
    edicionId: 'se-1',
    fuente: 'skermo_rfee',
    arma: 'ESPADA',
    genero: 'M',
    categoria: 'ABS',
    formato: 'INDIVIDUAL',
    fecha: '2021-03-06',
    url: null,
    edicion: 'TNR ABS',
    inicio: '2021-03-06',
    fin: '2021-03-06',
    ciudad: null,
    pais: null,
    urlEdicion: null,
    conResultados: 1,
    ganador: 'GARCÍA Pedro\u001fESP',
    ...sobre,
  };
}

const TRAMO = { desde: '2021-03-01', hasta: '2021-03-31', calendario: [], cruces: [] };

describe('el calendario histórico, sólo con lo que hay en Explorar', () => {
  it('lee también Engarde y la EFC', () => {
    expect(FUENTES_IMPORTADAS).toEqual(expect.arrayContaining(['fie', 'efc', 'skermo_rfee', 'rfee_pdf', 'engarde']));
  });

  it('una edición sin un solo puesto no sale', () => {
    const t = componerTramo({
      ...TRAMO,
      importadas: [fila({ edicion: 'Liga de clubes', conResultados: 0, ganador: null, formato: 'EQUIPOS' })],
    });
    expect(t.eventos).toEqual([]);
  });

  it('el PDF que titula la prueba se junta con el torneo de Skermo del mismo día', () => {
    expect(baseDeNombre('TNR ABS 1 Sable Masculino Individual')).toBe(baseDeNombre('TNR ABS'));
    const t = componerTramo({
      ...TRAMO,
      importadas: [
        fila({}),
        fila({ id: 'sc-2', edicionId: 'se-2', fuente: 'rfee_pdf', arma: 'SABLE', edicion: 'TNR ABS 1 Sable Masculino Individual' }),
      ],
    });
    expect(t.eventos).toHaveLength(1);
    expect(t.eventos[0].name).toBe('TNR ABS');
    expect(t.resultados[t.eventos[0].id].map((p) => p.arma).sort()).toEqual(['ESPADA', 'SABLE']);
  });

  it('Engarde sólo cuenta si Skermo o el PDF no traen ya esa prueba ese día', () => {
    const t = componerTramo({
      ...TRAMO,
      importadas: [
        fila({}),
        fila({ id: 'eg-1', edicionId: 'eg-1', fuente: 'engarde', edicion: 'TNR ABS Madrid Espada' }),
        fila({ id: 'eg-2', edicionId: 'eg-2', fuente: 'engarde', fecha: '2021-03-20', inicio: '2021-03-20', fin: '2021-03-20', edicion: 'TNR M-20 Espada' }),
      ],
    });
    const ids = Object.values(t.resultados).flat().map((p) => p.id).sort();
    expect(ids).toEqual(['eg-2', 'sc-1']);
  });

  it('una prueba de la EFC es internacional y no se junta con la nacional del mismo día', () => {
    const t = componerTramo({
      ...TRAMO,
      importadas: [
        fila({}),
        fila({ id: 'efc-1', edicionId: 'efc-1', fuente: 'efc', edicion: 'European Cup', ciudad: 'Paris', pais: 'FRA' }),
      ],
    });
    expect(t.eventos.map((e) => e.source).sort()).toEqual(['efc', 'skermo_rfee']);
    expect(t.eventos.find((e) => e.source === 'efc')?.scope).toBe('INTERNACIONAL');
  });

  it('un nombre que es sólo arma y género no se queda vacío', () => {
    expect(baseDeNombre('Sable masculino')).not.toBe('');
  });
});
