import { describe, expect, it } from 'vitest';
import { PAGINAS_AFF, fechaAff, listasAff, nombreAff, temporadaAff } from '@/lib/ingest/rankings-internacionales/aff';
import { documentosFrs, listaFrs } from '@/lib/ingest/rankings-internacionales/frs';
import { anioLicenciaOefv, documentosOefv, listaOefv, partirFilaOefv } from '@/lib/ingest/rankings-internacionales/oefv';
import { filasCeldas, puntosPdf, type Celda } from '@/lib/ingest/rankings-internacionales/pdf-celdas';
import { documentosTef, listaTef } from '@/lib/ingest/rankings-internacionales/tef';
import { indicePersonas, vincularLista } from '@/lib/ingest/rankings-internacionales/vincular';
import { FUENTES_RANKING, fuentesNacionalesDe } from '@/lib/sport/rankings-internacionales-fuentes';

/** Una línea de celdas: `['1@28', 'Falchetto@133']` → celdas con su `x`. */
const linea = (...cs: string[]): Celda[] => cs.map((c) => {
  const i = c.lastIndexOf('@');
  return { s: c.slice(0, i), x: Number(c.slice(i + 1)) };
});

describe('celdas de PDF', () => {
  it('agrupa por altura, ordena por x y descarta trozos vacíos', () => {
    const filas = filasCeldas([
      { s: 'Lauro', x: 185, y: 483 },
      { s: ' ', x: 170, y: 483 },
      { s: 'Falchetto', x: 133, y: 482 },
      { s: '1', x: 28, y: 483.5 },
      { s: '720001', x: 81, y: 472 },
      { s: 'Rang', x: 28, y: 500 },
    ]);
    expect(filas.map((f) => f.map((c) => c.s))).toEqual([['Rang'], ['1', 'Falchetto', 'Lauro'], ['720001']]);
  });

  it('puntos con coma o punto, redondeados a dos decimales', () => {
    expect(puntosPdf('56,5')).toBe('56.5');
    expect(puntosPdf('11,188')).toBe('11.19');
    expect(puntosPdf('59.75')).toBe('59.75');
    expect(puntosPdf('-')).toBeNull();
    expect(puntosPdf(undefined)).toBeNull();
  });
});

describe('AFF (Australia)', () => {
  const html = `
    <div class="fl-accordion-button"><a class="fl-accordion-button-label" role="none">Men&#039;s Epee</a></div>
    <table><thead><tr class="row-1"><th class="column-1">Rank</th></tr></thead><tbody>
    <tr class="row-2"><td class="column-1"> 1</td><td class="column-2"><a target="_blank" href="/biography/afb-1956" rel="noopener">CROOK, Jacob (QLD)</a></td><td class="column-3"> 159.88</td><td class="column-9">133.28 (3) - <a href="#intl-1956Epee">Events</a><table class="intl-res"><tr><td>x</td></tr></table></td></tr>
    <tr class="row-3"><td class="column-1">*</td><td class="column-2">BAKER, Matt (NZL)</td><td class="column-3"> 56.65</td><td class="column-9">11.25 (2) - <a href="#intl-370Epee">Events</a></td></tr>
    <tr class="row-4"><td class="column-1">*</td><td class="column-2">HUMPHRIES, Harry ()</td><td class="column-3"> 3.8</td></tr>
    <tr class="row-5"><td class="column-1"> 2</td><td class="column-2"><a href="/biography/afb-7051">SO, Wing Tung (Christal) (QLD)</a></td><td class="column-3"> 28.8</td></tr>
    </tbody></table><p>Current as of October 7, 2026 9:05 am</p>
    <div class="fl-accordion-button"><a class="fl-accordion-button-label" role="none">Women’s Sabre</a></div>
    <table><tbody><tr class="row-2"><td class="column-1"> 1</td><td class="column-2"><a href="/biography/afb-3517">TANG, Ka Ying Lorraine (NSW)</a></td><td class="column-3"> 92.7</td></tr></tbody></table>
  `;

  it('lee cada arma y género con fecha publicada, puestos y tiradores de fuera con su país', () => {
    const [h, m] = listasAff(PAGINAS_AFF[0], html, '2026-10-08');
    expect(h).toMatchObject({ fuente: 'aff_ranking', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'Open', temporada: '2026-2027', publicadoEl: '2026-10-07', baseFecha: 'source', total: 3 });
    expect(h.filas).toEqual([
      { ref: 'aff:1956', nombre: 'CROOK Jacob', pais: null, puesto: 1, puntos: '159.88' },
      { ref: 'aff:370', nombre: 'BAKER Matt', pais: 'NZL', puesto: null, puntos: '56.65' },
      { ref: 'aff:7051', nombre: 'SO Wing Tung', pais: null, puesto: 2, puntos: '28.8' },
    ]);
    // Sin «Current as of» propio: día de lectura.
    expect(m).toMatchObject({ arma: 'SABLE', genero: 'F', publicadoEl: '2026-10-08', baseFecha: 'observed' });
  });

  it('nombres, fechas y temporada', () => {
    expect(nombreAff('DOMINGUEZ RUBINA, Ignacio (WA)')).toEqual({ nombre: 'DOMINGUEZ RUBINA Ignacio', origen: 'WA' });
    expect(nombreAff('sin paréntesis')).toBeNull();
    expect(fechaAff('Current as of March 3, 2026 9:05 am')).toBe('2026-03-03');
    expect(temporadaAff('2026-03-03')).toBe('2025-2026');
    expect(temporadaAff('2026-07-01')).toBe('2026-2027');
  });
});

describe('ÖFV (Austria)', () => {
  it('documentos del archivo por temporada, sólo AK, Junioren y Kadetten', () => {
    const html = `<h2 class="togglein">Saison 2025/26</h2><table>
      <a href="https://www.oefv.com/files/doc/Ranglistenarchiv/2026-HF-AK.pdf">Allgemeine Klasse Herren Florett</a>
      <a href="https://www.oefv.com/files/doc/Ranglistenarchiv/2026-DS-Jun.pdf">Junioren Damen S&auml;bel</a>
      <a href="https://www.oefv.com/files/doc/Ranglistenarchiv/2026-HF-JgdB.pdf">Jugend B Herren Florett</a></table>
      <h2>Saison 2024/26</h2><a href="x.pdf">Kadetten Herren Degen</a>`;
    expect(documentosOefv(html)).toEqual([
      { temporada: '2025-2026', url: 'https://www.oefv.com/files/doc/Ranglistenarchiv/2026-HF-AK.pdf', arma: 'FLORETE', genero: 'M', categoria: 'ABS', categoriaRaw: 'Allgemeine Klasse' },
      { temporada: '2025-2026', url: 'https://www.oefv.com/files/doc/Ranglistenarchiv/2026-DS-Jun.pdf', arma: 'SABLE', genero: 'F', categoria: 'M20', categoriaRaw: 'Junioren' },
    ]);
  });

  const doc = { temporada: '2025-2026', url: 'u', arma: 'FLORETE' as const, genero: 'M' as const, categoria: 'ABS' as const, categoriaRaw: 'Allgemeine Klasse' };

  it('columnas separadas: licencia con el año, apellido, nombre y puntos', () => {
    const pagina = [
      linea('Herren Florett Allgemeine Klasse@28'),
      linea('Rang@28', 'OEFV-Lizen@81', 'Nachname@133', 'Vorname@185', 'Club@238', 'Punkte@293', '1544 Grazer@345'),
      linea('1@28', 'OEFV20080@81', 'Falchetto@133', 'Lauro@185', 'FUM@238', '267@293', '23@345'),
      linea('720001@81'),
      linea('2@28', 'OEFV19941@81', 'Grasso@133', 'Kei Lorenzo@185', 'FUM@238', '100@293'),
    ];
    const l = listaOefv(doc, [pagina], '2026-10-07')!;
    expect(l).toMatchObject({ fuente: 'oefv_rangliste', baseFecha: 'observed', total: 2 });
    expect(l.filas).toEqual([
      { ref: 'oefv:Falchetto_Lauro_2008', nombre: 'FALCHETTO Lauro', pais: null, puesto: 1, puntos: '267', anioNacimiento: 2008 },
      { ref: 'oefv:Grasso_Kei_Lorenzo_1994', nombre: 'GRASSO Kei Lorenzo', pais: null, puesto: 2, puntos: '100', anioNacimiento: 1994 },
    ]);
  });

  it('cabeceras y celdas juntas de temporadas antiguas', () => {
    const pagina = [
      linea('Rang OEFV-@35'),
      linea('Nachname Vorname@135', 'Club@225', 'Punkte@258', 'Budapest_JWC@289'),
      linea('1@35', 'OEFV20000313001 Lechner@58', 'Moritz@181', 'STLFC@225', '325@258', '36@289'),
      linea('7@35', 'OEFV19991115001 Huthmann@58', 'Erik-Elmar AFCS@181', '150@258'),
      linea('20@35', 'OEFV19890101001 Scherz@58', 'SUW@225', '31@258'),
    ];
    expect(listaOefv(doc, [pagina], '2026-10-07')!.filas.map((f) => [f.nombre, f.anioNacimiento, f.puntos])).toEqual([
      ['LECHNER Moritz', 2000, '325'],
      ['HUTHMANN Erik-Elmar', 1999, '150'],
    ]);
  });

  it('sin cabecera reconocible (tabla girada o sin texto) no hay lista', () => {
    expect(listaOefv(doc, [[linea('690@66', 'OeSTM_Salzburg@75', '100@95')]], '2026-10-07')).toBeNull();
    expect(listaOefv(doc, [[]], '2026-10-07')).toBeNull();
  });

  it('partir fila y año de licencia', () => {
    expect(partirFilaOefv('OEFV19960602001 Schmidl Paula OOELFK')).toEqual({ licencia: 'OEFV19960602001', apellido: 'Schmidl', nombre: 'Paula' });
    expect(partirFilaOefv('Scherz SUW')).toBeNull();
    expect(anioLicenciaOefv('OEFV2005')).toBe(2005);
    expect(anioLicenciaOefv('OEFV1234')).toBeNull();
  });
});

describe('FRS (Rumanía)', () => {
  const html = `<h3><strong>Actualizare 3 februarie 2025</strong></h3><h2>CADEȚI</h2>
    <a href="https://frscrima.ro/wp-content/uploads/2021/12/FLF-CADETI-3.pdf"><strong>Cadeti &#8211; feminin &#8211; floreta</strong></a>
    <a href="https://frscrima.ro/wp-content/uploads/2021/12/SPM-JUNIORI-3.pdf"><strong>Juniori – masculin – spada</strong></a>
    <a href="https://frscrima.ro/regulament.pdf">Regulament</a>`;

  it('documentos con la fecha de actualización y la temporada', () => {
    const docs = documentosFrs(html);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      url: 'https://frscrima.ro/wp-content/uploads/2021/12/FLF-CADETI-3.pdf', arma: 'FLORETE', genero: 'F', categoria: 'M17', categoriaRaw: 'Cadeti',
      publicadoEl: '2025-02-03', temporada: '2024-2025',
    });
    expect(docs[1]).toMatchObject({ arma: 'ESPADA', genero: 'M', categoria: 'M20' });
    expect(documentosFrs('<p>sin fecha</p>')).toEqual([]);
  });

  it('filas: puesto, total, nombre, año y club', () => {
    const [d] = documentosFrs(html);
    const pagina = [
      linea('Loc@77', 'Total@93', 'Nume si Prenume@122', 'Anul@218'),
      linea('1@77', '126@93', 'Adoch Alexandra@122', '2009@218', 'ACS Floreta Timisoara@245', '35@338'),
      linea('2@77', '59.75@93', 'Lita Karina@122', '2008@218', 'CSA Steaua Buc@245'),
      linea('3@77', '5@93', 'Solo@122', '2008@218'),
    ];
    const l = listaFrs(d, [pagina])!;
    expect(l).toMatchObject({ fuente: 'frs_ranking', baseFecha: 'source', publicadoEl: '2025-02-03', total: 2 });
    expect(l.filas[1]).toEqual({ ref: 'frs:Lita_Karina_2008', nombre: 'LITA Karina', pais: null, puesto: 2, puntos: '59.75', anioNacimiento: 2008 });
  });
});

describe('TEF (Turquía)', () => {
  const html = `<table>
    <a href="https://www.eskrim.org.tr/resim/extra/Klasmanlar/26%20-%2027/eylul/29/B_E_E.pdf" title="B_E_E">Epe</a>
    <a href="https://www.eskrim.org.tr/resim/extra/Klasmanlar/26%20-%2027/Klasman/Agustos/18-sezon-ilk/U14_K_K.pdf">Kılıç</a>
    <a href="https://www.eskrim.org.tr/resim/extra/Klasmanlar/26%20-%2027/eylul/17/B_E_F_.pdf">Flöre</a>
    <a href="https://www.eskrim.org.tr/resim/extra/Klasmanlar/26%20-%2027/eylul/7/V_EPE.pdf">Veteran</a>
    <a href="https://www.eskrim.org.tr/resim/extra/Klasmanlar/26%20-%2027/Ocak/5/U10_E_E.pdf">U10</a></table>`;

  it('documentos con temporada y día sacados de la ruta', () => {
    const docs = documentosTef(html);
    expect(docs.map((d) => [d.categoria, d.genero, d.arma, d.temporada, d.dia])).toEqual([
      ['ABS', 'M', 'ESPADA', '2026-2027', '2026-09-29'],
      ['M14', 'F', 'SABLE', '2026-2027', '2026-08-18'],
      ['ABS', 'M', 'FLORETE', '2026-2027', '2026-09-17'],
    ]);
  });

  it('filas con nacimiento, total al final o en la línea de abajo, y la «ı» como «i»', () => {
    const [d] = documentosTef(html);
    const pagina = [
      linea('S.NO@55', 'SOYAD@71', 'AD@117', 'KULÜBÜ@180', 'DOĞUM TARİH@268'),
      linea('1@59', 'YETER@71', 'YALGIN@117', 'İSTANBUL F.A.S.K.@180', '30.11.2005@272', '56,5@322', '30,15@506'),
      linea('10@59', 'IŞIKLAR@71', 'BARAN@117', 'ANKARA ESK.@180', '22.12.1998@272', '19@322', '7,9@506'),
      linea('60@58', 'ATAŞ@72', 'ELMİRA@123', 'KOCAELİ B. B.@188', '05.04.2008@287'),
      linea('9@330', '0,9@362', '3,9@514'),
      linea('61@58', 'SIRA@72', 'ID@123', 'sin fecha@188'),
    ];
    const l = listaTef(d, [pagina], '2026-10-07')!;
    expect(l).toMatchObject({ fuente: 'tef_klasman', publicadoEl: '2026-09-29', baseFecha: 'source', total: 3 });
    expect(l.filas).toEqual([
      { ref: 'tef:yeter_yalgin_30.11.2005', nombre: 'YETER Yalgin', pais: null, puesto: 1, puntos: '30.15', anioNacimiento: 2005 },
      { ref: 'tef:isiklar_baran_22.12.1998', nombre: 'IŞIKLAR Baran', pais: null, puesto: 10, puntos: '7.9', anioNacimiento: 1998 },
      { ref: 'tef:atas_elmira_05.04.2008', nombre: 'ATAŞ Elmira', pais: null, puesto: 60, puntos: '3.9', anioNacimiento: 2008 },
    ]);
  });

  it('vínculo conservador: nombre sin signos, país de la federación, género y año', () => {
    const [d] = documentosTef(html);
    const l = listaTef(d, [[
      linea('1@59', 'IŞIKLAR@71', 'BARAN@117', 'X@180', '22.12.1998@272', '7,9@506'),
      linea('2@59', 'KAYA@71', 'EMRE@117', 'X@180', '01.01.2000@272', '5@506'),
      linea('3@59', 'DEMİR@71', 'ALİ@117', 'X@180', '01.01.2001@272', '4@506'),
    ]], '2026-10-07')!;
    const indice = indicePersonas([
      { personId: 'p1', fieId: '1', pais: 'TUR', genero: 'M', anioNacimiento: 1998, nombres: ['ISIKLAR Baran'] },
      { personId: 'p2', fieId: '2', pais: 'TUR', genero: 'M', anioNacimiento: 1999, nombres: ['KAYA Emre'] },
      { personId: 'p3', fieId: null, pais: 'TUR', genero: 'M', anioNacimiento: null, nombres: ['DEMIR Ali'] },
      { personId: 'p4', fieId: null, pais: 'TUR', genero: 'M', anioNacimiento: null, nombres: ['DEMIR Ali'] },
    ]);
    const v = vincularLista(l.filas, l, FUENTES_RANKING.tef_klasman.pais, indice);
    expect(v).toEqual([
      { personId: 'p1', via: 'nombre' },
      { personId: null, motivo: 'nacimiento_distinto' },
      { personId: null, motivo: 'ambigua' },
    ]);
  });
});

describe('alta de las fuentes', () => {
  it('cada fuente nueva es nacional de su país', () => {
    expect(fuentesNacionalesDe('AUS')).toEqual(['aff_ranking']);
    expect(fuentesNacionalesDe('AUT')).toEqual(['oefv_rangliste']);
    expect(fuentesNacionalesDe('ROU')).toEqual(['frs_ranking']);
    expect(fuentesNacionalesDe('TUR')).toEqual(['tef_klasman']);
  });
});
