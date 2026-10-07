'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireProfile, requireWritableProfile } from '@/lib/auth/session';
import {
  abrirAviso, contarPruebasRecientes, guardarAvisos, guardarPreferencia, leerPreferenciasDe, marcarTodasLeidas, MAX_PRUEBAS_POR_HORA,
} from '@/lib/notificaciones/bandeja';
import { esFaltaDeTabla } from '@/lib/notificaciones/db';
import { entregarPush } from '@/lib/notificaciones/entrega';
import { endpointValido } from '@/lib/notificaciones/push/enviar';
import { borrarSuscripcion, guardarSuscripcion, validarSuscripcion } from '@/lib/notificaciones/suscripciones';
import { esClavePreferencia, esRutaInterna } from '@/lib/notificaciones/tipos';

/**
 * Acciones de la bandeja y de Ajustes › Notificaciones. Ninguna recibe un
 * identificador de perfil de fuera: todas trabajan sobre la cuenta de la
 * sesión, y las que escriben exigen una sesión con escritura (la vista previa
 * y el acceso de QA son de solo lectura).
 */

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: string };

const SIN_MIGRACION = 'Las notificaciones todavía no están activadas en este servidor.';

function fallo(error: unknown): ResultadoAccion {
  if (esFaltaDeTabla(error)) return { ok: false, error: SIN_MIGRACION };
  if (error instanceof Error && /solo lectura|SOLO_LECTURA|vista previa/i.test(error.message)) {
    return { ok: false, error: 'La vista previa es de solo lectura.' };
  }
  return { ok: false, error: 'No se ha podido guardar. Vuelve a intentarlo.' };
}

/** Abre un aviso: lo marca leído (con los de su grupo) y lleva a su pantalla. */
export async function abrirAvisoAccion(formData: FormData): Promise<void> {
  const perfil = await requireProfile();
  const id = String(formData.get('id') ?? '');
  const destinoForm = String(formData.get('url') ?? '');
  let destino = esRutaInterna(destinoForm) ? destinoForm : '/notificaciones';
  if (!perfil.preview && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      destino = (await abrirAviso(db, perfil.profileId, id)) ?? destino;
    } catch {
      // Sin poder marcarlo se navega igual: el aviso sigue sin leer, que es lo honesto.
    }
    revalidatePath('/', 'layout');
  }
  redirect(destino);
}

export async function marcarTodasLeidasAccion(): Promise<void> {
  const perfil = await requireProfile();
  if (perfil.preview) return;
  try {
    await marcarTodasLeidas(db, perfil.profileId);
  } catch {
    return;
  }
  revalidatePath('/', 'layout');
}

export async function guardarPreferenciaAccion(clave: string, activa: boolean): Promise<ResultadoAccion> {
  if (!esClavePreferencia(clave) || typeof activa !== 'boolean') return { ok: false, error: 'Ajuste desconocido.' };
  try {
    const perfil = await requireWritableProfile();
    await guardarPreferencia(db, perfil.profileId, clave, activa);
  } catch (error) {
    return fallo(error);
  }
  revalidatePath('/ajustes/notificaciones');
  return { ok: true, mensaje: activa ? 'Activado.' : 'Desactivado.' };
}

export async function suscribirAccion(entrada: unknown): Promise<ResultadoAccion> {
  const endpoint = entrada && typeof entrada === 'object' ? (entrada as { endpoint?: unknown }).endpoint : null;
  if (typeof endpoint !== 'string' || !endpointValido(endpoint.trim())) {
    return { ok: false, error: 'Este navegador usa un servicio de notificaciones que no admitimos.' };
  }
  const datos = validarSuscripcion(entrada);
  if (!datos) return { ok: false, error: 'El navegador ha devuelto una suscripción que no se puede usar.' };
  try {
    const perfil = await requireWritableProfile();
    await guardarSuscripcion(db, perfil.profileId, datos);
  } catch (error) {
    return fallo(error);
  }
  return { ok: true, mensaje: 'Este dispositivo recibirá las notificaciones.' };
}

export async function desuscribirAccion(endpoint: string): Promise<ResultadoAccion> {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return { ok: false, error: 'Dispositivo desconocido.' };
  try {
    const perfil = await requireWritableProfile();
    await borrarSuscripcion(db, perfil.profileId, endpoint);
  } catch (error) {
    return fallo(error);
  }
  return { ok: true, mensaje: 'Este dispositivo ya no recibirá notificaciones.' };
}

/**
 * Un aviso de prueba por los canales encendidos, sin mirar los tipos (no es
 * de ninguno). Dice lo que ha pasado con cada canal, incluido «no hay ningún
 * dispositivo suscrito».
 */
export async function notificacionPruebaAccion(): Promise<ResultadoAccion> {
  try {
    const perfil = await requireWritableProfile();
    const preferencias = await leerPreferenciasDe(db, perfil.profileId);
    if (!preferencias['canal:campana'] && !preferencias['canal:push']) {
      return { ok: false, error: 'Tienes los dos canales apagados: enciende la campana o el móvil para probar.' };
    }
    const ahora = new Date();
    if ((await contarPruebasRecientes(db, perfil.profileId, ahora)) >= MAX_PRUEBAS_POR_HORA) {
      return { ok: false, error: 'Ya has enviado varias pruebas. Espera un rato.' };
    }
    const guardados = await guardarAvisos(db, [{
      profileId: perfil.profileId,
      tipo: 'prueba',
      clave: `prueba:${ahora.getTime()}`,
      grupo: 'prueba',
      titulo: 'Notificación de prueba',
      cuerpo: 'Si ves esto, los avisos de CalendarFencing te llegan bien.',
      url: '/notificaciones',
      datos: null,
    }], new Map([[perfil.profileId, preferencias]]), ahora);
    const push = await entregarPush(db, guardados, { ahora });
    revalidatePath('/', 'layout');

    const partes: string[] = [];
    if (preferencias['canal:campana']) partes.push('Está en la campana.');
    if (preferencias['canal:push']) {
      if (push.sinClaves) partes.push('El envío al móvil no está configurado en el servidor.');
      else if (push.enviadas > 0) partes.push(`Enviada a ${push.enviadas} ${push.enviadas === 1 ? 'dispositivo' : 'dispositivos'}.`);
      else if (push.caducadasBorradas > 0) partes.push('La suscripción de tu dispositivo había caducado y se ha quitado: vuelve a activarla.');
      else if (push.errores + push.rechazadas > 0) partes.push('El servicio de notificaciones no la ha aceptado. Prueba de nuevo más tarde.');
      else partes.push('No hay ningún dispositivo con las notificaciones activadas.');
    }
    return { ok: true, mensaje: partes.join(' ') };
  } catch (error) {
    return fallo(error);
  }
}
