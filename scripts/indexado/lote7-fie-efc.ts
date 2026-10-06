/**
 * Asaltos de los Campeonatos de Europa (EFC) que la base tiene sin poules o
 * sin cuadro, desde el XML de resultados en formato FIE que la EFC publicaba
 * en `service.eurofencing.info/results/downloadresultxml/<id>` (el dominio
 * expiró en 2026; se leen las capturas de la Wayback Machine).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-efc.ts indice
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-efc.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-fie-efc.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * `indice` lee de la Wayback las páginas de campeonato de eurofencing.info
 * (`competitions/championships/case:competitions/tournamentId:<n>`) y anota
 * por prueba arma, género, categoría, PDF y XML, y si el XML tiene captura.
 * `descargar` baja los XML capturados; `hechos` trabaja sin red: cada prueba
 * FIE objetivo de un Campeonato de Europa se casa con la fila EFC del mismo
 * año, arma, género y categoría cuya clasificación comparte al menos la
 * mitad de los tiradores.
 */
import * as cheerio from 'cheerio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { abrirBase, puestosDeBase } from './fie-completar-comun';
import { hechosBase, solape } from './fie-completar-otras';
import { anadirAsaltos } from './fie-huecos-asaltos';
import { BASE_LOTE7, objetivos, soloFasesQueFaltan } from './lote7-fie-fww';
import { CARPETA_LOTE7, cdx, enCache, obtener, SALIDA_LOTE7, texto, urlWayback } from './lote7-fie-red';
import { leerXmlFie } from './lote7-fie-xml';

const INDICE = join(CARPETA_LOTE7, 'efc-championships.json');
const INFORME = join(CARPETA_LOTE7, 'efc-informe.json');
const PREFIJO_XML = 'service.eurofencing.info/results/downloadresultxml/';

export type FilaEfc = {
  tid: string; torneo: string; fecha: string; lugar: string; pais: string; arma: string; genero: string; cat: string; ev: string;
  pdf: string | null; xml: string | null; xid: string | null; xmlCap: string | null;
};

export function filasCampeonatoEfc(html: string, tid: string): FilaEfc[] {
  const $ = cheerio.load(html);
  const torneo = $('h1.page-header').text().replace(/\s+/g, ' ').trim();
  return $('table.table-fence tbody tr').toArray().map((tr) => {
    const td = $(tr).children('td');
    const g = (i: number) => td.eq(i).text().replace(/\s+/g, ' ').trim();
    const xml = $(tr).find('a.xml').attr('href') ?? null;
    return {
      tid, torneo, fecha: g(0), lugar: g(2), pais: g(3), arma: g(4), genero: td.eq(5).find('img').attr('alt') ?? '', cat: g(6), ev: g(7),
      pdf: $(tr).find('a.pdf').attr('href') ?? null, xml, xid: xml?.split('/').pop() ?? null, xmlCap: null,
    };
  });
}

async function indice() {
  const paginas = await cdx('eurofencing.info/competitions/championships/case:competitions/', { matchType: 'prefix', filter: 'statuscode:200' });
  const ultimas = new Map<string, { timestamp: string; original: string }>();
  for (const c of paginas) {
    const tid = /tournamentId:(\d+)$/.exec(c.original)?.[1];
    if (tid && (!ultimas.has(tid) || c.timestamp > ultimas.get(tid)!.timestamp)) ultimas.set(tid, c);
  }
  const xml = new Map<string, string>();
  for (const c of await cdx(PREFIJO_XML, { matchType: 'prefix', filter: 'statuscode:200' })) {
    const id = c.original.split('/').pop()!;
    if (!xml.has(id) || c.timestamp > xml.get(id)!) xml.set(id, c.timestamp);
  }
  const filas: FilaEfc[] = [];
  for (const [tid, c] of ultimas) {
    const html = texto(await obtener(urlWayback(c.timestamp, c.original)));
    if (!html) continue;
    for (const f of filasCampeonatoEfc(html, tid)) filas.push({ ...f, xmlCap: f.xid ? xml.get(f.xid) ?? null : null });
  }
  mkdirSync(CARPETA_LOTE7, { recursive: true });
  writeFileSync(INDICE, `${JSON.stringify(filas, null, 1)}\n`);
  console.log(`${filas.length} filas en ${INDICE}`);
}

const urlXml = (f: FilaEfc) => urlWayback(f.xmlCap!, `https://${PREFIJO_XML}${f.xid}`);

async function descargar() {
  const filas = JSON.parse(readFileSync(INDICE, 'utf8')) as FilaEfc[];
  for (const f of filas.filter((x) => x.xmlCap && /Individual/i.test(x.ev) && /20(1[7-9]|2\d)/.test(x.fecha))) {
    const d = await obtener(urlXml(f));
    console.log(`  ${f.tid} ${f.fecha} ${f.lugar} ${f.arma} ${f.genero} ${f.cat}: XML ${f.xid} HTTP ${d.status} ${d.bytes?.length ?? 0} B`);
  }
}

const CATEGORIA: Record<string, string> = { Cadets: 'M17', Juniors: 'M20', Seniors: 'ABS' };
const ARMA_XML: Record<string, string> = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' };
const CAT_XML: Record<string, string> = { C: 'M17', J: 'M20', S: 'ABS' };
const CABECERAS = join(CARPETA_LOTE7, 'efc-xml-cabeceras.json');
type CabeceraXml = { id: number; ts: string; tipo: string | null; titulo: string; fecha: string; arma: string; sexe: string; cat: string };

/** Cabecera de cada XML capturado a partir de un ID (los de 2024 en adelante no salen en páginas de campeonato capturadas). */
async function descargarCabeceras(desde: number) {
  const ult = new Map<number, string>();
  for (const c of await cdx(PREFIJO_XML, { matchType: 'prefix', filter: 'statuscode:200' })) {
    const id = Number(c.original.split('/').pop());
    if (id > desde && (!ult.has(id) || c.timestamp > ult.get(id)!)) ult.set(id, c.timestamp);
  }
  const salida: CabeceraXml[] = [];
  for (const [id, ts] of [...ult].sort((a, b) => a[0] - b[0])) {
    const h = texto(await obtener(urlWayback(ts, `https://${PREFIJO_XML}${id}`))) ?? '';
    const m = /<Competition(Individuelle|ParEquipes)([^>]*)>/.exec(h);
    const at = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(m?.[2] ?? '')?.[1] ?? '';
    salida.push({ id, ts, tipo: m?.[1] ?? null, titulo: at('TitreLong'), fecha: at('Date'), arma: at('Arme'), sexe: at('Sexe'), cat: at('Categorie') });
  }
  writeFileSync(CABECERAS, `${JSON.stringify(salida, null, 1)}\n`);
  console.log(`${salida.length} cabeceras en ${CABECERAS}`);
}
const ARMA: Record<string, string> = { Epee: 'ESPADA', Foil: 'FLORETE', Sabre: 'SABLE' };
const GENERO: Record<string, string> = { Female: 'F', Male: 'M' };

function hechos() {
  const db = abrirBase(argumento('db', BASE_LOTE7));
  const salida = argumento('salida', SALIDA_LOTE7);
  mkdirSync(salida, { recursive: true });
  if (!existsSync(INDICE)) throw new Error(`falta ${INDICE}: ejecuta antes «indice»`);
  const filas = (JSON.parse(readFileSync(INDICE, 'utf8')) as FilaEfc[]).filter((f) => /Individual/i.test(f.ev));
  const cabeceras = existsSync(CABECERAS) ? JSON.parse(readFileSync(CABECERAS, 'utf8')) as CabeceraXml[] : [];
  const informe: Record<string, unknown>[] = [];
  let escritos = 0;
  for (const p of objetivos(db).filter((x) => /Europe/i.test(x.editionName) && x.category !== 'ABS')) {
    const anio = (p.date ?? p.startDate)!.slice(0, 4);
    const clave = { season: p.season, competitionKey: p.competitionKey, categoria: p.category, arma: p.weapon, genero: p.gender };
    const candidatas = filas.filter((f) => f.fecha.slice(-4) === anio && ARMA[f.arma] === p.weapon && GENERO[f.genero] === p.gender &&
      CATEGORIA[f.cat] === p.category);

    const conXml = candidatas.filter((f) => f.xmlCap && enCache(urlXml(f)));
    // XML capturados sin página de campeonato capturada (2024): se identifican por su propia cabecera.
    for (const x of cabeceras.filter((c) => c.tipo === 'Individuelle' && /European (Cadet|Junior)s?\b.*Championship/i.test(c.titulo) &&
      c.fecha.slice(-4) === anio && ARMA_XML[c.arma] === p.weapon && c.sexe === p.gender && CAT_XML[c.cat] === p.category)) {
      if (conXml.some((f) => f.xid === String(x.id))) continue;
      conXml.push({ tid: '-', torneo: x.titulo, fecha: x.fecha, lugar: '', pais: '', arma: '', genero: '', cat: '', ev: 'Individual', pdf: null, xml: null, xid: String(x.id), xmlCap: x.ts });
    }
    if (conXml.length === 0) {
      informe.push(candidatas.length === 0
        ? { ...clave, motivo: 'sin página de campeonato ni XML capturados en Wayback para este año' }
        : { ...clave, efc: candidatas.map((f) => `${f.tid} ${f.lugar}`), pdf: candidatas.map((f) => f.pdf), motivo: 'sin XML capturado en Wayback (sólo PDF impreso, sin texto de asaltos)' });
      continue;
    }
    const puestos = puestosDeBase(db, p.id);
    const lecturas = conXml.map((f) => {
      const doc = enCache(urlXml(f))!;
      return { f, doc, l: leerXmlFie(texto(doc)!) };
    }).map((x) => ({ ...x, s: solape(puestos, x.l.puestos.map((q) => q.t)) })).sort((a, b) => b.s - a.s);
    const mejor = lecturas[0];
    if (mejor.s < 0.5 || (lecturas[1] && lecturas[1].s > mejor.s - 0.15) || mejor.l.arma !== p.weapon || mejor.l.genero !== p.gender) {
      informe.push({ ...clave, motivo: `XML sin solape suficiente (${lecturas.map((x) => x.s.toFixed(2)).join(' / ')})` });
      continue;
    }
    const publica = `https://web.archive.org/web/${mejor.f.xmlCap}/https://${PREFIJO_XML}${mejor.f.xid}`;
    const r = anadirAsaltos(hechosBase(p, puestos), mejor.l, {
      nombre: 'efc_xml', url: publica,
      descripcion: `XML de resultados FIE publicado por la EFC (${mejor.f.torneo}, ${mejor.f.lugar} ${mejor.f.fecha}), captura Wayback ${mejor.f.xmlCap}`,
    });
    const h = soloFasesQueFaltan(hechosPrueba.parse({ ...r.hechos, extractor: 'lote7_efc_xml', sourceUrl: publica, sourceSha256: mejor.doc.sha256! }), p);
    const fila = {
      ...clave, xml: mejor.f.xid, solape: Number(mejor.s.toFixed(2)),
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
  db.close();
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, pruebas: informe }, null, 1)}\n`);
  for (const i of informe) console.log(JSON.stringify(i));
  console.log(`${escritos} ficheros en ${salida}; informe en ${INFORME}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'indice') await indice();
  else if (orden === 'descargar') {
    await descargar();
    await descargarCabeceras(Number(argumento('cabeceras-desde', '3150')));
  }
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote7-fie-efc.ts indice|descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
