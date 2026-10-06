/**
 * Poules y cuadro de Engarde para las pruebas `skermo_rfee` (temporada 2021-22 en adelante)
 * que sólo tienen la clasificación.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-skermo-engarde.ts \
 *     [--db <calendario-trabajo/nuevo7.sqlite>] [--desde 2021-08-01] [--hasta 2026-10-06] \
 *     [--salida <calendario-trabajo/hechos/lote7-skermo>] [--pausa-ms 700] [--max 3000] [--sin-red]
 *
 * Skermo sólo publica la clasificación (HTML y un PDF de clasificación); las poules y el cuadro
 * de las pruebas nacionales están en Engarde. Por eso:
 *
 * 1. Huecos: pruebas `skermo_rfee` individuales con puestos y sin poules o sin cuadro. Las de
 *    veteranos se tiran juntas (todas las edades, o 30+40 y 50+60) y Skermo las parte por edad:
 *    si todos los tiradores de un hueco ya tienen asaltos de esa fase en otra prueba del mismo
 *    día y arma (la lectura conjunta que el unificador pegó a una de las edades), el hueco ya
 *    está cubierto y no se vuelve a importar.
 * 2. Torneos de Engarde a ±3 días: las listas de organizadores españoles que dejó en caché
 *    `engarde-historico-descargar.ts` y los directos que el índice de Skermo enlaza en la fila.
 * 3. Por cada prueba individual de Engarde del mismo arma y fecha (±1 día) se leen su página,
 *    clasificación, poules y cuadros (de las cachés de Engarde existentes o de la red, una
 *    petición cada vez con pausa) y se convierte con `convertirPrueba`.
 * 4. Sólo se escribe si es el mismo evento por nombres: cada prueba de Skermo que casa tiene al
 *    menos el 80 % de sus tiradores en la de Engarde, y entre todas cubren al menos el 60 % de
 *    los tiradores de Engarde. Una prueba de veteranos conjunta casa así con todas sus edades.
 * 5. Los marcadores se validan (ganador con más tocados o ganador explícito; poule a 5, cuadro
 *    a 15 como máximo); un asalto que no cuadra se descarta y la fase queda `parcial`.
 *
 * 6. Huecos ya cubiertos por la lectura conjunta de veteranos: la prueba de Engarde del mismo día
 *    se compara asalto a asalto con la base (`asaltoPresente`) y sólo se escribe si trae alguno
 *    que falta. Las de un torneo nacional que no casan por nombres sólo se comprueban.
 *
 * Además de las listas de organizadores españoles, se leen los torneos de todos los organizadores
 * de Engarde que deja `lote7-skermo-torneos.ts` (sólo a ±1 día y descartando pruebas de otro país).
 *
 * Los ficheros salen con fuente `engarde` y la clave de siempre (`engarde:{org}/{evt}/{compe}`),
 * igual que `asaltos-rfee-engarde.ts`: `unificar-personas.ts` los pasa a la prueba nacional.
 * Una prueba que otro productor ya dejó en `hechos/` sólo se omite si sus asaltos ya están en la
 * base; si no, se escribe con la misma clave (el cargador no duplica).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { fixDoubleEncodedUtf8 } from '../../src/lib/ingest/fetcher';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { ENGARDE_BASE, ENGARDE_INDICE, parsearIndiceEngarde, parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { torneosCacheados } from './asaltos-rfee-engarde';
import { cargarPruebasNacionales, nombresEnComun, prepararNombre, type NombrePreparado, type PruebaNacional } from './dedupe-pruebas';
import { categoriaEngarde, convertirPrueba, generoEngarde, temporadaRfee, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { CacheEngarde, CARPETA_ENGARDE, claveCache, enlaceEngarde, formularioIndiceEngarde, paginasDePrueba } from './engarde-descargar';
import { CARPETA_ENGARDE_HISTORICO, fechaTorneoLista, ORGANIZADORES_ES } from './engarde-historico-descargar';
import { CACHE_LOTE7_SKERMO, SALIDA_LOTE7_SKERMO, USER_AGENT_LOTE7 } from './lote7-skermo-comun';
import type { FilaIndice } from './lote7-skermo-indice';
import { leerTorneosGlobales } from './lote7-skermo-torneos';

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Fase = 'POULE' | 'TABLEAU';
const FASES: Fase[] = ['POULE', 'TABLEAU'];

// ------------------------------------------------------------------ huecos

export type HuecoSkermo = PruebaNacional & { faltan: Fase[]; cubiertoEnHermana: boolean };

/**
 * Un hueco está cubierto por una prueba hermana cuando todos sus tiradores tienen asaltos en
 * otras pruebas del mismo día y arma y, por cada fase que le falta, alguno aparece en esa fase.
 */
export function cubiertoPorHermanas(
  hueco: Pick<PruebaNacional, 'nombres'> & { faltan: readonly Fase[] },
  hermanas: readonly { POULE: readonly NombrePreparado[]; TABLEAU: readonly NombrePreparado[] }[],
): boolean {
  if (hueco.nombres.length === 0 || hermanas.length === 0) return false;
  const todos = hermanas.flatMap((h) => [...h.POULE, ...h.TABLEAU]);
  if (nombresEnComun(hueco.nombres, todos) < hueco.nombres.length) return false;
  return hueco.faltan.every((f) => nombresEnComun(hueco.nombres, hermanas.flatMap((h) => h[f])) > 0);
}

function nombresDeAsaltos(db: DatabaseSync, desde: string): Map<string, Record<Fase, NombrePreparado[]>> {
  const out = new Map<string, Record<Fase, NombrePreparado[]>>();
  const vistos = new Map<string, Set<string>>();
  const filas = db.prepare(
    `SELECT b.competition_id c, b.phase f, b.fencer_a_name a, b.fencer_b_name bn FROM sport_bout b
       JOIN sport_competition c ON c.id = b.competition_id JOIN sport_edition e ON e.id = c.edition_id
      WHERE coalesce(c.competition_date, e.start_date) >= ?`,
  ).iterate(desde) as Iterable<{ c: string; f: Fase; a: string; bn: string }>;
  for (const b of filas) {
    const r = out.get(b.c) ?? { POULE: [], TABLEAU: [] };
    out.set(b.c, r);
    const v = vistos.get(b.c) ?? new Set<string>();
    vistos.set(b.c, v);
    for (const n of [b.a, b.bn]) {
      const p = prepararNombre(n);
      const k = `${b.f}|${p.norm}`;
      if (!p.norm || v.has(k)) continue;
      v.add(k);
      r[b.f].push(p);
    }
  }
  return out;
}

export function huecosSkermo(db: DatabaseSync, pruebas: readonly PruebaNacional[], desde: string, hasta: string): HuecoSkermo[] {
  const fechaDe = new Map<string, { id: string; weapon: string; fecha: string }>();
  for (const r of db.prepare(
    `SELECT c.id, c.weapon, coalesce(c.competition_date, e.start_date) fecha FROM sport_competition c
       JOIN sport_edition e ON e.id = c.edition_id WHERE coalesce(c.competition_date, e.start_date) >= ?`,
  ).all(desde) as { id: string; weapon: string; fecha: string }[]) fechaDe.set(r.id, r);
  const asaltos = nombresDeAsaltos(db, desde);
  const conAsaltos = [...asaltos.keys()].map((id) => fechaDe.get(id)).filter((x): x is { id: string; weapon: string; fecha: string } => !!x?.fecha);
  const out: HuecoSkermo[] = [];
  for (const p of pruebas) {
    if (p.source !== 'skermo_rfee' || p.resultados === 0 || p.fecha < desde || p.fecha >= hasta) continue;
    const faltan = FASES.filter((f) => p.asaltos[f] === 0);
    if (faltan.length === 0) continue;
    const hermanas = conAsaltos
      .filter((c) => c.id !== p.id && c.weapon === p.weapon && Math.abs(dia(c.fecha) - dia(p.fecha)) <= 1)
      .map((c) => asaltos.get(c.id)!);
    out.push({ ...p, faltan, cubiertoEnHermana: cubiertoPorHermanas({ nombres: p.nombres, faltan }, hermanas) });
  }
  return out;
}

// --------------------------------------------------------- validación de marcadores

/** Asalto con marcador coherente: ganador determinable y con más tocados, poule ≤ 5, cuadro ≤ 15. */
export function asaltoValido(b: Pick<AsaltoHecho, 'phase' | 'scoreA' | 'scoreB' | 'winner'>): boolean {
  const max = b.phase === 'POULE' ? 5 : 15;
  if (b.scoreA > max || b.scoreB > max) return false;
  if (b.winner === null) return b.scoreA !== b.scoreB;
  return b.winner === 'A' ? b.scoreA >= b.scoreB : b.scoreB >= b.scoreA;
}

export function validarMarcadores(h: HechosPrueba): { hechos: HechosPrueba; descartados: Record<Fase, number> } {
  const descartados: Record<Fase, number> = { POULE: 0, TABLEAU: 0 };
  const bouts = h.bouts.filter((b) => {
    if (asaltoValido(b)) return true;
    descartados[b.phase] += 1;
    return false;
  });
  const status = { ...h.status, notes: [...h.status.notes] };
  for (const f of FASES) {
    if (descartados[f] === 0) continue;
    const clave = f === 'POULE' ? 'pools' : 'tableau';
    const quedan = bouts.some((b) => b.phase === f);
    status[clave] = quedan ? 'parcial' : 'ilegible';
    status.notes.push(`${f === 'POULE' ? 'Poules' : 'Cuadro'}: ${descartados[f]} asalto(s) descartado(s) por marcador incoherente`);
  }
  return { hechos: hechosPrueba.parse({ ...h, status, bouts }), descartados };
}

// ------------------------------------------------------------------ emparejado

function nombresDeHechos(h: HechosPrueba): NombrePreparado[] {
  const vistos = new Set<string>();
  const out: NombrePreparado[] = [];
  const fuente = h.results.length > 0 ? h.results.map((r) => r.name) : h.bouts.flatMap((b) => [b.aName, b.bName]);
  for (const n of fuente) {
    const p = prepararNombre(n);
    if (!p.norm || vistos.has(p.norm)) continue;
    vistos.add(p.norm);
    out.push(p);
  }
  return out;
}

/** Mayor fracción de tiradores de un hueco cuyas palabras del nombre salen todas en el HTML. */
export function prefiltroNombres(html: string, huecos: readonly Pick<PruebaNacional, 'nombres'>[]): number {
  const texto = fixDoubleEncodedUtf8(cheerio.load(html.replace(/</g, ' <')).text());
  const palabras = new Set(prepararNombre(texto).palabras);
  let mejor = 0;
  for (const h of huecos) {
    if (h.nombres.length === 0) continue;
    // Se tolera una palabra que no esté (erratas, segundo apellido omitido).
    const presentes = h.nombres.filter((n) => n.palabras.length > 0 && n.palabras.filter((w) => palabras.has(w)).length >= Math.max(1, n.palabras.length - 1)).length;
    mejor = Math.max(mejor, presentes / h.nombres.length);
  }
  return mejor;
}

export type Casamiento = { casan: PruebaNacional[]; cobertura: number };

/**
 * Pruebas de Skermo que son esta prueba de Engarde: cada una con al menos el 80 % de sus
 * tiradores en Engarde y, entre todas, al menos el 60 % de los tiradores de Engarde.
 */
export function casarConSkermo(
  e: { weapon: string; gender: string; fecha: string; nombres: readonly NombrePreparado[] },
  skermo: readonly PruebaNacional[],
): Casamiento {
  if (e.nombres.length === 0) return { casan: [], cobertura: 0 };
  const casan = skermo.filter((s) => {
    if (s.source !== 'skermo_rfee' || s.weapon !== e.weapon || s.nombres.length === 0) return false;
    if (e.gender !== 'MIXTO' && s.gender !== 'MIXTO' && s.gender !== e.gender) return false;
    if (Math.abs(dia(s.fecha) - dia(e.fecha)) > 1) return false;
    return nombresEnComun(s.nombres, e.nombres) >= Math.max(1, Math.ceil(0.8 * s.nombres.length));
  });
  const union = casan.flatMap((s) => s.nombres);
  const cobertura = casan.length ? nombresEnComun(e.nombres, union) / e.nombres.length : 0;
  // Un TNR abierto a extranjeros: Skermo sólo clasifica a los licenciados, que están todos en la
  // prueba de Engarde, pero son menos del 60 % de sus tiradores.
  const contenida = casan.some((s) => s.nombres.length >= 10 && nombresEnComun(s.nombres, e.nombres) >= Math.ceil(0.95 * s.nombres.length));
  return cobertura >= 0.6 || (contenida && cobertura >= 0.3) ? { casan, cobertura } : { casan: [], cobertura };
}

/**
 * Engarde etiqueta a veces mal la categoría en el índice (una prueba «sfv60_70» marcada
 * `cadet`). Si todas las pruebas de Skermo que casan por nombres tienen otra categoría, se toma
 * esa, para que el unificador la empareje; el texto original queda en `categoryRaw` y en notas.
 */
export function conCategoriaDeSkermo(h: HechosPrueba, casan: readonly Pick<PruebaNacional, 'category'>[]): HechosPrueba {
  const cats = new Set(casan.map((s) => s.category));
  if (cats.size !== 1) return h;
  const cat = [...cats][0];
  if (cat === h.competition.category) return h;
  return hechosPrueba.parse({
    ...h,
    competition: { ...h.competition, category: cat },
    status: {
      ...h.status,
      notes: [...h.status.notes, `Engarde publica la categoría ${h.competition.category} («${h.competition.categoryRaw ?? ''}»); se toma ${cat}, la de las pruebas de Skermo que casan por nombres`],
    },
  });
}

/**
 * En los TLM las pocas tiradoras de florete se tiran en la prueba «Florete mixto 30-40», que
 * el índice de Engarde marca con sexo masculino. El título manda.
 */
export function generoPrueba(p: Parameters<typeof generoEngarde>[0] & { titulo: string }, sexe: string | null): PruebaIndice['generoFinal'] {
  if (/\b(mixt[oae]?s?|mixed)\b/i.test(p.titulo.normalize('NFD').replace(/\p{Diacritic}/gu, ''))) return 'MIXTO';
  return generoEngarde(p, sexe);
}

// --------------------------------------------------------- verificación de veteranos

export type AsaltoBd = { dia: number; phase: Fase; a: string; sa: number; b: string; sb: number };

const primeraPalabra = (n: string) => prepararNombre(n).palabras[0] ?? '';
/** Primera palabra igual o con los mismos cuatro primeros caracteres (erratas al final del apellido). */
const mismaPalabra = (x: string, y: string) => x === y || (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4));

/**
 * Asalto ya presente: misma fase, mismos tocados por lado y la primera palabra del nombre de
 * al menos uno de los dos tiradores. Tolera que la lectura de la base venga de un PDF con el
 * otro nombre recortado o con una errata («CALCARA»/«CALCARRA»).
 */
export function asaltoPresente(
  b: Pick<AsaltoHecho, 'phase' | 'aName' | 'bName' | 'scoreA' | 'scoreB'>,
  lista: readonly Omit<AsaltoBd, 'dia'>[],
): boolean {
  const wa = primeraPalabra(b.aName);
  const wb = primeraPalabra(b.bName);
  return lista.some((x) => x.phase === b.phase && (
    (x.sa === b.scoreA && x.sb === b.scoreB && mismaPalabra(x.a, wa) && mismaPalabra(x.b, wb)) ||
    (x.sa === b.scoreB && x.sb === b.scoreA && mismaPalabra(x.a, wb) && mismaPalabra(x.b, wa))
  ));
}

/** Asaltos de la base por arma (con el día de la prueba), para comprobar lecturas conjuntas. */
function asaltosParaVerificar(db: DatabaseSync, desde: string): Map<string, AsaltoBd[]> {
  const out = new Map<string, AsaltoBd[]>();
  const filas = db.prepare(
    `SELECT c.weapon w, coalesce(c.competition_date, e.start_date) f, b.phase p, b.fencer_a_name a, b.score_a sa, b.fencer_b_name bn, b.score_b sb
       FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id JOIN sport_edition e ON e.id = c.edition_id
      WHERE coalesce(c.competition_date, e.start_date) >= ?`,
  ).iterate(desde) as Iterable<{ w: string; f: string; p: Fase; a: string; sa: number; bn: string; sb: number }>;
  for (const r of filas) {
    const lista = out.get(r.w) ?? [];
    out.set(r.w, lista);
    lista.push({ dia: dia(r.f), phase: r.p, a: primeraPalabra(r.a), sa: r.sa, b: primeraPalabra(r.bn), sb: r.sb });
  }
  return out;
}

// ------------------------------------------------------------------ red

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
            'User-Agent': USER_AGENT_LOTE7,
            Accept: formulario ? 'application/xml' : 'text/html',
            ...(formulario ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: formulario ? new URLSearchParams(formulario).toString() : undefined,
          signal: AbortSignal.timeout(45_000),
          redirect: 'follow',
        });
        const body = await res.text();
        if ((res.status === 429 || res.status >= 500) && intento < 3) {
          await esperar(5000 * intento);
          continue;
        }
        return { status: res.status, body };
      } catch (e) {
        if (intento >= 3) return { status: -1, body: String(e) };
        await esperar(5000 * intento);
      }
    }
  }
}

/** Ficheros de hechos que otros productores ya dejaron (para no duplicar una prueba de Engarde). */
function ficherosAjenos(raiz: string, propia: string): Set<string> {
  const out = new Set<string>();
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const ruta = join(d, e.name);
      if (e.isDirectory()) {
        if (resolve(ruta) !== resolve(propia)) recorrer(ruta);
      } else if (e.name.endsWith('.json')) out.add(e.name);
    }
  };
  if (existsSync(raiz)) recorrer(raiz);
  return out;
}

// ------------------------------------------------------------------ principal

export type InformeLote7Skermo = {
  huecos: number;
  cubiertosEnHermana: number;
  huecosPendientes: number;
  torneosCandidatos: number;
  torneosConIndice: number;
  pruebasLeidas: number;
  ficheros: number;
  huecosCompletados: number;
  asaltos: Record<Fase, number>;
  descartadosPorMarcador: Record<Fase, number>;
  descartes: Record<string, number>;
  descartesDetalle: { prueba: string; motivo: string }[];
  peticiones: number;
  escritos: { fichero: string; prueba: string; casan: string[]; cobertura: number; asaltos: Record<Fase, number> }[];
  cubiertosPorOtroProductor: { clave: string; fichero: string }[];
  reescritosDeOtro: { fichero: string; enBd: number; asaltos: number }[];
  verificacionVeteranos: {
    comparadas: number;
    asaltosComparados: number;
    escritas: { prueba: string; hermanas: string[]; asaltos: number; faltan: Record<Fase, number> }[];
    conFaltantesDeOtro: { prueba: string; fichero: string; faltan: number }[];
    huecosVerificados: number;
    sinCasarEnTorneoNacional: { prueba: string; asaltos: number; faltan: number }[];
    sinLecturaEngarde: string[];
  };
  sinFuente: { id: string; clave: string; fecha: string; arma: string; genero: string; categoria: string; resultados: number; faltan: Fase[]; motivo: string }[];
};

async function main(): Promise<void> {
  const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo7.sqlite'));
  const desde = argumento('desde', '2021-08-01');
  const hasta = argumento('hasta', '2026-10-06');
  const salida = argumento('salida', SALIDA_LOTE7_SKERMO);
  const red = new Red(Math.max(500, Number(argumento('pausa-ms', '700'))), Number(argumento('max', '3000')), !bandera('sin-red'));

  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const pruebas = cargarPruebasNacionales(db, desde);
  const huecos = huecosSkermo(db, pruebas, desde, hasta);
  const asaltosBd = asaltosParaVerificar(db, desde);
  const clavesEnBd = new Set((db.prepare(`SELECT competition_key k FROM sport_competition WHERE source = 'engarde'`).all() as { k: string }[]).map((r) => r.k));
  db.close();
  const pendientes = huecos.filter((h) => !h.cubiertoEnHermana);
  const skermo = pruebas.filter((p) => p.source === 'skermo_rfee');

  const propia = new CacheEngarde(join(CACHE_LOTE7_SKERMO, 'engarde'));
  const ajenas = [CARPETA_ENGARDE, CARPETA_ENGARDE_HISTORICO, join(CARPETA_TRABAJO, 'cache-asaltos-rfee', 'engarde')]
    .filter((c) => existsSync(join(c, 'raw')))
    .map((c) => new CacheEngarde(c));
  const leer = (clave: string) => {
    for (const c of [propia, ...ajenas]) {
      const r = c.obtener(clave);
      if (r && (r.status === 200 || r.status === 404)) return { hay: true, cuerpo: c.leer(clave) };
    }
    return { hay: false, cuerpo: null as string | null };
  };
  const traer = async (clave: string, url: string, formulario?: Record<string, string>) => {
    const previo = leer(clave);
    if (previo.hay) return previo.cuerpo;
    if (!red.disponible()) return null;
    const r = await red.pedir(url, formulario);
    if (r.status === -1) return null;
    propia.guardar(clave, url, r.status, r.body);
    return r.status === 200 ? r.body : null;
  };

  // Torneos: listas cacheadas de organizadores y directos enlazados desde el índice de Skermo.
  const historico = ajenas.find((c) => c.raw.startsWith(CARPETA_ENGARDE_HISTORICO));
  const torneos = new Map<string, { org: string; evt: string; fecha: string; titulo: string | null; global?: boolean }>();
  for (const t of historico ? torneosCacheados(historico, ORGANIZADORES_ES) : []) {
    torneos.set(`${t.Organisme.toLowerCase()}/${t.Event}`, { org: t.Organisme.toLowerCase(), evt: t.Event, fecha: t.fecha, titulo: t.Titre ?? null });
  }
  for (const t of leerTorneosGlobales()) {
    const k = `${t.org}/${t.evt}`;
    if (!torneos.has(k)) torneos.set(k, { org: t.org, evt: t.evt, fecha: t.fecha, titulo: t.titulo || null, global: true });
  }
  const rutaIndice = join(CACHE_LOTE7_SKERMO, 'indice.json');
  const directosPorPrueba = new Map<string, string[]>();
  if (existsSync(rutaIndice)) {
    const filas = JSON.parse(readFileSync(rutaIndice, 'utf8')) as FilaIndice[];
    for (const f of filas) {
      if (!f.competitionId || !f.date) continue;
      for (const l of f.liveLinks) {
        const e = enlaceEngarde(l.url);
        if (e.tipo !== 'torneo') continue;
        const k = `${e.org}/${e.evt}`;
        if (!torneos.has(k)) torneos.set(k, { org: e.org, evt: e.evt, fecha: f.date, titulo: null });
        const lista = directosPorPrueba.get(`RFEE:${f.competitionId}`) ?? [];
        lista.push(k);
        directosPorPrueba.set(`RFEE:${f.competitionId}`, lista);
      }
    }
  }

  const candidatos = new Map<string, { org: string; evt: string; fecha: string; titulo: string | null; huecos: HuecoSkermo[] }>();
  for (const h of huecos) {
    const enlazados = new Set(directosPorPrueba.get(h.competition_key) ?? []);
    for (const [k, t] of torneos) {
      // La lista mundial trae cientos de torneos extranjeros por fin de semana: sólo el mismo día ±1.
      if (!enlazados.has(k) && Math.abs(dia(t.fecha) - dia(h.fecha)) > (t.global ? 1 : 3)) continue;
      const c = candidatos.get(k) ?? { ...t, huecos: [] };
      c.huecos.push(h);
      candidatos.set(k, c);
    }
  }

  const inf: InformeLote7Skermo = {
    huecos: huecos.length, cubiertosEnHermana: huecos.length - pendientes.length, huecosPendientes: pendientes.length,
    torneosCandidatos: candidatos.size, torneosConIndice: 0, pruebasLeidas: 0, ficheros: 0, huecosCompletados: 0,
    asaltos: { POULE: 0, TABLEAU: 0 }, descartadosPorMarcador: { POULE: 0, TABLEAU: 0 }, descartes: {}, descartesDetalle: [], peticiones: 0, escritos: [], cubiertosPorOtroProductor: [], reescritosDeOtro: [],
    verificacionVeteranos: { comparadas: 0, asaltosComparados: 0, escritas: [], conFaltantesDeOtro: [], huecosVerificados: 0, sinCasarEnTorneoNacional: [], sinLecturaEngarde: [] }, sinFuente: [],
  };
  const descartar = (m: string, p?: Pick<PruebaIndice, 'org' | 'evt' | 'compe'>) => {
    inf.descartes[m] = (inf.descartes[m] ?? 0) + 1;
    if (p) inf.descartesDetalle.push({ prueba: `${p.org}/${p.evt}/${p.compe}`, motivo: m });
  };
  const ajenos = ficherosAjenos(join(CARPETA_TRABAJO, 'hechos'), salida);
  mkdirSync(salida, { recursive: true });
  const escritos = new Set<string>();
  const completados = new Set<string>();
  const cubiertosPorOtro = new Map<string, string>();
  const verificados = new Set<string>();
  const vistosEnEngarde = new Set<string>();

  for (const c of [...candidatos.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    const { org, evt } = c;
    const pruebasIndice: PruebaIndice[] = [];
    for (let n = 1, total = 1; n <= Math.min(total, 25); n += 1) {
      const xml = await traer(claveCache(org, evt, null, `indice-p${n}.xml`), ENGARDE_INDICE, formularioIndiceEngarde(org, evt, n));
      if (xml === null) break;
      const indice = parsearIndiceEngarde(xml);
      if (!indice.ok) break;
      total = indice.paginas;
      const sexes = new Map<string, string>();
      for (const m of xml.matchAll(/<comp\b[^>]*\bcompe="([^"]+)"[^>]*>/g)) {
        const s = m[0].match(/\bsexe="([^"]*)"/)?.[1];
        if (s !== undefined) sexes.set(m[1], s);
      }
      for (const p of indice.pruebas) {
        if (pruebasIndice.some((q) => q.compe === p.compe)) continue;
        const sexe = sexes.get(p.compe) ?? null;
        pruebasIndice.push({ ...p, sexe, generoFinal: generoPrueba(p, sexe), categoriaFinal: categoriaEngarde(p.categoriaOriginal, p.titulo) });
      }
    }
    if (pruebasIndice.length === 0) {
      descartar('torneo_sin_indice');
      continue;
    }
    inf.torneosConIndice += 1;
    const torneoHtml = await traer(claveCache(org, evt, null, 'torneo.html'), urlTorneoEngarde(org, evt));
    const nombreTorneo = (torneoHtml ? parsearTorneoEngarde(torneoHtml).nombre : null) ?? c.titulo ?? `${org}/${evt}`;
    let torneoCasado = false;
    const sinCasar: { prueba: string; h: HechosPrueba; suyos: HuecoSkermo[] }[] = [];
    const fechas = pruebasIndice.map((p) => p.fecha).filter((f): f is string => !!f).sort();

    for (const p of pruebasIndice) {
      if (p.individual !== true || !p.arma) continue;
      if (p.pais && !/^(ESP?|SPA|spain|espa(ñ|n)a|)$/i.test(p.pais.trim())) continue;
      const fechaP = p.fecha ?? c.fecha;
      const suyos = c.huecos.filter((h) => h.weapon === p.arma &&
        (!p.generoFinal || p.generoFinal === 'MIXTO' || h.gender === 'MIXTO' || h.gender === p.generoFinal) &&
        Math.abs(dia(fechaP) - dia(h.fecha)) <= 1);
      if (suyos.length === 0) continue;
      const clave = `engarde:${org}/${evt}/${p.compe}`;
      if (vistosEnEngarde.has(clave)) continue;
      vistosEnEngarde.add(clave);
      if (!p.categoriaFinal) {
        const cats = new Set(suyos.map((h) => h.category));
        if (cats.size !== 1) {
          descartar('categoria_ambigua', p);
          continue;
        }
        p.categoriaFinal = [...cats][0] as PruebaIndice['categoriaFinal'];
      }
      if (!p.generoFinal) {
        const gens = new Set(suyos.map((h) => h.gender));
        if (gens.size !== 1) {
          descartar('genero_ambiguo', p);
          continue;
        }
        p.generoFinal = [...gens][0] as PruebaIndice['generoFinal'];
      }
      const prueba = await traer(claveCache(org, evt, p.compe, 'prueba.html'), urlPruebaEngarde(org, evt, p.compe));
      if (prueba === null) {
        descartar('sin_pagina_de_prueba', p);
        continue;
      }
      const paginas: Paginas = { prueba, clasfinal: null, poules: [], cuadros: [], faltan: [] };
      const nombresPaginas = paginasDePrueba(prueba, org, evt, p.compe).slice(0, 16);
      // Antes de bajar poules y cuadros, la portada y la clasificación tienen que nombrar a los
      // tiradores de algún hueco: el mismo fin de semana hay muchos torneos regionales.
      let portada = prueba;
      if (nombresPaginas.some((n) => /^clasfinal\.htm$/i.test(n))) {
        portada += (await traer(claveCache(org, evt, p.compe, 'clasfinal.htm'), `${ENGARDE_BASE}/competition/${org}/${evt}/${p.compe}/clasfinal.htm`)) ?? '';
      }
      if (prefiltroNombres(portada, suyos) < 0.5) {
        descartar('prefiltro_nombres', p);
        continue;
      }
      for (const nombre of nombresPaginas) {
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
      inf.pruebasLeidas += 1;
      const r = convertirPrueba(p, paginas, {
        season: temporadaRfee(fechaP), nombreTorneo, inicio: fechas[0] ?? c.fecha, fin: fechas[fechas.length - 1] ?? c.fecha, ciudad: p.ciudad,
      });
      if (!r.ok) {
        descartar(r.motivo, p);
        continue;
      }
      const validado = validarMarcadores(r.hechos);
      const descartados = validado.descartados;
      let h = validado.hechos;
      if (h.bouts.length === 0) {
        descartar('sin_asaltos', p);
        continue;
      }
      const { casan, cobertura } = casarConSkermo(
        { weapon: h.competition.weapon, gender: h.competition.gender, fecha: h.competition.date ?? fechaP, nombres: nombresDeHechos(h) },
        skermo,
      );
      const huecosCasados = casan
        .map((s) => suyos.find((x) => x.id === s.id))
        .filter((x): x is HuecoSkermo => !!x && !x.cubiertoEnHermana)
        .filter((x) => x.faltan.some((f) => h.bouts.some((b) => b.phase === f)));
      if (casan.length === 0) {
        descartar('otro_evento_por_nombres', p);
        sinCasar.push({ prueba: `${org}/${evt}/${p.compe}`, h, suyos });
        continue;
      }
      torneoCasado = true;
      // Lectura conjunta de veteranos ya pegada a una edad hermana: sólo se vuelve a escribir si
      // trae asaltos que no están en ninguna prueba del mismo día y arma.
      // Mismo día exacto: el sábado anterior al TLM suele haber una copa internacional de veteranos
      // con parte de los mismos tiradores.
      const hermanasCubiertas = casan.filter((s) => suyos.some((x) => x.id === s.id && x.cubiertoEnHermana) && dia(s.fecha) === dia(h.competition.date ?? fechaP));
      let faltantes: AsaltoHecho[] = [];
      if (huecosCasados.length === 0) {
        if (hermanasCubiertas.length === 0) {
          descartar('casa_con_pruebas_ya_completas', p);
          continue;
        }
        const enBd = asaltosBd.get(`${h.competition.weapon}`) ?? [];
        const fechaE = dia(h.competition.date ?? fechaP);
        const cercanos = enBd.filter((b) => Math.abs(b.dia - fechaE) <= 1);
        faltantes = h.bouts.filter((b) => !asaltoPresente(b, cercanos));
        inf.verificacionVeteranos.comparadas += 1;
        for (const s of hermanasCubiertas) verificados.add(s.id);
        inf.verificacionVeteranos.asaltosComparados += h.bouts.length;
        if (faltantes.length === 0) {
          descartar('verificada_completa_en_bd', p);
          continue;
        }
      }
      h = conCategoriaDeSkermo(h, casan);
      const fichero = ficheroHechos(h);
      // Si otro productor ya tiene el fichero pero sus asaltos no están en la base (nunca se cargó o
      // el unificador no lo pegó), se escribe igual: misma clave, el cargador no duplica.
      const cercanosBd = (asaltosBd.get(h.competition.weapon) ?? []).filter((b) => Math.abs(b.dia - dia(h.competition.date ?? fechaP)) <= 1);
      const enBdYa = h.bouts.filter((b) => asaltoPresente(b, cercanosBd)).length;
      if ((ajenos.has(fichero) || clavesEnBd.has(h.competition.competitionKey)) && enBdYa >= 0.9 * h.bouts.length) {
        descartar('ya_producida_por_otro_productor', p);
        for (const x of huecosCasados) cubiertosPorOtro.set(x.id, fichero);
        if (faltantes.length > 0) inf.verificacionVeteranos.conFaltantesDeOtro.push({ prueba: `${org}/${evt}/${p.compe}`, fichero, faltan: faltantes.length });
        continue;
      }
      if (faltantes.length > 0) {
        inf.verificacionVeteranos.escritas.push({
          prueba: `${org}/${evt}/${p.compe}`, hermanas: hermanasCubiertas.map((s) => s.competition_key), asaltos: h.bouts.length,
          faltan: { POULE: faltantes.filter((b) => b.phase === 'POULE').length, TABLEAU: faltantes.filter((b) => b.phase === 'TABLEAU').length },
        });
      }
      if (ajenos.has(fichero) || clavesEnBd.has(h.competition.competitionKey)) inf.reescritosDeOtro.push({ fichero, enBd: enBdYa, asaltos: h.bouts.length });
      writeFileSync(join(salida, fichero), `${JSON.stringify(h, null, 1)}\n`);
      escritos.add(fichero);
      inf.ficheros += 1;
      const porFase = { POULE: h.bouts.filter((b) => b.phase === 'POULE').length, TABLEAU: h.bouts.filter((b) => b.phase === 'TABLEAU').length };
      inf.asaltos.POULE += porFase.POULE;
      inf.asaltos.TABLEAU += porFase.TABLEAU;
      inf.descartadosPorMarcador.POULE += descartados.POULE;
      inf.descartadosPorMarcador.TABLEAU += descartados.TABLEAU;
      for (const x of huecosCasados) completados.add(x.id);
      for (const s of hermanasCubiertas) verificados.add(s.id);
      inf.escritos.push({
        fichero, prueba: `${org}/${evt}/${p.compe}`, casan: casan.map((s) => `${s.competition_key}${huecosCasados.some((x) => x.id === s.id) ? '*' : ''}`),
        cobertura: Math.round(cobertura * 100) / 100, asaltos: porFase,
      });
    }
    // Pruebas de un torneo nacional que no casan por nombres (cuadros sueltos de una edad, una
    // edad sin hueco): sólo se comprueba que sus asaltos ya están en la base.
    if (torneoCasado) {
      for (const s of sinCasar) {
        const fechaE = dia(s.h.competition.date ?? c.fecha);
        const cercanos = (asaltosBd.get(s.h.competition.weapon) ?? []).filter((b) => Math.abs(b.dia - fechaE) <= 1);
        const faltan = s.h.bouts.filter((b) => !asaltoPresente(b, cercanos)).length;
        inf.verificacionVeteranos.sinCasarEnTorneoNacional.push({ prueba: s.prueba, asaltos: s.h.bouts.length, faltan });
        if (faltan === 0) for (const x of s.suyos) if (x.cubiertoEnHermana && dia(x.fecha) === fechaE && nombresEnComun(x.nombres, nombresDeHechos(s.h)) > 0) verificados.add(x.id);
      }
    }
    console.log(`${org}/${evt} (${c.fecha}): ${pruebasIndice.length} pruebas; peticiones ${red.peticiones}`);
  }

  // Carpeta exclusiva de este productor: lo que no se ha escrito ahora es de una ejecución anterior.
  for (const f of readdirSync(salida)) if (f.startsWith('engarde__') && f.endsWith('.json') && !escritos.has(f)) rmSync(join(salida, f));
  inf.huecosCompletados = completados.size;
  const cubiertos = huecos.filter((h) => h.cubiertoEnHermana);
  inf.verificacionVeteranos.huecosVerificados = cubiertos.filter((h) => verificados.has(h.id)).length;
  inf.verificacionVeteranos.sinLecturaEngarde = cubiertos.filter((h) => !verificados.has(h.id)).map((h) => h.competition_key);
  inf.peticiones = red.peticiones;
  for (const h of huecos) {
    if (h.cubiertoEnHermana || completados.has(h.id)) continue;
    if (cubiertosPorOtro.has(h.id)) {
      inf.cubiertosPorOtroProductor.push({ clave: h.competition_key, fichero: cubiertosPorOtro.get(h.id)! });
      continue;
    }
    const candidatosDe = [...candidatos.values()].filter((c) => c.huecos.some((x) => x.id === h.id));
    inf.sinFuente.push({
      id: h.id, clave: h.competition_key, fecha: h.fecha, arma: h.weapon, genero: h.gender, categoria: h.category, resultados: h.resultados, faltan: h.faltan,
      motivo: candidatosDe.length === 0 ? 'sin_torneo_engarde_en_fecha' : 'ninguna_prueba_engarde_casa',
    });
  }
  writeFileSync(join(salida, '_informe-lote7-skermo.json'), JSON.stringify(inf, null, 1));
  console.log(JSON.stringify({ ...inf, escritos: inf.escritos.length, sinFuente: inf.sinFuente.length, descartesDetalle: inf.descartesDetalle.length }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
