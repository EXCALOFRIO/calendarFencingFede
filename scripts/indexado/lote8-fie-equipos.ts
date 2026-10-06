/**
 * Cuadro de las pruebas FIE por equipos (lote 8), que el lector FIE común descarta a propósito
 * (`excluidos.equipo`): la API pública `fie.org/api/fie/competition/<temporada>/<id>/results/tableau`
 * publica cada encuentro con el ID FIE de los dos equipos y el marcador final del relevo.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8-fie-equipos.ts \
 *     [--huecos <cobertura/huecos-tras-lote7.json>] [--db <nuevo7.sqlite>] [--max 4000] [--sin-red]
 *
 * Objetivos: pruebas FIE por equipos celebradas sin cuadro tras el lote 7, en el orden de
 * prioridad del fichero de huecos. Por prueba escribe `hechos/lote8-fie-equipos/fie__<temporada>__<id>.json`
 * con las MISMAS claves de edición y prueba que nuevo7, sin clasificación (`results` vacío: la
 * existente se conserva) y con los encuentros en `TABLEAU`, referencias `team:<id FIE>` como los
 * puestos. Validación contra la clasificación oficial: el ganador y el perdedor de la final (`A2`)
 * tienen que ser el 1.º y el 2.º, y cada equipo del cuadro tiene que estar clasificado; si no,
 * la prueba no se escribe. Encuentros con marcador imposible (más de 45, ganador con menos
 * tocados, empate sin ganador) se descartan y se anotan. Las temporadas antiguas publican el
 * cuadro sin nombre de ronda: no se escribe (no hay ronda que guardar).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { CARPETA_COBERTURA, NUEVO7_COBERTURA } from './cobertura';
import { enParalelo, HECHOS_LOTE8, RedLote8, texto } from './lote8-red';

export const SALIDA_FIE_EQUIPOS = HECHOS_LOTE8('fie-equipos');
const ESTADO_RETIRADA = /^(A|M|N|E|F|MED|DNF|DNS|EXC)$/;
const MAX_TOCADOS = 45;

export const urlCuadroFie = (season: string, id: string) => `https://fie.org/api/fie/competition/${season}/${id}/results/tableau`;

type Lado = { name?: unknown; id?: unknown; isWinner?: unknown; score?: unknown; status?: unknown; newStatus?: unknown } | null | undefined;
type Cruce = { fencer1?: Lado; fencer2?: Lado; isBye?: unknown };

export type EquipoClasificado = { ref: string; nombre: string; puesto: number | null; pais?: string | null };
export type LecturaCuadroEquipos = {
  bouts: AsaltoHecho[];
  descartes: Record<string, number>;
  rondasSinNombre: number;
};

const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** Encuentros del cuadro FIE por equipos, orientados (`aRef < bRef`) y con los motivos de descarte. */
export function encuentrosCuadroFie(json: unknown, equipos: ReadonlyMap<string, EquipoClasificado>): LecturaCuadroEquipos {
  const descartes: Record<string, number> = {};
  const descartar = (m: string) => (descartes[m] = (descartes[m] ?? 0) + 1);
  const bouts: AsaltoHecho[] = [];
  let rondasSinNombre = 0;
  const vistos = new Set<string>();
  const tableau = (json as { tableau?: unknown })?.tableau;
  if (!Array.isArray(tableau)) return { bouts, descartes: { sin_cuadro: 1 }, rondasSinNombre };
  for (const suite of tableau as { suiteTableId?: unknown; rounds?: Record<string, unknown> }[]) {
    // Algunas pruebas publican el bronce en `SuiteTab_B` con la ronda «A2»: la letra de la
    // ronda se toma de la serie para no confundirlo con la final.
    const letra = typeof suite?.suiteTableId === 'string' ? /^SuiteTab_([A-Z])$/.exec(suite.suiteTableId)?.[1] ?? null : null;
    for (const [nombreRonda, cruces] of Object.entries(suite?.rounds ?? {})) {
      if (!Array.isArray(cruces)) continue;
      if (!nombreRonda.trim()) {
        rondasSinNombre += cruces.length;
        continue;
      }
      const ronda = letra ? nombreRonda.trim().replace(/^[A-Z](?=\d+$)/, letra) : nombreRonda.trim();
      for (const c of cruces as Cruce[]) {
        const f1 = c?.fencer1;
        const f2 = c?.fencer2;
        const id1 = entero(f1?.id);
        const id2 = entero(f2?.id);
        if (c?.isBye === true || id1 === null || id2 === null) {
          descartar('bye');
          continue;
        }
        if (id1 === id2) {
          descartar('mismo_equipo');
          continue;
        }
        const s1 = entero(f1?.score);
        const s2 = entero(f2?.score);
        const w1 = f1?.isWinner === true;
        const w2 = f2?.isWinner === true;
        const perdedor = w1 ? f2 : f1;
        if ([perdedor?.status, perdedor?.newStatus].some((s) => typeof s === 'string' && ESTADO_RETIRADA.test(s.trim().toUpperCase()))) {
          descartar('retirada');
          continue;
        }
        if (s1 === null || s2 === null) {
          descartar('sin_marcador');
          continue;
        }
        if (s1 > MAX_TOCADOS || s2 > MAX_TOCADOS || s1 < 0 || s2 < 0) {
          descartar('marcador_imposible_mas_de_45');
          continue;
        }
        if (w1 === w2) {
          descartar('ganador_no_unico');
          continue;
        }
        if ((w1 && s1 < s2) || (w2 && s2 < s1)) {
          descartar('marcador_imposible_ganador_con_menos');
          continue;
        }
        const r1 = `team:${id1}`;
        const r2 = `team:${id2}`;
        const swap = r1 > r2;
        const [aRef, bRef] = swap ? [r2, r1] : [r1, r2];
        const [sa, sb] = swap ? [s2, s1] : [s1, s2];
        const nombre = (ref: string, lado: Lado) => equipos.get(ref)?.nombre ?? (typeof lado?.name === 'string' && lado.name.trim() ? lado.name.trim() : ref);
        const clave = `${ronda}|${aRef}|${bRef}`;
        if (vistos.has(clave)) {
          descartar('duplicado');
          continue;
        }
        vistos.add(clave);
        bouts.push({
          phase: 'TABLEAU', roundKey: ronda, aRef, bRef,
          aName: nombre(aRef, swap ? f2 : f1), bName: nombre(bRef, swap ? f1 : f2), scoreA: sa, scoreB: sb,
          winner: sa === sb ? ((w1 !== swap) ? 'A' : 'B') : null,
        });
      }
    }
  }
  // El mismo cuadro publicado dos veces (rondas A y F): mismo par y marcador; queda el de `A<n>`.
  const porCruce = new Map<string, AsaltoHecho[]>();
  for (const b of bouts) {
    const k = `${b.aRef}|${b.bRef}|${b.scoreA}|${b.scoreB}`;
    porCruce.set(k, [...(porCruce.get(k) ?? []), b]);
  }
  const sobran = new Set<AsaltoHecho>();
  for (const g of porCruce.values()) {
    if (g.length < 2) continue;
    const queda = g.find((b) => /^A\d+$/.test(b.roundKey)) ?? g[0];
    for (const b of g) if (b !== queda) sobran.add(b);
  }
  for (const b of sobran) descartar('duplicado_otra_ronda');
  return { bouts: bouts.filter((b) => !sobran.has(b)), descartes, rondasSinNombre };
}

/** Comprueba el cuadro contra la clasificación oficial; devuelve el motivo del rechazo o null. */
export function validarCuadroEquipos(bouts: readonly AsaltoHecho[], equipos: ReadonlyMap<string, EquipoClasificado>): string | null {
  if (equipos.size === 0) return null;
  const enCuadro = new Set(bouts.flatMap((b) => [b.aRef, b.bRef]));
  const fuera = [...enCuadro].filter((r) => !equipos.has(r));
  // Un equipo retirado o excluido puede quedar fuera de la clasificación publicada.
  if (fuera.length > Math.max(1, Math.floor(enCuadro.size * 0.05))) return `equipos_no_clasificados:${fuera.length}`;
  const final = bouts.filter((b) => b.roundKey === 'A2');
  if (final.length > 1) return 'varias_finales';
  if (final.length === 1) {
    const f = final[0];
    const ganaA = f.winner ? f.winner === 'A' : f.scoreA > f.scoreB;
    const [g, p] = ganaA ? [f.aRef, f.bRef] : [f.bRef, f.aRef];
    const pg = equipos.get(g)?.puesto;
    const pp = equipos.get(p)?.puesto;
    if (pg !== 1 || pp !== 2) return `final_contradice_clasificacion:${pg ?? '-'}-${pp ?? '-'}`;
  }
  return null;
}

type Objetivo = {
  season: string; key: string; prioridad: number; tournamentKey: string; editionName: string; startDate: string | null; endDate: string | null;
  city: string | null; countryCode: string | null; weapon: string; gender: string; category: string; categoryRaw: string | null; date: string | null;
};

function objetivos(rutaHuecos: string, db: DatabaseSync): Objetivo[] {
  const j = JSON.parse(readFileSync(rutaHuecos, 'utf8')) as { huecos: { id: string; prioridad: number; fuente: string; formato: string; faltan: string[] }[] };
  const fila = db.prepare(`
    SELECT c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.competition_date, e.tournament_key, e.name,
           e.start_date, e.end_date, e.city, e.country_code
      FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND c.season = ? AND c.competition_key = ?`);
  const out: Objetivo[] = [];
  for (const h of j.huecos) {
    if (h.fuente !== 'FIE' || h.formato !== 'EQUIPOS' || !h.faltan.includes('cuadro')) continue;
    const [, season, key] = h.id.split(':');
    const f = fila.get(season, key) as Record<string, string | null> | undefined;
    if (!f) continue;
    out.push({
      season, key, prioridad: h.prioridad, tournamentKey: f.tournament_key!, editionName: f.name!, startDate: f.start_date, endDate: f.end_date,
      city: f.city, countryCode: f.country_code && /^[A-Z]{3}$/.test(f.country_code) ? f.country_code : null,
      weapon: f.weapon!, gender: f.gender!, category: f.category!, categoryRaw: f.category_raw, date: f.competition_date,
    });
  }
  return out;
}

/** Clasificación de nuevo7 y, si allí no hay, la de los ficheros FIE del lote 7. */
export function clasificaciones(db: DatabaseSync, raizHechos: string): (season: string, key: string) => Map<string, EquipoClasificado> {
  const q = db.prepare(`SELECT r.source_fact_key k, r.source_name n, r.position p, r.source_country_code pais FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id
     WHERE c.source = 'fie' AND c.season = ? AND c.competition_key = ?`);
  const lote7 = new Map<string, HechosPrueba['results']>();
  for (const d of existsSync(raizHechos) ? readdirSync(raizHechos).filter((x) => x.startsWith('lote7-')) : []) {
    const dir = join(raizHechos, d);
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('fie__') || !f.endsWith('.json')) continue;
      const h = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HechosPrueba;
      if (h.competition.format === 'EQUIPOS' && h.results.length > 0) lote7.set(`${h.edition.season}|${h.competition.competitionKey}`, h.results);
    }
  }
  return (season, key) => {
    const m = new Map<string, EquipoClasificado>();
    for (const r of q.all(season, key) as { k: string; n: string; p: number | null; pais: string | null }[]) m.set(r.k, { ref: r.k, nombre: r.n, puesto: r.p, pais: r.pais });
    if (m.size === 0) for (const r of lote7.get(`${season}|${key}`) ?? []) m.set(r.factKey, { ref: r.factKey, nombre: r.name, puesto: r.position, pais: r.countryCode });
    return m;
  };
}

async function main(): Promise<void> {
  const rutaHuecos = argumento('huecos', join(CARPETA_COBERTURA, 'huecos-tras-lote7.json'));
  const db = new DatabaseSync(argumento('db', NUEVO7_COBERTURA), { readOnly: true });
  const max = Number(argumento('max', '4000'));
  const sinRed = bandera('sin-red');
  const lista = objetivos(rutaHuecos, db).slice(0, max);
  const equiposDe = clasificaciones(db, join(CARPETA_TRABAJO, 'hechos'));
  const red = new RedLote8();
  mkdirSync(SALIDA_FIE_EQUIPOS, { recursive: true });
  const escritos = new Set<string>();
  const motivos: Record<string, number> = {};
  const descartesTotales: Record<string, number> = {};
  const detalle: Record<string, unknown>[] = [];
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  let encuentros = 0;
  let hechas = 0;
  await enParalelo(lista, 2, async (o) => {
    const url = urlCuadroFie(o.season, o.key);
    const doc = sinRed ? red.enCache(url) : await red.obtener(url, { aceptar: 'application/json' });
    hechas += 1;
    if (hechas % 100 === 0) console.log(`${hechas}/${lista.length} (peticiones ${red.peticiones}, caché ${red.desdeCache}, escritas ${escritos.size})`);
    const id = `fie:${o.season}:${o.key}`;
    if (!doc || doc.status !== 200 || !doc.bytes) {
      anotar(doc ? `http_${doc.status}` : 'sin_cache');
      detalle.push({ id, prioridad: o.prioridad, motivo: doc ? `http_${doc.status}` : 'sin_cache', url });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(texto(doc)!);
    } catch {
      anotar('json_ilegible');
      detalle.push({ id, prioridad: o.prioridad, motivo: 'json_ilegible', url });
      return;
    }
    const equipos = equiposDe(o.season, o.key);
    const l = encuentrosCuadroFie(json, equipos);
    for (const [k, n] of Object.entries(l.descartes)) descartesTotales[k] = (descartesTotales[k] ?? 0) + n;
    if (l.bouts.length === 0) {
      const m = l.rondasSinNombre > 0 ? 'rondas_sin_nombre' : 'cuadro_vacio';
      anotar(m);
      detalle.push({ id, prioridad: o.prioridad, motivo: m, url, rondasSinNombre: l.rondasSinNombre });
      return;
    }
    const rechazo = validarCuadroEquipos(l.bouts, equipos);
    if (rechazo) {
      anotar(rechazo.split(':')[0]);
      detalle.push({ id, prioridad: o.prioridad, motivo: rechazo, url });
      return;
    }
    const sinPuesto = [...new Set(l.bouts.flatMap((b) => [b.aRef, b.bRef]))].filter((r) => equipos.size > 0 && !equipos.has(r));
    const imposibles = Object.entries(l.descartes).filter(([k]) => k.startsWith('marcador_imposible')).reduce((s, [, n]) => s + n, 0);
    const notas = [
      'Lote 8: encuentros por equipos del cuadro de la API FIE (el lector común los descarta); results vacío a propósito: se conserva la clasificación existente',
      ...(Object.keys(l.descartes).length ? [`Descartados: ${Object.entries(l.descartes).map(([k, n]) => `${k}=${n}`).join(', ')}`] : []),
      ...(equipos.size === 0 ? ['Sin clasificación oficial con la que validar el cuadro'] : [`Validado contra la clasificación oficial: final coherente${sinPuesto.length ? `; ${sinPuesto.length} equipo del cuadro sin puesto publicado (${sinPuesto.join(', ')})` : ' y todos los equipos clasificados'}`]),
    ];
    const h = hechosPrueba.parse({
      version: 1, source: 'fie', extractor: 'lector_fie', sourceUrl: url, sourceSha256: doc.sha256,
      edition: { season: o.season, tournamentKey: o.tournamentKey, name: o.editionName, startDate: o.startDate, endDate: o.endDate, city: o.city, countryCode: o.countryCode },
      competition: { competitionKey: o.key, weapon: o.weapon, gender: o.gender, category: o.category, categoryRaw: o.categoryRaw, format: 'EQUIPOS', date: o.date },
      status: {
        results: 'sin_resultados', pools: 'sin_resultados', tableau: imposibles > 0 || l.rondasSinNombre > 0 ? 'parcial' : 'completo',
        publishedParticipants: null, notes: notas,
      },
      results: [],
      bouts: l.bouts,
    });
    const fichero = ficheroHechos(h);
    writeFileSync(join(SALIDA_FIE_EQUIPOS, fichero), `${JSON.stringify(h, null, 1)}\n`);
    escritos.add(fichero);
    encuentros += l.bouts.length;
    anotar('escrita');
    detalle.push({ id, prioridad: o.prioridad, motivo: 'escrita', encuentros: l.bouts.length, descartes: l.descartes, validada: equipos.size > 0 });
  });
  db.close();
  for (const f of readdirSync(SALIDA_FIE_EQUIPOS)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(SALIDA_FIE_EQUIPOS, f));
  const informe = {
    generado: new Date().toISOString(), objetivos: lista.length, escritas: escritos.size, encuentros, motivos, descartes: descartesTotales,
    peticiones: red.peticiones, desdeCache: red.desdeCache, cacheBytes: red.bytesCache, detalle,
  };
  writeFileSync(join(SALIDA_FIE_EQUIPOS, '_informe.json'), `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify({ ...informe, detalle: undefined }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
