/**
 * Asaltos de pruebas FIE individuales sin poules o sin cuadro en la base,
 * desde páginas estáticas de Fencing Time (`FTEvent<id>.htm`) que los
 * organizadores publicaron en su web y que sólo siguen en la Wayback Machine.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-ft.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-ft.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * El sitio se localiza por la URL que imprimen los PDF de documentación que
 * enlaza Ophardt (cabecera «Live Results … FTEvent…»). De cada `FTEvent` se
 * toma la última captura 200; cada prueba FIE de la edición se casa con la
 * única página de su arma, género y categoría cuya clasificación comparte al
 * menos la mitad de los tiradores. Se reutiliza el lector `leerFt` de
 * `fie-huecos-asaltos.ts` y sólo se emiten las fases que la base no tiene.
 */
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { abrirBase, puestosDeBase } from './fie-completar-comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos, leerFt } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, cdx, enCache, obtener, SALIDA_LOTE7, texto, urlWayback } from './lote7-fie-red';

type FuenteFt = { season: string; edicion: RegExp; prefijo: string; descripcion: string };

export const FUENTES: FuenteFt[] = [
  {
    season: '2018', edicion: /Panam.*Cadets/i, prefijo: 'esgrimacostarica.net/html/resultados/live_results/',
    descripcion: 'Campeonato Panamericano cadete y júnior, San José (Costa Rica) 2018, publicado en esgrimacostarica.net',
  },
];

const MANIFIESTO = join(CARPETA_LOTE7, 'ft-manifiesto.json');
const INFORME = join(CARPETA_LOTE7, 'ft-informe.json');

type Manifiesto = { capturas: { prefijo: string; evento: string; timestamp: string; original: string }[] };

export function categoriaFt(cabecera: string): 'M17' | 'M20' | 'ABS' | null {
  const t = cabecera.toLowerCase();
  if (/\bcadet/.test(t)) return 'M17';
  if (/\bjunior/.test(t)) return 'M20';
  if (/\bsenior/.test(t)) return 'ABS';
  return null;
}

async function descargar() {
  const man: Manifiesto = { capturas: [] };
  for (const f of FUENTES) {
    const ultimas = new Map<string, { timestamp: string; original: string }>();
    for (const c of await cdx(f.prefijo, { matchType: 'prefix', filter: 'statuscode:200' })) {
      const evento = /FTEvent(\d+)\.htm$/i.exec(c.original)?.[1];
      if (!evento) continue;
      const p = ultimas.get(evento);
      if (!p || c.timestamp > p.timestamp) ultimas.set(evento, c);
    }
    for (const [evento, c] of ultimas) {
      const d = await obtener(urlWayback(c.timestamp, c.original));
      console.log(`  ${f.season} FTEvent${evento} ${c.timestamp} HTTP ${d.status} ${d.bytes?.length ?? 0} B`);
      if (d.status === 200) man.capturas.push({ prefijo: f.prefijo, evento, timestamp: c.timestamp, original: c.original });
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
    const paginas = man.capturas.filter((c) => c.prefijo === f.prefijo).flatMap((c) => {
      const url = urlWayback(c.timestamp, c.original);
      const doc = enCache(url);
      const html = texto(doc);
      if (!html || !doc?.sha256) return [];
      const cabecera = cheerio.load(html)('.tournDetails').first().text();
      if (/team|équipe|equipos/i.test(cabecera)) return [];
      return [{ ...c, html, sha: doc.sha256, lectura: leerFt(html), categoria: categoriaFt(cabecera), publica: `https://web.archive.org/web/${c.timestamp}/${c.original}` }];
    });
    for (const p of obj.filter((x) => x.season === f.season && f.edicion.test(x.editionName))) {
      const clave = { season: p.season, competitionKey: p.competitionKey };
      const puestos = puestosDeBase(db, p.id);
      const compatibles = paginas
        .filter((x) => x.lectura.arma === p.weapon && x.lectura.genero === p.gender && (x.categoria === null || x.categoria === p.category))
        .map((x) => ({ x, s: solape(puestos, x.lectura.puestos.map((q) => q.t)) }))
        .sort((a, b) => b.s - a.s);
      const mejor = compatibles[0];
      if (!mejor || mejor.s < 0.5 || (compatibles[1] && compatibles[1].s > mejor.s - 0.15)) {
        informe.push({ ...clave, motivo: `sin página FTEvent con solape suficiente (${compatibles.slice(0, 2).map((c) => c.s.toFixed(2)).join(' / ')})` });
        continue;
      }
      const x = mejor.x;
      const r = anadirAsaltos(hechosBase(p, puestos), x.lectura, {
        nombre: 'fencingtime_wayback', url: x.publica,
        descripcion: `poules y cuadro de Fencing Time (FTEvent${x.evento}) archivados en Wayback (captura ${x.timestamp}); ${f.descripcion}`,
      });
      const h = soloFasesQueFaltan(hechosPrueba.parse({ ...r.hechos, extractor: 'lote7_fencingtime', sourceUrl: x.publica, sourceSha256: x.sha }), p);
      const fila = {
        ...clave, evento: x.evento, solape: Number(mejor.s.toFixed(2)),
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
  else throw new Error('uso: lote7-fie-ft.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
