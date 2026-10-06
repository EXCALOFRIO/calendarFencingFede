/**
 * Cuadros FIE por equipos que la API publica sin nombre de ronda (temporadas antiguas: todos los
 * encuentros en una sola lista `""`), con las rondas reconstruidas desde la clasificación oficial.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8b-fie-equipos-rondas.ts [--db <nuevo8.sqlite>]
 *
 * Sólo lee la caché del lote 8 (`lote8-fie-equipos` ya descargó estos cuadros); no hace red.
 *
 * Reconstrucción: en eliminación directa con puestos tirados, el puesto final p sólo puede
 * salir de perder en la ronda n = la potencia de 2 ≥ p (2.º en la final, 3.º-4.º en
 * semifinales, 5.º-8.º en cuartos...). Así, en cada encuentro:
 *  - si el ganador tiene una ronda de salida menor que el perdedor, es del cuadro principal y
 *    su ronda es la de salida del perdedor (`A<n>`);
 *  - si los dos salen en la misma ronda, es un encuentro por puestos dentro de ese tramo, con la
 *    clave del menor bloque alineado que contiene los dos puestos (`P3-4`, `P5-8`, `P5-6`...);
 *  - si el ganador sale antes que el perdedor, contradice la clasificación.
 * Se escribe sólo si el cuadro principal sale coherente y único: una final entre el 1.º y el 2.º,
 * nadie dos veces en una ronda, como mucho n/2 encuentros en la ronda n, cada ganador de la
 * ronda n juega la n/2 y cada equipo pierde una sola vez en el cuadro principal. Los encuentros
 * por puestos dudosos (empate de puestos o ganador peor clasificado) se anotan y no se escriben.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho } from '../../src/lib/ingest/hechos/formato';
import { argumento, CARPETA_TRABAJO } from './comun';
import { clasificaciones, encuentrosCuadroFie, urlCuadroFie, type EquipoClasificado } from './lote8-fie-equipos';
import { RedLote8, texto } from './lote8-red';

export const NUEVO8 = join(CARPETA_TRABAJO, 'nuevo8.sqlite');
export const SALIDA_RONDAS = join(CARPETA_TRABAJO, 'hechos', 'lote8b-fie-equipos-rondas');

/** Ronda del cuadro principal en la que sale el puesto p (1 = campeón, que no sale). */
export const rondaDeSalida = (p: number): number => (p <= 1 ? 1 : 2 ** Math.ceil(Math.log2(p)));

const ganaA = (b: Pick<AsaltoHecho, 'scoreA' | 'scoreB' | 'winner'>) => (b.scoreA !== b.scoreB ? b.scoreA > b.scoreB : b.winner === 'A');

export type Reconstruccion = { bouts: AsaltoHecho[]; dudosos: Record<string, number> } | { motivo: string };

export function reconstruirRondas(bouts: readonly AsaltoHecho[], equipos: ReadonlyMap<string, EquipoClasificado>): Reconstruccion {
  const puesto = (r: string) => equipos.get(r)?.puesto ?? null;
  const dudosos: Record<string, number> = {};
  const dudar = (m: string) => (dudosos[m] = (dudosos[m] ?? 0) + 1);
  const principal: (AsaltoHecho & { g: string; p: string; n: number })[] = [];
  const puestos: AsaltoHecho[] = [];
  for (const b of bouts) {
    const [g, p] = ganaA(b) ? [b.aRef, b.bRef] : [b.bRef, b.aRef];
    const pg = puesto(g);
    const pp = puesto(p);
    if (pg === null || pp === null) return { motivo: 'equipo_sin_puesto' };
    const sg = rondaDeSalida(pg);
    const sp = rondaDeSalida(pp);
    if (sg > sp) return { motivo: 'ganador_sale_antes_que_el_perdedor' };
    if (sg < sp) {
      principal.push({ ...b, roundKey: `A${sp}`, g, p, n: sp });
      continue;
    }
    if (pg === pp) {
      dudar('puestos_empatados');
      continue;
    }
    if (pg > pp) {
      dudar('ganador_peor_clasificado');
      continue;
    }
    const lo = sp / 2 + 1;
    let s = 2;
    while (Math.floor((pg - lo) / s) !== Math.floor((pp - lo) / s)) s *= 2;
    const inicio = lo + Math.floor((pg - lo) / s) * s;
    puestos.push({ ...b, roundKey: `P${inicio}-${inicio + s - 1}` });
  }
  const finales = principal.filter((b) => b.n === 2);
  if (finales.length !== 1 || puesto(finales[0].g) !== 1 || puesto(finales[0].p) !== 2) return { motivo: 'sin_final_unica_1_2' };
  const enRonda = new Map<number, Set<string>>();
  const derrotas = new Map<string, number>();
  for (const b of principal) {
    const s = enRonda.get(b.n) ?? enRonda.set(b.n, new Set()).get(b.n)!;
    if (s.has(b.g) || s.has(b.p)) return { motivo: 'equipo_dos_veces_en_una_ronda' };
    s.add(b.g);
    s.add(b.p);
    derrotas.set(b.p, (derrotas.get(b.p) ?? 0) + 1);
  }
  for (const [n, s] of enRonda) if (s.size / 2 > n / 2) return { motivo: 'demasiados_encuentros_en_ronda' };
  if ([...derrotas.values()].some((d) => d > 1)) return { motivo: 'dos_derrotas_en_cuadro_principal' };
  for (const b of principal) {
    if (b.n > 2 && !enRonda.get(b.n / 2)?.has(b.g)) return { motivo: 'ganador_no_sigue' };
  }
  const vistos = new Map<string, Set<string>>();
  const limpios: AsaltoHecho[] = [];
  for (const b of puestos) {
    const s = vistos.get(b.roundKey) ?? vistos.set(b.roundKey, new Set()).get(b.roundKey)!;
    if (s.has(b.aRef) || s.has(b.bRef)) {
      dudar('dos_veces_en_un_encuentro_por_puestos');
      continue;
    }
    s.add(b.aRef);
    s.add(b.bRef);
    limpios.push(b);
  }
  return { bouts: [...principal.map(({ g: _g, p: _p, n: _n, ...b }) => b), ...limpios], dudosos };
}

function main(): void {
  const db = new DatabaseSync(argumento('db', NUEVO8), { readOnly: true });
  const informe8 = JSON.parse(readFileSync(join(CARPETA_TRABAJO, 'hechos', 'lote8-fie-equipos', '_informe.json'), 'utf8')) as { detalle: { id: string; motivo: string }[] };
  const objetivos = informe8.detalle.filter((d) => d.motivo === 'rondas_sin_nombre').map((d) => d.id);
  const equiposDe = clasificaciones(db, join(CARPETA_TRABAJO, 'hechos'));
  const edicion = db.prepare(`SELECT c.weapon, c.gender, c.category, c.category_raw, c.competition_date, e.tournament_key, e.name,
      e.start_date, e.end_date, e.city, e.country_code FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND c.season = ? AND c.competition_key = ?`);
  const red = new RedLote8();
  mkdirSync(SALIDA_RONDAS, { recursive: true });
  const motivos: Record<string, number> = {};
  const dudososTotal: Record<string, number> = {};
  const descartesTotal: Record<string, number> = {};
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  const detalle: Record<string, unknown>[] = [];
  const escritos = new Set<string>();
  let principales = 0;
  let porPuestos = 0;
  for (const id of objetivos) {
    const [, season, key] = id.split(':');
    const url = urlCuadroFie(season, key);
    const doc = red.enCache(url);
    if (!doc?.bytes) {
      anotar('sin_cache');
      detalle.push({ id, motivo: 'sin_cache' });
      continue;
    }
    const json = JSON.parse(texto(doc)!) as { tableau?: { rounds?: Record<string, unknown> }[] };
    // Las rondas sin nombre se leen con el mismo filtro de marcadores, bajo una clave provisional.
    const renombrado = { tableau: (json.tableau ?? []).map((s) => ({ ...s, suiteTableId: null, rounds: Object.fromEntries(Object.entries(s.rounds ?? {}).map(([k, v]) => [k.trim() || '?', v])) })) };
    const equipos = equiposDe(season, key);
    const l = encuentrosCuadroFie(renombrado, equipos);
    for (const [k, n] of Object.entries(l.descartes)) descartesTotal[k] = (descartesTotal[k] ?? 0) + n;
    if (equipos.size === 0) {
      anotar('sin_clasificacion');
      detalle.push({ id, motivo: 'sin_clasificacion' });
      continue;
    }
    if (l.bouts.length === 0) {
      anotar('sin_encuentros');
      detalle.push({ id, motivo: 'sin_encuentros' });
      continue;
    }
    const r = reconstruirRondas(l.bouts, equipos);
    if ('motivo' in r) {
      anotar(r.motivo);
      detalle.push({ id, motivo: r.motivo, encuentros: l.bouts.length });
      continue;
    }
    for (const [k, n] of Object.entries(r.dudosos)) dudososTotal[k] = (dudososTotal[k] ?? 0) + n;
    const e = edicion.get(season, key) as Record<string, string | null>;
    const nDudosos = Object.values(r.dudosos).reduce((s, x) => s + x, 0);
    const imposibles = Object.entries(l.descartes).filter(([k]) => k.startsWith('marcador_imposible')).reduce((s, [, x]) => s + x, 0);
    const h = hechosPrueba.parse({
      version: 1, source: 'fie', extractor: 'lector_fie', sourceUrl: url, sourceSha256: doc.sha256,
      edition: {
        season, tournamentKey: e.tournament_key, name: e.name, startDate: e.start_date, endDate: e.end_date, city: e.city,
        countryCode: e.country_code && /^[A-Z]{3}$/.test(e.country_code) ? e.country_code : null,
      },
      competition: { competitionKey: key, weapon: e.weapon, gender: e.gender, category: e.category, categoryRaw: e.category_raw, format: 'EQUIPOS', date: e.competition_date },
      status: {
        results: 'sin_resultados', pools: 'sin_resultados', tableau: nDudosos + imposibles > 0 ? 'parcial' : 'completo', publishedParticipants: null,
        notes: [
          'Lote 8b: la API FIE publica el cuadro por equipos sin nombre de ronda; rondas reconstruidas con la clasificación oficial (A<n> cuadro principal, P<a>-<b> encuentros por puestos)',
          'Cuadro principal coherente: final 1.º-2.º, nadie dos veces por ronda, cada ganador sigue y una sola derrota por equipo; results vacío a propósito',
          ...(nDudosos ? [`Encuentros por puestos no escritos por dudosos: ${Object.entries(r.dudosos).map(([k, x]) => `${k}=${x}`).join(', ')}`] : []),
          ...(Object.keys(l.descartes).length ? [`Descartados al leer: ${Object.entries(l.descartes).map(([k, x]) => `${k}=${x}`).join(', ')}`] : []),
        ],
      },
      results: [],
      bouts: r.bouts,
    });
    const fichero = ficheroHechos(h);
    writeFileSync(join(SALIDA_RONDAS, fichero), `${JSON.stringify(h, null, 1)}\n`);
    escritos.add(fichero);
    const np = r.bouts.filter((b) => /^A\d+$/.test(b.roundKey)).length;
    principales += np;
    porPuestos += r.bouts.length - np;
    anotar('escrita');
    detalle.push({ id, motivo: 'escrita', principal: np, porPuestos: r.bouts.length - np, dudosos: r.dudosos });
  }
  db.close();
  for (const f of readdirSync(SALIDA_RONDAS)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(SALIDA_RONDAS, f));
  const informe = {
    generado: new Date().toISOString(), objetivos: objetivos.length, escritas: escritos.size, encuentrosPrincipal: principales, encuentrosPorPuestos: porPuestos,
    motivos, dudosos: dudososTotal, descartesLectura: descartesTotal, detalle,
  };
  writeFileSync(join(SALIDA_RONDAS, '_informe.json'), `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify({ ...informe, detalle: undefined }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
