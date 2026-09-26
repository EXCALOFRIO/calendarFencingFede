import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { athlete } from './core';
import {
  categoryEnum,
  fieLinkStatusEnum,
  genderEnum,
  weaponEnum,
} from './enums';

/**
 * FICHA DE UN TIRADOR EN LA FIE.
 *
 * -------------------------------------------------------------------------
 * LÍMITE LEGAL, y es el motivo de que esta tabla sea tan corta
 * -------------------------------------------------------------------------
 * Los términos de la FIE permiten ENLAZAR su contenido, no almacenarlo ni
 * rehospedarlo. Igual que en `src/lib/ingest/sources/fie.ts`, aquí se guarda
 * el mínimo imprescindible para poder enlazar:
 *
 *   - el identificador (`fie_id`), que es lo que construye la URL de su ficha,
 *   - la DIRECCIÓN de la foto (`photo_url`), nunca el archivo,
 *   - y los datos de HECHO que hacen falta para emparejar y para contar algo
 *     verdadero (nombre publicado, fecha de nacimiento, país, mano).
 *
 * De lo que devuelve `GET https://fie.org/api/fie/fencer/<id>` NO se copia:
 * `biography`, `graceNoteBiography` (una biografía redactada, con autoría de
 * un tercero), `medals`, `futureCompetitions`, `fencerBiography`, `introUrl`
 * ni patrocinadores. Son prosa y son su base de datos de resultados; nada de
 * eso hace falta para enseñar una foto y un puesto.
 *
 * LA FOTO NO SE COPIA A R2. Se guarda `photo_url` apuntando a
 * `static.fie.org` y la pide el navegador del usuario, igual que la pediría
 * visitando fie.org. Si la FIE la retira, desaparece también aquí, que es el
 * comportamiento correcto. Descargarla a nuestro almacenamiento sería
 * rehospedarla, y eso es exactamente lo que sus términos prohíben.
 *
 * -------------------------------------------------------------------------
 * EL EMPAREJADO, que es lo que condiciona el diseño
 * -------------------------------------------------------------------------
 * La FIE publica un `licenseNumber` propio ("26041992000"), que NO es el
 * número de licencia de la RFEE ("CLF01835"): es la fecha de nacimiento en
 * DDMMAAAA más tres dígitos. Comprobado en vivo el 26/09/2026 con las dos
 * fichas reales de la aplicación. Es decir: **no hay ningún identificador
 * común entre la FIE y la RFEE**.
 *
 * Por eso `athlete_id` solo se rellena de dos maneras, y ninguna es por
 * nombre: o `athlete.fie_license` ya coincide con el `licenseNumber` de la
 * FIE, o lo confirma una persona. El candidato propuesto vive aparte, en
 * `proposed_athlete_id`, y no lo lee nadie más que la cola de revisión.
 */
export const fieFencer = pgTable(
  'fie_fencer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `addrId` de la FIE. Es la clave estable y la que forma la URL pública. */
    fieId: integer('fie_id').notNull(),
    /**
     * Nuestro tirador. Relleno SOLO si el enlace está confirmado (ver
     * `fie_link_status`). Un null aquí significa "todavía no lo sabemos", que
     * es muy distinto de "no está en la FIE".
     */
    athleteId: uuid('athlete_id').references(() => athlete.id, {
      onDelete: 'set null',
    }),
    /**
     * Candidato que propone la ingestión, para que una persona lo mire. NO es
     * un enlace: nada de la aplicación lee de aquí para enseñar una foto.
     */
    proposedAthleteId: uuid('proposed_athlete_id').references(() => athlete.id, {
      onDelete: 'set null',
    }),
    linkStatus: fieLinkStatusEnum('link_status').notNull().default('PROPUESTO'),
    /** `licencia_fie` o `persona`. Queda escrito quién decidió el enlace. */
    linkedVia: text('linked_via'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    /**
     * Por qué se propone, en una frase legible. Se enseña tal cual en la cola
     * de revisión: quien confirma tiene que poder ver la evidencia sin abrir
     * la consola.
     */
    matchEvidence: text('match_evidence'),
    /** Tal y como lo publica la FIE: "LLAVADOR Carlos", al revés y en mayúsculas. */
    sourceName: text('source_name').notNull(),
    sourceFirstName: text('source_first_name'),
    sourceLastName: text('source_last_name'),
    /** ISO-3166 alfa-3, como lo da la FIE ("ESP"). */
    countryCode: text('country_code'),
    sourceBirthDate: date('source_birth_date'),
    /** "L" zurdo, "R" diestro. Dato publicado, no deducido. */
    hand: text('hand'),
    /** Dirección en `static.fie.org`. NUNCA el archivo. */
    photoUrl: text('photo_url'),
    /** Su ficha en fie.org. Se enlaza siempre desde la interfaz. */
    profileUrl: text('profile_url').notNull(),
    /** El `licenseNumber` de la FIE (DDMMAAAA + 3 dígitos). No es el de la RFEE. */
    fieLicense: text('fie_license'),
    /** "Valid" / "Expired", tal y como lo publica la FIE. */
    fieLicenseStatus: text('fie_license_status'),
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('fie_fencer_key').on(t.fieId),
    index('fie_fencer_athlete_idx').on(t.athleteId),
    index('fie_fencer_pendiente_idx').on(t.linkStatus, t.proposedAthleteId),
  ],
);

/**
 * PUESTO EN EL RANKING MUNDIAL, por temporada.
 *
 * Solo hechos publicados: el puesto, los puntos, la temporada y cuántas
 * pruebas le puntúan. Nada calculado por nosotros: un número inventado con
 * pinta de oficial es peor que no enseñar nada.
 *
 * Dos orígenes, los dos de la FIE:
 *  - la temporada en curso, de `/api/fie/fencers/ranking?country=ESP`, que ya
 *    trae puesto, puntos y foto en una sola petición;
 *  - el histórico, del array `ranking` de `/api/fie/fencer/<id>`, que publica
 *    el puesto de cada temporada desde 2009. Eso es lo que permite decir
 *    "su mejor puesto mundial fue 11.º en 2025" sin calcular nada.
 *
 * `event_count` sale de `competitionPoints` de
 * `/api/fie/fencers/detailed-ranking`, y solo se pide para los tiradores YA
 * enlazados: no tiene sentido gastar peticiones en un candidato sin confirmar.
 * Por eso en las temporadas viejas viene a null, y null significa "no lo
 * hemos pedido", no "cero pruebas".
 */
export const fieWorldRanking = pgTable(
  'fie_world_ranking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieId: integer('fie_id').notNull(),
    /** Temporada FIE, etiquetada con el año final (2027 = 2026-2027). */
    season: integer('season').notNull(),
    weapon: weaponEnum('weapon').notNull(),
    gender: genderEnum('gender').notNull(),
    category: categoryEnum('category').notNull(),
    /** Literal de la FIE: "S", "J", "C", "V". */
    categoryRaw: text('category_raw').notNull(),
    /** Tramo de edad en veteranos ("40-49"). Solo lo publica en categoría V. */
    ageBand: text('age_band'),
    /** Puesto mundial. `null` si aparece en la lista pero sin puesto. */
    position: integer('position'),
    /** La FIE publica tres decimales ("0.375"), así que no se redondea. */
    points: numeric('points', { precision: 10, scale: 3 }),
    /** Nº de pruebas que le puntúan esa temporada. `null` = no se ha pedido. */
    eventCount: integer('event_count'),
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
     * La clave natural. Se incluye el género porque el histórico de la ficha
     * no lo trae por fila —lo hereda del tirador—, y sin él dos armas del
     * mismo año podrían colisionar el día que la FIE publique mixtos.
     */
    unique('fie_world_ranking_key').on(
      t.fieId,
      t.season,
      t.weapon,
      t.gender,
      t.categoryRaw,
    ),
    index('fie_world_ranking_fencer_idx').on(t.fieId, t.season),
  ],
);
