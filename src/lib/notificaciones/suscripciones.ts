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

/**
 * Envía un mensaje a cada suscripción y limpia: 404/410 se borra en el acto,
 * un rechazo suma un fallo y a los `MAX_FALLOS` también se borra. Un error de
 * red o un 5xx no toca nada. Los mensajes de una misma suscripción van en
 * serie; suscripciones distintas, hasta `CONCURRENCIA_PUSH` a la vez.
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

  async function enviarCola(cola: Envio[]): Promise<void> {
    for (const { suscripcion, mensaje } of cola) {
      const r: ResultadoEnvio = await enviarPush(suscripcion, mensaje, vapid, { fetch: opciones.fetch, ahora });
      if (r.estado === 'enviada') {
        resumen.enviadas++;
        await db.execute(sql`UPDATE notificacion_suscripcion SET ultimo_envio_en = ${ahora.getTime()}, fallos = 0 WHERE id = ${suscripcion.id}`);
      } else if (r.estado === 'caducada') {
        await db.execute(sql`DELETE FROM notificacion_suscripcion WHERE id = ${suscripcion.id}`);
        resumen.caducadasBorradas++;
        return;
      } else if (r.estado === 'rechazada') {
        resumen.rechazadas++;
        const [fila] = await filasDe<{ fallos: number }>(db, sql`
          UPDATE notificacion_suscripcion SET fallos = fallos + 1 WHERE id = ${suscripcion.id} RETURNING fallos`);
        if (fila && Number(fila.fallos) >= MAX_FALLOS) {
          await db.execute(sql`DELETE FROM notificacion_suscripcion WHERE id = ${suscripcion.id}`);
          resumen.caducadasBorradas++;
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
  return resumen;
}
