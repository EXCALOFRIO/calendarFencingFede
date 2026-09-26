import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { event, eventDocument, officialDocument } from './calendar';
import { userProfile } from './core';

/**
 * Extracción asistida por IA de las circulares en PDF.
 *
 * QUÉ RESUELVE
 * ------------
 * El calendario da fechas y sede; los plazos reales, las cuotas, los horarios
 * y las categorías admitidas están DENTRO del PDF de la convocatoria. Nadie va
 * a leer 278 circulares a mano. Un modelo sí, pero un modelo también se
 * inventa datos, y una cuota inventada publicada como oficial es peor que no
 * tener el dato.
 *
 * POR QUÉ DOS TABLAS Y NO UNA
 * ---------------------------
 * `extraccion_documento` es el LIBRO DE REGISTRO: una fila por cada intento de
 * procesar un documento, pasara lo que pasara. `extraccion_propuesta` es la
 * COLA DE REVISIÓN: una fila por cada campo que hay que aprobar o rechazar.
 *
 * Están separadas porque la idempotencia vive en el registro, no en la cola.
 * Un documento puede acabar sin ninguna propuesta —está escaneado, lleva datos
 * personales, el modelo no encontró nada— y aun así NO se puede volver a
 * procesar cada noche: costaría una descarga y una llamada al modelo para
 * llegar otra vez a "nada". Si la idempotencia colgara de la cola, esos
 * documentos se reprocesarían para siempre, que es justo el caso caro.
 *
 * LA CLAVE DE IDEMPOTENCIA SON TRES COSAS, NO UNA
 * -----------------------------------------------
 * (hash del PDF, hash del prompt, versión del esquema).
 *
 *  - `hash_documento`: SHA-256 del contenido del fichero. Si la RFEE vuelve a
 *    publicar el mismo PDF en otra URL, es el mismo documento y no se procesa
 *    dos veces; si lo corrigen y cambia un byte, el hash cambia y sí se
 *    reprocesa. Por contenido, no por URL ni por fecha.
 *  - `hash_prompt` y `version_esquema`: cuando mejoremos el prompt o añadamos
 *    un campo al esquema, hay que poder reprocesar los 278 A PROPÓSITO y solo
 *    entonces. Sin esto, la única forma de reprocesar sería borrar la tabla, y
 *    con ella el historial de lo que se aprobó y lo que se rechazó.
 */

/**
 * Cómo acabó el intento de procesar un documento.
 *
 * Los estados "malos" se guardan igual que el bueno, y a propósito: son la
 * respuesta a "¿por qué esta circular no tiene datos?", que si no habría que
 * contestar volviendo a procesarla.
 */
export const estadoExtraccionEnum = pgEnum('estado_extraccion', [
  /** Se llamó al modelo y devolvió JSON válido. */
  'ok',
  /** PDF escaneado, sin capa de texto: no hay nada que cotejar ni que enviar. */
  'sin_texto',
  /** Cortafuegos de privacidad: el documento parece llevar datos personales. */
  'bloqueado_datos_personales',
  /** No hay proveedor configurado. La aplicación funciona igual, sin IA. */
  'sin_modelo',
  /** Fallo de red, del modelo o de validación. El motivo va en `motivo`. */
  'error',
]);

/**
 * Estado de revisión de un campo propuesto.
 *
 * Enum propio en vez de reutilizar `proposal_status` porque el vocabulario que
 * pidió el proyecto es pendiente/aprobada/RECHAZADA, y renombrar un valor de
 * un enum que ya usa otra tabla es una migración destructiva. Añadir un enum
 * nuevo es aditivo y no toca nada de lo que hay.
 */
export const estadoPropuestaIaEnum = pgEnum('estado_propuesta_ia', [
  'pendiente',
  'aprobada',
  'rechazada',
]);

/** Origen del texto sobre el que se hizo la extracción. */
export const origenTextoEnum = pgEnum('origen_texto_extraccion', [
  /** Capa de texto del PDF leída en local con `unpdf`, sin modelo. */
  'unpdf',
  /** Transcripción de un escaneado hecha por un modelo multimodal. */
  'ocr_modelo',
]);

/**
 * Cuánto sabemos de a qué evento pertenece el documento.
 *
 * Es el campo que decide si un dato aprobado puede llegar a una ficha. Los 278
 * documentos de `official_document` son circulares de la federación —no
 * dossieres por torneo— y HOY LOS 278 tienen `event_id` a null: ninguna trae
 * el id del evento, y varias hablan de tres competiciones a la vez.
 *
 *  - 'seguro': el documento cuelga del propio evento (`event_document`), o una
 *    persona lo ha confirmado. Aprobar un campo aquí sí lo lleva a la ficha.
 *  - 'dudoso': hay UN candidato que casa por nombre y fechas, pero lo dice una
 *    heurística, no el documento. Se enseña la sugerencia y la confirma una
 *    persona; hasta entonces el dato no se aplica a nada.
 *  - 'desconocido': cero candidatos, o más de uno. Se queda en la cola
 *    diciendo que no se sabe. NO se adivina.
 */
export const certezaEventoEnum = pgEnum('certeza_evento_extraccion', [
  'seguro',
  'dudoso',
  'desconocido',
]);

/**
 * Libro de registro: un intento de extracción sobre un documento.
 */
export const extraccionDocumento = pgTable(
  'extraccion_documento',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Circular de origen. `set null` y no `cascade`: si alguien borra la
     * circular del muro, el registro de que se procesó y lo que costó sigue
     * teniendo valor.
     */
    documentoId: uuid('documento_id').references(() => officialDocument.id, {
      onDelete: 'set null',
    }),
    /**
     * La OTRA procedencia posible: el dossier que Skermo cuelga del propio
     * torneo (`event_document`, 25 filas hoy, 15 de ellas de tipo
     * "convocatoria"). Son los que de verdad llevan el pabellón con su
     * dirección, los horarios por día y por arma y los importes, y además
     * vienen ya atados a un evento, así que su certeza es 'seguro' sin tener
     * que adivinar nada.
     *
     * Las dos columnas son excluyentes en la práctica: un documento viene de
     * una tabla o de la otra. No se fuerza con una restricción porque una fila
     * con las dos a null sigue siendo válida (un PDF procesado a mano por URL).
     */
    eventoDocumentoId: uuid('evento_documento_id').references(
      () => eventDocument.id,
      { onDelete: 'set null' },
    ),
    /** URL del PDF tal cual se descargó, para poder abrirlo desde la revisión. */
    documentoUrl: text('documento_url').notNull(),
    /** Título de la circular, copiado para que la revisión no necesite un join. */
    documentoTitulo: text('documento_titulo'),

    /**
     * Evento al que se refiere el documento, cuando se sabe o se sospecha.
     * Ver `certezaEventoEnum`: mientras la certeza no sea 'seguro', esto es
     * una sugerencia para que la confirme una persona, no un hecho.
     */
    eventoId: uuid('evento_id').references(() => event.id, { onDelete: 'set null' }),
    eventoCerteza: certezaEventoEnum('evento_certeza'),
    /** Por qué se cree eso, en castellano y para leerlo en pantalla. */
    eventoMotivo: text('evento_motivo'),
    /**
     * Confirmación humana del enlace con el evento. Aprobar campos y confirmar
     * a qué torneo van son dos decisiones distintas y se firman aparte: se
     * puede dar por bueno un horario y seguir sin saber de qué torneo es.
     */
    eventoConfirmadoEn: timestamp('evento_confirmado_en', { withTimezone: true }),
    eventoConfirmadoPorPerfilId: uuid('evento_confirmado_por_perfil_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),

    /** SHA-256 del contenido del PDF en hexadecimal. */
    hashDocumento: text('hash_documento').notNull(),
    /** SHA-256 del prompt de sistema + el esquema JSON de salida. */
    hashPrompt: text('hash_prompt').notNull(),
    /** Se sube a mano al cambiar la forma de los datos extraídos. */
    versionEsquema: integer('version_esquema').notNull(),

    estado: estadoExtraccionEnum('estado').notNull(),
    /** En castellano y para leer: es lo que se enseña en la pantalla. */
    motivo: text('motivo'),

    /** Identificador del modelo, tal cual lo llama el proveedor. */
    modelo: text('modelo'),
    origenTexto: origenTextoEnum('origen_texto'),
    paginas: integer('paginas'),
    caracteresTexto: integer('caracteres_texto'),

    /**
     * El JSON que devolvió el modelo, ya validado con Zod. Se guarda entero
     * aunque las propuestas estén desglosadas en la otra tabla: es la prueba
     * de qué contestó exactamente, y sin él no se puede depurar un descarte.
     */
    propuestaJson: jsonb('propuesta_json'),
    /**
     * Campos que NO pasaron la verificación de cita, con su motivo. No se
     * tiran: una tasa de descartes que sube es la señal de que el modelo o el
     * prompt se han degradado, y sin registrarla nadie se enteraría.
     */
    descartadasJson: jsonb('descartadas_json'),
    camposPropuestos: integer('campos_propuestos').notNull().default(0),
    camposDescartados: integer('campos_descartados').notNull().default(0),

    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * LA clave de idempotencia. El índice único no es solo una garantía: es lo
     * que consulta el cron antes de descargar nada.
     */
    unique('extraccion_documento_clave').on(
      t.hashDocumento,
      t.hashPrompt,
      t.versionEsquema,
    ),
    index('extraccion_documento_doc_idx').on(t.documentoId),
    index('extraccion_documento_estado_idx').on(t.estado),
    index('extraccion_documento_evento_doc_idx').on(t.eventoDocumentoId),
    index('extraccion_documento_evento_idx').on(t.eventoId),
  ],
);

/**
 * Cola de revisión: un campo propuesto, con su cita y su trozo de PDF.
 *
 * El modelo no escribe NUNCA en producción. Aprobar aquí significa "una
 * persona ha comprobado que esto lo pone el documento", y deja constancia de
 * quién y cuándo. Lo que no se ha revisado se enseña marcado como extraído
 * automáticamente y sin verificar, nunca como un dato oficial.
 */
export const extraccionPropuesta = pgTable(
  'extraccion_propuesta',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    extraccionId: uuid('extraccion_id')
      .notNull()
      .references(() => extraccionDocumento.id, { onDelete: 'cascade' }),
    documentoId: uuid('documento_id').references(() => officialDocument.id, {
      onDelete: 'set null',
    }),
    /** Repetido desde la extracción para poder filtrar sin join. */
    hashDocumento: text('hash_documento').notNull(),

    /**
     * Evento al que va este dato, copiado de la extracción al encolar.
     *
     * Denormalizado a propósito: la ficha de un torneo pide sus datos
     * extraídos en cada carga y el driver de Neon es HTTP. Con la columna aquí
     * es un índice y una consulta; sin ella, un join contra el libro de
     * registro en el camino crítico del calendario. Mismo criterio que
     * `event.canonical_event_id`.
     */
    eventoId: uuid('evento_id').references(() => event.id, { onDelete: 'set null' }),

    /** Clave estable del dato: "deadline.L1", "fee_eur", "venue", "call_time". */
    campo: text('campo').notNull(),
    valorPropuesto: text('valor_propuesto').notNull(),
    /**
     * La prueba a la que se refiere el dato, tal como la nombra el documento
     * ("florete masculino"). `null` = todo el evento.
     *
     * Se guarda el TEXTO del documento y no un `event_competition_id`: casar
     * "florete masculino" con una fila de pruebas es una decisión sobre datos
     * que aquí no se puede tomar con certeza, y escribir un id equivocado
     * pondría el horario en la prueba de otro. El revisor ve el texto original
     * y la ficha lo enseña tal cual.
     */
    prueba: text('prueba'),

    /** Frase copiada del PDF de la que sale el valor. */
    cita: text('cita').notNull(),
    /**
     * `true` = la frase aparece de verdad en el texto del PDF.
     *
     * En la práctica solo se guardan las verificadas: una cita que no está en
     * el documento no llega a la cola para no gastarle el tiempo a nadie
     * revisando invenciones. La columna existe igualmente porque el día que se
     * quiera revisar también lo dudoso, el dato tiene que estar.
     */
    citaVerificada: boolean('cita_verificada').notNull().default(false),
    /**
     * Trozo del texto del PDF alrededor de la cita. Es lo que se pone al lado
     * del valor en la pantalla de revisión: sin contexto, aprobar un dato es
     * fiarse, no comprobar.
     */
    contexto: text('contexto'),

    estado: estadoPropuestaIaEnum('estado').notNull().default('pendiente'),
    revisadoPorPerfilId: uuid('revisado_por_perfil_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    revisadoEn: timestamp('revisado_en', { withTimezone: true }),

    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Un campo una vez por extracción. Si el cron se dispara dos veces a la
     * vez, la segunda inserción no pisa el estado de revisión de la primera.
     */
    unique('extraccion_propuesta_clave').on(t.extraccionId, t.campo),
    index('extraccion_propuesta_estado_idx').on(t.estado),
    index('extraccion_propuesta_doc_idx').on(t.documentoId),
    /**
     * El índice que usa la ficha: «dame los datos extraídos de ESTE evento que
     * estén aprobados o pendientes». Sin él, cada carga de una ficha sería un
     * recorrido de la tabla entera.
     */
    index('extraccion_propuesta_evento_idx').on(t.eventoId, t.estado),
  ],
);
