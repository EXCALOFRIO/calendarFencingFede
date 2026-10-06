import {
  fieFichaApiUrl,
  fieFichaPublicaUrl,
  fotoFieAncho,
} from '@/lib/ingest/sources/fie-tiradores';
import {
  ANCHO_FOTO_FIE,
  urlFotoOriginal,
  urlRetratoOficial,
  type FotoPublicada,
} from './foto-contrato';

export const LIMITES_FOTO = {
  tiempoMs: 6000,
  redirecciones: 2,
  perfilBytes: 256 * 1024,
  imagenBytes: 256 * 1024,
} as const;

export type OpcionesFuente = { fetch?: typeof fetch; signal?: AbortSignal };

/**
 * `sin_foto` es una respuesta de la FIE (no hay retrato, no es adulto, el ID no
 * coincide...) y se puede recordar. `fallo` es nuestro o pasajero (red, tiempo,
 * 5xx, 429, una página de desafío en vez de JSON) y no se debe recordar como
 * ausencia: la próxima vez puede salir bien.
 */
export type ResolucionFoto =
  | { tipo: 'publicada'; foto: FotoPublicada; bytes: number }
  | { tipo: 'sin_foto' }
  | { tipo: 'fallo' };

const TIPOS_IMAGEN = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);
const SIN_FOTO = { tipo: 'sin_foto' } as const;
const FALLO = { tipo: 'fallo' } as const;
/** Respuestas que dicen «no existe», no «ahora no puedo». */
const AUSENTE = new Set([404, 410]);

/**
 * Una ficha singular, nunca censo/búsqueda por nombre. Sólo conserva dos URLs.
 * La política de la fuente prohíbe rehospedar: la imagen se comprueba con HEAD
 * y se enlaza al redimensionador de la FIE, sin descargar/copiar sus píxeles.
 */
export async function resolverFotoOficial(
  fieId: number,
  hoy: string,
  opciones: OpcionesFuente = {},
): Promise<ResolucionFoto> {
  if (!Number.isSafeInteger(fieId) || fieId < 1 || fieId > 9_999_999_999) return SIN_FOTO;
  if (opciones.signal?.aborted) return FALLO;

  const controlador = new AbortController();
  const solicitar = opciones.fetch ?? fetch;
  let restantes = LIMITES_FOTO.redirecciones as number;
  let detener: () => void = () => {};
  const interrumpida = new Promise<ResolucionFoto>((resolve) => {
    detener = () => { controlador.abort(); resolve(FALLO); };
  });
  const temporizador = setTimeout(detener, LIMITES_FOTO.tiempoMs);
  opciones.signal?.addEventListener('abort', detener, { once: true });

  async function pedir(
    inicio: string,
    metodo: 'GET' | 'HEAD',
    permitida: (url: string) => boolean,
  ): Promise<Response | null> {
    let url = inicio;
    for (;;) {
      if (controlador.signal.aborted || !permitida(url)) return null;
      const respuesta = await solicitar(url, {
        method: metodo,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: metodo === 'GET' ? 'application/json' : 'image/jpeg,image/png,image/webp,image/avif' },
        signal: controlador.signal,
      });
      if (controlador.signal.aborted) {
        void respuesta.body?.cancel().catch(() => {});
        return null;
      }
      if (!REDIRECCIONES.has(respuesta.status)) return respuesta;
      void respuesta.body?.cancel().catch(() => {});
      const destino = respuesta.headers.get('location');
      if (!destino || restantes-- <= 0) return null;
      url = new URL(destino, url).href;
    }
  }

  /** Una redirección ajena o en bucle es una respuesta de la fuente; un aborto, no. */
  const sinRespuesta = (): ResolucionFoto => controlador.signal.aborted ? FALLO : SIN_FOTO;

  async function leer(): Promise<ResolucionFoto> {
    const apiUrl = fieFichaApiUrl(fieId);
    // Redirecciones sólo a la misma ficha, nunca a otro ID o dominio.
    const respuesta = await pedir(apiUrl, 'GET', (url) => url === apiUrl);
    if (!respuesta) return sinRespuesta();
    try {
      if (!respuesta.ok) return AUSENTE.has(respuesta.status) ? SIN_FOTO : FALLO;
      const tipo = respuesta.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const longitud = respuesta.headers.get('content-length');
      // Un 200 en HTML suele ser el desafío antibots de su Cloudflare: pasajero.
      if (tipo !== 'application/json' || !respuesta.body) return FALLO;
      if (longitud !== null && (!/^\d+$/.test(longitud) || Number(longitud) > LIMITES_FOTO.perfilBytes)) return SIN_FOTO;

      const lector = respuesta.body.getReader();
      const trozos: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          if (controlador.signal.aborted) return FALLO;
          const { done, value } = await lector.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > LIMITES_FOTO.perfilBytes) return SIN_FOTO;
          trozos.push(value);
        }
      } finally {
        void lector.cancel().catch(() => {});
        lector.releaseLock();
      }
      const contenido = new Uint8Array(bytes);
      let offset = 0;
      for (const trozo of trozos) { contenido.set(trozo, offset); offset += trozo.length; }
      let perfil: unknown;
      try {
        perfil = JSON.parse(new TextDecoder().decode(contenido));
      } catch {
        return FALLO;
      }
      if (!perfil || typeof perfil !== 'object' || Array.isArray(perfil)) return SIN_FOTO;
      const publicado = perfil as Record<string, unknown>;
      // Vale para cualquier nacionalidad, pero el ID publicado debe ser exactamente el pedido.
      if (publicado.id !== fieId) return SIN_FOTO;
      // No se guarda ni devuelve el cumpleaños; se usa únicamente como veto.
      if (typeof publicado.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(publicado.date) &&
        Number(hoy.slice(0, 4)) - Number(publicado.date.slice(0, 4)) <= 18) return SIN_FOTO;
      const original = urlFotoOriginal(publicado.image);
      if (!original) return SIN_FOTO;
      const src = fotoFieAncho(original.href, ANCHO_FOTO_FIE);
      if (!src || !urlRetratoOficial(src)) return SIN_FOTO;

      const imagen = await pedir(src, 'HEAD', (url) =>
        !!urlRetratoOficial(url) && urlRetratoOficial(url)?.pathname === new URL(src).pathname);
      if (!imagen) return sinRespuesta();
      try {
        if (!imagen.ok) return AUSENTE.has(imagen.status) ? SIN_FOTO : FALLO;
        const tipoImagen = imagen.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        const peso = imagen.headers.get('content-length');
        // Sin tamaño publicado no podemos demostrar el límite: queda el fallback,
        // pero sin recordarlo, porque un CDN puede omitirlo una vez y no la siguiente.
        if (peso === null) return FALLO;
        if (!tipoImagen || !TIPOS_IMAGEN.has(tipoImagen) ||
          !/^\d+$/.test(peso) || Number(peso) < 1 ||
          Number(peso) > LIMITES_FOTO.imagenBytes) return SIN_FOTO;
        return { tipo: 'publicada', foto: { src, fichaUrl: fieFichaPublicaUrl(fieId) }, bytes: Number(peso) };
      } finally {
        void imagen.body?.cancel().catch(() => {});
      }
    } finally {
      if (!respuesta.body?.locked) void respuesta.body?.cancel().catch(() => {});
    }
  }

  try {
    return await Promise.race([leer().catch((): ResolucionFoto => FALLO), interrumpida]);
  } finally {
    clearTimeout(temporizador);
    opciones.signal?.removeEventListener('abort', detener);
    controlador.abort();
  }
}

/** Atajo sin distinguir ausencia de fallo, para quien sólo quiere la foto. */
export async function leerFotoOficial(
  fieId: number,
  hoy: string,
  opciones: OpcionesFuente = {},
): Promise<FotoPublicada | null> {
  const resolucion = await resolverFotoOficial(fieId, hoy, opciones);
  return resolucion.tipo === 'publicada' ? resolucion.foto : null;
}
