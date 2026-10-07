/**
 * Criterium Nacional en Engarde (2022-2024): los cuatro ganadores del tablón de 8.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-criterium.ts [--db <nuevo9.sqlite>] [--hechos <calendario-trabajo/hechos>]
 *
 * Según las circulares de la RFEE (p. ej. la 14-24), el Criterium termina en el tablón de 8 «con
 * cuatro vencedores y cuatro finalistas»: no hay semifinales ni final. Engarde publica la
 * clasificación general desde el 5.º puesto (los finalistas) y deja a los cuatro ganadores fuera,
 * así que los ficheros de `hechos/engarde` y `hechos/lote7-engarde-rfee` no tienen puestos 1 a 4.
 * Los ganadores sí están en el cuadro: son los tiradores de la columna «Semi-finales» de la página
 * del tablón (ahí también aparecen quienes pasan sin asalto).
 *
 * Cada prueba se escribe en `hechos/lote10-rfee-criterium/` con su misma clave de Engarde, todas
 * sus fases y los ganadores con el puesto 1 compartido (`positionRaw` «1-4»), si:
 *  - la clasificación publicada empieza en el 5.º puesto y ningún ganador está en ella;
 *  - los ganadores de los asaltos del tablón de 8 están en la columna de semifinales y los
 *    perdedores tienen puesto entre el 5 y el 8;
 *  - si la base tiene la clasificación oficial de la RFEE (PDF de Skermo con «GANADORES» o
 *    «GANADORAS»), sus ganadores son exactamente los mismos.
 * Asaltos con marcadores imposibles (empate sin ganador, más de 5 tocados en poule o más de 15 en
 * el cuadro) no se escriben.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { fixDoubleEncodedUtf8 } from '../../src/lib/ingest/fetcher';
import { claveRondaCuadro } from '../../src/lib/ingest/sources/engarde-cuadro';
import { urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import { argumento, CARPETA_TRABAJO } from './comun';
import { paginasDePrueba } from './engarde-descargar';
import { nombresCompatibles } from './lote7-engarde-rfee';
import { dia, EscritorHechos } from './lote7-faltan-comun';
import { HECHOS_LOTE10, NUEVO9, redLote10 } from './lote10-red';

const CARPETAS_ORIGEN = ['lote7-engarde-rfee', 'lote7-faltan', 'lote7-pdf/engarde', 'lote7-pdf-opcional/engarde', 'lote8c-engarde'];
/** Cachés de Engarde de lotes anteriores con registro `{url, status, fichero}` (sólo lectura). */
const CACHES_PREVIAS = [
  join(CARPETA_TRABAJO, 'cache-lote7-faltan'),
  join(CARPETA_TRABAJO, 'cache-lote8c', 'engarde'),
  join(CARPETA_TRABAJO, 'cache-lote7-pdf', 'engarde', 'raw'),
  join(CARPETA_TRABAJO, 'cache-lote8', 'engarde-asaltos', 'raw'),
];
export const PUESTO_GANADOR = '1-4';

export class CachesPrevias {
  private readonly porUrl = new Map<string, string>();
  constructor(carpetas: readonly string[]) {
    for (const c of carpetas) {
      const reg = join(c, '_registro.jsonl');
      if (!existsSync(reg)) continue;
      for (const l of readFileSync(reg, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try {
          const r = JSON.parse(l) as { url?: string; status?: number; fichero?: string | null };
          if (r.url && r.status === 200 && r.fichero && !this.porUrl.has(r.url)) this.porUrl.set(r.url, join(c, r.fichero));
        } catch {
          // Línea truncada de una ejecución interrumpida.
        }
      }
    }
  }
  leer(url: string): string | null {
    const ruta = this.porUrl.get(url);
    return ruta && existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
  }
}

export type Semifinalista = { nombre: string; nacion: string | null };

/**
 * Tiradores de la columna de semifinales de una página de cuadro de Engarde (los ganadores del
 * tablón de 8) y nación/club de cada nombre en la primera columna. `null` si la página no tiene
 * columna de semifinales.
 */
export function semifinalistasDeCuadro(html: string): { semis: Semifinalista[]; tablon8: string[] } | null {
  const $ = cheerio.load(html);
  const tabla = $('table.tableau').first();
  if (tabla.length === 0) return null;
  const filas: { texto: string; clases: string[] }[][] = [];
  tabla.find('tr').each((_, tr) => {
    const celdas: { texto: string; clases: string[] }[] = [];
    $(tr).children('td').each((__, td) => {
      celdas.push({
        texto: fixDoubleEncodedUtf8($(td).text()).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
        clases: ($(td).attr('class') ?? '').split(/\s+/).filter(Boolean),
      });
    });
    filas.push(celdas);
  });
  const cabecera = filas.findIndex((f) => f.some((c) => c.clases.includes('tableTitle')));
  if (cabecera < 0) return null;
  const columnas = filas[cabecera].map((c, i) => ({ i, clave: c.clases.includes('tableTitle') && c.texto ? claveRondaCuadro(c.texto) : undefined }))
    .filter((c) => c.clave !== undefined);
  const sf = columnas.find((c) => c.clave === 'SF');
  const t8 = columnas.find((c) => c.clave === 'T8');
  if (!sf || !t8) return null;
  const primera = columnas[0].i;
  const nacion = new Map<string, string | null>();
  for (let f = cabecera + 1; f < filas.length; f += 1) {
    const x = filas[f][primera];
    if (x?.clases.includes('fencer') && x.texto) {
      const n = filas[f][primera + 1];
      nacion.set(x.texto, n?.clases.includes('nation') ? n.texto || null : null);
    }
  }
  const enColumna = (col: number) => {
    const out: string[] = [];
    for (let f = cabecera + 1; f < filas.length; f += 1) {
      const x = filas[f][col];
      if (x?.clases.includes('fencer') && x.texto) out.push(x.texto);
    }
    return out;
  };
  return { semis: enColumna(sf.i).map((nombre) => ({ nombre, nacion: nacion.get(nombre) ?? null })), tablon8: enColumna(t8.i) };
}

/** Asalto con un marcador que no puede darse en el Criterium (poules a 5 y eliminación directa a 10). */
export function marcadorImposible(b: Pick<AsaltoHecho, 'phase' | 'scoreA' | 'scoreB' | 'winner'>): boolean {
  if (b.scoreA === b.scoreB && !b.winner) return true;
  const max = Math.max(b.scoreA, b.scoreB);
  return b.phase === 'POULE' ? max > 5 : max > 15;
}

const ganadorDe = (b: AsaltoHecho): 'A' | 'B' => b.winner ?? (b.scoreA > b.scoreB ? 'A' : 'B');
const norm = (n: string) => normalizeSportName(n);
const mismoNombre = (a: string, b: string) => nombresCompatibles(norm(a), norm(b));

export function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = t;
    }
  }
  return d[b.length];
}

/** El PDF oficial trae erratas de tecleo («IBARRRA», «ZALZIVAR»): basta con dos letras de diferencia. */
const mismoNombreOficial = (a: string, b: string) => mismoNombre(a, b) || distancia(norm(a), norm(b)) <= 2;

export type Oficial = { id: string; key: string; ganadores: string[]; finalistas: string[] };

/** Clasificaciones oficiales de la RFEE (PDF de Skermo) del Criterium con ganadores sin puesto. */
function oficiales(db: DatabaseSync): (Oficial & { weapon: string; gender: string; category: string; d: number })[] {
  const filas = db.prepare(`
    SELECT c.id, c.competition_key k, c.weapon, c.gender, c.category, coalesce(c.competition_date, e.start_date) f,
           r.source_name n, upper(r.position_raw) raw
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id JOIN sport_result r ON r.competition_id = c.id
     WHERE c.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL' AND upper(e.name) LIKE '%CRITERIUM%'
       AND (upper(r.position_raw) LIKE 'GANADOR%' OR upper(r.position_raw) LIKE 'FINALISTA%')`).all() as Record<string, string>[];
  const porId = new Map<string, Oficial & { weapon: string; gender: string; category: string; d: number }>();
  for (const f of filas) {
    if (!f.f) continue;
    const o = porId.get(f.id) ?? porId.set(f.id, { id: f.id, key: f.k, ganadores: [], finalistas: [], weapon: f.weapon, gender: f.gender, category: f.category, d: dia(f.f.slice(0, 10)) }).get(f.id)!;
    (f.raw.startsWith('GANADOR') ? o.ganadores : o.finalistas).push(f.n);
  }
  return [...porId.values()];
}

function* ficheros(carpeta: string): Generator<string> {
  if (!existsSync(carpeta)) return;
  for (const f of readdirSync(carpeta)) if (f.endsWith('.json') && !f.startsWith('_')) yield join(carpeta, f);
}

export type Resultado =
  | { ok: true; hechos: HechosPrueba; ganadores: string[]; oficial: string | null; descartados: number }
  | { ok: false; motivo: string; detalle?: unknown };

/** Completa una prueba del Criterium con sus ganadores; sin escribir nada. */
export function completarCriterium(
  h: HechosPrueba,
  cuadro: { semis: Semifinalista[]; tablon8: string[] },
  candidatos: readonly Oficial[],
): Resultado {
  if (h.results.length === 0) return { ok: false, motivo: 'sin_clasificacion' };
  const puestos = h.results.map((r) => r.position).filter((p): p is number => p !== null);
  if (puestos.length === 0 || Math.min(...puestos) !== 5) return { ok: false, motivo: 'clasificacion_no_empieza_en_5', detalle: Math.min(...puestos) };
  const semis = cuadro.semis.filter((s, i, xs) => xs.findIndex((y) => norm(y.nombre) === norm(s.nombre)) === i);
  if (semis.length === 0 || semis.length > 4 || semis.length !== cuadro.semis.length) return { ok: false, motivo: 'semifinalistas_irregulares', detalle: cuadro.semis };
  if (semis.some((s) => h.results.some((r) => mismoNombre(r.name, s.nombre)))) return { ok: false, motivo: 'ganador_ya_clasificado' };
  if (semis.some((s) => !cuadro.tablon8.some((t) => norm(t) === norm(s.nombre)))) return { ok: false, motivo: 'ganador_fuera_del_tablon_de_8' };
  const t8 = h.bouts.filter((b) => b.phase === 'TABLEAU' && b.roundKey === 'T8');
  for (const b of t8) {
    const [g, p] = ganadorDe(b) === 'A' ? [b.aName, b.bName] : [b.bName, b.aName];
    if (!semis.some((s) => mismoNombre(s.nombre, g))) return { ok: false, motivo: 'ganador_t8_no_es_semifinalista', detalle: g };
    const r = h.results.find((x) => mismoNombre(x.name, p));
    if (!r || r.position === null || r.position < 5 || r.position > 8) return { ok: false, motivo: 'perdedor_t8_sin_puesto_5_8', detalle: p };
  }
  // Cotejo con la clasificación oficial de la RFEE: la que comparte más ganadores y finalistas.
  const nuestros = [...semis.map((s) => s.nombre), ...h.results.filter((r) => (r.position ?? 99) <= 8).map((r) => r.name)];
  let oficial: Oficial | null = null;
  let mejor = 0;
  for (const o of candidatos) {
    const suyos = [...o.ganadores, ...o.finalistas];
    const comunes = suyos.filter((x) => nuestros.some((y) => mismoNombreOficial(x, y))).length;
    if (comunes > mejor && comunes >= Math.ceil(Math.min(suyos.length, nuestros.length) / 2)) {
      mejor = comunes;
      oficial = o;
    }
  }
  let oficialIncompleta = false;
  if (oficial) {
    // Cada ganador oficial es uno de los nuestros y ningún finalista oficial está entre ellos. Una
    // lectura oficial con menos ganadores (PDF mal leído) vale si no contradice nada.
    const esGanador = (x: string) => semis.some((s) => mismoNombreOficial(x, s.nombre));
    const contradice = oficial.ganadores.some((x) => !esGanador(x)) || oficial.finalistas.some(esGanador);
    if (contradice) return { ok: false, motivo: 'ganadores_distintos_de_la_oficial', detalle: { oficial: oficial.key, suyos: oficial.ganadores, nuestros: semis.map((s) => s.nombre) } };
    oficialIncompleta = oficial.ganadores.length < semis.length;
  }

  const out: HechosPrueba = structuredClone(h);
  const refPorNombre = new Map<string, string>();
  for (const b of out.bouts) {
    refPorNombre.set(norm(b.aName), b.aRef);
    refPorNombre.set(norm(b.bName), b.bRef);
  }
  const claves = new Set(out.results.map((r) => r.factKey));
  const nuevos: ResultadoHecho[] = semis.map((s) => {
    let factKey = refPorNombre.get(norm(s.nombre)) ?? `engarde:${norm(s.nombre)}|${s.nacion ?? ''}`;
    if (claves.has(factKey)) factKey = `${factKey}|ganador`;
    claves.add(factKey);
    return {
      factKey, name: s.nombre, countryCode: null, club: s.nacion, position: 1, positionRaw: PUESTO_GANADOR,
      points: null, fieId: null, license: null, birthYear: null,
    };
  });
  out.results = [...nuevos, ...out.results];
  const antes = out.bouts.length;
  out.bouts = out.bouts.filter((b) => !marcadorImposible(b));
  const descartados = antes - out.bouts.length;
  if (descartados > 0) {
    if (out.bouts.some((b) => b.phase === 'POULE')) out.status.pools = 'parcial';
    out.status.tableau = 'parcial';
  }
  out.status.results = 'completo';
  if (out.status.publishedParticipants !== null) out.status.publishedParticipants = out.results.length;
  out.status.notes = [
    ...out.status.notes,
    `Ganadores del tablón de 8 añadidos con el puesto 1 compartido («${PUESTO_GANADOR}»): el Criterium termina en el tablón de 8 con cuatro vencedores y cuatro finalistas (circulares de la RFEE) y Engarde publica la clasificación desde el 5.º puesto`,
    oficial
      ? `Ganadores cotejados con la clasificación oficial de la RFEE ${oficial.key}${oficialIncompleta ? ` (su lectura sólo trae ${oficial.ganadores.length} ganadores; ninguno contradice el cuadro)` : ''}`
      : 'Sin clasificación oficial de la RFEE con la que cotejar los ganadores',
    ...(descartados > 0 ? [`${descartados} asaltos con marcadores imposibles no se incluyen`] : []),
  ];
  return { ok: true, hechos: hechosPrueba.parse(out), ganadores: semis.map((s) => s.nombre), oficial: oficial?.key ?? null, descartados };
}

async function main(): Promise<void> {
  const raiz = argumento('hechos', join(CARPETA_TRABAJO, 'hechos'));
  const db = new DatabaseSync(argumento('db', NUEVO9), { readOnly: true });
  const ofs = oficiales(db);
  db.close();
  const previas = new CachesPrevias(CACHES_PREVIAS);
  const red = redLote10('engarde');
  const pagina = async (url: string): Promise<string | null> => {
    const p = previas.leer(url);
    if (p !== null) return p;
    const r = await red.get(url);
    return r.status === 200 ? r.body.toString('utf8') : null;
  };

  // Mejor lectura de cada prueba del Criterium: la de más puestos y, a igualdad, más asaltos.
  const elegidas = new Map<string, { h: HechosPrueba; ruta: string }>();
  for (const carpeta of CARPETAS_ORIGEN) {
    for (const ruta of ficheros(join(raiz, carpeta))) {
      const h = JSON.parse(readFileSync(ruta, 'utf8')) as HechosPrueba;
      if (h.source !== 'engarde' || h.competition.format !== 'INDIVIDUAL' || !/criterium/i.test(h.edition.name)) continue;
      if (!h.competition.competitionKey.startsWith('engarde:rfee/')) continue;
      const k = h.competition.competitionKey;
      const previa = elegidas.get(k);
      const peso = (x: HechosPrueba) => x.results.length * 10_000 + x.bouts.length;
      if (!previa || peso(h) > peso(previa.h)) elegidas.set(k, { h, ruta });
    }
  }

  const escritor = new EscritorHechos('lector_engarde', HECHOS_LOTE10('criterium'));
  const detalle: Record<string, unknown>[] = [];
  const motivos: Record<string, number> = {};
  const totales = { ficheros: 0, ganadores: 0, puestos: 0, poules: 0, cuadro: 0, conOficial: 0, asaltosDescartados: 0 };
  for (const [k, { h, ruta }] of [...elegidas].sort(([a], [b]) => a.localeCompare(b))) {
    const puestos = h.results.map((r) => r.position).filter((p): p is number => p !== null);
    if (h.results.length === 0 || Math.min(...puestos) <= 4) continue;
    const [, org, evt, compe] = /^engarde:([^/]+)\/([^/]+)\/(.+)$/.exec(k)!;
    const portada = await pagina(urlPruebaEngarde(org, evt, compe));
    let cuadro: { semis: Semifinalista[]; tablon8: string[] } | null = null;
    for (const f of portada ? paginasDePrueba(portada, org, evt, compe).filter((x) => /^tableau/i.test(x)) : []) {
      const html = await pagina(`${urlPruebaEngarde(org, evt, compe)}/${f}`);
      const c = html ? semifinalistasDeCuadro(html) : null;
      if (c && c.semis.length > 0) {
        cuadro = c;
        break;
      }
    }
    const fecha = h.competition.date ?? h.edition.startDate;
    const candidatos = ofs.filter((o) => o.weapon === h.competition.weapon && o.category === h.competition.category && fecha && Math.abs(o.d - dia(fecha)) <= 1 &&
      (o.gender === h.competition.gender || o.gender === 'MIXTO' || h.competition.gender === 'MIXTO'));
    const r: Resultado = cuadro ? completarCriterium(h, cuadro, candidatos) : { ok: false, motivo: portada ? 'cuadro_sin_semifinales' : 'sin_pagina_de_prueba' };
    if (!r.ok) {
      motivos[r.motivo] = (motivos[r.motivo] ?? 0) + 1;
      detalle.push({ prueba: k, origen: dirname(ruta).split(/[\\/]/).pop(), motivo: r.motivo, detalle: r.detalle });
      continue;
    }
    escritor.escribir(r.hechos);
    motivos.escrita = (motivos.escrita ?? 0) + 1;
    totales.ficheros += 1;
    totales.ganadores += r.ganadores.length;
    totales.puestos += r.hechos.results.length;
    totales.poules += r.hechos.bouts.filter((b) => b.phase === 'POULE').length;
    totales.cuadro += r.hechos.bouts.filter((b) => b.phase === 'TABLEAU').length;
    totales.asaltosDescartados += r.descartados;
    if (r.oficial) totales.conOficial += 1;
    detalle.push({ prueba: k, origen: dirname(ruta).split(/[\\/]/).pop(), motivo: 'escrita', ganadores: r.ganadores, oficial: r.oficial, puestos: r.hechos.results.length });
  }
  escritor.limpiarAntiguos();
  const informe = { generado: new Date().toISOString(), pruebasCriterium: elegidas.size, totales, motivos, peticiones: red.peticiones, detalle };
  escritor.informe('criterium', informe);
  console.log(JSON.stringify({ ...informe, detalle: detalle.filter((d) => d.motivo !== 'escrita') }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
