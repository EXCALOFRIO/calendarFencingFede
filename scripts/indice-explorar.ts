import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SENTENCIAS_INDICE } from '../src/lib/sport/explorar/indice-sql';

/**
 * Reconstrucción del índice de palabras de Explorar (migración 0004).
 *
 *   tsx scripts/indice-explorar.ts [--salida f.sql]  -> sólo escribe el SQL
 *   tsx scripts/indice-explorar.ts --local db.sqlite -> lo ejecuta en una copia local
 *
 * Nunca toca D1. Para producción se aplica el fichero tal cual, que D1 ejecuta
 * como una sola transacción:
 *
 *   wrangler d1 execute calendario-fie-fede-db --remote --file <salida>
 *
 * Sólo escribe en tablas `explorar_*` (sin guardas ni libro de capacidad). El
 * fichero no lleva BEGIN/COMMIT porque D1 los rechaza; en local se envuelve.
 */
function main(): void {
  const args = process.argv.slice(2);
  const valor = (bandera: string) => {
    const i = args.indexOf(bandera);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const conocidas = new Set(['--salida', '--local']);
  if (args.some((a, i) => a.startsWith('--') ? !conocidas.has(a) : !conocidas.has(args[i - 1]))) {
    console.error('Uso: tsx scripts/indice-explorar.ts [--salida f.sql] [--local db.sqlite]');
    process.exitCode = 2;
    return;
  }
  const texto = `${SENTENCIAS_INDICE.join(';\n\n')};\n`;
  const local = valor('--local');
  if (local) {
    const db = new DatabaseSync(local);
    const t = performance.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(texto);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const filas = db.prepare(`SELECT
      (SELECT count(*) FROM explorar_persona) AS personas,
      (SELECT count(*) FROM explorar_token) AS tokens,
      (SELECT count(*) FROM explorar_variante) AS variantes`).get();
    console.log(JSON.stringify({ base: local, ms: Math.round(performance.now() - t), ...filas }));
    db.close();
    return;
  }
  const salida = valor('--salida') ?? join(tmpdir(), 'indice-explorar.sql');
  writeFileSync(salida, texto);
  console.log(JSON.stringify({ salida, sentencias: SENTENCIAS_INDICE.length }));
}

main();
