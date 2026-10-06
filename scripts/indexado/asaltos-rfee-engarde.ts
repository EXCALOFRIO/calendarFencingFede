/**
 * Asaltos de Engarde para pruebas nacionales que sólo tienen la clasificación (Skermo HTML
 * o PDF de clasificación) y cuyo torneo el catálogo nacional no enlaza.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/asaltos-rfee-engarde.ts \
 *     --db <copia.sqlite> [--desde 2017-01-01] [--cache <calendario-trabajo/cache-asaltos-rfee/engarde>] \
 *     [--salida <calendario-trabajo/hechos/asaltos-rfee/engarde>] [--pausa-ms 500] [--max 4000] [--sin-red] \
 *     [--categorias ABS,M23,M20,M17,M15]
 *
 * 1. Huecos: pruebas INDIVIDUAL rfee_pdf / skermo_rfee con puestos y sin poules o sin cuadro,
 *    que no tienen otra prueba del mismo evento con esa fase (`dedupe-pruebas.ts`).
 * 2. Torneos candidatos: las listas de torneos de los organizadores españoles de Engarde que
 *    `engarde-historico-descargar.ts` dejó en caché (`prog/getTournois.php`), con fecha a ±3 días,
 *    de la RFEE o con título de prueba nacional (TNR, campeonato de España, liga, circuito…).
 * 3. Por torneo se lee su índice y, para cada prueba de la misma arma, género, categoría y
 *    fecha (±1 día) que un hueco, la página de la prueba, la clasificación, poules y cuadros
 *    (las mismas páginas que `engarde-descargar.ts`, con su caché y User-Agent, una petición
 *    cada vez con pausa). Se reutiliza lo ya descargado por los otros productores de Engarde.
 * 4. Se convierte con `convertirPrueba` de `engarde-a-hechos.ts` (los nombres de puestos y
 *    asaltos salen del propio HTML) y el fichero sólo se escribe si la prueba de Engarde es el
 *    mismo evento que el hueco por nombres (`mismoEvento`): un torneo regional del mismo fin de
 *    semana nunca entra.
 *
 * Los ficheros salen con fuente `engarde` y la clave de siempre (`engarde:{org}/{evt}/{compe}`):
 * `unificar-personas.ts` los pasa a la prueba nacional y borra la de Engarde.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { ENGARDE_BASE, ENGARDE_INDICE, parsearIndiceEngarde, parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { argumento, bandera, CARPETA_TRABAJO, NUEVO_POR_DEFECTO } from './comun';
import {
  cargarPruebasNacionales,
  emparejarDuplicados,
  enlacesDelCatalogo,
  leerCatalogoNacional,
  mismoEvento,
  prepararNombre,
  type PruebaNacional,
} from './dedupe-pruebas';
import { categoriaEngarde, convertirPrueba, generoEngarde, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { CacheEngarde, CARPETA_ENGARDE, claveCache, formularioIndiceEngarde, paginasDePrueba, USER_AGENT_ENGARDE } from './engarde-descargar';
import { CARPETA_ENGARDE_HISTORICO, fechaTorneoLista, ORGANIZADORES_ES, type TorneoLista } from './engarde-historico-descargar';

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Hueco = PruebaNacional & { faltan: ('POULE' | 'TABLEAU')[] };

/** Pruebas nacionales con puestos a las que les falta alguna fase que ninguna otra lectura del evento trae. */
export function huecosNacionales(pruebas: readonly PruebaNacional[], enlaces = new Map<string, Set<string>>(), desde = '2017-01-01'): Hueco[] {
  const { grupos, gruposConVariasSkermo } = emparejarDuplicados(pruebas, 0.5, enlaces);
  const grupoDe = new Map<string, PruebaNacional[]>();
  for (const g of [...grupos, ...gruposConVariasSkermo]) for (const p of [g.destino, ...g.otras]) grupoDe.set(p.id, [g.destino, ...g.otras]);
  const out: Hueco[] = [];
  for (const p of pruebas) {
    if (p.source === 'engarde' || p.resultados === 0 || p.fecha < desde) continue;
    const g = grupoDe.get(p.id) ?? [p];
    const faltan = (['POULE', 'TABLEAU'] as const).filter((f) => g.every((x) => x.asaltos[f] === 0));
    if (faltan.length > 0) out.push({ ...p, faltan });
  }
  return out;
}

/** Torneos de las listas de organizadores cacheadas (una entrada por organizador/torneo). */
export function torneosCacheados(cache: CacheEngarde, orgs: readonly string[]): (TorneoLista & { fecha: string })[] {
  const vistos = new Map<string, TorneoLista & { fecha: string }>();
  for (const org of orgs) {
    for (let n = 1; n <= 200; n += 1) {
      const cuerpo = cache.leer(claveCache(org, '_torneos', null, `p${n}.json`));
      if (cuerpo === null) break;
      let j: { result?: TorneoLista[] };
      try {
        j = JSON.parse(cuerpo);
      } catch {
        break;
      }
      for (const t of j.result ?? []) {
        if (t.Organisme?.toLowerCase() !== org.toLowerCase()) continue;
        const fecha = fechaTorneoLista(t);
        if (!fecha) continue;
        vistos.set(`${t.Organisme}/${t.Event}`, { ...t, fecha });
      }
    }
  }
  return [...vistos.values()];
}

/** Torneo que puede alojar una prueba nacional: de la RFEE o con título de TNR, campeonato de España, etc. */
export function torneoNacional(t: Pick<TorneoLista, 'Organisme' | 'Titre'>): boolean {
  if (t.Organisme.toLowerCase() === 'rfee') return true;
  const s = (t.Titre ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\btnr\b|nacional|ranking|campeonato de espana|cto\.? (de )?esp|\bliga\b|copa de espana|circuit|satel|\bu-?23\b|sub-?23/.test(s);
}

class Red {
  peticiones = 0;
  private ultima = 0;
  constructor(private readonly pausaMs: number, private readonly max: number, private readonly activa: boolean) {}

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

/** Prueba de Engarde ya convertida, con los datos que pide `mismoEvento`. */
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

export type InformeEngardeRfee = {
  huecos: number;
  huecosConTorneo: number;
  torneosCandidatos: number;
  torneosConIndice: number;
  pruebasCandidatas: number;
  ficheros: number;
  huecosCubiertos: number;
  descartadas: Record<string, number>;
  asaltos: { POULE: number; TABLEAU: number };
  peticiones: number;
  cubiertos: { hueco: string; prueba: string; fecha: string; categoria: string; asaltos: number }[];
};

async function main(): Promise<void> {
  const rutaDb = argumento('db', NUEVO_POR_DEFECTO);
  const desde = argumento('desde', '2017-01-01');
  const carpetaCache = argumento('cache', join(CARPETA_TRABAJO, 'cache-asaltos-rfee', 'engarde'));
  const salida = argumento('salida', join(CARPETA_TRABAJO, 'hechos', 'asaltos-rfee', 'engarde'));
  const red = new Red(Math.max(400, Number(argumento('pausa-ms', '500'))), Number(argumento('max', '4000')), !bandera('sin-red'));
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const pruebas = cargarPruebasNacionales(db);
  db.close();
  const categorias = new Set(argumento('categorias', 'ABS,M23,M20,M17,M15').split(',').map((s) => s.trim()));
  const huecos = huecosNacionales(pruebas, enlacesDelCatalogo(pruebas, leerCatalogoNacional()), desde)
    .filter((h) => categorias.has(h.category));

  const propia = new CacheEngarde(carpetaCache);
  const ajenas = [CARPETA_ENGARDE, CARPETA_ENGARDE_HISTORICO].filter((c) => existsSync(join(c, 'raw'))).map((c) => new CacheEngarde(c));
  const leer = (clave: string) => {
    for (const c of [propia, ...ajenas]) {
      const r = c.obtener(clave);
      if (r && (r.status === 200 || r.status === 404)) return { hay: true, cuerpo: c.leer(clave) };
    }
    return { hay: false, cuerpo: null };
  };
  const traer = async (clave: string, url: string, formulario?: Record<string, string>) => {
    const previo = leer(clave);
    if (previo.hay) return previo.cuerpo;
    if (!red.disponible()) return null;
    const r = await red.pedir(url, formulario);
    propia.guardar(clave, url, r.status, r.body);
    return r.status === 200 ? r.body : null;
  };

  const torneos = torneosCacheados(ajenas.find((c) => c.raw.startsWith(CARPETA_ENGARDE_HISTORICO)) ?? propia, ORGANIZADORES_ES);
  const inf: InformeEngardeRfee = {
    huecos: huecos.length, huecosConTorneo: 0, torneosCandidatos: 0, torneosConIndice: 0, pruebasCandidatas: 0, ficheros: 0,
    huecosCubiertos: 0, descartadas: {}, asaltos: { POULE: 0, TABLEAU: 0 }, peticiones: 0, cubiertos: [],
  };
  const descartar = (m: string) => (inf.descartadas[m] = (inf.descartadas[m] ?? 0) + 1);
  const candidatos = new Map<string, { t: (typeof torneos)[number]; huecos: Hueco[] }>();
  for (const h of huecos) {
    const ts = torneos.filter((t) => Math.abs(dia(t.fecha) - dia(h.fecha)) <= 3 && torneoNacional(t));
    if (ts.length > 0) inf.huecosConTorneo += 1;
    for (const t of ts) {
      const k = `${t.Organisme}/${t.Event}`;
      const c = candidatos.get(k) ?? { t, huecos: [] };
      c.huecos.push(h);
      candidatos.set(k, c);
    }
  }
  inf.torneosCandidatos = candidatos.size;
  mkdirSync(salida, { recursive: true });
  const escritos = new Set<string>();
  const cubiertos = new Set<string>();

  for (const { t, huecos: hs } of [...candidatos.values()].sort((a, b) => (a.t.fecha < b.t.fecha ? -1 : 1))) {
    const org = t.Organisme;
    const evt = t.Event;
    const pruebasIndice: PruebaIndice[] = [];
    for (let n = 1, total = 1; n <= Math.min(total, 25); n += 1) {
      const xml = await traer(claveCache(org, evt, null, `indice-p${n}.xml`), ENGARDE_INDICE, formularioIndiceEngarde(org, evt, n));
      if (xml === null) break;
      const indice = parsearIndiceEngarde(xml);
      if (!indice.ok) break;
      total = indice.paginas;
      const sexes = new Map<string, string>();
      for (const c of xml.matchAll(/<comp\b[^>]*\bcompe="([^"]+)"[^>]*>/g)) {
        const s = c[0].match(/\bsexe="([^"]*)"/)?.[1];
        if (s !== undefined) sexes.set(c[1], s);
      }
      for (const p of indice.pruebas) {
        if (pruebasIndice.some((q) => q.compe === p.compe)) continue;
        const sexe = sexes.get(p.compe) ?? null;
        pruebasIndice.push({ ...p, sexe, generoFinal: generoEngarde(p, sexe), categoriaFinal: categoriaEngarde(p.categoriaOriginal, p.titulo) });
      }
    }
    if (pruebasIndice.length === 0) {
      descartar('torneo_sin_indice');
      continue;
    }
    inf.torneosConIndice += 1;
    const torneoHtml = await traer(claveCache(org, evt, null, 'torneo.html'), urlTorneoEngarde(org, evt));
    const nombreTorneo = (torneoHtml ? parsearTorneoEngarde(torneoHtml).nombre : null) ?? t.Titre ?? `${org}/${evt}`;
    const fechas = pruebasIndice.map((p) => p.fecha).filter((f): f is string => !!f).sort();
    for (const p of pruebasIndice) {
      if (p.individual !== true || !p.arma) continue;
      const suyos = hs.filter((h) => h.weapon === p.arma &&
        (!p.generoFinal || p.generoFinal === 'MIXTO' || h.gender === 'MIXTO' || h.gender === p.generoFinal) &&
        (!p.categoriaFinal || p.categoriaFinal === h.category) &&
        (!p.fecha || Math.abs(dia(p.fecha) - dia(h.fecha)) <= 1));
      if (suyos.length === 0) continue;
      inf.pruebasCandidatas += 1;
      if (!p.categoriaFinal) {
        const cats = new Set(suyos.map((h) => h.category));
        if (cats.size !== 1) {
          descartar('categoria_ambigua');
          continue;
        }
        p.categoriaFinal = [...cats][0] as PruebaIndice['categoriaFinal'];
      }
      if (!p.generoFinal) p.generoFinal = suyos[0].gender as PruebaIndice['generoFinal'];
      const prueba = await traer(claveCache(org, evt, p.compe, 'prueba.html'), urlPruebaEngarde(org, evt, p.compe));
      if (prueba === null) {
        descartar('sin_pagina_de_prueba');
        continue;
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
        season: suyos[0].season, nombreTorneo, inicio: fechas[0] ?? t.fecha, fin: fechas[fechas.length - 1] ?? t.fecha, ciudad: p.ciudad,
      });
      if (!r.ok) {
        descartar(r.motivo);
        continue;
      }
      const h = r.hechos;
      if (h.bouts.length === 0) {
        descartar('sin_asaltos');
        continue;
      }
      const e = comoPrueba(h);
      const casa = suyos.filter((x) => mismoEvento(x, e) > 0);
      if (casa.length !== 1) {
        descartar(casa.length === 0 ? 'otro_evento_por_nombres' : 'varios_huecos');
        continue;
      }
      const fichero = ficheroHechos(h);
      writeFileSync(join(salida, fichero), JSON.stringify(h, null, 2));
      escritos.add(fichero);
      cubiertos.add(casa[0].id);
      inf.ficheros += 1;
      for (const b of h.bouts) inf.asaltos[b.phase] += 1;
      inf.cubiertos.push({ hueco: `${casa[0].source}:${casa[0].id}`, prueba: `${org}/${evt}/${p.compe}`, fecha: casa[0].fecha, categoria: casa[0].category, asaltos: h.bouts.length });
    }
    console.log(`${org}/${evt} (${t.fecha}): ${pruebasIndice.length} pruebas; peticiones ${red.peticiones}`);
  }
  // Carpeta exclusiva de este productor: lo que no se ha escrito ahora es de una ejecución anterior.
  for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(salida, f));
  inf.huecosCubiertos = cubiertos.size;
  inf.peticiones = red.peticiones;
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify({ ...inf, cubiertos: inf.cubiertos.length }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
