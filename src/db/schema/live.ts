import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { event, eventCompetition } from './calendar';
import { userProfile } from './core';

/**
 * Enlaces a plataformas de resultados en vivo (Engarde, Fencing Time Live,
 * la propia FIE, Skermo).
 *
 * Por qué una tabla y no un scraper más: se comprobó en vivo que ni Engarde ni
 * Fencing Time Live exponen un índice público de torneos ni datos sin
 * JavaScript (Engarde carga el torneo por AJAX; fencingtimelive.com redirige a
 * login en la raíz y no tiene índice). Es decir: NO se puede descubrir
 * automáticamente qué torneo corresponde a qué evento.
 *
 * Lo que sí funciona y es honesto: guardar el enlace por evento (lo pega el
 * admin, o lo trae la fuente cuando lo publica) y dar acceso de un toque desde
 * la ficha y desde el panel del día de competición. Las poules, la pista y el
 * cuadro se consultan ahí, en la plataforma oficial, en lugar de mostrar en
 * nuestra app un dato que no podemos garantizar.
 */
export const liveSource = pgTable(
  'live_source',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** Null = vale para todas las pruebas del evento. */
    eventCompetitionId: uuid('event_competition_id').references(
      () => eventCompetition.id,
      { onDelete: 'cascade' },
    ),
    /** engarde | fencingtimelive | fie | skermo | otro */
    platform: text('platform').notNull(),
    /** en_vivo | resultados | sorteo | horarios */
    kind: text('kind').notNull().default('resultados'),
    url: text('url').notNull(),
    label: text('label'),
    addedByProfileId: uuid('added_by_profile_id').references(() => userProfile.id, {
      onDelete: 'set null',
    }),
    /** Trae la fuente el enlace, o lo puso una persona. */
    automatic: boolean('is_automatic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('live_source_key').on(t.eventId, t.eventCompetitionId, t.url),
    index('live_source_event_idx').on(t.eventId),
  ],
);
