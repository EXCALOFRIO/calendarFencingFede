import { sql } from 'drizzle-orm';
import { CIRCUIT_LABEL } from '@/lib/utils';

/**
 * La ingestión FIE usa tournament.type / competitionCategory, nunca el título.
 * Skermo refineCircuitByName sobrescribe algunos circuitos sin conservar el
 * Tipo original. Esos códigos NO prueban el tipo histórico, aunque suenen claros.
 * Sólo conservamos los códigos que ese refinador no puede producir.
 */
export const TIPOS_FIE = [
  'CTO_ESPANA', 'CTO_EUROPA', 'CTO_MUNDO', 'SEN_WC', 'JUN_WC', 'CAD_WC', 'SEN_GP', 'SATELITE',
] as const;
export const TIPOS_SKERMO_SIN_REFINAR = [
  'TNR', 'LIGA_CLUBES', 'CONCENTRACION', 'TLM',
] as const;

export function tipoConProcedencia(fuente: string | null, circuito: string | null): string | null {
  if (!circuito) return null;
  if (fuente === 'fie' && (TIPOS_FIE as readonly string[]).includes(circuito)) return circuito;
  if ((fuente === 'skermo_rfee' || fuente === 'skermo_regional') &&
      (TIPOS_SKERMO_SIN_REFINAR as readonly string[]).includes(circuito)) return circuito;
  return null;
}

/** Los dos eventos ya están vinculados por la API compartida del explorador. */
function tipoEvento(alias: 'ev0' | 'evc') {
  const a = sql.raw(alias);
  return sql`CASE
    WHEN ${a}.source = 'fie' AND ${a}.circuit IN (${sql.join(TIPOS_FIE.map((t) => sql`${t}`), sql`, `)})
      THEN ${a}.circuit
    WHEN ${a}.source IN ('skermo_rfee', 'skermo_regional')
      AND ${a}.circuit IN (${sql.join(TIPOS_SKERMO_SIN_REFINAR.map((t) => sql`${t}`), sql`, `)})
      THEN ${a}.circuit
  END`;
}

const TIPO_DIRECTO = tipoEvento('ev0');
const TIPO_CANONICO = tipoEvento('evc');

// Un vínculo no autoriza a escoger uno de dos tipos oficiales incompatibles.
export const TIPO_ESTADISTICO_DOCUMENTADO = sql`CASE
  WHEN ${TIPO_DIRECTO} <> ${TIPO_CANONICO} THEN NULL
  ELSE coalesce(${TIPO_DIRECTO}, ${TIPO_CANONICO})
END`;

/** Orden de lectura de tipos, no pesos ni un índice de rendimiento oficial. */
const ORDEN = ['CTO_ESPANA', 'CTO_EUROPA', 'CTO_MUNDO', 'SEN_WC', 'JUN_WC', 'CAD_WC', 'SEN_GP'];
export function ordenTipo(tipo: string | null): number {
  if (tipo === null) return 100;
  const i = ORDEN.indexOf(tipo);
  return i < 0 ? 50 : i;
}

export function etiquetaTipoEstadistico(tipo: string | null): string {
  if (tipo === null) return 'Tipo no publicado';
  return CIRCUIT_LABEL[tipo] ?? tipo;
}
