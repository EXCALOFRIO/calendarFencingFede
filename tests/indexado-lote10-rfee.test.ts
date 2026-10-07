import { describe, expect, it } from 'vitest';
import type { HechosPrueba } from '@/lib/ingest/hechos/formato';
import { elegirListasBf, entradasSitemapBf, filasTablaBf, listaBf, temporadaBf } from '@/lib/ingest/rankings-internacionales/bf';
import { documentosCff, leerCsv, listasCff } from '@/lib/ingest/rankings-internacionales/cff';
import { completarCriterium, distancia, marcadorImposible, PUESTO_GANADOR, semifinalistasDeCuadro } from '../scripts/indexado/lote10-criterium';
import { cotejarClasificacion, depurarMarcadores, fasesAportadas } from '../scripts/indexado/lote10-engarde-wayback';
import { listaCoherente, parsearRankingWeb, refFila } from '../scripts/indexado/lote10-rfee-ranking-web';

const fila = (n: number, nombre: string, nacion: string, quarter: number) =>
  `<tr><td class="D placeNumber quarter${quarter}">${n}</td><td class="HBD fencer quarter${quarter}">${nombre}</td><td class="HBD nation quarter${quarter}">${nacion}</td><td></td></tr>`;
const avance = (nombre: string, q: number, marcador: string) =>
  `<tr><td></td><td class="timePiste">Arbitro</td><td class="D"></td><td class="HBD fencer quarter${q}">${nombre}</td></tr><tr><td></td><td></td><td></td><td class="D score">${marcador}</td></tr>`;

/** Tablón de 8 del Criterium con columnas de semifinales y final vacías (un asalto por cuarto). */
const CUADRO = `<table class="tableau"><tr><td></td><td class="tableTitle">Tableau of 8</td><td></td><td class="tableTitle">Semi-finales</td><td class="tableTitle">Final</td></tr>
${fila(1, 'ALFA Uno', 'C1', 1)}${avance('ALFA Uno', 1, '10/3')}${fila(8, 'OCHO Ocho', 'C8', 1)}
${fila(4, 'CUATRO Cuatro', 'C4', 2)}${avance('CINCO Cinco', 2, '10/4')}${fila(5, 'CINCO Cinco', 'C5', 2)}
${fila(3, 'TRES Tres', 'C3', 3)}${avance('TRES Tres', 3, '10/9')}${fila(6, 'SEIS Seis', 'C6', 3)}
${fila(2, 'DOS Dos', 'C2', 4)}${avance('SIETE Siete', 4, '10/7')}${fila(7, 'SIETE Siete', 'C7', 4)}</table>`;

function criterium(): HechosPrueba {
  const r = (name: string, position: number) => ({
    factKey: `engarde:${name.toLowerCase()}|`, name, countryCode: null, club: null, position, positionRaw: String(position),
    points: null, fieId: null, license: null, birthYear: null,
  });
  const b = (a: string, sa: number, c: string, sb: number) => ({
    phase: 'TABLEAU' as const, roundKey: 'T8', aRef: `engarde:${a.toLowerCase()}|`, bRef: `engarde:${c.toLowerCase()}|`, aName: a, bName: c, scoreA: sa, scoreB: sb, winner: null,
  });
  return {
    version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: 'https://engarde-service.com/competition/rfee/x/em', sourceSha256: '0'.repeat(64),
    edition: { season: '2021-2022', tournamentKey: 'engarde:rfee/x', name: 'Criterium Nacional', startDate: '2022-06-05', endDate: '2022-06-05', city: null, countryCode: null },
    competition: { competitionKey: 'engarde:rfee/x/em', weapon: 'ESPADA', gender: 'M', category: 'M11', categoryRaw: null, format: 'INDIVIDUAL', date: '2022-06-05' },
    status: { results: 'completo', pools: 'completo', tableau: 'completo', publishedParticipants: 5, notes: [] },
    results: [r('OCHO Ocho', 5), r('CUATRO Cuatro', 6), r('SEIS Seis', 7), r('DOS Dos', 8), r('NUEVE Nueve', 9)],
    bouts: [b('ALFA Uno', 10, 'OCHO Ocho', 3), b('CINCO Cinco', 10, 'CUATRO Cuatro', 4), b('TRES Tres', 10, 'SEIS Seis', 9), b('SIETE Siete', 10, 'DOS Dos', 7)],
  };
}

describe('lote 10 · Criterium', () => {
  it('lee los ganadores del tablón de 8 en la columna de semifinales', () => {
    const c = semifinalistasDeCuadro(CUADRO)!;
    expect(c.semis.map((s) => s.nombre)).toEqual(['ALFA Uno', 'CINCO Cinco', 'TRES Tres', 'SIETE Siete']);
    expect(c.semis[1].nacion).toBe('C5');
    expect(c.tablon8).toHaveLength(8);
  });

  it('añade los cuatro ganadores con el puesto 1 compartido', () => {
    const r = completarCriterium(criterium(), semifinalistasDeCuadro(CUADRO)!, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ganadores = r.hechos.results.filter((x) => x.position === 1);
    expect(ganadores.map((x) => x.name).sort()).toEqual(['ALFA Uno', 'CINCO Cinco', 'SIETE Siete', 'TRES Tres']);
    expect(ganadores.every((x) => x.positionRaw === PUESTO_GANADOR)).toBe(true);
    // Las referencias de los asaltos apuntan a los nuevos puestos.
    expect(ganadores.find((x) => x.name === 'ALFA Uno')!.factKey).toBe('engarde:alfa uno|');
    expect(r.hechos.status.publishedParticipants).toBe(9);
  });

  it('no escribe si la clasificación oficial da otros ganadores', () => {
    const oficial = { id: 'x', key: 'pdf:x', ganadores: ['ALFA Uno', 'CINCO Cinco', 'TRES Tres', 'OCHO Ocho'], finalistas: ['SIETE Siete', 'CUATRO Cuatro', 'SEIS Seis', 'DOS Dos'] };
    const r = completarCriterium(criterium(), semifinalistasDeCuadro(CUADRO)!, [oficial]);
    expect(r).toMatchObject({ ok: false, motivo: 'ganadores_distintos_de_la_oficial' });
  });

  it('acepta erratas de tecleo en la oficial', () => {
    expect(distancia('duran ibarra', 'duran ibarrra')).toBe(1);
    const oficial = { id: 'x', key: 'pdf:x', ganadores: ['ALFA Uno', 'CINCO Cinko', 'TRES Tres', 'SIETE Siete'], finalistas: [] };
    expect(completarCriterium(criterium(), semifinalistasDeCuadro(CUADRO)!, [oficial]).ok).toBe(true);
  });

  it('rechaza una clasificación que ya empieza en el primer puesto', () => {
    const h = criterium();
    h.results[0].position = 1;
    expect(completarCriterium(h, semifinalistasDeCuadro(CUADRO)!, [])).toMatchObject({ ok: false, motivo: 'clasificacion_no_empieza_en_5' });
  });

  it('marcadores imposibles del Criterium', () => {
    expect(marcadorImposible({ phase: 'POULE', scoreA: 6, scoreB: 2, winner: null })).toBe(true);
    expect(marcadorImposible({ phase: 'POULE', scoreA: 5, scoreB: 5, winner: null })).toBe(true);
    expect(marcadorImposible({ phase: 'POULE', scoreA: 5, scoreB: 5, winner: 'A' })).toBe(false);
    expect(marcadorImposible({ phase: 'TABLEAU', scoreA: 10, scoreB: 9, winner: null })).toBe(false);
  });
});

describe('lote 10 · Wayback de Engarde', () => {
  it('fases aportadas, cotejo y depuración de marcadores', () => {
    const h = criterium();
    expect(fasesAportadas(h, ['poules', 'cuadro'])).toEqual(['cuadro']);
    expect(cotejarClasificacion(h, [{ nombre: 'Ocho OCHO', puesto: 5 }, { nombre: 'SEIS Seis', puesto: 7 }, { nombre: 'X Y', puesto: 1 }])).toEqual({ presentes: 2 / 3, mismosPuestos: 1 });
    h.bouts.push({ ...h.bouts[0], scoreA: 16, scoreB: 2 });
    expect(depurarMarcadores(h)).toBe(1);
    expect(h.status.tableau).toBe('parcial');
  });
});

const RANKING_WEB = `<HTML><TITLE>RANKING NACIONAL SABLE MASCULINO ABSOLUTO 2014-2015</TITLE><body><table>
<TR><TD COLSPAN=4><b>Tiradores Participantes: </b></TD><TD WIDTH=25>221</TD><TD WIDTH=25>72</TD><TD WIDTH=25></TD><td><b>L</b></tr>
<!--linea 20 --><TR><TD WIDTH=40><b>Rkg.</b></TD><TD><b>Apellidos, Nombre </b></TD></TR>
<!--linea 21 --><TR><TD WIDTH=40>1</TD><TD WIDTH=200 align=left>PEREZ GARCIA, Juan     </TD><TD>CE-M  </TD><TD>ESP </TD><TD>1990</TD><TD>32 </TD><TD>-</TD><td width=30><b>64 </b></tr>
<!--linea 22 --><TR><TD WIDTH=40>2</TD><TD WIDTH=200 align=left>LOPEZ, Ana Maria</TD><TD>VC-M</TD><TD>ESP</TD><TD>1995</TD><TD>16 </TD><TD>-</TD><td width=30><b>20,5 </b></tr>
</table></body></HTML>`;

describe('lote 10 · ranking RFEE de la web antigua', () => {
  it('lee título, pruebas y filas', () => {
    const l = parsearRankingWeb(RANKING_WEB)!;
    expect(l).toMatchObject({ temporada: '2014-2015', arma: 'SABLE', genero: 'M', categoria: 'ABS', pruebas: 2 });
    expect(l.filas).toEqual([
      { puesto: 1, nombre: 'PEREZ GARCIA Juan', club: 'CE-M', nacion: 'ESP', anio: 1990, puntos: '64' },
      { puesto: 2, nombre: 'LOPEZ Ana Maria', club: 'VC-M', nacion: 'ESP', anio: 1995, puntos: '20.5' },
    ]);
    expect(listaCoherente(l)).toBeNull();
    expect(refFila(l.filas[0])).toBe('rfee-web:garcia_juan_perez|1990');
  });

  it('acepta M-15 y el año cortado, y descarta el ranking interno', () => {
    expect(parsearRankingWeb(RANKING_WEB.replace('SABLE MASCULINO ABSOLUTO 2014-2015', 'ESPADA FEMENINA M-15 2015-2016'))).toMatchObject({ categoria: 'M15', genero: 'F', temporada: '2015-2016' });
    expect(parsearRankingWeb(RANKING_WEB.replace('ABSOLUTO 2014-2015', 'JUNIOR 2016-201'))).toMatchObject({ categoria: 'M20', temporada: '2016-2017' });
    expect(parsearRankingWeb(RANKING_WEB.replace('RANKING NACIONAL', 'RANKING INTERNO'))).toBeNull();
    expect(parsearRankingWeb(RANKING_WEB.replace('2014-2015', '2014-2016'))).toBeNull();
  });

  it('una lista con puntos crecientes no es coherente', () => {
    const l = parsearRankingWeb(RANKING_WEB.replace('<b>20,5 </b>', '<b>90 </b>'))!;
    expect(listaCoherente(l)).toBe('puntos_crecientes');
  });
});

describe('lote 10 · British Fencing', () => {
  const sitemap = `<urlset><url><loc>https://www.britishfencing.com/senior-mens-epee-01-10-2026-0511/</loc><lastmod>2026-10-01T06:01:07+00:00</lastmod></url>
<url><loc>https://www.britishfencing.com/senior-mens-epee-31-08-2023-1525/</loc></url>
<url><loc>https://www.britishfencing.com/senior-mens-epee-01-07-2023-1958/</loc></url>
<url><loc>https://www.britishfencing.com/senior-mens-epee-march-2020/</loc></url>
<url><loc>https://www.britishfencing.com/cadet-womens-sabre-22nd-september-2019/</loc></url>
<url><loc>https://www.britishfencing.com/intermediate-mens-epee-01-10-2026-0510/</loc></url>
<url><loc>https://www.britishfencing.com/cadet-mens-foil-team-reach-cabries-final/</loc></url></urlset>`;

  it('enumera las listas y elige la última de cada temporada', () => {
    const e = entradasSitemapBf(sitemap);
    expect(e.map((x) => x.fecha)).toEqual(['2026-10-01', '2023-08-31', '2023-07-01', '2020-03-01', '2019-09-01']);
    expect(temporadaBf('2023-08-31')).toBe('2022-2023');
    const l = elegirListasBf(e, '2026-10-07');
    expect(l.map((x) => `${x.slug}:${x.cerrada}`).sort()).toEqual([
      'cadet-womens-sabre-22nd-september-2019:true', 'senior-mens-epee-01-10-2026-0511:false', 'senior-mens-epee-31-08-2023-1525:true', 'senior-mens-epee-march-2020:true',
    ]);
  });

  it('lee las dos formas de tabla', () => {
    const nueva = '<table><thead><tr><th>Rank</th><th>Name</th><th>Club</th><th>Licence</th><th>Total Points</th></tr></thead><tbody><tr><td>1</td><td>BROOKE Alec</td><td>KFC</td><td>118351</td><td>152690</td></tr></tbody></table>';
    const vieja = '<table class="table"><thead><tr><th>Position</th><th>Surname Forename</th><th>Club</th><th>BF Number</th><th>Points Total</th></tr></thead><tbody><tr><td>1</td><td>MARSH Philip</td><td>Bath</td><td>96878</td><td>76,582</td></tr></tbody></table>';
    expect(filasTablaBf(nueva)).toEqual([{ puesto: 1, nombre: 'BROOKE Alec', licencia: '118351', puntos: '152690' }]);
    expect(filasTablaBf(vieja)).toEqual([{ puesto: 1, nombre: 'MARSH Philip', licencia: '96878', puntos: '76582' }]);
    const [e] = elegirListasBf(entradasSitemapBf(sitemap), '2026-10-07').filter((x) => x.slug.endsWith('0511'));
    expect(listaBf(e, nueva)).toMatchObject({ fuente: 'bf_ranking', temporada: '2026-2027', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'Senior', publicadoEl: '2026-10-01', baseFecha: 'source', filas: [{ ref: 'bf:118351' }] });
  });
});

describe('lote 10 · Canadian Fencing Federation', () => {
  it('documentos de fin de temporada y listas por evento', () => {
    const html = '<a href="https://fencing.ca/wp-content/uploads/2025-2026-Season-End-Rankings.xlsx">2025-2026 Season End Rankings</a><a href="http://fencing.ca//wp-content/x.pdf">2014-2015 Season End Rankings</a><a href="/x.xlsx">Otro</a>';
    expect(documentosCff(html)).toEqual([{ temporada: '2025-2026', url: 'https://fencing.ca/wp-content/uploads/2025-2026-Season-End-Rankings.xlsx', archivo: '2025-2026.xlsx' }]);
    const filas = leerCsv('Event,Rank,CFF Licence,Last Name,First Name,Total\r\nSME,1,C17-1641,arthurs,david,"34.4"\nSME,2,C24-10791,suveg,bela,33\nV60ME,1,C1-1,x,y,1\nU15WS,1,C10-5,o\'neil,mary-ann,12.3456\n');
    const l = listasCff({ temporada: '2025-2026', url: 'u' }, filas, '2026-10-07');
    expect(l.map((x) => `${x.categoria}|${x.genero}|${x.arma}|${x.filas.length}`)).toEqual(['ABS|M|ESPADA|2', 'M15|F|SABLE|1']);
    expect(l[0].filas[0]).toMatchObject({ ref: 'cff:C17-1641', nombre: 'ARTHURS David', puesto: 1, puntos: '34.4' });
    expect(l[1].filas[0]).toMatchObject({ nombre: "O'NEIL Mary-Ann", puntos: '12.35' });
  });
});
