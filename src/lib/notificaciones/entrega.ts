import { marcarPushEnviada, type AvisoGuardado } from './bandeja';
import type { DbAvisos } from './db';
import type { MensajePush } from './push/enviar';
import { leerClavesVapid, type ClavesVapid } from './push/vapid';
import { enviarASuscripciones, listarSuscripciones, RESUMEN_VACIO, type ResumenEnvio } from './suscripciones';
import { recortar } from './textos';

/** Con más avisos que esto en una misma pasada, al móvil le llega uno que los resume. */
export const MAX_PUSH_POR_PASADA = 3;

export function mensajeDe(g: AvisoGuardado): MensajePush {
  return {
    titulo: recortar(g.aviso.titulo, 120),
    cuerpo: recortar(g.aviso.cuerpo, 400),
    url: g.aviso.url,
    etiqueta: g.aviso.clave.slice(0, 64),
  };
}

/** Mensajes de un perfil en una pasada: uno por aviso o, si son muchos, uno solo. */
export function mensajesDePerfil(guardados: readonly AvisoGuardado[]): MensajePush[] {
  if (guardados.length <= MAX_PUSH_POR_PASADA) return guardados.map(mensajeDe);
  const titulares = guardados.slice(0, 3).map((g) => g.aviso.titulo).join(' · ');
  return [{
    titulo: `${guardados.length} avisos nuevos`,
    cuerpo: recortar(titulares, 400),
    url: '/notificaciones',
    etiqueta: 'resumen',
  }];
}

export type OpcionesEntrega = { vapid?: ClavesVapid | null; fetch?: typeof fetch; ahora?: Date };

export type ResumenEntrega = ResumenEnvio & { sinClaves: boolean };

/** Empuja al móvil lo que `guardarAvisos` marcó con `push`. Sin claves VAPID no hace nada. */
export async function entregarPush(
  db: DbAvisos,
  guardados: readonly AvisoGuardado[],
  opciones: OpcionesEntrega = {},
): Promise<ResumenEntrega> {
  const vapid = opciones.vapid === undefined ? leerClavesVapid() : opciones.vapid;
  const conPush = guardados.filter((g) => g.push);
  if (conPush.length === 0) return { ...RESUMEN_VACIO, sinClaves: !vapid };
  if (!vapid) return { ...RESUMEN_VACIO, sinClaves: true };

  const porPerfil = new Map<string, AvisoGuardado[]>();
  for (const g of conPush) porPerfil.set(g.aviso.profileId, [...(porPerfil.get(g.aviso.profileId) ?? []), g]);
  const suscripciones = await listarSuscripciones(db, [...porPerfil.keys()]);
  const envios = suscripciones.flatMap((s) => mensajesDePerfil(porPerfil.get(s.profileId) ?? []).map((mensaje) => ({ suscripcion: s, mensaje })));
  const resumen = await enviarASuscripciones(db, envios, vapid, { fetch: opciones.fetch, ahora: opciones.ahora });
  const conDestino = new Set(suscripciones.map((s) => s.profileId));
  await marcarPushEnviada(db, conPush.filter((g) => conDestino.has(g.aviso.profileId)).map((g) => g.id), opciones.ahora);
  return { ...resumen, sinClaves: false };
}
