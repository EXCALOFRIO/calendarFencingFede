import { describe, expect, it } from 'vitest';
import {
  REGLAS_LA2028,
  calcularClasificacionOlimpica,
  calcularClasificacionesOlimpicas,
  zonaDe,
  type EntradaPrueba,
  type FilaEquipoFie,
  type FilaIndividualFie,
} from '@/lib/ranking/olimpica';

/** Ranking por equipos: un CON por puesto, puntos bajando de 10 en 10. */
function equipos(nocs: string[], base = 400): FilaEquipoFie[] {
  return nocs.map((noc, i) => ({ noc, posicion: i + 1, puntos: base - i * 10 }));
}

/** Ranking individual: [CON, nombre], puntos bajando de 5 en 5. */
function individual(filas: [string, string][], base = 250): FilaIndividualFie[] {
  return filas.map(([noc, nombre], i) => ({
    fieId: 1000 + i,
    nombre,
    noc,
    posicion: i + 1,
    puntos: base - i * 5,
  }));
}

function entrada(parcial: Partial<EntradaPrueba>): EntradaPrueba {
  return {
    arma: 'ESPADA',
    genero: 'M',
    fechaRanking: '2026-09-28T10:00:00.000Z',
    equipos: [],
    individual: [],
    ...parcial,
  };
}

// Espada masculina realista: el anfitrión (USA) ya está entre los 4 primeros.
const EQUIPOS_BASE = [
  'ITA', 'FRA', 'USA', 'JPN', // 1–4
  'HUN', 'KOR', 'CHN', 'EGY', 'POL', 'ESP', // 5–10
  'SUI', 'CAN', 'UKR', 'ISR', 'KAZ', 'GER', 'VEN', 'HKG', 'EST', 'BRA', // 11–20
  'TUR', 'ARG', 'AUS', 'MEX', 'ALG', 'COL', // 21–26
];

const INDIVIDUAL_BASE: [string, string][] = [
  ['ITA', 'SANTARELLI Andrea'],
  ['FRA', 'BOREL Yannick'],
  ['UKR', 'REIZLIN Roman'], // 3: sin equipo → AOR
  ['SUI', 'HEINZER Max'], // 4: sin equipo → AOR
  ['UKR', 'NIKISHYN Bohdan'], // mismo CON otra vez: no cuenta
  ['ISR', 'FREILICH Yuval'], // Europa
  ['KAZ', 'ALEXANIN Dmitriy'], // Asia-Oceanía
  ['GER', 'HEINE Lukas'],
  ['VEN', 'LIMARDO Ruben'], // América
  ['HKG', 'NG Ho Tin'],
  ['ALG', 'MEHDI Salim'], // África
  ['ESP', 'GARCIA Pablo'], // España sin equipo
  ['TUN', 'BEN Ali'], // África, segundo
  ['ARG', 'PEREZ Juan'], // América, segundo
];

describe('equipos (D.1)', () => {
  it('cuatro primeros + mejor de cada zona entre el 5.º y el 24.º', () => {
    const r = calcularClasificacionOlimpica(
      entrada({ equipos: equipos(EQUIPOS_BASE), individual: individual(INDIVIDUAL_BASE) }),
    );

    expect(r.equipos.map((e) => [e.noc, e.via, e.plazaDeZona])).toEqual([
      ['ITA', 'TOP', null],
      ['FRA', 'TOP', null],
      ['USA', 'TOP', null],
      ['JPN', 'TOP', null],
      ['HUN', 'ZONA', 'EUROPA'],
      ['KOR', 'ZONA', 'ASIA_OCEANIA'],
      ['EGY', 'ZONA', 'AFRICA'],
      ['CAN', 'ZONA', 'AMERICA'],
    ]);
    expect(r.equipos).toHaveLength(REGLAS_LA2028.equiposPorPrueba);
    expect(r.zonasSinEquipo).toEqual([]);
    expect(r.anfitrion).toEqual({ noc: 'USA', conEquipo: true, individuales: 3 });
  });

  it('primer fuera de los cuatro primeros y de cada zona, con la diferencia en puntos', () => {
    const r = calcularClasificacionOlimpica(entrada({ equipos: equipos(EQUIPOS_BASE) }));
    // 5.º HUN 360 contra 4.º JPN 370.
    expect(r.primerFuera.equiposTop).toMatchObject({ noc: 'HUN', diferencia: 10, empate: false });
    expect(r.primerFuera.equiposTop?.contra.noc).toBe('JPN');
    // Europa: el siguiente europeo tras HUN es POL (9.º, 320) contra HUN (360).
    expect(r.primerFuera.equiposZona.EUROPA).toMatchObject({ noc: 'POL', diferencia: 40 });
    expect(r.primerFuera.equiposZona.AMERICA).toMatchObject({ noc: 'VEN' });
    // El mejor equipo sin plaza es CHN (7.º, 340): adelantar a KOR (350,
    // mejor de Asia-Oceanía) le cuesta menos que al 4.º (JPN, 370).
    expect(r.primerFuera.equipos).toMatchObject({ noc: 'CHN', diferencia: 10 });
    expect(r.primerFuera.equipos?.contra.noc).toBe('KOR');
  });

  it('una zona sin equipo en el tramo cede su plaza al siguiente del ranking', () => {
    // EGY baja al 30.º y ALG sale: ningún africano entre el 5.º y el 24.º.
    const sinAfrica = EQUIPOS_BASE.filter((n) => n !== 'EGY' && n !== 'ALG');
    const lista = [...sinAfrica, 'NZL', 'PER', 'IRL', 'EGY'];
    const r = calcularClasificacionOlimpica(entrada({ equipos: equipos(lista) }));

    expect(r.zonasSinEquipo).toEqual(['AFRICA']);
    const heredero = r.equipos.find((e) => e.via === 'SIGUIENTE');
    expect(heredero).toMatchObject({ noc: 'CHN', plazaDeZona: 'AFRICA' });
    expect(r.equipos).toHaveLength(8);
    // EGY tendría que entrar entre los 24 primeros.
    expect(r.primerFuera.equiposZona.AFRICA).toMatchObject({ noc: 'EGY' });
    expect(r.primerFuera.equiposZona.AFRICA?.contra.posicion).toBe(24);
  });

  it('el anfitrión fuera del ranking no tiene equipo y se informa', () => {
    const sinUsa = EQUIPOS_BASE.filter((n) => n !== 'USA');
    const r = calcularClasificacionOlimpica(entrada({ equipos: equipos([...sinUsa, 'USA']) }));
    expect(r.anfitrion.conEquipo).toBe(false);
    expect(r.equipos.map((e) => e.noc)).not.toContain('USA');
  });

  it('empate en el 4.º puesto: manda el orden publicado y se marca el empate', () => {
    const lista = equipos(EQUIPOS_BASE);
    lista[4] = { ...lista[4], posicion: 4, puntos: lista[3].puntos ?? 0 };
    const r = calcularClasificacionOlimpica(entrada({ equipos: lista }));
    expect(r.equipos.slice(0, 4).map((e) => e.noc)).toEqual(['ITA', 'FRA', 'USA', 'JPN']);
    expect(r.primerFuera.equiposTop).toMatchObject({ noc: 'HUN', diferencia: 0, empate: true });
  });

  it('ignora filas sin puesto, sin país o de CON no elegibles', () => {
    const lista: FilaEquipoFie[] = [
      { noc: 'RUS', posicion: 1, puntos: 999 },
      { noc: null, posicion: 2, puntos: 900 },
      { noc: 'BRA', posicion: null, puntos: 800 },
      ...equipos(EQUIPOS_BASE).map((e) => ({ ...e, posicion: (e.posicion ?? 0) + 3 })),
    ];
    const r = calcularClasificacionOlimpica(entrada({ equipos: lista }), {
      nocsNoElegibles: ['RUS', 'FIE'],
    });
    expect(r.equipos[0].noc).toBe('ITA');
    expect(r.equipos.map((e) => e.noc)).not.toContain('RUS');
  });
});

describe('individual (D.2)', () => {
  const r = calcularClasificacionOlimpica(
    entrada({ equipos: equipos(EQUIPOS_BASE), individual: individual(INDIVIDUAL_BASE) }),
  );

  it('los CON con equipo no entran en el AOR; los dos mejores restantes van por el mundial', () => {
    expect(r.aorMundial.map((t) => t.noc)).toEqual(['UKR', 'SUI']);
    expect(r.aorMundial.every((t) => t.via === 'AOR')).toBe(true);
  });

  it('un mismo CON dos veces en la lista de su zona solo cuenta una', () => {
    const europa = r.aorZona.EUROPA;
    expect(europa).toMatchObject({ noc: 'ISR', via: 'AOR_ZONA', zonaPlaza: 'EUROPA' });
    // El segundo ucraniano (5.º) no puede ser el siguiente europeo.
    expect(r.primerFuera.aorZona.EUROPA?.noc).toBe('GER');
  });

  it('una plaza por zona y el siguiente con su diferencia', () => {
    expect(r.aorZona.ASIA_OCEANIA?.noc).toBe('KAZ');
    expect(r.aorZona.AMERICA?.noc).toBe('VEN');
    expect(r.aorZona.AFRICA?.noc).toBe('ALG');
    // ALG 200 (11.º) frente a TUN 190 (13.º).
    expect(r.primerFuera.aorZona.AFRICA).toMatchObject({ noc: 'TUN', diferencia: 10 });
    expect(r.primerFuera.aorZona.AMERICA).toMatchObject({ noc: 'ARG' });
    // Tercero del AOR (ISR) contra el segundo (SUI): 225 frente a 235.
    expect(r.primerFuera.aorMundial).toMatchObject({ noc: 'ISR', diferencia: 10 });
  });

  it('nadie pasa de 3 por arma y los CON sin equipo tienen como mucho 1', () => {
    for (const [noc, n] of Object.entries(r.plazasPorNoc)) {
      expect(n).toBeLessThanOrEqual(REGLAS_LA2028.maximoPorNocYArma);
      if (!r.equipos.some((e) => e.noc === noc)) expect(n).toBe(1);
    }
    expect(r.porEquipo.find((p) => p.noc === 'ITA')?.tiradores.map((t) => t.nombre)).toEqual([
      'SANTARELLI Andrea',
    ]);
    expect(r.plazasTorneoZonal).toBe(4);
  });

  it('una zona sin tiradores elegibles deja la plaza vacía', () => {
    const sinAfrica = INDIVIDUAL_BASE.filter(([n]) => n !== 'ALG' && n !== 'TUN');
    const s = calcularClasificacionOlimpica(
      entrada({ equipos: equipos(EQUIPOS_BASE), individual: individual(sinAfrica) }),
    );
    expect(s.aorZona.AFRICA).toBeNull();
    expect(s.primerFuera.aorZona.AFRICA).toBeNull();
  });

  it('los neutrales («FIE») no ocupan plaza por defecto', () => {
    const s = calcularClasificacionOlimpica(
      entrada({
        equipos: equipos(EQUIPOS_BASE),
        individual: individual([['FIE', 'NEUTRAL Uno'], ...INDIVIDUAL_BASE]),
      }),
    );
    expect(s.aorMundial.map((t) => t.noc)).toEqual(['UKR', 'SUI']);
  });
});

describe('estado de España', () => {
  it('sin equipo dentro: distancia por el camino más corto y su mejor tirador', () => {
    const r = calcularClasificacionOlimpica(
      entrada({ equipos: equipos(EQUIPOS_BASE), individual: individual(INDIVIDUAL_BASE) }),
    );
    const esp = r.seguidos.ESP;
    expect(esp.equipo).toBeNull();
    expect(esp.equipoRanking?.posicion).toBe(10);
    // ESP 310; 4.º JPN 370 (60), HUN 360 (50): el camino corto es la zona.
    expect(esp.distanciaEquipo).toMatchObject({ camino: 'EQUIPO_ZONA', diferencia: 50 });
    expect(esp.mejorAor?.nombre).toBe('GARCIA Pablo');
    // GARCIA 195 frente a ISR 225 (Europa) y SUI 235 (mundial).
    expect(esp.distanciaIndividual).toMatchObject({ camino: 'AOR_ZONA', diferencia: 30 });
    expect(esp.tiradores).toBe(0);
  });

  it('con equipo dentro: tres tiradores y sin distancias', () => {
    const lista = ['ESP', ...EQUIPOS_BASE.filter((n) => n !== 'ESP')];
    const r = calcularClasificacionOlimpica(entrada({ equipos: equipos(lista) }));
    expect(r.seguidos.ESP).toMatchObject({ tiradores: 3, distanciaEquipo: null });
    expect(r.seguidos.ESP.equipo?.via).toBe('TOP');
  });
});

describe('varias pruebas y zonas', () => {
  it('ordena florete, espada, sable con el femenino primero', () => {
    const r = calcularClasificacionesOlimpicas([
      entrada({ arma: 'SABLE', genero: 'M' }),
      entrada({ arma: 'FLORETE', genero: 'M' }),
      entrada({ arma: 'FLORETE', genero: 'F' }),
    ]);
    expect(r.map((x) => `${x.arma}-${x.genero}`)).toEqual(['FLORETE-F', 'FLORETE-M', 'SABLE-M']);
  });

  it('todos los países del ranking FIE guardado tienen zona salvo los neutrales', () => {
    const delRanking =
      'ALG,ANG,ANT,ARG,ARM,AUS,AUT,AZE,BAN,BEL,BEN,BER,BLR,BOL,BOT,BRA,BRN,BRU,BUL,BUR,CAM,CAN,CHI,CHN,CIV,CMR,COD,COL,CPV,CRC,CRO,CUB,CYP,CZE,DEN,DOM,ECU,EGY,ESA,ESP,EST,FIN,FRA,GBR,GEO,GER,GHA,GRE,GUA,GUI,HAI,HKG,HON,HUN,INA,IND,IRI,IRL,IRQ,ISL,ISR,ISV,ITA,JAM,JOR,JPN,KAZ,KEN,KGZ,KOR,KSA,KUW,LAT,LBA,LBN,LTU,LUX,MAC,MAR,MAS,MDA,MEX,MGL,MKD,MLI,MLT,MNE,MRI,NAM,NCA,NED,NEP,NGR,NIG,NOR,NZL,OMA,PAK,PAN,PAR,PER,PHI,POL,POR,PUR,QAT,ROU,RSA,RUS,RWA,SEN,SGP,SLE,SLO,SRB,SRI,SUI,SVK,SWE,SYR,THA,TJK,TKM,TOG,TPE,TUN,TUR,UAE,UGA,UKR,URU,USA,UZB,VEN,VIE'.split(
        ',',
      );
    expect(delRanking.filter((c) => zonaDe(c) === null)).toEqual([]);
    expect(zonaDe('FIE')).toBeNull();
    expect(zonaDe('ISR')).toBe('EUROPA');
    expect(zonaDe('KAZ')).toBe('ASIA_OCEANIA');
    expect(zonaDe('AUS')).toBe('ASIA_OCEANIA');
    expect(zonaDe('USA')).toBe('AMERICA');
  });
});
