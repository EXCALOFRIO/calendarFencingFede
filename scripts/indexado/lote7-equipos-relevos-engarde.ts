/**
 * Relevos tirador a tirador de las pruebas por equipos de Engarde (sin red, de las mismas
 * cachés que `lote7-equipos-engarde.ts`). Sólo datos: no se cargan ni se vinculan personas.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-relevos-engarde.ts \
 *     [--db <nuevo7.sqlite>] [--salida <calendario-trabajo/relevos/engarde>]
 *
 * Engarde publica, tras el cuadro, una sección por encuentro (`<a name="a8-1">`, título
 * «Tabla de 8 : EQ1  34/45  EQ2» o «Semi-finales : EQ1 - EQ2») con una `table.liste` de
 * columnas: tirador del equipo A, tocados del relevo, marcador acumulado de A, marcador
 * acumulado de B, tocados del relevo, tirador del equipo B. Esquema: `relevos/ESQUEMA.md`.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { argumento, CARPETA_TRABAJO } from './comun';
import { CacheEngarde } from './engarde-descargar';
import { NUEVO7, pruebasEquipos, type PruebaEquipos } from './lote7-equipos-comun';
import { documentosEnCache, refsEquipos, type Documento } from './lote7-equipos-engarde';

export const SALIDA_RELEVOS = join(CARPETA_TRABAJO, 'relevos', 'engarde');
export const ESQUEMA_RELEVOS = 1;

export type Relevo = {
  n: number;
  fencerA: { name: string | null; team: string };
  fencerB: { name: string | null; team: string };
  before: { a: number; b: number };
  after: { a: number; b: number };
  touches: { a: number; b: number };
  /** before + touches = after en los dos lados. */
  consistent: boolean;
};

export type EncuentroRelevos = {
  phase: 'TABLEAU' | 'POULE';
  /** Ancla de Engarde («a8-1»): letra del cuadro (a = principal), tamaño y número de encuentro. */
  anchor: string;
  tableId: string;
  matchNumber: number;
  /** `T8`, `T4`, `T2`, `T2-3`… en el cuadro principal y el tercer puesto; `null` en los de puestos. */
  roundKey: string | null;
  roundLabel: string;
  teamA: { name: string; ref: string | null };
  teamB: { name: string; ref: string | null };
  /** Marcador final del encuentro: el del título si lo publica; si no, el acumulado del último relevo. */
  finalScore: { a: number; b: number };
  finalScoreSource: 'title' | 'last_relay';
  relays: Relevo[];
  /** Todos los relevos coherentes y el último acaba en el marcador final. */
  consistent: boolean;
  sourceUrl: string;
};

const limpio = (t: string) => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const entero = (t: string) => (/^\d{1,3}$/.test(limpio(t)) ? Number(limpio(t)) : null);

/** Encuentros con relevos de una página de cuadro o poules de Engarde. */
export function relevosDePagina(html: string, url: string, phase: 'TABLEAU' | 'POULE'): EncuentroRelevos[] {
  const anclas = [...html.matchAll(/<a\s+name="?([a-z])(\d+)-(\d+)"?\s*\/?>/gi)];
  const out: EncuentroRelevos[] = [];
  anclas.forEach((m, i) => {
    const tramo = html.slice(m.index!, anclas[i + 1]?.index ?? html.length);
    const h3 = /<h3>([\s\S]*?)<\/h3>|<h3>([\s\S]*?)<\/p>/i.exec(tramo);
    const ini = tramo.search(/<table class="liste"/i);
    if (!h3 || ini < 0) return;
    const fin = tramo.indexOf('</table>', ini);
    const $ = cheerio.load(tramo.slice(ini, fin < 0 ? undefined : fin + 8));
    const titulo = limpio(cheerio.load(`<div>${h3[1] ?? h3[2]}</div>`)('div').text()).replace(/\^$/, '').trim();
    const [etiqueta, resto = ''] = titulo.split(/\s+:\s+/, 2);
    const filas = $('tr').toArray();
    const cab = $(filas[0]).children('th,td').toArray().map((c) => limpio($(c).text()));
    if (cab.length !== 6 || !/toques|touches|hits|tocs/i.test(cab[1])) return;
    const [equipoA, equipoB] = [cab[0], cab[5]];
    const relays: Relevo[] = [];
    let previo = { a: 0, b: 0 };
    for (const tr of filas.slice(1)) {
      const c = $(tr).children('td').toArray().map((x) => limpio($(x).text()));
      if (c.length !== 6) continue;
      const [ta, sa, sb, tb] = [entero(c[1]), entero(c[2]), entero(c[3]), entero(c[4])];
      if (ta === null || sa === null || sb === null || tb === null) continue;
      const despues = { a: sa, b: sb };
      relays.push({
        n: relays.length + 1,
        fencerA: { name: c[0] || null, team: equipoA },
        fencerB: { name: c[5] || null, team: equipoB },
        before: previo, after: despues, touches: { a: ta, b: tb },
        consistent: previo.a + ta === sa && previo.b + tb === sb,
      });
      previo = despues;
    }
    if (relays.length === 0) return;
    const marcador = /(\d{1,3})\s*\/\s*(\d{1,3})/.exec(resto);
    const finalScore = marcador ? { a: Number(marcador[1]), b: Number(marcador[2]) } : { ...previo };
    const letra = m[1].toLowerCase();
    const tam = Number(m[2]);
    const numeroPoule = /(\d+)/.exec(etiqueta)?.[1];
    const roundKey = phase === 'POULE' ? (numeroPoule ? `P${numeroPoule}` : null)
      : /tercer|third|troisi/i.test(etiqueta) ? 'T2-3'
      : letra === 'a' ? `T${tam}` : null;
    out.push({
      phase, anchor: `${letra}${tam}-${m[3]}`, tableId: `${letra.toUpperCase()}${tam}`, matchNumber: Number(m[3]),
      roundKey, roundLabel: etiqueta,
      teamA: { name: equipoA, ref: null }, teamB: { name: equipoB, ref: null },
      finalScore, finalScoreSource: marcador ? 'title' : 'last_relay',
      relays,
      consistent: relays.every((r) => r.consistent) && previo.a === finalScore.a && previo.b === finalScore.b,
      sourceUrl: url,
    });
  });
  return out;
}

export function relevosDePrueba(p: PruebaEquipos, docs: readonly Documento[]) {
  const ref = refsEquipos(p.resultados);
  const vistos = new Set<string>();
  const matches: EncuentroRelevos[] = [];
  for (const d of docs) {
    for (const e of relevosDePagina(d.html, d.url, d.tipo === 'poules' ? 'POULE' : 'TABLEAU')) {
      const k = `${e.phase}|${e.anchor}|${normalizeSportName(e.teamA.name)}|${normalizeSportName(e.teamB.name)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const r = (n: string) => {
        const x = ref(n);
        return x && !x.endsWith('|') ? x : null;
      };
      matches.push({ ...e, teamA: { name: e.teamA.name, ref: r(e.teamA.name) }, teamB: { name: e.teamB.name, ref: r(e.teamB.name) } });
    }
  }
  return matches;
}

function main(): void {
  const salida = argumento('salida', SALIDA_RELEVOS);
  mkdirSync(salida, { recursive: true });
  const db = new DatabaseSync(argumento('db', NUEVO7), { readOnly: true });
  const pruebas = pruebasEquipos(db, 'engarde');
  db.close();
  const caches = ['engarde', join('cache-asaltos-rfee', 'engarde'), 'engarde-historico'].map((c) => new CacheEngarde(join(CARPETA_TRABAJO, c)));
  const escritos = new Set<string>();
  const inf = { generado: new Date().toISOString(), pruebas: 0, encuentros: 0, relevos: 0, encuentrosIncoherentes: 0, relevosSinTirador: 0, porFase: {} as Record<string, number> };
  for (const p of pruebas) {
    if (!p.competitionKey.startsWith('engarde:')) continue;
    const [org, evt, compe] = p.competitionKey.slice('engarde:'.length).split('/');
    const { docs } = documentosEnCache(caches, org, evt, compe);
    const matches = relevosDePrueba(p, docs);
    if (matches.length === 0) continue;
    const nombre = `${p.season}__${p.competitionKey.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`;
    const urls = [...new Set(matches.map((m) => m.sourceUrl))];
    writeFileSync(join(salida, nombre), `${JSON.stringify({
      schemaVersion: ESQUEMA_RELEVOS,
      source: 'engarde',
      season: p.season,
      competitionKey: p.competitionKey,
      tournamentKey: p.edition.tournamentKey,
      edition: p.edition.name,
      weapon: p.weapon, gender: p.gender, category: p.category, date: p.date,
      sourceUrls: urls,
      sourceSha256: createHash('sha256').update(docs.filter((d) => urls.includes(d.url)).map((d) => d.html).join('\n')).digest('hex'),
      extractedAt: inf.generado,
      matches,
    }, null, 2)}\n`);
    escritos.add(nombre);
    inf.pruebas += 1;
    inf.encuentros += matches.length;
    for (const m of matches) {
      inf.relevos += m.relays.length;
      if (!m.consistent) inf.encuentrosIncoherentes += 1;
      inf.relevosSinTirador += m.relays.filter((r) => !r.fencerA.name || !r.fencerB.name).length;
      inf.porFase[m.phase] = (inf.porFase[m.phase] ?? 0) + 1;
    }
  }
  for (const f of readdirSync(salida)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(salida, f));
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 2));
  console.log(JSON.stringify(inf, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
