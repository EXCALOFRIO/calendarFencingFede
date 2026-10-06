import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
  sqlCaraACaraRendimiento,
  sqlPruebasRendimiento,
  type FilaCaraACaraRendimiento,
  type FilaPruebaRendimiento,
} from '@/lib/sport/explorar/rendimiento-sql';
import {
  aRendimiento,
  aRendimientoCaraACara,
  leerRendimiento,
  leerRendimientoCaraACara,
  percentilDe,
  temporadaCorta,
  temporadaDeportiva,
  tipoRendimiento,
} from '@/lib/sport/explorar/rendimiento';
import { aEstadisticasPorAmbito } from '@/lib/sport/explorar/stats-ambito';
import { crearContexto, UUID_A, UUID_B, UUID_C } from './helpers/explorar';

/**
 * Las consultas de las gráficas de rendimiento ejecutadas de verdad sobre
 * SQLite (el mismo motor que D1), con un esquema mínimo de las columnas que
 * leen, y el modelo que agrega sus filas.
 */

const bases: DatabaseSync[] = [];
afterEach(() => bases.splice(0).forEach((db) => db.close()));

const FUSIONADA = '44444444-4444-4444-8444-444444444444';

type OpcionesPrueba = {
  torneo?: string;
  fuente?: string;
  temporada?: string;
  fecha?: string | null;
  formato?: string;
  categoria?: string;
  arma?: string;
  genero?: string;
  pais?: string | null;
  equivalencia?: string | null;
  evento?: { scope: string; circuit: string; source: string } | null;
};

function fixture() {
  const db = new DatabaseSync(':memory:');
  bases.push(db);
  db.exec(`
    CREATE TABLE sport_person(id TEXT PRIMARY KEY, merged_into_person_id TEXT, display_name TEXT, country_code TEXT);
    CREATE TABLE event(id TEXT PRIMARY KEY, scope TEXT, circuit TEXT, source TEXT);
    CREATE TABLE sport_edition(id TEXT PRIMARY KEY, name TEXT, start_date TEXT, country_code TEXT, event_id TEXT);
    CREATE TABLE sport_competition(id TEXT PRIMARY KEY, edition_id TEXT, event_competition_id TEXT, source TEXT,
      season TEXT, format TEXT, competition_date TEXT, category TEXT, weapon TEXT, gender TEXT);
    CREATE TABLE sport_bout(id TEXT PRIMARY KEY, competition_id TEXT, phase TEXT,
      fencer_a_person_id TEXT, fencer_b_person_id TEXT, score_a INTEGER, score_b INTEGER, occurred_on TEXT);
    CREATE INDEX sport_bout_a_idx ON sport_bout(fencer_a_person_id, fencer_b_person_id, occurred_on);
    CREATE INDEX sport_bout_b_idx ON sport_bout(fencer_b_person_id, fencer_a_person_id, occurred_on);
    CREATE TABLE sport_result(id TEXT PRIMARY KEY, competition_id TEXT, person_id TEXT, source TEXT,
      position INTEGER, occurred_on TEXT);
    CREATE INDEX sport_result_person_date_idx ON sport_result(person_id, occurred_on);
    CREATE INDEX sport_result_competition_position_idx ON sport_result(competition_id, position);
  `);
  const persona = (id: string, nombre: string, fusion: string | null = null) =>
    db.prepare('INSERT INTO sport_person VALUES (?, ?, ?, ?)').run(id, fusion, nombre, 'ESP');
  const prueba = (id: string, o: OpcionesPrueba = {}) => {
    if (o.evento) db.prepare('INSERT INTO event VALUES (?, ?, ?, ?)').run(`ev-${id}`, o.evento.scope, o.evento.circuit, o.evento.source);
    const fecha = o.fecha === undefined ? '2026-03-01' : o.fecha;
    db.prepare('INSERT INTO sport_edition VALUES (?, ?, ?, ?, ?)').run(
      id, o.torneo ?? `TORNEO ${id}`, fecha, o.pais === undefined ? 'ESP' : o.pais, o.evento ? `ev-${id}` : null,
    );
    db.prepare('INSERT INTO sport_competition VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, id, o.equivalencia ?? null, o.fuente ?? 'rfee_pdf', o.temporada ?? '2025-2026', o.formato ?? 'INDIVIDUAL',
      fecha, o.categoria ?? 'ABS', o.arma ?? 'FLORETE', o.genero ?? 'M',
    );
  };
  let n = 0;
  const asalto = (competicion: string, a: string | null, b: string | null, sa: number, sb: number, fase = 'POULE') =>
    db.prepare('INSERT INTO sport_bout VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      `bout-${String(++n).padStart(4, '0')}`, competicion, fase, a, b, sa, sb, null,
    );
  let m = 0;
  const resultado = (competicion: string, persona: string | null, puesto: number | null, fuente = 'rfee_pdf') =>
    db.prepare('INSERT INTO sport_result VALUES (?, ?, ?, ?, ?, ?)').run(
      `res-${String(++m).padStart(4, '0')}`, competicion, persona, fuente, puesto, null,
    );
  /** Cuadro de `total` tiradores sin persona resuelta salvo los puestos dados aparte. */
  const cuadro = (competicion: string, total: number, ocupados: number[] = []) => {
    for (let p = 1; p <= total; p++) if (!ocupados.includes(p)) resultado(competicion, null, p);
  };
  function ejecutar<T>(consulta: SQL): T[] {
    const q = new SQLiteSyncDialect().sqlToQuery(consulta);
    expect(q.sql).not.toMatch(/::|DISTINCT ON|ILIKE|pg_catalog/);
    expect(q.params.length).toBeLessThanOrEqual(100);
    return db.prepare(q.sql).all(...q.params as SQLInputValue[]) as T[];
  }
  function plan(consulta: SQL): string {
    const q = new SQLiteSyncDialect().sqlToQuery(consulta);
    return (db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params as SQLInputValue[]) as { detail: string }[])
      .map((f) => f.detail).join('\n');
  }
  return { db, persona, prueba, asalto, resultado, cuadro, ejecutar, plan };
}

describe('tipos y temporadas de las gráficas', () => {
  it('separa el Campeonato y los Juegos del Mediterráneo y agrupa lo nacional menor', () => {
    const t = (torneo: string, fuente = 'fie', pais: string | null = 'FRA') =>
      tipoRendimiento({ torneo, fuente, pais, ambitoEvento: null, circuitoEvento: null, fuenteEvento: null }).tipo;
    expect(t('Championnats de la Méditerranée')).toBe('CTO_MEDITERRANEO');
    expect(t('Jeux Méditerranéens')).toBe('JUEGOS_MEDITERRANEOS');
    expect(t('Campeonato Panamericano')).toBe('CTO_CONTINENTAL');
    expect(t('Universiade')).toBe('JUEGOS_OTROS');
    expect(t('Jeux Olympiques')).toBe('JUEGOS_OLIMPICOS');
    expect(t('Coupe du Monde')).toBe('COPA_MUNDO');
    expect(t('TNR Florete Madrid', 'rfee_pdf', 'ESP')).toBe('TNR');
    expect(t('Criterium nacional', 'rfee_pdf', 'ESP')).toBe('NACIONAL_OTRO');
    expect(t('Campeonato de Madrid', 'skermo_regional', 'ESP')).toBe('AUTONOMICO');
  });

  it('lleva la temporada FIE a la deportiva y la acorta', () => {
    expect(temporadaDeportiva('2025')).toBe('2024-2025');
    expect(temporadaDeportiva('2024-2025')).toBe('2024-2025');
    expect(temporadaCorta('2024-2025')).toBe('24-25');
  });

  it('el percentil necesita un cuadro de al menos dos y un puesto dentro', () => {
    expect(percentilDe(3, 64)).toBeCloseTo(3 / 64);
    expect(percentilDe(1, 1)).toBeNull();
    expect(percentilDe(10, 8)).toBeNull();
    expect(percentilDe(3, null)).toBeNull();
  });
});

describe('pruebas del perfil para las gráficas', () => {
  it('separa poule y directa, orienta el marcador y lee el cuadro sin contar los no clasificados', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('p1');
    f.resultado('p1', UUID_A, 2);
    f.cuadro('p1', 16, [2]);
    f.resultado('p1', null, 998);
    f.asalto('p1', UUID_A, UUID_B, 5, 3);
    f.asalto('p1', UUID_B, UUID_A, 5, 2);
    f.asalto('p1', UUID_B, UUID_A, 10, 15, 'TABLEAU');
    f.asalto('p1', UUID_A, UUID_B, 45, 40, 'TABLEAU');
    const [fila] = f.ejecutar<FilaPruebaRendimiento>(sqlPruebasRendimiento([UUID_A]));
    expect(fila).toMatchObject({
      puesto: 2, participantes: 16, asaltos: 3, victorias: 2, derrotas: 1, dados: 22, recibidos: 18,
      pouleA: 2, pouleV: 1, pouleD: 1, pouleDados: 7, pouleRecibidos: 8,
      directaA: 1, directaV: 1, directaD: 0, directaDados: 15, directaRecibidos: 10,
    });
  });

  it('suma los IDs fusionados, descarta equipos y cuenta una sola fuente por equivalencia', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(FUSIONADA, 'Ana Perez', UUID_A); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('fie', { fuente: 'fie', equivalencia: 'cal-1', temporada: '2026' });
    f.prueba('pdf', { equivalencia: 'cal-1' });
    f.prueba('equipos', { formato: 'EQUIPOS' });
    f.resultado('fie', UUID_A, 5, 'fie');
    f.resultado('pdf', FUSIONADA, 5);
    f.resultado('equipos', UUID_A, 1);
    f.asalto('fie', UUID_A, UUID_B, 5, 1);
    f.asalto('pdf', FUSIONADA, UUID_B, 5, 1);
    const filas = f.ejecutar<FilaPruebaRendimiento>(sqlPruebasRendimiento([UUID_A, FUSIONADA]));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ puesto: 5, asaltos: 1, victorias: 1 });
  });

  it('dos puestos contradictorios en la misma equivalencia dejan la prueba sin puesto', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    f.prueba('a', { equivalencia: 'cal-1' });
    f.prueba('b', { equivalencia: 'cal-1', fuente: 'fie' });
    f.resultado('a', UUID_A, 3);
    f.resultado('b', UUID_A, 4, 'fie');
    const [fila] = f.ejecutar<FilaPruebaRendimiento>(sqlPruebasRendimiento([UUID_A]));
    expect(fila.puesto).toBeNull();
  });

  it('entra por los índices de la persona, nunca recorre asaltos ni resultados enteros', () => {
    const f = fixture();
    const plan = f.plan(sqlPruebasRendimiento([UUID_A]));
    expect(plan).toMatch(/sport_bout_a_idx/);
    expect(plan).toMatch(/sport_bout_b_idx/);
    expect(plan).toMatch(/sport_result_person_date_idx/);
    expect(plan).toMatch(/sport_result_competition_position_idx/);
    expect(plan).not.toMatch(/SCAN (b|r|x)\b/);
  });
});

describe('modelo de rendimiento', () => {
  function perfilDePrueba() {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta');
    // 2023-2024 (FIE «2024»): Copa del Mundo, 3.ª de 32.
    f.prueba('cm', { torneo: 'Coupe du Monde', fuente: 'fie', pais: 'FRA', temporada: '2024', fecha: '2024-01-10' });
    f.resultado('cm', UUID_A, 3, 'fie'); f.cuadro('cm', 32, [3]);
    f.asalto('cm', UUID_A, UUID_B, 5, 2); f.asalto('cm', UUID_A, UUID_B, 15, 9, 'TABLEAU');
    // 2025-2026: TNR ganado de 20 y Mediterráneo 8.º de 16; 2024-2025 sin competir.
    f.prueba('tnr', { torneo: 'TNR Florete Madrid', temporada: '2025-2026', fecha: '2025-11-10' });
    f.resultado('tnr', UUID_A, 1); f.cuadro('tnr', 20, [1]);
    f.asalto('tnr', UUID_B, UUID_A, 3, 5); f.asalto('tnr', UUID_B, UUID_A, 5, 4);
    f.prueba('med', { torneo: 'Championnats de la Méditerranée', fuente: 'fie', pais: 'TUN', temporada: '2026', fecha: '2026-02-01', categoria: 'M20' });
    f.resultado('med', UUID_A, 8, 'fie'); f.cuadro('med', 16, [8]);
    return aRendimiento(f.ejecutar<FilaPruebaRendimiento>(sqlPruebasRendimiento([UUID_A])));
  }

  it('agrega por temporada con el hueco relleno y el reparto por ámbito', () => {
    const r = perfilDePrueba();
    const ts = r.vistas.todo.porTemporada;
    expect(ts.map((t) => t.temporada)).toEqual(['2023-2024', '2024-2025', '2025-2026']);
    expect(ts[1]).toMatchObject({ competiciones: 0, internacionales: 0, nacionales: 0, mejor: null });
    expect(ts[2]).toMatchObject({ competiciones: 2, internacionales: 1, nacionales: 1, mejor: 1, mediana: 4.5, oros: 1, corta: '25-26' });
    expect(ts[0]).toMatchObject({ bronces: 1, medallas: 1 });
    expect(ts[0].asaltos).toMatchObject({ asaltos: 2, victorias: 2, porcentaje: 1 });
  });

  it('separa internacional y nacional, por tipo y por categoría', () => {
    const r = perfilDePrueba();
    expect(r.vistas.internacional.total.competiciones).toBe(2);
    expect(r.vistas.nacional.total.competiciones).toBe(1);
    expect(r.vistas.todo.porTipo.map((t) => t.clave)).toEqual(['CTO_MEDITERRANEO', 'COPA_MUNDO', 'TNR']);
    expect(r.vistas.nacional.porTipo.map((t) => t.clave)).toEqual(['TNR']);
    expect(r.vistas.todo.porCategoria.map((c) => [c.clave, c.etiqueta, c.competiciones])).toEqual([['ABS', 'Absoluto', 2], ['M20', 'M20', 1]]);
    const tnr = r.vistas.todo.porTipo.find((t) => t.clave === 'TNR')!;
    expect(tnr.poule).toMatchObject({ asaltos: 2, victorias: 1, derrotas: 1, porcentaje: 0.5 });
    expect(r.vistas.todo.porArma).toEqual([]);
  });

  it('la evolución es cronológica, con el percentil sobre el cuadro y el nombre en castellano', () => {
    const r = perfilDePrueba();
    const ev = r.vistas.todo.evolucion;
    expect(ev.map((p) => [p.puesto, p.participantes])).toEqual([[3, 32], [1, 20], [8, 16]]);
    expect(ev[0]).toMatchObject({ percentil: 3 / 32, tipo: 'COPA_MUNDO', tono: 'org-fie', ambito: 'internacional', torneo: 'Copa del Mundo' });
    expect(ev[2].torneo).toBe('Campeonato del Mediterráneo');
    expect(r.vistas.todo.total.percentilMediano).toBeCloseTo(3 / 32);
  });

  it('funde la misma prueba publicada por dos fuentes sin equivalencia y sirve a las estadísticas por ámbito', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('pdf', { fuente: 'rfee_pdf', fecha: '2026-01-10' });
    f.prueba('skermo', { fuente: 'skermo_rfee', fecha: '2026-01-10' });
    f.resultado('pdf', UUID_A, 2); f.cuadro('pdf', 10, [2]);
    f.resultado('skermo', UUID_A, 2, 'skermo_rfee');
    f.asalto('skermo', UUID_A, UUID_B, 5, 0); f.asalto('skermo', UUID_A, UUID_B, 15, 3, 'TABLEAU');
    const filas = f.ejecutar<FilaPruebaRendimiento>(sqlPruebasRendimiento([UUID_A]));
    expect(filas).toHaveLength(2);
    const r = aRendimiento(filas);
    expect(r.vistas.todo.total).toMatchObject({ competiciones: 1, platas: 1 });
    expect(r.vistas.todo.total.asaltos.victorias).toBe(2);
    expect(r.vistas.todo.total.directa.victorias).toBe(1);
    expect(r.vistas.todo.evolucion[0].participantes).toBe(10);
    expect(aEstadisticasPorAmbito(filas).total).toMatchObject({ competiciones: 1, platas: 1, victorias: 2 });
  });
});

describe('cara a cara para las gráficas', () => {
  function pareja() {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(FUSIONADA, 'Ana Perez', UUID_A);
    f.persona(UUID_B, 'RUIZ Marta'); f.persona(UUID_C, 'GIL Eva');
    f.prueba('p1', { temporada: '2024-2025', fecha: '2024-11-01' });
    f.resultado('p1', UUID_A, 3); f.resultado('p1', UUID_B, 9); f.cuadro('p1', 24, [3, 9]);
    f.asalto('p1', UUID_A, UUID_B, 5, 3);
    f.asalto('p1', UUID_B, FUSIONADA, 15, 11, 'TABLEAU');
    f.asalto('p1', UUID_A, UUID_C, 5, 0);
    f.prueba('p2', { temporada: '2026', fuente: 'fie', fecha: '2026-01-20', equivalencia: 'cal-2' });
    f.prueba('p2b', { temporada: '2025-2026', fecha: '2026-01-20', equivalencia: 'cal-2' });
    f.resultado('p2', UUID_A, 12, 'fie'); f.resultado('p2', UUID_B, 2, 'fie'); f.cuadro('p2', 40, [2, 12]);
    f.resultado('p2b', UUID_A, 12); f.resultado('p2b', UUID_B, 2);
    f.asalto('p2', UUID_B, UUID_A, 2, 5);
    f.asalto('p2b', UUID_B, UUID_A, 2, 5);
    f.asalto('p2', UUID_A, UUID_B, 10, 15, 'TABLEAU');
    return f;
  }

  it('orienta los asaltos hacia «yo», acumula el balance y cuenta una sola fuente por equivalencia', () => {
    const f = pareja();
    const r = aRendimientoCaraACara(f.ejecutar<FilaCaraACaraRendimiento>(sqlCaraACaraRendimiento([UUID_A, FUSIONADA], [UUID_B])));
    expect(r.asaltos.map((a) => [a.mios, a.suyos, a.fase, a.balance])).toEqual([
      [5, 3, 'POULE', 1],
      [11, 15, 'TABLEAU', 0],
      [5, 2, 'POULE', 1],
      [10, 15, 'TABLEAU', 0],
    ]);
    expect(r.total).toMatchObject({ asaltos: 4, victorias: 2, derrotas: 2, dados: 31, recibidos: 35, porcentaje: 0.5 });
    expect(r.poule).toMatchObject({ victorias: 2, derrotas: 0 });
    expect(r.directa).toMatchObject({ victorias: 0, derrotas: 2 });
    expect(r.tocadosPorAsalto.yo).toBeCloseTo(31 / 4);
  });

  it('las pruebas comunes dicen quién acabó delante, una vez por equivalencia y con su cuadro', () => {
    const f = pareja();
    const r = aRendimientoCaraACara(f.ejecutar<FilaCaraACaraRendimiento>(sqlCaraACaraRendimiento([UUID_A, FUSIONADA], [UUID_B])));
    expect(r.pruebas.map((p) => [p.pruebaId, p.puestoYo, p.puestoRival, p.participantes, p.delante])).toEqual([
      ['p1', 3, 9, 24, 'yo'],
      ['p2', 12, 2, 40, 'rival'],
    ]);
    expect(r.delante).toEqual({ yo: 1, rival: 1, empate: 0 });
    expect(r.porTemporada.map((t) => [t.temporada, t.asaltos.victorias, t.asaltos.derrotas, t.delanteYo, t.delanteRival])).toEqual([
      ['2024-2025', 1, 1, 1, 0],
      ['2025-2026', 1, 1, 0, 1],
    ]);
  });

  it('una prueba repetida por dos fuentes sin equivalencia cuenta una vez', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('pdf', { fecha: '2026-01-10' });
    f.prueba('skermo', { fuente: 'skermo_rfee', fecha: '2026-01-10' });
    for (const p of ['pdf', 'skermo']) {
      f.resultado(p, UUID_A, 1); f.resultado(p, UUID_B, 2);
    }
    f.asalto('skermo', UUID_A, UUID_B, 15, 14, 'TABLEAU');
    const r = aRendimientoCaraACara(f.ejecutar<FilaCaraACaraRendimiento>(sqlCaraACaraRendimiento([UUID_A], [UUID_B])));
    expect(r.pruebas).toHaveLength(1);
    expect(r.pruebas[0].pruebaId).toBe('skermo');
    expect(r.total.asaltos).toBe(1);
  });

  it('entra por los índices de la pareja y de cada persona', () => {
    const f = fixture();
    const plan = f.plan(sqlCaraACaraRendimiento([UUID_A], [UUID_B]));
    // Con los dos lados fijados vale cualquiera de los dos índices, pero con las dos columnas.
    const ramas = plan.match(/sport_bout_[ab]_idx \(fencer_[ab]_person_id=\? AND fencer_[ab]_person_id=\?\)/g) ?? [];
    expect(ramas).toHaveLength(2);
    expect(plan).toMatch(/sport_result_person_date_idx/);
    expect(plan).not.toMatch(/SCAN (b|r)\b/);
  });
});

describe('entradas', () => {
  it('exigen sesión y validan los IDs', async () => {
    await expect(leerRendimiento(crearContexto({ perfil: null }).ctx, { personaId: UUID_A })).rejects.toThrow();
    expect(await leerRendimiento(crearContexto().ctx, { personaId: 'x' })).toEqual({ estado: 'entrada_invalida' });
    expect(await leerRendimientoCaraACara(crearContexto().ctx, { personaId: UUID_A })).toEqual({ estado: 'entrada_invalida' });
    expect(await leerRendimiento(crearContexto({ esquema: { identidad: false, referencias: true } }).ctx, { personaId: UUID_A }))
      .toEqual({ estado: 'no_disponible' });
  });
});
