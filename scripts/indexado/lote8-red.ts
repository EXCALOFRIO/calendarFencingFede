/**
 * Red y caché del lote 8: como mucho 2 peticiones en vuelo por anfitrión y al menos 500 ms
 * entre dos peticiones al mismo anfitrión (1,5 s en archive.org), User-Agent de
 * `INGEST_USER_AGENT`, caché en `calendario-trabajo/cache-lote8` con techo de 1 GB.
 * 404/410/403 se registran y no se vuelven a pedir; 429/5xx y fallos de red se reintentan.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CARPETA_TRABAJO } from './comun';

export const CACHE_LOTE8 = process.env.CACHE_LOTE8 ?? join(CARPETA_TRABAJO, 'cache-lote8');
export const HECHOS_LOTE8 = (fuente: string) => join(CARPETA_TRABAJO, 'hechos', `lote8-${fuente}`);
export const USER_AGENT_LOTE8 = process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)';
export const LIMITE_CACHE_BYTES = 1024 ** 3;
export const MAX_EN_VUELO_POR_HOST = 2;
export const PAUSA_MINIMA_MS = 500;

export const sha256 = (d: Uint8Array | string): string => createHash('sha256').update(d).digest('hex');
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Documento = { url: string; status: number; bytes: Uint8Array | null; sha256: string | null; deCache: boolean };
type Entrada = { url: string; status: number; fichero: string | null; sha256: string | null; bytes: number; ts: string };

/** Pausa entre peticiones a un anfitrión. */
export const pausaHost = (host: string): number => (host.endsWith('archive.org') ? 1500 : PAUSA_MINIMA_MS);

/**
 * Turnos por anfitrión: `entrar` espera hasta que haya menos de `max` en vuelo y hayan pasado
 * `pausa` ms desde la última salida; `salir` libera el turno.
 */
export class Turnos {
  private readonly enVuelo = new Map<string, number>();
  private readonly ultima = new Map<string, number>();
  private cadena = new Map<string, Promise<void>>();
  constructor(private readonly max = MAX_EN_VUELO_POR_HOST, private readonly pausa = pausaHost, private readonly reloj = () => Date.now(), private readonly esperar = dormir) {}

  async entrar(host: string): Promise<void> {
    const previa = this.cadena.get(host) ?? Promise.resolve();
    let liberar!: () => void;
    const mia = new Promise<void>((r) => (liberar = r));
    this.cadena.set(host, previa.then(() => mia));
    await previa;
    try {
      for (;;) {
        const hueco = (this.ultima.get(host) ?? 0) + this.pausa(host) - this.reloj();
        if ((this.enVuelo.get(host) ?? 0) < this.max && hueco <= 0) break;
        await this.esperar(Math.max(hueco, 50));
      }
      this.enVuelo.set(host, (this.enVuelo.get(host) ?? 0) + 1);
      this.ultima.set(host, this.reloj());
    } finally {
      liberar();
    }
  }

  salir(host: string): void {
    this.enVuelo.set(host, Math.max(0, (this.enVuelo.get(host) ?? 1) - 1));
  }

  enVueloDe(host: string): number {
    return this.enVuelo.get(host) ?? 0;
  }
}

export class RedLote8 {
  private readonly raw: string;
  private readonly registro = new Map<string, Entrada>();
  private bytes = 0;
  readonly turnos = new Turnos();
  peticiones = 0;
  desdeCache = 0;

  constructor(readonly carpeta = CACHE_LOTE8, private readonly limite = LIMITE_CACHE_BYTES) {
    this.raw = join(carpeta, 'raw');
    const reg = join(this.raw, '_registro.jsonl');
    if (existsSync(reg)) {
      for (const l of readFileSync(reg, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try {
          const e = JSON.parse(l) as Entrada;
          this.registro.set(e.url, e);
        } catch {
          // Línea truncada por una parada brusca.
        }
      }
    }
    for (const e of this.registro.values()) if (e.fichero) this.bytes += e.bytes;
  }

  get bytesCache(): number {
    return this.bytes;
  }

  private ficheroDe(url: string): string {
    const h = sha256(url).slice(0, 24);
    return join(new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, '_'), h.slice(0, 2), `${h}.bin`);
  }

  enCache(url: string): Documento | null {
    const e = this.registro.get(url);
    if (!e) return null;
    if (!e.fichero) return { url, status: e.status, bytes: null, sha256: null, deCache: true };
    const ruta = join(this.raw, e.fichero);
    if (!existsSync(ruta)) return null;
    const bytes = new Uint8Array(readFileSync(ruta));
    return { url, status: e.status, bytes, sha256: sha256(bytes), deCache: true };
  }

  async obtener(url: string, opciones: { intentos?: number; aceptar?: string } = {}): Promise<Documento> {
    const previo = this.registro.get(url);
    if (previo && [200, 403, 404, 410].includes(previo.status)) {
      const d = this.enCache(url);
      if (d) {
        this.desdeCache += 1;
        return d;
      }
    }
    if (this.bytes > this.limite) throw new Error(`caché del lote 8 llena (${(this.bytes / 1024 ** 3).toFixed(2)} GB)`);
    const host = new URL(url).hostname;
    let espera = 5_000;
    const max = opciones.intentos ?? 4;
    for (let intento = 1; ; intento += 1) {
      await this.turnos.entrar(host);
      let res: Response | null = null;
      let fallo: unknown = null;
      let bytes: Uint8Array | null = null;
      try {
        this.peticiones += 1;
        res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT_LOTE8, ...(opciones.aceptar ? { Accept: opciones.aceptar } : {}) },
          redirect: 'follow',
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 429 || res.status >= 500) await res.body?.cancel();
        else bytes = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        fallo = e;
      } finally {
        this.turnos.salir(host);
      }
      if (fallo || !res || res.status === 429 || res.status >= 500) {
        if (intento >= max) return { url, status: res?.status ?? -1, bytes: null, sha256: null, deCache: false };
        const ra = Number(res?.headers.get('retry-after'));
        await dormir(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : espera);
        espera = Math.min(espera * 2, 120_000);
        continue;
      }
      const guardar = res.status === 200 && bytes !== null;
      const fichero = guardar ? this.ficheroDe(url) : null;
      if (fichero && bytes) {
        const ruta = join(this.raw, fichero);
        mkdirSync(dirname(ruta), { recursive: true });
        writeFileSync(`${ruta}.tmp`, bytes);
        renameSync(`${ruta}.tmp`, ruta);
        this.bytes += bytes.length;
      }
      const e: Entrada = { url, status: res.status, fichero, sha256: guardar && bytes ? sha256(bytes) : null, bytes: bytes?.length ?? 0, ts: new Date().toISOString() };
      mkdirSync(this.raw, { recursive: true });
      appendFileSync(join(this.raw, '_registro.jsonl'), `${JSON.stringify(e)}\n`);
      this.registro.set(url, e);
      return { url, status: res.status, bytes: guardar ? bytes : null, sha256: e.sha256, deCache: false };
    }
  }
}

export const texto = (d: Documento | null, cod = 'utf-8'): string | null => (d?.bytes ? new TextDecoder(cod).decode(d.bytes) : null);

/** `tarea` sobre cada elemento con `n` en vuelo como máximo. */
export async function enParalelo<T>(xs: readonly T[], n: number, tarea: (x: T, i: number) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < xs.length) {
      const i = siguiente;
      siguiente += 1;
      await tarea(xs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, trabajador));
}
