import { describe, expect, it } from 'vitest';
import {
  claseDeCursor,
  estadoDeFila,
  ETIQUETA_ESTADO,
  hechoDeFactKind,
  lecturaDeHecho,
  resumirCoberturaPorHecho,
  type FilaCoberturaAgregada,
} from '@/lib/ingest/backfill/estado';
import { codificarCursorFie } from '@/lib/ingest/backfill/cursor-fie';

const fila = (over: Partial<FilaCoberturaAgregada> = {}): FilaCoberturaAgregada => ({
  source: 'fie',
  factKind: 'ranking',
  status: 'completo',
  claseCursor: null,
  consistente: true,
  n: 1,
  publicado: 10,
  importado: 10,
  ...over,
});

describe('estado por prueba y tipo de dato (VAL-BACKFILL-007)', () => {
  it('cada estado de cobertura se lee como el estado que corresponde', () => {
    expect(estadoDeFila(fila({ status: 'pendiente' }))).toBe('pendiente');
    expect(estadoDeFila(fila({ status: 'parcial' }))).toBe('parcial');
    expect(estadoDeFila(fila({ status: 'error' }))).toBe('error');
    expect(estadoDeFila(fila({ status: 'conflicto' }))).toBe('conflicto');
    expect(estadoDeFila(fila({ status: 'sin_resultados' }))).toBe('sin_resultados');
    expect(estadoDeFila(fila({ status: 'completo' }))).toBe('completo');
  });

  it('«no publicado» sólo existe si la fuente lo registró de forma explícita (cursor no_publicado)', () => {
    expect(estadoDeFila(fila({ status: 'pendiente', claseCursor: 'no_publicado' }))).toBe('no_publicado');
    expect(estadoDeFila(fila({ status: 'sin_resultados', claseCursor: 'no_publicado' }))).toBe('no_publicado');
    // Sin esa marca, pendiente sigue siendo pendiente, no «no publicado».
    expect(estadoDeFila(fila({ status: 'pendiente' }))).toBe('pendiente');
  });

  it('un completo con continuación abierta o con importado por debajo del publicado no es completo', () => {
    expect(estadoDeFila(fila({ status: 'completo', claseCursor: 'continuacion' }))).toBe('parcial');
    expect(estadoDeFila(fila({ status: 'completo', consistente: false }))).toBe('parcial');
  });

  it('clasifica el cursor sin interpretar estados finos de enlace como continuación', () => {
    expect(claseDeCursor('no_publicado')).toBe('no_publicado');
    expect(claseDeCursor(codificarCursorFie({ fuente: 'fie', season: 2027, competitionId: 1, pageSize: 24, siguientePagina: 101, total: 3000 }))).toBe('continuacion');
    expect(claseDeCursor('solo_enlace')).toBeNull();
    expect(claseDeCursor(null)).toBeNull();
  });

  it('asocia cada tipo de dato con su hecho: puestos, poules, cuadro, documento y enlace', () => {
    expect(hechoDeFactKind('ranking')).toBe('puestos');
    expect(hechoDeFactKind('results')).toBe('puestos');
    expect(hechoDeFactKind('pools')).toBe('poules');
    expect(hechoDeFactKind('tableau')).toBe('cuadro');
    expect(hechoDeFactKind('pdf')).toBe('documento');
    expect(hechoDeFactKind('link')).toBe('enlace');
    expect(hechoDeFactKind('index')).toBe('indice');
    expect(hechoDeFactKind('entries')).toBeNull();
  });
});

describe('resumen con denominadores', () => {
  it('cuenta por hecho y estado, suma publicado/importado y declara lo nunca leído', () => {
    const r = resumirCoberturaPorHecho(
      [
        fila({ factKind: 'ranking', status: 'completo', n: 3, publicado: 30, importado: 30 }),
        fila({ factKind: 'results', source: 'skermo_rfee', status: 'parcial', n: 2, publicado: 40, importado: 25 }),
        fila({ factKind: 'ranking', status: 'error', n: 1, publicado: 0, importado: 0 }),
        fila({ factKind: 'pools', status: 'sin_resultados', n: 4, publicado: 0, importado: 0 }),
        fila({ factKind: 'tableau', status: 'pendiente', claseCursor: 'no_publicado', n: 5, publicado: 0, importado: 0 }),
      ],
      { puestos: 10, poules: 10, cuadro: 8 },
    );
    expect(r.puestos).toMatchObject({
      unidades: 6,
      porEstado: { completo: 3, parcial: 2, error: 1, pendiente: 0, conflicto: 0, no_publicado: 0, sin_resultados: 0 },
      publicado: 70,
      importado: 55,
      descubiertas: 10,
      nuncaLeidas: 4,
    });
    expect(r.poules).toMatchObject({ unidades: 4, porEstado: expect.objectContaining({ sin_resultados: 4 }), nuncaLeidas: 6 });
    expect(r.cuadro).toMatchObject({ unidades: 5, porEstado: expect.objectContaining({ no_publicado: 5 }), nuncaLeidas: 3 });
    expect(r.documento.unidades).toBe(0);
  });

  it('sin denominador descubierto no inventa pendientes: nuncaLeidas es null', () => {
    const r = resumirCoberturaPorHecho([fila()]);
    expect(r.puestos.descubiertas).toBeNull();
    expect(r.puestos.nuncaLeidas).toBeNull();
  });

  it('nunca presenta un hecho como completo ni como cero cuando falta lectura, hay error o no se publicó', () => {
    const base = resumirCoberturaPorHecho([], { puestos: 5 });
    expect(lecturaDeHecho(base.puestos)).toBe('sin_datos');

    const conError = resumirCoberturaPorHecho([fila({ status: 'error', n: 1 })], { puestos: 1 });
    expect(lecturaDeHecho(conError.puestos)).toBe('incompleto');

    const sinAsaltos = resumirCoberturaPorHecho([fila({ factKind: 'pools', status: 'sin_resultados', n: 1, publicado: 0, importado: 0 })], { poules: 1 });
    expect(lecturaDeHecho(sinAsaltos.poules)).toBe('sin_publicar');
    expect(ETIQUETA_ESTADO.sin_resultados).not.toMatch(/\b0\b|cero/i);
    expect(ETIQUETA_ESTADO.pendiente).not.toMatch(/\b0\b|cero/i);

    const parcial = resumirCoberturaPorHecho([fila({ status: 'completo', n: 1 }), fila({ status: 'parcial', n: 1 })], { puestos: 3 });
    expect(lecturaDeHecho(parcial.puestos)).toBe('incompleto');
  });

  it('completo_para_lo_publicado exige todas las unidades descubiertas leídas y sin otro estado', () => {
    const todo = resumirCoberturaPorHecho([fila({ status: 'completo', n: 4 })], { puestos: 4 });
    expect(lecturaDeHecho(todo.puestos)).toBe('completo_para_lo_publicado');
    const faltan = resumirCoberturaPorHecho([fila({ status: 'completo', n: 4 })], { puestos: 5 });
    expect(lecturaDeHecho(faltan.puestos)).toBe('incompleto');
    // Sin denominador conocido jamás se afirma completitud.
    const sinDenominador = resumirCoberturaPorHecho([fila({ status: 'completo', n: 4 })]);
    expect(lecturaDeHecho(sinDenominador.puestos)).toBe('incompleto');
  });
});
