/**
 * Refresca la copia SQLite local (la base de los lotes manuales) con lo que el cron de
 * resultados automáticos (src/lib/ingest/resultados-auto) escribió en D1 desde el último lote,
 * y comprueba que las tablas de sincronizar-d1 (TABLAS) quedan idénticas a producción.
 *
 *   --copia <sqlite> [--desde <ISO|ms>] [--aplicar] [--solo-verificar] [--bisecar] [--max-consultas 200]
 *
 * Sin --aplicar la copia se abre en sólo lectura y sólo se informa. En producción sólo se
 * lee (consultarRemoto de sincronizar-d1.ts).
 *
 * Qué se trae:
 *  - Competiciones tocadas desde --desde (sport_competition.updated_at, sport_import_coverage.updated_at,
 *    sport_result/sport_bout first_seen_at/revised_at, resultado_auto_evento.creado_en): se traen
 *    enteras (edición, prueba, puestos, asaltos, cobertura, pruebas conjuntas) y se reemplazan sus filas,
 *    porque el cron enlaza person_id en puestos y asaltos sin tocar marcas de tiempo.
 *  - Filas con alguna marca de tiempo posterior en el resto de tablas (personas, alias, IDs externos,
 *    candidatos, cobertura, ediciones, perfil_deportista): upsert por clave primaria.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { argumento, bandera, quitarGuardia, restaurarGuardia } from './comun';
import { TABLAS, combinarAgregados, consultarRemoto, consultasAgregado, literal, type Agregado } from './sincronizar-d1';

/** Misma forma que el resultado de `wrangler d1 execute --json`: un elemento por sentencia. */
export type ConsultaRemota = (sql: string) => { results: Record<string, unknown>[] }[];

type Valor = null | bigint | number | string | Uint8Array;
type Fila = Record<string, Valor>;

/** consultarRemoto rechaza más de 30.000 caracteres por llamada. */
const MAX_LLAMADA = 28_000;
const PAGINA = 1000;
const IDS_POR_CONSULTA = 40;
/** Igual que agregadoRemoto: por encima de esto la tabla se agrega por tramos de id. */
const UMBRAL_PARTICION = 50_000;
/** Un tramo con como mucho estas filas se compara fila a fila (id + huella). */
const LISTA_MAX = 2000;
const DIVISIONES = 16;
const MARCAS = ['created_at', 'updated_at', 'first_seen_at', 'revised_at', 'decided_at', 'linked_at', 'athlete_linked_at', 'last_checked_at'];
/** Tablas fuera de TABLAS que se refrescan por marca de tiempo (no se verifican por agregados). */
const EXTRA = ['perfil_deportista'] as const;
/** Mismos límites que consultasAgregado(..., true). */
const LIMITES: (string | null)[] = [null, '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', null];
/** Hijas de sport_competition que se reemplazan enteras por competición. */
const HIJAS: Record<string, string[]> = {
  sport_result: ['competition_id'],
  sport_bout: ['competition_id'],
  sport_import_coverage: ['competition_id'],
  sport_competition_combined: ['part_competition_id', 'combined_competition_id'],
};

const q = (identificador: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(identificador)) throw new Error(`identificador_no_permitido:${identificador}`);
  return `"${identificador}"`;
};
const lista = (ids: Iterable<unknown>) => [...ids].map((x) => literal(x)).join(',');
const trozos = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ---------------------------------------------------------------------------
// Remoto

class Remoto {
  consultas = 0;
  llamadas = 0;
  constructor(private readonly consultar: ConsultaRemota) {}

  /** Agrupa sentencias en llamadas de menos de MAX_LLAMADA caracteres; devuelve las filas de cada una. */
  varias(sqls: string[]): Record<string, unknown>[][] {
    const salida: Record<string, unknown>[][] = [];
    let grupo: string[] = [];
    let largo = 0;
    const vaciar = () => {
      if (!grupo.length) return;
      const r = this.consultar(grupo.join(';\n'));
      this.llamadas += 1;
      if (!Array.isArray(r) || r.length !== grupo.length) throw new Error(`respuesta_remota_incompleta (${r?.length} de ${grupo.length})`);
      for (const x of r) salida.push(x.results ?? []);
      grupo = [];
      largo = 0;
    };
    for (const s of sqls) {
      if (s.length > MAX_LLAMADA) throw new Error(`consulta_demasiado_larga:${s.length}`);
      if (grupo.length && largo + s.length + 2 > MAX_LLAMADA) vaciar();
      grupo.push(s);
      largo += s.length + 2;
      this.consultas += 1;
    }
    vaciar();
    return salida;
  }

  una(sql: string): Record<string, unknown>[] {
    return this.varias([sql])[0];
  }
}

// ---------------------------------------------------------------------------
// Esquema

interface Esquema {
  tabla: string;
  pk: string;
  columnas: string[];
  version: string | null;
  marcas: string[];
}

function esquemaLocal(db: DatabaseSync, tabla: string): Esquema | null {
  const filas = db.prepare(`SELECT name, type, pk FROM pragma_table_info(?)`).all(tabla) as { name: string; type: string; pk: number }[];
  if (!filas.length) return null;
  const pk = filas.filter((f) => Number(f.pk) > 0).map((f) => f.name);
  if (pk.length !== 1) throw new Error(`pk_no_soportada:${tabla}`);
  const columnas = filas.map((f) => f.name);
  return {
    tabla,
    pk: pk[0],
    columnas,
    // Mismo criterio que infoTabla de sincronizar-d1.ts.
    version: columnas.includes('revised_at') ? 'revised_at' : columnas.includes('updated_at') ? 'updated_at' : null,
    marcas: filas.filter((f) => MARCAS.includes(f.name) && /INT/i.test(f.type)).map((f) => f.name),
  };
}

/** Columnas con su tipo exacto: JSON no distingue 12 de 12.0 ni conserva enteros de más de 53 bits. */
function seleccionTipada(e: Esquema, donde: string, limite?: number): string {
  const cols = e.columnas
    .map((c) => `typeof(${q(c)}) AS ${q(`t_${c}`)}, CASE typeof(${q(c)}) WHEN 'integer' THEN CAST(${q(c)} AS TEXT) WHEN 'blob' THEN hex(${q(c)}) ELSE ${q(c)} END AS ${q(`v_${c}`)}`)
    .join(', ');
  return `SELECT ${cols} FROM ${q(e.tabla)} WHERE ${donde} ORDER BY ${q(e.pk)}${limite ? ` LIMIT ${limite}` : ''}`;
}

function decodificar(e: Esquema, r: Record<string, unknown>): Fila {
  const f: Fila = {};
  for (const c of e.columnas) {
    const t = r[`t_${c}`];
    const v = r[`v_${c}`];
    if (t === 'null') f[c] = null;
    else if (t === 'integer') f[c] = BigInt(String(v));
    else if (t === 'real') f[c] = Number(v);
    else if (t === 'text') f[c] = String(v);
    else if (t === 'blob') f[c] = new Uint8Array(Buffer.from(String(v), 'hex'));
    else throw new Error(`tipo_remoto_desconocido:${e.tabla}.${c}:${String(t)}`);
  }
  return f;
}

/** Filas remotas que cumplen `donde`, paginadas por clave primaria. */
function traerFilas(remoto: Remoto, e: Esquema, donde: string): Fila[] {
  const salida: Fila[] = [];
  let ultimo: Valor = null;
  for (;;) {
    const cond: string = ultimo === null ? `(${donde})` : `(${donde}) AND ${q(e.pk)} > ${literal(ultimo)}`;
    const filas = remoto.una(seleccionTipada(e, cond, PAGINA)).map((r) => decodificar(e, r));
    salida.push(...filas);
    if (filas.length < PAGINA) return salida;
    ultimo = filas[filas.length - 1][e.pk];
  }
}

function traerPorValores(remoto: Remoto, e: Esquema, columnas: string[], valores: Iterable<string>): Fila[] {
  const salida: Fila[] = [];
  for (const t of trozos([...valores], IDS_POR_CONSULTA)) {
    salida.push(...traerFilas(remoto, e, columnas.map((c) => `${q(c)} IN (${lista(t)})`).join(' OR ')));
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Plan de cambios

interface CambiosTabla {
  upserts: Map<string, Fila>;
  borrar: Set<string>;
}
export interface Recuento {
  insertar: number;
  actualizar: number;
  borrar: number;
  iguales: number;
}
type Plan = Map<string, CambiosTabla>;

const cambios = (plan: Plan, tabla: string): CambiosTabla => {
  let c = plan.get(tabla);
  if (!c) plan.set(tabla, (c = { upserts: new Map(), borrar: new Set() }));
  return c;
};
const ordenTablas = (esquemas: Map<string, Esquema>) => [...TABLAS, ...EXTRA].filter((t) => esquemas.has(t));

function filaLocal(db: DatabaseSync, e: Esquema, id: string): Fila | undefined {
  const st = db.prepare(`SELECT * FROM ${q(e.tabla)} WHERE ${q(e.pk)} = ?`);
  st.setReadBigInts(true);
  return st.get(id) as Fila | undefined;
}

const igualFila = (e: Esquema, a: Fila, b: Fila) => e.columnas.every((c) => literal(a[c]) === literal(b[c]));

/** Quita del plan las filas ya iguales en la copia y cuenta altas, cambios y bajas. */
function clasificar(db: DatabaseSync, plan: Plan, esquemas: Map<string, Esquema>): Record<string, Recuento> {
  const salida: Record<string, Recuento> = {};
  for (const t of ordenTablas(esquemas)) {
    const c = plan.get(t);
    const r: Recuento = { insertar: 0, actualizar: 0, borrar: 0, iguales: 0 };
    salida[t] = r;
    if (!c) continue;
    const e = esquemas.get(t)!;
    for (const [id, fila] of [...c.upserts]) {
      const local = filaLocal(db, e, id);
      if (!local) r.insertar += 1;
      else if (igualFila(e, local, fila)) {
        r.iguales += 1;
        c.upserts.delete(id);
      } else r.actualizar += 1;
    }
    for (const id of [...c.borrar]) {
      if (c.upserts.has(id) || !filaLocal(db, e, id)) c.borrar.delete(id);
    }
    r.borrar = c.borrar.size;
  }
  return salida;
}

/** Antes de borrar, comprueba en remoto que la fila no se ha movido a otra competición. */
function confirmarBorrados(remoto: Remoto, plan: Plan, esquemas: Map<string, Esquema>) {
  for (const [t, c] of plan) {
    const candidatos = [...c.borrar].filter((id) => !c.upserts.has(id));
    if (!candidatos.length) continue;
    const e = esquemas.get(t)!;
    for (const f of traerPorValores(remoto, e, [e.pk], candidatos)) {
      const id = String(f[e.pk]);
      c.borrar.delete(id);
      c.upserts.set(id, f);
    }
  }
}

/**
 * Trae los padres (dentro de las tablas refrescadas) que faltan en la copia y en el plan: p. ej.
 * un asalto que pasó a una prueba antigua, o la edición de una prueba traída por bisección.
 */
function completarPadres(db: DatabaseSync, remoto: Remoto, plan: Plan, esquemas: Map<string, Esquema>) {
  const fks = new Map<string, { columna: string; padre: string }[]>();
  for (const t of esquemas.keys()) {
    const todas = db.prepare(`SELECT "table" AS padre, "from" AS columna, "to" AS destino FROM pragma_foreign_key_list(?)`).all(t) as {
      padre: string; columna: string; destino: string | null;
    }[];
    fks.set(t, todas.filter((f) => esquemas.has(f.padre) && (f.destino === null || f.destino === esquemas.get(f.padre)!.pk)));
  }
  const intentados = new Set<string>();
  for (;;) {
    const faltan = new Map<string, Set<string>>();
    for (const [t, c] of plan) {
      for (const f of c.upserts.values()) {
        for (const fk of fks.get(t) ?? []) {
          const v = f[fk.columna];
          if (v === null || v === undefined) continue;
          const id = String(v);
          const clave = `${fk.padre}|${id}`;
          if (intentados.has(clave) || plan.get(fk.padre)?.upserts.has(id) || filaLocal(db, esquemas.get(fk.padre)!, id)) continue;
          intentados.add(clave);
          let s = faltan.get(fk.padre);
          if (!s) faltan.set(fk.padre, (s = new Set()));
          s.add(id);
        }
      }
    }
    if (!faltan.size) return;
    for (const [padre, ids] of faltan) {
      const e = esquemas.get(padre)!;
      for (const f of traerPorValores(remoto, e, [e.pk], ids)) cambios(plan, padre).upserts.set(String(f[e.pk]), f);
    }
  }
}

function planVacio(plan: Plan) {
  return [...plan.values()].every((c) => !c.upserts.size && !c.borrar.size);
}

function contarGuardas(db: DatabaseSync): number {
  return Number((db.prepare(
    `SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'
       AND (name LIKE 'sport\\_fence\\_%' ESCAPE '\\' OR name LIKE 'sport\\_charge\\_%' ESCAPE '\\')`,
  ).get() as { n: number }).n);
}

/**
 * Aplica el plan en una sola transacción con la guarda retirada y FKs diferidas; si algo falla
 * (incluido un foreign_key_check no vacío) se deshace todo. La guarda se repone siempre.
 */
function aplicarPlan(db: DatabaseSync, plan: Plan, esquemas: Map<string, Esquema>, log: (m: string) => void) {
  restaurarGuardia(db);
  const antes = contarGuardas(db);
  quitarGuardia(db);
  let error: unknown = null;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('PRAGMA defer_foreign_keys = ON');
      const orden = ordenTablas(esquemas);
      for (const t of [...orden].reverse()) {
        const c = plan.get(t);
        if (!c?.borrar.size) continue;
        const e = esquemas.get(t)!;
        for (const ids of trozos([...c.borrar], 500)) {
          db.prepare(`DELETE FROM ${q(t)} WHERE ${q(e.pk)} IN (${ids.map(() => '?').join(',')})`).run(...ids);
        }
      }
      for (const t of orden) {
        const c = plan.get(t);
        if (!c?.upserts.size) continue;
        const e = esquemas.get(t)!;
        const st = db.prepare(
          `INSERT INTO ${q(t)} (${e.columnas.map(q).join(',')}) VALUES (${e.columnas.map(() => '?').join(',')})
             ON CONFLICT(${q(e.pk)}) DO UPDATE SET ${e.columnas.filter((x) => x !== e.pk).map((x) => `${q(x)}=excluded.${q(x)}`).join(',')}`,
        );
        for (const f of c.upserts.values()) st.run(...e.columnas.map((x) => f[x]));
      }
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) throw new Error(`foreign_key_check: ${fk.length} filas, p. ej. ${JSON.stringify(fk.slice(0, 3))}`);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite ya pudo deshacerla por su cuenta (p. ej. tras SQLITE_FULL).
      }
      throw e;
    }
  } catch (e) {
    error = e;
  } finally {
    try {
      restaurarGuardia(db);
    } catch (e) {
      log(`ERROR reponiendo la guarda: ${(e as Error).message}`);
      error ??= e;
    }
  }
  const despues = contarGuardas(db);
  if (!error && despues !== antes) error = new Error(`guarda_incompleta: ${despues} triggers tras aplicar, ${antes} antes`);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Verificación por agregados

export interface Diferencia {
  tabla: string;
  particion: string;
  lo: string | null;
  hi: string | null;
  local: Agregado;
  remoto: Agregado;
}
export interface Verificacion {
  identica: boolean;
  tablas: Record<string, { local: Agregado; remoto: Agregado; iguales: boolean }>;
  diferencias: Diferencia[];
}

const etiqueta = (lo: string | null, hi: string | null) =>
  lo === null && hi === null ? 'todo' : lo === null ? `id < '${hi}'` : hi === null ? `id >= '${lo}'` : `'${lo}' <= id < '${hi}'`;
const rango = (pk: string, lo: string | null, hi: string | null) =>
  [lo === null ? null : `${q(pk)} >= ${literal(lo)}`, hi === null ? null : `${q(pk)} < ${literal(hi)}`].filter(Boolean).join(' AND ') || '1';
const mismo = (a: Agregado, b: Agregado) => a.n === b.n && a.s === b.s && a.v === b.v;

function agregadoLocal(db: DatabaseSync, sql: string): { n: unknown; s: unknown; v: unknown } {
  const st = db.prepare(sql);
  st.setReadBigInts(true);
  return st.get() as { n: unknown; s: unknown; v: unknown };
}

function verificar(db: DatabaseSync, remoto: Remoto, esquemas: Map<string, Esquema>, umbral = UMBRAL_PARTICION): Verificacion {
  const salida: Verificacion = { identica: true, tablas: {}, diferencias: [] };
  for (const t of TABLAS) {
    const e = esquemas.get(t);
    if (!e) continue;
    const n = Number((db.prepare(`SELECT count(*) AS n FROM ${q(t)}`).get() as { n: number }).n);
    const consultas = consultasAgregado(t, e.columnas, e.version, n > umbral);
    const locales = consultas.map((sql) => agregadoLocal(db, sql));
    const remotas = remoto.varias(consultas).map((r) => r[0] as { n: unknown; s: unknown; v: unknown });
    const local = combinarAgregados(locales);
    const rem = combinarAgregados(remotas);
    salida.tablas[t] = { local, remoto: rem, iguales: mismo(local, rem) };
    for (let i = 0; i < consultas.length; i++) {
      const [a, b] = [combinarAgregados([locales[i]]), combinarAgregados([remotas[i]])];
      if (mismo(a, b)) continue;
      const [lo, hi] = consultas.length === 1 ? [null, null] : [LIMITES[i], LIMITES[i + 1]];
      salida.diferencias.push({ tabla: t, particion: etiqueta(lo, hi), lo, hi, local: a, remoto: b });
    }
  }
  salida.identica = salida.diferencias.length === 0;
  return salida;
}

// ---------------------------------------------------------------------------
// Bisección

/** Huella por fila de consultasAgregado (sin copiarla: se extrae de su SQL). */
function expresionFila(e: Esquema): string {
  const [sql] = consultasAgregado(e.tabla, e.columnas, null);
  const inicio = 'SELECT count(*) AS n, coalesce(sum(h),0) AS s, max(v) AS v FROM (SELECT ';
  const fin = ` AS h, NULL AS v FROM ${q(e.tabla)})`;
  if (!sql.startsWith(inicio) || !sql.endsWith(fin)) throw new Error('formato_de_consultasAgregado_desconocido');
  return sql.slice(inicio.length, sql.length - fin.length);
}

export interface Localizadas {
  upserts: Record<string, string[]>;
  borrar: Record<string, string[]>;
  agotado: boolean;
  pendientes: string[];
}

function bisecar(
  db: DatabaseSync, remoto: Remoto, esquemas: Map<string, Esquema>, diferencias: Diferencia[], maxConsultas: number,
  log: (m: string) => void, listaMax = LISTA_MAX,
): Localizadas {
  const inicio = remoto.consultas;
  const quedan = () => maxConsultas - (remoto.consultas - inicio);
  const salida: Localizadas = { upserts: {}, borrar: {}, agotado: false, pendientes: [] };
  const cola = diferencias.map((d) => ({ tabla: d.tabla, lo: d.lo, hi: d.hi, nl: d.local.n, nr: d.remoto.n }));
  while (cola.length) {
    const r = cola.shift()!;
    const e = esquemas.get(r.tabla)!;
    const fila = expresionFila(e);
    const cond = rango(e.pk, r.lo, r.hi);
    const v = e.version ? q(e.version) : 'NULL';
    if (Math.max(r.nl, r.nr) <= listaMax) {
      if (quedan() < 1) {
        salida.agotado = true;
        salida.pendientes.push(`${r.tabla} ${etiqueta(r.lo, r.hi)}`);
        continue;
      }
      const sql = `SELECT ${q(e.pk)} AS id, ${fila} AS h FROM ${q(e.tabla)} WHERE ${cond} ORDER BY ${q(e.pk)} LIMIT ${listaMax + 1}`;
      const rem = new Map(remoto.una(sql).map((x) => [String(x.id), String(x.h)]));
      const loc = new Map((db.prepare(sql).all() as { id: string; h: number }[]).map((x) => [String(x.id), String(x.h)]));
      const up = [...rem].filter(([id, h]) => loc.get(id) !== h).map(([id]) => id);
      const bo = [...loc.keys()].filter((id) => !rem.has(id));
      if (up.length) (salida.upserts[r.tabla] ??= []).push(...up);
      if (bo.length) (salida.borrar[r.tabla] ??= []).push(...bo);
      log(`  ${r.tabla} ${etiqueta(r.lo, r.hi)}: ${up.length} filas distintas o sólo en remoto, ${bo.length} sólo en la copia`);
      continue;
    }
    // Puntos de corte tomados del lado con más filas, para que cada subtramo quede más pequeño.
    if (quedan() < 2 * DIVISIONES) {
      salida.agotado = true;
      salida.pendientes.push(`${r.tabla} ${etiqueta(r.lo, r.hi)}`);
      continue;
    }
    const n = Math.max(r.nl, r.nr);
    const offsets = Array.from({ length: DIVISIONES - 1 }, (_, j) => Math.floor((n * (j + 1)) / DIVISIONES));
    const cortesSql = offsets.map((o) => `SELECT ${q(e.pk)} AS id FROM ${q(e.tabla)} WHERE ${cond} ORDER BY ${q(e.pk)} LIMIT 1 OFFSET ${o}`);
    const cortes = (r.nr >= r.nl
      ? remoto.varias(cortesSql).map((x) => x[0]?.id)
      : cortesSql.map((s) => (db.prepare(s).get() as { id: unknown } | undefined)?.id))
      .filter((x): x is string => typeof x === 'string');
    const unicos = [...new Set(cortes)].filter((c) => (r.lo === null || c > r.lo) && (r.hi === null || c < r.hi)).sort();
    const limites = [r.lo, ...unicos, r.hi];
    const subtramos = limites.slice(0, -1).map((lo, i) => ({ lo, hi: limites[i + 1] }));
    const agregado = (lo: string | null, hi: string | null) =>
      `SELECT count(*) AS n, coalesce(sum(h),0) AS s, max(v) AS v FROM (SELECT ${fila} AS h, ${v} AS v FROM ${q(e.tabla)} WHERE ${rango(e.pk, lo, hi)})`;
    const sqls = subtramos.map((s) => agregado(s.lo, s.hi));
    const remotas = remoto.varias(sqls);
    subtramos.forEach((s, i) => {
      const a = combinarAgregados([agregadoLocal(db, sqls[i])]);
      const b = combinarAgregados([remotas[i][0] as { n: unknown; s: unknown; v: unknown }]);
      if (!mismo(a, b)) cola.push({ tabla: r.tabla, lo: s.lo, hi: s.hi, nl: a.n, nr: b.n });
    });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Refresco

export interface OpcionesRefresco {
  copia: string;
  /** ms; por defecto, la marca de tiempo más alta de la copia. */
  desde?: number;
  aplicar?: boolean;
  soloVerificar?: boolean;
  bisecar?: boolean;
  maxConsultasBisecar?: number;
  consultar?: ConsultaRemota;
  log?: (m: string) => void;
  /** Para pruebas: filas a partir de las cuales se agrega por tramos y tamaño de tramo que se lista. */
  umbralParticion?: number;
  listaMax?: number;
}

export interface InformeRefresco {
  desde: number | null;
  competiciones: string[];
  origenes: Record<string, number>;
  filas: Record<string, Recuento>;
  aplicado: boolean;
  verificacion: Verificacion;
  localizadas?: Localizadas;
  filasBisecado?: Record<string, Recuento>;
  verificacionFinal?: Verificacion;
  identica: boolean;
  consultasRemotas: number;
  llamadasRemotas: number;
}

export function parsearDesde(texto: string): number {
  if (/^\d+$/.test(texto)) return Number(texto);
  const ms = Date.parse(texto);
  if (!Number.isFinite(ms)) throw new Error(`--desde no válido: ${texto}`);
  return ms;
}

function maximaMarca(db: DatabaseSync, esquemas: Map<string, Esquema>): number {
  let max = 0;
  for (const e of esquemas.values()) {
    for (const m of e.marcas) {
      const r = db.prepare(`SELECT max(${q(m)}) AS m FROM ${q(e.tabla)} WHERE typeof(${q(m)})='integer'`).get() as { m: number | null };
      if (r.m !== null && Number(r.m) > max) max = Number(r.m);
    }
  }
  return max;
}

function planificarRefresco(db: DatabaseSync, remoto: Remoto, esquemas: Map<string, Esquema>, remotas: Set<string>, desde: number) {
  const plan: Plan = new Map();
  const X = String(Math.trunc(desde));
  const tocadas: { origen: string; sql: string }[] = [
    { origen: 'sport_competition.updated_at', sql: `SELECT id FROM sport_competition WHERE updated_at > ${X}` },
    { origen: 'sport_import_coverage.updated_at', sql: `SELECT DISTINCT competition_id AS id FROM sport_import_coverage WHERE updated_at > ${X} AND competition_id IS NOT NULL` },
    { origen: 'sport_result', sql: `SELECT DISTINCT competition_id AS id FROM sport_result WHERE first_seen_at > ${X} OR revised_at > ${X}` },
    { origen: 'sport_bout', sql: `SELECT DISTINCT competition_id AS id FROM sport_bout WHERE first_seen_at > ${X} OR revised_at > ${X}` },
  ];
  if (remotas.has('resultado_auto_evento')) {
    tocadas.push({ origen: 'resultado_auto_evento.creado_en', sql: `SELECT DISTINCT competition_id AS id FROM resultado_auto_evento WHERE creado_en > ${X}` });
  }
  const competiciones = new Set<string>();
  const origenes: Record<string, number> = {};
  remoto.varias(tocadas.map((t) => t.sql)).forEach((filas, i) => {
    origenes[tocadas[i].origen] = filas.length;
    for (const f of filas) if (f.id !== null && f.id !== undefined) competiciones.add(String(f.id));
  });

  const ec = esquemas.get('sport_competition')!;
  const ee = esquemas.get('sport_edition')!;
  const ids = [...competiciones].sort();
  if (ids.length) {
    const comps = traerPorValores(remoto, ec, ['id'], ids);
    const cc = cambios(plan, 'sport_competition');
    for (const f of comps) cc.upserts.set(String(f.id), f);
    // Una competición tocada que ya no existe en remoto se borra (con confirmación).
    for (const id of ids) if (!cc.upserts.has(id)) cc.borrar.add(id);
    const ediciones = new Set(comps.map((f) => String(f.edition_id)));
    const ce = cambios(plan, 'sport_edition');
    for (const f of traerPorValores(remoto, ee, ['id'], ediciones)) ce.upserts.set(String(f.id), f);
    for (const [t, cols] of Object.entries(HIJAS)) {
      const e = esquemas.get(t);
      if (!e || !remotas.has(t)) continue;
      const c = cambios(plan, t);
      for (const f of traerPorValores(remoto, e, cols, ids)) c.upserts.set(String(f[e.pk]), f);
      for (const trozo of trozos(ids, 500)) {
        const marcas = trozo.map(() => '?').join(',');
        const sql = `SELECT ${q(e.pk)} AS id FROM ${q(t)} WHERE ${cols.map((x) => `${q(x)} IN (${marcas})`).join(' OR ')}`;
        const params = cols.flatMap(() => trozo);
        for (const f of db.prepare(sql).all(...params) as { id: string }[]) if (!c.upserts.has(f.id)) c.borrar.add(f.id);
      }
    }
  }

  // Resto de filas con marcas posteriores (personas nuevas, cobertura sin prueba, ediciones, perfiles...).
  for (const t of ordenTablas(esquemas)) {
    if (t === 'sport_result' || t === 'sport_bout' || t === 'sport_competition' || !remotas.has(t)) continue;
    const e = esquemas.get(t)!;
    if (!e.marcas.length) continue;
    const c = cambios(plan, t);
    for (const f of traerFilas(remoto, e, e.marcas.map((m) => `${q(m)} > ${X}`).join(' OR '))) c.upserts.set(String(f[e.pk]), f);
  }
  confirmarBorrados(remoto, plan, esquemas);
  completarPadres(db, remoto, plan, esquemas);
  return { plan, competiciones: ids, origenes };
}

export function refrescarEspejo(o: OpcionesRefresco): InformeRefresco {
  const log = o.log ?? ((m: string) => console.log(m));
  const remoto = new Remoto(o.consultar ?? consultarRemoto);
  const aplicar = Boolean(o.aplicar);
  const db = new DatabaseSync(resolve(o.copia), aplicar ? {} : { readOnly: true });
  try {
    if (aplicar) db.exec('PRAGMA foreign_keys = ON');
    log(`Copia: ${resolve(o.copia)} (${aplicar ? 'se modifica (--aplicar)' : 'sólo lectura (ensayo)'})`);
    const guardas = contarGuardas(db);
    const respaldo = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_indexado_guardia'`).get();
    log(`Guarda local: ${guardas} triggers sport_fence_*/sport_charge_*${respaldo ? ' (HAY un respaldo _indexado_guardia pendiente de reponer)' : ''}`);

    const esquemas = new Map<string, Esquema>();
    for (const t of [...TABLAS, ...EXTRA]) {
      const e = esquemaLocal(db, t);
      if (e) esquemas.set(t, e);
    }
    const nombres = [...TABLAS, ...EXTRA, 'resultado_auto_evento'];
    const remotas = new Set(
      remoto.una(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${lista(nombres)})`).map((f) => String(f.name)),
    );
    for (const t of TABLAS) {
      if (esquemas.has(t) !== remotas.has(t)) throw new Error(`tabla_${esquemas.has(t) ? 'sin_migrar_en_remoto' : 'sin_migrar_en_la_copia'}:${t}`);
    }
    const columnasRemotas = remoto.varias([...esquemas.keys()].filter((t) => remotas.has(t)).map(
      (t) => `SELECT ${literal(t)} AS t, group_concat(name, ',') AS c FROM pragma_table_info(${literal(t)})`,
    ));
    for (const [r] of columnasRemotas) {
      const e = esquemas.get(String(r.t))!;
      const remotasCols = String(r.c ?? '').split(',').sort().join(',');
      if (remotasCols !== [...e.columnas].sort().join(',')) throw new Error(`columnas_distintas:${e.tabla} (remoto ${r.c})`);
    }
    for (const t of EXTRA) if (esquemas.has(t) && !remotas.has(t)) esquemas.delete(t);

    let desde: number | null = null;
    let competiciones: string[] = [];
    let origenes: Record<string, number> = {};
    let filas: Record<string, Recuento> = {};
    let aplicado = false;
    if (!o.soloVerificar) {
      desde = o.desde ?? maximaMarca(db, esquemas);
      log(`Desde: ${desde} (${new Date(desde).toISOString()})${o.desde === undefined ? ' = marca más alta de la copia' : ''}`);
      const r = planificarRefresco(db, remoto, esquemas, remotas, desde);
      competiciones = r.competiciones;
      origenes = r.origenes;
      filas = clasificar(db, r.plan, esquemas);
      log(`Competiciones tocadas: ${competiciones.length}`);
      for (const [k, n] of Object.entries(origenes)) log(`  por ${k}: ${n}`);
      if (competiciones.length) log(`  ${competiciones.slice(0, 20).join(', ')}${competiciones.length > 20 ? ', ...' : ''}`);
      log(`Filas (${aplicar ? 'aplicadas' : 'pendientes'}): +insertadas ~actualizadas -borradas =ya iguales`);
      for (const [t, c] of Object.entries(filas)) log(`  ${t}: +${c.insertar} ~${c.actualizar} -${c.borrar} =${c.iguales}`);
      if (aplicar && !planVacio(r.plan)) {
        aplicarPlan(db, r.plan, esquemas, log);
        aplicado = true;
        log('Cambios aplicados en una transacción; guarda repuesta y foreign_key_check vacío.');
      }
    }

    log('Verificación de agregados frente a producción:');
    const verificacion = verificar(db, remoto, esquemas, o.umbralParticion);
    informarVerificacion(verificacion, log);
    const informe: InformeRefresco = {
      desde, competiciones, origenes, filas, aplicado, verificacion, identica: verificacion.identica,
      consultasRemotas: 0, llamadasRemotas: 0,
    };
    if (!verificacion.identica && !aplicar && !o.soloVerificar && Object.values(filas).some((c) => c.insertar || c.actualizar || c.borrar)) {
      log('(Ensayo: la copia no se ha modificado; las diferencias incluyen lo pendiente de aplicar.)');
    }
    if (!verificacion.identica && o.bisecar) {
      const max = o.maxConsultasBisecar ?? 200;
      log(`Bisección de las particiones distintas (máx. ${max} consultas remotas):`);
      const loc = bisecar(db, remoto, esquemas, verificacion.diferencias, max, log, o.listaMax);
      informe.localizadas = loc;
      if (loc.agotado) log(`AVISO: presupuesto agotado; sin localizar: ${loc.pendientes.join('; ')}`);
      const plan: Plan = new Map();
      for (const [t, ids] of Object.entries(loc.upserts)) {
        const e = esquemas.get(t)!;
        const c = cambios(plan, t);
        for (const f of traerPorValores(remoto, e, [e.pk], ids)) c.upserts.set(String(f[e.pk]), f);
        log(`  ${t}: traer ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? `, ... (${ids.length})` : ''}`);
      }
      for (const [t, ids] of Object.entries(loc.borrar)) {
        for (const id of ids) cambios(plan, t).borrar.add(id);
        log(`  ${t}: borrar ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? `, ... (${ids.length})` : ''}`);
      }
      completarPadres(db, remoto, plan, esquemas);
      informe.filasBisecado = clasificar(db, plan, esquemas);
      if (aplicar && !planVacio(plan)) {
        aplicarPlan(db, plan, esquemas, log);
        informe.aplicado = true;
        log('Filas localizadas aplicadas. Nueva verificación:');
        informe.verificacionFinal = verificar(db, remoto, esquemas, o.umbralParticion);
        informarVerificacion(informe.verificacionFinal, log);
        informe.identica = informe.verificacionFinal.identica;
      } else if (!aplicar) {
        log('(Sin --aplicar: las filas localizadas no se copian.)');
      }
    }
    informe.consultasRemotas = remoto.consultas;
    informe.llamadasRemotas = remoto.llamadas;
    const sincronizadas = TABLAS.filter((t) => esquemas.has(t)).length;
    log(`${informe.identica ? 'IDÉNTICA' : 'DISTINTA'}: la copia ${informe.identica ? 'coincide' : 'no coincide'} con producción en las ${sincronizadas} tablas sincronizadas ` +
      `(${remoto.consultas} consultas remotas en ${remoto.llamadas} llamadas).`);
    if (!informe.identica && !o.bisecar) log('Usa --bisecar para localizar las filas de las particiones distintas.');
    return informe;
  } finally {
    db.close();
  }
}

function informarVerificacion(v: Verificacion, log: (m: string) => void) {
  for (const [t, r] of Object.entries(v.tablas)) {
    log(`  ${t}: ${r.iguales ? 'igual' : 'DISTINTA'} (copia n=${r.local.n}, producción n=${r.remoto.n})`);
  }
  for (const d of v.diferencias) {
    log(`  DIFERENCIA ${d.tabla} [${d.particion}]: copia ${JSON.stringify(d.local)} producción ${JSON.stringify(d.remoto)}`);
  }
}

// ---------------------------------------------------------------------------
// CLI

function main() {
  const copia = argumento('copia', '');
  if (!copia) throw new Error('falta --copia <sqlite>');
  const desde = argumento('desde', '');
  const informe = refrescarEspejo({
    copia,
    desde: desde ? parsearDesde(desde) : undefined,
    aplicar: bandera('aplicar'),
    soloVerificar: bandera('solo-verificar'),
    bisecar: bandera('bisecar'),
    maxConsultasBisecar: Number(argumento('max-consultas', '200')),
  });
  process.exitCode = informe.identica ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
