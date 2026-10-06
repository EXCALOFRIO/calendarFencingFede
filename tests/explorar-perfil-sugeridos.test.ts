import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
  LIMITE_SUGERIDOS,
  sqlTiradoresSugeridos,
  type FilaSugerido,
} from '@/lib/sport/explorar/sugeridos';
import { sqlBalanceAsaltos, type FilaBalanceAsaltos } from '@/lib/sport/explorar/perfil-sql';
import { aTiradoresSugeridos, motivoSugerido } from '@/lib/sport/explorar/perfil-modelo';
import { SugeridosPerfil, textoMotivo } from '@/components/explorar/perfil/sugeridos-perfil';
import { destacadosPerfil, mejorTemporada } from '@/components/explorar/perfil/destacados-perfil';
import type { PerfilDeportivo, TemporadaPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

/**
 * Tiradores sugeridos y rivales distintos, ejecutados de verdad sobre SQLite
 * (el motor de D1) con las columnas e índices que usan.
 */

const bases: DatabaseSync[] = [];
afterEach(() => bases.splice(0).forEach((db) => db.close()));

const FUSIONADA_A = '44444444-4444-4444-8444-444444444444';
const FUSIONADA_B = '55555555-5555-4555-8555-555555555555';
const UUID_D = '66666666-6666-4666-8666-666666666666';

function fixture() {
  const db = new DatabaseSync(':memory:');
  bases.push(db);
  db.exec(`
    CREATE TABLE sport_person(id TEXT PRIMARY KEY, merged_into_person_id TEXT, display_name TEXT, country_code TEXT);
    CREATE INDEX sport_person_merged_idx ON sport_person(merged_into_person_id);
    CREATE TABLE sport_edition(id TEXT PRIMARY KEY, name TEXT, start_date TEXT);
    CREATE TABLE sport_competition(id TEXT PRIMARY KEY, edition_id TEXT, event_competition_id TEXT,
      season TEXT, format TEXT, competition_date TEXT);
    CREATE TABLE sport_bout(id TEXT PRIMARY KEY, competition_id TEXT, phase TEXT,
      fencer_a_person_id TEXT, fencer_b_person_id TEXT, score_a INTEGER, score_b INTEGER, occurred_on TEXT);
    CREATE INDEX sport_bout_a_idx ON sport_bout(fencer_a_person_id, fencer_b_person_id, occurred_on);
    CREATE INDEX sport_bout_b_idx ON sport_bout(fencer_b_person_id, fencer_a_person_id, occurred_on);
    CREATE TABLE sport_result(id TEXT PRIMARY KEY, competition_id TEXT, person_id TEXT, position INTEGER,
      source TEXT, source_club TEXT, occurred_on TEXT);
    CREATE INDEX sport_result_person_date_idx ON sport_result(person_id, occurred_on);
    CREATE INDEX sport_result_competition_position_idx ON sport_result(competition_id, position);
  `);
  const persona = (id: string, nombre: string, fusion: string | null = null, pais = 'ESP') =>
    db.prepare('INSERT INTO sport_person VALUES (?, ?, ?, ?)').run(id, fusion, nombre, pais);
  const prueba = (id: string, o: { fecha?: string; formato?: string; equivalencia?: string | null } = {}) => {
    db.prepare('INSERT INTO sport_edition VALUES (?, ?, ?)').run(id, `TORNEO ${id}`, o.fecha ?? '2026-03-01');
    db.prepare('INSERT INTO sport_competition VALUES (?, ?, ?, ?, ?, ?)').run(
      id, id, o.equivalencia ?? null, '2026', o.formato ?? 'INDIVIDUAL', o.fecha ?? '2026-03-01');
  };
  let n = 0;
  const resultado = (competicion: string, personaId: string, puesto: number, club: string | null = null) =>
    db.prepare('INSERT INTO sport_result VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      `r-${++n}`, competicion, personaId, puesto, 'fie', club, null);
  const asalto = (competicion: string, a: string, b: string, sa: number, sb: number) =>
    db.prepare('INSERT INTO sport_bout VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      `b-${++n}`, competicion, 'POULE', a, b, sa, sb, null);
  function ejecutar<T>(consulta: SQL): T[] {
    const q = new SQLiteSyncDialect().sqlToQuery(consulta);
    expect(q.params.length).toBeLessThanOrEqual(100);
    return db.prepare(q.sql).all(...q.params as SQLInputValue[]) as T[];
  }
  function plan(consulta: SQL): string {
    const q = new SQLiteSyncDialect().sqlToQuery(consulta);
    return (db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params as SQLInputValue[]) as { detail: string }[])
      .map((f) => f.detail).join('\n');
  }
  return { persona, prueba, resultado, asalto, ejecutar, plan };
}

describe('tiradores sugeridos', () => {
  it('suma rivales y coincidencias de fichas fundidas en la que prevalece y nunca sugiere a la propia persona', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    f.persona(FUSIONADA_A, 'Ana Perez', UUID_A);
    f.persona(UUID_B, 'RUIZ Marta');
    f.persona(FUSIONADA_B, 'Marta Ruiz', UUID_B);
    f.persona(UUID_C, 'GIL Eva');
    f.prueba('p1', { fecha: '2026-01-10' });
    f.prueba('p2', { fecha: '2026-02-10' });
    f.resultado('p1', UUID_A, 1, 'CLUB ESGRIMA MADRID');
    f.resultado('p1', UUID_B, 2, 'CLUB ESGRIMA MADRID');
    f.resultado('p1', UUID_C, 3, 'OTRO CLUB');
    f.resultado('p2', FUSIONADA_A, 4);
    f.resultado('p2', FUSIONADA_B, 5);
    f.asalto('p1', UUID_A, UUID_B, 5, 3);
    f.asalto('p2', FUSIONADA_B, FUSIONADA_A, 5, 2);
    f.asalto('p2', UUID_B, FUSIONADA_A, 1, 5);

    const filas = f.ejecutar<FilaSugerido>(sqlTiradoresSugeridos([UUID_A, FUSIONADA_A], UUID_A));
    const ids = filas.map((x) => x.id);
    expect(ids).not.toContain(UUID_A);
    expect(ids).not.toContain(FUSIONADA_A);
    expect(ids).not.toContain(FUSIONADA_B);
    const marta = filas.find((x) => x.id === UUID_B);
    expect(marta).toMatchObject({ nombre: 'RUIZ Marta', asaltos: 3, victorias: 2, derrotas: 1, pruebas: 2, mismoClub: 1 });
    expect(marta?.club).toBe('CLUB ESGRIMA MADRID');
    // Eva sólo coincide en una prueba, sin asaltos ni club: no llega al mínimo.
    expect(ids).not.toContain(UUID_C);
    expect(ids[0]).toBe(UUID_B);
  });

  it('no cuenta asaltos por equipos ni duplica una prueba publicada por dos fuentes equivalentes', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(UUID_B, 'RUIZ Marta');
    f.prueba('fie', { equivalencia: 'cal-1' });
    f.prueba('pdf', { equivalencia: 'cal-1' });
    f.prueba('equipos', { formato: 'EQUIPOS' });
    f.asalto('fie', UUID_A, UUID_B, 5, 1);
    f.asalto('pdf', UUID_A, UUID_B, 5, 1);
    f.asalto('equipos', UUID_A, UUID_B, 45, 40);
    const [marta] = f.ejecutar<FilaSugerido>(sqlTiradoresSugeridos([UUID_A], UUID_A));
    expect(marta).toMatchObject({ id: UUID_B, asaltos: 1, victorias: 1, derrotas: 0 });
  });

  it('dos fichas fundidas en la misma prueba equivalente cuentan una vez; club de la más reciente; rival sólo por asaltos', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    f.persona(UUID_B, 'RUIZ Marta'); f.persona(FUSIONADA_B, 'Marta Ruiz', UUID_B);
    f.persona(UUID_C, 'GIL Eva');
    f.prueba('fie', { fecha: '2026-01-10', equivalencia: 'cal-1' });
    f.prueba('pdf', { fecha: '2026-01-10', equivalencia: 'cal-1' });
    f.prueba('p3', { fecha: '2026-02-10' });
    for (const p of ['fie', 'pdf', 'p3']) f.resultado(p, UUID_A, 1);
    f.resultado('fie', UUID_B, 2, 'CLUB VIEJO');
    f.resultado('pdf', FUSIONADA_B, 2, 'CLUB VIEJO');
    f.resultado('p3', UUID_B, 3, 'CLUB NUEVO');
    f.asalto('p3', UUID_A, UUID_C, 5, 4);
    const filas = f.ejecutar<FilaSugerido>(sqlTiradoresSugeridos([UUID_A], UUID_A));
    expect(filas.find((x) => x.id === UUID_B)).toMatchObject({ pruebas: 2, club: 'CLUB NUEVO', asaltos: 0, mismoClub: 0 });
    expect(filas.find((x) => x.id === UUID_C)).toMatchObject({ pruebas: 0, club: null, asaltos: 1, victorias: 1 });
  });

  it(`devuelve como mucho ${LIMITE_SUGERIDOS} personas`, () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana');
    f.prueba('p1');
    f.resultado('p1', UUID_A, 1);
    for (let i = 0; i < LIMITE_SUGERIDOS + 8; i += 1) {
      const id = `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`;
      f.persona(id, `RIVAL ${i}`);
      f.asalto('p1', UUID_A, id, 5, i % 5);
    }
    expect(f.ejecutar<FilaSugerido>(sqlTiradoresSugeridos([UUID_A], UUID_A))).toHaveLength(LIMITE_SUGERIDOS);
  });

  it('usa los índices por persona, por prueba y de asaltos, sin recorrer tablas enteras', () => {
    const f = fixture();
    const plan = f.plan(sqlTiradoresSugeridos([UUID_A, FUSIONADA_A], UUID_A));
    expect(plan).toContain('sport_result_person_date_idx');
    expect(plan).toContain('sport_result_competition_position_idx');
    expect(plan).toMatch(/sport_bout_a_idx/);
    expect(plan).toMatch(/sport_bout_b_idx/);
    expect(plan).not.toMatch(/SCAN (sport_result|sport_bout|sport_person)\b(?! USING)/);
  });
});

describe('rivales distintos en el balance', () => {
  it('cuenta una vez a un rival con dos fichas fundidas y no cuenta a la propia persona', () => {
    const f = fixture();
    f.persona(UUID_A, 'PEREZ Ana'); f.persona(FUSIONADA_A, 'Ana Perez', UUID_A);
    f.persona(UUID_B, 'RUIZ Marta'); f.persona(FUSIONADA_B, 'Marta Ruiz', UUID_B);
    f.persona(UUID_D, 'GIL Eva');
    f.prueba('p1');
    f.asalto('p1', UUID_A, UUID_B, 5, 3);
    f.asalto('p1', FUSIONADA_B, FUSIONADA_A, 5, 2);
    f.asalto('p1', UUID_A, UUID_D, 5, 4);
    const total = f.ejecutar<FilaBalanceAsaltos>(sqlBalanceAsaltos([UUID_A, FUSIONADA_A])).find((x) => x.clase === 'total');
    expect(total).toMatchObject({ asaltos: 3, rivales: 2 });
  });
});

describe('modelo y vista de las sugerencias', () => {
  const fila = (o: Partial<FilaSugerido>): FilaSugerido => ({
    id: UUID_B, nombre: 'RUIZ Marta', pais: 'ESP', club: null,
    asaltos: 0, victorias: 0, derrotas: 0, pruebas: 0, mismoClub: 0, ...o,
  });

  it('el motivo va del más fuerte al más débil y un código de Skermo no se enseña como club', () => {
    expect(motivoSugerido({ asaltos: 5, pruebas: 1, mismoClub: true })).toBe('rival_frecuente');
    expect(motivoSugerido({ asaltos: 2, pruebas: 1, mismoClub: true })).toBe('mismo_club');
    expect(motivoSugerido({ asaltos: 2, pruebas: 1, mismoClub: false })).toBe('asaltos');
    expect(motivoSugerido({ asaltos: 0, pruebas: 4, mismoClub: false })).toBe('pruebas');
    const [s] = aTiradoresSugeridos([fila({ club: 'FED-M-C', pruebas: 3 })]);
    expect(s.club).toBeNull();
    expect(textoMotivo(s)).toBe('Coinciden en 3 pruebas');
  });

  it('cada tarjeta enlaza a la ficha y al cara a cara, con el motivo y el balance en una pastilla corta', () => {
    const sugeridos = aTiradoresSugeridos([fila({ asaltos: 6, victorias: 4, derrotas: 2, club: 'Club Esgrima Madrid' })]);
    const html = renderToStaticMarkup(React.createElement(SugeridosPerfil, { personaId: UUID_A, sugeridos, nivel: 'pagina' }));
    expect(html).toContain(`href="/explorar/${UUID_B}"`);
    expect(html).toContain(`/explorar/${UUID_A}/cara-a-cara?rival=${UUID_B}`);
    expect(html).toContain('Rival frecuente · 4–2');
    expect(html).toContain('Marta Ruiz');
    // La foto la pide el cliente al verse (el servidor veta a posibles menores): en el HTML sólo hay iniciales y bandera.
    expect(html).not.toMatch(/<img(?![^>]*\/banderas\/)/);
    // Sin carrusel: rejilla que envuelve.
    expect(html).not.toMatch(/overflow-x|snap-x/);
  });

  it('sin sugerencias no pinta nada; si la lectura falla lo dice en corto', () => {
    const vacio = renderToStaticMarkup(React.createElement(SugeridosPerfil, { personaId: UUID_A, sugeridos: [], nivel: 'pagina' }));
    expect(vacio).toBe('');
    const fallo = renderToStaticMarkup(React.createElement(SugeridosPerfil, { personaId: UUID_A, sugeridos: null, nivel: 'pagina' }));
    expect(fallo).toContain('No se han podido cargar');
  });
});

describe('destacados del perfil', () => {
  const temporada = (t: string, oros: number, puesto: number | null): TemporadaPerfil => ({
    temporada: t, pruebas: 3, mejorPuesto: puesto,
    medallero: { oros, platas: 0, bronces: 0, finales: 0 }, asaltos: null,
  } as TemporadaPerfil);

  it('la mejor temporada es la de más medallas y con una sola no se destaca nada', () => {
    expect(mejorTemporada([temporada('2025-2026', 1, 1), temporada('2024-2025', 3, 2)])?.temporada).toBe('2024-2025');
    expect(mejorTemporada([temporada('2025-2026', 1, 1)])).toBeNull();
  });

  it('sólo lleva lo importado: los títulos de España del desglose por tipo, sin repetir el medallero de la cabecera', () => {
    const perfil = {
      resumen: { oros: 2, platas: 0, bronces: 1, finales: 3, pruebas: 10, conPuesto: 10, mejorPuesto: 1 },
      asaltos: null, temporadas: [], ranking: { actual: null, mejor: null },
    } as unknown as PerfilDeportivo;
    const lista = destacadosPerfil(perfil, [
      { tipo: 'CTO_ESPANA', clasificaciones: 2, mejorPuesto: 1, podios: 2, victorias: 1, sinPuestoNumerico: 0 },
    ] as never);
    expect(lista.map((d) => d.clave)).toEqual(['espana']);
    expect(lista.find((d) => d.clave === 'espana')).toMatchObject({ cifra: '1', rotulo: 'Campeón de España' });
  });
});
