import { describe, expect, it } from 'vitest';
import {
  acuerdoClasificacion, cubreHueco, divisionDePrueba, grupoContenido, marcadorImposible, quitarNacionEnCuadro, tramoVet,
  traducirRotulosItalianos, validarPrueba, type Hueco,
} from '../scripts/indexado/lote8c-engarde';
import { DESCARTES, veredictoEngarde } from '../scripts/indexado/lote8c-huecos';
import { parsearPaginaEngarde } from '../src/lib/ingest/sources/engarde';
import { parsearCuadroEngarde } from '../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../src/lib/ingest/sources/engarde-poules';
import type { AsaltoHecho, HechosPrueba } from '../src/lib/ingest/hechos/formato';

const hueco = (x: Partial<Hueco> = {}): Hueco => ({
  id: 'rfee:x', prioridad: 1, fuente: 'RFEE', temporada: '2024-2025', fecha: '2024-11-30', nombre: 'FENCING FOR EVERYONE', arma: 'FLORETE', genero: 'M',
  categoria: 'M23', formato: 'INDIVIDUAL', faltan: ['clasificacion', 'poules', 'cuadro'], estadoBusqueda: 'sin_fuente', categoriaOriginal: 'M23', ...x,
});
const atributos = { weapon: 'FLORETE', gender: 'M', category: 'M23', format: 'INDIVIDUAL', fecha: '2024-12-01', division: null };

const asalto = (x: Partial<AsaltoHecho>): AsaltoHecho => ({ phase: 'TABLEAU', roundKey: 'T8', aRef: 'a', bRef: 'b', aName: 'A A', bName: 'B B', scoreA: 15, scoreB: 10, winner: null, ...x });
const prueba = (bouts: AsaltoHecho[], format: 'INDIVIDUAL' | 'EQUIPOS' = 'INDIVIDUAL'): HechosPrueba => ({
  version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: 'https://engarde-service.com/competition/o/e/c', sourceSha256: 'a'.repeat(64),
  edition: { season: '2024-2025', tournamentKey: 'engarde:o/e', name: 'X', startDate: '2024-11-30', endDate: '2024-11-30', city: null, countryCode: null },
  competition: { competitionKey: 'engarde:o/e/c', weapon: 'FLORETE', gender: 'M', category: 'M23', categoryRaw: null, format, date: '2024-11-30' },
  status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: null, notes: [] },
  results: [], bouts,
});

describe('lote8c-engarde: atribución a huecos', () => {
  it('reconoce la división de liga por el código cuando el título la abrevia', () => {
    expect(divisionDePrueba('Liga Nacional Clubes Florete Masculino O.', 'fmoro')).toBe('ORO');
    expect(divisionDePrueba('Liga Nacional Clubes Florete Masculino P.', 'fmplata')).toBe('PLATA');
    expect(divisionDePrueba('LIGA PLATA FEMENINA', 'x')).toBe('PLATA');
    expect(divisionDePrueba('ESPADA FEMENINA', 'tnr_valladolid_21-22_ef_eq_iber')).toBe('IBERDROLA');
    expect(divisionDePrueba('TNR FMA', 'tnr_madrid_florete')).toBeNull();
  });

  it('cubre el hueco con arma, género, categoría, modalidad y fecha a ±2 días', () => {
    expect(cubreHueco(hueco(), atributos, null)).toBe(true);
    expect(cubreHueco(hueco({ fecha: '2024-12-04' }), atributos, null)).toBe(false);
    expect(cubreHueco(hueco({ genero: 'F' }), atributos, null)).toBe(false);
    expect(cubreHueco(hueco(), { ...atributos, gender: 'MIXTO' }, null)).toBe(false);
    expect(cubreHueco(hueco({ categoria: 'M20' }), atributos, null)).toBe(false);
  });

  it('respeta la división de liga y el tramo de veteranos de la fila', () => {
    const liga = { ...atributos, category: 'ABS', format: 'EQUIPOS', division: 'PLATA' };
    expect(cubreHueco(hueco({ nombre: 'LIGA ORO', categoria: 'ABS', formato: 'EQUIPOS' }), liga, null)).toBe(false);
    expect(cubreHueco(hueco({ nombre: 'Liga de clubes', categoria: 'ABS', formato: 'EQUIPOS' }), liga, null)).toBe(true);
    const vet = { ...atributos, category: 'VET' };
    expect(tramoVet('VET70')).toBe('70');
    expect(cubreHueco(hueco({ categoria: 'VET', categoriaOriginal: 'VET70' }), vet, 'V30-40')).toBe(false);
    expect(cubreHueco(hueco({ categoria: 'VET', categoriaOriginal: 'VET70' }), vet, 'V60-70')).toBe(true);
    expect(cubreHueco(hueco({ categoria: 'VET', categoriaOriginal: 'VET70' }), vet, null)).toBe(true);
  });

  it('une poules mixtas sólo a tablones de un grupo de edad que las contiene', () => {
    expect(grupoContenido('N2012', 'N2012-2013')).toBe(true);
    expect(grupoContenido('N2013', 'N2012')).toBe(false);
    expect(grupoContenido('N2012', 'N2012')).toBe(true);
  });
});

describe('lote8c-engarde: validación', () => {
  it('marca los marcadores imposibles', () => {
    expect(marcadorImposible(asalto({ scoreA: 16, scoreB: 3 }), false)).toMatch(/encima de 15/);
    expect(marcadorImposible(asalto({ phase: 'POULE', scoreA: 6, scoreB: 3 }), false)).toMatch(/encima de 5/);
    expect(marcadorImposible(asalto({ scoreA: 10, scoreB: 10 }), false)).toBe('empate sin ganador');
    expect(marcadorImposible(asalto({ scoreA: 9, scoreB: 10, winner: 'A' }), false)).toBe('gana quien tiene menos tocados');
    expect(marcadorImposible(asalto({ scoreA: 10, scoreB: 10, winner: 'B' }), false)).toBeNull();
    expect(marcadorImposible(asalto({ scoreA: 45, scoreB: 38 }), true)).toBeNull();
    expect(marcadorImposible(asalto({ scoreA: 46, scoreB: 38 }), true)).toMatch(/encima de 45/);
  });

  it('descarta un asalto imposible y deja la fase parcial', () => {
    const bouts = Array.from({ length: 12 }, (_, i) => asalto({ phase: 'POULE', roundKey: 'P1', aRef: `a${i}`, bRef: `b${i}`, scoreA: 5, scoreB: 2 }));
    bouts.push(asalto({ phase: 'POULE', roundKey: 'P1', aRef: 'x', bRef: 'y', scoreA: 7, scoreB: 2 }));
    const v = validarPrueba(prueba(bouts));
    expect(v.descartes).toHaveLength(1);
    expect(v.hechos.bouts).toHaveLength(12);
    expect(v.hechos.status.pools).toBe('parcial');
    expect(v.fasesRetiradas).toEqual([]);
  });

  it('retira la fase entera si los imposibles pasan del 10 %', () => {
    const bouts = [asalto({ phase: 'POULE', scoreA: 5, scoreB: 1 }), asalto({ phase: 'POULE', aRef: 'c', bRef: 'd', scoreA: 9, scoreB: 1 })];
    const v = validarPrueba(prueba(bouts));
    expect(v.fasesRetiradas).toEqual(['POULE']);
    expect(v.hechos.bouts).toHaveLength(0);
    expect(v.hechos.status.pools).toBe('ilegible');
  });

  it('retira un cuadro incoherente (un perdedor que sigue)', () => {
    const bouts = [
      asalto({ roundKey: 'T4', aRef: 'a', bRef: 'b', scoreA: 15, scoreB: 3 }),
      asalto({ roundKey: 'T4', aRef: 'c', bRef: 'd', scoreA: 15, scoreB: 9 }),
      asalto({ roundKey: 'T2', aRef: 'b', bRef: 'c', scoreA: 15, scoreB: 12 }),
    ];
    const v = validarPrueba(prueba(bouts));
    expect(v.fasesRetiradas).toEqual(['TABLEAU']);
    expect(v.hechos.status.tableau).toBe('ilegible');
  });

  it('mide el acuerdo con la clasificación oficial', () => {
    const a = [{ name: 'PEREZ Ana', position: 1 }, { name: 'GIL Eva', position: 2 }, { name: 'RUIZ Sara', position: 3 }, { name: 'SANZ Lia', position: 3 }, { name: 'OTRA Una', position: 5 }];
    const b = [{ name: 'Ana PEREZ', position: 1 }, { name: 'GIL Eva', position: 2 }, { name: 'RUIZ Sara', position: 3 }, { name: 'SANZ Lia', position: 4 }];
    const r = acuerdoClasificacion(a, b);
    expect(r).toEqual({ comunes: 4, iguales: 3, acuerdo: 0.75 });
    expect(acuerdoClasificacion(a.slice(0, 2), b).acuerdo).toBeNull();
  });
});

describe('lote8c-huecos: veredictos', () => {
  const de = (h: Hueco) => DESCARTES.find((x) => x.si(h))?.v.estado ?? null;

  it('descarta las pruebas suspendidas por la COVID-19 y las filas que no son pruebas', () => {
    expect(de(hueco({ fecha: '2020-03-21', nombre: 'TNR ABS (3/4)' }))).toBe('descartado');
    expect(de(hueco({ fecha: '2020-02-15', nombre: 'TLM VET (3/3)' }))).toBeNull();
    expect(de(hueco({ fecha: '2020-11-07', nombre: 'Liga Nacional de Clubes', formato: 'EQUIPOS' }))).toBe('descartado');
    expect(de(hueco({ fecha: '2023-09-01', nombre: 'PRUEBA LIGA NACIONAL DE CLUBES SABLE MASCULINO 23-24' }))).toBe('descartado');
    expect(de(hueco({ fecha: '2025-04-26', nombre: 'PRUEBA CTO ESPAÑA SILLA RUEDAS', genero: 'F' }))).toBe('descartado');
  });

  it('da por recuperado sólo lo que aporta todas las fases que faltaban', () => {
    const escrita = { prueba: 'engarde:o/e/c', motivo: 'escrita_falta_entera', fichero: 'f.json', engarde: { resultados: 10, poules: 20, cuadro: 0 } };
    expect(veredictoEngarde(hueco(), [escrita])?.estado).toBe('recuperado_parcial');
    expect(veredictoEngarde(hueco({ faltan: ['poules'] }), [escrita])?.estado).toBe('recuperado');
    expect(veredictoEngarde(hueco(), [{ prueba: 'x', motivo: 'fase_falta_equipos_otra_fuente', equivalentes: ['a'] }])?.estado).toBe('no_escrito');
    expect(veredictoEngarde(hueco(), [{ prueba: 'x', motivo: 'ya_cubierta', equivalentes: ['a'] }])?.estado).toBe('descartado');
    expect(veredictoEngarde(hueco(), [])).toBeNull();
  });
});

describe('lote8c-engarde: páginas de Engarde de torneos internacionales', () => {
  const fila = (n: string, nacion: string, extra = '') => `<tr><td class="D placeNumber">1</td><td class="HBD fencer">${n}</td><td class="HBD nation"><div class="country-container"><span translate="no">${nacion}</span></div></td>${extra}</tr>`;
  const cuadro = `<table class="tableau"><tr><td> </td><td class="tableTitle">Tableau of 2</td><td> </td><td class="tableTitle">Final</td></tr>
    ${fila('WALTON Thomas', 'GBR')}
    <tr><td> </td><td> </td><td class="D"> </td><td class="HBD fencer"> WALTON Thomas GBR </td></tr>
    ${fila('FAZEKAS Arpad', 'SVK', '<td class="D score">15/9</td>')}
  </table>`;

  it('quita la nación pegada al nombre del ganador sólo si es un tirador de la primera columna', () => {
    const limpio = quitarNacionEnCuadro(cuadro);
    expect(limpio).toContain('> WALTON Thomas </td>');
    expect(limpio).not.toContain('WALTON Thomas GBR');
    const antes = parsearCuadroEngarde(cuadro, { individual: true });
    const despues = parsearCuadroEngarde(limpio, { individual: true });
    expect(antes.asaltos).toHaveLength(0);
    expect(despues.asaltos).toHaveLength(1);
    expect(despues.asaltos[0]).toMatchObject({ ronda: 'T2', nombreA: 'FAZEKAS Arpad', nombreB: 'WALTON Thomas', puntosA: 9, puntosB: 15 });
    expect(quitarNacionEnCuadro('<table class="tableau"><tr><td class="fencer">LEE Kim ABC</td></tr></table>')).toContain('LEE Kim ABC');
  });

  it('traduce los rótulos italianos de la clasificación y de las poules', () => {
    const clas = `<div id="reloadable"><h1>X</h1><h3>Classifica generale (2 tiratori)</h3><table class="liste"><tr><th>&nbsp;Pos.&nbsp;</th><th>&nbsp;Denominazione/cognome&nbsp;</th><th>&nbsp;Nome&nbsp;</th><th>&nbsp;Sigla/zona/interreg.&nbsp;</th></tr>
      <tr><td>1</td><td>IACOMONI</td><td>Matteo</td><td><span translate="no">ITA</span></td></tr><tr><td>2</td><td>BONATO</td><td>Jacopo</td><td><span translate="no">ITA</span></td></tr></table></div>`;
    expect(parsearPaginaEngarde(clas).tipo).toBe('clasificacion_provisional');
    const p = parsearPaginaEngarde(traducirRotulosItalianos(clas));
    expect(p.tipo).toBe('clasificacion');
    expect(p.filas.map((f) => [f.puesto, f.nombre, f.nacion])).toEqual([[1, 'IACOMONI Matteo', 'ITA'], [2, 'BONATO Jacopo', 'ITA']]);
    const poule = `<table class="poule" summary="Girone n° 1"><tr><th><b> Girone n° 1 </b></th><th></th><th></th><th></th><th></th><th></th><th>V/A</th><th>Aliquota</th><th>SD</th></tr>
      <tr><td>A Uno</td><td>ITA</td><td></td><td class="HGBD"> </td><td class="HBD"><div class="victory-cell">V</div></td><td></td><td>1.000</td><td>3</td><td>5</td></tr>
      <tr><td>B Dos</td><td>ITA</td><td></td><td class="GBD">2</td><td class="BD"> </td><td></td><td>0.000</td><td>-3</td><td>2</td></tr></table>`;
    expect(parsearPoulesEngarde(poule).asaltos).toHaveLength(0);
    const leidas = parsearPoulesEngarde(traducirRotulosItalianos(poule));
    expect(leidas.asaltos).toHaveLength(1);
  });
});
