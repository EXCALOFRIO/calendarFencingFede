import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { sportBout, sportExternalId } from '@/db/schema';
import { CAPACITY_DEFINITIONS, CAPACITY_MAX_BUDGET_BYTES } from '@/lib/ingest/sport-incremental/capacity';
import { verificarEsquemaD1 } from '@/lib/ingest/sport-incremental/schema';
import { reclamarSportLease } from '@/lib/ingest/sport-incremental/lease';
import { crearBaseResultados } from '@/lib/ingest/resultados-auto/sql';
import { consumoDelDia, margenLedger, migracionAplicada, sentenciasConsumo } from '@/lib/ingest/resultados-auto/estado';
import {
  libroRecomendado, PARADA_INGESTA, rellenarRecalibrado, validarParametros,
} from '../scripts/indexado/recalibrar-libro';

const DIR = new URL('../drizzle-d1/', import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, DIR), 'utf8');
const SQL0019 = leer('0019_recalibrar_libro.sql');
const SQL0020 = leer('0020_quitar_indices_duplicados.sql');
const DESHACER0019 = leer('manual/0019_recalibrar_libro.deshacer.sql');
const DESHACER0020 = leer('manual/0020_quitar_indices_duplicados.deshacer.sql');
const COMPROBAR0019 = leer('manual/0019_recalibrar_libro.comprobar.sql');
const PREVIAS = readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f) && f >= '0001' && f < '0019').sort();
const AHORA = "(cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))";
const LIBRO_ANTERIOR = 6_450_944_980;
const MEDIDO = 2_102_996_992;
const LIBRO = libroRecomendado(MEDIDO);

type Sqlite = ReturnType<typeof localD1>['sqlite'];
const cierres: (() => void)[] = [];
afterEach(() => { while (cierres.length) cierres.pop()!(); });

/** La base con las migraciones reales que preceden a 0019, como en producción. */
function base() {
  const local = localD1();
  cierres.push(local.close);
  for (const f of PREVIAS) local.sqlite.exec(leer(f));
  return { ...local, db: createD1Database(local.binding) };
}
/** wrangler aplica cada fichero como una unidad atómica. */
function aplicar(sqlite: Sqlite, texto: string) {
  sqlite.exec('BEGIN');
  try { sqlite.exec(texto); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
}
function fijarLedger(sqlite: Sqlite, bytes: number) {
  sqlite.exec('DROP TRIGGER sport_ledger_update');
  sqlite.exec(`UPDATE sport_capacity_ledger SET accounted_bytes=${bytes} WHERE key='global'`);
  sqlite.exec(CAPACITY_DEFINITIONS.sport_ledger_update);
}
const ledger = (sqlite: Sqlite) =>
  sqlite.prepare("SELECT accounted_bytes AS a, blocked AS b FROM sport_capacity_ledger WHERE key='global'").get() as { a: number; b: number };
const esquema = (sqlite: Sqlite) => sqlite.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
const trigger = (sqlite: Sqlite) =>
  (sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='sport_ledger_update'").get() as { sql: string }).sql;
const rellenado = (minutos = 60, libro = LIBRO) =>
  rellenarRecalibrado(SQL0019, { medido: MEDIDO, libro, validoHasta: Date.now() + minutos * 60_000 });
const plan = (sqlite: Sqlite, texto: string) =>
  (sqlite.prepare(`EXPLAIN QUERY PLAN ${texto}`).all() as { detail: string }[]).map((r) => r.detail);

describe('0019: recalibrar el libro de capacidad', () => {
  it('baja el libro al valor dado, recrea el trigger exacto y verificarEsquemaD1 lo acepta', async () => {
    const f = base();
    fijarLedger(f.sqlite, LIBRO_ANTERIOR);
    await expect(verificarEsquemaD1(f.db)).resolves.toEqual({ identidad: true, referencias: true });
    aplicar(f.sqlite, rellenado());
    expect(ledger(f.sqlite)).toEqual({ a: LIBRO, b: 0 });
    expect(trigger(f.sqlite)).toBe(CAPACITY_DEFINITIONS.sport_ledger_update);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '\\_%' ESCAPE '\\'").get()).toEqual({ n: 0 });
    await expect(verificarEsquemaD1(f.db)).resolves.toEqual({ identidad: true, referencias: true });
    const comprobacion = f.sqlite.prepare(COMPROBAR0019.split(';')[0]).get();
    expect(comprobacion).toMatchObject({ libro_bytes: LIBRO, bloqueado: 0, abiertos: 0, lease_vigente: 0, guardas: 0, triggers_ledger: 3 });
  });

  it('tras recalibrar el libro sigue sin poder bajar ni cambiarse fuera de un contexto', () => {
    const f = base();
    fijarLedger(f.sqlite, LIBRO_ANTERIOR);
    aplicar(f.sqlite, rellenado());
    expect(() => f.sqlite.exec(`UPDATE sport_capacity_ledger SET accounted_bytes=${LIBRO - 1}`)).toThrow('sport_capacity_ledger_immutable');
    expect(() => f.sqlite.exec(`UPDATE sport_capacity_ledger SET accounted_bytes=${LIBRO + 1}`)).toThrow('sport_capacity_ledger_immutable');
    expect(() => f.sqlite.exec('DELETE FROM sport_capacity_ledger')).toThrow('sport_capacity_ledger_immutable');
    // Bloquear sí está permitido sin contexto (lo usa la comprobación tras confirmar).
    f.sqlite.exec('UPDATE sport_capacity_ledger SET blocked=1');
    expect(() => f.sqlite.exec('UPDATE sport_capacity_ledger SET blocked=0')).toThrow('sport_capacity_ledger_immutable');
    // Una segunda aplicación tampoco puede volver a bajarlo.
    expect(() => aplicar(f.sqlite, rellenado(60, LIBRO + 4096))).not.toThrow();
    expect(ledger(f.sqlite)).toEqual({ a: LIBRO, b: 1 });
  });

  it('una escritura deportiva con lease (ingesta de resultados) sigue cobrando y la ingesta puede escribir', async () => {
    const f = base();
    fijarLedger(f.sqlite, LIBRO_ANTERIOR);
    aplicar(f.sqlite, rellenado());
    const presupuesto = { comprobar: () => {}, reservarFilas: () => {} };
    const lectura = crearBaseResultados(f.db, null, presupuesto);
    expect(await migracionAplicada(lectura)).toBe(true);
    const margen = await margenLedger(lectura, CAPACITY_MAX_BUDGET_BYTES);
    expect(margen).toEqual({ contabilizado: LIBRO, margen: CAPACITY_MAX_BUDGET_BYTES - LIBRO, bloqueado: false });
    expect(margen.margen).toBeGreaterThan(CAPACITY_MAX_BUDGET_BYTES - LIBRO_ANTERIOR);

    const lease = await reclamarSportLease(f.db);
    expect(lease).not.toBeNull();
    const escritura = crearBaseResultados(f.db, lease, presupuesto);
    await escritura.escribirDeporte([{
      sql: 'insert into sport_person (id, display_name, name_normalized) values (?, ?, ?)',
      params: ['00000000-0000-4000-8000-000000000001', 'Persona Prueba', 'persona prueba'], filas: 1,
    }]);
    await escritura.escribirPropias(sentenciasConsumo(Date.now(), { filas: 1 }));
    await lease!.liberar();

    expect(f.sqlite.prepare('SELECT count(*) AS n FROM sport_person').get()).toEqual({ n: 1 });
    expect((await consumoDelDia(lectura, Date.now())).filas).toBe(1);
    const tras = ledger(f.sqlite);
    // Lote: 16.384 B + cobro de la fila (1.024 + 4 × bytes de las columnas).
    expect(tras.b).toBe(0);
    expect(tras.a).toBeGreaterThan(LIBRO + 16_384 + 1_024);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM sport_write_context').get()).toEqual({ n: 0 });
    await expect(verificarEsquemaD1(f.db)).resolves.toEqual({ identidad: true, referencias: true });
    // Fuera del lote las guardas siguen cerradas.
    expect(() => f.sqlite.exec("INSERT INTO sport_person(id,display_name,name_normalized) VALUES('x','X','x')"))
      .toThrow('sport_write_lease_required');
  });

  it('en una base nueva o ya recalibrada no cambia nada (todas las migraciones se pueden encadenar)', async () => {
    const f = base();
    const antes = esquema(f.sqlite);
    aplicar(f.sqlite, SQL0019);
    aplicar(f.sqlite, SQL0019);
    expect(ledger(f.sqlite)).toEqual({ a: 0, b: 0 });
    expect(esquema(f.sqlite)).toEqual(antes);
    await expect(verificarEsquemaD1(f.db)).resolves.toEqual({ identidad: true, referencias: true });
  });

  it.each([
    ['la medida está caducada (el fichero tal cual está en el repositorio)', () => SQL0019, () => {}, 'recalibrado_medida_caducada'],
    ['hay un lease vigente', () => rellenado(), (s: Sqlite) => s.exec(
      `INSERT INTO sport_write_lease(key,owner,expires_at,lease_version) VALUES('global','w',${AHORA}+60000,1)`), 'recalibrado_lease_vigente'],
    ['el libro está bloqueado', () => rellenado(), (s: Sqlite) => s.exec('UPDATE sport_capacity_ledger SET blocked=1'), 'recalibrado_libro_bloqueado'],
    ['el valor queda por debajo del tamaño medido + 10 %', () => SQL0019
      .replace(/\d+, -- libro_bytes/, `${MEDIDO}, -- libro_bytes`)
      .replace(/\d+\); -- valido_hasta_ms/, `${Date.now() + 3_600_000}); -- valido_hasta_ms`), () => {}, 'recalibrado_margen_minimo'],
  ])('aborta sin tocar nada si %s', (_n, texto, preparar, error) => {
    const f = base();
    fijarLedger(f.sqlite, LIBRO_ANTERIOR);
    preparar(f.sqlite);
    const antes = esquema(f.sqlite);
    const libro = ledger(f.sqlite);
    expect(() => aplicar(f.sqlite, texto())).toThrow(error);
    expect(esquema(f.sqlite)).toEqual(antes);
    expect(ledger(f.sqlite)).toEqual(libro);
  });

  it('aborta con un contexto de escritura abierto', () => {
    const f = base();
    fijarLedger(f.sqlite, LIBRO_ANTERIOR);
    f.sqlite.exec(`INSERT INTO sport_write_lease(key,owner,expires_at,lease_version) VALUES('global','w',${AHORA}+60000,1)`);
    f.sqlite.exec(`INSERT INTO sport_write_context(key,owner,lease_version,budget_bytes,projected_bytes,measured_bytes)
      VALUES('global','w',1,${CAPACITY_MAX_BUDGET_BYTES},16384,1)`);
    f.sqlite.exec(`UPDATE sport_write_lease SET expires_at=${AHORA}-1`);
    const antes = esquema(f.sqlite);
    expect(() => aplicar(f.sqlite, rellenado())).toThrow('recalibrado_contexto_abierto');
    expect(esquema(f.sqlite)).toEqual(antes);
  });

  it('la migración inversa devuelve el valor anterior con el mismo trigger', async () => {
    const f = base();
    fijarLedger(f.sqlite, LIBRO_ANTERIOR);
    aplicar(f.sqlite, rellenado());
    aplicar(f.sqlite, DESHACER0019);
    expect(ledger(f.sqlite)).toEqual({ a: LIBRO_ANTERIOR, b: 0 });
    expect(trigger(f.sqlite)).toBe(CAPACITY_DEFINITIONS.sport_ledger_update);
    await expect(verificarEsquemaD1(f.db)).resolves.toEqual({ identidad: true, referencias: true });
  });
});

describe('scripts/indexado/recalibrar-libro.ts', () => {
  it('recomienda el tamaño medido + 15 % redondeado a 64 MiB', () => {
    expect(LIBRO).toBe(2_483_027_968);
    expect(LIBRO % (64 * 1024 * 1024)).toBe(0);
    expect(LIBRO / MEDIDO).toBeGreaterThanOrEqual(1.15);
    expect(libroRecomendado(2_400_000_000)).toBeGreaterThan(2_400_000_000 * 1.15);
  });

  it('rellena exactamente los tres literales y rechaza valores que la migración rechazaría', () => {
    const texto = rellenarRecalibrado(SQL0019, { medido: MEDIDO, libro: LIBRO, validoHasta: 1_800_000_000_000 });
    expect(texto).toContain(`  ${MEDIDO}, -- medido_bytes`);
    expect(texto).toContain(`  ${LIBRO}, -- libro_bytes`);
    expect(texto).toContain('  1800000000000); -- valido_hasta_ms');
    expect(texto.split('\n').length).toBe(SQL0019.split('\n').length);
    expect(() => validarParametros({ medido: MEDIDO, libro: MEDIDO, validoHasta: 1 })).toThrow('margen_minimo');
    expect(() => validarParametros({ medido: MEDIDO, libro: PARADA_INGESTA + 1, validoHasta: 1 })).toThrow('parada');
    expect(() => validarParametros({ medido: 0, libro: LIBRO, validoHasta: 1 })).toThrow('medido_invalido');
    expect(() => rellenarRecalibrado('SELECT 1;', { medido: MEDIDO, libro: LIBRO, validoHasta: 1 })).toThrow('marca_ausente');
  });
});

describe('0020: quitar los índices duplicados', () => {
  const CONSULTAS = [
    "SELECT count(*) FROM sport_bout b WHERE b.competition_id = 'x'",
    "SELECT b.competition_id, b.phase, count(*) FROM sport_bout b WHERE b.competition_id IN ('x','y') GROUP BY b.competition_id, b.phase",
    "SELECT count(*) FROM sport_bout WHERE competition_id='x' AND source='fie' AND phase='POULE'",
    "SELECT id FROM sport_bout WHERE competition_id='x' AND source='fie' LIMIT 1",
    "SELECT DISTINCT value FROM sport_external_id WHERE person_id IN ('x','y')",
    "SELECT 1 FROM sport_external_id x WHERE x.person_id IN ('x') AND x.scheme='rfee_license' AND x.link_status='CONFIRMADO'",
  ];

  it('las consultas que filtraban por prueba o persona siguen buscando por índice', () => {
    const f = base();
    aplicar(f.sqlite, SQL0020);
    expect(f.sqlite.prepare(`SELECT count(*) AS n FROM sqlite_master
      WHERE name IN ('sport_bout_competition_idx','sport_external_id_person_idx')`).get()).toEqual({ n: 0 });
    for (const consulta of CONSULTAS) {
      const detalle = plan(f.sqlite, consulta).join(' | ');
      expect(detalle, consulta).toMatch(/SEARCH \w+ USING (COVERING )?INDEX (sport_bout_key|sport_external_id_person_key) \((competition_id|person_id)=/);
      expect(detalle, consulta).not.toMatch(/SCAN (b|x|sport_bout|sport_external_id)\b/);
    }
    aplicar(f.sqlite, SQL0020);
  });

  it('el esquema declarado ya no los incluye y la inversa los recrea', () => {
    const nombres = [...getTableConfig(sportBout).indexes, ...getTableConfig(sportExternalId).indexes].map((i) => i.config.name);
    expect(nombres).not.toContain('sport_bout_competition_idx');
    expect(nombres).not.toContain('sport_external_id_person_idx');
    expect(nombres).toContain('sport_bout_a_idx');
    const f = base();
    aplicar(f.sqlite, SQL0020);
    aplicar(f.sqlite, DESHACER0020);
    expect(f.sqlite.prepare(`SELECT count(*) AS n FROM sqlite_master
      WHERE name IN ('sport_bout_competition_idx','sport_external_id_person_idx')`).get()).toEqual({ n: 2 });
  });
});
