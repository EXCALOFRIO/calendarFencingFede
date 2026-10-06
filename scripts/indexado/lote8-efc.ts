/**
 * Pruebas del circuito EFC que el lote 7 dejó sin captura del XML en la Wayback Machine
 * (`xml_sin_captura` de `hechos/lote7-efc/_informe-efc.json`). Su página de torneo enlazaba
 * además un documento en el almacén público de la EFC (`efc-prod.s3.amazonaws.com`), que sigue
 * accesible sin sesión.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8-efc.ts [--pdf]
 *
 * - XML (formato FIE): se lee con el mismo lector que el lote 7 y se escribe en
 *   `hechos/lote8-efc/` con las claves del lote 7 (edición del mismo torneo si el lote 7 tiene
 *   otras pruebas suyas).
 * - PDF: no hay lector para estos PDF (FencingTime, Engarde en francés o italiano...); con `--pdf`
 *   sólo se comprueba que el documento responde y se anota su tamaño.
 * Se omiten las que ya tienen lectura compatible (lote 7 por Engarde o Fencing Worldwide).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { bandera, CARPETA_TRABAJO } from './comun';
import { compatibles, especieDe, especieEfcPendiente, registrosDeCarpetas } from './cobertura';
import { temporadaRfee } from './engarde-a-hechos';
import { claveEvento, clavePrueba, decodificarXml, pruebaEquiposXml, pruebaIndividualXml } from './lote7-efc';
import { HECHOS_LOTE8, RedLote8 } from './lote8-red';

export const SALIDA_EFC8 = HECHOS_LOTE8('efc');
const HECHOS = join(CARPETA_TRABAJO, 'hechos');

/** Sede de «Cadet Circuit Espoo Helsinki» / «Cadets Circuit Napoli». */
export const sedeDeTorneo = (torneo: string) => torneo.replace(/^\s*cadets?\s+circuit\s+/i, '').trim() || torneo;

type Edicion = HechosPrueba['edition'];

/** Edición ya escrita por id de torneo de eurofencing.info (lo dicen sus notas). */
export function edicionesEfc(carpetas: readonly string[] = ['lote7-efc', 'lote8-efc']): Map<string, Edicion> {
  const m = new Map<string, Edicion>();
  for (const c of carpetas) {
    const dir = join(HECHOS, c);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const h = JSON.parse(readFileSync(join(dir, f), 'utf8')) as HechosPrueba;
      const tid = h.status.notes.map((n) => /torneo (\d+) de eurofencing\.info/.exec(n)?.[1]).find(Boolean);
      if (tid && !m.has(tid)) m.set(tid, h.edition);
    }
  }
  return m;
}

const edicionesLote7 = () => edicionesEfc(['lote7-efc']);

async function main(): Promise<void> {
  const conPdf = bandera('pdf');
  const inf = JSON.parse(readFileSync(join(HECHOS, 'lote7-efc', '_informe-efc.json'), 'utf8')) as { detalle: Record<string, string>[] };
  const pendientes = inf.detalle.filter((d) => d.motivo === 'xml_sin_captura');
  const leidas = [...registrosDeCarpetas(HECHOS, 'lote7-', 'lote7')].filter((r) => r.source === 'efc').map(especieDe);
  const ediciones = edicionesLote7();
  const red = new RedLote8();
  mkdirSync(SALIDA_EFC8, { recursive: true });
  const motivos: Record<string, number> = {};
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  const detalle: Record<string, unknown>[] = [];
  let puestos = 0;
  let poules = 0;
  let cuadro = 0;
  for (const d of pendientes) {
    const s = especieEfcPendiente(d.prueba, d.fecha);
    const base = { tid: d.tid, xid: d.xid, torneo: d.torneo, prueba: d.prueba, fecha: d.fecha, url: d.pdf ?? null };
    if (s.weapon && leidas.some((x) => compatibles(x, s, 3))) {
      anotar('ya_leida_lote7');
      detalle.push({ ...base, motivo: 'ya_leida_lote7' });
      continue;
    }
    if (!d.pdf) {
      anotar('sin_documento');
      detalle.push({ ...base, motivo: 'sin_documento' });
      continue;
    }
    const url = encodeURI(d.pdf);
    const esXml = /\.xml$/i.test(d.pdf);
    if (!esXml && !conPdf) {
      anotar('pdf_sin_lector');
      detalle.push({ ...base, motivo: 'pdf_sin_lector' });
      continue;
    }
    const doc = await red.obtener(url);
    if (doc.status !== 200 || !doc.bytes) {
      anotar(`http_${doc.status}`);
      detalle.push({ ...base, motivo: `http_${doc.status}` });
      continue;
    }
    const cuerpo = Buffer.from(doc.bytes);
    if (!/^\s*(\uFEFF)?<\?xml/.test(cuerpo.subarray(0, 64).toString('latin1'))) {
      anotar('pdf_sin_lector');
      detalle.push({ ...base, motivo: 'pdf_sin_lector', bytes: cuerpo.length });
      continue;
    }
    const xml = decodificarXml(cuerpo);
    const p = /<CompetitionParEquipes\b/.test(xml) ? pruebaEquiposXml(xml) : pruebaIndividualXml(xml);
    if (!p) {
      anotar('xml_ilegible');
      detalle.push({ ...base, motivo: 'xml_ilegible' });
      continue;
    }
    const previa = ediciones.get(d.tid);
    const fecha = p.atributos.fecha;
    const season = previa?.season ?? temporadaRfee(fecha);
    const tournamentKey = previa?.tournamentKey ?? `efc:${season}:${claveEvento(sedeDeTorneo(d.torneo), s.fecha ?? fecha)}`;
    const evento = tournamentKey.split(':').slice(2).join(':');
    const h = hechosPrueba.parse({
      version: 1, source: 'efc', extractor: 'lector_efc_xml', sourceUrl: url, sourceSha256: doc.sha256,
      edition: previa ?? { season, tournamentKey, name: d.torneo, startDate: s.fecha ?? fecha, endDate: fecha, city: sedeDeTorneo(d.torneo), countryCode: null },
      competition: {
        competitionKey: clavePrueba(season, evento, p.atributos), weapon: p.atributos.weapon, gender: p.atributos.gender, category: p.atributos.category,
        categoryRaw: p.titulo || null, format: p.atributos.format, date: fecha,
      },
      status: { ...p.status, notes: [...p.status.notes, `Lote 8: XML de la EFC (id ${d.xid}) del almacén público de la EFC; torneo ${d.tid} de eurofencing.info`] },
      results: p.results,
      bouts: p.bouts,
    });
    writeFileSync(join(SALIDA_EFC8, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
    anotar('escrita');
    puestos += h.results.length;
    poules += h.bouts.filter((b) => b.phase === 'POULE').length;
    cuadro += h.bouts.filter((b) => b.phase === 'TABLEAU').length;
    detalle.push({ ...base, motivo: 'escrita', clave: h.competition.competitionKey, puestos: h.results.length, estados: h.status });
  }
  const informe = { generado: new Date().toISOString(), pendientes: pendientes.length, motivos, puestos, poules, cuadro, peticiones: red.peticiones, detalle };
  writeFileSync(join(SALIDA_EFC8, '_informe.json'), `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify({ ...informe, detalle: undefined }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
