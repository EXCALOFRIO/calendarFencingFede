import { describe, expect, it } from 'vitest';
import { hojasBff, latinoBff, listaBff, pestanasBff, tituloBff } from '@/lib/ingest/rankings-internacionales/bff';
import { archivoCss, combosCss, listaCss, temporadasCss, urlCss } from '@/lib/ingest/rankings-internacionales/css';
import { PAGINAS_FVE, listasFve } from '@/lib/ingest/rankings-internacionales/fve';
import { documentosKnas, listaKnas, temporadaKnas } from '@/lib/ingest/rankings-internacionales/knas';
import { indicePersonas, vincularLista } from '@/lib/ingest/rankings-internacionales/vincular';
import { FUENTES_RANKING, fuentesNacionalesDe } from '@/lib/sport/rankings-internacionales-fuentes';

describe('ČSŠ (República Checa)', () => {
  const temporadas = temporadasCss([
    { id: 'a', name: '2020 - 2021', validTill: '2021-08-31T00:00:00.000000', stateId: 'ARCHIVED' },
    { id: 'b', name: '2025 - 2026', validTill: '2026-08-31T00:00:00.000000', stateId: 'ARCHIVED' },
    { id: 'c', name: '2026 - 2027', validTill: '2027-08-31T00:00:00.000000', stateId: 'ACTIVE' },
    { id: 'd', name: 'rara' },
  ], 2021);
  const json = {
    totals: [
      { personId: 'u1', personFullName: 'Jurka Jakub', personBirthYear: 1999, cpRank: 1, cpTotalPoints: 1717.0 },
      { personId: 'u2', personFullName: 'Dupraz  Yann', personBirthYear: 2009, cpRank: 174, cpTotalPoints: 0.25 },
      { personId: 'u1', personFullName: 'Jurka Jakub', personBirthYear: 1999, cpRank: 1, cpTotalPoints: 1717.0 },
      { personId: 'u3', personFullName: '', cpRank: 2 },
    ],
    log: { startDateTime: '2026-10-06T22:00:04.073022' },
  };

  it('temporadas desde un año, con su fin y si siguen abiertas', () => {
    expect(temporadas).toEqual([
      { id: 'b', temporada: '2025-2026', fin: '2026-08-31', activa: false },
      { id: 'c', temporada: '2026-2027', fin: '2027-08-31', activa: true },
    ]);
    const combos = combosCss(temporadas);
    expect(combos).toHaveLength(2 * 8 * 3);
    expect(urlCss(combos[0])).toBe('https://www.czechfencing.cz/api/public-zone/tournaments/stat-ranks/b/4/1');
    expect(archivoCss(combos[0], '2026-10-07')).toBe('2025-2026-4-1.json');
    expect(archivoCss(combos[24], '2026-10-07')).toBe('2026-10-07-2026-2027-4-1.json');
  });

  it('lista archivada con el fin de temporada; la abierta con el día del cálculo', () => {
    const [cerrada] = combosCss(temporadas);
    const l = listaCss(cerrada, json, '2026-10-07')!;
    expect(l).toMatchObject({ fuente: 'css_zebricek', temporada: '2025-2026', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'Senioři', publicadoEl: '2026-08-31', baseFecha: 'source', total: 2 });
    expect(l.filas).toEqual([
      { ref: 'css:u1', nombre: 'Jurka Jakub', pais: null, puesto: 1, puntos: '1717', anioNacimiento: 1999 },
      { ref: 'css:u2', nombre: 'Dupraz Yann', pais: null, puesto: 174, puntos: '0.25', anioNacimiento: 2009 },
    ]);
    const abierta = combosCss(temporadas).find((c) => c.temporada.activa && c.categoria.id === 10 && c.disciplina.id === 3)!;
    expect(listaCss(abierta, json, '2026-10-07')).toMatchObject({ genero: 'F', categoria: 'M15', arma: 'SABLE', publicadoEl: '2026-10-06', baseFecha: 'source' });
    expect(listaCss(abierta, { ...json, log: null }, '2026-10-07')).toMatchObject({ publicadoEl: '2026-10-07', baseFecha: 'observed' });
    expect(listaCss(cerrada, { totals: [] }, '2026-10-07')).toBeNull();
    expect(listaCss(cerrada, { title: 'Not Found' }, '2026-10-07')).toBeNull();
  });
});

describe('KNAS (Países Bajos)', () => {
  const portada = `<h2 class="rank-list-group-name">Individueel</h2>
    <a class="link ot-link" href="/pag/8094/rls/2167">senioren</a><a class="link ot-link" href="/pag/8094/rls/b564">kuikens (U10)</a>
    <a class="link ot-link" href="/pag/8094/rls/6763">cadetten (U15 - U17)</a><a class="link ot-link" href="/pag/8094/rls/ca61">veteranen algemeen</a>
    <a class="link ot-link" href="/pag/8094/rls/2167">senioren</a>
    <h2 class="rank-list-group-name">Verenigingsequipes</h2><a class="link ot-link" href="/pag/8094/rls/ffff">senioren</a>`;
  const lista = `<h1 class="title">Individueel - sabel heren cadetten (U15 - U17) - 01-09-2026</h1><table><tbody class="ot-tbody">
    <tr class="is-even ot-row"><td class="ot-cell ot-cell-number" data-value="1">1</td><td class="ot-cell ot-cell-number"><a class="link ot-link" href="/pag/59c1/rl1/b2402c">114917</a></td><td class="ot-cell ot-cell-relation">HENDRIKS Jasper</td><td class="ot-cell ot-cell-number"><a href="/x">2012</a></td><td class="ot-cell ot-cell-relation">s.v. Surtout</td><td class="ot-cell ot-cell-number" data-value="1429">1429</td></tr>
    <tr class="is-odd ot-row"><td class="ot-cell ot-cell-number" data-value="2">2</td><td class="ot-cell ot-cell-number"><a href="/y">117221</a></td><td class="ot-cell ot-cell-relation">VAN DER BERG Enno</td><td class="ot-cell ot-cell-number">2012</td><td class="ot-cell ot-cell-relation">s.v. Surtout</td><td class="ot-cell ot-cell-number">13.5</td></tr>
    </tbody></table>`;

  it('sólo listas individuales de las categorías que se leen, sin repetir', () => {
    expect(documentosKnas(portada)).toEqual(['2167', '6763']);
    expect(documentosKnas('<h2 class="rank-list-group-name">Verenigingsequipes</h2>')).toEqual([]);
  });

  it('arma, género, categoría y día del título; licencia como referencia', () => {
    const l = listaKnas('6763', lista)!;
    expect(l).toMatchObject({ fuente: 'knas_ranglijst', temporada: '2026-2027', arma: 'SABLE', genero: 'M', categoria: 'M17', categoriaRaw: 'cadetten', publicadoEl: '2026-09-01', baseFecha: 'source', url: 'https://knas.onzeranglijsten.net/pag/8094/rls/6763', total: 2 });
    expect(l.filas).toEqual([
      { ref: 'knas:114917', nombre: 'HENDRIKS Jasper', pais: null, puesto: 1, puntos: '1429' },
      { ref: 'knas:117221', nombre: 'VAN DER BERG Enno', pais: null, puesto: 2, puntos: '13.5' },
    ]);
    expect(listaKnas('x', lista.replace('Individueel', 'Equipe'))).toBeNull();
    // Las U23 ponen la categoría delante.
    expect(listaKnas('286c', lista.replace('sabel heren cadetten (U15 - U17) - 01-09-2026', 'U23 dames floret - 01-08-2026'))).toMatchObject({
      arma: 'FLORETE', genero: 'F', categoria: 'M23', categoriaRaw: 'U23', publicadoEl: '2026-08-01', temporada: '2025-2026',
    });
    expect(listaKnas('x', lista.replace(/<tr class="is-[\s\S]*<\/tr>/, ''))).toBeNull();
    expect(temporadaKnas('2026-06-01')).toBe('2025-2026');
  });
});

describe('FVE (Venezuela)', () => {
  const tabla = (id: number, titulo: string, filas: string) => `<h2 class="wpdt-c" id="wdt-table-title-${id}">${titulo}</h2>
    <table id="table_1" class="wpDataTable" data-described-by='table_1_desc' data-wpdatatable_id="${id}"><thead><tr><th
      class="sort">Licencia</th><th class="sort">Atleta</th><th>Entidad</th><th>Caracas Dic.2025</th><th>Total</th><th class="sort">Rank</th></tr><tr><th>Licencia</th></tr></thead>
    <tbody><div class="wdt-table-loader"></div>${filas}</tbody></table>`;
  const html = `<h2 class="elementor-heading-title">Clasificación Nacional Adulto 2025 - 2026</h2>
    ${tabla(115, 'Ranking Adulto Espada Femenina', `<tr id="table_115_row_0"
      data-row-index="0"><td style="">24019437</td><td style="">Asis Escalona Lizze Carolina</td><td>GUA</td><td>40</td><td>120</td><td>1</td></tr>
      <tr id="table_115_row_1" data-row-index="1"><td>17868043</td><td>Martinez Gascón María</td><td>CCS</td><td>52</td><td>111,5</td><td>2</td></tr>`)}
    ${tabla(114, 'Ranking Cadete - Sable Masculino', `<tr id="table_114_row_0"><td>1</td><td>Perez Juan</td><td>X</td><td>1</td><td>8</td><td>1</td></tr>`)}
    ${tabla(200, 'Ranking por equipos', '')}`;

  it('una lista por tabla con arma y género del título, sin guardar la cédula', () => {
    const [f, m] = listasFve(PAGINAS_FVE[0], html, '2026-10-07');
    expect(f).toMatchObject({ fuente: 'fve_clasificacion', temporada: '2025-2026', arma: 'ESPADA', genero: 'F', categoria: 'ABS', categoriaRaw: 'Adulto', publicadoEl: '2026-10-07', baseFecha: 'observed', total: 2 });
    expect(f.filas).toEqual([
      { ref: 'fve:asis_escalona_lizze_carolina', nombre: 'Asis Escalona Lizze Carolina', pais: null, puesto: 1, puntos: '120' },
      { ref: 'fve:martinez_gascon_maria', nombre: 'Martinez Gascón María', pais: null, puesto: 2, puntos: '111.5' },
    ]);
    expect(m).toMatchObject({ arma: 'SABLE', genero: 'M', total: 1 });
    expect(listasFve(PAGINAS_FVE[0], html.replace('2025 - 2026', '2025 - 2027'), '2026-10-07')).toEqual([]);
  });
});

describe('БФФ (Bulgaria)', () => {
  const pagina = `<iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?widget=true&amp;headers=false"></iframe>
    <iframe src="https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?widget=true"></iframe>`;
  const hojaHtml = `<title>EPEE-(2025-2026) - Google Drive</title>
    items.push({name: "Момчета до 10 г.", pageUrl: "https:\\/\\/docs.google.com\\/x", gid: "1",initialSheet: ("1" == gid)});
    items.push({name: "Кадети ", pageUrl: "https:\\/\\/docs.google.com\\/x", gid: "2",initialSheet: ("2" == gid)});
    items.push({name: "U23-жени", pageUrl: "https:\\/\\/docs.google.com\\/x", gid: "3",initialSheet: ("3" == gid)});`;
  const pestana = `<table><tr><th>1</th><td></td><td>ШПАГА мъже - ранглиста</td></tr>
    <tr><th>3</th><td class="s12"></td><td class="s13">ФАМИЛИЯ</td><td class="s13">ИМЕ</td><td class="s13">КЛУБ</td><td class="s14">Год.</td><td class="s13">Точки</td><td class="freezebar-cell"></td><td colspan="2">КБ 1</td></tr>
    <tr><th>5</th><td>1</td><td>Гълъбов</td><td>Йордан</td><td>НСА</td><td>2002</td><td>73</td><td></td><td>5</td></tr>
    <tr><th>6</th><td>2</td><td>Щерева</td><td>Мария</td><td>ЦСКА</td><td>2005</td><td>12,5</td></tr>
    <tr><th>7</th><td></td><td>Сума</td><td></td><td></td><td></td><td>85</td></tr></table>`;

  it('hojas sin repetir, título con arma y temporada, pestañas de las categorías que se leen', () => {
    const hojas = hojasBff(pagina);
    expect(hojas).toEqual([{ id: '2PACX-abc', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?widget=true&headers=false' }]);
    expect(tituloBff(hojaHtml)).toEqual({ arma: 'ESPADA', temporada: '2025-2026' });
    expect(tituloBff('<title>SABRE-(2025-2027)</title>')).toBeNull();
    expect(pestanasBff(hojas[0], hojaHtml).map((p) => [p.gid, p.genero, p.categoria, p.categoriaRaw, p.url])).toEqual([
      ['2', 'M', 'M17', 'Кадети', 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml/sheet?headers=false&gid=2'],
      ['3', 'F', 'M23', 'U23-жени', 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml/sheet?headers=false&gid=3'],
    ]);
  });

  it('transliteración oficial búlgara', () => {
    expect(latinoBff('Гълъбов Йордан')).toBe('Galabov Yordan');
    expect(latinoBff('Щерева Мария')).toBe('Shtereva Maria');
    expect(latinoBff('ЦВЕТКОВ Жюл')).toBe('TSVETKOV Zhyul');
  });

  it('filas con puesto, nombre en latino y año; las de totales no', () => {
    const [p] = pestanasBff(hojasBff(pagina)[0], hojaHtml);
    const l = listaBff(p, tituloBff(hojaHtml)!, pestana, '2026-10-07')!;
    expect(l).toMatchObject({ fuente: 'bff_ranglista', temporada: '2025-2026', arma: 'ESPADA', genero: 'M', categoria: 'M17', publicadoEl: '2026-10-07', baseFecha: 'observed', total: 2 });
    expect(l.filas).toEqual([
      { ref: 'bff:galabov_yordan_2002', nombre: 'GALABOV Yordan', pais: null, puesto: 1, puntos: '73', anioNacimiento: 2002 },
      { ref: 'bff:shtereva_maria_2005', nombre: 'SHTEREVA Maria', pais: null, puesto: 2, puntos: '12.5', anioNacimiento: 2005 },
    ]);
  });

  it('рапира: título en búlgaro, pestañas sin «до», columna vacía antes del apellido', () => {
    const hoja = `<title>RAPIRA-(2025-2026) - Google Drive</title>
      items.push({name: "момчета 15", pageUrl: "x", gid: "7",initialSheet: false});
      items.push({name: "Кадетки U17", pageUrl: "x", gid: "8",initialSheet: false});`;
    expect(tituloBff(hoja)).toEqual({ arma: 'FLORETE', temporada: '2025-2026' });
    const ps = pestanasBff({ id: 'h', url: 'u' }, hoja);
    expect(ps.map((p) => [p.genero, p.categoria, p.categoriaRaw])).toEqual([['M', 'M15', 'Момчета до 15 г.'], ['F', 'M17', 'Кадетки']]);
    const tabla = `<tr><td></td><td></td><td>Фамилия</td><td>ИМЕ</td><td>КЛУБ</td><td>Год.</td><td>Точки</td></tr>
      <tr><td>1</td><td></td><td>Полишев</td><td>Данаил</td><td>ПЛОВДИВ БГ</td><td>2007</td><td>70</td></tr>`;
    expect(listaBff(ps[0], tituloBff(hoja)!, tabla, '2026-10-07')!.filas).toEqual([
      { ref: 'bff:polishev_danail_2007', nombre: 'POLISHEV Danail', pais: null, puesto: 1, puntos: '70', anioNacimiento: 2007 },
    ]);
  });

  it('vínculo por nombre transliterado, país de la federación, género y año', () => {
    const [p] = pestanasBff(hojasBff(pagina)[0], hojaHtml);
    const l = listaBff(p, tituloBff(hojaHtml)!, pestana, '2026-10-07')!;
    const indice = indicePersonas([
      { personId: 'p1', fieId: '1', pais: 'BUL', genero: 'M', anioNacimiento: 2002, nombres: ['GALABOV Yordan'] },
      { personId: 'p2', fieId: '2', pais: 'BUL', genero: 'F', anioNacimiento: 2004, nombres: ['SHTEREVA Maria'] },
    ]);
    expect(vincularLista(l.filas, l, FUENTES_RANKING.bff_ranglista.pais, indice)).toEqual([
      { personId: 'p1', via: 'nombre' },
      { personId: null, motivo: 'genero_distinto' },
    ]);
  });
});

describe('alta de las fuentes', () => {
  it('cada fuente nueva es nacional de su país', () => {
    expect(fuentesNacionalesDe('CZE')).toEqual(['css_zebricek']);
    expect(fuentesNacionalesDe('NED')).toEqual(['knas_ranglijst']);
    expect(fuentesNacionalesDe('VEN')).toEqual(['fve_clasificacion']);
    expect(fuentesNacionalesDe('BUL')).toEqual(['bff_ranglista']);
  });

  it('el vínculo checo usa el año de nacimiento y exige candidata única', () => {
    const [c] = combosCss(temporadasCss([{ id: 'b', name: '2025 - 2026', validTill: '2026-08-31', stateId: 'ARCHIVED' }], 2021));
    const l = listaCss(c, { totals: [
      { personId: 'u1', personFullName: 'Jurka Jakub', personBirthYear: 1999, cpRank: 1, cpTotalPoints: 10 },
      { personId: 'u2', personFullName: 'Novák Petr', personBirthYear: 2001, cpRank: 2, cpTotalPoints: 9 },
      { personId: 'u3', personFullName: 'Svoboda Jan', personBirthYear: 2000, cpRank: 3, cpTotalPoints: 8 },
    ] }, '2026-10-07')!;
    const indice = indicePersonas([
      { personId: 'p1', fieId: '1', pais: 'CZE', genero: 'M', anioNacimiento: 1999, nombres: ['JURKA Jakub'] },
      { personId: 'p2', fieId: '2', pais: 'CZE', genero: 'M', anioNacimiento: 1990, nombres: ['NOVAK Petr'] },
      { personId: 'p3', fieId: null, pais: 'CZE', genero: 'M', anioNacimiento: null, nombres: ['SVOBODA Jan'] },
      { personId: 'p4', fieId: null, pais: 'CZE', genero: 'M', anioNacimiento: null, nombres: ['SVOBODA Jan'] },
    ]);
    expect(vincularLista(l.filas, l, FUENTES_RANKING.css_zebricek.pais, indice)).toEqual([
      { personId: 'p1', via: 'nombre' },
      { personId: null, motivo: 'nacimiento_distinto' },
      { personId: null, motivo: 'ambigua' },
    ]);
  });
});
