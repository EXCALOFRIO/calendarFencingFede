import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import {
  sportBout,
  sportCompetition,
  sportEdition,
  sportImportCoverage,
  sportResult,
} from '@/db/schema';
import { depsEvidenciaDb } from '@/lib/entries/evidencia-db';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import { crearGuardDb } from '@/lib/sport/id-guard-db';
import {
  FUENTE_FIE,
  type DepsPersistenciaFie,
  type FilaAsalto,
  type FilaResultado,
  type ResumenEscritura,
} from './fie-resultados-persist';

/**
 * Implementación Neon de la persistencia de resultados FIE.
 *
 * Todo es `INSERT … ON CONFLICT` sobre la clave natural del hecho, así que
 * repetir una lectura no duplica nada. Sólo se reescribe una fila (y sube su
 * `revision`) si cambió su contenido; una persona recién resuelta sí se
 * incorpora a una fila ya guardada sin tocar su revisión. No hay borrados.
 */

const LOTE = 200;

function lotes<T>(items: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += LOTE) salida.push(items.slice(i, i + LOTE));
  return salida;
}

function resumir(total: number, devueltas: { insertado: boolean }[]): ResumenEscritura {
  const nuevos = devueltas.filter((d) => d.insertado).length;
  return { nuevos, revisados: devueltas.length - nuevos, sinCambios: total - devueltas.length };
}

/** Puestos por clave natural; compartido por todos los adaptadores de resultados. */
export async function escribirResultados(
  db: Db,
  source: string,
  competitionId: string,
  filas: FilaResultado[],
): Promise<ResumenEscritura> {
  const devueltas: { insertado: boolean }[] = [];
  for (const lote of lotes(filas)) {
    const r = await db
      .insert(sportResult)
      .values(lote.map((f) => ({ ...f, competitionId, source })))
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
          revisedAt: sql`CASE WHEN ${sportResult.contentHash} <> excluded.content_hash THEN now() ELSE ${sportResult.revisedAt} END`,
          contentHash: sql`excluded.content_hash`,
        },
        setWhere: sql`${sportResult.contentHash} <> excluded.content_hash OR (${sportResult.personId} IS NULL AND excluded.person_id IS NOT NULL)`,
      })
      .returning({ insertado: sql<boolean>`(xmax = 0)` });
    devueltas.push(...r);
  }
  return resumir(filas.length, devueltas);
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
  sourceUrl: string;
  lastError: string | null;
};

/** Cobertura por fuente/temporada/tipo/prueba; una lectura fallida no pisa las cifras. */
export async function escribirCobertura(
  db: Db,
  source: string,
  f: FilaCoberturaGenerica,
): Promise<void> {
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
      attempts: 1,
      sourceUrl: f.sourceUrl,
      lastCheckedAt: sql`now()`,
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
        attempts: sql`${sportImportCoverage.attempts} + 1`,
        sourceUrl: sql`excluded.source_url`,
        lastCheckedAt: sql`now()`,
        lastError: sql`excluded.last_error`,
        updatedAt: sql`now()`,
      },
    });
}

export function crearDepsPersistenciaFieDb(db: Db): DepsPersistenciaFie {
  return {
    esquema: esquemaDeportivo,
    evidencia: depsEvidenciaDb,
    guard: crearGuardDb(db),

    async upsertPrueba(p) {
      const tournamentKey =
        p.tournamentId !== null ? String(p.tournamentId) : `competition:${p.competitionId}`;
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
            startDate: sql`excluded.start_date`,
            endDate: sql`excluded.end_date`,
            city: sql`excluded.city`,
            countryCode: sql`excluded.country_code`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: sql`now()`,
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
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: sportCompetition.id });
      return prueba.id;
    },

    upsertResultados: (competitionId, filas: FilaResultado[]) =>
      escribirResultados(db, FUENTE_FIE, competitionId, filas),

    async upsertAsaltos(competitionId, filas: FilaAsalto[]) {
      const devueltas: { insertado: boolean }[] = [];
      for (const lote of lotes(filas)) {
        const r = await db
          .insert(sportBout)
          .values(lote.map((f) => ({ ...f, competitionId, source: FUENTE_FIE })))
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
              revisedAt: sql`CASE WHEN ${sportBout.contentHash} <> excluded.content_hash THEN now() ELSE ${sportBout.revisedAt} END`,
              contentHash: sql`excluded.content_hash`,
            },
            setWhere: sql`${sportBout.contentHash} <> excluded.content_hash OR (${sportBout.fencerAPersonId} IS NULL AND excluded.fencer_a_person_id IS NOT NULL) OR (${sportBout.fencerBPersonId} IS NULL AND excluded.fencer_b_person_id IS NOT NULL)`,
          })
          .returning({ insertado: sql<boolean>`(xmax = 0)` });
        devueltas.push(...r);
      }
      return resumir(filas.length, devueltas);
    },

    upsertCobertura: (f) => escribirCobertura(db, FUENTE_FIE, f),
  };
}
