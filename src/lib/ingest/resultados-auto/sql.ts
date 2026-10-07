import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { dbConSportLease, MAX_BATCH_STATEMENTS, MAX_BIND_PARAMS, type SportLease } from '../sport-incremental/lease';

export type Fila = Record<string, unknown>;
export type Sentencia = { sql: string; params: unknown[]; filas: number };

/**
 * Acceso a D1 de la ingesta automática con SQL de texto y `?`.
 *
 *  - `leer`: sólo SELECT, sin lease.
 *  - `escribirDeporte`: tablas sport_*. Pasa por `dbConSportLease`, el mismo camino que el
 *    incremento deportivo: cada lote atómico abre y cierra el contexto de escritura con el lease
 *    global, mide el almacenamiento y lo cobra en el libro de capacidad. Nunca hay escrituras
 *    sport_* fuera de un lote así.
 *  - `escribirPropias`: tablas resultado_auto_* (sin guardas ni cargo).
 */
export interface BaseResultados {
  leer<T extends Fila = Fila>(texto: string, params?: readonly unknown[]): Promise<T[]>;
  escribirDeporte(sentencias: readonly Sentencia[]): Promise<void>;
  escribirPropias(sentencias: readonly Omit<Sentencia, 'filas'>[]): Promise<void>;
  /** Filas sport_* planificadas y enviadas en esta pasada. */
  readonly filasEscritas: number;
}

/** Une texto con `?` y parámetros en un SQL de Drizzle (los `?` nunca van dentro de literales). */
export function aSql(texto: string, params: readonly unknown[] = []): SQL {
  const partes = texto.split('?');
  if (partes.length - 1 !== params.length) throw new Error('resultados_auto_parametros');
  const trozos: SQL[] = [sql.raw(partes[0])];
  params.forEach((p, i) => {
    trozos.push(sql`${p === undefined ? null : p}`);
    trozos.push(sql.raw(partes[i + 1]));
  });
  return sql.join(trozos, sql.raw(''));
}

export function crearBaseResultados(
  rawDb: Db,
  lease: SportLease | null,
  presupuesto: { comprobar: () => void; reservarFilas: (n: number) => void },
): BaseResultados {
  let filas = 0;
  const leaseDb = lease
    ? dbConSportLease(rawDb, lease, presupuesto.comprobar, () => {})
    : null;
  const trocear = <T>(lista: readonly T[], n: number) => {
    const salida: T[][] = [];
    for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
    return salida;
  };
  return {
    get filasEscritas() { return filas; },
    async leer<T extends Fila>(texto: string, params: readonly unknown[] = []) {
      if (!/^\s*(select|with)\b/i.test(texto)) throw new Error('resultados_auto_lectura_no_select');
      return (await rawDb.execute<T>(aSql(texto, params))).rows;
    },
    async escribirDeporte(sentencias) {
      if (!sentencias.length) return;
      if (!leaseDb) throw new Error('resultados_auto_sin_lease');
      for (const s of sentencias) if (s.params.length > MAX_BIND_PARAMS) throw new Error('resultados_auto_bind_limit');
      // Reserve the whole set first: a per-pass cap must never split a competition halfway.
      const total = sentencias.reduce((n, s) => n + s.filas, 0);
      presupuesto.reservarFilas(total);
      for (const lote of trocear(sentencias, MAX_BATCH_STATEMENTS - 2)) {
        const consultas = lote.map((s) => leaseDb.execute(aSql(s.sql, s.params)));
        const [primera, ...resto] = consultas;
        await leaseDb.batch([primera, ...resto]);
        filas += lote.reduce((n, s) => n + s.filas, 0);
      }
    },
    async escribirPropias(sentencias) {
      for (const lote of trocear(sentencias, 90)) {
        if (!lote.length) continue;
        const consultas = lote.map((s) => rawDb.execute(aSql(s.sql, s.params)));
        const [primera, ...resto] = consultas;
        await rawDb.batch([primera, ...resto]);
      }
    },
  };
}
