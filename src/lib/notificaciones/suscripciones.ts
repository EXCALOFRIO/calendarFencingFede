import { sql } from 'drizzle-orm';
import { filasDe, jsonLista, type DbAvisos } from './db';
import { deBase64url } from './push/base64url';
import { endpointValido, enviarPush, type MensajePush, type ResultadoEnvio } from './push/enviar';
import type { ClavesVapid } from './push/vapid';

export type DatosSuscripcion = { endpoint: string; p256dh: string; auth: string; dispositivo?: string | null };

export type Suscripcion = DatosSuscripcion & { id: string; profileId: string; creadaEn: number; fallos: number };

/** Tras tantos rechazos seguidos (403 de clave cambiada, 413…) la suscripción se da por perdida. */
export const MAX_FALLOS = 5;

/** Valida lo que manda el navegador antes de guardarlo: nada de endpoints http ni claves de otro tamaño. */
export function validarSuscripcion(entrada: unknown): DatosSuscripcion | null {
  if (!entrada || typeof entrada !== 'object') return null;
  const e = entrada as Record<string, unknown>;
  const endpoint = typeof e.endpoint === 'string' ? e.endpoint.trim() : '';
  const p256dh = typeof e.p256dh === 'string' ? e.p256dh.trim() : '';
  const auth = typeof e.auth === 'string' ? e.auth.trim() : '';
  if (!endpointValido(endpoint)) return null;
  try {
    const clave = deBase64url(p256dh);
    const secreto = deBase64url(auth);
    if (clave.length !== 65 || clave[0] !== 4 || secreto.length !== 16) return null;
  } catch {
    return null;
  }
  const dispositivo = typeof e.dispositivo === 'string'
    ? e.dispositivo.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || null
    : null;
  return { endpoint, p256dh, auth, dispositivo };
}

/** Dispositivos por cuenta: al suscribir uno más, se quitan los más antiguos. */
export const MAX_SUSCRIPCIONES_POR_PERFIL = 10;

/** El endpoint es la identidad: el mismo dispositivo con otra cuenta se la queda. */
export async function guardarSuscripcion(db: DbAvisos, profileId: string, s: DatosSuscripcion, ahora = new Date()): Promise<void> {
  await db.execute(sql`
    INSERT INTO notificacion_suscripcion (id, profile_id, endpoint, p256dh, auth, dispositivo, creada_en, fallos)
    VALUES (${crypto.randomUUID()}, ${profileId}, ${s.endpoint}, ${s.p256dh}, ${s.auth}, ${s.dispositivo ?? null}, ${ahora.getTime()}, 0)
    ON CONFLICT (endpoint) DO UPDATE SET profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
      dispositivo = excluded.dispositivo, creada_en = excluded.creada_en, fallos = 0`);
  await db.execute(sql`
    DELETE FROM notificacion_suscripcion
    WHERE profile_id = ${profileId} AND endpoint <> ${s.endpoint} AND id NOT IN (
      SELECT id FROM notificacion_suscripcion WHERE profile_id = ${profileId}
      ORDER BY (endpoint = ${s.endpoint}) DESC, creada_en DESC, id DESC LIMIT ${MAX_SUSCRIPCIONES_POR_PERFIL}
    )`);
}

export async function borrarSuscripcion(db: DbAvisos, profileId: string, endpoint: string): Promise<void> {
  await db.execute(sql`DELETE FROM notificacion_suscripcion WHERE profile_id = ${profileId} AND endpoint = ${endpoint}`);
}

export async function listarSuscripciones(db: DbAvisos, profileIds: readonly string[]): Promise<Suscripcion[]> {
  if (profileIds.length === 0) return [];
  const filas = await filasDe<{
    id: string; profile_id: string; endpoint: string; p256dh: string; auth: string;
    dispositivo: string | null; creada_en: number; fallos: number;
  }>(db, sql`
    SELECT id, profile_id, endpoint, p256dh, auth, dispositivo, creada_en, fallos FROM notificacion_suscripcion
    WHERE profile_id IN (SELECT value FROM json_each(${jsonLista(profileIds)}))
    ORDER BY creada_en DESC`);
  return filas.map((f) => ({
    id: f.id, profileId: f.profile_id, endpoint: f.endpoint, p256dh: f.p256dh, auth: f.auth,
    dispositivo: f.dispositivo, creadaEn: Number(f.creada_en), fallos: Number(f.fallos),
  }));
}

/**
 * `omitidas`: envíos que no se intentaron por pasar de `MAX_ENVIOS_POR_PASADA`.
 * Esos avisos siguen en la campana, pero al móvil no les llega nada: no se
 * reintentan en la pasada siguiente.
 */
export type ResumenEnvio = { enviadas: number; caducadasBorradas: number; rechazadas: number; errores: number; omitidas: number };

export const RESUMEN_VACIO: ResumenEnvio = { enviadas: 0, caducadasBorradas: 0, rechazadas: 0, errores: 0, omitidas: 0 };

/** Peticiones al servicio de push a la vez. */
export const CONCURRENCIA_PUSH = 6;
/** Tope de peticiones de push por pasada (cron o acción), para acotar el tiempo y las subpeticiones del Worker. */
export const MAX_ENVIOS_POR_PASADA = 500;

type Envio = { suscripcion: Suscripcion; mensaje: MensajePush };

/** Ids por sentencia al apuntar el resultado de los envíos (un solo parámetro JSON). */
export const IDS_POR_SENTENCIA = 200;

/**
 * Envía un mensaje a cada suscripción y limpia: 404/410 se borra, un rechazo
 * suma un fallo y a los `MAX_FALLOS` también se borra. Un error de red o un
 * 5xx no toca nada. Los mensajes de una misma suscripción van en serie;
 * suscripciones distintas, hasta `CONCURRENCIA_PUSH` a la vez.
 *
 * El resultado se apunta en la base AL FINAL y en lote: un UPDATE y un DELETE
 * por cada `IDS_POR_SENTENCIA` suscripciones, no una sentencia por envío. Con
 * 500 envíos eran ≥500 consultas de las 1.000 que admite una invocación del
 * Worker; ahora son 2–6. Los fallos se cuentan en memoria partiendo de
 * `Suscripcion.fallos`, así que una cola sigue parándose en el envío que
 * alcanza `MAX_FALLOS`, igual que antes.
 */
export async function enviarASuscripciones(
  db: DbAvisos,
  envios: readonly Envio[],
  vapid: ClavesVapid,
  opciones: { fetch?: typeof fetch; ahora?: Date; concurrencia?: number; maxEnvios?: number } = {},
): Promise<ResumenEnvio> {
  const resumen = { ...RESUMEN_VACIO };
  const ahora = opciones.ahora ?? new Date();
  const maxEnvios = opciones.maxEnvios ?? MAX_ENVIOS_POR_PASADA;
  const aceptados = envios.slice(0, maxEnvios);
  resumen.omitidas = envios.length - aceptados.length;

  const porSuscripcion = new Map<string, Envio[]>();
  for (const e of aceptados) porSuscripcion.set(e.suscripcion.id, [...(porSuscripcion.get(e.suscripcion.id) ?? []), e]);
  const colas = [...porSuscripcion.values()];

  /** Lo que hay que apuntar de cada suscripción tocada. */
  type Apunte = { enviada: boolean; rechazosTrasEnvio: number; borrar: boolean };
  const apuntes = new Map<string, Apunte>();

  async function enviarCola(cola: Envio[]): Promise<void> {
    let fallos = cola[0]?.suscripcion.fallos ?? 0;
    for (const { suscripcion, mensaje } of cola) {
      const apunte = apuntes.get(suscripcion.id) ?? { enviada: false, rechazosTrasEnvio: 0, borrar: false };
      apuntes.set(suscripcion.id, apunte);
      const r: ResultadoEnvio = await enviarPush(suscripcion, mensaje, vapid, { fetch: opciones.fetch, ahora });
      if (r.estado === 'enviada') {
        resumen.enviadas++;
        apunte.enviada = true;
        apunte.rechazosTrasEnvio = 0;
        fallos = 0;
      } else if (r.estado === 'caducada') {
        apunte.borrar = true;
        return;
      } else if (r.estado === 'rechazada') {
        resumen.rechazadas++;
        apunte.rechazosTrasEnvio++;
        fallos++;
        if (fallos >= MAX_FALLOS) {
          apunte.borrar = true;
          return;
        }
      } else {
        resumen.errores++;
      }
    }
  }

  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.max(1, Math.min(opciones.concurrencia ?? CONCURRENCIA_PUSH, colas.length)) }, async () => {
    while (siguiente < colas.length) await enviarCola(colas[siguiente++]);
  });
  await Promise.all(trabajadores);

  const aBorrar = [...apuntes].filter(([, a]) => a.borrar).map(([id]) => id);
  const aActualizar = [...apuntes]
    .filter(([, a]) => !a.borrar && (a.enviada || a.rechazosTrasEnvio > 0))
    .map(([id, a]) => ({ id, enviada: a.enviada ? 1 : 0, n: a.rechazosTrasEnvio }));
  for (let i = 0; i < aActualizar.length; i += IDS_POR_SENTENCIA) {
    // Tras un envío correcto los fallos son los rechazos posteriores; sin envío, se suman a los guardados.
    await db.execute(sql`
      WITH v AS (
        SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.enviada') AS enviada, json_extract(value, '$.n') AS n
          FROM json_each(${JSON.stringify(aActualizar.slice(i, i + IDS_POR_SENTENCIA))})
      )
      UPDATE notificacion_suscripcion
         SET fallos = CASE WHEN v.enviada = 1 THEN v.n ELSE notificacion_suscripcion.fallos + v.n END,
             ultimo_envio_en = CASE WHEN v.enviada = 1 THEN ${ahora.getTime()} ELSE notificacion_suscripcion.ultimo_envio_en END
        FROM v
       WHERE notificacion_suscripcion.id = v.id`);
  }
  for (let i = 0; i < aBorrar.length; i += IDS_POR_SENTENCIA) {
    await db.execute(sql`
      DELETE FROM notificacion_suscripcion
       WHERE id IN (SELECT value FROM json_each(${jsonLista(aBorrar.slice(i, i + IDS_POR_SENTENCIA))}))`);
  }
  resumen.caducadasBorradas = aBorrar.length;
  return resumen;
}
