import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { palabrasNombre } from '../../src/lib/nombres';

/** Carpeta compartida de la reindexación local (base exportada, hechos, copias de trabajo). */
export const CARPETA_TRABAJO = join(tmpdir(), 'calendario-trabajo');
export const BASE_POR_DEFECTO = join(CARPETA_TRABAJO, 'base.sqlite');
export const NUEVO_POR_DEFECTO = join(CARPETA_TRABAJO, 'nuevo.sqlite');

export const ahora = (): number => Date.now();
export const uuid = (): string => randomUUID();

export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/** JSON con claves ordenadas: el mismo hecho produce siempre el mismo hash. */
export function jsonCanonico(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`)
    .join(',')}}`;
}

/** Igual que `normalizeSportName` de `src/lib/identity/resolver.ts`: palabras sin acentos, ordenadas. */
export function normalizarNombre(nombre: string): string {
  return palabrasNombre(nombre).sort().join(' ');
}

export { palabrasNombre };

/**
 * Los triggers de 0002_guardia_deportiva.sql exigen un lease y cobran cada fila
 * contra un ledger monotónico con techo de 4 GiB: una recarga completa de
 * ~1M filas lo agotaría y además iría decenas de veces más lenta. En la COPIA
 * de trabajo se retiran y se guardan en una tabla de respaldo dentro de la
 * propia base, de modo que si el proceso muere a medias la siguiente ejecución
 * los repone igual (ver `restaurarGuardia`). El remoto nunca pasa por aquí.
 */
const RESPALDO = '_indexado_guardia';

export function quitarGuardia(db: DatabaseSync): number {
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ${RESPALDO} (name TEXT PRIMARY KEY, sql TEXT NOT NULL)`);
    const triggers = db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='trigger'
           AND (name LIKE 'sport\\_fence\\_%' ESCAPE '\\' OR name LIKE 'sport\\_charge\\_%' ESCAPE '\\')`,
      )
      .all() as { name: string; sql: string }[];
    const guardar = db.prepare(`INSERT OR IGNORE INTO ${RESPALDO}(name, sql) VALUES (?, ?)`);
    for (const t of triggers) {
      guardar.run(t.name, t.sql);
      db.exec(`DROP TRIGGER "${t.name.replace(/"/g, '""')}"`);
    }
    db.exec('COMMIT');
    return triggers.length;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function restaurarGuardia(db: DatabaseSync): number {
  const existe = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(RESPALDO);
  if (!existe) return 0;
  db.exec('BEGIN');
  try {
    const filas = db.prepare(`SELECT name, sql FROM ${RESPALDO} ORDER BY name`).all() as {
      name: string;
      sql: string;
    }[];
    let repuestos = 0;
    for (const f of filas) {
      const ya = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?`).get(f.name);
      if (!ya) {
        db.exec(f.sql);
        repuestos += 1;
      }
    }
    db.exec(`DROP TABLE ${RESPALDO}`);
    db.exec('COMMIT');
    return repuestos;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Ajustes de velocidad seguros sólo porque la base es una copia regenerable. */
export function prepararCopiaTrabajo(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = OFF');
  db.exec('PRAGMA cache_size = -262144');
  db.exec('PRAGMA temp_store = MEMORY');
}

export function argumento(nombre: string, porDefecto: string, argv = process.argv.slice(2)): string {
  const i = argv.indexOf(`--${nombre}`);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  const igual = argv.find((a) => a.startsWith(`--${nombre}=`));
  return igual ? igual.slice(nombre.length + 3) : porDefecto;
}

export function bandera(nombre: string, argv = process.argv.slice(2)): boolean {
  return argv.includes(`--${nombre}`);
}

/** Contador anidado `tabla → fuente → acción`. */
export type Contadores = Record<string, Record<string, Record<string, number>>>;

export function contar(c: Contadores, tabla: string, fuente: string, accion: string, n = 1): void {
  if (n === 0) return;
  const t = (c[tabla] ??= {});
  const f = (t[fuente] ??= {});
  f[accion] = (f[accion] ?? 0) + n;
}
