/**
 * Sincroniza las tablas deportivas de una copia local reindexada (nuevo.sqlite)
 * con el D1 de producción, partiendo de la copia exacta de producción (base.sqlite).
 *
 *   --diff --base <base.sqlite> --nuevo <nuevo.sqlite> --salida <dir> [--chunk-mb 20]
 *   --comprobar --base <base.sqlite> --nuevo <nuevo.sqlite> --salida <dir> [--conservar]
 *   --verificar-base --salida <dir>
 *   --aplicar --salida <dir> --confirmar <id D1>
 *   --verificar-final --salida <dir>
 *
 * Cada chunk se aplica con `wrangler d1 execute --remote --file`, que usa la ruta
 * de importación de D1: el fichero entero se ejecuta de forma atómica (si falla,
 * D1 vuelve al estado anterior). Por eso cada chunk lleva su propia cabecera de
 * lease + contexto de capacidad y su pie que los cierra, igual que una batch de
 * `dbConSportLease` (src/lib/ingest/sport-incremental/lease.ts): las guardas de
 * 0002_guardia_deportiva.sql nunca se desactivan.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync,
  writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { argumento, bandera } from './comun';

/** Orden topológico (padres primero) de las tablas que se sincronizan. */
export const TABLAS = [
  'sport_edition',
  'sport_competition',
  'sport_person',
  'sport_result',
  'sport_bout',
  'sport_import_coverage',
  'sport_person_alias',
  'sport_external_id',
  'sport_link_candidate',
] as const;
export type Tabla = (typeof TABLAS)[number];

export const D1_NOMBRE = 'calendario-fie-fede-db';
export const D1_ID = 'e1c28f19-278c-4d8f-9c7c-9b9d1c45653e';
export const CUENTA_CLOUDFLARE = '52d39cf14bc17b94754729436036124d';
/** Igual que D1_STORAGE_BUDGET_BYTES de wrangler.jsonc y el techo del CHECK de sport_write_context (0005). */
export const PRESUPUESTO_BYTES = 8_589_934_592;
export const LEASE_MS = 30 * 60_000;
const SOBRECOSTE_LOTE = 16_384;
const SOBRECOSTE_FILA = 1_024;
const FACTOR_CARGA = 4;
/** D1 rechaza sentencias de más de 100 KiB. */
export const MAX_SENTENCIA_BYTES = 90_000;
const MAX_FILAS_INSERT = 100;
const MAX_FILAS_UPDATE = 50;
const MAX_FILAS_DELETE = 100;
export const CHUNK_BYTES_POR_DEFECTO = 20 * 1024 * 1024;
const AHORA_SQL =
  "(cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))";
const MODULO = 2_147_483_647;
const PESOS = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Codificación literal

const q = (identificador: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(identificador)) throw new Error(`identificador_no_permitido:${identificador}`);
  return `"${identificador}"`;
};

/**
 * Literal SQL exacto para SQLite/D1. Los enteros llegan como bigint (lectura con
 * setReadBigInts) y los REAL como number, así el tipo almacenado no cambia. Los
 * textos con NUL, CR, LF o ';' van en hexadecimal para no depender de cómo parta
 * sentencias el importador de D1.
 */
export function literal(valor: unknown): string {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error('real_no_finito');
    const texto = String(valor);
    return /[.eE]/.test(texto) ? texto : `${texto}.0`;
  }
  if (typeof valor === 'string') {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(valor)) throw new Error('texto_utf16_mal_formado');
    if (/[\0\r\n;]/.test(valor)) return `CAST(X'${Buffer.from(valor, 'utf8').toString('hex')}' AS TEXT)`;
    return `'${valor.replace(/'/g, "''")}'`;
  }
  if (valor instanceof Uint8Array) return `X'${Buffer.from(valor).toString('hex')}'`;
  throw new Error(`valor_no_soportado:${typeof valor}`);
}

/** Bytes de `CAST(v AS BLOB)`, la unidad que cobran los triggers sport_charge_*. */
function bytesCarga(valor: unknown): number {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === 'string') return Buffer.byteLength(valor, 'utf8');
  if (valor instanceof Uint8Array) return valor.byteLength;
  // REAL: el texto de SQLite puede tener más dígitos que el de JS.
  if (typeof valor === 'number') return String(valor).length + 8;
  return String(valor).length;
}

// ---------------------------------------------------------------------------
// Esquema

interface InfoTabla {
  columnas: string[];
  version: string | null;
}

function columnas(db: DatabaseSync, esquema: string, tabla: string): string[] {
  const filas = db.prepare(`SELECT name, pk FROM pragma_table_info(?, ?) ORDER BY cid`).all(tabla, esquema) as {
    name: string;
    pk: number | bigint;
  }[];
  if (!filas.length) throw new Error(`tabla_inexistente:${esquema}.${tabla}`);
  const pk = filas.filter((f) => Number(f.pk) > 0).map((f) => f.name);
  if (pk.length !== 1 || pk[0] !== 'id') throw new Error(`pk_no_soportada:${tabla}`);
  return filas.map((f) => f.name);
}

function infoTabla(db: DatabaseSync, tabla: string): InfoTabla {
  const cols = columnas(db, 'b', tabla);
  const nuevas = columnas(db, 'n', tabla);
  if (nuevas.length !== cols.length || nuevas.some((c) => !cols.includes(c))) {
    throw new Error(`columnas_distintas:${tabla}`);
  }
  const version = cols.includes('revised_at') ? 'revised_at' : cols.includes('updated_at') ? 'updated_at' : null;
  return { columnas: cols, version };
}

interface IndiceUnico {
  nombre: string;
  columnas: string[];
  donde: string | null;
}

function indicesUnicos(db: DatabaseSync, tabla: string): IndiceUnico[] {
  const lista = db.prepare(`SELECT name, "unique" AS u, origin FROM pragma_index_list(?, 'b')`).all(tabla) as {
    name: string;
    u: number | bigint;
    origin: string;
  }[];
  const salida: IndiceUnico[] = [];
  for (const i of lista) {
    if (!Number(i.u) || i.origin === 'pk') continue;
    const cols = (db.prepare(`SELECT name FROM pragma_index_info(?, 'b') ORDER BY seqno`).all(i.name) as {
      name: string | null;
    }[]).map((c) => c.name);
    if (cols.some((c) => c === null)) throw new Error(`indice_por_expresion_no_soportado:${i.name}`);
    const sql = (db.prepare(`SELECT sql FROM b.sqlite_master WHERE type='index' AND name=?`).get(i.name) as
      | { sql: string | null }
      | undefined)?.sql;
    const donde = sql && /\sWHERE\s/i.test(sql) ? sql.slice(sql.search(/\sWHERE\s/i) + 7) : null;
    salida.push({ nombre: i.name, columnas: cols as string[], donde });
  }
  return salida;
}

interface ClaveAjena {
  hija: string;
  columna: string;
  padre: string;
}

function clavesAjenas(db: DatabaseSync): ClaveAjena[] {
  const tablas = (db.prepare(`SELECT name FROM b.sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
    (t) => t.name,
  );
  const salida: ClaveAjena[] = [];
  for (const t of tablas) {
    for (const fk of db.prepare(`SELECT "table" AS padre, "from" AS col, "to" AS destino FROM pragma_foreign_key_list(?, 'b')`).all(t) as {
      padre: string;
      col: string;
      destino: string | null;
    }[]) {
      if (fk.destino !== null && fk.destino !== 'id') continue;
      salida.push({ hija: t, columna: fk.col, padre: fk.padre });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Checksum agregado: sólo funciones del núcleo de SQLite que D1 autoriza.

function huellaColumna(c: string): string {
  const t = `CAST(${q(c)} AS TEXT)`;
  const pos = [1, 2, 3, 4, 5, 6]
    .map((k) => `coalesce(unicode(substr(${t},-${k},1)),0)%251*${256 ** (k - 1)}`)
    .join('+');
  return `(CASE WHEN ${q(c)} IS NULL THEN 7 ELSE (length(CAST(${q(c)} AS BLOB))*65537+coalesce(unicode(${t}),0)%251*${256 ** 6}+${pos})%${MODULO} END)`;
}

const LIMITES_PARTICION = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

/**
 * Consultas de agregado de una tabla: recuento, suma de una huella por fila
 * (independiente del orden) y máximo de la columna de versión. Con
 * `particiones`, una consulta por tramo de id para no acercarse a los 30 s de D1.
 */
export function consultasAgregado(tabla: string, cols: string[], version: string | null, particiones = false): string[] {
  const fila = `(${cols.map((c, i) => `${PESOS[i % PESOS.length]}*${huellaColumna(c)}`).join('+')})%${MODULO}`;
  const v = version ? q(version) : 'NULL';
  const base = (donde: string) =>
    `SELECT count(*) AS n, coalesce(sum(h),0) AS s, max(v) AS v FROM (SELECT ${fila} AS h, ${v} AS v FROM ${q(tabla)}${donde})`;
  if (!particiones) return [base('')];
  const tramos: string[] = [];
  let anterior: string | null = null;
  for (const l of LIMITES_PARTICION) {
    tramos.push(base(anterior === null ? ` WHERE "id" < '${l}'` : ` WHERE "id" >= '${anterior}' AND "id" < '${l}'`));
    anterior = l;
  }
  tramos.push(base(` WHERE "id" >= '${anterior}'`));
  return tramos;
}

export interface Agregado {
  n: number;
  s: string;
  v: string | null;
}

export function combinarAgregados(filas: { n: unknown; s: unknown; v: unknown }[]): Agregado {
  let n = 0n;
  let s = 0n;
  let v: bigint | null = null;
  for (const f of filas) {
    n += BigInt(f.n as number | bigint);
    s += BigInt(f.s as number | bigint);
    if (f.v !== null && f.v !== undefined) {
      const x = BigInt(f.v as number | bigint);
      if (v === null || x > v) v = x;
    }
  }
  return { n: Number(n), s: s.toString(), v: v === null ? null : v.toString() };
}

export function agregadosLocales(
  db: DatabaseSync,
  info: Record<string, InfoTabla>,
  esquema = 'main',
): Record<string, Agregado> {
  const salida: Record<string, Agregado> = {};
  for (const tabla of TABLAS) {
    const { columnas: cols, version } = info[tabla];
    const filas = consultasAgregado(tabla, cols, version).map((sql) => {
      const st = db.prepare(sql.replace(`FROM ${q(tabla)}`, `FROM ${esquema}.${q(tabla)}`));
      st.setReadBigInts(true);
      return st.get() as { n: bigint; s: bigint; v: bigint | null };
    });
    salida[tabla] = combinarAgregados(filas);
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Manifiesto

interface Sonda {
  sql: string;
  esperado: number;
}

export interface ChunkManifiesto {
  archivo: string;
  bytes: number;
  sha256: string;
  sentencias: number;
  cargoBytes: number;
  filas: Record<string, { insertar: number; actualizar: number; borrar: number }>;
  sonda: Sonda;
}

export interface Manifiesto {
  version: 1;
  generado: string;
  d1: { nombre: string; id: string };
  presupuestoBytes: number;
  leaseMs: number;
  base: { ruta: string; bytes: number; agregados: Record<string, Agregado> };
  nuevo: { ruta: string; bytes: number };
  esperado: Record<string, Agregado>;
  tablas: Record<
    string,
    InfoTabla & {
      insertar: number;
      actualizar: number;
      borrar: number;
      borrarAlFinal: number;
      ordenadas: number;
    }
  >;
  referenciasExternas: ClaveAjena[];
  cargoTotalBytes: number;
  chunks: ChunkManifiesto[];
}

// ---------------------------------------------------------------------------
// Escritura de chunks

class EscritorChunks {
  readonly chunks: ChunkManifiesto[] = [];
  private fd: number | null = null;
  private actual: ChunkManifiesto | null = null;
  private hash = createHash('sha256');

  constructor(
    private readonly dir: string,
    private readonly limite: number,
  ) {}

  /** Añade sentencias que deben ir juntas en el mismo chunk (mutación + aserción). */
  agregar(sentencias: string[], tabla: string, op: 'insertar' | 'actualizar' | 'borrar', filas: number, cargo: number, sonda: Sonda) {
    const texto = sentencias.map((s) => `${s};\n`).join('');
    for (const s of sentencias) {
      if (Buffer.byteLength(s, 'utf8') > MAX_SENTENCIA_BYTES + 10_000) throw new Error(`sentencia_demasiado_larga:${tabla}`);
    }
    const bytes = Buffer.byteLength(texto, 'utf8');
    if (this.actual && this.actual.bytes + bytes > this.limite) this.cerrar();
    if (!this.actual) this.abrir();
    const c = this.actual!;
    writeSync(this.fd!, texto);
    this.hash.update(texto, 'utf8');
    c.bytes += bytes;
    c.sentencias += sentencias.length;
    c.cargoBytes += cargo;
    const f = (c.filas[tabla] ??= { insertar: 0, actualizar: 0, borrar: 0 });
    f[op] += filas;
    c.sonda = sonda;
  }

  private abrir() {
    const archivo = `chunk-${String(this.chunks.length + 1).padStart(4, '0')}.sql`;
    this.fd = openSync(join(this.dir, archivo), 'w');
    this.hash = createHash('sha256');
    this.actual = { archivo, bytes: 0, sha256: '', sentencias: 0, cargoBytes: 0, filas: {}, sonda: { sql: '', esperado: 0 } };
  }

  cerrar() {
    if (!this.actual) return;
    closeSync(this.fd!);
    this.actual.sha256 = this.hash.digest('hex');
    this.chunks.push(this.actual);
    this.actual = null;
    this.fd = null;
  }
}

const listaIds = (ids: unknown[]) => ids.map(literal).join(',');
const asercion = (n: number, que: string) =>
  `SELECT CASE WHEN changes()<>${n} THEN json('sincronizar_d1 precondicion ${que}') END`;

// ---------------------------------------------------------------------------
// Diff

export interface OpcionesPlan {
  base: string;
  nuevo: string;
  salida: string;
  chunkBytes?: number;
  log?: (mensaje: string) => void;
}

const uriSoloLectura = (ruta: string) => `${pathToFileURL(resolve(ruta)).href}?mode=ro`;

export function abrirComparacion(base: string, nuevo: string): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: false });
  db.exec(`ATTACH DATABASE ${literal(uriSoloLectura(base))} AS b`);
  db.exec(`ATTACH DATABASE ${literal(uriSoloLectura(nuevo))} AS n`);
  db.exec('PRAGMA temp_store = MEMORY');
  return db;
}

type Fila = Record<string, SQLOutputValue>;

function* iterar(db: DatabaseSync, sql: string, ...params: (string | number)[]): Generator<Fila> {
  const st = db.prepare(sql);
  st.setReadBigInts(true);
  yield* st.iterate(...params) as Iterable<Fila>;
}

function cargoFila(fila: Fila, cols: string[]): number {
  return SOBRECOSTE_FILA + FACTOR_CARGA * cols.reduce((t, c) => t + bytesCarga(fila[c]), 0);
}

export function planificar(opciones: OpcionesPlan): Manifiesto {
  const log = opciones.log ?? ((m: string) => console.log(m));
  const limite = opciones.chunkBytes ?? CHUNK_BYTES_POR_DEFECTO;
  mkdirSync(opciones.salida, { recursive: true });
  for (const previo of ['manifest.json', 'progreso.json']) {
    if (existsSync(join(opciones.salida, previo))) throw new Error(`salida_no_vacia:${previo}`);
  }
  const db = abrirComparacion(opciones.base, opciones.nuevo);
  try {
    const info: Record<string, InfoTabla> = {};
    for (const t of TABLAS) info[t] = infoTabla(db, t);
    const fks = clavesAjenas(db);
    const sincronizadas = new Set<string>(TABLAS);
    const fksInternas = fks.filter((f) => sincronizadas.has(f.hija) && sincronizadas.has(f.padre));
    const referenciasExternas = fks.filter((f) => !sincronizadas.has(f.hija) && sincronizadas.has(f.padre));
    const fksSalientes = fks.filter((f) => sincronizadas.has(f.hija) && !sincronizadas.has(f.padre));

    // 1. Conjuntos de cambios por clave primaria, en SQL sobre las dos bases adjuntas.
    const resumen: Manifiesto['tablas'] = {};
    for (const t of TABLAS) {
      const { columnas: cols } = info[t];
      const cambio = `temp.${q(`cambio_${t}`)}`;
      db.exec(`CREATE TABLE ${cambio} (id TEXT PRIMARY KEY, op TEXT NOT NULL, fase INTEGER NOT NULL DEFAULT 2, dep INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`);
      db.exec(`INSERT INTO ${cambio}(id,op) SELECT x.id,'I' FROM n.${q(t)} x WHERE NOT EXISTS (SELECT 1 FROM b.${q(t)} y WHERE y.id=x.id)`);
      db.exec(`INSERT INTO ${cambio}(id,op) SELECT y.id,'D' FROM b.${q(t)} y WHERE NOT EXISTS (SELECT 1 FROM n.${q(t)} x WHERE x.id=y.id)`);
      const igual = cols
        .filter((c) => c !== 'id')
        .map((c) => `(x.${q(c)} IS y.${q(c)} AND typeof(x.${q(c)})=typeof(y.${q(c)}))`)
        .join(' AND ');
      db.exec(`INSERT INTO ${cambio}(id,op) SELECT x.id,'U' FROM n.${q(t)} x JOIN b.${q(t)} y ON y.id=x.id WHERE NOT (${igual})`);
      const n = (op: string) =>
        Number((db.prepare(`SELECT count(*) AS n FROM ${cambio} WHERE op=?`).get(op) as { n: number }).n);
      resumen[t] = { ...info[t], insertar: n('I'), actualizar: n('U'), borrar: n('D'), borrarAlFinal: 0, ordenadas: 0 };
      log(`${t}: +${resumen[t].insertar} ~${resumen[t].actualizar} -${resumen[t].borrar}`);
    }

    // 2. Referencias a tablas no sincronizadas (event, athlete, user_profile...) deben existir ya.
    for (const fk of fksSalientes) {
      const faltan = (db.prepare(
        `SELECT count(*) AS n FROM n.${q(fk.hija)} x JOIN temp.${q(`cambio_${fk.hija}`)} d ON d.id=x.id AND d.op IN ('I','U')
          WHERE x.${q(fk.columna)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM b.${q(fk.padre)} p WHERE p.id=x.${q(fk.columna)})`,
      ).get() as { n: number }).n;
      if (Number(faltan)) throw new Error(`referencia_fuera_de_alcance:${fk.hija}.${fk.columna}->${fk.padre} (${faltan})`);
    }

    // node:sqlite corta los textos en el primer NUL: esas filas se copiarían truncadas.
    for (const t of TABLAS) {
      const conNul = info[t].columnas.map((c) => `instr(x.${q(c)}, char(0))>0`).join(' OR ');
      const n = (db.prepare(
        `SELECT count(*) AS n FROM n.${q(t)} x JOIN temp.${q(`cambio_${t}`)} d ON d.id=x.id AND d.op IN ('I','U') WHERE ${conNul}`,
      ).get() as { n: number }).n;
      if (Number(n)) throw new Error(`texto_con_nul_no_soportado:${t} (${n})`);
    }

    // 3. Borrados de padres: los que aún referencia una fila superviviente de la base
    //    (que el paso de actualización reapunta) se borran al final; el resto, al principio.
    for (const t of TABLAS) {
      const hijas = fksInternas.filter((f) => f.padre === t);
      if (!hijas.length || !resumen[t].borrar) continue;
      const usadas = hijas
        .map(
          (f) => `EXISTS (SELECT 1 FROM b.${q(f.hija)} x WHERE x.${q(f.columna)}=d.id
            AND NOT EXISTS (SELECT 1 FROM temp.${q(`cambio_${f.hija}`)} y WHERE y.id=x.id AND y.op='D'))`,
        )
        .join(' OR ');
      db.exec(`UPDATE temp.${q(`cambio_${t}`)} AS d SET fase=3 WHERE d.op='D' AND (${usadas})`);
      resumen[t].borrarAlFinal = Number(
        (db.prepare(`SELECT count(*) AS n FROM temp.${q(`cambio_${t}`)} WHERE op='D' AND fase=3`).get() as { n: number }).n,
      );
    }
    for (const t of TABLAS) db.exec(`UPDATE temp.${q(`cambio_${t}`)} SET fase=1 WHERE op='D' AND fase=2`);

    // Borrar una persona referenciada desde tablas fuera del alcance (favoritos, rankings)
    // las modificaría por cascada: no se permite.
    for (const fk of referenciasExternas) {
      const n = (db.prepare(
        `SELECT count(*) AS n FROM temp.${q(`cambio_${fk.padre}`)} d WHERE d.op='D'
          AND EXISTS (SELECT 1 FROM b.${q(fk.hija)} x WHERE x.${q(fk.columna)}=d.id)`,
      ).get() as { n: number }).n;
      if (Number(n)) throw new Error(`borrado_referenciado_fuera_de_alcance:${fk.hija}.${fk.columna}->${fk.padre} (${n})`);
    }

    // 4. Dependencias dentro de cada tabla en la fase de altas/cambios.
    const dependencias: Record<string, Map<string, Set<string>>> = {};
    for (const t of TABLAS) {
      const deps = new Map<string, Set<string>>();
      const arista = (antes: string, despues: string) => {
        if (!deps.has(antes)) deps.set(antes, new Set());
        if (!deps.has(despues)) deps.set(despues, new Set());
        deps.get(despues)!.add(antes);
      };
      const cambio = `temp.${q(`cambio_${t}`)}`;
      for (const u of indicesUnicos(db, t)) {
        const k = (a: string) => `json_array(${u.columnas.map((c) => `${a}.${q(c)}`).join(',')})`;
        const noNulo = (a: string) => u.columnas.map((c) => `${a}.${q(c)} IS NOT NULL`).join(' AND ');
        const donde = u.donde ? ` AND (${u.donde})` : '';
        // Tablas temporales indexadas: un JOIN directo sobre json_array() sería cuadrático.
        db.exec(`DROP TABLE IF EXISTS temp.clave_a; DROP TABLE IF EXISTS temp.clave_r`);
        db.exec(`CREATE TEMP TABLE clave_a AS SELECT ${q(t)}.id AS id, ${k(q(t))} AS k FROM n.${q(t)} AS ${q(t)}
            JOIN ${cambio} d ON d.id=${q(t)}.id AND d.op IN ('I','U') WHERE ${noNulo(q(t))}${donde}`);
        db.exec(`CREATE TEMP TABLE clave_r AS SELECT ${q(t)}.id AS id, d.op AS op, d.fase AS fase, ${k(q(t))} AS k FROM b.${q(t)} AS ${q(t)}
            JOIN ${cambio} d ON d.id=${q(t)}.id AND d.op IN ('U','D') WHERE ${noNulo(q(t))}${donde}`);
        db.exec(`CREATE INDEX temp.clave_r_k ON clave_r(k)`);
        const sql = `SELECT a.id AS adquiere, r.id AS libera, r.op AS op, r.fase AS fase
          FROM temp.clave_a a JOIN temp.clave_r r ON r.k=a.k AND a.id<>r.id`;
        for (const e of db.prepare(sql).all() as { adquiere: string; libera: string; op: string; fase: number }[]) {
          if (e.op === 'D') {
            if (Number(e.fase) === 3) throw new Error(`conflicto_unico_con_borrado_final:${u.nombre}:${e.libera}->${e.adquiere}`);
            continue;
          }
          arista(e.libera, e.adquiere);
        }
      }
      for (const fk of fksInternas.filter((f) => f.hija === t && f.padre === t)) {
        const sql = `SELECT x.id AS hija, x.${q(fk.columna)} AS padre FROM n.${q(t)} x
          JOIN ${cambio} d ON d.id=x.id AND d.op IN ('I','U') JOIN ${cambio} p ON p.id=x.${q(fk.columna)} AND p.op='I'`;
        for (const e of db.prepare(sql).all() as { hija: string; padre: string }[]) arista(e.padre, e.hija);
      }
      if (deps.size) {
        const marcar = db.prepare(`UPDATE ${cambio} SET dep=1 WHERE id=?`);
        for (const id of deps.keys()) marcar.run(id);
      }
      dependencias[t] = deps;
      resumen[t].ordenadas = deps.size;
    }

    log('Dependencias calculadas; agregados...');
    const base = { ruta: resolve(opciones.base), bytes: statSync(opciones.base).size, agregados: agregadosLocales(db, info, 'b') };
    const esperado = agregadosLocales(db, info, 'n');
    log('Agregados calculados; emitiendo SQL...');

    // 5. Emisión.
    const escritor = new EscritorChunks(opciones.salida, limite);
    const borrar = (t: string, fase: number) => emitirBorrados(
      db, escritor, t, info[t], fase, referenciasExternas, fksInternas.filter((f) => f.hija === t && f.padre === t),
    );
    for (const t of [...TABLAS].reverse()) borrar(t, 1);
    for (const t of TABLAS) emitirAltasYCambios(db, escritor, t, info[t], dependencias[t]);
    for (const t of [...TABLAS].reverse()) borrar(t, 3);
    escritor.cerrar();

    const manifiesto: Manifiesto = {
      version: 1,
      generado: new Date().toISOString(),
      d1: { nombre: D1_NOMBRE, id: D1_ID },
      presupuestoBytes: PRESUPUESTO_BYTES,
      leaseMs: LEASE_MS,
      base,
      nuevo: { ruta: resolve(opciones.nuevo), bytes: statSync(opciones.nuevo).size },
      esperado,
      tablas: resumen,
      referenciasExternas,
      cargoTotalBytes: escritor.chunks.reduce((t, c) => t + c.cargoBytes, 0),
      chunks: escritor.chunks,
    };
    writeFileSync(join(opciones.salida, 'manifest.json'), `${JSON.stringify(manifiesto, null, 2)}\n`);
    return manifiesto;
  } finally {
    db.close();
  }
}

function emitirBorrados(
  db: DatabaseSync,
  escritor: EscritorChunks,
  t: string,
  info: InfoTabla,
  fase: number,
  externas: ClaveAjena[],
  autorreferencias: ClaveAjena[],
) {
  // Si otra fila borrada de la misma tabla apunta a esta (merged_into_person_id),
  // ON DELETE SET NULL la actualiza antes de su propio borrado y el trigger de
  // UPDATE cobra 1024 B más (el valor nuevo es NULL, sin carga útil).
  const cascada = autorreferencias.length
    ? `(${autorreferencias
      .map((f) => `(SELECT count(*) FROM b.${q(t)} z JOIN temp.${q(`cambio_${t}`)} dz ON dz.id=z.id AND dz.op='D' WHERE z.${q(f.columna)}=y.id AND z.id<>y.id)`)
      .join('+')})`
    : '0';
  const cols = [...['id', ...(info.version ? [info.version] : [])].map((c) => `y.${q(c)}`), `${cascada} AS "_cascada"`].join(',');
  const lote: Fila[] = [];
  const refs = externas.filter((f) => f.padre === t);
  const vaciar = () => {
    if (!lote.length) return;
    const ids = listaIds(lote.map((f) => f.id));
    const sentencias: string[] = [];
    if (refs.length) {
      const usada = refs.map((f) => `EXISTS (SELECT 1 FROM ${q(f.hija)} WHERE ${q(f.columna)} IN (${ids}))`).join(' OR ');
      sentencias.push(`SELECT CASE WHEN ${usada} THEN json('sincronizar_d1 borrado referenciado ${t}') END`);
    }
    const precondicion = info.version
      ? ` AND CASE "id" ${lote.map((f) => `WHEN ${literal(f.id)} THEN ${q(info.version!)} IS ${literal(f[info.version!])}`).join(' ')} END`
      : '';
    sentencias.push(`DELETE FROM ${q(t)} WHERE "id" IN (${ids})${precondicion}`, asercion(lote.length, `${t} D`));
    const cascadas = lote.reduce((s, f) => s + Number(f._cascada), 0);
    escritor.agregar(sentencias, t, 'borrar', lote.length, SOBRECOSTE_FILA * (lote.length + cascadas), {
      sql: `SELECT count(*) AS n FROM ${q(t)} WHERE "id" IN (${ids})`,
      esperado: 0,
    });
    lote.length = 0;
  };
  for (const f of iterar(
    db,
    `SELECT ${cols} FROM b.${q(t)} y JOIN temp.${q(`cambio_${t}`)} d ON d.id=y.id AND d.op='D' AND d.fase=? ORDER BY y.id`,
    fase,
  )) {
    lote.push(f);
    if (lote.length >= MAX_FILAS_DELETE) vaciar();
  }
  vaciar();
}

function emitirAltasYCambios(
  db: DatabaseSync,
  escritor: EscritorChunks,
  t: string,
  info: InfoTabla,
  deps: Map<string, Set<string>>,
) {
  const cols = info.columnas;
  const cambio = `temp.${q(`cambio_${t}`)}`;
  const cabecera = `INSERT INTO ${q(t)} (${cols.map(q).join(',')}) VALUES `;
  const sondaAlta = (ids: unknown[]): Sonda => ({
    sql: `SELECT count(*) AS n FROM ${q(t)} WHERE "id" IN (${listaIds(ids)})`,
    esperado: ids.length,
  });

  // Altas sin dependencias: INSERT de varias filas.
  let valores: string[] = [];
  let ids: unknown[] = [];
  let bytes = 0;
  let cargo = 0;
  const vaciarAltas = () => {
    if (!valores.length) return;
    escritor.agregar([cabecera + valores.join(',')], t, 'insertar', valores.length, cargo, sondaAlta(ids));
    valores = [];
    ids = [];
    bytes = 0;
    cargo = 0;
  };
  for (const f of iterar(db, `SELECT x.* FROM n.${q(t)} x JOIN ${cambio} d ON d.id=x.id AND d.op='I' AND d.dep=0 ORDER BY x.id`)) {
    const tupla = `(${cols.map((c) => literal(f[c])).join(',')})`;
    const tam = Buffer.byteLength(tupla, 'utf8') + 1;
    if (valores.length && (valores.length >= MAX_FILAS_INSERT || bytes + tam + cabecera.length > MAX_SENTENCIA_BYTES)) vaciarAltas();
    valores.push(tupla);
    ids.push(f.id);
    bytes += tam;
    cargo += cargoFila(f, cols);
  }
  vaciarAltas();

  // Cambios sin dependencias: agrupados por conjunto de columnas modificadas.
  const lotes = new Map<string, { filas: { id: unknown; nuevo: Fila; base: Fila }[]; bytes: number }>();
  const vaciarCambios = (firma: string) => {
    const lote = lotes.get(firma);
    if (!lote?.filas.length) return;
    emitirCambio(escritor, t, firma.split(','), lote.filas);
    lotes.delete(firma);
  };
  const seleccionCambio = (dep: number) =>
    `SELECT ${cols.map((c) => `x.${q(c)} AS ${q(`n_${c}`)}, y.${q(c)} AS ${q(`b_${c}`)}`).join(',')}
      FROM n.${q(t)} x JOIN b.${q(t)} y ON y.id=x.id JOIN ${cambio} d ON d.id=x.id AND d.op='U' AND d.dep=${dep} ORDER BY x.id`;
  const separar = (f: Fila) => {
    const nuevo: Fila = {};
    const base: Fila = {};
    for (const c of cols) {
      nuevo[c] = f[`n_${c}`];
      base[c] = f[`b_${c}`];
    }
    const cambiadas = cols.filter((c) => c !== 'id' && literal(nuevo[c]) !== literal(base[c]));
    return { nuevo, base, cambiadas };
  };
  for (const f of iterar(db, seleccionCambio(0))) {
    const { nuevo, base, cambiadas } = separar(f);
    if (!cambiadas.length) continue;
    const firma = cambiadas.join(',');
    const tam = cambiadas.reduce((s, c) => s + literal(nuevo[c]).length + literal(base[c]).length + 60, 120);
    const lote = lotes.get(firma);
    if (lote && (lote.filas.length >= MAX_FILAS_UPDATE || lote.bytes + tam > MAX_SENTENCIA_BYTES)) vaciarCambios(firma);
    const destino = lotes.get(firma) ?? { filas: [], bytes: 0 };
    destino.filas.push({ id: nuevo.id, nuevo, base });
    destino.bytes += tam;
    lotes.set(firma, destino);
  }
  for (const firma of [...lotes.keys()]) vaciarCambios(firma);

  if (!deps.size) return;
  // Filas con dependencias (claves únicas que se liberan antes de reutilizarse,
  // autorreferencias a filas nuevas): una sentencia por fila en orden topológico.
  const filas = new Map<string, { op: 'I' | 'U'; fila: Fila }>();
  for (const f of iterar(db, `SELECT x.* FROM n.${q(t)} x JOIN ${cambio} d ON d.id=x.id AND d.op='I' AND d.dep=1`)) {
    filas.set(String(f.id), { op: 'I', fila: f });
  }
  for (const f of iterar(db, seleccionCambio(1))) filas.set(String(f[`n_id`]), { op: 'U', fila: f });
  const pendientes = new Map<string, number>();
  const siguientes = new Map<string, string[]>();
  for (const [id, antes] of deps) {
    pendientes.set(id, antes.size);
    for (const a of antes) (siguientes.get(a) ?? siguientes.set(a, []).get(a)!).push(id);
  }
  const listos = [...deps.keys()].filter((id) => pendientes.get(id) === 0).sort();
  let emitidas = 0;
  while (listos.length) {
    const id = listos.shift()!;
    emitidas += 1;
    const item = filas.get(id);
    if (!item) throw new Error(`dependencia_sin_fila:${t}:${id}`);
    if (item.op === 'I') {
      const tupla = `(${cols.map((c) => literal(item.fila[c])).join(',')})`;
      escritor.agregar([cabecera + tupla], t, 'insertar', 1, cargoFila(item.fila, cols), sondaAlta([item.fila.id]));
    } else {
      const { nuevo, base, cambiadas } = separar(item.fila);
      if (cambiadas.length) emitirCambio(escritor, t, cambiadas, [{ id: nuevo.id, nuevo, base }]);
    }
    for (const s of siguientes.get(id) ?? []) {
      const resto = pendientes.get(s)! - 1;
      pendientes.set(s, resto);
      if (resto === 0) listos.push(s);
    }
  }
  if (emitidas !== deps.size) throw new Error(`ciclo_de_dependencias:${t}`);
}

function emitirCambio(
  escritor: EscritorChunks,
  t: string,
  cambiadas: string[],
  filas: { id: unknown; nuevo: Fila; base: Fila }[],
) {
  const cargo = filas.reduce(
    (s, f) => s + SOBRECOSTE_FILA + FACTOR_CARGA * cambiadas.reduce((x, c) => x + bytesCarga(f.nuevo[c]), 0),
    0,
  );
  const igualdad = (f: Fila, c: string) => `${q(c)} IS ${literal(f[c])}`;
  const conj = (f: Fila) => `(${cambiadas.map((c) => igualdad(f, c)).join(' AND ')})`;
  let sql: string;
  let sonda: string;
  const ids = listaIds(filas.map((f) => f.id));
  if (filas.length === 1) {
    const f = filas[0];
    sql = `UPDATE ${q(t)} SET ${cambiadas.map((c) => `${q(c)}=${literal(f.nuevo[c])}`).join(',')} WHERE "id"=${literal(f.id)} AND ${conj(f.base)}`;
    sonda = `SELECT count(*) AS n FROM ${q(t)} WHERE "id"=${literal(f.id)} AND ${conj(f.nuevo)}`;
  } else {
    const casos = (c: string) => `CASE "id" ${filas.map((f) => `WHEN ${literal(f.id)} THEN ${literal(f.nuevo[c])}`).join(' ')} END`;
    const pre = (lado: 'nuevo' | 'base') =>
      `CASE "id" ${filas.map((f) => `WHEN ${literal(f.id)} THEN ${conj(f[lado])}`).join(' ')} END`;
    sql = `UPDATE ${q(t)} SET ${cambiadas.map((c) => `${q(c)}=${casos(c)}`).join(',')} WHERE "id" IN (${ids}) AND ${pre('base')}`;
    sonda = `SELECT count(*) AS n FROM ${q(t)} WHERE "id" IN (${ids}) AND ${pre('nuevo')}`;
  }
  escritor.agregar([sql, asercion(filas.length, `${t} U`)], t, 'actualizar', filas.length, cargo, {
    sql: sonda,
    esperado: filas.length,
  });
}

// ---------------------------------------------------------------------------
// Composición con lease y contexto de capacidad

export interface Contexto {
  owner: string;
  medidoBytes: number;
  proyectadoBytes: number;
  presupuestoBytes?: number;
  leaseMs?: number;
}

export function proyeccion(cargoBytes: number): number {
  return Math.ceil((SOBRECOSTE_LOTE + Math.ceil(cargoBytes * 1.1) + 65_536) / 4096) * 4096;
}

/**
 * Cabecera: reclama el lease global sólo si está libre (misma sentencia que
 * reclamarSportLease) e inserta el contexto con la versión que quedó en la
 * tabla; si el lease es de otro, no hay contexto y la primera escritura aborta.
 * Pie: cierra el contexto (sport_context_close exige seguir autorizado) y
 * libera el lease. Al ser un único import atómico, cualquier error lo deshace todo.
 */
export function componerChunk(cuerpo: string, ctx: Contexto): string {
  if (!/^[0-9a-f-]{36}$/.test(ctx.owner)) throw new Error('owner_invalido');
  const presupuesto = ctx.presupuestoBytes ?? PRESUPUESTO_BYTES;
  const lease = ctx.leaseMs ?? LEASE_MS;
  const medido = Math.max(1, Math.trunc(ctx.medidoBytes));
  const owner = literal(ctx.owner);
  const cabecera = [
    `INSERT INTO sport_write_lease(key,owner,expires_at,lease_version) VALUES('global',${owner},${AHORA_SQL}+${lease},1) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at, lease_version=sport_write_lease.lease_version+1 WHERE sport_write_lease.expires_at <= ${AHORA_SQL}`,
    `INSERT INTO sport_write_context(key,owner,lease_version,budget_bytes,projected_bytes,measured_bytes) SELECT 'global',owner,lease_version,${presupuesto},${ctx.proyectadoBytes},${medido} FROM sport_write_lease WHERE key='global' AND owner=${owner}`,
    `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sport_write_authorized) THEN json('sincronizar_d1 lease no disponible') END`,
  ];
  const pie = [
    `DELETE FROM sport_write_context WHERE key='global' AND owner=${owner}`,
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM sport_write_context) OR EXISTS (SELECT 1 FROM sport_write_charge) THEN json('sincronizar_d1 contexto abierto') END`,
    `UPDATE sport_write_lease SET expires_at=${AHORA_SQL} WHERE key='global' AND owner=${owner}`,
  ];
  return `${cabecera.map((s) => `${s};\n`).join('')}${cuerpo}${pie.map((s) => `${s};\n`).join('')}`;
}

export function leerManifiesto(salida: string): Manifiesto {
  return JSON.parse(readFileSync(join(salida, 'manifest.json'), 'utf8')) as Manifiesto;
}

export function leerCuerpo(salida: string, chunk: ChunkManifiesto): string {
  const cuerpo = readFileSync(join(salida, chunk.archivo), 'utf8');
  const sha = createHash('sha256').update(cuerpo, 'utf8').digest('hex');
  if (sha !== chunk.sha256) throw new Error(`sha256_distinto:${chunk.archivo}`);
  return cuerpo;
}

/** Aplica los chunks a una base local con node:sqlite, uno por transacción (como el import de D1). */
export interface CargoChunk {
  archivo: string;
  estimadoBytes: number;
  realBytes: number;
  proyectadoBytes: number;
}

export function aplicarLocal(
  db: DatabaseSync,
  salida: string,
  manifiesto: Manifiesto,
  opciones: { owner?: () => string; log?: (m: string) => void } = {},
): { ms: number; contabilizadoBytes: number; medidoInicialBytes: number; porChunk: CargoChunk[] } {
  const inicio = Date.now();
  const porChunk: CargoChunk[] = [];
  let medidoInicial = 0;
  for (const chunk of manifiesto.chunks) {
    const pagina = db.prepare('SELECT page_count*page_size AS b FROM pragma_page_count, pragma_page_size').get() as { b: number };
    const ledger = db.prepare(`SELECT accounted_bytes AS a FROM sport_capacity_ledger WHERE key='global'`).get() as { a: number };
    const medido = Number(pagina.b);
    const proyectado = proyeccion(chunk.cargoBytes);
    if (Math.max(Number(ledger.a), medido) + proyectado >= manifiesto.presupuestoBytes) throw new Error('sport_capacity');
    const sql = componerChunk(leerCuerpo(salida, chunk), {
      owner: (opciones.owner ?? randomUUID)(),
      medidoBytes: medido,
      proyectadoBytes: proyectado,
      presupuestoBytes: manifiesto.presupuestoBytes,
      leaseMs: manifiesto.leaseMs,
    });
    const t0 = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`${chunk.archivo}: ${(e as Error).message}`, { cause: e });
    }
    const despues = db.prepare(`SELECT accounted_bytes AS a FROM sport_capacity_ledger WHERE key='global'`).get() as { a: number };
    // sport_context_reserve fija el ledger en max(ledger, medido) + 16 KiB antes
    // de cobrar filas: ese salto es el tamaño de la base, no cargo de filas.
    const real = Number(despues.a) - Math.max(Number(ledger.a), medido) - SOBRECOSTE_LOTE;
    if (!porChunk.length) medidoInicial = Math.max(Number(ledger.a), medido);
    porChunk.push({ archivo: chunk.archivo, estimadoBytes: chunk.cargoBytes, realBytes: real, proyectadoBytes: proyectado });
    opciones.log?.(`${chunk.archivo} aplicado en ${Date.now() - t0} ms; cargo real ${real} B, estimado ${chunk.cargoBytes} B`);
  }
  const ledger = db.prepare(`SELECT accounted_bytes AS a FROM sport_capacity_ledger WHERE key='global'`).get() as { a: number };
  return { ms: Date.now() - inicio, contabilizadoBytes: Number(ledger.a), medidoInicialBytes: medidoInicial, porChunk };
}

export interface Diferencia {
  tabla: string;
  soloA: number;
  soloB: number;
  agregadosIguales: boolean;
}

/** Compara fila a fila (EXCEPT en ambos sentidos) las tablas sincronizadas de dos bases. */
export function compararBases(rutaA: string, rutaB: string): Diferencia[] {
  const db = abrirComparacion(rutaA, rutaB);
  try {
    const info: Record<string, InfoTabla> = {};
    for (const t of TABLAS) info[t] = infoTabla(db, t);
    const agA = agregadosLocales(db, info, 'b');
    const agB = agregadosLocales(db, info, 'n');
    return TABLAS.map((t) => {
      const cols = info[t].columnas.map(q).join(',');
      const cuenta = (x: string, y: string) =>
        Number((db.prepare(`SELECT count(*) AS n FROM (SELECT ${cols} FROM ${x}.${q(t)} EXCEPT SELECT ${cols} FROM ${y}.${q(t)})`).get() as { n: number }).n);
      return {
        tabla: t,
        soloA: cuenta('b', 'n'),
        soloB: cuenta('n', 'b'),
        agregadosIguales: JSON.stringify(agA[t]) === JSON.stringify(agB[t]),
      };
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Remoto (wrangler)

interface ResultadoD1 {
  results: Record<string, unknown>[];
  success: boolean;
  meta: { size_after?: number; duration?: number; rows_read?: number; rows_written?: number };
}

function wrangler(args: string[]): ResultadoD1[] {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID = CUENTA_CLOUDFLARE;
  const r = spawnSync(
    process.execPath,
    [join(REPO, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', D1_NOMBRE, '--remote', ...args, '--json', '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null'],
    { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const salida = r.stdout ?? '';
  const inicio = salida.search(/^[[{]/m);
  let json: unknown;
  try {
    json = inicio >= 0 ? JSON.parse(salida.slice(inicio)) : undefined;
  } catch {
    json = undefined;
  }
  if (!Array.isArray(json)) {
    const detalle = json && typeof json === 'object' ? JSON.stringify(json) : `${salida}\n${r.stderr ?? ''}`;
    throw new Error(`wrangler_fallo (${r.status}): ${detalle.slice(0, 4000)}`);
  }
  return json as ResultadoD1[];
}

export function consultarRemoto(sql: string): ResultadoD1[] {
  if (sql.length > 30_000) throw new Error('consulta_demasiado_larga_para_linea_de_ordenes');
  return wrangler(['--command', sql]);
}

function agregadosRemotos(manifiesto: Manifiesto, log: (m: string) => void): Record<string, Agregado> {
  const salida: Record<string, Agregado> = {};
  for (const t of TABLAS) {
    const t0 = Date.now();
    salida[t] = agregadoRemoto(manifiesto, t);
    log(`  ${t}: n=${salida[t].n} (${Date.now() - t0} ms)`);
  }
  return salida;
}

export function agregadoRemoto(manifiesto: Manifiesto, t: Tabla): Agregado {
  {
    const { columnas: cols, version } = manifiesto.tablas[t];
    const grande = manifiesto.base.agregados[t].n > 50_000;
    const consultas = consultasAgregado(t, cols, version, grande);
    const filas: { n: unknown; s: unknown; v: unknown }[] = [];
    // Varias sentencias por llamada sin superar el límite de la línea de órdenes de Windows.
    let grupo: string[] = [];
    const vaciar = () => {
      if (!grupo.length) return;
      for (const r of consultarRemoto(grupo.join(';\n'))) filas.push(r.results[0] as { n: unknown; s: unknown; v: unknown });
      grupo = [];
    };
    for (const c of consultas) {
      if ((grupo.join(';\n').length + c.length) > 28_000) vaciar();
      grupo.push(c);
    }
    vaciar();
    if (filas.length !== consultas.length) throw new Error(`agregado_incompleto:${t}`);
    return combinarAgregados(filas);
  }
}

interface EstadoRemoto {
  tamano: number;
  contabilizado: number;
  bloqueado: number;
  contextos: number;
  cargos: number;
  lease: { owner: string; lease_version: number; expires_at: number; ahora: number } | null;
}

function estadoRemoto(): EstadoRemoto {
  const r = consultarRemoto(
    `SELECT accounted_bytes AS a, blocked AS b, (SELECT count(*) FROM sport_write_context) AS c, (SELECT count(*) FROM sport_write_charge) AS g FROM sport_capacity_ledger WHERE key='global';
     SELECT owner, lease_version, expires_at, ${AHORA_SQL} AS ahora FROM sport_write_lease WHERE key='global'`,
  );
  const l = r[0].results[0] as { a: number; b: number; c: number; g: number };
  const tamano = Number(r[0].meta.size_after);
  if (!l || !Number.isSafeInteger(tamano) || tamano <= 0) throw new Error('estado_remoto_desconocido');
  return {
    tamano,
    contabilizado: Number(l.a),
    bloqueado: Number(l.b),
    contextos: Number(l.c),
    cargos: Number(l.g),
    lease: (r[1]?.results[0] as EstadoRemoto['lease']) ?? null,
  };
}

function compararAgregados(esperado: Record<string, Agregado>, real: Record<string, Agregado>): string[] {
  return TABLAS.filter((t) => JSON.stringify(esperado[t]) !== JSON.stringify(real[t])).map(
    (t) => `${t}: esperado ${JSON.stringify(esperado[t])} remoto ${JSON.stringify(real[t])}`,
  );
}

function holgura(manifiesto: Manifiesto, estado: EstadoRemoto, pendientes: ChunkManifiesto[]): number {
  const necesario = pendientes.reduce((s, c) => s + c.cargoBytes + SOBRECOSTE_LOTE, 0);
  const ultimo = pendientes.reduce((m, c) => Math.max(m, proyeccion(c.cargoBytes)), 0);
  return manifiesto.presupuestoBytes - Math.max(estado.contabilizado, estado.tamano) - necesario - ultimo;
}

export function verificarBaseRemota(salida: string, log = console.log): boolean {
  const manifiesto = leerManifiesto(salida);
  const estado = estadoRemoto();
  log(`D1: ${(estado.tamano / 1e6).toFixed(1)} MB, ledger ${estado.contabilizado} B, bloqueado=${estado.bloqueado}, contextos=${estado.contextos}, cargos=${estado.cargos}, lease=${JSON.stringify(estado.lease)}`);
  const problemas: string[] = [];
  if (estado.bloqueado) problemas.push('ledger bloqueado');
  if (estado.contextos || estado.cargos) problemas.push('contexto de escritura abierto');
  const margen = holgura(manifiesto, estado, manifiesto.chunks);
  const final = Math.max(estado.contabilizado, estado.tamano) + manifiesto.cargoTotalBytes + SOBRECOSTE_LOTE * manifiesto.chunks.length;
  log(`Cargo de filas previsto ${manifiesto.cargoTotalBytes} B en ${manifiesto.chunks.length} chunks; ledger final previsto ${final} B ` +
    `(incluye el tamaño actual de D1); holgura tras aplicar ${margen} B`);
  if (margen <= 0) problemas.push('el presupuesto del ledger no alcanza');
  log('Agregados remotos:');
  problemas.push(...compararAgregados(manifiesto.base.agregados, agregadosRemotos(manifiesto, log)));
  for (const p of problemas) log(`DERIVA: ${p}`);
  if (!problemas.length) log('El remoto coincide con la base.');
  return problemas.length === 0;
}

export function verificarFinalRemota(salida: string, log = console.log): boolean {
  const manifiesto = leerManifiesto(salida);
  const problemas = compararAgregados(manifiesto.esperado, agregadosRemotos(manifiesto, log));
  for (const p of problemas) log(`DISTINTO: ${p}`);
  if (!problemas.length) log('El remoto coincide con nuevo.sqlite en las tablas sincronizadas.');
  return problemas.length === 0;
}

interface Progreso {
  chunks: Record<
    string,
    { estado: 'en_curso' | 'hecho'; owner: string; inicio: string; fin?: string; ms?: number; tamano?: number; contabilizado?: number }
  >;
}

function aplicado(chunk: ChunkManifiesto, owner: string): boolean {
  const estado = estadoRemoto();
  if (estado.lease?.owner === owner) return true;
  const r = consultarRemoto(chunk.sonda.sql);
  return Number(r[0].results[0]?.n) === chunk.sonda.esperado;
}

export function aplicarRemoto(salida: string, log = console.log): void {
  const manifiesto = leerManifiesto(salida);
  const rutaProgreso = join(salida, 'progreso.json');
  const progreso: Progreso = existsSync(rutaProgreso) ? JSON.parse(readFileSync(rutaProgreso, 'utf8')) : { chunks: {} };
  const guardar = () => writeFileSync(rutaProgreso, `${JSON.stringify(progreso, null, 2)}\n`);
  if (!Object.keys(progreso.chunks).length && !bandera('sin-verificar-base')) {
    if (!verificarBaseRemota(salida, log)) throw new Error('el remoto no coincide con la base; no se aplica nada');
  }
  const dirAplicando = join(salida, 'aplicando');
  mkdirSync(dirAplicando, { recursive: true });
  for (const [i, chunk] of manifiesto.chunks.entries()) {
    const previo = progreso.chunks[chunk.archivo];
    if (previo?.estado === 'hecho') continue;
    if (previo?.estado === 'en_curso') {
      if (aplicado(chunk, previo.owner)) {
        log(`${chunk.archivo}: ya estaba aplicado (ejecución anterior interrumpida)`);
        progreso.chunks[chunk.archivo] = { ...previo, estado: 'hecho', fin: new Date().toISOString() };
        guardar();
        continue;
      }
    }
    const cuerpo = leerCuerpo(salida, chunk);
    const estado = estadoRemoto();
    if (estado.bloqueado || estado.contextos || estado.cargos) throw new Error('ledger bloqueado o contexto abierto');
    if (estado.lease && estado.lease.expires_at > estado.lease.ahora) throw new Error(`lease ocupado por ${estado.lease.owner}`);
    const proyectado = proyeccion(chunk.cargoBytes);
    if (Math.max(estado.contabilizado, estado.tamano) + proyectado >= manifiesto.presupuestoBytes) throw new Error('sport_capacity');
    const owner = randomUUID();
    const ruta = join(dirAplicando, chunk.archivo);
    writeFileSync(ruta, componerChunk(cuerpo, {
      owner,
      medidoBytes: estado.tamano,
      proyectadoBytes: proyectado,
      presupuestoBytes: manifiesto.presupuestoBytes,
      leaseMs: manifiesto.leaseMs,
    }));
    progreso.chunks[chunk.archivo] = { estado: 'en_curso', owner, inicio: new Date().toISOString() };
    guardar();
    const t0 = Date.now();
    let error: unknown = null;
    try {
      wrangler(['--file', ruta, '--yes']);
    } catch (e) {
      error = e;
    }
    if (error && !aplicado(chunk, owner)) {
      throw new Error(`${chunk.archivo} no se aplicó (D1 lo revirtió): ${(error as Error).message}`);
    }
    const ms = Date.now() - t0;
    // Igual que dbConSportLease: tras confirmar, el tamaño físico no puede superar
    // lo contabilizado; si lo hace, se bloquea el ledger para todos los escritores.
    const despues = estadoRemoto();
    if (despues.bloqueado || despues.tamano > despues.contabilizado || despues.tamano >= manifiesto.presupuestoBytes) {
      consultarRemoto(`UPDATE sport_capacity_ledger SET blocked=1 WHERE key='global'`);
      throw new Error(`${chunk.archivo}: comprobación de capacidad tras confirmar fallida; ledger bloqueado`);
    }
    progreso.chunks[chunk.archivo] = {
      estado: 'hecho', owner, inicio: progreso.chunks[chunk.archivo].inicio, fin: new Date().toISOString(),
      ms, tamano: despues.tamano, contabilizado: despues.contabilizado,
    };
    guardar();
    rmSync(ruta, { force: true });
    log(`${chunk.archivo} (${i + 1}/${manifiesto.chunks.length}) aplicado en ${(ms / 1000).toFixed(1)} s; D1 ${(despues.tamano / 1e6).toFixed(1)} MB, ledger ${despues.contabilizado} B`);
  }
  if (!verificarFinalRemota(salida, log)) throw new Error('verificación final fallida');
}

// ---------------------------------------------------------------------------
// Comprobación local de ida y vuelta

export function comprobarLocal(opciones: OpcionesPlan & { conservar?: boolean }) {
  const log = opciones.log ?? console.log;
  const manifiesto = existsSync(join(opciones.salida, 'manifest.json')) ? leerManifiesto(opciones.salida) : planificar(opciones);
  const copia = join(opciones.salida, 'copia-base.sqlite');
  copyFileSync(opciones.base, copia);
  try {
    const db = new DatabaseSync(copia);
    let resultado: ReturnType<typeof aplicarLocal>;
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const guardas = (db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND (name LIKE 'sport_fence_%' OR name LIKE 'sport_charge_%')`).get() as { n: number }).n;
      log(`Copia con ${guardas} triggers de guarda`);
      resultado = aplicarLocal(db, opciones.salida, manifiesto, { log });
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) throw new Error(`foreign_key_check: ${fk.length} filas`);
    } finally {
      db.close();
    }
    const difs = compararBases(copia, opciones.nuevo);
    for (const d of difs) log(`${d.tabla}: soloCopia=${d.soloA} soloNuevo=${d.soloB} agregados=${d.agregadosIguales ? 'iguales' : 'DISTINTOS'}`);
    const ok = difs.every((d) => !d.soloA && !d.soloB && d.agregadosIguales) &&
      resultado.porChunk.every((c) => c.realBytes <= c.estimadoBytes);
    const real = resultado.porChunk.reduce((s, c) => s + c.realBytes, 0);
    const insuficientes = resultado.porChunk.filter((c) => c.realBytes > c.estimadoBytes);
    log(`${ok ? 'OK' : 'FALLO'}: aplicado en ${resultado.ms} ms, ledger local ${resultado.contabilizadoBytes} B = ` +
      `max(ledger, tamaño inicial) ${resultado.medidoInicialBytes} + cargo de filas ${real} (estimado ${manifiesto.cargoTotalBytes}) ` +
      `+ ${resultado.porChunk.length} x ${SOBRECOSTE_LOTE} de lote`);
    for (const c of insuficientes) log(`ESTIMACION INSUFICIENTE ${c.archivo}: real ${c.realBytes} > estimado ${c.estimadoBytes}`);
    return { ok, difs, ...resultado, manifiesto };
  } finally {
    if (!opciones.conservar) rmSync(copia, { force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI

function main() {
  const salida = argumento('salida', '');
  if (!salida) throw new Error('falta --salida <dir>');
  if (bandera('diff')) {
    const m = planificar({
      base: argumento('base', ''),
      nuevo: argumento('nuevo', ''),
      salida,
      chunkBytes: Math.round(Number(argumento('chunk-mb', '20')) * 1024 * 1024),
    });
    console.log(`${m.chunks.length} chunks, ${m.chunks.reduce((s, c) => s + c.bytes, 0)} bytes, cargo ${m.cargoTotalBytes} B`);
  } else if (bandera('comprobar')) {
    const r = comprobarLocal({ base: argumento('base', ''), nuevo: argumento('nuevo', ''), salida, conservar: bandera('conservar') });
    process.exitCode = r.ok ? 0 : 1;
  } else if (bandera('verificar-base')) {
    process.exitCode = verificarBaseRemota(salida) ? 0 : 1;
  } else if (bandera('aplicar')) {
    if (argumento('confirmar', '') !== D1_ID) throw new Error(`falta --confirmar ${D1_ID}`);
    aplicarRemoto(salida);
  } else if (bandera('verificar-final')) {
    process.exitCode = verificarFinalRemota(salida) ? 0 : 1;
  } else {
    throw new Error('modo: --diff | --comprobar | --verificar-base | --aplicar | --verificar-final');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
