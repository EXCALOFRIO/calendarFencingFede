import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cargarHechos, type EntradaHechos } from '../scripts/indexado/cargar-hechos';
import { quitarGuardia, restaurarGuardia } from '../scripts/indexado/comun';
import { mismoTexto, sustituir } from '../scripts/indexado/lote8-engarde-cespm15-sustituir';
import { hechosPrueba, type HechosPrueba } from '../src/lib/ingest/hechos/formato';

const X = '\uFFFD';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0000_aplicacion.sql', '0001_auth.sql', '0002_guardia_deportiva.sql', '0003_vinculos_revisados.sql', '0005_presupuesto_8gib.sql']) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

type Tirador = { key: string; name: string; club: string; pos: number };

function hechos(t: Tirador[]): HechosPrueba {
  const [a, b, c] = t;
  const asalto = (phase: string, round: string, x: Tirador, y: Tirador, sx: number, sy: number) =>
    ({ phase, roundKey: round, aRef: x.key, bRef: y.key, aName: x.name, bName: y.name, scoreA: sx, scoreB: sy });
  return hechosPrueba.parse({
    version: 1, source: 'engarde', extractor: 'lector_engarde_estatica',
    sourceUrl: 'https://engarde-service.com/files/rfee/cespm15/smind/clasfinal.htm', sourceSha256: 'a'.repeat(64),
    edition: { season: '2013-2014', tournamentKey: 'engarde:rfee/cespm15', name: 'Campeonato de España M-15 2014', startDate: '2014-06-07', endDate: '2014-06-07', city: null, countryCode: null },
    competition: { competitionKey: 'engarde:rfee/cespm15/smind', weapon: 'SABLE', gender: 'M', category: 'M15', categoryRaw: null, format: 'INDIVIDUAL', date: '2014-06-07' },
    // Poules «parcial»: es el caso en que `cargar-hechos` conserva lo guardado.
    status: { results: 'completo', pools: 'parcial', tableau: 'completo', publishedParticipants: 3, notes: [] },
    results: t.map((x) => ({ factKey: x.key, name: x.name, club: x.club, position: x.pos })),
    bouts: [asalto('POULE', 'P1', a, b, 5, 3), asalto('POULE', 'P1', b, c, 5, 4), asalto('TABLEAU', 'T2', a, c, 15, 9)],
  });
}

const rota = hechos([
  { key: 'engarde:a mu oz|CE-M', name: `MU${X}OZ Ana`, club: 'CE-M', pos: 1 },
  { key: 'engarde:eva gil|SAM-B', name: 'GIL Eva', club: 'SAM-B', pos: 2 },
  { key: 'engarde:a luz pe|CEL-M', name: `PE${X}A Luz`, club: 'CEL-M', pos: 3 },
]);
const buena = hechos([
  { key: 'engarde:ana munoz|CE-M', name: 'MUÑOZ Ana', club: 'CE-M', pos: 1 },
  { key: 'engarde:eva gil|SAM-B', name: 'GIL Eva', club: 'SAM-B', pos: 2 },
  { key: 'engarde:luz pena|CEL-M', name: 'PEÑA Luz', club: 'CEL-M', pos: 3 },
]);

let n = 0;
const entrada = (h: HechosPrueba): EntradaHechos => ({ ruta: `f${(n += 1)}.json`, carpeta: 'lote8-engarde-cespm15', leer: () => h });

/** Base con la lectura rota cargada y cada resultado ya unido a una persona. */
function conLecturaRota(): DatabaseSync {
  const db = crearBase();
  quitarGuardia(db);
  cargarHechos(db, [entrada(rota)]);
  for (const r of db.prepare(`SELECT id, source_name FROM sport_result`).all() as { id: string; source_name: string }[]) {
    db.prepare(`INSERT INTO sport_person (id, display_name, name_normalized) VALUES (?,?,?)`).run(`p-${r.id}`, r.source_name, r.source_name);
    db.prepare(`UPDATE sport_result SET person_id=? WHERE id=?`).run(`p-${r.id}`, r.id);
  }
  restaurarGuardia(db);
  return db;
}

const cuenta = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
const rotas = (db: DatabaseSync) =>
  cuenta(db, `SELECT count(*) n FROM sport_result WHERE instr(source_name||source_fact_key, char(65533))>0`) +
  cuenta(db, `SELECT count(*) n FROM sport_bout WHERE instr(fencer_a_name||fencer_b_name||fencer_a_ref||fencer_b_ref, char(65533))>0`);

describe('lote8-engarde-cespm15-sustituir', () => {
  it('compara textos salvo los huecos «\uFFFD»', () => {
    expect(mismoTexto(`MU${X}OZ Ana`, 'MUÑOZ Ana')).toBe(true);
    expect(mismoTexto('MUÑOZ Ana', `MU${X}OZ Ana`)).toBe(true);
    expect(mismoTexto(`MU${X}OZ Ana`, 'MUÑOZ Eva')).toBe(false);
    expect(mismoTexto(null, null)).toBe(true);
    expect(mismoTexto('CE-M', null)).toBe(false);
  });

  it('sin el paso, cargar-hechos no duplica pero deja poules rotas y pierde personas', () => {
    const db = conLecturaRota();
    quitarGuardia(db);
    const i = cargarHechos(db, [entrada(buena)]);
    expect(cuenta(db, `SELECT count(*) n FROM sport_result`)).toBe(3);
    expect(i.secciones.pools.engarde.conservado).toBe(1);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE phase='POULE' AND instr(fencer_a_name||fencer_b_name, char(65533))>0`)).toBe(2);
    expect(cuenta(db, `SELECT count(*) n FROM sport_result WHERE person_id IS NULL`)).toBe(2);
  });

  it('con el paso, la recarga sustituye la prueba entera y conserva las personas', () => {
    const db = conLecturaRota();
    const disparadores = cuenta(db, `SELECT count(*) n FROM sqlite_master WHERE type='trigger'`);
    const ensayo = sustituir(db, [buena], true);
    expect(ensayo.pruebas[0]).toMatchObject({ resultadosMismaClave: 1, resultadosReclavados: 2, asaltosBorrados: 3 });
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout`)).toBe(3);

    const inf = sustituir(db, [buena], false);
    expect(inf.pruebas[0]).toMatchObject({ resultadosMismaClave: 1, resultadosReclavados: 2, resultadosSinPareja: [], asaltosBorrados: 3, asaltosYaCorrectos: false });
    expect(cuenta(db, `SELECT count(*) n FROM sqlite_master WHERE type='trigger'`)).toBe(disparadores);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout`)).toBe(0);

    quitarGuardia(db);
    cargarHechos(db, [entrada(buena)]);
    expect(rotas(db)).toBe(0);
    expect(cuenta(db, `SELECT count(*) n FROM sport_result`)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_result WHERE person_id IS NULL`)).toBe(0);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout`)).toBe(3);
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout WHERE fencer_a_person_id IS NULL OR fencer_b_person_id IS NULL`)).toBe(0);
    expect(db.prepare(`SELECT source_name, person_id FROM sport_result WHERE source_fact_key='engarde:ana munoz|CE-M'`).get())
      .toMatchObject({ source_name: 'MUÑOZ Ana' });
    restaurarGuardia(db);

    // Idempotente: ya no hay nada que reclavar ni borrar.
    const otra = sustituir(db, [buena], false);
    expect(otra.pruebas[0]).toMatchObject({ resultadosMismaClave: 3, resultadosReclavados: 0, asaltosBorrados: 0, asaltosYaCorrectos: true });
    expect(cuenta(db, `SELECT count(*) n FROM sport_bout`)).toBe(3);
  });

  it('una prueba que no está en la base se deja para cargar-hechos', () => {
    const db = crearBase();
    expect(sustituir(db, [buena], true)).toMatchObject({ noEncontradas: ['engarde:rfee/cespm15/smind'], pruebas: [] });
  });
});
