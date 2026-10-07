import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type SQLiteTableExtraConfigValue } from 'drizzle-orm/sqlite-core';
import { userProfile } from '../d1/schema';

/**
 * Notificaciones de la aplicación (migración `drizzle-d1/0014_notificaciones.sql`).
 *
 * Esquema D1 escrito a mano, como `sport-relevos.ts`: estas tablas no vienen
 * del catálogo PostgreSQL del que se genera `src/db/d1/schema.ts` y por eso no
 * se exportan desde `./index` (el inventario de `tests/d1-schema.test.ts`
 * compara ese catálogo con la 0000). Las lecturas usan SQL; esto es el
 * contrato tipado y `tests/notificaciones-modelo.test.ts` lo compara con la
 * migración.
 */

export const TIPOS_NOTIFICACION = ['inscripciones', 'seguidos', 'perfil', 'calendario', 'prueba'] as const;
export const CLAVES_PREFERENCIA = [
  'tipo:inscripciones', 'tipo:seguidos', 'tipo:perfil', 'tipo:calendario', 'canal:campana', 'canal:push',
] as const;
export const TIPOS_EVENTO_DEPORTIVO = ['resultados_publicados', 'resultado_nuevo'] as const;

export const notificacion = sqliteTable('notificacion', {
  id: text('id').notNull().primaryKey(),
  profileId: text('profile_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_NOTIFICACION }).notNull(),
  clave: text('clave').notNull(),
  grupo: text('grupo').notNull(),
  titulo: text('titulo').notNull(),
  cuerpo: text('cuerpo').notNull(),
  url: text('url').notNull(),
  datos: text('datos'),
  enBandeja: integer('en_bandeja', { mode: 'boolean' }).notNull().default(true),
  leidaEn: integer('leida_en'),
  creadaEn: integer('creada_en').notNull(),
  actualizadaEn: integer('actualizada_en').notNull(),
  pushEnviadaEn: integer('push_enviada_en'),
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('notificacion_clave_key').on(t.profileId, t.clave),
  index('notificacion_bandeja_idx').on(t.profileId, t.enBandeja, t.actualizadaEn),
  index('notificacion_no_leidas_idx').on(t.profileId).where(sql`leida_en IS NULL AND en_bandeja = 1`),
  foreignKey({ name: 'notificacion_profile_fk', columns: [t.profileId], foreignColumns: [userProfile.id] }).onDelete('cascade'),
]);

export const notificacionPreferencia = sqliteTable('notificacion_preferencia', {
  profileId: text('profile_id').notNull(),
  clave: text('clave', { enum: CLAVES_PREFERENCIA }).notNull(),
  activa: integer('activa', { mode: 'boolean' }).notNull(),
  actualizadaEn: integer('actualizada_en').notNull(),
}, (t): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [t.profileId, t.clave] }),
  foreignKey({ name: 'notificacion_preferencia_profile_fk', columns: [t.profileId], foreignColumns: [userProfile.id] }).onDelete('cascade'),
]);

export const notificacionSuscripcion = sqliteTable('notificacion_suscripcion', {
  id: text('id').notNull().primaryKey(),
  profileId: text('profile_id').notNull(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  dispositivo: text('dispositivo'),
  creadaEn: integer('creada_en').notNull(),
  ultimoEnvioEn: integer('ultimo_envio_en'),
  fallos: integer('fallos').notNull().default(0),
}, (t): SQLiteTableExtraConfigValue[] => [
  uniqueIndex('notificacion_suscripcion_endpoint_key').on(t.endpoint),
  index('notificacion_suscripcion_perfil_idx').on(t.profileId),
  foreignKey({ name: 'notificacion_suscripcion_profile_fk', columns: [t.profileId], foreignColumns: [userProfile.id] }).onDelete('cascade'),
]);

export const notificacionEvento = sqliteTable('notificacion_evento', {
  id: text('id').notNull().primaryKey(),
  tipo: text('tipo', { enum: TIPOS_EVENTO_DEPORTIVO }).notNull(),
  competitionId: text('competition_id').notNull(),
  personIds: text('person_ids'),
  creadoEn: integer('creado_en').notNull(),
  procesadoEn: integer('procesado_en'),
}, (t): SQLiteTableExtraConfigValue[] => [
  index('notificacion_evento_pendiente_idx').on(t.procesadoEn, t.creadoEn),
]);

export const notificacionCursor = sqliteTable('notificacion_cursor', {
  fuente: text('fuente').notNull().primaryKey(),
  ultimoId: integer('ultimo_id').notNull(),
  actualizadoEn: integer('actualizado_en').notNull(),
});

export const notificacionLectura = sqliteTable('notificacion_lectura', {
  personId: text('person_id').notNull(),
  clave: text('clave').notNull(),
  valor: text('valor').notNull(),
  leidaEn: integer('leida_en').notNull(),
}, (t): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [t.personId, t.clave] }),
]);
