import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import {
  sportBout,
  sportCompetition,
  sportEdition,
  sportImportCoverage,
  sportResult,
} from '@/db/schema';
import { crearGuardIdentidadD1, evidenciaD1, esquemaD1 } from './backfill/identidad-db';
import { DB_NOW, MAX_BATCH_STATEMENTS } from './sport-incremental/lease';
import {
  claveEdicionFie,
  FUENTE_FIE,
  type DepsPersistenciaFie,
  type FilaAsalto,
  type FilaResultado,
  type ResumenEscritura,
} from './fie-resultados-persist';

/**
 * Implementación D1 de la persistencia de resultados FIE.
 *
 * Todo es `INSERT … ON CONFLICT` sobre la clave natural del hecho, así que
 * repetir una lectura no duplica nada. Sólo se reescribe una fila (y sube su
 * `revision`) si cambió su contenido; una persona recién resuelta sí se
 * incorpora a una fila ya guardada sin tocar su revisión. No hay borrados.
 */

const LOTE = 3;

function lotes<T>(items: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += LOTE) salida.push(items.slice(i, i + LOTE));
  return salida;
}

function resumir(total: number, devueltas: { id: string }[], idsNuevos: Set<string>): ResumenEscritura {
  const nuevos = devueltas.filter((d) => idsNuevos.has(d.id)).length;
  return { nuevos, revisados: devueltas.length - nuevos, sinCambios: total - devueltas.length };
}

async function marcarRelectura(db: Db, source: string, competitionId: string, kinds: string[]) {
  // Large fact sets commit independently bounded batches. A later lease/DB
  // failure must not leave an old COMPLETE checkpoint over a mixed snapshot.
  // This is not a source check: keep counts/attempts/last_checked_at unchanged.
  await db.update(sportImportCoverage).set({ status: 'pendiente',
    lastError: 'sport_refresh_in_progress', updatedAt: DB_NOW }).where(and(
    eq(sportImportCoverage.source, source), eq(sportImportCoverage.competitionId, competitionId),
    eq(sportImportCoverage.status, 'completo'),
    sql`${sportImportCoverage.factKind} in (select value from json_each(${JSON.stringify(kinds)}))`,
  ));
}

/** Puestos por clave natural; compartido por todos los adaptadores de resultados. */
export async function escribirResultados(
  db: Db,
  source: string,
  competitionId: string,
  filas: FilaResultado[],
): Promise<ResumenEscritura> {
  if (filas.length) await marcarRelectura(db, source, competitionId, ['ranking', 'results']);
  const devueltas: { id: string }[] = [];
  const idsNuevos = new Set<string>();
  const queries = [];
  for (const lote of lotes(filas)) {
    const values = lote.map((f) => {
      const id = crypto.randomUUID(); idsNuevos.add(id);
      return { ...f, id, competitionId, source };
    });
    queries.push(db
      .insert(sportResult)
      .values(values)
      .onConflictDoUpdate({
        target: [sportResult.competitionId, sportResult.source, sportResult.sourceFactKey],
        set: {
          personId: sql`coalesce(excluded.person_id, ${sportResult.personId})`,
          sourceName: sql`excluded.source_name`,
          sourceCountryCode: sql`excluded.source_country_code`,
          sourceClub: sql`excluded.source_club`,
          position: sql`excluded.position`,
          positionRaw: sql`excluded.position_raw`,
          officialPoints: sql`excluded.official_points`,
          occurredOn: sql`excluded.occurred_on`,
          sourceUrl: sql`excluded.source_url`,
          revision: sql`CASE WHEN ${sportResult.contentHash} <> excluded.content_hash THEN ${sportResult.revision} + 1 ELSE ${sportResult.revision} END`,
          revisedAt: sql`CASE WHEN ${sportResult.contentHash} <> excluded.content_hash THEN ${DB_NOW} ELSE ${sportResult.revisedAt} END`,
          contentHash: sql`excluded.content_hash`,
        },
        setWhere: sql`${sportResult.contentHash} <> excluded.content_hash OR (${sportResult.personId} IS NULL AND excluded.person_id IS NOT NULL)`,
      })
      .returning({ id: sportResult.id }));
  }
  for (let i = 0; i < queries.length; i += MAX_BATCH_STATEMENTS) {
    const [first, ...rest] = queries.slice(i, i + MAX_BATCH_STATEMENTS);
    devueltas.push(...(await db.batch([first, ...rest])).flat());
  }
  return resumir(filas.length, devueltas, idsNuevos);
}

/** Asaltos por clave natural; compartido por FIE y las fuentes complementarias. */
export async function escribirAsaltos(
  db: Db,
  source: string,
  competitionId: string,
  filas: FilaAsalto[],
): Promise<ResumenEscritura> {
  if (filas.length) await marcarRelectura(db, source, competitionId, ['pools', 'tableau']);
  const devueltas: { id: string }[] = [];
  const idsNuevos = new Set<string>();
  const queries = [];
  for (const lote of lotes(filas)) {
    const values = lote.map((f) => {
      const id = crypto.randomUUID(); idsNuevos.add(id);
      return { ...f, id, competitionId, source };
    });
    queries.push(db
      .insert(sportBout)
      .values(values)
      .onConflictDoUpdate({
        target: [
          sportBout.competitionId,
          sportBout.source,
          sportBout.phase,
          sportBout.roundKey,
          sportBout.fencerARef,
          sportBout.fencerBRef,
        ],
        set: {
          fencerAPersonId: sql`coalesce(excluded.fencer_a_person_id, ${sportBout.fencerAPersonId})`,
          fencerBPersonId: sql`coalesce(excluded.fencer_b_person_id, ${sportBout.fencerBPersonId})`,
          fencerAName: sql`excluded.fencer_a_name`,
          fencerBName: sql`excluded.fencer_b_name`,
          scoreA: sql`excluded.score_a`,
          scoreB: sql`excluded.score_b`,
          occurredOn: sql`excluded.occurred_on`,
          sourceUrl: sql`excluded.source_url`,
          revision: sql`CASE WHEN ${sportBout.contentHash} <> excluded.content_hash THEN ${sportBout.revision} + 1 ELSE ${sportBout.revision} END`,
          revisedAt: sql`CASE WHEN ${sportBout.contentHash} <> excluded.content_hash THEN ${DB_NOW} ELSE ${sportBout.revisedAt} END`,
          contentHash: sql`excluded.content_hash`,
        },
        setWhere: sql`${sportBout.contentHash} <> excluded.content_hash OR (${sportBout.fencerAPersonId} IS NULL AND excluded.fencer_a_person_id IS NOT NULL) OR (${sportBout.fencerBPersonId} IS NULL AND excluded.fencer_b_person_id IS NOT NULL)`,
      })
      .returning({ id: sportBout.id }));
  }
  for (let i = 0; i < queries.length; i += MAX_BATCH_STATEMENTS) {
    const [first, ...rest] = queries.slice(i, i + MAX_BATCH_STATEMENTS);
    devueltas.push(...(await db.batch([first, ...rest])).flat());
  }
  return resumir(filas.length, devueltas, idsNuevos);
}

export type FilaCoberturaGenerica = {
  season: string;
  factKind: string;
  competitionKey: string;
  competitionId: string | null;
  status: 'pendiente' | 'completo' | 'parcial' | 'sin_resultados' | 'error' | 'conflicto';
  /** `undefined` = no tocar la cifra anterior (lectura fallida). */
  publishedTotal?: number | null;
  importedTotal?: number;
  sourceUrl: string | null;
  lastError: string | null;
  /** Estado fino que el enum no distingue (p. ej. «solo_enlace»). `undefined` = no tocar. */
  cursor?: string | null;
  /**
   * Aplazamiento que no es una lectura (el presupuesto del lote cortó la fase): no suma un
   * intento ni mueve la última comprobación, así que nunca agota la unidad.
   */
  sinIntento?: boolean;
};

/** Cobertura por fuente/temporada/tipo/prueba; una lectura fallida no pisa las cifras. */
export async function escribirCobertura(
  db: Db,
  source: string,
  f: FilaCoberturaGenerica,
): Promise<void> {
  if (f.status === 'sin_resultados') {
    const [published] = await db.select({ id: sportImportCoverage.id }).from(sportImportCoverage).where(and(
      eq(sportImportCoverage.source, source), eq(sportImportCoverage.season, f.season),
      eq(sportImportCoverage.factKind, f.factKind), eq(sportImportCoverage.competitionKey, f.competitionKey),
      sql`${sportImportCoverage.importedTotal} > 0`,
    )).limit(1);
    if (published) f = { ...f, status: 'conflicto', publishedTotal: undefined, importedTotal: undefined,
      lastError: 'empty_after_published_results' };
  }
  const conservarCifras = f.publishedTotal === undefined;
  await db
    .insert(sportImportCoverage)
    .values({
      source,
      season: f.season,
      factKind: f.factKind,
      competitionKey: f.competitionKey,
      competitionId: f.competitionId,
      status: f.status,
      publishedTotal: f.publishedTotal ?? null,
      importedTotal: f.importedTotal ?? 0,
      attempts: f.sinIntento ? 0 : 1,
      sourceUrl: f.sourceUrl,
      cursor: f.cursor ?? null,
      lastCheckedAt: f.sinIntento ? null : DB_NOW,
      lastError: f.lastError,
    })
    .onConflictDoUpdate({
      target: [
        sportImportCoverage.source,
        sportImportCoverage.season,
        sportImportCoverage.factKind,
        sportImportCoverage.competitionKey,
      ],
      set: {
        competitionId: sql`coalesce(excluded.competition_id, ${sportImportCoverage.competitionId})`,
        status: sql`excluded.status`,
        ...(conservarCifras
          ? {}
          : {
              publishedTotal: sql`excluded.published_total`,
              importedTotal: sql`excluded.imported_total`,
            }),
        ...(f.sinIntento
          ? {}
          : { attempts: sql`${sportImportCoverage.attempts} + 1`, lastCheckedAt: DB_NOW }),
        sourceUrl: sql`excluded.source_url`,
        ...(f.cursor === undefined ? {} : { cursor: sql`excluded.cursor` }),
        lastError: sql`excluded.last_error`,
        updatedAt: DB_NOW,
      },
    });
}

export function crearDepsPersistenciaFieDb(db: Db): DepsPersistenciaFie {
  return {
    esquema: esquemaD1(db),
    evidencia: evidenciaD1(db),
    guard: crearGuardIdentidadD1(db),

    async upsertPrueba(p) {
      const { clave: tournamentKey, agrupaPruebas } = claveEdicionFie(p);
      const season = String(p.season);
      const [edicion] = await db
        .insert(sportEdition)
        .values({
          source: FUENTE_FIE,
          season,
          tournamentKey,
          name: p.nombre ?? `FIE ${season}/${p.competitionId}`,
          startDate: p.inicio,
          endDate: p.fin,
          city: p.ciudad,
          countryCode: p.federacion,
          sourceUrl: p.url,
        })
        .onConflictDoUpdate({
          target: [sportEdition.source, sportEdition.season, sportEdition.tournamentKey],
          set: {
            name: sql`excluded.name`,
            // Una edición compartida abarca todas sus pruebas: LEAST/GREATEST ignoran NULL.
            startDate: agrupaPruebas
              ? sql`coalesce(min(${sportEdition.startDate}, excluded.start_date), ${sportEdition.startDate}, excluded.start_date)`
              : sql`excluded.start_date`,
            endDate: agrupaPruebas
              ? sql`coalesce(max(${sportEdition.endDate}, excluded.end_date), ${sportEdition.endDate}, excluded.end_date)`
              : sql`excluded.end_date`,
            city: sql`excluded.city`,
            countryCode: sql`excluded.country_code`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: DB_NOW,
          },
        })
        .returning({ id: sportEdition.id });

      const [prueba] = await db
        .insert(sportCompetition)
        .values({
          editionId: edicion.id,
          source: FUENTE_FIE,
          season,
          competitionKey: String(p.competitionId),
          weapon: p.arma,
          gender: p.genero,
          category: p.categoria,
          categoryRaw: p.categoriaOriginal,
          format: p.formato,
          competitionDate: p.fecha,
          sourceUrl: p.url,
        })
        .onConflictDoUpdate({
          target: [sportCompetition.source, sportCompetition.season, sportCompetition.competitionKey],
          set: {
            editionId: sql`excluded.edition_id`,
            weapon: sql`excluded.weapon`,
            gender: sql`excluded.gender`,
            category: sql`excluded.category`,
            categoryRaw: sql`excluded.category_raw`,
            format: sql`excluded.format`,
            competitionDate: sql`excluded.competition_date`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: DB_NOW,
          },
        })
        .returning({ id: sportCompetition.id });
      return prueba.id;
    },

    upsertResultados: (competitionId, filas: FilaResultado[]) =>
      escribirResultados(db, FUENTE_FIE, competitionId, filas),

    upsertAsaltos: (competitionId, filas: FilaAsalto[]) =>
      escribirAsaltos(db, FUENTE_FIE, competitionId, filas),

    upsertCobertura: (f) => escribirCobertura(db, FUENTE_FIE, f),

    async contarResultados(competitionId) {
      const [fila] = await db
        .select({
          total: sql<number>`count(*)`,
          sinPersona: sql<number>`count(*) filter (where ${sportResult.personId} is null)`,
        })
        .from(sportResult)
        .where(and(eq(sportResult.competitionId, competitionId), eq(sportResult.source, FUENTE_FIE)));
      return { total: fila?.total ?? 0, sinPersona: fila?.sinPersona ?? 0 };
    },
  };
}
