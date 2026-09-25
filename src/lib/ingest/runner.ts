import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  event,
  ingestQuarantine,
  ingestRun,
  notification,
  officialDocument,
} from '@/db/schema';
import { sha256 } from '../utils';
import { recalcularEnlaces } from './enlazar';
import { fetchText } from './fetcher';
import { fetchEfcCalendar } from './sources/efc';
import { currentFieSeason, fetchFieSeason } from './sources/fie';
import { fetchOfficialDocuments } from './sources/rfee-wp';
import { parseSkermoCalendar, skermoCalendarUrl } from './sources/skermo';
import { ingestSkermoResults } from './sources/skermo-results';
import { markMissingEvents, upsertEvents } from './upsert';
import { validateEvents } from './types';
import { storeIngestSnapshot } from '../storage';

export const INGEST_SOURCES = [
  'skermo_rfee',
  'skermo_regional',
  'fie',
  'efc',
  'rfee_wp',
] as const;

export type IngestSource = (typeof INGEST_SOURCES)[number];

export function isIngestSource(value: string): value is IngestSource {
  return (INGEST_SOURCES as readonly string[]).includes(value);
}

/** Trocea para escribir en lote: un INSERT gigante tampoco es buena idea. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const SOURCE_DESCRIPTION: Record<IngestSource, string> = {
  skermo_rfee: 'Calendario nacional de la RFEE en Skermo',
  skermo_regional: 'Calendarios de las federaciones autonómicas en Skermo',
  fie: 'Calendario internacional de la FIE (API JSON pública)',
  efc: 'Circuito europeo de la EFC',
  rfee_wp: 'Circulares oficiales de esgrima.es',
};

/**
 * Federaciones autonómicas que se ingieren en la pasada `skermo_regional`.
 * Los códigos están verificados: uno inválido devuelve HTTP 500 en Skermo.
 */
export const REGIONAL_FEDERATIONS: { code: string; name: string }[] = [
  { code: 'FCE', name: 'Federació Catalana d’Esgrima' },
  { code: 'FME', name: 'Federación de Madrid' },
  { code: 'FECYL', name: 'Federación de Castilla y León' },
  { code: 'FAE', name: 'Federación FAE' },
  { code: 'FVE', name: 'Federación FVE' },
  { code: 'FGE', name: 'Federación Galega' },
  { code: 'FNE', name: 'Federación Navarra' },
  { code: 'FEXE', name: 'Federación de Extremadura' },
  { code: 'FRE', name: 'Federación FRE' },
  { code: 'FCANE', name: 'Federación Canaria' },
  { code: 'FEESCLM', name: 'Federación de Castilla-La Mancha' },
];

export type IngestResult = {
  runId: string;
  source: IngestSource;
  status: 'ok' | 'parcial' | 'error';
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsQuarantined: number;
  notificationsQueued: number;
  durationMs: number;
  error: string | null;
  note: string | null;
};

/**
 * Ejecuta la ingestión de una fuente y deja constancia en `ingest_run`.
 *
 * Nunca lanza: un fallo se registra y se devuelve. Si esto lanzara, la ruta de
 * cron devolvería 500 y nos quedaríamos sin saber qué pasó, que es exactamente
 * el escenario que queremos evitar (un scraper roto pasando desapercibido
 * durante semanas).
 */
export async function runIngest(
  source: IngestSource,
  options: { triggeredBy?: string } = {},
): Promise<IngestResult> {
  const startedAt = new Date();

  const [run] = await db
    .insert(ingestRun)
    .values({
      source,
      startedAt,
      triggeredBy: options.triggeredBy ?? 'cron',
    })
    .returning({ id: ingestRun.id });

  const base: IngestResult = {
    runId: run.id,
    source,
    status: 'ok',
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsQuarantined: 0,
    notificationsQueued: 0,
    durationMs: 0,
    error: null,
    note: null,
  };

  try {
    const result = await dispatch(source, run.id);
    Object.assign(base, result);

    /**
     * DUPLICADOS ENTRE FUENTES. El mismo torneo internacional entra dos veces,
     * una por Skermo y otra por la FIE, con nombres distintos. Después de
     * tocar el calendario se recalcula qué pares son el mismo torneo, para que
     * se pinte una sola tarjeta y el evento de Skermo herede el cartel de la
     * FIE.
     *
     * Se recalcula ENTERO en cada pasada, no incrementalmente: así una sede
     * corregida en la fuente deshace el enlace sola, y volver a lanzar la
     * ingestión no cambia nada. Cuesta tres lecturas en lote.
     *
     * Si falla, la ingestión NO falla: el calendario con duplicados sigue
     * siendo un calendario correcto; se anota y ya está.
     */
    if (source !== 'rfee_wp') {
      try {
        const enlaces = await recalcularEnlaces();
        const partes = [
          `${enlaces.enlazados} registros de la FIE unidos a su torneo de Skermo`,
          `${enlaces.cartelesHeredados} eventos heredan cartel`,
        ];
        if (enlaces.dudosos > 0) {
          partes.push(`${enlaces.dudosos} emparejamientos dudosos sin unir, a revisar`);
        }
        base.note = [base.note, partes.join(', ')].filter(Boolean).join(' | ');
      } catch (error) {
        base.note = [
          base.note,
          `el emparejado con la FIE no se pudo recalcular: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ]
          .filter(Boolean)
          .join(' | ');
      }
    }
  } catch (error) {
    base.status = 'error';
    base.error = error instanceof Error ? error.message : String(error);
  }

  base.durationMs = Date.now() - startedAt.getTime();

  await db
    .update(ingestRun)
    .set({
      finishedAt: new Date(),
      durationMs: base.durationMs,
      status: base.status,
      itemsSeen: base.itemsSeen,
      itemsCreated: base.itemsCreated,
      itemsUpdated: base.itemsUpdated,
      itemsQuarantined: base.itemsQuarantined,
      notificationsQueued: base.notificationsQueued,
      error: base.error ?? base.note,
    })
    .where(eq(ingestRun.id, run.id));

  if (base.status === 'error') await maybeAlertAdmin(source, base.error);

  return base;
}

type Dispatched = Partial<IngestResult> & { note?: string | null };

async function dispatch(source: IngestSource, runId: string): Promise<Dispatched> {
  switch (source) {
    case 'skermo_rfee': {
      // Los resultados van DESPUÉS del calendario a propósito: necesitan que
      // las pruebas ya existan para poder emparejarse con ellas.
      const calendario = await ingestSkermo(runId, source, [
        { code: 'RFEE', name: 'Real Federación Española de Esgrima' },
      ]);
      const resultados = await ingestSkermoResults(runId);
      return {
        ...calendario,
        itemsSeen: (calendario.itemsSeen ?? 0) + resultados.itemsSeen,
        itemsCreated: (calendario.itemsCreated ?? 0) + resultados.itemsCreated,
        itemsUpdated: (calendario.itemsUpdated ?? 0) + resultados.itemsUpdated,
        itemsQuarantined:
          (calendario.itemsQuarantined ?? 0) + resultados.itemsQuarantined,
        note: [calendario.note, resultados.note].filter(Boolean).join(' | ') || null,
      };
    }
    case 'skermo_regional':
      return ingestSkermo(runId, source, REGIONAL_FEDERATIONS);
    case 'fie':
      return ingestFie(runId);
    case 'efc':
      return ingestEfc();
    case 'rfee_wp':
      return ingestOfficialDocuments();
  }
}

async function ingestSkermo(
  runId: string,
  source: 'skermo_rfee' | 'skermo_regional',
  federations: { code: string; name: string }[],
): Promise<Dispatched> {
  let itemsSeen = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let quarantined = 0;
  let notifications = 0;
  const failures: string[] = [];
  /** Se acumulan de todas las federaciones: marcar desaparecidos mirando solo
   *  una federación borraría del mapa las de las otras diez. */
  const seenSourceIds: string[] = [];

  for (const federation of federations) {
    const url = skermoCalendarUrl(federation.code);

    try {
      const { body } = await fetchText(url, { timeoutMs: 120_000 });

      // Snapshot del HTML crudo: depurar un parseo roto sin volver a pedir la
      // página vale mucho más de lo que cuesta guardarlo comprimido.
      if (source === 'skermo_rfee') {
        await storeIngestSnapshot(source, runId, body).catch(() => null);
      }

      const { candidates, rowsSeen } = parseSkermoCalendar(body, {
        source,
        federationCode: federation.code,
        regionalFederation: source === 'skermo_regional' ? federation.name : null,
      });

      itemsSeen += rowsSeen;

      const validated = validateEvents(candidates);
      quarantined += await saveQuarantine(runId, source, validated.quarantined);

      for (const e of validated.events) seenSourceIds.push(e.sourceId);

      const stats = await upsertEvents(validated.events);
      created += stats.created;
      updated += stats.updated;
      unchanged += stats.unchanged;
      notifications += stats.notificationsQueued;
    } catch (error) {
      // Una federación caída no debe tumbar las otras diez.
      failures.push(
        `${federation.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length === federations.length) {
    throw new Error(`Ninguna federación respondió. ${failures.join(' | ')}`);
  }

  /**
   * Los eventos que ya no aparecen se marcan como desaparecidos (normalmente
   * significa "anulado"). Solo se hace si NO hubo fallos: si media fuente no
   * respondió, marcaríamos como desaparecido lo que simplemente no pudimos
   * leer, y eso sí que sería un dato falso.
   */
  let disappeared = 0;
  if (failures.length === 0 && seenSourceIds.length > 0) {
    disappeared = await markMissingEvents(source, seenSourceIds, new Date());
  }

  return {
    status: failures.length > 0 ? 'parcial' : 'ok',
    itemsSeen,
    itemsCreated: created,
    itemsUpdated: updated,
    itemsUnchanged: unchanged,
    itemsQuarantined: quarantined,
    notificationsQueued: notifications,
    note:
      failures.length > 0
        ? `No respondieron ${failures.length} federaciones: ${failures.join(' | ')}`
        : disappeared > 0
          ? `${disappeared} eventos han desaparecido del calendario oficial`
          : null,
  };
}

async function ingestFie(runId: string): Promise<Dispatched> {
  const season = currentFieSeason();
  const { candidates, rowsSeen } = await fetchFieSeason(season);

  const validated = validateEvents(candidates);
  const quarantined = await saveQuarantine(runId, 'fie', validated.quarantined);
  const stats = await upsertEvents(validated.events);

  return {
    status: 'ok',
    itemsSeen: rowsSeen,
    itemsCreated: stats.created,
    itemsUpdated: stats.updated,
    itemsUnchanged: stats.unchanged,
    itemsQuarantined: quarantined,
    notificationsQueued: stats.notificationsQueued,
    note: `Temporada FIE ${season}`,
  };
}

async function ingestEfc(): Promise<Dispatched> {
  const outcome = await fetchEfcCalendar();
  return {
    // "parcial", no "error": no hay nada roto por nuestra parte, la fuente no
    // existe. Marcarlo como error haría saltar la alerta de scraper averiado
    // todos los días y acabaríamos ignorando las alertas de verdad.
    status: 'parcial',
    itemsSeen: outcome.rowsSeen,
    note: outcome.unavailableReason,
  };
}

async function ingestOfficialDocuments(): Promise<Dispatched> {
  const { candidates, rowsSeen } = await fetchOfficialDocuments();

  let created = 0;
  let updated = 0;
  let feeAlerts = 0;

  /**
   * RENDIMIENTO: esto era un bucle con un SELECT y un INSERT/UPDATE por
   * documento. Con los 278 documentos que hay hoy en la base son 556 viajes de
   * red a Neon (~60 ms cada uno medidos en local) = unos 33 s de pura espera
   * dentro de una función que muere a los 300 s, y creciendo con cada circular
   * que publique la RFEE. Ahora: una consulta para saber cuáles existen ya y
   * dos escrituras en lote.
   */
  if (candidates.length === 0) {
    return { status: 'ok', itemsSeen: rowsSeen, note: '0 documentos únicos' };
  }

  const yaExisten = new Set(
    (
      await db
        .select({ wpMediaId: officialDocument.wpMediaId })
        .from(officialDocument)
        .where(
          inArray(
            officialDocument.wpMediaId,
            candidates.map((d) => d.wpMediaId),
          ),
        )
    ).map((r) => r.wpMediaId),
  );

  const nuevos = candidates.filter((d) => !yaExisten.has(d.wpMediaId));

  for (const lote of chunk(candidates, 100)) {
    /**
     * `wp_media_id` es único, así que un solo INSERT ... ON CONFLICT hace de
     * alta y de actualización a la vez. Solo se refrescan título, URL y fecha:
     * `reviewedAt` y lo que haya marcado una persona no se pisa.
     */
    await db
      .insert(officialDocument)
      .values(
        lote.map((doc) => ({
          wpMediaId: doc.wpMediaId,
          title: doc.title,
          pdfUrl: doc.pdfUrl,
          publishedAt: doc.publishedAt,
          circularNumber: doc.circularNumber,
          seasonLabel: doc.seasonLabel,
          mentionsFees: doc.mentionsFees,
        })),
      )
      .onConflictDoUpdate({
        target: officialDocument.wpMediaId,
        set: {
          title: sql`excluded."title"`,
          pdfUrl: sql`excluded."pdf_url"`,
          publishedAt: sql`excluded."published_at"`,
        },
      });
  }

  created = nuevos.length;
  updated = candidates.length - nuevos.length;

  /**
   * Circular nueva que menciona recargos, plazos o categorías: se avisa al
   * admin para que revise si cambian los importes. No se actualiza nada solo
   * a escondidas; avisa, y decide una persona.
   */
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  const conRecargos = nuevos.filter((d) => d.mentionsFees);
  if (adminEmail && conRecargos.length > 0) {
    const queued = await db
      .insert(notification)
      .values(
        conRecargos.map((doc) => ({
          dedupeKey: `circular-fees:${doc.wpMediaId}`,
          toEmail: adminEmail,
          kind: 'circular_normativa',
          subject: `Circular nueva: ${doc.title}`,
          body:
            `Se ha publicado un documento oficial que menciona plazos, ` +
            `recargos o categorías:\n\n` +
            `${doc.title}\n${doc.pdfUrl}\n` +
            `Publicado el ${doc.publishedAt.toISOString().slice(0, 10)}.\n\n` +
            'Revisa si hay que actualizar las tablas de normativa ' +
            '(plazos y recargos, categorías de la temporada, coeficientes ' +
            'de ranking). La app no cambia ningún importe por su cuenta.\n',
        })),
      )
      .onConflictDoNothing({ target: notification.dedupeKey })
      .returning({ id: notification.id });
    feeAlerts = queued.length;
  }

  return {
    status: 'ok',
    itemsSeen: rowsSeen,
    itemsCreated: created,
    itemsUpdated: updated,
    notificationsQueued: feeAlerts,
    note: `${candidates.length} documentos únicos`,
  };
}

async function saveQuarantine(
  runId: string,
  source: IngestSource,
  items: { sourceId: string | null; raw: unknown; errors: unknown }[],
): Promise<number> {
  /**
   * RENDIMIENTO: en lote, no una fila por viaje de red. Cuando una fuente
   * cambia de formato la cuarentena no recibe dos filas, recibe TODAS las del
   * día (cientos), y es justo el día en que la función no se puede permitir
   * gastar un viaje a Neon por cada una.
   */
  for (const lote of chunk(items, 100)) {
    await db.insert(ingestQuarantine).values(
      lote.map((item) => ({
        ingestRunId: runId,
        source,
        sourceId: item.sourceId,
        rawPayload: item.raw as never,
        validationErrors: item.errors as never,
      })),
    );
  }
  return items.length;
}

/**
 * Avisa al admin si la fuente falla DOS días seguidos.
 *
 * Un solo fallo puede ser un timeout tonto; dos seguidos es un scraper roto.
 * Avisar al primero enseña a la gente a ignorar los avisos.
 */
async function maybeAlertAdmin(source: IngestSource, error: string | null) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return;

  const recent = await db
    .select({ status: ingestRun.status, startedAt: ingestRun.startedAt })
    .from(ingestRun)
    .where(eq(ingestRun.source, source))
    .orderBy(desc(ingestRun.startedAt))
    .limit(2);

  const consecutiveFailures = recent.filter((r) => r.status === 'error').length;
  if (consecutiveFailures < 2) return;

  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(notification)
    .values({
      dedupeKey: `ingest-failure:${source}:${day}`,
      toEmail: adminEmail,
      kind: 'scraper_roto',
      subject: `La ingestión de ${source} falla dos días seguidos`,
      body:
        `${SOURCE_DESCRIPTION[source]} ha fallado en las dos últimas ` +
        `ejecuciones.\n\nÚltimo error:\n${error ?? 'sin detalle'}\n\n` +
        'Mientras no se arregle, el calendario de esa fuente se queda con los ' +
        'datos del último día que funcionó, y la app lo avisa en pantalla.\n',
    })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

/**
 * Estado de salud de las fuentes, para el panel de admin y para el aviso en la
 * interfaz cuando los datos tienen más de 48 horas. El silencio es el peor
 * fallo posible: si el calendario no se ha podido actualizar, se dice.
 */
export async function sourceHealth() {
  const rows = await db
    .select({
      source: ingestRun.source,
      status: ingestRun.status,
      startedAt: ingestRun.startedAt,
      finishedAt: ingestRun.finishedAt,
      itemsSeen: ingestRun.itemsSeen,
      itemsCreated: ingestRun.itemsCreated,
      itemsUpdated: ingestRun.itemsUpdated,
      itemsQuarantined: ingestRun.itemsQuarantined,
      error: ingestRun.error,
    })
    .from(ingestRun)
    .orderBy(desc(ingestRun.startedAt))
    .limit(200);

  const latestBySource = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestBySource.has(row.source)) latestBySource.set(row.source, row);
  }

  const now = Date.now();

  return INGEST_SOURCES.map((source) => {
    const latest = latestBySource.get(source);
    const ageHours = latest
      ? Math.floor((now - latest.startedAt.getTime()) / 3_600_000)
      : null;

    return {
      source,
      description: SOURCE_DESCRIPTION[source],
      latest: latest ?? null,
      ageHours,
      stale: ageHours === null || ageHours > 48,
    };
  });
}

/** Nº de filas en cuarentena sin resolver, por fuente. */
export async function openQuarantineCount() {
  return db
    .select({
      source: ingestQuarantine.source,
      count: sql<number>`count(*)::int`,
    })
    .from(ingestQuarantine)
    .where(isNull(ingestQuarantine.resolvedAt))
    .groupBy(ingestQuarantine.source);
}

/**
 * Contraste contra la fuente: compara cuántas competiciones tenemos en una
 * semana con las que publica el calendario oficial. Si no cuadra, es que el
 * parseo se está dejando filas, y eso hay que verlo antes que los usuarios.
 */
export async function countEventsBetween(from: string, to: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(event)
    .where(and(sql`${event.startDate} >= ${from}`, sql`${event.startDate} <= ${to}`));
  return row?.count ?? 0;
}
