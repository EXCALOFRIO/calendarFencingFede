/**
 * Poules y cuadros de Engarde para las pruebas nacionales individuales cuyo documento sólo
 * publica la clasificación, y fases que les faltan a las pruebas `engarde` ya cargadas.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-engarde.ts \
 *     [--db <calendario-trabajo/nuevo7.sqlite>] [--desde 2017-01-01] [--hasta 2026-10-06] \
 *     [--cache <calendario-trabajo/cache-lote7-pdf/engarde>] [--salida <calendario-trabajo/hechos/lote7-pdf/engarde>] \
 *     [--opcional <calendario-trabajo/hechos/lote7-pdf-opcional/engarde>] \
 *     [--pausa-ms 600] [--max 3000] [--sin-red] [--refrescar-listas] [--detalle]
 *     [--extra org/evt@temporada@fecha,...] [--hechos-previos <hechos/lote7-pdf/droid>]
 *
 * A. Huecos `rfee_pdf` (variante de `asaltos-rfee-engarde.ts`, que se limitaba a ABS-M15):
 *    - mismos huecos que `huecosNacionales` (ninguna lectura del evento trae la fase), todas
 *      las categorías (criterium M9-M13, veteranos, ligas...); los `skermo_rfee` no entran;
 *    - torneos candidatos: título nacional a ±3 días o cualquier organizador español a ±1 día;
 *    - cada prueba se lee de la página dinámica (`/competition/...`) y, si está vacía («This
 *      competition currently has no data»), de la exportación estática (`/files/.../menu.html`);
 *    - el fichero se escribe en `--salida` sólo si `mismoEvento` (el mismo criterio que usa
 *      `unificar-personas.ts` para fundir la copia de Engarde con la nacional) la casa con el hueco.
 *      Si no casa, pero casi todos los nombres de la clasificación del hueco están en la prueba de
 *      Engarde (criterium que Engarde tira mixto o con dos años juntos y el PDF publica por sexo
 *      y año), va a `--opcional`: es el mismo evento, pero quedaría como prueba aparte.
 * B. Pruebas `engarde` de la base sin poules o sin cuadro: se vuelven a leer (dinámica y
 *    estática) y se escribe el fichero con su clave de siempre si trae la fase que falta.
 * C. `--extra`: torneos que un PDF de la RFEE enlaza en su texto (el PDF no trae datos, sólo el
 *    enlace); se escriben todas sus pruebas individuales sin emparejar por nombres.
 *
 * User-Agent = `INGEST_USER_AGENT` del `.env`; una petición cada vez con pausa.
 * Fuente `engarde`, clave `engarde:{org}/{evt}/{compe}`. Los registros no imprimen nombres.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { ENGARDE_BASE, ENGARDE_INDICE, parsearFechaTexto, parsearIndiceEngarde, parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { decodificarHtml, documentosDelMenu, esCuadroPrincipal, esFechaFicticiaEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { huecosNacionales, torneoNacional, torneosCacheados, type Hueco } from './asaltos-rfee-engarde';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import {
  cargarPruebasNacionales, enlacesDelCatalogo, leerCatalogoNacional, mismoEvento, nombresEnComun, prepararNombre,
  type PruebaNacional,
} from './dedupe-pruebas';
import { categoriaEngarde, convertirPrueba, generoEngarde, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { CacheEngarde, CARPETA_ENGARDE, claveCache, formularioIndiceEngarde, paginasDePrueba } from './engarde-descargar';
import { convertirEntrada, type EntradaPrueba } from './engarde-historico-a-hechos';
import {
  CARPETA_ENGARDE_HISTORICO, compsDelIndice, fechaTorneoLista, listaTorneos, ORGANIZADORES_ES, urlFicheroEngarde,
  type CompIndice, type TorneoLista,
} from './engarde-historico-descargar';
import { CACHE_LOTE7_PDF, userAgentLote7 } from './lote7-pdf-comun';

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Puede un torneo de la lista alojar el hueco? Nacional a ±3 días o cualquiera a ±1 día. */
export function torneoCandidato(t: Pick<TorneoLista, 'Organisme' | 'Titre'> & { fecha: string }, fechaHueco: string): boolean {
  const d = Math.abs(dia(t.fecha) - dia(fechaHueco));
  return d <= 1 || (d <= 3 && torneoNacional(t));
}

/**
 * Torneo sin fecha en la lista: de la RFEE, de AEVE o con título nacional, y con el año del hueco
 * (`2018`, `_18`, `1718`/`1819`, `17-18`) en el identificador o en el título.
 */
export function torneoSinFechaCandidato(t: Pick<TorneoLista, 'Organisme' | 'Event' | 'Titre'>, fechaHueco: string): boolean {
  const org = t.Organisme.toLowerCase();
  if (org !== 'rfee' && org !== 'aeve_esgrima' && !torneoNacional(t)) return false;
  const y = Number(fechaHueco.slice(0, 4));
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  const texto = `${t.Event} ${t.Titre ?? ''}`.toLowerCase();
  const temporadas = [[y - 1, y], [y, y + 1]].map(([a, b]) => [`${yy(a)}${yy(b)}`, `${yy(a)}-${yy(b)}`]).flat();
  return texto.includes(String(y)) || temporadas.some((s) => texto.includes(s)) || new RegExp(`(^|[^0-9])${yy(y)}([^0-9]|$)`).test(texto);
}

/**
 * La clasificación del hueco cabe casi entera en la prueba de Engarde: al menos 3 nombres y el 80 %
 * de los del hueco. Sólo para pruebas del mismo arma, fecha y categoría que `mismoEvento` no
 * casa porque la prueba de Engarde junta sexos o años que el PDF publica por separado.
 */
export function huecoContenido(hueco: Pick<PruebaNacional, 'nombres'>, engarde: Pick<PruebaNacional, 'nombres'>): boolean {
  if (hueco.nombres.length < 3) return false;
  const comunes = nombresEnComun(hueco.nombres, engarde.nombres);
  return comunes >= 3 && comunes / hueco.nombres.length >= 0.8;
}

/** Fases que trae una lectura y faltan en la base. */
export function fasesNuevas(h: Pick<HechosPrueba, 'bouts'>, faltan: readonly ('POULE' | 'TABLEAU')[]): ('POULE' | 'TABLEAU')[] {
  return faltan.filter((f) => h.bouts.some((b) => b.phase === f));
}

class Red {
  peticiones = 0;
  private ultima = 0;
  constructor(private readonly pausaMs: number, private readonly max: number, private readonly activa: boolean, private readonly ua: string) {}

  disponible(): boolean {
    return this.activa && this.peticiones < this.max;
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
            'User-Agent': this.ua,
            Accept: formulario ? 'application/xml, application/json' : 'text/html',
            ...(formulario ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: formulario ? new URLSearchParams(formulario).toString() : undefined,
          signal: AbortSignal.timeout(45_000),
          redirect: 'follow',
        });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if ((res.status === 429 || res.status >= 500) && intento < 3) {
          const ra = Number(res.headers.get('retry-after'));
          await esperar(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 5000 * intento);
          continue;
        }
        return { status: res.status, body: decodificarHtml(bytes, res.headers.get('content-type')) };
      } catch (e) {
        if (intento >= 3) throw e;
        await esperar(5000 * intento);
      }
    }
  }
}

function comoPrueba(h: HechosPrueba): PruebaNacional {
  const vistos = new Set<string>();
  const nombres = [];
  for (const n of [...h.results.map((r) => r.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])]) {
    const p = prepararNombre(n);
    if (!p.norm || vistos.has(p.norm)) continue;
    vistos.add(p.norm);
    nombres.push(p);
  }
  return {
    id: h.competition.competitionKey, source: 'engarde', season: h.edition.season, competition_key: h.competition.competitionKey,
    edition_id: h.edition.tournamentKey, weapon: h.competition.weapon, gender: h.competition.gender, category: h.competition.category,
    fecha: h.competition.date ?? h.edition.startDate ?? '', url: h.sourceUrl, resultados: h.results.length,
    conPuesto: h.results.filter((r) => r.position !== null).length,
    asaltos: { POULE: h.bouts.filter((b) => b.phase === 'POULE').length, TABLEAU: h.bouts.filter((b) => b.phase === 'TABLEAU').length },
    nombres,
  };
}

type Traer = (clave: string, url: string, formulario?: Record<string, string>, refrescar?: boolean) => Promise<string | null>;
type Torneo = { pruebas: PruebaIndice[]; comps: Map<string, CompIndice>; nombre: string | null; fechas: string[] };

async function leerTorneo(org: string, evt: string, titulo: string | null, traer: Traer): Promise<Torneo> {
  const pruebas: PruebaIndice[] = [];
  const comps = new Map<string, CompIndice>();
  for (let n = 1, total = 1; n <= Math.min(total, 25); n += 1) {
    const xml = await traer(claveCache(org, evt, null, `indice-p${n}.xml`), ENGARDE_INDICE, formularioIndiceEngarde(org, evt, n));
    if (xml === null) break;
    for (const c of compsDelIndice(xml)?.comps ?? []) if (!comps.has(c.compe)) comps.set(c.compe, c);
    const indice = parsearIndiceEngarde(xml);
    if (!indice.ok) break;
    total = indice.paginas;
    for (const p of indice.pruebas) {
      if (pruebas.some((q) => q.compe === p.compe)) continue;
      const sexe = comps.get(p.compe)?.sexe ?? null;
      // La fecha ficticia del sistema antiguo («2012-01-01») no es la de la prueba.
      const ficticia = esFechaFicticiaEngarde(comps.get(p.compe)?.date ?? '') || esFechaFicticiaEngarde(p.fecha);
      pruebas.push({ ...p, fecha: ficticia ? null : p.fecha, sexe, generoFinal: generoEngarde(p, sexe), categoriaFinal: categoriaEngarde(p.categoriaOriginal, p.titulo) });
    }
  }
  return { pruebas, comps, nombre: titulo, fechas: pruebas.map((p) => p.fecha).filter((f): f is string => !!f).sort() };
}

/**
 * Lee una prueba de Engarde por las dos vías y devuelve la lectura con más asaltos.
 * `season` es la temporada del hueco (A) o la de la prueba guardada (B).
 */
async function leerPrueba(
  org: string, evt: string, p: PruebaIndice, torneo: Torneo, season: string, fechaTorneo: string, traer: Traer,
): Promise<{ ok: true; hechos: HechosPrueba; via: string } | { ok: false; motivo: string }> {
  let mejor: { hechos: HechosPrueba; via: string } | null = null;
  let motivo = 'sin_documentos';
  const prueba = await traer(claveCache(org, evt, p.compe, 'prueba.html'), urlPruebaEngarde(org, evt, p.compe));
  if (prueba !== null && !/currently has no data/i.test(prueba)) {
    if (torneo.nombre === null) {
      const torneoHtml = await traer(claveCache(org, evt, null, 'torneo.html'), urlTorneoEngarde(org, evt));
      torneo.nombre = (torneoHtml ? parsearTorneoEngarde(torneoHtml).nombre : null) ?? `${org}/${evt}`;
    }
    const paginas: Paginas = { prueba, clasfinal: null, poules: [], cuadros: [], faltan: [] };
    for (const nombre of paginasDePrueba(prueba, org, evt, p.compe).slice(0, 16)) {
      const html = await traer(claveCache(org, evt, p.compe, nombre), `${ENGARDE_BASE}/competition/${org}/${evt}/${p.compe}/${nombre}`);
      if (html === null) {
        paginas.faltan.push(nombre);
        continue;
      }
      const np = nombre.match(/^poules(\d+)\.htm$/i);
      if (/^clasfinal\.htm$/i.test(nombre)) paginas.clasfinal = html;
      else if (np) paginas.poules.push({ pagina: Number(np[1]), html });
      else paginas.cuadros.push({ url: `${urlPruebaEngarde(org, evt, p.compe)}/${nombre}`, html });
    }
    const r = convertirPrueba(p, paginas, {
      season, nombreTorneo: torneo.nombre, inicio: torneo.fechas[0] ?? fechaTorneo, fin: torneo.fechas.at(-1) ?? fechaTorneo, ciudad: p.ciudad,
    });
    if (r.ok) mejor = { hechos: r.hechos, via: 'dinamica' };
    else motivo = r.motivo;
  }
  const ci = torneo.comps.get(p.compe);
  const menu = await traer(claveCache(org, evt, p.compe, 'files_menu.html'), urlFicheroEngarde(org, evt, p.compe, 'menu.html'));
  if (ci && menu !== null) {
    const docs: { fichero: string; html: string; url: string; tipo: string }[] = [];
    const faltan: string[] = [];
    for (const d of documentosDelMenu(menu).filter((x) => x.tipo !== 'cuadro' || esCuadroPrincipal(x.fichero)).slice(0, 30)) {
      const html = await traer(claveCache(org, evt, p.compe, `files_${d.fichero}`), urlFicheroEngarde(org, evt, p.compe, d.fichero));
      if (html === null) faltan.push(d.fichero);
      else docs.push({ ...d, html, url: urlFicheroEngarde(org, evt, p.compe, d.fichero) });
    }
    // El índice da la fecha ficticia también como texto («01/01/2012»).
    const legado = esFechaFicticiaEngarde(ci.date) || esFechaFicticiaEngarde(parsearFechaTexto(ci.date));
    const numero = (f: string) => Number(f.match(/(\d+)\.html?$/i)?.[1] ?? 1);
    const e: EntradaPrueba = {
      org, evt, compe: p.compe, claveTorneo: `engarde:${org}/${evt}`, claveCompeticion: `engarde:${org}/${evt}/${p.compe}`,
      nombreTorneo: torneo.nombre ?? `${org}/${evt}`, comp: ci, legado, titulos: [ci.titre, ci.content],
      fechaIndice: legado ? null : parsearFechaTexto(ci.date), fechaTorneo, temporadaCarpeta: null,
      clasificacion: docs.find((d) => d.tipo === 'clasificacion') ?? null,
      poules: docs.filter((d) => d.tipo === 'poules').map((d) => ({ ...d, pagina: numero(d.fichero) })),
      cuadros: docs.filter((d) => d.tipo === 'cuadro'),
      faltan, extractor: 'lector_engarde_estatico',
    };
    const r = convertirEntrada(e, '2999-01-01');
    if (r.ok && (!mejor || r.hechos.bouts.length > mejor.hechos.bouts.length)) {
      // La temporada la fija la fecha publicada; si no la hay, la del hueco.
      mejor = { hechos: r.hechos, via: 'estatica' };
    } else if (!r.ok && !mejor) motivo = r.motivo;
  }
  if (mejor && mejor.hechos.edition.season !== season) motivo = `temporada_distinta:${mejor.hechos.edition.season}`;
  return mejor && mejor.hechos.edition.season === season ? { ok: true, ...mejor } : { ok: false, motivo };
}

/**
 * Puestos que otro productor de este lote (los droids de `lote7-pdf-droids.ts`) acaba de leer para
 * pruebas que en la base están vacías: sin ellos esas pruebas no entran como hueco ni se pueden
 * casar por nombres. Sólo se añaden a pruebas sin puestos y con la misma clave.
 */
export function anadirPuestosPrevios(pruebas: PruebaNacional[], carpeta: string): number {
  const porClave = new Map(pruebas.map((p) => [`${p.source}\u0000${p.season}\u0000${p.competition_key}`, p]));
  let n = 0;
  for (const f of readdirSync(carpeta)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const h = JSON.parse(readFileSync(join(carpeta, f), 'utf8')) as HechosPrueba;
    const p = porClave.get(`${h.source}\u0000${h.edition.season}\u0000${h.competition.competitionKey}`);
    if (!p || p.resultados > 0 || h.results.length === 0) continue;
    const vistos = new Set(p.nombres.map((x) => x.norm));
    for (const r of h.results) {
      const x = prepararNombre(r.name);
      if (x.norm && !vistos.has(x.norm)) {
        vistos.add(x.norm);
        p.nombres.push(x);
      }
    }
    p.resultados = h.results.length;
    p.conPuesto = h.results.filter((r) => r.position !== null).length;
    n += 1;
  }
  return n;
}

type GapEngarde = { id: string; key: string; season: string; faltan: ('POULE' | 'TABLEAU')[]; resultados: number; fecha: string };

function huecosEngarde(db: DatabaseSync, hasta: string): GapEngarde[] {
  const filas = db.prepare(
    `SELECT c.id, c.competition_key k, c.season s, coalesce(c.competition_date, e.start_date) f,
       (SELECT count(*) FROM sport_result r WHERE r.competition_id = c.id) nr,
       (SELECT count(*) FROM sport_bout b WHERE b.competition_id = c.id AND b.phase = 'POULE') np,
       (SELECT count(*) FROM sport_bout b WHERE b.competition_id = c.id AND b.phase = 'TABLEAU') nt
     FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'engarde' AND c.format = 'INDIVIDUAL' AND c.competition_key LIKE 'engarde:%'
       AND coalesce(c.competition_date, e.start_date) < ?`,
  ).all(hasta) as { id: string; k: string; s: string; f: string; nr: number; np: number; nt: number }[];
  return filas
    .map((r) => ({
      id: r.id, key: r.k, season: r.s, fecha: r.f, resultados: Number(r.nr),
      faltan: [...(Number(r.np) === 0 ? ['POULE' as const] : []), ...(Number(r.nt) === 0 ? ['TABLEAU' as const] : [])],
    }))
    .filter((r) => r.faltan.length > 0 || r.resultados === 0);
}

async function main(): Promise<void> {
  const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo7.sqlite'));
  const desde = argumento('desde', '2017-01-01');
  const hasta = argumento('hasta', '2026-10-06');
  const carpetaCache = argumento('cache', join(CARPETA_TRABAJO, 'cache-lote7-pdf', 'engarde'));
  const salida = argumento('salida', join(CARPETA_TRABAJO, 'hechos', 'lote7-pdf', 'engarde'));
  const opcional = argumento('opcional', join(CARPETA_TRABAJO, 'hechos', 'lote7-pdf-opcional', 'engarde'));
  const red = new Red(Math.max(500, Number(argumento('pausa-ms', '600'))), Number(argumento('max', '3000')), !bandera('sin-red'), userAgentLote7());
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const pruebas = cargarPruebasNacionales(db);
  const previos = argumento('hechos-previos', join(CARPETA_TRABAJO, 'hechos', 'lote7-pdf', 'droid'));
  if (previos && existsSync(previos)) anadirPuestosPrevios(pruebas, previos);
  const gapsEngarde = huecosEngarde(db, hasta);
  db.close();
  const huecos = huecosNacionales(pruebas, enlacesDelCatalogo(pruebas, leerCatalogoNacional()), desde)
    .filter((h) => h.source === 'rfee_pdf' && h.fecha < hasta);

  const propia = new CacheEngarde(carpetaCache);
  // Cachés de otros productores, sólo lectura (incluida la del lote 7 de Skermo).
  const ajenas = [CARPETA_ENGARDE, CARPETA_ENGARDE_HISTORICO, join(CARPETA_TRABAJO, 'cache-asaltos-rfee', 'engarde'), join(CARPETA_TRABAJO, 'cache-lote7-skermo', 'engarde')]
    .filter((c) => existsSync(join(c, 'raw'))).map((c) => new CacheEngarde(c));
  const leer = (clave: string) => {
    for (const c of [propia, ...ajenas]) {
      const r = c.obtener(clave);
      if (r && (r.status === 200 || r.status === 404)) return { hay: true, cuerpo: c.leer(clave) };
    }
    return { hay: false, cuerpo: null };
  };
  const traer: Traer = async (clave, url, formulario, refrescar = false) => {
    const previo = refrescar ? { hay: false, cuerpo: null } : leer(clave);
    if (previo.hay) return previo.cuerpo;
    if (!red.disponible()) return refrescar ? leer(clave).cuerpo : null;
    const r = await red.pedir(url, formulario);
    propia.guardar(clave, url, r.status, r.body);
    return r.status === 200 ? r.body : null;
  };

  const historica = ajenas.find((c) => c.raw.startsWith(CARPETA_ENGARDE_HISTORICO)) ?? propia;
  const torneos = new Map<string, TorneoLista & { fecha: string }>();
  for (const t of torneosCacheados(historica, ORGANIZADORES_ES)) torneos.set(`${t.Organisme}/${t.Event}`, t);
  if (bandera('refrescar-listas')) {
    for (const org of ORGANIZADORES_ES) {
      for (const t of await listaTorneos(org, (c, u, f) => traer(c, u, f, true))) {
        const fecha = fechaTorneoLista(t);
        if (fecha) torneos.set(`${t.Organisme}/${t.Event}`, { ...t, fecha });
      }
    }
  }
  // Todos los organizadores de engarde-service.com (`prog/getOrganism.php`, 738 el 2026-10-06), no sólo los españoles.
  if (bandera('todos-organismos')) {
    const ruta = join(CACHE_LOTE7_PDF, 'engarde-organismos.json');
    if (!existsSync(ruta)) {
      const r = await red.pedir(`${ENGARDE_BASE}/prog/getOrganism.php`, { option: 'organism', nrows: '2000' });
      if (r.status === 200) writeFileSync(ruta, r.body);
    }
    const orgs = existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as { result?: { Organisme: string }[] }).result ?? [] : [];
    let n = 0;
    for (const { Organisme: org } of orgs) {
      if (!org || (ORGANIZADORES_ES as readonly string[]).includes(org)) continue;
      for (const t of await listaTorneos(org, (c, u, f) => traer(c, u, f))) {
        const fecha = fechaTorneoLista(t);
        if (fecha) torneos.set(`${t.Organisme}/${t.Event}`, { ...t, fecha });
      }
      if (++n % 50 === 0) console.log(`listas de organizadores: ${n}/${orgs.length}; torneos ${torneos.size}; peticiones ${red.peticiones}`);
    }
  }

  const inf = {
    huecos: huecos.length, huecosPorCategoria: {} as Record<string, number>, huecosConTorneo: 0, torneosCandidatos: 0,
    torneosConIndice: 0, pruebasCandidatas: 0, ficheros: 0, ficherosOpcionales: 0, huecosCubiertos: 0, huecosCubiertosOpcional: 0,
    descartadas: {} as Record<string, number>, vias: {} as Record<string, number>,
    asaltos: { POULE: 0, TABLEAU: 0 }, asaltosOpcionales: { POULE: 0, TABLEAU: 0 }, peticiones: 0, torneosEnListas: torneos.size,
    cubiertos: [] as { hueco: string; prueba: string; fecha: string; categoria: string; poules: number; cuadro: number; opcional: boolean }[],
    sinCubrir: [] as { hueco: string; fecha: string; categoria: string; arma: string; genero: string; faltan: string[]; url: string | null }[],
    sinFechaEnListas: 0,
    engarde: { huecos: gapsEngarde.length, completados: 0, asaltos: { POULE: 0, TABLEAU: 0 }, resultados: 0, descartadas: {} as Record<string, number>, completadas: [] as string[] },
  };
  for (const h of huecos) inf.huecosPorCategoria[h.category] = (inf.huecosPorCategoria[h.category] ?? 0) + 1;
  const detalle = bandera('detalle');
  const depurar = argumento('depurar', '');
  let actual = '';
  const descartar = (m: string) => {
    inf.descartadas[m] = (inf.descartadas[m] ?? 0) + 1;
    if (detalle) console.log(`  descarte ${m} ${actual}`);
  };
  // Torneos de organizadores españoles sin fecha usable en la lista (fecha ficticia del sistema antiguo
  // y título sin fecha): entran por el año en el nombre; las fechas reales las dan sus documentos.
  const sinFecha: TorneoLista[] = [];
  for (const org of ORGANIZADORES_ES) {
    for (const t of await listaTorneos(org, (c, u, f) => traer(c, u, f))) {
      if (!fechaTorneoLista(t) && !torneos.has(`${t.Organisme}/${t.Event}`)) sinFecha.push(t);
    }
  }
  inf.sinFechaEnListas = sinFecha.length;
  const clavesSinFecha = new Set(sinFecha.map((t) => `${t.Organisme}/${t.Event}`));
  const candidatos = new Map<string, { t: TorneoLista & { fecha: string }; huecos: Hueco[] }>();
  for (const h of huecos) {
    const ts = [
      ...[...torneos.values()].filter((t) => torneoCandidato(t, h.fecha)),
      ...sinFecha.filter((t) => torneoSinFechaCandidato(t, h.fecha)).map((t) => ({ ...t, fecha: h.fecha })),
    ];
    if (ts.length > 0) inf.huecosConTorneo += 1;
    for (const t of ts) {
      const k = `${t.Organisme}/${t.Event}`;
      const c = candidatos.get(k) ?? { t, huecos: [] };
      c.huecos.push(h);
      candidatos.set(k, c);
    }
  }
  inf.torneosCandidatos = candidatos.size;
  console.log(`huecos=${huecos.length} conTorneo=${inf.huecosConTorneo} torneos=${candidatos.size} listas=${torneos.size} huecosEngarde=${gapsEngarde.length}`);
  for (const d of [salida, opcional]) mkdirSync(d, { recursive: true });
  const escritos = new Set<string>();
  const escritosOpcionales = new Set<string>();
  const cubiertos = new Set<string>();
  const cubiertosOpcional = new Set<string>();
  const escribir = (h: HechosPrueba, enOpcional: boolean) => {
    const fichero = ficheroHechos(h);
    const lista = enOpcional ? escritosOpcionales : escritos;
    if (lista.has(fichero) || (enOpcional && escritos.has(fichero))) return;
    writeFileSync(join(enOpcional ? opcional : salida, fichero), JSON.stringify(h, null, 2));
    lista.add(fichero);
    if (enOpcional) inf.ficherosOpcionales += 1;
    else inf.ficheros += 1;
    for (const b of h.bouts) (enOpcional ? inf.asaltosOpcionales : inf.asaltos)[b.phase] += 1;
  };

  // ---------------------------------------------------------------- A. huecos rfee_pdf
  for (const { t, huecos: hs } of [...candidatos.values()].sort((a, b) => (a.t.fecha < b.t.fecha ? -1 : 1))) {
    const org = t.Organisme;
    const evt = t.Event;
    const torneo = await leerTorneo(org, evt, t.Titre?.trim() || null, traer);
    if (torneo.pruebas.length === 0) {
      descartar('torneo_sin_indice');
      continue;
    }
    inf.torneosConIndice += 1;
    for (const p of torneo.pruebas) {
      if (p.individual !== true || !p.arma) continue;
      let suyos = hs.filter((h) => h.weapon === p.arma &&
        (!p.generoFinal || p.generoFinal === 'MIXTO' || h.gender === 'MIXTO' || h.gender === p.generoFinal) &&
        (!p.categoriaFinal || p.categoriaFinal === h.category) &&
        (!p.fecha || Math.abs(dia(p.fecha) - dia(h.fecha)) <= 1));
      if (depurar === `${org}/${evt}`) {
        console.log(`  depurar ${p.compe} ind=${p.individual} ${p.arma} ${p.generoFinal} ${p.categoriaFinal} ${p.fecha} suyos=${suyos.length}`);
      }
      if (suyos.length === 0) continue;
      inf.pruebasCandidatas += 1;
      actual = `${org}/${evt}/${p.compe} ${p.arma} ${p.generoFinal} ${p.categoriaFinal} ${p.fecha} huecos=${suyos.length}`;
      if (!p.categoriaFinal) {
        const cats = new Set(suyos.map((h) => h.category));
        if (cats.size !== 1) {
          descartar('categoria_ambigua');
          continue;
        }
        p.categoriaFinal = [...cats][0] as PruebaIndice['categoriaFinal'];
      }
      if (!p.generoFinal) p.generoFinal = suyos[0].gender as PruebaIndice['generoFinal'];
      // Un torneo sin fecha casa con huecos de todo el año, que pueden ser de dos temporadas: se
      // prueba cada una con la fecha de su primer hueco y la lectura fija cuál es.
      const sinFechaT = clavesSinFecha.has(`${org}/${evt}`) && !p.fecha;
      let r: Awaited<ReturnType<typeof leerPrueba>> = { ok: false, motivo: 'sin_documentos' };
      for (const s of sinFechaT ? [...new Set(suyos.map((x) => x.season))] : [suyos[0].season]) {
        const primero = suyos.find((x) => x.season === s)!;
        r = await leerPrueba(org, evt, p, torneo, s, sinFechaT ? primero.fecha : t.fecha, traer);
        if (r.ok) break;
      }
      if (!r.ok) {
        descartar(r.motivo);
        continue;
      }
      const h = r.hechos;
      if (sinFechaT) suyos = suyos.filter((x) => x.season === h.edition.season);
      if (h.bouts.length === 0) {
        descartar('sin_asaltos');
        continue;
      }
      const e = comoPrueba(h);
      if (detalle) actual += ` via=${r.via} engarde=${e.nombres.length}n/${e.resultados}r huecos=${suyos.map((x) => `${x.nombres.length}n/${x.resultados}r/${x.category}/${x.gender}`).join(',')}`;
      const casa = suyos.filter((x) => mismoEvento(x, e) > 0);
      const contenidos = casa.length > 0 ? [] : suyos.filter((x) => h.competition.category === x.category && huecoContenido(x, e));
      if (casa.length === 0 && contenidos.length === 0) {
        descartar('otro_evento_por_nombres');
        continue;
      }
      inf.vias[r.via] = (inf.vias[r.via] ?? 0) + 1;
      const enOpcional = casa.length === 0;
      escribir(h, enOpcional);
      for (const c of enOpcional ? contenidos : casa) {
        (enOpcional ? cubiertosOpcional : cubiertos).add(c.id);
        inf.cubiertos.push({
          hueco: `${c.source}:${c.id}`, prueba: `${org}/${evt}/${p.compe}`, fecha: c.fecha, categoria: c.category,
          poules: e.asaltos.POULE, cuadro: e.asaltos.TABLEAU, opcional: enOpcional,
        });
      }
    }
    console.log(`${org}/${evt} (${t.fecha}): ${torneo.pruebas.length} pruebas; peticiones ${red.peticiones}`);
  }

  // ---------------------------------------------------------------- B. pruebas engarde incompletas
  const porTorneo = new Map<string, GapEngarde[]>();
  for (const g of gapsEngarde) {
    const m = g.key.match(/^engarde:([^/]+)\/([^/]+)\/(.+)$/);
    if (!m) continue;
    const k = `${m[1]}/${m[2]}`;
    porTorneo.set(k, [...(porTorneo.get(k) ?? []), g]);
  }
  const descE = (m: string) => (inf.engarde.descartadas[m] = (inf.engarde.descartadas[m] ?? 0) + 1);
  for (const [k, gs] of porTorneo) {
    const [org, evt] = k.split('/');
    const lista = torneos.get(k);
    const torneo = await leerTorneo(org, evt, lista?.Titre?.trim() || null, traer);
    for (const g of gs) {
      const compe = g.key.split('/').slice(2).join('/');
      const p = torneo.pruebas.find((x) => x.compe === compe);
      if (!p) {
        descE('prueba_no_en_indice');
        continue;
      }
      const r = await leerPrueba(org, evt, p, torneo, g.season, lista?.fecha ?? g.fecha, traer);
      if (!r.ok) {
        descE(r.motivo);
        continue;
      }
      if (r.hechos.competition.competitionKey !== g.key) {
        descE('clave_distinta');
        continue;
      }
      const nuevas = fasesNuevas(r.hechos, g.faltan);
      const conResultados = g.resultados === 0 && r.hechos.results.length > 0;
      if (nuevas.length === 0 && !conResultados) {
        descE(g.faltan.length > 0 ? `sin_fase_publicada:${g.faltan.join('+')}` : 'sin_resultados_publicados');
        continue;
      }
      escribir(r.hechos, false);
      inf.engarde.completados += 1;
      inf.engarde.completadas.push(`${g.key} +${nuevas.join('+')}${conResultados ? '+RES' : ''} via=${r.via}`);
      for (const b of r.hechos.bouts) if (nuevas.includes(b.phase)) inf.engarde.asaltos[b.phase] += 1;
      if (conResultados) inf.engarde.resultados += r.hechos.results.length;
    }
  }

  // ---------------------------------------------------------------- C. torneos que enlaza el propio PDF
  const extra = { torneos: 0, ficheros: 0, asaltos: { POULE: 0, TABLEAU: 0 }, resultados: 0, descartadas: {} as Record<string, number> };
  for (const par of argumento('extra', '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [k, season, fecha] = par.split('@');
    const [org, evt] = (k ?? '').split('/');
    if (!org || !evt || !season || !fecha) continue;
    extra.torneos += 1;
    const torneo = await leerTorneo(org, evt, null, traer);
    for (const p of torneo.pruebas) {
      if (p.individual !== true || !p.arma) continue;
      const r = await leerPrueba(org, evt, p, torneo, season, fecha, traer);
      if (!r.ok) {
        extra.descartadas[r.motivo] = (extra.descartadas[r.motivo] ?? 0) + 1;
        continue;
      }
      escribir(r.hechos, false);
      extra.ficheros += 1;
      extra.resultados += r.hechos.results.length;
      for (const b of r.hechos.bouts) extra.asaltos[b.phase] += 1;
    }
  }
  Object.assign(inf, { extra });

  for (const [d, lista] of [[salida, escritos], [opcional, escritosOpcionales]] as const) {
    for (const f of readdirSync(d)) if (f.endsWith('.json') && !f.startsWith('_') && !lista.has(f)) rmSync(join(d, f));
  }
  inf.huecosCubiertos = cubiertos.size;
  inf.huecosCubiertosOpcional = [...cubiertosOpcional].filter((x) => !cubiertos.has(x)).length;
  inf.peticiones = red.peticiones;
  inf.sinCubrir = huecos.filter((h) => !cubiertos.has(h.id)).map((h) => ({
    hueco: `${h.source}:${h.id}`, fecha: h.fecha, categoria: h.category, arma: h.weapon, genero: h.gender, faltan: h.faltan, url: h.url,
  }));
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, cubiertos: inf.cubiertos.length, sinCubrir: inf.sinCubrir.length, engarde: { ...inf.engarde, completadas: inf.engarde.completadas.length } }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
