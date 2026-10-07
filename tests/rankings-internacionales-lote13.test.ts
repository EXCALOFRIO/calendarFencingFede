import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { COMBOS_FPE, claveFpe, entradaFpe, filaFpe, listaFpe, nonceFpe, pdfFpe, urlBusquedaFpe } from '@/lib/ingest/rankings-internacionales/fpe';
import { listaOefv } from '@/lib/ingest/rankings-internacionales/oefv';
import { filasCeldas, trozosPagina, type Celda } from '@/lib/ingest/rankings-internacionales/pdf-celdas';
import { aniosSgp, archivoSgp, combosSgp, listaSgp, nombreSgp, urlSgp } from '@/lib/ingest/rankings-internacionales/sgp';
import { archivosUsa, carpetasUsa, elegirPdfsUsa, ficherosCarpetaUsa, finalTemporadaUsa, listaUsa, nombreUsa, pdfUsa } from '@/lib/ingest/rankings-internacionales/usa';
import { indicePersonas, vincularLista } from '@/lib/ingest/rankings-internacionales/vincular';
import { entradasZip } from '@/lib/ingest/rankings-internacionales/xlsx';
import { FUENTES_RANKING, fuentesNacionalesDe } from '@/lib/sport/rankings-internacionales-fuentes';

describe('USA Fencing (Estados Unidos)', () => {
  it('zips del archivo por temporada', () => {
    const html = `<a href="https://assets.contentstack.io/v3/x/Archive_2024-25.zip" target="_blank">2024-25</a>
      <a href="https://teamusa-org-migration.s3.amazonaws.com/USA%20Fencing/Archive_2020-21.zip">2020-21</a>
      <a href="https://assets.ngin.com/final99.zip">1998-99</a><a href="https://x/raro.zip">2024-27</a><a href="/point-rules">Rules</a>`;
    expect(archivosUsa(html)).toEqual([
      { temporada: '2024-2025', url: 'https://assets.contentstack.io/v3/x/Archive_2024-25.zip' },
      { temporada: '2020-2021', url: 'https://teamusa-org-migration.s3.amazonaws.com/USA%20Fencing/Archive_2020-21.zip' },
      { temporada: '1998-1999', url: 'https://assets.ngin.com/final99.zip' },
    ]);
  });

  it('el último PDF «rolling» de cada arma, género y categoría', () => {
    expect(pdfUsa('Archive 2024-25/WS Sr R 2025 08 01.pdf')).toEqual({ nombre: 'WS Sr R 2025 08 01.pdf', codigo: 'WS', cat: 'Sr', dia: '2025-08-01' });
    expect(pdfUsa('ME V40 R 2026 07 04.pdf')).toBeNull();
    expect(pdfUsa('ME Cdt Team 2026 07 04.pdf')).toBeNull();
    expect(elegirPdfsUsa([
      'A/WS Sr R 2025 08 01.pdf', 'A/WS Sr R 2025 04 13.pdf', '__MACOSX/A/._WS Sr R 2025 09 01.pdf',
      'A/WS Jr R 20204 11 11.pdf', 'A/WS Jr R 2025 02 28.pdf', 'A/ME Cdt R 2024 12 08.pdf', 'A/ME Para R 2025 01 01.pdf',
    ])).toEqual(['A/ME Cdt R 2024 12 08.pdf', 'A/WS Jr R 2025 02 28.pdf', 'A/WS Sr R 2025 08 01.pdf']);
  });

  it('varios por combo y el final de temporada según la cabecera', () => {
    const rutas = ['A/ME Sr R 2025 08 01.pdf', 'A/ME Sr R 2025 07 10.pdf', 'A/ME Sr R 2025 03 01.pdf', 'A/WE Jr R 2025 05 01.pdf'];
    expect(elegirPdfsUsa(rutas, 2)).toEqual(['A/ME Sr R 2025 08 01.pdf', 'A/ME Sr R 2025 07 10.pdf', 'A/WE Jr R 2025 05 01.pdf']);
    const l = (temporada: string, dia: string) => ({ temporada, publicadoEl: dia }) as Parameters<typeof finalTemporadaUsa>[0][number];
    // El PDF de agosto ya es la primera lista de la temporada siguiente.
    expect(finalTemporadaUsa([l('2025-2026', '2025-08-01'), null, l('2024-2025', '2025-07-10'), l('2024-2025', '2025-03-01')], '2024-2025'))
      .toMatchObject({ publicadoEl: '2025-07-10' });
    expect(finalTemporadaUsa([l('2022-2023', '2023-07-07')], '2023-2024')).toBeNull();
  });

  it('carpetas y ficheros del directorio actual', () => {
    const raiz = `<li data-name="Men's Epee " data-href="?dir=Men%27s%20Epee%20"></li><li data-name="Parafencing" data-href="?dir=Parafencing"></li>
      <li data-name="Women's Saber" data-href="?dir=Women%27s%20Saber"></li>`;
    expect(carpetasUsa(raiz)).toEqual(['Men%27s%20Epee%20', 'Women%27s%20Saber']);
    const carpeta = `<li data-name=".." data-href="https://usfencingresults.org/rankings/"></li>
      <li data-name="ME Sr R 2026 07 27.pdf" data-href="Men%27s%20Epee%20/ME%20Sr%20R%202026%2007%2027.pdf"></li>`;
    expect(ficherosCarpetaUsa(carpeta)).toEqual(['Men%27s%20Epee%20/ME%20Sr%20R%202026%2007%2027.pdf']);
  });

  it('nombre sin iniciales, apodos ni sufijos', () => {
    expect(nombreUsa('Ewart Jr.', 'Stephen P')).toBe('EWART Stephen');
    expect(nombreUsa('Xiao', 'Leon (Ruibo)')).toBe('XIAO Leon');
    expect(nombreUsa('Pastore Liu', 'Vince')).toBe('PASTORE LIU Vince');
  });

  const rolling = [
    '2025-2026 USFA Point Standings', "Senior Men's Epee", 'ROLLING POINT CALCULATIONS', 'CURRENT AS OF 7/27/2026',
    'RANK NAME BTH 1st 2nd 1st 2nd 3rd 4th',
    '1 Imrek, Samuel 2005 Gulf Coast 5,775.000 1100 583 1260 1248 816 768',
    '2 # Imrek, Elijah 2007 Gulf Coast 4,588.500 935 764.5 1656 680 279 274',
    '6 Xiao, Leon (Ruibo) 2003 CAN 2,441.000 935 0 1248 258 0 0',
    '26 Bida, Sergey 1993 FIE 1,012.000 1012 0 0 0 0 0',
    '30T Kaull, James T 1991 Metropolitan NYC 935.000 555.5 379.5 0 0 0 0',
    'ROLLING', 'TOTAL', '# = Junior',
  ].join('\n');
  const resultados = ['2025-2026 USFA Point Standings', "Senior Men's Epee", 'DESIGNATED', 'PLACE POINTS', '3 Spina, Joseph 2001 x 1,000.000 np 0'].join('\n');

  it('lista: temporada, día, puesto (con empates), año, país de los de fuera; sin las páginas de resultados', () => {
    const l = listaUsa([rolling, resultados], 'ME Sr R 2026 07 27.pdf', 'https://usfencingresults.org/rankings/x.pdf')!;
    expect(l).toMatchObject({
      fuente: 'usa_points', temporada: '2025-2026', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'Senior',
      publicadoEl: '2026-07-27', baseFecha: 'source', total: 5,
    });
    expect(l.filas).toEqual([
      { ref: 'usa:IMREK_Samuel_2005', nombre: 'IMREK Samuel', pais: null, puesto: 1, puntos: '5775', anioNacimiento: 2005 },
      { ref: 'usa:IMREK_Elijah_2007', nombre: 'IMREK Elijah', pais: null, puesto: 2, puntos: '4588.5', anioNacimiento: 2007 },
      { ref: 'usa:XIAO_Leon_2003', nombre: 'XIAO Leon', pais: 'CAN', puesto: 6, puntos: '2441', anioNacimiento: 2003 },
      { ref: 'usa:KAULL_James_1991', nombre: 'KAULL James', pais: null, puesto: 30, puntos: '935', anioNacimiento: 1991 },
    ]);
    const cadete = rolling.replace("Senior Men's Epee", "CADET Women's Saber").replace('2025-2026 USFA Point Standings', '2024-2025 USA Fencing National Rolling Point Standings');
    expect(listaUsa([cadete], 'Archive 2024-25/WS Cdt R 2025 05 18.pdf', 'u')).toMatchObject({ temporada: '2024-2025', arma: 'SABLE', genero: 'F', categoria: 'M17' });
    expect(listaUsa([resultados], 'ME Sr R 2026 07 27.pdf', 'u')).toBeNull();
    expect(listaUsa([rolling], 'ME V40 R 2026 07 04.pdf', 'u')).toBeNull();
  });

  it('formato hasta 2013-14: nombres de fichero, «PLACE», fecha sin «AS OF», puntos sin comas y país escrito entero', () => {
    expect(pdfUsa('Cadet/CME R End of Season 0408 2014.pdf')).toEqual({ nombre: 'CME R End of Season 0408 2014.pdf', codigo: 'ME', cat: 'Cdt', dia: '2014-04-08' });
    expect(pdfUsa('Senior/SWF R 0118 2014 (2).pdf')).toMatchObject({ codigo: 'WF', cat: 'Sr', dia: '2014-01-18' });
    expect(pdfUsa('Cadet/Team/CME TM 0104 2014.pdf')).toBeNull();
    expect(pdfUsa('SMF R 2010 0514.pdf')).toMatchObject({ codigo: 'MF', cat: 'Sr', dia: '2010-05-14' });
    expect(pdfUsa('CME R 2010 1221.pdf')).toMatchObject({ codigo: 'ME', cat: 'Cdt', dia: '2010-12-21' });
    expect(pdfUsa('CME R 2010 2112.pdf')).toBeNull();
    expect(pdfUsa('Cadet/2103-2014 CME ADJ R 0223 2013.pdf')).toBeNull();
    expect(elegirPdfsUsa(['Cadet/CME R 0216 2014.pdf', 'Cadet/CME R End of Season 0408 2014.pdf', 'Cadet/CME R 0704 2013.pdf'])).toEqual(['Cadet/CME R End of Season 0408 2014.pdf']);
    const viejo = [
      '2013-2014 Point Standings', "Senior Men's Epee", 'ROLLING POINT CALCULATIONS', 'CURRENT 1/18/2014 Group I Values=Best 3 Group II Values=Best 4',
      'PLACE NAME BTH', 'ROLLING', '1 Thompson, Soren 1981 METRO NYC 4551.736 0 0 0 1656 1257 835 804',
      '2 Pelletier, Vincent 1976 CANADA 3936.928 0 0 0 1644 1260 780 253',
    ].join('\n');
    // 2010-11: totales enteros, divisiones con coma y «CORRECTED» en vez de «CURRENT AS OF».
    const antiguo = ['2010-2011 USFA Point Standings', "Cadet* Men's Epee", 'ROLLING POINT CALCULATIONS', 'CORRECTED 2/8/2011 ROLLING Group I Values',
      'PLACE NAME BTH DIVISION TOTAL 1st 2nd', '1 Eldeib, Alexander 1995 VIRGINIA 3101 660 510', '2 Campbell, Lindsay 1981 METROPOLITAN, NYC 3693 1000'].join('\n');
    expect(listaUsa([antiguo], 'CME R 2011 0208.pdf', 'u')!.filas.map((f) => [f.nombre, f.puntos])).toEqual([['ELDEIB Alexander', '3101'], ['CAMPBELL Lindsay', '3693']]);
    expect(listaUsa([antiguo], 'CME R 2011 0208.pdf', 'u')).toMatchObject({ publicadoEl: '2011-02-08', categoria: 'M17' });
    // Fichero con nombre de otra arma, género o categoría: no se lee.
    expect(listaUsa([antiguo], 'CWE R 2011 0208.pdf', 'u')).toBeNull();
    expect(listaUsa([antiguo], 'JME R 2011 0208.pdf', 'u')).toBeNull();
    const l = listaUsa([viejo], 'Senior/SME R 0118 2014.pdf', 'u')!;
    expect(l).toMatchObject({ temporada: '2013-2014', publicadoEl: '2014-01-18', categoria: 'ABS', total: 2 });
    expect(l.filas.map((f) => [f.nombre, f.pais, f.puntos])).toEqual([['THOMPSON Soren', null, '4551.736'], ['PELLETIER Vincent', 'CAN', '3936.928']]);
  });

  it('vínculo con año de nacimiento y país de los de fuera', () => {
    const l = listaUsa([rolling], 'ME Sr R 2026 07 27.pdf', 'u')!;
    const indice = indicePersonas([
      { personId: 'p1', fieId: '1', pais: 'USA', genero: 'M', anioNacimiento: 2005, nombres: ['IMREK Samuel'] },
      { personId: 'p2', fieId: '2', pais: 'USA', genero: 'M', anioNacimiento: 2006, nombres: ['IMREK Elijah'] },
      { personId: 'p3', fieId: '3', pais: 'CAN', genero: 'M', anioNacimiento: 2003, nombres: ['XIAO Leon'] },
      { personId: 'p4', fieId: null, pais: 'USA', genero: 'M', anioNacimiento: null, nombres: ['KAULL James'] },
      { personId: 'p5', fieId: null, pais: 'USA', genero: 'M', anioNacimiento: null, nombres: ['KAULL James'] },
    ]);
    expect(vincularLista(l.filas, l, FUENTES_RANKING.usa_points.pais, indice)).toEqual([
      { personId: 'p1', via: 'nombre' },
      { personId: null, motivo: 'nacimiento_distinto' },
      { personId: 'p3', via: 'nombre' },
      { personId: null, motivo: 'ambigua' },
    ]);
  });
});

describe('Fencing Singapore', () => {
  const formulario = `<select class="chosenjs" name="rankingmethod[windowlength]" id="rankingmethod_windowlength"><option value="" label=" "></option>
    <option value="2026">2026</option><option selected="selected" value="2025">2025</option><option value="2019">2019</option></select>`;
  const html = `<h4>Senior Male Epee 2025-2026</h4><h6>Displaying records from 2025-06-01 to 2026-05-30 as at 2026-08-12 13:43:15 UTC</h6>
    <table><tbody><tr class="table-secondary"><td>1</td><td><a href="/profiles/100">SITO, Jian Tong</a></td><td><a href="/profiles/100"></a></td><td><a href="/profiles/100">NP/SSP</a></td><td>7338</td></tr>
    <tr class="table-primary"><td>2</td><td><a href="/profiles/80">Ong, Azfar Luqman</a></td><td></td><td>SSP</td><td>3288</td></tr>
    <tr><td>3</td><td><a href="/profiles/81">SinComa</a></td><td></td><td></td><td>10</td></tr>
    <tr><td>1</td><td><a href="/profiles/100">SITO, Jian Tong</a></td><td></td><td></td><td>7338</td></tr></tbody></table>`;

  it('años, combos, URL y fichero de caché', () => {
    expect(aniosSgp(formulario)).toEqual([2019, 2025, 2026]);
    const combos = combosSgp([2025]);
    expect(combos).toHaveLength(18);
    expect(urlSgp(combos[0])).toBe('https://my.fencingsingapore.org.sg/showranks?rankingmethod%5Bcategory%5D=Senior&rankingmethod%5Bgender%5D=Male&rankingmethod%5Bweapon%5D=Epee&rankingmethod%5Bwindowlength%5D=2025&Ranking+Only=Ranking+Only');
    expect(archivoSgp(combos[0], null)).toBe('2025-senior-male-epee.html');
    expect(archivoSgp(combos[0], '2026-10-07')).toBe('2026-10-07-2025-senior-male-epee.html');
  });

  it('lista con el día del cálculo, el perfil como referencia y sin repetir', () => {
    const [c] = combosSgp([2025]);
    const l = listaSgp(c, html, '2026-10-07')!;
    expect(l).toMatchObject({ fuente: 'sgp_ranking', temporada: '2025-2026', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'Senior', publicadoEl: '2026-08-12', baseFecha: 'source', total: 4 });
    expect(l.filas).toEqual([
      { ref: 'sgp:100', nombre: 'SITO Jian Tong', pais: null, puesto: 1, puntos: '7338' },
      { ref: 'sgp:80', nombre: 'ONG Azfar Luqman', pais: null, puesto: 2, puntos: '3288' },
    ]);
    // El título ha de ser el del combo pedido.
    expect(listaSgp(combosSgp([2024])[0], html, '2026-10-07')).toBeNull();
    expect(listaSgp(c, html.replace(/ as at [^<]+/, ''), '2026-10-07')).toMatchObject({ publicadoEl: '2026-10-07', baseFecha: 'observed' });
    expect(nombreSgp('LEE, Samson (Sam) Mun Hou')).toBe('LEE Samson Mun Hou');
  });
});

describe('FPE (Portugal)', () => {
  const combo = COMBOS_FPE.find((c) => claveFpe(c) === 'espada-seniores-masculino')!;
  const cadetes = COMBOS_FPE.find((c) => claveFpe(c) === 'florete-cadetes-feminino')!;
  const busqueda = `<article class="post-810 post type-post status-publish category-espada category-masculino category-seniores">
      <div><h2 class="entry-title"><a href="https://www.fpe.pt/grande-premio-de-senior-2014-2015-2/" title="x" rel="bookmark">Ranking Nacional Seniores de Espada Masculino 2026/2027</a></h2></div></article>
    <article class="post-900 post category-florete category-feminino category-cadetes">
      <h2 class="entry-title"><a href="https://www.fpe.pt/cadetes-f/" rel="bookmark">Ranking Nacional Cadetes 2026/2027</a></h2></article>`;

  it('formulario: nonce, búsqueda y entrada por sus categorías', () => {
    expect(COMBOS_FPE).toHaveLength(18);
    expect(nonceFpe('<input type="hidden" name="unonce" value="037e26e1d8" />')).toBe('037e26e1d8');
    expect(urlBusquedaFpe(combo, 'abc')).toBe('https://www.fpe.pt/?unonce=abc&uformid=579&s=uwpsfsearchtrg&taxo%5B0%5D%5Bname%5D=category&taxo%5B0%5D%5Bopt%5D=&taxo%5B0%5D%5Bterm%5D=espada&taxo%5B1%5D%5Bname%5D=category&taxo%5B1%5D%5Bopt%5D=&taxo%5B1%5D%5Bterm%5D=seniores&taxo%5B2%5D%5Bname%5D=category&taxo%5B2%5D%5Bopt%5D=&taxo%5B2%5D%5Bterm%5D=masculino');
    expect(entradaFpe(combo, busqueda)).toEqual({ url: 'https://www.fpe.pt/grande-premio-de-senior-2014-2015-2/', temporada: '2026-2027' });
    expect(entradaFpe(cadetes, busqueda)).toEqual({ url: 'https://www.fpe.pt/cadetes-f/', temporada: '2026-2027' });
    expect(entradaFpe(COMBOS_FPE.find((c) => claveFpe(c) === 'sabre-juniores-feminino')!, busqueda)).toBeNull();
    expect(pdfFpe('<article id="post-810"><p><a href="http://www.fpe.pt/wp-content/uploads/2026/09/R_EM_SEN.pdf">R</a></p>')).toBe('https://www.fpe.pt/wp-content/uploads/2026/09/R_EM_SEN.pdf');
  });

  it('filas: nombre sin el club, año, total y puesto', () => {
    expect(filaFpe('Filipe Frazão CAE 2001 32 20 26 78 32 26 48 184 184 1')).toEqual({ nombre: 'Filipe Frazão', anio: 2001, puntos: '184', puesto: 1 });
    expect(filaFpe('Diogo Onofre SPORTING CP 2004 4 8 20 32 8 14 6 60 60 11')).toEqual({ nombre: 'Diogo Onofre', anio: 2004, puntos: '60', puesto: 11 });
    expect(filaFpe('João Pedro Faria CAE 1954 4 4 8 8 8 40')).toMatchObject({ nombre: 'João Pedro Faria', puesto: 40 });
    expect(filaFpe('SENIORES MASCULINOS (1985 a 2006)')).toBeNull();
    expect(filaFpe('CN_Caldas_')).toBeNull();
  });

  it('lista vigente con el día de lectura', () => {
    const texto = ['SEN I -', 'Filipe Frazão CAE 2001 32 20 26 78 32 26 48 184 184 1', 'Luís Alvito AEJG 1995 14 14 8 36 14 12 62 62 9', 'Manuel Bispo AELIS 2008 14 8 22 20 14 6 62 62 9'].join('\n');
    const l = listaFpe(combo, '2026-2027', texto, 'https://www.fpe.pt/x.pdf', '2026-10-07')!;
    expect(l).toMatchObject({ fuente: 'fpe_ranking', temporada: '2026-2027', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'Seniores', publicadoEl: '2026-10-07', baseFecha: 'observed', total: 3 });
    expect(l.filas.map((f) => [f.ref, f.puesto, f.puntos, f.anioNacimiento])).toEqual([
      ['fpe:Filipe_Frazão_2001', 1, '184', 2001],
      ['fpe:Luís_Alvito_1995', 9, '62', 1995],
      ['fpe:Manuel_Bispo_2008', 9, '62', 2008],
    ]);
    expect(listaFpe(combo, '2026-2027', 'nada', 'u', '2026-10-07')).toBeNull();
  });
});

describe('ÖFV: temporadas antiguas', () => {
  const doc = { temporada: '2011-2012', url: 'u', arma: 'ESPADA' as const, genero: 'M' as const, categoria: 'ABS' as const, categoriaRaw: 'Allgemeine Klasse' };
  const g = (str: string, x: number, y: number) => ({ str, transform: [0, 9, -9, 0, x, y] });

  it('página con el texto girado 90°: filas por `x`, columnas por `y`', () => {
    const items = [
      g('Rang', 73, 42), g('OEFV-Lizenznummer', 78, 64), g('Nachname', 78, 142), g('Vorname', 78, 192), g('Club', 78, 233), g('Punkte', 78, 282), g('632', 68, 311),
      g('1', 99, 42), g('OEFV19820416001', 99, 64), g('Mathé', 99, 142), g('Jörg', 99, 192), g('BALMUNG', 99, 233), g('471', 99, 282), g('40', 99, 386),
      { str: ' ', transform: [1, 0, 0, 1, 5, 5] },
    ];
    const pagina: Celda[][] = filasCeldas(trozosPagina(items));
    expect(pagina[pagina.length - 1].map((c) => c.s)).toEqual(['1', 'OEFV19820416001', 'Mathé', 'Jörg', 'BALMUNG', '471', '40']);
    expect(listaOefv(doc, [pagina], '2026-10-07')!.filas).toEqual([
      { ref: 'oefv:Mathé_Jörg_1982', nombre: 'MATHÉ Jörg', pais: null, puesto: 1, puntos: '471', anioNacimiento: 1982 },
    ]);
    // Sin giro, igual que antes.
    expect(trozosPagina([{ str: 'a', transform: [1, 0, 0, 1, 10, 20] }])).toEqual([{ s: 'a', x: 10, y: 20 }]);
  });

  it('cabecera de 2010-11 con la «N» como carácter de control', () => {
    const c = (s: string, x: number): Celda => ({ s, x });
    const pagina = [
      [c('OEFV-Lizenznummer', 55), c('\u0010achname', 110), c('Vorname', 158), c('Club', 189), c('Punkte', 223)],
      [c('1', 40), c('OEFV19820416001', 55), c('Mathé', 110), c('Jörg', 158), c('BALMUNG', 189), c('471', 223)],
    ];
    expect(listaOefv({ ...doc, temporada: '2010-2011' }, [pagina], '2026-10-07')!.filas).toHaveLength(1);
  });
});

describe('zip y registro', () => {
  it('entradas de un zip, sólo las pedidas', () => {
    const entrada = (nombre: string, datos: Buffer, desplazamiento: number) => {
      const comprimido = deflateRawSync(datos);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(comprimido.length, 18);
      local.writeUInt32LE(datos.length, 22);
      local.writeUInt16LE(Buffer.byteLength(nombre), 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(comprimido.length, 20);
      central.writeUInt32LE(datos.length, 24);
      central.writeUInt16LE(Buffer.byteLength(nombre), 28);
      central.writeUInt32LE(desplazamiento, 42);
      return { local: Buffer.concat([local, Buffer.from(nombre), comprimido]), central: Buffer.concat([central, Buffer.from(nombre)]) };
    };
    const a = entrada('A/ME Sr R 2026 07 27.pdf', Buffer.from('%PDF uno'), 0);
    const b = entrada('A/ME Sr Team 2026 07 27.pdf', Buffer.from('%PDF dos'), a.local.length);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(2, 10);
    fin.writeUInt32LE(a.central.length + b.central.length, 12);
    fin.writeUInt32LE(a.local.length + b.local.length, 16);
    const zip = Buffer.concat([a.local, b.local, a.central, b.central, fin]);
    const nombres: string[] = [];
    expect(entradasZip(zip, (n) => (nombres.push(n), false)).size).toBe(0);
    expect(nombres).toEqual(['A/ME Sr R 2026 07 27.pdf', 'A/ME Sr Team 2026 07 27.pdf']);
    const elegidas = entradasZip(zip, (n) => elegirPdfsUsa(nombres).includes(n));
    expect([...elegidas.entries()].map(([n, v]) => [n, v.toString()])).toEqual([['A/ME Sr R 2026 07 27.pdf', '%PDF uno']]);
  });

  it('fuentes nacionales nuevas', () => {
    expect(fuentesNacionalesDe('USA')).toEqual(['usa_points']);
    expect(fuentesNacionalesDe('SGP')).toEqual(['sgp_ranking']);
    expect(fuentesNacionalesDe('POR')).toEqual(['fpe_ranking']);
    expect(FUENTES_RANKING.usa_points).toMatchObject({ ambito: 'nacional', organismo: 'USA Fencing', continente: null });
  });
});
