/**
 * Utilidades comunes de los productores `lote7-pdf-*`: rutas propias, User-Agent y red educada.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';

export const CACHE_LOTE7_PDF = join(CARPETA_TRABAJO, 'cache-lote7-pdf');
export const HECHOS_LOTE7_PDF = join(CARPETA_TRABAJO, 'hechos', 'lote7-pdf');
export const NUEVO7 = join(CARPETA_TRABAJO, 'nuevo7.sqlite');

let ua: string | null = null;

/** `INGEST_USER_AGENT` del `.env` del repositorio (o del entorno); nunca se imprime. */
export function userAgentLote7(): string {
  if (ua) return ua;
  if (!process.env.INGEST_USER_AGENT) {
    const env = join(process.cwd(), '.env');
    if (existsSync(env)) {
      try {
        process.loadEnvFile(env);
      } catch {
        // Un .env con sintaxis que Node no entiende: se usa el valor por defecto.
      }
    }
  }
  ua = process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)';
  return ua;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cliente de un solo host: una petición cada vez con pausa mínima, reintentos espaciados ante 429/5xx. */
export class ClienteEducado {
  peticiones = 0;
  private ultima = 0;
  private cola: Promise<unknown> = Promise.resolve();
  constructor(private readonly pausaMs = 800, private readonly max = 5000) {}

  disponible(): boolean {
    return this.peticiones < this.max;
  }

  pedir(url: string): Promise<{ status: number; bytes: Uint8Array; tipo: string | null }> {
    const tarea = this.cola.then(() => this.pedirYa(url));
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  private async pedirYa(url: string): Promise<{ status: number; bytes: Uint8Array; tipo: string | null }> {
    for (let intento = 1; ; intento += 1) {
      const falta = this.ultima + this.pausaMs - Date.now();
      if (falta > 0) await esperar(falta);
      this.ultima = Date.now();
      this.peticiones += 1;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': userAgentLote7() },
          signal: AbortSignal.timeout(90_000),
          redirect: 'follow',
        });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if ((res.status === 429 || res.status >= 500) && intento < 4) {
          const ra = Number(res.headers.get('retry-after'));
          await esperar(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 6000 * intento);
          continue;
        }
        return { status: res.status, bytes, tipo: res.headers.get('content-type') };
      } catch (e) {
        if (intento >= 4) throw e;
        await esperar(6000 * intento);
      }
    }
  }
}
