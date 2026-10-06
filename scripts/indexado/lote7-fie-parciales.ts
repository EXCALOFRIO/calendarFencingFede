/**
 * Asaltos que faltan en pruebas FIE individuales que ya tienen poules y cuadro
 * pero incompletos (cobertura `parcial`), desde otra publicación de la misma
 * prueba (Engarde del organizador).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-parciales.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-parciales.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * Sólo se emiten asaltos que la base no tiene, con la ronda de la base:
 *  - Poule: cada poule de la fuente se identifica con la poule FIE por sus
 *    tiradores (todos los que la base tiene en alguna poule están en una sola,
 *    la misma, y esa poule FIE no tiene a nadie fuera de la de la fuente), no
 *    por número. Si algún asalto que ya está en la base trae otro marcador en
 *    la fuente, la poule entera se descarta. Lo nuevo lleva la `round_key` FIE.
 *  - Cuadro: el asalto se coloca en la única ronda FIE de su tamaño en la que
 *    ninguno de los dos tiradores figure ya y que no esté llena (N/2 asaltos);
 *    si la fuente contradice algún marcador del cuadro guardado, no se añade
 *    nada del cuadro; y lo añadido debe ser coherente con lo guardado (nadie
 *    repite ronda, el perdedor no sigue).
 * El fichero lleva `parcial` en las dos fases: el cargador fusiona por clave
 * estable (ronda + referencias) sin borrar lo guardado.
 */
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho } from '../../src/lib/ingest/hechos/formato';
import { parsearPaginaEngarde, puestosDeEngarde, urlPruebaEngarde } from '../../src/lib/ingest/sources/engarde';
import { argumento } from './comun';
import { consistenciaCuadro } from './cuadro-consistencia';
import { paginasDePrueba } from './engarde-descargar';
import { parsearResultadosFww } from '../../src/lib/ingest/sources/fww';
import { abrirBase, pruebasFieIndividuales, puestosDeBase, type PruebaBase, type PuestoBase } from './fie-completar-comun';
import { atributosEngarde, hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos, leerEngarde } from './fie-huecos-asaltos';
import { indice } from './lote7-fie-engarde';
import { BASE_LOTE7, descargarFww, ediciones, HOY, leerPruebaFww, urlFww, type Edicion, type ManifiestoFww } from './lote7-fie-fww';
import { CARPETA_LOTE7, enCache, obtener, SALIDA_LOTE7, sha256, texto } from './lote7-fie-red';

export const FUENTES: { org: string; evt: string; season: string; competitionKey: string; descripcion: string }[] = [
  { org: 'rfee', evt: 'villademadrid22', season: '2022', competitionKey: '474', descripcion: '39 Trofeo Villa de Madrid (Copa del Mundo de sable masculino), mayo de 2022' },
  { org: 'rfee', evt: 'vm2024', season: '2024', competitionKey: '474', descripcion: 'Villa de Madrid, Copa del Mundo de sable masculino, mayo de 2024' },
  { org: 'rfee', evt: 'cmj_mad', season: '2024', competitionKey: '66', descripcion: 'Copa del Mundo júnior de sable de Madrid, diciembre de 2023' },
  { org: 'rfee', evt: 'sabadell25', season: '2026', competitionKey: '1387', descripcion: 'Satélite de florete Sabadell-Barcelona, octubre de 2025' },
];

const MANIFIESTO = join(CARPETA_LOTE7, 'parciales-manifiesto.json');
const MANIFIESTO_FWW = join(CARPETA_LOTE7, 'parciales-fww-manifiesto.json');
const INFORME = join(CARPETA_LOTE7, 'parciales-informe.json');
type Manifiesto = { pruebas: { org: string; evt: string; compe: string; titulo: string; paginas: string[]; arma: string | null; genero: string | null; categoria?: string | null }[] };

export type Guardado = { phase: 'POULE' | 'TABLEAU'; roundKey: string; aRef: string; bRef: string; scoreA: number; scoreB: number };

const par = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
/** Marcador orientado a la pareja ordenada. */
const orientado = (b: { aRef: string; bRef: string; scoreA: number; scoreB: number }) => (b.aRef < b.bRef ? `${b.scoreA}-${b.scoreB}` : `${b.scoreB}-${b.scoreA}`);
const tamano = (k: string) => {
  const m = /^[A-Z]?(\d+)$/.exec(k);
  return m ? Number(m[1]) : null;
};

export function complementar(guardados: readonly Guardado[], nuevos: readonly AsaltoHecho[]) {
  const motivos: Record<string, number> = {};
  const fuera = (k: string, n = 1) => (motivos[k] = (motivos[k] ?? 0) + n);
  const anadidos: AsaltoHecho[] = [];

  // ---- poules
  const gp = guardados.filter((b) => b.phase === 'POULE');
  const paresP = new Map(gp.map((b) => [par(b.aRef, b.bRef), b]));
  const pouleDe = new Map<string, Set<string>>();
  const miembros = new Map<string, Set<string>>();
  for (const b of gp) {
    for (const r of [b.aRef, b.bRef]) {
      (pouleDe.get(r) ?? pouleDe.set(r, new Set()).get(r)!).add(b.roundKey);
      (miembros.get(b.roundKey) ?? miembros.set(b.roundKey, new Set()).get(b.roundKey)!).add(r);
    }
  }
  const porPouleFuente = new Map<string, AsaltoHecho[]>();
  for (const b of nuevos.filter((x) => x.phase === 'POULE')) (porPouleFuente.get(b.roundKey) ?? porPouleFuente.set(b.roundKey, []).get(b.roundKey)!).push(b);
  for (const [, lista] of porPouleFuente) {
    const suyos = new Set(lista.flatMap((b) => [b.aRef, b.bRef]));
    const fie = new Set([...suyos].flatMap((r) => [...(pouleDe.get(r) ?? [])]));
    const faltan = lista.filter((b) => !paresP.has(par(b.aRef, b.bRef)));
    if (faltan.length === 0) continue;
    if (fie.size !== 1) {
      fuera('poule_sin_equivalente_unica', faltan.length);
      continue;
    }
    const destino = [...fie][0];
    if ([...(miembros.get(destino) ?? [])].some((r) => !suyos.has(r))) {
      fuera('poule_fie_con_otros_tiradores', faltan.length);
      continue;
    }
    const distintos = lista.filter((b) => {
      const g = paresP.get(par(b.aRef, b.bRef));
      return g && orientado(g) !== orientado(b);
    });
    if (distintos.length > 0) {
      fuera('poule_con_marcadores_distintos', faltan.length);
      continue;
    }
    const k = suyos.size;
    const yaHay = gp.filter((b) => b.roundKey === destino).length;
    if (yaHay + faltan.length > (k * (k - 1)) / 2) {
      fuera('poule_excederia_lo_esperado', faltan.length);
      continue;
    }
    for (const b of faltan) anadidos.push({ ...b, roundKey: destino });
  }

  // ---- cuadro
  const gt = guardados.filter((b) => b.phase === 'TABLEAU');
  const paresT = new Map(gt.map((b) => [par(b.aRef, b.bRef), b]));
  const nt = nuevos.filter((x) => x.phase === 'TABLEAU');
  const contradice = nt.filter((b) => {
    const g = paresT.get(par(b.aRef, b.bRef));
    return g && orientado(g) !== orientado(b);
  });
  const faltanT = nt.filter((b) => !paresT.has(par(b.aRef, b.bRef)));
  if (contradice.length > 0) fuera('cuadro_con_marcadores_distintos', faltanT.length);
  else {
    const rondas = new Map<string, { n: number; tiradores: Set<string> }>();
    for (const b of gt) {
      const r = rondas.get(b.roundKey) ?? { n: 0, tiradores: new Set<string>() };
      r.n += 1;
      r.tiradores.add(b.aRef);
      r.tiradores.add(b.bRef);
      rondas.set(b.roundKey, r);
    }
    const propuestos: AsaltoHecho[] = [];
    for (const b of faltanT) {
      const t = tamano(b.roundKey);
      const posibles = [...rondas].filter(([k, r]) => tamano(k) === t && r.n < t! / 2 && !r.tiradores.has(b.aRef) && !r.tiradores.has(b.bRef));
      if (t === null || posibles.length !== 1) {
        fuera(posibles.length === 0 ? 'cuadro_sin_ronda_libre' : 'cuadro_ronda_ambigua');
        continue;
      }
      const [k, r] = posibles[0];
      r.n += 1;
      r.tiradores.add(b.aRef);
      r.tiradores.add(b.bRef);
      propuestos.push({ ...b, roundKey: k });
    }
    const todos = [...gt.map((b) => ({ ...b })), ...propuestos];
    const c = consistenciaCuadro(todos);
    propuestos.forEach((b, i) => {
      if (c.incoherentes.has(gt.length + i)) fuera('cuadro_incoherente');
      else anadidos.push(b);
    });
  }
  return { anadidos, motivos };
}

async function descargar() {
  const man: Manifiesto = { pruebas: [] };
  for (const f of FUENTES) {
    const lista = await indice(f.org, f.evt);
    console.log(`${f.org}/${f.evt}: ${lista.length} pruebas`);
    for (const p of lista) {
      if (p.individual === false) continue;
      const base = urlPruebaEngarde(f.org, f.evt, p.compe);
      const html = texto(await obtener(base));
      if (html === null) continue;
      const titulo = cheerio.load(html)('h1').first().text().replace(/\s+/g, ' ').trim() || p.titulo;
      const paginas = paginasDePrueba(html, f.org, f.evt, p.compe).slice(0, 30);
      for (const pg of paginas) await obtener(`${base}/${pg}`);
      man.pruebas.push({ org: f.org, evt: f.evt, compe: p.compe, titulo, paginas, arma: p.arma, genero: p.genero, categoria: p.categoria });
      console.log(`  ${p.compe} «${titulo}» ${p.arma} ${p.genero}: ${paginas.join(', ')}`);
    }
  }
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const eds = ediciones(parcialesDeBase(db));
  db.close();
  await descargarFww(eds, MANIFIESTO_FWW);
}

/** Pruebas con las dos fases guardadas pero alguna con cobertura `parcial`. */
export function parcialesDeBase(db: ReturnType<typeof abrirBase>): PruebaBase[] {
  const ids = new Set((db.prepare(`SELECT DISTINCT competition_id id FROM sport_import_coverage
    WHERE source = 'fie' AND fact_kind IN ('pools', 'tableau') AND status = 'parcial' AND CAST(season AS INTEGER) >= 2017`).all() as { id: string }[]).map((x) => x.id));
  return pruebasFieIndividuales(db, 2017).filter((p) => ids.has(p.id) && p.poule > 0 && p.tableau > 0 && (p.date ?? p.startDate ?? '9') < HOY);
}

type Lectura = Parameters<typeof anadirAsaltos>[1];
type Fuente = { nombre: string; url: string; sha: string; descripcion: string; lectura: Lectura; solape: number };

function fuentesEngarde(man: Manifiesto, p: PruebaBase, puestos: PuestoBase[]): Fuente[] {
  const salida: Fuente[] = [];
  for (const f of FUENTES.filter((x) => x.season === p.season && x.competitionKey === p.competitionKey)) {
    const candidatas = man.pruebas.filter((x) => x.org === f.org && x.evt === f.evt).map((x) => {
      const base = urlPruebaEngarde(x.org, x.evt, x.compe);
      const paginas: { nombre: string; url: string; html: string; sha: string }[] = [];
      let faltan = 0;
      for (const nombre of x.paginas) {
        const d = enCache(`${base}/${nombre}`);
        const html = texto(d);
        if (html === null || !d?.sha256) faltan += 1;
        else paginas.push({ nombre, url: `${base}/${nombre}`, html, sha: d.sha256 });
      }
      const final = paginas.find((q) => /^clasfinal\.htm$/i.test(q.nombre));
      const pagina = final ? parsearPaginaEngarde(final.html) : null;
      const clasificacion = pagina ? puestosDeEngarde(pagina).map((r) => ({ nombre: r.nombre, pais: r.pais })) : [];
      const at = atributosEngarde(x.titulo);
      return { ...x, base, paginas, faltan, clasificacion, arma: x.arma ?? at.weapon, genero: x.genero ?? at.gender };
    }).filter((c) => c.arma === p.weapon && c.genero === p.gender)
      .map((c) => ({ c, s: solape(puestos, c.clasificacion) })).sort((a, b) => b.s - a.s);
    const mejor = candidatas[0];
    if (!mejor || mejor.s < 0.7 || (candidatas[1] && candidatas[1].s > mejor.s - 0.15)) continue;
    const c = mejor.c;
    salida.push({
      nombre: `engarde ${f.org}/${f.evt}/${c.compe}`, url: c.base, sha: sha256(c.paginas.map((x) => x.sha).join('|')), solape: mejor.s,
      descripcion: `Engarde ${f.org}/${f.evt}/${c.compe} («${c.titulo}»; ${f.descripcion})`, lectura: leerEngarde(c.paginas, c.faltan),
    });
  }
  return salida;
}

function fuentesFww(man: ManifiestoFww, e: Edicion, p: PruebaBase, puestos: PuestoBase[]): Fuente[] {
  const candidatas = man.torneos.filter((t) => t.edicion === e.clave).flatMap((t) => t.pruebas.map((q) => {
    const res = texto(enCache(urlFww(q.ruta, 'results/')));
    return { torneo: t.torneo, ruta: q.ruta, destinos: q.destinos, resultados: res ? parsearResultadosFww(res) : null };
  })).filter((c) => c.resultados?.hayTabla && c.resultados.arma === p.weapon && c.resultados.genero === p.gender &&
    (c.resultados.categoria === null || c.resultados.categoria === p.category))
    .map((c) => ({ c, s: solape(puestos, c.resultados!.filas.map((f) => ({ nombre: f.nombre, pais: f.nacion }))) }))
    .sort((x, y) => y.s - x.s);
  const mejor = candidatas[0];
  if (!mejor || mejor.s < 0.7 || (candidatas[1] && candidatas[1].s > mejor.s - 0.15)) return [];
  const c = mejor.c;
  const paginas: { destino: string; html: string; sha: string }[] = [];
  for (const d of c.destinos) {
    const doc = enCache(urlFww(c.ruta, d));
    const html = texto(doc);
    if (html && doc?.sha256) paginas.push({ destino: d, html, sha: doc.sha256 });
  }
  return [{
    nombre: `fww ${c.ruta}`, url: urlFww(c.ruta, 'results/'), sha: sha256(paginas.map((x) => x.sha).join('|')), solape: mejor.s,
    descripcion: `Fencing Worldwide (Ophardt), torneo ${c.torneo.ruta} «${c.torneo.nombre}», prueba ${c.ruta}`,
    lectura: leerPruebaFww(paginas, c.resultados!),
  }];
}

function hechos() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  const man: Manifiesto = existsSync(MANIFIESTO) ? JSON.parse(readFileSync(MANIFIESTO, 'utf8')) : { pruebas: [] };
  const manFww: ManifiestoFww = existsSync(MANIFIESTO_FWW) ? JSON.parse(readFileSync(MANIFIESTO_FWW, 'utf8')) : { torneos: [] };
  const parciales = parcialesDeBase(db);
  const eds = ediciones(parciales);
  const informe: Record<string, unknown>[] = [];
  for (const e of eds) {
    for (const p of e.pruebas) {
      const id = `${p.season}-${p.competitionKey}`;
      const puestos = puestosDeBase(db, p.id);
      const fuentes = [...fuentesEngarde(man, p, puestos), ...fuentesFww(manFww, e, p, puestos)];
      if (fuentes.length === 0) {
        informe.push({ id, prueba: `${e.nombre} ${p.city ?? ''}`, motivo: 'sin otra publicación casada (Engarde/FWW)' });
        continue;
      }
      const guardados: Guardado[] = (db.prepare(`SELECT phase, round_key, fencer_a_ref, fencer_b_ref, score_a, score_b FROM sport_bout WHERE competition_id = ?`)
        .all(p.id) as Record<string, string | number>[]).map((x) => ({
        phase: x.phase as Guardado['phase'], roundKey: String(x.round_key), aRef: String(x.fencer_a_ref), bRef: String(x.fencer_b_ref),
        scoreA: Number(x.score_a), scoreB: Number(x.score_b),
      }));
      const base = hechosBase(p, puestos);
      const publicados = new Map((db.prepare(`SELECT fact_kind k, published_total n FROM sport_import_coverage
        WHERE source = 'fie' AND season = ? AND competition_key = ? AND fact_kind IN ('pools', 'tableau')`).all(p.season, p.competitionKey) as { k: string; n: number | null }[])
        .map((x) => [x.k, x.n]));
      const todos: AsaltoHecho[] = [];
      const usadas: Fuente[] = [];
      const filas: Record<string, unknown>[] = [];
      for (const f of fuentes) {
        const r = anadirAsaltos(base, f.lectura, { nombre: f.nombre, url: f.url, descripcion: f.descripcion });
        const { anadidos, motivos } = complementar([...guardados, ...todos], r.hechos.bouts);
        filas.push({
          fuente: f.nombre, solape: Number(f.solape.toFixed(2)),
          leidos: { poule: r.hechos.bouts.filter((b) => b.phase === 'POULE').length, cuadro: r.hechos.bouts.filter((b) => b.phase === 'TABLEAU').length },
          anadidos: { poule: anadidos.filter((b) => b.phase === 'POULE').length, cuadro: anadidos.filter((b) => b.phase === 'TABLEAU').length },
          motivos, sinCasar: r.informe.tiradores.sinCasar.length,
        });
        // La FIE publica cuántos asaltos tiene cada fase (sin los de retirados): no se pasa de ahí.
        for (const [fase, clave] of [['POULE', 'pools'], ['TABLEAU', 'tableau']] as const) {
          const tope = publicados.get(clave);
          const nuevosFase = anadidos.filter((b) => b.phase === fase).length;
          const yaHay = guardados.filter((b) => b.phase === fase).length + todos.filter((b) => b.phase === fase).length;
          if (nuevosFase > 0 && tope != null && yaHay + nuevosFase > tope) {
            (filas.at(-1)!.motivos as Record<string, number>)[`${clave}_excederia_total_publicado_${tope}`] = nuevosFase;
            (filas.at(-1)!.anadidos as Record<string, number>)[fase === 'POULE' ? 'poule' : 'cuadro'] = 0;
            for (let i = anadidos.length - 1; i >= 0; i -= 1) if (anadidos[i].phase === fase) anadidos.splice(i, 1);
          }
        }
        if (anadidos.length > 0) usadas.push(f);
        todos.push(...anadidos);
      }
      const fila = {
        id, prueba: `${e.nombre} ${p.city ?? ''} ${p.category} ${p.weapon} ${p.gender}`,
        guardados: { poule: guardados.filter((b) => b.phase === 'POULE').length, cuadro: guardados.filter((b) => b.phase === 'TABLEAU').length },
        fuentes: filas,
      };
      informe.push(fila);
      console.log(JSON.stringify(fila));
      if (todos.length === 0) continue;
      const nota = `lote7: asaltos que faltaban, de ${usadas.map((f) => `${f.descripcion} (${f.url})`).join('; ')}; colocados en la poule o ronda FIE por identidad de los tiradores; sólo se añaden, no sustituyen`;
      const h = hechosPrueba.parse({
        ...base, extractor: 'lote7_complemento', sourceUrl: usadas[0].url, sourceSha256: sha256(usadas.map((f) => f.sha).join('|')),
        status: { ...base.status, pools: 'parcial', tableau: 'parcial', notes: [...base.status.notes, nota] },
        bouts: todos,
      });
      writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
    }
  }
  db.close();
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), pruebas: informe }, null, 1)}\n`);
  for (const i of informe.filter((x) => 'motivo' in x)) console.log(JSON.stringify(i));
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote7-fie-parciales.ts descargar|hechos');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
