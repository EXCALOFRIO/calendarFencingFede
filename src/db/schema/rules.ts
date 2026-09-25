import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { season, userProfile } from './core';
import {
  categoryEnum,
  circuitEnum,
  deadlineTypeEnum,
  scopeEnum,
  weaponEnum,
} from './enums';

/**
 * NORMATIVA CONFIGURABLE
 *
 * Regla general: ningún número de la normativa se escribe en el código. Si
 * aparece un importe, un plazo o un coeficiente, va a una tabla con su
 * pantalla de edición y su historial de cambios.
 *
 * El motivo es práctico: la normativa de la RFEE cambia cada temporada. Si los
 * 150 € del segundo plazo están escritos en un `.ts`, el día que la federación
 * los suba a 175 € hay que tocar código, desplegar y esperar. En una tabla,
 * el admin edita el número y en el segundo siguiente toda la app muestra lo
 * correcto.
 */

/**
 * Plazos y recargos por tipo de competición.
 *
 * Cuando entra un evento nuevo por el scraper, la app calcula sus fechas
 * límite a partir de estas reglas y de la fecha de inicio. Si la fuente
 * publica el plazo real para ese evento concreto, ESE gana: el dato de la
 * fuente siempre tiene prioridad sobre la estimación.
 */
export const deadlineRule = pgTable(
  'deadline_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    /** A qué se aplica. Null en un criterio = "cualquiera". */
    scope: scopeEnum('scope').notNull(),
    circuit: circuitEnum('circuit'),
    category: categoryEnum('category'),
    type: deadlineTypeEnum('type').notNull(),
    /** Etiqueta legible: "Ordinario", "Segundo plazo", "Cierre FIE". */
    label: text('label').notNull(),
    /** Días naturales antes de la fecha de inicio del evento. */
    daysBefore: integer('days_before').notNull(),
    surchargeEur: numeric('surcharge_eur', { precision: 8, scale: 2 }),
    /** Cierre duro en vez de recargo (el D-7 de la FIE). */
    blocking: boolean('is_blocking').notNull().default(false),
    /**
     * Procedencia del dato. Los recargos viven dentro de circulares en PDF y
     * no hay ningún sitio del que se puedan recopilar automáticamente, así que
     * cada valor guarda de dónde sale y cuándo se puso. Debajo del semáforo se
     * muestra: "Recargos según Circular 12-26 de la RFEE, actualizado el ...".
     */
    sourceDocument: text('source_document'),
    sourceUrl: text('source_url'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByProfileId: uuid('updated_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    index('deadline_rule_lookup_idx').on(t.seasonId, t.scope, t.circuit, t.active),
  ],
);

/**
 * Parámetros del ranking interno: lo que hoy se aplica a mano en una hoja de
 * cálculo. La app muestra siempre el cálculo abierto (qué pruebas ha cogido,
 * con qué coeficiente y por qué), porque un ranking que no puedes auditar
 * genera más discusiones con los padres que la hoja que querías sustituir.
 */
export const rankingRule = pgTable(
  'ranking_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    weapon: weaponEnum('weapon'),
    category: categoryEnum('category'),
    /** Cuántas pruebas cuentan (las mejores N). */
    countingEvents: smallint('counting_events').notNull(),
    /** Coeficiente por tipo de prueba: { "TNR": 1.0, "SEN_WC": 1.25, ... } */
    coefficients: jsonb('coefficients').notNull(),
    /** Tabla puesto -> puntos base: { "1": 32, "2": 26, ... } */
    pointsTable: jsonb('points_table').notNull(),
    /** Plazas que salen por ranking y plazas de criterio técnico. */
    rankingPlaces: smallint('ranking_places').notNull().default(0),
    technicalPlaces: smallint('technical_places').notNull().default(0),
    /** Fecha en la que se hace el corte para convocatorias. */
    cutoffDate: timestamp('cutoff_date', { withTimezone: true }),
    sourceDocument: text('source_document'),
    sourceUrl: text('source_url'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByProfileId: uuid('updated_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('ranking_rule_key').on(t.seasonId, t.weapon, t.category),
  ],
);

/**
 * Historial de cambios de normativa. Si alguien se queja de un importe, se ve
 * en dos segundos de dónde viene, de cuándo es y quién lo puso.
 */
export const configChangeLog = pgTable(
  'config_change_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableName: text('table_name').notNull(),
    rowId: uuid('row_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    changedByProfileId: uuid('changed_by_profile_id').references(
      () => userProfile.id,
      { onDelete: 'set null' },
    ),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('config_change_log_row_idx').on(t.tableName, t.rowId)],
);
