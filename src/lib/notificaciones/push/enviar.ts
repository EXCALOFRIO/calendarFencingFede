import { utf8 } from './base64url';
import { cifrarMensajePush, MAX_TEXTO_PUSH, type ClavesSuscripcion, type OpcionesCifrado } from './cifrado';
import { cabeceraVapid, type ClavesVapid } from './vapid';

/** Lo que recibe el trabajador de servicio (`public/sw.js`) en el evento `push`. */
export type MensajePush = {
  titulo: string;
  cuerpo: string;
  /** Ruta interna que abre `notificationclick`. */
  url: string;
  /** Sustituye en el dispositivo a la notificación anterior con la misma etiqueta. */
  etiqueta: string;
};

export type SuscripcionPush = ClavesSuscripcion & { endpoint: string };

export type ResultadoEnvio =
  /** El servicio la aceptó (201/202). */
  | { estado: 'enviada'; status: number }
  /**
   * 404/410: la suscripción ya no existe y hay que borrarla (RFC 8030 §7.3).
   * `status: null`: el endpoint guardado ya no pasa `endpointValido`; se borra sin llamar.
   */
  | { estado: 'caducada'; status: number | null }
  /** Rechazo permanente de este mensaje o de esta suscripción (400, 401, 403, 413, o una redirección). */
  | { estado: 'rechazada'; status: number }
  /** Error de red, 429 o 5xx: se reintenta otro día, no se borra nada. */
  | { estado: 'error'; status: number | null };

export type OpcionesEnvio = {
  fetch?: typeof fetch;
  ahora?: Date;
  /** Segundos que el servicio guarda el mensaje si el dispositivo no está conectado. */
  ttl?: number;
  urgencia?: 'very-low' | 'low' | 'normal' | 'high';
  cifrado?: OpcionesCifrado;
};

function codificar(mensaje: MensajePush): Uint8Array<ArrayBuffer> {
  let m = { ...mensaje };
  let bytes = utf8(JSON.stringify(m));
  // Recorta el cuerpo hasta caber en un registro: un texto largo no debe tumbar el aviso.
  while (bytes.length > MAX_TEXTO_PUSH - 64 && m.cuerpo.length > 0) {
    m = { ...m, cuerpo: `${m.cuerpo.slice(0, Math.floor(m.cuerpo.length * 0.8)).trimEnd()}…` };
    bytes = utf8(JSON.stringify(m));
  }
  return bytes;
}

/**
 * Servicios de push de los navegadores reales (Chrome/Edge/Android, Firefox,
 * Safari, Windows). El endpoint lo manda el cliente, así que cualquier otro host
 * convertiría el envío en una petición del Worker a donde quiera quien suscribe.
 */
const HOSTS_PUSH_EXACTOS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com']);
const SUFIJOS_PUSH = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function endpointValido(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return HOSTS_PUSH_EXACTOS.has(host) || SUFIJOS_PUSH.some((s) => host.endsWith(s) && host.length > s.length);
}

/** Un servicio de push que no contesta en este tiempo cuenta como error de red. */
export const TIEMPO_MAX_ENVIO_MS = 10_000;

export async function enviarPush(
  suscripcion: SuscripcionPush,
  mensaje: MensajePush,
  vapid: ClavesVapid,
  opciones: OpcionesEnvio = {},
): Promise<ResultadoEnvio> {
  // Una suscripción guardada antes de restringir los hosts no se usa nunca más: se borra.
  if (!endpointValido(suscripcion.endpoint)) return { estado: 'caducada', status: null };
  let cuerpo: Uint8Array<ArrayBuffer>;
  let autorizacion: string;
  try {
    cuerpo = await cifrarMensajePush(codificar(mensaje), suscripcion, opciones.cifrado);
    autorizacion = await cabeceraVapid(suscripcion.endpoint, vapid, opciones.ahora ?? new Date());
  } catch {
    // Claves de la suscripción corruptas: no hay forma de entregarle nada nunca.
    return { estado: 'rechazada', status: 400 };
  }
  let respuesta: Response;
  try {
    respuesta = await (opciones.fetch ?? fetch)(suscripcion.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(opciones.ttl ?? 86_400),
        Urgency: opciones.urgencia ?? 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: autorizacion,
      },
      body: cuerpo,
      // Una redirección llevaría la petición fuera de la lista de hosts permitidos.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIEMPO_MAX_ENVIO_MS),
    });
  } catch {
    return { estado: 'error', status: null };
  }
  const status = respuesta.status;
  // El cuerpo de la respuesta no se lee ni se registra: puede traer el endpoint.
  await respuesta.body?.cancel().catch(() => {});
  // `opaqueredirect` (status 0) es como lo entrega un navegador; el Worker da el 3xx tal cual.
  if (respuesta.type === 'opaqueredirect' || (status >= 300 && status < 400)) return { estado: 'rechazada', status };
  if (status >= 200 && status < 300) return { estado: 'enviada', status };
  if (status === 404 || status === 410) return { estado: 'caducada', status };
  if (status === 400 || status === 401 || status === 403 || status === 413) return { estado: 'rechazada', status };
  return { estado: 'error', status };
}
