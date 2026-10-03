import { and, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { contieneSinMayusculas as ilike, enLista as inArray } from '@/lib/sqlite';
import { db } from '@/db';
import { documentoVigencia, officialDocument } from '@/db/schema';
import type { EstadoVigencia } from './vigencia';

/**
 * Lo que `/documentos` necesita saber de cada circular.
 *
 * `estado` puede venir a null: si la vigencia todavía no se ha calculado, la
 * pantalla enseña la circular tal cual, sin marca. Nunca se rellena con
 * 'vigente' por defecto, porque «no lo he calculado» y «he comprobado que
 * manda» son cosas distintas y la segunda es una afirmación.
 */
export type FilaDocumento = {
  id: string;
  title: string;
  pdfUrl: string;
  publishedAt: Date;
  circularNumber: string | null;
  seasonLabel: string | null;
  mentionsFees: boolean;
  estado: EstadoVigencia | null;
  etiquetaVersion: string | null;
  familia: string | null;
  versionesEnFamilia: number;
  motivo: string | null;
  /**
   * `true` cuando la última vez que se intentó descargar el PDF la web de la
   * RFEE respondió 404.
   *
   * Sale de `documento_vigencia.hash_error`, que se rellenó al calcular los
   * hashes para colapsar duplicados: son **32 de las 278** —22 en vigor y 10
   * superadas— y no es un fallo de esta aplicación, es que esgrima.es enlaza
   * ficheros que ya ha borrado.
   *
   * Importa porque sin este dato el botón de descarga falla en silencio: se
   * toca, se abre una pestaña y sale el 404 de la RFEE. Un botón desactivado
   * que dice por qué es mejor que uno que engaña.
   */
  pdfRoto: boolean;
  /** El documento que manda, cuando este no manda. */
  sustituidaPor: { id: string; title: string; pdfUrl: string; publishedAt: Date } | null;
};

/** Una versión anterior, para colgarla debajo de la que manda. */
export type VersionAnterior = {
  id: string;
  familia: string;
  title: string;
  pdfUrl: string;
  publishedAt: Date;
  estado: EstadoVigencia;
  etiquetaVersion: string | null;
  /** Igual que en `FilaDocumento`: el PDF da 404 en esgrima.es. */
  pdfRoto: boolean;
};

type FilaCruda = {
  id: string;
  title: string;
  pdfUrl: string;
  publishedAt: Date;
  circularNumber: string | null;
  seasonLabel: string | null;
  mentionsFees: boolean;
  estado: string | null;
  etiquetaVersion: string | null;
  familia: string | null;
  versionesEnFamilia: number | null;
  motivo: string | null;
  hashError: string | null;
  mandaId: string | null;
  mandaTitle: string | null;
  mandaPdfUrl: string | null;
  mandaPublishedAt: Date | null;
};

function aFila(f: FilaCruda): FilaDocumento {
  return {
    id: f.id,
    title: f.title,
    pdfUrl: f.pdfUrl,
    publishedAt: f.publishedAt,
    circularNumber: f.circularNumber,
    seasonLabel: f.seasonLabel,
    mentionsFees: f.mentionsFees,
    estado: (f.estado as EstadoVigencia | null) ?? null,
    etiquetaVersion: f.etiquetaVersion,
    familia: f.familia,
    versionesEnFamilia: f.versionesEnFamilia ?? 1,
    motivo: f.motivo,
    /*
      Solo el 404 cuenta como «roto».

      `hash_error` recoge cualquier fallo al descargar, y un tiempo de espera
      agotado o un 503 son problemas de un momento: desactivar el botón por
      eso escondería un PDF que sí está. El 404 es el único que dice que el
      fichero no existe, y es el caso de las 32.
    */
    pdfRoto: /\b404\b/.test(f.hashError ?? ''),
    sustituidaPor:
      f.mandaId && f.mandaTitle && f.mandaPdfUrl && f.mandaPublishedAt
        ? {
            id: f.mandaId,
            title: f.mandaTitle,
            pdfUrl: f.mandaPdfUrl,
            publishedAt: f.mandaPublishedAt,
          }
        : null,
  };
}

export type PantallaDocumentos = {
  filas: FilaDocumento[];
  /** Versiones anteriores agrupadas por familia, listas para pintar debajo. */
  anteriores: Record<string, VersionAnterior[]>;
  /** Cuántas coinciden con el filtro que se está aplicando. */
  total: number;
  /** Cuántas circulares hay en total, sin filtrar. */
  totalAbsoluto: number;
  /** Cuántas no se presentan como vigentes, para poder decirlo en una línea. */
  superadas: number;
  canceladas: number;
  duplicadas: number;
  /**
   * Cuántas circulares tienen el PDF caído en esgrima.es (404), en total.
   *
   * Se dice el número una vez, en su línea, para que quede claro de quién es
   * el fallo: 32 de 278 enlaces que la RFEE publica apuntan a ficheros que ya
   * ha borrado. Sin la cifra, quien se tope con dos botones desactivados
   * pensará que la aplicación está mal cargada.
   */
  conPdfRoto: number;
  /** `true` = la vigencia no está calculada todavía. */
  sinCalcular: boolean;
};

/**
 * Datos de la pantalla de normativa.
 *
 * TRES CONSULTAS, Y NI UNA MÁS
 * ----------------------------
 * El driver de Neon habla por HTTP: cada consulta es un viaje de red. Así que
 * son tres y fijas, independientemente de cuántas circulares se pinten:
 *
 *   1. las filas de la página, con la vigencia y el documento que manda en el
 *      mismo SELECT (dos LEFT JOIN, que no cuestan un viaje);
 *   2. los recuentos, todos en una sola fila con `count(*) FILTER (WHERE …)`;
 *   3. las versiones anteriores de las familias de ESTA página, con un
 *      `IN (...)`. No una consulta por familia, que serían treinta viajes.
 *
 * La tercera se salta entera cuando no hay ninguna familia con más de una
 * versión en la página, que es el caso más común.
 */
export async function datosDeDocumentos(opciones: {
  termino?: string;
  limite: number;
  /** `true` = lista plana con todo, incluidas las superadas y los duplicados. */
  todas: boolean;
}): Promise<PantallaDocumentos> {
  const { termino, limite, todas } = opciones;
  const manda = alias(officialDocument, 'manda');

  const filtroTexto = termino
    ? or(
        ilike(officialDocument.title, `%${termino}%`),
        ilike(officialDocument.circularNumber, `%${termino}%`),
        ilike(officialDocument.seasonLabel, `%${termino}%`),
      )
    : undefined;

  /**
   * Qué entra en la lista principal.
   *
   * Por defecto, lo VIGENTE y lo CANCELADO. Lo cancelado NO se esconde a
   * propósito: no tiene sustituta a la que mandar a nadie, así que si se
   * ocultara, quien la busque no la encontraría y seguiría creyendo que vale.
   * Enseñarla diciendo «cancelada» es lo que resuelve el problema.
   *
   * Lo superado y los duplicados sí se quitan de la lista: cada uno cuelga
   * debajo de la versión que manda, que es donde tiene sentido leerlos.
   *
   * Si se busca, se busca en TODO y en plano: quien teclea «12-23» quiere esa
   * circular, y si está superada lo que necesita es que se le diga.
   */
  const soloLoQueManda =
    todas || termino
      ? undefined
      : or(
          inArray(documentoVigencia.estado, ['vigente', 'cancelada']),
          // Sin fila de vigencia todavía: se enseña igual, sin marca.
          sql`${documentoVigencia.documentoId} is null`,
        );

  const filtro = and(filtroTexto, soloLoQueManda);

  const [crudas, [recuento] = [undefined]] = await Promise.all([
    db
      /**
       * Se enumeran las columnas a mano en vez de `select()` entero: por ahí
       * viajaban hashes, ids de revisión y fechas que esta pantalla no pinta.
       */
      .select({
        id: officialDocument.id,
        title: officialDocument.title,
        pdfUrl: officialDocument.pdfUrl,
        publishedAt: officialDocument.publishedAt,
        circularNumber: officialDocument.circularNumber,
        seasonLabel: officialDocument.seasonLabel,
        mentionsFees: officialDocument.mentionsFees,
        estado: documentoVigencia.estado,
        etiquetaVersion: documentoVigencia.etiquetaVersion,
        familia: documentoVigencia.familia,
        versionesEnFamilia: documentoVigencia.versionesEnFamilia,
        motivo: documentoVigencia.motivo,
        hashError: documentoVigencia.hashError,
        mandaId: manda.id,
        mandaTitle: manda.title,
        mandaPdfUrl: manda.pdfUrl,
        mandaPublishedAt: manda.publishedAt,
      })
      .from(officialDocument)
      .leftJoin(documentoVigencia, eq(documentoVigencia.documentoId, officialDocument.id))
      .leftJoin(
        manda,
        or(
          eq(manda.id, documentoVigencia.sustituidaPorId),
          eq(manda.id, documentoVigencia.duplicadoDeId),
        ),
      )
      .where(filtro)
      .orderBy(desc(officialDocument.publishedAt))
      .limit(limite),

    db
      .select({
        coinciden: sql<number>`count(*) filter (where ${filtro ?? sql`true`})`,
        total: sql<number>`count(*)`,
        superadas: sql<number>`count(*) filter (where ${documentoVigencia.estado} = 'superada')`,
        canceladas: sql<number>`count(*) filter (where ${documentoVigencia.estado} = 'cancelada')`,
        duplicadas: sql<number>`count(*) filter (where ${documentoVigencia.estado} = 'duplicada')`,
        conPdfRoto: sql<number>`count(*) filter (where ${documentoVigencia.hashError} like '%404%')`,
        calculadas: sql<number>`count(${documentoVigencia.documentoId})`,
      })
      .from(officialDocument)
      .leftJoin(documentoVigencia, eq(documentoVigencia.documentoId, officialDocument.id)),
  ]);

  const filas = (crudas as FilaCruda[]).map(aFila);

  // --- Versiones anteriores de las familias de esta página ---
  const familias = [
    ...new Set(
      filas
        .filter((f) => f.versionesEnFamilia > 1 && f.familia !== null)
        .map((f) => f.familia as string),
    ),
  ];

  const anteriores: Record<string, VersionAnterior[]> = {};

  if (familias.length > 0 && !termino && !todas) {
    const viejas = await db
      .select({
        id: officialDocument.id,
        familia: documentoVigencia.familia,
        title: officialDocument.title,
        pdfUrl: officialDocument.pdfUrl,
        publishedAt: officialDocument.publishedAt,
        estado: documentoVigencia.estado,
        etiquetaVersion: documentoVigencia.etiquetaVersion,
        hashError: documentoVigencia.hashError,
      })
      .from(documentoVigencia)
      .innerJoin(officialDocument, eq(officialDocument.id, documentoVigencia.documentoId))
      .where(
        and(
          inArray(documentoVigencia.familia, familias),
          inArray(documentoVigencia.estado, ['superada', 'duplicada']),
        ),
      )
      .orderBy(desc(documentoVigencia.ordenVersion), desc(officialDocument.publishedAt));

    for (const v of viejas) {
      const lista = anteriores[v.familia] ?? [];
      lista.push({
        id: v.id,
        familia: v.familia,
        title: v.title,
        pdfUrl: v.pdfUrl,
        publishedAt: v.publishedAt,
        estado: v.estado as EstadoVigencia,
        etiquetaVersion: v.etiquetaVersion,
        pdfRoto: /\b404\b/.test(v.hashError ?? ''),
      });
      anteriores[v.familia] = lista;
    }
  }

  return {
    filas,
    anteriores,
    total: recuento?.coinciden ?? 0,
    totalAbsoluto: recuento?.total ?? 0,
    superadas: recuento?.superadas ?? 0,
    canceladas: recuento?.canceladas ?? 0,
    duplicadas: recuento?.duplicadas ?? 0,
    conPdfRoto: recuento?.conPdfRoto ?? 0,
    sinCalcular: (recuento?.calculadas ?? 0) === 0,
  };
}
