import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { cargarMigracionesLocales } from '../src/lib/db/migracion-aditiva';
import { evaluarPreflightCron, type EstadoMigracionCron } from '../src/lib/cron/migracion';

/**
 * Aplica SÓLO 0020 y su fila del ledger en una única transacción.
 *
 *   tsx scripts/aplicar-migracion-crons.ts           -> sólo lectura
 *   tsx scripts/aplicar-migracion-crons.ts --aplicar -> preflight y aplicación
 *
 * Sin migrador general, db:push, correcciones de hashes ni DDL de otras tablas.
 * Un ledger distinto, una guarda ya existente o una previa pendiente abortan.
 */
const LEDGER = '"drizzle"."__drizzle_migrations"';
const LOCK_TIMEOUT = '10s';
const STATEMENT_TIMEOUT = '120s';

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg !== '--aplicar')) {
    console.error('Argumento desconocido: sólo se admite --aplicar.');
    process.exitCode = 2;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    console.error('Falta DATABASE_URL; no se escribe nada.');
    process.exitCode = 1;
    return;
  }
  const sql = neon(url);
  const raiz = join(import.meta.dirname, '..', 'drizzle');
  const journal = JSON.parse(readFileSync(join(raiz, 'meta', '_journal.json'), 'utf8'));
  // The command is permanently scoped to 0020, even after newer migrations land.
  const hasta0020 = journal.entries.findIndex((e: { tag: string }) => e.tag === '0020_guardia_crons');
  const locales = cargarMigracionesLocales({ entries: journal.entries.slice(0, hasta0020 + 1) },
    (tag) => readFileSync(join(raiz, `${tag}.sql`), 'utf8'));

  async function leerEstado(): Promise<{ estado: EstadoMigracionCron; versionNum: number }> {
    const r = await sql.transaction(
      [
        sql.query(`select hash, created_at::bigint as created_at from ${LEDGER} order by created_at, id`),
        sql.query(
          `select to_regclass('public.cron_execution') is not null as cron,
                  to_regclass('public.ingest_run') is not null as ingest,
                  current_setting('server_version_num')::int as version`,
        ),
      ],
      { readOnly: true, isolationLevel: 'RepeatableRead' },
    );
    const tablas = (r[1] as { cron: boolean; ingest: boolean; version: number }[])[0];
    return {
      versionNum: tablas.version,
      estado: {
        ledger: (r[0] as { hash: string; created_at: string }[]).map((f) => ({
          hash: f.hash,
          created_at: Number(f.created_at),
        })),
        tablaCronExiste: tablas.cron,
        tablaIngestExiste: tablas.ingest,
      },
    };
  }

  const { estado, versionNum } = await leerEstado();
  const veredicto = evaluarPreflightCron(locales, estado);
  const limites = await sql.transaction(
    [
      sql.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`),
      sql.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`),
      sql.query(`select name, setting::int as ms from pg_settings where name in ('lock_timeout','statement_timeout')`),
    ],
    { readOnly: true },
  );
  const ms = Object.fromEntries((limites[2] as { name: string; ms: number }[]).map((f) => [f.name, f.ms]));
  const limitesOk = ms.lock_timeout === 10_000 && ms.statement_timeout === 120_000;
  console.log(JSON.stringify({
    fase: 'preflight',
    ledgerFilas: estado.ledger.length,
    tablaCronExiste: estado.tablaCronExiste,
    versionServidor: versionNum,
    limitesTransaccionVerificados: limitesOk,
    pendiente: veredicto.ok ? veredicto.pendiente.tag : null,
    motivos: veredicto.ok ? [] : veredicto.motivos,
  }));
  if (!veredicto.ok || !limitesOk || versionNum < 120000) {
    console.error('Preflight no superado: no se escribe nada.');
    process.exitCode = 2;
    return;
  }
  if (!process.argv.includes('--aplicar')) return;

  // Serializar aplicadores y repetir las anclas dentro de la misma transacción
  // que crea la tabla. El preflight de fuera no basta contra una carrera.
  const ledgerEsperado = JSON.stringify(
    locales.slice(0, -1).map((m) => ({ hash: m.hash, created_at: m.when })),
  );
  const m = veredicto.pendiente;
  await sql.transaction([
    sql.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`),
    sql.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`),
    sql.query(`lock table ${LEDGER} in exclusive mode`),
    sql.query(
      `select 1 / case when
        (select coalesce(jsonb_agg(jsonb_build_object('hash', hash, 'created_at', created_at::bigint)
          order by created_at, id), '[]'::jsonb) from ${LEDGER}) = $1::jsonb
        and to_regclass('public.cron_execution') is null
        and to_regclass('public.ingest_run') is not null
        then 1 else 0 end as preflight_seguro`,
      [ledgerEsperado],
    ),
    ...m.sentencias.map((s) => sql.query(s)),
    sql.query(`insert into ${LEDGER} ("hash", "created_at") values ($1, $2)`, [m.hash, m.when]),
  ]);

  const despues = await leerEstado();
  const ledgerOk = despues.estado.ledger.length === locales.length && locales.every(
    (local, i) => despues.estado.ledger[i].hash === local.hash && despues.estado.ledger[i].created_at === local.when,
  );
  console.log(JSON.stringify({
    fase: 'aplicada',
    migracion: m.tag,
    tablaCronExiste: despues.estado.tablaCronExiste,
    ledgerFilas: despues.estado.ledger.length,
    ledgerVerificado: ledgerOk,
  }));
  if (!ledgerOk || !despues.estado.tablaCronExiste) process.exitCode = 3;
}

// No mostrar el objeto de error del driver: puede contener la URL de conexión.
void main().catch(() => {
  console.error('No se pudo verificar o aplicar 0020; no se muestran credenciales ni errores del driver.');
  process.exitCode = 1;
});
