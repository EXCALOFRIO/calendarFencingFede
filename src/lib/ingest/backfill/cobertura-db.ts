import type { ConsultaSql } from './capacidad-db';
import type { FilaCoberturaAgregada } from './estado';
import type { FilaPlan } from './plan';

/**
 * Lecturas SELECT de sólo lectura para planificar y resumir el backfill. Todo
 * el SQL es de texto fijo; lo poco que viene de fuera (fuentes, temporadas) se
 * valida contra un patrón estricto antes de entrar en la consulta.
 */

const FUENTE_VALIDA = /^[a-z][a-z0-9_]{1,30}$/;
const TEMPORADA_VALIDA = /^\d{4}(-\d{4})?$/;

const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function comoFecha(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function comoDia(v: unknown): string | null {
  const d = comoFecha(v);
  return d ? d.toISOString().slice(0, 10) : null;
}

function lista(valores: readonly string[], valido: RegExp, nombre: string): string {
  for (const v of valores) {
    if (!valido.test(v)) throw new Error(`Valor no válido para ${nombre}: ${v}`);
  }
  return valores.map((v) => `'${v}'`).join(',');
}

export type FiltroFilasPlan = { fuentes?: readonly string[]; temporadas?: readonly string[]; limite: number };

/**
 * Filas de cobertura con la fecha de su prueba. `truncado` avisa de que el
 * límite cortó el listado: lo que no se ve no se da por completo.
 */
export async function leerFilasPlan(
  consultar: ConsultaSql,
  filtro: FiltroFilasPlan,
): Promise<{ filas: FilaPlan[]; truncado: boolean }> {
  const limite = Math.max(1, Math.floor(filtro.limite));
  const condiciones = [`c.fact_kind in ('competitions','ranking','results','pools','tableau','pdf')`];
  if (filtro.fuentes?.length) condiciones.push(`c.source in (${lista(filtro.fuentes, FUENTE_VALIDA, 'fuente')})`);
  if (filtro.temporadas?.length) condiciones.push(`c.season in (${lista(filtro.temporadas, TEMPORADA_VALIDA, 'temporada')})`);
  const filas = await consultar(`
    select c.source, c.season, c.fact_kind, c.competition_key, c.status, c.published_total,
           c.imported_total, c.attempts, c.cursor, c.last_checked_at, c.last_error, c.source_url,
           c.competition_id, sc.competition_date
    from sport_import_coverage c
    left join sport_competition sc on sc.id = c.competition_id
    where ${condiciones.join(' and ')}
    order by c.season desc, c.source, c.competition_key, c.fact_kind
    limit ${limite + 1}`);
  const truncado = filas.length > limite;
  return {
    truncado,
    filas: filas.slice(0, limite).map((f) => ({
      source: String(f.source),
      season: String(f.season),
      factKind: String(f.fact_kind),
      competitionKey: String(f.competition_key),
      status: String(f.status) as FilaPlan['status'],
      publishedTotal: f.published_total === null || f.published_total === undefined ? null : numero(f.published_total),
      importedTotal: numero(f.imported_total),
      attempts: numero(f.attempts),
      cursor: f.cursor === null || f.cursor === undefined ? null : String(f.cursor),
      lastCheckedAt: comoFecha(f.last_checked_at),
      lastError: f.last_error === null || f.last_error === undefined ? null : String(f.last_error),
      sourceUrl: f.source_url === null || f.source_url === undefined ? null : String(f.source_url),
      competitionDate: comoDia(f.competition_date),
      competitionId: f.competition_id === null || f.competition_id === undefined ? null : String(f.competition_id),
    })),
  };
}

export type FilaIndicePersistida = {
  source: string;
  season: string;
  competitionKey: string;
  status: FilaPlan['status'];
  publishedTotal: number | null;
  importedTotal: number;
};

/**
 * Cobertura `index:` que guarda el inventario (una fila por fuente, temporada y
 * federación). Sólo cuenta temporadas inventariadas: no enumera pruebas.
 */
export async function leerIndicesPersistidos(consultar: ConsultaSql, limite = 2000): Promise<FilaIndicePersistida[]> {
  const filas = await consultar(`
    select source, season, competition_key, status, published_total, imported_total
    from sport_import_coverage
    where fact_kind = 'index'
    order by season desc, source, competition_key
    limit ${Math.max(1, Math.floor(limite))}`);
  return filas.map((f) => ({
    source: String(f.source),
    season: String(f.season),
    competitionKey: String(f.competition_key),
    status: String(f.status) as FilaPlan['status'],
    publishedTotal: f.published_total === null || f.published_total === undefined ? null : numero(f.published_total),
    importedTotal: numero(f.imported_total),
  }));
}
/** Cobertura agrupada por fuente, tipo de hecho, estado y clase de cursor (denominadores incluidos). */
export async function leerCoberturaAgregada(consultar: ConsultaSql): Promise<FilaCoberturaAgregada[]> {
  const filas = await consultar(`
    select source, fact_kind, status,
           case when cursor = 'no_publicado' then 'no_publicado'
                when cursor like '{"v":1,"fuente":"fie"%' then 'continuacion'
                else null end as clase_cursor,
           (published_total is null or imported_total >= published_total) as consistente,
           count(*)::int as n,
           coalesce(sum(published_total), 0)::bigint as publicado,
           coalesce(sum(imported_total), 0)::bigint as importado
    from sport_import_coverage
    group by 1, 2, 3, 4, 5`);
  return filas.map((f) => ({
    source: String(f.source),
    factKind: String(f.fact_kind),
    status: String(f.status) as FilaCoberturaAgregada['status'],
    claseCursor: f.clase_cursor === 'no_publicado' || f.clase_cursor === 'continuacion' ? f.clase_cursor : null,
    consistente: f.consistente === true || f.consistente === 't' || f.consistente === 'true',
    n: numero(f.n),
    publicado: numero(f.publicado),
    importado: numero(f.importado),
  }));
}

export type ReferenciasHistoricas = {
  /** `false` si la migración 0018 no está aplicada: no hay referencias que contar. */
  tablaDisponible: boolean;
  inscripcionesFie: number;
  /** De esas, las de pruebas ya disputadas (no vuelven a entrar en la ventana de lectura). */
  inscripcionesFieHistoricas: number;
  /** Con al menos una referencia guardada. `null` sin la tabla. */
  conReferencia: number | null;
  /** Históricas sin referencia: no se enriquecerán solas porque la cadencia sólo relee pruebas próximas. */
  historicasSinReferencia: number | null;
};

/**
 * Referencias de inscripción aún no enriquecidas tras la migración 0018. Es un
 * recuento, no una hidratación: ninguna lectura histórica se dispara desde aquí.
 */
export async function contarReferenciasHistoricas(consultar: ConsultaSql): Promise<ReferenciasHistoricas> {
  const [existe] = await consultar(`select to_regclass('public.sport_registration_ref') is not null as ok`);
  const tabla = existe?.ok === true || existe?.ok === 't' || existe?.ok === 'true';
  const base = `
    from competition_registration r
    join event_competition ec on ec.id = r.event_competition_id
    where r.source = 'fie'`;
  const [t] = await consultar(`
    select count(*)::int as total,
           count(*) filter (where ec.competition_date < current_date)::int as historicas
    ${base}`);
  const resultado: ReferenciasHistoricas = {
    tablaDisponible: tabla,
    inscripcionesFie: numero(t?.total),
    inscripcionesFieHistoricas: numero(t?.historicas),
    conReferencia: null,
    historicasSinReferencia: null,
  };
  if (!tabla) return resultado;
  const [c] = await consultar(`
    select count(*) filter (where exists (select 1 from sport_registration_ref f where f.registration_id = r.id))::int as con_ref,
           count(*) filter (where ec.competition_date < current_date
                              and not exists (select 1 from sport_registration_ref f where f.registration_id = r.id))::int as hist_sin_ref
    ${base}`);
  return { ...resultado, conReferencia: numero(c?.con_ref), historicasSinReferencia: numero(c?.hist_sin_ref) };
}
