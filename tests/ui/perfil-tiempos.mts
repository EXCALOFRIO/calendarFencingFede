/**
 * Tiempo de servidor del perfil (/explorar/[personaId]) contra una copia
 * SQLite de D1 en sólo lectura: total por cargador y las sentencias más caras,
 * con su plan de consulta.
 *
 *   PERF_DB=<copia> [RANKING_SQL=<dir>] npx tsx tests/ui/perfil-tiempos.mts [personaId…]
 *
 * Con `RANKING_SQL` se mide sobre la copia con el ranking nacional cargado
 * (ver `ranking-superposicion.mts`). Las sentencias son síncronas en SQLite:
 * el total es la suma, que es la cota de lo que D1 tendría que leer.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cargarDiferidosPerfil } from '@/lib/sport/explorar/perfil-diferido';
import { cargarExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS } from '@/lib/sport/explorar/ficha-url';
import { crearContexto } from '../helpers/explorar';
import { bindingDeLectura, d1DeLectura, type Medida } from './d1-lectura.mts';
import { abrirSuperposicion } from './ranking-superposicion.mts';

const BASE = process.env.PERF_DB;
if (!BASE) throw new Error('Falta PERF_DB');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : [
  'b40372bf-0b56-4faf-a603-4e0b7f351739',
  '8bf5062e-5677-4540-b2bc-1ae911cda424',
];
const sqlite = process.env.RANKING_SQL
  ? abrirSuperposicion(BASE, process.env.RANKING_SQL, path.join(tmpdir(), 'perfil-tiempos.sqlite'))
  : new DatabaseSync(BASE, { readOnly: true });

const resumen = (s: string) => s.replace(/\s+/g, ' ').slice(0, 110);

for (const id of ids) {
  for (const ronda of [1, 2]) {
    const medidas: Medida[] = [];
    const ctx = { ...crearContexto().ctx, db: d1DeLectura(sqlite, medidas) };
    // Lo que va por el `db` global (la marca olímpica) también cuenta en el crítico.
    (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] = { env: { DB: bindingDeLectura(sqlite, medidas) }, ctx: {}, cf: {} };
    const t0 = performance.now();
    // ANTES=1 mide la carga de antes (todo en el camino crítico).
    const antes = Boolean(process.env.ANTES);
    const [vista] = await Promise.all([
      cargarFichaPantalla(ctx, id, CRITERIOS_FICHA_VACIOS, { diferirRivales: !antes }),
      cargarExtrasPerfil(ctx, id, { conRendimiento: antes }),
    ]);
    const total = performance.now() - t0;
    const suma = medidas.reduce((s, m) => s + m.ms, 0);
    console.log(`\n${id} ronda ${ronda}: ${vista.tipo} crítico=${total.toFixed(0)} ms, ${medidas.length} sentencias, suma SQL=${suma.toFixed(0)} ms`);
    if (!antes) {
      const diferidas: Medida[] = [];
      const t1 = performance.now();
      const d = cargarDiferidosPerfil({ ...crearContexto().ctx, db: d1DeLectura(sqlite, diferidas) }, id);
      await Promise.all([d.rendimiento, d.rivales, d.europeo]);
      console.log(`   diferido=${(performance.now() - t1).toFixed(0)} ms, ${diferidas.length} sentencias, suma SQL=${diferidas.reduce((s, m) => s + m.ms, 0).toFixed(0)} ms`);
    }
    if (ronda === 2) {
      for (const m of [...medidas].sort((a, b) => b.ms - a.ms).slice(0, Number(process.env.TOP ?? 10))) {
        console.log(`  ${m.ms.toFixed(0).padStart(6)} ms ${String(m.filas).padStart(5)} filas  ${resumen(m.sql)}`);
        if (process.env.PLAN) {
          try {
            const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${m.sql}`).all(...m.params) as { detail: string }[];
            for (const p of plan.slice(0, 12)) console.log(`           ${p.detail}`);
          } catch { /* plan sin parámetros reales */ }
        }
      }
    }
  }
}
sqlite.close();
