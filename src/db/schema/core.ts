import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  categoryEnum,
  genderEnum,
  inviteStatusEnum,
  roleEnum,
  weaponEnum,
} from './enums';

/** Club o sala de armas. La federación autonómica se guarda como texto libre
 *  porque no hay una lista canónica publicada en ningún sitio estable. */
export const club = pgTable('club', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  regionalFederation: text('regional_federation'),
  contactEmail: text('contact_email'),
  /** Clave del club en Skermo, si se conoce. Necesaria para la fase 10. */
  skermoClubCode: text('skermo_club_code'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Nuestro perfil, enlazado a la identidad por `authUserId`. Separar identidad
 * de perfil es lo que permite cambiar de proveedor de auth sin rehacer nada.
 */
export const userProfile = pgTable(
  'user_profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Id del usuario en `neon_auth.user`, que gestiona Neon Auth.
     *
     * A propósito SIN clave ajena: esas tablas las administra Neon (las crea y
     * las migra su servicio), y encadenar nuestro esquema a un esquema
     * gestionado por un tercero es pedir que una migración suya nos rompa las
     * migraciones. La integridad se mantiene en la capa de aplicación, que es
     * donde se crea el perfil al primer acceso.
     */
    authUserId: text('auth_user_id').unique(),
    /** Se guarda aparte del auth para poder invitar a alguien que aún no
     *  tiene cuenta (importación CSV antes del primer acceso). */
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    role: roleEnum('role').notNull().default('athlete'),
    clubId: uuid('club_id').references(() => club.id, { onDelete: 'set null' }),
    phone: text('phone'),
    inviteStatus: inviteStatusEnum('invite_status').notNull().default('pendiente'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    /** Token del feed iCal personal. Revocable desde el perfil. */
    icalToken: text('ical_token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_profile_club_idx').on(t.clubId)],
);

/**
 * Tirador.
 *
 * Se guarda la FECHA DE NACIMIENTO, no la categoría escrita a mano: la
 * categoría se deriva de la temporada (ver src/lib/categories.ts). Si se
 * escribiese a mano, el 1 de septiembre siguiente está desactualizada y el
 * tirador se pierde media temporada de torneos.
 *
 * RGPD: en España un menor de 14 años no puede consentir el tratamiento por sí
 * mismo. Por eso la cuenta puede estar a nombre del tutor (`guardianUserId`) y
 * el tirador ser un perfil vinculado sin cuenta propia. Un tutor puede tener
 * varios hijos colgando de la misma cuenta.
 */
export const athlete = pgTable(
  'athlete',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Perfil propio del tirador, si tiene cuenta (mayores de 14). */
    userProfileId: uuid('user_profile_id').references(() => userProfile.id, {
      onDelete: 'set null',
    }),
    /** Perfil del padre/tutor que gestiona al tirador, si es menor. */
    guardianProfileId: uuid('guardian_profile_id').references(() => userProfile.id, {
      onDelete: 'set null',
    }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthDate: date('birth_date').notNull(),
    gender: genderEnum('gender').notNull(),
    clubId: uuid('club_id').references(() => club.id, { onDelete: 'set null' }),
    /** Número de licencia RFEE. Es la clave con la que se emparejan los
     *  resultados ingeridos de Skermo. Nunca se empareja por nombre. */
    rfeeLicense: text('rfee_license'),
    fieLicense: text('fie_license'),
    fieLicenseValidUntil: date('fie_license_valid_until'),
    rfeeLicenseValidUntil: date('rfee_license_valid_until'),
    /** Consentimiento de tratamiento firmado (por el tutor si es menor). */
    consentSignedAt: timestamp('consent_signed_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('athlete_rfee_license_key').on(t.rfeeLicense),
    index('athlete_club_idx').on(t.clubId),
    index('athlete_guardian_idx').on(t.guardianProfileId),
  ],
);

/** Un tirador puede competir en más de un arma. */
export const athleteWeapon = pgTable(
  'athlete_weapon',
  {
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id, { onDelete: 'cascade' }),
    weapon: weaponEnum('weapon').notNull(),
    primary: boolean('is_primary').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.athleteId, t.weapon] })],
);

export const season = pgTable('season', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** "2026-2027" */
  label: text('label').notNull().unique(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  current: boolean('is_current').notNull().default(false),
});

/**
 * Categorías y años de nacimiento por temporada. Es DATOS, no código: lo edita
 * el admin una vez al año a partir de la circular de categorías de la RFEE.
 *
 * `birthYearMin`/`birthYearMax` son inclusivos. Con la fecha de nacimiento del
 * tirador y esta tabla sale "puedes tirar M17, M20 y ABS".
 */
export const seasonCategory = pgTable(
  'season_category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    code: categoryEnum('code').notNull(),
    birthYearMin: smallint('birth_year_min'),
    birthYearMax: smallint('birth_year_max'),
    /** Orden ascendente de edad: M13=1 … VET=6. Sirve para "puedes subir de
     *  categoría pero no bajar". */
    rank: integer('rank').notNull(),
    /** VET no encaja en "subir de categoría": se sale de la escalera. */
    laddered: boolean('is_laddered').notNull().default(true),
    sourceDocument: text('source_document'),
    sourceUrl: text('source_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedByProfileId: uuid('updated_by_profile_id').references(() => userProfile.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [unique('season_category_key').on(t.seasonId, t.code)],
);

/**
 * Armas de las que se ocupa un perfil.
 *
 * Solo tiene sentido para los seleccionadores (`role = 'coach'`): define qué
 * tiradores ve por defecto al entrar. Es una tabla y no una columna porque un
 * mismo entrenador puede llevar florete y espada, y porque así el admin puede
 * cambiarlo sin tocar el rol.
 */
export const profileWeapon = pgTable(
  'profile_weapon',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    weapon: weaponEnum('weapon').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.weapon] })],
);
