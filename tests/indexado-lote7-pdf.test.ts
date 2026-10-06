import { describe, expect, it } from 'vitest';
import type { HechosPrueba } from '../src/lib/ingest/hechos/formato';
import { documentosDelMenu } from '../src/lib/ingest/sources/engarde-antiguo';
import { prepararNombre } from '../scripts/indexado/dedupe-pruebas';
import { alcanceObjetivos, anioDeClave, asignar, reclavar, type Objetivo } from '../scripts/indexado/lote7-pdf-droids';
import { fasesNuevas, huecoContenido, torneoCandidato, torneoSinFechaCandidato } from '../scripts/indexado/lote7-pdf-engarde';
import { capturasEngarde, partesUrlEngarde } from '../scripts/indexado/lote7-pdf-engarde-wayback';
import { canonica, celda, comprobarClasificacion, comprobarPoule, type PouleCruda } from '../scripts/indexado/lote7-pdf-poules-imagen';
import { capturasPdf, decodificar } from '../scripts/indexado/lote7-pdf-wayback';

const nombres = (...ns: string[]) => ({ nombres: ns.map(prepararNombre) });

function hechos(over: Partial<HechosPrueba['competition']>, results: { name: string; position: number | null }[] = []): HechosPrueba {
  const key = over.competitionKey ?? 'pdf:doc:doc:SABLE:F:INDIVIDUAL:M13:201321062025COLMENARVIEJ';
  return {
    version: 1, source: 'rfee_pdf', extractor: 'droid:x', sourceUrl: 'https://app.skermo.org/client/1/doc.pdf',
    sourceSha256: 'a'.repeat(64),
    edition: { season: '2024-2025', tournamentKey: 'pdf:doc', name: 'Criterium', startDate: null, endDate: null, city: null, countryCode: null },
    competition: { competitionKey: key, weapon: 'SABLE', gender: 'F', category: 'M13', categoryRaw: null, format: 'INDIVIDUAL', date: null, ...over },
    status: { results: 'completo', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null, notes: [] },
    results: results.map((r, i) => ({
      factKey: `${key}:pdfd:${r.position ?? `x${i + 1}`}`, name: r.name, countryCode: null, club: null, position: r.position,
      positionRaw: r.position === null ? 'CAMPEONA' : String(r.position), points: null, fieId: null, license: null, birthYear: null,
    })),
    bouts: [],
  };
}

const objetivo = (over: Partial<Objetivo> = {}): Objetivo => ({
  id: 'c1', season: '2024-2025', competitionKey: 'pdf:u1:u1:SABLE:F:INDIVIDUAL:M13:201321062025COLMENARVIEJ', tournamentKey: 'pdf:u1',
  editionName: 'Criterium', editionStart: null, editionEnd: null, fecha: '2025-06-21', weapon: 'SABLE', gender: 'F', category: 'M13',
  categoryRaw: '2013 21.06.2025 COLMENAR VIEJO', url: 'https://app.skermo.org/client/1/u1.pdf', anio: '2013', ...over,
});

describe('lote7-pdf: droids para clasificaciones vacías', () => {
  it('saca el año de cohorte de la última parte de la clave', () => {
    expect(anioDeClave('pdf:a:a:SABLE:F:INDIVIDUAL:M13:201321062025COLMENARVIEJ')).toBe('2013');
    expect(anioDeClave('pdf:a:a:ESPADA:F:INDIVIDUAL:M13:CRITERIUMM13201421062025')).toBe('2014');
    expect(anioDeClave('pdf:a:a:ESPADA:F:INDIVIDUAL:ABS:TNR')).toBeNull();
  });

  it('asigna cada prueba validada a la prueba existente de su mismo año y sólo si es única', () => {
    const h2013 = hechos({}, [{ name: 'A B', position: 1 }]);
    const h2012 = hechos({ competitionKey: 'pdf:doc:doc:SABLE:F:INDIVIDUAL:M13:201221062025COLMENARVIEJ' }, [{ name: 'C D', position: 1 }]);
    const vacia = hechos({ competitionKey: 'pdf:doc:doc:SABLE:F:INDIVIDUAL:M13:201321062025X' });
    const o = objetivo();
    expect(asignar([h2012, h2013], [o]).get(o)).toBe(h2013);
    // Dos lecturas del mismo año: no se elige.
    expect(asignar([h2013, { ...h2013 }], [o]).size).toBe(0);
    // Una prueba sin puestos no rellena nada.
    expect(asignar([vacia], [o]).size).toBe(0);
    expect(asignar([h2013], [objetivo({ gender: 'M' })]).size).toBe(0);
  });

  it('pone la clave existente en la prueba, la edición y los puestos', () => {
    const h = reclavar(hechos({}, [{ name: 'A B', position: null }, { name: 'C D', position: 9 }]), objetivo());
    expect(h.competition.competitionKey).toBe(objetivo().competitionKey);
    expect(h.edition.tournamentKey).toBe('pdf:u1');
    expect(h.results.map((r) => r.factKey)).toEqual([
      `${objetivo().competitionKey}:pdfd:x1`, `${objetivo().competitionKey}:pdfd:9`,
    ]);
  });

  it('el alcance nombra las tablas que faltan una vez cada una', () => {
    const a = alcanceObjetivos([objetivo(), objetivo({ id: 'c2' })]);
    expect(a.match(/SABLE FEMENINO category M13, birth year 2013/g)).toHaveLength(1);
    expect(a).toMatch(/Return empty "pools" and "tableau"/);
  });
});

describe('lote7-pdf: Engarde como alternativa al PDF de clasificación', () => {
  it('torneo nacional a ±3 días o cualquier torneo a ±1 día', () => {
    expect(torneoCandidato({ Organisme: 'fme', Titre: 'Torneo infantil', fecha: '2024-06-16' }, '2024-06-15')).toBe(true);
    expect(torneoCandidato({ Organisme: 'fme', Titre: 'Torneo infantil', fecha: '2024-06-18' }, '2024-06-15')).toBe(false);
    expect(torneoCandidato({ Organisme: 'rfee', Titre: 'Criterium', fecha: '2024-06-18' }, '2024-06-15')).toBe(true);
  });

  it('una clasificación de PDF contenida en la prueba mixta de Engarde', () => {
    const pdf = nombres('GARCIA LOPEZ Ana', 'PEREZ RUIZ Eva', 'SANZ GIL Lia', 'MORA DIAZ Noa');
    const engarde = nombres('GARCIA LOPEZ Ana', 'PEREZ RUIZ Eva', 'SANZ GIL Lia', 'MORA DIAZ Noa', 'VIDAL RUIZ Hugo', 'ROS PINA Leo');
    expect(huecoContenido(pdf, engarde)).toBe(true);
    expect(huecoContenido(pdf, nombres('GARCIA LOPEZ Ana', 'OTRO NOMBRE Uno', 'OTRO NOMBRE Dos'))).toBe(false);
    expect(huecoContenido(nombres('GARCIA LOPEZ Ana', 'PEREZ RUIZ Eva'), engarde)).toBe(false);
  });

  it('sólo cuenta como completada una fase que falta y que la lectura trae', () => {
    const b = (phase: 'POULE' | 'TABLEAU') => ({ phase, roundKey: 'P1', aRef: 'a', bRef: 'b', aName: 'A', bName: 'B', scoreA: 5, scoreB: 3, winner: null });
    expect(fasesNuevas({ bouts: [b('POULE')] }, ['POULE', 'TABLEAU'])).toEqual(['POULE']);
    expect(fasesNuevas({ bouts: [b('POULE')] }, ['TABLEAU'])).toEqual([]);
  });

  it('el menú de la exportación estática enlaza los documentos con index.php?page=', () => {
    const menu = '<a href="index.php?page=tireurs.htm">T</a><a href="index.php?page=poules1.htm">P</a>'
      + '<a href="index.php?page=tableau_a16.htm">C</a><a href="index.php?page=clasfinal.htm">F</a><a href="poules2.htm">P2</a>';
    expect(documentosDelMenu(menu)).toEqual([
      { fichero: 'poules1.htm', tipo: 'poules' },
      { fichero: 'tableau_a16.htm', tipo: 'cuadro' },
      { fichero: 'clasfinal.htm', tipo: 'clasificacion' },
      { fichero: 'poules2.htm', tipo: 'poules' },
    ]);
  });
});

describe('lote7-pdf: torneos de Engarde sin fecha y capturas de la Wayback', () => {
  it('un torneo sin fecha entra por organizador nacional y año del hueco en el nombre', () => {
    expect(torneoSinFechaCandidato({ Organisme: 'rfee', Event: 'cespabs_2018', Titre: '' }, '2018-06-09')).toBe(true);
    expect(torneoSinFechaCandidato({ Organisme: 'rfee', Event: 'ligamaster1819', Titre: '' }, '2019-02-02')).toBe(true);
    expect(torneoSinFechaCandidato({ Organisme: 'rfee', Event: 'tnr_18', Titre: '' }, '2018-01-20')).toBe(true);
    expect(torneoSinFechaCandidato({ Organisme: 'rfee', Event: 'cespabs_2017', Titre: '' }, '2018-06-09')).toBe(false);
    expect(torneoSinFechaCandidato({ Organisme: 'fme', Event: 'infantil2018', Titre: 'Torneo infantil' }, '2018-06-09')).toBe(false);
  });

  it('parte las URL capturadas de Engarde y se queda con la última captura de cada página', () => {
    expect(partesUrlEngarde('http://www.engarde-service.com:80/competition/RFEE/evt/ef_ind/poules1.htm'))
      .toEqual({ org: 'rfee', evt: 'evt', compe: 'ef_ind', pagina: 'poules1.htm' });
    expect(partesUrlEngarde('https://engarde-service.com/files/rfee/cespabs_2018/ef_ind/index.php?page=clasfinal.htm'))
      .toEqual({ org: 'rfee', evt: 'cespabs_2018', compe: 'ef_ind', pagina: 'files_clasfinal.htm' });
    expect(partesUrlEngarde('https://www.engarde-service.com/tournament/rfee/evt')).toMatchObject({ compe: null, pagina: 'torneo' });
    expect(partesUrlEngarde('https://www.engarde-service.com/index.php?lang=es')).toBeNull();
    const g = capturasEngarde([
      { timestamp: '20180101000000', original: 'http://engarde-service.com/competition/rfee/evt/c/poules1.htm' },
      { timestamp: '20190101000000', original: 'https://www.engarde-service.com/competition/rfee/evt/c/poules1.htm' },
      { timestamp: '20180101000000', original: 'https://www.engarde-service.com/competition/rfee/evt/c/clasfinal.htm' },
    ]);
    expect([...g.keys()]).toEqual(['rfee/evt']);
    expect(g.get('rfee/evt')!.map((p) => [p.pagina, p.timestamp])).toEqual([
      ['poules1.htm', '20190101000000'], ['clasfinal.htm', '20180101000000'],
    ]);
  });
});

describe('lote7-pdf: hojas de poules en imagen', () => {
  const fila = (name: string, cells: string[], vm: string, tdtr: string, td: string) => ({ name, club: null, cells, vm, tdtr, td });
  const poule = (): PouleCruda => ({
    pool: 1,
    rows: [
      fila('GARCIA Ana', ['', 'V', 'V'], '1.000', '5', '10'),
      fila('PEREZ Eva', ['2', '', 'V'], '0.500', '-2', '7'),
      fila('SANZ Lia', ['3', '4', ''], '0.000', '-3', '7'),
    ],
  });
  const ranking = [
    { rank: 1, surname: 'GARCIA', firstName: 'Ana', vm: '1.000', ind: '5', td: '10' },
    { rank: 2, surname: 'PEREZ', firstName: 'Eva', vm: '0.500', ind: '-2', td: '7' },
    { rank: 3, surname: 'SANZ', firstName: 'Lia', vm: '0.000', ind: '-3', td: '7' },
  ];

  it('lee las celdas de la matriz', () => {
    expect(celda('V', 5)).toEqual({ tocados: 5, victoria: true });
    expect(celda('v4', 5)).toEqual({ tocados: 4, victoria: true });
    expect(celda(' 3 ', 5)).toEqual({ tocados: 3, victoria: false });
    expect(celda('?', 5)).toBeNull();
  });

  it('acepta una poule coherente y saca un asalto por pareja', () => {
    const c = comprobarPoule(poule());
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.asaltos).toEqual([
      { a: 'GARCIA Ana', b: 'PEREZ Eva', sa: 5, sb: 2, w: null },
      { a: 'GARCIA Ana', b: 'SANZ Lia', sa: 5, sb: 3, w: null },
      { a: 'PEREZ Eva', b: 'SANZ Lia', sa: 5, sb: 4, w: null },
    ]);
  });

  it('rechaza poules incoherentes', () => {
    const p = poule();
    p.rows[1].cells[0] = 'V';
    expect(comprobarPoule(p)).toEqual({ ok: false, motivo: 'pareja_sin_un_ganador' });
    const q = poule();
    q.rows[0].td = '9';
    expect(comprobarPoule(q)).toEqual({ ok: false, motivo: 'td_no_cuadra' });
    const r = poule();
    r.rows[2].vm = '0.500';
    expect(comprobarPoule(r)).toEqual({ ok: false, motivo: 'vm_no_cuadra' });
    const s = poule();
    s.rows[2].cells = ['3', '4'];
    expect(comprobarPoule(s)).toEqual({ ok: false, motivo: 'matriz_no_cuadrada' });
  });

  it('la clasificación de poules debe cuadrar con las poules y estar ordenada', () => {
    expect(comprobarClasificacion([poule()], ranking)).toBeNull();
    expect(comprobarClasificacion([poule()], ranking.slice(0, 2))).toBe('clasificacion_otro_numero_de_tiradores');
    expect(comprobarClasificacion([poule()], [ranking[1], ranking[0], ranking[2]])).toBe('clasificacion_orden_incoherente');
    expect(comprobarClasificacion([poule()], [{ ...ranking[0], td: '11' }, ranking[1], ranking[2]])).toBe('clasificacion_valores_distintos');
  });

  it('dos lecturas iguales salvo formato tienen la misma forma canónica', () => {
    const a = { headerLines: ['CRITERIUM NACIONAL 2022', 'SABLE FEMENINO M13 AÑO 2009'], pools: [poule()], ranking };
    const b = structuredClone(a);
    b.pools[0].rows[0].vm = '1,000';
    b.pools[0].rows[0].cells[1] = 'v';
    expect(canonica(b)).toBe(canonica(a));
    b.pools[0].rows[1].cells[0] = '3';
    expect(canonica(b)).not.toBe(canonica(a));
  });
});

describe('lote7-pdf: Wayback de esgrima.es', () => {
  it('una captura 200 por PDF, la más reciente, sin el :80', () => {
    const filas = [
      ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
      ['k', '20180101000000', 'http://www.esgrima.es:80/pdfs/calendario/A.pdf', 'application/pdf', '200', 'D1', '10'],
      ['k', '20180301000000', 'http://www.esgrima.es/pdfs/calendario/A.pdf', 'application/pdf', '200', 'D2', '11'],
      ['k', '20180401000000', 'http://www.esgrima.es/pdfs/calendario/B.pdf', 'application/pdf', '404', 'D3', '0'],
      ['k', '20180401000000', 'http://www.esgrima.es/pdfs/calendario/C.html', 'text/html', '200', 'D4', '5'],
    ];
    const c = capturasPdf(filas);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ timestamp: '20180301000000', digest: 'D2' });
    expect(decodificar('Clas%20Cto%20Espa%C3%B1a')).toBe('Clas Cto España');
    expect(decodificar('100%')).toBe('100%');
  });
});
