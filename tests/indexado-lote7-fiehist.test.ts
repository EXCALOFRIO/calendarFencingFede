import { describe, expect, it } from 'vitest';
import type { ItemTexto, PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';
import { alinearNombres, celdaDe, completarNombre, filaEngarde, leerDocumento, numeroPoule, rondaDeCabecera } from '../scripts/indexado/lote7-fiehist-pdf';
import { enlacesPdf, grupoHist } from '../scripts/indexado/lote7-fiehist-ophardt';

const it_ = (s: string, x: number, y: number): ItemTexto => ({ s, x, y, w: s.length * 4, h: 8 });

/** Cabecera de sección de la documentación de Ophardt (espada masculina júnior individual). */
function cabecera(y = 800): ItemTexto[] {
  return [
    it_('RESULTS: LIST OF RESULTS', 248, y),
    it_('Competition', 184, y - 24), it_('Place', 268, y - 24), it_('Date', 331, y - 24), it_('Category', 363, y - 24),
    it_('Weapon', 401, y - 24), it_('Gender', 434, y - 24), it_('Event', 465, y - 24), it_('Type', 490, y - 24),
    it_('Coupe du Monde', 189, y - 38), it_('2012-01-06', 320, y - 38), it_('J', 378, y - 38), it_('E', 413, y - 38),
    it_('M', 444, y - 38), it_('I', 474, y - 38), it_('A', 497, y - 38),
  ];
}

const pagina = (numero: number, items: ItemTexto[]): PaginaTexto => ({ numero, ancho: 595, alto: 842, items });

/** Fila de poule: nación, nombre, celdas en las columnas 200/240/280 (la propia vacía) y V/M, TD, TR, diferencia. */
function filaPoule(y: number, pais: string, nombre: string, celdas: (string | null)[], stats: number[]): ItemTexto[] {
  const out = [it_(pais, 96, y), it_(nombre, 118, y)];
  celdas.forEach((c, j) => {
    if (c) out.push(it_(c, 200 + 40 * j, y));
  });
  stats.forEach((s, k) => out.push(it_(String(s), 330 + 28 * k, y)));
  return out;
}

describe('lote7-fiehist: documentación PDF de Ophardt', () => {
  it('lee una poule recíproca y descarta la fila cuyos totales no cuadran', () => {
    const buena = pagina(1, [
      ...cabecera(),
      it_('Pool 1 Piste 1 09:00', 80, 700),
      ...filaPoule(686, 'ESP', 'GARCIA Juan', [null, 'V/5', 'D/3'], [0.5, 8, 6, 2]),
      ...filaPoule(672, 'FRA', 'MARTIN Paul', ['D/2', null, 'V/5'], [0.5, 7, 9, -2]),
      ...filaPoule(658, 'ITA', 'ROSSI Luca', ['V/4', 'D/4', null], [0.5, 8, 8, 0]),
    ]);
    const l = leerDocumento([buena], { weapon: 'ESPADA', gender: 'M', category: 'M20' });
    expect(l.poules?.esperados).toBe(3);
    expect(l.poules?.bouts).toHaveLength(3);
    const garciaMartin = l.poules!.bouts.find((b) => b.a.nombre === 'GARCIA Juan' && b.b.nombre === 'MARTIN Paul');
    expect(garciaMartin).toMatchObject({ roundKey: 'P1', scoreA: 5, scoreB: 2, a: { pais: 'ESP' } });

    const mala = pagina(1, [
      ...cabecera(),
      it_('Pool 1 Piste 1 09:00', 80, 700),
      ...filaPoule(686, 'ESP', 'GARCIA Juan', [null, 'V/5', 'D/3'], [0.5, 9, 6, 3]),
      ...filaPoule(672, 'FRA', 'MARTIN Paul', ['D/2', null, 'V/5'], [0.5, 7, 9, -2]),
      ...filaPoule(658, 'ITA', 'ROSSI Luca', ['V/4', 'D/4', null], [0.5, 8, 8, 0]),
    ]);
    const m = leerDocumento([mala]);
    expect(m.poules?.bouts).toHaveLength(1);
    expect(m.poules?.descartados.totales_no_cuadran).toBe(2);
  });

  it('ignora las secciones de otra prueba del mismo documento', () => {
    const otra = pagina(1, [
      ...cabecera().map((i) => (i.s === 'E' ? { ...i, s: 'F' } : i)),
      it_('Pool 1 Piste 1 09:00', 80, 700),
      ...filaPoule(686, 'ESP', 'GARCIA Juan', [null, 'V/5'], [1, 5, 2, 3]),
      ...filaPoule(672, 'FRA', 'MARTIN Paul', ['D/2', null], [0, 2, 5, -3]),
    ]);
    expect(leerDocumento([otra], { weapon: 'ESPADA', gender: 'M', category: 'M20' }).poules).toBeNull();
  });

  it('lee el cuadro por columnas, salta los exentos, quita los cruces repetidos entre bloques y completa nombres recortados', () => {
    const entrada = (x: number, y: number, nombre: string, pais: string | null, marca: string | null) => [
      it_(nombre, x, y), ...(pais ? [it_(pais, x + 74, y)] : []), ...(marca ? [it_(marca, x + 98, y)] : []),
    ];
    const p1 = pagina(1, [
      ...cabecera(),
      it_('Tabla de 8', 31, 696), it_('Semi-finales', 165, 696), it_('Final', 299, 696),
      ...entrada(36, 682, 'ROSATELLI Dam…', 'ITA', 'V/15'),
      ...entrada(36, 664, 'SOBCZAK Piotr', 'POL', 'D/8'),
      ...entrada(36, 635, 'SIDO Alexandre', 'FRA', null),
      it_('BYE', 36, 617),
      ...entrada(36, 588, 'INGARGIOLA Fra…', 'ITA', 'V/15'),
      ...entrada(36, 570, 'MOLINARO Romain', 'FRA', 'D/12'),
      ...entrada(36, 541, 'KHAMZIN Askar', 'RUS', 'V/15'),
      ...entrada(36, 523, 'DAHLIN Kolja', 'DEN', 'D/3'),
      ...entrada(170, 659, 'ROSATELLI Dam…', 'ITA', 'V/15'),
      ...entrada(170, 641, 'SIDO Alexandre', 'FRA', 'D/11'),
      ...entrada(170, 564, 'INGARGIOLA Fra…', 'ITA', 'V/15'),
      ...entrada(170, 546, 'KHAMZIN Askar', 'RUS', 'D/14'),
      ...entrada(303, 612, 'ROSATELLI Dam…', 'ITA', 'V/15'),
      ...entrada(303, 594, 'INGARGIOLA Fra…', 'ITA', 'D/11'),
    ]);
    // Segundo bloque que repite la final.
    const p2 = pagina(2, [
      ...cabecera(),
      it_('Final', 31, 696),
      ...entrada(36, 682, 'ROSATELLI Dam…', 'ITA', 'V/15'),
      ...entrada(36, 664, 'INGARGIOLA Fra…', 'ITA', 'D/11'),
    ]);
    const clasif = pagina(3, [
      ...cabecera(),
      it_('Rank', 31, 700), it_('Points', 80, 700), it_('Name', 150, 700),
      it_('1', 31, 686), it_('32', 80, 686), it_('ROSATELLI Damiano', 150, 686), it_('ITA', 400, 686),
      it_('2', 31, 672), it_('26', 80, 672), it_('INGARGIOLA Francesco', 150, 672), it_('ITA', 400, 672),
    ]);
    const l = leerDocumento([clasif, p1, p2], { weapon: 'ESPADA', gender: 'M', category: 'M20' });
    const rondas = Object.fromEntries(['A8', 'A4', 'A2'].map((r) => [r, l.cuadro!.bouts.filter((b) => b.roundKey === r).length]));
    expect(rondas).toEqual({ A8: 3, A4: 2, A2: 1 });
    expect(l.cuadro?.esperados).toBe(6);
    expect(l.cuadro?.completo).toBe(true);
    const final = l.cuadro!.bouts.find((b) => b.roundKey === 'A2')!;
    expect(final).toMatchObject({ a: { nombre: 'ROSATELLI Damiano' }, b: { nombre: 'INGARGIOLA Francesco' }, scoreA: 15, scoreB: 11 });
    expect(l.puestos).toHaveLength(2);
  });

  it('reconoce las cabeceras de ronda en varios idiomas', () => {
    expect(rondaDeCabecera('Tabla de 64')).toBe(64);
    expect(rondaDeCabecera('Table of 128')).toBe(128);
    expect(rondaDeCabecera('Semi-finales')).toBe(4);
    expect(rondaDeCabecera('Final')).toBe(2);
    expect(rondaDeCabecera('Finale')).toBe(2);
    expect(rondaDeCabecera('Pool 3')).toBeNull();
  });

  it('completa un nombre recortado sólo si hay un único candidato de la misma nación', () => {
    const completos = [{ nombre: 'CIUTI Matteo', pais: 'ITA' }, { nombre: 'CIUTI Tommaso', pais: 'ITA' }];
    expect(completarNombre({ nombre: 'CIUTI Tom', pais: 'ITA', truncado: true }, completos).nombre).toBe('CIUTI Tommaso');
    expect(completarNombre({ nombre: 'CIUTI', pais: 'ITA', truncado: true }, completos).nombre).toBe('CIUTI');
    expect(completarNombre({ nombre: 'CIUTI Tom', pais: 'FRA', truncado: true }, completos).nombre).toBe('CIUTI Tom');
  });
});

describe('lote7-fiehist: formatos anteriores', () => {
  it('lee las celdas y cabeceras del formato anterior de Ophardt', () => {
    expect(celdaDe('5V')).toEqual({ v: true, n: 5 });
    expect(celdaDe('14 D')).toEqual({ v: false, n: 14 });
    expect(celdaDe('V/15')).toEqual({ v: true, n: 15 });
    expect(celdaDe('---')).toBeNull();
    expect(rondaDeCabecera('Tableau 64/32')).toBe(64);
    expect(rondaDeCabecera('Tableau 160-96')).toBe(160);
    expect(rondaDeCabecera('Quads de final')).toBe(8);
    expect(numeroPoule([it_('Poule No:', 62, 700), it_('1', 108, 700), it_('Arbitre: X (GER)', 116, 700)])).toBe(1);
    expect(numeroPoule([it_('Poule no 12', 71, 700)])).toBe(12);
    expect(numeroPoule([it_('Poules, round no 1', 71, 700)])).toBeNull();
  });

  it('lee una fila de poule de Engarde con la diagonal en «X» o en blanco', () => {
    const conX = filaEngarde('WILLIS Jonathan GBR V 1 V3 3 X 3 2/5 -5 15'.split(' '), 6, 4);
    expect(conX?.t).toEqual({ nombre: 'WILLIS Jonathan', pais: 'GBR' });
    expect(conX?.celdas).toEqual([{ v: true, n: 5 }, { v: false, n: 1 }, { v: true, n: 3 }, { v: false, n: 3 }, null, { v: false, n: 3 }]);
    expect(conX?.hs).toBe(15);
    const sinX = filaEngarde('JU Hyun Seung KOR 2 V V V 2 V 4/6 10 24'.split(' '), 7, 0);
    expect(sinX?.celdas[0]).toBeNull();
    expect(sinX?.celdas.slice(1)).toEqual([{ v: false, n: 2 }, { v: true, n: 5 }, { v: true, n: 5 }, { v: true, n: 5 }, { v: false, n: 2 }, { v: true, n: 5 }]);
    expect(filaEngarde('MOODY Jimmy USA S S S S S S forfait1'.split(' '), 7, 3)).toBeNull();
  });

  it('alinea variantes de nombre con la clasificación sólo si el candidato es único', () => {
    const lectura = {
      poules: { esperados: 1, descartados: {}, bouts: [{ phase: 'POULE' as const, roundKey: 'P1', a: { nombre: 'CANA Kelvin', pais: 'VEN' }, b: { nombre: 'KELSEY Weston Seth', pais: 'USA' }, scoreA: 5, scoreB: 3, winner: null }] },
      cuadro: null,
    };
    const n = alinearNombres(lectura, [{ nombre: 'CANA INFANTE Kelvin', pais: 'VEN' }, { nombre: 'KELSEY Seth', pais: 'USA' }, { nombre: 'KELSEY Weston', pais: 'USA' }]);
    expect(n).toBe(1);
    expect(lectura.poules.bouts[0].a.nombre).toBe('CANA INFANTE Kelvin');
    expect(lectura.poules.bouts[0].b.nombre).toBe('KELSEY Weston Seth');
  });
});

describe('lote7-fiehist: Ophardt', () => {
  it('agrupa las ediciones FIE por campeonato', () => {
    expect(grupoHist('Championnats du Monde', 'ABS')?.grupo).toBe('Mundiales');
    expect(grupoHist('Champ du monde juniors-cadets', 'M17')?.grupo).toBe('Mundiales júnior-cadete');
    expect(grupoHist("Championnats d'Europe Cadets", 'M17')?.grupo).toBe('Europeos');
    expect(grupoHist('Jeux Olympiques de la Jeunesse', 'M17')?.grupo).toBe('JOJ');
    expect(grupoHist('Coupe du Monde', 'M20')?.mismoPais).toBe(true);
  });

  it('prefiere el PDF de la sección y si no usa la documentación del torneo', () => {
    const conSeccion = '<th><a href="/cdn/documents/documentation/../legacy-documentation/123.pdf">x</a></th><th>Epee Men\'s U20 Individual</th><th width="200"';
    expect(enlacesPdf(conSeccion, "Epee Men's U20 Individual")).toEqual(['https://fencing.ophardt.online/cdn/documents/legacy-documentation/123.pdf']);
    const torneo = '<a href="https://fencing.ophardt.online/cdn/documents/documentation/692-1999.pdf">doc</a>';
    expect(enlacesPdf(torneo, 'Epee Women\'s Senior Individual')).toEqual(['https://fencing.ophardt.online/cdn/documents/documentation/692-1999.pdf']);
  });
});
