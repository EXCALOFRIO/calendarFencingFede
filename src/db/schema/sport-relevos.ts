import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex, check, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core';
import { sportCompetition, sportPerson } from '../d1/schema';

/**
 * Relevos de las pruebas por equipos (migración `drizzle-d1/0010_relevos.sql`).
 *
 * Esquema D1 escrito a mano: estas tablas no vienen del catálogo PostgreSQL
 * del que se genera `src/db/d1/schema.ts`, y por eso no se exportan desde
 * `./index` (el inventario de `tests/d1-schema.test.ts` compara ese catálogo
 * con la 0000). Las lecturas usan SQL; esto sirve de contrato tipado y lo
 * comprueban los tests de relevos contra la migración.
 */

export const sportTeamMatch = sqliteTable('sport_team_match', {
  id: text('id').notNull().primaryKey(),
  competitionId: text('competition_id').notNull(),
  source: text('source').notNull(),
  /** Ancla del encuentro en la fuente (Engarde `a8-1`). */
  sourceKey: text('source_key').notNull(),
  phase: text('phase', { enum: ['POULE', 'TABLEAU'] }).notNull(),
  /** Como `sport_bout.round_key`; `null` en los cuadros de puestos. */
  roundKey: text('round_key'),
  roundLabel: text('round_label'),
  teamAName: text('team_a_name').notNull(),
  teamBName: text('team_b_name').notNull(),
  /** `source_fact_key` del puesto del equipo en `sport_result`, si el nombre casó. */
  teamARef: text('team_a_ref'),
  teamBRef: text('team_b_ref'),
  scoreA: integer('score_a').notNull(),
  scoreB: integer('score_b').notNull(),
  consistent: integer('consistent', { mode: 'boolean' }).notNull(),
  sourceUrl: text('source_url'),
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('sport_team_match_key').on(t.competitionId, t.source, t.sourceKey),
  foreignKey({ name: 'sport_team_match_competition_fk', columns: [t.competitionId], foreignColumns: [sportCompetition.id] }).onDelete('cascade'),
  check('sport_team_match_phase', sql`${t.phase} IN ('POULE', 'TABLEAU')`),
]);

export const sportRelay = sqliteTable('sport_relay', {
  id: text('id').notNull().primaryKey(),
  matchId: text('match_id').notNull(),
  relayNumber: integer('relay_number').notNull(),
  fencerAName: text('fencer_a_name'),
  fencerBName: text('fencer_b_name'),
  fencerAPersonId: text('fencer_a_person_id'),
  fencerBPersonId: text('fencer_b_person_id'),
  /** Tocados de cada tirador en ese relevo. */
  touchesA: integer('touches_a').notNull(),
  touchesB: integer('touches_b').notNull(),
  /** Marcador acumulado antes y después del relevo. */
  beforeA: integer('before_a').notNull(),
  beforeB: integer('before_b').notNull(),
  afterA: integer('after_a').notNull(),
  afterB: integer('after_b').notNull(),
  consistent: integer('consistent', { mode: 'boolean' }).notNull(),
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('sport_relay_key').on(t.matchId, t.relayNumber),
  foreignKey({ name: 'sport_relay_match_fk', columns: [t.matchId], foreignColumns: [sportTeamMatch.id] }).onDelete('cascade'),
  foreignKey({ name: 'sport_relay_fencer_a_fk', columns: [t.fencerAPersonId], foreignColumns: [sportPerson.id] }).onDelete('set null'),
  foreignKey({ name: 'sport_relay_fencer_b_fk', columns: [t.fencerBPersonId], foreignColumns: [sportPerson.id] }).onDelete('set null'),
  index('sport_relay_a_idx').on(t.fencerAPersonId, t.fencerBPersonId).where(sql`${t.fencerAPersonId} IS NOT NULL`),
  index('sport_relay_b_idx').on(t.fencerBPersonId, t.fencerAPersonId).where(sql`${t.fencerBPersonId} IS NOT NULL`),
]);

/** Columnas en el orden físico de la 0010 (el cargo de capacidad de sus triggers las suma todas). */
export const COLUMNAS_RELEVOS = {
  sport_team_match: ['id', 'competition_id', 'source', 'source_key', 'phase', 'round_key', 'round_label', 'team_a_name',
    'team_b_name', 'team_a_ref', 'team_b_ref', 'score_a', 'score_b', 'consistent', 'source_url'],
  sport_relay: ['id', 'match_id', 'relay_number', 'fencer_a_name', 'fencer_b_name', 'fencer_a_person_id', 'fencer_b_person_id',
    'touches_a', 'touches_b', 'before_a', 'before_b', 'after_a', 'after_b', 'consistent'],
} as const;
