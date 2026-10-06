/**
 * Asaltos de pruebas FIE individuales (temporada 2017+) que la base tiene sin
 * poules o sin cuadro, desde Fencing Worldwide (fencingworldwide.com, la web
 * pública de resultados de Ophardt), que sí publica poules (`pools/N`) y
 * cuadro (`direct/N`) de los campeonatos gestionados con Ophardt.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-fww.ts descargar [--db <sqlite>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-fww.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * `descargar` lee el archivo anual de FWW, elige los torneos que coinciden en
 * fechas y sede con las ediciones objetivo, y guarda en caché la clasificación,
 * las poules y el cuadro de cada prueba individual. `hechos` trabaja sin red:
 * cada prueba FIE se casa con la única prueba FWW del torneo con su arma,
 * género y categoría cuya clasificación comparte al menos la mitad de los
 * tiradores, y sus asaltos se escriben con las `source_fact_key` de la
 * clasificación guardada (emparejamiento por nombre, nación y puesto). Sólo se
 * emiten las fases que la base no tiene: una fase con asaltos guardados no se
 * toca, para no duplicarla con otra numeración de poules.
 */
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { FusionAsaltos, type ParteAsaltosComplementarios } from '../../src/lib/ingest/asaltos-complementarios';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { parsearDirectaFww, parsearPoulesFww } from '../../src/lib/ingest/sources/fww-asaltos';
import { FWW_BASE, parsearResultadosFww, type PaginaFww } from '../../src/lib/ingest/sources/fww';
import { argumento, CARPETA_TRABAJO } from './comun';
import { abrirBase, pruebasFieIndividuales, puestosDeBase, type PruebaBase } from './fie-completar-comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { CARPETA_LOTE7, enCache, obtener, SALIDA_LOTE7, sha256, texto } from './lote7-fie-red';

export const BASE_LOTE7 = join(CARPETA_TRABAJO, 'nuevo7.sqlite');
export const HOY = '2026-10-06';
const MANIFIESTO = join(CARPETA_LOTE7, 'fww-manifiesto.json');
const INFORME = join(CARPETA_LOTE7, 'fww-informe.json');

// ---------------------------------------------------------------------------
// Objetivos
// ---------------------------------------------------------------------------

/** Pruebas celebradas con clasificación a las que les falta una fase entera (los JJOO no tienen poules). */
export function objetivos(db: ReturnType<typeof abrirBase>): PruebaBase[] {
  return pruebasFieIndividuales(db, 2017).filter((p) => {
    const fecha = p.date ?? p.startDate;
    if (!fecha || fecha >= HOY || p.resultados === 0) return false;
    const olimpicos = /juegos_olimpicos/.test(p.tournamentKey);
    return (p.poule === 0 && !olimpicos) || p.tableau === 0;
  });
}

export type Edicion = { clave: string; season: string; nombre: string; pais: string | null; tbd: boolean; desde: string; hasta: string; pruebas: PruebaBase[] };

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);
const fecha = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

export function ediciones(pruebas: PruebaBase[]): Edicion[] {
  const m = new Map<string, PruebaBase[]>();
  for (const p of pruebas) {
    const k = `${p.season}|${p.editionName.trim()}|${p.city ?? ''}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(p);
  }
  return [...m].map(([clave, ps]) => {
    const fechas = ps.map((p) => (p.date ?? p.startDate)!).sort();
    const tbd = ps.some((p) => !p.city || /^TBD$/i.test(p.city.trim()) || p.countryCode === 'FIE');
    const margen = tbd ? 25 : 4;
    return {
      clave, season: ps[0].season, nombre: ps[0].editionName.trim(), pais: tbd ? null : ps[0].countryCode, tbd,
      desde: fecha(dia(fechas[0]) - margen), hasta: fecha(dia(fechas[fechas.length - 1]) + margen), pruebas: ps,
    };
  });
}

// ---------------------------------------------------------------------------
// Archivo y torneos de FWW
// ---------------------------------------------------------------------------

export type TorneoFww = { ruta: string; desde: string; hasta: string; nombre: string; pais: string | null; ciudad: string };

const plano = (s: string) => s.replace(/\s+/g, ' ').trim();
const aIso = (dmy: string) => {
  const [d, m, a] = dmy.split('.');
  return `${a}-${m}-${d}`;
};

export function parsearArchivoFww(html: string): TorneoFww[] {
  const $ = cheerio.load(html);
  const salida: TorneoFww[] = [];
  $('tr').each((_, tr) => {
    const td = $(tr).children('td');
    const enlace = $(tr).find('a[href*="/tournament/"]').first();
    const ruta = /^\/[a-z]{2}\/(\d+-\d{2,4})\/tournament\/?$/.exec(enlace.attr('href') ?? '')?.[1];
    const fechas = /(\d\d\.\d\d\.\d{4})\s*-\s*(\d\d\.\d\d\.\d{4})/.exec(td.text());
    if (!ruta || !fechas) return;
    const pais = td.toArray().map((x) => plano($(x).text())).find((t) => /^[A-Z]{3}$/.test(t)) ?? null;
    const iPais = td.toArray().findIndex((x) => /^[A-Z]{3}$/.test(plano($(x).text())));
    salida.push({
      ruta, desde: aIso(fechas[1]), hasta: aIso(fechas[2]), nombre: plano(enlace.text()), pais,
      ciudad: iPais >= 0 ? plano(td.eq(iPais + 1).text()) : '',
    });
  });
  return salida;
}

/** Pruebas (`<id>-<temporada>`) enlazadas desde la página de un torneo. */
export function pruebasDeTorneoFww(html: string): string[] {
  const rutas = new Set<string>();
  for (const m of html.matchAll(/href="\/[a-z]{2}\/(\d+-\d{2,4})\/global\/"/g)) rutas.add(m[1]);
  return [...rutas];
}

/** Destinos `pools/N` y `direct/N` que ofrece el menú de una prueba. */
export function destinosDePruebaFww(html: string, ruta: string): string[] {
  const d = new Set<string>();
  const re = new RegExp(`href="/[a-z]{2}/${ruta}/((?:pools|direct)/\\d{1,2})"`, 'g');
  for (const m of html.matchAll(re)) d.add(m[1]);
  return [...d].sort((a, b) => Number(a.split('/')[1]) - Number(b.split('/')[1]));
}

/** Nombre de torneo compatible con la edición FIE cuando la FIE no da sede (TBD). */
const TITULOS: [RegExp, RegExp][] = [
  [/Europe.*Cadet|Cadet.*Europe/i, /Europ/i],
  [/asiatiques cadets|Asian Cadet/i, /Asia/i],
  [/Afrique|Africa/i, /Afri/i],
  [/Panam|Pan.?Am/i, /Pan.?Am|Panam/i],
  [/M[ée]diterran/i, /Medit/i],
  [/Commonwealth/i, /Commonwealth/i],
  [/Universi|FISU/i, /Universi|FISU/i],
];

export function torneoCompatible(e: Edicion, t: TorneoFww): boolean {
  if (t.hasta < e.desde || t.desde > e.hasta) return false;
  if (e.pais) return t.pais === e.pais;
  return TITULOS.some(([fie, fww]) => fie.test(e.nombre) && fww.test(t.nombre));
}

export type ManifiestoFww = {
  torneos: { edicion: string; torneo: TorneoFww; pruebas: { ruta: string; destinos: string[] }[] }[];
};
type Manifiesto = ManifiestoFww;

export const urlFww = (ruta: string, resto: string) => `${FWW_BASE}/en/${ruta}/${resto}`;
const url = urlFww;

async function descargar() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const eds = ediciones(objetivos(db));
  db.close();
  await descargarFww(eds, MANIFIESTO);
}

/** Torneos FWW de las ediciones, con clasificación, poules y cuadro de cada prueba compatible en caché. */
export async function descargarFww(eds: Edicion[], rutaManifiesto: string) {
  console.log(`${eds.length} ediciones objetivo`);
  const anios = [...new Set(eds.flatMap((e) => [e.desde.slice(0, 4), e.hasta.slice(0, 4)]))].sort();
  const archivo: TorneoFww[] = [];
  for (const a of anios) {
    const d = await obtener(`${FWW_BASE}/en/archive/${a}`);
    const t = parsearArchivoFww(texto(d) ?? '');
    console.log(`archivo ${a}: HTTP ${d.status}, ${t.length} torneos`);
    archivo.push(...t);
  }
  const man: Manifiesto = { torneos: [] };
  for (const e of eds) {
    const ts = archivo.filter((t) => torneoCompatible(e, t));
    if (ts.length === 0) {
      console.log(`- ${e.clave}: sin torneo FWW`);
      continue;
    }
    for (const t of ts) {
      const pagina = texto(await obtener(url(t.ruta, 'tournament/')));
      const rutas = pagina ? pruebasDeTorneoFww(pagina) : [];
      console.log(`+ ${e.clave}: ${t.ruta} «${t.nombre}» ${t.pais} ${t.ciudad} ${t.desde}..${t.hasta}: ${rutas.length} pruebas`);
      const pruebas: Manifiesto['torneos'][number]['pruebas'] = [];
      for (const r of rutas) {
        const res = texto(await obtener(url(r, 'results/')));
        const p = res ? parsearResultadosFww(res) : null;
        // La miga de pan no siempre trae la modalidad; las clasificaciones por equipos no casan después por solape.
        if (!p || p.formato === 'EQUIPOS' || !p.hayTabla) continue;
        if (!e.pruebas.some((x) => x.weapon === p.arma && x.gender === p.genero && (p.categoria === null || p.categoria === x.category))) continue;
        const global = texto(await obtener(url(r, 'global/')));
        const destinos = global ? destinosDePruebaFww(global, r) : [];
        for (const d of destinos) await obtener(url(r, d));
        console.log(`    ${r} ${p.arma} ${p.genero} ${p.categoria ?? p.categoriaOriginal} n=${p.filas.length}: ${destinos.join(', ')}`);
        pruebas.push({ ruta: r, destinos });
      }
      man.torneos.push({ edicion: e.clave, torneo: t, pruebas });
    }
  }
  mkdirSync(CARPETA_LOTE7, { recursive: true });
  writeFileSync(rutaManifiesto, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${rutaManifiesto}`);
}

// ---------------------------------------------------------------------------
// Hechos
// ---------------------------------------------------------------------------

type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];

const MAX_POULE = 5;
const MAX_CUADRO = 15;

/** Marcador posible en la fase: ganador con el máximo de la fase o menos y perdedor por debajo. */
export function marcadorValido(fase: 'POULE' | 'TABLEAU', a: number, b: number): boolean {
  const max = fase === 'POULE' ? MAX_POULE : MAX_CUADRO;
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a !== b && Math.max(a, b) <= max;
}

export function rondaCuadro(r: string): string | null {
  if (r === 'SF') return 'A4';
  if (r === 'F') return 'A2';
  const m = /^T(\d+)$/.exec(r);
  return m ? `A${m[1]}` : null;
}

/**
 * Lectura de una prueba FWW: clasificación (ancla de puestos y naciones), poules
 * de cada ronda (`P<n>` la primera, `V2P<n>` la segunda) y cuadro fusionado.
 */
export function leerPruebaFww(paginas: { destino: string; html: string }[], resultados: PaginaFww): Lectura {
  const porId = new Map<string, { nombre: string; pais: string | null }>();
  for (const f of resultados.filas) if (f.fwwId) porId.set(f.fwwId, { nombre: f.nombre, pais: f.nacion && /^[A-Z]{3}$/.test(f.nacion) ? f.nacion : null });
  // Sin ficha enlazada, la nación sale de la fila de la clasificación con el mismo nombre, si es única.
  const porNombre = new Map<string, string | null>();
  for (const f of resultados.filas) {
    const n = normalizeSportName(f.nombre);
    const pais = f.nacion && /^[A-Z]{3}$/.test(f.nacion) ? f.nacion : null;
    porNombre.set(n, porNombre.has(n) && porNombre.get(n) !== pais ? null : pais);
  }
  const tirador = (ref: string, nombre: string) => {
    const id = /^fww:athlete:(\d+)$/.exec(ref)?.[1];
    const r = id ? porId.get(id) : undefined;
    return { nombre: r?.nombre ?? nombre, pais: r?.pais ?? porNombre.get(normalizeSportName(nombre)) ?? null };
  };
  const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);
  const excluidos = (p: ParteAsaltosComplementarios, d: Record<string, number>) => {
    for (const [k, n] of Object.entries(p.excluidos)) if (n && k !== 'bye') sumar(d, k, n);
    if (p.conflictos.length) sumar(d, 'conflicto', p.conflictos.length);
  };

  const rondasPoule = paginas.filter((p) => p.destino.startsWith('pools/'));
  let poules: Lectura['poules'] = null;
  rondasPoule.forEach((pg, i) => {
    const parte = parsearPoulesFww(pg.html, Number(pg.destino.split('/')[1]), { refPorNombre: true });
    if (parte.publicado === 0 && parte.asaltos.length === 0) return;
    poules ??= { bouts: [], esperados: 0, descartados: {} };
    const prefijo = i === 0 ? 'P' : `V${i + 1}P`;
    poules.esperados += parte.publicado;
    excluidos(parte, poules.descartados);
    if (!parte.completo && parte.asaltos.length === parte.publicado) sumar(poules.descartados, 'poule_ilegible');
    for (const b of parte.asaltos) {
      if (!marcadorValido('POULE', b.puntosA, b.puntosB)) {
        sumar(poules.descartados, 'marcador_fuera_de_rango');
        continue;
      }
      poules.bouts.push({
        phase: 'POULE', roundKey: b.ronda.replace(/^R\d+P/, prefijo), a: tirador(b.refA, b.nombreA), b: tirador(b.refB, b.nombreB),
        scoreA: b.puntosA, scoreB: b.puntosB, winner: null,
      } satisfies BoutLeido);
    }
  });

  let cuadro: Lectura['cuadro'] = null;
  const directas = paginas.filter((p) => p.destino.startsWith('direct/'));
  if (directas.length > 0) {
    const fusion = new FusionAsaltos();
    for (const pg of directas) fusion.anadir(parsearDirectaFww(pg.html, { refPorNombre: true }), pg.destino);
    const parte = fusion.resumen(true);
    if (parte.publicado > 0) {
      const descartados: Record<string, number> = {};
      excluidos(parte, descartados);
      const bouts: BoutLeido[] = [];
      for (const b of parte.asaltos) {
        const ronda = rondaCuadro(b.ronda);
        if (!ronda) {
          sumar(descartados, 'ronda_no_regular');
          continue;
        }
        if (!marcadorValido('TABLEAU', b.puntosA, b.puntosB)) {
          sumar(descartados, 'marcador_fuera_de_rango');
          continue;
        }
        bouts.push({ phase: 'TABLEAU', roundKey: ronda, a: tirador(b.refA, b.nombreA), b: tirador(b.refB, b.nombreB), scoreA: b.puntosA, scoreB: b.puntosB, winner: null });
      }
      cuadro = { bouts, esperados: parte.publicado, completo: parte.completo, descartados };
    }
  }

  const puestos = resultados.filas
    .filter((f) => f.puesto !== null)
    .map((f) => ({ t: { nombre: f.nombre, pais: f.nacion && /^[A-Z]{3}$/.test(f.nacion) ? f.nacion : null }, puesto: f.puesto! }));
  return { arma: resultados.arma, genero: resultados.genero, puestos, poules, cuadro };
}

/**
 * Deja en el fichero sólo las fases que la base no tiene; una fase sin asaltos
 * queda `parcial` con 0 filas, que el cargador se salta.
 */
export function soloFasesQueFaltan(h: HechosPrueba, p: Pick<PruebaBase, 'poule' | 'tableau'>): HechosPrueba {
  const pools = p.poule === 0;
  const tableau = p.tableau === 0;
  const bouts = h.bouts.filter((b) => (b.phase === 'POULE' ? pools : tableau));
  const estado = (fase: 'POULE' | 'TABLEAU', permitida: boolean, actual: HechosPrueba['status']['pools']) =>
    permitida && bouts.some((b) => b.phase === fase) ? actual : 'parcial';
  return hechosPrueba.parse({
    ...h,
    status: { ...h.status, pools: estado('POULE', pools, h.status.pools), tableau: estado('TABLEAU', tableau, h.status.tableau) },
    bouts,
  });
}

type InformeFww = {
  season: string; competitionKey: string; edicion: string; prueba: string | null; motivo: string | null;
  pools?: { importados: number; esperados: number; estado: string; descartados: Record<string, number> };
  tableau?: { importados: number; esperados: number; estado: string; descartados: Record<string, number> };
  sinCasar?: string[];
};

function hechos() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const eds = ediciones(objetivos(db));
  const informe: InformeFww[] = [];
  let escritos = 0;
  for (const e of eds) {
    const torneos = man.torneos.filter((t) => t.edicion === e.clave);
    const candidatas = torneos.flatMap((t) => t.pruebas.map((p) => {
      const res = texto(enCache(url(p.ruta, 'results/')));
      return { torneo: t.torneo, ruta: p.ruta, destinos: p.destinos, resultados: res ? parsearResultadosFww(res) : null };
    })).filter((c) => c.resultados?.hayTabla);
    for (const p of e.pruebas) {
      const base = { season: p.season, competitionKey: p.competitionKey, edicion: e.clave };
      if (torneos.length === 0) {
        informe.push({ ...base, prueba: null, motivo: 'sin torneo en el archivo de FWW' });
        continue;
      }
      const puestos = puestosDeBase(db, p.id);
      const compatibles = candidatas
        .filter((c) => c.resultados!.arma === p.weapon && c.resultados!.genero === p.gender &&
          (c.resultados!.categoria === null || c.resultados!.categoria === p.category))
        .map((c) => ({ c, s: solape(puestos, c.resultados!.filas.map((f) => ({ nombre: f.nombre, pais: f.nacion }))) }))
        .sort((x, y) => y.s - x.s);
      const mejor = compatibles[0];
      if (!mejor || mejor.s < 0.5 || (compatibles[1] && compatibles[1].s > mejor.s - 0.15)) {
        informe.push({ ...base, prueba: mejor?.c.ruta ?? null, motivo: !mejor ? 'sin prueba FWW compatible' : `solape insuficiente o ambiguo (${compatibles.slice(0, 2).map((x) => x.s.toFixed(2)).join(' / ')})` });
        continue;
      }
      const c = mejor.c;
      const paginas: { destino: string; html: string; sha: string }[] = [];
      for (const d of c.destinos) {
        const doc = enCache(url(c.ruta, d));
        const html = texto(doc);
        if (html && doc?.sha256) paginas.push({ destino: d, html, sha: doc.sha256 });
      }
      const lectura = leerPruebaFww(paginas, c.resultados!);
      if (!lectura.poules && !lectura.cuadro) {
        informe.push({ ...base, prueba: c.ruta, motivo: `FWW no publica asaltos (${c.destinos.join(', ') || 'sin destinos'})` });
        continue;
      }
      const h0 = hechosBase(p, puestos);
      const fuenteUrl = url(c.ruta, 'results/');
      const r = anadirAsaltos(h0, lectura, {
        nombre: 'fww', url: fuenteUrl,
        descripcion: `poules y cuadro publicados en Fencing Worldwide (Ophardt), torneo ${c.torneo.ruta} «${c.torneo.nombre}» (${c.torneo.pais ?? '?'} ${c.torneo.ciudad}), prueba ${c.ruta}`,
      });
      const h = soloFasesQueFaltan(hechosPrueba.parse({
        ...r.hechos,
        extractor: 'lote7_fww',
        sourceUrl: fuenteUrl,
        sourceSha256: sha256(paginas.map((x) => x.sha).join('|')),
      }), p);
      const entrada: InformeFww = {
        ...base, prueba: c.ruta, motivo: null,
        pools: { importados: h.bouts.filter((b) => b.phase === 'POULE').length, esperados: r.informe.pools.esperados, estado: h.status.pools, descartados: r.informe.pools.descartados },
        tableau: { importados: h.bouts.filter((b) => b.phase === 'TABLEAU').length, esperados: r.informe.tableau.esperados, estado: h.status.tableau, descartados: r.informe.tableau.descartados },
        sinCasar: r.informe.tiradores.sinCasar,
      };
      if (h.bouts.length === 0) {
        informe.push({ ...entrada, motivo: 'ningún asalto válido de una fase que falte' });
        continue;
      }
      writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
      escritos += 1;
      informe.push(entrada);
    }
  }
  db.close();
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, pruebas: informe }, null, 1)}\n`);
  for (const i of informe) {
    if (i.motivo) console.log(`${i.season} ${i.competitionKey} [${i.edicion}]: ${i.motivo}`);
    else console.log(`${i.season} ${i.competitionKey} ${i.prueba}: poules ${i.pools!.importados}/${i.pools!.esperados} ${i.pools!.estado} ${JSON.stringify(i.pools!.descartados)}; cuadro ${i.tableau!.importados}/${i.tableau!.esperados} ${i.tableau!.estado} ${JSON.stringify(i.tableau!.descartados)}${i.sinCasar?.length ? `; sin casar: ${i.sinCasar.join('; ')}` : ''}`);
  }
  console.log(`${escritos} ficheros en ${salida}; informe en ${INFORME}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote7-fie-fww.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
