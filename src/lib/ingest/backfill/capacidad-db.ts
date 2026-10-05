import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { evaluarCapacidad, proyectarCrecimiento, TASAS_CONSERVADORAS,
  type ConteosOcupacion, type EstimacionLote, type Ocupacion, type PlanNeon } from './capacidad';

export type ConsultaSql = ((texto: string) => Promise<Record<string, unknown>[]>) & {
  storageSize?: () => Promise<number>;
};
/**
 * Application allocation (8 GiB, below D1's 10 GB per-database limit on the paid
 * plan), NOT a spending cap nor a claim that account storage is free.
 */
export const D1_DEFAULT_BUDGET_BYTES = 8 * 1024 ** 3;
export function presupuestoD1(value = process.env.D1_STORAGE_BUDGET_BYTES): number {
  if (value === undefined) return D1_DEFAULT_BUDGET_BYTES;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n <= 0 || n > D1_DEFAULT_BUDGET_BYTES) {
    throw new Error('sport_capacity_budget_invalid');
  }
  return n;
}
/** Compatibility DTO for the legacy pure planning core, never a Neon policy. */
export function planCapacidadD1(bytes = presupuestoD1()): PlanNeon {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > D1_DEFAULT_BUDGET_BYTES) throw new Error('sport_capacity_budget_invalid');
  return { tipo: 'otro', umbralVerificadoBytes: bytes, verificadoEn: 'D1 application allocation (account storage unverified)' };
}
const CONTEOS: { clave: keyof ConteosOcupacion; tabla: string; donde?: string }[] = [
  { clave: 'personas', tabla: 'sport_person' }, { clave: 'pruebas', tabla: 'sport_competition' },
  { clave: 'puestos', tabla: 'sport_result' }, { clave: 'asaltos', tabla: 'sport_bout' },
  { clave: 'documentos', tabla: 'sport_import_coverage', donde: "fact_kind = 'pdf'" },
  { clave: 'coberturas', tabla: 'sport_import_coverage' },
];
function entero(v: unknown, positive = false) {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isSafeInteger(n) || n < (positive ? 1 : 0)) {
    throw new Error('sport_capacity_measurement_unknown');
  }
  return n;
}
export async function medirOcupacion(consultar: ConsultaSql, ahora = () => new Date()): Promise<Ocupacion> {
  let bytes: number;
  try {
    if (!consultar.storageSize) throw new Error();
    bytes = entero(await consultar.storageSize(), true);
  } catch { throw new Error('sport_capacity_measurement_unknown'); }
  const tables = await consultar("select name as tabla from sqlite_master where type='table'");
  const names = new Set(tables.map((r) => String(r.tabla)));
  const conteos: ConteosOcupacion = { personas: 0, pruebas: 0, puestos: 0, asaltos: 0, documentos: 0, coberturas: 0 };
  for (const c of CONTEOS) {
    if (!names.has(c.tabla)) throw new Error('sport_capacity_schema_missing');
    const [row] = await consultar(`select count(*) as n from "${c.tabla}"${c.donde ? ` where ${c.donde}` : ''}`);
    conteos[c.clave] = entero(row?.n);
  }
  return { medidoEn: ahora().toISOString(), logicoBytes: bytes, baseDatosBytes: bytes,
    // D1 metadata exposes total storage, not trustworthy per-table byte sizes.
    tablas: [{ tabla: 'd1_reported_storage', tablaBytes: bytes, indicesBytes: 0, totalBytes: bytes, filas: 0 }],
    conteos };
}
export function consultaSqlDb(db: Db): ConsultaSql {
  return Object.assign(async (texto: string) => (await db.execute(sql.raw(texto))).rows,
    { storageSize: () => db.storageSize() });
}
export async function comprobarCapacidadD1(db: Db, estimate: EstimacionLote, bytes = presupuestoD1()) {
  const counts = Object.values(estimate);
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error('sport_capacity_projection_unknown');
  const occupied = await medirOcupacion(consultaSqlDb(db));
  const projected = proyectarCrecimiento(TASAS_CONSERVADORAS, estimate);
  if (!Number.isSafeInteger(projected)) throw new Error('sport_capacity_projection_unknown');
  return evaluarCapacidad({ actualBytes: occupied.logicoBytes, proyectadoBytes: projected, plan: planCapacidadD1(bytes) });
}
