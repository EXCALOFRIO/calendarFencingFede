import { sql } from 'drizzle-orm';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { construirAvisosResultados, type AvisoNuevo, type LineaResultado, type PruebaResultados } from './agrupar';
import { guardarAvisos, leerPreferencias, type AvisoGuardado } from './bandeja';
import { filasDe, jsonLista, type DbAvisos } from './db';
import { entregarPush, type OpcionesEntrega, type ResumenEntrega } from './entrega';
import { PREFERENCIAS_POR_DEFECTO } from './tipos';

/**
 * ===========================================================================
 * EVENTOS DEPORTIVOS: LA INTERFAZ QUE LLAMA LA INGESTA
 * ===========================================================================
 *
 * La ingesta no sabe nada de perfiles, preferencias ni dispositivos. Solo dice
 * qué ha pasado, con identificadores deportivos:
 *
 *   - `resultados_publicados`: la clasificación de una prueba ya está
 *     (primera vez o reescrita entera);
 *   - `resultado_nuevo`: hay puestos nuevos o cambiados de estas personas en
 *     esta prueba.
 *
 * Y lo deja en la tabla `notificacion_evento` (una bandeja de salida). De ahí
 * se sacan los avisos: inscripciones, personas seguidas y tu perfil, uno por
 * perfil y competición.
 *
 * Dos entradas, según quién produzca el evento:
 *   - la ingesta automática ya escribe `resultado_auto_evento`; basta con que
 *     llame a `notificarResultadosNuevos(db)` al acabar cada pasada
 *     (y si no lo hace, el cron de las 07:00 lo recoge igual);
 *   - cualquier otro código (scripts, lotes manuales) puede llamar a
 *     `notificarEventosDeportivos(db, eventos)` con estos tipos.
 */

export type EventoDeportivo = {
  tipo: 'resultados_publicados' | 'resultado_nuevo';
  /** `sport_competition.id`. */
  competitionId: string;
  /** `sport_person.id` (cualquiera del grupo fundido). Sin lista: toda la prueba. */
  personIds?: readonly string[];
};

const ID_RE = /^[0-9A-Za-z-]{1,64}$/;
const MAX_EVENTOS_POR_PASADA = 200;
const SALTOS = 3;
/** Estados de una inscripción de la aplicación que cuentan como «inscrito». */
const INSCRITO = ['pending_club', 'club_approved', 'federation_approved', 'submitted'] as const;

export async function encolarEventosDeportivos(
  db: DbAvisos, eventos: readonly EventoDeportivo[], ahora = new Date(),
): Promise<number> {
  let n = 0;
  for (const e of eventos) {
    if (!ID_RE.test(e.competitionId)) continue;
    if (e.tipo !== 'resultados_publicados' && e.tipo !== 'resultado_nuevo') continue;
    const personas = e.personIds ? [...new Set(e.personIds.filter((p) => ID_RE.test(p)))] : null;
    if (e.tipo === 'resultado_nuevo' && (!personas || personas.length === 0)) continue;
    await db.execute(sql`
      INSERT INTO notificacion_evento (id, tipo, competition_id, person_ids, creado_en)
      VALUES (${crypto.randomUUID()}, ${e.tipo}, ${e.competitionId}, ${personas ? JSON.stringify(personas) : null}, ${ahora.getTime()})`);
    n++;
  }
  return n;
}

export type ResumenResultados = {
  eventos: number;
  competiciones: number;
  avisos: number;
  guardados: AvisoGuardado[];
};

/** Saca de la bandeja de salida lo pendiente, genera y guarda los avisos. No empuja al móvil. */
export async function procesarEventosPendientes(db: DbAvisos, ahora = new Date()): Promise<ResumenResultados> {
  const pendientes = await filasDe<{ id: string; tipo: string; competition_id: string; person_ids: string | null }>(db, sql`
    SELECT id, tipo, competition_id, person_ids FROM notificacion_evento
    WHERE procesado_en IS NULL ORDER BY creado_en, id LIMIT ${MAX_EVENTOS_POR_PASADA}`);
  if (pendientes.length === 0) return { eventos: 0, competiciones: 0, avisos: 0, guardados: [] };

  // Varios eventos de la misma prueba son uno: la unión de sus personas, o la prueba entera.
  const porPrueba = new Map<string, Set<string> | null>();
  for (const p of pendientes) {
    const personas = p.person_ids ? (JSON.parse(p.person_ids) as string[]) : null;
    const previa = porPrueba.get(p.competition_id);
    if (previa === null || personas === null || p.tipo === 'resultados_publicados') {
      porPrueba.set(p.competition_id, null);
    } else {
      porPrueba.set(p.competition_id, new Set([...(previa ?? []), ...personas]));
    }
  }

  const avisos: AvisoNuevo[] = [];
  for (const [competitionId, personas] of porPrueba) {
    avisos.push(...(await avisosDePrueba(db, competitionId, personas ? [...personas] : null)));
  }
  const preferencias = await leerPreferencias(db, [...new Set(avisos.map((a) => a.profileId))]);
  const guardados = await guardarAvisos(db, avisos, preferencias, ahora);

  await db.execute(sql`
    UPDATE notificacion_evento SET procesado_en = ${ahora.getTime()}
    WHERE id IN (SELECT value FROM json_each(${jsonLista(pendientes.map((p) => p.id))}))`);
  await db.execute(sql`DELETE FROM notificacion_evento WHERE procesado_en < ${ahora.getTime() - 30 * 86_400_000}`);
  return { eventos: pendientes.length, competiciones: porPrueba.size, avisos: avisos.length, guardados };
}

/** Lo que debe llamar la ingesta: encola, genera los avisos y los empuja al móvil. */
export async function notificarEventosDeportivos(
  db: DbAvisos, eventos: readonly EventoDeportivo[], opciones: OpcionesEntrega = {},
): Promise<ResumenResultados & { push: ResumenEntrega }> {
  const ahora = opciones.ahora ?? new Date();
  await encolarEventosDeportivos(db, eventos, ahora);
  const resumen = await procesarEventosPendientes(db, ahora);
  const push = await entregarPush(db, resumen.guardados, { ...opciones, ahora });
  return { ...resumen, push };
}

// ---------------------------------------------------------------- eventos de la ingesta automática

/**
 * Lo que publica la ingesta automática en `resultado_auto_evento`
 * (drizzle-d1/0017_resultados_automaticos.sql, `src/lib/ingest/resultados-auto/eventos.ts`):
 * una tabla de solo añadir con id creciente, en la que cada consumidor lleva
 * su cursor. Se lee la tabla directamente, por su contrato, sin importar el
 * módulo de la ingesta:
 *
 *   prueba_publicada   → resultados_publicados (toda la prueba)
 *   resultado_persona  → resultado_nuevo de esa persona
 *   fases_publicadas   → nada (poules y cuadro no son un puesto)
 *
 * El cursor arranca en el máximo actual: al activar las notificaciones no
 * llegan de golpe los resultados de los últimos 120 días.
 */
const FUENTE_INGESTA = 'resultado_auto_evento';
const LOTE_INGESTA = 500;
const MAX_LOTES_INGESTA = 5;

export async function consumirEventosIngesta(
  db: DbAvisos, ahora = new Date(),
): Promise<{ leidos: number; encolados: number; disponible: boolean }> {
  const [tabla] = await filasDe<{ n: number }>(db, sql`
    SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${FUENTE_INGESTA}`);
  if (Number(tabla?.n ?? 0) !== 1) return { leidos: 0, encolados: 0, disponible: false };

  const [cursor] = await filasDe<{ ultimo_id: number }>(db, sql`
    SELECT ultimo_id FROM notificacion_cursor WHERE fuente = ${FUENTE_INGESTA}`);
  if (!cursor) {
    const [maximo] = await filasDe<{ m: number }>(db, sql`SELECT coalesce(max(id), 0) AS m FROM resultado_auto_evento`);
    await guardarCursor(db, Number(maximo?.m ?? 0), ahora);
    return { leidos: 0, encolados: 0, disponible: true };
  }

  let desde = Number(cursor.ultimo_id);
  let leidos = 0;
  let encolados = 0;
  for (let lote = 0; lote < MAX_LOTES_INGESTA; lote++) {
    const filas = await filasDe<{ id: number; tipo: string; competition_id: string; person_id: string | null }>(db, sql`
      SELECT id, tipo, competition_id, person_id FROM resultado_auto_evento
      WHERE id > ${desde} ORDER BY id LIMIT ${LOTE_INGESTA}`);
    if (filas.length === 0) break;
    const eventos: EventoDeportivo[] = filas.flatMap((f): EventoDeportivo[] => {
      if (f.tipo === 'prueba_publicada') return [{ tipo: 'resultados_publicados', competitionId: f.competition_id }];
      if (f.tipo === 'resultado_persona' && f.person_id) return [{ tipo: 'resultado_nuevo', competitionId: f.competition_id, personIds: [f.person_id] }];
      return [];
    });
    encolados += await encolarEventosDeportivos(db, eventos, ahora);
    leidos += filas.length;
    // Encolar y luego mover el cursor: si algo cae en medio, se encola dos veces y la clave del aviso lo deduplica.
    desde = Number(filas.at(-1)!.id);
    await guardarCursor(db, desde, ahora);
    if (filas.length < LOTE_INGESTA) break;
  }
  return { leidos, encolados, disponible: true };
}

async function guardarCursor(db: DbAvisos, id: number, ahora: Date): Promise<void> {
  await db.execute(sql`
    INSERT INTO notificacion_cursor (fuente, ultimo_id, actualizado_en) VALUES (${FUENTE_INGESTA}, ${id}, ${ahora.getTime()})
    ON CONFLICT (fuente) DO UPDATE SET ultimo_id = excluded.ultimo_id, actualizado_en = excluded.actualizado_en`);
}

/**
 * Para llamar al final de cada pasada de la ingesta automática: lee sus
 * eventos nuevos, genera los avisos y los empuja al móvil en el momento.
 */
export async function notificarResultadosNuevos(
  db: DbAvisos, opciones: OpcionesEntrega = {},
): Promise<ResumenResultados & { push: ResumenEntrega; leidos: number }> {
  const ahora = opciones.ahora ?? new Date();
  const { leidos } = await consumirEventosIngesta(db, ahora);
  const resumen = await procesarEventosPendientes(db, ahora);
  const push = await entregarPush(db, resumen.guardados, { ...opciones, ahora });
  return { ...resumen, push, leidos };
}

// ---------------------------------------------------------------- una prueba

type FilaPrueba = {
  id: string; edition_id: string; weapon: string; gender: string; category: string; format: string;
  event_competition_id: string | null; nombre: string; event_id: string | null;
};

/** Grupo fundido de unas personas canónicas: la canónica y las fundidas en ella. */
function sqlGrupo(canonicas: readonly string[]) {
  return sql`WITH RECURSIVE grupo(canon, id, salto) AS (
      SELECT value, value, 0 FROM json_each(${jsonLista(canonicas)})
      UNION ALL
      SELECT g.canon, p.id, g.salto + 1 FROM sport_person p JOIN grupo g ON p.merged_into_person_id = g.id
      WHERE g.salto < ${SALTOS}
    )`;
}

async function canonicas(db: DbAvisos, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const filas = await filasDe<{ origen: string; canon: string }>(db, sql`
    WITH RECURSIVE cadena(origen, id, siguiente, salto) AS (
      SELECT p.id, p.id, p.merged_into_person_id, 0 FROM sport_person p
      WHERE p.id IN (SELECT value FROM json_each(${jsonLista(ids)}))
      UNION ALL
      SELECT c.origen, p.id, p.merged_into_person_id, c.salto + 1
      FROM sport_person p JOIN cadena c ON p.id = c.siguiente WHERE c.salto < ${SALTOS}
    )
    SELECT origen, id AS canon FROM cadena WHERE siguiente IS NULL`);
  return new Map(filas.map((f) => [f.origen, f.canon]));
}

export async function avisosDePrueba(db: DbAvisos, competitionId: string, personas: readonly string[] | null): Promise<AvisoNuevo[]> {
  const [prueba] = await filasDe<FilaPrueba>(db, sql`
    SELECT c.id, c.edition_id, c.weapon, c.gender, c.category, c.format, c.event_competition_id,
      e.name AS nombre, e.event_id
    FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
    WHERE c.id = ${competitionId}`);
  if (!prueba) return [];

  const resultados = await filasDe<{ person_id: string; position: number | null }>(db, sql`
    SELECT person_id, min(position) AS position FROM sport_result
    WHERE competition_id = ${competitionId} AND person_id IS NOT NULL
    GROUP BY person_id`);

  const eventoCompeticion = prueba.event_competition_id ?? (prueba.event_id
    ? (await filasDe<{ id: string }>(db, sql`
        SELECT id FROM event_competition WHERE event_id = ${prueba.event_id} AND weapon = ${prueba.weapon}
          AND gender = ${prueba.gender} AND category = ${prueba.category} AND format = ${prueba.format} LIMIT 1`))[0]?.id ?? null
    : null);
  const inscritos = eventoCompeticion
    ? await filasDe<{
        athlete_id: string; first_name: string; last_name: string; user_profile_id: string | null;
        guardian_profile_id: string | null; requested_by_profile_id: string | null; person_id: string | null;
      }>(db, sql`
        SELECT e.athlete_id, a.first_name, a.last_name, a.user_profile_id, a.guardian_profile_id, e.requested_by_profile_id,
          (SELECT p.id FROM sport_person p WHERE p.athlete_id = e.athlete_id LIMIT 1) AS person_id
        FROM entry e JOIN athlete a ON a.id = e.athlete_id
        WHERE e.event_competition_id = ${eventoCompeticion} AND a.active = 1
          AND e.status IN (SELECT value FROM json_each(${JSON.stringify(INSCRITO)}))`)
    : [];

  const canon = await canonicas(db, [
    ...resultados.map((r) => r.person_id),
    ...(personas ?? []),
    ...inscritos.flatMap((i) => (i.person_id ? [i.person_id] : [])),
  ]);

  const puestoDe = new Map<string, number | null>();
  for (const r of resultados) {
    const c = canon.get(r.person_id);
    if (!c) continue;
    const p = r.position === null ? null : Number(r.position);
    const previo = puestoDe.get(c);
    if (previo === undefined || (p !== null && (previo === null || p < previo))) puestoDe.set(c, p);
  }
  // Lo nuevo: las personas del evento (si trae lista) con resultado en la prueba. El aviso, en
  // cambio, se escribe con TODAS las personas de la prueba que le interesan al perfil, para que
  // un `resultado_nuevo` de una segunda persona complete el aviso en vez de sustituirlo.
  const objetivo = new Set(
    personas === null
      ? puestoDe.keys()
      : personas.map((p) => canon.get(p)).filter((c): c is string => !!c && puestoDe.has(c)),
  );
  if (personas !== null && objetivo.size === 0) return [];

  const lineas: LineaResultado[] = [];
  const objetivoLista = [...puestoDe.keys()];
  const nombres = new Map<string, string>();
  if (objetivoLista.length > 0 || inscritos.length > 0) {
    const ids = [...new Set([...objetivoLista, ...inscritos.flatMap((i) => (i.person_id && canon.get(i.person_id) ? [canon.get(i.person_id)!] : []))])];
    for (const f of await filasDe<{ id: string; display_name: string }>(db, sql`
      SELECT id, display_name FROM sport_person WHERE id IN (SELECT value FROM json_each(${jsonLista(ids)}))`)) {
      nombres.set(f.id, nombreVisible(f.display_name));
    }
  }

  if (objetivoLista.length > 0) {
    const vinculos = await filasDe<{ canon: string; user_profile_id: string | null; guardian_profile_id: string | null }>(db, sql`
      ${sqlGrupo(objetivoLista)}
      SELECT g.canon, a.user_profile_id, a.guardian_profile_id
      FROM grupo g JOIN sport_person p ON p.id = g.id JOIN athlete a ON a.id = p.athlete_id
      WHERE a.active = 1`);
    for (const v of vinculos) {
      for (const profileId of [v.user_profile_id, v.guardian_profile_id]) {
        if (!profileId) continue;
        lineas.push({ profileId, motivo: 'perfil', clavePersona: v.canon, personaId: v.canon, nombre: nombres.get(v.canon) ?? '', puesto: puestoDe.get(v.canon) ?? null });
      }
    }
    const seguidores = await filasDe<{ canon: string; profile_id: string }>(db, sql`
      ${sqlGrupo(objetivoLista)}
      SELECT DISTINCT g.canon, f.profile_id FROM grupo g JOIN sport_favorite f ON f.person_id = g.id`);
    for (const s of seguidores) {
      lineas.push({ profileId: s.profile_id, motivo: 'seguidos', clavePersona: s.canon, personaId: s.canon, nombre: nombres.get(s.canon) ?? '', puesto: puestoDe.get(s.canon) ?? null });
    }
  }

  for (const i of inscritos) {
    const c = i.person_id ? canon.get(i.person_id) ?? null : null;
    const nombre = (c && nombres.get(c)) || `${i.first_name} ${i.last_name}`.trim();
    for (const profileId of [i.user_profile_id, i.guardian_profile_id, i.requested_by_profile_id]) {
      if (!profileId) continue;
      lineas.push({
        profileId, motivo: 'inscripciones', clavePersona: c ?? `athlete:${i.athlete_id}`, personaId: c,
        nombre, puesto: c ? puestoDe.get(c) ?? null : null,
      });
    }
  }
  // Un `resultado_nuevo` de otras personas no es noticia para este perfil.
  const conNovedad = new Set(lineas.filter((l) => objetivo.has(l.clavePersona)).map((l) => l.profileId));
  if (personas !== null) lineas.splice(0, lineas.length, ...lineas.filter((l) => conNovedad.has(l.profileId)));
  if (lineas.length === 0) return [];

  const validos = new Set((await filasDe<{ id: string }>(db, sql`
    SELECT id FROM user_profile WHERE invite_status <> 'revocada' AND auth_user_id IS NOT NULL
      AND id IN (SELECT value FROM json_each(${jsonLista(lineas.map((l) => l.profileId))}))`)).map((f) => f.id));
  const utiles = lineas.filter((l) => validos.has(l.profileId) && l.nombre);
  if (utiles.length === 0) return [];

  const preferencias = await leerPreferencias(db, [...validos]);
  const descripcion: PruebaResultados = {
    competitionId: prueba.id, editionId: prueba.edition_id, nombreEdicion: prueba.nombre,
    arma: prueba.weapon, genero: prueba.gender, categoria: prueba.category, formato: prueba.format,
  };
  return construirAvisosResultados(descripcion, utiles, preferencias, PREFERENCIAS_POR_DEFECTO);
}
