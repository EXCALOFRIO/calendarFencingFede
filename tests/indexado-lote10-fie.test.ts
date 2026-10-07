import { describe, expect, it } from 'vitest';
import { corregirRondasPorPuestos, cuadroContraClasificacion, plegar, totalesPoule } from '../scripts/indexado/lote10-fie-comun';
import { parsearCuadroArbol, rondaInicial } from '../scripts/indexado/lote10-fie-engarde-arbol';
import {
  agruparCapturas, atributosDeCodigo, claveCarpeta, fechaCabecera, firmaCabecera, tipoDoc, vueltaPoules,
} from '../scripts/indexado/lote10-fie-engarde-wayback';
import { listaCoherente, mismaCiudad, parsearListaFiech } from '../scripts/indexado/lote10-fie-fiech';
import {
  atributosEvento, compararClasificacion, emparejar, leerAsaltos, mismaNacion, objetivosOlimpicos, parsearEvento, partesFie, rondaDirecta,
} from '../scripts/indexado/lote10-fie-olympedia';
import { permitido, reglasRobots } from '../scripts/indexado/lote10-fie-red';
import type { PruebaBase, PuestoBase } from '../scripts/indexado/fie-completar-comun';

// Fixtures recortados con la estructura real de las fuentes y nombres ficticios.

describe('robots.txt', () => {
  const txt = `User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /w/api.php?action=mobileview&\nDisallow: /w/\nDisallow: /api/\nCrawl-delay: 10\n`;
  it('aplica el grupo * y gana la regla más larga', () => {
    const r = reglasRobots(txt, 'CalendarioEsgrima');
    expect(permitido(r, '/wiki/2010_World_Fencing_Championships')).toBe(true);
    expect(permitido(r, '/w/index.php?title=X&action=raw')).toBe(false);
    expect(permitido(r, '/w/api.php?action=mobileview&page=X')).toBe(true);
    expect(permitido(reglasRobots(txt, 'BadBot/1.0'), '/wiki/X')).toBe(false);
  });
});

describe('cuadro frente a la clasificación', () => {
  const puestos = new Map<string, number | null>([['1', 1], ['2', 2], ['3', 3], ['4', 3], ['5', 5], ['6', 6]]);
  const b = (roundKey: string, aRef: string, bRef: string, scoreA: number, scoreB: number) => ({ roundKey, aRef, bRef, scoreA, scoreB, winner: null });
  it('acepta un cuadro con los puestos oficiales', () => {
    expect(cuadroContraClasificacion([b('A8', '1', '5', 15, 3), b('A8', '3', '6', 15, 9), b('A4', '1', '3', 15, 10), b('A4', '2', '4', 15, 12), b('A2', '1', '2', 15, 14)], puestos)).toEqual([]);
  });
  it('rechaza una final que no es 1.º y 2.º y un semifinalista que no es 3.º', () => {
    expect(cuadroContraClasificacion([b('A2', '2', '1', 15, 14)], puestos)).toEqual(['final_no_es_1_y_2']);
    expect(cuadroContraClasificacion([b('A4', '3', '5', 15, 10)], puestos)).toEqual(['semifinal_no_es_3']);
    expect(cuadroContraClasificacion([b('A8', '5', '1', 15, 10)], puestos)).toContain('perdedor_con_puesto_imposible');
  });
  it('con combate por el bronce el perdedor de semifinal puede ser 4.º', () => {
    const p = new Map<string, number | null>([['1', 1], ['2', 2], ['3', 3], ['4', 4]]);
    expect(cuadroContraClasificacion([b('A4', '1', '3', 15, 10), b('A4', '2', '4', 15, 12), b('C2', '3', '4', 15, 11), b('A2', '1', '2', 15, 8)], p)).toEqual([]);
  });
  it('renombra una ronda previa por los puestos de sus perdedores sólo si no choca', () => {
    const p = new Map<string, number | null>([['w1', 20], ['l1', 70], ['w2', 30], ['l2', 84]]);
    const previa = [b('A64', 'w1', 'l1', 15, 7), b('A64', 'w2', 'l2', 15, 9)];
    expect(corregirRondasPorPuestos(previa, p).map((x) => x.roundKey)).toEqual(['A128', 'A128']);
    expect(cuadroContraClasificacion(corregirRondasPorPuestos(previa, p), p)).toEqual([]);
    expect(corregirRondasPorPuestos([...previa, b('A128', 'w1', 'l2', 15, 3)], p).map((x) => x.roundKey)).toEqual(['A64', 'A64', 'A128']);
    const bien = new Map<string, number | null>([['w1', 20], ['l1', 40]]);
    expect(corregirRondasPorPuestos([b('A64', 'w1', 'l1', 15, 7)], bien)[0].roundKey).toBe('A64');
  });
  it('suma los totales de una poule', () => {
    const t = totalesPoule([{ a: 'x', b: 'y', sa: 5, sb: 3, ganador: 'A' }, { a: 'y', b: 'z', sa: 5, sb: 4, ganador: 'A' }]);
    expect(t.get('y')).toEqual({ v: 1, d: 1, ts: 8, tr: 9 });
  });
});

const FILA = (pos: string, id: string, nombre: string, noc: string) =>
  `<tr><td>${pos}</td><td><a href="/athletes/${id}">${nombre}</a></td><td><a href="/countries/${noc}"><img src="x.svg" />${noc}</a></td><td></td></tr>`;
const ASALTO = (id: string, a: [string, string, string], res: string, b: [string, string, string]) =>
  `<tr><td><a href="/results/9${id}">${id.startsWith('M') ? id.slice(1) : `Bout #${id}`}</a></td><td>17 Aug</td><td><a href="/athletes/${a[0]}">${a[1]}</a></td><td><a href="/countries/${a[2]}">${a[2]}</a></td><td style="text-align: center">${res}</td><td><a href="/athletes/${b[0]}">${b[1]}</a></td><td><a href="/countries/${b[2]}">${b[2]}</a></td><td></td></tr>`;
const CAB_ASALTOS = '<thead><tr><th>Match</th><th>Date/Time</th><th>Competitor</th><th>NOC</th><th>Result</th><th>Competitor</th><th>NOC</th><th></th></tr></thead>';
const ANA: [string, string, string] = ['1', 'Ana Alfa', 'URS'];
const BEA: [string, string, string] = ['2', 'Bea Beta', 'FRG'];
const CLA: [string, string, string] = ['3', 'Clara Gamma', 'ITA'];
const DORA: [string, string, string] = ['4', 'Dora Delta', 'HUN'];

const EVENTO = `<html><body><h1>Foil, Individual, Women</h1>
<table class="biodata"><tr><th>Date</th><td>1 August 1976</td></tr></table>
<table class="table table-striped"><thead><tr><th>Pos</th><th>Competitor</th><th>NOC</th><th></th></tr></thead>
${FILA('1', '1', 'Ana Alfa', 'URS')}${FILA('2', '2', 'Bea Beta', 'FRG')}${FILA('3', '3', 'Clara Gamma', 'ITA')}${FILA('4', '4', 'Dora Delta', 'HUN')}</table>
<h2>Round One</h2><table class="biodata"><tr><th>Format</th><td>Top 2</td></tr></table>
<h3>Pool #1</h3><table class="table table-striped"><thead><tr><th>Pos</th><th>Competitor</th><th>NOC</th><th>Bouts</th><th>Touches</th><th></th></tr></thead>
<tr><td>1</td><td><a href="/athletes/1">Ana Alfa</a></td><td>URS</td><td>2-0</td><td>10-5</td><td></td></tr>
<tr><td>2</td><td><a href="/athletes/2">Bea Beta</a></td><td>FRG</td><td>1-1</td><td>8-7</td><td></td></tr>
<tr><td>3</td><td><a href="/athletes/3">Clara Gamma</a></td><td>ITA</td><td>0-2</td><td>4-10</td><td></td></tr></table>
<table class="table table-striped">${CAB_ASALTOS}${ASALTO('1', ANA, '5 – 3', BEA)}${ASALTO('2', ANA, '5 – 2', CLA)}${ASALTO('3', BEA, '5 – 2', CLA)}</table>
<h3>Pool #2</h3><table class="table table-striped"><thead><tr><th>Pos</th><th>Competitor</th><th>NOC</th><th>Bouts</th><th>Touches</th><th></th></tr></thead>
<tr><td>1</td><td><a href="/athletes/4">Dora Delta</a></td><td>HUN</td><td>1-0</td><td>5-0</td><td></td></tr>
<tr><td>2</td><td><a href="/athletes/3">Clara Gamma</a></td><td>ITA</td><td>0-1</td><td>0-5</td><td></td></tr></table>
<table class="table table-striped">${CAB_ASALTOS}${ASALTO('1', DORA, '5 – 0', CLA)}</table>
<h3>Pool #2, Barrage 1-2</h3><table class="table table-striped">${CAB_ASALTOS}${ASALTO('1', DORA, '5 – 4', CLA)}</table>
<h2>Semi-Finals</h2><table class="table table-striped">${CAB_ASALTOS}${ASALTO('1', ANA, '15 – 9', CLA)}${ASALTO('2', BEA, '15 – 12', DORA)}</table>
<h2>Final Round</h2><table class="table table-striped">${CAB_ASALTOS}${ASALTO('MMatch 1/2', ANA, '15 – 11', BEA)}${ASALTO('MMatch 3/4', CLA, '15 – 14', DORA)}</table>
</body></html>`;

const FIE: PuestoBase[] = [
  { factKey: '101', name: 'ALFA Ana Petrovna', countryCode: 'RUS', position: 1 },
  { factKey: '102', name: 'SCHMIDT Bea', countryCode: 'GER', position: 2 },
  { factKey: '103', name: 'GAMMA Clara', countryCode: 'ITA', position: 3 },
  { factKey: '104', name: 'DELTA Dora', countryCode: 'HUN', position: 4 },
];

describe('Olympedia', () => {
  it('reconoce arma, género y modalidad del nombre de la prueba', () => {
    expect(atributosEvento('Épée, Individual, Men')).toEqual({ arma: 'ESPADA', genero: 'M', formato: 'INDIVIDUAL' });
    expect(atributosEvento('Sabre, Team, Women')).toEqual({ arma: 'SABLE', genero: 'F', formato: 'EQUIPOS' });
    expect(atributosEvento('Foil, Individual, Girls')).toEqual({ arma: 'FLORETE', genero: 'F', formato: 'INDIVIDUAL' });
  });

  it('lee la clasificación, las poules sin desempates y los cruces', () => {
    const ev = parsearEvento(EVENTO);
    expect(ev.final.map((f) => [f.puesto, f.nombre, f.noc, f.atleta])).toEqual([
      [1, 'Ana Alfa', 'URS', '1'], [2, 'Bea Beta', 'FRG', '2'], [3, 'Clara Gamma', 'ITA', '3'], [4, 'Dora Delta', 'HUN', '4'],
    ]);
    expect(ev.rondas.map((r) => [r.titulo, r.poules.length, r.asaltos.length])).toEqual([['Round One', 2, 0], ['Semi-Finals', 0, 2], ['Final Round', 0, 2]]);
    expect(ev.rondas[0].poules[1].asaltos).toHaveLength(1);
    expect(ev.rondas[2].asaltos.map((b) => b.etiqueta)).toEqual(['Match 1/2', 'Match 3/4']);
  });

  it('nombra las rondas de eliminación directa como la FIE', () => {
    expect(rondaDirecta('Round One', 32, 'INDIVIDUAL')).toBe('A64');
    expect(rondaDirecta('Quarter-Finals', 4, 'INDIVIDUAL')).toBe('A8');
    expect(rondaDirecta('Bronze Medal Match', 1, 'EQUIPOS')).toBe('B2');
    expect(rondaDirecta('Repêchage Round One', 8, 'INDIVIDUAL')).toBeNull();
    expect(rondaDirecta('Classification Round 5-8', 2, 'EQUIPOS')).toBeNull();
  });

  it('casa nombres en orden occidental, códigos históricos y apellidos de casada con puesto único', () => {
    expect(partesFie('D’ORIOLA Christian')).toEqual({ apellidos: ['doriola'], nombres: ['christian'] });
    expect(mismaNacion('URS', 'RUS')).toBe(true);
    expect(mismaNacion('FRG', 'GER')).toBe(true);
    expect(mismaNacion('FRA', 'ITA')).toBe(false);
    const ev = parsearEvento(EVENTO);
    const m = emparejar(FIE, ev.final, new Map(ev.final.map((f) => [f.atleta!, f.puesto])), 'INDIVIDUAL');
    expect(m.get('1')?.ref).toBe('101');
    expect(m.get('3')?.ref).toBe('103');
    expect(m.get('2')).toMatchObject({ ref: '102', metodo: 'puesto' });
  });

  it('casa transliteraciones, apellidos de casada en un tramo de empatados y el mismo tirador con y sin enlace', () => {
    expect(plegar('Małgorzata Søren')).toBe('malgorzata soren');
    const fie: PuestoBase[] = [
      { factKey: '201', name: 'LELKO Olga', countryCode: 'UKR', position: 17 },
      { factKey: '202', name: 'GRACH Inna', countryCode: 'RUS', position: 18 },
      { factKey: '203', name: 'JUNG Gil Ok', countryCode: 'KOR', position: 19 },
      { factKey: '204', name: 'NOWAK Malgorzata', countryCode: 'POL', position: 20 },
      { factKey: '205', name: 'PETROVA Inna', countryCode: 'RUS', position: 3 },
    ];
    const oly = [
      { nombre: 'Olha Lelko', noc: 'UKR', atleta: '1' },
      { nombre: 'Inna Derig', noc: 'RUS', atleta: '2' },
      { nombre: 'Jeong Gil-Ok', noc: 'KOR', atleta: '3' },
      { nombre: 'Małgorzata Nowak', noc: 'POL', atleta: '4' },
      { nombre: 'Małgorzata Nowak', noc: 'POL', atleta: null },
      { nombre: 'Inna Petrova', noc: 'RUS', atleta: '5' },
    ];
    const puestos = new Map<string, number | null>([['1', 17], ['2', 17], ['3', 17], ['4', 17], ['5', 3]]);
    const m = emparejar(fie, oly, puestos, 'INDIVIDUAL');
    expect(m.get('1')?.ref).toBe('201');
    expect(m.get('2')).toMatchObject({ ref: '202', metodo: 'puesto' });
    expect(m.get('3')?.ref).toBe('203');
    expect(m.get('4')?.ref).toBe('204');
    expect(m.get('Małgorzata Nowak|POL')?.ref).toBe('204');
    expect(m.get('5')?.ref).toBe('205');
    // Fuera del tramo (=17 con cuatro empatados: 17..20) no casa por nombre de pila.
    const lejos = emparejar([{ factKey: '202', name: 'GRACH Inna', countryCode: 'RUS', position: 30 }], [oly[1]], puestos, 'INDIVIDUAL');
    expect(lejos.size).toBe(0);
  });

  it('compara la clasificación y valida poules y cuadro', () => {
    const ev = parsearEvento(EVENTO);
    expect(compararClasificacion(ev, FIE, 'INDIVIDUAL').ok).toBe(true);
    const l = leerAsaltos(ev, FIE, 'INDIVIDUAL');
    // Las dos poules reproducen su tabla; el desempate de la poule 2 no se lee.
    expect(l.pools.escritos).toBe(4);
    expect(l.bouts.filter((b) => b.phase === 'TABLEAU').map((b) => [b.roundKey, b.aRef, b.bRef, b.scoreA, b.scoreB])).toEqual([
      ['A4', '101', '103', 15, 9], ['A4', '102', '104', 15, 12], ['A2', '101', '102', 15, 11], ['C2', '103', '104', 15, 14],
    ]);
    const malo = parsearEvento(EVENTO.replace('<td>2-0</td><td>10-5</td>', '<td>2-0</td><td>10-6</td>'));
    expect(leerAsaltos(malo, FIE, 'INDIVIDUAL').pools.descartados).toEqual({ totales_no_cuadran: 3 });
  });

  it('desde 1996 la prueba individual olímpica no tiene poules', () => {
    const base = { tournamentKey: 'juegos_olimpicos|c:x', editionName: 'Jeux Olympiques', resultados: 10, format: 'INDIVIDUAL' } as PruebaBase;
    const ps = [
      { ...base, date: '2004-08-15', poule: 0, tableau: 20 },
      { ...base, date: '1988-09-20', poule: 0, tableau: 20 },
      { ...base, date: '2008-08-10', poule: 0, tableau: 0 },
    ] as PruebaBase[];
    expect(objetivosOlimpicos(ps).map((p) => p.date)).toEqual(['1988-09-20', '2008-08-10']);
  });
});

const ARBOL = `<h3>Tableau de 4</h3><table class="tableau" summary="Tableau de 4">
<tr><td class="D" align=right>1&nbsp;</td><td class="HBD">&nbsp;ALFA Ana&nbsp;</td><td class="HBD">&nbsp;ITA</td><td>&nbsp;</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td class="D">&nbsp;</td><td class="HBD">&nbsp;ALFA Ana&nbsp;</td></tr>
<tr><td class="D" align=right>4&nbsp;</td><td class="HBD">&nbsp;DELTA Dora&nbsp;</td><td class="HBD">&nbsp;HUN</td><td class="D">&nbsp;&nbsp;15/7</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td class="D">&nbsp;</td><td class="HBD">&nbsp;BETA Bea&nbsp;</td></tr>
<tr><td class="D" align=right>3&nbsp;</td><td class="HBD">&nbsp;GAMMA Clara&nbsp;</td><td class="HBD">&nbsp;FRA</td><td class="D">&nbsp;</td><td class="D">&nbsp;&nbsp;15/14</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td class="D">&nbsp;</td><td class="HBD">&nbsp;BETA Bea&nbsp;</td><td class="D">&nbsp;</td></tr>
<tr><td class="D" align=right>2&nbsp;</td><td class="HBD">&nbsp;BETA Bea&nbsp;</td><td class="HBD">&nbsp;GER</td><td>&nbsp;&nbsp;10/8</td></tr>
</table>`;

describe('cuadro antiguo de Engarde (árbol sin títulos de columna)', () => {
  it('reconoce la ronda inicial', () => {
    expect(rondaInicial('Tableau pr\uFFFDliminaire de 128')).toBe(128);
    expect(rondaInicial('Quarts de finale')).toBe(8);
    expect(rondaInicial('Table of 64')).toBe(64);
  });
  it('lee cruces, marcadores y naciones', () => {
    const c = parsearCuadroArbol(ARBOL);
    expect(c.estado).toBe('leido');
    expect(c.completo).toBe(true);
    expect(c.cruces.map((x) => [x.ronda, x.nombreA, x.paisA, x.puntosA, x.nombreB, x.puntosB])).toEqual([
      ['A4', 'ALFA Ana', 'ITA', 15, 'DELTA Dora', 7],
      ['A4', 'GAMMA Clara', 'FRA', 8, 'BETA Bea', 10],
      ['A2', 'ALFA Ana', 'ITA', 14, 'BETA Bea', 15],
    ]);
  });
});

const LISTA_FIECH = `<table><tr><td><span id="labNameDat" class="ListText">Alpe Adria</span></td><td><span id="labLocalDat">Lignano</span></td>
<td><span id="labDtBeginDat">06.01.2012</span></td><td><span id="labFencerCatDat">Junior</span></td><td><span id="labWeaponDat">Epée</span></td>
<td><span id="labSexDat">M</span></td><td><span id="labContestTypeDat">Individual</span></td></tr></table>
<table id="Table2"><thead><tr><th>Rank</th><th>Pts</th><th>Name</th><th>Nationality</th><td>Birth</td><th>Licence</th></tr></thead>
<tr><td class="ListText">1</td><td class="ListText">32</td><td><a href="#"><span>ALFA Marco</span></a></td><td class="ListText">ITA</td><td>04.09.93</td><td>04091993000</td></tr>
<tr><td class="ListText">2</td><td class="ListText">26</td><td><a href="#"><span>BETA Luca</span></a></td><td class="ListText">SUI</td><td>10.03.92</td><td>10031992003</td></tr>
<tr><td class="ListText">3</td><td class="ListText">20</td><td><a href="#"><span>GAMMA Rui</span></a></td><td class="ListText">POR</td><td>01.06.93</td><td>01061993000</td></tr>
<tr><td class="ListText">3</td><td class="ListText">20</td><td><a href="#"><span>DELTA Ali</span></a></td><td class="ListText">TUR</td><td>26.05.92</td><td>26051992000</td></tr></table>`;

describe('clasificaciones de la web antigua de la FIE', () => {
  it('lee cabecera y puestos', () => {
    const l = parsearListaFiech(LISTA_FIECH)!;
    expect([l.competicion, l.fecha, l.categoria, l.arma, l.genero, l.formato]).toEqual(['Alpe Adria', '2012-01-06', 'M20', 'ESPADA', 'M', 'INDIVIDUAL']);
    expect(l.filas.map((f) => [f.puesto, f.nombre, f.nacion, f.puntos, f.licencia])).toEqual([
      [1, 'ALFA Marco', 'ITA', '32', '04091993000'], [2, 'BETA Luca', 'SUI', '26', '10031992003'],
      [3, 'GAMMA Rui', 'POR', '20', '01061993000'], [3, 'DELTA Ali', 'TUR', '20', '26051992000'],
    ]);
    expect(listaCoherente(l)).toBe(true);
    expect(listaCoherente({ ...l, filas: l.filas.slice(1) })).toBe(false);
    const equipos = parsearListaFiech(LISTA_FIECH.replace('>Individual<', '>Par équipes<'))!;
    expect(equipos.formato).toBe('EQUIPOS');
  });
  it('reconoce la misma ciudad con otra grafía y no confunde ciudades distintas', () => {
    expect(mismaCiudad('St-Petersbourg', 'St Petersbourg')).toBe(true);
    expect(mismaCiudad('Göteborg', 'Goteborg')).toBe(true);
    expect(mismaCiudad('Barcelone', 'San José')).toBe(false);
    expect(mismaCiudad('Budapest', 'Hammamet')).toBe(false);
    expect(mismaCiudad(null, 'Berne')).toBe(false);
  });
});

describe('exportaciones de Engarde en la Wayback', () => {
  it('clasifica los documentos y deja fuera los cuadros de puestos', () => {
    expect(tipoDoc('ClasGeneral.htm')).toBe('clasificacion');
    expect(tipoDoc('poules.htm')).toBe('poules');
    expect(tipoDoc('tableau%20de%20128.htm')).toBe('cuadro');
    expect(tipoDoc('tableau_a64.htm')).toBe('cuadro');
    expect(tipoDoc('tableaufinal.htm')).toBe('cuadro');
    expect(tipoDoc('tableau_b8.htm')).toBeNull();
    expect(tipoDoc('clasFinPoules.htm')).toBeNull();
    expect(vueltaPoules('poules.htm')).toBe(1);
    expect(vueltaPoules('poules2.htm')).toBe(2);
  });
  it('lee arma, sexo, categoría y modalidad del código de carpeta', () => {
    expect(atributosDeCodigo('efj-in')).toEqual({ arma: 'ESPADA', genero: 'F', categoria: 'M20', equipos: false });
    expect(atributosDeCodigo('SMC-AUX')).toEqual({ arma: 'SABLE', genero: 'M', categoria: 'M17', equipos: false });
    expect(atributosDeCodigo('fm-eq')).toEqual({ arma: 'FLORETE', genero: 'M', categoria: null, equipos: true });
    expect(atributosDeCodigo('gylcs')).toBeNull();
  });
  it('lee la fecha de la cabecera', () => {
    expect(fechaCabecera(['Epee Feminine Juniors', 'Acireale', 'Le 10 avril 2008'])).toBe('2008-04-10');
    expect(fechaCabecera(['BELEK TURKIE', '14 avril 2007'])).toBe('2007-04-14');
    expect(fechaCabecera(['Budapest 05 e 12 aout 2013'])).toBe('2013-08-12');
  });
  it('agrupa por carpeta con la última captura de cada documento', () => {
    expect(claveCarpeta('http://www.fie.ch:80/External%5FData/resultats/ef-in/poules.htm')).toEqual({ carpeta: 'fie.ch/external_data/resultats/ef-in/', fichero: 'poules.htm' });
    const g = agruparCapturas([
      { timestamp: '20080410113021', original: 'http://live.fie.ch:80/resultats/efc-in/poules.htm' },
      { timestamp: '20080411000000', original: 'http://live.fie.ch/resultats/efc-in/poules.htm' },
      { timestamp: '20080410113041', original: 'http://live.fie.ch:80/resultats/efc-in/clasfinal.htm' },
      { timestamp: '20080410113041', original: 'http://live.fie.ch:80/resultats/efc-in/tireurs.htm' },
      { timestamp: '20080410113041', original: 'http://live.fie.ch:80/resultats/efj-in/clasfinal.htm' },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].documentos.find((d) => d.tipo === 'poules')?.timestamp).toBe('20080411000000');
  });
  it('separa en pruebas distintas las capturas de una carpeta reutilizada', () => {
    const g = agruparCapturas([
      { timestamp: '20071009232204', original: 'http://www.fie.ch/External%5FData/resultats/ef-in/clasfinal.htm' },
      { timestamp: '20071010095614', original: 'http://www.fie.ch/External%5FData/resultats/ef-in/poules.htm' },
      { timestamp: '20101109232204', original: 'http://www.fie.ch/External%5FData/resultats/ef-in/clasfinal.htm' },
      { timestamp: '20101110095614', original: 'http://www.fie.ch/External%5FData/resultats/ef-in/tableau64.htm' },
    ]);
    expect(g.map((c) => [c.clave, c.documentos.map((d) => d.timestamp.slice(0, 4))])).toEqual([
      ['fie.ch/external_data/resultats/ef-in/@20071009', ['2007', '2007']],
      ['fie.ch/external_data/resultats/ef-in/@20101109', ['2010', '2010']],
    ]);
  });
  it('compara cabeceras sin la fecha de cada fase', () => {
    const cab = (fecha: string) => `<h1>Championnats du Monde<br><small>Epee Feminine Seniors<br>Antalya<br>${fecha}</small></h1>`;
    expect(firmaCabecera(cab('Le 2 octobre 2009'))).toBe(firmaCabecera(cab('Le 5 octobre 2009')));
    expect(firmaCabecera(cab('Le 2 octobre 2009'))).not.toBe(firmaCabecera(cab('Le 2 octobre 2009').replace('Feminine', 'Masculine')));
  });
});
