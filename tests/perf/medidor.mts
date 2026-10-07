/**
 * Enlace D1 que apunta cada sentencia: SQL, parámetros, cuándo empezó y
 * acabó, filas devueltas y `meta.rows_read` / `rows_written` (las que factura
 * Cloudflare). Envuelve cualquier D1 (el local de workerd o el remoto) sin
 * cambiar lo que devuelve.
 *
 * `raw()` de D1 no trae `meta`: esas sentencias se apuntan con `leidas: null`
 * y `completarLecturas` las repite con `all()` DESPUÉS de la ruta, para no
 * inflar el tiempo medido. Sólo vale para lecturas, que es lo que se mide.
 */
import type { D1Binding, D1QueryResult, D1Statement } from '@/db/d1/binding';

export type Registro = {
  sql: string;
  params: unknown[];
  inicio: number;
  fin: number;
  devueltas: number;
  leidas: number | null;
  escritas: number;
  /** Tiempo del motor según D1 (`meta.duration`), sin la ida y vuelta. */
  motorMs: number | null;
  via: 'all' | 'run' | 'raw' | 'first' | 'batch';
};

const origen = Symbol('medidor');
type Envuelta = D1Statement & { [origen]: { st: D1Statement; sql: string; params: unknown[] } };

/** `registro` puede ser una función para cambiar de lista entre rutas sin rehacer el enlace. */
export function medidor(base: D1Binding, registro: Registro[] | (() => Registro[])): D1Binding {
  const lista = typeof registro === 'function' ? registro : () => registro;
  const apuntar = (r: Omit<Registro, 'fin'>, meta?: D1QueryResult['meta']) => {
    lista().push({
      ...r,
      fin: performance.now(),
      leidas: meta ? meta.rows_read ?? null : r.leidas,
      escritas: meta?.rows_written ?? 0,
      motorMs: meta?.duration ?? null,
    });
  };
  const envolver = (st: D1Statement, sql: string, params: unknown[]): Envuelta => ({
    [origen]: { st, sql, params },
    bind: (...p: unknown[]) => envolver(st.bind(...p), sql, p),
    async all<T>() {
      const inicio = performance.now();
      const r = await st.all<T>();
      apuntar({ sql, params, inicio, devueltas: r.results.length, leidas: null, escritas: 0, motorMs: null, via: 'all' }, r.meta);
      return r;
    },
    async run<T>() {
      const inicio = performance.now();
      const r = await st.run<T>();
      apuntar({ sql, params, inicio, devueltas: r.results?.length ?? 0, leidas: null, escritas: 0, motorMs: null, via: 'run' }, r.meta);
      return r;
    },
    async first<T>(columna?: string) {
      const inicio = performance.now();
      const r = await st.all<Record<string, unknown>>();
      apuntar({ sql, params, inicio, devueltas: r.results.length, leidas: null, escritas: 0, motorMs: null, via: 'first' }, r.meta);
      const fila = r.results[0];
      return (fila ? (columna ? fila[columna] : fila) : null) as T | null;
    },
    async raw<T>(opciones?: { columnNames?: false }) {
      const inicio = performance.now();
      const filas = await st.raw<T>(opciones);
      apuntar({ sql, params, inicio, devueltas: filas.length, leidas: null, escritas: 0, motorMs: null, via: 'raw' });
      return filas;
    },
  });
  return {
    prepare: (sql) => envolver(base.prepare(sql), sql, []),
    async batch<T>(sts: D1Statement[]) {
      const inicio = performance.now();
      const datos = sts.map((s) => (s as Envuelta)[origen]);
      const rs = await base.batch<T>(datos.map((d) => d.st));
      rs.forEach((r, i) => apuntar({
        sql: datos[i].sql, params: datos[i].params, inicio, devueltas: r.results?.length ?? 0,
        leidas: null, escritas: 0, motorMs: null, via: 'batch',
      }, r.meta));
      return rs;
    },
  };
}

/** Rellena `leidas` de las sentencias `raw()` repitiéndolas con `all()`. */
export async function completarLecturas(base: D1Binding, registro: Registro[]): Promise<void> {
  for (const r of registro) {
    if (r.leidas !== null) continue;
    if (!/^\s*(SELECT|WITH)\b/i.test(r.sql)) continue;
    const x = await base.prepare(r.sql).bind(...r.params).all();
    r.leidas = x.meta.rows_read;
    r.motorMs = x.meta.duration;
  }
}

/**
 * Idas a la base en el camino crítico: la cadena más larga de sentencias en
 * la que cada una empieza después de que acabe la anterior. En producción
 * cada ida del Worker a D1 cuesta su latencia de red, así que esto pesa más
 * que el tiempo del motor.
 */
export function idasEnSerie(registro: readonly Registro[]): number {
  const orden = [...registro].sort((a, b) => a.inicio - b.inicio);
  const prof: number[] = [];
  let max = 0;
  orden.forEach((r, i) => {
    let p = 1;
    for (let j = 0; j < i; j++) if (orden[j].fin <= r.inicio && prof[j] + 1 > p) p = prof[j] + 1;
    prof.push(p);
    if (p > max) max = p;
  });
  return max;
}
