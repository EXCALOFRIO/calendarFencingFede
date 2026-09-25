import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { event, eventCompetition } from './calendar';
import { athlete, club, userProfile } from './core';
import {
  callUpStatusEnum,
  entryStatusEnum,
  placeTypeEnum,
  submissionStatusEnum,
} from './enums';

/**
 * Inscripción de un tirador en una prueba concreta.
 *
 * Flujo: draft -> pending_club -> club_approved -> federation_approved ->
 * submitted. Las transiciones válidas están en un único sitio
 * (src/lib/entries/state-machine.ts), no repartidas por la interfaz.
 */
export const entry = pgTable(
  'entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id, { onDelete: 'cascade' }),
    eventCompetitionId: uuid('event_competition_id')
      .notNull()
      .references(() => eventCompetition.id, { onDelete: 'cascade' }),
    status: entryStatusEnum('status').notNull().default('draft'),
    requestedByProfileId: uuid('requested_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    clubDecidedByProfileId: uuid('club_decided_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    clubDecidedAt: timestamp('club_decided_at', { withTimezone: true }),
    federationDecidedByProfileId: uuid('federation_decided_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    federationDecidedAt: timestamp('federation_decided_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /** Motivo obligatorio al rechazar o retirar. */
    reason: text('reason'),
    /**
     * Plazo aplicable en el momento de la solicitud, congelado para poder
     * explicar después qué recargo tocaba. Null = todavía sin calcular.
     */
    appliedDeadlineId: uuid('applied_deadline_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Un tirador no puede tener dos inscripciones a la misma prueba. */
    unique('entry_athlete_competition_key').on(t.athleteId, t.eventCompetitionId),
    index('entry_status_idx').on(t.status),
    index('entry_athlete_idx').on(t.athleteId),
  ],
);

/**
 * Auditoría de cada cambio de estado. Imprescindible cuando alguien diga
 * "yo sí me apunté".
 */
export const entryEventLog = pgTable(
  'entry_event_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entry.id, { onDelete: 'cascade' }),
    fromStatus: entryStatusEnum('from_status'),
    toStatus: entryStatusEnum('to_status').notNull(),
    actorProfileId: uuid('actor_profile_id').references(() => userProfile.id, {
      onDelete: 'set null',
    }),
    /** "sistema" cuando lo hace un cron (p. ej. cierre de plazo). */
    actorLabel: text('actor_label'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('entry_event_log_entry_idx').on(t.entryId, t.createdAt)],
);

/**
 * Fase 10: intento de envío a Skermo.
 *
 * Única por `entryId` para que nadie se inscriba dos veces. Se guardan la
 * petición y la respuesta como evidencia: sin releer el listado y confirmar
 * que la inscripción aparece, no se puede decir que el envío fue correcto.
 */
export const submission = pgTable(
  'submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .unique()
      .references(() => entry.id, { onDelete: 'cascade' }),
    status: submissionStatusEnum('status').notNull().default('dry_run'),
    /** Petición construida (sin credenciales: nunca se registran). */
    requestSnapshot: jsonb('request_snapshot'),
    responseStatus: integer('response_status'),
    responseSnapshot: text('response_snapshot'),
    /** Resultado de releer el listado de Skermo para verificar. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationNote: text('verification_note'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    triggeredByProfileId: uuid('triggered_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('submission_status_idx').on(t.status)],
);

/** Convocatoria del seleccionador para un evento. */
export const callUp = pgTable(
  'call_up',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    /** PDF de la circular, subido a Vercel Blob. */
    pdfUrl: text('pdf_url'),
    pdfName: text('pdf_name'),
    travelNotes: text('travel_notes'),
    published: boolean('published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Fecha límite por defecto para que los convocados respondan. */
    respondBy: timestamp('respond_by', { withTimezone: true }),
    createdByProfileId: uuid('created_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('call_up_event_idx').on(t.eventId)],
);

export const callUpAthlete = pgTable(
  'call_up_athlete',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callUpId: uuid('call_up_id')
      .notNull()
      .references(() => callUp.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id, { onDelete: 'cascade' }),
    /** A qué prueba se le convoca, cuando la convocatoria es por prueba. */
    eventCompetitionId: uuid('event_competition_id').references(
      () => eventCompetition.id,
      { onDelete: 'set null' },
    ),
    placeType: placeTypeEnum('place_type').notNull().default('ranking'),
    /** Puesto en el ranking interno en el momento del corte, para poder
     *  explicar la decisión. */
    rankingPositionAtCutoff: integer('ranking_position_at_cutoff'),
    status: callUpStatusEnum('status').notNull().default('pendiente'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /** Obligatorio al rechazar. Un "no" sin motivo no sirve de nada. */
    rejectionReason: text('rejection_reason'),
    respondBy: timestamp('respond_by', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('call_up_athlete_key').on(t.callUpId, t.athleteId, t.eventCompetitionId),
    index('call_up_athlete_athlete_idx').on(t.athleteId),
  ],
);

/**
 * Cola de emails. Se encola en la ingestión y se envía en el cron de avisos,
 * para no depender de que una petición HTTP sobreviva al envío y para poder
 * reintentar sin duplicar.
 */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Clave de deduplicación: mismo aviso, mismo destinatario, una vez. */
    dedupeKey: text('dedupe_key').notNull().unique(),
    toEmail: text('to_email').notNull(),
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    relatedEntryId: uuid('related_entry_id').references(() => entry.id, {
      onDelete: 'set null',
    }),
    relatedEventId: uuid('related_event_id').references(() => event.id, {
      onDelete: 'set null',
    }),
    relatedCallUpId: uuid('related_call_up_id').references(() => callUp.id, {
      onDelete: 'set null',
    }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('notification_pending_idx').on(t.sentAt, t.createdAt)],
);

/** Clubes a los que se ha autorizado el envío directo a Skermo (fase 10). */
export const clubSkermoSettings = pgTable('club_skermo_settings', {
  clubId: uuid('club_id')
    .primaryKey()
    .references(() => club.id, { onDelete: 'cascade' }),
  /** Interruptor por club: nada se envía sin activarlo explícitamente. */
  directSubmitEnabled: boolean('direct_submit_enabled').notNull().default(false),
  /** Usuario de Skermo. La contraseña NO se guarda por defecto: se pide en el
   *  momento del envío y no se persiste. */
  skermoUsername: text('skermo_username'),
  /** Solo si el club decide recordar la sesión: AES-256-GCM con la clave en
   *  variable de entorno de Vercel, nunca en la base. Borrable a un clic. */
  encryptedPassword: text('encrypted_password'),
  credentialStoredAt: timestamp('credential_stored_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
