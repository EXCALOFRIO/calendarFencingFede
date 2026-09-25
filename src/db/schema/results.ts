import {
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
import { event, eventCompetition } from './calendar';
import { athlete, season, userProfile } from './core';
import { categoryEnum, genderEnum, proposalStatusEnum, weaponEnum } from './enums';

/**
 * Resultado ingerido de Skermo (`/calendar/public/<FED>/results` y
 * `/ranking-rfee/public/RFEE`).
 *
 * El emparejamiento con nuestros tiradores es el punto delicado: se hace por
 * NÚMERO DE LICENCIA cuando está disponible. Si no, la fila se queda con
 * `athleteId` a null y entra en la cola de "por emparejar" que el admin
 * resuelve con un clic. Nunca se empareja por nombre automáticamente: hay
 * homónimos y acentos inconsistentes.
 */
export const result = pgTable(
  'result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventCompetitionId: uuid('event_competition_id').references(
      () => eventCompetition.id,
      { onDelete: 'cascade' },
    ),
    /** Se guarda también el evento por si la prueba concreta no se pudo
     *  emparejar (la fuente de resultados no siempre repite el desglose). */
    eventId: uuid('event_id').references(() => event.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id').references(() => athlete.id, {
      onDelete: 'set null',
    }),
    /** Lo que publica la fuente, tal cual, para poder auditar el emparejado. */
    sourceAthleteName: text('source_athlete_name').notNull(),
    sourceLicense: text('source_license'),
    sourceClub: text('source_club'),
    position: integer('position').notNull(),
    /** Puntos oficiales publicados por la fuente (distintos de los nuestros). */
    officialPoints: numeric('official_points', { precision: 10, scale: 2 }),
    weapon: weaponEnum('weapon'),
    gender: genderEnum('gender'),
    category: categoryEnum('category'),
    sourceUrl: text('source_url'),
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('result_key').on(t.eventCompetitionId, t.sourceAthleteName, t.position),
    index('result_athlete_idx').on(t.athleteId),
    index('result_unmatched_idx').on(t.athleteId, t.ingestedAt),
  ],
);

/**
 * Ranking interno calculado por el sistema. Se guarda el desglose completo
 * (puntos base, coeficiente, puntos finales) porque la pantalla muestra
 * siempre el cálculo abierto.
 */
export const rankingPoint = pgTable(
  'ranking_point',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id, { onDelete: 'cascade' }),
    eventCompetitionId: uuid('event_competition_id')
      .notNull()
      .references(() => eventCompetition.id, { onDelete: 'cascade' }),
    resultId: uuid('result_id').references(() => result.id, {
      onDelete: 'set null',
    }),
    position: integer('position').notNull(),
    basePoints: numeric('base_points', { precision: 10, scale: 2 }).notNull(),
    coefficient: numeric('coefficient', { precision: 5, scale: 3 }).notNull(),
    finalPoints: numeric('final_points', { precision: 10, scale: 2 }).notNull(),
    /** Si esta prueba entra en las "mejores N" que cuentan. */
    counted: numeric('counted', { precision: 1, scale: 0 }).notNull().default('0'),
    /** Explicación legible del cálculo, para enseñarla tal cual. */
    explanation: text('explanation'),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('ranking_point_key').on(t.athleteId, t.eventCompetitionId),
    index('ranking_point_season_idx').on(t.seasonId, t.athleteId),
  ],
);

/**
 * Snapshot del ranking en una fecha. Sirve para responder "a cuántos puestos
 * estás del corte" y para enseñar cuánto te movió una competición.
 */
export const rankingSnapshot = pgTable(
  'ranking_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    weapon: weaponEnum('weapon').notNull(),
    gender: genderEnum('gender').notNull(),
    category: categoryEnum('category').notNull(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    totalPoints: numeric('total_points', { precision: 10, scale: 2 }).notNull(),
    countedEventIds: jsonb('counted_event_ids').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('ranking_snapshot_lookup_idx').on(
      t.seasonId,
      t.weapon,
      t.gender,
      t.category,
      t.computedAt,
    ),
  ],
);

/**
 * Fase 8 (opcional): propuestas de la extracción asistida por IA.
 *
 * El modelo NO escribe nunca en producción. Lo que produce va a esta cola: el
 * admin ve el valor extraído y el trozo del PDF al lado, y aprueba con un
 * clic. Cada campo trae la cita literal del documento, y el código comprueba
 * que esa frase aparece de verdad en el texto del PDF; si no aparece, el campo
 * se descarta automáticamente. Así una alucinación es un error detectable por
 * máquina, no un dato malo publicado.
 */
export const extractionProposal = pgTable(
  'extraction_proposal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Hash del PDF: cada documento se procesa una sola vez (idempotencia). */
    documentHash: text('document_hash').notNull(),
    documentUrl: text('document_url').notNull(),
    eventId: uuid('event_id').references(() => event.id, { onDelete: 'cascade' }),
    /** Campo propuesto: "deadline.L2", "fee_eur", "venue", "call_time"... */
    field: text('field').notNull(),
    proposedValue: text('proposed_value').notNull(),
    /** Cita literal del PDF. Verificada contra el texto extraído. */
    quote: text('quote').notNull(),
    quoteVerified: numeric('quote_verified', { precision: 1, scale: 0 })
      .notNull()
      .default('0'),
    model: text('model'),
    status: proposalStatusEnum('status').notNull().default('pendiente'),
    reviewedByProfileId: uuid('reviewed_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('extraction_proposal_key').on(t.documentHash, t.field),
    index('extraction_proposal_status_idx').on(t.status),
  ],
);
