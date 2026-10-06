/**
 * Copia de trabajo de la base para pruebas y capturas: copia el SQLite de
 * producción (que sólo se lee) y le aplica, en orden y tal cual (con su
 * cabecera de lease y su cierre), los SQL de ranking generados. Se borra al
 * acabar con `borrarCopia`.
 *
 *   npx tsx tests/ui/copia-trabajo.mts <base> <destino> <dirSql>...
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function prepararCopia(base: string, destino: string, dirs: readonly string[]): string[] {
  if (resolve(base) === resolve(destino)) throw new Error('el destino no puede ser la base');
  if (existsSync(destino)) rmSync(destino);
  copyFileSync(base, destino);
  const db = new DatabaseSync(destino);
  const aplicados: string[] = [];
  try {
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
        db.exec(readFileSync(join(dir, f), 'utf8'));
        aplicados.push(f);
      }
    }
  } finally {
    db.close();
  }
  return aplicados;
}

export function borrarCopia(destino: string): void {
  for (const sufijo of ['', '-wal', '-shm', '-journal']) if (existsSync(destino + sufijo)) rmSync(destino + sufijo);
}

if (process.argv[1]?.endsWith('copia-trabajo.mts')) {
  const [base, destino, ...dirs] = process.argv.slice(2);
  if (!base || !destino || dirs.length === 0) throw new Error('uso: <base> <destino> <dirSql>...');
  const t0 = performance.now();
  const aplicados = prepararCopia(base, destino, dirs);
  console.log(`${aplicados.length} ficheros aplicados en ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  console.log(aplicados.join('\n'));
}
