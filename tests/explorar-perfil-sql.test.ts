import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
  LIMITE_RIVALES_FRECUENTES,
  sqlBalanceAsaltos,
  sqlClubesRecientes,
  sqlIdFieConfirmado,
  sqlMejorRanking,
  sqlRivalesFrecuentes,
  type FilaBalanceAsaltos,
  type FilaClubPublicado,
  type FilaRivalFrecuente,
} from '@/lib/sport/explorar/perfil-sql';
import { clubLegible, enlaceFie } from '@/lib/sport/explorar/perfil-modelo';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

/**
 * Las consultas del perfil ejecutadas de verdad sobre SQLite (el mismo motor
 * que D1), con un esquema mínimo de las columnas que leen.
 */

const bases: DatabaseSync[] = [];
afterEach(() => bases.splice(0).forEach((db) => db.close()));

const FUSIONADA = '44444444-4444-4444-8444-444444444444';
const RIVAL_FUSIONADO = '55555555-5555-4555-8555-555555555555';

function fixture() {
  const db = new DatabaseSync(':memory:');
  bases.push(db);
  db.exec(`
    CREATE TABLE sport_person(id TEXT PRIMARY KEY, merged_into_person_id TEXT, display_name TEXT, country_code TEXT);
    CREATE TABLE sport_edition(id TEXT PRIMARY KEY, name TEXT, start_date TEXT);
    CREATE TABLE sport_competition(id TEXT PRIMARY KEY, edition_id TEXT, event_competition_id TEXT,
      season TEXT, format TEXT, competition_date TEXT);
    CREATE TABLE sport_bout(id TEXT PRIMARY KEY, competition_id TEXT, phase TEXT,
      fencer_a_person_id TEXT, fencer_b_person_id TEXT, score_a INTEGER, score_b INTEGER, occurred_on TEXT);
    CREATE INDEX sport_bout_a_idx ON sport_bout(fencer_a_person_id, fencer_b_person_id, occurred_on);
    CREATE INDEX sport_bout_b_idx ON sport_bout(fencer_b_person_id, fencer_a_person_id, occurred_on);
    CREATE TABLE sport_result(id TEXT PRIMARY KEY, competition_id TEXT, person_id TEXT, source TEXT,
      source_club TEXT, occurred_on TEXT);
    CREATE INDEX sport_result_person_date_idx ON sport_result(person_id, occurred_on);
    CREATE TABLE sport_external_id(person_id TEXT, scheme TEXT, value TEXT, scope_source TEXT, link_status TEXT);
    CREATE TABLE sport_ranking_publication(id TEXT PRIMARY KEY, source TEXT, season TEXT, weapon TEXT,
      category TEXT, category_raw TEXT, format TEXT, published_on TEXT, published_total INTEGER);
    CREATE TABLE sport_ranking_entry(id TEXT PRIMARY KEY, publication_id TEXT, person_id TEXT, position INTEGER);
    CREATE INDEX sport_ranking_entry_person_idx ON sport_ranking_entry(person_id, publication_id);
  `);
  const persona = (id: string, nombre: string, pais: string | null = 'ESP', fusion: string | null = null) =>
    db.prepare('INSERT INTO sport_person VALUES (?, ?, ?, ?)').run(id, fusion, nombre, pais);
  const prueba = (id: string, o: { temporada?: string; formato?: string; equivalencia?: string | null; fecha?: string; torneo?: string } = {}) => {
    db.prepare('INSERT INTO sport_edition VALUES (?, ?, ?)').run(id, o.torneo ?? `TORNEO ${id}`, o.fecha ?? '2026-03-01');
    db.prepare('INSERT INTO sport_competition VALUES (?, ?, ?, ?, ?, ?)').run(
      id, id, o.equivalencia ?? null, o.temporada ?? '2026', o.formato ?? 'INDIVIDUAL', o.fecha ?? '2026-03-01',
    );
  };
  let n = 0;
  const asalto = (competicion: string, a: string | null, b: string | null, sa: number, sb: number, fase = 'POULE', fecha: string | null = null) =>
    db.prepare('INSERT INTO sport_bout VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      `bout-${String(++n).padStart(4, '0')}`, competicion, fase, a, b, sa, sb, fecha,
    );
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
  return { db, persona, prueba, asalto, ejecutar, plan };
}

const balance = (filas: FilaBalanceAsaltos[], clase: string, extra: Partial<FilaBalanceAsaltos> = {}) =>
  filas.find((f) => f.clase === clase && Object.entries(extra).every(([k, v]) => f[k as keyof FilaBalanceAsaltos] === v));

describe('balance de asaltos del perfil', () => {
  it('orienta el marcador hacia la persona en las dos posiciones y separa poule, eliminación y empates', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta', 'FRA');
    f.prueba('p1');
    f.asalto('p1', UUID_A, UUID_B, 5, 3);
    f.asalto('p1', UUID_B, UUID_A, 5, 2);
    f.asalto('p1', UUID_A, UUID_B, 4, 4);
    f.asalto('p1', UUID_B, UUID_A, 10, 15, 'TABLEAU');
    const filas = f.ejecutar<FilaBalanceAsaltos>(sqlBalanceAsaltos([UUID_A]));
    expect(balance(filas, 'total')).toMatchObject({
      asaltos: 4, victorias: 2, derrotas: 1, empates: 1, tocadosDados: 26, tocadosRecibidos: 22,
    });
    expect(balance(filas, 'fase', { fase: 'POULE' })).toMatchObject({ asaltos: 3, victorias: 1, derrotas: 1 });
    expect(balance(filas, 'fase', { fase: 'TABLEAU' })).toMatchObject({ asaltos: 1, victorias: 1, derrotas: 0 });
  });

  it('suma los IDs fusionados, excluye equipos y lleva la temporada FIE a la deportiva', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(FUSIONADA, 'Ana Perez', 'ESP', UUID_A); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('fie', { temporada: '2025' });
    f.prueba('rfee', { temporada: '2024-2025' });
    f.prueba('equipos', { formato: 'EQUIPOS' });
    f.asalto('fie', UUID_A, UUID_B, 5, 1);
    f.asalto('rfee', FUSIONADA, UUID_B, 5, 2);
    f.asalto('equipos', UUID_A, UUID_B, 45, 40, 'TABLEAU');
    const filas = f.ejecutar<FilaBalanceAsaltos>(sqlBalanceAsaltos([UUID_A, FUSIONADA]));
    expect(balance(filas, 'total')).toMatchObject({ asaltos: 2, victorias: 2 });
    const temporadas = filas.filter((x) => x.clase === 'temporada');
    expect(temporadas).toEqual([expect.objectContaining({ temporada: '2024-2025', asaltos: 2 })]);
  });

  it('dos fuentes con equivalencia explícita no duplican asaltos; sin equivalencia sí cuentan las dos', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('fie', { equivalencia: 'cal-1' });
    f.prueba('pdf', { equivalencia: 'cal-1' });
    f.prueba('otra');
    f.asalto('fie', UUID_A, UUID_B, 5, 1);
    f.asalto('pdf', UUID_A, UUID_B, 5, 1);
    f.asalto('otra', UUID_A, UUID_B, 2, 5);
    const filas = f.ejecutar<FilaBalanceAsaltos>(sqlBalanceAsaltos([UUID_A]));
    expect(balance(filas, 'total')).toMatchObject({ asaltos: 2, victorias: 1, derrotas: 1 });
  });

  it('sin asaltos devuelve un total a cero que la pantalla presenta como «sin asaltos», y usa los índices de asalto', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    const filas = f.ejecutar<FilaBalanceAsaltos>(sqlBalanceAsaltos([UUID_A]));
    expect(filas).toEqual([expect.objectContaining({ clase: 'total', asaltos: 0, victorias: 0 })]);
    const plan = f.plan(sqlBalanceAsaltos([UUID_A]));
    expect(plan).toMatch(/sport_bout_a_idx/);
    expect(plan).toMatch(/sport_bout_b_idx/);
  });
});

describe('rivales frecuentes', () => {
  it('ordena por asaltos, junta al rival fusionado, guarda el último asalto y nunca se cuenta a sí misma', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    f.persona(FUSIONADA, 'Ana Perez', 'ESP', UUID_A);
    f.persona(UUID_B, 'RUIZ Marta', 'FRA');
    f.persona(RIVAL_FUSIONADO, 'Marta Ruiz', 'FRA', UUID_B);
    f.persona(UUID_C, 'ROSSI Giulia', 'ITA');
    f.prueba('p1', { fecha: '2026-01-10', torneo: 'COPA DEL MUNDO PARIS' });
    f.prueba('p2', { fecha: '2026-02-20', torneo: 'GRAND PRIX BUDAPEST' });
    f.asalto('p1', UUID_A, UUID_B, 5, 3);
    f.asalto('p2', RIVAL_FUSIONADO, FUSIONADA, 15, 11, 'TABLEAU');
    f.asalto('p1', UUID_A, UUID_B, 2, 5);
    f.asalto('p1', UUID_C, UUID_A, 1, 5);
    f.asalto('p1', UUID_A, null, 5, 0);
    const filas = f.ejecutar<FilaRivalFrecuente>(sqlRivalesFrecuentes([UUID_A, FUSIONADA], UUID_A));
    expect(filas.map((r) => r.id)).toEqual([UUID_B, UUID_C]);
    expect(filas[0]).toMatchObject({
      nombreRival: 'RUIZ Marta', paisRival: 'FRA', asaltos: 3, victorias: 1, derrotas: 2,
      ultimaFecha: '2026-02-20', ultimoFavor: 11, ultimoContra: 15, ultimoTorneo: 'GRAND PRIX BUDAPEST',
    });
    expect(filas[1]).toMatchObject({ asaltos: 1, victorias: 1, derrotas: 0 });
  });

  it('está acotada aunque haya muchos rivales', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    f.prueba('p1');
    for (let i = 0; i < LIMITE_RIVALES_FRECUENTES + 5; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      f.persona(id, `RIVAL ${i}`);
      f.asalto('p1', UUID_A, id, 5, i % 5);
    }
    expect(f.ejecutar(sqlRivalesFrecuentes([UUID_A], UUID_A))).toHaveLength(LIMITE_RIVALES_FRECUENTES);
  });
});

describe('club, enlace FIE y mejor ranking', () => {
  it('toma el club legible más reciente y salta los códigos de Skermo', () => {
    const f = fixture();
    f.prueba('vieja', { fecha: '2024-01-01' });
    f.prueba('media', { fecha: '2025-01-01' });
    f.prueba('nueva', { fecha: '2026-01-01' });
    const r = f.db.prepare('INSERT INTO sport_result VALUES (?, ?, ?, ?, ?, ?)');
    r.run('r1', 'vieja', UUID_A, 'rfee_pdf', 'CLUB ESGRIMA VIEJO', null);
    r.run('r2', 'media', UUID_A, 'rfee_pdf', 'Sala de Armas Valencia', null);
    r.run('r3', 'nueva', UUID_A, 'skermo_rfee', 'FED-M-C', null);
    r.run('r4', 'nueva', UUID_B, 'rfee_pdf', 'OTRO CLUB', null);
    const filas = f.ejecutar<FilaClubPublicado>(sqlClubesRecientes([UUID_A]));
    expect(filas.map((x) => x.club)).toEqual(['FED-M-C', 'Sala de Armas Valencia', 'CLUB ESGRIMA VIEJO']);
    expect(clubLegible(filas)).toEqual({ nombre: 'Sala de Armas Valencia', fuente: 'rfee_pdf', fecha: '2025-01-01' });
    expect(clubLegible([{ club: '100TO-C', fuente: 'skermo_rfee', fecha: null }])).toBeNull();
  });

  it('sólo enlaza la FIE con un único ID confirmado y nunca para un posible menor', () => {
    const f = fixture();
    const e = f.db.prepare('INSERT INTO sport_external_id VALUES (?, ?, ?, ?, ?)');
    e.run(UUID_A, 'fie_addr_id', '12345', 'fie', 'CONFIRMADO');
    e.run(UUID_A, 'fie_addr_id', '99999', 'fie', 'EN_REVISION');
    e.run(UUID_B, 'fie_addr_id', '111', 'fie', 'CONFIRMADO');
    e.run(UUID_B, 'fie_addr_id', '222', 'fie', 'CONFIRMADO');
    const a = f.ejecutar<{ valor: string }>(sqlIdFieConfirmado([UUID_A]));
    expect(enlaceFie(a, false)).toBe('https://fie.org/athletes/12345');
    expect(enlaceFie(a, true)).toBeNull();
    expect(enlaceFie(f.ejecutar<{ valor: string }>(sqlIdFieConfirmado([UUID_B])), false)).toBeNull();
    expect(enlaceFie([{ valor: '12a' }], false)).toBeNull();
  });

  it('el mejor ranking es el puesto más bajo individual, nunca un puesto nulo ni de equipos', () => {
    const f = fixture();
    const p = f.db.prepare('INSERT INTO sport_ranking_publication VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    p.run('pub-1', 'fie_tiradores', '2025', 'ESPADA', 'ABS', 'Senior', 'INDIVIDUAL', '2025-05-01', 300);
    p.run('pub-2', 'skermo_rfee', '2024-2025', 'ESPADA', 'M20', 'Junior', 'INDIVIDUAL', '2025-04-01', 80);
    p.run('pub-3', 'fie_tiradores', '2025', 'ESPADA', 'ABS', 'Senior', 'EQUIPOS', '2025-05-01', 40);
    const e = f.db.prepare('INSERT INTO sport_ranking_entry VALUES (?, ?, ?, ?)');
    e.run('e1', 'pub-1', UUID_A, 41);
    e.run('e2', 'pub-2', UUID_A, 3);
    e.run('e3', 'pub-3', UUID_A, 1);
    e.run('e4', 'pub-1', FUSIONADA, null);
    expect(f.ejecutar(sqlMejorRanking([UUID_A, FUSIONADA]))).toEqual([
      expect.objectContaining({ puesto: 3, fuente: 'skermo_rfee', temporada: '2024-2025', categoria: 'M20', total: 80 }),
    ]);
    expect(f.plan(sqlMejorRanking([UUID_A]))).toMatch(/sport_ranking_entry_person_idx/);
  });
});
