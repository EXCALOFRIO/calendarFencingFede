import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { estadoDeListaOficial } from '@/app/(app)/estado/oficial';
import type { PruebaPropia } from '@/app/(app)/estado/consultas';
import { PastillaOficial, Procedencia } from '@/components/estado/pruebas';
import {
  resumirParaMiEstado,
  torneosSinLeer,
  unirResumenes,
} from '@/lib/entries/resumen-mi-estado';
import {
  contarPorPrueba,
  unirObservaciones,
  type FilaUnida,
  type Observacion,
} from '@/lib/entries/union';

/**
 * «Mi estado»: la lista consultada y vacía y la no consultada son estados
 * distintos y ninguno afirma «no estás»; la proyección de la unión conserva
 * recuentos y propiedad sin arrastrar las observaciones.
 */

const MIO = 'atleta-mio';

function obs(parcial: Partial<Observacion> & Pick<Observacion, 'competitionId' | 'nombre'>): Observacion {
  return {
    equipo: '',
    club: null,
    athleteId: null,
    retiradoEn: null,
    fuente: 'skermo_rfee',
    sourceUrl: 'https://skermo.example/lista',
    leidoEl: new Date('2026-10-01T10:00:00Z'),
    ...parcial,
  };
}

describe('estadoDeListaOficial con estado de lectura', () => {
  it('lista leída y vacía no es lista sin consultar', () => {
    const vacia = estadoDeListaOficial({ emparejado: false, publicados: 0, lista: 'vacia' });
    const sinLeer = estadoDeListaOficial({
      emparejado: false,
      publicados: 0,
      lista: 'sin_consultar',
    });
    expect(vacia).toBe('vacia');
    expect(sinLeer).toBe('sin_publicar');
    expect(vacia).not.toBe(sinLeer);
  });

  it('sin dato de lectura se comporta como antes (no consultada)', () => {
    expect(estadoDeListaOficial({ emparejado: false, publicados: 0 })).toBe('sin_publicar');
  });

  it('estar emparejado manda y publicados > 0 sigue siendo «sin confirmar»', () => {
    expect(estadoDeListaOficial({ emparejado: true, publicados: 0, lista: 'vacia' })).toBe('dentro');
    expect(estadoDeListaOficial({ emparejado: false, publicados: 3, lista: 'con_datos' })).toBe(
      'sin_emparejar',
    );
  });
});

function prueba(estado: PruebaPropia['oficial']['estado']): PruebaPropia {
  return {
    oficial: { estado, publicados: estado === 'sin_emparejar' ? 4 : 0, equipo: null, sourceUrl: null, leidoEl: null },
  } as unknown as PruebaPropia;
}

describe('vista de los estados oficiales', () => {
  it('rotula cada estado distinto y ninguno dice que no estés inscrito', () => {
    const textos = (['sin_emparejar', 'vacia', 'sin_publicar'] as const).map((e) =>
      renderToStaticMarkup(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PastillaOficial, { prueba: prueba(e) }),
          React.createElement(Procedencia, { oficial: prueba(e).oficial }),
        ),
      ),
    );
    expect(new Set(textos).size).toBe(3);
    expect(textos[1]).toContain('Lista vacía');
    expect(textos[1]).toContain('se leyó');
    expect(textos[2]).toContain('sin consultar');
    for (const t of textos) {
      expect(t.toLowerCase()).not.toContain('no estás');
      expect(t.toLowerCase()).not.toContain('no inscrito');
    }
  });
});

function filasSinteticas(torneos: number, porPrueba: number): FilaUnida[] {
  const observaciones: Observacion[] = [];
  for (let t = 0; t < torneos; t++) {
    for (let i = 0; i < porPrueba; i++) {
      observaciones.push(
        obs({
          competitionId: `prueba-${t}`,
          nombre: `APELLIDO ${t}-${i}, NOMBRE`,
          athleteId: t === 0 && i === 0 ? MIO : null,
          sourceUrl: `https://skermo.example/${t}`,
          leidoEl: new Date(Date.UTC(2026, 9, 1, 8, i % 60)),
        }),
      );
    }
  }
  return unirObservaciones(observaciones);
}

describe('resumirParaMiEstado', () => {
  it('conserva propiedad, recuento por prueba, URL y última lectura', () => {
    const filas = filasSinteticas(3, 20);
    const resumen = resumirParaMiEstado(filas, new Set([MIO]));

    expect(resumen.mias).toHaveLength(1);
    expect(resumen.mias[0]).toMatchObject({ competitionId: 'prueba-0', athleteId: MIO });
    const esperado = contarPorPrueba(filas);
    for (const [id, n] of Object.entries(esperado)) {
      expect(resumen.recuentos.get(id)?.n).toBe(n);
    }
    expect(resumen.recuentos.get('prueba-1')?.sourceUrl).toBe('https://skermo.example/1');
    expect(resumen.recuentos.get('prueba-1')?.leidoEl?.toISOString()).toBe(
      '2026-10-01T08:19:00.000Z',
    );
  });

  it('ajeno o en conflicto cuenta en el recuento pero no marca «es mío»', () => {
    const filas: FilaUnida[] = [
      {
        competitionId: 'p',
        nombre: 'A',
        equipo: null,
        club: null,
        athleteIds: ['otro'],
        retiradoEn: null,
        observaciones: [obs({ competitionId: 'p', nombre: 'A' })],
      },
      {
        competitionId: 'p',
        nombre: 'B',
        equipo: null,
        club: null,
        athleteIds: [],
        retiradoEn: null,
        observaciones: [obs({ competitionId: 'p', nombre: 'B' })],
      },
    ];
    const resumen = resumirParaMiEstado(filas, new Set([MIO]));
    expect(resumen.mias).toEqual([]);
    expect(resumen.recuentos.get('p')?.n).toBe(2);
  });

  it('el resumen no arrastra observaciones ni fuentes por fila', () => {
    const resumen = resumirParaMiEstado(filasSinteticas(2, 5), new Set([MIO]));
    const json = JSON.stringify([resumen.mias, [...resumen.recuentos]]);
    expect(json).not.toContain('observaciones');
    expect(json).not.toContain('skermo_rfee');
    expect(json).not.toContain('APELLIDO');
  });

  it('una prueba sin filas no aparece: ausencia de recuento no afirma nada', () => {
    const resumen = resumirParaMiEstado([], new Set([MIO]));
    expect(resumen.recuentos.size).toBe(0);
    expect(resumen.mias).toEqual([]);
  });

  it('une dos lecturas sin pisar las pruebas de cada una', () => {
    const a = resumirParaMiEstado(filasSinteticas(1, 3), new Set([MIO]));
    const b = resumirParaMiEstado(
      filasSinteticas(2, 4).filter((f) => f.competitionId === 'prueba-1'),
      new Set([MIO]),
    );
    const unido = unirResumenes(a, b);
    expect(unido.recuentos.get('prueba-0')?.n).toBe(3);
    expect(unido.recuentos.get('prueba-1')?.n).toBe(4);
    expect(unido.mias).toHaveLength(1);
  });
});

describe('torneosSinLeer', () => {
  it('no repite torneos ni vuelve a leer los ya leídos', () => {
    expect(torneosSinLeer(['a', 'b', 'a', 'c'], new Set(['b']))).toEqual(['a', 'c']);
    expect(torneosSinLeer(['a'], new Set(['a']))).toEqual([]);
  });
});

/**
 * Medición reproducible sobre datos SINTÉTICOS, no sobre la base real ni una
 * vista privada. Compara el volumen que antes se leía y retenía (todas las
 * candidatas, filas unidas con observaciones) con el actual (sólo los torneos
 * de las filas que salen y un resumen por prueba).
 */
describe('medición sintética de lo que lee y retiene «Mi estado»', () => {
  const TORNEOS_CANDIDATOS = 120;
  const INSCRITOS_POR_PRUEBA = 80;
  const TOPE = 5;

  it('lee como mucho los torneos de las filas mostradas y retiene mucho menos', () => {
    const todas = filasSinteticas(TORNEOS_CANDIDATOS, INSCRITOS_POR_PRUEBA);
    const antesFilas = todas.length;
    const antesBytes = JSON.stringify(todas).length;

    const elegidos = Array.from({ length: TOPE }, (_, i) => `torneo-${i}`);
    const yaLeidos = new Set(['torneo-0']);
    const leer = torneosSinLeer(elegidos, yaLeidos);
    const despuesFilas = (leer.length + yaLeidos.size) * INSCRITOS_POR_PRUEBA;

    const resumen = resumirParaMiEstado(
      todas.filter((f) => ['prueba-0', 'prueba-1', 'prueba-2', 'prueba-3', 'prueba-4'].includes(f.competitionId)),
      new Set([MIO]),
    );
    const despuesBytes = JSON.stringify([resumen.mias, [...resumen.recuentos]]).length;

    console.info(
      `[medición sintética] filas leídas ${antesFilas} -> ${despuesFilas}; ` +
        `bytes retenidos ${antesBytes} -> ${despuesBytes}`,
    );
    expect(leer).toEqual(['torneo-1', 'torneo-2', 'torneo-3', 'torneo-4']);
    expect(despuesFilas).toBeLessThan(antesFilas / 10);
    expect(despuesBytes).toBeLessThan(antesBytes / 50);
  });
});
