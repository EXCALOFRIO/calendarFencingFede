import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportBout, sportCompetition, sportEdition, sportImportCoverage, sportResult } from '@/db/schema';
import { categoriasHistoricasAplicadas, esquemaDeportivo } from '@/lib/sport/esquema-db';
import { escribirAsaltos, escribirCobertura, escribirResultados } from '../fie-resultados-db';
import { FUENTE_PDF, type DepsPersistenciaPdf } from './pdf-persist';

/**
 * Implementación Neon de la persistencia de PDFs. Sólo guarda hechos y el
 * checkpoint (URL, SHA-256, motivos): nunca el binario. Reutiliza los
 * escritores de resultados, asaltos y cobertura compartidos; el único borrado
 * es el de `reconciliar`, acotado al documento.
 */

const LOTE_BORRADO = 200;

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
          name: p.edicion.nombre,
          startDate: p.edicion.inicio,
          endDate: p.edicion.fin,
          sourceUrl: p.edicion.url,
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

    /**
     * `sport_result` y `sport_bout` no tienen estado «vigente», así que retirar
     * un hecho es borrarlo. El alcance es sólo `rfee_pdf` y las competiciones
     * `pdf:<docId>:*` de la temporada; se borra por id tras leer las claves, en
     * lotes, y el llamador sólo lo pide con una lectura fiable.
     */
    async reconciliar({ season, docId, vigentes }) {
      const prefijo = `pdf:${docId}:`;
      const pruebas = await db
        .select({ id: sportCompetition.id, competitionKey: sportCompetition.competitionKey })
        .from(sportCompetition)
        .where(
          and(
            eq(sportCompetition.source, FUENTE_PDF),
            eq(sportCompetition.season, season),
            sql`starts_with(${sportCompetition.competitionKey}, ${prefijo})`,
          ),
        );
      const vigentePorId = new Map(vigentes.map((v) => [v.competitionId, v]));
      const claveAsalto = (k: { phase: string; roundKey: string; fencerARef: string; fencerBRef: string }) =>
        JSON.stringify([k.phase, k.roundKey, k.fencerARef, k.fencerBRef]);

      let puestosRetirados = 0;
      let asaltosRetirados = 0;
      const pruebasRetiradas: { competitionKey: string; competitionId: string }[] = [];

      for (const prueba of pruebas) {
        const vigente = vigentePorId.get(prueba.id);
        if (!vigente) pruebasRetiradas.push({ competitionKey: prueba.competitionKey, competitionId: prueba.id });

        const puestos = await db
          .select({ id: sportResult.id, clave: sportResult.sourceFactKey })
          .from(sportResult)
          .where(and(eq(sportResult.competitionId, prueba.id), eq(sportResult.source, FUENTE_PDF)));
        const claves = new Set(vigente?.resultados ?? []);
        const sobrantes = puestos.filter((f) => !claves.has(f.clave)).map((f) => f.id);
        for (let i = 0; i < sobrantes.length; i += LOTE_BORRADO) {
          await db.delete(sportResult).where(inArray(sportResult.id, sobrantes.slice(i, i + LOTE_BORRADO)));
        }
        puestosRetirados += sobrantes.length;

        const asaltos = await db
          .select({
            id: sportBout.id,
            phase: sportBout.phase,
            roundKey: sportBout.roundKey,
            fencerARef: sportBout.fencerARef,
            fencerBRef: sportBout.fencerBRef,
          })
          .from(sportBout)
          .where(and(eq(sportBout.competitionId, prueba.id), eq(sportBout.source, FUENTE_PDF)));
        const clavesAsalto = new Set((vigente?.asaltos ?? []).map(claveAsalto));
        const sobrantesAsalto = asaltos.filter((a) => !clavesAsalto.has(claveAsalto(a))).map((a) => a.id);
        for (let i = 0; i < sobrantesAsalto.length; i += LOTE_BORRADO) {
          await db.delete(sportBout).where(inArray(sportBout.id, sobrantesAsalto.slice(i, i + LOTE_BORRADO)));
        }
        asaltosRetirados += sobrantesAsalto.length;
      }
      return { puestosRetirados, asaltosRetirados, pruebasRetiradas };
    },
  };
}
