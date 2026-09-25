import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  entry,
  event,
  eventCompetition,
  eventDeadline,
  eventDocument,
  liveSource,
  notification,
  userProfile,
} from '@/db/schema';
import { sha256 } from '../utils';
import type { NormalizedEvent } from './types';

export type UpsertStats = {
  created: number;
  updated: number;
  unchanged: number;
  competitionsCreated: number;
  competitionsUpdated: number;
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
  const documentInserts: (typeof eventDocument.$inferInsert)[] = [];
  const liveInserts: (typeof liveSource.$inferInsert)[] = [];
  /** Plazos publicados por la fuente; se resuelven tras insertar las pruebas. */
  const publishedDeadlines: {
    eventId: string;
    competitionKey: string;
    closeDate: string;
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

      if (c.registrationCloseDate) {
        publishedDeadlines.push({
          eventId,
          competitionKey: key,
          closeDate: c.registrationCloseDate,
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
   * El cierre que publica la fuente se guarda como plazo de origen PUBLICADO,
   * que gana sobre cualquier estimación calculada con `deadline_rule`.
   *
   * Skermo publica UNA sola fecha ("Fin inscripciones"), sin recargos ni
   * plazos escalonados —se comprobó enumerando todas las etiquetas del DOM—,
   * así que se registra como L1 sin importe. Los recargos vienen de la tabla
   * de normativa, porque solo existen dentro de circulares en PDF.
   */
  const deadlineInserts = publishedDeadlines
    .map((d) => {
      const competition = existingCompetitions.get(d.competitionKey);
      if (!competition) return null;
      return {
        eventId: d.eventId,
        eventCompetitionId: competition.id,
        type: 'L1' as const,
        deadlineAt: new Date(`${d.closeDate}T23:59:59+02:00`),
        surchargeEur: null,
        blocking: false,
        origin: 'PUBLICADO' as const,
        sourceDocument: 'Calendario oficial (fuente)',
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
