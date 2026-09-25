import { describe, expect, it } from 'vitest';
import { claveCiudad, mismaCiudad, normalizarTexto } from '../src/lib/ingest/ciudades';
import { refineCircuitByName } from '../src/lib/ingest/mappers';

/**
 * CIUDADES Y CIRCUITOS: LOS CASOS SON REALES.
 *
 * Todos los nombres de esta prueba están sacados de la base tal y como los
 * publican las fuentes hoy (214 eventos de `skermo_rfee`, 60 de `fie`). No hay
 * ni un caso inventado: si mañana Skermo cambia «DUBLÍN» por otra cosa, esta
 * prueba tiene que enterarse.
 */

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

describe('normalizarTexto deja el nombre comparable', () => {
  it('quita acentos, baja a minúsculas y colapsa espacios', () => {
    expect(normalizarTexto('  NÚREMBERG  ')).toBe('nuremberg');
    expect(normalizarTexto('SOFÍA')).toBe('sofia');
    expect(normalizarTexto('RÍO  DE   JANEIRO')).toBe('rio de janeiro');
    expect(normalizarTexto('Šamorín')).toBe('samorin');
  });

  it('los guiones y los puntos hacen de espacio', () => {
    expect(normalizarTexto('CLUJ-NAPOCA')).toBe('cluj napoca');
    expect(normalizarTexto("Sant Cugat del Vallès")).toBe('sant cugat del valles');
  });
});

// ---------------------------------------------------------------------------
// Los pares que hoy fallan en la base
// ---------------------------------------------------------------------------

describe('los exónimos españoles casan con el nombre de la FIE', () => {
  /**
   * Cada fila es un par REAL: a la izquierda lo que publica Skermo, a la
   * derecha lo que publica la FIE para el mismo torneo. Cruzando por ciudad
   * literal solo casaban 12; estos son los que se perdían.
   */
  const pares: [string, string][] = [
    ['DUBLÍN', 'Dublin'],
    ['NÚREMBERG', 'Nuremberg'],
    ['GANTE', 'Gand'],
    ['ESTAMBUL', 'Istanbul'],
    ['BELGRADO', 'Belgrade'],
    ['SOFÍA', 'Sofia'],
    ['ÁMSTERDAM', 'Amsterdam'],
    ['SAO PAULO', 'Sao Paulo'],
    ['SAN SALVADOR', 'San Salvador'],
    ['BOGOTÁ', 'Bogota'],
    ['SAMSUN', 'Samsun'],
    ['SAMORIN', 'Samorin'],
    ['TASHKENT', 'Tashkent'],
    ['REYKJAVIK', 'Reykjavik'],
    ['SPLIT', 'Split'],
    ['BARI', 'Bari'],
    ['BANGKOK', 'Bangkok'],
  ];

  for (const [skermo, fie] of pares) {
    it(`«${skermo}» (Skermo) y «${fie}» (FIE) son la misma plaza`, () => {
      expect(claveCiudad(skermo)).toBe(claveCiudad(fie));
      expect(mismaCiudad(skermo, fie)).toBe(true);
    });
  }

  it('también las plazas que aún no han salido pero saldrán', () => {
    expect(mismaCiudad('NUEVA YORK', 'New York')).toBe(true);
    expect(mismaCiudad('LONDRES', 'London')).toBe(true);
    expect(mismaCiudad('GINEBRA', 'Genève')).toBe(true);
    expect(mismaCiudad('AMBERES', 'Antwerpen')).toBe(true);
    expect(mismaCiudad('TURÍN', 'Torino')).toBe(true);
    expect(mismaCiudad('MILÁN', 'Milano')).toBe(true);
    expect(mismaCiudad('COPENHAGUE', 'Copenhagen')).toBe(true);
    expect(mismaCiudad('VARSOVIA', 'Warsaw')).toBe(true);
    expect(mismaCiudad('PRAGA', 'Prague')).toBe(true);
    expect(mismaCiudad('MOSCÚ', 'Moscow')).toBe(true);
    expect(mismaCiudad('ATENAS', 'Athens')).toBe(true);
    expect(mismaCiudad('BUCAREST', 'Bucharest')).toBe(true);
    expect(mismaCiudad('LISBOA', 'Lisbon')).toBe(true);
    expect(mismaCiudad('EL CAIRO', 'Cairo')).toBe(true);
    expect(mismaCiudad('ARGEL', 'Algiers')).toBe(true);
    expect(mismaCiudad('BAKÚ', 'Baku')).toBe(true);
    expect(mismaCiudad('TIFLIS', 'Tbilisi')).toBe(true);
    expect(mismaCiudad('SEÚL', 'Seoul')).toBe(true);
    expect(mismaCiudad('TOKIO', 'Tokyo')).toBe(true);
    expect(mismaCiudad('PEKÍN', 'Beijing')).toBe(true);
    expect(mismaCiudad('LA HAYA', 'The Hague')).toBe(true);
    expect(mismaCiudad('BRUSELAS', 'Brussels')).toBe(true);
    expect(mismaCiudad('MÚNICH', 'Munich')).toBe(true);
    expect(mismaCiudad('COLONIA', 'Köln')).toBe(true);
    expect(mismaCiudad('FRÁNCFORT', 'Frankfurt')).toBe(true);
    expect(mismaCiudad('BASILEA', 'Basel')).toBe(true);
    expect(mismaCiudad('ZÚRICH', 'Zurich')).toBe(true);
    expect(mismaCiudad('LAUSANA', 'Lausanne')).toBe(true);
    expect(mismaCiudad('ESTOCOLMO', 'Stockholm')).toBe(true);
    expect(mismaCiudad('GOTEMBURGO', 'Gothenburg')).toBe(true);
    expect(mismaCiudad('TALLIN', 'Tallinn')).toBe(true);
    expect(mismaCiudad('BURDEOS', 'Bordeaux')).toBe(true);
    expect(mismaCiudad('MARSELLA', 'Marseille')).toBe(true);
    expect(mismaCiudad('NIZA', 'Nice')).toBe(true);
    expect(mismaCiudad('PARÍS', 'Paris')).toBe(true);
    expect(mismaCiudad('ESTRASBURGO', 'Strasbourg')).toBe(true);
    expect(mismaCiudad('TESALÓNICA', 'Thessaloniki')).toBe(true);
  });

  it('la errata de la propia fuente no rompe el emparejado', () => {
    // Las dos formas conviven hoy en la base, escritas por Skermo.
    expect(mismaCiudad('ESPLUES DE LLOBREGAT', 'ESPLUGUES DE LLOBREGAT')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lo que NUNCA puede casar
// ---------------------------------------------------------------------------

describe('sin sede no se empareja: ante la duda, no unir', () => {
  it('«TBD» no es una ciudad', () => {
    // La FIE tiene hoy 35 filas con la sede a «TBD». Si casaran entre sí, se
    // fundirían 35 torneos distintos en uno.
    expect(claveCiudad('TBD')).toBeNull();
    expect(mismaCiudad('TBD', 'TBD')).toBe(false);
    expect(mismaCiudad('TBD', 'Dublin')).toBe(false);
  });

  it('null, cadena vacía y espacios tampoco', () => {
    expect(claveCiudad(null)).toBeNull();
    expect(claveCiudad(undefined)).toBeNull();
    expect(claveCiudad('')).toBeNull();
    expect(claveCiudad('   ')).toBeNull();
    expect(mismaCiudad(null, null)).toBe(false);
    expect(mismaCiudad(null, 'Gand')).toBe(false);
  });

  it('dos ciudades distintas siguen siendo distintas', () => {
    expect(mismaCiudad('BUDAPEST', 'BUCAREST')).toBe(false);
    expect(mismaCiudad('SOFÍA', 'SPLIT')).toBe(false);
    expect(mismaCiudad('SAN JOSÉ', 'SAN SALVADOR')).toBe(false);
    expect(mismaCiudad('NOVI SAD', 'NUEVA YORK')).toBe(false);
    // Homónimos reales del calendario: Samsun (Turquía) y Samorin (Eslovaquia).
    expect(mismaCiudad('SAMSUN', 'SAMORIN')).toBe(false);
  });

  it('una ciudad desconocida se queda con su propio nombre normalizado', () => {
    // No se fuerza a null ni se aproxima a la entrada más parecida: eso es lo
    // que produciría un falso positivo.
    expect(claveCiudad('DAUGAVPILS')).toBe('daugavpils');
    expect(claveCiudad('Xiongan')).toBe('xiongan');
  });
});

// ---------------------------------------------------------------------------
// Circuito a partir del nombre
// ---------------------------------------------------------------------------

describe('el circuito se afina con el nombre que publica la fuente', () => {
  /**
   * Los nombres son los que hay hoy en `skermo_rfee`, agrupados. El circuito
   * de la izquierda es el que traían antes, con el que una Copa del Mundo
   * absoluta, un Gran Premio y un satélite se veían exactamente igual.
   */
  const casos: [string, string, string][] = [
    ['CPTO EUROPA CADETE', 'FIE_CIRCUITO', 'CTO_EUROPA'],
    ['CPTO EUROPA JÚNIOR', 'FIE_CIRCUITO', 'CTO_EUROPA'],
    ['CPTO EUROPA SUB23', 'SUB23_EFC', 'CTO_EUROPA'],
    ['CPTO MUNDO', 'FIE_CIRCUITO', 'CTO_MUNDO'],
    ['CPTO MUNDO JÚNIOR', 'FIE_CIRCUITO', 'CTO_MUNDO'],
    ['GRAND PRIX', 'FIE_CIRCUITO', 'SEN_GP'],
    ['TORNEO SATÉLITE', 'FIE_CIRCUITO', 'SATELITE'],
    ['COPA MUNDO CADETE', 'FIE_CIRCUITO', 'CAD_WC'],
    ['COPA MUNDO JÚNIOR', 'FIE_CIRCUITO', 'JUN_WC'],
    ['COPA MUNDO', 'FIE_CIRCUITO', 'SEN_WC'],
    ['LIGA NACIONAL ORO 1ª JORNADA', 'LIGA_CLUBES', 'LIGA_ORO'],
    ['LIGA NACIONAL PLATA 1ª JORNADA', 'LIGA_CLUBES', 'LIGA_PLATA'],
    ['LIGA NACIONAL IBERDROLA 1ª JORNADA', 'LIGA_CLUBES', 'LIGA_IBERDROLA'],
    ['LIGA NACIONAL BRONCE 1ªJORNADA', 'LIGA_CLUBES', 'LIGA_BRONCE'],
    // `ECC` es el Circuito Europeo CADETE. Esta es la Copa de Europa de
    // clubes, que no tiene nada que ver.
    ['COPA EUROPA CLUBES', 'ECC', 'EUR_CLUBES'],
  ];

  for (const [nombre, antes, despues] of casos) {
    it(`«${nombre}»: ${antes} -> ${despues}`, () => {
      expect(refineCircuitByName(nombre, antes as never)).toBe(despues);
    });
  }

  it('la cadete no se lleva el circuito de la absoluta', () => {
    // El orden de las reglas importa: «COPA MUNDO CADETE» contiene
    // «COPA MUNDO».
    expect(refineCircuitByName('COPA MUNDO CADETE', 'FIE_CIRCUITO')).not.toBe('SEN_WC');
    expect(refineCircuitByName('COPA MUNDO JÚNIOR', 'FIE_CIRCUITO')).not.toBe('SEN_WC');
    // Y un campeonato del mundo júnior no es una Copa del Mundo júnior.
    expect(refineCircuitByName('CPTO MUNDO JÚNIOR', 'FIE_CIRCUITO')).toBe('CTO_MUNDO');
  });

  it('lo que no encaja en ninguna regla se queda EXACTAMENTE como estaba', () => {
    // «JUEGOS EUROPEOS» no tiene código propio: no se adivina uno.
    expect(refineCircuitByName('JUEGOS EUROPEOS', 'FIE_CIRCUITO')).toBe('FIE_CIRCUITO');
    expect(refineCircuitByName('TNR ABS', 'TNR')).toBe('TNR');
    expect(refineCircuitByName('CONCENTRACIÓN PFCAR SABLE ESPAÑOLAS', 'CONCENTRACION')).toBe(
      'CONCENTRACION',
    );
    expect(refineCircuitByName('CIRCUITO EUROPEO M-14', 'U14_EFC')).toBe('U14_EFC');
    expect(refineCircuitByName('EUROFENCE LEAGUE', 'EFC_LEAGUE')).toBe('EFC_LEAGUE');
    expect(refineCircuitByName(null, 'OTRO')).toBe('OTRO');
    expect(refineCircuitByName('', 'TNR')).toBe('TNR');
  });

  it('no inventa un Campeonato de España que la RFEE no ha publicado', () => {
    // Hoy no hay ni una sola prueba `CTO_ESPANA` en la base. La regla existe,
    // pero solo dispara si el nombre lo dice; nada la deduce.
    expect(refineCircuitByName('TNR ABS', 'TNR')).not.toBe('CTO_ESPANA');
    expect(refineCircuitByName('COPA MUNDO', 'FIE_CIRCUITO')).not.toBe('CTO_ESPANA');
  });
});
