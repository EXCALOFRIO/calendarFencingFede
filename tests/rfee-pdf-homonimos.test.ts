import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leerClasificacionIntermedia, nombreEnIntermedia } from '@/lib/ingest/sources/rfee-pdf/intermedia';
import { analizarPagina } from '@/lib/ingest/sources/rfee-pdf/paginas';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import type { PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';

/**
 * TNR absoluto de sable femenino (RFEE:10295, 27-09-2026). Dos hermanas con el mismo nombre
 * truncado y el mismo club («SANCHEZ CORBELLA», SAMA-) en las poules 1 y 9: el lector dejaba sin
 * atribuir sus 12 asaltos, y la poule 1 (la de VILA BAILACH, que gana los seis) salía con 15 de 21.
 * La lectura antigua por modelo guardó además marcadores que no son los del PDF.
 */
const f = JSON.parse(fs.readFileSync(new URL('./fixtures/rfee-pdf/tnr-abs-sable-f-2026-homonimos.json', import.meta.url), 'utf8')) as {
  fuente: { url: string };
  paginas: PaginaTexto[];
};
/** El mismo cifrado de letras del fixture (+7, sin tildes); «DE» es estructura y no se cifra. */
const cifrar = (t: string) => t.split(' ').map((w) => (w === 'DE' ? w : w.replace(/[A-Za-z]/g, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 7) % 26) + base);
}))).join(' ');

describe('poules con hermanas homónimas (fixture real cifrado, RFEE:10295)', () => {
  const p = leerResultadosPdf(f.paginas, { url: f.fuente.url, docId: 'tnr' }).pruebas[0];
  const ref = (inicio: string, posicion?: number) => {
    const l = p.puestos.filter((x) => x.nombre.startsWith(cifrar(inicio)) && (posicion === undefined || x.posicion === posicion));
    expect(l).toHaveLength(1);
    return l[0].ref;
  };
  const poule = (ronda: string) => p.asaltos.filter((a) => a.fase === 'POULE' && a.ronda === ronda);
  const marcador = (ronda: string, a: string, b: string) => {
    const x = poule(ronda).find((y) => (y.refA === a && y.refB === b) || (y.refA === b && y.refB === a))!;
    return x.refA === a ? [x.puntosA, x.puntosB] : [x.puntosB, x.puntosA];
  };

  it('las poules salen completas: 198 de 198 asaltos y ninguno sin atribuir', () => {
    expect(p.cobertura.poules).toMatchObject({ estado: 'completo', publicado: 198, importado: 198 });
    expect(p.rechazos.filter((r) => r.seccion === 'poules')).toEqual([]);
  });

  it('la poule 1 tiene sus 21 asaltos y VILA BAILACH, que gana todos, sus seis victorias', () => {
    expect(poule('P1')).toHaveLength(21);
    const vila = ref('VILA BAILACH');
    const suyos = poule('P1').filter((a) => a.refA === vila || a.refB === vila);
    expect(suyos).toHaveLength(6);
    expect(suyos.every((a) => (a.refA === vila ? a.puntosA > a.puntosB : a.puntosB > a.puntosA))).toBe(true);
  });

  it('la clasificación de poules decide cuál de las hermanas es cuál: la eliminada (61) en la 1, la otra (45) en la 9', () => {
    const sofia = ref('SANCHEZ CORBELLA', 61);
    const celia = ref('SANCHEZ CORBELLA', 45);
    expect(poule('P1').filter((a) => a.refA === sofia || a.refB === sofia)).toHaveLength(6);
    expect(poule('P9').filter((a) => a.refA === celia || a.refB === celia)).toHaveLength(6);
    expect(p.asaltos.some((a) => a.fase === 'POULE' && a.ronda === 'P1' && (a.refA === celia || a.refB === celia))).toBe(false);
    // La eliminada no tira el cuadro: el cuadro ya no duda entre las dos.
    expect(p.asaltos.some((a) => a.fase === 'TABLEAU' && (a.refA === sofia || a.refB === sofia))).toBe(false);
    expect(p.asaltos.some((a) => a.fase === 'TABLEAU' && (a.refA === celia || a.refB === celia))).toBe(true);
  });

  it('los marcadores de DE RIOJA son los del PDF (la lectura por modelo guardó 4-5 y 3-5)', () => {
    const rioja = ref('DE RIOJA');
    expect(marcador('P1', rioja, ref('GONZALEZ CASARES'))).toEqual([3, 5]);
    expect(marcador('P1', rioja, ref('MARTIN PORTUGUES'))).toEqual([1, 5]);
  });

  it('la clasificación de poules se lee con sus totales y el estado de cada tiradora', () => {
    const paginas = f.paginas.map(analizarPagina).filter((x) => x.tipo === 'clasificacion_intermedia');
    const filas = leerClasificacionIntermedia(paginas);
    expect(filas).toHaveLength(68);
    expect(filas.find((x) => x.posicion === 61)).toMatchObject({ vm: 0.167, ind: -16, td: 13, eliminado: true });
    expect(filas.find((x) => x.posicion === 45)).toMatchObject({ vm: 0.333, ind: -5, td: 18, eliminado: false });
  });

  it('un apellido solo no basta para casar con la clasificación de poules (CE cadete 2022: «GARCIA GARCIA» ≠ «GARCÍA PALOMARES»)', () => {
    const fila = { posicion: 40, texto: 'GARCIA GARCIA SASLE', vm: 0.167, ind: -10, td: 19, eliminado: true };
    expect(nombreEnIntermedia('GARCÍA PALOMARES Adriá', fila)).toBe(false);
    expect(nombreEnIntermedia('SANCHEZ CORBELLA Sofia', { ...fila, texto: 'SANCHEZ CORBE SAMA-' })).toBe(true);
  });
});
