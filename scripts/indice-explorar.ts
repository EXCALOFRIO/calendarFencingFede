import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SENTENCIAS_INDICE, SENTENCIAS_RECONSTRUCCION } from '../src/lib/sport/explorar/indice-sql';
import { SENTENCIAS_PAISES } from '../src/lib/sport/explorar/pais-indice-sql';

/**
 * Reconstrucción del índice de palabras de Explorar (migración 0004) y de los
 * agregados por país (0018 y 0021, `pais-indice-sql.ts`).
 *
 *   tsx scripts/indice-explorar.ts [--salida f.sql]  -> sólo escribe el SQL
 *   ... --partes dir                                 -> un fichero por sentencia (01.sql, 02.sql…)
 *   tsx scripts/indice-explorar.ts --local db.sqlite -> lo ejecuta en una copia local
 *   ... --sin-paises                                 -> sólo el índice (una base sin la 0018)
 *   ... --solo-paises                                -> sólo los agregados por país
 *
 * Nunca toca D1. Para producción se aplica el fichero tal cual, que D1 ejecuta
 * como una sola transacción, o, si una sentencia se acerca al límite de
 * duración de D1, los ficheros de `--partes` uno a uno y en orden:
 *
 *   wrangler d1 execute calendario-fie-fede-db --remote --file <salida>
 *
 * Sólo escribe en tablas `explorar_*` (sin guardas ni libro de capacidad). El
 * fichero no lleva BEGIN/COMMIT porque D1 los rechaza; en local se envuelve y
 * se mide cada sentencia (tiempo y filas escritas).
 */
function main(): void {
  const args = process.argv.slice(2);
  const valor = (bandera: string) => {
    const i = args.indexOf(bandera);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const conocidas = new Set(['--salida', '--local', '--partes', '--sin-paises', '--solo-paises']);
  const sinValor = new Set(['--sin-paises', '--solo-paises']);
  if (args.some((a, i) => a.startsWith('--') ? !conocidas.has(a) : !conocidas.has(args[i - 1]) || sinValor.has(args[i - 1]))
    || (args.includes('--sin-paises') && args.includes('--solo-paises'))) {
    console.error('Uso: tsx scripts/indice-explorar.ts [--salida f.sql | --partes dir] [--local db.sqlite] [--sin-paises | --solo-paises]');
    process.exitCode = 2;
    return;
  }
  const sentencias = args.includes('--sin-paises') ? SENTENCIAS_INDICE
    : args.includes('--solo-paises') ? SENTENCIAS_PAISES : SENTENCIAS_RECONSTRUCCION;
  const texto = `${sentencias.join(';\n\n')};\n`;
  const local = valor('--local');
  if (local) {
    const db = new DatabaseSync(local);
    // Los agregados por país ordenan cientos de miles de filas: con la caché de 2 MB
    // y los temporales en disco de node:sqlite, la reconstrucción tardaba cinco veces más.
    db.exec('PRAGMA cache_size = -262144');
    db.exec('PRAGMA temp_store = MEMORY');
    const t = performance.now();
    const medidas: { n: number; ms: number; filas: number; sentencia: string }[] = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      sentencias.forEach((s, i) => {
        const t0 = performance.now();
        const { changes } = db.prepare(s).run();
        // `changes` no se reinicia con DDL: tras un CREATE INDEX repite el del último INSERT.
        const filas = /^\s*(INSERT|DELETE|UPDATE)\b/i.test(s) ? Number(changes) : 0;
        medidas.push({ n: i + 1, ms: Math.round(performance.now() - t0), filas, sentencia: s.replace(/\s+/g, ' ').slice(0, 70) });
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    for (const m of medidas) console.log(JSON.stringify(m));
    const existe = (tabla: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(tabla));
    const tablas = ['explorar_persona', 'explorar_token', 'explorar_variante', 'explorar_pais_prueba', 'explorar_pais_tirador',
      'explorar_pais_rival', 'explorar_pais_resumen', 'explorar_pais_medalla'].filter(existe);
    const filas = Object.fromEntries(tablas.map((x) => [x, Number((db.prepare(`SELECT count(*) AS n FROM ${x}`).get() as { n: number }).n)]));
    console.log(JSON.stringify({ base: local, ms: Math.round(performance.now() - t), escritas: medidas.reduce((s, m) => s + m.filas, 0), ...filas }));
    db.close();
    return;
  }
  const partes = valor('--partes');
  if (partes) {
    mkdirSync(partes, { recursive: true });
    const ancho = String(sentencias.length).length < 2 ? 2 : String(sentencias.length).length;
    sentencias.forEach((s, i) => writeFileSync(join(partes, `${String(i + 1).padStart(ancho, '0')}.sql`), `${s};\n`));
    console.log(JSON.stringify({ partes, sentencias: sentencias.length }));
    return;
  }
  const salida = valor('--salida') ?? join(tmpdir(), 'indice-explorar.sql');
  writeFileSync(salida, texto);
  console.log(JSON.stringify({ salida, sentencias: sentencias.length }));
}

main();
