import {
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
 * RANKING OFICIAL DE LA RFEE, tal y como lo publica Skermo.
 *
 * Es una copia fiel de lo que hay en
 * `app.skermo.org/ranking-rfee/public/RFEE?season&weapon&category&gender`, y
 * NO se mezcla nunca con `ranking_point` / `ranking_snapshot`, que son el
 * cálculo interno de esta aplicación. Son dos números distintos y confundirlos
 * sería grave: el oficial es el que decide convocatorias; el nuestro es el que
 * se puede auditar puesto a puesto. La pantalla tiene que poder enseñar los
 * dos y decir cuál es cuál.
 *
 * Dos cosas de la fuente condicionan el diseño:
 *
 * 1. La tabla del ranking **no publica el número de licencia**: solo puesto,
 *    nombre, apellidos, fecha de nacimiento, club y puntuación. La licencia
 *    está una pantalla más adentro, en `/ranking-rfee/public/RFEE/<id>`, a una
 *    petición por tirador. Por eso `source_license` se rellena a posteriori y
 *    con presupuesto por ejecución, y `skermo_athlete_id` se guarda siempre:
 *    es la clave estable que permite no volver a pedir esa ficha nunca más.
 * 2. `athlete_id` solo se rellena por LICENCIA. Nunca por nombre. Lo que no
 *    empareja se queda a null y lo resuelve una persona.
 */
export const officialRankingEntry = pgTable(
  'official_ranking_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** "2026-2027", leído del propio selector de temporada de Skermo. */
    seasonLabel: text('season_label').notNull(),
    /** El id interno que Skermo usa en el parámetro `season` ("17"). */
    skermoSeasonId: text('skermo_season_id').notNull(),
    weapon: weaponEnum('weapon').notNull(),
    gender: genderEnum('gender').notNull(),
    category: categoryEnum('category').notNull(),
    /** "VET50" y "M20" se normalizan a VET y M20; aquí queda el literal. */
    categoryRaw: text('category_raw').notNull(),
    /**
     * Puesto en el ranking, o `null` si el tirador todavía NO está
     * clasificado.
     *
     * Skermo marca a los no clasificados con el puesto **9999**: 59 de los
     * 259 de espada masculina absoluta, todos con 0 puntos. Es un centinela,
     * no un puesto, y guardarlo tal cual pondría a medio ranking en el puesto
     * nueve mil novecientos noventa y nueve. Se traduce a `null`, que es lo
     * que significa.
     */
    position: integer('position'),
    totalPoints: numeric('total_points', { precision: 10, scale: 2 }),
    athleteId: uuid('athlete_id').references(() => athlete.id, {
      onDelete: 'set null',
    }),
    /** Clave interna del tirador en Skermo. No es la licencia. */
    skermoAthleteId: text('skermo_athlete_id'),
    /** Licencia resuelta desde la ficha del tirador, cuando se ha pedido. */
    sourceLicense: text('source_license'),
    sourceAthleteName: text('source_athlete_name').notNull(),
    sourceFirstName: text('source_first_name'),
    sourceLastName: text('source_last_name'),
    sourceClub: text('source_club'),
    sourceBirthDate: date('source_birth_date'),
    sourceUrl: text('source_url'),
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * La clave natural es EL TIRADOR dentro del ranking, no su puesto.
     *
     * Empezó siendo el puesto y la primera ejecución contra Skermo lo tumbó:
     * los no clasificados comparten el puesto 9999, así que el puesto no es
     * único. El id de Skermo sí lo es, y además hace que "ha subido del 12 al
     * 7" sea una modificación de su fila en vez de dos filas distintas.
     */
    unique('official_ranking_entry_key').on(
      t.skermoSeasonId,
      t.weapon,
      t.gender,
      t.categoryRaw,
      t.skermoAthleteId,
    ),
    index('official_ranking_entry_lookup_idx').on(
      t.seasonLabel,
      t.weapon,
      t.gender,
      t.category,
    ),
    index('official_ranking_entry_athlete_idx').on(t.athleteId),
    index('official_ranking_entry_skermo_idx').on(t.skermoAthleteId),
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
