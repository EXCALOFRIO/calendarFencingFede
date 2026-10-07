/**
 * Deja una copia de trabajo de la base con el mismo esquema que producción
 * tiene hoy, para medir. La exportación (`nuevo9.sqlite`) no trae el índice
 * de Explorar (0004) ni lo aplicado después del lote 8 (0006, 0008, 0009,
 * 0010, 0012), ni los rankings internacionales históricos ni los relevos, que
 * se cargaron más tarde en remoto. Sin ellos, las consultas de relevos o de
 * ranking histórico parecen baratas porque no hay filas.
 *
 *   npx tsx tests/perf/preparar-copia.mts <copia.sqlite> [dirSql...]
 *
 * NUNCA sobre la copia de producción: abre la ruta en escritura. Los `dirSql`
 * son los SQL generados con cabecera de lease (relevos, rankings), que se
 * aplican tal cual, como en `tests/ui/copia-trabajo.mts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SENTENCIAS_INDICE } from '@/lib/sport/explorar/indice-sql';

const RAIZ = resolve(import.meta.dirname, '..', '..');
const migracion = (f: string) => readFileSync(join(RAIZ, 'drizzle-d1', f), 'utf8');

export function prepararEsquema(db: DatabaseSync, dirs: readonly string[] = []): string[] {
  const hecho: string[] = [];
  const existe = (nombre: string) => Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(nombre));
  const tieneColumna = (tabla: string, columna: string) =>
    (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).some((c) => c.name === columna);

  if (!existe('explorar_indice_estado')) {
    db.exec(migracion('0004_indice_explorar.sql'));
    db.exec('BEGIN');
    for (const s of SENTENCIAS_INDICE) db.exec(s);
    db.exec('COMMIT');
    hecho.push('0004 + índice construido');
  }
  if (!existe('sport_competition_event_competition_idx')) {
    db.exec(migracion('0006_indice_prueba_calendario.sql'));
    hecho.push('0006');
  }
  if (!tieneColumna('live_source', 'match_rule')) {
    db.exec(migracion('0008_enlaces_directo.sql'));
    hecho.push('0008');
  }
  if (!existe('fie_clasificacion_lectura')) {
    db.exec(migracion('0009_fie_clasificacion_lectura.sql'));
    hecho.push('0009');
  }
  if (!existe('sport_relay')) {
    db.exec(migracion('0010_relevos.sql'));
    hecho.push('0010');
  }
  if (!existe('refresco_programado')) {
    db.exec(migracion('0012_refresco_programado.sql'));
    hecho.push('0012');
  }
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(dir, f), 'utf8'));
    }
    hecho.push(`SQL de ${basename(dir)}`);
  }
  return hecho;
}

if (process.argv[1]?.endsWith('preparar-copia.mts')) {
  const [copia, ...dirs] = process.argv.slice(2);
  if (!copia) throw new Error('uso: preparar-copia.mts <copia.sqlite> [dirSql...]');
  if (/nuevo\d+\.sqlite$/i.test(copia)) throw new Error('esa es una copia de producción: haz una copia de trabajo');
  const db = new DatabaseSync(copia);
  const t0 = performance.now();
  console.log(prepararEsquema(db, dirs).join('\n') || 'nada que hacer');
  db.close();
  console.log(`${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
