/**
 * Lote 13, punto 3: cruces del cuadro `rfee_pdf` que siguen con la ronda que les dio el lector
 * antiguo de cuadros (rotulaba mal «Semi-finals», «Semi-finais»… y corría las rondas: A2→A4,
 * A2→A8, A4→A16). El lote 12 corrigió el lector y lo midió en
 * `hechos/lote12-correccion-pdf/_precision.json` (`cuadroCambiaDeRonda`): 24 cruces de la base
 * seguían con la ronda antigua.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-rondas.ts [--db <nuevo13.sqlite>] \
 *     [--precision <_precision.json>] [--cache <cache-rfee-2018>] [--correcciones <rondas-correcciones.json>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-rondas.ts --db <copia.sqlite> --aplicar \
 *     [--correcciones <rondas-correcciones.json>] [--informe <json>]
 *
 * Ensayo (por defecto, base en sólo lectura): relee con el lector actual los PDF de
 * `cuadroCambiaDeRonda.pdfs` y escribe las correcciones con su evidencia. Un cruce guardado se
 * corrige (sólo su `round_key`, por id) si:
 *  - en el cuadro del PDF releído está la misma pareja (nombres compatibles) con el mismo
 *    marcador orientado UNA sola vez, en otra ronda, y ese cruce del PDF es fiable
 *    (`asaltosFiables`: marcador explícito y posible, coherente con el cuadro y la clasificación);
 *  - la prueba no tiene ya esa pareja en la ronda nueva ni otro asalto con la misma clave;
 *  - con todos los cambios de la prueba, el cuadro guardado no queda menos coherente
 *    (`consistenciaCuadro`) y ningún cruce cambiado queda incoherente. Todo o nada por prueba.
 * Lo demás queda en `dudas`.
 *
 * Aplicación (`--aplicar`, nunca sobre las bases protegidas de `lote13-comun.ts`): por id, si el
 * asalto sigue con la ronda, refs y marcador vistos → `round_key` nuevo, `content_hash`
 * recalculado, `revision`+1 y `revised_at` (para que `sincronizar-d1.ts` lo lleve a D1). Si ya tiene
 * la ronda nueva cuenta como `yaAplicada` (idempotente); si cambió, `obsoleta`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { consistenciaCuadro } from '../../src/lib/ingest/hechos/cuadro-consistencia';
import type { PistasPrueba } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { Arma, Genero } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { ahora, argumento, bandera, CARPETA_CACHES, CARPETA_TRABAJO, jsonCanonico, sha256 } from './comun';
import { mismoTexto, type AsaltoBase } from './lote10-pdf-auditar';
import { asaltosFiables, elegirPrueba, leerCuadros, type CuadroPdf, type LecturaCuadros } from './lote12-pdf-auditar';
import { asegurarCarpetaInformes, conBase, corto, NUEVO13 } from './lote13-comun';
import { cargarManifiesto, rutaBlob } from './pdf-relectura-objetivos';

export const PRECISION_12 = join(CARPETA_TRABAJO, 'hechos', 'lote12-correccion-pdf', '_precision.json');
const FUENTE = 'rfee_pdf';

export type AsaltoGuardado = AsaltoBase & { competitionKey: string };

export type CorreccionRonda = {
  asalto: string;
  competicion: string;
  competitionKey: string;
  url: string;
  antes: string;
  despues: string;
  aRef: string;
  bRef: string;
  aNombre: string;
  bNombre: string;
  sa: number;
  sb: number;
  evidencia: { prueba: string; rondaOriginal: string; pagina: number | null; cruce: string };
};
export type DudaRonda = { asalto: string; competicion: string; url: string; ronda: string; rondaPdf: string | null; motivo: string; cruce: string };

/** El cruce del PDF con la misma pareja y el mismo marcador orientado que el guardado. */
function mismoCruce(g: AsaltoBase, x: CuadroPdf['cuadro'][number]): boolean {
  const directo = mismoTexto(g.aNombre, x.nombreA) && mismoTexto(g.bNombre, x.nombreB) && g.sa === x.puntosA && g.sb === x.puntosB;
  const cruzado = mismoTexto(g.aNombre, x.nombreB) && mismoTexto(g.bNombre, x.nombreA) && g.sa === x.puntosB && g.sb === x.puntosA;
  return directo || cruzado;
}

const texto = (g: AsaltoBase) => `${g.ronda} ${g.aNombre} ${g.sa}-${g.sb} ${g.bNombre}`;

const tamano = (ronda: string): number | null => {
  const m = /^[ATB](\d+)$/.exec(ronda);
  return m ? Number(m[1]) : null;
};

/**
 * La ronda del PDF escrita como la guarda la base: los droids guardan `T16` donde el lector
 * escribe `A16` (la misma ronda). Sólo cambia el tamaño; el prefijo guardado se conserva.
 */
export function rondaEnBase(guardada: string, pdf: string): string {
  const n = tamano(pdf);
  const prefijo = /^([ATB])\d+$/.exec(guardada)?.[1];
  return n !== null && prefijo ? `${prefijo}${n}` : pdf;
}

export const mismaRonda = (guardada: string, pdf: string): boolean => rondaEnBase(guardada, pdf) === guardada;

/**
 * Correcciones de ronda de los cruces guardados de una prueba (una URL de PDF) frente al cuadro
 * releído. `todos`: todos los asaltos de cuadro de la prueba (para colisiones y coherencia).
 */
export function planRondas(guardados: readonly AsaltoGuardado[], todos: readonly AsaltoBase[], prueba: CuadroPdf, fiables: ReadonlySet<number>):
  { cambios: CorreccionRonda[]; dudas: DudaRonda[] } {
  const cambios: CorreccionRonda[] = [];
  const dudas: DudaRonda[] = [];
  const duda = (g: AsaltoGuardado, rondaPdf: string | null, motivo: string) =>
    dudas.push({ asalto: g.id, competicion: g.competicion, url: g.url, ronda: g.ronda, rondaPdf, motivo, cruce: texto(g) });
  for (const g of guardados) {
    const cands = prueba.cuadro.map((x, i) => ({ x, i })).filter(({ x }) => mismoCruce(g, x));
    if (cands.length === 0 || cands.some(({ x }) => mismaRonda(g.ronda, x.ronda))) continue;
    if (cands.length > 1) { duda(g, cands.map(({ x }) => x.ronda).join('/'), 'cruce_repetido_en_el_pdf'); continue; }
    const [{ x, i }] = cands;
    const despues = rondaEnBase(g.ronda, x.ronda);
    if (!fiables.has(i)) { duda(g, x.ronda, 'cruce_pdf_no_fiable'); continue; }
    const otro = todos.find((b) => b.id !== g.id && b.ronda === despues &&
      ((mismoTexto(b.aNombre, g.aNombre) && mismoTexto(b.bNombre, g.bNombre)) || (mismoTexto(b.aNombre, g.bNombre) && mismoTexto(b.bNombre, g.aNombre))));
    if (otro) { duda(g, x.ronda, `pareja_ya_en_la_ronda_nueva:${corto(otro.id)}`); continue; }
    if (todos.some((b) => b.id !== g.id && b.ronda === despues && b.aRef === g.aRef && b.bRef === g.bRef)) { duda(g, x.ronda, 'clave_ocupada'); continue; }
    cambios.push({
      asalto: g.id, competicion: g.competicion, competitionKey: g.competitionKey, url: g.url, antes: g.ronda, despues,
      aRef: g.aRef, bRef: g.bRef, aNombre: g.aNombre, bNombre: g.bNombre, sa: g.sa, sb: g.sb,
      evidencia: { prueba: prueba.clave, rondaOriginal: x.rondaOriginal, pagina: x.region?.pagina ?? null, cruce: `${x.ronda} ${x.nombreA} ${x.puntosA}-${x.puntosB} ${x.nombreB}` },
    });
  }
  if (cambios.length === 0) return { cambios, dudas };
  const nueva = new Map(cambios.map((c) => [c.asalto, c.despues]));
  const aCuadro = (rondaDe: (b: AsaltoBase) => string) => todos.map((b) => ({ roundKey: rondaDe(b), aRef: b.aRef, bRef: b.bRef, scoreA: b.sa, scoreB: b.sb }));
  const antes = consistenciaCuadro(aCuadro((b) => b.ronda));
  const despues = consistenciaCuadro(aCuadro((b) => nueva.get(b.id) ?? b.ronda));
  const cambiadoIncoherente = todos.some((b, i) => nueva.has(b.id) && despues.incoherentes.has(i));
  if (despues.incoherentes.size > antes.incoherentes.size || cambiadoIncoherente) {
    for (const c of cambios) {
      dudas.push({ asalto: c.asalto, competicion: c.competicion, url: c.url, ronda: c.antes, rondaPdf: c.despues,
        motivo: `empeora_coherencia:${antes.incoherentes.size}->${despues.incoherentes.size}`, cruce: `${c.antes} ${c.aNombre} ${c.sa}-${c.sb} ${c.bNombre}` });
    }
    return { cambios: [], dudas };
  }
  return { cambios, dudas };
}

export type PlanRondas = {
  generado: string;
  base: string;
  pdfs: number;
  pdfsLeidos: number;
  fallos: Record<string, number>;
  pruebas: number;
  correcciones: CorreccionRonda[];
  dudas: DudaRonda[];
  transiciones: Record<string, number>;
};

const ARMAS = new Set(['ESPADA', 'FLORETE', 'SABLE']);
const GENEROS = new Set(['M', 'F', 'MIXTO']);

export async function planificarRondas(db: DatabaseSync, urls: readonly string[], cache: string, base: string): Promise<PlanRondas> {
  const plan: PlanRondas = { generado: new Date().toISOString(), base, pdfs: urls.length, pdfsLeidos: 0, fallos: {}, pruebas: 0, correcciones: [], dudas: [], transiciones: {} };
  const manifiesto = cargarManifiesto(cache);
  const qGuardados = db.prepare(
    `SELECT b.id, b.competition_id c, c.competition_key k, c.weapon w, c.gender g, b.round_key r, b.fencer_a_ref ar, b.fencer_b_ref br,
            b.fencer_a_name an, b.fencer_b_name bn, b.fencer_a_person_id ap, b.fencer_b_person_id bp, b.score_a sa, b.score_b sb, b.source_url u
       FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
      WHERE b.source = ? AND b.phase = 'TABLEAU' AND (b.source_url = ? OR b.source_url LIKE ? ESCAPE '\\')`,
  );
  const qTodos = db.prepare(
    `SELECT id, competition_id c, round_key r, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an, fencer_b_name bn, fencer_a_person_id ap,
            fencer_b_person_id bp, score_a sa, score_b sb, source_url u FROM sport_bout WHERE competition_id = ? AND source = ? AND phase = 'TABLEAU'`,
  );
  type Fila = Record<string, string | number | null>;
  const aBase = (r: Fila): AsaltoBase => ({
    id: String(r.id), competicion: String(r.c), fase: 'TABLEAU', ronda: String(r.r), aRef: String(r.ar), bRef: String(r.br),
    aNombre: String(r.an ?? ''), bNombre: String(r.bn ?? ''), aPersona: (r.ap as string) ?? null, bPersona: (r.bp as string) ?? null,
    sa: Number(r.sa), sb: Number(r.sb), url: String(r.u ?? '').split('#')[0],
  });
  const lecturas = new Map<string, LecturaCuadros | string>();
  for (const url of urls) {
    const escapada = url.replace(/[\\%_]/g, (c) => `\\${c}`);
    const filas = qGuardados.all(FUENTE, url, `${escapada}#%`) as Fila[];
    const porComp = new Map<string, Fila[]>();
    for (const f of filas) (porComp.get(String(f.c)) ?? porComp.set(String(f.c), []).get(String(f.c))!).push(f);
    for (const [comp, fs] of porComp) {
      plan.pruebas += 1;
      const w = String(fs[0].w ?? '');
      const g = String(fs[0].g ?? '');
      const pistas: PistasPrueba = { arma: ARMAS.has(w) ? (w as Arma) : null, genero: GENEROS.has(g) ? (g as Genero) : null };
      const k = `${url}|${pistas.arma}|${pistas.genero}`;
      if (!lecturas.has(k)) {
        const unidad = manifiesto.get(url);
        let l: LecturaCuadros | string;
        if (!unidad || !existsSync(rutaBlob(cache, unidad))) l = 'pdf_no_en_cache';
        else {
          try { l = await leerCuadros(new Uint8Array(readFileSync(rutaBlob(cache, unidad))), url, pistas); } catch (e) { l = `error:${e instanceof Error ? e.message : String(e)}`.slice(0, 160); }
        }
        lecturas.set(k, l);
      }
      const l = lecturas.get(k)!;
      if (typeof l === 'string') { plan.fallos[l] = (plan.fallos[l] ?? 0) + 1; continue; }
      const guardados = fs.map((f): AsaltoGuardado => ({ ...aBase(f), competitionKey: String(f.k) }));
      const todos = (qTodos.all(comp, FUENTE) as Fila[]).map(aBase);
      const familias = [...new Set(guardados.map((b) => (b.ronda.startsWith('B') ? 'B' : 'A')))];
      for (const fam of familias) {
        const delaFamilia = guardados.filter((b) => (b.ronda.startsWith('B') ? 'B' : 'A') === fam);
        const prueba = elegirPrueba(delaFamilia, l.pruebas);
        if (!prueba) { plan.fallos.prueba_pdf_no_casa = (plan.fallos.prueba_pdf_no_casa ?? 0) + 1; continue; }
        const previa = fam === 'A' && familias.includes('B');
        const r = planRondas(delaFamilia, todos, prueba, asaltosFiables(prueba, previa));
        plan.correcciones.push(...r.cambios);
        plan.dudas.push(...r.dudas);
      }
    }
  }
  plan.pdfsLeidos = [...lecturas.values()].filter((x) => typeof x !== 'string').length;
  for (const c of plan.correcciones) plan.transiciones[`${c.antes}->${c.despues}`] = (plan.transiciones[`${c.antes}->${c.despues}`] ?? 0) + 1;
  return plan;
}

// ------------------------------------------------------------------ aplicación

export type InformeAplicacionRondas = { correcciones: number; aplicadas: number; yaAplicadas: number; obsoletas: { asalto: string; motivo: string }[] };

const hashAsalto = (competitionKey: string, b: { phase: string; roundKey: string; aRef: string; bRef: string; aName: string; bName: string; scoreA: number; scoreB: number }) =>
  sha256(jsonCanonico({ source: FUENTE, competitionKey, fact: { ...b, winner: null } }));

export function aplicarRondas(db: DatabaseSync, correcciones: readonly CorreccionRonda[]): InformeAplicacionRondas {
  const inf: InformeAplicacionRondas = { correcciones: correcciones.length, aplicadas: 0, yaAplicadas: 0, obsoletas: [] };
  const leer = db.prepare(`SELECT competition_id c, source s, phase f, round_key r, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an, fencer_b_name bn,
      score_a sa, score_b sb FROM sport_bout WHERE id = ?`);
  const ocupada = db.prepare(`SELECT 1 FROM sport_bout WHERE competition_id=? AND source=? AND phase='TABLEAU' AND round_key=? AND fencer_a_ref=? AND fencer_b_ref=? AND id<>?`);
  const actualizar = db.prepare(`UPDATE sport_bout SET round_key=?, content_hash=?, revision=revision+1, revised_at=? WHERE id=?`);
  for (const c of correcciones) {
    const b = leer.get(c.asalto) as Record<string, string | number> | undefined;
    if (!b) { inf.obsoletas.push({ asalto: c.asalto, motivo: 'no_esta' }); continue; }
    const igual = b.c === c.competicion && b.s === FUENTE && b.f === 'TABLEAU' && b.ar === c.aRef && b.br === c.bRef && Number(b.sa) === c.sa && Number(b.sb) === c.sb;
    if (!igual) { inf.obsoletas.push({ asalto: c.asalto, motivo: 'asalto_distinto' }); continue; }
    if (b.r === c.despues) { inf.yaAplicadas += 1; continue; }
    if (b.r !== c.antes) { inf.obsoletas.push({ asalto: c.asalto, motivo: `ronda_${b.r}` }); continue; }
    if (ocupada.get(c.competicion, FUENTE, c.despues, c.aRef, c.bRef, c.asalto)) { inf.obsoletas.push({ asalto: c.asalto, motivo: 'clave_ocupada' }); continue; }
    actualizar.run(c.despues, hashAsalto(c.competitionKey, { phase: 'TABLEAU', roundKey: c.despues, aRef: c.aRef, bRef: c.bRef,
      aName: String(b.an), bName: String(b.bn), scoreA: c.sa, scoreB: c.sb }), ahora(), c.asalto);
    inf.aplicadas += 1;
  }
  return inf;
}

async function main(): Promise<void> {
  const rutaDb = argumento('db', NUEVO13);
  const aplicar = bandera('aplicar');
  const carpeta = asegurarCarpetaInformes();
  const rutaCorr = argumento('correcciones', join(carpeta, 'rondas-correcciones.json'));
  if (aplicar) {
    if (!existsSync(rutaCorr)) throw new Error(`Falta ${rutaCorr}: ejecuta antes el ensayo`);
    const plan = JSON.parse(readFileSync(rutaCorr, 'utf8')) as PlanRondas;
    const inf = conBase(rutaDb, true, (db) => aplicarRondas(db, plan.correcciones));
    const salida = argumento('informe', join(carpeta, 'rondas-aplicado.json'));
    writeFileSync(salida, JSON.stringify(inf, null, 2));
    console.log(JSON.stringify(inf, null, 2));
    return;
  }
  const precision = JSON.parse(readFileSync(argumento('precision', PRECISION_12), 'utf8')) as { cuadroCambiaDeRonda: { pdfs: string[] } };
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const conexion = new DatabaseSync(rutaDb, { readOnly: true });
  let plan: PlanRondas;
  try {
    plan = await planificarRondas(conexion, precision.cuadroCambiaDeRonda.pdfs, cache, rutaDb);
  } finally {
    conexion.close();
  }
  writeFileSync(rutaCorr, JSON.stringify(plan, null, 1));
  const { correcciones, dudas, ...resumen } = plan;
  console.log(JSON.stringify({ ...resumen, correcciones: correcciones.length, dudas: dudas.length,
    motivosDudas: dudas.reduce<Record<string, number>>((o, d) => ({ ...o, [d.motivo.split(':')[0]]: (o[d.motivo.split(':')[0]] ?? 0) + 1 }), {}) }, null, 2));
  for (const c of correcciones.slice(0, 30)) console.log(`${corto(c.asalto)} ${corto(c.competicion)} ${c.antes}->${c.despues} ${c.aNombre} ${c.sa}-${c.sb} ${c.bNombre} [${c.evidencia.rondaOriginal} p${c.evidencia.pagina}]`);
  console.log(`Ensayo: nada guardado en la base. Correcciones: ${rutaCorr}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
