import { describe, expect, it } from 'vitest';
import {
  anotarRankingOlimpico,
  calcularClasificacionOlimpica,
  ordenarSoloJjoo,
  type EntradaPrueba,
  type FilaEquipoFie,
  type FilaIndividualFie,
} from '@/lib/ranking/olimpica';

function equipos(nocs: string[], base = 400): FilaEquipoFie[] {
  return nocs.map((noc, i) => ({ noc, posicion: i + 1, puntos: base - i * 10 }));
}

function individual(filas: [string, string][], base = 250): FilaIndividualFie[] {
  return filas.map(([noc, nombre], i) => ({
    fieId: 1000 + i,
    nombre,
    noc,
    posicion: i + 1,
    puntos: base - i * 5,
  }));
}

const EQUIPOS_BASE = [
  'ITA', 'FRA', 'USA', 'JPN',
  'HUN', 'KOR', 'CHN', 'EGY', 'POL', 'ESP',
  'SUI', 'CAN', 'UKR', 'ISR', 'KAZ', 'GER', 'VEN', 'HKG', 'EST', 'BRA',
  'TUR', 'ARG', 'AUS', 'MEX', 'ALG', 'COL',
];

const INDIVIDUAL_BASE: [string, string][] = [
  ['ITA', 'SANTARELLI Andrea'], // 1000
  ['FRA', 'BOREL Yannick'], // 1001
  ['UKR', 'REIZLIN Roman'], // 1002
  ['SUI', 'HEINZER Max'], // 1003
  ['UKR', 'NIKISHYN Bohdan'], // 1004
  ['ISR', 'FREILICH Yuval'], // 1005
  ['KAZ', 'ALEXANIN Dmitriy'], // 1006
  ['GER', 'HEINE Lukas'], // 1007
  ['VEN', 'LIMARDO Ruben'], // 1008
  ['HKG', 'NG Ho Tin'], // 1009
  ['ALG', 'MEHDI Salim'], // 1010
  ['ESP', 'GARCIA Pablo'], // 1011
  ['TUN', 'BEN Ali'], // 1012
  ['ARG', 'PEREZ Juan'], // 1013
];

const id = (nombre: string) => String(1000 + INDIVIDUAL_BASE.findIndex(([, n]) => n === nombre));

function entrada(parcial: Partial<EntradaPrueba> = {}): EntradaPrueba {
  return {
    arma: 'ESPADA',
    genero: 'M',
    fechaRanking: '2026-10-01T06:00:00.000Z',
    equipos: equipos(EQUIPOS_BASE),
    individual: individual(INDIVIDUAL_BASE),
    ...parcial,
  };
}

describe('anotarRankingOlimpico: selecciones', () => {
  const a = anotarRankingOlimpico(entrada());

  it('clasificados con su camino y su margen sobre el primero fuera', () => {
    expect(a.equipos.ITA).toMatchObject({ estado: 'clasificado', camino: 'EQUIPO_TOP', margen: 40 });
    expect(a.equipos.ITA.sobre?.noc).toBe('HUN');
    expect(a.equipos.HUN).toMatchObject({ estado: 'clasificado', camino: 'EQUIPO_ZONA', zona: 'EUROPA', margen: 40 });
    expect(a.equipos.HUN.sobre?.noc).toBe('POL');
    expect(a.fechaRanking).toBe('2026-10-01T06:00:00.000Z');
  });

  it('«cerca»: solo el primer reserva de cada camino, por el camino más corto, con rival, puntos y margen', () => {
    // CHN: primero fuera del top 4 (a 30 de JPN) y reserva de Asia-Oceanía (a 10 de KOR).
    expect(a.equipos.CHN).toMatchObject({
      estado: 'cerca',
      camino: 'EQUIPO_ZONA',
      zona: 'ASIA_OCEANIA',
      faltan: 10,
      puestoFuera: 1,
      margen: 80,
    });
    expect(a.equipos.CHN.contra?.noc).toBe('KOR');
    expect(a.equipos.CHN.sobre?.noc).toBe('KAZ');
    // Reservas de Europa y América.
    expect(a.equipos.POL).toMatchObject({ estado: 'cerca', camino: 'EQUIPO_ZONA', zona: 'EUROPA', faltan: 40, puestoFuera: 1 });
    expect(a.equipos.VEN).toMatchObject({ estado: 'cerca', camino: 'EQUIPO_ZONA', zona: 'AMERICA', faltan: 50 });
    // ESP y SUI son el 2.º y 3.º europeos fuera: no heredarían la plaza.
    expect(a.equipos.ESP).toBeUndefined();
    expect(a.equipos.SUI).toBeUndefined();
    // ALG es el reserva de África, pero a 170 de EGY (330): más de un tercio.
    expect(a.equipos.ALG).toBeUndefined();
    const amarillos = Object.values(a.equipos).filter((x) => x.estado === 'cerca').length;
    expect(amarillos).toBe(3);
  });

  it('`cercanos` y `faltaMaxima` son configurables', () => {
    const b = anotarRankingOlimpico(entrada(), { cercanos: 3 });
    expect(b.equipos.ESP).toMatchObject({ estado: 'cerca', camino: 'EQUIPO_ZONA', faltan: 50, puestoFuera: 2, margen: 10 });
    expect(b.equipos.SUI).toMatchObject({ estado: 'cerca', camino: 'EQUIPO_ZONA', puestoFuera: 3 });
    expect(b.equipos.ALG).toBeUndefined();
    const c = anotarRankingOlimpico(entrada(), { faltaMaxima: 1 });
    expect(c.equipos.ALG).toMatchObject({ estado: 'cerca', camino: 'EQUIPO_ZONA', zona: 'AFRICA', faltan: 170 });
    expect(c.equipos.ESP).toBeUndefined();
  });

  it('anfitrión fuera de los cercanos: queda como «cerca» por la vía del anfitrión', () => {
    const lista = [...EQUIPOS_BASE.filter((n) => n !== 'USA'), 'USA'];
    const b = anotarRankingOlimpico(entrada({ equipos: equipos(lista) }));
    expect(b.equipos.USA).toMatchObject({ estado: 'cerca', camino: 'ANFITRION', faltan: null });
  });
});

describe('anotarRankingOlimpico: individual', () => {
  const a = anotarRankingOlimpico(entrada());

  it('por equipo, top 2 y mejor de zona como clasificados', () => {
    expect(a.individual[id('SANTARELLI Andrea')]).toMatchObject({ estado: 'clasificado', camino: 'POR_EQUIPO' });
    expect(a.individual[id('REIZLIN Roman')]).toMatchObject({ estado: 'clasificado', camino: 'AOR', margen: 15 });
    expect(a.individual[id('FREILICH Yuval')]).toMatchObject({ estado: 'clasificado', camino: 'AOR_ZONA', zona: 'EUROPA' });
  });

  it('un segundo tirador de un CON con plaza no tiene camino', () => {
    expect(a.individual[id('NIKISHYN Bohdan')]).toBeUndefined();
  });

  it('«cerca» individual: rival, puntos y margen sobre el siguiente', () => {
    expect(a.individual[id('HEINE Lukas')]).toMatchObject({
      estado: 'cerca',
      camino: 'AOR_ZONA',
      faltan: 10,
      margen: 20,
      puestoFuera: 1,
    });
    expect(a.individual[id('HEINE Lukas')].contra?.nombre).toBe('FREILICH Yuval');
    expect(a.individual[id('HEINE Lukas')].sobre?.nombre).toBe('GARCIA Pablo');
    // Reservas de Asia-Oceanía, África y América.
    expect(a.individual[id('NG Ho Tin')]).toMatchObject({ camino: 'AOR_ZONA', zona: 'ASIA_OCEANIA', faltan: 15 });
    expect(a.individual[id('BEN Ali')]).toMatchObject({ camino: 'AOR_ZONA', zona: 'AFRICA', faltan: 10 });
    expect(a.individual[id('PEREZ Juan')]).toMatchObject({ camino: 'AOR_ZONA', zona: 'AMERICA', faltan: 25 });
    // GARCIA es el 2.º europeo fuera (tras HEINE): le queda el torneo zonal.
    expect(a.individual[id('GARCIA Pablo')]).toMatchObject({ estado: null, camino: 'TORNEO_ZONAL', zona: 'EUROPA' });
  });

  it('sin camino cercano, le queda el torneo zonal (sin diferencia)', () => {
    const b = anotarRankingOlimpico(
      entrada({ individual: individual([...INDIVIDUAL_BASE, ['NZL', 'KIWI Uno']]) }),
      { cercanos: 1 },
    );
    expect(b.individual['1014']).toMatchObject({ estado: null, camino: 'TORNEO_ZONAL', zona: 'ASIA_OCEANIA', faltan: null });
  });

  it('por su equipo cuando es el camino más corto', () => {
    // Sin POL, España es el reserva de Europa a 5 puntos de HUN; su tirador no es reserva de nada.
    const lista = equipos(EQUIPOS_BASE)
      .filter((e) => e.noc !== 'POL')
      .map((e) => (e.noc === 'ESP' ? { ...e, puntos: 355 } : e));
    const b = anotarRankingOlimpico(entrada({ equipos: lista }));
    expect(b.equipos.ESP).toMatchObject({ estado: 'cerca', faltan: 5 });
    expect(b.individual[id('GARCIA Pablo')]).toMatchObject({ estado: 'cerca', camino: 'POR_EQUIPO', faltan: 5 });
  });
});

describe('RUS, BLR y neutrales: se ven pero no ocupan plaza', () => {
  const lista = ['ITA', 'RUS', ...EQUIPOS_BASE.slice(1)];
  const filas = individual([
    ['RUS', 'RUSO Uno'], // 1000
    ['FIE', 'NEUTRAL Uno'], // 1001
    ...INDIVIDUAL_BASE,
    ['BLR', 'CERCANO Uno'], // 1016
  ]);
  // Empatado en puesto con GER (10.º, 205) y con más puntos: sería el reserva de Europa.
  filas[16] = { ...filas[16], posicion: 10, puntos: 207 };
  const ent = entrada({ equipos: equipos(lista), individual: filas });
  const a = anotarRankingOlimpico(ent);

  it('se calculan sin ellos', () => {
    const r = calcularClasificacionOlimpica(ent);
    expect(r.equipos.map((e) => e.noc)).not.toContain('RUS');
    expect(r.equipos.slice(0, 4).map((e) => e.noc)).toEqual(['ITA', 'FRA', 'USA', 'JPN']);
    expect(r.aorMundial.map((t) => t.noc)).toEqual(['UKR', 'SUI']);
  });

  it('sus filas quedan «pendiente» con el motivo y lo que tendrían si contaran', () => {
    expect(a.equipos.RUS).toMatchObject({
      estado: 'pendiente',
      motivo: 'PARTICIPACION_SIN_DECIDIR',
      sinVeto: { estado: 'clasificado', camino: 'EQUIPO_TOP' },
    });
    // Con su equipo dentro, el ruso iría por equipo.
    expect(a.individual['1000']).toMatchObject({
      estado: 'pendiente',
      sinVeto: { estado: 'clasificado', camino: 'POR_EQUIPO' },
    });
    expect(a.individual['1001']).toMatchObject({ estado: 'pendiente', motivo: 'NEUTRAL', sinVeto: null });
    // El bielorruso sería el primer europeo fuera: «cerca» si contara.
    expect(a.individual['1016']).toMatchObject({
      estado: 'pendiente',
      sinVeto: { estado: 'cerca', camino: 'AOR_ZONA' },
    });
  });
});

describe('ordenarSoloJjoo', () => {
  it('verdes por puesto, amarillos por probabilidad, grises con opción al final', () => {
    const lista = ['ITA', 'RUS', ...EQUIPOS_BASE.slice(1)];
    const filasInd = individual([...INDIVIDUAL_BASE, ['RUS', 'RUSO Uno']]);
    // El ruso, con 50 puntos más que nadie, entraría si contara.
    filasInd[filasInd.length - 1] = { ...filasInd[filasInd.length - 1], posicion: 1, puntos: 300 };
    const a = anotarRankingOlimpico(entrada({ equipos: equipos(lista), individual: filasInd }));

    const orden = ordenarSoloJjoo(filasInd, (f) => ({
      anotacion: a.individual[String(f.fieId)],
      posicion: f.posicion,
    })).map((f) => f.nombre);

    expect(orden).toEqual([
      'SANTARELLI Andrea',
      'BOREL Yannick',
      'REIZLIN Roman',
      'HEINZER Max',
      'FREILICH Yuval',
      'ALEXANIN Dmitriy',
      'LIMARDO Ruben',
      'MEHDI Salim',
      // cerca: GER 10 y TUN 10 empatan; GER tiene mejor puesto.
      'HEINE Lukas',
      'BEN Ali',
      'NG Ho Tin',
      'PEREZ Juan',
      // GARCIA (2.º europeo fuera) no sale.
      // pendiente que entraría.
      'RUSO Uno',
    ]);
  });

  it('los «cerca» sin diferencia medible van detrás de los que sí la tienen', () => {
    const filas = [
      { n: 'a', posicion: 1, anotacion: { estado: 'cerca', faltan: null } },
      { n: 'b', posicion: 9, anotacion: { estado: 'cerca', faltan: 3 } },
      { n: 'c', posicion: 5, anotacion: { estado: null, faltan: null } },
    ] as const;
    const orden = ordenarSoloJjoo(filas, (f) => ({
      anotacion: { ...anotarVacia(), ...f.anotacion },
      posicion: f.posicion,
    })).map((f) => f.n);
    expect(orden).toEqual(['b', 'a']);
  });
});

function anotarVacia() {
  return {
    estado: null,
    camino: null,
    zona: null,
    contra: null,
    faltan: null,
    margen: null,
    sobre: null,
    puestoFuera: null,
    motivo: null,
    sinVeto: null,
  };
}
