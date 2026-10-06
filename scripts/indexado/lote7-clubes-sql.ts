/** Consulta de sólo lectura a `nuevo7.sqlite`: `lote7-clubes-sql.ts "<select ...>"`. */
import { DatabaseSync } from 'node:sqlite';
import { NUEVO7 } from './lote7-pdf-comun';

const db = new DatabaseSync(process.env.LOTE7_DB ?? NUEVO7, { readOnly: true });
const filas = db.prepare(process.argv[2]).all();
if (process.argv.includes('--json')) console.log(JSON.stringify(filas, null, 1));
else for (const f of filas) console.log(Object.values(f as Record<string, unknown>).join(' | '));
db.close();
