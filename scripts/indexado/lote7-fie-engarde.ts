/**
 * Asaltos de pruebas FIE individuales sin poules o sin cuadro en la base,
 * desde torneos Engarde (engarde-service.com) de los organizadores que las
 * alojaron. Los torneos se fijan a mano tras revisar las listas de
 * `prog/getTournois.php` de los organizadores candidatos (fecha y título).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-engarde.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-engarde.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * Cada prueba FIE objetivo de la edición se casa con la única prueba Engarde
 * del torneo con su arma y género cuya clasificación final comparte al menos
 * la mitad de los tiradores; los asaltos llevan las `source_fact_key` de la
 * clasificación guardada y sólo se emiten las fases que la base no tiene.
 */
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba } from '../../src/lib/ingest/hechos/formato';
import {
  ENGARDE_INDICE, parsearIndiceEngarde, parsearPaginaEngarde, puestosDeEngarde, urlPruebaEngarde, type PruebaEngarde,
} from '../../src/lib/ingest/sources/engarde';
import { argumento } from './comun';
import { formularioIndiceEngarde, paginasDePrueba } from './engarde-descargar';
import { abrirBase, puestosDeBase } from './fie-completar-comun';
import { atributosEngarde, hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos, leerEngarde } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, enCache, obtener, SALIDA_LOTE7, sha256, texto, userAgent } from './lote7-fie-red';

type FuenteEngarde = { org: string; evt: string; season: string; tournamentKey: string; descripcion: string };

export const FUENTES: FuenteEngarde[] = [
  { org: 'rfee', evt: 'palma', season: '2026', tournamentKey: '30', descripcion: 'Copa del Mundo absoluta de florete «Ciutat de Palma», noviembre de 2025' },
  { org: 'rfee', evt: 'bcn25', season: '2026', tournamentKey: '24', descripcion: 'Satélite de espada de Barcelona, octubre de 2025' },
  { org: 'rfee', evt: 'sabadell25', season: '2026', tournamentKey: '24', descripcion: 'Satélite de florete Sabadell-Barcelona, octubre de 2025' },
  { org: 'fie_fencing', evt: 'asian_championship_amman2019', season: '2019', tournamentKey: 'competition:769', descripcion: 'Campeonatos de Asia júnior y cadete, Ammán 2019' },
  { org: 'eyad', evt: 'cj_jor_18m', season: '2022', tournamentKey: 'campeonato_mediterraneo|c:al salt', descripcion: 'Campeonato del Mediterráneo cadete y júnior, Ammán 2022' },
];

const MANIFIESTO = join(CARPETA_LOTE7, 'engarde-manifiesto.json');
const INFORME = join(CARPETA_LOTE7, 'engarde-informe.json');

type Manifiesto = { pruebas: { org: string; evt: string; compe: string; titulo: string; paginas: string[]; arma: string | null; genero: string | null; categoria?: string | null }[] };

export async function indice(org: string, evt: string) {
  const pruebas: PruebaEngarde[] = [];
  for (let pagina = 1, total = 1; pagina <= total && pagina <= 10; pagina += 1) {
    const fichero = join(CARPETA_LOTE7, 'engarde-indices', `${org}__${evt}__p${pagina}.xml`);
    let xml: string;
    if (existsSync(fichero)) xml = readFileSync(fichero, 'utf8');
    else {
      const r = await fetch(ENGARDE_INDICE, {
        method: 'POST',
        headers: { 'User-Agent': userAgent(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formularioIndiceEngarde(org, evt, pagina)),
      });
      xml = await r.text();
      mkdirSync(join(CARPETA_LOTE7, 'engarde-indices'), { recursive: true });
      writeFileSync(fichero, xml);
      await new Promise((ok) => setTimeout(ok, 700));
    }
    const i = parsearIndiceEngarde(xml);
    if (!i.ok) break;
    total = i.paginas;
    pruebas.push(...i.pruebas);
  }
  return pruebas;
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
      const paginas = paginasDePrueba(html, f.org, f.evt, p.compe).slice(0, 24);
      for (const pg of paginas) await obtener(`${base}/${pg}`);
      man.pruebas.push({ org: f.org, evt: f.evt, compe: p.compe, titulo, paginas, arma: p.arma, genero: p.genero, categoria: p.categoria });
      console.log(`  ${p.compe} «${titulo}» ${p.arma} ${p.genero}: ${paginas.join(', ')}`);
    }
  }
  mkdirSync(CARPETA_LOTE7, { recursive: true });
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO}`);
}

function hechos() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const obj = objetivos(db);
  const informe: Record<string, unknown>[] = [];
  let escritos = 0;
  for (const f of FUENTES) {
    const pruebas = obj.filter((p) => p.season === f.season && p.tournamentKey === f.tournamentKey);
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
      const final = paginas.find((p) => /^clasfinal\.htm$/i.test(p.nombre));
      const pagina = final ? parsearPaginaEngarde(final.html) : null;
      const clasificacion = pagina ? puestosDeEngarde(pagina).map((r) => ({ nombre: r.nombre, pais: r.pais })) : [];
      const at = atributosEngarde(x.titulo);
      return { ...x, base, paginas, faltan, clasificacion, arma: x.arma ?? at.weapon, genero: x.genero ?? at.gender, categoria: x.categoria ?? at.category };
    });
    for (const p of pruebas) {
      const clave = { season: p.season, competitionKey: p.competitionKey, fuente: `${f.org}/${f.evt}` };
      const puestos = puestosDeBase(db, p.id);
      const compatibles = candidatas
        .filter((c) => c.arma === p.weapon && c.genero === p.gender && (c.categoria == null || c.categoria === p.category))
        .map((c) => ({ c, s: solape(puestos, c.clasificacion) }))
        .sort((a, b) => b.s - a.s);
      const mejor = compatibles[0];
      if (!mejor || mejor.s < 0.5 || (compatibles[1] && compatibles[1].s > mejor.s - 0.15)) {
        if (mejor) informe.push({ ...clave, motivo: `sin prueba Engarde con solape suficiente (${compatibles.slice(0, 2).map((x) => x.s.toFixed(2)).join(' / ')})` });
        continue;
      }
      const c = mejor.c;
      const r = anadirAsaltos(hechosBase(p, puestos), leerEngarde(c.paginas, c.faltan), {
        nombre: 'engarde', url: c.base,
        descripcion: `poules y cuadro publicados en Engarde (${f.org}/${f.evt}/${c.compe}, «${c.titulo}»; ${f.descripcion})`,
      });
      const h = soloFasesQueFaltan(hechosPrueba.parse({
        ...r.hechos, extractor: 'lote7_engarde', sourceUrl: c.base, sourceSha256: sha256(c.paginas.map((x) => x.sha).join('|')),
      }), p);
      const fila = {
        ...clave, compe: c.compe, solape: Number(mejor.s.toFixed(2)),
        pools: { importados: h.bouts.filter((b) => b.phase === 'POULE').length, esperados: r.informe.pools.esperados, estado: h.status.pools, descartados: r.informe.pools.descartados },
        tableau: { importados: h.bouts.filter((b) => b.phase === 'TABLEAU').length, esperados: r.informe.tableau.esperados, estado: h.status.tableau, descartados: r.informe.tableau.descartados },
        sinCasar: r.informe.tiradores.sinCasar,
      };
      if (h.bouts.length === 0) {
        informe.push({ ...fila, motivo: 'ningún asalto válido de una fase que falte' });
        continue;
      }
      writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
      escritos += 1;
      informe.push(fila);
    }
  }
  db.close();
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, pruebas: informe }, null, 1)}\n`);
  for (const i of informe) console.log(JSON.stringify(i));
  console.log(`${escritos} ficheros en ${salida}; informe en ${INFORME}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote7-fie-engarde.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
