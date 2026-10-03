/** Contrato mínimo: sólo enlaces oficiales, nunca identidad de cuenta ni payload FIE. */
export type FotoPublicada = { src: string; fichaUrl: string };

export type ResultadoFoto =
  | { estado: 'publicada'; foto: FotoPublicada }
  | { estado: 'foto_no_publicada' }
  | { estado: 'entrada_invalida' }
  | { estado: 'no_disponible' };

export const ANCHO_FOTO_FIE = 320;

function urlHttps(valor: unknown): URL | null {
  if (typeof valor !== 'string' || valor.length > 2048) return null;
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.hash || url.search || /[\\\u0000-\u0020]/u.test(valor)) return null;
    return url;
  } catch {
    return null;
  }
}

/** No se aceptan SVG, HTML, puertos, credenciales ni URLs proporcionadas por el cliente. */
export function urlFotoOriginal(valor: unknown): URL | null {
  const url = urlHttps(valor);
  if (!url || url.hostname !== 'static.fie.org' ||
    !/\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname)) return null;
  return url;
}

export function urlRetratoOficial(valor: unknown): URL | null {
  const url = urlHttps(valor);
  const prefijo = `/cdn-cgi/image/width=${ANCHO_FOTO_FIE},quality=80,format=auto/`;
  if (!url || url.hostname !== 'fie.org' || !url.pathname.startsWith(prefijo)) return null;
  return urlFotoOriginal(url.pathname.slice(prefijo.length)) ? url : null;
}

export function urlFichaOficial(valor: unknown): URL | null {
  const url = urlHttps(valor);
  return url?.hostname === 'fie.org' && /^\/athletes\/[1-9]\d{0,9}$/.test(url.pathname)
    ? url : null;
}

/** También se valida la respuesta en el cliente; jamás convierte el componente en proxy. */
export function fotoPublicadaValida(valor: unknown): valor is FotoPublicada {
  if (!valor || typeof valor !== 'object') return false;
  const foto = valor as Record<string, unknown>;
  return !!urlRetratoOficial(foto.src) && !!urlFichaOficial(foto.fichaUrl);
}
