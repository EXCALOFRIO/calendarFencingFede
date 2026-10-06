import { describe, expect, it } from 'vitest';
import { hechosPrueba } from '@/lib/ingest/hechos/formato';
import { docIdDeUrl } from '@/lib/ingest/sources/rfee-pdf/lectura';
import type { PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';
import { convertirPrueba, emparejar } from '../scripts/indexado/lote7-clubes-hechos';
import { asaltosDePoule, grupos, leerClasificacion, leerCuadro, leerPoules, nombresCasan } from '../scripts/indexado/lote7-clubes-impreso';
import { EVENTOS } from '../scripts/indexado/lote7-clubes-eventos';

type T = [string, number, number];
const pagina = (numero: number, textos: T[]): PaginaTexto => ({
  numero, ancho: 595, alto: 841, items: textos.map(([s, x, y]) => ({ s, x, y, w: s.length * 5, h: 10 })),
});
const cabecera: T[] = [['25/1/2018', 26, 819], ['TNR JUNIOR ESPADA FEMENINA', 256, 819], ['TNR JUNIOR', 213, 772]];

const clasificacion = (): PaginaTexto[] => [
  pagina(1, [
    ...cabecera,
    ['Clasificación general final', 34, 644],
    ['Cl.', 43.6, 612], ['Apellido nom', 119.7, 612], ['Nombre', 262, 612], ['Nación', 332.5, 612], ['Club', 395.9, 612],
    ['1', 52, 595.5], ['ALFA RUIZ', 74.2, 595.5], ['Ana', 246.7, 595.5], ['ESP', 332.2, 595.5], ['CE SG', 382.5, 595.5],
    ['2', 52, 579], ['BETA SANCHEZ DE TOCA', 74.1, 579], ['Bea', 246.7, 579], ['ESP', 332.2, 579], ['UTB', 382.5, 579], ['Z', 405, 579],
    ['3', 52, 562.5], ['GAMMA LOPEZ', 74.2, 562.5], ['Gema', 246.7, 562.5], ['CHI', 332.2, 562.5], ['CHI', 382.5, 562.5],
    ['Document Engarde', 34, 424.5], ['22/01/2018 21:54:07', 112.6, 424.5],
  ]),
];

const poules = (): PaginaTexto[] => [
  pagina(1, [
    ...cabecera,
    ['Poules, vuelta no 1', 34, 644.3],
    ['Poule no 1', 87.6, 612.8], ['V/M', 446.3, 612.8], ['Td tr', 493.1, 612.8], ['TD', 536.4, 612.8],
    // A gana a B 5-3; C gana a A por prioridad 2-2; B gana a C 4-1.
    ['ALFA RUIZ Ana', 40, 597], ['Ce Sg', 184, 597], ['V', 286, 597], ['2', 308.5, 597], ['1/2', 433, 597], ['2', 488.5, 597], ['7', 530.5, 597],
    // Nombre largo partido por encima y por debajo de la fila.
    ['BETA SANCHEZ DE', 40, 587.3], ['Utb', 184, 581.3], ['Z', 207.1, 581.3], ['3', 263.5, 581.3], ['V4', 308.5, 581.3], ['1/2', 433, 581.3], ['1', 488.5, 581.3], ['7', 530.5, 581.3],
    ['TOCA Bea', 40, 575.3],
    ['GAMMA LOPEZ Gema', 40, 565.5], ['Chi', 184, 565.5], ['V2', 263.5, 565.5], ['1', 286, 565.5], ['1/2', 433, 565.5], ['3', 491.8, 565.5], ['3', 530.5, 565.5],
  ]),
];

const cuadro = (final = '15/12'): PaginaTexto[] => [
  pagina(1, [
    ...cabecera,
    ['Tabla de 4', 56.8, 644.3],
    ['1', 40.1, 609], ['ALFA RUIZ', 52.2, 614.3], ['Ana', 49.8, 602.3], ['Ce', 136.2, 614.3], ['Sg', 133.8, 602.3],
    ['4', 35.1, 560],
    ['ALFA RUIZ', 173.7, 588], ['Ana', 171.3, 576],
    ['3', 40.1, 505], ['GAMMA LOPEZ', 52.2, 510], ['Gema', 49.8, 498], ['Chi', 136.2, 510],
    ['ALFA RUIZ Ana', 244.2, 533], [final, 251.6, 521],
    ['2', 40.1, 450], ['BETA SANCHEZ DE', 52.2, 456], ['TOCA Bea', 49.8, 444], ['Utb', 136.2, 456], ['Z', 145, 456],
    ['BETA SANCHEZ DE', 173.7, 478], ['TOCA Bea', 171.3, 466], ['15/9', 181.1, 454],
    ['Tercer lugar', 56.8, 300],
    ['1', 40.8, 270], ['DELTA Dina', 53, 270], ['Ceb M', 203, 270],
    ['EPSI Eva', 278, 256],
    ['2', 40.8, 242], ['EPSI Eva', 53, 242], ['Sam B', 203, 242], ['15/14', 285.4, 242],
  ]),
];

describe('lote7-clubes: lector de impresiones HTML de Engarde', () => {
  it('lee la clasificación con club partido y país', () => {
    const { filas } = leerClasificacion(clasificacion());
    expect(filas.map((f) => [f.posicion, f.nombre, f.pais, f.club])).toEqual([
      [1, 'ALFA RUIZ Ana', 'ESP', 'CE SG'],
      [2, 'BETA SANCHEZ DE TOCA Bea', 'ESP', 'UTB Z'],
      [3, 'GAMMA LOPEZ Gema', 'CHI', 'CHI'],
    ]);
  });

  it('lee la poule, valida la matriz y respeta la victoria por prioridad', () => {
    const { poules: ps, avisos } = leerPoules(poules());
    expect(avisos).toEqual([]);
    expect(ps).toHaveLength(1);
    expect(ps[0].filas.map((f) => f.nombre)).toEqual(['ALFA RUIZ Ana', 'BETA SANCHEZ DE TOCA Bea', 'GAMMA LOPEZ Gema']);
    expect(ps[0].filas[1].club).toBe('Utb Z');
    const { asaltos, errores } = asaltosDePoule(ps[0]);
    expect(errores).toEqual([]);
    expect(asaltos.map((a) => [a.a, a.ta, a.tb, a.b, a.ganador])).toEqual([
      ['ALFA RUIZ Ana', 5, 3, 'BETA SANCHEZ DE TOCA Bea', null],
      ['ALFA RUIZ Ana', 2, 2, 'GAMMA LOPEZ Gema', 'B'],
      ['BETA SANCHEZ DE TOCA Bea', 4, 1, 'GAMMA LOPEZ Gema', null],
    ]);
  });

  it('rechaza una poule cuyos TD no cuadran con la matriz', () => {
    const p = leerPoules(poules()).poules[0];
    p.filas[0].td = 8;
    const r = asaltosDePoule(p);
    expect(r.asaltos).toEqual([]);
    expect(r.errores).toContain('td_1:8!=7');
  });

  it('lee el cuadro en árbol con exento y tercer puesto', () => {
    const r = leerCuadro(cuadro());
    expect(r.errores).toEqual([]);
    expect(r.byes).toBe(1);
    expect(r.cruces).toEqual([
      { ronda: 'T4', a: 'GAMMA LOPEZ Gema', b: 'BETA SANCHEZ DE TOCA Bea', ganador: 'B', ta: 9, tb: 15 },
      { ronda: 'T2', a: 'ALFA RUIZ Ana', b: 'BETA SANCHEZ DE TOCA Bea', ganador: 'A', ta: 15, tb: 12 },
      { ronda: 'T2-3', a: 'DELTA Dina', b: 'EPSI Eva', ganador: 'B', ta: 14, tb: 15 },
    ]);
  });

  it('no inventa un cruce si el ganador no es ninguno de los dos', () => {
    const p = cuadro();
    p[0].items = p[0].items.map((i) => (i.s === 'ALFA RUIZ Ana' && i.x > 240 ? { ...i, s: 'OTRA PERSONA' } : i));
    const r = leerCuadro(p);
    expect(r.errores.some((e) => e.startsWith('ganador_no_casa:T2'))).toBe(true);
  });

  it('agrupa posiciones y empareja nombres recortados', () => {
    expect(grupos([52.2, 49.8, 136.2, 133.8, 173.7], 5).map(Math.round)).toEqual([51, 135, 174]);
    expect(nombresCasan('MERINO MATIA Monica', 'Monica MERINO MATIA')).toBe(true);
    expect(nombresCasan('LETE MUÑOZ-REPISO', 'LETE MUÑOZ-REPISO Mateo')).toBe(true);
    expect(emparejar('ALFA', [{ factKey: 'a', name: 'ALFA RUIZ Ana' }])).toBeNull();
  });
});

describe('lote7-clubes: hechos', () => {
  const ev = { ...EVENTOS[0] };
  const prueba = { ...ev.pruebas[2] };
  const doc = (url: string, paginas: PaginaTexto[]) => ({ url, sha256: 'a'.repeat(64), paginas });

  it('produce un fichero válido con claves derivadas de la URL de la página', () => {
    const { hechos } = convertirPrueba(ev, prueba, {
      clasificacion: doc(prueba.clasificacion, clasificacion()),
      poules: doc(prueba.poules!, poules()),
      cuadro: doc(prueba.cuadro!, cuadro()),
    });
    expect(hechosPrueba.parse(hechos)).toBeTruthy();
    const docId = docIdDeUrl(ev.paginaUrl);
    expect(hechos.edition.tournamentKey).toBe(`pdf:${docId}`);
    expect(hechos.competition.competitionKey).toBe(`pdf:${docId}:ESPADA:F:INDIVIDUAL:M20`);
    expect(hechos.status).toMatchObject({ results: 'completo', pools: 'completo', tableau: 'completo' });
    // El tercer puesto entre tiradores ausentes de la clasificación queda con referencia local.
    expect(hechos.bouts.filter((b) => b.phase === 'POULE')).toHaveLength(3);
    expect(hechos.bouts.filter((b) => b.phase === 'TABLEAU')).toHaveLength(3);
    for (const b of hechos.bouts) expect(b.aRef < b.bRef).toBe(true);
    const keys = new Set(hechos.results.map((r) => r.factKey));
    const finalB = hechos.bouts.find((b) => b.roundKey === 'T2')!;
    expect(keys.has(finalB.aRef) && keys.has(finalB.bRef)).toBe(true);
    const prioridad = hechos.bouts.find((b) => b.scoreA === 2 && b.scoreB === 2)!;
    expect(prioridad.winner).toBe(prioridad.aName === 'GAMMA LOPEZ Gema' ? 'A' : 'B');
  });

  it('no envía el cuadro si el podio no casa con la clasificación', () => {
    const c = cuadro();
    // Final ganada por BETA: contradice el 1.º de la clasificación.
    c[0].items = c[0].items.map((i) => (i.s === 'ALFA RUIZ Ana' && i.x > 240 ? { ...i, s: 'BETA SANCHEZ DE TOCA Bea' } : i));
    const { hechos } = convertirPrueba(ev, prueba, {
      clasificacion: doc(prueba.clasificacion, clasificacion()), poules: null, cuadro: doc(prueba.cuadro!, c),
    });
    expect(hechos.status.tableau).toBe('parcial');
    expect(hechos.bouts.filter((b) => b.phase === 'TABLEAU')).toEqual([]);
  });

  it('el catálogo sólo trae URLs https y fechas del evento', () => {
    for (const e of EVENTOS) {
      for (const p of e.pruebas) {
        for (const u of [p.clasificacion, p.poules, p.cuadro].filter(Boolean)) expect(u!.startsWith('https://')).toBe(true);
        expect(p.fecha >= e.inicio && p.fecha <= e.fin).toBe(true);
      }
    }
  });
});
