/** Contrato mínimo: sólo enlaces oficiales, nunca identidad de cuenta ni payload FIE. */
export type FotoPublicada = { src: string; fichaUrl: string };

export type ResultadoFoto =
  | { estado: 'publicada'; foto: FotoPublicada }
  | { estado: 'foto_no_publicada' }
  | { estado: 'entrada_invalida' }
  | { estado: 'no_disponible' };

export const ANCHO_FOTO_FIE = 320;
/**
 * Los dos anchos que ya pide el resto de la aplicación (ver `ranking.ts`): así
 * se comparte la caché del redimensionador de la FIE y no se le multiplican las
 * transformaciones. Medido el 05/10/2026: 2 KB a 96 px y 16 KB a 320, en AVIF y
 * con `max-age=2592000`, así que el navegador las guarda un mes.
 */
export const ANCHOS_RETRATO_FIE = [96, ANCHO_FOTO_FIE] as const;
export type AnchoRetratoFie = (typeof ANCHOS_RETRATO_FIE)[number];
const prefijoRetrato = (ancho: number) => `/cdn-cgi/image/width=${ancho},quality=80,format=auto/`;

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
  if (!url || url.hostname !== 'fie.org') return null;
  const prefijo = ANCHOS_RETRATO_FIE.map(prefijoRetrato).find((p) => url.pathname.startsWith(p));
  if (!prefijo) return null;
  return urlFotoOriginal(url.pathname.slice(prefijo.length)) ? url : null;
}

/** El mismo original al otro ancho permitido; nunca acepta un ancho libre. */
export function retratoAncho(src: string, ancho: AnchoRetratoFie): string | null {
  const url = urlRetratoOficial(src);
  if (!url || !ANCHOS_RETRATO_FIE.includes(ancho)) return null;
  const prefijo = ANCHOS_RETRATO_FIE.map(prefijoRetrato).find((p) => url.pathname.startsWith(p))!;
  return `https://fie.org${prefijoRetrato(ancho)}${url.pathname.slice(prefijo.length)}`;
}

/** 96 px cubren hasta 48 px CSS en pantallas 2x; por encima, el de 320. */
export function anchoRetratoPara(medidaCss: number): AnchoRetratoFie {
  return medidaCss * 2 <= 96 ? 96 : ANCHO_FOTO_FIE;
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
