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

type OpcionesFuente = { fetch?: typeof fetch; signal?: AbortSignal };
const TIPOS_IMAGEN = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

/**
 * Una ficha singular, nunca censo/búsqueda por nombre. Sólo conserva dos URLs.
 * La política de la fuente prohíbe rehospedar: la imagen se comprueba con HEAD
 * y se enlaza al redimensionador de la FIE, sin descargar/copiar sus píxeles.
 */
export async function leerFotoOficial(
  fieId: number,
  hoy: string,
  opciones: OpcionesFuente = {},
): Promise<FotoPublicada | null> {
  if (!Number.isSafeInteger(fieId) || fieId < 1 || fieId > 9_999_999_999) return null;
  if (opciones.signal?.aborted) return null;

  const controlador = new AbortController();
  const solicitar = opciones.fetch ?? fetch;
  let restantes = LIMITES_FOTO.redirecciones as number;
  let detener: () => void = () => {};
  const interrumpida = new Promise<null>((resolve) => {
    detener = () => { controlador.abort(); resolve(null); };
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

  async function leer(): Promise<FotoPublicada | null> {
    const apiUrl = fieFichaApiUrl(fieId);
    // Redirecciones sólo a la misma ficha, nunca a otro ID o dominio.
    const respuesta = await pedir(apiUrl, 'GET', (url) => url === apiUrl);
    if (!respuesta) return null;
    try {
      const tipo = respuesta.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const longitud = respuesta.headers.get('content-length');
      if (!respuesta.ok || tipo !== 'application/json' ||
        (longitud !== null && (!/^\d+$/.test(longitud) || Number(longitud) > LIMITES_FOTO.perfilBytes)) ||
        !respuesta.body) return null;

      const lector = respuesta.body.getReader();
      const trozos: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          if (controlador.signal.aborted) return null;
          const { done, value } = await lector.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > LIMITES_FOTO.perfilBytes) return null;
          trozos.push(value);
        }
      } finally {
        void lector.cancel().catch(() => {});
        lector.releaseLock();
      }
      const contenido = new Uint8Array(bytes);
      let offset = 0;
      for (const trozo of trozos) { contenido.set(trozo, offset); offset += trozo.length; }
      const perfil: unknown = JSON.parse(new TextDecoder().decode(contenido));
      if (!perfil || typeof perfil !== 'object' || Array.isArray(perfil)) return null;
      const publicado = perfil as Record<string, unknown>;
      // España es el ámbito autorizado. El ID exacto debe coincidir.
      if (publicado.id !== fieId || publicado.countryCode !== 'ESP') return null;
      // No se guarda ni devuelve el cumpleaños; se usa únicamente como veto.
      if (typeof publicado.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(publicado.date) &&
        Number(hoy.slice(0, 4)) - Number(publicado.date.slice(0, 4)) <= 18) return null;
      const original = urlFotoOriginal(publicado.image);
      if (!original) return null;
      const src = fotoFieAncho(original.href, ANCHO_FOTO_FIE);
      if (!src || !urlRetratoOficial(src)) return null;

      const imagen = await pedir(src, 'HEAD', (url) =>
        !!urlRetratoOficial(url) && urlRetratoOficial(url)?.pathname === new URL(src).pathname);
      if (!imagen) return null;
      try {
        const tipoImagen = imagen.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        const peso = imagen.headers.get('content-length');
        // Sin tamaño publicado no podemos demostrar el límite: queda el fallback.
        if (!imagen.ok || !tipoImagen || !TIPOS_IMAGEN.has(tipoImagen) ||
          peso === null || !/^\d+$/.test(peso) || Number(peso) < 1 ||
          Number(peso) > LIMITES_FOTO.imagenBytes) return null;
        return { src, fichaUrl: fieFichaPublicaUrl(fieId) };
      } finally {
        void imagen.body?.cancel().catch(() => {});
      }
    } finally {
      if (!respuesta.body?.locked) void respuesta.body?.cancel().catch(() => {});
    }
  }

  try {
    return await Promise.race([leer().catch(() => null), interrumpida]);
  } finally {
    clearTimeout(temporizador);
    opciones.signal?.removeEventListener('abort', detener);
    controlador.abort();
  }
}
