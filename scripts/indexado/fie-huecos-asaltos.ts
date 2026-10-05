/**
 * Añade asaltos individuales (poules y cuadro) a los hechos `fie-huecos` que
 * escribe `fie-huecos-ophardt.ts`, desde las páginas de los organizadores que
 * siguen publicadas o archivadas:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-huecos-asaltos.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-huecos-asaltos.ts hechos [--hechos <dir>]
 *
 * - Fencing Time (páginas estáticas `FTEvent*.htm` archivadas en Wayback):
 *   Europeos cadetes 2017 (Plovdiv) y 2018 (Sochi).
 * - Engarde (`fie_fencing`): Asiáticos cadetes 2019 (Amán).
 *
 * `descargar` deja en caché las páginas y un manifiesto con las capturas
 * elegidas; `hechos` trabaja sin red. Sólo se reescriben los ficheros que
 * ganan asaltos; el resto queda intacto. Las referencias de cada asalto son
 * los `factKey` de la clasificación del propio fichero (nombre normalizado y
 * nación); un tirador que no casa de forma única deja fuera sus asaltos, que
 * se cuentan en el informe. Los asaltos por equipos no se importan: los hechos
 * FIE de la base no tienen asaltos de equipos.
 */
import * as cheerio from 'cheerio';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { FusionAsaltos } from '../../src/lib/ingest/asaltos-complementarios';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { parsearPaginaEngarde, puestosDeEngarde, urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import { parsearCuadroEngarde } from '../../src/lib/ingest/sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../../src/lib/ingest/sources/engarde-poules';
import { argumento } from './comun';
import { consistenciaCuadro } from './cuadro-consistencia';
import { esGeneralDePruebaTerminada } from './engarde-a-hechos';
import { paginasDePrueba } from './engarde-descargar';
import { CARPETA_HUECOS, cdx, enCache, obtener, SALIDA_HECHOS, texto, ultimasCapturas, urlWayback } from './fie-huecos-comun';

type Estado = HechosPrueba['status']['pools'];
type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];

type FuenteFt = {
  tipo: 'ft';
  season: string;
  /** Prefijo CDX (sin esquema) de las páginas del torneo. */
  prefijo: string;
  /** `FTEvent<id>` → competitionKey FIE. */
  eventos: Record<string, string>;
};
type FuenteEngarde = { tipo: 'engarde'; season: string; org: string; evt: string; pruebas: Record<string, string> };

const EUROPEOS_CADETES_FT = {
  '360448': '937', '360449': '938', '360450': '939', '360451': '940', '360452': '941', '360453': '942',
};

export const FUENTES: (FuenteFt | FuenteEngarde)[] = [
  { tipo: 'ft', season: '2017', prefijo: 'fencingtime.com/LiveResults/PlovdivJCEFCH/Cadet/', eventos: EUROPEOS_CADETES_FT },
  { tipo: 'ft', season: '2018', prefijo: 'fencingtime.com/LiveResults/EuropeanCadets2018/', eventos: EUROPEOS_CADETES_FT },
  {
    tipo: 'engarde', season: '2019', org: 'fie_fencing', evt: 'asian_championship_amman2019',
    pruebas: {
      epee_women: '763', epee_men_cadet: '764', foil_women_cadet: '765', foil_men: '766', saber_women: '767', saber_men: '768',
    },
  },
];

const MANIFIESTO = join(CARPETA_HUECOS, 'asaltos-capturas.json');
const INFORME = join(CARPETA_HUECOS, 'asaltos-informe.json');
const PREFIJO_NOTA = 'Asaltos:';

type Manifiesto = {
  ft: { season: string; evento: string; url: string; timestamp: string }[];
  engarde: { season: string; org: string; evt: string; compe: string; paginas: string[] }[];
};

// ---------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------

const sinEsquema = (url: string) => url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/^([^/]+):\d+\//, '$1/');

async function descargar() {
  const man: Manifiesto = { ft: [], engarde: [] };
  for (const f of FUENTES) {
    if (f.tipo === 'ft') {
      const capturas = await cdx(f.prefijo, { matchType: 'prefix' });
      const ultimas = ultimasCapturas(
        capturas.filter((c) => sinEsquema(c.original).startsWith(f.prefijo.toLowerCase())),
        (c) => /FTEvent(\d+)\.htm$/i.exec(c.original)?.[1] ?? '',
      );
      for (const evento of Object.keys(f.eventos)) {
        const c = ultimas.get(evento);
        if (!c) {
          console.log(`  ${f.season} FTEvent${evento}: sin captura`);
          continue;
        }
        const d = await obtener(urlWayback(c.timestamp, c.original));
        console.log(`  ${f.season} FTEvent${evento} ${c.timestamp} HTTP ${d.status} ${d.bytes?.length ?? 0} B`);
        if (d.status === 200) man.ft.push({ season: f.season, evento, url: c.original, timestamp: c.timestamp });
      }
    } else {
      for (const compe of Object.keys(f.pruebas)) {
        const base = urlPruebaEngarde(f.org, f.evt, compe);
        const prueba = texto(await obtener(base));
        if (prueba === null) {
          console.log(`  ${f.season} ${compe}: sin página de prueba`);
          continue;
        }
        const paginas = paginasDePrueba(prueba, f.org, f.evt, compe).slice(0, 16);
        for (const p of paginas) await obtener(`${base}/${p}`);
        console.log(`  ${f.season} ${compe}: ${paginas.join(', ')}`);
        man.engarde.push({ season: f.season, org: f.org, evt: f.evt, compe, paginas });
      }
    }
  }
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO}`);
}

// ---------------------------------------------------------------------------
// Referencias: tirador publicado → factKey de la clasificación
// ---------------------------------------------------------------------------

type Tirador = { nombre: string; pais: string | null };
export type Metodo = 'nombre_y_nacion' | 'nombre_otra_nacion' | 'puesto_y_apellido' | 'apellido_parecido' | 'puesto_nacion_y_palabra';
type Mapeo = { ref: string; metodo: Metodo };
/** Puesto final que publica la propia fuente de asaltos (ancla para casar transliteraciones). */
type Puesto = { t: Tirador; puesto: number };

const claveTirador = (t: Tirador) => `${normalizeSportName(t.nombre)}|${t.pais ?? ''}`;

const plegar = (s: string) =>
  s.replace(/ß/g, 'ss').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/** Apellido = palabras iniciales en mayúsculas («SURNAME, Given» o «SURNAME Given»); nombre = el resto. */
function partesNombre(nombre: string): { apellido: string; inicial: string } {
  const [antes, despues] = nombre.includes(',') ? nombre.split(/,(.*)/s) : [null, null];
  if (antes !== null) return { apellido: plegar(antes), inicial: plegar(despues ?? '').charAt(0) };
  const palabras = nombre.trim().split(/\s+/);
  const n = palabras.findIndex((p) => p !== p.toUpperCase() || !/\p{L}/u.test(p));
  const corte = n <= 0 ? Math.max(1, palabras.length - 1) : n;
  return { apellido: plegar(palabras.slice(0, corte).join(' ')), inicial: plegar(palabras.slice(corte).join(' ')).charAt(0) };
}

function parecido(a: string, b: string): number {
  if (!a || !b) return 0;
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = t;
    }
  }
  return 1 - d[b.length] / Math.max(a.length, b.length);
}

/**
 * Casa los tiradores que publica la fuente de asaltos con las filas de la
 * clasificación, de forma inyectiva y por pasadas de menos a más tolerantes:
 * 1. nombre normalizado (orden de palabras indiferente) y nación;
 * 2. el mismo nombre, único en la prueba, con otra nación (Ophardt reescribe
 *    hoy RUS/BLR como AIN y algunos cambios de federación);
 * 3. mismo puesto final en la fuente y en la clasificación y apellido parecido
 *    (transliteraciones: Andriy/Andrii, RAIKIN/RAYKIN, GIESSER/GIEßER);
 * 4. misma nación, misma inicial y apellido muy parecido, candidato único;
 * 5. mismo puesto final y una palabra del nombre en común con la misma
 *    nación, o dos con cualquier nación (apellidos compuestos recortados:
 *    RAPOSO / RAPOSO TRAMONT; CALDERON ESP / CALDERON BARTOLOME USA).
 * Lo que no casa así queda fuera y sus asaltos se cuentan como descartados.
 */
export function emparejarTiradores(resultados: HechosPrueba['results'], tiradores: Tirador[], puestos: Puesto[]) {
  const filas = resultados.map((r) => ({
    ref: r.factKey, pais: r.countryCode, n: normalizeSportName(r.name), pos: r.position, ...partesNombre(r.name),
    palabras: plegar(r.name).split(' ').filter((x) => x.length >= 3),
  }));
  const unicos = new Map<string, Tirador>();
  for (const t of tiradores) if (normalizeSportName(t.nombre)) unicos.set(claveTirador(t), t);
  const puestoDe = new Map<string, number | null>();
  for (const p of puestos) {
    const n = normalizeSportName(p.t.nombre);
    puestoDe.set(n, puestoDe.has(n) ? null : p.puesto);
  }
  const asignado = new Map<string, Mapeo>();
  const tomadas = new Set<string>();
  const pendientes = () => [...unicos].filter(([k]) => !asignado.has(k));
  const libres = () => filas.filter((f) => !tomadas.has(f.ref));
  const pasada = (metodo: Metodo, candidatos: (t: Tirador, libres: typeof filas) => typeof filas) => {
    const propuestas = new Map<string, string[]>();
    const disponibles = libres();
    for (const [k, t] of pendientes()) {
      const c = candidatos(t, disponibles);
      if (c.length === 1) propuestas.set(c[0].ref, [...(propuestas.get(c[0].ref) ?? []), k]);
    }
    for (const [ref, ks] of propuestas) {
      if (ks.length !== 1) continue;
      asignado.set(ks[0], { ref, metodo });
      tomadas.add(ref);
    }
  };
  pasada('nombre_y_nacion', (t, l) => l.filter((f) => f.n === normalizeSportName(t.nombre) && (!t.pais || !f.pais || f.pais === t.pais)));
  pasada('nombre_otra_nacion', (t, l) => {
    const n = normalizeSportName(t.nombre);
    return filas.filter((f) => f.n === n).length === 1 ? l.filter((f) => f.n === n) : [];
  });
  pasada('puesto_y_apellido', (t, l) => {
    const pos = puestoDe.get(normalizeSportName(t.nombre));
    if (pos == null) return [];
    const p = partesNombre(t.nombre);
    return l.filter((f) => f.pos === pos && parecido(f.apellido, p.apellido) >= 0.6 && (f.inicial === p.inicial || parecido(f.apellido, p.apellido) >= 0.85));
  });
  pasada('apellido_parecido', (t, l) => {
    if (!t.pais) return [];
    const p = partesNombre(t.nombre);
    return l.filter((f) => f.pais === t.pais && f.inicial === p.inicial && parecido(f.apellido, p.apellido) >= 0.8);
  });
  pasada('puesto_nacion_y_palabra', (t, l) => {
    const pos = puestoDe.get(normalizeSportName(t.nombre));
    if (pos == null) return [];
    const propias = new Set(plegar(t.nombre).split(' ').filter((x) => x.length >= 3));
    return l.filter((f) => {
      const comunes = f.palabras.filter((x) => propias.has(x)).length;
      return f.pos === pos && (comunes >= 2 || (comunes >= 1 && !!t.pais && f.pais === t.pais));
    });
  });
  const metodos: Partial<Record<Metodo, number>> = {};
  for (const m of asignado.values()) metodos[m.metodo] = (metodos[m.metodo] ?? 0) + 1;
  return {
    de: (t: Tirador): Mapeo | null => asignado.get(claveTirador(t)) ?? null,
    metodos,
    sinCasar: pendientes().map(([, t]) => t),
  };
}

// ---------------------------------------------------------------------------
// Fencing Time (páginas estáticas FTEvent)
// ---------------------------------------------------------------------------

type BoutLeido = { phase: 'POULE' | 'TABLEAU'; roundKey: string; a: Tirador; b: Tirador; scoreA: number; scoreB: number; winner: 'A' | 'B' | null };
type Lectura = {
  arma: Arma | null;
  genero: Genero | null;
  puestos: Puesto[];
  poules: { bouts: BoutLeido[]; esperados: number; descartados: Record<string, number> } | null;
  cuadro: { bouts: BoutLeido[]; esperados: number; completo: boolean; descartados: Record<string, number> } | null;
};

const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);

export function armaGeneroFt(cabecera: string): { arma: Arma | null; genero: Genero | null } {
  const t = cabecera.toLowerCase();
  const arma: Arma | null = /\bepee|\bépée/.test(t) ? 'ESPADA' : /\bfoil/.test(t) ? 'FLORETE' : /\bsab(re|er)/.test(t) ? 'SABLE' : null;
  const genero: Genero | null = /\bwomen/.test(t) ? 'F' : /\bmen/.test(t) ? 'M' : null;
  return { arma, genero };
}

function tiradorFt($: cheerio.CheerioAPI, celda: cheerio.Cheerio<any>, claseNacion: string): Tirador {
  const copia = celda.clone();
  const pais = copia.find(claseNacion).text().replace(/\s+/g, '').trim();
  copia.find(claseNacion).remove();
  copia.find('.tableauSeed').remove();
  return { nombre: copia.text().replace(/,/g, ' ').replace(/\s+/g, ' ').trim(), pais: /^[A-Z]{3}$/.test(pais) ? pais : null };
}

function poulesFt($: cheerio.CheerioAPI, seccion: cheerio.Cheerio<any>): NonNullable<Lectura['poules']> {
  const res: NonNullable<Lectura['poules']> = { bouts: [], esperados: 0, descartados: {} };
  const numeros = seccion.find('.poolNum').toArray().map((e) => Number(/#\s*(\d+)/.exec($(e).text())?.[1]));
  seccion.find('table.pool').each((ip, tabla) => {
    const pool = numeros[ip] || ip + 1;
    const filas = $(tabla).find('tr.poolOddRow, tr.poolEvenRow').toArray().map((tr) => {
      const celdas = $(tr).find('td.poolScoreCol').toArray().map((td) => {
        const m = /^([VD])\s*(\d{1,2})?$/i.exec($(td).text().trim());
        return { relleno: $(td).hasClass('poolScoreFill'), v: m ? m[1].toUpperCase() === 'V' : null, n: m?.[2] !== undefined ? Number(m[2]) : null };
      });
      const totales = $(tr).find('td.poolResultCol').toArray().map((td) => $(td).text().trim());
      return { t: tiradorFt($, $(tr).find('td.poolNameCol').first(), '.poolAffil'), celdas, v: Number(totales[0]), ts: Number(totales[2]), tr: Number(totales[3]) };
    });
    const n = filas.length;
    res.esperados += (n * (n - 1)) / 2;
    // Una fila cuyas victorias y tocados no suman lo publicado (abandono, anulación) invalida sus asaltos.
    const filaValida = filas.map((f, i) => {
      if (f.celdas.length !== n) return false;
      let v = 0;
      let ts = 0;
      let tr = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const c = f.celdas[j];
        const o = filas[j].celdas[i];
        if (c?.n == null || o?.n == null) return false;
        v += c.v ? 1 : 0;
        ts += c.n;
        tr += o.n;
      }
      return v === f.v && ts === f.ts && tr === f.tr;
    });
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const c = filas[i].celdas[j];
        const o = filas[j].celdas[i];
        if (!c || !o || c.v === null || o.v === null || c.n === null || o.n === null) {
          sumar(res.descartados, 'sin_marcador');
          continue;
        }
        if (c.v === o.v || (c.v && c.n < o.n) || (o.v && o.n < c.n)) {
          sumar(res.descartados, 'incoherente');
          continue;
        }
        if (!filaValida[i] || !filaValida[j]) {
          sumar(res.descartados, 'totales_no_cuadran');
          continue;
        }
        res.bouts.push({
          phase: 'POULE', roundKey: `P${pool}`, a: filas[i].t, b: filas[j].t, scoreA: c.n, scoreB: o.n,
          winner: c.n === o.n ? (c.v ? 'A' : 'B') : null,
        });
      }
    }
  });
  return res;
}

function rondaDeTitulo(titulo: string): string | null {
  const t = titulo.trim().toLowerCase();
  const m = /table of (\d+)/.exec(t);
  if (m) return `A${m[1]}`;
  if (/semi/.test(t)) return 'A4';
  if (/^finals?$/.test(t)) return 'A2';
  return null;
}

/**
 * El cuadro de Fencing Time es una rejilla: cada columna es una ronda, los
 * tiradores de un cruce son los nombres consecutivos de la columna y el
 * ganador aparece en la columna siguiente, en una fila entre los dos, con el
 * marcador (el del ganador primero) en la celda de debajo.
 */
function cuadroFt($: cheerio.CheerioAPI, tabla: cheerio.Cheerio<any>): NonNullable<Lectura['cuadro']> {
  const res: NonNullable<Lectura['cuadro']> = { bouts: [], esperados: 0, completo: false, descartados: {} };
  const filas = tabla.find('tr').toArray().map((tr) => $(tr).children('td').toArray());
  const titulos = filas[0]?.map((td) => $(td).text()) ?? [];
  const rondas = titulos.map(rondaDeTitulo);
  type Nombre = { fila: number; t: Tirador; bye: boolean };
  const columnas: Nombre[][] = titulos.map(() => []);
  const marcador = (fila: number, col: number): [number, number] | null => {
    const td = filas[fila]?.[col];
    const m = td ? /^\s*(\d{1,2})\s*-\s*(\d{1,2})/.exec($(td).text()) : null;
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  filas.forEach((tds, fila) => {
    tds.forEach((td, col) => {
      if (!$(td).hasClass('tableauNameCell') || col >= columnas.length) return;
      const nombre = $(td).find('.tableauCompName').text().trim();
      if (!nombre) return;
      columnas[col].push({ fila, t: tiradorFt($, $(td), '.tableauCompAffil'), bye: /-?\s*bye\s*-?/i.test(nombre) && nombre.length <= 8 });
    });
  });
  for (let c = 0; c + 1 < columnas.length; c += 1) {
    const ronda = rondas[c];
    if (!ronda) continue;
    const col = columnas[c];
    for (let k = 0; k + 1 < col.length; k += 2) if (!col[k].bye && !col[k + 1].bye) res.esperados += 1;
    for (const g of columnas[c + 1]) {
      const arriba = [...col].reverse().find((x) => x.fila < g.fila);
      const abajo = col.find((x) => x.fila > g.fila);
      if (!arriba || !abajo) {
        sumar(res.descartados, 'sin_rivales');
        continue;
      }
      if (arriba.bye || abajo.bye) continue;
      const m = marcador(g.fila + 1, c + 1);
      if (!m) {
        sumar(res.descartados, 'sin_marcador');
        continue;
      }
      const ganaArriba = normalizeSportName(g.t.nombre) === normalizeSportName(arriba.t.nombre);
      const ganaAbajo = normalizeSportName(g.t.nombre) === normalizeSportName(abajo.t.nombre);
      if (ganaArriba === ganaAbajo || m[0] < m[1]) {
        sumar(res.descartados, 'incoherente');
        continue;
      }
      const [sa, sb] = ganaArriba ? m : [m[1], m[0]];
      res.bouts.push({
        phase: 'TABLEAU', roundKey: ronda, a: arriba.t, b: abajo.t, scoreA: sa, scoreB: sb,
        winner: sa === sb ? (ganaArriba ? 'A' : 'B') : null,
      });
    }
  }
  const ultima = rondas.lastIndexOf('A2');
  res.completo = ultima >= 0 && columnas[ultima + 1]?.length === 1 && res.bouts.length === res.esperados;
  return res;
}

export function leerFt(html: string): Lectura {
  const $ = cheerio.load(html);
  const { arma, genero } = armaGeneroFt($('.tournDetails').first().text());
  let poules: Lectura['poules'] = null;
  let cuadro: Lectura['cuadro'] = null;
  $('[id^="Round"][id$="Scores"]').each((_, s) => {
    const sec = $(s);
    if (sec.find('table.pool').length > 0 && !poules) poules = poulesFt($, sec);
    const tablas = sec.find('table.elimTableau');
    if (tablas.length === 1 && !cuadro) cuadro = cuadroFt($, tablas.first());
  });
  const puestos: Puesto[] = [];
  $('#finalResults table.dataTable tr').each((_, tr) => {
    const td = $(tr).children('td').toArray().map((x) => $(x).text().replace(/\s+/g, ' ').trim());
    const puesto = Number(/^(\d+)/.exec(td[0] ?? '')?.[1]);
    if (td.length < 3 || !puesto) return;
    puestos.push({ t: { nombre: td[1].replace(/,/g, ' ').replace(/\s+/g, ' ').trim(), pais: /^[A-Z]{3}$/.test(td[2]) ? td[2] : null }, puesto });
  });
  return { arma, genero, puestos, poules, cuadro };
}

// ---------------------------------------------------------------------------
// Engarde
// ---------------------------------------------------------------------------

export function leerEngarde(paginas: { nombre: string; url: string; html: string }[], faltan: number): Lectura {
  const poules: NonNullable<Lectura['poules']> = { bouts: [], esperados: 0, descartados: {} };
  const naciones = new Map<string, string | null>();
  const nacion = (club: string | null) => (club && /^[A-Z]{3}$/.test(club.trim()) ? club.trim() : null);
  let hayPoules = false;
  for (const p of paginas) {
    const np = /^poules(\d+)\.htm$/i.exec(p.nombre);
    if (!np) continue;
    const r = parsearPoulesEngarde(p.html, { pagina: Number(np[1]) });
    if (r.estado !== 'leido') {
      sumar(poules.descartados, 'pagina_ilegible');
      continue;
    }
    hayPoules = true;
    poules.esperados += r.esperados;
    for (const [k, n] of Object.entries(r.excluidos)) if (n) sumar(poules.descartados, k, n);
    for (const t of r.tiradores) {
      const k = normalizeSportName(t.nombre);
      const pais = nacion(t.club);
      naciones.set(k, naciones.has(k) && naciones.get(k) !== pais ? null : pais);
    }
    for (const b of r.asaltos) {
      poules.bouts.push({
        phase: 'POULE', roundKey: b.ronda,
        a: { nombre: b.a.nombre, pais: nacion(b.a.club) }, b: { nombre: b.b.nombre, pais: nacion(b.b.club) },
        scoreA: b.a.tocados, scoreB: b.b.tocados, winner: b.a.tocados === b.b.tocados ? b.ganador : null,
      });
    }
  }
  const fusion = new FusionAsaltos();
  let ilegibles = 0;
  let hayCuadro = false;
  for (const p of paginas) {
    if (!/^tableau/i.test(p.nombre)) continue;
    const c = parsearCuadroEngarde(p.html, { individual: true });
    if (c.estado !== 'leido') {
      ilegibles += 1;
      continue;
    }
    hayCuadro = true;
    fusion.anadir(c, p.url);
  }
  let cuadro: Lectura['cuadro'] = null;
  if (hayCuadro) {
    const parte = fusion.resumen(ilegibles === 0 && faltan === 0);
    const descartados: Record<string, number> = {};
    for (const [k, n] of Object.entries(parte.excluidos)) if (n && k !== 'bye') sumar(descartados, k, n);
    if (parte.conflictos.length) sumar(descartados, 'conflicto', parte.conflictos.length);
    if (ilegibles) sumar(descartados, 'pagina_ilegible', ilegibles);
    const ronda = (r: string) => (r === 'SF' ? 'A4' : r === 'F' ? 'A2' : r.replace(/^T(\d+)$/, 'A$1'));
    cuadro = {
      esperados: parte.publicado,
      completo: parte.completo,
      descartados,
      bouts: parte.asaltos.map((b) => ({
        phase: 'TABLEAU' as const, roundKey: ronda(b.ronda),
        a: { nombre: b.nombreA, pais: naciones.get(normalizeSportName(b.nombreA)) ?? null },
        b: { nombre: b.nombreB, pais: naciones.get(normalizeSportName(b.nombreB)) ?? null },
        scoreA: b.puntosA, scoreB: b.puntosB, winner: null,
      })),
    };
  }
  const puestos: Puesto[] = [];
  const final = paginas.find((p) => /^clasfinal\.htm$/i.test(p.nombre));
  if (final) {
    const pagina = parsearPaginaEngarde(final.html);
    // Las seis pruebas figuran como terminadas («completed») en el índice de Engarde.
    if (pagina.tipo === 'clasificacion_provisional' && esGeneralDePruebaTerminada(pagina.encabezado, 'completed')) pagina.tipo = 'clasificacion';
    if (pagina.tipo === 'clasificacion') {
      for (const x of puestosDeEngarde(pagina)) {
        if (x.posicion !== null) puestos.push({ t: { nombre: x.nombre, pais: x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null }, puesto: x.posicion });
      }
    }
  }
  return { arma: null, genero: null, puestos, poules: hayPoules ? poules : null, cuadro };
}

// ---------------------------------------------------------------------------
// Fusión con los hechos de Ophardt
// ---------------------------------------------------------------------------

export type InformePrueba = {
  season: string;
  competitionKey: string;
  fuente: string;
  url: string;
  pools: { estado: Estado; importados: number; esperados: number; descartados: Record<string, number> };
  tableau: { estado: Estado; importados: number; esperados: number; descartados: Record<string, number> };
  tiradores: { publicados: number; casados: Partial<Record<Metodo, number>>; sinCasar: string[] };
  motivo?: string;
};

function estadoFase(importados: number, esperados: number, descartes: number, completoFuente: boolean): Estado {
  if (importados === 0) return 'sin_resultados';
  return importados === esperados && descartes === 0 && completoFuente ? 'completo' : 'parcial';
}

/** Asaltos de la lectura con referencias de la clasificación, validados; devuelve el fichero nuevo. */
export function anadirAsaltos(
  h: HechosPrueba,
  lectura: Lectura,
  fuente: { nombre: string; url: string; descripcion: string },
): { hechos: HechosPrueba; informe: InformePrueba } {
  const todos = [...(lectura.poules?.bouts ?? []), ...(lectura.cuadro?.bouts ?? [])];
  const refs = emparejarTiradores(h.results, todos.flatMap((b) => [b.a, b.b]), lectura.puestos);
  const nombres = new Map(h.results.map((r) => [r.factKey, r.name]));
  const fase = (l: Lectura['poules'] | Lectura['cuadro'], tipo: 'POULE' | 'TABLEAU') => {
    const descartados: Record<string, number> = { ...(l?.descartados ?? {}) };
    const bouts: AsaltoHecho[] = [];
    const vistos = new Set<string>();
    for (const b of l?.bouts ?? []) {
      const ra = refs.de(b.a);
      const rb = refs.de(b.b);
      if (!ra || !rb) {
        sumar(descartados, 'tirador_sin_referencia');
        continue;
      }
      if (ra.ref === rb.ref) {
        sumar(descartados, 'mismo_tirador');
        continue;
      }
      const enteros = [b.scoreA, b.scoreB].every((s) => Number.isInteger(s) && s >= 0 && s <= 45);
      if (!enteros || (b.scoreA === b.scoreB && b.winner === null)) {
        sumar(descartados, 'marcador_invalido');
        continue;
      }
      const clave = `${b.roundKey}|${[ra.ref, rb.ref].sort().join('|')}`;
      if (vistos.has(clave)) {
        sumar(descartados, 'duplicado');
        continue;
      }
      vistos.add(clave);
      bouts.push({
        phase: tipo, roundKey: b.roundKey, aRef: ra.ref, bRef: rb.ref,
        aName: nombres.get(ra.ref) ?? b.a.nombre, bName: nombres.get(rb.ref) ?? b.b.nombre,
        scoreA: b.scoreA, scoreB: b.scoreB, winner: b.winner,
      });
    }
    if (tipo === 'TABLEAU' && bouts.length > 0) {
      const c = consistenciaCuadro(bouts);
      if (c.incoherentes.size > 0) {
        sumar(descartados, 'cuadro_incoherente', c.incoherentes.size);
        return { bouts: bouts.filter((_, i) => !c.incoherentes.has(i)), descartados };
      }
    }
    return { bouts, descartados };
  };
  const p = fase(lectura.poules, 'POULE');
  const t = fase(lectura.cuadro, 'TABLEAU');
  const cuenta = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);
  const estadoP: Estado = lectura.poules
    ? estadoFase(p.bouts.length, lectura.poules.esperados, cuenta(p.descartados), true)
    : h.status.pools;
  const estadoT: Estado = lectura.cuadro
    ? estadoFase(t.bouts.length, lectura.cuadro.esperados, cuenta(t.descartados), lectura.cuadro.completo)
    : h.status.tableau;

  const notas = h.status.notes.filter((n) => !n.startsWith(PREFIJO_NOTA));
  const detalle = (nombre: string, n: number, esperados: number, d: Record<string, number>) => {
    const fuera = Object.entries(d).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ');
    return `${nombre} ${n} de ${esperados} asaltos${fuera ? ` (fuera: ${fuera})` : ''}`;
  };
  const partes = [
    lectura.poules ? detalle('poules', p.bouts.length, lectura.poules.esperados, p.descartados) : 'sin poules',
    lectura.cuadro ? detalle('cuadro', t.bouts.length, lectura.cuadro.esperados, t.descartados) : 'sin cuadro',
  ];
  notas.push(`${PREFIJO_NOTA} ${fuente.descripcion} (${fuente.url}); ${partes.join('; ')}; referencias = factKey de la clasificación por nombre y nación; no se importan asaltos de equipos`);

  const nuevo = hechosPrueba.parse({
    ...h,
    status: { ...h.status, pools: estadoP, tableau: estadoT, notes: notas },
    bouts: [...p.bouts, ...t.bouts],
  });
  return {
    hechos: nuevo,
    informe: {
      season: h.edition.season,
      competitionKey: h.competition.competitionKey,
      fuente: fuente.nombre,
      url: fuente.url,
      pools: { estado: estadoP, importados: p.bouts.length, esperados: lectura.poules?.esperados ?? 0, descartados: p.descartados },
      tableau: { estado: estadoT, importados: t.bouts.length, esperados: lectura.cuadro?.esperados ?? 0, descartados: t.descartados },
      tiradores: {
        publicados: new Set(todos.flatMap((b) => [b.a, b.b]).map(claveTirador)).size,
        casados: refs.metodos,
        sinCasar: refs.sinCasar.map((t) => `${t.nombre} (${t.pais ?? '?'})`),
      },
    },
  };
}

function hechos() {
  const carpeta = argumento('hechos', SALIDA_HECHOS);
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const informe: InformePrueba[] = [];
  const sinCambio: { season: string; competitionKey: string; motivo: string }[] = [];
  const leerHechos = (season: string, comp: string) => {
    const ruta = join(carpeta, `fie__${season}__${comp}.json`);
    if (!existsSync(ruta)) return null;
    return { ruta, h: hechosPrueba.parse(JSON.parse(readFileSync(ruta, 'utf8'))) };
  };
  const escribir = (ruta: string, r: ReturnType<typeof anadirAsaltos>) => {
    if (r.hechos.bouts.length === 0) {
      sinCambio.push({ season: r.informe.season, competitionKey: r.informe.competitionKey, motivo: 'ningún asalto válido' });
      informe.push({ ...r.informe, motivo: 'sin_asaltos_validos' });
      return;
    }
    writeFileSync(ruta, `${JSON.stringify(r.hechos, null, 1)}\n`);
    informe.push(r.informe);
  };

  for (const f of FUENTES) {
    if (f.tipo === 'ft') {
      for (const [evento, comp] of Object.entries(f.eventos)) {
        const c = man.ft.find((x) => x.season === f.season && x.evento === evento);
        const fichero = leerHechos(f.season, comp);
        if (!c || !fichero) {
          sinCambio.push({ season: f.season, competitionKey: comp, motivo: !c ? 'sin captura en caché' : 'sin fichero de hechos' });
          continue;
        }
        const wb = urlWayback(c.timestamp, c.url);
        const html = texto(enCache(wb));
        if (!html) {
          sinCambio.push({ season: f.season, competitionKey: comp, motivo: 'captura no está en caché' });
          continue;
        }
        const l = leerFt(html);
        if (l.arma !== fichero.h.competition.weapon || l.genero !== fichero.h.competition.gender) {
          sinCambio.push({ season: f.season, competitionKey: comp, motivo: `la página es ${l.arma}/${l.genero}, la prueba ${fichero.h.competition.weapon}/${fichero.h.competition.gender}` });
          continue;
        }
        const url = `https://web.archive.org/web/${c.timestamp}/${c.url}`;
        escribir(fichero.ruta, anadirAsaltos(fichero.h, l, {
          nombre: 'fencingtime_wayback', url, descripcion: `poules y cuadro de Fencing Time Live Results archivados en Wayback (captura ${c.timestamp})`,
        }));
      }
    } else {
      for (const [compe, comp] of Object.entries(f.pruebas)) {
        const e = man.engarde.find((x) => x.season === f.season && x.evt === f.evt && x.compe === compe);
        const fichero = leerHechos(f.season, comp);
        if (!e || !fichero) {
          sinCambio.push({ season: f.season, competitionKey: comp, motivo: !e ? 'sin páginas Engarde' : 'sin fichero de hechos' });
          continue;
        }
        if (fichero.h.competition.format !== 'INDIVIDUAL') continue;
        const base = urlPruebaEngarde(f.org, f.evt, compe);
        const paginas: { nombre: string; url: string; html: string }[] = [];
        let faltan = 0;
        for (const nombre of e.paginas) {
          const html = texto(enCache(`${base}/${nombre}`));
          if (html === null) faltan += 1;
          else paginas.push({ nombre, url: `${base}/${nombre}`, html });
        }
        escribir(fichero.ruta, anadirAsaltos(fichero.h, leerEngarde(paginas, faltan), {
          nombre: 'engarde', url: base, descripcion: 'poules y cuadro publicados en Engarde (organismo fie_fencing)',
        }));
      }
    }
  }
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), pruebas: informe, sinCambio }, null, 1)}\n`);
  for (const i of informe) {
    console.log(`${i.season} ${i.competitionKey} ${i.fuente}: poules ${i.pools.importados}/${i.pools.esperados} ${i.pools.estado} ${JSON.stringify(i.pools.descartados)}; cuadro ${i.tableau.importados}/${i.tableau.esperados} ${i.tableau.estado} ${JSON.stringify(i.tableau.descartados)}; tiradores ${i.tiradores.publicados} ${JSON.stringify(i.tiradores.casados)} sin casar: ${i.tiradores.sinCasar.join('; ')}`);
  }
  for (const s of sinCambio) console.log(`${s.season} ${s.competitionKey}: sin cambios (${s.motivo})`);
  console.log(`informe en ${INFORME}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: fie-huecos-asaltos.ts descargar|hechos [--hechos <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
