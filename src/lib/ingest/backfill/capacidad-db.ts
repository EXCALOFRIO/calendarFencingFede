import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { ConteosOcupacion, Ocupacion, TablaOcupacion } from './capacidad';

/**
 * Medición de ocupación lógica con SELECT de sólo lectura sobre el catálogo y
 * recuentos de las tablas deportivas. Nunca lee filas de datos, PDF ni
 * credenciales. Los errores se propagan: una base que no contesta no es una
 * base vacía.
 */

export type ConsultaSql = (texto: string) => Promise<Record<string, unknown>[]>;

const SQL_TABLAS = `
  select c.relname as tabla,
         pg_table_size(c.oid)::bigint as tabla_bytes,
         pg_indexes_size(c.oid)::bigint as indices_bytes,
         pg_total_relation_size(c.oid)::bigint as total_bytes,
         greatest(c.reltuples, 0)::bigint as filas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by total_bytes desc`;

const SQL_BASE = 'select pg_database_size(current_database())::bigint as bytes';

/** Tablas contadas con exactitud (pequeñas) y qué mide cada una. */
const CONTEOS: { clave: keyof ConteosOcupacion; tabla: string; donde?: string }[] = [
  { clave: 'personas', tabla: 'sport_person' },
  { clave: 'pruebas', tabla: 'sport_competition' },
  { clave: 'puestos', tabla: 'sport_result' },
  { clave: 'asaltos', tabla: 'sport_bout' },
  { clave: 'documentos', tabla: 'sport_import_coverage', donde: "fact_kind = 'pdf'" },
  { clave: 'coberturas', tabla: 'sport_import_coverage' },
];

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function medirOcupacion(
  consultar: ConsultaSql,
  ahora: () => Date = () => new Date(),
): Promise<Ocupacion> {
  const filas = await consultar(SQL_TABLAS);
  const tablas: TablaOcupacion[] = filas.map((f) => ({
    tabla: String(f.tabla),
    tablaBytes: numero(f.tabla_bytes),
    indicesBytes: numero(f.indices_bytes),
    totalBytes: numero(f.total_bytes),
    filas: numero(f.filas),
  }));
  const [base] = await consultar(SQL_BASE);
  const existentes = new Set(tablas.map((t) => t.tabla));

  const conteos: ConteosOcupacion = {
    personas: 0,
    pruebas: 0,
    puestos: 0,
    asaltos: 0,
    documentos: 0,
    coberturas: 0,
  };
  for (const c of CONTEOS) {
    // Identificadores fijos de esta lista: nada que venga de fuera llega al SQL.
    if (!existentes.has(c.tabla)) continue;
    const [r] = await consultar(
      `select count(*)::int as n from "${c.tabla}"${c.donde ? ` where ${c.donde}` : ''}`,
    );
    conteos[c.clave] = numero(r?.n);
  }

  return {
    medidoEn: ahora().toISOString(),
    logicoBytes: tablas.reduce((s, t) => s + t.totalBytes, 0),
    baseDatosBytes: base ? numero(base.bytes) : null,
    tablas,
    conteos,
  };
}

/** Consulta real: SELECT de texto fijo sobre la conexión Neon existente. */
export function consultaSqlDb(db: Db): ConsultaSql {
  return async (texto) => {
    const r = await db.execute(sql.raw(texto));
    return (r as unknown as { rows: Record<string, unknown>[] }).rows;
  };
}
