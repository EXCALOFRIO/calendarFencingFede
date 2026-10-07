import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analizarPagina, type PaginaAnalizada } from '@/lib/ingest/sources/rfee-pdf/paginas';
import { leerMatricesPoules, leerPoules, type PouleLeida } from '@/lib/ingest/sources/rfee-pdf/poules';
import type { PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';
import { cabecera, fila, pagina } from './fixtures/rfee-pdf/sintetico';

/**
 * Poules de PDF reales de la RFEE que el lector rechazaba entero (lote 11): tiradores retirados,
 * «Poules, tour», V/M truncado a dos cifras, club numérico, celdas pegadas y victorias por
 * prioridad. Fixtures con nombres, clubes y árbitros cifrados (+7 por letra, «DE» sin cifrar).
 */
const paginasDe = (nombre: string): PaginaAnalizada[] => {
  const f = JSON.parse(fs.readFileSync(new URL(`./fixtures/rfee-pdf/${nombre}`, import.meta.url), 'utf8')) as { paginas: PaginaTexto[] };
  return f.paginas.map(analizarPagina).filter((p) => p.tipo === 'poules');
};
const leer = (nombre: string) => {
  const grupos = new Map<string, PaginaAnalizada[]>();
  for (const p of paginasDe(nombre)) (grupos.get(p.firma) ?? grupos.set(p.firma, []).get(p.firma)!).push(p);
  return [...grupos.values()].flatMap((g) => leerMatricesPoules(g).lecturas);
};
const leidas = (nombre: string) => leer(nombre).filter((l): l is PouleLeida => 'matriz' in l);
const poule = (nombre: string, ronda: string) => {
  const l = leidas(nombre).filter((x) => x.ronda === ronda);
  expect(l).toHaveLength(1);
  return l[0];
};
/** Fila `i` de la matriz como la publica el PDF, con la `V` sin número ya resuelta: «- 0 V5 V5 2 2». */
const filaMatriz = (p: PouleLeida, i: number) => p.matriz.celdas[i].map((c, k) => (k === i ? '-' : `${c.gana ? 'V' : ''}${c.puntos ?? '?'}`)).join(' ');

describe('tiradores retirados en la poule', () => {
  it('abandono («A … DNF»): su fila sale de la matriz y los rivales cuadran V/M, TD e índice sin él', () => {
    const l = leer('poules-retirado-abandono.json');
    expect(l.filter((x) => !('matriz' in x))).toEqual([]);
    const p = poule('poules-retirado-abandono.json', 'P6');
    expect(p.retirados).toMatchObject([{ nombre: 'IPZWV Thubls', marca: 'A', estado: 'DNF', rivales: 6 }]);
    expect(p.filas).toHaveLength(6);
    expect(p.filas[0]).toMatchObject({ nombre: 'THYAPU WVSV Kplnv', vm: 0.4, ind: -5, td: 14 });
    expect(filaMatriz(p, 0)).toBe('- 0 V5 V5 2 2');
    expect(filaMatriz(p, 5)).toBe('V5 V5 V5 V5 V5 -');
    expect(p.matriz.sinResolver).toBe(0);
  });

  it('abandono con celdas pegadas tras la X («X | V V2 0»): cada celda va con su rival, no desplazada', () => {
    const p = poule('poules-retirado-celdas-pegadas.json', 'P15');
    expect(p.retirados.map((r) => r.nombre)).toEqual(['HNBPSLYH SBPZ Obt']);
    // La lectura antigua guardó 4-5, 5-1 y 2-5: las columnas corridas una posición.
    expect(p.filas[0].nombre).toBe('IPUKLY HYYVFV Nhi');
    expect(filaMatriz(p, 0)).toBe('- V5 V2 0 V5 4');
    expect(filaMatriz(p, 1)).toBe('4 - V4 2 4 2');
    expect(filaMatriz(p, 2)).toBe('1 2 - 2 3 V5');
    expect(leidas('poules-retirado-celdas-pegadas.json').map((x) => x.ronda)).toEqual(['P13', 'P14', 'P15', 'P16']);
  });

  it('no presentado («C … cesión»)', () => {
    const p = poule('poules-retirado-cesion.json', 'P1');
    expect(p.retirados).toMatchObject([{ nombre: 'CPSSHKVUPNH THY', marca: 'C', estado: 'CESIÓN' }]);
    expect(p.filas.map((f) => f.vm)).toEqual([0.4, 0.2, 0.8, 0, 0.6, 1]);
  });

  it('un retirado cuyo rival publica tanteo en su columna no es un retirado limpio: la poule se rechaza', () => {
    const cab = cabecera('ESPADA MASCULINA');
    const filas = [
      fila(770, [11, 'Poules, vuelta No 1']),
      fila(740, [11, 'Poule No 1']),
      fila(716, [301, 'V/M'], [342, 'ind.'], [376, 'TD'], [407, 'cl.']),
      fila(704, [17, 'UNO Ana'], [125, 'C1'], [210, 'V'], [223, 'V'], [236, '3'], [301, '0.667'], [350, '7'], [380, '10'], [412, '1']),
      fila(692, [17, 'DOS Bea'], [125, 'C2'], [197, '1'], [223, 'V'], [236, 'X'], [301, '0.500'], [350, '-2'], [380, '6'], [412, '2']),
      fila(680, [17, 'TRES Cris'], [125, 'C3'], [197, '2'], [210, '3'], [236, 'X'], [301, '0.000'], [350, '-5'], [380, '5'], [412, '3']),
      fila(668, [17, 'CUATRO Dora'], [125, 'C4'], [197, 'A'], [210, 'A'], [223, 'A'], [301, 'DNF']),
    ];
    const l = leerMatricesPoules([analizarPagina(pagina(2, [...cab, ...filas]))]).lecturas;
    expect(l).toMatchObject([{ motivo: 'Un cruce con un tirador retirado publica tanteo' }]);
  });
});

describe('poules en francés con V/M truncado', () => {
  it('«Poules, tour No 1» declara la vuelta; «0,16» y «0,66» son 1/6 y 4/6 truncados; «F … forfai» es un retirado', () => {
    const l = leer('poules-tour-forfait-vm-truncado.json');
    expect(l.filter((x) => !('matriz' in x))).toEqual([]);
    expect(l.map((x) => ('matriz' in x ? x.ronda : null))).toEqual(['P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14']);
    const truncados = leidas('poules-tour-forfait-vm-truncado.json').flatMap((p) => p.filas.map((f, i) => ({ f, v: p.matriz.celdas[i].filter((c) => c.gana).length / (p.filas.length - 1) })))
      .filter(({ f, v }) => f.vmDecimales === 2 && Math.round(v * 100) !== Math.round(f.vm * 100));
    expect(truncados.length).toBeGreaterThan(0);
    for (const { f, v } of truncados) expect(Math.floor(v * 100 + 1e-9)).toBe(Math.round(f.vm * 100));
    const p7 = poule('poules-tour-forfait-vm-truncado.json', 'P7');
    expect(p7.retirados).toMatchObject([{ nombre: 'SPCPUNZAVUL W', marca: 'F', estado: 'FORFAI' }]);
    expect(filaMatriz(p7, 1)).toBe('V5 - V5 V5 2 V5');
  });
});

describe('filas que el lector no partía bien', () => {
  it('club truncado en cifras («100») en la columna del club: no es una celda', () => {
    const l = leer('poules-club-numerico.json');
    expect(l.filter((x) => !('matriz' in x))).toEqual([]);
    const p = poule('poules-club-numerico.json', 'P1');
    expect(p.filas[4]).toMatchObject({ nombre: 'ILSTVUAL THYPU Fvuhah', club: '100' });
    expect(filaMatriz(p, 4)).toBe('3 V5 V5 V5 - 1 V5');
  });

  it('celdas pegadas sin espacio («V4V»): se separan por la V', () => {
    const p = poule('poules-celdas-pegadas.json', 'P1');
    expect(p.filas).toHaveLength(9);
    expect(filaMatriz(p, 0)).toBe('- V4 V5 V5 V5 V5 V5 V5 3');
  });
});

describe('victoria por prioridad con los tocados iguales', () => {
  it('«V0» frente a «0» cuadra con los totales; la poule se lee, pero ese asalto no se emite', () => {
    const p = poule('poules-prioridad.json', 'P5');
    expect(p.matriz.prioridad).toBe(1);
    expect(filaMatriz(p, 6)).toBe('V0 V5 1 V4 4 0 -');
    expect(filaMatriz(p, 0).split(' ')[6]).toBe('0');
    const todas = leidas('poules-prioridad.json');
    const registro = todas.flatMap((x, k) => x.filas.map((f, i) => ({ ref: `r${k}-${i}`, nombre: f.nombre, club: f.club })));
    const r = leerPoules(paginasDe('poules-prioridad.json'), registro);
    expect(r.asaltos.filter((a) => a.ronda === 'P5')).toHaveLength(20);
    expect(r.asaltos.some((a) => a.puntosA === a.puntosB)).toBe(false);
    expect(r.excluidos.sinGanador).toBe(1);
    expect(r.rechazos.map((x) => x.motivo)).toContain('1 victorias por prioridad con los tocados iguales: el marcador no dice quién ganó y no se guardan');
  });

  it('un ganador con menos tocados que el perdedor sigue siendo un error de lectura', () => {
    const cab = cabecera('ESPADA MASCULINA');
    const filas = [
      fila(770, [11, 'Poules, vuelta No 1']),
      fila(740, [11, 'Poule No 1']),
      fila(716, [301, 'V/M'], [342, 'ind.'], [376, 'TD'], [407, 'cl.']),
      fila(704, [17, 'UNO Ana'], [125, 'C1'], [210, 'V2'], [223, 'V'], [301, '1.000'], [350, '3'], [380, '7'], [412, '1']),
      fila(692, [17, 'DOS Bea'], [125, 'C2'], [197, '3'], [223, 'V'], [301, '0.500'], [350, '4'], [380, '8'], [412, '2']),
      fila(680, [17, 'TRES Cris'], [125, 'C3'], [197, '1'], [210, '2'], [301, '0.000'], [350, '-7'], [380, '3'], [412, '3']),
    ];
    const l = leerMatricesPoules([analizarPagina(pagina(2, [...cab, ...filas]))]).lecturas;
    expect(l).toMatchObject([{ motivo: 'El ganador no tiene más tocados que el perdedor' }]);
  });
});
