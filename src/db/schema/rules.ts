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
  eventTypeEnum,
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
    /**
     * Individual o equipos. La RFEE cobra importes distintos por lo mismo: una
     * inscripción fuera del primer límite son 5 € por tirador/a pero 25 € por
     * equipo. Null = se aplica a los dos.
     */
    format: eventTypeEnum('format'),
    type: deadlineTypeEnum('type').notNull(),
    /** Etiqueta legible: "Ordinario", "Segundo plazo", "Cierre FIE". */
    label: text('label').notNull(),
    /** Días naturales antes de la fecha de inicio del evento. */
    daysBefore: integer('days_before').notNull(),
    /**
     * ANCLAJE POR DÍA DE LA SEMANA (lo que de verdad dice la normativa).
     *
     * `days_before` sirve para la FIE, que cuenta días: D-28, D-21, D-14, D-7.
     * La RFEE **no cuenta días**, ancla a un día de la semana y a una hora de
     * reloj: *«el plazo de inscripción finaliza el viernes de la semana
     * anterior a la competición a las 12:00 h»* (Circular 12-26), y los dos
     * límites de agregación son *«hasta el lunes anterior a las 23:59»* y
     * *«hasta el martes anterior a las 23:59»* (Normativa de Rankings, 3.3.2).
     *
     * Con un contador de días eso solo sale bien si la competición empieza en
     * sábado. Se midió: de 28 competiciones nacionales, 9 empiezan en domingo
     * y 2 en martes, y en esas once el plazo calculado caía en el día
     * equivocado. Por eso el anclaje es explícito:
     *
     *   `weekday`      1 = lunes … 7 = domingo (ISO), null = usar `days_before`
     *   `weeksBefore`  0 = la semana de la competición, 1 = la anterior
     *   `timeOfDay`    hora de cierre en hora de Madrid, "HH:MM"
     *
     * Así «viernes de la semana anterior a las 12:00» es, literalmente,
     * `weekday 5, weeksBefore 1, timeOfDay '12:00'`, y se lee igual en la
     * tabla y en el PDF.
     */
    weekday: smallint('weekday'),
    weeksBefore: smallint('weeks_before').notNull().default(0),
    timeOfDay: text('time_of_day'),
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
    /**
     * PARÁMETROS DE LA FÓRMULA DE PUNTOS. Null = solo se usa `pointsTable`.
     *
     * Por qué hizo falta ampliar la tabla: la «NORMATIVA PARA RANKINGS
     * NACIONALES_26-27_V1» (punto 1.4.1) no reparte los puntos con una tabla de
     * puesto a puntos, sino con una tabla MÁS un término continuo que depende
     * del número de participantes:
     *
     *     puntos = (escalón(puesto) + escala × (techo − log10(puesto) /
     *               log10(participantes))) × coeficiente
     *
     * El escalón sí cabe en `pointsTable` tal cual, porque sus claves ya
     * admiten tramos: `{"1":1414, "2":1212, "3-4":1010, "5-8":808, "9-16":606,
     * "17-32":404, "33-64":202, "65-128":101}`. Lo que no cabía en ninguna
     * columna eran `escala` (1000) y `techo` (1,01), que son dos números de la
     * normativa, y la regla de este proyecto es que ningún número de la
     * normativa se escribe en el código. Ahí es donde van.
     *
     * Forma: `{ "tipo": "rfee_log10", "escala": 1000, "techo": 1.01 }`.
     * `tipo` existe para poder añadir otra fórmula sin migrar nada: si algún
     * día la RFEE cambia de método, se guarda con otro `tipo` y el código elige.
     */
    pointsFormula: jsonb('points_formula'),
    /**
     * ARRASTRE DE LA TEMPORADA ANTERIOR, en tanto por uno.
     *
     * Punto 1.1 de la misma normativa: el ranking «no es vivo» y arranca con un
     * porcentaje de los puntos de la temporada pasada. Cadete 0,10; júnior
     * 0,15; sénior 0,20; y sub-23 0,00, que NO es lo mismo que null: cero es
     * una decisión de la federación («0 %» está escrito en su tabla) y null es
     * «esta normativa no lo dice». M13 y M15 no tienen fila de arrastre, y por
     * eso se quedan a null.
     */
    previousSeasonCarry: numeric('previous_season_carry', {
      precision: 5,
      scale: 4,
    }),
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
