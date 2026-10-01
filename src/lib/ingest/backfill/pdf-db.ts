import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportCompetition, sportEdition, sportImportCoverage } from '@/db/schema';
import { categoriasHistoricasAplicadas, esquemaDeportivo } from '@/lib/sport/esquema-db';
import { escribirAsaltos, escribirCobertura, escribirResultados } from '../fie-resultados-db';
import { FUENTE_PDF, type DepsPersistenciaPdf } from './pdf-persist';

/**
 * Implementación Neon de la persistencia de PDFs. Sólo guarda hechos y el
 * checkpoint (URL, SHA-256, motivos): nunca el binario. Reutiliza los
 * escritores de resultados, asaltos y cobertura compartidos, sin borrados.
 */
export function crearDepsPersistenciaPdfDb(db: Db): DepsPersistenciaPdf {
  return {
    esquema: esquemaDeportivo,
    categoriasHistoricas: categoriasHistoricasAplicadas,

    async leerCheckpoint(season, docKey) {
      const [fila] = await db
        .select({
          status: sportImportCoverage.status,
          cursor: sportImportCoverage.cursor,
          lastError: sportImportCoverage.lastError,
        })
        .from(sportImportCoverage)
        .where(
          and(
            eq(sportImportCoverage.source, FUENTE_PDF),
            eq(sportImportCoverage.season, season),
            eq(sportImportCoverage.factKind, 'pdf'),
            eq(sportImportCoverage.competitionKey, docKey),
          ),
        )
        .limit(1);
      return fila ?? null;
    },

    async upsertPrueba(p) {
      const [edicion] = await db
        .insert(sportEdition)
        .values({
          source: FUENTE_PDF,
          season: p.season,
          tournamentKey: p.edicionKey,
          name: p.nombre,
          startDate: p.fecha,
          endDate: p.fecha,
          sourceUrl: p.url,
        })
        .onConflictDoUpdate({
          target: [sportEdition.source, sportEdition.season, sportEdition.tournamentKey],
          set: {
            name: sql`excluded.name`,
            startDate: sql`excluded.start_date`,
            endDate: sql`excluded.end_date`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: sportEdition.id });

      const [prueba] = await db
        .insert(sportCompetition)
        .values({
          editionId: edicion.id,
          source: FUENTE_PDF,
          season: p.season,
          competitionKey: p.competitionKey,
          weapon: p.arma,
          gender: p.genero,
          category: p.categoria as typeof sportCompetition.$inferInsert.category,
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

    upsertResultados: (competitionId, filas) => escribirResultados(db, FUENTE_PDF, competitionId, filas),
    upsertAsaltos: (competitionId, filas) => escribirAsaltos(db, FUENTE_PDF, competitionId, filas),
    upsertCobertura: (f) => escribirCobertura(db, FUENTE_PDF, f),
  };
}
