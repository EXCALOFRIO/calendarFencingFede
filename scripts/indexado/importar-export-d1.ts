import { createReadStream, existsSync, renameSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

/**
 * Convierte un `wrangler d1 export --output x.sql` en una base SQLite local
 * leyendo el volcado por líneas (un volcado de D1 supera el tamaño máximo de
 * cadena de V8). Los triggers y vistas se crean al final, después de los
 * datos, para que las guardas de escritura no rechacen la propia carga.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/importar-export-d1.ts <export.sql> <salida.sqlite>
 */

function comillasAbiertas(texto: string, estado: boolean): boolean {
  let abiertas = estado;
  for (let i = 0; i < texto.length; i++) if (texto.charCodeAt(i) === 39) abiertas = !abiertas;
  return abiertas;
}

/** `CASE … END;` dentro del cuerpo también termina en «END;»: el trigger acaba cuando sobra un END (el de BEGIN). */
function triggerCompleto(texto: string): boolean {
  if (!/END\s*;$/i.test(texto)) return false;
  const sinCadenas = texto.replace(/'(?:[^']|'')*'/g, "''");
  const casos = sinCadenas.match(/\bCASE\b/gi)?.length ?? 0;
  const fines = sinCadenas.match(/\bEND\b/gi)?.length ?? 0;
  return fines === casos + 1;
}

async function main() {
  const [entrada, salida] = process.argv.slice(2);
  if (!entrada || !salida) throw new Error('uso: importar-export-d1.ts <export.sql> <salida.sqlite>');
  const temporal = `${salida}.parcial`;
  if (existsSync(temporal)) rmSync(temporal);
  const db = new DatabaseSync(temporal);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;');
  const diferidas: string[] = [];
  let buffer = '';
  let abiertas = false;
  let n = 0;
  db.exec('BEGIN');
  const lineas = createInterface({ input: createReadStream(entrada, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const linea of lineas) {
    buffer = buffer ? `${buffer}\n${linea}` : linea;
    abiertas = comillasAbiertas(linea, abiertas);
    if (abiertas) continue;
    const recortado = buffer.trimEnd();
    if (!recortado.endsWith(';')) continue;
    const cabeza = recortado.trimStart().slice(0, 40).toUpperCase();
    if (cabeza.startsWith('CREATE TRIGGER') && !triggerCompleto(recortado)) continue;
    buffer = '';
    if (/^PRAGMA\s/i.test(cabeza) || /^(BEGIN|COMMIT)/.test(cabeza)) continue;
    if (cabeza.startsWith('CREATE TRIGGER') || cabeza.startsWith('CREATE VIEW')) { diferidas.push(recortado); continue; }
    db.exec(recortado);
    if (++n % 50_000 === 0) {
      db.exec('COMMIT; BEGIN');
      process.stdout.write(`\r${n} sentencias`);
    }
  }
  if (buffer.trim()) throw new Error(`volcado incompleto: ${buffer.slice(0, 200)}`);
  for (const s of diferidas) db.exec(s);
  db.exec('COMMIT');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const integridad = (db.prepare('PRAGMA quick_check').get() as Record<string, string>);
  db.close();
  if (fk.length) throw new Error(`foreign_key_check: ${fk.length} filas`);
  renameSync(temporal, salida);
  console.log(`\n${n} sentencias, ${diferidas.length} triggers/vistas, quick_check=${Object.values(integridad)[0]}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
