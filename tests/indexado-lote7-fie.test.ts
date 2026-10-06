import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hechosPrueba, type HechosPrueba } from '@/lib/ingest/hechos/formato';
import { parsearResultadosFww } from '@/lib/ingest/sources/fww';
import { parsearDirectaFww, parsearPoulesFww, rondaFww } from '@/lib/ingest/sources/fww-asaltos';
import { categoriaFt } from '../scripts/indexado/lote7-fie-ft';
import { aliasKorat, asaltosDePoule, filasKoratQueFaltan, nombresCompatibles, poulesDeTexto, PREFIJO_CLAVE_KORAT, rankingGeneral } from '../scripts/indexado/lote7-fie-korat';
import { leerXmlFie } from '../scripts/indexado/lote7-fie-xml';
import { capaDeTexto, paginasImagen, validarCuadro, validarPoule, type LecturaModelo } from '../scripts/indexado/lote7-fie-imagen';
import { aliasPorNombre, aliasPorPuesto, filasQueFaltan, PREFIJO_CLAVE_OFICIAL, asaltosCuadro, asaltosPoule, colocacionCoincide, clasificacionPoules, leerCuadro, ordenCuadro } from '../scripts/indexado/lote7-fie-tarragona';
import { complementar, type Guardado } from '../scripts/indexado/lote7-fie-parciales';
import { asaltosCuadroApi, asaltosPouleApi, rondaApi, type PouleApi, type UnidadCuadro } from '../scripts/indexado/lote7-fie-taranto';
import {
  destinosDePruebaFww,
  ediciones,
  leerPruebaFww,
  marcadorValido,
  parsearArchivoFww,
  pruebasDeTorneoFww,
  rondaCuadro,
  soloFasesQueFaltan,
  torneoCompatible,
} from '../scripts/indexado/lote7-fie-fww';
import type { PruebaBase } from '../scripts/indexado/fie-completar-comun';

const fixture = (n: string) => readFileSync(`tests/fixtures/complementarios/${n}`, 'utf8');
const POOLS = fixture('fww-basel-u17-pools1.html');
const DIRECTA = fixture('fww-basel-u17-direct2.html');
const RESULTADOS = fixture('fww-basel-u17-resultados.html');

const fila = (fechas: string, ruta: string, nombre: string, pais: string, ciudad: string) => `
  <tr>
    <td style="width: 20px;"><i class="fa fa-circle text-warning"></i></td>
    <td style="width: 200px;">${fechas}</td>
    <td style="width: 40%;"><a href="/en/${ruta}/tournament/"><strong>${nombre}</strong></a></td>
    <td style="width: 80px;"><img src="/img/flags/x.svg" /> ${pais}</td>
    <td>${ciudad}</td>
  </tr>`;

describe('lote 7 FIE: archivo y torneos de Fencing Worldwide', () => {
  it('lee el archivo anual con temporadas de dos y de cuatro cifras', () => {
    const html = `<table>${fila('15.02.2023 - 21.02.2023', '24751-2022', 'African Championships', 'GHA', 'Accra')}${fila('27.05.2017 - 28.05.2017', '13312-16', 'Trekanten International', 'DEN', 'Kobenhavn')}</table>`;
    expect(parsearArchivoFww(html)).toEqual([
      { ruta: '24751-2022', desde: '2023-02-15', hasta: '2023-02-21', nombre: 'African Championships', pais: 'GHA', ciudad: 'Accra' },
      { ruta: '13312-16', desde: '2017-05-27', hasta: '2017-05-28', nombre: 'Trekanten International', pais: 'DEN', ciudad: 'Kobenhavn' },
    ]);
  });

  it('saca las pruebas del torneo y los destinos pools/direct de una prueba', () => {
    const torneo = '<a href="/en/11980-2022/global/">x</a><a href="/en/2095-16/global/">y</a><a href="/en/11980-2022/global/">z</a>';
    expect(pruebasDeTorneoFww(torneo)).toEqual(['11980-2022', '2095-16']);
    const global = '<a href="/en/11980-2022/direct/2">DE</a><a href="/en/11980-2022/pools/1">R1</a><a href="/en/9-2022/pools/1">otra</a>';
    expect(destinosDePruebaFww(global, '11980-2022')).toEqual(['pools/1', 'direct/2']);
  });

  it('casa un torneo por fechas y sede, o por título si la FIE no da sede', () => {
    const conSede = { clave: 'k', season: '2023', nombre: "Championnats d'Afrique", pais: 'GHA', tbd: false, desde: '2023-02-13', hasta: '2023-02-21', pruebas: [] };
    const t = { ruta: '24751-2022', desde: '2023-02-15', hasta: '2023-02-21', nombre: 'African Championships', pais: 'GHA', ciudad: 'Accra' };
    expect(torneoCompatible(conSede, t)).toBe(true);
    expect(torneoCompatible({ ...conSede, pais: 'NGR' }, t)).toBe(false);
    const tbd = { ...conSede, pais: null, tbd: true };
    expect(torneoCompatible(tbd, t)).toBe(true);
    expect(torneoCompatible(tbd, { ...t, nombre: 'European Circuit' })).toBe(false);
  });

  it('agrupa las pruebas objetivo por edición con margen de fechas', () => {
    const p = { season: '2023', editionName: 'X', city: 'Accra', countryCode: 'GHA', date: '2023-02-17', startDate: '2023-02-16' } as PruebaBase;
    const [e] = ediciones([p, { ...p, date: '2023-02-16' }]);
    expect(e).toMatchObject({ pais: 'GHA', tbd: false, desde: '2023-02-12', hasta: '2023-02-21' });
    expect(e.pruebas).toHaveLength(2);
    expect(ediciones([{ ...p, city: 'TBD', countryCode: 'FIE' }])[0]).toMatchObject({ pais: null, tbd: true });
  });

  it('reconoce género y ronda en las etiquetas alemanas y francesas de FWW', () => {
    const miga = (items: string[]) => `<ol class="breadcrumb">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
    expect(parsearResultadosFww(miga(['', 'African Championships', 'Fleuret', 'Dames', 'U17', 'Individual'])).genero).toBe('F');
    expect(parsearResultadosFww(miga(['', 'African Championships', 'Florett', 'männlich', 'U17'])).genero).toBe('M');
    expect(parsearResultadosFww(miga(['', 'Trekanten', 'Foil', 'female', 'Senior'])).genero).toBe('F');
    expect(rondaFww('16er Tableau')).toBe('T16');
    expect(rondaFww('8er Tableau')).toBe('T8');
    expect(rondaFww('Halbfinale')).toBe('SF');
    expect(rondaFww('Finale')).toBe('F');
    expect(rondaFww('Table of 32')).toBe('T32');
    expect(rondaFww('Place 3')).toBeNull();
  });
});

describe('lote 7 FIE: asaltos de FWW', () => {
  it('sin ficha de atleta sólo admite el asalto si se pide la referencia por nombre', () => {
    const sinFichas = POOLS.replace(/<a href="\/athlete\/\d+\/?"[^>]*>([^<]*)<\/a>/g, '$1');
    const normal = parsearPoulesFww(POOLS, 1);
    const sinId = parsearPoulesFww(sinFichas, 1);
    const porNombre = parsearPoulesFww(sinFichas, 1, { refPorNombre: true });
    expect(normal.asaltos.length).toBeGreaterThan(0);
    expect(sinId.asaltos).toHaveLength(0);
    expect(porNombre.asaltos).toHaveLength(normal.asaltos.length);
    expect(porNombre.asaltos.every((a) => a.refA.startsWith('fww:nombre:') && a.refB.startsWith('fww:nombre:'))).toBe(true);
    const cuadro = parsearDirectaFww(DIRECTA.replace(/<a href="\/athlete\/\d+\/?"[^>]*>([^<]*)<\/a>/g, '$1'), { refPorNombre: true });
    expect(cuadro.asaltos).toHaveLength(parsearDirectaFww(DIRECTA).asaltos.length);
  });

  it('lee poules (P<n>) y cuadro (A<n>) con marcadores de poule y de cuadro válidos', () => {
    const l = leerPruebaFww([{ destino: 'pools/1', html: POOLS }, { destino: 'direct/2', html: DIRECTA }], parsearResultadosFww(RESULTADOS));
    expect(l.poules!.bouts.length).toBeGreaterThan(0);
    expect(l.poules!.bouts.every((b) => /^P\d+$/.test(b.roundKey) && Math.max(b.scoreA, b.scoreB) <= 5)).toBe(true);
    expect(l.cuadro!.bouts.length).toBeGreaterThan(0);
    expect(l.cuadro!.bouts.every((b) => /^A\d+$/.test(b.roundKey) && Math.max(b.scoreA, b.scoreB) <= 15)).toBe(true);
    expect(l.puestos.length).toBeGreaterThan(0);
    expect(l.poules!.bouts.some((b) => b.a.pais !== null)).toBe(true);
  });

  it('una segunda ronda de poules lleva el prefijo V2P', () => {
    const l = leerPruebaFww([{ destino: 'pools/1', html: POOLS }, { destino: 'pools/3', html: POOLS }], parsearResultadosFww(RESULTADOS));
    const rondas = new Set(l.poules!.bouts.map((b) => b.roundKey.replace(/\d+$/, '')));
    expect([...rondas].sort()).toEqual(['P', 'V2P']);
  });

  it('valida marcadores por fase y traduce las rondas de cuadro', () => {
    expect(marcadorValido('POULE', 5, 3)).toBe(true);
    expect(marcadorValido('POULE', 6, 3)).toBe(false);
    expect(marcadorValido('POULE', 4, 4)).toBe(false);
    expect(marcadorValido('TABLEAU', 15, 14)).toBe(true);
    expect(marcadorValido('TABLEAU', 16, 14)).toBe(false);
    expect(rondaCuadro('T64')).toBe('A64');
    expect(rondaCuadro('SF')).toBe('A4');
    expect(rondaCuadro('F')).toBe('A2');
    expect(rondaCuadro('T3')).toBe('A3');
    expect(rondaCuadro('X')).toBeNull();
  });
});

describe('lote 7 FIE: fases emitidas', () => {
  const base: HechosPrueba = hechosPrueba.parse({
    version: 1, source: 'fie', extractor: 'lote7_fww', sourceUrl: 'https://example.org/x', sourceSha256: 'a'.repeat(64),
    edition: { season: '2023', tournamentKey: 'competition:1297', name: 'X', startDate: null, endDate: null, city: null, countryCode: null },
    competition: { competitionKey: '1297', weapon: 'ESPADA', gender: 'F', category: 'M17', categoryRaw: null, format: 'INDIVIDUAL', date: null },
    status: { results: 'parcial', pools: 'completo', tableau: 'completo', publishedParticipants: null, notes: [] },
    results: [
      { factKey: '1', name: 'A A', position: 1 },
      { factKey: '2', name: 'B B', position: 2 },
    ],
    bouts: [
      { phase: 'POULE', roundKey: 'P1', aRef: '1', bRef: '2', aName: 'A A', bName: 'B B', scoreA: 5, scoreB: 2 },
      { phase: 'TABLEAU', roundKey: 'A2', aRef: '1', bRef: '2', aName: 'A A', bName: 'B B', scoreA: 15, scoreB: 9 },
    ],
  });

  it('no emite una fase que la base ya tiene y la deja parcial sin filas', () => {
    const h = soloFasesQueFaltan(base, { poule: 0, tableau: 12 });
    expect(h.bouts.map((b) => b.phase)).toEqual(['POULE']);
    expect(h.status.pools).toBe('completo');
    expect(h.status.tableau).toBe('parcial');
    const ambas = soloFasesQueFaltan(base, { poule: 0, tableau: 0 });
    expect(ambas.bouts).toHaveLength(2);
    expect(ambas.status.tableau).toBe('completo');
  });

  it('detecta la categoría en la cabecera de Fencing Time', () => {
    expect(categoriaFt("Campeonato Panamericano Cadet Women's Epee")).toBe('M17');
    expect(categoriaFt("Junior Men's Foil")).toBe('M20');
    expect(categoriaFt("Men's Foil")).toBeNull();
  });
});

const XML_FIE = `<?xml version="1.0" encoding="UTF-8"?>
<CompetitionIndividuelle Arme="E" Sexe="F" Domaine="I" Categorie="C" Date="10.04.2022" TitreLong="EC Cadets">
 <Tireurs>
  <Tireur ID="1" Nom="ALFA" Prenom="Ana" Nation="ITA" Classement="1"/>
  <Tireur ID="2" Nom="BETA" Prenom="Bea" Nation="FRA" Classement="2"/>
  <Tireur ID="3" Nom="GAMMA" Prenom="Cris" Nation="ESP" Classement="3"/>
 </Tireurs>
 <Phases>
  <TourDePoules ID="1">
   <Poule ID="1">
    <Tireur REF="1" NbVictoires="2" TD="10" TR="5"/>
    <Tireur REF="2" NbVictoires="1" TD="8" TR="8"/>
    <Tireur REF="3" NbVictoires="0" TD="5" TR="10"/>
    <Match ID="1"><Tireur REF="1" Score="5" Statut="V"/><Tireur REF="2" Score="3" Statut="D"/></Match>
    <Match ID="2"><Tireur REF="1" Score="5" Statut="V"/><Tireur REF="3" Score="2" Statut="D"/></Match>
    <Match ID="3"><Tireur REF="2" Score="5" Statut="V"/><Tireur REF="3" Score="3" Statut="D"/></Match>
   </Poule>
   <Poule ID="2">
    <Tireur REF="1" NbVictoires="1" TD="5" TR="0"/>
    <Tireur REF="2" NbVictoires="1" TD="0" TR="5"/>
    <Match ID="1"><Tireur REF="1" Score="5" Statut="V"/><Tireur REF="2" Score="0" Statut="D"/></Match>
   </Poule>
  </TourDePoules>
  <PhaseDeTableaux>
   <SuiteDeTableaux ID="A">
    <Tableau ID="A2" Taille="2">
     <Match ID="1"><Tireur REF="1" Score="15" Statut="V"/><Tireur REF="2" Score="15" Statut="D"/></Match>
    </Tableau>
    <Tableau ID="A4" Taille="4">
     <Match ID="1"><Tireur REF="3"/></Match>
    </Tableau>
   </SuiteDeTableaux>
  </PhaseDeTableaux>
 </Phases>
</CompetitionIndividuelle>`;

describe('XML FIE (EFC)', () => {
  it('lee poules que cuadran con sus totales y descarta las que no', () => {
    const x = leerXmlFie(XML_FIE);
    expect(x).toMatchObject({ arma: 'ESPADA', genero: 'F', individual: true, categoria: 'C' });
    expect(x.puestos).toHaveLength(3);
    expect(x.poules?.bouts).toHaveLength(3);
    expect(x.poules?.bouts[0]).toMatchObject({ roundKey: 'P1', scoreA: 5, scoreB: 3, a: { nombre: 'ALFA Ana', pais: 'ITA' } });
    expect(x.poules?.esperados).toBe(4);
    expect(x.poules?.descartados).toEqual({ totales_no_cuadran: 1 });
  });

  it('lee el cuadro principal, con empate resuelto por estado y sin exentos', () => {
    const x = leerXmlFie(XML_FIE);
    expect(x.cuadro?.esperados).toBe(1);
    expect(x.cuadro?.bouts).toEqual([
      expect.objectContaining({ phase: 'TABLEAU', roundKey: 'A2', scoreA: 15, scoreB: 15, winner: 'A' }),
    ]);
  });
});

const KORAT = `
Poule No 1 11:00 piste No BLUE
                                                   V/M     ind.   HS rank
     ALFA Ana                 ITA        V    V    1.000   5   10   1
     BETA Bea                 FRA   3         V4   0.500   ‐1  7    2
     GAMMA Cris               ESP   2    3         0.000   ‐4  5    3

Poule No 2 11:00 piste No 1
                                                   V/M     ind.   HS rank
     ALFA Ana                 ITA        V    V    1.000   5   10   1
     BETA Bea                 FRA   3         V    0.500   0   8    2
     GAMMA Cris               ESP   V    3         0.500   ‐1  8    3
Ranking after pools
`;

describe('matrices de poule de Korat 2017', () => {
  it('acepta sólo las poules recíprocas cuyos V/M, indicador y TD cuadran', () => {
    const poules = poulesDeTexto(KORAT);
    expect([...poules.keys()]).toEqual([1, 2]);
    const p1 = asaltosDePoule(poules.get(1)!, 1);
    expect('bouts' in p1 && p1.bouts).toEqual([
      expect.objectContaining({ roundKey: 'P1', a: { nombre: 'ALFA Ana', pais: 'ITA' }, scoreA: 5, scoreB: 3 }),
      expect.objectContaining({ scoreA: 5, scoreB: 2 }),
      expect.objectContaining({ a: { nombre: 'BETA Bea', pais: 'FRA' }, scoreA: 4, scoreB: 3 }),
    ]);
    expect(asaltosDePoule(poules.get(2)!, 2)).toEqual({ motivo: 'dos_victorias_o_derrotas' });
  });

  it('casa nombres recortados o reordenados sin confundir homónimos de apellido', () => {
    const alias = aliasKorat(
      [
        { nombre: 'SIA SANDRO ANTONI', pais: 'PHI' },
        { nombre: 'ALI Kheirkhah', pais: 'IRI' },
        { nombre: 'LAU Ho Chuen', pais: 'HKG' },
        { nombre: 'CHOI YU MIN', pais: 'KOR' },
        { nombre: 'CHOI YU JIN', pais: 'KOR' },
      ],
      [
        { name: 'SIA Sandro Antonio', countryCode: 'PHI' },
        { name: 'KHEIR KHAH Ali', countryCode: 'IRI' },
        { name: 'LAU Ho Fung', countryCode: 'HKG' },
        { name: 'CHOI Yumin', countryCode: 'KOR' },
        { name: 'CHOI Yujin', countryCode: 'KOR' },
      ],
    );
    expect(Object.fromEntries(alias)).toEqual({
      'SIA SANDRO ANTONI|PHI': { nombre: 'SIA Sandro Antonio', pais: 'PHI' },
      'ALI Kheirkhah|IRI': { nombre: 'KHEIR KHAH Ali', pais: 'IRI' },
      'CHOI YU MIN|KOR': { nombre: 'CHOI Yumin', pais: 'KOR' },
      'CHOI YU JIN|KOR': { nombre: 'CHOI Yujin', pais: 'KOR' },
    });
    expect(nombresCompatibles(['ho', 'chuen'], ['ho', 'fung'])).toBe(false);
    expect(nombresCompatibles(['pak', 'hei', 'nicholas'], ['pak', 'hei'])).toBe(true);
  });
});

describe('PDF Fencing Time impreso (Antalya 2025)', () => {
  const paginas = [
    'Strip Blue\n09:00\nReferee(s):\nREF Uno (NED)\nALFA Ana ITA\nBETA Bea FRA\nGAMMA Cris ESP',
    'Seed Name Country V V/M TS TR Ind Notes\n1 ALFA Ana ITA 2 1,00 10 5 +5 Advanced\n2 BETA Bea FRA 1 0,50 8 8 0 Advanced\n3 GAMMA Cris ESP 0 0,00 5 10 -5 Advanced',
    'Table of 4\n1\n2',
    'Place Name Country Birthdate\n1 ALFA Ana ITA 01/01/2009\n2 GAMMA Cris ESP 01/01/2009\n3 BETA Bea FRA 01/01/2009',
  ];
  const capa = capaDeTexto(paginas, "Cadet Women's Epee");
  const pool = (cells: string[][]): LecturaModelo['pools'][number] => ({
    pool: 1,
    rows: [
      { name: 'ALFA Ana', country: 'ITA', cells: cells[0], v: '2', vm: '1,00', ts: '10', tr: '5', ind: '5' },
      { name: 'BETA Bea', country: 'FRA', cells: cells[1], v: '1', vm: '0,50', ts: '8', tr: '8', ind: '0' },
      { name: 'GAMMA Cris', country: 'ESP', cells: cells[2], v: '0', vm: '0,00', ts: '5', tr: '10', ind: '-5' },
    ],
  });
  const buena = pool([['', 'V5', 'V5'], ['D3', '', 'V5'], ['D2', 'D3', '']]);

  it('lee de la capa de texto poules, seeding, clasificación y qué páginas son imagen', () => {
    expect(capa.poules).toEqual([[{ nombre: 'ALFA Ana', pais: 'ITA' }, { nombre: 'BETA Bea', pais: 'FRA' }, { nombre: 'GAMMA Cris', pais: 'ESP' }]]);
    expect(capa.seeding.map((x) => [x.seed, x.v, x.ts, x.tr, x.ind])).toEqual([[1, 2, 10, 5, 5], [2, 1, 8, 8, 0], [3, 0, 5, 10, -5]]);
    expect(capa.clasificacion.map((x) => x.puesto)).toEqual([1, 2, 3]);
    expect([capa.arma, capa.genero]).toEqual(['ESPADA', 'F']);
    expect(paginasImagen(paginas)).toEqual([1, 3]);
  });

  it('acepta una poule sólo si las dos lecturas son idénticas y todo cuadra', () => {
    const seeding = new Map(capa.seeding.map((x) => [x.nombre.replace(/\s/g, '').toUpperCase(), x]));
    const r = validarPoule(buena, buena, capa.poules[0], seeding);
    expect('bouts' in r && r.bouts.map((b) => [b.scoreA, b.scoreB])).toEqual([[5, 3], [5, 2], [5, 3]]);
    expect(validarPoule(buena, pool([['', 'V5', 'V5'], ['D4', '', 'V5'], ['D2', 'D3', '']]), capa.poules[0], seeding)).toEqual({ motivo: 'lecturas_distintas' });
    const mala = pool([['', 'V5', 'V5'], ['D3', '', 'V5'], ['D2', 'V3', '']]);
    expect(validarPoule(mala, mala, capa.poules[0], seeding)).toEqual({ motivo: 'pareja_sin_un_ganador' });
  });

  it('reconstruye el cuadro con ganadores que avanzan y puestos finales coherentes', () => {
    const lectura: LecturaModelo = {
      title: "Cadet Women's Epee", pools: [],
      brackets: [{
        bracket: 4,
        columns: [
          { table: 4, slots: [{ seed: 1, name: 'ALFA Ana', score: null }, { seed: 4, name: '-BYE-', score: null }, { seed: 3, name: 'GAMMA Cris', score: null }, { seed: 2, name: 'BETA Bea', score: null }] },
          { table: 2, slots: [{ seed: 1, name: 'ALFA Ana', score: null }, { seed: 2, name: 'GAMMA Cris', score: '15 - 12' }] },
          { table: 1, slots: [{ seed: 1, name: 'ALFA Ana', score: '15 - 9' }] },
        ],
      }],
    };
    const c = validarCuadro(lectura, lectura, capa);
    expect(c.esperados).toBe(2);
    expect(c.bouts.map((b) => [b.roundKey, b.a.nombre, b.scoreA, b.b.nombre, b.scoreB])).toEqual([
      ['A4', 'GAMMA Cris', 15, 'BETA Bea', 12], ['A2', 'ALFA Ana', 15, 'GAMMA Cris', 9],
    ]);
    const otra = JSON.parse(JSON.stringify(lectura)) as LecturaModelo;
    otra.brackets[0].columns[2].slots[0].score = '15 - 8';
    expect(validarCuadro(lectura, otra, capa).descartados).toEqual({ lecturas_distintas: 1 });
  });
});

describe('Juegos Mediterráneos de Tarragona 2018 (resultados oficiales)', () => {
  it('ordena las cabezas de serie como la FIE y compara cada cruce como pareja', () => {
    expect(ordenCuadro(8)).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
    const t = (nombre: string) => ({ nombre, pais: null });
    const bouts = [
      { a: t('A'), b: t('B'), scoreA: 5, scoreB: 1 }, { a: t('A'), b: t('C'), scoreA: 5, scoreB: 2 }, { a: t('B'), b: t('C'), scoreA: 5, scoreB: 3 },
    ].map((b) => ({ ...b, phase: 'POULE' as const, roundKey: 'P1', winner: null }));
    const clas = clasificacionPoules(bouts);
    expect(clas.map((x) => x.clave)).toEqual(['A', 'B', 'C']);
    expect(colocacionCoincide(clas, [t('A'), null, t('C'), t('B')])).toBe(true);
    expect(colocacionCoincide(clas, [t('B'), null, t('C'), t('A')])).toBe(false);
  });

  it('lee la matriz HTML y el JSON del cuadro, y rechaza una poule no recíproca', () => {
    const fila = (n: string, celdas: (string | null)[]) => ({ tirador: { nombre: n, pais: 'ESP' }, celdas, puntos: null });
    expect('bouts' in asaltosPoule({ numero: 1, filas: [fila('A', [null, '5-1', '5-2']), fila('B', ['1-5', null, '5-3']), fila('C', ['2-5', '3-5', null])] })).toBe(true);
    expect(asaltosPoule({ numero: 1, filas: [fila('A', [null, '5-1', '5-2']), fila('B', ['1-4', null, '5-3']), fila('C', ['2-5', '3-5', null])] })).toEqual({ motivo: 'no_reciproca' });
    const json = JSON.stringify([{ Code: 'FNL', Phases: [{ Code: 'x.SFNL', Desc: 'Semifinals' }, { Code: 'x.FNL-', Desc: 'Finals' }],
      Results: [[[15, 10, { Code: 's1' }], [null, null, { Code: 's2' }]], [[12, 15, { Code: 'f' }]]],
      Partics: [[{ flag: 'img/flags/ITA.png', name: 'A' }, { flag: 'img/flags/FRA.png', name: 'B' }], [{ flag: 'img/flags/ESP.png', name: 'C' }, null]] }]);
    const info = leerCuadro(`<script>Vue.set(appBracket, 'bracketInfo', JSON.parse('${json}'))</script>`)!;
    const c = asaltosCuadro(info);
    expect(c.esperados).toBe(2);
    expect(c.bouts.map((b) => [b.roundKey, b.a.nombre, b.b.nombre, b.scoreA, b.scoreB, b.a.pais])).toEqual([['A4', 'A', 'B', 15, 10, 'ITA'], ['A2', 'A', 'C', 12, 15, 'ITA']]);
  });

  it('casa la clasificación oficial con la FIE por puesto (con empates), nación y palabra', () => {
    const alias = aliasPorPuesto(
      [{ t: { nombre: 'NAVARRO LASO Araceli', pais: 'ESP' }, puesto: 5 }, { t: { nombre: 'RIFKISS Margaux', pais: 'FRA' }, puesto: 5 }, { t: { nombre: 'OTRA Persona', pais: 'TUR' }, puesto: 9 }],
      [{ factKey: '1', name: 'NAVARRO Araceli', countryCode: 'ESP', position: 8 }, { factKey: '2', name: 'RIFKISS Margaux', countryCode: 'ITA', position: 7 }],
    );
    expect([...alias]).toEqual([['NAVARROLASOARACELI', { nombre: 'NAVARRO Araceli', pais: 'ESP' }]]);
  });
});

describe('asaltos que faltan en pruebas parciales', () => {
  const g = (phase: Guardado['phase'], roundKey: string, aRef: string, bRef: string, scoreA: number, scoreB: number): Guardado => ({ phase, roundKey, aRef, bRef, scoreA, scoreB });
  const n = (phase: Guardado['phase'], roundKey: string, aRef: string, bRef: string, scoreA: number, scoreB: number) =>
    ({ phase, roundKey, aRef, bRef, aName: aRef, bName: bRef, scoreA, scoreB, winner: null });

  it('añade sólo lo que falta, en la poule FIE de esos tiradores y no en la de igual número', () => {
    const guardados = [g('POULE', 'P7', '1', '2', 5, 3), g('POULE', 'P7', '1', '3', 5, 1)];
    const r = complementar(guardados, [n('POULE', 'P1', '2', '1', 3, 5), n('POULE', 'P1', '1', '3', 5, 1), n('POULE', 'P1', '2', '3', 4, 5)]);
    expect(r.anadidos).toEqual([n('POULE', 'P7', '2', '3', 4, 5)]);
    const otra = complementar(guardados, [n('POULE', 'P1', '1', '2', 5, 4), n('POULE', 'P1', '2', '3', 4, 5), n('POULE', 'P1', '1', '3', 5, 1)]);
    expect(otra.anadidos).toEqual([]);
    expect(otra.motivos).toEqual({ poule_con_marcadores_distintos: 1 });
  });

  it('coloca un asalto de cuadro en la única ronda FIE libre de su tamaño', () => {
    const guardados = [g('TABLEAU', 'A4', '1', '2', 15, 3), g('TABLEAU', 'A2', '1', '3', 15, 10)];
    const r = complementar(guardados, [n('TABLEAU', 'A4', '3', '4', 15, 11), n('TABLEAU', 'A4', '1', '2', 15, 3)]);
    expect(r.anadidos).toEqual([n('TABLEAU', 'A4', '3', '4', 15, 11)]);
    expect(complementar(guardados, [n('TABLEAU', 'A4', '4', '3', 15, 11)]).motivos).toEqual({ cuadro_incoherente: 1 });
  });
});

describe('clasificaciones FIE truncadas completadas con la oficial', () => {
  const fie = (position: number, name: string, countryCode: string, factKey = `f${position}${name}`) => ({ factKey, name, countryCode, position });
  const of = (puesto: number, nombre: string, pais: string, registro: string) => ({ t: { nombre, pais }, puesto, registro });

  it('Tarragona: añade sólo las filas oficiales sin pareja FIE y casa por nombre las que difieren en nación o puesto', () => {
    const oficial = [of(1, 'PEREIRA RAMOS Yulen', 'ESP', '1'), of(2, 'CIPRESSA Erica', 'ITA', '2'), of(3, 'NOGUEIRA Débora', 'POR', '3'), of(4, 'SHAITO Mona', 'LBN', '4')];
    const puestos = [fie(1, 'PEREIRA-RAMOS Yulen', 'ESP'), fie(2, 'CIPRESSA Erica', 'FRA'), fie(9, 'NOGUEIRA Debora', 'POR')];
    const alias = aliasPorPuesto(oficial, puestos);
    expect(alias.size).toBe(1);
    expect(aliasPorNombre(oficial, puestos, alias)).toEqual(['CIPRESSA Erica: nación FIE FRA, oficial ITA', 'NOGUEIRA Debora: puesto FIE 9, oficial 3']);
    const r = filasQueFaltan(oficial, puestos, alias);
    expect('filas' in r && r.filas.map((x) => [x.factKey, x.name, x.position])).toEqual([[`${PREFIJO_CLAVE_OFICIAL}4`, 'SHAITO Mona', 4]]);
    expect(filasQueFaltan(oficial, puestos, new Map())).toMatchObject({ motivo: expect.stringMatching(/^filas_fie_sin_casar/) });
  });

  it('Korat: lee el ranking general y casa las filas FIE por puesto (empates por nación o palabra)', () => {
    const texto = [
      'Overall ranking (ordered by ranking - 4 fencers)', 'rank   flag   name and first name                     country',
      '   1          UENO YUKA                               JPN', '   3          LEE Areta                               HKG',
      '   3          WONG Maxine Jie Xin                     SIN', '                                     Document engarde-escrime.com - 01/03/2017 21:38',
      'Overall ranking (ordered by ranking - 4 fencers)', '  49          BATYRBEKOVA Marzhan                     KAZ',
    ].join('\n');
    const general = rankingGeneral(texto)!;
    expect(general.map((g) => g.puesto)).toEqual([1, 3, 3, 49]);
    const r = filasKoratQueFaltan(general, [fie(1, 'UENO Yuka', 'JPN'), fie(3, 'WONG Maxine Jie Xin', 'SGP'), fie(3, 'LEE Areta', 'HKG')]);
    expect('filas' in r && r.filas.map((x) => [x.factKey, x.position])).toEqual([[`${PREFIJO_CLAVE_KORAT}batyrbekovamarzhan-kaz`, 49]]);
    expect('avisos' in r && r.avisos).toEqual(['WONG Maxine Jie Xin: nación FIE SGP, PDF SIN']);
    expect(filasKoratQueFaltan(general, [fie(1, 'TANAKA Rie', 'KOR')])).toMatchObject({ motivo: expect.stringMatching(/^puesto_con_otro_tirador/) });
    expect(rankingGeneral(texto.replace('- 4 fencers', '- 5 fencers').replace('- 4 fencers', '- 5 fencers'))).toBeNull();
  });
});

describe('Juegos Mediterráneos de Taranto 2026 (API Microplus)', () => {
  const rival = (code: string, result: string | null, wlt: string | null) => ({ Code: code, Result: result, WLT: wlt, IRM: null, PrintName: `X ${code}`, OrganisationCode: 'ESP' });
  const fila = (code: string, marcas: [string, number, number][]) => ({
    CompetitorCode: code, OrganisationCode: 'ESP',
    Won: marcas.filter(([, a, b]) => a > b).length, Lost: marcas.filter(([, a, b]) => a < b).length,
    PointFor: marcas.reduce((s, [, a]) => s + a, 0), PointAgainst: marcas.reduce((s, [, , b]) => s + b, 0),
    Composition: { Athlete: [{ Description: { PrintName: `X ${code}` } }] },
    Units: marcas.map(([o, a, b]) => ({ UnitCode: '1', Competitor: { ...rival(code, String(a), a > b ? 'W' : 'L'), OpponentCompetitor: rival(o, String(b), a > b ? 'L' : 'W') } })),
  });
  const poule = (filas: ReturnType<typeof fila>[]): PouleApi => ({ GenderCode: 'W', EventCode: 'EPEE', PhaseCode: 'GP02', PoolCompetitors: filas });

  it('reconstruye una poule recíproca y rechaza la que no cuadra', () => {
    const ok = asaltosPouleApi(poule([fila('1', [['2', 5, 3], ['3', 5, 1]]), fila('2', [['1', 3, 5], ['3', 5, 4]]), fila('3', [['1', 1, 5], ['2', 4, 5]])]));
    expect('bouts' in ok && ok.bouts).toHaveLength(3);
    expect('bouts' in ok && ok.bouts[0]).toMatchObject({ phase: 'POULE', roundKey: 'P2', scoreA: 5, scoreB: 3 });
    const mal = asaltosPouleApi(poule([fila('1', [['2', 5, 3], ['3', 5, 1]]), fila('2', [['1', 3, 5], ['3', 5, 4]]), fila('3', [['1', 1, 5], ['2', 2, 5]])]));
    expect(mal).toMatchObject({ motivo: 'no_reciproca', esperados: 3 });
  });

  it('lee el cuadro sin exentos y exige un avance coherente', () => {
    const plaza = (code: string | null, result: string | null, wlt: string | null) => code
      ? { Pos: 1, WLT: wlt, Result: result, Competitor: { Code: code, OrganisationCode: 'ITA', Composition: { Athlete: [{ Description: { PrintName: `Y ${code}` } }] } } }
      : { Pos: 2, Code: 'BYE', Competitor: { Composition: {} } };
    const u = (fase: string, x: ReturnType<typeof plaza>, y: ReturnType<typeof plaza>): UnidadCuadro => ({ PhaseCode: fase, UnitCode: '1', CompetitorPlace: [x, y] });
    expect([rondaApi('8FNL'), rondaApi('QFNL'), rondaApi('SFNL'), rondaApi('FNL-')]).toEqual([16, 8, 4, 2]);
    const r = asaltosCuadroApi([
      u('SFNL', plaza('1', null, 'W'), plaza(null, null, null)),
      u('SFNL', plaza('2', '15', 'W'), plaza('3', '9', 'L')),
      u('FNL-', plaza('1', '15', 'W'), plaza('2', '14', 'L')),
    ]);
    expect(r.esperados).toBe(2);
    expect(r.bouts.map((b) => [b.roundKey, b.scoreA, b.scoreB])).toEqual([['A4', 15, 9], ['A2', 15, 14]]);
    const roto = asaltosCuadroApi([u('SFNL', plaza('2', '15', 'W'), plaza('3', '9', 'L')), u('FNL-', plaza('1', '15', 'W'), plaza('3', '14', 'L'))]);
    expect(roto.descartados).toEqual({ avance_incoherente: 1 });
    expect(roto.bouts.map((b) => b.roundKey)).toEqual(['A2']);
  });
});
