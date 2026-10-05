/**
 * Filas leídas (contador `rows_read` de D1 en workerd, el mismo que factura
 * producción) y tiempo de la ficha y del cara a cara con los mismos cargadores
 * que las páginas.
 *
 *   D1_ESTADO=<carpeta persist de miniflare con la copia> npx tsx tests/ui/_filas-perfil.mts
 *
 * La copia se coloca a mano en `<estado>/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`
 * (ver el informe del trabajo); aquí sólo se leen sentencias SELECT.
 */
import { getPlatformProxy } from 'wrangler';
import { createD1Database } from '@/db/d1/runtime';
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { CRITERIOS_CARA_A_CARA_VACIOS } from '@/lib/sport/explorar/cara-a-cara-url';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { CRITERIOS_FICHA_VACIOS, type CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import { crearContexto } from '../helpers/explorar';

const ESTADO = process.env.D1_ESTADO;
if (!ESTADO) throw new Error('Falta D1_ESTADO');

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
    detalle.push({ sql: query.replace(/\s+/g, ' ').slice(0, 70), filas: r.results.length, leidas: r.meta.rows_read, ms: Math.round(r.meta.duration) });
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
const ctx = { ...crearContexto().ctx, db: createD1Database(binding) };

async function medir(nombre: string, f: () => Promise<unknown>) {
  const tiempos: number[] = [];
  let filas = 0;
  let ultimo: typeof detalle = [];
  for (let i = 0; i < 3; i++) {
    leidas = 0;
    detalle.length = 0;
    const t = performance.now();
    await f();
    tiempos.push(Math.round(performance.now() - t));
    filas = leidas;
    ultimo = [...detalle];
  }
  console.log(`${nombre.padEnd(34)} filas leídas=${String(filas).padStart(7)}  consultas=${ultimo.length}  ms=${tiempos.join('/')}`);
  if (process.env.DETALLE) console.table(ultimo.sort((a, b) => b.leidas - a.leidas).slice(0, 8));
}

const ZABALA = '8bf5062e-5677-4540-b2bc-1ae911cda424';
const RAMIREZ = '58671832-da43-4fc9-bafa-4354747a347e';
const PESADA = '513f3cc3-1eb1-4a69-868f-7ef24bef5657';
const EXTRA = (process.env.PERSONAS ?? '').split(',').filter(Boolean);
const PAREJAS = (process.env.PAREJAS ?? '').split(',').filter(Boolean).map((p) => p.split(':') as [string, string]);

const ficha = (id: string, c: Partial<CriteriosFicha> = {}) => async () => {
  const v = await cargarFichaPantalla(ctx, id, { ...CRITERIOS_FICHA_VACIOS, ...c });
  if (v.tipo !== 'ok') throw new Error(`${id}: ${v.tipo}`);
};

for (const id of [ZABALA, RAMIREZ, PESADA, ...EXTRA]) {
  await medir(`ficha ${id.slice(0, 8)}`, ficha(id));
  if (process.env.AMBITOS) {
    await medir(`ficha ${id.slice(0, 8)} internacional`, ficha(id, { ambito: 'internacional' } as never));
    await medir(`ficha ${id.slice(0, 8)} nacional`, ficha(id, { ambito: 'nacional' } as never));
  }
  let primero: string | undefined;
  await medir(`cara a cara ${id.slice(0, 8)} elegir`, async () => {
    const v = await cargarCaraACaraPantalla(ctx, id, CRITERIOS_CARA_A_CARA_VACIOS);
    if (v.tipo === 'elegir' && v.rivales.tipo === 'ok') primero = v.rivales.items[0]?.id;
  });
  // El rival con más asaltos: el cara a cara más caro de esa persona.
  if (primero) PAREJAS.push([id, primero]);
}
for (const [a, b] of PAREJAS) {
  await medir(`cara a cara ${a.slice(0, 8)}-${b.slice(0, 8)}`, async () => {
    const v = await cargarCaraACaraPantalla(ctx, a, { ...CRITERIOS_CARA_A_CARA_VACIOS, rival: b });
    if (v.tipo !== 'ok') throw new Error(`${a}/${b}: ${v.tipo}`);
  });
}
await proxy.dispose();
