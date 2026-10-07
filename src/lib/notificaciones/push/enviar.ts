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
  /** 404/410: la suscripción ya no existe y hay que borrarla (RFC 8030 §7.3). */
  | { estado: 'caducada'; status: number }
  /** Rechazo permanente de este mensaje o de esta suscripción (400, 401, 403, 413). */
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

export function endpointValido(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && endpoint.length <= 1000;
  } catch {
    return false;
  }
}

export async function enviarPush(
  suscripcion: SuscripcionPush,
  mensaje: MensajePush,
  vapid: ClavesVapid,
  opciones: OpcionesEnvio = {},
): Promise<ResultadoEnvio> {
  if (!endpointValido(suscripcion.endpoint)) return { estado: 'rechazada', status: 400 };
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
    });
  } catch {
    return { estado: 'error', status: null };
  }
  const status = respuesta.status;
  // El cuerpo de la respuesta no se lee ni se registra: puede traer el endpoint.
  await respuesta.body?.cancel().catch(() => {});
  if (status >= 200 && status < 300) return { estado: 'enviada', status };
  if (status === 404 || status === 410) return { estado: 'caducada', status };
  if (status === 400 || status === 401 || status === 403 || status === 413) return { estado: 'rechazada', status };
  return { estado: 'error', status };
}
