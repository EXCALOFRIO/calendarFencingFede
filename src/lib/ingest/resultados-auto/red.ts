import { parsearRetryAfter } from '../http-retry';

/**
 * Red de la ingesta automática: sólo HTTPS a las fuentes deterministas, sin credenciales, con
 * tope de peticiones y de tiempo por pasada, una pausa mínima entre peticiones y el cuerpo
 * acotado. Un 429 o un 5xx detiene la pasada entera (no se insiste contra una fuente que pide
 * calma) y la unidad queda pendiente, nunca como «sin resultados».
 */
export const HOSTS_PERMITIDOS = ['fie.org', 'app.skermo.org', 'engarde-service.com', 'www.engarde-service.com'] as const;

/** Saltos de redirección que se siguen; cada uno cuenta como una petición más. */
export const MAX_REDIRECCIONES = 3;

function urlPermitida(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
    (HOSTS_PERMITIDOS as readonly string[]).includes(u.hostname);
}

const esRedireccion = (status: number) => status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

export class RedDetenida extends Error {
  constructor(public readonly motivo: 'peticiones' | 'tiempo' | 'limite_remoto' | 'fuente' | 'tamano',
    public readonly retryAfterMs: number | null = null) { super(`red_${motivo}`); }
}

export type Transporte = (url: string, init: RequestInit) => Promise<Response>;

export type Red = {
  json(url: string): Promise<unknown>;
  texto(url: string, init?: { method?: 'POST'; form?: Record<string, string> }): Promise<string>;
  bytes(url: string, maxBytes: number): Promise<Uint8Array>;
  readonly peticiones: number;
  /** Parada de toda la pasada (tope, tiempo, 429/5xx): lo leído después no es una respuesta de la fuente. */
  readonly detenida: RedDetenida | null;
};

export function crearRed(opciones: {
  maxPeticiones: number;
  restanteMs: () => number;
  transporte?: Transporte;
  pausaMs?: number;
  userAgent?: string;
}): Red {
  const transporte = opciones.transporte ?? ((url, init) => fetch(url, init));
  const pausa = opciones.pausaMs ?? 400;
  let peticiones = 0;
  let ultima = 0;
  let parada: RedDetenida | null = null;
  async function pedirUna(url: string, init: { method?: string; form?: Record<string, string> }): Promise<Response> {
    if (parada) throw parada;
    if (peticiones >= opciones.maxPeticiones) throw (parada = new RedDetenida('peticiones'));
    const espera = Math.max(0, pausa - (Date.now() - ultima));
    if (espera) await new Promise((r) => setTimeout(r, espera));
    const restante = opciones.restanteMs();
    if (restante < 2_000) throw (parada = new RedDetenida('tiempo'));
    peticiones += 1;
    ultima = Date.now();
    try {
      return await transporte(url, {
        method: init.method ?? 'GET',
        // Las redirecciones se siguen a mano para comprobar el destino contra HOSTS_PERMITIDOS.
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(15_000, restante - 1_000)),
        headers: {
          'User-Agent': opciones.userAgent ?? 'CalendarioEsgrima/1.0 (+resultados-automaticos)',
          ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
      });
    } catch {
      throw (parada = new RedDetenida('fuente'));
    }
  }
  async function pedir(url: string, init: { method?: 'POST'; form?: Record<string, string> } = {}, maxBytes = 3 * 1024 * 1024) {
    if (parada) throw parada;
    if (!urlPermitida(url)) throw new Error('resultados_auto_host_no_permitido');
    let actual = url;
    let peticion: { method?: string; form?: Record<string, string> } = init;
    let res = await pedirUna(actual, peticion);
    for (let saltos = 0; esRedireccion(res.status); saltos++) {
      const destino = res.headers.get('location');
      await res.body?.cancel();
      if (saltos >= MAX_REDIRECCIONES) throw new Error('resultados_auto_demasiadas_redirecciones');
      let siguiente: string;
      try {
        siguiente = new URL(destino ?? '', actual).href;
      } catch {
        throw new Error('resultados_auto_redireccion_no_permitida');
      }
      if (!destino || !urlPermitida(siguiente)) throw new Error('resultados_auto_redireccion_no_permitida');
      // Como fetch: 303, y 301/302 tras un POST, siguen con GET y sin cuerpo; 307/308 repiten tal cual.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && peticion.method === 'POST')) peticion = {};
      actual = siguiente;
      res = await pedirUna(actual, peticion);
    }
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      throw (parada = new RedDetenida(res.status === 429 ? 'limite_remoto' : 'fuente', parsearRetryAfter(res.headers.get('retry-after'))));
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`resultados_auto_http_${res.status}`);
    }
    const largo = Number(res.headers.get('content-length') ?? '0');
    if (largo > maxBytes) {
      await res.body?.cancel();
      throw new RedDetenida('tamano');
    }
    const cuerpo = new Uint8Array(await res.arrayBuffer());
    if (cuerpo.byteLength > maxBytes) throw new RedDetenida('tamano');
    return cuerpo;
  }
  const decodificar = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
  return {
    get peticiones() { return peticiones; },
    get detenida() { return parada; },
    json: async (url) => JSON.parse(decodificar(await pedir(url))),
    texto: async (url, init) => decodificar(await pedir(url, init?.form ? { method: 'POST', form: init.form } : {})),
    bytes: (url, maxBytes) => pedir(url, {}, maxBytes),
  };
}
