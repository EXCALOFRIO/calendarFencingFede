import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  competitionRegistration,
  entry,
  event,
  eventCompetition,
  eventDeadline,
  eventDocument,
  liveSource,
  notification,
  sportRegistrationRef,
  userProfile,
} from '@/db/schema';
import { cargarEvidencia } from '@/lib/entries/evidencia';
import { depsEvidenciaDb } from '@/lib/entries/evidencia-db';
import {
  identificarObservacion,
  refsPublicadas,
  type RefPublicada,
} from '@/lib/entries/identidad';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import { parseFechaMadrid } from '../callups/fechas';
import { sha256 } from '../utils';
import type { NormalizedEvent } from './types';

export type UpsertStats = {
  created: number;
  updated: number;
  unchanged: number;
  competitionsCreated: number;
  competitionsUpdated: number;
  /** Inscritos publicados por la fuente que se han leído en esta pasada. */
  registrationsSeen: number;
  /** De esos, cuántos han casado con un tirador nuestro POR LICENCIA. */
  registrationsMatched: number;
  /** Los que ya no figuran en la lista oficial: se marcan, no se borran. */
  registrationsWithdrawn: number;
  notificationsQueued: number;
  /** Cambios detectados, para poder enseñarlos en el panel de admin. */
  changes: ChangeRecord[];
};

export type ChangeRecord = {
  eventName: string;
  eventId: string;
  field: string;
  before: string | null;
  after: string | null;
};

/**
 * Hash del contenido relevante de un evento.
 *
 * Se incluyen solo los campos cuyo cambio le importa a alguien. `lastSeenAt` o
 * el nº de inscritos quedan fuera a propósito: si entraran, el hash cambiaría
 * todos los días y la comprobación de idempotencia no valdría para nada.
 *
 * `timezone` SÍ entra, aunque sea un valor derivado del país y no algo que
 * publique la fuente. Estaba fuera y eso tenía una consecuencia que costó
 * encontrar: al ampliar la tabla de husos, los eventos ya guardados no se
 * actualizaban nunca —su hash no había cambiado—, así que Perú, Baréin o
 * Costa Rica seguían sin huso indefinidamente mientras los eventos nuevos del
 * mismo país sí lo tenían. Con él dentro, mejorar la tabla arregla el pasado
 * en la siguiente pasada. No dispara avisos por correo: `timezone` no está en
 * `NOTIFIABLE_FIELDS`.
 */
async function eventContentHash(e: NormalizedEvent): Promise<string> {
  return sha256(
    JSON.stringify([
      e.name,
      e.startDate,
      e.endDate,
      e.venue,
      e.venueAddress,
      e.city,
      e.country,
      e.timezone,
      e.circuit,
      e.scope,
      e.officialSite,
    ]),
  );
}

async function competitionContentHash(
  c: NormalizedEvent['competitions'][number],
): Promise<string> {
  return sha256(
    JSON.stringify([
      c.weapon,
      c.gender,
      c.category,
      c.format,
      c.competitionDate,
      c.installationOpen,
      c.callTime,
      c.scratchTime,
      c.startTime,
      c.feeEur,
      c.registrationCloseDate,
    ]),
  );
}

/** Campos que, si cambian, merecen un email a quien esté inscrito. */
const NOTIFIABLE_FIELDS: Record<string, string> = {
  startDate: 'la fecha de inicio',
  endDate: 'la fecha de fin',
  venue: 'el pabellón',
  venueAddress: 'la dirección',
  city: 'la sede',
  callTime: 'la hora de llamada',
  startTime: 'la hora de inicio',
  competitionDate: 'el día de la prueba',
};

/**
 * Se queda con la primera aparición de cada clave. Hace falta porque Postgres
 * aborta un `ON CONFLICT DO UPDATE` cuando la misma sentencia intenta tocar la
 * misma fila dos veces.
 */
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Trocea para no mandar un INSERT gigante en una sola petición HTTP. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Guarda una tanda de eventos normalizados.
 *
 * Reglas de negocio:
 * - Clave estable (`source`, `source_id`); nunca se duplica entre ejecuciones.
 * - Si el `content_hash` no cambió, la fila no se toca (solo `last_seen_at`) y
 *   no se dispara ninguna notificación. Esto es lo que hace que ejecutar el
 *   mismo scrape dos veces seguidas deje `updated = 0` la segunda vez.
 * - Si cambió algo que le importa a alguien inscrito, se encola un email.
 *   Aquí está el valor real de raspar todos los días.
 *
 * Nota de rendimiento, que aquí no es un capricho: el driver de Neon habla por
 * HTTP, así que **cada consulta es un viaje de red**. La primera versión hacía
 * un SELECT por evento y otro por prueba: más de mil viajes y 116 segundos
 * para un solo calendario. Con once federaciones autonómicas eso se sale del
 * límite de 300 s de una función en Vercel. Por eso se precarga TODO lo
 * existente en dos consultas y se compara en memoria.
 */
export async function upsertEvents(events: NormalizedEvent[]): Promise<UpsertStats> {
  const stats: UpsertStats = {
    created: 0,
    updated: 0,
    unchanged: 0,
    competitionsCreated: 0,
    competitionsUpdated: 0,
    registrationsSeen: 0,
    registrationsMatched: 0,
    registrationsWithdrawn: 0,
    notificationsQueued: 0,
    changes: [],
  };

  if (events.length === 0) return stats;

  const source = events[0].source;
  const sourceIds = events.map((e) => e.sourceId);

  // --- 1. Precarga: una consulta para los eventos existentes de esta tanda ---
  const existingEvents = new Map<string, typeof event.$inferSelect>();
  for (const batch of chunk(sourceIds, 500)) {
    const rows = await db
      .select()
      .from(event)
      .where(and(eq(event.source, source), inArray(event.sourceId, batch)));
    for (const row of rows) existingEvents.set(row.sourceId, row);
  }

  // --- 2. Precarga: una consulta para todas sus pruebas ---
  const existingEventIds = [...existingEvents.values()].map((e) => e.id);
  const existingCompetitions = new Map<string, typeof eventCompetition.$inferSelect>();
  for (const batch of chunk(existingEventIds, 300)) {
    if (batch.length === 0) continue;
    const rows = await db
      .select()
      .from(eventCompetition)
      .where(inArray(eventCompetition.eventId, batch));
    for (const row of rows) {
      existingCompetitions.set(competitionKey(row.eventId, row), row);
    }
  }

  const now = new Date();

  // --- 3. Eventos: separar altas de modificaciones ---
  const toInsert: (typeof event.$inferInsert)[] = [];
  const toUpdate: { id: string; values: Partial<typeof event.$inferInsert> }[] = [];
  const touched: string[] = [];
  const pendingChanges: ChangeRecord[] = [];
  /** sourceId -> datos normalizados, para la segunda pasada. */
  const bySourceId = new Map<string, NormalizedEvent>();

  for (const normalized of events) {
    bySourceId.set(normalized.sourceId, normalized);
    const contentHash = await eventContentHash(normalized);
    const existing = existingEvents.get(normalized.sourceId);

    const values = {
      source: normalized.source,
      sourceId: normalized.sourceId,
      sourceUrl: normalized.sourceUrl,
      name: normalized.name,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      venue: normalized.venue,
      venueAddress: normalized.venueAddress,
      city: normalized.city,
      country: normalized.country,
      timezone: normalized.timezone,
      officialSite: normalized.officialSite,
      imageUrl: normalized.imageUrl,
      circuit: normalized.circuit,
      scope: normalized.scope,
      regionalFederation: normalized.regionalFederation,
      contentHash,
      sourceModifiedAt: normalized.sourceModifiedAt,
      notes: normalized.notes,
      lastSeenAt: now,
      // Si había desaparecido del calendario y vuelve, se reactiva.
      disappearedAt: null,
    } satisfies typeof event.$inferInsert;

    if (!existing) {
      toInsert.push(values);
      stats.created += 1;
    } else if (existing.contentHash === contentHash) {
      touched.push(existing.id);
      stats.unchanged += 1;
    } else {
      for (const field of Object.keys(NOTIFIABLE_FIELDS)) {
        const before = (existing as Record<string, unknown>)[field];
        const after = (values as Record<string, unknown>)[field];
        if (before !== undefined && after !== undefined && before !== after) {
          pendingChanges.push({
            eventName: normalized.name,
            eventId: existing.id,
            field,
            before: before === null ? null : String(before),
            after: after === null ? null : String(after),
          });
        }
      }
      toUpdate.push({ id: existing.id, values });
      stats.updated += 1;
    }
  }

  // Altas en lote.
  const insertedIds = new Map<string, string>();
  for (const batch of chunk(toInsert, 100)) {
    const rows = await db
      .insert(event)
      .values(batch)
      .onConflictDoUpdate({
        target: [event.source, event.sourceId],
        set: { lastSeenAt: now },
      })
      .returning({ id: event.id, sourceId: event.sourceId });
    for (const row of rows) insertedIds.set(row.sourceId, row.id);
  }

  // Modificaciones: normalmente son pocas o ninguna.
  for (const item of toUpdate) {
    await db.update(event).set(item.values).where(eq(event.id, item.id));
  }

  // Los que no cambiaron: un solo UPDATE con IN, no uno por fila.
  for (const batch of chunk(touched, 500)) {
    if (batch.length === 0) continue;
    await db
      .update(event)
      .set({ lastSeenAt: now, disappearedAt: null })
      .where(inArray(event.id, batch));
  }

  // --- 4. Pruebas, documentos y enlaces ---
  const eventIdBySourceId = new Map<string, string>();
  for (const [sourceId, row] of existingEvents) eventIdBySourceId.set(sourceId, row.id);
  for (const [sourceId, id] of insertedIds) eventIdBySourceId.set(sourceId, id);

  const competitionInserts: (typeof eventCompetition.$inferInsert)[] = [];
  const competitionUpdates: {
    id: string;
    values: Partial<typeof eventCompetition.$inferInsert>;
  }[] = [];
  const competitionTouched: { id: string; registrationCount: number | null }[] = [];
  /**
   * Listas nominales de inscritos, por prueba. Solo entran las pruebas cuya
   * fuente publica la lista (`registrations !== null`); con `null` no se toca
   * nada, que es lo que hace falta con la FIE.
   */
  const registrationBatches: {
    competitionKey: string;
    source: NormalizedEvent['source'];
    sourceUrl: string | null;
    rows: NonNullable<NormalizedEvent['competitions'][number]['registrations']>;
  }[] = [];
  const documentInserts: (typeof eventDocument.$inferInsert)[] = [];
  const liveInserts: (typeof liveSource.$inferInsert)[] = [];
  /** Plazos publicados por la fuente; se resuelven tras insertar las pruebas. */
  const publishedDeadlines: {
    eventId: string;
    competitionKey: string;
    closeDate: string;
    scope: NormalizedEvent['scope'];
    sourceUrl: string | null;
  }[] = [];

  for (const [sourceId, normalized] of bySourceId) {
    const eventId = eventIdBySourceId.get(sourceId);
    if (!eventId) continue;

    for (const c of normalized.competitions) {
      const contentHash = await competitionContentHash(c);
      const key = competitionKey(eventId, c);
      const existing = existingCompetitions.get(key);

      const values = {
        eventId,
        weapon: c.weapon,
        gender: c.gender,
        category: c.category,
        categoryRaw: c.categoryRaw,
        format: c.format,
        competitionDate: c.competitionDate,
        installationOpen: c.installationOpen,
        callTime: c.callTime,
        scratchTime: c.scratchTime,
        startTime: c.startTime,
        registrationCount: c.registrationCount,
        feeEur: c.feeEur,
        sourceId: c.sourceId,
        sourceUrl: c.sourceUrl,
        contentHash,
        lastSeenAt: now,
      } satisfies typeof eventCompetition.$inferInsert;

      if (!existing) {
        competitionInserts.push(values);
        stats.competitionsCreated += 1;
      } else if (existing.contentHash !== contentHash) {
        const label = `${c.weapon} ${c.gender} ${c.category}`;
        for (const field of ['callTime', 'startTime', 'competitionDate'] as const) {
          if (existing[field] !== values[field]) {
            pendingChanges.push({
              eventName: `${normalized.name} · ${label}`,
              eventId,
              field,
              before: existing[field] === null ? null : String(existing[field]),
              after: values[field] === null ? null : String(values[field]),
            });
          }
        }
        competitionUpdates.push({ id: existing.id, values });
        stats.competitionsUpdated += 1;
      } else {
        // El nº de inscritos cambia a diario y no entra en el hash a propósito,
        // pero sí interesa tenerlo al día.
        competitionTouched.push({
          id: existing.id,
          registrationCount: c.registrationCount,
        });
      }

      if (c.registrations !== null) {
        registrationBatches.push({
          competitionKey: key,
          source: normalized.source,
          sourceUrl: c.sourceUrl,
          rows: c.registrations,
        });
      }

      if (c.registrationCloseDate) {
        publishedDeadlines.push({
          eventId,
          competitionKey: key,
          closeDate: c.registrationCloseDate,
          scope: normalized.scope,
          sourceUrl: c.sourceUrl,
        });
      }
    }

    for (const doc of normalized.documents) {
      documentInserts.push({
        eventId,
        title: doc.title,
        url: doc.url,
        kind: doc.kind,
      });
    }

    for (const link of normalized.liveLinks) {
      liveInserts.push({
        eventId,
        platform: link.platform,
        kind: link.kind,
        url: link.url,
        label: link.label,
        automatic: true,
      });
    }
  }

  /**
   * Postgres rechaza un `ON CONFLICT DO UPDATE` si la misma sentencia trae dos
   * filas con la misma clave ("cannot affect row a second time"). Y Skermo sí
   * produce duplicados: un mismo torneo puede tener dos filas con idéntico
   * arma+género+categoría+modalidad (por ejemplo, dos jornadas el mismo fin de
   * semana). Se queda la primera, que es la que da la fuente primero.
   */
  const dedupedCompetitions = dedupeBy(competitionInserts, (c) =>
    competitionKey(c.eventId, {
      weapon: c.weapon,
      gender: c.gender,
      category: c.category,
      format: c.format ?? 'INDIVIDUAL',
    }),
  );

  for (const batch of chunk(dedupedCompetitions, 150)) {
    const rows = await db
      .insert(eventCompetition)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          eventCompetition.eventId,
          eventCompetition.weapon,
          eventCompetition.gender,
          eventCompetition.category,
          eventCompetition.format,
        ],
        set: { lastSeenAt: now },
      })
      .returning({
        id: eventCompetition.id,
        eventId: eventCompetition.eventId,
        weapon: eventCompetition.weapon,
        gender: eventCompetition.gender,
        category: eventCompetition.category,
        format: eventCompetition.format,
      });
    // Solo se necesita el id para poder colgar después los plazos publicados;
    // el resto de columnas no se usa, así que no se piden de vuelta.
    for (const row of rows) {
      existingCompetitions.set(
        competitionKey(row.eventId, row),
        row as unknown as typeof eventCompetition.$inferSelect,
      );
    }
  }

  for (const item of competitionUpdates) {
    await db
      .update(eventCompetition)
      .set(item.values)
      .where(eq(eventCompetition.id, item.id));
  }

  // Los recuentos de inscritos se agrupan por valor: así, en vez de 400
  // UPDATE, salen tantos como valores distintos haya.
  const byCount = new Map<number | null, string[]>();
  for (const item of competitionTouched) {
    const list = byCount.get(item.registrationCount) ?? [];
    list.push(item.id);
    byCount.set(item.registrationCount, list);
  }
  for (const [count, ids] of byCount) {
    for (const batch of chunk(ids, 500)) {
      await db
        .update(eventCompetition)
        .set({ registrationCount: count, lastSeenAt: now })
        .where(inArray(eventCompetition.id, batch));
    }
  }

  for (const batch of chunk(documentInserts, 200)) {
    await db
      .insert(eventDocument)
      .values(batch)
      .onConflictDoNothing({ target: [eventDocument.eventId, eventDocument.url] });
  }

  for (const batch of chunk(liveInserts, 200)) {
    await db
      .insert(liveSource)
      .values(batch)
      .onConflictDoNothing({
        target: [liveSource.eventId, liveSource.eventCompetitionId, liveSource.url],
      });
  }

  /**
   * LISTA NOMINAL DE INSCRITOS.
   *
   * Se escribe después de las pruebas porque hace falta su `id`, y siempre en
   * lote: son 2.176 filas en la pasada de la RFEE y el driver de Neon es HTTP.
   *
   * El emparejado con nuestros tiradores es por IDENTIFICADOR de la FIE o por
   * LICENCIA, nunca por nombre. Skermo no publica ninguno de los dos en esta
   * pantalla, así que sus filas entran con `athlete_id = null` y las resuelve
   * el puente por el ranking o una persona; las listas de la FIE sí traen
   * identificador y licencia y se emparejan solas. Lo que no se hace jamás es
   * decidir quién es alguien por su nombre: decirle a alguien "ya estás
   * inscrito" porque coincide con su homónimo es cómo se pierde un torneo.
   */
  const registrationStats = await upsertRegistrations(
    registrationBatches,
    existingCompetitions,
    now,
  );
  stats.registrationsSeen = registrationStats.seen;
  stats.registrationsMatched = registrationStats.matched;
  stats.registrationsWithdrawn = registrationStats.withdrawn;

  /**
   * El cierre que publica la fuente se guarda como plazo de origen PUBLICADO,
   * que gana sobre cualquier estimación calculada con `deadline_rule`.
   *
   * Skermo publica UNA sola fecha ("Fin inscripciones"), sin recargos ni
   * plazos escalonados —se comprobó enumerando todas las etiquetas del DOM—,
   * así que se registra como L1 sin importe. Los recargos vienen de la tabla
   * de normativa, porque solo existen dentro de circulares en PDF.
   */
  /**
   * A qué hora cierra un plazo del que la fuente solo publica el DÍA.
   *
   * Skermo publica «Fin inscripciones» como una fecha sin hora. Antes se
   * guardaba como `T23:59:59+02:00`, y eso tenía dos fallos, los dos con
   * consecuencia práctica:
   *
   * 1. **El desfase estaba escrito a mano.** `+02:00` es el horario de verano
   *    español; de finales de octubre a finales de marzo España está en
   *    `+01:00`, así que todos los plazos de invierno se guardaban una hora
   *    tarde.
   * 2. **Las 23:59 son un dato inventado, y en lo nacional está contradicho.**
   *    La Circular 12-26 de la RFEE dice, literalmente: «el plazo de
   *    inscripción finaliza el viernes de la semana anterior a la competición a
   *    las 12:00 h». Guardar las 23:59 le regalaba al tirador casi doce horas
   *    de margen que no existen, justo el día en que el margen importa.
   *
   * Así que en lo nacional, cuando el día publicado ES un viernes —que es lo
   * que dice la norma, y son 32 de los 36 plazos nacionales—, se cierra a las
   * 12:00 y se cita la circular. En cualquier otro caso no se sabe la hora y se
   * toma el final del día, que es lo que significa una fecha suelta usada como
   * plazo; el texto de procedencia lo dice para que no parezca un dato firme.
   */
  function horaDeCierre(
    closeDate: string,
    scope: NormalizedEvent['scope'],
  ): { instante: Date; hora: string } {
    const dia = new Date(`${closeDate.slice(0, 10)}T00:00:00Z`).getUTCDay();
    const esViernes = dia === 5;

    if (scope === 'NACIONAL' && esViernes) {
      return {
        instante: parseFechaMadrid(`${closeDate.slice(0, 10)}T12:00`) as Date,
        hora: 'Calendario oficial',
      };
    }
    return {
      instante: parseFechaMadrid(`${closeDate.slice(0, 10)}T23:59`) as Date,
      hora: 'Calendario oficial · hora no publicada',
    };
  }

  const deadlineInserts = publishedDeadlines
    .map((d) => {
      const competition = existingCompetitions.get(d.competitionKey);
      if (!competition) return null;
      const { instante, hora } = horaDeCierre(d.closeDate, d.scope);
      return {
        eventId: d.eventId,
        eventCompetitionId: competition.id,
        type: 'L1' as const,
        deadlineAt: instante,
        surchargeEur: null,
        blocking: false,
        origin: 'PUBLICADO' as const,
        sourceDocument: hora,
        sourceUrl: d.sourceUrl,
        updatedAt: now,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const dedupedDeadlines = dedupeBy(
    deadlineInserts,
    (d) => `${d.eventId}|${d.eventCompetitionId}|${d.type}`,
  );

  for (const batch of chunk(dedupedDeadlines, 200)) {
    await db
      .insert(eventDeadline)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          eventDeadline.eventId,
          eventDeadline.eventCompetitionId,
          eventDeadline.type,
        ],
        set: {
          // `excluded` es la fila que se intentaba insertar: así, si la fuente
          // mueve el cierre, el plazo guardado se actualiza en vez de ignorarse.
          deadlineAt: sql`excluded."deadline_at"`,
          origin: 'PUBLICADO',
          updatedAt: now,
        },
      });
  }

  // --- 5. Avisos, al final y una sola vez ---
  stats.changes = pendingChanges;
  if (pendingChanges.length > 0) {
    stats.notificationsQueued = await queueChangeNotifications(pendingChanges);
  }

  return stats;
}

function competitionKey(
  eventId: string,
  c: { weapon: string; gender: string; category: string; format: string },
): string {
  return `${eventId}|${c.weapon}|${c.gender}|${c.category}|${c.format}`;
}

/**
 * Una fila de lista oficial, tal y como la entrega un adaptador.
 *
 * `sourceFieId` es el `fencer.id` de la FIE. No va en `competition_registration`
 * (esa tabla no cambia), pero sí se retiene en `sport_registration_ref` cuando
 * esa tabla existe, junto con la licencia, su ámbito y el día: sirve para
 * emparejar contra `fie_fencer.fie_id` y contra los IDs externos confirmados.
 */
export type FilaDeListaOficial = {
  sourceAthleteName: string;
  sourceTeam: string;
  sourceLicense?: string | null;
  sourceClub?: string | null;
  /** Día de inscripción publicado por la fuente, si lo publica. */
  sourceRegisteredAt?: string | null;
  /** Identificador de la FIE; se retiene como referencia con ámbito, no como nombre. */
  sourceFieId?: number | null;
};

/**
 * Guarda las listas nominales publicadas por la fuente.
 *
 * Idempotente por `(prueba, nombre, equipo)`: repetir la ingestión no duplica
 * ni una fila. Quien deja de figurar en la lista se marca con `withdrawn_at`
 * en vez de borrarse, porque "me han quitado de la lista oficial" es
 * exactamente lo que hay que poder contarle a alguien.
 */
async function upsertRegistrations(
  batches: {
    competitionKey: string;
    source: NormalizedEvent['source'];
    sourceUrl: string | null;
    rows: FilaDeListaOficial[];
  }[],
  competitions: Map<string, typeof eventCompetition.$inferSelect>,
  now: Date,
): Promise<{ seen: number; matched: number; withdrawn: number }> {
  if (batches.length === 0) return { seen: 0, matched: 0, withdrawn: 0 };

  const porPrueba: ListaDeInscritos[] = [];
  for (const batch of batches) {
    const competition = competitions.get(batch.competitionKey);
    if (!competition) continue;
    porPrueba.push({
      eventCompetitionId: competition.id,
      source: batch.source,
      sourceUrl: batch.sourceUrl,
      rows: batch.rows,
    });
  }

  return upsertListasDeInscritos(porPrueba, now);
}

/** Una lista ya resuelta a la prueba concreta a la que pertenece. */
export type ListaDeInscritos = {
  eventCompetitionId: string;
  source: NormalizedEvent['source'];
  sourceUrl: string | null;
  rows: FilaDeListaOficial[];
  /** Día (YYYY-MM-DD) de la prueba: es el día del hecho para ámbitos y vigencias. */
  dia?: string | null;
};

/**
 * Lo mismo, pero con la prueba ya resuelta a su identificador.
 *
 * Existe aparte porque hay dos caminos hasta aquí y comparten TODO lo
 * delicado —el emparejado, la cláusula `ON CONFLICT` con su `coalesce`, las
 * bajas— y eso no puede estar escrito dos veces:
 *
 *  · el calendario, que trae las pruebas a medio insertar y las identifica por
 *    su clave natural (arma+género+categoría+formato);
 *  · la pasada de inscritos de la FIE, que lee las pruebas de la base y ya
 *    tiene el `id` en la mano.
 */
export async function upsertListasDeInscritos(
  listas: ListaDeInscritos[],
  now: Date,
): Promise<{ seen: number; matched: number; withdrawn: number }> {
  const inserts: (typeof competitionRegistration.$inferInsert)[] = [];
  /**
   * Pruebas cuya lista hemos leído de verdad, con la fuente que la publica:
   * solo ahí, y solo de esa fuente, se dan bajas.
   */
  const touched: { id: string; source: NormalizedEvent['source'] }[] = [];

  for (const lista of listas) {
    touched.push({ id: lista.eventCompetitionId, source: lista.source });

    for (const row of lista.rows) {
      inserts.push({
        eventCompetitionId: lista.eventCompetitionId,
        sourceAthleteName: row.sourceAthleteName,
        sourceTeam: row.sourceTeam,
        sourceLicense: row.sourceLicense ?? null,
        sourceClub: row.sourceClub ?? null,
        sourceRegisteredAt: row.sourceRegisteredAt ?? null,
        source: lista.source,
        sourceUrl: lista.sourceUrl,
        lastSeenAt: now,
        withdrawnAt: null,
      });
    }
  }

  if (touched.length === 0) {
    return { seen: 0, matched: 0, withdrawn: 0 };
  }

  let matched = 0;

  /**
   * =========================================================================
   * EMPAREJADO: sólo por lo que la propia fila publicada demuestra
   * =========================================================================
   *
   * Se identifica con las mismas reglas que usa el lector (`identificarObservacion`):
   *
   *  · el ID de la FIE publicado, si coincide con una ficha FIE que una persona
   *    confirmó contra un tirador (`fie_fencer`, CONFIRMADO);
   *  · la licencia publicada (RFEE o FIE: no son el mismo número), si
   *    pertenece a UN solo tirador y estaba vigente el día de la prueba;
   *  · una persona deportiva confirmada, si el esquema está aplicado.
   *
   * Dos candidatos distintos para una misma licencia no se resuelven con «el
   * último que llegó»: la fila se queda sin emparejar. Y **no hay puente por
   * nombre**: antes una cadena de nombre igual en el ranking asignaba ficha, y
   * eso unía homónimos sin prueba. Las filas ya escritas con un `athlete_id`
   * antiguo se conservan tal cual (ver el `coalesce` de abajo); el lector las
   * trata como candidato sin probar, no como identidad.
   */
  const hoy = now.toISOString().slice(0, 10);
  const refsPorFila: RefPublicada[][] = [];
  const diasPorFila: (string | null)[] = [];
  for (const lista of listas) {
    for (const row of lista.rows) {
      refsPorFila.push(
        refsPublicadas({
          fuente: lista.source,
          fieId: row.sourceFieId ?? null,
          licencia: row.sourceLicense ?? null,
          observadoEl: lista.dia ?? hoy,
        }),
      );
      diasPorFila.push(lista.dia ?? hoy);
    }
  }

  const evidencia = await cargarEvidencia(depsEvidenciaDb, refsPorFila.flat());
  for (const [i, row] of inserts.entries()) {
    if (row.athleteId) continue;
    const refs = refsPorFila[i];
    if (refs.length === 0) continue;
    const { athleteId } = identificarObservacion(
      { fuente: row.source, refs, arma: '', dia: diasPorFila[i] },
      evidencia,
    );
    if (athleteId) {
      row.athleteId = athleteId;
      matched += 1;
    }
  }

  const deduped = dedupeBy(
    inserts,
    (r) => `${r.eventCompetitionId}|${r.sourceAthleteName}|${r.sourceTeam}`,
  );

  /** Referencias publicadas, agrupadas por la clave natural de la inscripción. */
  const claveDe = (r: { eventCompetitionId: string; sourceAthleteName: string; sourceTeam?: string }) =>
    `${r.eventCompetitionId}|${r.sourceAthleteName}|${r.sourceTeam ?? ''}`;
  const refsPorClave = new Map<string, Map<string, RefPublicada>>();
  for (const [i, row] of inserts.entries()) {
    const clave = claveDe(row);
    const mapa = refsPorClave.get(clave) ?? new Map<string, RefPublicada>();
    for (const ref of refsPorFila[i]) {
      mapa.set([ref.scheme, ref.value, ref.scopeSource, ref.scopeFederation].join('|'), ref);
    }
    refsPorClave.set(clave, mapa);
  }
  const guardarReferencias = (await esquemaDeportivo()).referencias;

  for (const lote of chunk(deduped, 300)) {
    const guardadas = await db
      .insert(competitionRegistration)
      .values(lote)
      .onConflictDoUpdate({
        target: [
          competitionRegistration.eventCompetitionId,
          competitionRegistration.sourceAthleteName,
          competitionRegistration.sourceTeam,
        ],
        /**
         * `athlete_id` **no se pisa, pero sí se rellena si está vacío**, y esa
         * distinción es la que faltaba.
         *
         * Antes esta cláusula no lo tocaba en absoluto, con un motivo bueno:
         * puede haberlo puesto una persona desde el panel y la fuente nunca lo
         * sabe. Pero tenía una consecuencia que no se veía: **las 2.046 filas
         * ya existían**, así que toda pasada acababa en conflicto y el
         * emparejado recién calculado se tiraba a la basura. Medido después de
         * añadir el puente por el ranking: 0 de 2.046 emparejadas, con el
         * puente funcionando y devolviendo el identificador correcto.
         *
         * Con `coalesce` al revés —lo guardado primero, lo nuevo después— se
         * conservan las dos cosas: lo que decidió una persona manda, y un hueco
         * se llena solo. Y sigue siendo idempotente: una vez relleno, las
         * siguientes pasadas no lo cambian.
         *
         * Lo demás se refresca de la fuente, y se deshace la baja si vuelve a
         * aparecer en la lista.
         */
        set: {
          lastSeenAt: now,
          withdrawnAt: null,
          athleteId: sql`coalesce("competition_registration"."athlete_id", excluded."athlete_id")`,
          sourceUrl: sql`excluded."source_url"`,
          sourceLicense: sql`coalesce(excluded."source_license", "competition_registration"."source_license")`,
          sourceClub: sql`coalesce(excluded."source_club", "competition_registration"."source_club")`,
          /**
           * El día de inscripción, con `excluded` delante: si la FIE lo
           * corrige, manda el de la fuente. Y con `coalesce` para que una
           * pasada de una fuente que no lo publica —Skermo— no borre el que
           * ya estaba escrito.
           */
          sourceRegisteredAt: sql`coalesce(excluded."source_registered_at", "competition_registration"."source_registered_at")`,
        },
      })
      .returning({
        id: competitionRegistration.id,
        eventCompetitionId: competitionRegistration.eventCompetitionId,
        sourceAthleteName: competitionRegistration.sourceAthleteName,
        sourceTeam: competitionRegistration.sourceTeam,
      });

    /**
     * El ID y la licencia que publicó la fuente se guardan aparte, con su
     * ámbito y día, para poder conciliar y corregir después. Sólo si la tabla
     * existe (migración 0018): sin ella la pasada sigue igual que antes.
     */
    if (guardarReferencias) {
      const refs = guardadas.flatMap((g) =>
        [...(refsPorClave.get(claveDe(g))?.values() ?? [])].map((ref) => ({
          registrationId: g.id,
          scheme: ref.scheme,
          value: ref.value,
          scopeSource: ref.scopeSource,
          scopeFederation: ref.scopeFederation,
          scopeSeason: ref.scopeSeason,
          scopeWeapon: ref.scopeWeapon,
          observedOn: ref.observadoEl,
          lastSeenAt: now,
        })),
      );
      for (const parte of chunk(refs, 300)) {
        if (parte.length === 0) continue;
        await db
          .insert(sportRegistrationRef)
          .values(parte)
          .onConflictDoUpdate({
            target: [
              sportRegistrationRef.registrationId,
              sportRegistrationRef.scheme,
              sportRegistrationRef.value,
              sportRegistrationRef.scopeSource,
              sportRegistrationRef.scopeFederation,
              sportRegistrationRef.scopeSeason,
              sportRegistrationRef.scopeWeapon,
            ],
            set: {
              observedOn: sql`excluded."observed_on"`,
              lastSeenAt: now,
            },
          });
      }
    }
  }

  /**
   * Bajas. En vez de comparar listas fila a fila, se aprovecha que a todo lo
   * visto se le acaba de poner `last_seen_at = now`: lo que siga con una marca
   * anterior dentro de una prueba que SÍ hemos leído es que ya no está. Una
   * sola sentencia por lote de pruebas, en vez de una por prueba.
   *
   * Y SOLO DE LA FUENTE QUE SE ACABA DE LEER, que es la parte importante. Una
   * misma prueba puede acabar con la lista de dos publicadores —la de la FIE y
   * la de Skermo del mismo torneo internacional—, y sin este filtro leer una
   * daría de baja a toda la otra: a quien figure en la lista de Skermo se le
   * diría «te han quitado de la lista oficial» porque la FIE, que es otra
   * lista, no lo tiene. Es el aviso peor posible y sería mentira.
   *
   * Para las fuentes de Skermo no cambia nada —cada prueba suya solo tiene su
   * propia lista—, así que esto es un cinturón, no un cambio de conducta.
   */
  let withdrawn = 0;
  const porFuente = new Map<NormalizedEvent['source'], string[]>();
  for (const t of touched) {
    const lista = porFuente.get(t.source) ?? [];
    lista.push(t.id);
    porFuente.set(t.source, lista);
  }
  for (const [fuente, ids] of porFuente) {
    for (const lote of chunk([...new Set(ids)], 300)) {
      const filas = await db
        .update(competitionRegistration)
        .set({ withdrawnAt: now })
        .where(
          and(
            inArray(competitionRegistration.eventCompetitionId, lote),
            eq(competitionRegistration.source, fuente),
            isNull(competitionRegistration.withdrawnAt),
            sql`${competitionRegistration.lastSeenAt} < ${now}`,
          ),
        )
        .returning({ id: competitionRegistration.id });
      withdrawn += filas.length;
    }
  }

  return { seen: deduped.length, matched, withdrawn };
}

/**
 * Encola avisos para quien tenga una inscripción viva en un evento que cambió.
 *
 * No se envía aquí: se encola. El envío lo hace el cron de avisos, para no
 * depender de que la invocación del scraper sobreviva al envío y para poder
 * reintentar sin duplicar (de eso se encarga la clave de deduplicación).
 */
async function queueChangeNotifications(changes: ChangeRecord[]): Promise<number> {
  const byEvent = new Map<string, ChangeRecord[]>();
  for (const c of changes) {
    const list = byEvent.get(c.eventId) ?? [];
    list.push(c);
    byEvent.set(c.eventId, list);
  }

  const eventIds = [...byEvent.keys()];
  if (eventIds.length === 0) return 0;

  const affected = await db
    .select({
      eventId: eventCompetition.eventId,
      email: userProfile.email,
      name: userProfile.fullName,
      entryId: entry.id,
    })
    .from(entry)
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(userProfile, eq(entry.requestedByProfileId, userProfile.id))
    .where(
      and(
        inArray(eventCompetition.eventId, eventIds),
        inArray(entry.status, [
          'pending_club',
          'club_approved',
          'federation_approved',
          'submitted',
        ]),
      ),
    );

  if (affected.length === 0) return 0;

  const rows: (typeof notification.$inferInsert)[] = [];

  for (const person of affected) {
    const eventChanges = byEvent.get(person.eventId) ?? [];
    if (eventChanges.length === 0) continue;

    const eventName = eventChanges[0].eventName;
    const lines = eventChanges.map((c) => {
      const label = NOTIFIABLE_FIELDS[c.field] ?? c.field;
      return `- Ha cambiado ${label}: "${c.before ?? 'sin dato'}" → "${
        c.after ?? 'sin dato'
      }".`;
    });

    const changeHash = await sha256(JSON.stringify(eventChanges));

    rows.push({
      dedupeKey: `event-change:${person.eventId}:${person.entryId}:${changeHash}`,
      toEmail: person.email,
      kind: 'cambio_evento',
      subject: `Cambio en ${eventName}`,
      body:
        `Hola ${person.name}:\n\n` +
        'Han cambiado datos de una competición en la que tienes inscripción.\n\n' +
        `${lines.join('\n')}\n\n` +
        'Puedes comprobarlo en la ficha de la prueba, que enlaza siempre a la ' +
        'fuente oficial.\n',
      relatedEntryId: person.entryId,
      relatedEventId: person.eventId,
    });
  }

  if (rows.length === 0) return 0;

  const inserted = await db
    .insert(notification)
    .values(rows)
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ id: notification.id });

  return inserted.length;
}

/**
 * Marca como desaparecidos los eventos de una fuente que ya no aparecen.
 *
 * No se borran: puede haber inscripciones colgando y hace falta trazabilidad.
 * Un evento que desaparece del calendario oficial casi siempre significa
 * "anulado", y eso es información, no basura que haya que tirar.
 */
export async function markMissingEvents(
  source: string,
  seenSourceIds: string[],
  runStartedAt: Date,
): Promise<number> {
  if (seenSourceIds.length === 0) return 0;

  const result = await db
    .update(event)
    .set({ disappearedAt: runStartedAt })
    .where(
      and(
        eq(event.source, source as never),
        notInArray(event.sourceId, seenSourceIds),
        isNull(event.disappearedAt),
      ),
    )
    .returning({ id: event.id });

  return result.length;
}
