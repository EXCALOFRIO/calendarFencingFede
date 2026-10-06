/**
 * Poules y cuadro de los Juegos Mediterráneos de Tarragona 2018 (FIE 2018
 * 1139–1142), desde el sistema oficial de resultados del comité organizador
 * (`results.tarragona2018.cat`, Bornan) archivado en Wayback.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-tarragona.ts [--db <sqlite>] [--salida <dir>]
 *
 * - «groups/<prueba>»: matriz de cada poule en HTML («a-b» desde el tirador de
 *   la fila) con «Points» (2 por victoria) y puesto.
 * - «brackets/<prueba>»: JSON incrustado (`bracketInfo`) con los cruces de la
 *   primera ronda (`Partics`) y el marcador de cada asalto por ronda.
 * Una poule vale si su matriz es recíproca, cada asalto tiene un ganador con
 * ≤ 5 tocados y, además, o bien «Points» = 2 × victorias en todas sus filas, o
 * bien la clasificación tras poules calculada con los asaltos de todas las
 * poules (V/M, indicador, TD) da exactamente la colocación del cuadro
 * publicado (1-16, 8-9, 5-12…). Un asalto del cuadro vale si tiene ganador,
 * ≤ 15 tocados y el ganador pasa a la ronda siguiente; el perdedor de la final,
 * semifinales y cuartos debe tener en la clasificación de la base el puesto 2,
 * 3 y 5–8. Las referencias son las `source_fact_key` de la clasificación: los
 * asaltos con tiradores que la FIE no clasificó se quedan fuera.
 */
import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { abrirBase, puestosDeBase, type PuestoBase } from './fie-completar-comun';
import { hechosBase } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, cdx, obtener, SALIDA_LOTE7, sha256, texto, urlWayback } from './lote7-fie-red';
import { compacto } from './pdf-droids';

type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];
type Tirador = { nombre: string; pais: string | null };

const BASE = 'https://results.tarragona2018.cat/en/FEN';
export const PRUEBAS: { competitionKey: string; codigo: string }[] = [
  { competitionKey: '1139', codigo: 'M.INDIV------EPEE---' },
  { competitionKey: '1140', codigo: 'W.INDIV------FOIL---' },
  { competitionKey: '1141', codigo: 'W.INDIV------SABLE--' },
  { competitionKey: '1142', codigo: 'W.INDIV------EPEE---' },
];

export type PouleWeb = { numero: number; filas: { tirador: Tirador; celdas: (string | null)[]; puntos: number | null }[] };

export function leerGrupos(html: string): PouleWeb[] {
  const $ = cheerio.load(html);
  const poules: PouleWeb[] = [];
  $('h4.sp-table-caption').each((_, h) => {
    const m = /Pool (\d+) - Standings/.exec($(h).text());
    if (!m) return;
    const tabla = $(h).nextAll('div').first().find('table').first();
    const filas: PouleWeb['filas'] = [];
    tabla.find('tbody > tr').each((__, tr) => {
      const td = $(tr).children('td').toArray();
      const nombre = $(td[1]).find('.nameTableLeft').text().trim();
      const pais = $(td[2]).text().trim();
      const resto = td.slice(3);
      const celdas = resto.slice(0, resto.length - 2).map((c) => ($(c).hasClass('StyleNone') ? null : $(c).text().trim()));
      const puntos = Number($(resto[resto.length - 2]).text().trim());
      filas.push({ tirador: { nombre, pais: /^[A-Z]{3}$/.test(pais) ? pais : null }, celdas, puntos: Number.isFinite(puntos) ? puntos : null });
    });
    poules.push({ numero: Number(m[1]), filas });
  });
  return poules;
}

export type PuestoOficial = { t: Tirador; puesto: number; registro: string | null };

/** «Medals & Ranking»: puesto, nombre, nación y número de acreditación de los Juegos (`register`, no es el ID FIE). */
export function leerClasificacion(html: string): PuestoOficial[] {
  const $ = cheerio.load(html);
  const filas: PuestoOficial[] = [];
  $('table tbody tr').each((_, tr) => {
    const puesto = Number($(tr).find('.final-rank strong').first().text().trim());
    const tag = $(tr).find('.playerTag').first();
    const nombre = tag.find('.nameLine span').first().text().trim();
    const pais = tag.attr('country') ?? '';
    const registro = tag.attr('register')?.trim() || null;
    if (Number.isInteger(puesto) && puesto > 0 && nombre) {
      filas.push({ t: { nombre, pais: /^[A-Z]{3}$/.test(pais) ? pais : null }, puesto, registro: registro && /^\d+$/.test(registro) ? registro : null });
    }
  });
  return filas;
}

/**
 * Segunda pasada para las filas FIE que `aliasPorPuesto` no casó: nombre
 * idéntico (sin acentos ni signos), único en la oficial, y además la misma
 * nación o el mismo puesto. Devuelve las discrepancias que quedan entre FIE y
 * la oficial (nación o puesto) para dejarlas anotadas.
 */
export function aliasPorNombre(oficial: readonly PuestoOficial[], puestos: readonly PuestoBase[], alias: Map<string, Tirador>): string[] {
  const casadas = new Set([...alias.values()].map((a) => a.nombre));
  const avisos: string[] = [];
  for (const r of puestos.filter((x) => !casadas.has(x.name))) {
    const c = oficial.filter((o) => compacto(o.t.nombre) === compacto(r.name) && !alias.has(compacto(o.t.nombre)));
    if (c.length !== 1 || oficial.filter((o) => compacto(o.t.nombre) === compacto(r.name)).length !== 1) continue;
    const o = c[0];
    const mismaNacion = o.t.pais === r.countryCode;
    const mismoPuesto = o.puesto === r.position;
    if (!mismaNacion && !mismoPuesto) continue;
    alias.set(compacto(o.t.nombre), { nombre: r.name, pais: r.countryCode });
    if (!mismaNacion) avisos.push(`${r.name}: nación FIE ${r.countryCode}, oficial ${o.t.pais}`);
    if (!mismoPuesto) avisos.push(`${r.name}: puesto FIE ${r.position}, oficial ${o.puesto}`);
  }
  return avisos;
}

export const PREFIJO_CLAVE_OFICIAL = 'tarragona2018_oficial:';

/**
 * Filas de la clasificación oficial que la FIE no publicó, para añadirlas a las
 * suyas. Sólo si cada fila FIE casa con una oficial (si no, el tirador saldría
 * dos veces), cada fila oficial tiene acreditación única y ninguna añadida
 * queda por delante de la última FIE (la FIE publica los primeros puestos).
 */
export function filasQueFaltan(oficial: readonly PuestoOficial[], puestos: readonly PuestoBase[], alias: ReadonlyMap<string, Tirador>):
  { filas: HechosPrueba['results'] } | { motivo: string } {
  const casadas = new Set([...alias.values()].map((a) => a.nombre));
  const sinCasar = puestos.filter((r) => !casadas.has(r.name));
  if (sinCasar.length > 0) return { motivo: `filas_fie_sin_casar: ${sinCasar.map((r) => `${r.position} ${r.name} ${r.countryCode}`).join('; ')}` };
  const registros = oficial.map((o) => o.registro);
  if (registros.some((r) => !r) || new Set(registros).size !== registros.length) return { motivo: 'acreditacion_ausente_o_repetida' };
  const nuevas = oficial.filter((o) => !alias.has(compacto(o.t.nombre)));
  if (nuevas.length + puestos.length !== oficial.length) return { motivo: 'recuento_distinto' };
  return {
    filas: nuevas.map((o) => ({
      factKey: `${PREFIJO_CLAVE_OFICIAL}${o.registro}`, name: o.t.nombre, countryCode: o.t.pais, club: null, position: o.puesto,
      positionRaw: String(o.puesto), points: null, fieId: null, license: null, birthYear: null,
    })),
  };
}

const palabras = (s: string) => new Set(s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3));

/**
 * Nombre de la clasificación FIE para cada tirador de la oficial de los Juegos
 * con su mismo puesto (un empate de la oficial, 5-5-5-5, cubre los puestos
 * FIE 5 a 8), nación y al menos una palabra del nombre en común
 * («SIDIROPOULOU Niki Katerina» → «SIDIROPOULOU-CHRISTODOULOU Niki-Katerina»).
 * Clave: nombre compacto de la web.
 */
export function aliasPorPuesto(oficial: readonly { t: Tirador; puesto: number }[], puestos: readonly PuestoBase[]): Map<string, Tirador> {
  const alias = new Map<string, Tirador>();
  const banda = (p: number) => {
    const siguiente = oficial.map((o) => o.puesto).filter((x) => x > p).sort((a, b) => a - b)[0];
    return [p, (siguiente ?? p + 1) - 1] as const;
  };
  for (const r of puestos) {
    const pr = palabras(r.name);
    const c = oficial.filter((o) => {
      const [desde, hasta] = banda(o.puesto);
      return r.position !== null && r.position >= desde && r.position <= hasta && o.t.pais === r.countryCode &&
        [...palabras(o.t.nombre)].some((w) => pr.has(w));
    });
    if (c.length === 1 && !alias.has(compacto(c[0].t.nombre))) alias.set(compacto(c[0].t.nombre), { nombre: r.name, pais: r.countryCode });
  }
  return alias;
}

type Marcador = { a: number; b: number };
const marcador = (s: string | null): Marcador | null => {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(s ?? '');
  return m ? { a: +m[1], b: +m[2] } : null;
};

/** Asaltos de una poule y si sus «Points» cuadran; `motivo` si la matriz no es válida. */
export function asaltosPoule(p: PouleWeb): { bouts: BoutLeido[]; puntosCuadran: boolean } | { motivo: string } {
  const n = p.filas.length;
  if (n < 3 || p.filas.some((f) => f.celdas.length !== n)) return { motivo: 'matriz_no_cuadrada' };
  const v = new Array(n).fill(0);
  const bouts: BoutLeido[] = [];
  for (let i = 0; i < n; i += 1) {
    if (p.filas[i].celdas[i] !== null) return { motivo: 'diagonal_no_vacia' };
    for (let j = i + 1; j < n; j += 1) {
      const x = marcador(p.filas[i].celdas[j]);
      const y = marcador(p.filas[j].celdas[i]);
      if (!x || !y) return { motivo: 'celda_ilegible' };
      if (x.a !== y.b || x.b !== y.a) return { motivo: 'no_reciproca' };
      if (x.a === x.b || Math.max(x.a, x.b) > 5) return { motivo: 'marcador_imposible' };
      if (x.a > x.b) v[i] += 1;
      else v[j] += 1;
      bouts.push({ phase: 'POULE', roundKey: `P${p.numero}`, a: p.filas[i].tirador, b: p.filas[j].tirador, scoreA: x.a, scoreB: x.b, winner: null });
    }
  }
  return { bouts, puntosCuadran: p.filas.every((f, i) => f.puntos === 2 * v[i]) };
}

/** Orden FIE de las cabezas de serie en un cuadro de `t`: 1-16, 9-8, 5-12, 13-4, 3-14, 11-6, 7-10, 15-2. */
export function ordenCuadro(t: number): number[] {
  let o = [1, 2];
  while (o.length < t) {
    const m = o.length * 2 + 1;
    o = o.flatMap((s, i) => (i % 2 === 0 ? [s, m - s] : [m - s, s]));
  }
  return o;
}

type Stats = { v: number; m: number; td: number; tr: number };
/** Clasificación tras poules (V/M, indicador, TD) con los grupos de empate. */
export function clasificacionPoules(bouts: BoutLeido[]): { clave: string; stats: Stats }[] {
  const s = new Map<string, Stats>();
  const k = (t: Tirador) => compacto(t.nombre);
  for (const b of bouts) {
    for (const [t, a, c] of [[b.a, b.scoreA, b.scoreB], [b.b, b.scoreB, b.scoreA]] as const) {
      const x = s.get(k(t)) ?? { v: 0, m: 0, td: 0, tr: 0 };
      x.m += 1;
      x.v += a > c ? 1 : 0;
      x.td += a;
      x.tr += c;
      s.set(k(t), x);
    }
  }
  return [...s].map(([clave, stats]) => ({ clave, stats })).sort((x, y) =>
    y.stats.v / y.stats.m - x.stats.v / x.stats.m || (y.stats.td - y.stats.tr) - (x.stats.td - x.stats.tr) || y.stats.td - x.stats.td);
}

/**
 * Cada cruce de la primera ronda publicada enfrenta a las cabezas de serie que
 * le tocan según la clasificación tras poules (el orden dentro del cruce es
 * libre; un empate total en V/M, indicador y TD admite cualquiera de los dos).
 */
export function colocacionCoincide(clas: { clave: string; stats: Stats }[], primera: readonly (Tirador | null)[]): boolean {
  const orden = ordenCuadro(primera.length);
  const igual = (a: Stats, b: Stats) => a.v * b.m === b.v * a.m && a.td - a.tr === b.td - b.tr && a.td === b.td;
  const encaja = (t: Tirador | null, seed: number) => {
    const esperado = clas[seed - 1];
    if (!t) return !esperado;
    const real = clas.findIndex((c) => c.clave === compacto(t.nombre));
    return real >= 0 && esperado !== undefined && (real === seed - 1 || igual(clas[real].stats, esperado.stats));
  };
  for (let k = 0; k < primera.length / 2; k += 1) {
    const [x, y] = [primera[2 * k], primera[2 * k + 1]];
    const [s1, s2] = [orden[2 * k], orden[2 * k + 1]];
    if (!((encaja(x, s1) && encaja(y, s2)) || (encaja(x, s2) && encaja(y, s1)))) return false;
  }
  return primera.filter(Boolean).length === clas.length;
}

type InfoCuadro = { Phases: { Code: string; Desc: string }[]; Results: ([number | null, number | null, { Code: string }] | null)[][]; Partics: ({ flag: string; name: string } | null)[][] };

export function leerCuadro(html: string): InfoCuadro | null {
  const m = /Vue\.set\(appBracket, 'bracketInfo', JSON\.parse\('(.*?)'\)\)/s.exec(html);
  if (!m) return null;
  const info = JSON.parse(m[1].replace(/\\'/g, "'")) as InfoCuadro[];
  return info.find((x) => x.Phases?.length) ?? null;
}

const RONDA: Record<string, number> = { 'Round of 64': 64, 'Round of 32': 32, 'Round of 16': 16, Quarterfinals: 8, Semifinals: 4, Finals: 2 };

/** Asaltos del cuadro reconstruidos ronda a ronda; el ganador de cada uno pasa a la siguiente. */
export function asaltosCuadro(info: InfoCuadro): { bouts: (BoutLeido & { perdedor: Tirador; ganador: Tirador })[]; esperados: number; descartados: Record<string, number>; primera: (Tirador | null)[] } {
  const descartados: Record<string, number> = {};
  const fuera = (k: string) => (descartados[k] = (descartados[k] ?? 0) + 1);
  const t = (p: { flag: string; name: string } | null): Tirador | null =>
    p ? { nombre: p.name.trim(), pais: /flags\/([A-Z]{3})\.png/.exec(p.flag)?.[1] ?? null } : null;
  let actuales: (Tirador | null | undefined)[] = info.Partics.flatMap((par) => [t(par[0]), t(par[1])]);
  const primera = actuales.map((x) => x ?? null);
  const bouts: (BoutLeido & { perdedor: Tirador; ganador: Tirador })[] = [];
  let esperados = 0;
  info.Phases.forEach((fase, r) => {
    const tam = RONDA[fase.Desc.trim()];
    const siguientes: (Tirador | null | undefined)[] = [];
    const res = info.Results[r] ?? [];
    for (let k = 0; k < actuales.length / 2; k += 1) {
      const a = actuales[2 * k];
      const b = actuales[2 * k + 1];
      if (a === undefined || b === undefined) {
        siguientes.push(undefined);
        continue;
      }
      if (!a || !b) {
        siguientes.push(a ?? b ?? undefined);
        continue;
      }
      esperados += 1;
      const x = res[k];
      if (!tam || !x || x[0] === null || x[1] === null) {
        fuera('sin_marcador');
        siguientes.push(undefined);
        continue;
      }
      const [sa, sb] = [x[0], x[1]];
      if (sa === sb || Math.max(sa, sb) > 15 || sa < 0 || sb < 0) {
        fuera('marcador_imposible');
        siguientes.push(undefined);
        continue;
      }
      const ganador = sa > sb ? a : b;
      bouts.push({ phase: 'TABLEAU', roundKey: `A${tam}`, a, b, scoreA: sa, scoreB: sb, winner: null, ganador, perdedor: sa > sb ? b : a });
      siguientes.push(ganador);
    }
    actuales = siguientes;
  });
  return { bouts, esperados, descartados, primera };
}

async function ultimaCaptura(url: string): Promise<{ html: string; ts: string } | null> {
  const caps = (await cdx(url)).filter((c) => c.status === '200').sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  for (const c of caps.slice(0, 4)) {
    const d = await obtener(urlWayback(c.timestamp, c.original));
    const html = texto(d);
    if (html && html.length > 20_000) return { html, ts: c.timestamp };
  }
  return null;
}

async function main() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  const pendientes = new Map(objetivos(db).filter((p) => p.season === '2018').map((p) => [p.competitionKey, p]));
  const informe: Record<string, unknown>[] = [];
  for (const prueba of PRUEBAS) {
    const p = pendientes.get(prueba.competitionKey);
    if (!p || !/Tarragona/i.test(p.city ?? '')) {
      informe.push({ competitionKey: prueba.competitionKey, motivo: 'no es una prueba pendiente de Tarragona 2018' });
      continue;
    }
    const grupos = await ultimaCaptura(`${BASE}/groups/${prueba.codigo}`);
    const cuadroWeb = await ultimaCaptura(`${BASE}/brackets/${prueba.codigo}`);
    const info = cuadroWeb ? leerCuadro(cuadroWeb.html) : null;
    const cuadro = info ? asaltosCuadro(info) : null;

    const poules = grupos ? leerGrupos(grupos.html) : [];
    const lecturas = poules.map((q) => ({ q, r: asaltosPoule(q) }));
    const todos = lecturas.flatMap((x) => ('bouts' in x.r ? x.r.bouts : []));
    // Colocación del cuadro publicada frente a la calculada con los asaltos de las poules.
    let colocacion: 'coincide' | 'no_coincide' | 'sin_comprobar' = 'sin_comprobar';
    if (cuadro && lecturas.every((x) => 'bouts' in x.r) && todos.length > 0) {
      colocacion = colocacionCoincide(clasificacionPoules(todos), cuadro.primera) ? 'coincide' : 'no_coincide';
    }
    const descP: Record<string, number> = {};
    const boutsP: BoutLeido[] = [];
    let esperadosP = 0;
    for (const { q, r } of lecturas) {
      const k = q.filas.length;
      esperadosP += (k * (k - 1)) / 2;
      if ('motivo' in r) descP[`P${q.numero}:${r.motivo}`] = (k * (k - 1)) / 2;
      else if (!r.puntosCuadran && colocacion !== 'coincide') descP[`P${q.numero}:puntos_no_cuadran_y_colocacion_${colocacion}`] = r.bouts.length;
      else boutsP.push(...r.bouts);
    }

    const puestos = puestosDeBase(db, p.id);
    const clasWeb = await ultimaCaptura(`${BASE}/final-rank/${prueba.codigo}`);
    const oficial = clasWeb ? leerClasificacion(clasWeb.html) : [];
    // La clasificación FIE sólo trae los primeros, con otra grafía: cada fila suya debe tener en la oficial
    // de los Juegos el mismo puesto, la misma nación y alguna palabra del nombre en común.
    const alias = aliasPorPuesto(oficial, puestos);
    const discrepancias = aliasPorNombre(oficial, puestos, alias);
    const coincidencia = puestos.length ? alias.size / puestos.length : 0;
    const podio = puestos.filter((x) => (x.position ?? 99) <= 3).every((x) => [...alias.values()].some((a) => a.nombre === x.name));
    if (oficial.length === 0 || coincidencia < 0.75 || !podio) {
      informe.push({ competitionKey: prueba.competitionKey, motivo: `clasificación oficial ${oficial.length ? `distinta (solape ${coincidencia.toFixed(2)})` : 'no capturada'}` });
      continue;
    }
    const puestoDe = new Map(oficial.map((x) => [compacto(x.t.nombre), x.puesto]));
    const descT: Record<string, number> = { ...(cuadro?.descartados ?? {}) };
    const boutsT: BoutLeido[] = [];
    for (const b of cuadro?.bouts ?? []) {
      const tam = Number(b.roundKey.slice(1));
      const pp = puestoDe.get(compacto(b.perdedor.nombre));
      const pg = puestoDe.get(compacto(b.ganador.nombre));
      const rango: [number, number] | null = tam === 2 ? [2, 2] : tam === 4 ? [3, 4] : tam === 8 ? [5, 8] : null;
      if (rango && pp !== undefined && (pp < rango[0] || pp > rango[1])) {
        descT.puesto_final_incoherente = (descT.puesto_final_incoherente ?? 0) + 1;
        continue;
      }
      if (tam === 2 && pg !== undefined && pg !== 1) {
        descT.puesto_final_incoherente = (descT.puesto_final_incoherente ?? 0) + 1;
        continue;
      }
      boutsT.push({ phase: b.phase, roundKey: b.roundKey, a: b.a, b: b.b, scoreA: b.scoreA, scoreB: b.scoreB, winner: b.winner });
    }
    const renombrar = (t: Tirador) => alias.get(compacto(t.nombre)) ?? t;
    for (const b of [...boutsP, ...boutsT]) {
      b.a = renombrar(b.a);
      b.b = renombrar(b.b);
    }
    const lectura: Lectura = {
      arma: p.weapon, genero: p.gender, puestos: oficial.map((o) => ({ t: renombrar(o.t), puesto: o.puesto })),
      poules: grupos ? { bouts: boutsP, esperados: esperadosP, descartados: descP } : null,
      cuadro: cuadro ? { bouts: boutsT, esperados: cuadro.esperados, completo: true, descartados: descT } : null,
    };
    const url = `${BASE}/groups/${prueba.codigo}`;
    const fuentes = [grupos && `poules: captura ${grupos.ts} de ${url}`, cuadroWeb && `cuadro: captura ${cuadroWeb.ts} de ${BASE}/brackets/${prueba.codigo}`].filter(Boolean).join('; ');
    // Las filas FIE se copian tal cual y se añaden las oficiales que faltan. Como el fichero
    // trae todas las filas previas, el cargador lo aplica como `completo` sin borrar ninguna.
    const extension = filasQueFaltan(oficial, puestos, alias);
    const enOficial = new Set(oficial.map((o) => compacto(o.t.nombre)));
    const fueraDeClasificacion = [...new Set([...boutsP, ...boutsT].flatMap((b) => [b.a, b.b])
      .filter((t) => !enOficial.has(compacto(t.nombre)) && ![...alias.values()].some((a) => a.nombre === t.nombre)).map((t) => t.nombre))];
    const base = hechosBase(p, puestos);
    const urlClas = `${BASE}/final-rank/${prueba.codigo}`;
    const ampliada = 'filas' in extension && extension.filas.length > 0 && fueraDeClasificacion.length === 0
      ? hechosPrueba.parse({
        ...base,
        status: {
          ...base.status, results: 'completo', publishedParticipants: oficial.length,
          notes: [`Clasificación: ${puestos.length} filas FIE sin cambios y ${extension.filas.length} del ranking final oficial de los Juegos (captura ${clasWeb!.ts} de ${urlClas}), claves ${PREFIJO_CLAVE_OFICIAL}<acreditación de los Juegos>; identidad por nombre y nación (la web no da ID FIE)${discrepancias.length ? `; FIE y la clasificación oficial difieren (se conserva el dato FIE): ${discrepancias.join('; ')}` : ''}`],
        },
        results: [...base.results, ...extension.filas],
      })
      : base;
    const r = anadirAsaltos(ampliada, lectura, {
      nombre: 'tarragona2018_wayback', url,
      descripcion: `sistema oficial de resultados de Tarragona 2018 archivado en Wayback (${fuentes}); colocación del cuadro frente a poules: ${colocacion}`,
    });
    const doc = grupos ?? cuadroWeb;
    const h = soloFasesQueFaltan(hechosPrueba.parse({
      ...r.hechos, extractor: ampliada === base ? 'lote7_tarragona2018' : 'lote7_tarragona2018_oficial', sourceUrl: grupos ? urlWayback(grupos.ts, url) : urlWayback(cuadroWeb!.ts, `${BASE}/brackets/${prueba.codigo}`),
      sourceSha256: sha256(doc!.html),
    }), p);
    const fila = {
      competitionKey: prueba.competitionKey, codigo: prueba.codigo, capturas: { grupos: grupos?.ts ?? null, cuadro: cuadroWeb?.ts ?? null }, colocacion,
      pools: { importados: h.bouts.filter((x) => x.phase === 'POULE').length, esperados: esperadosP, estado: h.status.pools, descartados: r.informe.pools.descartados },
      tableau: { importados: h.bouts.filter((x) => x.phase === 'TABLEAU').length, esperados: cuadro?.esperados ?? 0, estado: h.status.tableau, descartados: r.informe.tableau.descartados },
      clasificados: puestos.length, solapeClasificacion: Number(coincidencia.toFixed(2)), sinCasar: r.informe.tiradores.sinCasar,
      clasificacion: {
        fie: puestos.length, oficial: oficial.length, anadidas: ampliada === base ? 0 : ampliada.results.length - puestos.length, estado: h.status.results,
        discrepancias,
        motivo: 'motivo' in extension ? extension.motivo : fueraDeClasificacion.length ? `tiradores_fuera_de_la_clasificacion: ${fueraDeClasificacion.join('; ')}` : null,
      },
    };
    informe.push(fila);
    console.log(JSON.stringify(fila));
    if (h.bouts.length > 0) writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
  }
  db.close();
  writeFileSync(join(CARPETA_LOTE7, 'tarragona-informe.json'), `${JSON.stringify({ generado: new Date().toISOString(), pruebas: informe }, null, 1)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
