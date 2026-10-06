/**
 * Red educada para el lote 7 (pruebas que faltan): caché en disco bajo
 * `calendario-trabajo/cache-lote7-faltan/`, User-Agent INGEST_USER_AGENT del `.env`,
 * como mucho 2 peticiones simultáneas por host y ≥600 ms entre peticiones al mismo host.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-faltan-red.ts <url>...   (sonda: estado y tamaño)
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CARPETA_TRABAJO } from './comun';

export const CACHE_LOTE7 = join(CARPETA_TRABAJO, 'cache-lote7-faltan');
const LIMITE_BYTES = 1024 ** 3;

function userAgent(): string {
  if (process.env.INGEST_USER_AGENT) return process.env.INGEST_USER_AGENT;
  const ruta = resolve(import.meta.dirname ?? '.', '../../.env');
  if (existsSync(ruta)) {
    for (const l of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
      const m = /^INGEST_USER_AGENT\s*=\s*(.*)$/.exec(l);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return 'CalendarioEsgrima/1.0 (+contacto)';
}

export type Respuesta = { status: number; body: Buffer; url: string; desdeCache: boolean; sha256: string; ruta: string | null };

type Registro = { url: string; status: number; fichero: string | null; sha256: string | null; en: string; bytes: number };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Red {
  private readonly registro = new Map<string, Registro>();
  private readonly rutaRegistro: string;
  private readonly hosts = new Map<string, { activas: number; ultima: number; cola: (() => void)[] }>();
  private bytes = 0;
  peticiones = 0;

  constructor(readonly carpeta = CACHE_LOTE7, private readonly pausaMs = 600, private readonly porHost = 2) {
    mkdirSync(carpeta, { recursive: true });
    this.rutaRegistro = join(carpeta, '_registro.jsonl');
    if (existsSync(this.rutaRegistro)) {
      for (const l of readFileSync(this.rutaRegistro, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        const r = JSON.parse(l) as Registro;
        this.registro.set(r.url, r);
        this.bytes += r.bytes ?? 0;
      }
    }
  }

  private fichero(url: string): string {
    const u = new URL(url);
    const h = createHash('sha256').update(url).digest('hex').slice(0, 16);
    const nombre = (u.pathname.split('/').filter(Boolean).pop() ?? 'index').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    return join(u.hostname.replace(/[^A-Za-z0-9.-]+/g, '_'), `${h}_${nombre}`);
  }

  enCache(url: string): Registro | undefined {
    return this.registro.get(url);
  }

  private async turno(host: string): Promise<() => void> {
    const h = this.hosts.get(host) ?? { activas: 0, ultima: 0, cola: [] };
    this.hosts.set(host, h);
    while (h.activas >= this.porHost) await new Promise<void>((r) => h.cola.push(r));
    h.activas += 1;
    const falta = h.ultima + this.pausaMs - Date.now();
    h.ultima = Math.max(Date.now(), h.ultima + this.pausaMs);
    if (falta > 0) await esperar(falta);
    return () => {
      h.activas -= 1;
      h.cola.shift()?.();
    };
  }

  /** GET con caché: los 200 y 404 registrados no se vuelven a pedir. */
  async get(url: string, opciones: { reintentos?: number; timeoutMs?: number } = {}): Promise<Respuesta> {
    return this.pedir(url, null, opciones);
  }

  /** POST de formulario con caché; la clave de caché es la URL más el cuerpo. */
  async post(url: string, formulario: Record<string, string>, opciones: { reintentos?: number; timeoutMs?: number } = {}): Promise<Respuesta> {
    return this.pedir(url, new URLSearchParams(formulario).toString(), opciones);
  }

  private async pedir(urlBase: string, cuerpo: string | null, opciones: { reintentos?: number; timeoutMs?: number }): Promise<Respuesta> {
    const url = cuerpo === null ? urlBase : `${urlBase}#POST:${cuerpo}`;
    const previo = this.registro.get(url);
    if (previo && (previo.status === 200 || previo.status === 404 || previo.status === 410)) {
      const body = previo.fichero ? readFileSync(join(this.carpeta, previo.fichero)) : Buffer.alloc(0);
      return { status: previo.status, body, url, desdeCache: true, sha256: previo.sha256 ?? '', ruta: previo.fichero ? join(this.carpeta, previo.fichero) : null };
    }
    if (this.bytes > LIMITE_BYTES) throw new Error('Caché del lote 7 por encima de 1 GB');
    const host = new URL(url).hostname;
    const reintentos = opciones.reintentos ?? 3;
    for (let intento = 1; ; intento += 1) {
      const soltar = await this.turno(host);
      let res: Response;
      let body: Buffer;
      try {
        this.peticiones += 1;
        res = await fetch(urlBase, {
          method: cuerpo === null ? 'GET' : 'POST',
          headers: {
            'User-Agent': userAgent(),
            Accept: '*/*',
            ...(cuerpo === null ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          },
          body: cuerpo ?? undefined,
          signal: AbortSignal.timeout(opciones.timeoutMs ?? 60_000),
          redirect: 'follow',
        });
        body = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        soltar();
        if (intento >= reintentos) throw e;
        await esperar(5000 * intento);
        continue;
      }
      soltar();
      if ((res.status === 429 || res.status >= 500) && intento < reintentos) {
        const ra = Number(res.headers.get('retry-after'));
        await esperar(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 6000 * intento);
        continue;
      }
      let fichero: string | null = null;
      const sha = createHash('sha256').update(body).digest('hex');
      if (res.status === 200) {
        fichero = this.fichero(url);
        const ruta = join(this.carpeta, fichero);
        mkdirSync(dirname(ruta), { recursive: true });
        writeFileSync(ruta, body);
        this.bytes += body.length;
      }
      const r: Registro = { url, status: res.status, fichero, sha256: res.status === 200 ? sha : null, en: new Date().toISOString(), bytes: res.status === 200 ? body.length : 0 };
      this.registro.set(url, r);
      appendFileSync(this.rutaRegistro, `${JSON.stringify(r)}\n`);
      return { status: res.status, body, url, desdeCache: false, sha256: sha, ruta: fichero ? join(this.carpeta, fichero) : null };
    }
  }

  tamano(): number {
    return this.bytes;
  }
}

export function tamanoFichero(ruta: string): number {
  return existsSync(ruta) ? statSync(ruta).size : 0;
}

async function main(): Promise<void> {
  const red = new Red();
  for (const url of process.argv.slice(2)) {
    try {
      const r = await red.get(url, { reintentos: 2 });
      const texto = r.body.toString('latin1');
      console.log(JSON.stringify({ url, status: r.status, bytes: r.body.length, cache: r.desdeCache, ruta: r.ruta, inicio: texto.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400) }));
    } catch (e) {
      console.log(JSON.stringify({ url, error: String(e) }));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
