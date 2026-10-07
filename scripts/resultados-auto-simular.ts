/**
 * Ensayo local de la ingesta automática de resultados sobre una COPIA de trabajo de D1.
 *
 *   npx tsx scripts/resultados-auto-simular.ts --d1-local <copia.sqlite> --casete <dir>
 *     [--grabar] [--ahora 2026-10-07T10:20:00Z] [--pasadas 6] [--forzar] [--sin-huella]
 *
 *  - Nunca abre una exportación de producción (`nuevoN.sqlite`) ni nada remoto.
 *  - Aplica 0017 si falta (la copia es desechable).
 *  - `--casete`: con `--grabar` pide a las fuentes reales y guarda cada respuesta; sin él
 *    reproduce lo guardado y falla si una petición no está grabada (ensayo sin red).
 *  - Cada pasada avanza el reloj una hora, como el cron.
 *  - `--forzar`: antes de cada pasada (salvo la primera) vuelve a poner en cola todas las
 *    unidades; `--sin-huella` borra además la huella para que la carga compare fila a fila.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrirD1Local } from '../src/lib/ingest/sport-incremental/local';
import { ejecutarResultadosAuto } from '../src/lib/ingest/resultados-auto/ejecutar';
import { POR_DEFECTO } from '../src/lib/ingest/resultados-auto/config';
import type { Transporte } from '../src/lib/ingest/resultados-auto/red';
import { presupuestoD1 } from '../src/lib/ingest/backfill/capacidad-db';

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const bandera = (nombre: string) => process.argv.includes(nombre);

const ruta = arg('--d1-local');
const casete = arg('--casete');
if (!ruta || !casete) throw new Error('uso: --d1-local <copia.sqlite> --casete <dir> [--grabar]');
if (/nuevo\d+\.sqlite$/i.test(basename(ruta))) throw new Error('esa es la exportación de producción: usa una copia de trabajo');
const grabar = bandera('--grabar');
const pasadas = Number(arg('--pasadas') ?? '1');
const ahora0 = Date.parse(arg('--ahora') ?? new Date().toISOString());
mkdirSync(casete, { recursive: true });

{
  const s = new DatabaseSync(resolve(ruta));
  if (!s.prepare(`select 1 from sqlite_master where name='resultado_auto_unidad'`).get()) {
    s.exec(readFileSync(resolve(import.meta.dirname, '..', 'drizzle-d1', '0017_resultados_automaticos.sql'), 'utf8'));
    console.log('0017 aplicada a la copia');
  }
  s.close();
}

const claveDe = (url: string, init: RequestInit) =>
  createHash('sha256').update(`${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`).digest('hex').slice(0, 32);

const transporte: Transporte = async (url, init) => {
  const k = claveDe(url, init);
  const meta = join(casete, `${k}.json`), cuerpo = join(casete, `${k}.bin`);
  if (existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as { status: number; tipo: string | null };
    return new Response(m.status === 204 ? null : readFileSync(cuerpo), { status: m.status, headers: m.tipo ? { 'content-type': m.tipo } : {} });
  }
  if (!grabar) throw new Error(`no grabada: ${init.method ?? 'GET'} ${url}`);
  const res = await fetch(url, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(cuerpo, bytes);
  writeFileSync(meta, JSON.stringify({ url, metodo: init.method ?? 'GET', status: res.status, tipo: res.headers.get('content-type') }));
  return new Response(bytes, { status: res.status, headers: res.headers });
};

const recuento = (s: DatabaseSync) => Object.fromEntries(
  ['sport_competition', 'sport_result', 'sport_bout', 'sport_person', 'sport_person_alias', 'sport_external_id',
    'sport_link_candidate', 'sport_import_coverage'].map((t) => [t, Number((s.prepare(`select count(*) n from ${t}`).get() as { n: number }).n)]));

const { db, close } = abrirD1Local(resolve(ruta), true);
const espia = new DatabaseSync(resolve(ruta), { readOnly: true });
const antes = recuento(espia);
console.log('antes', antes);
let ahora = ahora0;
let uuidN = 0;
for (let i = 0; i < pasadas; i++) {
  if (i > 0 && bandera('--forzar')) {
    const w = new DatabaseSync(resolve(ruta));
    w.exec(`update resultado_auto_unidad set proxima=0 ${bandera('--sin-huella') ? ', huella=null' : ''} where fuente <> 'indice' and estado <> 'revision'`);
    w.close();
  }
  const t0 = performance.now();
  const r = await ejecutarResultadosAuto({
    db, presupuestoBytes: presupuestoD1(),
    config: { ...POR_DEFECTO, habilitado: true, iaHabilitada: false, maxMs: Number(arg('--max-ms') ?? POR_DEFECTO.maxMs) },
    ahora: () => Math.round(ahora + (performance.now() - t0)),
    transporte, pausaMs: grabar ? 400 : 0,
    uuid: () => `sim-${process.pid}-${++uuidN}`,
  });
  console.log(`pasada ${i + 1} (${new Date(ahora).toISOString()}) ${Math.round(performance.now() - t0)} ms`,
    JSON.stringify({ ...r, detalle: undefined }));
  for (const d of r.detalle) console.log('   ', d.clave, d.estado, d.motivo ?? '', d.filas);
  ahora += 3_600_000;
}
const despues = recuento(espia);
console.log('después', despues);
console.log('diferencia', Object.fromEntries(Object.entries(despues).map(([k, v]) => [k, v - antes[k as keyof typeof antes]])));
for (const f of espia.prepare(`select clave, estado, detalle, intentos from resultado_auto_unidad order by clave`).all()) console.log('unidad', JSON.stringify(f));
for (const f of espia.prepare(`select clave, motivo, substr(datos,1,300) datos from resultado_auto_revision`).all()) console.log('revision', JSON.stringify(f));
for (const f of espia.prepare(`select tipo, count(*) n from resultado_auto_evento group by tipo`).all()) console.log('eventos', JSON.stringify(f));
espia.close();
close();
