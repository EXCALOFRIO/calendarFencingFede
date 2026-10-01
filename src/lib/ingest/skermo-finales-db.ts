import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportCompetition, sportEdition } from '@/db/schema';
import { depsEvidenciaDb } from '@/lib/entries/evidencia-db';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import { crearGuardDb } from '@/lib/sport/id-guard-db';
import { escribirCobertura, escribirResultados } from './fie-resultados-db';
import type { DepsPersistenciaSkermo } from './skermo-finales-persist';

/**
 * Implementación Neon de la persistencia de puestos finales de Skermo. Reutiliza
 * los escritores de resultados y cobertura de la FIE (misma clave natural y
 * mismas reglas de revisión) y el guard de IDs compartido. No hay borrados.
 */
export function crearDepsPersistenciaSkermoDb(db: Db): DepsPersistenciaSkermo {
  return {
    esquema: esquemaDeportivo,
    evidencia: depsEvidenciaDb,
    guard: crearGuardDb(db),

    async upsertPrueba(p) {
      // Skermo no tiene entidad de torneo en el índice de resultados: cada
      // prueba es su propia edición, igual que una prueba FIE sin tournamentId.
      const [edicion] = await db
        .insert(sportEdition)
        .values({
          source: p.fuente,
          season: p.season,
          tournamentKey: `competition:${p.competitionKey}`,
          name: p.nombre,
          startDate: p.fecha,
          endDate: p.fecha,
          city: p.ciudad,
          sourceUrl: p.url,
        })
        .onConflictDoUpdate({
          target: [sportEdition.source, sportEdition.season, sportEdition.tournamentKey],
          set: {
            name: sql`excluded.name`,
            startDate: sql`excluded.start_date`,
            endDate: sql`excluded.end_date`,
            city: sql`excluded.city`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: sportEdition.id });

      const [prueba] = await db
        .insert(sportCompetition)
        .values({
          editionId: edicion.id,
          source: p.fuente,
          season: p.season,
          competitionKey: p.competitionKey,
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

    upsertResultados: (source, competitionId, filas) =>
      escribirResultados(db, source, competitionId, filas),

    upsertCobertura: (f) => escribirCobertura(db, f.source, f),
  };
}
