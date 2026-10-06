import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { componerChunk, proyeccion } from '../scripts/indexado/sincronizar-d1';
import { listaEfc, temporadasEfc, urlEfc } from '@/lib/ingest/rankings-internacionales/efc';
import { parseRankingFie } from '@/lib/ingest/rankings-internacionales/fie';
import { listaFfe, parseFichaFfe, parseListadoFfe } from '@/lib/ingest/rankings-internacionales/ffe';
import {
  anioDeCeldaFis,
  claseDocumentoFis,
  elegirDocumentosFis,
  listasFis,
  parseBusquedaFis,
} from '@/lib/ingest/rankings-internacionales/fis';
import { listaHkfa, parseTextoHkfa, temporadaHkfa } from '@/lib/ingest/rankings-internacionales/hkfa';
import { listaMvsz, temporadasMvsz } from '@/lib/ingest/rankings-internacionales/mvsz';
import { sentenciasLista } from '@/lib/ingest/rankings-internacionales/sql';
import type { ListaInternacional } from '@/lib/ingest/rankings-internacionales/tipos';
import { indicePersonas, vincularFila, vincularLista } from '@/lib/ingest/rankings-internacionales/vincular';
import { leerXlsx, type HojaXlsx } from '@/lib/ingest/rankings-internacionales/xlsx';
import {
  anioFinTemporada,
  construirRankingInternacional,
  fuentesParaPais,
  leerRankingInternacional,
} from '@/lib/sport/explorar/ranking-internacional';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const HOY = '2026-10-06';

// ------------------------------------------------------------- Fixtures ---

/** Extracto real (recortado) de `detailed-ranking?season=2012&weapon=E&gender=M&category=S&type=I`. */
const FIE_2012 = {
  season: 2012, weapon: 'E', gender: 'M', level: 'S', type: 'I', ageBand: null, competitions: [],
  fencers: [
    { rank: 1, addrId: 2853, name: 'GRUMIER Gauthier', country: 'FRANCE', countryCode: 'FRA', points: '228.000', competitionPoints: {} },
    { rank: 2, addrId: 4701, name: 'TAGLIARIOL Matteo', country: 'ITALY', countryCode: 'ITA', points: '201.500' },
    { rank: 2, addrId: 4701, name: 'TAGLIARIOL Matteo', country: 'ITALY', countryCode: 'ITA', points: '201.500' },
    { rank: null, addrId: 26146, name: 'MIGALLON Guillermo', countryCode: 'ESP', points: '0.000' },
    { rank: 9, name: 'SIN ID' },
  ],
};

/** Hoja del .xlsx de descarga de la EFC (cabecera real). */
const HOJA_EFC: HojaXlsx = {
  nombre: 'Worksheet',
  filas: [
    ['Rank', 'Points', 'Name', 'Country', 'Hand', 'Year of birth'],
    ['1', '278', 'DELFINO Francesco', 'ITA', 'right', '2008'],
    ['2', '232', 'VAN LAECKE Wout', 'BEL', 'right', '2009'],
    ['3', '202', 'GAULIARD Thomas', 'FRA', '', ''],
  ],
};

const LISTADO_FFE = `
<div class="section__table-row"> <ul> <li> Classement National Individuel - Fleuret Homme Senior </li> <li> National </li>
<li style="display: flex;"> <div class="discipline"><div class="discipline__content"> <span>F</span> </div></div> <div> / Hommes </div> </li>
<li> SENIOR </li> <li> Individuelle </li> <li> <a href="/fiche-classements/346" class="btn"> Consulter </a> </li> </ul> </div><!-- /.section__table-row -->
<div class="section__table-row"> <ul> <li> Classement National Individuel - Epée Dame M20 </li> <li> National </li>
<li> <span>E</span> / Femmes </li> <li> M20 </li> <li> Individuelle </li> <li> <a href="/fiche-classements/412"> Consulter </a> </li> </ul> </div><!-- /.section__table-row -->
<div class="section__table-row"> <ul> <li> Classement National Individuel - Epée Dame Vétéran 1 </li> <li> National </li>
<li> <span>E</span> / Femmes </li> <li> V1 </li> <li> Individuelle </li> <li> <a href="/fiche-classements/349"> Consulter </a> </li> </ul> </div><!-- /.section__table-row -->
<div class="section__table-row"> <ul> <li> Classement Régional FHM15 PDL </li> <li> Régional </li>
<li> <span>F</span> / Hommes </li> <li> M15 </li> <li> Individuelle </li> <li> <a href="/fiche-classements/1029"> Consulter </a> </li> </ul> </div><!-- /.section__table-row -->`;

const FICHA_FFE = `<h1 class="title">Classement National Individuel - Fleuret Homme Senior</h1>
<div style="text-align: right;">Dernière mise à jour le 23/10/2024 à 17:08:00</div>
<ul data-cla="35" data-tir="53090" data-light=""> <li> <span class="mobile-libelle-detail-classement">Rang :</span> 1 </li>
<li> <span class="mobile-libelle-detail-classement">Nom :</span> SAVIN </li> <li> <span class="mobile-libelle-detail-classement">Prénom :</span> Rafael </li>
<li> <span class="mobile-libelle-detail-classement">Club :</span> BLR92 </li> <li> <span class="mobile-libelle-detail-classement">Points :</span> 55593.00 </li> <li> <span class="row__arrow"></span> </li> </ul>
<ul data-cla="35" data-tir="37190" data-light=""> <li> <span class="mobile-libelle-detail-classement">Rang :</span> 2 </li>
<li> <span class="mobile-libelle-detail-classement">Nom :</span> LOISEL </li> <li> <span class="mobile-libelle-detail-classement">Prénom :</span> Pierre </li>
<li> <span class="mobile-libelle-detail-classement">Club :</span> O.G.C. NICE ESCRIME </li> <li> <span class="mobile-libelle-detail-classement">Points :</span> 53904.00 </li> </ul>`;

const BUSQUEDA_FIS = `
<article class="w-grid-item post-203906 documento" data-id="203906"><time datetime="2026-07-28T10:00:00+02:00">x</time>
<h2 class="w-post-elm post_title">RANKING ASSOLUTO 2025-2026 FINALE</h2><a href="/wp-content/plugins/if_document_manager/forceDownload.php?ID_file=203906">.</a></article>
<article class="w-grid-item" data-id="203880"><time datetime="2026-07-27T10:00:00+02:00">x</time>
<h2>RANKING ASSOLUTO 2025-2026 N.23/26</h2><a href="/wp-content/plugins/if_document_manager/forceDownload.php?ID_file=203880">.</a></article>
<article class="w-grid-item" data-id="205059"><time datetime="2026-10-05T10:00:00+02:00">x</time>
<h2>RANKING UNDER 23 2026-27 n.1/27</h2><a href="/wp-content/plugins/if_document_manager/forceDownload.php?ID_file=205059">.</a></article>
<article class="w-grid-item" data-id="205050"><time datetime="2026-09-01T10:00:00+02:00">x</time>
<h2>RANKING U23 2026-27 INIZIALE</h2><a href="/wp-content/plugins/if_document_manager/forceDownload.php?ID_file=205050">.</a></article>
<article class="w-grid-item" data-id="191858"><time datetime="2025-08-04T10:00:00+02:00">x</time>
<h2>RANKING MASTER 2024-2025 FINALE</h2><a href="/wp-content/plugins/if_document_manager/forceDownload.php?ID_file=191858">.</a></article>`;

/** Hoja real del ranking assoluto (recortada a las columnas que se leen y alguna más). */
const HOJA_FIS: HojaXlsx = {
  nombre: 'FM A',
  filas: [
    ['FEDERAZIONE  ITALIANA  SCHERMA', ''],
    [],
    ['RANKING ASSOLUTO 2025 - 2026  -  FIORETTO  MASCHILE'],
    ['FINALE'],
    [],
    ['Rank', 'NOME', 'Codice', 'Società', 'Anno', 'qual1', 'open1', 'TOTALE', 'Rank iniz.', '+/-'],
    ['1', 'MACCHI FILIPPO', '650831', 'RMFFO', '37153', '0', '36850', '255195.003', '4', '3'],
    ['2', 'MARINI TOMMASO', '643650', 'RMFFO', '36633', '0', '29480', '168390.84433333331', '2', '0'],
    ['', '', '', '', '', '', '', '', '', ''],
  ],
};

const TEXTO_HKFA = `男子花劍排名 Ranking of Men's Foil
Ranking Name 姓名
PC 2025
08.11.2025
WC Palma de
Mallorca
17.05.2026
GP Shanghai
Overall
248 fencers 232 fencers 330 fencers
1 Ho Shing Him Harris 何承謙 10 2 5 3 1 13 40 45 7 57 13 74
2 Cheung Ka Long 張家朗 1 19 21 3 3 17 35 37 68
10 Lau Kenji Tsun Yin 劉晉延 16 6 2 16 6 31
10 Lee Yat Long Aaron 李逸朗 8 3 15 24 9 57 31`;

// ------------------------------------------------------------- Lectores ---

describe('lectores de cada fuente', () => {
  it('FIE: lista pedida, sin repetidos ni filas sin id; otra temporada no vale', () => {
    const c = { season: 2012, weapon: 'E', gender: 'M', category: 'S' } as const;
    const l = parseRankingFie(FIE_2012, c, HOY)!;
    expect(l).toMatchObject({ fuente: 'fie_historico', temporada: '2012', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'S', total: 5 });
    expect(l.filas.map((f) => f.ref)).toEqual(['fie:2853', 'fie:4701', 'fie:26146']);
    expect(l.filas[2]).toMatchObject({ puesto: null, fieId: 26146, pais: 'ESP', puntos: '0.000' });
    expect(parseRankingFie({ ...FIE_2012, season: 2013 }, c, HOY)).toBeNull();
  });

  it('EFC: descarga .xlsx con país COI y año de nacimiento', () => {
    const l = listaEfc({ season: 2024, age: 'cadet', weapon: 'epee', gender: 'men' }, [HOJA_EFC], HOY)!;
    expect(l).toMatchObject({ fuente: 'efc_ranking', temporada: '2024-2025', categoria: 'M17', categoriaRaw: 'cadet', arma: 'ESPADA', genero: 'M' });
    expect(l.filas[0]).toMatchObject({ nombre: 'DELFINO Francesco', pais: 'ITA', puesto: 1, puntos: '278', anioNacimiento: 2008 });
    expect(l.filas[2]).toMatchObject({ pais: 'FRA', anioNacimiento: null });
    expect(urlEfc({ season: 2024, age: 'u23', weapon: 'foil', gender: 'women' }, true)).toBe(
      'https://www.fencing-efc.eu/rankings?season=2024&age=u23&gender=women&weapon=foil&team=individual&download_action=download',
    );
    expect(listaEfc({ season: 2024, age: 'cadet', weapon: 'epee', gender: 'men' }, [{ nombre: 'x', filas: [['otra']] }], HOY)).toBeNull();
    expect(temporadasEfc('<div class="js-select-option select__list__option js-click-form" data-value="2026">2026/2027</div><div class="js-select-option select__list__option js-click-form" data-value="2006">x</div>')).toEqual([2006, 2026]);
  });

  it('FFE: sólo fichas nacionales individuales de categorías cargadas; fecha de actualización publicada', () => {
    const fichas = parseListadoFfe(LISTADO_FFE);
    expect(fichas.map((f) => [f.id, f.arma, f.genero, f.categoria])).toEqual([['346', 'FLORETE', 'M', 'ABS'], ['412', 'ESPADA', 'F', 'M20']]);
    expect(parseFichaFfe(FICHA_FFE)).toMatchObject({ actualizado: '2024-10-23', titulo: 'Classement National Individuel - Fleuret Homme Senior' });
    const l = listaFfe(2025, fichas[0], FICHA_FFE, HOY);
    expect(l).toMatchObject({ temporada: '2024-2025', publicadoEl: '2024-10-23', baseFecha: 'source', total: 2 });
    expect(l.filas[1]).toEqual({ ref: 'ffe:37190', nombre: 'LOISEL Pierre', pais: null, puesto: 2, puntos: '53904.00' });
  });

  it('FIS: elige el FINALE o el más reciente por categoría y temporada; lee la hoja', () => {
    const docs = parseBusquedaFis(BUSQUEDA_FIS);
    expect(docs).toHaveLength(5);
    expect(claseDocumentoFis('RANKING CADETTI 2024-25 FINALE')).toEqual({ categoria: 'M17', categoriaRaw: 'CADETTI', temporada: '2024-2025', finale: true });
    expect(claseDocumentoFis('RANKING U23 2024/2025 FINALE')?.categoria).toBe('M23');
    expect(claseDocumentoFis('RANKING MASTER 2024-2025 FINALE')).toBeNull();
    const elegidos = elegirDocumentosFis(docs);
    expect(elegidos.map((d) => [d.idFile, d.categoria, d.temporada, d.finale])).toEqual([
      ['203906', 'ABS', '2025-2026', true],
      ['205059', 'M23', '2026-2027', false],
    ]);
    const [l] = listasFis(elegidos[0], [HOJA_FIS, { nombre: 'Foglio1', filas: [] }]);
    expect(l).toMatchObject({ fuente: 'fis_ranking', arma: 'FLORETE', genero: 'M', categoria: 'ABS', temporada: '2025-2026', total: 2, publicadoEl: '2026-07-28' });
    expect(l.filas[0]).toEqual({ ref: 'fis:650831', nombre: 'MACCHI FILIPPO', pais: null, puesto: 1, puntos: '255195.003', anioNacimiento: 2001 });
    expect(anioDeCeldaFis('36633')).toBe(2000);
    expect(anioDeCeldaFis('1998')).toBe(1998);
    expect(anioDeCeldaFis('')).toBeNull();
  });

  it('MVSZ: temporadas del selector y tabla con ficha y nacimiento', () => {
    const form = `<select name='szezon' id='szezon'>\n<option value='16'>2026/2027</option>\n<option value='15'>2025/2026</option>\n</select>`;
    expect(temporadasMvsz(form)).toEqual([{ szezon: '16', temporada: '2026-2027' }, { szezon: '15', temporada: '2025-2026' }]);
    const html = `<table><tr><th>Rang</th><th>Név</th><th>Egyesület</th><th class="hideSzuldat">Szül. dátum</th><th class="hideKor">Korosztály</th><th>Σ</th></tr>
<tr><td>1</td><td><a href="index.php?p=pPontok&szezon=15&kor=10&nem=1&fegyver=3&sorszam=4690">NAGY Dávid Martin</a></td><td>Vasas</td><td class="hideSzuldat">1999-07-14</td><td class="hideKor">felnőtt</td><td>6115</td></tr>
<tr><td>128</td><td><a href="index.php?p=pPontok&sorszam=77">VIKTÓRI-FARKAS Ádám</a></td><td>TSC</td><td class="hideSzuldat">2006-11-11</td><td class="hideKor">junior</td><td>1</td></tr></table>`;
    const l = listaMvsz({ szezon: '15', temporada: '2025-2026', kor: '10', nem: '1', fegyver: '3' }, html, HOY)!;
    expect(l).toMatchObject({ fuente: 'mvsz_ranglista', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'felnőtt', total: 2 });
    expect(l.filas[0]).toEqual({ ref: 'mvsz:4690', nombre: 'NAGY Dávid Martin', pais: null, puesto: 1, puntos: '6115', anioNacimiento: 1999 });
    expect(listaMvsz({ szezon: '15', temporada: '2025-2026', kor: '10', nem: '1', fegyver: '3' }, '<p>nada</p>', HOY)).toBeNull();
  });

  it('FAHK: filas del PDF sin nombre chino; temporada por la última fecha', () => {
    expect(temporadaHkfa(TEXTO_HKFA)).toBe('2025-2026');
    expect(parseTextoHkfa(TEXTO_HKFA)).toEqual([
      { puesto: 1, nombre: 'Ho Shing Him Harris', total: '74', anioNacimiento: null },
      { puesto: 2, nombre: 'Cheung Ka Long', total: '68', anioNacimiento: null },
      { puesto: 10, nombre: 'Lau Kenji Tsun Yin', total: '31', anioNacimiento: null },
      { puesto: 10, nombre: 'Lee Yat Long Aaron', total: '31', anioNacimiento: null },
    ]);
    const cadete = `Ranking of Cadet Men's Foil\nRanking Name 姓名 Year of Birth JFC 2025 AG 2026 U20 2026 JFC 2026 Overall\n1 Liu Hao Yang 劉昊揚 2012 8 9 2 1 35\n10 So Chun Ho 蘇鎮皓 2012 8 8 10`;
    expect(temporadaHkfa(cadete)).toBe('2025-2026');
    expect(parseTextoHkfa(cadete)).toEqual([
      { puesto: 1, nombre: 'Liu Hao Yang', total: '35', anioNacimiento: 2012 },
      { puesto: 10, nombre: 'So Chun Ho', total: '10', anioNacimiento: 2012 },
    ]);
    // Una fecha de la temporada siguiente en el encabezado no cambia la temporada.
    expect(temporadaHkfa('14.11.2025\nJWC Lima\n12.09.2026 Updated\n1 Ho Shing Him 何 3')).toBe('2025-2026');
    const l = listaHkfa({ prefijo: 'u20', genero: 'l', arma: 'f' }, TEXTO_HKFA, HOY)!;
    expect(l).toMatchObject({ fuente: 'hkfa_ranking', categoria: 'M20', genero: 'F', arma: 'FLORETE', temporada: '2025-2026' });
  });
});

// ----------------------------------------------------------------- xlsx ---

function zip(archivos: Record<string, string>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = deflateRawSync(Buffer.from(contenido, 'utf8'));
    const n = Buffer.from(nombre, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    locales.push(local, n, datos);
    centrales.push(central, n);
    desplazamiento += 30 + n.length + datos.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dir, fin]);
}

describe('lector xlsx', () => {
  it('lee texto compartido, en línea y números respetando la columna', () => {
    const bytes = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="FM A" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Rank</t></si><si><t>NOME</t></si><si><r><t>NICOL</t></r><r><t>Ò &amp; CO</t></r></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2"><v>1</v></c><c r="C2" t="s"><v>2</v></c><c r="D2" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
    });
    expect(leerXlsx(bytes)).toEqual([{ nombre: 'FM A', filas: [['Rank', 'NOME'], ['1', '', 'NICOLÒ & CO', 'x']] }]);
  });
});

// ---------------------------------------------------------------- Vínculo ---

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const P4 = '44444444-4444-4444-8444-444444444444';
const P_FUNDIDA = '55555555-5555-4555-8555-555555555555';

describe('vínculo con personas', () => {
  const indice = indicePersonas([
    { personId: P1, fieId: '100', pais: 'FRA', genero: 'M', anioNacimiento: 1999, nombres: ['SAVIN Rafael', 'Rafael SAVIN'] },
    { personId: P2, fieId: '200', pais: 'FRA', genero: 'M', anioNacimiento: null, nombres: ['MARTIN Paul'] },
    { personId: P3, fieId: '300', pais: 'FRA', genero: 'M', anioNacimiento: null, nombres: ['MARTIN Paul'] },
    { personId: P4, fieId: '400', pais: 'ITA', genero: 'F', anioNacimiento: 2001, nombres: ['MOLINARI Matilde'] },
  ]);
  const M = { genero: 'M' as const };

  it('id FIE manda cuando lo hay', () => {
    expect(vincularFila({ ref: 'fie:100', nombre: 'otro', pais: null, puesto: 1, puntos: null, fieId: 100 }, M, null, indice)).toEqual({ personId: P1, via: 'fie_id' });
    expect(vincularFila({ ref: 'fie:9', nombre: 'SAVIN Rafael', pais: 'FRA', puesto: 1, puntos: null, fieId: 9 }, M, null, indice)).toEqual({ personId: null, motivo: 'fie_id_desconocido' });
  });

  it('nombre exacto (orden y acentos aparte) + país + género + nacimiento; nunca aproximado', () => {
    const fila = (nombre: string, extra: object = {}) => ({ ref: 'x', nombre, pais: null, puesto: 1, puntos: null, ...extra });
    expect(vincularFila(fila('Savín RAFAEL'), M, 'FRA', indice)).toEqual({ personId: P1, via: 'nombre' });
    expect(vincularFila(fila('SAVIN Rafael', { anioNacimiento: 2000 }), M, 'FRA', indice)).toEqual({ personId: null, motivo: 'nacimiento_distinto' });
    expect(vincularFila(fila('SAVIN Rafa'), M, 'FRA', indice)).toEqual({ personId: null, motivo: 'sin_candidata' });
    expect(vincularFila(fila('SAVIN Rafael'), M, 'ITA', indice)).toEqual({ personId: null, motivo: 'sin_candidata' });
    expect(vincularFila(fila('SAVIN Rafael'), { genero: 'F' }, 'FRA', indice)).toEqual({ personId: null, motivo: 'genero_distinto' });
    expect(vincularFila(fila('MARTIN Paul'), M, 'FRA', indice)).toEqual({ personId: null, motivo: 'ambigua' });
    expect(vincularFila(fila('MOLINARI MATILDE', { pais: 'ITA', anioNacimiento: 2001 }), { genero: 'F' }, null, indice)).toEqual({ personId: P4, via: 'nombre' });
    expect(vincularFila(fila('MOLINARI MATILDE'), { genero: 'F' }, null, indice)).toEqual({ personId: null, motivo: 'sin_pais' });
  });

  describe('personas sin id FIE', () => {
    const E1 = 'e1e1e1e1-0000-4000-8000-000000000001';
    const E2 = 'e1e1e1e1-0000-4000-8000-000000000002';
    const E3 = 'e1e1e1e1-0000-4000-8000-000000000003';
    const E4 = 'e1e1e1e1-0000-4000-8000-000000000004';
    const E5 = 'e1e1e1e1-0000-4000-8000-000000000005';
    const E6 = 'e1e1e1e1-0000-4000-8000-000000000006';
    const ind = indicePersonas([
      { personId: E1, fieId: null, pais: 'GER', genero: 'M', anioNacimiento: 2008, nombres: ['MÜLLER Jonas'] },
      { personId: E2, fieId: null, pais: 'AUT', genero: 'M', anioNacimiento: 2008, nombres: ['MÜLLER Jonas'] },
      { personId: E3, fieId: null, pais: 'HUN', genero: 'F', anioNacimiento: 2007, nombres: ['KISS Anna'] },
      { personId: E4, fieId: null, pais: 'HUN', genero: 'F', anioNacimiento: 2009, nombres: ['KISS Anna'] },
      { personId: E5, fieId: null, pais: 'HUN', genero: 'F', anioNacimiento: 2009, nombres: ['KISS Dora'] },
      { personId: E6, fieId: null, pais: 'ITA', genero: null, anioNacimiento: null, nombres: ['ROSSI Luca'] },
      { personId: P1, fieId: '100', pais: 'FRA', genero: 'M', anioNacimiento: 1999, nombres: ['SAVIN Rafael'] },
    ]);
    const fila = (nombre: string, extra: object = {}) => ({ ref: `x:${nombre}`, nombre, pais: null, puesto: 1, puntos: null, ...extra });
    const M = { genero: 'M' as const };
    const F = { genero: 'F' as const };

    it('entran por nombre con país y género; homónimos de otro país no cuentan', () => {
      expect(vincularFila(fila('Muller JONAS', { pais: 'GER' }), M, null, ind)).toEqual({ personId: E1, via: 'nombre' });
      expect(vincularFila(fila('MULLER Jonas', { pais: 'AUT', anioNacimiento: 2008 }), M, null, ind)).toEqual({ personId: E2, via: 'nombre' });
      expect(vincularFila(fila('MULLER Jonas', { pais: 'SUI' }), M, null, ind)).toEqual({ personId: null, motivo: 'sin_candidata' });
      expect(vincularFila(fila('MULLER Jonas', { pais: 'GER' }), F, null, ind)).toEqual({ personId: null, motivo: 'genero_distinto' });
      expect(vincularFila(fila('MULLER Jonas', { pais: 'GER', anioNacimiento: 2006 }), M, null, ind)).toEqual({ personId: null, motivo: 'nacimiento_distinto' });
    });

    it('sin género conocido no son candidatas', () => {
      expect(vincularFila(fila('ROSSI Luca'), M, 'ITA', ind)).toEqual({ personId: null, motivo: 'sin_candidata' });
    });

    it('hermanas con el mismo nombre: sólo el año las separa', () => {
      expect(vincularFila(fila('KISS Anna'), F, 'HUN', ind)).toEqual({ personId: null, motivo: 'ambigua' });
      expect(vincularFila(fila('KISS Anna', { anioNacimiento: 2009 }), F, 'HUN', ind)).toEqual({ personId: E4, via: 'nombre' });
      expect(vincularFila(fila('KISS Dora'), F, 'HUN', ind)).toEqual({ personId: E5, via: 'nombre' });
    });

    it('una persona nunca ocupa dos filas de la misma lista', () => {
      const v = vincularLista([fila('KISS Dora', { ref: 'a' }), fila('KISS Dora', { ref: 'b' }), fila('KISS Anna', { ref: 'c', anioNacimiento: 2007 })], F, 'HUN', ind);
      expect(v).toEqual([
        { personId: null, motivo: 'persona_repetida' },
        { personId: null, motivo: 'persona_repetida' },
        { personId: E3, via: 'nombre' },
      ]);
      const w = vincularLista([fila('SAVIN Rafael', { ref: 'n' }), { ...fila('otro', { ref: 'f' }), fieId: 100 }], M, 'FRA', ind);
      expect(w).toEqual([{ personId: null, motivo: 'persona_repetida' }, { personId: P1, via: 'fie_id' }]);
    });
  });
});

// --------------------------------------------------------------- Lectura ---

function lista(extra: Partial<ListaInternacional> & Pick<ListaInternacional, 'fuente' | 'temporada'>): ListaInternacional {
  return {
    arma: 'FLORETE', genero: 'M', categoria: 'ABS', categoriaRaw: 'S', publicadoEl: HOY, baseFecha: 'observed',
    url: 'https://example.invalid/x', total: 500, filas: [], ...extra,
  };
}

function base() {
  const local = fixtureDeportivaD1();
  const ejecutar = (cuerpo: string, cargo: number) =>
    local.sqlite.exec(componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: 1, proyectadoBytes: proyeccion(cargo) }));
  ejecutar([
    `INSERT INTO sport_person(id,display_name,name_normalized,gender,birth_year,country_code) VALUES('${P1}','SAVIN Rafael','rafael savin','M',1999,'FRA')`,
    `INSERT INTO sport_person(id,display_name,name_normalized,gender,birth_year,country_code,merged_into_person_id) VALUES('${P_FUNDIDA}','SAVIN R.','r savin','M',1999,'FRA','${P1}')`,
    `INSERT INTO sport_person(id,display_name,name_normalized,gender,country_code) VALUES('${P2}','OTRO Tirador','otro tirador','M','FRA')`,
  ].map((s) => `${s};\n`).join(''), 200_000);
  const cargar = (l: ListaInternacional, cerrada: boolean, filas: { ref: string; personId: string | null; puesto: number | null; puntos?: string }[]) => {
    const { sentencias, cargo } = sentenciasLista(l, filas.map((f) => ({ nombre: null, pais: 'FRA', puntos: f.puntos ?? null, ...f })), cerrada);
    ejecutar(sentencias.map((s) => `${s};\n`).join(''), cargo);
  };
  return { ...local, cargar };
}

const cuenta = (local: ReturnType<typeof base>, tabla: string) =>
  Number((local.sqlite.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n);

describe('carga SQL', () => {
  it('cerrada: una sola publicación por lista aunque cambie el día; abierta: una por día', () => {
    const local = base();
    try {
      const l = lista({ fuente: 'fie_historico', temporada: '2016' });
      local.cargar(l, true, [{ ref: 'fie:100', personId: P1, puesto: 5 }]);
      local.cargar({ ...l, publicadoEl: '2026-12-01' }, true, [{ ref: 'fie:100', personId: P1, puesto: 5 }]);
      local.cargar(l, true, [{ ref: 'fie:100', personId: P1, puesto: 5 }]);
      expect(cuenta(local, 'sport_ranking_publication')).toBe(1);
      expect(cuenta(local, 'sport_ranking_entry')).toBe(1);
      const h = lista({ fuente: 'hkfa_ranking', temporada: '2025-2026', categoriaRaw: 'Open' });
      local.cargar(h, false, [{ ref: 'hkfa:a', personId: P2, puesto: 3 }]);
      local.cargar({ ...h, publicadoEl: '2026-11-06' }, false, [{ ref: 'hkfa:a', personId: P2, puesto: 2 }]);
      local.cargar(h, false, [{ ref: 'hkfa:a', personId: P2, puesto: 3 }]);
      expect(cuenta(local, 'sport_ranking_publication')).toBe(3);
      const e = local.sqlite.prepare(`SELECT country_code AS pais FROM sport_ranking_entry WHERE source_ref='fie:100'`).get() as { pais: string };
      expect(e.pais).toBe('FRA');
    } finally {
      local.close();
    }
  });
});

describe('ranking internacional de una persona', () => {
  it('mundial actual y mejor de carrera, nacional propia y continental, por la persona fundida', async () => {
    const local = base();
    try {
      // Histórico FIE: absoluto 2016 (#40) y 2024 (#12, su mejor); júnior 2017 (#3).
      local.cargar(lista({ fuente: 'fie_historico', temporada: '2016' }), true, [{ ref: 'fie:100', personId: P_FUNDIDA, puesto: 40, puntos: '20.5' }]);
      local.cargar(lista({ fuente: 'fie_historico', temporada: '2024' }), true, [{ ref: 'fie:100', personId: P1, puesto: 12 }]);
      local.cargar(lista({ fuente: 'fie_historico', temporada: '2017', categoria: 'M20', categoriaRaw: 'J' }), true, [{ ref: 'fie:100', personId: P1, puesto: 3 }]);
      // Temporada en curso (ingesta diaria) y otra persona sola en el júnior vigente.
      local.cargar(lista({ fuente: 'fie_tiradores' as ListaInternacional['fuente'], temporada: '2027' }), false, [{ ref: 'fie:100', personId: P1, puesto: 25 }]);
      local.cargar(lista({ fuente: 'fie_tiradores' as ListaInternacional['fuente'], temporada: '2027', categoria: 'M20', categoriaRaw: 'J' }), false, [{ ref: 'fie:200', personId: P2, puesto: 1 }]);
      // Nacional FFE: lectura antigua (#1) superada por una posterior en la que ya no figura.
      const ffe = lista({ fuente: 'ffe_classement', temporada: '2026-2027', categoriaRaw: 'SENIOR', publicadoEl: '2026-09-01', baseFecha: 'source' });
      local.cargar(ffe, false, [{ ref: 'ffe:1', personId: P1, puesto: 1 }]);
      local.cargar({ ...ffe, publicadoEl: '2026-10-01' }, false, [{ ref: 'ffe:2', personId: P2, puesto: 1 }]);
      local.cargar(lista({ fuente: 'ffe_classement', temporada: '2025-2026', categoriaRaw: 'SENIOR' }), true, [{ ref: 'ffe:1', personId: P1, puesto: 2 }]);
      // Otra federación nacional: no es la suya.
      local.cargar(lista({ fuente: 'fis_ranking', temporada: '2025-2026', categoriaRaw: 'ASSOLUTI' }), true, [{ ref: 'fis:1', personId: P1, puesto: 7 }]);
      // Continental (EFC U23).
      local.cargar(lista({ fuente: 'efc_ranking', temporada: '2019-2020', categoria: 'M23', categoriaRaw: 'u23' }), true, [{ ref: 'efc:x', personId: P1, puesto: 4 }]);

      const r = await leerRankingInternacional(local.db, P_FUNDIDA);
      expect(r.mundial).toMatchObject({ organismos: ['FIE'], vigente: 2027, ultimaTemporada: 2027 });
      expect(r.mundial!.actual.map((p) => [p.fuente, p.temporada, p.categoria, p.puesto])).toEqual([['fie_tiradores', '2027', 'ABS', 25]]);
      expect(r.mundial!.mejor).toMatchObject({ temporada: '2017', categoria: 'M20', puesto: 3 });
      expect(r.mundial!.mejores.map((p) => [p.categoria, p.puesto, p.temporada])).toEqual([['ABS', 12, '2024'], ['M20', 3, '2017']]);
      const abs = r.mundial!.series.find((s) => s.categoria === 'ABS')!;
      expect(abs.serie.map((p) => [p.anioFin, p.puesto])).toEqual([[2016, 40], [2024, 12], [2027, 25]]);
      expect(abs.serie[0]).toMatchObject({ puntos: 20.5, de: 500, organismo: 'FIE', ambito: 'mundial' });

      expect(r.nacional).toMatchObject({ organismos: ['FFE'], vigente: 2027, ultimaTemporada: 2026 });
      expect(r.nacional!.actual).toEqual([]);
      expect(r.nacional!.mejor).toMatchObject({ temporada: '2025-2026', puesto: 2 });

      expect(r.continental).toMatchObject({ organismos: ['EFC'], vigente: 2020, ultimaTemporada: 2020 });
      expect(r.continental!.actual.map((p) => p.puesto)).toEqual([4]);
    } finally {
      local.close();
    }
  });

  it('sin datos o sin persona: vacío', async () => {
    const local = base();
    try {
      expect(await leerRankingInternacional(local.db, P2)).toEqual({ mundial: null, continental: null, nacional: null });
      expect(await leerRankingInternacional(local.db, '99999999-9999-4999-8999-999999999999')).toEqual({ mundial: null, continental: null, nacional: null });
    } finally {
      local.close();
    }
  });

  it('piezas puras', () => {
    expect(anioFinTemporada('2024')).toBe(2024);
    expect(anioFinTemporada('2023-2024')).toBe(2024);
    expect(anioFinTemporada('x')).toBeNull();
    expect(fuentesParaPais('ITA')).toEqual(expect.arrayContaining(['fie_tiradores', 'fie_historico', 'efc_ranking', 'fis_ranking']));
    expect(fuentesParaPais('ITA')).not.toContain('ffe_classement');
    expect(fuentesParaPais(null)).not.toContain('skermo_ranking');
    expect(construirRankingInternacional([], [])).toEqual({ mundial: null, continental: null, nacional: null });
  });
});
