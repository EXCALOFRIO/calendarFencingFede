const DEFAULT_UA = 'CalendarioEsgrima/1.0 (+contacto)';

export type FetchTextResult = {
  body: string;
  status: number;
  url: string;
  /** Milisegundos que tardó, para el registro de la ejecución. */
  durationMs: number;
};

/**
 * `fetch` con identificación, timeout y un reintento.
 *
 * Se manda un `User-Agent` identificable a propósito: la carga que metemos es
 * de 1 petición al día por fuente, y si a Skermo o la FIE les molesta algo,
 * que sepan a quién escribir. Es lo correcto y además lo educado.
 */
export async function fetchText(
  url: string,
  options: {
    timeoutMs?: number;
    retries?: number;
    accept?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<FetchTextResult> {
  const { timeoutMs = 45_000, retries = 1, accept = 'text/html', headers = {} } = options;
  const userAgent = process.env.INGEST_USER_AGENT || DEFAULT_UA;
  const startedAt = Date.now();

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: accept,
          'Accept-Language': 'es-ES,es;q=0.9',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
        // El scraper siempre quiere el dato de hoy, nunca una copia cacheada.
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} al pedir ${url}`);
      }

      const body = await res.text();
      return {
        body,
        status: res.status,
        url: res.url,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        // Una espera corta basta: si la fuente está caída de verdad, el cron
        // de mañana lo reintenta y el aviso al admin salta a los 2 fallos.
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `No se pudo leer ${url} tras ${retries + 1} intentos: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const res = await fetchText(url, { ...options, accept: 'application/json' });
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error(`La respuesta de ${url} no es JSON válido`);
  }
}

/**
 * Algunas APIs devuelven UTF-8 doblemente codificado (se comprobó en
 * `fie.org/api/fie/competition/...`, que da "TÃ¼rkiye" en vez de
 * "Türkiye"). Esto lo deshace sin tocar el texto que ya está bien.
 */
export function fixDoubleEncodedUtf8(value: string): string {
  if (!/[\u00c2-\u00c3][\u0080-\u00bf]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from([...value].map((c) => c.charCodeAt(0) & 0xff));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}
