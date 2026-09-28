import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { officialDocument } from './calendar';

/**
 * VIGENCIA DE LAS CIRCULARES: qué manda, qué está superado y qué se canceló.
 *
 * POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN `official_document`
 * ------------------------------------------------------------
 * `official_document` es la copia FIEL de lo que publica la RFEE: título, URL,
 * fecha y nada más. Todo lo de aquí es DERIVADO —sale de aplicar expresiones
 * regulares a esos títulos— y se puede tirar y recalcular entero en cualquier
 * momento sin perder nada. Mezclar las dos cosas en la misma fila haría que no
 * se pudiera distinguir un dato de la federación de una deducción nuestra, que
 * es justo la distinción que este proyecto no se puede permitir perder.
 *
 * Es el mismo criterio que separa `event_link` de `event.canonical_event_id`:
 * la tabla dice POR QUÉ, con qué regla y con qué certeza.
 *
 * Y NO CUESTA UN VIAJE DE RED MÁS: `/documentos` la trae con un LEFT JOIN
 * dentro de la consulta que ya hacía, así que sigue siendo una sola consulta.
 * El driver de Neon habla por HTTP y cada consulta es un viaje; un JOIN no.
 *
 * SE BORRA CON EL DOCUMENTO
 * -------------------------
 * `cascade` y no `set null`: si la circular desaparece del muro, su vigencia
 * no significa nada. Al contrario que un registro de extracción, aquí no hay
 * historial que valga la pena conservar, porque se regenera en un segundo.
 */
export const estadoVigenciaEnum = pgEnum('estado_vigencia_documento', [
  /** Es la versión que manda de su familia. */
  'vigente',
  /** Hay una versión posterior del mismo documento. */
  'superada',
  /** Otra circular la deroga expresamente («CIRCULAR 01-26 CANCELACIÓN…»). */
  'cancelada',
  /** Es byte a byte el mismo fichero que otra entrada de la lista. */
  'duplicada',
]);

export const documentoVigencia = pgTable(
  'documento_vigencia',
  {
    /**
     * La clave primaria ES el documento: una decisión de vigencia por
     * circular, ni más ni menos. Así el recálculo es un `ON CONFLICT` limpio y
     * no hacen falta borrados previos.
     */
    documentoId: uuid('documento_id')
      .primaryKey()
      .references(() => officialDocument.id, { onDelete: 'cascade' }),

    /**
     * Clave de familia, «ASUNTO|temporada». Se guarda legible a propósito: al
     * depurar por qué dos circulares se han agrupado, ver
     * «CAMPEONATO ESPANA CADETE|2023-2024» responde la pregunta sin ejecutar
     * nada. Un hash sería más corto y no diría nada.
     */
    familia: text('familia').notNull(),
    /** El asunto normalizado, sin número, sin temporada y sin marcas. */
    asunto: text('asunto').notNull(),
    temporada: text('temporada'),
    /**
     * `true` = la temporada se ha deducido de la fecha de publicación porque
     * ni el título ni el número de circular la traían. Se guarda para poder
     * decirlo en pantalla: una agrupación deducida no se presenta como un dato
     * de la federación.
     */
    temporadaInferida: boolean('temporada_inferida').notNull().default(false),
    /** «12-23», normalizado. Null cuando el título no lo trae. */
    numeroCircular: text('numero_circular'),

    /** Cómo se nombra la versión en pantalla: «V3», «bis», «actualizada». */
    etiquetaVersion: text('etiqueta_version'),
    ordenVersion: integer('orden_version').notNull().default(100),
    /** Cuántas versiones tiene la familia, contando esta. */
    versionesEnFamilia: integer('versiones_en_familia').notNull().default(1),

    estado: estadoVigenciaEnum('estado').notNull(),
    /**
     * La versión que manda, cuando esta no lo es. Es lo que hace que la
     * pantalla pueda enlazar «sustituida por …» al PDF que de verdad vale, que
     * es la mitad de lo que pidió el usuario: «poder ver lo que había antes».
     */
    sustituidaPorId: uuid('sustituida_por_id').references(
      () => officialDocument.id,
      { onDelete: 'set null' },
    ),
    /** La entrada que se queda, cuando esta es un duplicado exacto. */
    duplicadoDeId: uuid('duplicado_de_id').references(() => officialDocument.id, {
      onDelete: 'set null',
    }),
    /** Por qué, en castellano y para enseñarlo tal cual. */
    motivo: text('motivo'),

    /**
     * PASADA DE HASHES: por qué estas dos columnas están aquí y no en
     * `official_document`.
     *
     * `official_document.file_hash` es el dato (el SHA-256 del PDF). Esto es la
     * CONTABILIDAD de haber intentado conseguirlo, que es lo que hace que la
     * pasada sea reanudable: sin ella, una URL que da 404 se reintentaría todas
     * las noches para siempre. Con ella, la consulta de pendientes es «hash a
     * null y sin intento reciente», y el cron se queda en «nada nuevo» sin
     * descargar un solo byte.
     */
    hashIntentadoEn: timestamp('hash_intentado_en', { withTimezone: true }),
    /** Qué falló al descargar, si falló. Null = fue bien o no se ha probado. */
    hashError: text('hash_error'),

    calculadoEn: timestamp('calculado_en', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** La consulta de `/documentos`: «enséñame lo vigente primero». */
    index('documento_vigencia_estado_idx').on(t.estado),
    index('documento_vigencia_familia_idx').on(t.familia),
    /** La consulta de la pasada de hashes, que busca lo que falta por intentar. */
    index('documento_vigencia_intento_idx').on(t.hashIntentadoEn),
  ],
);
