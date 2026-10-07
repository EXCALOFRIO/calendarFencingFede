/**
 * Estado de la ingesta automática de resultados tras cada pasada. SOLO LECTURA.
 *
 *   npx tsx scripts/resultados-auto-estado.ts [--horas 3]
 *     → producción: `wrangler d1 execute calendario-fie-fede-db --remote --json --command <SELECT>`
 *   npx tsx scripts/resultados-auto-estado.ts --local <copia.sqlite> [--horas 3]
 *     → una copia local, abierta en sólo lectura (para ensayar el script)
 *
 * Enseña: esquema (0014/0017), lease, libro de capacidad y su margen, consumo del día, unidades
 * (por estado y las tocadas en las últimas `--horas`), cola de revisión, eventos y avisos.
 * Cada consulta pasa por una guarda que sólo admite un SELECT único; nunca escribe.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const local = arg('--local');
const horas = Number(arg('--horas') ?? '3');
if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 30) throw new Error('--horas fuera de rango');
const PRESUPUESTO = Number(process.env.D1_STORAGE_BUDGET_BYTES ?? 8 * 1024 ** 3);
const MARGEN_MIN = Number(process.env.RESULTADOS_AUTO_MARGEN_MIN_BYTES ?? 512 * 1024 ** 2);
const desde = Date.now() - horas * 3_600_000;
const DB = 'calendario-fie-fede-db';

type Fila = Record<string, unknown>;

function soloSelect(texto: string): string {
  const t = texto.trim().replace(/;\s*$/, '');
  if (!/^select\b/i.test(t) || t.includes(';') ||
    /\b(insert|update|delete|replace|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i.test(t)) {
    throw new Error(`consulta no permitida: ${t.slice(0, 60)}`);
  }
  return t;
}

const espia = local ? new DatabaseSync(resolve(local), { readOnly: true }) : null;
const raiz = resolve(import.meta.dirname, '..');
const wrangler = resolve(raiz, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
// Same as scripts/indexado/sincronizar-d1.ts: OAuth login, never the repo's .env or a limited API token.
const entornoWrangler = { ...process.env };
delete entornoWrangler.CLOUDFLARE_API_TOKEN;
entornoWrangler.CLOUDFLARE_ACCOUNT_ID = '52d39cf14bc17b94754729436036124d';

function consultar(texto: string): Fila[] {
  const q = soloSelect(texto);
  if (espia) return espia.prepare(q).all() as Fila[];
  const salida = execFileSync(process.execPath, [wrangler, 'd1', 'execute', DB, '--remote', '--json', '--command', q,
    '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null'],
    { cwd: raiz, env: entornoWrangler, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const json = JSON.parse(salida.slice(salida.indexOf('['))) as { results?: Fila[]; success?: boolean }[];
  if (!json[0]?.success) throw new Error('wrangler: consulta sin éxito');
  return json[0].results ?? [];
}

function bloque(titulo: string, texto: string, opcional = false): Fila[] {
  console.log(`\n== ${titulo}`);
  try {
    const filas = consultar(texto);
    if (filas.length === 0) console.log('   (nada)');
    else console.table(filas);
    return filas;
  } catch (e) {
    const m = String((e as { stderr?: string }).stderr || (e as Error).message || e).split('\n').find((l) => l.trim()) ?? '';
    console.log(`   ${opcional ? 'no disponible' : 'ERROR'}: ${m.slice(0, 200)}`);
    return [];
  }
}

const fecha = (col: string) => `datetime(${col} / 1000, 'unixepoch')`;
console.log(`Ingesta automática de resultados: ${local ? `copia local ${local}` : `producción (${DB}, remoto, sólo SELECT)`}; ventana ${horas} h`);

const tablas = bloque('esquema', `select name from sqlite_master where type = 'table' and name in
  ('resultado_auto_unidad', 'resultado_auto_revision', 'resultado_auto_evento', 'resultado_auto_consumo',
   'notificacion', 'notificacion_evento', 'notificacion_cursor') order by name`).map((f) => String(f.name));
const con0017 = tablas.includes('resultado_auto_unidad');
const con0014 = tablas.includes('notificacion_cursor');
if (!con0017) console.log('   >> falta 0017: la pasada responde migracion_pendiente y no hace nada');
if (!con0014) console.log('   >> falta 0014: tras cada pasada los avisos quedan en sin_tablas');

bloque('lease global de escritura sport_*', `select owner, lease_version, ${fecha('expires_at')} caduca,
  case when expires_at > cast(unixepoch('subsec') * 1000 as integer) then 'OCUPADO' else 'libre' end estado
  from sport_write_lease where key = 'global'`);

const [libro] = bloque('libro de capacidad', `select accounted_bytes, blocked from sport_capacity_ledger where key = 'global'`);
if (libro) {
  const margen = PRESUPUESTO - Number(libro.accounted_bytes);
  const mib = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MiB`;
  console.log(`   margen ${mib(margen)} de ${mib(PRESUPUESTO)}; mínimo para escribir ${mib(MARGEN_MIN)}` +
    `${Number(libro.blocked) ? ' — BLOQUEADO' : margen < MARGEN_MIN ? ' — POR DEBAJO DEL MÍNIMO (no escribirá)' : ''}`);
}

if (con0017) {
  bloque('consumo (hoy y ayer, UTC)', `select dia, clave, valor from resultado_auto_consumo
    where dia >= date('now', '-1 day') order by dia desc, clave`);
  bloque('unidades por fuente y estado', `select fuente, estado, count(*) n, ${fecha('max(ultima)')} ultima_vez
    from resultado_auto_unidad group by fuente, estado order by fuente, estado`);
  bloque(`unidades tocadas en las últimas ${horas} h`, `select clave, estado, fecha, detalle, intentos, escrito,
    ${fecha('ultima')} ultima, case when proxima >= 9000000000000 then 'nunca' else ${fecha('proxima')} end proxima
    from resultado_auto_unidad where ultima >= ${desde} and fuente <> 'indice' order by ultima desc, clave limit 60`);
  bloque('próximas unidades en cola', `select clave, estado, fecha, ${fecha('proxima')} proxima from resultado_auto_unidad
    where fuente <> 'indice' and estado in ('pendiente', 'esperando', 'error', 'hecho') and proxima < 9000000000000
    order by proxima, clave limit 12`);
  bloque('cola de revisión abierta', `select id, clave, motivo, substr(datos, 1, 160) datos, ${fecha('creada_en')} creada
    from resultado_auto_revision where estado = 'abierta' order by creada_en desc limit 30`);
  bloque(`eventos de las últimas ${horas} h`, `select tipo, count(*) n, count(distinct competition_id) pruebas,
    min(id) desde_id, max(id) hasta_id from resultado_auto_evento where creado_en >= ${desde} group by tipo`);
  bloque(`pruebas con eventos en las últimas ${horas} h`, `select e.competition_id, json_extract(min(e.datos), '$.competitionKey') prueba,
    json_extract(min(e.datos), '$.nombre') nombre, json_extract(min(e.datos), '$.fecha') fecha, count(*) eventos
    from resultado_auto_evento e where e.creado_en >= ${desde} group by e.competition_id order by eventos desc limit 20`);
}
if (con0014) {
  const [cursor] = bloque('cursor de avisos de la ingesta', `select fuente, ultimo_id, ${fecha('actualizado_en')} actualizado
    from notificacion_cursor where fuente = 'resultado_auto_evento'`);
  if (con0017) {
    bloque('eventos de la ingesta sin leer por el notificador', `select count(*) n from resultado_auto_evento
      where id > ${Number(cursor?.ultimo_id ?? 0)}`);
    if (!cursor) console.log('   >> sin cursor: la próxima pasada lo ancla antes de escribir');
  }
  bloque('bandeja de salida de eventos (notificacion_evento)', `select tipo, case when procesado_en is null then 'pendiente' else 'procesado' end estado,
    count(*) n, ${fecha('max(creado_en)')} ultimo from notificacion_evento where creado_en >= ${desde} group by 1, 2`);
  bloque(`avisos generados en las últimas ${horas} h`, `select tipo, count(*) n, count(distinct profile_id) perfiles,
    sum(push_enviada_en is not null) push from notificacion where creada_en >= ${desde} group by tipo`);
}
espia?.close();
