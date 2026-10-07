/**
 * Estado propio de la ingesta automática (tablas resultado_auto_*, drizzle-d1/0017): unidades
 * de trabajo, cola de revisión y consumo diario. Fuera de sport_*: no consume libro.
 */
import type { BaseResultados } from './sql';

export const TABLAS_PROPIAS = ['resultado_auto_unidad', 'resultado_auto_revision', 'resultado_auto_evento', 'resultado_auto_consumo'] as const;

export type FuenteUnidad = 'fie' | 'skermo' | 'pdf' | 'indice';
export type EstadoUnidad = 'pendiente' | 'esperando' | 'hecho' | 'revision' | 'descartada' | 'error';

export type Unidad = {
  clave: string;
  fuente: FuenteUnidad;
  temporada: string;
  fecha: string | null;
  estado: EstadoUnidad;
  huella: string | null;
  intentos: number;
  proxima: number;
  ultima: number | null;
  detalle: string | null;
  /** Clave de los asaltos (o del documento) que escribió esta misma unidad. */
  escrito: string | null;
  datos: Record<string, unknown> | null;
};

export const NUNCA = 8_640_000_000_000_000;
export const HORA = 3_600_000;
export const DIA = 24 * HORA;

export async function migracionAplicada(base: BaseResultados): Promise<boolean> {
  const filas = await base.leer<{ n: number }>(
    `select count(*) n from sqlite_master where type='table' and name in (${TABLAS_PROPIAS.map(() => '?').join(',')})`,
    [...TABLAS_PROPIAS]);
  return Number(filas[0]?.n) === TABLAS_PROPIAS.length;
}

export async function tablaExiste(base: BaseResultados, nombre: string): Promise<boolean> {
  return (await base.leer(`select 1 from sqlite_master where type='table' and name=?`, [nombre])).length > 0;
}

function aUnidad(f: Record<string, unknown>): Unidad {
  let datos: Record<string, unknown> | null = null;
  try { datos = f.datos ? JSON.parse(String(f.datos)) : null; } catch { datos = null; }
  return {
    clave: String(f.clave), fuente: f.fuente as FuenteUnidad, temporada: String(f.temporada),
    fecha: (f.fecha as string | null) ?? null, estado: f.estado as EstadoUnidad, huella: (f.huella as string | null) ?? null,
    intentos: Number(f.intentos ?? 0), proxima: Number(f.proxima), ultima: f.ultima === null ? null : Number(f.ultima),
    detalle: (f.detalle as string | null) ?? null, escrito: (f.escrito as string | null) ?? null, datos,
  };
}

export async function unidadesPendientes(base: BaseResultados, ahora: number, limite: number): Promise<Unidad[]> {
  return (await base.leer(
    `select * from resultado_auto_unidad where proxima <= ? and estado in ('pendiente','esperando','error','hecho')
      and fuente <> 'indice' order by proxima, clave limit ?`, [ahora, limite])).map(aUnidad);
}

export async function leerUnidad(base: BaseResultados, clave: string): Promise<Unidad | null> {
  const [f] = await base.leer(`select * from resultado_auto_unidad where clave=?`, [clave]);
  return f ? aUnidad(f) : null;
}

/**
 * Alta de unidades descubiertas. Una unidad ya conocida sólo actualiza `datos` (el índice puede
 * añadir un PDF o un enlace) y, si cambió y estaba hecha, se vuelve a mirar ya.
 */
export function sentenciasAlta(unidades: readonly Omit<Unidad, 'estado' | 'huella' | 'intentos' | 'ultima' | 'detalle' | 'escrito'>[]) {
  return unidades.map((u) => ({
    sql: `insert into resultado_auto_unidad (clave, fuente, temporada, fecha, estado, intentos, proxima, datos)
      values (?,?,?,?,'pendiente',0,?,?)
      on conflict (clave) do update set datos=excluded.datos, fecha=excluded.fecha,
        proxima=case when resultado_auto_unidad.datos is not excluded.datos and resultado_auto_unidad.estado in ('hecho','esperando')
          then min(resultado_auto_unidad.proxima, excluded.proxima) else resultado_auto_unidad.proxima end
      where resultado_auto_unidad.datos is not excluded.datos or resultado_auto_unidad.fecha is not excluded.fecha`,
    params: [u.clave, u.fuente, u.temporada, u.fecha, u.proxima, u.datos ? JSON.stringify(u.datos) : null],
  }));
}

export function sentenciaCierre(u: Pick<Unidad, 'clave'>, c: {
  estado: EstadoUnidad; huella?: string | null; escrito?: string | null; proxima: number; detalle: string | null; ahora: number;
  intento: boolean;
}) {
  return {
    sql: `update resultado_auto_unidad set estado=?, huella=coalesce(?, huella), escrito=coalesce(?, escrito), proxima=?,
      detalle=?, ultima=?, intentos=intentos + ? where clave=?`,
    params: [c.estado, c.huella ?? null, c.escrito?.slice(0, 300) || null, c.proxima, c.detalle?.slice(0, 300) ?? null, c.ahora,
      c.intento ? 1 : 0, u.clave],
  };
}

export function sentenciaRevision(clave: string, motivo: string, datos: Record<string, unknown>, ahora: number) {
  const json = JSON.stringify(datos);
  return {
    sql: `insert into resultado_auto_revision (clave, motivo, datos, estado, creada_en) values (?,?,?,'abierta',?)
      on conflict (clave, motivo) where estado = 'abierta' do update set datos=excluded.datos, creada_en=excluded.creada_en`,
    params: [clave, motivo.slice(0, 80), json.length <= 8000 ? json : JSON.stringify({ recortado: true }), ahora],
  };
}

// ------------------------------------------------------------------ consumo diario

export type ClaveConsumo = 'ia_llamadas' | 'ia_neuronas' | 'filas' | 'peticiones' | 'bytes_ledger';
export const diaUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function consumoDelDia(base: BaseResultados, ahora: number): Promise<Record<ClaveConsumo, number>> {
  const r: Record<ClaveConsumo, number> = { ia_llamadas: 0, ia_neuronas: 0, filas: 0, peticiones: 0, bytes_ledger: 0 };
  for (const f of await base.leer<{ clave: ClaveConsumo; valor: number }>(
    `select clave, valor from resultado_auto_consumo where dia=?`, [diaUtc(ahora)])) r[f.clave] = Number(f.valor);
  return r;
}

export function sentenciasConsumo(ahora: number, sumas: Partial<Record<ClaveConsumo, number>>) {
  return Object.entries(sumas).filter(([, v]) => Number.isSafeInteger(v) && (v as number) > 0).map(([clave, v]) => ({
    sql: `insert into resultado_auto_consumo (dia, clave, valor) values (?,?,?)
      on conflict (dia, clave) do update set valor = valor + excluded.valor`,
    params: [diaUtc(ahora), clave, v],
  }));
}

/** Margen del libro de capacidad: lo que queda hasta el presupuesto de 8 GiB. */
export async function margenLedger(base: BaseResultados, presupuesto: number): Promise<{ contabilizado: number; margen: number; bloqueado: boolean }> {
  const [f] = await base.leer<{ a: number; b: number }>(
    `select accounted_bytes a, blocked b from sport_capacity_ledger where key='global'`);
  if (!f) throw new Error('resultados_auto_ledger_ausente');
  const contabilizado = Number(f.a);
  return { contabilizado, margen: presupuesto - contabilizado, bloqueado: Number(f.b) !== 0 };
}
