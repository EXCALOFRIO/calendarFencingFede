import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportBout, sportCompetition, sportEdition, sportImportCoverage, sportResult } from '@/db/schema';
import { categoriasD1, esquemaD1 } from './identidad-db';
import { DB_NOW } from '../sport-incremental/lease';
import { escribirAsaltos, escribirCobertura, escribirResultados } from '../fie-resultados-db';
import { FUENTE_PDF, type DepsPersistenciaPdf } from './pdf-persist';
import { docIdLegadoDeUrl } from '../sources/rfee-pdf/lectura';

/**
 * Implementación D1 de la persistencia de PDFs. Sólo guarda hechos y el
 * checkpoint (URL, SHA-256, motivos): nunca el binario. Reutiliza los
 * escritores de resultados, asaltos y cobertura compartidos; el único borrado
 * es el de `reconciliar`, acotado al documento.
 */

const LOTE_BORRADO = 90;

export function crearDepsPersistenciaPdfDb(db: Db): DepsPersistenciaPdf {
  return {
    esquema: esquemaD1(db),
    categoriasHistoricas: categoriasD1(db),

    async resolverDocumento(season, sourceUrl, suggestedDocId) {
      async function namespace(docId: string) {
        const docKey = `doc:${docId}`, editionKey = `pdf:${docId}`, prefix = `${editionKey}:`;
        const result = await db.execute(sql`
          select count(*) as found, coalesce(sum(case when source_url = ${sourceUrl}
            or substr(source_url,1,length(${sourceUrl})+1) = ${`${sourceUrl}#`} then 0 else 1 end),0) as conflicts
          from (
            select ${sportImportCoverage.sourceUrl} as source_url from ${sportImportCoverage}
              where ${sportImportCoverage.source} = ${FUENTE_PDF} and ${sportImportCoverage.season} = ${season}
                and ${sportImportCoverage.factKind} = 'pdf' and ${sportImportCoverage.competitionKey} = ${docKey}
            union all
            select ${sportCompetition.sourceUrl} as source_url from ${sportCompetition}
              where ${sportCompetition.source} = ${FUENTE_PDF} and ${sportCompetition.season} = ${season}
                and substr(${sportCompetition.competitionKey},1,length(${prefix})) = ${prefix}
            union all
            select ${sportEdition.sourceUrl} as source_url from ${sportEdition}
              where ${sportEdition.source} = ${FUENTE_PDF} and ${sportEdition.season} = ${season}
                and ${sportEdition.tournamentKey} = ${editionKey}
          )`);
        return result.rows[0] as { found: number; conflicts: number };
      }
      const current = await namespace(suggestedDocId);
      if (Number(current.conflicts) > 0) throw new Error('pdf_document_namespace_conflict');
      if (Number(current.found) > 0) return suggestedDocId;
      const legacyDocId = docIdLegadoDeUrl(sourceUrl);
      if (legacyDocId !== suggestedDocId) {
        const legacy = await namespace(legacyDocId);
        // A filename collision is not evidence of ownership. Leave those rows
        // untouched and assign this new document its full-URL namespace.
        if (Number(legacy.found) > 0 && Number(legacy.conflicts) === 0) return legacyDocId;
      }
      return suggestedDocId;
    },

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
            updatedAt: DB_NOW,
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
            updatedAt: DB_NOW,
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
            sql`substr(${sportCompetition.competitionKey},1,length(${prefijo})) = ${prefijo}`,
          ),
        );
      const vigentePorId = new Map(vigentes.map((v) => [v.competitionId, v]));
      // Validate every exact competition before deleting ANY fact. An empty
      // corrected list after published facts is a conflict, not a retirement.
      for (const p of pruebas) {
        const v = vigentePorId.get(p.id);
        if (!v) continue;
        for (const [table, empty] of [[sportResult, !v.resultados.length], [sportBout, !v.asaltos.length]] as const) {
          if (!empty) continue;
          const [old] = await db.select({ id: table.id }).from(table)
            .where(and(eq(table.competitionId, p.id), eq(table.source, FUENTE_PDF))).limit(1);
          if (old) throw new Error('sport_empty_after_published');
        }
      }
      const claveAsalto = (k: { phase: string; roundKey: string; fencerARef: string; fencerBRef: string }) =>
        JSON.stringify([k.phase, k.roundKey, k.fencerARef, k.fencerBRef]);

      let puestosRetirados = 0;
      let asaltosRetirados = 0;
      const pruebasRetiradas: { competitionKey: string; competitionId: string }[] = [];

      for (const prueba of pruebas) {
        const vigente = vigentePorId.get(prueba.id);
        // An absent competition was not read exactly. Never retire its facts
        // merely because a corrected document/index stopped mentioning it.
        if (!vigente) continue;

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
