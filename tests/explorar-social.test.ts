import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import {
  aEstadisticasRivales,
  leerEstadisticasRivales,
  sqlEstadisticasRivales,
  type FilaEstadisticasRivales,
} from '@/lib/sport/explorar/rivales-stats';
import { leerEstadisticasAmbito, sqlPruebasAmbito } from '@/lib/sport/explorar/stats-ambito';
import { clasificarCompeticion, etiquetaCategoria } from '@/lib/sport/explorar/tipo-competicion';
import {
  contarSiguiendo,
  leerFeedSiguiendo,
  sqlFeedSiguiendo,
} from '@/lib/sport/explorar/seguidos';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { crearContexto, perfil } from './helpers/explorar';

/**
 * Las lecturas sociales ejecutadas sobre el esquema D1 real (0000) en SQLite
 * en memoria: columnas, CHECK e índices son los de producción.
 */

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((c) => c()));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YO = uuid(1);
const YO_FUNDIDA = uuid(2);
const RIVAL = uuid(3);
const RIVAL_FUNDIDO = uuid(4);
const OTRO = uuid(5);
const TERCERO = uuid(6);
const CUENTA = '00000000-0000-4000-8000-0000000000a1';
const OTRA_CUENTA = '00000000-0000-4000-8000-0000000000b2';

function fixture() {
  const local = localD1();
  cierres.push(() => local.close());
  const database = createD1Database(local.binding);
  const dialecto = new SQLiteSyncDialect();
  const db = local.sqlite;
  let n = 0;
  const persona = (id: string, nombre: string, fusion: string | null = null) =>
    db.prepare('INSERT INTO sport_person(id, display_name, name_normalized, country_code, merged_into_person_id) VALUES (?,?,?,?,?)')
      .run(id, nombre, nombre.toLowerCase(), 'ESP', fusion);
  const prueba = (id: string, o: {
    fuente?: string; nombre?: string; fecha?: string; categoria?: string; formato?: string; pais?: string | null;
  } = {}) => {
    const fuente = o.fuente ?? 'fie';
    db.prepare('INSERT INTO sport_edition(id, source, season, tournament_key, name, start_date, country_code) VALUES (?,?,?,?,?,?,?)')
      .run(`ed-${id}`, fuente, '2026', id, o.nombre ?? 'Coupe du Monde', o.fecha ?? '2026-01-10', o.pais ?? null);
    db.prepare(`INSERT INTO sport_competition(id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, `ed-${id}`, fuente, '2026', id, 'ESPADA', 'M', o.categoria ?? 'ABS',
      o.formato ?? 'INDIVIDUAL', o.fecha ?? '2026-01-10');
  };
  const asalto = (competicion: string, a: string | null, b: string | null, sa: number, sb: number,
    fase: 'POULE' | 'TABLEAU' = 'POULE', fecha: string | null = null) => {
    n += 1;
    db.prepare(`INSERT INTO sport_bout(id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
      fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`bout-${String(n).padStart(4, '0')}`, competicion, 'fie', fase,
      `r${n}`, `a-${n}`, `b-${n}`, a, b, 'A', 'B', sa, sb, fecha, `h${n}`);
  };
  const resultado = (competicion: string, personaId: string | null, puesto: number | null, fecha: string | null = null,
    fuente = 'fie') => {
    n += 1;
    const id = `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
    db.prepare(`INSERT INTO sport_result(id, competition_id, source, source_fact_key, person_id, source_name, position, occurred_on, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, competicion, fuente, `f${n}`, personaId, 'X', puesto, fecha, `h${n}`);
    return id;
  };
  const cuenta = (id: string) => db.prepare('INSERT INTO user_profile(id, email, full_name, ical_token) VALUES (?,?,?,?)')
    .run(id, `${id}@example.test`, 'Cuenta sintética', `token-${id}`);
  const seguir = (cuentaId: string, personaId: string, creado: number) =>
    db.prepare('INSERT INTO sport_favorite(profile_id, person_id, created_at) VALUES (?,?,?)').run(cuentaId, personaId, creado);

  function ejecutar<T>(consulta: SQL): T[] {
    const q = dialecto.sqlToQuery(consulta);
    expect(q.params.length).toBeLessThanOrEqual(100);
    return db.prepare(q.sql).all(...(q.params as SQLInputValue[])) as T[];
  }
  function plan(consulta: SQL): string {
    const q = dialecto.sqlToQuery(consulta);
    return (db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...(q.params as SQLInputValue[])) as { detail: string }[])
      .map((f) => f.detail).join('\n');
  }
  function contexto(profileId: string | null = CUENTA): ContextoExplorador {
    return {
      ...crearContexto({ perfil: profileId ? perfil({ profileId }) : null }).ctx,
      db: { execute: (q: SQL) => database.execute(q) } as ContextoExplorador['db'],
    };
  }
  return { db, persona, prueba, asalto, resultado, cuenta, seguir, ejecutar, plan, contexto };
}

const rivales = (f: ReturnType<typeof fixture>, ids: string[], canonica: string) =>
  aEstadisticasRivales(f.ejecutar<FilaEstadisticasRivales>(sqlEstadisticasRivales(ids, canonica)));

describe('estadísticas por rival', () => {
  it('orienta el marcador, separa poule y directa, cuenta empates aparte y deriva la sangre fría', () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(RIVAL, 'RIVAL'); f.persona(OTRO, 'OTRO');
    f.prueba('p1');
    f.asalto('p1', YO, RIVAL, 5, 4);
    f.asalto('p1', RIVAL, YO, 5, 4);
    f.asalto('p1', YO, OTRO, 3, 3);
    f.asalto('p1', OTRO, YO, 10, 15, 'TABLEAU');
    f.asalto('p1', YO, RIVAL, 15, 14, 'TABLEAU');
    const r = rivales(f, [YO], YO);
    expect(r.total).toMatchObject({ asaltos: 5, victorias: 3, derrotas: 1, empates: 1, tocadosDados: 42, tocadosRecibidos: 36 });
    expect(r.total.porcentajeVictorias).toBeCloseTo(0.75);
    expect(r.poule).toMatchObject({ asaltos: 3, victorias: 1, derrotas: 1, empates: 1 });
    expect(r.eliminacion).toMatchObject({ asaltos: 2, victorias: 2, tocadosDados: 30, tocadosRecibidos: 24 });
    expect(r.sangreFria).toEqual({ asaltos: 3, victorias: 2, porcentaje: 2 / 3 });
    expect(r.rivalesDistintos).toBe(2);
    expect(r.rivales[0]).toMatchObject({
      rival: { id: RIVAL, nombre: 'RIVAL' }, asaltos: 3, victorias: 2, derrotas: 1, decididosPorUno: 3, ganadosPorUno: 2,
    });
  });

  it('las curiosidades eligen al rival correcto y respetan el mínimo de asaltos', () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(RIVAL, 'RIVAL'); f.persona(OTRO, 'OTRO'); f.persona(TERCERO, 'TERCERO');
    f.prueba('p1', { fecha: '2026-01-01' });
    f.prueba('p2', { fecha: '2026-02-01' });
    // RIVAL: V V D V V V (racha 3), mucho volumen.
    for (const [i, [a, b]] of ([[5, 1], [5, 2], [1, 5], [5, 0], [5, 3], [5, 4]] as const).entries()) {
      f.asalto(i < 3 ? 'p1' : 'p2', YO, RIVAL, a, b, 'POULE', i < 3 ? `2026-01-0${i + 1}` : `2026-02-0${i}`);
    }
    // OTRO: 3 derrotas en 3 asaltos.
    f.asalto('p1', OTRO, YO, 5, 2); f.asalto('p1', OTRO, YO, 5, 3); f.asalto('p2', OTRO, YO, 15, 10, 'TABLEAU');
    // TERCERO: una victoria muy amplia, sólo un asalto (no entra en las proporciones).
    f.asalto('p2', YO, TERCERO, 15, 2, 'TABLEAU');
    const c = Object.fromEntries(rivales(f, [YO], YO).curiosidades.map((x) => [x.clave, x]));
    expect(c.rivalMasHabitual.rival.id).toBe(RIVAL);
    expect(c.rivalMasHabitual.valor).toBe(6);
    expect(c.rivalMasDificil.rival.id).toBe(OTRO);
    expect(c.rivalMasDificil.valor).toBe(3);
    expect(c.masVictoriasContra.rival.id).toBe(RIVAL);
    expect(c.mejorRacha).toMatchObject({ valor: 3, rival: { id: RIVAL } });
    expect(c.mayorVictoria).toMatchObject({ valor: 13, rival: { id: TERCERO }, marcador: { favor: 15, contra: 2, pruebaId: 'p2' } });
    expect(c.masTocadosRecibidos.rival.id).toBe(OTRO);
    expect(c.masTocadosPorAsalto.rival.id).not.toBe(TERCERO);
    expect(c.duelosMasAjustados.rival.id).toBe(RIVAL);
    for (const x of Object.values(c)) expect(x.descripcion).not.toMatch(/undefined|NaN/);
  });

  it('un empate corta la racha y un empate en la curiosidad lo deshace el ID del rival', () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(RIVAL, 'RIVAL'); f.persona(OTRO, 'OTRO'); f.persona(TERCERO, 'TERCERO');
    f.prueba('p1', { fecha: '2026-01-01' });
    // RIVAL: V E V V D V → la mejor racha es 2.
    for (const [i, [a, b]] of ([[5, 0], [3, 3], [5, 0], [5, 0], [0, 1], [5, 0]] as const).entries()) {
      f.asalto('p1', YO, RIVAL, a, b, 'POULE', `2026-01-0${i + 1}`);
    }
    // Mismos tocados recibidos y mismos asaltos: gana el ID menor aunque se inserte después.
    f.asalto('p1', YO, TERCERO, 1, 5);
    f.asalto('p1', YO, OTRO, 0, 5);
    const r = rivales(f, [YO], YO);
    expect(r.rivales.find((x) => x.rival.id === RIVAL)?.mejorRacha).toBe(2);
    const c = Object.fromEntries(r.curiosidades.map((x) => [x.clave, x]));
    expect(c.mejorRacha).toMatchObject({ valor: 2, rival: { id: RIVAL } });
    expect(c.masTocadosRecibidos).toMatchObject({ valor: 5, rival: { id: OTRO } });
    expect(r.poule).toMatchObject({ asaltos: 8, victorias: 4, derrotas: 3, empates: 1 });
    expect(r.eliminacion.asaltos).toBe(0);
  });

  it('suma los IDs fundidos de ambos lados, ignora asaltos dentro del grupo, equipos y relevos', async () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(YO_FUNDIDA, 'YO bis', YO);
    f.persona(RIVAL, 'RIVAL'); f.persona(RIVAL_FUNDIDO, 'RIVAL bis', RIVAL);
    f.prueba('p1');
    f.prueba('eq', { formato: 'EQUIPOS' });
    f.asalto('p1', YO, RIVAL, 5, 3);
    f.asalto('p1', RIVAL_FUNDIDO, YO_FUNDIDA, 5, 1);
    f.asalto('p1', YO, YO_FUNDIDA, 5, 0);
    f.asalto('p1', YO, null, 5, 0);
    f.asalto('p1', YO, RIVAL, 45, 40, 'TABLEAU');
    f.asalto('eq', YO, RIVAL, 5, 2);
    const r = await leerEstadisticasRivales(f.contexto(), { personaId: YO_FUNDIDA });
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') return;
    expect(r.personaId).toBe(YO);
    expect(r.datos.rivalesDistintos).toBe(1);
    expect(r.datos.rivales).toEqual([expect.objectContaining({ rival: expect.objectContaining({ id: RIVAL }), asaltos: 2, victorias: 1, derrotas: 1 })]);
  });

  it('A contra B es el espejo de B contra A', () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(RIVAL, 'RIVAL');
    f.prueba('p1');
    f.asalto('p1', YO, RIVAL, 5, 4); f.asalto('p1', RIVAL, YO, 5, 1); f.asalto('p1', YO, RIVAL, 15, 9, 'TABLEAU');
    const a = rivales(f, [YO], YO).rivales[0];
    const b = rivales(f, [RIVAL], RIVAL).rivales[0];
    expect(a.rival.id).toBe(RIVAL);
    expect(b.rival.id).toBe(YO);
    expect([a.victorias, a.derrotas, a.tocadosDados, a.tocadosRecibidos, a.decididosPorUno])
      .toEqual([b.derrotas, b.victorias, b.tocadosRecibidos, b.tocadosDados, b.decididosPorUno]);
    expect(a.ganadosPorUno + b.ganadosPorUno).toBe(a.decididosPorUno);
  });

  it('entra por los dos índices de asaltos y nunca recorre la tabla', () => {
    const f = fixture();
    const plan = f.plan(sqlEstadisticasRivales([YO, YO_FUNDIDA], YO));
    expect(plan).toMatch(/SEARCH b USING INDEX sport_bout_a_idx/);
    expect(plan).toMatch(/SEARCH b USING INDEX sport_bout_b_idx/);
    expect(plan).not.toMatch(/SCAN (b|c|e|rp|sport_bout|sport_competition|sport_person)\b/);
  });

  it('exige sesión y valida la entrada', async () => {
    const f = fixture();
    await expect(leerEstadisticasRivales(f.contexto(null), { personaId: YO })).rejects.toThrow('NO_AUTENTICADO');
    expect(await leerEstadisticasRivales(f.contexto(), { personaId: 'x' })).toEqual({ estado: 'entrada_invalida' });
    expect(await leerEstadisticasRivales(f.contexto(), { personaId: YO })).toEqual({ estado: 'no_encontrada' });
  });
});

describe('tipo de competición', () => {
  const tipo = (nombre: string, fuente = 'fie', extra: Partial<Parameters<typeof clasificarCompeticion>[0]> = {}) =>
    clasificarCompeticion({ nombre, fuente, ...extra });

  it.each([
    ['Jeux Olympiques', 'fie', 'JUEGOS_OLIMPICOS', 'internacional'],
    ['Jeux Olympiques de la Jeunesse', 'fie', 'JUEGOS_MULTIDEPORTE', 'internacional'],
    ['Championnats du Monde', 'fie', 'CTO_MUNDO', 'internacional'],
    ['Champ du monde juniors-cadets', 'fie', 'CTO_MUNDO', 'internacional'],
    ['Championnats d’Europe juniors', 'fie', 'CTO_EUROPA', 'internacional'],
    ["Championnats d'Afrique", 'fie', 'CTO_CONTINENTAL', 'internacional'],
    ['Сhampionnats de la Méditerranée', 'fie', 'CTO_CONTINENTAL', 'internacional'],
    ['2019 Summer Universiades', 'fie', 'JUEGOS_MULTIDEPORTE', 'internacional'],
    ['Coupe du Monde par équipes', 'fie', 'COPA_MUNDO', 'internacional'],
    ['Grand Prix', 'fie', 'GRAN_PREMIO', 'internacional'],
    ['Tournoi satellite épée masculine', 'fie', 'SATELITE', 'internacional'],
    ['Satélite FIE Sabadell', 'rfee_pdf', 'SATELITE', 'internacional'],
    ['Copa del Mundo Segovia', 'rfee_pdf', 'COPA_MUNDO', 'internacional'],
    ['U23 European Circuit', 'rfee_pdf', 'CIRCUITO_EUROPEO', 'internacional'],
    ['Tournoi international', 'fie', 'INTERNACIONAL_OTRO', 'internacional'],
    ['CAMPEONATO DE ESPAÑA M-20', 'rfee_pdf', 'CTO_ESPANA', 'nacional'],
    ['Cto. España M-15', 'rfee_pdf', 'CTO_ESPANA', 'nacional'],
    ['CTO ESPAÑA ABSOLUTO 2019', 'skermo_rfee', 'CTO_ESPANA', 'nacional'],
    ['TNR ABS (1/3) Liga Plata', 'skermo_rfee', 'TNR', 'nacional'],
    ['TNR M-17 (2/2)', 'skermo_rfee', 'TNR', 'nacional'],
    ['LIGA PLATA (2ªJORNADA)', 'rfee_pdf', 'LIGA_CLUBES', 'nacional'],
    ['LIGA 4ª DIVISION (2ªJORNADA)', 'rfee_pdf', 'LIGA_CLUBES', 'nacional'],
    ['TLM VET +50', 'rfee_pdf', 'LIGA_MASTER', 'nacional'],
    ['TORNEO LIGA MASTER HARO', 'rfee_pdf', 'LIGA_MASTER', 'nacional'],
    ['Criteriun Nacional M-10', 'rfee_pdf', 'CRITERIUM', 'nacional'],
    ['Campeonato Autonómico de Madrid', 'skermo_regional', 'AUTONOMICO', 'nacional'],
    ['Trofeu Sant Jordi M15', 'skermo_rfee', 'NACIONAL_OTRO', 'nacional'],
  ])('%s (%s) → %s', (nombre, fuente, esperado, ambito) => {
    expect(tipo(nombre, fuente)).toMatchObject({ tipo: esperado, ambito });
  });

  it('el circuito documentado del calendario prevalece; uno no fiable no', () => {
    expect(tipo('Prueba X', 'fie', { circuitoEvento: 'SEN_GP', fuenteEvento: 'fie' }).tipo).toBe('GRAN_PREMIO');
    // Skermo refina por nombre los circuitos FIE: no prueba el tipo.
    expect(tipo('Prueba X', 'skermo_rfee', { circuitoEvento: 'SEN_GP', fuenteEvento: 'skermo_rfee' }).tipo).toBe('NACIONAL_OTRO');
  });

  it('una prueba sin tipo reconocible en el extranjero es internacional', () => {
    expect(tipo('Trofeo Ciudad', 'rfee_pdf', { pais: 'FRA' })).toMatchObject({ tipo: 'INTERNACIONAL_OTRO', ambito: 'internacional' });
    expect(tipo('Trofeo Ciudad', 'desconocida')).toMatchObject({ tipo: 'OTRO', ambito: 'nacional', tono: 'off' });
  });

  it('cada tipo tiene un token de color existente', () => {
    const tokens = new Set(['gold', 'primary', 'org-fie', 'org-efc', 'org-rfee', 'org-aut', 'off']);
    expect(tokens.has(tipo('Jeux Olympiques').tono)).toBe(true);
    expect(tipo('Jeux Olympiques').tono).toBe('gold');
    expect(tipo('TNR M20', 'rfee_pdf').tono).toBe('org-rfee');
    expect(etiquetaCategoria('M17')).toBe('M17');
    expect(etiquetaCategoria('XX')).toBe('XX');
  });
});

describe('estadísticas por ámbito y categoría', () => {
  it('separa internacional y nacional, por categoría y tipo, con medallas, finales y asaltos', async () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(YO_FUNDIDA, 'YO bis', YO); f.persona(RIVAL, 'RIVAL');
    f.prueba('cm', { nombre: 'Coupe du Monde', fecha: '2026-01-10' });
    f.prueba('mund', { nombre: 'Championnats du Monde juniors-cadets', categoria: 'M20', fecha: '2025-04-01' });
    f.prueba('tnr', { fuente: 'rfee_pdf', nombre: 'TNR ABS', fecha: '2026-02-01' });
    f.prueba('cto', { fuente: 'skermo_rfee', nombre: 'CAMPEONATO DE ESPAÑA M20', categoria: 'M20', fecha: '2026-03-01' });
    f.prueba('equipos', { formato: 'EQUIPOS' });
    f.resultado('cm', YO, 12);
    f.resultado('mund', YO_FUNDIDA, 3);
    f.resultado('tnr', YO, 1, null, 'rfee_pdf');
    f.resultado('cto', YO, 2, null, 'skermo_rfee');
    f.resultado('equipos', YO, 1);
    f.asalto('cm', YO, RIVAL, 5, 2); f.asalto('cm', RIVAL, YO, 15, 11, 'TABLEAU');
    f.asalto('tnr', YO, RIVAL, 15, 10, 'TABLEAU');
    const r = await leerEstadisticasAmbito(f.contexto(), { personaId: YO });
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') return;
    const d = r.datos;
    expect(d.total).toMatchObject({ competiciones: 4, oros: 1, platas: 1, bronces: 1, medallas: 3, finales: 3, mejorPuesto: 1 });
    expect(d.internacional).toMatchObject({
      competiciones: 2, bronces: 1, mejorPuesto: 3, asaltos: 2, victorias: 1, derrotas: 1, indiceTocados: -1,
      tocadosDados: 16, tocadosRecibidos: 17,
    });
    expect(d.internacional.porcentajeVictorias).toBeCloseTo(0.5);
    expect(d.internacional.porCategoria.map((c) => [c.clave, c.competiciones])).toEqual([['ABS', 1], ['M20', 1]]);
    expect(d.nacional).toMatchObject({ competiciones: 2, oros: 1, platas: 1, victorias: 1, indiceTocados: 5 });
    expect(d.porCategoria.map((c) => [c.clave, c.etiqueta, c.competiciones]))
      .toEqual([['ABS', 'Absoluto', 2], ['M20', 'M20', 2]]);
    expect(d.porTipo.map((t) => [t.clave, t.competiciones, t.tono])).toEqual([
      ['CTO_MUNDO', 1, 'primary'], ['COPA_MUNDO', 1, 'org-fie'], ['CTO_ESPANA', 1, 'org-rfee'], ['TNR', 1, 'org-rfee'],
    ]);
    expect(d.truncado).toBe(false);
  });

  it('dos puestos contradictorios del mismo grupo en una prueba no cuentan como puesto', () => {
    const f = fixture();
    f.persona(YO, 'YO'); f.persona(YO_FUNDIDA, 'YO bis', YO);
    f.prueba('cm');
    f.resultado('cm', YO, 1); f.resultado('cm', YO_FUNDIDA, 5);
    const filas = f.ejecutar<{ puesto: number | null }>(sqlPruebasAmbito([YO, YO_FUNDIDA]));
    expect(filas).toEqual([expect.objectContaining({ puesto: null })]);
  });

  it('lee resultados y asaltos por sus índices de persona', () => {
    const f = fixture();
    const plan = f.plan(sqlPruebasAmbito([YO]));
    expect(plan).toMatch(/SEARCH r USING INDEX sport_result_person_date_idx/);
    expect(plan).toMatch(/SEARCH b USING INDEX sport_bout_a_idx/);
    expect(plan).toMatch(/SEARCH b USING INDEX sport_bout_b_idx/);
    expect(plan).not.toMatch(/SCAN (r|b|c|e|sport_result|sport_bout|sport_competition)\b/);
  });
});

describe('Siguiendo', () => {
  function conSeguidas() {
    const f = fixture();
    f.cuenta(CUENTA); f.cuenta(OTRA_CUENTA);
    f.persona(YO, 'YO'); f.persona(YO_FUNDIDA, 'YO bis', YO);
    f.persona(RIVAL, 'RIVAL'); f.persona(OTRO, 'OTRO');
    const ids: Record<string, string> = {};
    for (let i = 1; i <= 9; i++) {
      const fecha = `2026-0${i}-15`;
      f.prueba(`p${i}`, { fecha, fuente: i % 3 === 0 ? 'rfee_pdf' : 'fie', nombre: i % 3 === 0 ? 'TNR ABS' : 'Coupe du Monde' });
      // Las de rfee_pdf no publican fecha en el resultado: toma la de la prueba.
      ids[`yo${i}`] = f.resultado(`p${i}`, YO, i, i % 3 === 0 ? null : fecha);
      ids[`rival${i}`] = f.resultado(`p${i}`, RIVAL, 10 + i, i % 3 === 0 ? null : fecha);
      f.resultado(`p${i}`, OTRO, 20 + i, fecha);
    }
    // Copia del mismo puesto en la misma prueba con el ID fundido: sale una vez.
    f.resultado('p5', YO_FUNDIDA, 5, '2026-05-15');
    f.seguir(CUENTA, YO_FUNDIDA, 1000);
    f.seguir(CUENTA, RIVAL, 2000);
    f.seguir(OTRA_CUENTA, OTRO, 3000);
    return { f, ids };
  }

  async function todas(ctx: ContextoExplorador, extra: Record<string, unknown>) {
    const vistas: EntradaSiguiendo[] = [];
    let cursor: string | undefined;
    for (let paginas = 0; paginas < 20; paginas++) {
      const r = await leerFeedSiguiendo(ctx, { ...extra, ...(cursor ? { cursor } : {}) });
      if (r.estado !== 'ok') throw new Error(r.estado);
      vistas.push(...r.items);
      if (!r.siguiente) return vistas;
      cursor = r.siguiente;
    }
    throw new Error('demasiadas páginas');
  }

  it('sólo muestra a las seguidas por la cuenta de la sesión, sin repetir ni perder entre páginas', async () => {
    const { f } = conSeguidas();
    const vistas = await todas(f.contexto(), { limite: 2 });
    expect(vistas).toHaveLength(18);
    expect(new Set(vistas.map((v) => v.id)).size).toBe(18);
    expect(new Set(vistas.map((v) => v.persona.id))).toEqual(new Set([YO, RIVAL]));
    const fechas = vistas.map((v) => v.fecha ?? '');
    expect(fechas).toEqual([...fechas].sort().reverse());
    expect(vistas.filter((v) => v.prueba.id === 'p5' && v.persona.id === YO)).toHaveLength(1);
    const otra = await todas(f.contexto(OTRA_CUENTA), {});
    expect(otra.every((v) => v.persona.id === OTRO)).toBe(true);
    expect(otra).toHaveLength(9);
  });

  it('el mismo resultado con cualquier tamaño de página (ventana y repetición sin ventana)', async () => {
    const { f } = conSeguidas();
    const referencia = (await todas(f.contexto(), { limite: 50 })).map((v) => v.id);
    for (const limite of [1, 3, 4, 7]) {
      expect((await todas(f.contexto(), { limite })).map((v) => v.id)).toEqual(referencia);
    }
  });

  it('medallas, clasificación y participantes', async () => {
    const { f } = conSeguidas();
    const medallas = await todas(f.contexto(), { soloMedallas: true, limite: 1 });
    expect(medallas.map((m) => [m.prueba.id, m.medalla])).toEqual([['p3', 'bronce'], ['p2', 'plata'], ['p1', 'oro']]);
    expect(medallas[0]).toMatchObject({ participantes: 3, clasificacion: { tipo: 'TNR', ambito: 'nacional' } });
    expect(medallas[1].clasificacion).toMatchObject({ tipo: 'COPA_MUNDO', tono: 'org-fie' });
  });

  it('un cursor de otra cuenta o de otro filtro no sirve', async () => {
    const { f } = conSeguidas();
    const r = await leerFeedSiguiendo(f.contexto(), { limite: 1 });
    if (r.estado !== 'ok' || !r.siguiente) throw new Error('sin cursor');
    expect(await leerFeedSiguiendo(f.contexto(OTRA_CUENTA), { cursor: r.siguiente, limite: 1 })).toEqual({ estado: 'cursor_invalido' });
    expect(await leerFeedSiguiendo(f.contexto(), { cursor: r.siguiente, limite: 1, soloMedallas: true })).toEqual({ estado: 'cursor_invalido' });
    expect(await leerFeedSiguiendo(f.contexto(), { cuenta: OTRA_CUENTA })).toEqual({ estado: 'entrada_invalida' });
    await expect(leerFeedSiguiendo(f.contexto(null), {})).rejects.toThrow('NO_AUTENTICADO');
  });

  it('cuenta personas raíz distintas de la cuenta', async () => {
    const { f } = conSeguidas();
    f.seguir(CUENTA, YO, 1500);
    expect(await contarSiguiendo(f.contexto())).toEqual({ estado: 'ok', siguiendo: 2 });
    expect(await contarSiguiendo(f.contexto(OTRA_CUENTA))).toEqual({ estado: 'ok', siguiendo: 1 });
  });

  it('entra por la cuenta y por el índice de resultados de cada persona', () => {
    const f = fixture();
    for (const clave of [null, ['2026-05-15', uuid(9)] as [string, string]]) {
      for (const soloMedallas of [false, true]) {
        const plan = f.plan(sqlFeedSiguiendo(CUENTA, 25, clave, soloMedallas));
        expect(plan).toMatch(/SEARCH f USING (COVERING )?INDEX (sport_favorite_profile_idx|sqlite_autoindex_sport_favorite_1) \(profile_id=\?/);
        expect(plan).toMatch(/SEARCH r USING (COVERING )?INDEX sport_result_person_date_idx \(person_id=\?/);
        expect(plan).not.toMatch(/SCAN (f|r|r2|sport_result|sport_favorite)\b/);
      }
    }
  });
});
