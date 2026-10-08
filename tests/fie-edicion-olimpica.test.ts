import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { crearDepsPersistenciaFieDb } from '@/lib/ingest/fie-resultados-db';
import { claveEdicionFie, persistirLecturaFie } from '@/lib/ingest/fie-resultados-persist';
import { dbConSportLease, reclamarSportLease } from '@/lib/ingest/sport-incremental/lease';
import { claveEdicionSerieSinTorneo } from '@/lib/ingest/series-complementarias';
import { leerPruebaFie, type DepsLecturaFie, type PruebaFie } from '@/lib/ingest/sources/fie-resultados';
import { leerEdicion, leerSeries } from '@/lib/sport/explorar/ediciones';
import { crearContexto } from './helpers/explorar';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

/**
 * Los Juegos de París publican `tournamentId: null`. Individual (246) y equipos
 * (250) deben acabar en UNA edición olímpica 2024. Se ejecuta el contrato nativo
 * de `sport_edition`/`sport_competition` en SQLite efímero con la guardia D1 real.
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
};
type Prueba = { id: string; edicionId: string; clave: string; formato: string; fecha: string | null };

const abiertos: ReturnType<typeof fixtureDeportivaD1>[] = [];
afterEach(() => abiertos.splice(0).forEach((local) => local.close()));
async function almacenSql() {
  const local = fixtureDeportivaD1();
  abiertos.push(local);
  const lease = await reclamarSportLease(local.db);
  const db = dbConSportLease(local.db, lease!);
  return {
    ...local, db, lease,
    get ediciones() {
      const rows = local.sqlite.prepare(`SELECT id,tournament_key AS clave,season,name AS nombre,
        start_date AS inicio,end_date AS fin,city AS ciudad FROM sport_edition`).all() as Edicion[];
      return new Map(rows.map((row) => [row.id, row]));
    },
    get pruebas() {
      const rows = local.sqlite.prepare(`SELECT id,edition_id AS edicionId,competition_key AS clave,
        format AS formato,competition_date AS fecha FROM sport_competition
        ORDER BY competition_date,competition_key`).all() as Prueba[];
      return new Map(rows.map((row) => [row.id, row]));
    },
  };
}
const depsReales = (db: Db) => ({ deps: crearDepsPersistenciaFieDb(db) });

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
    const sql = await almacenSql();
    const s = depsReales(sql.db);
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
    const sql = await almacenSql();
    const s = depsReales(sql.db);
    for (const [id, fx] of [[250, 'paris-2024-250-equipos'], [246, 'paris-2024-246'], [250, 'paris-2024-250-equipos']] as const) {
      await persistirLecturaFie(s.deps, await leerPruebaFie(2024, id, lector(cargar(fx))));
    }
    expect([...sql.ediciones.values()]).toHaveLength(1);
    expect([...sql.pruebas.values()]).toHaveLength(2);
    expect([...sql.ediciones.values()][0]).toMatchObject({ inicio: '2024-07-27', fin: '2024-08-04' });
  });

  it('el SQL ensancha fechas en ediciones de varias pruebas (serie o torneo), pisa las de una sola y no cambia las claves', async () => {
    const local = await almacenSql();
    const deps = crearDepsPersistenciaFieDb(local.db);
    await deps.upsertPrueba(prueba());
    await deps.upsertPrueba(prueba({ tournamentId: 107 }));
    await deps.upsertPrueba(prueba({ nombre: 'Grand Prix de Paris', competitionId: 300 }));
    const consultas = local.calls.map((c) => c.sql);
    const [olimpica, torneo, suelta] = consultas.filter((c) => /insert into "sport_edition"/i.test(c));
    // Con tournamentId cada prueba trae sus fechas: pisarlas dejaba el torneo con las de la última.
    for (const varias of [olimpica, torneo]) {
      expect(varias).toMatch(/"start_date" = coalesce\(min\(/i);
      expect(varias).toMatch(/"end_date" = coalesce\(max\(/i);
    }
    expect(suelta).toMatch(/"start_date" = excluded\.start_date/i);
    expect(suelta).not.toMatch(/\bmin\(|\bmax\(/i);
    for (const c of consultas.filter((c) => /insert into "sport_competition"/i.test(c))) {
      expect(c).toMatch(/on conflict \("sport_competition"\."source",\s*"sport_competition"\."season",\s*"sport_competition"\."competition_key"\)/i);
    }
  });

  it('el lector devuelve ambas pruebas en la edición y conserva puestos individuales y de equipo', async () => {
    const { sql } = await persistirAmbas();
    const [edicion] = [...sql.ediciones.values()];
    const del = [...sql.pruebas.values()].filter((p) => p.edicionId === edicion.id);
    const [individual, equipos] = del;

    const leer = async (prueba: string) => {
      const ctx = { ...crearContexto().ctx, db: sql.db };
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
    const { sql, individual, equipos } = await persistirAmbas();
    const count = sql.sqlite.prepare('SELECT count(*) AS n FROM sport_bout WHERE competition_id=?');
    expect(count.get(individual.competitionId!)!.n).toBe(34);
    expect(count.get(equipos.competitionId!)!.n).toBe(0);
    expect(equipos.personas).toEqual({ confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 });
  });

  it('la serie lista una sola edición olímpica para París con sus dos pruebas', async () => {
    const { sql } = await persistirAmbas();
    const ctx = { ...crearContexto().ctx, db: sql.db };
    const r = await leerSeries(ctx);
    if (r.estado !== 'ok') throw new Error('se esperaba ok');
    expect(r.series[0]?.ediciones).toHaveLength(1);
    expect(r.series[0]?.ediciones[0]).toMatchObject({ pruebas: 2, formatos: ['EQUIPOS', 'INDIVIDUAL'] });
  });
});
