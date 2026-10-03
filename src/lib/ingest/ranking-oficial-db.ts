import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '@/db';
import {
  officialRankingEntry,
  sportImportCoverage,
  sportRankingEntry,
  sportRankingPublication,
} from '@/db/schema';
import { categoriasD1, evidenciaD1, esquemaD1 } from './backfill/identidad-db';
import { DB_NOW, MAX_BATCH_STATEMENTS } from './sport-incremental/lease';
import { escribirCobertura } from './fie-resultados-db';
import {
  mismaLista,
  type DepsPersistenciaRanking,
  type FilaEntradaRanking,
  type ResultadoEscrituraRanking,
} from './ranking-oficial-persist';
import type { PublicacionRanking } from './sources/ranking-oficial-historico';

/**
 * Implementación D1 de la persistencia de rankings oficiales por temporada.
 *
 * El driver HTTP no ofrece transacciones interactivas, pero `db.batch` envía
 * todas las sentencias en una única transacción no interactiva. Una publicación
 * nueva (cabecera + todas las entradas) o la corrección de la de un mismo día
 * (cabecera + entradas + retirada de las que ya no están) se confirma o se
 * revierte entera: un fallo no deja una cabecera vacía ni una lista mezclada.
 * El identificador de la publicación se decide antes de construir el lote, así
 * que ninguna sentencia depende del resultado de otra.
 */

// Eight columns including the UUID client default: 11 rows <= 88 binds.
const LOTE = 11;
// A complete correction is ONE atomic D1 batch; never split a publication.
export const MAX_RANKING_ENTRIES_D1 = (MAX_BATCH_STATEMENTS - 2) * LOTE;

function lotes<T>(items: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += LOTE) salida.push(items.slice(i, i + LOTE));
  return salida;
}

type Lote = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

const claveLista = (p: PublicacionRanking) =>
  and(
    eq(sportRankingPublication.source, p.fuente),
    eq(sportRankingPublication.season, p.season),
    eq(sportRankingPublication.weapon, p.arma),
    eq(sportRankingPublication.gender, p.genero),
    eq(sportRankingPublication.categoryRaw, p.categoriaOriginal),
    eq(sportRankingPublication.format, p.formato),
  );

function valoresEntradas(publicationId: string, filas: readonly FilaEntradaRanking[]) {
  return lotes(filas).map((lote) =>
    lote.map((f) => ({
      publicationId,
      sourceRef: f.sourceRef,
      personId: f.personId,
      sourceName: f.sourceName,
      countryCode: f.countryCode,
      position: f.position,
      points: f.points,
    })),
  );
}

/** Publicación nueva: cabecera y todas las entradas, en este orden, en una transacción. */
function lotePublicacionNueva(
  db: Db,
  id: string,
  p: PublicacionRanking,
  filas: readonly FilaEntradaRanking[],
): Lote {
  return [
    db.insert(sportRankingPublication).values({
      id,
      source: p.fuente,
      season: p.season,
      weapon: p.arma,
      gender: p.genero,
      category: p.categoria,
      categoryRaw: p.categoriaOriginal,
      format: p.formato,
      publishedOn: p.publicadoEl,
      dateBasis: 'observed',
      sourceUrl: p.url,
      publishedTotal: p.total,
    }),
    ...valoresEntradas(id, filas).map((valores) => db.insert(sportRankingEntry).values(valores)),
  ];
}

/**
 * Corrección del mismo día: cabecera, entradas de la nueva lista y retirada de
 * las que ya no figuran, sólo de esta publicación, en una transacción.
 */
function loteCorreccion(
  db: Db,
  id: string,
  p: PublicacionRanking,
  filas: readonly FilaEntradaRanking[],
): Lote {
  return [
    db
      .update(sportRankingPublication)
      .set({ publishedTotal: p.total, sourceUrl: p.url, fetchedAt: DB_NOW,
        revision: sql`${sportRankingPublication.revision} + 1` })
      .where(eq(sportRankingPublication.id, id)),
    ...valoresEntradas(id, filas).map((valores) =>
      db
        .insert(sportRankingEntry)
        .values(valores)
        .onConflictDoUpdate({
          target: [sportRankingEntry.publicationId, sportRankingEntry.sourceRef],
          set: {
            personId: sql`coalesce(excluded.person_id, ${sportRankingEntry.personId})`,
            sourceName: sql`excluded.source_name`,
            countryCode: sql`excluded.country_code`,
            position: sql`excluded.position`,
            points: sql`excluded.points`,
          },
        }),
    ),
    db.delete(sportRankingEntry).where(
      and(
        eq(sportRankingEntry.publicationId, id),
        sql`${sportRankingEntry.sourceRef} not in
          (select value from json_each(${JSON.stringify(filas.map((f) => f.sourceRef))}))`,
      ),
    ),
  ];
}

export async function escribirPublicacion(
  db: Db,
  p: PublicacionRanking,
  filas: FilaEntradaRanking[],
  nuevoId: string = randomUUID(),
): Promise<ResultadoEscrituraRanking> {
  if (!['skermo_ranking', 'fie_tiradores'].includes(p.fuente) ||
    filas.length > MAX_RANKING_ENTRIES_D1 || new Set(filas.map((f) => f.sourceRef)).size !== filas.length) {
    throw new Error('sport_ranking_shape_invalid');
  }
  const [ultima] = await db
    .select({ id: sportRankingPublication.id, publishedOn: sportRankingPublication.publishedOn })
    .from(sportRankingPublication)
    .where(claveLista(p))
    .orderBy(desc(sportRankingPublication.publishedOn), desc(sportRankingPublication.fetchedAt))
    .limit(1);

  if (ultima) {
    const guardadas = await db
      .select({
        sourceRef: sportRankingEntry.sourceRef,
        personId: sportRankingEntry.personId,
        sourceName: sportRankingEntry.sourceName,
        countryCode: sportRankingEntry.countryCode,
        position: sportRankingEntry.position,
        points: sportRankingEntry.points,
      })
      .from(sportRankingEntry)
      .where(eq(sportRankingEntry.publicationId, ultima.id));

    if (guardadas.length > 0 && filas.length === 0) throw new Error('sport_empty_after_published');
    if (mismaLista(guardadas, filas)) {
      // Misma lista que la última de esta temporada: no hay publicación nueva.
      // Sólo se incorpora una persona que antes no estaba confirmada.
      const incorporaciones = filas
        .filter((f) => f.personId !== null)
        .map((f) =>
          db
            .update(sportRankingEntry)
            .set({ personId: f.personId })
            .where(
              and(
                eq(sportRankingEntry.publicationId, ultima.id),
                eq(sportRankingEntry.sourceRef, f.sourceRef),
                isNull(sportRankingEntry.personId),
              ),
            )
            .returning({ id: sportRankingEntry.id }),
        );
      let incorporadas = 0;
      if (incorporaciones.length > 0) {
        for (let i = 0; i < incorporaciones.length; i += MAX_BATCH_STATEMENTS) {
          const [primera, ...resto] = incorporaciones.slice(i, i + MAX_BATCH_STATEMENTS);
          const resultados = await db.batch([primera, ...resto]);
          incorporadas += resultados.reduce((suma, r) => suma + r.length, 0);
        }
      }
      return { estado: 'sin_cambios', publicationId: ultima.id, personasIncorporadas: incorporadas };
    }

  }

  const [mismoDia] = await db.select({ id: sportRankingPublication.id, dateBasis: sportRankingPublication.dateBasis })
    .from(sportRankingPublication).where(and(claveLista(p), eq(sportRankingPublication.publishedOn, p.publicadoEl))).limit(1);
  if (mismoDia) {
    if (mismoDia.dateBasis !== 'observed') throw new Error('sport_ranking_date_basis_conflict');
    await db.batch(loteCorreccion(db, mismoDia.id, p, filas));
    return { estado: 'creada', publicationId: mismoDia.id, personasIncorporadas: 0 };
  }
  await db.batch(lotePublicacionNueva(db, nuevoId, p, filas));
  return { estado: 'creada', publicationId: nuevoId, personasIncorporadas: 0 };
}

/**
 * Licencias RFEE que Skermo publicó, en esa misma temporada, para cada ID de
 * ranking (tabla del ranking anterior, sólo lectura). Una licencia de otra
 * temporada no sirve: se reutilizan entre personas.
 */
async function licenciasRfee(
  db: Db,
  season: string,
  skermoIds: string[],
): Promise<ReadonlyMap<string, string>> {
  const salida = new Map<string, string>();
  for (const lote of lotes(skermoIds)) {
    if (lote.length === 0) continue;
    const filas = await db
      .selectDistinct({
        skermoAthleteId: officialRankingEntry.skermoAthleteId,
        sourceLicense: officialRankingEntry.sourceLicense,
      })
      .from(officialRankingEntry)
      .where(
        and(
          eq(officialRankingEntry.seasonLabel, season),
          inArray(officialRankingEntry.skermoAthleteId, lote),
          sql`${officialRankingEntry.sourceLicense} is not null`,
        ),
      );
    // Un ID con dos licencias distintas en la temporada es contradicción: ninguna.
    const vistas = new Map<string, Set<string>>();
    for (const f of filas) {
      if (!f.skermoAthleteId || !f.sourceLicense) continue;
      vistas.set(f.skermoAthleteId, (vistas.get(f.skermoAthleteId) ?? new Set()).add(f.sourceLicense));
    }
    for (const [id, set] of vistas) if (set.size === 1) salida.set(id, [...set][0]);
  }
  return salida;
}

export function crearDepsPersistenciaRankingDb(db: Db): DepsPersistenciaRanking {
  return {
    esquema: esquemaD1(db),
    categoriasHistoricas: categoriasD1(db),
    evidencia: evidenciaD1(db),
    licenciasRfee: (season, ids) => licenciasRfee(db, season, ids),
    escribirPublicacion: (p, filas) => escribirPublicacion(db, p, filas),
    async upsertCobertura(f) {
      if (f.status === 'sin_resultados') {
        const [previous] = await db.select({ id: sportImportCoverage.id })
          .from(sportImportCoverage).where(and(
            eq(sportImportCoverage.source, f.source), eq(sportImportCoverage.season, f.season),
            eq(sportImportCoverage.factKind, f.factKind), eq(sportImportCoverage.competitionKey, f.competitionKey),
            sql`${sportImportCoverage.importedTotal}>0`,
          )).limit(1);
        if (previous) {
          await escribirCobertura(db, f.source, { ...f, status: 'conflicto', publishedTotal: undefined,
            importedTotal: undefined, lastError: 'empty_after_published_results' });
          return 'conflicto';
        }
      }
      await escribirCobertura(db, f.source, f);
      return f.status;
    },
  };
}

/** Listas de ranking ya cerradas (completas o publicadas sin filas) de una fuente y temporada. */
export async function clavesRankingLeidas(
  db: Db,
  source: string,
  season: string,
): Promise<Set<string>> {
  const filas = await db
    .select({ clave: sportImportCoverage.competitionKey })
    .from(sportImportCoverage)
    .where(
      and(
        eq(sportImportCoverage.source, source),
        eq(sportImportCoverage.season, season),
        eq(sportImportCoverage.factKind, 'ranking'),
        inArray(sportImportCoverage.status, ['completo', 'sin_resultados']),
      ),
    );
  return new Set(filas.map((f) => f.clave));
}
