import { describe, expect, it } from 'vitest';
import type { CompetitionView, EventView } from '@/lib/queries/calendar';
import { nombreDePruebaPasada } from '@/components/calendario/pasado/resultados-pasados';
import {
  aPruebaPasada,
  baseDeNombre,
  componerTramo,
  edicionesDeCruces,
  esMarcadorFie,
  urlPublica,
  type FilaCruce,
  type FilaPruebaImportada,
} from '@/lib/queries/calendario-pasado-modelo';
import {
  leerSaltoDeMes,
  tramoDeMeses,
  tramoPasadoDe,
} from '@/lib/queries/calendario-pasado-tramo';

const ESTADO: CompetitionView['status'] = {
  state: 'cerrado',
  label: 'Inscripción cerrada',
  next: null,
  daysLeft: null,
  currentSurchargeEur: null,
  nextSurchargeEur: null,
  closed: true,
  hasEstimates: false,
};

function prueba(sobre: Partial<CompetitionView>): CompetitionView {
  return {
    id: 'ec-1',
    weapon: 'ESPADA',
    gender: 'M',
    category: 'ABS',
    categoryRaw: null,
    format: 'INDIVIDUAL',
    competitionDate: '2026-09-26',
    installationOpen: null,
    callTime: null,
    scratchTime: null,
    startTime: null,
    registrationCount: null,
    feeEur: null,
    sourceUrl: null,
    deadlines: [],
    status: ESTADO,
    datosExtraidos: [],
    ...sobre,
  };
}

function evento(sobre: Partial<EventView>): EventView {
  return {
    id: 'ev-1',
    source: 'skermo_rfee',
    sourceUrl: null,
    name: 'TNR ABS',
    startDate: '2026-09-26',
    endDate: '2026-09-27',
    venue: null,
    venueAddress: null,
    city: 'Medina del Campo',
    country: 'ES',
    geoLat: null,
    geoLon: null,
    timezone: null,
    officialSite: null,
    imageUrl: null,
    circuit: 'TNR',
    scope: 'NACIONAL',
    regionalFederation: null,
    notes: null,
    lastSeenAt: new Date(0),
    disappearedAt: null,
    competitions: [prueba({})],
    documents: [],
    liveLinks: [],
    linkedEvents: [],
    sources: [],
    imageSource: null,
    circuitFie: null,
    datosExtraidos: [],
    ...sobre,
  };
}

function fila(sobre: Partial<FilaPruebaImportada>): FilaPruebaImportada {
  return {
    id: 'sc-1',
    edicionId: 'se-1',
    fuente: 'skermo_rfee',
    arma: 'ESPADA',
    genero: 'M',
    categoria: 'ABS',
    formato: 'INDIVIDUAL',
    fecha: '2026-09-26',
    url: null,
    edicion: 'TNR ABS',
    inicio: '2026-09-26',
    fin: '2026-09-26',
    ciudad: 'MEDINA DEL CAMPO',
    pais: null,
    urlEdicion: null,
    conResultados: 1,
    ganador: 'GARCÍA Pedro\u001fESP',
    ...sobre,
  };
}

const TRAMO = { desde: '2026-09-01', hasta: '2026-09-30' };

describe('componerTramo: el calendario ya celebrado, cruzado con Explorar', () => {
  it('ata la prueba exacta al torneo del calendario y no la repite suelta', () => {
    const cal = evento({});
    const exacta = fila({});
    const cruce: FilaCruce = { ...exacta, evento: cal.id };
    const t = componerTramo({ ...TRAMO, calendario: [cal], cruces: [cruce], importadas: [exacta] });

    expect(t.eventos.map((e) => e.id)).toEqual([cal.id]);
    expect(t.importados).toEqual([]);
    expect(t.resultados[cal.id]).toHaveLength(1);
    expect(t.resultados[cal.id][0].ganador).toEqual({ nombre: 'GARCÍA Pedro', pais: 'ESP' });
  });

  it('sin clave, empareja la prueba nacional del mismo día y descarta su copia en PDF', () => {
    const cal = evento({});
    const pdf = fila({ id: 'sc-pdf', edicionId: 'se-pdf', fuente: 'rfee_pdf', ciudad: null });
    const pdfCopia = fila({ id: 'sc-pdf-2', edicionId: 'se-pdf-2', fuente: 'rfee_pdf', ciudad: null });
    const t = componerTramo({ ...TRAMO, calendario: [cal], cruces: [], importadas: [pdf, pdfCopia] });

    expect(t.resultados[cal.id].map((p) => p.id)).toEqual(['sc-pdf']);
    // La segunda lectura del mismo resultado no se convierte en otro torneo.
    expect(t.importados).toEqual([]);
  });

  it('en la FIE no empareja por la prueba si la ciudad es otra: un sábado hay varios satélites', () => {
    const cal = evento({
      id: 'ev-fie',
      source: 'fie',
      scope: 'INTERNACIONAL',
      circuit: 'SATELITE',
      city: 'Dublin',
      country: 'IE',
      competitions: [prueba({ competitionDate: '2026-09-05' })],
    });
    const reykjavik = fila({
      id: 'sc-rey',
      edicionId: 'se-rey',
      fuente: 'fie',
      edicion: 'Tournoi Satellite',
      fecha: '2026-09-05',
      inicio: '2026-09-05',
      fin: '2026-09-05',
      ciudad: 'Reykjavik',
      pais: 'ISL',
    });
    const dublin = { ...reykjavik, id: 'sc-dub', edicionId: 'se-dub', ciudad: 'Dublin', pais: 'IRL' };
    const t = componerTramo({ ...TRAMO, calendario: [cal], cruces: [], importadas: [reykjavik, dublin] });

    expect(t.resultados[cal.id].map((p) => p.id)).toEqual(['sc-dub']);
    expect(t.importados).toHaveLength(1);
    const suelto = t.eventos.find((e) => e.id === t.importados[0])!;
    expect(suelto.city).toBe('Reykjavik');
    expect(suelto.name).toBe('Torneo Satélite');
    expect(suelto.circuit).toBe('SATELITE');
    expect(suelto.scope).toBe('INTERNACIONAL');
  });

  it('junta en un torneo el individual y el de equipos de la misma sede, y no la misma sede otro año', () => {
    const base = {
      fuente: 'fie',
      arma: 'FLORETE',
      genero: 'F',
      ciudad: 'Le Caire',
      pais: 'EGY',
    };
    const filas = [
      fila({ ...base, id: 'a', edicionId: 'e-a', edicion: 'Coupe du Monde', fecha: '2019-03-01', inicio: '2019-03-01', fin: '2019-03-02' }),
      fila({ ...base, id: 'b', edicionId: 'e-b', edicion: 'Coupe du Monde par équipes', formato: 'EQUIPOS', fecha: '2019-03-03', inicio: '2019-03-03', fin: '2019-03-03' }),
      fila({ ...base, id: 'c', edicionId: 'e-c', edicion: 'Coupe du Monde', fecha: '2020-03-01', inicio: '2020-03-01', fin: '2020-03-01' }),
    ];
    const t = componerTramo({ desde: '2019-01-01', hasta: '2020-12-31', calendario: [], cruces: [], importadas: filas });

    expect(t.importados).toHaveLength(2);
    const [cairo2019, cairo2020] = t.importados.map((id) => t.eventos.find((e) => e.id === id)!);
    expect(cairo2019.startDate).toBe('2019-03-01');
    expect(cairo2019.endDate).toBe('2019-03-03');
    expect(cairo2019.competitions.map((c) => c.format)).toEqual(['INDIVIDUAL', 'EQUIPOS']);
    expect(cairo2019.name).toBe('Copa del Mundo');
    expect(cairo2019.circuit).toBe('SEN_WC');
    expect(t.resultados[cairo2019.id].map((p) => p.id)).toEqual(['a', 'b']);
    expect(cairo2020.startDate).toBe('2020-03-01');
  });

  it('no descarta pruebas de Skermo contra sí mismas: el TLM tiene varias espadas el mismo día', () => {
    const tramos = ['v40', 'v50', 'v60'].map((tramo) =>
      fila({ id: `sc-${tramo}`, edicionId: `se-${tramo}`, categoria: 'VET', edicion: 'TLM VET (1/3)', ciudad: 'Madrid', fecha: '2024-11-30', inicio: '2024-11-30', fin: '2024-11-30' }),
    );
    const t = componerTramo({ desde: '2024-11-01', hasta: '2024-11-30', calendario: [], cruces: [], importadas: tramos });
    expect(t.importados).toHaveLength(1);
    expect(t.resultados[t.importados[0]]).toHaveLength(3);
    expect(t.eventos[0].circuit).toBe('TLM');
  });

  it('quita la prueba importada dos veces en la misma edición con el mismo ganador', () => {
    const comun = { edicionId: 'se-tlm', fuente: 'rfee_pdf', categoria: 'VET', categoriaRaw: '+60', ciudad: null };
    const t = componerTramo({
      ...TRAMO,
      calendario: [],
      cruces: [],
      importadas: [
        fila({ ...comun, id: 'sc-a', ganador: 'RODRIGUEZ\u001fESP' }),
        fila({ ...comun, id: 'sc-b', ganador: 'RODRIGUEZ\u001fESP' }),
        fila({ ...comun, id: 'sc-c', ganador: 'VILLADONIGA\u001fESP' }),
        fila({ ...comun, id: 'sc-d', categoriaRaw: '+50', ganador: 'RODRIGUEZ\u001fESP' }),
      ],
    });
    expect(t.resultados[t.importados[0]].map((p) => p.id).sort()).toEqual(['sc-a', 'sc-c', 'sc-d']);
  });

  it('no pinta los huecos que la FIE reserva para la temporada siguiente con fechas de la anterior', () => {
    const fie = { fuente: 'fie', ciudad: 'TBD', edicion: 'Championnats Panaméricains Cadets' };
    const marcador = fila({ ...fie, id: 'sc-hueco', temporada: '2027', fecha: '2026-02-26', inicio: '2026-02-26' });
    const real = fila({ ...fie, id: 'sc-real', edicionId: 'se-real', temporada: '2026', fecha: '2026-02-26', inicio: '2026-02-26' });
    const t = componerTramo({ desde: '2026-02-01', hasta: '2026-02-28', calendario: [], cruces: [], importadas: [marcador, real] });
    expect(Object.values(t.resultados).flat().map((p) => p.id)).toEqual(['sc-real']);

    expect(esMarcadorFie({ fuente: 'fie', temporada: '2027', fecha: '2026-08-01' })).toBe(false);
    expect(esMarcadorFie({ fuente: 'fie', temporada: '2027', fecha: '2026-07-31' })).toBe(true);
    expect(esMarcadorFie({ fuente: 'fie', temporada: '2027', fecha: null, inicio: null })).toBe(true);
    expect(esMarcadorFie({ fuente: 'skermo_rfee', temporada: '2026-2027', fecha: '2020-01-01' })).toBe(false);
  });

  it('agrupa por edición lo que es un torneo, sin huecos de la FIE ni copias', () => {
    const cruces = [
      fila({ id: 'sc-eq', edicionId: 'se-b', fuente: 'fie', temporada: '2026', formato: 'EQUIPOS', inicio: '2026-03-02' }),
      fila({ id: 'sc-ind', edicionId: 'se-a', fuente: 'fie', temporada: '2026', inicio: '2026-03-01' }),
      fila({ id: 'sc-ind', edicionId: 'se-a', fuente: 'fie', temporada: '2026', inicio: '2026-03-01' }),
      fila({ id: 'sc-hueco', edicionId: 'se-c', fuente: 'fie', temporada: '2027', fecha: '2026-03-01' }),
    ];
    const ediciones = edicionesDeCruces(cruces);
    expect(ediciones.map((e) => [e.edicionId, e.pruebas.map((p) => p.id)])).toEqual([
      ['se-a', ['sc-ind']],
      ['se-b', ['sc-eq']],
    ]);
  });

  it('un torneo del calendario sin nada en Explorar lleva la lista vacía, no se queda sin entrada', () => {
    const cal = evento({});
    const t = componerTramo({ ...TRAMO, calendario: [cal], cruces: [], importadas: [] });
    expect(t.resultados[cal.id]).toEqual([]);
  });

  it('descarta armas o géneros que el calendario no sabe pintar', () => {
    const rara = fila({ id: 'x', arma: 'OTRA' });
    const t = componerTramo({ ...TRAMO, calendario: [], cruces: [], importadas: [rara] });
    expect(t.eventos).toEqual([]);
  });
});

describe('nombres, enlaces y tramos', () => {
  it('el nombre base quita lo que cambia entre las pruebas de una misma edición', () => {
    expect(baseDeNombre('TNR M20 M20')).toBe(baseDeNombre('TNR M20_equipos'));
    expect(baseDeNombre('Coupe du Monde par équipes')).toBe(baseDeNombre('Coupe du Monde'));
    expect(baseDeNombre('TNR M-20 (1/2)')).toBe('tnr m20');
  });

  it('enlaza la página de la FIE y no su API', () => {
    expect(urlPublica('https://fie.org/api/fie/competition/2019/1010')).toBe(
      'https://fie.org/competitions/2019/1010',
    );
    expect(urlPublica('https://app.skermo.org/ranking/public/RFEE/competition/8609')).toBe(
      'https://app.skermo.org/ranking/public/RFEE/competition/8609',
    );
    expect(urlPublica(null)).toBeNull();
  });

  it('nombra la prueba con la concordancia de la espada y el tramo de edad de veteranos', () => {
    const base = aPruebaPasada(fila({ arma: 'ESPADA', genero: 'F', categoria: 'VET', categoriaRaw: '+50' }));
    expect(nombreDePruebaPasada(base)).toBe('Espada femenina · Veteranos +50');
    expect(nombreDePruebaPasada({ ...base, arma: 'FLORETE', genero: 'M', categoriaRaw: 'TORNEOLIGAMASTER' })).toBe(
      'Florete masculino · Veteranos',
    );
    expect(nombreDePruebaPasada({ ...base, categoria: 'M17', categoriaRaw: '+50', formato: 'EQUIPOS' })).toBe(
      'Espada femenina · M17 · equipos',
    );
  });

  it('el tramo pasado acaba ayer y no existe si todo es de hoy en adelante', () => {
    const trimestre = tramoDeMeses(2026, 9, 3);
    expect(trimestre).toEqual({ desde: '2026-10-01', hasta: '2026-12-31' });
    expect(tramoPasadoDe(trimestre.desde, trimestre.hasta, '2026-10-05')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-04',
    });
    expect(tramoPasadoDe('2026-11-01', '2026-11-30', '2026-10-05')).toBeNull();
    const septiembre = tramoDeMeses(2026, 8, 1);
    expect(tramoPasadoDe(septiembre.desde, septiembre.hasta, '2026-10-05')).toEqual(septiembre);
  });

  it('lee un mes escrito en el buscador, y nada que no sea solo una fecha', () => {
    expect(leerSaltoDeMes('2019', 2026)).toEqual({ anio: 2019, mes: 0 });
    expect(leerSaltoDeMes('marzo 2019', 2026)).toEqual({ anio: 2019, mes: 2 });
    expect(leerSaltoDeMes('Septiembre de 2017', 2026)).toEqual({ anio: 2017, mes: 8 });
    expect(leerSaltoDeMes('sep 2017', 2026)).toEqual({ anio: 2017, mes: 8 });
    expect(leerSaltoDeMes('03/2019', 2026)).toEqual({ anio: 2019, mes: 2 });
    expect(leerSaltoDeMes('2019-11', 2026)).toEqual({ anio: 2019, mes: 10 });
    expect(leerSaltoDeMes('Copa 2019', 2026)).toBeNull();
    expect(leerSaltoDeMes('3000', 2026)).toBeNull();
    expect(leerSaltoDeMes('madrid', 2026)).toBeNull();
  });
});
