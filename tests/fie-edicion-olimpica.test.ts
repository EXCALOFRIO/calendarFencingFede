import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import type { Db } from '@/db';
import type { DepsEvidencia } from '@/lib/entries/evidencia';
import { claveEdicionFie, persistirLecturaFie, type DepsPersistenciaFie } from '@/lib/ingest/fie-resultados-persist';
import { claveEdicionSerieSinTorneo } from '@/lib/ingest/series-complementarias';
import { leerPruebaFie, type DepsLecturaFie, type PruebaFie } from '@/lib/ingest/sources/fie-resultados';
import { leerEdicion, leerSeries } from '@/lib/sport/explorar/ediciones';
import { crearContexto } from './helpers/explorar';

vi.mock('@/db', () => ({ db: {} }));
const { crearDepsPersistenciaFieDb } = await import('@/lib/ingest/fie-resultados-db');

/**
 * Los Juegos de París publican `tournamentId: null`. Individual (246) y equipos
 * (250) deben acabar en UNA edición olímpica 2024. El almacén es una simulación
 * del contrato de claves de `sport_edition`/`sport_competition`: demuestra el
 * SQL generado y la orquestación, no su ejecución en Neon.
 */

type Fixture = { respuestas: Record<string, unknown> };
const cargar = (nombre: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/fie-resultados/${nombre}.json`, import.meta.url), 'utf8'));

const lector = (fx: Fixture): DepsLecturaFie => ({
  async fetchJson(url) {
    if (!(url in fx.respuestas)) throw new Error(`HTTP 404 al pedir ${url}`);
    return structuredClone(fx.respuestas[url]);
  },
});

type Edicion = {
  id: string;
  clave: string;
  season: string;
  nombre: string;
  inicio: string | null;
  fin: string | null;
  ciudad: string | null;
  sentencias: number;
};
type Prueba = { id: string; edicionId: string; clave: string; formato: string; fecha: string | null };

/** Cliente Neon falso que aplica las claves únicas de `sport_edition` y `sport_competition`. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function almacenSql() {
  const ediciones = new Map<string, Edicion>();
  const pruebas = new Map<string, Prueba>();
  let n = 0;
  const cliente = Object.assign(
    async (sql: string, params: unknown[], opciones?: { arrayMode?: boolean }) => {
      let filas: unknown[] = [];
      if (/insert into "sport_edition"/i.test(sql)) {
        const [source, season, clave, nombre, inicio, fin, ciudad] = params as string[];
        const k = `${source}|${season}|${clave}`;
        const previa = ediciones.get(k);
        const agrupa = /least\(/i.test(sql) && /greatest\(/i.test(sql);
        const menor = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);
        const mayor = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);
        const fila: Edicion = {
          id: previa?.id ?? uuid(n += 1),
          clave,
          season,
          nombre,
          inicio: previa && agrupa ? menor(previa.inicio, inicio) : inicio,
          fin: previa && agrupa ? mayor(previa.fin, fin) : fin,
          ciudad,
          sentencias: (previa?.sentencias ?? 0) + 1,
        };
        ediciones.set(k, fila);
        filas = [{ id: fila.id }];
      } else if (/insert into "sport_competition"/i.test(sql)) {
        const [edicionId, source, season, clave] = params as string[];
        const k = `${source}|${season}|${clave}`;
        // Parámetros: edition_id, source, season, competition_key, weapon, gender, category,
        // category_raw, format, competition_date, source_url (id/event_competition_id van `default`).
        const formato = params[8] as string;
        const fecha = params[9] as string | null;
        const previa = pruebas.get(k);
        pruebas.set(k, { id: previa?.id ?? uuid(n += 1), edicionId, clave, formato, fecha });
        filas = [{ id: pruebas.get(k)!.id }];
      }
      return opciones?.arrayMode ? { rows: filas.map((f) => Object.values(f as object)), fields: [] } : { rows: filas, fields: [] };
    },
    { transaction: async () => [] },
  );
  const db = drizzle(cliente as never, { schema }) as unknown as Db;
  return { db, ediciones, pruebas };
}

function depsSimuladas(db: Db) {
  const resultados = new Map<string, { source_name: string; position: number | null; person_id: string | null; competitionId: string }[]>();
  const asaltos = new Map<string, number>();
  const evidencia: DepsEvidencia = {
    esquema: async () => ({ identidad: true, referencias: true }),
    atletasPorLicencia: async () => [],
    fichasFie: async () => [],
    externos: async () => [],
    personas: async (ids) => new Map(ids.map((id) => [id, { athleteId: null, mergedIntoPersonId: null }])),
  };
  let personas = 0;
  const deps: DepsPersistenciaFie = {
    esquema: async () => ({ identidad: true, referencias: true }),
    evidencia,
    guard: { confirmar: async () => true, conflictos: async () => [] },
    nuevoId: () => `persona-${(personas += 1)}`,
    upsertPrueba: crearDepsPersistenciaFieDb(db).upsertPrueba,
    async upsertResultados(competitionId, filas) {
      resultados.set(
        competitionId,
        filas.map((f) => ({ source_name: f.sourceName, position: f.position, person_id: f.personId, competitionId })),
      );
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    async upsertAsaltos(competitionId, filas) {
      asaltos.set(competitionId, (asaltos.get(competitionId) ?? 0) + filas.length);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    async upsertCobertura() {},
  };
  return { deps, resultados, asaltos };
}

const prueba = (extra: Partial<PruebaFie> = {}): PruebaFie => ({
  season: 2024,
  competitionId: 246,
  tournamentId: null,
  nombre: 'Jeux Olympiques',
  ciudad: 'Paris',
  federacion: 'FRA',
  inicio: '2024-07-27',
  fin: '2024-07-27',
  arma: 'SABLE',
  genero: 'M',
  categoria: 'ABS',
  categoriaOriginal: 'S',
  formato: 'INDIVIDUAL',
  fecha: '2024-07-27',
  url: 'https://fie.org/competitions/2024/246',
  ...extra,
});

describe('clave de edición de las pruebas FIE sin tournamentId', () => {
  it('individual y equipos de París comparten edición olímpica; la temporada sigue en la clave natural', () => {
    const individual = claveEdicionFie(prueba());
    const equipos = claveEdicionFie(prueba({ competitionId: 250, formato: 'EQUIPOS' }));
    expect(individual).toEqual({ clave: 'juegos_olimpicos|c:paris', agrupaPruebas: true });
    expect(equipos).toEqual(individual);
  });

  it('un tournamentId publicado se conserva sin tocar', () => {
    expect(claveEdicionFie(prueba({ tournamentId: 107 }))).toEqual({ clave: '107', agrupaPruebas: false });
  });

  it('distingue localidad y serie: otra ciudad u otra serie no comparten clave', () => {
    const paris = claveEdicionFie(prueba()).clave;
    expect(claveEdicionFie(prueba({ ciudad: 'Tokyo' })).clave).not.toBe(paris);
    const jm = claveEdicionFie(prueba({ nombre: 'Juegos Mediterráneos', ciudad: 'Paris' })).clave;
    const cm = claveEdicionFie(prueba({ nombre: 'Campeonato del Mediterráneo', ciudad: 'Paris' })).clave;
    expect(new Set([paris, jm, cm]).size).toBe(3);
  });

  it('sin serie reconocida, sin ciudad o juvenil cada prueba queda como su propia edición', () => {
    for (const extra of [
      { nombre: 'Grand Prix de Paris' },
      { ciudad: null },
      { ciudad: '  ' },
      { nombre: 'Jeux Olympiques de la Jeunesse' },
    ]) {
      expect(claveEdicionFie(prueba(extra))).toEqual({ clave: 'competition:246', agrupaPruebas: false });
    }
  });

  it('la categoría JO publicada basta aunque el nombre no diga «Olímpicos»', () => {
    expect(claveEdicionFie(prueba({ nombre: 'Paris 2024', categoriaCompeticion: 'JO' })).clave).toBe(
      claveEdicionSerieSinTorneo({ nombre: 'Jeux Olympiques', ciudad: 'Paris' }),
    );
  });
});

describe('París 2024: persistir individual y equipos → una edición → clasificación', () => {
  async function persistirAmbas() {
    const sql = almacenSql();
    const s = depsSimuladas(sql.db);
    const individual = await persistirLecturaFie(s.deps, await leerPruebaFie(2024, 246, lector(cargar('paris-2024-246'))));
    const equipos = await persistirLecturaFie(s.deps, await leerPruebaFie(2024, 250, lector(cargar('paris-2024-250-equipos'))));
    return { sql, s, individual, equipos };
  }

  it('las dos pruebas cuelgan de la misma edición con las fechas de ambas', async () => {
    const { sql, individual, equipos } = await persistirAmbas();
    expect([...sql.ediciones.values()]).toHaveLength(1);
    const [edicion] = [...sql.ediciones.values()];
    expect(edicion).toMatchObject({
      clave: 'juegos_olimpicos|c:paris',
      season: '2024',
      nombre: 'Jeux Olympiques',
      inicio: '2024-07-27',
      fin: '2024-08-04',
    });
    expect([...sql.pruebas.values()].map((p) => [p.clave, p.formato, p.edicionId])).toEqual([
      ['246', 'INDIVIDUAL', edicion.id],
      ['250', 'EQUIPOS', edicion.id],
    ]);
    expect(individual.competitionId).not.toBe(equipos.competitionId);
  });

  it('el orden de lectura no cambia la edición ni sus fechas, y repetir no duplica', async () => {
    const sql = almacenSql();
    const s = depsSimuladas(sql.db);
    for (const [id, fx] of [[250, 'paris-2024-250-equipos'], [246, 'paris-2024-246'], [250, 'paris-2024-250-equipos']] as const) {
      await persistirLecturaFie(s.deps, await leerPruebaFie(2024, id, lector(cargar(fx))));
    }
    expect([...sql.ediciones.values()]).toHaveLength(1);
    expect([...sql.pruebas.values()]).toHaveLength(2);
    expect([...sql.ediciones.values()][0]).toMatchObject({ inicio: '2024-07-27', fin: '2024-08-04' });
  });

  it('el SQL sólo ensancha fechas en ediciones compartidas y no cambia las claves de competencia ni hechos', async () => {
    const consultas: string[] = [];
    const cliente = Object.assign(
      async (sql: string, _p: unknown[], o?: { arrayMode?: boolean }) => {
        consultas.push(sql);
        return o?.arrayMode ? { rows: [['id-1']], fields: [] } : { rows: [{ id: 'id-1' }], fields: [] };
      },
      { transaction: async () => [] },
    );
    const db = drizzle(cliente as never, { schema }) as unknown as Db;
    const deps = crearDepsPersistenciaFieDb(db);
    await deps.upsertPrueba(prueba());
    await deps.upsertPrueba(prueba({ tournamentId: 107 }));
    const [olimpica, torneo] = consultas.filter((c) => /insert into "sport_edition"/i.test(c));
    expect(olimpica).toMatch(/"start_date" = least\(/i);
    expect(olimpica).toMatch(/"end_date" = greatest\(/i);
    expect(torneo).toMatch(/"start_date" = excluded\.start_date/i);
    expect(torneo).not.toMatch(/least\(|greatest\(/i);
    for (const c of consultas.filter((c) => /insert into "sport_competition"/i.test(c))) {
      expect(c).toMatch(/on conflict \("source",\s*"season",\s*"competition_key"\)/i);
    }
  });

  it('el lector devuelve ambas pruebas en la edición y conserva puestos individuales y de equipo', async () => {
    const { sql, s } = await persistirAmbas();
    const [edicion] = [...sql.ediciones.values()];
    const del = [...sql.pruebas.values()].filter((p) => p.edicionId === edicion.id);
    const [individual, equipos] = del;

    const filaEdicion = {
      id: edicion.id,
      nombre: edicion.nombre,
      temporada: edicion.season,
      fuente: 'fie',
      ciudad: edicion.ciudad,
      pais: 'FRA',
      inicio: edicion.inicio,
      fin: edicion.fin,
      pruebas: del.length,
      armas: 'FLORETE,SABLE',
      formatos: 'EQUIPOS,INDIVIDUAL',
    };
    const filasPrueba = del.map((p) => ({
      id: p.id,
      edicionId: p.edicionId,
      arma: p.formato === 'EQUIPOS' ? 'FLORETE' : 'SABLE',
      genero: 'M',
      categoria: 'ABS',
      categoriaRaw: 'S',
      formato: p.formato,
      fecha: p.fecha,
      fuente: 'fie',
      pruebaCalendarioId: null,
      importados: s.resultados.get(p.id)?.length ?? 0,
    }));
    const puestos = (id: string) =>
      (s.resultados.get(id) ?? [])
        .slice()
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        .map((r, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          puesto: r.position,
          puestoPublicado: r.position === null ? null : String(r.position),
          nombre: r.source_name,
          pais: null,
          club: null,
          personaId: r.person_id,
        }));
    const leer = async (prueba: string) => {
      const { ctx } = crearContexto({
        respuestas: [
          { cuando: /WHERE e\.id = /, filas: [filaEdicion] },
          { cuando: /c\.format::text AS formato/, filas: filasPrueba },
          { cuando: /GROUP BY r\.source/, filas: [{ fuente: 'fie', n: s.resultados.get(prueba)?.length ?? 0 }] },
          { cuando: /FROM sport_result r\s+WHERE r\.competition_id/, filas: puestos(prueba) },
        ],
      });
      const r = await leerEdicion(ctx, { edicionId: edicion.id, prueba });
      if (r.estado !== 'ok') throw new Error('se esperaba ok');
      return r.edicion;
    };

    const ind = await leer(individual.id);
    expect(ind.serie).toBe('juegos_olimpicos');
    expect(ind.pruebas).toBe(2);
    expect(ind.pruebasDetalle.map((p) => p.formato).sort()).toEqual(['EQUIPOS', 'INDIVIDUAL']);
    expect(ind.clasificacion?.filas).toHaveLength(34);
    expect(ind.clasificacion?.filas.map((f) => f.puesto)).toEqual(Array.from({ length: 34 }, (_, i) => i + 1));
    expect(ind.clasificacion?.filas.every((f) => f.personaId !== null)).toBe(true);

    const eq = await leer(equipos.id);
    expect(eq.clasificacion?.filas.map((f) => f.puesto)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(eq.clasificacion?.filas.every((f) => f.personaId === null)).toBe(true);
  });

  it('equipos no generan asaltos ni personas; el individual conserva sus 34 duelos de cuadro', async () => {
    const { s, individual, equipos } = await persistirAmbas();
    expect(s.asaltos.get(individual.competitionId!)).toBe(34);
    expect(s.asaltos.has(equipos.competitionId!)).toBe(false);
    expect(equipos.personas).toEqual({ confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 });
  });

  it('la serie lista una sola edición olímpica para París con sus dos pruebas', async () => {
    const { sql } = await persistirAmbas();
    const filas = [...sql.ediciones.values()].map((e) => ({
      id: e.id,
      nombre: e.nombre,
      temporada: e.season,
      fuente: 'fie',
      ciudad: e.ciudad,
      pais: 'FRA',
      inicio: e.inicio,
      fin: e.fin,
      pruebas: sql.pruebas.size,
      armas: 'FLORETE,SABLE',
      formatos: 'EQUIPOS,INDIVIDUAL',
    }));
    const { ctx } = crearContexto({ respuestas: [{ cuando: /FROM sport_edition e\s+WHERE/, filas }] });
    const r = await leerSeries(ctx);
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.series[0]?.ediciones).toHaveLength(1);
    expect(r.series[0]?.ediciones[0]).toMatchObject({ pruebas: 2, formatos: ['EQUIPOS', 'INDIVIDUAL'] });
  });
});
