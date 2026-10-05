/**
 * Orden, filas leídas (contador `rows_read` de D1 en workerd) y tiempo del
 * buscador social de Explorar con los mismos lectores que la API.
 *
 *   D1_ESTADO=<carpeta persist de miniflare con la copia> npx tsx tests/ui/_buscador-social-filas.mts
 *
 * La copia (con 0004 aplicada y el índice reconstruido) se coloca a mano en
 * `<estado>/d1/miniflare-D1DatabaseObject/<hash>.sqlite`. Sólo ejecuta SELECT.
 * SEGUIDAS=id,id simula personas seguidas por la cuenta de prueba si la copia
 * ya tiene esas filas en sport_favorite. LISTAS=q,q elige las listas completas
 * medidas y PAGINA2=q,q las que además piden la segunda página.
 */
import { getPlatformProxy } from 'wrangler';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { buscarDeportistas } from '@/lib/sport/explorar/busqueda';
import { leerPropuestasParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { crearContexto, perfil } from '../helpers/explorar';

const ESTADO = process.env.D1_ESTADO;
if (!ESTADO) throw new Error('Falta D1_ESTADO');
const CUENTA = process.env.CUENTA ?? '00000000-0000-4000-8000-0000000000a1';

const proxy = await getPlatformProxy({ persist: { path: ESTADO }, envFiles: [], remoteBindings: false } as never);
type D1Real = {
  prepare(q: string): {
    bind(...p: unknown[]): { all(): Promise<{ results: unknown[]; meta: { rows_read: number; duration: number } }> };
  };
};
const real = (proxy.env as { DB: D1Real }).DB;

let leidas = 0;
const detalle: { sql: string; filas: number; leidas: number; ms: number }[] = [];

function sentencia(query: string, values: unknown[] = []): D1Statement & { _x: () => Promise<D1QueryResult<unknown>> } {
  const ejecutar = async (): Promise<D1QueryResult<unknown>> => {
    if (!/^\s*(SELECT|WITH)\b/i.test(query)) throw new Error(`sólo lectura: ${query.slice(0, 60)}`);
    const r = await real.prepare(query).bind(...values).all();
    leidas += r.meta.rows_read;
    detalle.push({ sql: query.replace(/\s+/g, ' ').slice(0, 60), filas: r.results.length, leidas: r.meta.rows_read, ms: Math.round(r.meta.duration) });
    return { success: true, results: r.results, meta: r.meta } as unknown as D1QueryResult<unknown>;
  };
  return {
    _x: ejecutar,
    bind: (...p: unknown[]) => sentencia(query, p),
    all: async <T>() => (await ejecutar()) as D1QueryResult<T>,
    run: async <T>() => (await ejecutar()) as D1QueryResult<T>,
    raw: async <T>() => (await ejecutar()).results.map((x) => Object.values(x as object)) as unknown as T[],
    first: async <T>(columna?: string) => {
      const fila = (await ejecutar()).results[0] as Record<string, unknown> | undefined;
      return (fila ? (columna ? fila[columna] : fila) : null) as T | null;
    },
  } as never;
}

const binding: D1Binding = {
  prepare: (q) => sentencia(q),
  batch: async <T>(sts: D1Statement[]) =>
    Promise.all(sts.map((s) => (s as unknown as { _x: () => Promise<D1QueryResult<T>> })._x())),
};
const db = createD1Database(binding);
const ctx = {
  ...crearContexto({ perfil: perfil({ profileId: CUENTA }) }).ctx,
  db,
  indiceExplorar: async () => true,
};

async function medir<T>(nombre: string, f: () => Promise<T>): Promise<T> {
  const tiempos: number[] = [];
  let r: T | undefined;
  let ultimo: typeof detalle = [];
  let filas = 0;
  for (let i = 0; i < 3; i++) {
    leidas = 0;
    detalle.length = 0;
    const t = performance.now();
    r = await f();
    tiempos.push(Math.round(performance.now() - t));
    filas = leidas;
    ultimo = [...detalle];
  }
  console.log(`\n${nombre.padEnd(30)} filas leídas=${String(filas).padStart(7)}  consultas=${ultimo.length}  ms=${tiempos.join('/')}`);
  console.log(ultimo.map((d) => `    ${String(d.leidas).padStart(7)} filas, ${String(d.ms).padStart(4)} ms  ${d.sql}`).join('\n'));
  return r as T;
}

const CONSULTAS = (process.env.CONSULTAS ?? 'zabal,zabala,zabla,alejandro,ramirez,maria garcia,jorgensen,jorgensn,lim,cheung').split(',');
for (const q of CONSULTAS) {
  const r = await medir(`sugerencias «${q}»`, () => sugerirPersonas(ctx, { q, limite: 20 }));
  if (r.estado !== 'ok') { console.log(`  ${r.estado}`); continue; }
  const ids = r.items.map((i) => i.id);
  const pesos = new Map(
    (await real.prepare(`SELECT id, peso FROM explorar_persona WHERE id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(ids)).all()).results.map((f) => [(f as { id: string }).id, (f as { peso: number }).peso]),
  );
  r.items.slice(0, Number(process.env.TOP ?? 10)).forEach((i, k) => {
    console.log(`  ${String(k + 1).padStart(2)}. ${i.nombre.padEnd(34)} ${String(i.pais ?? '-').padEnd(3)} peso=${String(pesos.get(i.id) ?? 0).padStart(5)} resultados=${String(i.resultados).padStart(4)} última=${i.ultimaFecha?.slice(0, 4) ?? '----'}${i.seguida ? ' SIGUE' : ''}${i.alias ? ` (alias ${i.alias})` : ''}`);
  });
}

if (!process.env.SOLO_SUGERENCIAS) {
  const LISTAS = (process.env.LISTAS ?? 'alejandro,maria garcia,zabal,zabala').split(',');
  for (const q of LISTAS) {
    const r = await medir(`lista completa «${q}»`, () => buscarDeportistas(ctx, { q }));
    if (r.estado !== 'ok') { console.log(`  ${r.estado}`); continue; }
    r.items.slice(0, Number(process.env.TOP ?? 10)).forEach((i, k) => {
      console.log(`  ${String(k + 1).padStart(2)}. ${i.nombre.padEnd(34)} ${String(i.pais ?? '-').padEnd(3)} resultados=${String(i.resultadosImportados).padStart(4)} última=${i.trayectoria.ultima?.fecha?.slice(0, 4) ?? '----'}`);
    });
    if ((process.env.PAGINA2 ?? 'alejandro').split(',').includes(q) && r.siguiente) {
      const cursor = r.siguiente;
      const r2 = await medir(`lista completa «${q}» página 2`, () => buscarDeportistas(ctx, { q, cursor }));
      if (r2.estado === 'ok') {
        const repetidos = r2.items.filter((i) => r.items.some((x) => x.id === i.id)).length;
        console.log(`  página 2: ${r2.items.length} personas, ${repetidos} repetidas; primera ${r2.items[0]?.nombre ?? '-'}`);
      } else console.log(`  página 2: ${r2.estado}`);
    }
  }
  await medir('propuestas para seguir', () => leerPropuestasParaSeguir(ctx));
}
await proxy.dispose();
