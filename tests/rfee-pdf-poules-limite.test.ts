import { describe, expect, it } from 'vitest';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import { cabecera, filasPoule, paginaClasificacion, paginaPoules, type Tirador } from './fixtures/rfee-pdf/sintetico';

const CTX = { url: 'https://app.skermo.org/client/1/prueba.pdf', docId: 'prueba' };
const ESPADA = cabecera('ESPADA MASCULINA INDIVIDUAL');

const NOMBRES: Tirador[] = [
  'ALFA UNO', 'BRAVO DOS', 'CHARLIE TRES', 'DELTA CUATRO', 'ECO CINCO', 'FOXTROT SEIS', 'GOLF SIETE', 'HOTEL OCHO',
].map((nombre, i) => ({ puesto: String(i + 1), nombre, club: `CLUB-${i + 1}` }));

const poule = (tocados: number[][], desde: number) => filasPoule(tocados, NOMBRES.slice(desde));

// Una sola «V» en la fila de A: la aritmética la obliga a 5 y demuestra el tope de la vuelta.
const CON_EVIDENCIA = [
  [0, 4, 5, 4],
  [3, 0, 2, 4],
  [2, 5, 0, 3],
  [3, 2, 4, 0],
];
// Cuatro «V» en ciclo (filas y columnas con dos cada una): sin tope, varios repartos cuadran.
const CICLO = [
  [0, 4, 5, 5],
  [3, 0, 5, 5],
  [2, 4, 0, 4],
  [3, 1, 2, 0],
];

const leer = (...paginas: ReturnType<typeof paginaPoules>[]) =>
  leerResultadosPdf([...paginas, paginaClasificacion(paginas.length + 1, ESPADA, NOMBRES)], CTX).pruebas[0];
const asalto = (p: ReturnType<typeof leer>, a: number, b: number) =>
  p.asaltos.find((x) => x.refA === `p000${a}` && x.refB === `p000${b}`);

describe('V sin número y tope de tocados demostrado por la vuelta', () => {
  it('el tope que la aritmética demuestra en la vuelta resuelve un ciclo de V: derivado_de_limite y poules completas', () => {
    const p = leer(paginaPoules(1, ESPADA, [poule(CON_EVIDENCIA, 0), poule(CICLO, 4)]));
    expect(asalto(p, 1, 3)).toMatchObject({ puntosA: 5, puntosB: 2, marcador: 'derivado_de_totales' });
    for (const [a, b] of [[5, 7], [5, 8], [6, 7], [6, 8]]) {
      expect(asalto(p, a, b)).toMatchObject({ puntosA: 5, marcador: 'derivado_de_limite', ronda: 'P2' });
    }
    expect(p.asaltos.filter((a) => a.fase === 'POULE')).toHaveLength(12);
    expect(p.excluidos.sinMarcador).toBe(0);
    expect(p.rechazos).toEqual([]);
    expect(p.cobertura.poules).toMatchObject({ estado: 'completo', publicado: 12, importado: 12 });
  });

  it('sin ninguna V obligada en la vuelta no hay tope: el ciclo queda parcial y sin tanteo', () => {
    const p = leer(paginaPoules(1, ESPADA, [poule(CICLO, 4)]));
    expect(p.asaltos.some((a) => a.marcador !== 'explicito')).toBe(false);
    expect(p.excluidos.sinMarcador).toBe(4);
    expect(p.rechazos.some((r) => /no determinan/.test(r.motivo))).toBe(true);
    expect(p.cobertura.poules.estado).toBe('parcial');
  });

  it('el tope de una vuelta no se aplica a otra', () => {
    const p = leer(paginaPoules(1, ESPADA, [poule(CON_EVIDENCIA, 0)], 1), paginaPoules(2, ESPADA, [poule(CICLO, 4)], 2));
    expect(p.asaltos.filter((a) => a.ronda.startsWith('V2'))).toHaveLength(2);
    expect(p.asaltos.some((a) => a.marcador === 'derivado_de_limite')).toBe(false);
    expect(p.excluidos.sinMarcador).toBe(4);
  });

  it('V obligadas con valores distintos en la vuelta no demuestran ningún tope', () => {
    // E→F (4-3) se publica como «V»: la columna de F la obliga a 4, y la otra poule obliga 5.
    const cicloConCuatro = poule(CICLO, 4).map((f, i) => (i === 0 ? { ...f, celdas: ['V', 'V', 'V'] } : f));
    const p = leer(paginaPoules(1, ESPADA, [poule(CON_EVIDENCIA, 0), cicloConCuatro]));
    expect(asalto(p, 5, 6)).toMatchObject({ puntosA: 4, puntosB: 3, marcador: 'derivado_de_totales' });
    expect(p.asaltos.some((a) => a.marcador === 'derivado_de_limite')).toBe(false);
    expect(p.excluidos.sinMarcador).toBe(4);
  });

  it('un tanteo publicado por encima del valor obligado anula el tope', () => {
    const conSeis = CON_EVIDENCIA.map((f, i) => (i === 3 ? [3, 6, 4, 0] : f));
    const p = leer(paginaPoules(1, ESPADA, [poule(conSeis, 0), poule(CICLO, 4)]));
    expect(asalto(p, 2, 4)).toMatchObject({ puntosA: 4, puntosB: 6, marcador: 'explicito' });
    expect(p.asaltos.some((a) => a.marcador === 'derivado_de_limite')).toBe(false);
    expect(p.excluidos.sinMarcador).toBe(4);
  });

  it('con tope, una V que no llega a él sólo se fija si los totales la obligan; si no, queda sin tanteo', () => {
    // E→G vale 4 aunque se publica como «V»: la fila y la columna de E no suman 2 × 5.
    const roto = CICLO.map((f, i) => (i === 0 ? [0, 4, 4, 5] : f));
    const resuelto = leer(paginaPoules(1, ESPADA, [poule(CON_EVIDENCIA, 0), poule(roto, 4).map((f, i) => (i === 0 ? { ...f, celdas: ['V4', 'V', 'V'] } : f))]));
    expect(asalto(resuelto, 5, 7)).toMatchObject({ puntosA: 4, marcador: 'derivado_de_limite' });
    expect(asalto(resuelto, 6, 8)).toMatchObject({ puntosA: 5, marcador: 'derivado_de_limite' });

    // Dos V de 4 en diagonal: ninguna fila ni columna suma incógnitas × 5, así que nada se fija.
    const diagonal = CICLO.map((f, i) => (i === 0 ? [0, 4, 4, 5] : i === 1 ? [3, 0, 5, 4] : f));
    const filas = poule(diagonal, 4).map((f, i) => (i < 2 ? { ...f, celdas: [f.celdas[0], 'V', 'V'] } : f));
    const p = leer(paginaPoules(1, ESPADA, [poule(CON_EVIDENCIA, 0), filas]));
    expect(p.asaltos.some((a) => a.marcador === 'derivado_de_limite')).toBe(false);
    expect(p.excluidos.sinMarcador).toBe(4);
    expect(p.cobertura.poules.estado).toBe('parcial');
  });
});
