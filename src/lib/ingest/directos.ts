import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { event, eventCompetition, liveSource } from '@/db/schema';
import { enLista as inArray, lotesDeInsercion } from '@/lib/sqlite';
import { normalizarUrlDirecto, proveedorDeUrl } from '@/lib/calendario/enlaces-directo';
import {
  emparejarTorneoEngarde,
  parsearListaTorneosEngarde,
  sinTorneoAmbiguo,
  torneosEnVentanaEngarde,
  type PruebaCalendarioDirecto,
} from './enlaces-directo-engarde';
import { ENGARDE_BASE, ENGARDE_INDICE, formularioIndice, parsearIndiceEngarde, type PruebaEngarde } from './sources/engarde';

/**
 * `matchRule` va a la columna `match_rule` de 0008_enlaces_directo.sql, que no
 * está en el esquema de Drizzle (que tiene que seguir idéntico al de Postgres):
 * se escribe aparte y por SQL.
 */
export type FilaDirecto = typeof liveSource.$inferInsert & { matchRule?: string | null };

type EnlaceExistente = {
  id: string;
  eventId: string;
  competitionId: string | null;
  url: string;
  automatic: boolean | null;
};

/**
 * Qué hacer con cada enlace frente a lo que ya hay, comparando siempre la URL
 * normalizada (las filas antiguas se guardaron en crudo, con `#today` y
 * demás).
 *
 * Antes de 0008 la FIE y el índice de Skermo guardaban el enlace de UNA prueba
 * con `event_competition_id` NULL. Cuando llega ese mismo enlace con su
 * prueba, la copia automática sin prueba no es un enlace del torneo: se
 * convierte en el de la prueba si aún no existe, y se borra si ya existe. Las
 * filas puestas a mano no se tocan.
 */
export function planificarEnlacesDirecto(
  limpias: readonly FilaDirecto[],
  existentes: readonly EnlaceExistente[],
): { nuevas: FilaDirecto[]; convertir: { id: string; fila: FilaDirecto }[]; borrar: string[] } {
  const ya = new Set<string>();
  const sinPrueba = new Map<string, string[]>();
  for (const e of existentes) {
    const url = normalizarUrlDirecto(e.url) ?? e.url;
    ya.add(`${e.eventId}|${e.competitionId ?? ''}|${url}`);
    if (e.competitionId === null && e.automatic !== false) {
      const lista = sinPrueba.get(`${e.eventId}|${url}`) ?? [];
      lista.push(e.id);
      sinPrueba.set(`${e.eventId}|${url}`, lista);
    }
  }

  const nuevas: FilaDirecto[] = [];
  const convertir: { id: string; fila: FilaDirecto }[] = [];
  const borrar = new Set<string>();
  for (const f of limpias) {
    const clave = `${f.eventId}|${f.eventCompetitionId ?? ''}|${f.url}`;
    if (!f.eventCompetitionId) {
      if (!ya.has(clave)) {
        ya.add(clave);
        nuevas.push(f);
      }
      continue;
    }
    const huerfanas = sinPrueba.get(`${f.eventId}|${f.url}`) ?? [];
    sinPrueba.delete(`${f.eventId}|${f.url}`);
    if (ya.has(clave)) {
      for (const id of huerfanas) borrar.add(id);
      continue;
    }
    ya.add(clave);
    const [primera, ...resto] = huerfanas;
    if (primera) convertir.push({ id: primera, fila: f });
    else nuevas.push(f);
    for (const id of resto) borrar.add(id);
  }
  return { nuevas, convertir, borrar: [...borrar] };
}

/**
 * Si dos torneos de Engarde de la misma pasada reclaman la misma prueba con
 * URL distinta, no se sabe cuál es el suyo: esa prueba se queda sin enlace.
 */
export function sinPruebaAmbigua<T extends { eventId: string; competitionId: string | null; url: string }>(
  enlaces: readonly T[],
): T[] {
  const urls = new Map<string, Set<string>>();
  for (const e of enlaces) {
    if (e.competitionId === null) continue;
    const clave = `${e.eventId}|${e.competitionId}`;
    const s = urls.get(clave) ?? new Set<string>();
    s.add(normalizarUrlDirecto(e.url) ?? e.url);
    urls.set(clave, s);
  }
  return enlaces.filter(
    (e) => e.competitionId === null || (urls.get(`${e.eventId}|${e.competitionId}`)?.size ?? 0) <= 1,
  );
}

function chunkIds(ids: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Inserta enlaces sin repetirlos.
 *
 * `live_source_key` es único por (evento, prueba, url), pero en SQLite dos
 * NULL nunca chocan: un enlace del torneo entero (prueba NULL) se duplicaba
 * en cada pasada del cron. Por eso se lee antes lo que ya hay.
 */
export async function escribirEnlacesDirecto(filas: readonly FilaDirecto[]): Promise<number> {
  const limpias: FilaDirecto[] = [];
  const vistas = new Set<string>();
  for (const f of filas) {
    const url = normalizarUrlDirecto(f.url);
    if (!url) continue;
    const clave = `${f.eventId}|${f.eventCompetitionId ?? ''}|${url}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    limpias.push({ ...f, url, platform: proveedorDeUrl(url) });
  }
  if (limpias.length === 0) return 0;

  const eventos = [...new Set(limpias.map((f) => f.eventId))];
  const existentes = await db
    .select({
      id: liveSource.id,
      eventId: liveSource.eventId,
      competitionId: liveSource.eventCompetitionId,
      url: liveSource.url,
      automatic: liveSource.automatic,
    })
    .from(liveSource)
    .where(inArray(liveSource.eventId, eventos));
  const { nuevas, convertir, borrar } = planificarEnlacesDirecto(limpias, existentes);

  let escritas = 0;
  for (const c of convertir) {
    await db
      .update(liveSource)
      .set({ eventCompetitionId: c.fila.eventCompetitionId, url: c.fila.url, platform: c.fila.platform })
      .where(eq(liveSource.id, c.id));
    escritas += 1;
    if (c.fila.matchRule) {
      try {
        await db.execute(sql`UPDATE live_source SET match_rule = ${c.fila.matchRule} WHERE id = ${c.id}`);
      } catch {
        // Sin 0008 aplicada la columna no existe.
      }
    }
  }
  for (const lote of chunkIds(borrar, 200)) {
    await db.delete(liveSource).where(inArray(liveSource.id, lote));
  }
  const porRegla = new Map<string, string[]>();
  for (const lote of lotesDeInsercion(nuevas, liveSource)) {
    const r = await db
      .insert(liveSource)
      .values(lote.map(({ matchRule: _regla, ...fila }) => fila))
      .onConflictDoNothing({ target: [liveSource.eventId, liveSource.eventCompetitionId, liveSource.url] })
      .returning({ id: liveSource.id, eventId: liveSource.eventId, competitionId: liveSource.eventCompetitionId, url: liveSource.url });
    escritas += r.length;
    for (const fila of r) {
      const regla = lote.find(
        (f) => f.eventId === fila.eventId && (f.eventCompetitionId ?? null) === fila.competitionId && f.url === fila.url,
      )?.matchRule;
      if (!regla) continue;
      const ids = porRegla.get(regla) ?? [];
      ids.push(fila.id);
      porRegla.set(regla, ids);
    }
  }
  for (const [regla, ids] of porRegla) {
    try {
      await db.execute(sql`UPDATE live_source SET match_rule = ${regla} WHERE ${inArray(liveSource.id, ids)}`);
    } catch {
      // Sin 0008 aplicada la columna no existe: el enlace queda escrito igual, sin su regla.
    }
  }
  return escritas;
}

type Respuesta = { status: number; body: string };
export type DepsDirectos = {
  post: (url: string, formulario: Record<string, string>) => Promise<Respuesta>;
  esperar: (ms: number) => Promise<void>;
};

const PAUSA_MS = 600;
const MAX_TORNEOS = 20;

const depsReales: DepsDirectos = {
  async post(url, formulario) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(formulario).toString(),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    return { status: res.status, body: await res.text() };
  },
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
};

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type ResumenDirectosEngarde = {
  torneosListados: number;
  torneosMirados: number;
  peticiones: number;
  enlaces: number;
  escritos: number;
  fallos: number;
};

/**
 * La pasada nocturna de la cuenta de Engarde de la RFEE.
 *
 * Una petición para la lista (los 50 torneos más recientes, que es la primera
 * página en orden descendente) y una por torneo dentro de la ventana para su
 * índice de pruebas. Secuencial, con pausa entre peticiones y con un tope de
 * torneos: en una noche normal son 3 a 8 peticiones.
 */
export async function ingestDirectosEngarde(
  opciones: { hoy?: string; deps?: DepsDirectos; organismo?: string } = {},
): Promise<ResumenDirectosEngarde> {
  const hoy = opciones.hoy ?? new Date().toISOString().slice(0, 10);
  const deps = opciones.deps ?? depsReales;
  const organismo = opciones.organismo ?? 'rfee';
  const resumen: ResumenDirectosEngarde = {
    torneosListados: 0,
    torneosMirados: 0,
    peticiones: 0,
    enlaces: 0,
    escritos: 0,
    fallos: 0,
  };

  resumen.peticiones += 1;
  const lista = await deps.post(`${ENGARDE_BASE}/prog/getTournois.php`, {
    option: 'tournois',
    organism: organismo,
    nrows: '50',
    order: 'desc',
    page: '1',
  });
  const torneos = lista.status === 200 ? parsearListaTorneosEngarde(lista.body, organismo) : null;
  if (!torneos) throw new Error(`La lista de torneos de Engarde (${organismo}) no respondió como se esperaba (HTTP ${lista.status})`);
  resumen.torneosListados = torneos.length;

  const ventana = torneosEnVentanaEngarde(torneos, hoy).slice(0, MAX_TORNEOS);
  if (ventana.length === 0) return resumen;

  const fechas = ventana.map((t) => t.fecha).sort();
  const calendario = await pruebasDelCalendario(sumarDias(fechas[0], -1), sumarDias(fechas[fechas.length - 1], 10));

  const filas: FilaDirecto[] = [];
  const emparejados: ReturnType<typeof emparejarTorneoEngarde>['enlaces'] = [];
  for (const t of ventana) {
    await deps.esperar(PAUSA_MS);
    resumen.peticiones += 1;
    resumen.torneosMirados += 1;
    const pruebas: PruebaEngarde[] = [];
    let fallo = false;
    try {
      for (let pagina = 1, paginas = 1; pagina <= Math.min(paginas, 3); pagina += 1) {
        if (pagina > 1) {
          await deps.esperar(PAUSA_MS);
          resumen.peticiones += 1;
        }
        const r = await deps.post(ENGARDE_INDICE, formularioIndice(organismo, t.evt, pagina));
        const indice = r.status === 200 ? parsearIndiceEngarde(r.body) : null;
        if (!indice || !indice.ok) {
          fallo = true;
          break;
        }
        paginas = indice.paginas;
        pruebas.push(...indice.pruebas.filter((p) => !pruebas.some((q) => q.compe === p.compe)));
      }
    } catch {
      fallo = true;
    }
    if (fallo && pruebas.length === 0) {
      resumen.fallos += 1;
      continue;
    }
    emparejados.push(...emparejarTorneoEngarde(pruebas, calendario).enlaces);
  }
  for (const e of sinPruebaAmbigua(sinTorneoAmbiguo(emparejados))) {
    filas.push({
      eventId: e.eventId,
      eventCompetitionId: e.competitionId,
      platform: 'engarde',
      kind: 'resultados',
      url: e.url,
      label: null,
      automatic: true,
      matchRule: e.regla,
    });
  }
  resumen.enlaces = filas.length;
  resumen.escritos = await escribirEnlacesDirecto(filas);
  return resumen;
}

/** Las pruebas del calendario (no absorbidas, no desaparecidas) en un rango de fechas. */
async function pruebasDelCalendario(desde: string, hasta: string): Promise<PruebaCalendarioDirecto[]> {
  const fecha = sql<string>`coalesce(${eventCompetition.competitionDate}, ${event.startDate})`;
  const filas = await db
    .select({
      competitionId: eventCompetition.id,
      eventId: eventCompetition.eventId,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
      fecha,
      ciudad: event.city,
      pais: event.country,
      circuit: event.circuit,
    })
    .from(eventCompetition)
    .innerJoin(event, eq(event.id, eventCompetition.eventId))
    .where(
      and(
        isNull(event.disappearedAt),
        isNull(event.canonicalEventId),
        gte(event.endDate, desde),
        lte(event.startDate, hasta),
      ),
    );
  return filas.map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10) }));
}
