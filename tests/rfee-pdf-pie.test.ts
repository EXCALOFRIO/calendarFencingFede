import { describe, expect, it } from 'vitest';
import { analizarPagina } from '@/lib/ingest/sources/rfee-pdf/paginas';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import type { PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';
import { cabecera, filasPoule, paginaClasificacion, paginaPoules, type Tirador } from './fixtures/rfee-pdf/sintetico';

const CTX = { url: 'https://app.skermo.org/client/1/prueba.pdf', docId: 'prueba' };
const ESPADA = cabecera('ESPADA MASCULINA INDIVIDUAL');
const tiradores = (n: number): Tirador[] =>
  Array.from({ length: n }, (_, i) => ({ puesto: String(i + 1), nombre: `TIRADOR N${i + 1}`, club: `CLUB-${(i % 5) + 1}` }));
const con = (p: PaginaTexto, ...items: [x: number, y: number, s: string][]): PaginaTexto => ({
  ...p,
  items: [...p.items, ...items.map(([x, y, s]) => ({ s, x, y, w: s.length * 3.6, h: 8 }))],
});
const PIE: [number, number, string] = [193, 32, 'Engarde escrime-engarde.com - 2019-04-08 13:34 - Página 1'];

describe('pie de página de Engarde', () => {
  it('en una página llena, la última fila queda justo encima del pie y se lee; el pie no', () => {
    // 48 filas cada 14 puntos desde y=711: la última cae en y=53.
    const llena = con(paginaClasificacion(1, ESPADA, tiradores(48)), PIE);
    expect(analizarPagina(llena).filas.at(-1)?.y).toBe(53);
    const p = leerResultadosPdf([llena], CTX).pruebas[0];
    expect(p.rechazos).toEqual([]);
    expect(p.cobertura.puestos).toMatchObject({ estado: 'completo', publicado: 48, importado: 48 });
    expect(p.puestos.at(-1)).toMatchObject({ posicion: 48, nombre: 'TIRADOR N48' });
  });

  it('un texto de la franja inferior que no es el pie no desaparece: queda como rechazo visible', () => {
    const conNota = con(paginaClasificacion(1, ESPADA, tiradores(4)), [43, 45, 'Organiza: CLUB-1'], PIE);
    const p = leerResultadosPdf([conNota], CTX).pruebas[0];
    expect(p.puestos).toHaveLength(4);
    expect(p.rechazos.map((r) => [r.motivo, r.region?.yMin])).toEqual([['Fila de clasificación sin puesto publicado', 42]]);
  });

  it('la leyenda de abreviaturas de la franja inferior es pie: no entra en la última poule', () => {
    const tres = tiradores(3);
    const poules = paginaPoules(1, ESPADA, [filasPoule([[0, 5, 5], [3, 0, 5], [2, 4, 0]], tres)]);
    const conLeyenda = con(poules, [11, 54, 'V/D = Victoria/Derrota = v/d'], [110, 54, 'Ind. = TD-TR = toques dados - toques recibidos'], PIE);
    expect(analizarPagina(conLeyenda).filas.map((f) => f.y)).toEqual(analizarPagina(poules).filas.map((f) => f.y));
    const p = leerResultadosPdf([conLeyenda], CTX).pruebas[0];
    const sin = leerResultadosPdf([poules], CTX).pruebas[0];
    expect(p.rechazos).toEqual(sin.rechazos);
    expect(p.cobertura.poules).toEqual(sin.cobertura.poules);
    expect(p.cobertura.poules.publicado).toBe(3);
  });
});

describe('motivo de una prueba que no se puede atribuir', () => {
  it('sin modalidad, el motivo lo dice aunque también falte la categoría', () => {
    const liga = cabecera('ESPADA FEMENINA', '8 JUNIO 2019', 'LIGA DE CLUBES');
    const tres = tiradores(3);
    const l = leerResultadosPdf([paginaPoules(1, liga, [filasPoule([[0, 5, 5], [3, 0, 5], [2, 4, 0]], tres)])], CTX);
    const p = l.pruebas[0];
    expect(p.estado).toBe('pendiente');
    expect(p.rechazos.filter((r) => r.seccion === 'prueba').map((r) => r.motivo)).toEqual([
      'La cabecera no declara una categoría reconocida; Modalidad no declarada',
    ]);
  });
});
