/**
 * Criterios del sistema oficial de LA 2028 (COI/FIE, versión del 17 de
 * septiembre de 2026; resumen en docs/clasificacion-olimpica-la2028.md):
 * zonas, límite por CON, equipos y sus tiradores, recuentos por prueba y los
 * casos con nombre que se revisaron (Choupenitch, Ranvier, Marino, Llavador,
 * Borodachev).
 *
 * El último bloque usa la copia de producción si se pasa `PERF_DB`; sin ella
 * se omite.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REGLAS_LA2028,
  anotarRankingOlimpico,
  calcularClasificacionOlimpica,
  colorOlimpico,
  type AnotacionesPrueba,
  type ArmaOlimpica,
  type EntradaPrueba,
  type FilaEquipoFie,
  type FilaIndividualFie,
  type GeneroOlimpico,
} from '@/lib/ranking/olimpica';

const PLAZAS_INDIVIDUALES = 34; // B.3: 24 de los 8 equipos + 10 individuales.
const PLAZAS_TORNEO_ZONAL = 4; // D.2: una por zona, se decide en abril de 2028.
const PLAZAS_CALCULABLES = PLAZAS_INDIVIDUALES - PLAZAS_TORNEO_ZONAL;

function equipos(nocs: string[], base = 400, paso = 12): FilaEquipoFie[] {
  return nocs.map((noc, i) => ({ noc, posicion: i + 1, puntos: base - i * paso }));
}

/** Ranking individual por rondas: primero el mejor de cada CON, luego el segundo… */
function porRondas(nocs: string[], rondas: number, base = 300): FilaIndividualFie[] {
  const filas: FilaIndividualFie[] = [];
  for (let r = 0; r < rondas; r++) {
    for (const noc of nocs) {
      const i = filas.length;
      filas.push({ fieId: 5000 + i, nombre: `${noc} ${r + 1}`, noc, posicion: i + 1, puntos: base - i });
    }
  }
  return filas;
}

const contar = (a: Record<string, Parameters<typeof colorOlimpico>[0]>) => {
  const c = { verde: 0, amarillo: 0, gris: 0 };
  for (const x of Object.values(a)) {
    const k = colorOlimpico(x);
    if (k) c[k]++;
  }
  return c;
};

// Una prueba completa: 26 equipos de las cuatro zonas (RUS 2.º) y 35 CON con 4 tiradores.
const EQUIPOS_PRUEBA = [
  'ITA', 'RUS', 'FRA', 'HUN', 'JPN',
  'KOR', 'POL', 'USA', 'CHN', 'GER', 'UKR', 'CAN', 'ESP', 'SUI', 'HKG', 'ISR', 'BRA', 'KAZ', 'EGY',
  'ARG', 'TUR', 'VEN', 'ALG', 'AUS', 'MEX', 'TUN', 'RSA',
];
const NOCS_PRUEBA = [
  'ITA', 'FRA', 'RUS', 'HUN', 'JPN', 'CZE', 'KOR', 'POL', 'USA', 'CHN', 'GER', 'UKR', 'CAN', 'ESP',
  'SUI', 'HKG', 'ISR', 'BRA', 'KAZ', 'EGY', 'ARG', 'TUR', 'VEN', 'ALG', 'AUS', 'MEX', 'TUN', 'RSA',
  'BLR', 'SEN', 'CHI', 'GRE', 'IRI', 'NZL', 'FIE',
];

function prueba(arma: ArmaOlimpica = 'FLORETE', genero: GeneroOlimpico = 'M'): EntradaPrueba {
  return {
    arma,
    genero,
    fechaRanking: '2026-10-01T06:00:00.000Z',
    equipos: equipos(EQUIPOS_PRUEBA),
    individual: porRondas(NOCS_PRUEBA, 4),
  };
}

const nombreDe = (e: EntradaPrueba, fieId: string) => e.individual.find((f) => String(f.fieId) === fieId)?.nombre;

describe('recuentos por prueba = plazas oficiales (B.3, D.1, D.2)', () => {
  const e = prueba();
  const r = calcularClasificacionOlimpica(e);
  const a = anotarRankingOlimpico(e);

  it('8 equipos: 4 primeros + mejor de cada zona entre el 5.º y el 24.º', () => {
    expect(r.equipos).toHaveLength(REGLAS_LA2028.equiposPorPrueba);
    expect(r.equipos.map((x) => `${x.noc}:${x.via}`)).toEqual([
      'ITA:TOP', 'FRA:TOP', 'HUN:TOP', 'JPN:TOP',
      'KOR:ZONA', 'POL:ZONA', 'USA:ZONA', 'EGY:ZONA',
    ]);
    expect(contar(a.equipos).verde).toBe(8);
  });

  it('30 verdes individuales: 24 por equipo + 2 por el AOR + 4 por el AOR por zona (los 4 del torneo zonal no se calculan)', () => {
    expect(r.porEquipo.flatMap((p) => p.tiradores)).toHaveLength(24);
    expect(r.aorMundial).toHaveLength(2);
    expect(Object.values(r.aorZona).filter(Boolean)).toHaveLength(4);
    expect(r.plazasTorneoZonal).toBe(PLAZAS_TORNEO_ZONAL);
    expect(contar(a.individual).verde).toBe(PLAZAS_CALCULABLES);
    const caminos = Object.values(a.individual).filter((x) => x.estado === 'clasificado').map((x) => x.camino);
    expect(caminos.filter((c) => c === 'POR_EQUIPO')).toHaveLength(24);
    expect(caminos.filter((c) => c === 'AOR')).toHaveLength(2);
    expect(caminos.filter((c) => c === 'AOR_ZONA')).toHaveLength(4);
  });

  it('amarillos: solo el primer reserva de cada camino (y los tiradores de los equipos reserva)', () => {
    // Equipos reserva: CHN (Asia-Oceanía), GER (Europa), CAN (América), ALG (África).
    const eqAmarillos = Object.entries(a.equipos).filter(([, x]) => x.estado === 'cerca').map(([n]) => n).sort();
    expect(eqAmarillos).toEqual(['ALG', 'CAN', 'CHN', 'GER']);
    const ind = Object.entries(a.individual).filter(([, x]) => x.estado === 'cerca');
    const porCamino = (c: string) => ind.filter(([, x]) => x.camino === c).map(([k]) => nombreDe(e, k)).sort();
    // Reservas individuales: el siguiente de cada zona en el AOR.
    expect(porCamino('AOR_ZONA')).toEqual(['BRA 1', 'KAZ 1', 'TUN 1', 'UKR 1']);
    // El 2.º y 3.º de cada equipo reserva (el 1.º ya tiene plaza individual).
    expect(porCamino('POR_EQUIPO')).toEqual(['ALG 2', 'ALG 3', 'CAN 2', 'CAN 3', 'CHN 2', 'CHN 3', 'GER 2', 'GER 3']);
    expect(ind).toHaveLength(12);
  });

  it('gris solo para RUS y BLR; los neutrales («FIE») sin marca', () => {
    for (const [k, x] of Object.entries(a.individual)) {
      const noc = e.individual.find((f) => String(f.fieId) === k)?.noc;
      if (colorOlimpico(x) === 'gris') expect(['RUS', 'BLR']).toContain(noc);
      if (noc === 'FIE') expect(colorOlimpico(x)).toBeNull();
    }
    expect(colorOlimpico(a.equipos.RUS)).toBe('gris');
    expect(contar(a.individual).gris).toBeGreaterThan(0);
  });
});

describe('límite por CON (B.2, D.2)', () => {
  const pruebas = (['FLORETE', 'ESPADA', 'SABLE'] as const).map((arma) => prueba(arma, 'F'));

  it('máximo 3 por arma; con equipo, exactamente 3; sin equipo, como mucho 1', () => {
    for (const e of pruebas) {
      const r = calcularClasificacionOlimpica(e);
      const conEquipo = new Set(r.equipos.map((x) => x.noc));
      for (const [noc, n] of Object.entries(r.plazasPorNoc)) {
        expect(n).toBeLessThanOrEqual(REGLAS_LA2028.maximoPorNocYArma);
        expect(n).toBe(conEquipo.has(noc) ? 3 : 1);
      }
      // Las marcas verdes dicen lo mismo, CON a CON.
      const a = anotarRankingOlimpico(e);
      const verdes = new Map<string, number>();
      for (const f of e.individual) {
        if (colorOlimpico(a.individual[String(f.fieId)]) === 'verde') verdes.set(f.noc!, (verdes.get(f.noc!) ?? 0) + 1);
      }
      expect(Object.fromEntries(verdes)).toEqual(r.plazasPorNoc);
    }
  });

  it('nunca más de 9 tiradores por género (3 armas × 3)', () => {
    const total = new Map<string, number>();
    for (const e of pruebas) {
      for (const [noc, n] of Object.entries(calcularClasificacionOlimpica(e).plazasPorNoc)) total.set(noc, (total.get(noc) ?? 0) + n);
    }
    for (const n of total.values()) expect(n).toBeLessThanOrEqual(9);
    expect(total.get('ITA')).toBe(9);
  });

  it('el AOR mundial no da dos plazas al mismo CON aunque tenga los dos mejores', () => {
    const e = prueba();
    // Dos checos delante de todos los que no tienen equipo.
    e.individual = [
      { fieId: 1, nombre: 'CZE A', noc: 'CZE', posicion: 1, puntos: 999 },
      { fieId: 2, nombre: 'CZE B', noc: 'CZE', posicion: 2, puntos: 998 },
      ...e.individual.map((f) => ({ ...f, posicion: (f.posicion ?? 0) + 2 })),
    ];
    const r = calcularClasificacionOlimpica(e);
    expect(r.aorMundial.map((t) => t.nombre)).toEqual(['CZE A', 'CHN 1']);
    expect(r.plazasPorNoc.CZE).toBe(1);
    expect(anotarRankingOlimpico(e).individual['2']).toBeUndefined();
  });
});

describe('equipos y sus individuales (D.2, primer párrafo)', () => {
  const e = prueba();
  const r = calcularClasificacionOlimpica(e);
  const a = anotarRankingOlimpico(e);
  const marca = (nombre: string) => a.individual[String(e.individual.find((f) => f.nombre === nombre)!.fieId)];

  it('los tres mejor clasificados de cada CON con equipo van al individual; el cuarto, a nada', () => {
    expect(r.porEquipo.find((p) => p.noc === 'ITA')?.tiradores.map((t) => t.nombre)).toEqual(['ITA 1', 'ITA 2', 'ITA 3']);
    for (const n of ['ITA 1', 'ITA 2', 'ITA 3']) expect(marca(n)).toMatchObject({ estado: 'clasificado', camino: 'POR_EQUIPO' });
    expect(marca('ITA 4')).toBeUndefined();
  });

  it('ningún tirador de un CON con equipo entra en el AOR', () => {
    const conEquipo = new Set(r.equipos.map((x) => x.noc));
    for (const t of [...r.aorMundial, ...Object.values(r.aorZona)]) expect(conEquipo.has(t!.noc)).toBe(false);
  });

  it('el tirador clasificado por su equipo hereda el puesto y el margen del equipo', () => {
    expect(marca('KOR 1')).toMatchObject({ camino: 'POR_EQUIPO', puesto: a.equipos.KOR.puesto, margen: a.equipos.KOR.margen });
  });
});

describe('zonas (D.1 y D.2): una plaza por zona, con la zona de la confederación', () => {
  const base = (individual: [string, string][]): EntradaPrueba => ({
    arma: 'ESPADA',
    genero: 'M',
    fechaRanking: null,
    equipos: equipos(EQUIPOS_PRUEBA),
    individual: individual.map(([noc, nombre], i) => ({ fieId: 100 + i, nombre, noc, posicion: i + 1, puntos: 200 - i * 4 })),
  });

  it('Israel y Turquía son Europa; Kazajistán y Australia, Asia-Oceanía', () => {
    const r = calcularClasificacionOlimpica(base([
      ['CZE', 'A'], ['NED', 'B'], // AOR mundial
      ['ISR', 'C'], ['KAZ', 'D'], ['TUR', 'E'], ['AUS', 'F'], ['MEX', 'G'], ['SEN', 'H'],
    ]));
    expect(r.aorZona.EUROPA?.noc).toBe('ISR');
    expect(r.aorZona.ASIA_OCEANIA?.noc).toBe('KAZ');
    expect(r.primerFuera.aorZona.EUROPA?.noc).toBe('TUR');
    expect(r.primerFuera.aorZona.ASIA_OCEANIA?.noc).toBe('AUS');
    expect(r.aorZona.AMERICA?.noc).toBe('MEX');
    expect(r.aorZona.AFRICA?.noc).toBe('SEN');
  });

  it('si los dos del AOR mundial son europeos, la plaza de Europa es para el siguiente CON europeo', () => {
    const r = calcularClasificacionOlimpica(base([
      ['CZE', 'A'], ['NED', 'B'], ['CZE', 'A2'], ['BEL', 'C'], ['MEX', 'G'], ['SEN', 'H'], ['AUS', 'F'],
    ]));
    expect(r.aorMundial.map((t) => t.noc)).toEqual(['CZE', 'NED']);
    expect(r.aorZona.EUROPA?.noc).toBe('BEL');
  });

  it('una zona sin tiradores elegibles deja su plaza sin calcular y sin reserva', () => {
    const e = base([['CZE', 'A'], ['NED', 'B'], ['BEL', 'C'], ['MEX', 'G'], ['AUS', 'F']]);
    const r = calcularClasificacionOlimpica(e);
    expect(r.aorZona.AFRICA).toBeNull();
    expect(Object.values(anotarRankingOlimpico(e).individual).filter((x) => x.zona === 'AFRICA' && x.estado)).toEqual([]);
  });

  it('equipos: el mejor de cada zona entre el 5.º y el 24.º, aunque su zona ya tenga uno en el top 4', () => {
    // USA (América) entre los 4 primeros: la plaza de América sigue siendo para el mejor americano del tramo.
    const lista = ['ITA', 'USA', 'FRA', 'HUN', 'KOR', 'POL', 'CHN', 'CAN', 'EGY', 'GER'];
    const r = calcularClasificacionOlimpica({ ...base([]), equipos: equipos(lista) });
    expect(r.equipos.find((x) => x.plazaDeZona === 'AMERICA')?.noc).toBe('CAN');
    expect(r.equipos).toHaveLength(8);
  });

  it('equipos: una zona sin nadie en el tramo cede su plaza al siguiente del ranking, sea de donde sea', () => {
    const lista = ['ITA', 'FRA', 'HUN', 'JPN', 'KOR', 'POL', 'USA', 'CHN', 'GER'];
    const r = calcularClasificacionOlimpica({ ...base([]), equipos: equipos(lista) });
    expect(r.zonasSinEquipo).toEqual(['AFRICA']);
    expect(r.equipos.find((x) => x.via === 'SIGUIENTE')).toMatchObject({ noc: 'CHN', plazaDeZona: 'AFRICA' });
  });
});

describe('«cerca» = primer reserva y a no más de un tercio de los puntos del rival', () => {
  it('un reserva a más de un tercio no es amarillo', () => {
    // Europa: ISR 200 entra; TUR (reserva) a 70 (35 %) no es «cerca».
    const e: EntradaPrueba = {
      arma: 'SABLE',
      genero: 'F',
      fechaRanking: null,
      equipos: equipos(EQUIPOS_PRUEBA),
      individual: [
        { fieId: 1, nombre: 'A', noc: 'CZE', posicion: 1, puntos: 400 },
        { fieId: 2, nombre: 'B', noc: 'NED', posicion: 2, puntos: 390 },
        { fieId: 3, nombre: 'C', noc: 'ISR', posicion: 3, puntos: 200 },
        { fieId: 4, nombre: 'D', noc: 'TUR', posicion: 4, puntos: 130 },
      ],
    };
    expect(anotarRankingOlimpico(e).individual['4']).toMatchObject({ estado: null, camino: 'TORNEO_ZONAL' });
    e.individual = e.individual.map((f) => (f.fieId === 4 ? { ...f, puntos: 140 } : f));
    expect(anotarRankingOlimpico(e).individual['4']).toMatchObject({ estado: 'cerca', camino: 'AOR_ZONA', faltan: 60 });
  });
});

// Situaciones de los tiradores revisados, con su ranking reducido a lo que decide.
describe('casos revisados', () => {
  it('Choupenitch (CZE, florete): 1.º del ranking y la República Checa sin equipo → verde por el AOR', () => {
    const e = prueba('FLORETE', 'M');
    e.individual = [{ fieId: 1, nombre: 'CHOUPENITCH Alexander', noc: 'CZE', posicion: 1, puntos: 999 }, ...e.individual.filter((f) => f.noc !== 'CZE')];
    expect(anotarRankingOlimpico(e).individual['1']).toMatchObject({ estado: 'clasificado', camino: 'AOR' });
  });

  it('Ranvier (FRA, florete): entre las tres mejores francesas y Francia en el top 4 → verde con su equipo', () => {
    const e = prueba('FLORETE', 'F');
    e.individual = [...e.individual.filter((f) => f.nombre !== 'FRA 3'), { fieId: 1, nombre: 'RANVIER Pauline', noc: 'FRA', posicion: 90, puntos: 100 }];
    const a = anotarRankingOlimpico(e);
    expect(a.individual['1']).toMatchObject({ estado: 'clasificado', camino: 'POR_EQUIPO' });
    // La cuarta francesa no: el CON elige a tres.
    expect(a.individual[String(e.individual.find((f) => f.nombre === 'FRA 4')!.fieId)]).toBeUndefined();
  });

  it('Marino (ESP, florete): España mejor europeo entre el 5.º y el 24.º → verde con su equipo', () => {
    const e = prueba('FLORETE', 'F');
    e.equipos = equipos(['ITA', 'USA', 'JPN', 'FRA', 'ESP', 'CAN', 'HUN', 'KOR', 'POL', 'EGY']);
    e.individual = [...e.individual, { fieId: 1, nombre: 'MARINO Maria', noc: 'ESP', posicion: 30, puntos: 280 }];
    const a = anotarRankingOlimpico(e);
    expect(a.equipos.ESP).toMatchObject({ estado: 'clasificado', camino: 'EQUIPO_ZONA', zona: 'EUROPA' });
    expect(a.individual['1']).toMatchObject({ estado: 'clasificado', camino: 'POR_EQUIPO' });
  });

  it('Llavador (ESP, florete): España sin equipo y primer europeo tras el que entra por zona → amarillo', () => {
    // Europa: el polaco entra con 89,5; Llavador, el siguiente europeo, a 21 (23 %).
    const e: EntradaPrueba = {
      arma: 'FLORETE',
      genero: 'M',
      fechaRanking: null,
      equipos: equipos(['ITA', 'HKG', 'USA', 'JPN', 'FRA', 'CHN', 'TPE', 'EGY', 'KOR', 'ESP', 'POL', 'GER', 'GBR', 'CAN']),
      individual: [
        { fieId: 1, nombre: 'CHOUPENITCH Alexander', noc: 'CZE', posicion: 1, puntos: 227 },
        { fieId: 2, nombre: 'DOSA Daniel', noc: 'HUN', posicion: 11, puntos: 120 },
        { fieId: 3, nombre: 'RZADKOWSKI Andrzej', noc: 'POL', posicion: 17, puntos: 89.5 },
        { fieId: 4, nombre: 'LLAVADOR Carlos', noc: 'ESP', posicion: 25, puntos: 68.5 },
        { fieId: 5, nombre: 'COOK Jaimie', noc: 'GBR', posicion: 27, puntos: 62 },
      ],
    };
    const a = anotarRankingOlimpico(e);
    expect(a.individual['3']).toMatchObject({ estado: 'clasificado', camino: 'AOR_ZONA', zona: 'EUROPA' });
    expect(a.individual['4']).toMatchObject({ estado: 'cerca', camino: 'AOR_ZONA', zona: 'EUROPA', faltan: 21 });
    expect(a.individual['5']).toMatchObject({ estado: null, camino: 'TORNEO_ZONAL' });
  });

  it('Borodachev (RUS, florete): entraría por el AOR si Rusia contara → gris', () => {
    const e = prueba('FLORETE', 'M');
    e.individual = [{ fieId: 1, nombre: 'BORODACHEV Kirill', noc: 'RUS', posicion: 1, puntos: 999 }, ...e.individual.filter((f) => f.noc !== 'RUS')];
    e.equipos = e.equipos.filter((x) => x.noc !== 'RUS');
    const x = anotarRankingOlimpico(e).individual['1'];
    expect(x).toMatchObject({ estado: 'pendiente', motivo: 'PARTICIPACION_SIN_DECIDIR', sinVeto: { estado: 'clasificado', camino: 'AOR' } });
    expect(colorOlimpico(x)).toBe('gris');
  });
});

// --- Copia de producción ------------------------------------------------------
const BASE = process.env.PERF_DB;
const conBase = Boolean(BASE && existsSync(BASE));

async function leerPrueba(arma: ArmaOlimpica, genero: GeneroOlimpico): Promise<EntradaPrueba> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(BASE!, { readOnly: true });
  try {
    const temporada = db.prepare(`SELECT max(season) AS s FROM (
        SELECT season FROM fie_clasificacion WHERE category = 'ABS' AND weapon = ? AND gender = ? AND position IS NOT NULL
        GROUP BY season HAVING count(DISTINCT CASE WHEN format = 'EQUIPOS' THEN 'E' ELSE 'I' END) = 2)`).get(arma, genero) as { s: number };
    const filas = db.prepare(`SELECT format, fie_id, position, points, source_name, country_code FROM fie_clasificacion
      WHERE season = ? AND category = 'ABS' AND weapon = ? AND gender = ? AND position IS NOT NULL ORDER BY position`)
      .all(temporada.s, arma, genero) as { format: string; fie_id: number; position: number; points: string | null; source_name: string | null; country_code: string | null }[];
    return {
      arma,
      genero,
      fechaRanking: null,
      equipos: filas.filter((f) => f.format === 'EQUIPOS').map((f) => ({ noc: f.country_code, posicion: f.position, puntos: Number(f.points) })),
      individual: filas.filter((f) => f.format !== 'EQUIPOS').map((f) => ({ fieId: f.fie_id, nombre: f.source_name ?? '', noc: f.country_code, posicion: f.position, puntos: Number(f.points) })),
    };
  } finally {
    db.close();
  }
}

describe.skipIf(!conBase)('copia de producción (PERF_DB)', () => {
  const PRUEBAS: [ArmaOlimpica, GeneroOlimpico][] = [
    ['FLORETE', 'M'], ['FLORETE', 'F'], ['ESPADA', 'M'], ['ESPADA', 'F'], ['SABLE', 'M'], ['SABLE', 'F'],
  ];

  it.each(PRUEBAS)('%s %s: 8 equipos y 30 tiradores en verde, pocos amarillos, gris solo RUS/BLR', async (arma, genero) => {
    const e = await leerPrueba(arma, genero);
    const a: AnotacionesPrueba = anotarRankingOlimpico(e);
    expect(contar(a.equipos).verde).toBe(8);
    const c = contar(a.individual);
    expect(c.verde).toBe(PLAZAS_CALCULABLES);
    expect(c.amarillo).toBeLessThanOrEqual(12);
    const nocDe = new Map(e.individual.map((f) => [String(f.fieId), f.noc]));
    for (const [k, x] of Object.entries(a.individual)) {
      if (colorOlimpico(x) === 'gris') expect(['RUS', 'BLR']).toContain(nocDe.get(k));
    }
  });

  it('Choupenitch, Ranvier y Marino en verde; Llavador en amarillo; Borodachev en gris', async () => {
    const fm = await leerPrueba('FLORETE', 'M');
    const ff = await leerPrueba('FLORETE', 'F');
    const am = anotarRankingOlimpico(fm);
    const af = anotarRankingOlimpico(ff);
    const de = (e: EntradaPrueba, a: AnotacionesPrueba, prefijo: string) => {
      const f = e.individual.find((x) => x.nombre.toUpperCase().startsWith(prefijo));
      expect(f, prefijo).toBeDefined();
      return a.individual[String(f!.fieId)];
    };
    expect(de(fm, am, 'CHOUPENITCH')).toMatchObject({ estado: 'clasificado', camino: 'AOR' });
    expect(de(ff, af, 'RANVIER PAULINE')).toMatchObject({ estado: 'clasificado', camino: 'POR_EQUIPO' });
    expect(de(ff, af, 'MARINO MARIA')).toMatchObject({ estado: 'clasificado', camino: 'POR_EQUIPO' });
    expect(de(fm, am, 'LLAVADOR CARLOS')).toMatchObject({ estado: 'cerca', camino: 'AOR_ZONA', zona: 'EUROPA' });
    expect(colorOlimpico(de(fm, am, 'BORODACHEV KIRILL'))).toBe('gris');
  });
});
