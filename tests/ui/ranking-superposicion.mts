/**
 * Base de capturas para el ranking por temporadas sin tocar la copia de
 * producción: un SQLite temporal con SÓLO `sport_ranking_publication` y
 * `sport_ranking_entry` (lo que ya hay en la copia más el SQL generado por
 * `scripts/ranking-historico-skermo.ts`), y la copia adjunta en sólo lectura
 * para todo lo demás. SQLite resuelve los nombres sin esquema en `main`
 * antes que en la base adjunta.
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function abrirSuperposicion(copia: string, dirSql: string, destino: string, patron = /^ranking-.*\.sql$/): DatabaseSync {
  if (existsSync(destino)) rmSync(destino);
  // Las claves ajenas apuntan a `sport_person`, que sólo está en la copia adjunta.
  const db = new DatabaseSync(destino, { enableForeignKeyConstraints: false });
  db.exec(`ATTACH DATABASE 'file:${copia.replace(/\\/g, '/')}?mode=ro' AS src`);
  const ddl = db.prepare(`SELECT type, sql FROM src.sqlite_master
    WHERE sql IS NOT NULL AND tbl_name IN ('sport_ranking_publication','sport_ranking_entry') AND type IN ('table','index')
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, CASE tbl_name WHEN 'sport_ranking_publication' THEN 0 ELSE 1 END`).all() as { type: string; sql: string }[];
  for (const d of ddl) db.exec(d.sql);
  db.exec('INSERT INTO main.sport_ranking_publication SELECT * FROM src.sport_ranking_publication');
  db.exec('INSERT INTO main.sport_ranking_entry SELECT * FROM src.sport_ranking_entry');
  const ficheros = readdirSync(dirSql).filter((f) => patron.test(f)).sort();
  db.exec('BEGIN');
  for (const f of ficheros) {
    // Sólo cabeceras y entradas: el lease, el contexto y la cobertura viven en la copia.
    for (const linea of readFileSync(join(dirSql, f), 'utf8').split('\n')) {
      if (/^INSERT INTO sport_ranking_(publication|entry)\b/.test(linea)) db.exec(linea);
    }
  }
  db.exec('COMMIT');
  return db;
}
