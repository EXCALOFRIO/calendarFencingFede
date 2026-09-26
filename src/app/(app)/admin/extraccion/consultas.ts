import { and, count, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  event,
  eventDocument,
  extraccionDocumento,
  extraccionPropuesta,
  officialDocument,
  userProfile,
} from '@/db/schema';
import { VERSION_ESQUEMA, huellaDeExtraccion } from '@/lib/ai/extract';

/**
 * Consultas de la pantalla de revisión de extracciones.
 *
 * Viven aquí y no en `src/lib/queries/**` porque solo las usa esta pantalla:
 * son la forma de lo que se pinta, no un modelo de dominio que nadie más
 * comparta.
 */

export type PropuestaRevision = {
  id: string;
  campo: string;
  valorPropuesto: string;
  /** La prueba tal como la nombra el PDF. Null = todo el evento. */
  prueba: string | null;
  cita: string;
  citaVerificada: boolean;
  contexto: string | null;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  revisadoEn: Date | null;
  revisadoPor: string | null;
};

/**
 * A qué torneo va esto, que es la otra mitad de la revisión.
 *
 * Aprobar un campo contesta «¿lo pone el documento?». Esto contesta «¿de qué
 * torneo habla?», y sin las dos respuestas el dato no puede llegar a ninguna
 * ficha. Hoy los 278 documentos de `official_document` tienen `event_id` a
 * null, así que esta pregunta no tiene respuesta automática para casi ninguno.
 */
export type EventoDeExtraccion = {
  eventoId: string | null;
  certeza: 'seguro' | 'dudoso' | 'desconocido';
  motivo: string | null;
  /** Nombre y fecha del evento sugerido, para que el revisor lo reconozca. */
  nombre: string | null;
  inicio: string | null;
  ciudad: string | null;
  /** Cuándo lo confirmó una persona. */
  confirmadoEn: Date | null;
};

/** Un campo que el modelo propuso y que la verificación de cita tumbó. */
export type CampoDescartado = {
  campo: string;
  valor: string;
  cita: string;
  motivo: string;
};

export type ExtraccionRevision = {
  id: string;
  documentoId: string | null;
  titulo: string | null;
  url: string;
  estado: 'ok' | 'sin_texto' | 'bloqueado_datos_personales' | 'sin_modelo' | 'error';
  motivo: string | null;
  modelo: string | null;
  paginas: number | null;
  creadoEn: Date;
  descartadas: CampoDescartado[];
  propuestas: PropuestaRevision[];
  evento: EventoDeExtraccion;
};

export type ResumenExtraccion = {
  pendientes: number;
  aprobadas: number;
  rechazadas: number;
  /** Circulares que todavía no ha mirado el modelo con el prompt de hoy. */
  sinLeer: number;
  /** Circulares que se miraron y no dieron ningún campo, con su motivo. */
  sinDatos: number;
  descartadasPorCitaFalsa: number;
};

/** Cuántas hay de cada cosa. Es lo que abre la pantalla. */
export async function resumenExtraccion(): Promise<ResumenExtraccion> {
  const huella = await huellaDeExtraccion();

  /**
   * «Sin leer» cuenta las DOS procedencias: las circulares de la federación y
   * los dossieres que cuelgan de cada torneo. Contar solo las primeras decía
   * «0 sin leer» mientras quedaban convocatorias con el pabellón y los
   * horarios dentro sin mirar, que son justo las que se notan en la ficha.
   */
  const sinProcesar = (mismoDocumento: ReturnType<typeof eq>) =>
    notExists(
      db
        .select({ existe: sql`1` })
        .from(extraccionDocumento)
        .where(
          and(
            mismoDocumento,
            eq(extraccionDocumento.hashPrompt, huella),
            eq(extraccionDocumento.versionEsquema, VERSION_ESQUEMA),
          ),
        ),
    );

  const [porEstado, sinLeer, sinLeerDossieres, sinDatos, descartes] = await Promise.all([
    db
      .select({ estado: extraccionPropuesta.estado, n: count() })
      .from(extraccionPropuesta)
      .groupBy(extraccionPropuesta.estado),
    db
      .select({ n: count() })
      .from(officialDocument)
      .where(sinProcesar(eq(extraccionDocumento.documentoId, officialDocument.id))),
    db
      .select({ n: count() })
      .from(eventDocument)
      .where(sinProcesar(eq(extraccionDocumento.eventoDocumentoId, eventDocument.id))),
    db
      .select({ n: count() })
      .from(extraccionDocumento)
      .where(eq(extraccionDocumento.camposPropuestos, 0)),
    db
      .select({
        n: sql<number>`coalesce(sum(${extraccionDocumento.camposDescartados}), 0)::int`,
      })
      .from(extraccionDocumento),
  ]);

  const de = (estado: string) =>
    porEstado.find((fila) => fila.estado === estado)?.n ?? 0;

  return {
    pendientes: de('pendiente'),
    aprobadas: de('aprobada'),
    rechazadas: de('rechazada'),
    sinLeer: (sinLeer[0]?.n ?? 0) + (sinLeerDossieres[0]?.n ?? 0),
    sinDatos: sinDatos[0]?.n ?? 0,
    descartadasPorCitaFalsa: descartes[0]?.n ?? 0,
  };
}

/** Lo que el modelo dejó anotado de un campo que no superó la verificación. */
function leerDescartadas(valor: unknown): CampoDescartado[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((bruto) => {
    if (!bruto || typeof bruto !== 'object') return [];
    const fila = bruto as Record<string, unknown>;
    const texto = (clave: string) =>
      typeof fila[clave] === 'string' ? (fila[clave] as string) : '';
    return [
      {
        campo: texto('field') || 'campo sin nombre',
        valor: texto('proposedValue'),
        cita: texto('quote'),
        motivo:
          texto('motivoDescarte') ||
          'La cita no aparece en el texto del PDF: se descarta por posible alucinación.',
      },
    ];
  });
}

/**
 * Las últimas extracciones con sus propuestas.
 *
 * Dos consultas y un cruce en memoria en lugar de un `join`: con el join, una
 * extracción de doce campos se repetiría doce veces y habría que deshacerlo
 * igualmente. El tope de 60 extracciones es lo que cabe revisar de una
 * sentada; lo demás se ve filtrando.
 */
export async function listarExtracciones(
  filtro: 'pendientes' | 'revisadas' | 'sin_datos' = 'pendientes',
  limite = 60,
): Promise<ExtraccionRevision[]> {
  const documentos = await db
    .select({
      id: extraccionDocumento.id,
      documentoId: extraccionDocumento.documentoId,
      titulo: extraccionDocumento.documentoTitulo,
      url: extraccionDocumento.documentoUrl,
      estado: extraccionDocumento.estado,
      motivo: extraccionDocumento.motivo,
      modelo: extraccionDocumento.modelo,
      paginas: extraccionDocumento.paginas,
      creadoEn: extraccionDocumento.creadoEn,
      descartadas: extraccionDocumento.descartadasJson,
      camposPropuestos: extraccionDocumento.camposPropuestos,
      eventoId: extraccionDocumento.eventoId,
      eventoCerteza: extraccionDocumento.eventoCerteza,
      eventoMotivo: extraccionDocumento.eventoMotivo,
      eventoConfirmadoEn: extraccionDocumento.eventoConfirmadoEn,
      eventoNombre: event.name,
      eventoInicio: event.startDate,
      eventoCiudad: event.city,
    })
    .from(extraccionDocumento)
    /**
     * `leftJoin` y no `innerJoin`: la inmensa mayoría de las extracciones NO
     * tienen evento, y con un join interno desaparecerían de la pantalla justo
     * las que hay que revisar.
     */
    .leftJoin(event, eq(event.id, extraccionDocumento.eventoId))
    .where(
      filtro === 'sin_datos'
        ? eq(extraccionDocumento.camposPropuestos, 0)
        : sql`${extraccionDocumento.camposPropuestos} > 0`,
    )
    .orderBy(desc(extraccionDocumento.creadoEn))
    .limit(limite);

  if (documentos.length === 0) return [];

  const revisor = userProfile;
  const propuestas =
    filtro === 'sin_datos'
      ? []
      : await db
          .select({
            id: extraccionPropuesta.id,
            extraccionId: extraccionPropuesta.extraccionId,
            campo: extraccionPropuesta.campo,
            valorPropuesto: extraccionPropuesta.valorPropuesto,
            prueba: extraccionPropuesta.prueba,
            cita: extraccionPropuesta.cita,
            citaVerificada: extraccionPropuesta.citaVerificada,
            contexto: extraccionPropuesta.contexto,
            estado: extraccionPropuesta.estado,
            revisadoEn: extraccionPropuesta.revisadoEn,
            revisadoPor: revisor.fullName,
          })
          .from(extraccionPropuesta)
          .leftJoin(revisor, eq(extraccionPropuesta.revisadoPorPerfilId, revisor.id))
          .where(
            inArray(
              extraccionPropuesta.extraccionId,
              documentos.map((d) => d.id),
            ),
          )
          .orderBy(extraccionPropuesta.campo);

  const quiero = filtro === 'pendientes' ? 'pendiente' : null;

  return documentos
    .map((documento) => ({
      id: documento.id,
      documentoId: documento.documentoId,
      titulo: documento.titulo,
      url: documento.url,
      estado: documento.estado,
      motivo: documento.motivo,
      modelo: documento.modelo,
      paginas: documento.paginas,
      creadoEn: documento.creadoEn,
      descartadas: leerDescartadas(documento.descartadas),
      evento: {
        eventoId: documento.eventoId,
        certeza: documento.eventoCerteza ?? 'desconocido',
        motivo: documento.eventoMotivo,
        nombre: documento.eventoNombre,
        inicio: documento.eventoInicio,
        ciudad: documento.eventoCiudad,
        confirmadoEn: documento.eventoConfirmadoEn,
      },
      propuestas: propuestas
        .filter((p) => p.extraccionId === documento.id)
        .filter((p) => (quiero ? p.estado === quiero : p.estado !== 'pendiente'))
        .map((p) => ({
          id: p.id,
          campo: p.campo,
          valorPropuesto: p.valorPropuesto,
          prueba: p.prueba,
          cita: p.cita,
          citaVerificada: p.citaVerificada,
          contexto: p.contexto,
          estado: p.estado,
          revisadoEn: p.revisadoEn,
          revisadoPor: p.revisadoPor,
        })),
    }))
    /**
     * Una circular sin nada que enseñar en este filtro no pinta nada en la
     * lista: ocuparía sitio para decir que no tiene nada que decir.
     */
    .filter((fila) => filtro === 'sin_datos' || fila.propuestas.length > 0);
}
