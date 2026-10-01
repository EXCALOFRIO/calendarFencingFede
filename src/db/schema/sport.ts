import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { competitionRegistration, event, eventCompetition } from './calendar';
import { athlete, userProfile } from './core';
import {
  categoryEnum,
  eventTypeEnum,
  genderEnum,
  sportCoverageStatusEnum,
  sportLinkStatusEnum,
  weaponEnum,
} from './enums';

/**
 * ===========================================================================
 * MODELO DEPORTIVO: PERSONA, PRUEBA Y HECHOS PUBLICADOS
 * ===========================================================================
 *
 * Todo lo de este fichero es ADITIVO y vive aparte de `athlete`, `result`,
 * `official_ranking_entry`, `fie_fencer` y los rankings internos, que no se
 * tocan. Dos reglas mandan sobre el diseño:
 *
 * 1. La persona deportiva NO es la cuenta. `sport_person` puede existir sin
 *    usuario, retirada o repartida entre clubes y países. Su enlace a
 *    `athlete` es opcional y no reinterpreta `athlete.active`, que habla de la
 *    ficha/cuenta y no de si la persona sigue compitiendo.
 * 2. Los hechos (puestos, asaltos) se identifican por prueba + ID estable del
 *    hecho en su fuente, nunca por el puesto ni por el nombre. Así una
 *    corrección de la fuente revisa la fila en vez de duplicarla.
 */

/** Persona deportiva global. Sin foto, biografía ni fecha de nacimiento completa. */
export const sportPerson = pgTable(
  'sport_person',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Ficha/cuenta local, si la hay. Único: una ficha sólo es una persona.
     * Nunca se rellena por nombre, y `athlete.active` no se interpreta.
     */
    athleteId: uuid('athlete_id').references(() => athlete.id, {
      onDelete: 'set null',
    }),
    athleteLinkedVia: text('athlete_linked_via'),
    athleteLinkedAt: timestamp('athlete_linked_at', { withTimezone: true }),
    athleteLinkEvidence: text('athlete_link_evidence'),
    /** Nombre tal y como lo publicó la fuente que la creó. */
    displayName: text('display_name').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    /** Palabras sin acentos, en minúscula y ordenadas. Sólo búsqueda/candidatos. */
    nameNormalized: text('name_normalized').notNull(),
    gender: genderEnum('gender'),
    /** ISO-3166 alfa-3 publicado. */
    countryCode: text('country_code'),
    /** Sólo el año: suficiente para desambiguar, sin guardar el cumpleaños. */
    birthYear: smallint('birth_year'),
    /** Fusión reversible: apunta a la persona que prevalece. */
    mergedIntoPersonId: uuid('merged_into_person_id').references(
      (): AnyPgColumn => sportPerson.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sport_person_athlete_key')
      .on(t.athleteId)
      .where(sql`${t.athleteId} IS NOT NULL`),
    index('sport_person_name_idx').on(t.nameNormalized.op('text_pattern_ops')),
    index('sport_person_merged_idx').on(t.mergedIntoPersonId),
    check('sport_person_no_self_merge', sql`${t.mergedIntoPersonId} IS DISTINCT FROM ${t.id}`),
  ],
);

/** Nombre original por fuente. Varias personas pueden compartir el mismo. */
export const sportPersonAlias = pgTable(
  'sport_person_alias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => sportPerson.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    nameOriginal: text('name_original').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('sport_person_alias_key').on(t.personId, t.source, t.nameNormalized),
    index('sport_person_alias_name_idx').on(t.nameNormalized.op('text_pattern_ops')),
  ],
);

/**
 * ID externo con ámbito y vigencia.
 *
 * El ámbito son columnas NOT NULL con '' como «sin ámbito» para que la clave
 * única funcione sin NULLS NOT DISTINCT. Un ID FIE (`addrId`) no necesita
 * ámbito; una licencia RFEE sí (federación y vigencia), porque se reutiliza.
 * `person_id` es null mientras sólo hay candidato (`PROPUESTO`).
 */
export const sportExternalId = pgTable(
  'sport_external_id',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id').references(() => sportPerson.id, {
      onDelete: 'cascade',
    }),
    /** fie_addr_id | fie_license | rfee_license | skermo_athlete_id | pdf_ref */
    scheme: text('scheme').notNull(),
    value: text('value').notNull(),
    scopeSource: text('scope_source').notNull(),
    scopeFederation: text('scope_federation').notNull().default(''),
    scopeSeason: text('scope_season').notNull().default(''),
    scopeWeapon: text('scope_weapon').notNull().default(''),
    validFrom: date('valid_from').notNull().default('1900-01-01'),
    /** null = sin fecha de fin publicada. */
    validTo: date('valid_to'),
    linkStatus: sportLinkStatusEnum('link_status').notNull().default('PROPUESTO'),
    linkedVia: text('linked_via'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    evidence: text('evidence'),
    decidedByProfileId: uuid('decided_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Un ID en su ámbito y vigencia sólo puede estar confirmado para una persona. */
    uniqueIndex('sport_external_id_confirmed_key')
      .on(
        t.scheme,
        t.value,
        t.scopeSource,
        t.scopeFederation,
        t.scopeSeason,
        t.scopeWeapon,
        t.validFrom,
      )
      .where(sql`${t.linkStatus} = 'CONFIRMADO'`),
    unique('sport_external_id_person_key').on(
      t.personId,
      t.scheme,
      t.value,
      t.scopeSource,
      t.scopeFederation,
      t.scopeSeason,
      t.scopeWeapon,
      t.validFrom,
    ),
    index('sport_external_id_lookup_idx').on(t.scheme, t.value, t.scopeSource),
    index('sport_external_id_person_idx').on(t.personId),
    check(
      'sport_external_id_confirmed_has_person',
      sql`${t.linkStatus} <> 'CONFIRMADO' OR ${t.personId} IS NOT NULL`,
    ),
    check(
      'sport_external_id_validity',
      sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
    check(
      'sport_external_id_scheme',
      sql`${t.scheme} IN ('fie_addr_id','fie_license','rfee_license','skermo_athlete_id','pdf_ref')`,
    ),
  ],
);

/**
 * Referencia que la fuente publicó para el participante de una inscripción
 * (ID FIE, licencia), con su ámbito y el día del dato. Es la prueba que deja
 * enlazar la observación con una persona confirmada sin fiarse del nombre ni
 * del `athlete_id` antiguo de la fila. No sale nunca en una respuesta visible.
 *
 * Vive aparte de `competition_registration` a propósito: añadir una columna a
 * esa tabla rompería sus inserciones y lecturas completas mientras la
 * migración no esté aplicada; esta tabla sólo se toca si existe.
 */
export const sportRegistrationRef = pgTable(
  'sport_registration_ref',
  {
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => competitionRegistration.id, { onDelete: 'cascade' }),
    scheme: text('scheme').notNull(),
    value: text('value').notNull(),
    scopeSource: text('scope_source').notNull(),
    scopeFederation: text('scope_federation').notNull().default(''),
    scopeSeason: text('scope_season').notNull().default(''),
    scopeWeapon: text('scope_weapon').notNull().default(''),
    observedOn: date('observed_on'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'sport_registration_ref_pk',
      columns: [
        t.registrationId,
        t.scheme,
        t.value,
        t.scopeSource,
        t.scopeFederation,
        t.scopeSeason,
        t.scopeWeapon,
      ],
    }),
    index('sport_registration_ref_value_idx').on(t.scheme, t.value),
    check(
      'sport_registration_ref_scheme',
      sql`${t.scheme} IN ('fie_addr_id','fie_license','rfee_license','skermo_athlete_id','pdf_ref')`,
    ),
  ],
);

/**
 * Cola de conciliación: una observación de una fuente que podría ser una de
 * varias personas (homónimos). Cada decisión es reversible y queda firmada.
 */
export const sportLinkCandidate = pgTable(
  'sport_link_candidate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    /** Clave de la observación en la fuente (ID, o documento+página+región). */
    sourceRef: text('source_ref').notNull(),
    sourceName: text('source_name').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => sportPerson.id, { onDelete: 'cascade' }),
    status: sportLinkStatusEnum('status').notNull().default('PROPUESTO'),
    evidence: text('evidence'),
    decidedByProfileId: uuid('decided_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_link_candidate_key').on(t.source, t.sourceRef, t.personId),
    index('sport_link_candidate_open_idx').on(t.status, t.source),
    index('sport_link_candidate_person_idx').on(t.personId),
  ],
);

/**
 * Edición de un torneo en una fuente. En la FIE la clave es
 * `(season, tournamentId)`; el año de calendario NO es la temporada
 * (Bogotá septiembre 2026 es la 2027) y `tournamentId` NO es `competitionId`.
 */
export const sportEdition = pgTable(
  'sport_edition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    season: text('season').notNull(),
    tournamentKey: text('tournament_key').notNull(),
    name: text('name').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    city: text('city'),
    countryCode: text('country_code'),
    sourceUrl: text('source_url'),
    /** Torneo del calendario, si se ha vinculado. Opcional. */
    eventId: uuid('event_id').references(() => event.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_edition_key').on(t.source, t.season, t.tournamentKey),
    index('sport_edition_dates_idx').on(t.startDate, t.endDate),
    index('sport_edition_event_idx').on(t.eventId),
  ],
);

/**
 * Prueba de una edición. FIE: `(source='fie', season, competition_key =
 * competitionId)`, separada del torneo. Las pruebas de PDF usan una clave de
 * documento+prueba.
 */
export const sportCompetition = pgTable(
  'sport_competition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => sportEdition.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    season: text('season').notNull(),
    competitionKey: text('competition_key').notNull(),
    weapon: weaponEnum('weapon').notNull(),
    gender: genderEnum('gender').notNull(),
    category: categoryEnum('category').notNull(),
    categoryRaw: text('category_raw'),
    format: eventTypeEnum('format').notNull().default('INDIVIDUAL'),
    competitionDate: date('competition_date'),
    sourceUrl: text('source_url'),
    /** Prueba del calendario equivalente, si la hay. No sustituye a la clave. */
    eventCompetitionId: uuid('event_competition_id').references(
      () => eventCompetition.id,
      { onDelete: 'set null' },
    ),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_competition_key').on(t.source, t.season, t.competitionKey),
    index('sport_competition_edition_idx').on(t.editionId),
    index('sport_competition_filter_idx').on(
      t.weapon,
      t.gender,
      t.category,
      t.format,
      t.season,
    ),
    index('sport_competition_date_idx').on(t.competitionDate),
  ],
);

/**
 * Puesto final de una persona en una prueba, según una fuente.
 *
 * La identidad del hecho es `(prueba, fuente, source_fact_key)`: el ID del
 * participante en la fuente (o página+región en un PDF), NO el puesto. Si la
 * fuente corrige el puesto, se actualiza `position` y sube `revision`.
 */
export const sportResult = pgTable(
  'sport_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => sportCompetition.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceFactKey: text('source_fact_key').notNull(),
    /** null = sin conciliar o ambiguo: nunca se asigna por nombre. */
    personId: uuid('person_id').references(() => sportPerson.id, {
      onDelete: 'set null',
    }),
    sourceName: text('source_name').notNull(),
    sourceCountryCode: text('source_country_code'),
    sourceClub: text('source_club'),
    /** null = la fuente no publicó puesto numérico (p. ej. no clasificado). */
    position: integer('position'),
    positionRaw: text('position_raw'),
    officialPoints: numeric('official_points', { precision: 10, scale: 3 }),
    /** Copia de la fecha de la prueba, para filtrar por atleta+fecha sin JOIN. */
    occurredOn: date('occurred_on'),
    sourceUrl: text('source_url'),
    contentHash: text('content_hash').notNull(),
    revision: integer('revision').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revisedAt: timestamp('revised_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_result_key').on(t.competitionId, t.source, t.sourceFactKey),
    index('sport_result_person_date_idx').on(t.personId, t.occurredOn),
    index('sport_result_competition_position_idx').on(t.competitionId, t.position),
    check('sport_result_position_positive', sql`${t.position} IS NULL OR ${t.position} > 0`),
  ],
);

/**
 * Asalto individual con marcador final publicado. Sólo individuales: BYE,
 * equipos, relevos y puestos no son asaltos. Un asalto de poule se guarda una
 * vez aunque la matriz publique ambas perspectivas: `fencer_a_ref` es siempre
 * el menor de los dos, y la restricción lo impide al revés.
 */
export const sportBout = pgTable(
  'sport_bout',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => sportCompetition.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    /** POULE | TABLEAU */
    phase: text('phase').notNull(),
    /** Poule nº o ronda del cuadro (p. ej. 'P2', 'T32', 'T8'). */
    roundKey: text('round_key').notNull(),
    fencerARef: text('fencer_a_ref').notNull(),
    fencerBRef: text('fencer_b_ref').notNull(),
    fencerAPersonId: uuid('fencer_a_person_id').references(() => sportPerson.id, {
      onDelete: 'set null',
    }),
    fencerBPersonId: uuid('fencer_b_person_id').references(() => sportPerson.id, {
      onDelete: 'set null',
    }),
    fencerAName: text('fencer_a_name').notNull(),
    fencerBName: text('fencer_b_name').notNull(),
    scoreA: smallint('score_a').notNull(),
    scoreB: smallint('score_b').notNull(),
    occurredOn: date('occurred_on'),
    sourceUrl: text('source_url'),
    contentHash: text('content_hash').notNull(),
    revision: integer('revision').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revisedAt: timestamp('revised_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_bout_key').on(
      t.competitionId,
      t.source,
      t.phase,
      t.roundKey,
      t.fencerARef,
      t.fencerBRef,
    ),
    index('sport_bout_a_idx').on(t.fencerAPersonId, t.fencerBPersonId, t.occurredOn),
    index('sport_bout_b_idx').on(t.fencerBPersonId, t.fencerAPersonId, t.occurredOn),
    index('sport_bout_competition_idx').on(t.competitionId, t.phase, t.roundKey),
    check('sport_bout_canonical_order', sql`${t.fencerARef} < ${t.fencerBRef}`),
    check('sport_bout_phase', sql`${t.phase} IN ('POULE','TABLEAU')`),
    check('sport_bout_scores', sql`${t.scoreA} >= 0 AND ${t.scoreB} >= 0`),
    check(
      'sport_bout_distinct_people',
      sql`${t.fencerAPersonId} IS NULL OR ${t.fencerBPersonId} IS NULL OR ${t.fencerAPersonId} <> ${t.fencerBPersonId}`,
    ),
  ],
);

/**
 * Publicación de un ranking OFICIAL en una fecha. Aparte de
 * `ranking_snapshot`/`ranking_point`, que son el cálculo interno y privado.
 */
export const sportRankingPublication = pgTable(
  'sport_ranking_publication',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    season: text('season').notNull(),
    weapon: weaponEnum('weapon').notNull(),
    gender: genderEnum('gender').notNull(),
    category: categoryEnum('category').notNull(),
    categoryRaw: text('category_raw').notNull(),
    format: eventTypeEnum('format').notNull().default('INDIVIDUAL'),
    /** Fecha de publicación según la fuente o, si no la da, del día leído. */
    publishedOn: date('published_on').notNull(),
    sourceUrl: text('source_url'),
    publishedTotal: integer('published_total'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_ranking_publication_key').on(
      t.source,
      t.season,
      t.weapon,
      t.gender,
      t.categoryRaw,
      t.format,
      t.publishedOn,
    ),
    index('sport_ranking_publication_lookup_idx').on(
      t.season,
      t.weapon,
      t.gender,
      t.category,
      t.publishedOn,
    ),
  ],
);

export const sportRankingEntry = pgTable(
  'sport_ranking_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => sportRankingPublication.id, { onDelete: 'cascade' }),
    /** ID del participante en la fuente. */
    sourceRef: text('source_ref').notNull(),
    personId: uuid('person_id').references(() => sportPerson.id, {
      onDelete: 'set null',
    }),
    sourceName: text('source_name'),
    countryCode: text('country_code'),
    position: integer('position'),
    points: numeric('points', { precision: 10, scale: 3 }),
  },
  (t) => [
    unique('sport_ranking_entry_key').on(t.publicationId, t.sourceRef),
    index('sport_ranking_entry_person_idx').on(t.personId, t.publicationId),
    index('sport_ranking_entry_position_idx').on(t.publicationId, t.position),
  ],
);

/** Favorito `(cuenta, persona)`. No es una alerta ni da acceso a datos privados. */
export const sportFavorite = pgTable(
  'sport_favorite',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => sportPerson.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.personId] }),
    index('sport_favorite_profile_idx').on(t.profileId, t.createdAt),
    index('sport_favorite_person_idx').on(t.personId),
  ],
);

/**
 * Cobertura y checkpoint de una importación por fuente, temporada, tipo de
 * hecho y (opcionalmente) prueba. `competition_key = ''` es el nivel de
 * temporada. Distingue pendiente / vacío publicado / parcial / error /
 * conflicto; `cursor` permite reanudar sin cortar en silencio.
 */
export const sportImportCoverage = pgTable(
  'sport_import_coverage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    season: text('season').notNull(),
    /** index | tournaments | competitions | ranking | pools | tableau | entries | results | pdf */
    factKind: text('fact_kind').notNull(),
    competitionKey: text('competition_key').notNull().default(''),
    competitionId: uuid('competition_id').references(() => sportCompetition.id, {
      onDelete: 'set null',
    }),
    status: sportCoverageStatusEnum('status').notNull().default('pendiente'),
    publishedTotal: integer('published_total'),
    importedTotal: integer('imported_total').notNull().default(0),
    cursor: text('cursor'),
    attempts: integer('attempts').notNull().default(0),
    sourceUrl: text('source_url'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sport_import_coverage_key').on(
      t.source,
      t.season,
      t.factKind,
      t.competitionKey,
    ),
    index('sport_import_coverage_status_idx').on(t.status, t.source, t.season),
    index('sport_import_coverage_competition_idx').on(t.competitionId),
    check(
      'sport_import_coverage_counts',
      sql`${t.importedTotal} >= 0 AND ${t.attempts} >= 0`,
    ),
  ],
);
