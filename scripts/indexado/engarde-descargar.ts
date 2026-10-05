/**
 * Descarga, con caché en disco, las páginas de Engarde (engarde-service.com) de
 * los torneos que el catálogo nacional RFEE enlaza como «externo».
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/engarde-descargar.ts \
 *     [--inventario <national-inventory.json>] [--salida <calendario-trabajo/engarde>] [--pausa-ms 450] [--max <n>]
 *
 * Una petición cada vez, con pausa entre peticiones y el User-Agent del proyecto.
 * engarde-service.com no publica robots.txt (la ruta devuelve la portada HTML),
 * así que no hay rutas excluidas. Cada respuesta (incluidos los 404) queda en
 * `raw/` con su registro en `raw/_registro.jsonl`; una segunda ejecución no
 * vuelve a pedir nada que ya esté registrado con 200 o 404.
 *
 * Todas las formas de enlace (`/files/{org}/{evt}/`, `/tournament/{org}/{evt}`,
 * `siteTemplate.php?Organisme=&Event=`, `?Org=&Tour=`, `/competition/...`) se
 * reducen a (organizador, torneo) y se leen con el índice XML del torneo. Los
 * enlaces `app.php?id=` abren Engarde Smart (aplicación JavaScript) y no
 * identifican el torneo: se cuentan y no se descargan.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ENGARDE_BASE,
  ENGARDE_INDICE,
  esSegmentoEngarde,
  parsearIndiceEngarde,
  urlPruebaEngarde,
  urlTorneoEngarde,
} from '../../src/lib/ingest/sources/engarde';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';

export const USER_AGENT_ENGARDE = 'CalendarioEsgrima/1.0 (+contacto)';
export const CARPETA_ENGARDE = join(CARPETA_TRABAJO, 'engarde');
export const INVENTARIO_POR_DEFECTO = join(CARPETA_CACHES, 'history-national', 'national-inventory.json');

export type EnlaceEngarde =
  | { tipo: 'torneo'; org: string; evt: string; compe: string | null }
  | { tipo: 'smart'; id: string }
  | { tipo: 'otro' };

/** Organizador y torneo de cualquier forma de enlace publicada a engarde-service.com. */
export function enlaceEngarde(url: string): EnlaceEngarde {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { tipo: 'otro' };
  }
  if (!/(^|\.)engarde-service\.com$/i.test(u.hostname)) return { tipo: 'otro' };
  const torneo = (org: string | null | undefined, evt: string | null | undefined, compe: string | null = null): EnlaceEngarde =>
    org && evt && esSegmentoEngarde(org) && esSegmentoEngarde(evt) && (compe === null || esSegmentoEngarde(compe))
      ? { tipo: 'torneo', org: org.toLowerCase(), evt, compe }
      : { tipo: 'otro' };
  const partes = u.pathname.split('/').filter(Boolean);
  if ((partes[0] === 'files' || partes[0] === 'tournament') && partes.length >= 3) {
    return torneo(partes[1], partes[2], partes[0] === 'files' && partes[3] && !partes[3].includes('.') ? partes[3] : null);
  }
  if (partes[0] === 'competition' && partes.length >= 3) return torneo(partes[1], partes[2], partes[3] ?? null);
  const q = u.searchParams;
  if (q.get('Organisme') && q.get('Event')) return torneo(q.get('Organisme'), q.get('Event'));
  if (q.get('Org') && q.get('Tour')) return torneo(q.get('Org'), q.get('Tour'));
  if (/app\.php$/i.test(u.pathname) && q.get('id')) return { tipo: 'smart', id: q.get('id')! };
  return { tipo: 'otro' };
}

export type FilaInventario = {
  fuente: string;
  temporada: string;
  claveCatalogo: string;
  nombre: string;
  fecha: string | null;
  arma: string | null;
  genero: string | null;
  categoria: string | null;
  categoriaOriginal?: string | null;
  formato: string | null;
  enlaces: { tipo: string; url: string; etiqueta?: string }[];
  city?: string | null;
};

export function leerInventario(ruta: string): FilaInventario[] {
  const j = JSON.parse(readFileSync(ruta, 'utf8')) as { ownRfeeCatalog: FilaInventario[] };
  return j.ownRfeeCatalog;
}

export type TorneoPedido = { org: string; evt: string; filas: string[] };

/** Torneos únicos enlazados desde el catálogo, con las filas que los enlazan. */
export function torneosDelInventario(filas: readonly FilaInventario[]): {
  torneos: TorneoPedido[];
  smart: number;
  otros: number;
  filasConEngarde: number;
} {
  const torneos = new Map<string, TorneoPedido>();
  let smart = 0;
  let otros = 0;
  let filasConEngarde = 0;
  for (const f of filas) {
    const externos = f.enlaces.filter((e) => e.tipo === 'externo' && /engarde-service\.com/i.test(e.url));
    if (externos.length > 0) filasConEngarde += 1;
    for (const e of externos) {
      const r = enlaceEngarde(e.url);
      if (r.tipo === 'smart') smart += 1;
      if (r.tipo === 'otro') otros += 1;
      if (r.tipo !== 'torneo') continue;
      const k = `${r.org}/${r.evt}`;
      const t = torneos.get(k) ?? { org: r.org, evt: r.evt, filas: [] };
      if (!t.filas.includes(f.claveCatalogo)) t.filas.push(f.claveCatalogo);
      torneos.set(k, t);
    }
  }
  return {
    torneos: [...torneos.values()].sort((a, b) => (`${a.org}/${a.evt}` < `${b.org}/${b.evt}` ? -1 : 1)),
    smart,
    otros,
    filasConEngarde,
  };
}

// ---------------------------------------------------------------------------
// Caché
// ---------------------------------------------------------------------------

export type Registro = { clave: string; url: string; status: number; fichero: string | null; sha256: string | null; en: string };

function nombreSeguro(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
}

/** Ruta relativa de caché de una petición: `org/evt/<compe|_torneo>/<página>`. */
export function claveCache(org: string, evt: string, compe: string | null, pagina: string): string {
  return [nombreSeguro(org), nombreSeguro(evt), compe === null ? '_torneo' : nombreSeguro(compe), nombreSeguro(pagina)].join('/');
}

export class CacheEngarde {
  readonly raw: string;
  private readonly registro = new Map<string, Registro>();
  private readonly rutaRegistro: string;

  constructor(carpeta: string) {
    this.raw = join(carpeta, 'raw');
    mkdirSync(this.raw, { recursive: true });
    this.rutaRegistro = join(this.raw, '_registro.jsonl');
    if (existsSync(this.rutaRegistro)) {
      for (const l of readFileSync(this.rutaRegistro, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        const r = JSON.parse(l) as Registro;
        this.registro.set(r.clave, r);
      }
    }
  }

  obtener(clave: string): Registro | undefined {
    return this.registro.get(clave);
  }

  /** Cuerpo cacheado de una página leída con 200; `null` si no existe o fue 404. */
  leer(clave: string): string | null {
    const r = this.registro.get(clave);
    if (!r || r.status !== 200 || !r.fichero) return null;
    return readFileSync(join(this.raw, r.fichero), 'utf8');
  }

  guardar(clave: string, url: string, status: number, cuerpo: string | null): Registro {
    let fichero: string | null = null;
    let sha: string | null = null;
    if (cuerpo !== null && status === 200) {
      fichero = `${clave}.html`;
      const ruta = join(this.raw, fichero);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(ruta, cuerpo);
      sha = createHash('sha256').update(cuerpo).digest('hex');
    }
    const r: Registro = { clave, url, status, fichero, sha256: sha, en: new Date().toISOString() };
    this.registro.set(clave, r);
    appendFileSync(this.rutaRegistro, `${JSON.stringify(r)}\n`);
    return r;
  }
}

// ---------------------------------------------------------------------------
// Red
// ---------------------------------------------------------------------------

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function formularioIndiceEngarde(org: string, evt: string, pagina: number): Record<string, string> {
  return {
    option: 'competition', sexe: '', arme: '', indiv: '', categorie: '', orderby: 'competitions_tournament',
    datefrom: '', dateto: '', country: '', city: '', type: '', state: '', page: String(pagina), lang: 'en',
    large: 'E', nrows: '20', organism: org, event: evt, order: 'ASC', show_test: '0', cache: '1',
  };
}

class Cliente {
  peticiones = 0;
  private ultima = 0;
  constructor(private readonly pausaMs: number, private readonly max: number) {}

  agotado(): boolean {
    return this.peticiones >= this.max;
  }

  async pedir(url: string, formulario?: Record<string, string>): Promise<{ status: number; body: string }> {
    for (let intento = 1; ; intento += 1) {
      const falta = this.ultima + this.pausaMs - Date.now();
      if (falta > 0) await esperar(falta);
      this.ultima = Date.now();
      this.peticiones += 1;
      try {
        const res = await fetch(url, {
          method: formulario ? 'POST' : 'GET',
          headers: {
            'User-Agent': USER_AGENT_ENGARDE,
            Accept: formulario ? 'application/xml' : 'text/html',
            ...(formulario ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: formulario ? new URLSearchParams(formulario).toString() : undefined,
          signal: AbortSignal.timeout(45_000),
          redirect: 'follow',
        });
        const body = await res.text();
        if ((res.status === 429 || res.status >= 500) && intento < 3) {
          const ra = Number(res.headers.get('retry-after'));
          await esperar(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 5000 * intento);
          continue;
        }
        return { status: res.status, body };
      } catch (e) {
        if (intento >= 3) throw e;
        await esperar(5000 * intento);
      }
    }
  }
}

/** Clasificación final, poules y cuadros que ofrece la página de una prueba, sólo de esa prueba. */
export function paginasDePrueba(html: string, org: string, evt: string, compe: string): string[] {
  const raiz = `/competition/${org}/${evt}/${compe}/`.toLowerCase();
  const vistas = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const ruta = m[1].replace(/^https?:\/\/(www\.)?engarde-service\.com/i, '').replace(/^\/\/(www\.)?engarde-service\.com/i, '');
    if (!ruta.toLowerCase().startsWith(raiz)) continue;
    const pagina = ruta.slice(raiz.length).split(/[?#]/)[0];
    if (/^(clasfinal|poules\d{1,2}|tableau[\w-]{1,20})\.htm$/i.test(pagina)) vistas.add(pagina);
  }
  return [...vistas].sort();
}

export type InformeDescarga = {
  generado: string;
  filasConEngarde: number;
  enlacesSmart: number;
  enlacesNoReconocidos: number;
  torneos: number;
  torneosConIndice: number;
  torneosSinIndice: { org: string; evt: string; motivo: string }[];
  pruebas: number;
  paginas: Record<string, number>;
  peticiones: number;
  desdeCache: number;
};

export async function descargar(opciones: {
  inventario: string;
  salida: string;
  pausaMs: number;
  max: number;
}): Promise<InformeDescarga> {
  const filas = leerInventario(opciones.inventario);
  const { torneos, smart, otros, filasConEngarde } = torneosDelInventario(filas);
  const cache = new CacheEngarde(opciones.salida);
  const cliente = new Cliente(opciones.pausaMs, opciones.max);
  const inf: InformeDescarga = {
    generado: new Date().toISOString(), filasConEngarde, enlacesSmart: smart, enlacesNoReconocidos: otros,
    torneos: torneos.length, torneosConIndice: 0, torneosSinIndice: [], pruebas: 0, paginas: {}, peticiones: 0, desdeCache: 0,
  };
  const anotar = (tipo: string) => (inf.paginas[tipo] = (inf.paginas[tipo] ?? 0) + 1);

  const traer = async (clave: string, url: string, formulario?: Record<string, string>): Promise<string | null> => {
    const previo = cache.obtener(clave);
    if (previo && (previo.status === 200 || previo.status === 404)) {
      inf.desdeCache += 1;
      return cache.leer(clave);
    }
    if (cliente.agotado()) return null;
    const r = await cliente.pedir(url, formulario);
    cache.guardar(clave, url, r.status, r.body);
    return r.status === 200 ? r.body : null;
  };

  for (const t of torneos) {
    if (cliente.agotado()) break;
    const pruebas: string[] = [];
    let ok = false;
    let motivo = 'sin respuesta';
    for (let pagina = 1, total = 1; pagina <= Math.min(total, 25); pagina += 1) {
      const xml = await traer(claveCache(t.org, t.evt, null, `indice-p${pagina}.xml`), ENGARDE_INDICE, formularioIndiceEngarde(t.org, t.evt, pagina));
      if (xml === null) break;
      const indice = parsearIndiceEngarde(xml);
      if (!indice.ok) {
        motivo = indice.error;
        break;
      }
      ok = true;
      total = indice.paginas;
      for (const p of indice.pruebas) if (!pruebas.includes(p.compe)) pruebas.push(p.compe);
    }
    anotar('indice');
    await traer(claveCache(t.org, t.evt, null, 'torneo.html'), urlTorneoEngarde(t.org, t.evt));
    if (!ok) {
      inf.torneosSinIndice.push({ org: t.org, evt: t.evt, motivo });
      continue;
    }
    inf.torneosConIndice += 1;
    for (const compe of pruebas) {
      inf.pruebas += 1;
      const html = await traer(claveCache(t.org, t.evt, compe, 'prueba.html'), urlPruebaEngarde(t.org, t.evt, compe));
      anotar('prueba');
      if (html === null) continue;
      for (const p of paginasDePrueba(html, t.org, t.evt, compe).slice(0, 16)) {
        await traer(claveCache(t.org, t.evt, compe, p), `${ENGARDE_BASE}/competition/${t.org}/${t.evt}/${compe}/${p}`);
        anotar(p.startsWith('poules') ? 'poules' : p.startsWith('clasfinal') ? 'clasfinal' : 'cuadro');
      }
    }
    console.log(`${t.org}/${t.evt}: ${pruebas.length} pruebas (peticiones ${cliente.peticiones})`);
  }
  inf.peticiones = cliente.peticiones;
  return inf;
}

async function main(): Promise<void> {
  const salida = argumento('salida', CARPETA_ENGARDE);
  const inf = await descargar({
    inventario: argumento('inventario', INVENTARIO_POR_DEFECTO),
    salida,
    pausaMs: Math.max(400, Number(argumento('pausa-ms', '450'))),
    max: Number(argumento('max', '100000')),
  });
  writeFileSync(join(salida, '_descarga-informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify(inf, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
