import { DatabaseSync } from 'node:sqlite';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache } from '@/lib/cache/cache';
import { versionDe, type Dependencia } from '@/lib/cache/versiones';
import type { EdicionDeEvento, PruebaPasada } from '@/lib/queries/calendario-pasado-modelo';
import {
  crearEnlacesCalendario,
  destinoDeCompeticion,
  destinoDeEvento,
  destinoEnPruebas,
  leerEventoDeEdicion,
  soloConResultados,
  urlEventoCalendario,
  urlResultados,
} from '@/lib/sport/explorar/enlaces-calendario';
import { rutaPaisContraDe as rutaPaisContra, rutaPaisDe as rutaPais } from '@/lib/sport/explorar/enlace-pais';
import { crearContexto } from './helpers/explorar';

const EV = 'aaaaaaaa-0000-4000-8000-000000000001';
const ED1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const ED2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';
const P3 = 'cccccccc-0000-4000-8000-000000000003';

function prueba(id: string, edicionId: string, sobre: Partial<PruebaPasada> = {}): PruebaPasada {
  return {
    id, edicionId, fuente: 'fie', arma: 'ESPADA', genero: 'F', categoria: 'ABS', categoriaRaw: null,
    formato: 'INDIVIDUAL', fecha: '2026-03-01', conResultados: true, ganador: null, urlOficial: null, ...sobre,
  };
}

function edicion(edicionId: string, pruebas: PruebaPasada[]): EdicionDeEvento {
  return { edicionId, nombre: 'Copa', fuente: 'fie', inicio: '2026-03-01', fin: '2026-03-02', ciudad: null, pais: null, urlOficial: null, pruebas };
}

describe('calendario → resultados, lógica pura', () => {
  it('sólo cuentan las pruebas con puestos, y una edición sin ninguna desaparece', () => {
    const lista = soloConResultados([
      edicion(ED1, [prueba(P1, ED1), prueba(P2, ED1, { conResultados: false })]),
      edicion(ED2, [prueba(P3, ED2, { conResultados: false })]),
    ]);
    expect(lista.map((e) => e.edicionId)).toEqual([ED1]);
    expect(lista[0].pruebas.map((p) => p.id)).toEqual([P1]);
  });

  it('una edición con una prueba lleva a la prueba; con varias, a la edición; con varias ediciones, a la lista', () => {
    expect(destinoDeEvento([edicion(ED1, [prueba(P1, ED1)])])).toEqual({ edicionId: ED1, pruebaId: P1 });
    expect(destinoDeEvento([edicion(ED1, [prueba(P1, ED1), prueba(P2, ED1, { formato: 'EQUIPOS' })])])).toEqual({ edicionId: ED1, pruebaId: null });
    expect(destinoDeEvento([edicion(ED1, [prueba(P1, ED1)]), edicion(ED2, [prueba(P3, ED2)])])).toBeNull();
    expect(destinoDeEvento([])).toBeNull();
  });

  it('la prueba del calendario va a la suya exacta por arma, género, categoría y formato', () => {
    const ediciones = [
      edicion(ED1, [prueba(P1, ED1), prueba(P2, ED1, { genero: 'M', conResultados: false })]),
      edicion(ED2, [prueba(P3, ED2, { formato: 'EQUIPOS' })]),
    ];
    expect(destinoDeCompeticion({ weapon: 'ESPADA', gender: 'F', category: 'ABS', format: 'INDIVIDUAL' }, ediciones)).toEqual({ edicionId: ED1, pruebaId: P1 });
    expect(destinoDeCompeticion({ weapon: 'ESPADA', gender: 'F', category: 'ABS', format: 'EQUIPOS' }, ediciones)).toEqual({ edicionId: ED2, pruebaId: P3 });
    // Sin puestos no promete resultados.
    expect(destinoDeCompeticion({ weapon: 'ESPADA', gender: 'M', category: 'ABS', format: 'INDIVIDUAL' }, ediciones)).toBeNull();
    // La lista plana de la tarjeta del calendario da lo mismo.
    expect(destinoEnPruebas({ weapon: 'ESPADA', gender: 'F', category: 'ABS', format: 'EQUIPOS' }, ediciones.flatMap((e) => e.pruebas))).toEqual({ edicionId: ED2, pruebaId: P3 });
  });

  it('las direcciones conservan el calendario de origen y abren la ficha del torneo', () => {
    expect(urlResultados({ edicionId: ED1, pruebaId: P1 }, '/?mes=2026-03')).toBe(
      `/explorar/ediciones/${ED1}?prueba=${P1}&origen=${encodeURIComponent('/?mes=2026-03')}`,
    );
    expect(urlResultados({ edicionId: ED1, pruebaId: null })).toBe(`/explorar/ediciones/${ED1}`);
    expect(urlEventoCalendario({ id: EV, inicio: '2026-03-01' })).toBe(`/?mes=2026-03&evento=${EV}`);
    // El mes es el del torneo; la vista y los filtros, los del calendario del que se vino.
    expect(urlEventoCalendario({ id: EV, inicio: '2026-03-01' }, '/?vista=mes&mes=2025-11&armas=ESPADA')).toBe(
      `/?vista=mes&mes=2026-03&armas=ESPADA&evento=${EV}`,
    );
    expect(urlEventoCalendario({ id: EV, inicio: '2026-03-01' }, 'https://malo.example/?mes=2026-01')).toBe(`/?mes=2026-03&evento=${EV}`);
    expect(urlEventoCalendario({ id: 'no-es-un-id', inicio: '2026-03-01' })).toBeNull();
  });

  it('el país va por su código de la FIE y nunca a una bandera neutral', () => {
    expect(rutaPais('es')).toBe('/explorar/pais/ESP');
    expect(rutaPais('GER')).toBe('/explorar/pais/GER');
    expect(rutaPais('FIE')).toBeNull();
    expect(rutaPais(null)).toBeNull();
    expect(rutaPaisContra('ES', 'FR')).toBe('/explorar/pais/ESP/contra/FRA');
    expect(rutaPaisContra('ESP', 'ES')).toBeNull();
  });
});

/* ------------------------------------------------- el torneo de una edición */

function base() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE event (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, name TEXT, start_date TEXT, end_date TEXT, canonical_event_id TEXT);
    CREATE UNIQUE INDEX event_source_key ON event (source, source_id);
    CREATE TABLE event_competition (id TEXT PRIMARY KEY, event_id TEXT, source_id TEXT, weapon TEXT, gender TEXT, category TEXT, format TEXT);
    CREATE TABLE sport_edition (id TEXT PRIMARY KEY, event_id TEXT);
    CREATE TABLE sport_competition (id TEXT PRIMARY KEY, edition_id TEXT, source TEXT, season TEXT, competition_key TEXT,
      event_competition_id TEXT, weapon TEXT, gender TEXT, category TEXT, format TEXT);
  `);
  const dialecto = new SQLiteSyncDialect();
  const consultas: string[] = [];
  const db = {
    execute: (consulta: never) => {
      const { sql, params } = dialecto.sqlToQuery(consulta);
      consultas.push(sql);
      return Promise.resolve({ rows: sqlite.prepare(sql).all(...(params as never[])) });
    },
  };
  const meter = (tabla: string, fila: Record<string, string | null>) => {
    const columnas = Object.keys(fila);
    sqlite.prepare(`INSERT INTO ${tabla} (${columnas.join(',')}) VALUES (${columnas.map(() => '?').join(',')})`).run(...Object.values(fila));
  };
  return { db: db as never, meter, consultas };
}

const id = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const comp = { weapon: 'ESPADA', gender: 'F', category: 'ABS', format: 'INDIVIDUAL' };

describe('resultados → calendario: el torneo de una edición', () => {
  it('por la clave de la FIE, devolviendo la tarjeta que lo absorbió', async () => {
    const b = base();
    b.meter('event', { id: id(1), source: 'skermo_rfee', source_id: '9', name: 'Tarjeta', start_date: '2026-03-01', end_date: '2026-03-02', canonical_event_id: null });
    b.meter('event', { id: id(2), source: 'fie', source_id: 'fie-2026-186', name: 'Registro FIE', start_date: '2026-03-01', end_date: '2026-03-02', canonical_event_id: id(1) });
    b.meter('sport_edition', { id: ED1, event_id: null });
    b.meter('sport_competition', { id: P1, edition_id: ED1, source: 'fie', season: '2026', competition_key: '186', event_competition_id: null, ...comp });
    expect(await leerEventoDeEdicion(b.db, ED1)).toEqual({ id: id(1), nombre: 'Tarjeta', inicio: '2026-03-01', fin: '2026-03-02' });
    expect(b.consultas).toHaveLength(1);
  });

  it('por la clave de Skermo, con arma, género, categoría, formato y temporada', async () => {
    const b = base();
    b.meter('event', { id: id(3), source: 'skermo_rfee', source_id: '10158', name: 'TNR', start_date: '2025-11-08', end_date: '2025-11-09', canonical_event_id: null });
    b.meter('event_competition', { id: id(4), event_id: id(3), source_id: '10158', ...comp });
    b.meter('sport_edition', { id: ED1, event_id: null });
    b.meter('sport_competition', { id: P1, edition_id: ED1, source: 'skermo_rfee', season: '2025-2026', competition_key: 'RFEE:10158', event_competition_id: null, ...comp });
    expect((await leerEventoDeEdicion(b.db, ED1))?.id).toBe(id(3));

    // Otra categoría con el mismo número no es este torneo.
    b.meter('sport_edition', { id: ED2, event_id: null });
    b.meter('sport_competition', { id: P2, edition_id: ED2, source: 'skermo_rfee', season: '2025-2026', competition_key: 'RFEE:10158', event_competition_id: null, ...comp, category: 'M17' });
    expect(await leerEventoDeEdicion(b.db, ED2)).toBeNull();
  });

  it('por los vínculos guardados de la edición o de una prueba', async () => {
    const b = base();
    b.meter('event', { id: id(5), source: 'fie', source_id: 'fie-2027-1', name: 'Guardado', start_date: '2026-10-01', end_date: '2026-10-02', canonical_event_id: null });
    b.meter('event_competition', { id: id(6), event_id: id(5), source_id: null, ...comp });
    b.meter('sport_edition', { id: ED1, event_id: id(5) });
    b.meter('sport_edition', { id: ED2, event_id: null });
    b.meter('sport_competition', { id: P2, edition_id: ED2, source: 'engarde', season: '2026', competition_key: 'x', event_competition_id: id(6), ...comp });
    expect((await leerEventoDeEdicion(b.db, ED1))?.id).toBe(id(5));
    expect((await leerEventoDeEdicion(b.db, ED2))?.id).toBe(id(5));
  });

  it('sin torneo, o con un identificador que no lo es, nada', async () => {
    const b = base();
    expect(await leerEventoDeEdicion(b.db, ED1)).toBeNull();
    expect(await leerEventoDeEdicion(b.db, 'x')).toBeNull();
    expect(b.consultas).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------- caché */

function entorno() {
  const memoria = almacenMemoria();
  const cache = crearCache({
    almacen: () => memoria,
    versiones: { de: async (deps: readonly Dependencia[]) => versionDe({ ledger: 1 }, deps), olvidar() {} },
    esperar: () => {},
  });
  const llamadas = { ediciones: 0, evento: 0 };
  const enlaces = crearEnlacesCalendario({
    cache,
    fuentes: {
      edicionesDeEvento: async () => {
        llamadas.ediciones++;
        return [edicion(ED1, [prueba(P1, ED1)])];
      },
      eventoDeEdicion: async (edicionId) => {
        llamadas.evento++;
        return edicionId === ED1 ? { id: EV, nombre: 'Copa', inicio: '2026-03-01', fin: '2026-03-02' } : null;
      },
    },
  });
  return { enlaces, llamadas };
}

describe('calendario ↔ resultados con la caché compartida', () => {
  it('una lectura por torneo y por edición, también cuando no hay nada', async () => {
    const { enlaces, llamadas } = entorno();
    const ctx = crearContexto().ctx;
    const r = await enlaces.resultadosDeEvento(ctx, EV.toUpperCase());
    expect(r).toMatchObject({ tipo: 'ok', destino: { edicionId: ED1, pruebaId: P1 } });
    await enlaces.resultadosDeEvento(ctx, EV);
    expect(llamadas.ediciones).toBe(1);

    expect(await enlaces.eventoDeEdicion(ctx, ED1)).toMatchObject({ id: EV });
    expect(await enlaces.eventoDeEdicion(ctx, ED2)).toBeNull();
    expect(await enlaces.eventoDeEdicion(ctx, ED2)).toBeNull();
    expect(llamadas.evento).toBe(2);
  });

  it('sin sesión no se lee nada; una entrada que no es un torneo, tampoco', async () => {
    const { enlaces, llamadas } = entorno();
    const sin = crearContexto({ perfil: null }).ctx;
    expect(await enlaces.resultadosDeEvento(sin, EV)).toEqual({ tipo: 'sin_sesion' });
    expect(await enlaces.eventoDeEdicion(sin, ED1)).toBeNull();
    expect(await enlaces.resultadosDeEvento(crearContexto().ctx, 'nada')).toEqual({ tipo: 'entrada_invalida' });
    expect(llamadas).toEqual({ ediciones: 0, evento: 0 });
  });
});
