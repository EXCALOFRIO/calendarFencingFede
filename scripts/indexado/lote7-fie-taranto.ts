/**
 * Poules y cuadro de los Juegos Mediterráneos de Taranto 2026 (FIE 2026
 * 1139–1144), desde la API pública de resultados del comité organizador
 * (Microplus, `crs-ta2026-api.microplustimingservices.com/api/v2`, la misma
 * que usa `taranto2026.microplustimingservices.com`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-taranto.ts [--db <sqlite>] [--salida <dir>]
 *
 * - `results/poolStandings`: cada poule con V, D, TD y TR de cada tirador y sus
 *   asaltos (marcador propio y del rival). Una poule vale si cada asalto
 *   aparece igual (y al revés) en los dos tiradores, tiene un ganador con ≤ 5
 *   tocados y V, D, TD, TR de cada fila salen de sus asaltos.
 * - `brackets`: cada asalto del cuadro con los dos tiradores, marcador y
 *   W/L. Vale si el marcado W tiene más tocados (≤ 15), pasa a la ronda
 *   siguiente y no reaparece el perdedor; el perdedor de cuartos, semifinal y
 *   final tiene en `events/ranking` el puesto 5–8, 3 y 2.
 * Referencias: `source_fact_key` de la clasificación FIE de la prueba.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { abrirBase, puestosDeBase } from './fie-completar-comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, obtener, SALIDA_LOTE7, sha256, texto } from './lote7-fie-red';

type Lectura = Parameters<typeof anadirAsaltos>[1];
type BoutLeido = NonNullable<Lectura['poules']>['bouts'][number];
type Tirador = { nombre: string; pais: string | null };

const API = 'https://crs-ta2026-api.microplustimingservices.com/api/v2';
const COMUN = 'competitionCode=GDM2026&disciplineCode=FEN&languageCode=ENG';
const ARMA: Record<string, string> = { EPEE: 'ESPADA', FOIL: 'FLORETE', SABRE: 'SABLE' };

type Rival = { Code: string; Result: string | null; WLT: string | null; IRM: string | null; PrintName: string; OrganisationCode: string | null };
type UnidadPoule = { UnitCode: string; Competitor: Rival & { OpponentCompetitor: Rival } };
type FilaPoule = { CompetitorCode: string; OrganisationCode: string; Won: number; Lost: number; PointFor: number; PointAgainst: number;
  Composition: { Athlete: { Description: { PrintName: string } }[] }; Units: UnidadPoule[] };
export type PouleApi = { GenderCode: string; EventCode: string; PhaseCode: string; PoolCompetitors: FilaPoule[] };

const entero = (s: string | null | undefined) => (s != null && /^\d{1,2}$/.test(s.trim()) ? Number(s) : null);

/** Asaltos de una poule de la API si todo cuadra; si no, el motivo. */
export function asaltosPouleApi(p: PouleApi): { bouts: BoutLeido[]; esperados: number } | { motivo: string; esperados: number } {
  const filas = p.PoolCompetitors ?? [];
  const n = filas.length;
  const esperados = (n * (n - 1)) / 2;
  const tirador = new Map<string, Tirador>(filas.map((f) => [f.CompetitorCode, { nombre: f.Composition.Athlete[0].Description.PrintName, pais: f.OrganisationCode }]));
  const vistos = new Map<string, { a: string; b: string; sa: number; sb: number }>();
  const tot = new Map(filas.map((f) => [f.CompetitorCode, { v: 0, d: 0, td: 0, tr: 0 }]));
  for (const f of filas) {
    for (const u of f.Units ?? []) {
      const yo = u.Competitor;
      const el = yo.OpponentCompetitor;
      const [sa, sb] = [entero(yo.Result), entero(el?.Result)];
      if (!el || yo.Code !== f.CompetitorCode || !tirador.has(el.Code)) return { motivo: 'rival_fuera_de_la_poule', esperados };
      if (sa === null || sb === null || yo.IRM || el.IRM) return { motivo: 'asalto_sin_marcador', esperados };
      if ((yo.WLT === 'W') === (el.WLT === 'W') || Math.max(sa, sb) > 5 || (yo.WLT === 'W' ? sa < sb : sb < sa)) return { motivo: 'marcador_imposible', esperados };
      const t = tot.get(f.CompetitorCode)!;
      t.v += yo.WLT === 'W' ? 1 : 0;
      t.d += yo.WLT === 'W' ? 0 : 1;
      t.td += sa;
      t.tr += sb;
      const k = [yo.Code, el.Code].sort().join('|');
      const previo = vistos.get(k);
      if (previo) {
        if (previo.a !== el.Code || previo.sa !== sb || previo.sb !== sa) return { motivo: 'no_reciproca', esperados };
        vistos.delete(k);
        vistos.set(`${k}#ok`, previo);
      } else if (vistos.has(`${k}#ok`)) return { motivo: 'asalto_repetido', esperados };
      else vistos.set(k, { a: yo.Code, b: el.Code, sa, sb });
    }
  }
  const sinPareja = [...vistos.keys()].filter((k) => !k.endsWith('#ok'));
  if (sinPareja.length > 0) return { motivo: 'no_reciproca', esperados };
  for (const f of filas) {
    const t = tot.get(f.CompetitorCode)!;
    if (t.v !== f.Won || t.d !== f.Lost || t.td !== f.PointFor || t.tr !== f.PointAgainst) return { motivo: 'totales_no_cuadran', esperados };
  }
  const numero = Number(p.PhaseCode.replace(/\D/g, ''));
  const bouts = [...vistos.values()].map((x) => ({
    phase: 'POULE' as const, roundKey: `P${numero}`, a: tirador.get(x.a)!, b: tirador.get(x.b)!, scoreA: x.sa, scoreB: x.sb,
    winner: null,
  }));
  return { bouts, esperados };
}

type Plaza = { Pos: number; WLT?: string | null; Result?: string | null; Code?: string; Competitor: { Code?: string; OrganisationCode?: string;
  Composition: { Athlete?: { Description: { PrintName: string } }[] } } };
export type UnidadCuadro = { PhaseCode: string; UnitCode: string; CompetitorPlace: Plaza[] };

export function rondaApi(fase: string): number | null {
  if (fase === 'FNL-') return 2;
  if (fase === 'SFNL') return 4;
  if (fase === 'QFNL') return 8;
  const m = /^(\d+)FNL$/.exec(fase);
  return m ? Number(m[1]) * 2 : null;
}

/** Asaltos del cuadro de la API (sin exentos) con su ganador y perdedor. */
export function asaltosCuadroApi(unidades: readonly UnidadCuadro[]) {
  const descartados: Record<string, number> = {};
  const fuera = (k: string) => (descartados[k] = (descartados[k] ?? 0) + 1);
  const bouts: (BoutLeido & { ganador: Tirador; perdedor: Tirador; tam: number })[] = [];
  let esperados = 0;
  for (const u of unidades) {
    const tam = rondaApi(u.PhaseCode);
    const plazas = u.CompetitorPlace ?? [];
    if (!tam) continue;
    if (plazas.length !== 2 || plazas.some((x) => x.Code === 'BYE' || !x.Competitor?.Code)) continue;
    esperados += 1;
    const [x, y] = plazas;
    const [sx, sy] = [entero(x.Result), entero(y.Result)];
    const t = (p: Plaza): Tirador => ({ nombre: p.Competitor.Composition.Athlete![0].Description.PrintName, pais: p.Competitor.OrganisationCode ?? null });
    if (sx === null || sy === null || (x.WLT === 'W') === (y.WLT === 'W')) {
      fuera('sin_marcador_o_ganador');
      continue;
    }
    const ganaX = x.WLT === 'W';
    if ((ganaX ? sx < sy : sy < sx) || Math.max(sx, sy) > 15) {
      fuera('marcador_imposible');
      continue;
    }
    bouts.push({
      phase: 'TABLEAU', roundKey: `A${tam}`, a: t(x), b: t(y), scoreA: sx, scoreB: sy, winner: sx === sy ? (ganaX ? 'A' : 'B') : null,
      ganador: ganaX ? t(x) : t(y), perdedor: ganaX ? t(y) : t(x), tam,
    });
  }
  // Coherencia del avance: el ganador de la ronda de N está en la de N/2 y el perdedor ya no aparece.
  const clave = (t: Tirador) => `${t.nombre}|${t.pais}`;
  const enRonda = new Map<number, Set<string>>();
  for (const b of bouts) {
    const s = enRonda.get(b.tam) ?? new Set<string>();
    s.add(clave(b.a));
    s.add(clave(b.b));
    enRonda.set(b.tam, s);
  }
  const buenos = bouts.filter((b) => {
    const despues = [...enRonda].filter(([t]) => t < b.tam).flatMap(([, s]) => [...s]);
    const sigue = b.tam === 2 || (enRonda.get(b.tam / 2)?.has(clave(b.ganador)) ?? false);
    if (!sigue || despues.includes(clave(b.perdedor))) {
      fuera('avance_incoherente');
      return false;
    }
    return true;
  });
  return { bouts: buenos, esperados, descartados };
}

async function json<T>(ruta: string): Promise<T | null> {
  const d = await obtener(`${API}/${ruta}`);
  const t = texto(d);
  if (d.status !== 200 || !t) return null;
  return JSON.parse(t) as T;
}

async function main() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  const pendientes = objetivos(db).filter((p) => p.season === '2026' && /mediterr/i.test(`${p.tournamentKey} ${p.editionName}`));
  console.log(`pendientes: ${pendientes.map((p) => `${p.competitionKey} ${p.gender}${p.weapon}`).join(', ')}`);
  const eventos = (await json<{ Data: { GenderCode: string; EventCode: string; TeamEvent: string }[] }>(`events?${COMUN}`))?.Data ?? [];
  const poules = (await json<{ Data: PouleApi[] }>(`results/poolStandings?${COMUN}`))?.Data ?? [];
  const informe: Record<string, unknown>[] = [];
  for (const p of pendientes) {
    const ev = eventos.find((e) => e.TeamEvent === 'N' && ARMA[e.EventCode.replace(/-+$/, '')] === p.weapon && (e.GenderCode === 'W' ? 'F' : 'M') === p.gender);
    if (!ev) {
      informe.push({ competitionKey: p.competitionKey, motivo: 'sin prueba en la API' });
      continue;
    }
    const filtro = `${COMUN}&genderCode=${ev.GenderCode}&eventCode=${ev.EventCode}`;
    const cuadroApi = await json<{ Data: { Stages: { Brackets: UnidadCuadro[] } }[] }>(`brackets?${filtro}`);
    const ranking = await json<{ Data: { Rank: string | null; OrganisationCode?: string; Composition?: { Athlete?: { Description: { PrintName: string } }[] } }[] }>(`events/ranking?${filtro}`);
    const oficial = (ranking?.Data ?? []).flatMap((r) => {
      const nombre = r.Composition?.Athlete?.[0]?.Description.PrintName;
      const puesto = Number(r.Rank);
      return nombre && r.Rank && Number.isInteger(puesto) ? [{ t: { nombre, pais: r.OrganisationCode ?? null }, puesto }] : [];
    });
    const puestos = puestosDeBase(db, p.id);
    const coincidencia = solape(puestos, oficial.map((o) => o.t));
    if (oficial.length === 0 || coincidencia < 0.8) {
      informe.push({ competitionKey: p.competitionKey, motivo: `clasificación de la API distinta de la FIE (solape ${coincidencia.toFixed(2)}, ${oficial.length} filas)` });
      continue;
    }
    const propias = poules.filter((q) => q.GenderCode === ev.GenderCode && q.EventCode === ev.EventCode);
    const boutsP: BoutLeido[] = [];
    const descP: Record<string, number> = {};
    let esperadosP = 0;
    for (const q of propias) {
      const r = asaltosPouleApi(q);
      esperadosP += r.esperados;
      if ('motivo' in r) descP[`${q.PhaseCode}:${r.motivo}`] = r.esperados;
      else boutsP.push(...r.bouts);
    }
    const unidades = cuadroApi?.Data?.[0]?.Stages?.Brackets ?? [];
    const c = asaltosCuadroApi(unidades);
    const puestoDe = new Map(oficial.map((o) => [`${o.t.nombre}|${o.t.pais}`, o.puesto]));
    const descT = { ...c.descartados };
    const boutsT = c.bouts.filter((b) => {
      const rango = b.tam === 2 ? [2, 2] : b.tam === 4 ? [3, 4] : b.tam === 8 ? [5, 8] : null;
      const pp = puestoDe.get(`${b.perdedor.nombre}|${b.perdedor.pais}`);
      if (rango && (pp === undefined || pp < rango[0] || pp > rango[1])) {
        descT.puesto_final_incoherente = (descT.puesto_final_incoherente ?? 0) + 1;
        return false;
      }
      return true;
    }).map(({ ganador: _g, perdedor: _p, tam: _t, ...b }) => b);
    const lectura: Lectura = {
      arma: p.weapon, genero: p.gender, puestos: oficial,
      poules: propias.length ? { bouts: boutsP, esperados: esperadosP, descartados: descP } : null,
      cuadro: unidades.length ? { bouts: boutsT, esperados: c.esperados, completo: true, descartados: descT } : null,
    };
    const url = `https://taranto2026.microplustimingservices.com/#/competition-schedule/FEN`;
    const r = anadirAsaltos(hechosBase(p, puestos), lectura, {
      nombre: 'taranto2026_api', url,
      descripcion: `API pública de resultados de Taranto 2026 (${API}: results/poolStandings, brackets y events/ranking de ${ev.GenderCode} ${ev.EventCode.replace(/-+$/, '')})`,
    });
    const h = soloFasesQueFaltan(hechosPrueba.parse({
      ...r.hechos, extractor: 'lote7_taranto2026', sourceUrl: `${API}/brackets?${filtro}`,
      sourceSha256: sha256(JSON.stringify([propias, unidades])),
    }), p);
    const fila = {
      competitionKey: p.competitionKey, evento: `${ev.GenderCode} ${ev.EventCode.replace(/-+$/, '')}`, solape: Number(coincidencia.toFixed(2)),
      pools: { importados: h.bouts.filter((b) => b.phase === 'POULE').length, esperados: esperadosP, estado: h.status.pools, descartados: r.informe.pools.descartados },
      tableau: { importados: h.bouts.filter((b) => b.phase === 'TABLEAU').length, esperados: c.esperados, estado: h.status.tableau, descartados: r.informe.tableau.descartados },
      sinCasar: r.informe.tiradores.sinCasar,
    };
    informe.push(fila);
    console.log(JSON.stringify(fila));
    if (h.bouts.length > 0) writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
  }
  db.close();
  writeFileSync(join(CARPETA_LOTE7, 'taranto-informe.json'), `${JSON.stringify({ generado: new Date().toISOString(), pruebas: informe }, null, 1)}\n`);
  for (const i of informe.filter((x) => 'motivo' in x)) console.log(JSON.stringify(i));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
