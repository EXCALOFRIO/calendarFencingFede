import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  leerPruebaFie,
  leerRanking,
  normalizarCuadro,
  normalizarPoules,
  normalizarPrueba,
  urlCuadro,
  urlPoules,
  urlRanking,
  type DepsLecturaFie,
} from '@/lib/ingest/sources/fie-resultados';

/**
 * Fixtures: respuestas REALES de la API pública de la FIE (lectura 2026-10-01,
 * sin cuenta), reducidas a campos deportivos y con los nombres sustituidos.
 * `depsDesde` las sirve por URL exacta, así que si el adaptador pidiera otra
 * ruta (p. ej. `/results`) fallaría como falla la FIE: con 404.
 */
type Fixture = { respuestas: Record<string, unknown> };
const cargar = (nombre: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/fie-resultados/${nombre}.json`, import.meta.url), 'utf8'));

function depsDesde(
  fx: Fixture,
  fallos: Record<string, string> = {},
): DepsLecturaFie & { pedidas: string[] } {
  const pedidas: string[] = [];
  return {
    pedidas,
    async fetchJson(url) {
      pedidas.push(url);
      if (fallos[url]) throw new Error(fallos[url]);
      if (!(url in fx.respuestas)) throw new Error(`HTTP 404 al pedir ${url}`);
      return structuredClone(fx.respuestas[url]);
    },
  };
}

const bogota = () => cargar('bogota-2027-1478');
const paris = () => cargar('paris-2024-246');
const parisEquipos = () => cargar('paris-2024-250-equipos');

describe('Bogotá 2027/1478: puestos finales paginados (VAL-RESULT-002)', () => {
  it('recupera los 28 puestos de las dos páginas, 24 + 4, sin duplicados', async () => {
    const deps = depsDesde(bogota());
    const parte = await leerRanking(2027, 1478, deps);
    expect(parte.cobertura).toEqual({ estado: 'completo', publicado: 28, importado: 28, error: null });
    expect(parte.puestos).toHaveLength(28);
    expect(new Set(parte.puestos.map((p) => p.fieId)).size).toBe(28);
    expect(parte.paginasLeidas).toBe(2);
    expect(deps.pedidas).toEqual([urlRanking(2027, 1478, 1), urlRanking(2027, 1478, 2)]);
    expect(deps.pedidas[0]).toBe(
      'https://fie.org/api/fie/competition/2027/1478/results/ranking?page=1&pageSize=24',
    );
  });

  it('guarda el rank de la prueba, con su empate, y no el overallRanking de la ficha', async () => {
    const fx = bogota();
    const pagina1 = fx.respuestas[urlRanking(2027, 1478, 1)] as {
      items: { rank: number; overallRanking: number; fencer: { id: number } }[];
    };
    // En la fuente el puesto de la prueba y el del ranking mundial difieren.
    expect(pagina1.items.some((i) => i.rank !== i.overallRanking)).toBe(true);
    const parte = await leerRanking(2027, 1478, depsDesde(fx));
    const porId = new Map(parte.puestos.map((p) => [p.fieId, p]));
    for (const i of pagina1.items) expect(porId.get(i.fencer.id)?.posicion).toBe(i.rank);
    expect(parte.puestos.map((p) => p.posicion).slice(0, 5)).toEqual([1, 2, 3, 3, 5]);
  });

  it('leer dos veces da los mismos hechos (idempotente)', async () => {
    const a = await leerRanking(2027, 1478, depsDesde(bogota()));
    const b = await leerRanking(2027, 1478, depsDesde(bogota()));
    expect(b.puestos).toEqual(a.puestos);
  });

  it('si la segunda página falla conserva lo leído como parcial, no completo ni vacío', async () => {
    const deps = depsDesde(bogota(), { [urlRanking(2027, 1478, 2)]: 'HTTP 503 al pedir la página 2' });
    const parte = await leerRanking(2027, 1478, deps);
    expect(parte.puestos).toHaveLength(24);
    expect(parte.cobertura).toMatchObject({ estado: 'parcial', publicado: 28, importado: 24 });
    expect(parte.cobertura.error).toMatch(/503/);
  });

  it('si la primera página falla es error, sin cifras inventadas', async () => {
    const deps = depsDesde(bogota(), { [urlRanking(2027, 1478, 1)]: 'HTTP 429 al pedir la página 1' });
    const parte = await leerRanking(2027, 1478, deps);
    expect(parte.puestos).toEqual([]);
    expect(parte.cobertura).toMatchObject({ estado: 'error', publicado: null, importado: 0 });
  });

  it('un total publicado de 0 es «sin resultados», distinto de error', async () => {
    const deps: DepsLecturaFie = {
      fetchJson: async () => ({ totalFound: 0, page: 1, pageSize: 24, items: [] }),
    };
    const parte = await leerRanking(2027, 1, deps);
    expect(parte.cobertura).toEqual({ estado: 'sin_resultados', publicado: 0, importado: 0, error: null });
  });

  it('una página que se repite no cuenta dos veces ni se queda en bucle', async () => {
    const fx = bogota();
    const p1 = fx.respuestas[urlRanking(2027, 1478, 1)];
    const deps: DepsLecturaFie & { pedidas: string[] } = {
      pedidas: [],
      async fetchJson(url) {
        this.pedidas.push(url);
        return structuredClone(p1);
      },
    };
    const parte = await leerRanking(2027, 1478, deps);
    expect(parte.puestos).toHaveLength(24);
    expect(parte.cobertura.estado).toBe('parcial');
    expect(deps.pedidas.length).toBeLessThanOrEqual(2);
  });

  it('descarta fecha de nacimiento, foto y licencia que traiga la respuesta', async () => {
    const deps: DepsLecturaFie = {
      fetchJson: async () => ({
        totalFound: 1,
        page: 1,
        pageSize: 24,
        items: [
          {
            overallRanking: 10,
            rank: 1,
            points: 32,
            fencer: {
              id: 7,
              name: 'APELLIDO Nombre',
              countryCode: 'ESP',
              gender: 'F',
              date: '2010-03-04',
              image: 'https://static.fie.org/x.jpg',
              licenseNumber: 'ABC123',
              age: 13,
            },
          },
        ],
      }),
    };
    const parte = await leerRanking(2027, 1478, deps);
    const volcado = JSON.stringify(parte);
    for (const prohibido of ['2010-03-04', 'static.fie.org', 'ABC123', 'age', 'overallRanking']) {
      expect(volcado).not.toContain(prohibido);
    }
    expect(parte.puestos[0]).toMatchObject({ fieId: 7, posicion: 1, puntosPrueba: 32 });
  });
});

describe('Bogotá 2027/1478: poules y cuadro (VAL-RESULT-003)', () => {
  it('pide los endpoints exactos, no una ruta /results inventada', async () => {
    const deps = depsDesde(bogota());
    await leerPruebaFie(2027, 1478, deps);
    expect(deps.pedidas).toContain(urlPoules(2027, 1478));
    expect(deps.pedidas).toContain(urlCuadro(2027, 1478));
    expect(deps.pedidas.some((u) => /\/results$/.test(u))).toBe(false);
  });

  it('cuatro poules de 7: 84 asaltos, uno por pareja recíproca, completos', async () => {
    const lectura = await leerPruebaFie(2027, 1478, depsDesde(bogota()));
    const poules = lectura.poules!;
    expect(poules.grupos).toBe(4);
    expect(poules.asaltos).toHaveLength(4 * 21);
    expect(poules.cobertura).toEqual({ estado: 'completo', publicado: 84, importado: 84, error: null });
    const claves = poules.asaltos.map((a) => `${a.ronda}|${a.refA}|${a.refB}`);
    expect(new Set(claves).size).toBe(84);
    for (const a of poules.asaltos) {
      expect(a.fase).toBe('POULE');
      expect(a.refA < a.refB).toBe(true);
      expect(a.ronda).toMatch(/^P[1-4]$/);
    }
  });

  it('orienta el marcador a cada tirador: la matriz se lee fila contra columna', async () => {
    const fx = bogota();
    const matriz = fx.respuestas[urlPoules(2027, 1478)] as {
      pools: { poolId: number; rows: { fencerId: number; matches: ({ score: number } | null)[] }[] }[];
    };
    const poule = matriz.pools[0];
    const lectura = await leerPruebaFie(2027, 1478, depsDesde(fx));
    const asalto = lectura.poules!.asaltos.find(
      (a) =>
        a.ronda === `P${poule.poolId}` &&
        a.refA === String(Math.min(poule.rows[0].fencerId, poule.rows[1].fencerId)) &&
        a.refB === String(Math.max(poule.rows[0].fencerId, poule.rows[1].fencerId)),
    )!;
    const puntosDe = (id: number) => {
      const i = poule.rows.findIndex((r) => r.fencerId === id);
      const j = i === 0 ? 1 : 0;
      return poule.rows[i].matches[j]!.score;
    };
    expect(asalto.puntosA).toBe(puntosDe(Number(asalto.refA)));
    expect(asalto.puntosB).toBe(puntosDe(Number(asalto.refB)));
  });

  it('el cuadro A32…A2 conserva fase, ronda y tanteo; los BYE no son asaltos', async () => {
    const lectura = await leerPruebaFie(2027, 1478, depsDesde(bogota()));
    const cuadro = lectura.cuadro!;
    expect(cuadro.excluidos.bye).toBe(10);
    expect(cuadro.asaltos).toHaveLength(21);
    expect(cuadro.cobertura).toMatchObject({ estado: 'completo', publicado: 21, importado: 21 });
    const rondas = new Map<string, number>();
    for (const a of cuadro.asaltos) {
      expect(a.fase).toBe('TABLEAU');
      rondas.set(a.ronda, (rondas.get(a.ronda) ?? 0) + 1);
      expect(Math.max(a.puntosA, a.puntosB)).toBeGreaterThan(Math.min(a.puntosA, a.puntosB));
    }
    expect([...rondas.keys()].sort()).toEqual(['A16', 'A2', 'A32', 'A4', 'A8']);
    expect(rondas.get('A2')).toBe(1);
    expect(rondas.get('A4')).toBe(2);
  });

  it('el mismo cruce en poule y en cuadro son dos asaltos distintos', async () => {
    const lectura = await leerPruebaFie(2027, 1478, depsDesde(bogota()));
    const pares = (xs: { refA: string; refB: string }[]) => new Set(xs.map((a) => `${a.refA}|${a.refB}`));
    const enAmbos = [...pares(lectura.cuadro!.asaltos)].filter((p) => pares(lectura.poules!.asaltos).has(p));
    expect(enAmbos.length).toBeGreaterThan(0);
  });

  it('la metadata sale de la propia prueba: sable femenino cadete individual, no del torneo', async () => {
    const lectura = await leerPruebaFie(2027, 1478, depsDesde(bogota()));
    expect(lectura.prueba).toMatchObject({
      season: 2027,
      competitionId: 1478,
      tournamentId: 107,
      arma: 'SABLE',
      genero: 'F',
      categoria: 'M17',
      categoriaOriginal: 'C',
      formato: 'INDIVIDUAL',
      fecha: '2026-09-25',
    });
  });
});

describe('normalización de poules: reciprocidad y exclusiones', () => {
  const celda = (score: number, v: boolean) => ({ score, v });
  const poule = (matrices: unknown[][]) => ({
    pools: [
      {
        poolId: 9,
        rows: matrices.map((matches, i) => ({ fencerId: 100 + i, name: `FIE ${100 + i}`, matches })),
      },
    ],
  });

  it('una pareja con las dos perspectivas coherentes sale una sola vez', () => {
    const r = normalizarPoules(poule([[null, celda(5, true)], [celda(3, false), null]]), { individual: true });
    expect(r.ok && r.parte.asaltos).toEqual([
      expect.objectContaining({ refA: '100', refB: '101', puntosA: 5, puntosB: 3, ronda: 'P9' }),
    ]);
  });

  it('el orden canónico se respeta cuando el ID de la fila es mayor que el de la columna', () => {
    const entrada = {
      pools: [
        {
          poolId: 1,
          rows: [
            { fencerId: 900, name: 'FIE 900', matches: [null, celda(5, true)] },
            { fencerId: 90, name: 'FIE 90', matches: [celda(2, false), null] },
          ],
        },
      ],
    };
    const r = normalizarPoules(entrada, { individual: true });
    const a = r.ok ? r.parte.asaltos[0] : null;
    // «90» < «900» como texto, igual que lo compara la restricción de la tabla.
    expect(a).toMatchObject({ refA: '90', refB: '900', puntosA: 2, puntosB: 5 });
  });

  it('una sola celda, sin recíproca, no es asalto', () => {
    const r = normalizarPoules(poule([[null, celda(5, true)], [null, null]]), { individual: true });
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos.noReciproco).toBe(1);
    expect(r.ok && r.parte.cobertura.estado).toBe('parcial');
  });

  it('dos ganadores, ninguno, empate de marcador o ganador con menos tocados quedan fuera', () => {
    const casos: [ReturnType<typeof celda>, ReturnType<typeof celda>, string][] = [
      [celda(5, true), celda(3, true), 'sinGanador'],
      [celda(5, false), celda(3, false), 'sinGanador'],
      [celda(4, true), celda(4, false), 'empate'],
      [celda(3, true), celda(5, false), 'incoherente'],
    ];
    for (const [ij, ji, motivo] of casos) {
      const r = normalizarPoules(poule([[null, ij], [ji, null]]), { individual: true });
      expect(r.ok && r.parte.asaltos).toEqual([]);
      expect(r.ok && (r.parte.excluidos as Record<string, number>)[motivo]).toBe(1);
    }
  });

  it('quien se retira sin tirar no deja asaltos publicados: la poule sigue completa', () => {
    const nada = celda(0, false);
    const r = normalizarPoules(
      poule([
        [null, celda(5, true), nada],
        [celda(2, false), null, nada],
        [nada, nada, null],
      ]),
      { individual: true },
    );
    expect(r.ok && r.parte.asaltos).toHaveLength(1);
    expect(r.ok && r.parte.excluidos).toMatchObject({ retirado: 2, sinGanador: 0 });
    expect(r.ok && r.parte.cobertura).toMatchObject({ estado: 'completo', publicado: 1, importado: 1 });
  });

  it('un 0-0 sin victoria entre dos que sí tiraron, o una poule entera a 0-0, no es retirada', () => {
    const nada = celda(0, false);
    const cruzado = normalizarPoules(
      poule([
        [null, nada, celda(5, true)],
        [nada, null, celda(5, true)],
        [celda(1, false), celda(2, false), null],
      ]),
      { individual: true },
    );
    expect(cruzado.ok && cruzado.parte.excluidos).toMatchObject({ retirado: 0, sinGanador: 1 });
    expect(cruzado.ok && cruzado.parte.cobertura.estado).toBe('parcial');
    const vacia = normalizarPoules(poule([[null, nada], [nada, null]]), { individual: true });
    expect(vacia.ok && vacia.parte.excluidos).toMatchObject({ retirado: 0, sinGanador: 1 });
  });

  it('una celda con marcador incompleto no se completa', () => {
    const r = normalizarPoules(
      poule([[null, { score: null, v: true }], [celda(3, false), null]]),
      { individual: true },
    );
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos.sinMarcador).toBe(1);
  });

  it('una poule sin ID de tirador no se atribuye a nadie', () => {
    const entrada = {
      pools: [
        {
          poolId: 1,
          rows: [
            { fencerId: null, matches: [null, celda(5, true)] },
            { fencerId: 7, matches: [celda(2, false), null] },
          ],
        },
      ],
    };
    const r = normalizarPoules(entrada, { individual: true });
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos.sinId).toBe(1);
  });

  it('equipos nunca generan asaltos de poule', () => {
    const r = normalizarPoules(poule([[null, celda(45, true)], [celda(36, false), null]]), {
      individual: false,
    });
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos.equipo).toBe(1);
  });

  it('una respuesta con otra forma se rechaza en el borde', () => {
    expect(normalizarPoules({ pools: 'x' }, { individual: true })).toEqual({ ok: false });
    expect(normalizarPoules(null, { individual: true })).toEqual({ ok: false });
  });
});

describe('normalización del cuadro: BYE, marcador y equipos', () => {
  const t = (id: number | null, score: number | null, isWinner: boolean | null) => ({
    id,
    name: id === null ? '' : `FIE ${id}`,
    score,
    isWinner,
  });
  const cuadro = (cruces: unknown[]) => ({
    tableau: [{ suiteTableId: 'SuiteTab_A', rounds: { A16: cruces } }],
  });

  it('un cruce completo da un asalto con su ronda y su tanteo', () => {
    const r = normalizarCuadro(cuadro([{ fencer1: t(5, 15, true), fencer2: t(3, 11, false) }]), {
      individual: true,
    });
    expect(r.ok && r.parte.asaltos).toEqual([
      expect.objectContaining({ fase: 'TABLEAU', ronda: 'A16', refA: '3', refB: '5', puntosA: 11, puntosB: 15 }),
    ]);
  });

  it('BYE (con y sin la marca isBye), sin marcador, sin ganador o con empate no son asalto', () => {
    const r = normalizarCuadro(
      cuadro([
        { fencer1: t(1, 15, true), fencer2: t(null, null, false), isBye: true },
        { fencer1: t(2, 15, true), fencer2: t(null, null, false) },
        { fencer1: t(3, 8, null), fencer2: t(4, null, null) },
        { fencer1: t(5, 8, false), fencer2: t(6, 7, false) },
        { fencer1: t(7, 10, true), fencer2: t(8, 10, false) },
        { fencer1: t(9, 10, true), fencer2: t(10, 12, false) },
      ]),
      { individual: true },
    );
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos).toMatchObject({
      bye: 1,
      sinId: 1,
      sinMarcador: 1,
      sinGanador: 1,
      empate: 1,
      incoherente: 1,
    });
  });

  it('un cruce ganado por retirada no es asalto publicado; un empate con perdedor normal sigue siendo empate', () => {
    const conEstado = (id: number, score: number, isWinner: boolean, status: string | null, newStatus: string | null = null) =>
      ({ ...t(id, score, isWinner), status, newStatus });
    const r = normalizarCuadro(
      cuadro([
        { fencer1: conEstado(1, 0, true, 'V'), fencer2: conEstado(2, 0, false, 'A') },
        { fencer1: conEstado(3, 0, false, 'N', 'MED'), fencer2: conEstado(4, 0, true, 'V', 'V') },
        { fencer1: conEstado(5, 3, true, 'V', 'V'), fencer2: conEstado(6, 3, false, 'E', 'EXC') },
        { fencer1: conEstado(7, 15, true, 'V'), fencer2: conEstado(8, 9, false, 'D') },
        { fencer1: conEstado(9, 12, true, 'V'), fencer2: conEstado(10, 12, false, 'D') },
      ]),
      { individual: true },
    );
    expect(r.ok && r.parte.asaltos).toHaveLength(1);
    expect(r.ok && r.parte.excluidos).toMatchObject({ retirado: 3, empate: 1 });
    expect(r.ok && r.parte.cobertura).toMatchObject({ estado: 'parcial', publicado: 2, importado: 1 });
  });

  it('un cuadro de equipos no produce ni un asalto individual', () => {
    const r = normalizarCuadro(cuadro([{ fencer1: t(6960, 45, true), fencer2: t(6878, 26, false) }]), {
      individual: false,
    });
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos.equipo).toBe(1);
  });

  it('el mismo cruce repetido en la misma ronda sólo cuenta una vez', () => {
    const cruce = { fencer1: t(5, 15, true), fencer2: t(3, 11, false) };
    const r = normalizarCuadro(cuadro([cruce, cruce]), { individual: true });
    expect(r.ok && r.parte.asaltos).toHaveLength(1);
    expect(r.ok && r.parte.excluidos.duplicado).toBe(1);
  });
});

describe('París 2024/246: individual olímpico sin poules (VAL-RESULT-004)', () => {
  it('conserva los 34 puestos publicados y su total', async () => {
    const lectura = await leerPruebaFie(2024, 246, depsDesde(paris()));
    expect(lectura.prueba).toMatchObject({
      arma: 'SABLE',
      genero: 'M',
      categoria: 'ABS',
      formato: 'INDIVIDUAL',
      tournamentId: null,
      fecha: '2024-07-27',
    });
    expect(lectura.ranking!.cobertura).toEqual({
      estado: 'completo',
      publicado: 34,
      importado: 34,
      error: null,
    });
    expect(lectura.ranking!.puestos.map((p) => p.posicion)).toEqual(
      Array.from({ length: 34 }, (_, i) => i + 1),
    );
  });

  it('las poules publicadas vacías son «sin resultados», y el cuadro conserva los duelos', async () => {
    const lectura = await leerPruebaFie(2024, 246, depsDesde(paris()));
    expect(lectura.poules).toMatchObject({
      grupos: 0,
      asaltos: [],
      cobertura: { estado: 'sin_resultados', publicado: 0, importado: 0 },
    });
    const cuadro = lectura.cuadro!;
    expect(cuadro.cobertura.estado).toBe('completo');
    expect(cuadro.asaltos).toHaveLength(34);
    expect(cuadro.excluidos.bye).toBe(30);
    const rondas = new Set(cuadro.asaltos.map((a) => a.ronda));
    expect([...rondas].sort()).toEqual(['A16', 'A2', 'A32', 'A4', 'A64', 'A8', 'C2']);
  });

  it('final y bronce son cruces distintos, cada uno con su marcador', async () => {
    const lectura = await leerPruebaFie(2024, 246, depsDesde(paris()));
    const final = lectura.cuadro!.asaltos.filter((a) => a.ronda === 'A2');
    const bronce = lectura.cuadro!.asaltos.filter((a) => a.ronda === 'C2');
    expect(final).toHaveLength(1);
    expect(bronce).toHaveLength(1);
    expect(`${final[0].refA}|${final[0].refB}`).not.toBe(`${bronce[0].refA}|${bronce[0].refB}`);
    expect(Math.max(final[0].puntosA, final[0].puntosB)).toBe(15);
  });

  it('hasResults no decide: se piden los tres documentos aunque la metadata diga lo que diga', async () => {
    const fx = paris();
    const meta = fx.respuestas['https://fie.org/api/fie/competition/2024/246'] as { hasResults: number };
    meta.hasResults = 0;
    const deps = depsDesde(fx);
    const lectura = await leerPruebaFie(2024, 246, deps);
    expect(deps.pedidas).toHaveLength(1 + 2 + 1 + 1);
    expect(lectura.ranking!.puestos).toHaveLength(34);
  });
});

describe('equipos: clasificación sí, asaltos individuales nunca', () => {
  it('conserva la clasificación del equipo y no pide poules ni cuadro', async () => {
    const deps = depsDesde(parisEquipos());
    const lectura = await leerPruebaFie(2024, 250, deps);
    expect(lectura.prueba?.formato).toBe('EQUIPOS');
    expect(lectura.ranking!.puestos).toHaveLength(8);
    expect(lectura.ranking!.puestos[0]).toMatchObject({ posicion: 1, paisCodigo: 'JPN' });
    expect(lectura.poules).toBeNull();
    expect(lectura.cuadro).toBeNull();
    expect(deps.pedidas.some((u) => /pools|tableau/.test(u))).toBe(false);
  });

  it('aunque el cuadro de equipos llegara, el normalizador no emite H2H', async () => {
    const fx = parisEquipos();
    const cuerpo = fx.respuestas[urlCuadro(2024, 250)];
    const r = normalizarCuadro(cuerpo, { individual: false });
    expect(r.ok && r.parte.asaltos).toEqual([]);
    expect(r.ok && r.parte.excluidos.equipo).toBeGreaterThan(0);
  });
});

describe('lecturas fallidas o inutilizables conservan cobertura sin inventar', () => {
  it('si la metadata falla no hay prueba ni datos, sólo el error', async () => {
    const deps = depsDesde(bogota(), {
      'https://fie.org/api/fie/competition/2027/1478': 'HTTP 500 al pedir la prueba',
    });
    const lectura = await leerPruebaFie(2027, 1478, deps);
    expect(lectura).toMatchObject({ prueba: null, ranking: null, poules: null, cuadro: null });
    expect(lectura.errorPrueba).toMatch(/500/);
  });

  it('si fallan los asaltos, el ranking sigue y los asaltos quedan en error, no vacíos', async () => {
    const deps = depsDesde(bogota(), {
      [urlPoules(2027, 1478)]: 'HTTP 500 al pedir poules',
      [urlCuadro(2027, 1478)]: 'HTTP 429 al pedir cuadro',
    });
    const lectura = await leerPruebaFie(2027, 1478, deps);
    expect(lectura.ranking!.puestos).toHaveLength(28);
    expect(lectura.poules).toMatchObject({ asaltos: [], cobertura: { estado: 'error', publicado: null } });
    expect(lectura.cuadro).toMatchObject({ asaltos: [], cobertura: { estado: 'error', publicado: null } });
  });

  it('una metadata de otra prueba, o de categoría desconocida, se rechaza', () => {
    const base = {
      competitionId: 1,
      season: 2027,
      type: 'I',
      category: 'C',
      weapon: 'S',
      gender: 'F',
    };
    expect(normalizarPrueba(base, 2027, 1)).toHaveProperty('prueba');
    expect(normalizarPrueba(base, 2026, 1)).toHaveProperty('error');
    expect(normalizarPrueba({ ...base, category: '??' }, 2027, 1)).toHaveProperty('error');
    expect(normalizarPrueba({ ...base, type: null }, 2027, 1)).toHaveProperty('error');
  });
});
