/**
 * Comprobación de una carpeta de SQL de rankings del lote 10 (misma prueba que
 * `scripts/ranking-historico-skermo.ts --comprobar`): aplica cada fichero sobre una base en
 * memoria con el esquema, las personas, las cabeceras de ranking y las guardas de la copia;
 * comprueba que entra el número de entradas esperado, que re-aplicarlo no duplica nada, las
 * claves ajenas y que no queda ningún contexto de escritura abierto.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function comprobarCarpeta(salida: string, rutaBase: string, ficheros: readonly { archivo: string; entradas: number }[]): boolean {
  const db = new DatabaseSync(':memory:');
  db.exec(`ATTACH DATABASE 'file:${resolve(rutaBase).replace(/\\/g, '/')}?mode=ro' AS src`);
  db.exec('PRAGMA foreign_keys = OFF');
  const tablas = ['sport_person', 'sport_ranking_publication', 'sport_ranking_entry', 'sport_import_coverage', 'sport_competition', 'sport_edition',
    'sport_write_lease', 'sport_write_context', 'sport_write_charge', 'sport_capacity_ledger', 'athlete'];
  const ddl = db.prepare(`SELECT type, name, tbl_name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND (tbl_name IN (${tablas.map(() => '?').join(',')}) OR name = 'sport_write_authorized') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END`).all(...tablas) as { type: string; sql: string }[];
  for (const d of ddl.filter((x) => x.type === 'table')) db.exec(d.sql);
  db.exec(`INSERT INTO main.sport_person SELECT * FROM src.sport_person`);
  db.exec(`UPDATE main.sport_person SET athlete_id = NULL`);
  db.exec(`INSERT INTO main.sport_ranking_publication SELECT * FROM src.sport_ranking_publication`);
  db.exec(`INSERT INTO main.sport_capacity_ledger SELECT * FROM src.sport_capacity_ledger`);
  db.exec(`INSERT INTO main.sport_write_lease SELECT * FROM src.sport_write_lease`);
  for (const d of ddl.filter((x) => x.type !== 'table')) db.exec(d.sql);
  db.exec('DETACH DATABASE src');
  db.exec('PRAGMA foreign_keys = ON');
  const guardas = (db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND (name LIKE 'sport_fence_%' OR name LIKE 'sport_charge_%' OR name LIKE 'sport_context_%')`).get() as { n: number }).n;
  console.log(`Base de prueba en memoria con ${guardas} triggers de guarda.`);
  try {
    db.exec(`INSERT INTO sport_ranking_publication(source,season,weapon,gender,category,category_raw,published_on) VALUES('x','x','ESPADA','M','ABS','x','2000-01-01')`);
    throw new Error('la guarda no bloqueó una escritura sin lease');
  } catch (e) {
    if ((e as Error).message.includes('guarda no bloqueó')) throw e;
  }
  const cuenta = () => (db.prepare(`SELECT count(*) AS n FROM sport_ranking_entry`).get() as { n: number }).n;
  let ok = true;
  for (const f of ficheros) {
    const antes = cuenta();
    const sql = readFileSync(join(salida, f.archivo), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.log(`FALLO ${f.archivo}: ${(e as Error).message}`);
      ok = false;
      continue;
    }
    const despues = cuenta();
    const owner = sql.match(/VALUES\('global','([0-9a-f-]{36})'/)?.[1];
    if (!owner) throw new Error(`${f.archivo}: sin cabecera de lease`);
    db.exec('BEGIN IMMEDIATE');
    db.exec(sql.replaceAll(owner, randomUUID()));
    db.exec('COMMIT');
    const reaplicado = cuenta();
    const bien = despues - antes === f.entradas && reaplicado === despues;
    ok &&= bien;
    console.log(`${bien ? 'OK' : 'DISTINTO'} ${f.archivo}: +${despues - antes} entradas (esperadas ${f.entradas}); re-aplicado +${reaplicado - despues}`);
  }
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const abiertos = db.prepare(`SELECT (SELECT count(*) FROM sport_write_context) + (SELECT count(*) FROM sport_write_charge) AS n`).get() as { n: number };
  const ledger = db.prepare(`SELECT accounted_bytes AS a, blocked AS b FROM sport_capacity_ledger`).get() as { a: number; b: number };
  console.log(`foreign_key_check=${fk.length} contextosAbiertos=${abiertos.n} ledger=${ledger.a} bloqueado=${ledger.b}`);
  ok &&= fk.length === 0 && abiertos.n === 0 && ledger.b === 0;
  console.log(ok ? 'COMPROBACIÓN OK' : 'COMPROBACIÓN CON FALLOS');
  db.close();
  return ok;
}
