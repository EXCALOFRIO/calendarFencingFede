import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { documentoVigencia, officialDocument } from '@/db/schema';
import {
  type DocumentoParaVigencia,
  type VigenciaCalculada,
  calcularVigencia,
  resumirVigencia,
} from './vigencia';

/**
 * Recalcula la vigencia de TODAS las circulares y la guarda.
 *
 * COSTE: DOS VIAJES DE RED, NO 278
 * --------------------------------
 * El driver de Neon habla por HTTP, así que cada consulta es un viaje. El
 * comentario de los 116 segundos de `src/lib/ingest/upsert.ts` cuenta lo que
 * pasa si esto se hace ingenuamente: un SELECT por documento y otro por
 * versión serían más de quinientos viajes.
 *
 * Aquí es una sola lectura (las 278 filas, cinco columnas cortas), el cálculo
 * ENTERO en memoria —`calcularVigencia` es una función pura— y la escritura en
 * tandas de 200 con `ON CONFLICT`. Medido sobre las 278 filas reales: 4
 * consultas en total y menos de un segundo.
 *
 * Y NO DESCARGA NI UN BYTE. Esto solo mira títulos y fechas, que ya están en
 * la base. Se puede llamar en cada ingestión de `rfee_wp` sin que cueste nada,
 * que es justo lo que pidió el usuario: «que no vuelva a analizar documento,
 * solo si cambia».
 */
export async function recalcularVigencia(): Promise<{
  total: number;
  familias: number;
  vigentes: number;
  superadas: number;
  canceladas: number;
  duplicadas: number;
  familiasConVarias: number;
  consultas: number;
  duracionMs: number;
}> {
  const t0 = Date.now();
  let consultas = 0;

  // --- 1. Una sola lectura. Solo las columnas que entran en el cálculo ---
  const filas = await db
    .select({
      id: officialDocument.id,
      title: officialDocument.title,
      publishedAt: officialDocument.publishedAt,
      fileHash: officialDocument.fileHash,
      wpMediaId: officialDocument.wpMediaId,
    })
    .from(officialDocument);
  consultas += 1;

  const documentos: DocumentoParaVigencia[] = filas.map((f) => ({
    id: f.id,
    title: f.title,
    publishedAt: f.publishedAt,
    fileHash: f.fileHash,
    wpMediaId: f.wpMediaId,
  }));

  // --- 2. Todo el cálculo en memoria, sin tocar la base ---
  const calculadas = calcularVigencia(documentos);
  const resumen = resumirVigencia(calculadas);

  // --- 3. Escritura en tandas ---
  const ahora = new Date();
  for (const tanda of trocear(calculadas, 200)) {
    await db
      .insert(documentoVigencia)
      .values(tanda.map((v) => aFila(v, ahora)))
      .onConflictDoUpdate({
        target: documentoVigencia.documentoId,
        set: {
          familia: sql`excluded.familia`,
          asunto: sql`excluded.asunto`,
          temporada: sql`excluded.temporada`,
          temporadaInferida: sql`excluded.temporada_inferida`,
          numeroCircular: sql`excluded.numero_circular`,
          etiquetaVersion: sql`excluded.etiqueta_version`,
          ordenVersion: sql`excluded.orden_version`,
          versionesEnFamilia: sql`excluded.versiones_en_familia`,
          estado: sql`excluded.estado`,
          sustituidaPorId: sql`excluded.sustituida_por_id`,
          duplicadoDeId: sql`excluded.duplicado_de_id`,
          motivo: sql`excluded.motivo`,
          calculadoEn: sql`excluded.calculado_en`,
          /**
           * `hash_intentado_en` y `hash_error` NO se pisan: son de la pasada de
           * hashes, no de este cálculo. Si se pusieran a null aquí, recalcular
           * la vigencia borraría la contabilidad de las descargas y la pasada
           * volvería a intentar las URLs que ya se sabe que fallan.
           */
        },
      });
    consultas += 1;
  }

  return { ...resumen, consultas, duracionMs: Date.now() - t0 };
}

function aFila(
  v: VigenciaCalculada,
  ahora: Date,
): typeof documentoVigencia.$inferInsert {
  return {
    documentoId: v.documentoId,
    familia: v.familia,
    asunto: v.asunto,
    temporada: v.temporada,
    temporadaInferida: v.temporadaInferida,
    numeroCircular: v.numeroCircular,
    etiquetaVersion: v.etiquetaVersion,
    ordenVersion: v.ordenVersion,
    versionesEnFamilia: v.versionesEnFamilia,
    estado: v.estado,
    sustituidaPorId: v.sustituidaPorId,
    duplicadoDeId: v.duplicadoDeId,
    motivo: v.motivo,
    calculadoEn: ahora,
  };
}

function trocear<T>(items: T[], tamano: number): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    salida.push(items.slice(i, i + tamano));
  }
  return salida;
}
