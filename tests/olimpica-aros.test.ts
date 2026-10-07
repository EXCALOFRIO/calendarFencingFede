import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnotacionesPrueba } from '@/lib/ranking/olimpica';

const busqueda = { valor: new URLSearchParams() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/ranking',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => busqueda.valor,
}));

const anotaciones = vi.hoisted(() => ({ porPrueba: {} as Record<string, AnotacionesPrueba | null>, llamadas: [] as string[] }));
vi.mock('@/lib/queries/olimpica', () => ({
  getAnotacionesOlimpicas: vi.fn(async (arma: string, genero: string) => {
    anotaciones.llamadas.push(`${arma}|${genero}`);
    return anotaciones.porPrueba[`${arma}|${genero}`] ?? null;
  }),
}));

const { anotarRankingOlimpico, colorOlimpico, ordenarSoloJjoo } = await import('@/lib/ranking/olimpica');
const { leerOlimpicaPerfil, leerOlimpicaPersonas } = await import('@/lib/sport/explorar/olimpica-perfil');
const { chipsRanking } = await import('@/lib/sport/explorar/chips-ranking');
const { FilasRanking } = await import('@/components/explorar/ficha-deportiva');
const { TablaRankingFie } = await import('@/components/ranking/tabla-fie');
const { MarcaOlimpicaPersona } = await import('@/components/olimpica/burbuja-olimpica');

type Entrada = Parameters<typeof anotarRankingOlimpico>[0];
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

// El ejemplo de las reglas (docs/clasificacion-olimpica-la2028.md): top 4,
// mejor de cada zona entre el 5.º y el 24.º, 2 del AOR y 1 por zona.
const EQUIPOS = [
  'ITA', 'FRA', 'USA', 'JPN',
  'HUN', 'KOR', 'CHN', 'EGY', 'POL', 'ESP',
  'SUI', 'CAN', 'UKR', 'ISR', 'KAZ', 'GER', 'VEN', 'HKG', 'EST', 'BRA',
  'TUR', 'ARG', 'AUS', 'MEX', 'ALG', 'COL',
];
const INDIVIDUAL: [string, string][] = [
  ['ITA', 'SANTARELLI Andrea'], ['FRA', 'BOREL Yannick'], ['UKR', 'REIZLIN Roman'], ['SUI', 'HEINZER Max'],
  ['UKR', 'NIKISHYN Bohdan'], ['ISR', 'FREILICH Yuval'], ['KAZ', 'ALEXANIN Dmitriy'], ['GER', 'HEINE Lukas'],
  ['VEN', 'LIMARDO Ruben'], ['HKG', 'NG Ho Tin'], ['ALG', 'MEHDI Salim'], ['ESP', 'GARCIA Pablo'],
  ['TUN', 'BEN Ali'], ['ARG', 'PEREZ Juan'],
];
const id = (nombre: string) => String(1000 + INDIVIDUAL.findIndex(([, n]) => n === nombre));
const FECHA = '2026-10-01T06:00:00.000Z';

function entrada(parcial: Partial<Entrada> = {}): Entrada {
  return {
    arma: 'ESPADA',
    genero: 'M',
    fechaRanking: FECHA,
    equipos: EQUIPOS.map((noc, i) => ({ noc, posicion: i + 1, puntos: 400 - i * 10 })),
    individual: INDIVIDUAL.map(([noc, nombre], i) => ({ fieId: 1000 + i, nombre, noc, posicion: i + 1, puntos: 250 - i * 5 })),
    ...parcial,
  };
}

describe('colorOlimpico: tres colores para los estados de anotar.ts', () => {
  const a = anotarRankingOlimpico(entrada({
    equipos: ['ITA', 'RUS', ...EQUIPOS.slice(1)].map((noc, i) => ({ noc, posicion: i + 1, puntos: 400 - i * 10 })),
    individual: [
      ...entrada().individual,
      { fieId: 2000, nombre: 'NEUTRAL Uno', noc: 'FIE', posicion: 40, puntos: 10 },
      // Un europeo más por delante: el bielorruso sería el 4.º fuera y no tendría opción.
      { fieId: 2003, nombre: 'EST Uno', noc: 'EST', posicion: 80, puntos: 2 },
      { fieId: 2001, nombre: 'LEJANO Uno', noc: 'BLR', posicion: 90, puntos: 1 },
    ],
  }));

  it('clasificado → verde; cerca (también anfitrión) → amarillo', () => {
    expect(colorOlimpico(a.equipos.ITA)).toBe('verde');
    expect(colorOlimpico(a.individual[id('SANTARELLI Andrea')])).toBe('verde');
    expect(colorOlimpico(a.equipos.POL)).toBe('amarillo');
    expect(colorOlimpico({ ...a.equipos.POL, camino: 'ANFITRION', faltan: null })).toBe('amarillo');
  });

  it('RUS/BLR con opción → gris; sin opción y neutrales → nada; torneo zonal → nada', () => {
    expect(a.equipos.RUS.estado).toBe('pendiente');
    expect(colorOlimpico(a.equipos.RUS)).toBe('gris');
    expect(a.individual['2000']).toMatchObject({ estado: 'pendiente', motivo: 'NEUTRAL', sinVeto: null });
    expect(colorOlimpico(a.individual['2000'])).toBeNull();
    expect(a.individual['2001']).toMatchObject({ estado: 'pendiente', sinVeto: null });
    expect(colorOlimpico(a.individual['2001'])).toBeNull();
    const zonal = anotarRankingOlimpico(entrada({
      individual: [...entrada().individual, { fieId: 2002, nombre: 'KIWI Uno', noc: 'NZL', posicion: 95, puntos: 0.5 }],
    }), { cercanos: 1 }).individual['2002'];
    expect(zonal).toMatchObject({ estado: null, camino: 'TORNEO_ZONAL' });
    expect(colorOlimpico(zonal)).toBeNull();
    expect(colorOlimpico(undefined)).toBeNull();
  });

  it('las etiquetas con color son justo las filas que deja «Solo JJOO»', () => {
    const filas = Object.entries(a.individual).map(([k, v]) => ({ k, v }));
    const conColor = filas.filter((f) => colorOlimpico(f.v)).map((f) => f.k).sort();
    const filtro = ordenarSoloJjoo(filas, (f) => ({ anotacion: f.v, posicion: null })).map((f) => f.k).sort();
    expect(filtro).toEqual(conColor);
  });
});

describe('puesto que cuenta, margen (verde) y lo que falta (amarillo)', () => {
  const a = anotarRankingOlimpico(entrada());

  it('verde por el top 4 y por zona: margen sobre el primero que se queda fuera', () => {
    // ITA 400 sobre HUN 360 (5.º); HUN, mejor europeo del 5.º al 24.º, 360 sobre POL 320.
    expect(a.equipos.ITA).toMatchObject({ estado: 'clasificado', puesto: 1, puntos: 400, margen: 40 });
    expect(a.equipos.HUN).toMatchObject({ camino: 'EQUIPO_ZONA', puesto: 5, margen: 40 });
    expect(a.equipos.HUN.sobre?.noc).toBe('POL');
  });

  it('los tres del equipo: puesto y margen de su equipo', () => {
    expect(a.individual[id('SANTARELLI Andrea')]).toMatchObject({ camino: 'POR_EQUIPO', puesto: 1, puntos: 400, margen: 40 });
  });

  it('verde por el AOR individual: su puesto individual y el margen sobre el 3.º del AOR', () => {
    expect(a.individual[id('REIZLIN Roman')]).toMatchObject({ camino: 'AOR', puesto: 3, puntos: 240, margen: 15 });
  });

  it('amarillo por zona: el reserva de su zona, con lo que le falta al último que entra', () => {
    // POL (9.º, 320), primer europeo fuera: 40 a HUN.
    expect(a.equipos.POL).toMatchObject({ estado: 'cerca', camino: 'EQUIPO_ZONA', puesto: 9, faltan: 40, puestosFaltan: 1 });
    // ESP (10.º) es el 2.º europeo fuera: sin marca.
    expect(a.equipos.ESP).toBeUndefined();
    // CHN (7.º): 10 a KOR, 1 rival.
    expect(a.equipos.CHN).toMatchObject({ camino: 'EQUIPO_ZONA', puesto: 7, faltan: 10, puestosFaltan: 1 });
    // HEINE (8.º individual): 10 a FREILICH, primero fuera en Europa.
    expect(a.individual[id('HEINE Lukas')]).toMatchObject({ camino: 'AOR_ZONA', puesto: 8, faltan: 10, puestosFaltan: 1 });
    expect(colorOlimpico(a.individual[id('GARCIA Pablo')])).toBeNull();
  });

  it('amarillo por el top 4: hay que pasar a todos los que tiene delante hasta el 4.º', () => {
    // Sin CHN, POL es el primero fuera (8.º, 330); JPN y HUN empatan a 370: top 4 y zona a 40, gana el top 4.
    const lista = EQUIPOS.filter((n) => n !== 'CHN').map((noc, i) => ({ noc, posicion: i + 1, puntos: noc === 'HUN' ? 370 : 400 - i * 10 }));
    const b = anotarRankingOlimpico(entrada({ equipos: lista }));
    expect(b.equipos.POL).toMatchObject({ camino: 'EQUIPO_TOP', faltan: 40, puesto: 8, puestosFaltan: 4 });
  });

  it('amarillo por su equipo: el tirador hereda puesto y lo que le falta a su equipo', () => {
    const lista = entrada().equipos.filter((e) => e.noc !== 'POL').map((e) => (e.noc === 'ESP' ? { ...e, puntos: 355 } : e));
    const b = anotarRankingOlimpico(entrada({ equipos: lista }));
    expect(b.individual[id('GARCIA Pablo')]).toMatchObject({ camino: 'POR_EQUIPO', puesto: 10, faltan: 5, puestosFaltan: 1 });
  });

  it('gris: el puesto que tiene en la lista aunque no cuente', () => {
    const b = anotarRankingOlimpico(entrada({
      equipos: ['ITA', 'RUS', ...EQUIPOS.slice(1)].map((noc, i) => ({ noc, posicion: i + 1, puntos: 400 - i * 10 })),
    }));
    expect(b.equipos.RUS).toMatchObject({ estado: 'pendiente', puesto: 2, puntos: 390 });
  });
});

const PRUEBA = anotarRankingOlimpico(entrada());

describe('perfil: la anotación completa viaja con fecha y prueba', () => {
  beforeEach(() => {
    anotaciones.porPrueba = { 'ESPADA|M': PRUEBA };
    anotaciones.llamadas = [];
  });

  const actual = (fieId: number) => ({ arma: 'ESPADA' as const, genero: 'M' as const, categoria: 'ABS', puesto: 1, temporada: '2027', fieId });

  it('entra el amarillo (antes sólo el verde) y la fecha del ranking', async () => {
    const [m] = await leerOlimpicaPerfil([actual(Number(id('HEINE Lukas')))]);
    expect(m.anotacion).toMatchObject({ estado: 'cerca', faltan: 10, puesto: 8, fechaRanking: FECHA, prueba: { arma: 'ESPADA', genero: 'M' } });
    const [v] = await leerOlimpicaPerfil([actual(Number(id('REIZLIN Roman')))]);
    expect(v.anotacion.estado).toBe('clasificado');
  });

  it('sin color o fuera de una prueba olímpica, nada', async () => {
    expect(await leerOlimpicaPerfil([actual(Number(id('NIKISHYN Bohdan')))])).toEqual([]);
    expect(await leerOlimpicaPerfil([{ ...actual(1002), categoria: 'M20' }])).toEqual([]);
    expect(anotaciones.llamadas).toEqual(['ESPADA|M']);
  });

  it('la cabecera pinta la burbuja que se toca, con su color y la fecha dentro', async () => {
    const olimpica = await leerOlimpicaPerfil([actual(Number(id('HEINE Lukas')))]);
    const chips = chipsRanking({
      resumenMundial: { vigente: '2027', mejores: [], actuales: [actual(Number(id('HEINE Lukas')))] },
      olimpica,
    });
    const o = html(React.createElement(FilasRanking, { chips }));
    expect(o).toContain('data-slot="popover-trigger"');
    expect(o).toContain('data-color-olimpico="amarillo"');
    expect(o).toContain('le faltan 10 puntos');
    expect(o).toContain('data-icono="aros"');
  });
});

describe('Buscar: marcas de varias personas de una vez', () => {
  beforeEach(() => {
    anotaciones.porPrueba = { 'ESPADA|M': PRUEBA, 'FLORETE|F': null };
    anotaciones.llamadas = [];
  });

  it('una consulta para todas, una lectura por prueba, y sólo quien tiene color', async () => {
    const sentencias: string[] = [];
    const db = {
      execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
        sentencias.push(JSON.stringify(q));
        return {
          rows: [
            { persona: 'p-heine', arma: 'ESPADA', genero: 'M', fieId: Number(id('HEINE Lukas')) },
            { persona: 'p-reizlin', arma: 'ESPADA', genero: 'M', fieId: Number(id('REIZLIN Roman')) },
            { persona: 'p-nikishyn', arma: 'ESPADA', genero: 'M', fieId: Number(id('NIKISHYN Bohdan')) },
            { persona: 'p-heine', arma: 'FLORETE', genero: 'F', fieId: 1 },
          ],
        };
      }),
    };
    const r = await leerOlimpicaPersonas(db as never, ['p-heine', 'p-reizlin', 'p-nikishyn', 'p-heine']);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(sentencias[0]).toContain('merged_into_person_id');
    expect(sentencias[0]).toContain('fie_addr_id');
    expect([...new Set(anotaciones.llamadas)].sort()).toEqual(['ESPADA|M', 'FLORETE|F']);
    expect(Object.keys(r).sort()).toEqual(['p-heine', 'p-reizlin']);
    expect(r['p-heine'][0].anotacion).toMatchObject({ estado: 'cerca', fechaRanking: FECHA });

    const fila = html(React.createElement(MarcaOlimpicaPersona, { marcas: r['p-heine'] }));
    expect(fila).toContain('data-color-olimpico="amarillo"');
    expect(fila).toContain('<button');
  });

  it('sin personas no consulta; si la base falla, nada', async () => {
    const db = { execute: vi.fn(async () => { throw new Error('caída'); }) };
    expect(await leerOlimpicaPersonas(db as never, [])).toEqual({});
    expect(db.execute).not.toHaveBeenCalled();
    expect(await leerOlimpicaPersonas(db as never, ['x'])).toEqual({});
  });
});

describe('/ranking internacional: la misma burbuja en cada fila y con «Solo JJOO»', () => {
  const grupo = { weapon: 'ESPADA', gender: 'M', category: 'ABS' } as const;
  const tabla = (olimpica: AnotacionesPrueba | null) => ({
    group: grupo,
    format: 'INDIVIDUAL' as const,
    season: 2027,
    rows: entrada().individual.map((f) => ({
      fieId: f.fieId, nombre: f.nombre, athleteId: null, esMio: false, position: f.posicion,
      pais: f.noc, paisNombre: f.noc, points: String(f.puntos), eventCount: 1, fichaUrl: null,
    })),
    espanoles: 1,
    actualizadoEl: new Date(FECHA),
    sourceUrl: 'https://example.test/fie',
    olimpica,
    personas: {},
  });
  const pintar = (olimpica: AnotacionesPrueba | null) => html(React.createElement(TablaRankingFie, {
    grupos: [{ ...grupo, format: 'INDIVIDUAL', tiradores: 14 }] as never,
    inicial: { ...grupo, format: 'INDIVIDUAL' },
    primeraTabla: tabla(olimpica) as never,
    mios: [],
    cargar: vi.fn(),
  }));

  it('verde y amarillo en sus filas, el filtro con aros y el mismo recuento', () => {
    busqueda.valor = new URLSearchParams();
    const o = pintar(PRUEBA);
    expect(o).toContain('data-color-olimpico="verde"');
    expect(o).toContain('data-color-olimpico="amarillo"');
    expect(o).toContain('data-filtro-olimpico');
    expect(o).toContain('data-icono="aros"');
    expect(o).not.toContain('laurel');
    const conColor = Object.values(PRUEBA.individual).filter((x) => colorOlimpico(x)).length;
    expect((o.match(/data-slot="popover-trigger"/g) ?? []).length).toBe(conColor);
  });

  it('con ?jjoo=1 sólo quedan las filas con color', () => {
    busqueda.valor = new URLSearchParams('jjoo=1');
    const o = pintar(PRUEBA);
    expect(o).toContain('aria-pressed="true"');
    expect(o).not.toContain('NIKISHYN');
    expect(o).toContain('HEINE');
    busqueda.valor = new URLSearchParams();
  });

  it('sin marcas olímpicas, ni burbujas ni filtro', () => {
    const o = pintar(null);
    expect(o).not.toContain('data-color-olimpico');
    expect(o).not.toContain('data-filtro-olimpico');
  });
});
