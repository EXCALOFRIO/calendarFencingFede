import {
  VERSION_ESQUEMA,
  crearClienteModelo,
  documentosPendientesDeExtraer,
  huellaDeExtraccion,
  leerConfiguracionIa,
  procesarDocumentoOficial,
  type ResumenProceso,
} from '@/lib/ai/extract';

/**
 * Extracción asistida por IA de las circulares en PDF, en lotes pequeños.
 *
 * QUÉ HACE
 * Coge las circulares que todavía no se han leído con el prompt y el esquema
 * actuales, de la más reciente a la más antigua, y las pasa por el embudo:
 * descarga -> texto en local con `unpdf` -> cortafuegos de datos personales ->
 * modelo con salida JSON -> verificación de cada cita contra el texto real ->
 * cola de revisión. Nada de lo que salga de aquí se publica: lo aprueba una
 * persona en Gestión › Extracción.
 *
 * POR QUÉ EN LOTES PEQUEÑOS Y NO LAS 278 DE GOLPE
 * Un Worker tiene un techo de tiempo y la capa gratuita de Workers AI son
 * 10.000 neurons al día. Cinco circulares por pasada acaban con las 278 en un
 * par de meses de crons nocturnos, y con `?limite=` se puede acelerar a mano
 * cuando haga falta. Lo importante es que NUNCA se reprocesa lo ya hecho: la
 * idempotencia va por hash del contenido, hash del prompt y versión del
 * esquema (ver `src/db/schema/extraccion.ts`), así que repetir la llamada no
 * gasta ni una petición al modelo.
 *
 * QUÉ PASA SI NO HAY IA
 * Nada malo. Si `AI_EXTRACTION_ENABLED` no está a "true" o no hay ni binding
 * de Workers AI ni credenciales, la ruta contesta 200 diciendo por qué no ha
 * hecho nada. La aplicación funciona sin esto; con esto funciona mejor.
 */

/** Lo mismo que los otros crons: leer 5 PDFs no cabe en 60 s. */
export const maxDuration = 300;

/** Nunca cacheado: cada invocación tiene que mirar la base de datos de verdad. */
export const dynamic = 'force-dynamic';

/** Circulares por pasada. Conservador a propósito: ver la cabecera. */
const LOTE_POR_DEFECTO = 5;
/**
 * Tope duro aunque alguien pida más por la URL. Un lote enorme no acelera
 * nada: agota el tiempo del Worker a mitad y deja el trabajo sin registrar.
 */
const LOTE_MAXIMO = 25;

export async function GET(request: Request) {
  const denegado = autorizarCron(request);
  if (denegado) return denegado;

  const config = leerConfiguracionIa();
  if (!config.activa) {
    return Response.json({
      ok: true,
      procesadas: 0,
      motivo:
        'La extracción asistida está apagada. Pon AI_EXTRACTION_ENABLED="true" ' +
        'para encenderla; el resto de la aplicación no depende de ella.',
    });
  }

  const cliente = crearClienteModelo(config);
  if (!cliente) {
    /**
     * 200 y no 503: que no haya modelo configurado no es una avería del cron,
     * es una decisión de configuración. Un 503 haría que Cloudflare marcase el
     * disparador como caído y reintentase sin arreglar nada.
     */
    return Response.json({
      ok: true,
      procesadas: 0,
      proveedor: config.proveedor,
      motivo:
        'No hay a quién preguntar: ni binding de Workers AI en el Worker, ni ' +
        'CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN con permiso de Workers AI, ' +
        'ni AI_API_KEY para otro proveedor. Todo lo demás sigue funcionando.',
    });
  }

  const url = new URL(request.url);
  const pedido = Number.parseInt(url.searchParams.get('limite') ?? '', 10);
  const limite = Number.isFinite(pedido)
    ? Math.min(Math.max(pedido, 1), LOTE_MAXIMO)
    : LOTE_POR_DEFECTO;

  /**
   * La huella se calcula UNA vez y se pasa a cada documento: son 278 hashes
   * idénticos del mismo prompt, y calcularlos en bucle sería tonto.
   */
  const huella = { hashPrompt: await huellaDeExtraccion(), versionEsquema: VERSION_ESQUEMA };

  const pendientes = await documentosPendientesDeExtraer(limite, huella);

  const resultados: ResumenProceso[] = [];
  for (const documento of pendientes) {
    /**
     * De una en una y no con `Promise.all`: son descargas de PDF y llamadas a
     * un modelo, y lanzarlas a la vez solo sirve para chocar con el límite de
     * peticiones por minuto y para que un fallo arrastre a los demás.
     */
    try {
      resultados.push(
        await procesarDocumentoOficial({
          documentoId: documento.id,
          documentoUrl: documento.pdfUrl,
          documentoTitulo: documento.titulo,
          fileHash: documento.fileHash,
          eventId: documento.eventId,
          cliente,
          config,
          huella,
        }),
      );
    } catch (error) {
      // Una circular que revienta no puede tumbar el lote entero.
      resultados.push({
        documentoId: documento.id,
        documentoUrl: documento.pdfUrl,
        titulo: documento.titulo,
        estado: 'error',
        motivo: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const cuenta = (estado: ResumenProceso['estado']) =>
    resultados.filter((r) => r.estado === estado).length;

  return Response.json({
    ok: true,
    proveedor: config.proveedor,
    modelo: cliente.modelo,
    versionEsquema: VERSION_ESQUEMA,
    revisadas: resultados.length,
    extraidas: cuenta('ok'),
    yaProcesadas: cuenta('ya_procesado'),
    sinTexto: cuenta('sin_texto'),
    bloqueadasPorDatosPersonales: cuenta('bloqueado_datos_personales'),
    errores: cuenta('error'),
    encoladas: resultados.reduce((suma, r) => suma + (r.encoladas ?? 0), 0),
    descartadasPorCitaFalsa: resultados.reduce(
      (suma, r) => suma + (r.descartadas ?? 0),
      0,
    ),
    detalle: resultados,
  });
}

/**
 * Protección del cron.
 *
 * Deliberadamente duplicado en las tres rutas de cron en lugar de extraído a
 * un módulo común: son quince líneas y así cada endpoint público se puede
 * auditar entero sin saltar de fichero, que es justo lo que uno quiere al
 * mirar una ruta que gasta dinero en llamadas a un modelo.
 */
function autorizarCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return Response.json(
        {
          ok: false,
          error:
            'Falta CRON_SECRET en el entorno. Defínela en el Worker para que el ' +
            'cron pueda ejecutarse.',
        },
        { status: 503 },
      );
    }
    // En desarrollo se permite, para poder probar con curl sin montar nada.
    return null;
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  return null;
}
