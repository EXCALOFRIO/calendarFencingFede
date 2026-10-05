/**
 * Descarga, con caché en disco, los torneos de organizadores españoles en
 * engarde-service.com anteriores a la temporada 2018-19 (las posteriores
 * llegan por el calendario RFEE con `engarde-descargar.ts`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/engarde-historico-descargar.ts \
 *     [--salida <calendario-trabajo/engarde-historico>] [--pausa-ms 600] [--max <n>] [--hasta 2018-09-01] [--org fce,rfee]
 *
 * Recorrido: lista de torneos de cada organizador (`prog/getTournois.php`),
 * índice XML de cada torneo y, por prueba, la exportación estática de Engarde
 * (`/files/{org}/{evt}/{compe}/menu.html` y los documentos que enlaza). Si la
 * prueba no tiene exportación estática se lee la página `/competition/...`.
 *
 * Una petición cada vez, con pausa y el User-Agent del proyecto; todo queda en
 * `raw/` y una segunda ejecución no repite lo ya registrado con 200 o 404.
 * Los torneos con la fecha ficticia «2012-01-01» se fechan por su título; si no
 * se puede, se descargan igualmente y la conversión decide con la fecha que
 * publican sus documentos (o los descarta sin temporada).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGARDE_BASE, ENGARDE_INDICE, esSegmentoEngarde, urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import {
  decodificarHtml,
  documentosDelMenu,
  esCuadroPrincipal,
  esFechaFicticiaEngarde,
  fechaDeTituloTorneo,
} from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento } from './comun';
import { CacheEngarde, claveCache, formularioIndiceEngarde, paginasDePrueba, USER_AGENT_ENGARDE } from './engarde-descargar';

export const CARPETA_ENGARDE_HISTORICO = join(tmpdir(), 'calendario-trabajo', 'engarde-historico');
export const FECHA_CORTE = '2018-09-01';

/**
 * Organizadores españoles con torneos en engarde-service.com (lista de
 * `prog/getOrganism.php` del 2026-10-06 filtrada por nombre; `cccm` no sale en
 * esa lista pero responde en `getTournois`).
 */
export const ORGANIZADORES_ES = [
  'rfee', 'fce', 'fme', 'fecyl', 'fecv-f', 'fed-ara-esp', 'federacionnavarradeesgrima', 'riojana', 'alavaesgrima',
  'cccm', 'clubesgrimalcobendas', 'clubesgrimabarajas', 'aeve_esgrima', 'antonio', 'bhc', 'cdesgrimatoledo', 'cecr',
  'cegaesgrima', 'celsgandia', 'cetc_m', 'club', 'club-esgrima-majadahonda', 'clubdeesgimademadrid',
  'clubdeesgrimademadrid', 'clubesgrimadinamo', 'compostelaesgrima', 'edmc', 'ejercitodelaire', 'esgrimapontevedra',
  'esgrimavigo', 'maestro_sune', 'saarvi', 'sadaab',
] as const;

export type TorneoLista = { Organisme: string; Event: string; Titre: string; date: string; compet: string };

export function urlFicheroEngarde(org: string, evt: string, compe: string, fichero: string): string {
  return `${ENGARDE_BASE}/files/${org}/${evt}/${compe}/${fichero}`;
}

/** Fecha del torneo en la lista: la publicada, o la de su título si la publicada es ficticia. */
export function fechaTorneoLista(t: Pick<TorneoLista, 'date' | 'Titre'>): string | null {
  if (!esFechaFicticiaEngarde(t.date) && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) return t.date;
  return fechaDeTituloTorneo(t.Titre ?? '');
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ClienteBytes {
  peticiones = 0;
  private ultima = 0;
  constructor(
    private readonly pausaMs: number,
    private readonly max: number,
    private readonly reintentos = 3,
  ) {}

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
            ...(formulario ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: formulario ? new URLSearchParams(formulario).toString() : undefined,
          signal: AbortSignal.timeout(60_000),
          redirect: 'follow',
        });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if ((res.status === 429 || res.status >= 500) && intento < this.reintentos) {
          const ra = Number(res.headers.get('retry-after'));
          await esperar(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 8000 * intento);
          continue;
        }
        return { status: res.status, body: decodificarHtml(bytes, res.headers.get('content-type')) };
      } catch (e) {
        if (intento >= this.reintentos) throw e;
        await esperar(8000 * intento);
      }
    }
  }
}

export type InformeDescargaHistorico = {
  generado: string;
  organizadores: Record<string, { torneos: number; enAlcance: number; sinFecha: number; pruebas: number; conMenu: number; documentos: number }>;
  peticiones: number;
  desdeCache: number;
  errores: { url: string; error: string }[];
};

export async function descargarHistorico(opciones: {
  salida: string;
  pausaMs: number;
  max: number;
  hasta: string;
  orgs: readonly string[];
}): Promise<InformeDescargaHistorico> {
  const cache = new CacheEngarde(opciones.salida);
  const cliente = new ClienteBytes(opciones.pausaMs, opciones.max);
  const inf: InformeDescargaHistorico = { generado: new Date().toISOString(), organizadores: {}, peticiones: 0, desdeCache: 0, errores: [] };

  const traer = async (clave: string, url: string, formulario?: Record<string, string>): Promise<string | null> => {
    const previo = cache.obtener(clave);
    if (previo && (previo.status === 200 || previo.status === 404)) {
      inf.desdeCache += 1;
      return cache.leer(clave);
    }
    if (cliente.agotado()) return null;
    try {
      const r = await cliente.pedir(url, formulario);
      cache.guardar(clave, url, r.status, r.body);
      return r.status === 200 ? r.body : null;
    } catch (e) {
      inf.errores.push({ url, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      return null;
    }
  };

  for (const org of opciones.orgs) {
    const o = (inf.organizadores[org] = { torneos: 0, enAlcance: 0, sinFecha: 0, pruebas: 0, conMenu: 0, documentos: 0 });
    const torneos = await listaTorneos(org, traer);
    o.torneos = torneos.length;
    for (const t of torneos) {
      if (cliente.agotado()) break;
      if (!esSegmentoEngarde(t.Event)) continue;
      const fecha = fechaTorneoLista(t);
      if (fecha && fecha >= opciones.hasta) continue;
      o.enAlcance += 1;
      if (!fecha) o.sinFecha += 1;
      const comps = await indiceTorneo(org, t.Event, traer);
      for (const c of comps) {
        if (c.etat === 'empty' || !esSegmentoEngarde(c.compe)) continue;
        o.pruebas += 1;
        const menu = await traer(claveCache(org, t.Event, c.compe, 'files_menu.html'), urlFicheroEngarde(org, t.Event, c.compe, 'menu.html'));
        const docs = menu ? documentosDelMenu(menu).filter((d) => d.tipo !== 'cuadro' || esCuadroPrincipal(d.fichero)).slice(0, 30) : [];
        if (docs.length > 0) o.conMenu += 1;
        for (const d of docs) {
          await traer(claveCache(org, t.Event, c.compe, `files_${d.fichero}`), urlFicheroEngarde(org, t.Event, c.compe, d.fichero));
          o.documentos += 1;
        }
        // Con exportación estática (aunque sólo traiga la lista de tiradores) la página dinámica está vacía.
        if (menu !== null) continue;
        const prueba = await traer(claveCache(org, t.Event, c.compe, 'prueba.html'), urlPruebaEngarde(org, t.Event, c.compe));
        if (!prueba || /currently has no data/i.test(prueba)) continue;
        for (const p of paginasDePrueba(prueba, org, t.Event, c.compe).slice(0, 16)) {
          await traer(claveCache(org, t.Event, c.compe, p), `${ENGARDE_BASE}/competition/${org}/${t.Event}/${c.compe}/${p}`);
          o.documentos += 1;
        }
      }
    }
    console.log(`${org}: ${JSON.stringify(o)} (peticiones ${cliente.peticiones})`);
  }
  inf.peticiones = cliente.peticiones;
  return inf;
}

type Traer = (clave: string, url: string, formulario?: Record<string, string>) => Promise<string | null>;

export async function listaTorneos(org: string, traer: Traer): Promise<TorneoLista[]> {
  const out: TorneoLista[] = [];
  for (let pagina = 1, total = 1; pagina <= Math.min(total, 40); pagina += 1) {
    const cuerpo = await traer(claveCache(org, '_torneos', null, `p${pagina}.json`), `${ENGARDE_BASE}/prog/getTournois.php`, {
      option: 'tournois', organism: org, nrows: '50', order: 'asc', page: String(pagina),
    });
    if (!cuerpo) break;
    let j: { result?: TorneoLista[]; totalPages?: number | string };
    try {
      j = JSON.parse(cuerpo.replace(/^\uFEFF/, ''));
    } catch {
      break;
    }
    total = Number(j.totalPages ?? 1) || 1;
    for (const t of j.result ?? []) if (t.Organisme?.toLowerCase() === org.toLowerCase()) out.push(t);
  }
  return out;
}

export type CompIndice = {
  compe: string;
  etat: string;
  sexe: string;
  arme: string;
  estindividuelle: string;
  date: string;
  ville: string;
  pays: string;
  categorie: string;
  titre: string;
  content: string;
};

/** Pruebas del índice XML tal cual las publica (sin interpretar los valores por defecto del sistema antiguo). */
export function compsDelIndice(xml: string): { comps: CompIndice[]; paginas: number } | null {
  if (!/<comps\b/.test(xml)) return null;
  const attr = (s: string, n: string) => s.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1] ?? '';
  const hijo = (s: string, n: string) => {
    const m = s.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").trim() : '';
  };
  const comps: CompIndice[] = [];
  for (const m of xml.matchAll(/<comp\b([^>]*?)(\/>|>([\s\S]*?)<\/comp>)/g)) {
    const a = m[1];
    const cuerpo = m[3] ?? '';
    comps.push({
      compe: attr(a, 'compe'), etat: attr(a, 'etat'), sexe: attr(a, 'sexe'), arme: attr(a, 'arme'),
      estindividuelle: attr(a, 'estindividuelle'), date: attr(a, 'date'), ville: attr(a, 'ville'), pays: attr(a, 'pays'),
      categorie: hijo(cuerpo, 'categorie'), titre: hijo(cuerpo, 'titre'), content: hijo(cuerpo, 'content'),
    });
  }
  const paginas = Number(xml.match(/<pagination\b[^>]*\bnbpages="(\d+)"/)?.[1] ?? 1) || 1;
  return { comps, paginas };
}

export async function indiceTorneo(org: string, evt: string, traer: Traer): Promise<CompIndice[]> {
  const out: CompIndice[] = [];
  for (let pagina = 1, total = 1; pagina <= Math.min(total, 25); pagina += 1) {
    const xml = await traer(claveCache(org, evt, null, `indice-p${pagina}.xml`), ENGARDE_INDICE, formularioIndiceEngarde(org, evt, pagina));
    if (!xml) break;
    const r = compsDelIndice(xml);
    if (!r) break;
    total = r.paginas;
    for (const c of r.comps) if (!out.some((x) => x.compe === c.compe)) out.push(c);
  }
  return out;
}

async function main(): Promise<void> {
  const salida = argumento('salida', CARPETA_ENGARDE_HISTORICO);
  const orgs = argumento('org', ORGANIZADORES_ES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const inf = await descargarHistorico({
    salida,
    pausaMs: Math.max(500, Number(argumento('pausa-ms', '600'))),
    max: Number(argumento('max', '100000')),
    hasta: argumento('hasta', FECHA_CORTE),
    orgs,
  });
  writeFileSync(join(salida, '_descarga-informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, errores: inf.errores.slice(0, 20) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
