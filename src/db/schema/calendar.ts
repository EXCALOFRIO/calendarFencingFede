import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { athlete, userProfile } from './core';
import {
  categoryEnum,
  circuitEnum,
  deadlineOriginEnum,
  deadlineTypeEnum,
  eventLinkStatusEnum,
  eventTypeEnum,
  genderEnum,
  ingestStatusEnum,
  scopeEnum,
  sourceEnum,
  weaponEnum,
} from './enums';

/**
 * Evento = el torneo (el fin de semana en un pabellón).
 * La prueba concreta a la que uno se inscribe es `eventCompetition`.
 *
 * Nota sobre la FIE: sus términos exigen permiso escrito para almacenar su
 * contenido, así que de fie.org se guarda lo MÍNIMO indispensable
 * (identificador, fecha, arma, categoría, sede) y siempre `sourceUrl` para
 * enlazar al original. No se copian descripciones ni documentos.
 */
export const event = pgTable(
  'event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: sourceEnum('source').notNull(),
    /** Id en la fuente, o hash estable si la fuente no da id. */
    sourceId: text('source_id').notNull(),
    sourceUrl: text('source_url'),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    venue: text('venue'),
    city: text('city'),
    /** ISO-3166 alfa-2. */
    country: text('country'),
    /** Dirección completa del pabellón (Skermo la publica en la pestaña
     *  "Ubicación"). Es lo que hace que el enlace a Maps funcione bien. */
    venueAddress: text('venue_address'),
    /** Para que el "Cómo llegar" del móvil funcione en el feed iCal. */
    geoLat: numeric('geo_lat', { precision: 9, scale: 6 }),
    geoLon: numeric('geo_lon', { precision: 9, scale: 6 }),
    /**
     * Huso horario IANA de la sede ("Europe/Madrid", "Europe/Istanbul").
     * Con esto la app avisa de la diferencia de hora y de si el cambio de hora
     * cae en medio del viaje, que es justo lo que despista en un torneo fuera.
     */
    timezone: text('timezone'),
    /** Web del organizador, si la publica la fuente. */
    officialSite: text('official_site'),
    /**
     * Imagen del torneo.
     *
     * Se guarda la URL, NO la imagen: se enlaza a `static.fie.org` y el
     * navegador la pide directamente a ellos. Es la diferencia entre citar y
     * copiar, que es justo lo que exigen los términos de la FIE. Si un día
     * retiran la imagen, desaparece, que es el comportamiento correcto.
     */
    imageUrl: text('image_url'),
    circuit: circuitEnum('circuit').notNull().default('OTRO'),
    scope: scopeEnum('scope').notNull(),
    regionalFederation: text('regional_federation'),
    /** Si el hash no cambia, no se toca la fila y no se dispara notificación. */
    contentHash: text('content_hash').notNull(),
    /**
     * "Últ. modificación" que publica Skermo por competición. Permite detectar
     * cambios sin diffear todo el contenido.
     */
    sourceModifiedAt: timestamp('source_modified_at', { withTimezone: true }),
    /** Texto libre de la sección "Observaciones" de Skermo. */
    notes: text('notes'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Dejó de aparecer en la fuente: se marca, no se borra (hay inscripciones
     * colgando y hace falta trazabilidad).
     */
    disappearedAt: timestamp('disappeared_at', { withTimezone: true }),
    cancelled: boolean('cancelled').notNull().default(false),
    /**
     * El MISMO torneo internacional entra dos veces, una por Skermo y otra por
     * la FIE, con nombres distintos («TORNEO SATÉLITE» · «DUBLÍN» frente a
     * «Dublin Satellite Tournament 2026» · «Dublin»). Cuando se detecta ese
     * par, la fila secundaria (la de la FIE) apunta aquí a la principal (la de
     * Skermo, que es la que trae el nombre y las pruebas que le valen a un
     * español) y desaparece del calendario: las dos se pintan como una tarjeta.
     *
     * `null` = esta fila manda por sí misma. Es el caso de la inmensa mayoría.
     *
     * Es un valor DERIVADO de `event_link`, que es donde queda el rastro de
     * por qué se unieron y quién lo decidió. Se guarda denormalizado porque el
     * calendario lo consulta en cada carga y el driver de Neon es HTTP: cada
     * JOIN evitado es un viaje de red menos.
     */
    canonicalEventId: uuid('canonical_event_id').references(
      (): AnyPgColumn => event.id,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    unique('event_source_key').on(t.source, t.sourceId),
    index('event_start_idx').on(t.startDate),
    index('event_scope_idx').on(t.scope),
    index('event_canonical_idx').on(t.canonicalEventId),
  ],
);

/**
 * Decisiones de emparejado entre los dos registros del mismo torneo.
 *
 * Existe aparte de `event.canonical_event_id` porque son dos cosas distintas:
 * la columna dice QUÉ se colapsa hoy; esta tabla dice POR QUÉ, con qué
 * criterio, y guarda además lo que NO se ha unido por dudoso y lo que una
 * persona ha rechazado a mano. Sin ella, un falso positivo sería invisible y
 * un rechazo del admin volvería a aparecer en la siguiente ingestión.
 *
 * `canonicalEventId` es siempre la fila que se queda (Skermo);
 * `linkedEventId`, la que se absorbe (FIE). Nunca al revés, así que no hay
 * cadenas: un evento absorbido jamás es el principal de otro.
 */
export const eventLink = pgTable(
  'event_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalEventId: uuid('canonical_event_id')
      .notNull()
      .references((): AnyPgColumn => event.id, { onDelete: 'cascade' }),
    linkedEventId: uuid('linked_event_id')
      .notNull()
      .references((): AnyPgColumn => event.id, { onDelete: 'cascade' }),
    status: eventLinkStatusEnum('status').notNull().default('AUTOMATICO'),
    /** Clave canónica de ciudad con la que casaron. Sirve para depurar. */
    cityKey: text('city_key'),
    /** Regla que disparó el emparejado, en texto legible para el admin. */
    rule: text('rule').notNull(),
    /** Por qué se dejó en duda, cuando aplica. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Cuándo lo confirmó o rechazó una persona. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByProfileId: uuid('decided_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
  },
  (t) => [
    unique('event_link_key').on(t.canonicalEventId, t.linkedEventId),
    index('event_link_linked_idx').on(t.linkedEventId),
    index('event_link_status_idx').on(t.status),
  ],
);

/**
 * La prueba concreta dentro del evento: arma + género + categoría +
 * individual/equipos. ESTO es lo que se filtra y a lo que uno se inscribe,
 * no el evento entero.
 */
export const eventCompetition = pgTable(
  'event_competition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    weapon: weaponEnum('weapon').notNull(),
    gender: genderEnum('gender').notNull(),
    category: categoryEnum('category').notNull(),
    /** El texto literal de la fuente ("VET50", "M14"), para no perder nada al
     *  normalizar a nuestro enum. */
    categoryRaw: text('category_raw'),
    format: eventTypeEnum('format').notNull().default('INDIVIDUAL'),
    /** Día concreto de la prueba dentro del evento, si la fuente lo publica. */
    competitionDate: date('competition_date'),
    /**
     * Horarios del día de competición, tal y como los publica Skermo en la
     * sección "Calendario" del detalle. Se guardan como texto porque la fuente
     * los da como texto y a veces vienen vacíos: convertirlos a hora exacta
     * obligaría a inventar un valor cuando no lo hay.
     */
    installationOpen: text('installation_open'),
    callTime: text('call_time'),
    scratchTime: text('scratch_time'),
    startTime: text('start_time'),
    /**
     * Nº de inscritos que publica Skermo. Da una idea real del nivel de
     * participación y del coeficiente que acabará teniendo la prueba.
     */
    registrationCount: integer('registration_count'),
    /** Cuota en euros. Null = "no publicado". Nunca se inventa un importe. */
    feeEur: numeric('fee_eur', { precision: 8, scale: 2 }),
    sourceId: text('source_id'),
    sourceUrl: text('source_url'),
    contentHash: text('content_hash').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('event_competition_key').on(
      t.eventId,
      t.weapon,
      t.gender,
      t.category,
      t.format,
    ),
    index('event_competition_filter_idx').on(t.weapon, t.gender, t.category),
  ],
);

/**
 * Plazos de inscripción. Alimenta el semáforo.
 *
 * `origin` distingue el plazo PUBLICADO por la fuente del CALCULADO a partir
 * de `deadline_rule`. El publicado siempre gana, y en la interfaz se marcan
 * distinto: un plazo estimado no se presenta nunca como si fuera oficial.
 */
export const eventDeadline = pgTable(
  'event_deadline',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** Null = aplica a todas las pruebas del evento. */
    eventCompetitionId: uuid('event_competition_id').references(
      () => eventCompetition.id,
      { onDelete: 'cascade' },
    ),
    type: deadlineTypeEnum('type').notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    surchargeEur: numeric('surcharge_eur', { precision: 8, scale: 2 }),
    /** Cierre duro: pasada esta fecha no se puede inscribir en absoluto. */
    blocking: boolean('is_blocking').notNull().default(false),
    origin: deadlineOriginEnum('origin').notNull(),
    /** De dónde sale el importe, para poder enseñarlo debajo del semáforo. */
    sourceDocument: text('source_document'),
    sourceUrl: text('source_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('event_deadline_key').on(t.eventId, t.eventCompetitionId, t.type),
    index('event_deadline_at_idx').on(t.deadlineAt),
  ],
);

/**
 * Lista NOMINAL de inscritos que publica Skermo en cada prueba.
 *
 * Por qué hace falta, con las palabras del usuario: «que pueda recuperar si
 * estás o no ya inscrito, porque igual le ha inscrito otra persona». En la
 * práctica al tirador lo apunta su club o el seleccionador por fuera de esta
 * aplicación, y hasta ahora aquí solo se guardaba el NÚMERO
 * (`event_competition.registration_count`), así que la app no podía decirle
 * «tranquilo, ya estás en la lista oficial».
 *
 * La lista viene en el MISMO HTML del calendario que ya descargamos, en la
 * pestaña "Inscritos" de cada modal (`#registrations<id>`): 2.176 nombres en
 * una sola petición. Cero peticiones extra por prueba.
 *
 * EMPAREJADO: Skermo NO publica la licencia en esta pantalla, solo el nombre
 * y —en las pruebas por equipos— el código del equipo. Así que
 * `athlete_id` se queda a null salvo que la fuente traiga licencia, y la fila
 * va a la cola que resuelve una persona. Emparejar por nombre está prohibido
 * en este proyecto y aquí con más motivo: decirle a alguien que está inscrito
 * cuando el inscrito es su homónimo es el peor error posible de esta pantalla.
 *
 * `withdrawn_at` marca a quien ya no aparece en la lista: se marca, no se
 * borra, porque "te han quitado de la lista" es justo lo que hay que poder
 * contar.
 */
export const competitionRegistration = pgTable(
  'competition_registration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventCompetitionId: uuid('event_competition_id')
      .notNull()
      .references(() => eventCompetition.id, { onDelete: 'cascade' }),
    /** Null mientras nadie lo haya emparejado a mano. Nunca por nombre. */
    athleteId: uuid('athlete_id').references(() => athlete.id, {
      onDelete: 'set null',
    }),
    /** El nombre tal y como lo publica la fuente, sin retocar. */
    sourceAthleteName: text('source_athlete_name').notNull(),
    /**
     * Código de equipo en las pruebas por equipos ("CCC-M 1"). Cadena vacía en
     * las individuales, no null: forma parte de la clave única y en Postgres
     * dos NULL no chocan, con lo que un null dejaría entrar duplicados.
     */
    sourceTeam: text('source_team').notNull().default(''),
    /** Skermo no la publica en esta pantalla; queda por si otra fuente sí. */
    sourceLicense: text('source_license'),
    sourceClub: text('source_club'),
    source: sourceEnum('source').notNull(),
    sourceUrl: text('source_url'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Dejó de figurar en la lista oficial: baja, no borrado. */
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    unique('competition_registration_key').on(
      t.eventCompetitionId,
      t.sourceAthleteName,
      t.sourceTeam,
    ),
    index('competition_registration_competition_idx').on(t.eventCompetitionId),
    index('competition_registration_athlete_idx').on(t.athleteId),
  ],
);

/** Documentos del evento. Se enlaza al original, no se duplica. */
export const eventDocument = pgTable(
  'event_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    kind: text('kind'),
    publishedAt: date('published_at'),
    /** Hash del contenido, para procesar cada PDF una sola vez (fase 8). */
    fileHash: text('file_hash'),
  },
  (t) => [unique('event_document_key').on(t.eventId, t.url)],
);

/**
 * Circulares oficiales de la RFEE traídas de `esgrima.es/wp-json`.
 * Es una API JSON de verdad, no scraping frágil: el muro de circulares se
 * alimenta solo.
 */
export const officialDocument = pgTable(
  'official_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Clave única: el id del adjunto en WordPress. */
    wpMediaId: integer('wp_media_id').notNull().unique(),
    title: text('title').notNull(),
    pdfUrl: text('pdf_url').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    /** Extraídos del nombre del fichero (CIRCULAR_12-26_...) cuando se puede. */
    circularNumber: text('circular_number'),
    seasonLabel: text('season_label'),
    /** Enlace opcional a un evento, cuando se puede deducir. */
    eventId: uuid('event_id').references(() => event.id, { onDelete: 'set null' }),
    /**
     * Menciona "recargo", "inscripción" o "plazos" -> aviso al admin para que
     * revise si cambian los importes de normativa. Nunca se actualiza solo.
     */
    mentionsFees: boolean('mentions_fees').notNull().default(false),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByProfileId: uuid('reviewed_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    fileHash: text('file_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('official_document_published_idx').on(t.publishedAt)],
);

/**
 * Registro de cada ejecución del scraper. Sin esto, un scraper roto pasa
 * desapercibido durante semanas.
 */
export const ingestRun = pgTable(
  'ingest_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: sourceEnum('source').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    status: ingestStatusEnum('status').notNull().default('ok'),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsCreated: integer('items_created').notNull().default(0),
    itemsUpdated: integer('items_updated').notNull().default(0),
    itemsQuarantined: integer('items_quarantined').notNull().default(0),
    notificationsQueued: integer('notifications_queued').notNull().default(0),
    error: text('error'),
    /**
     * URL del snapshot de HTML crudo en Vercel Blob. Permite depurar un parseo
     * roto sin volver a pedir la página.
     */
    snapshotUrl: text('snapshot_url'),
    snapshotHash: text('snapshot_hash'),
    /** Disparado por cron o por el botón "Actualizar ahora" del admin. */
    triggeredBy: text('triggered_by').notNull().default('cron'),
  },
  (t) => [index('ingest_run_source_idx').on(t.source, t.startedAt)],
);

/**
 * Cuarentena: lo que no valida NO entra en el calendario. Sale en el panel de
 * admin como "3 competiciones no se han podido leer bien". Un dato dudoso
 * visible es infinitamente mejor que un dato malo publicado.
 */
export const ingestQuarantine = pgTable(
  'ingest_quarantine',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingestRunId: uuid('ingest_run_id')
      .notNull()
      .references(() => ingestRun.id, { onDelete: 'cascade' }),
    source: sourceEnum('source').notNull(),
    sourceId: text('source_id'),
    /** Lo que se leyó, tal cual, para poder arreglarlo a mano. */
    rawPayload: jsonb('raw_payload').notNull(),
    /** Errores de Zod ya formateados. */
    validationErrors: jsonb('validation_errors').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('ingest_quarantine_open_idx').on(t.source, t.resolvedAt)],
);
