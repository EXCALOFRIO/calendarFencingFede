import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import {
  officialRankingEntry,
  sportImportCoverage,
  sportRankingEntry,
  sportRankingPublication,
} from '@/db/schema';
import { depsEvidenciaDb } from '@/lib/entries/evidencia-db';
import { categoriasHistoricasAplicadas, esquemaDeportivo } from '@/lib/sport/esquema-db';
import { escribirCobertura } from './fie-resultados-db';
import {
  mismaLista,
  type DepsPersistenciaRanking,
  type FilaEntradaRanking,
  type ResultadoEscrituraRanking,
} from './ranking-oficial-persist';
import type { PublicacionRanking } from './sources/ranking-oficial-historico';

/**
 * Implementación Neon de la persistencia de rankings oficiales por temporada.
 *
 * El driver HTTP no ofrece transacciones interactivas, así que una publicación
 * nueva se escribe en dos pasos (cabecera, entradas) y, si el segundo falla,
 * se borra la cabecera recién creada (las entradas caen en cascada) antes de
 * propagar el error: nunca queda una lista a medias como «la última».
 */

const LOTE = 500;

function lotes<T>(items: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += LOTE) salida.push(items.slice(i, i + LOTE));
  return salida;
}

const claveLista = (p: PublicacionRanking) =>
  and(
    eq(sportRankingPublication.source, p.fuente),
    eq(sportRankingPublication.season, p.season),
    eq(sportRankingPublication.weapon, p.arma),
    eq(sportRankingPublication.gender, p.genero),
    eq(sportRankingPublication.categoryRaw, p.categoriaOriginal),
    eq(sportRankingPublication.format, p.formato),
  );

export async function escribirPublicacion(
  db: Db,
  p: PublicacionRanking,
  filas: FilaEntradaRanking[],
): Promise<ResultadoEscrituraRanking> {
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

    if (mismaLista(guardadas, filas)) {
      // Misma lista que la última de esta temporada: no hay publicación nueva.
      // Sólo se incorpora una persona que antes no estaba confirmada.
      const conPersona = filas.filter((f) => f.personId !== null);
      let incorporadas = 0;
      for (const f of conPersona) {
        const r = await db
          .update(sportRankingEntry)
          .set({ personId: f.personId })
          .where(
            and(
              eq(sportRankingEntry.publicationId, ultima.id),
              eq(sportRankingEntry.sourceRef, f.sourceRef),
              isNull(sportRankingEntry.personId),
            ),
          )
          .returning({ id: sportRankingEntry.id });
        incorporadas += r.length;
      }
      return { estado: 'sin_cambios', publicationId: ultima.id, personasIncorporadas: incorporadas };
    }

    if (ultima.publishedOn === p.publicadoEl) {
      // Corrección el mismo día: la lista de ese día se sustituye, sin tocar
      // las de otros días.
      await db
        .update(sportRankingPublication)
        .set({ publishedTotal: p.total, sourceUrl: p.url, fetchedAt: sql`now()` })
        .where(eq(sportRankingPublication.id, ultima.id));
      await escribirEntradas(db, ultima.id, filas);
      await db
        .delete(sportRankingEntry)
        .where(
          and(
            eq(sportRankingEntry.publicationId, ultima.id),
            notInArray(
              sportRankingEntry.sourceRef,
              filas.map((f) => f.sourceRef),
            ),
          ),
        );
      return { estado: 'creada', publicationId: ultima.id, personasIncorporadas: 0 };
    }
  }

  const [nueva] = await db
    .insert(sportRankingPublication)
    .values({
      source: p.fuente,
      season: p.season,
      weapon: p.arma,
      gender: p.genero,
      category: p.categoria,
      categoryRaw: p.categoriaOriginal,
      format: p.formato,
      publishedOn: p.publicadoEl,
      sourceUrl: p.url,
      publishedTotal: p.total,
    })
    .returning({ id: sportRankingPublication.id });

  try {
    await escribirEntradas(db, nueva.id, filas);
  } catch (error) {
    await db.delete(sportRankingPublication).where(eq(sportRankingPublication.id, nueva.id));
    throw error;
  }
  return { estado: 'creada', publicationId: nueva.id, personasIncorporadas: 0 };
}

async function escribirEntradas(db: Db, publicationId: string, filas: FilaEntradaRanking[]) {
  for (const lote of lotes(filas)) {
    await db
      .insert(sportRankingEntry)
      .values(
        lote.map((f) => ({
          publicationId,
          sourceRef: f.sourceRef,
          personId: f.personId,
          sourceName: f.sourceName,
          countryCode: f.countryCode,
          position: f.position,
          points: f.points,
        })),
      )
      .onConflictDoUpdate({
        target: [sportRankingEntry.publicationId, sportRankingEntry.sourceRef],
        set: {
          personId: sql`coalesce(excluded.person_id, ${sportRankingEntry.personId})`,
          sourceName: sql`excluded.source_name`,
          countryCode: sql`excluded.country_code`,
          position: sql`excluded.position`,
          points: sql`excluded.points`,
        },
      });
  }
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
    esquema: esquemaDeportivo,
    categoriasHistoricas: categoriasHistoricasAplicadas,
    evidencia: depsEvidenciaDb,
    licenciasRfee: (season, ids) => licenciasRfee(db, season, ids),
    escribirPublicacion: (p, filas) => escribirPublicacion(db, p, filas),
    upsertCobertura: (f) => escribirCobertura(db, f.source, f),
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
