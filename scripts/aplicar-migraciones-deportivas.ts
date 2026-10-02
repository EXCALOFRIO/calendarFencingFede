import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import {
  ENUMS_DEPORTIVOS,
  ENUMS_PREVIOS_REQUERIDOS,
  TABLAS_DEPORTIVAS_ESPERADAS,
  TABLAS_PREVIAS_REQUERIDAS,
  cargarMigracionesLocales,
  evaluarPreflight,
  type EstadoLeido,
} from '../src/lib/db/migracion-aditiva';

/**
 * Aplica SOLO las migraciones aditivas 0017→0018→0019 con sus filas del ledger
 * de Drizzle en una única transacción con límites de bloqueo y ejecución.
 *
 *   tsx scripts/aplicar-migraciones-deportivas.ts             -> preflight de sólo lectura
 *   tsx scripts/aplicar-migraciones-deportivas.ts --aplicar   -> preflight y aplicación
 *
 * No invoca el migrador general ni `db:push`. Si el estado o algún hash no son
 * los esperados, aborta sin escribir; no corrige el ledger. Salida sin datos.
 */

const PENDIENTES = ['0017_identidad_deportiva', '0018_referencias_de_inscripcion', '0019_categorias_m10_m12'];
const LOCK_TIMEOUT = '10s';
const STATEMENT_TIMEOUT = '120s';
const LEDGER = '"drizzle"."__drizzle_migrations"';

const aplicar = process.argv.includes('--aplicar');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}
const sql = neon(url);

const raiz = join(import.meta.dirname, '..', 'drizzle');
const journal = JSON.parse(readFileSync(join(raiz, 'meta', '_journal.json'), 'utf8'));
const locales = cargarMigracionesLocales(journal, (tag) => readFileSync(join(raiz, `${tag}.sql`), 'utf8'));

const lista = (nombres: readonly string[]) => nombres.map((n) => `'${n}'`).join(',');

async function leerEstado(): Promise<{ estado: EstadoLeido; versionNum: number }> {
  const ledger = (await sql.query(`select hash, created_at::bigint as created_at from ${LEDGER} order by created_at, id`)) as {
    hash: string;
    created_at: string;
  }[];
  const tablas = (await sql.query(
    `select table_name from information_schema.tables where table_schema = 'public'
     and (table_name like 'sport\\_%' or table_name in (${lista(TABLAS_PREVIAS_REQUERIDAS)}))`,
  )) as { table_name: string }[];
  const enums = (await sql.query(
    `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as valores
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     where t.typname in (${lista([...ENUMS_PREVIOS_REQUERIDOS, ...ENUMS_DEPORTIVOS])}) group by t.typname`,
  )) as { typname: string; valores: string[] }[];
  const [v] = (await sql.query(`select current_setting('server_version_num')::int as v`)) as { v: number }[];
  const nombres = tablas.map((t) => t.table_name);
  return {
    versionNum: v.v,
    estado: {
      ledger: ledger.map((f) => ({ hash: f.hash, created_at: Number(f.created_at) })),
      tablasSport: nombres.filter((n) => n.startsWith('sport_')),
      tablasPrevias: nombres.filter((n) => !n.startsWith('sport_')),
      enums: Object.fromEntries(enums.map((e) => [e.typname, e.valores])),
    },
  };
}

async function verificarLimites() {
  const r = await sql.transaction(
    [
      sql.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`),
      sql.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`),
      sql.query(`select name, setting::int as ms from pg_settings where name in ('lock_timeout','statement_timeout')`),
    ],
    { readOnly: true },
  );
  const ms = Object.fromEntries((r[2] as { name: string; ms: number }[]).map((f) => [f.name, f.ms]));
  return ms.lock_timeout === 10_000 && ms.statement_timeout === 120_000;
}

const { estado, versionNum } = await leerEstado();
const veredicto = evaluarPreflight(locales, estado, PENDIENTES);
const limitesOk = await verificarLimites();
console.log(
  JSON.stringify({
    fase: 'preflight',
    ledgerFilas: estado.ledger.length,
    tablasSport: estado.tablasSport.length,
    versionServidor: versionNum,
    limitesTransaccionVerificados: limitesOk,
    pendientes: veredicto.ok ? veredicto.pendientes.map((m) => m.tag) : [],
    motivos: veredicto.ok ? [] : veredicto.motivos,
  }),
);
if (!veredicto.ok || !limitesOk || versionNum < 120000) {
  console.error('Preflight no superado: no se escribe nada.');
  process.exit(2);
}
if (!aplicar) process.exit(0);

const consultas = [
  sql.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`),
  sql.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`),
  ...veredicto.pendientes.flatMap((m) => [
    ...m.sentencias.map((s) => sql.query(s)),
    sql.query(`insert into ${LEDGER} ("hash", "created_at") values ($1, $2)`, [m.hash, m.when]),
  ]),
];
const inicio = Date.now();
await sql.transaction(consultas);

const despues = await leerEstado();
const faltan = TABLAS_DEPORTIVAS_ESPERADAS.filter((t) => !despues.estado.tablasSport.includes(t));
const categorias = despues.estado.enums.category_code ?? [];
console.log(
  JSON.stringify({
    fase: 'aplicada',
    ms: Date.now() - inicio,
    sentencias: consultas.length,
    ledgerFilas: despues.estado.ledger.length,
    tablasSport: despues.estado.tablasSport.length,
    tablasFaltantes: faltan,
    m10m12: categorias.includes('M10') && categorias.includes('M12'),
    enumsDeportivos: ENUMS_DEPORTIVOS.filter((e) => despues.estado.enums[e]),
  }),
);
