/**
 * Cuadro de los Campeonatos de Europa por equipos (pruebas FIE) que la API de la FIE publica
 * vacío, desde el XML de resultados de la EFC (`service.eurofencing.info/results/downloadresultxml/<id>`,
 * capturas de la Wayback Machine indexadas por `lote7-fie-efc.ts indice`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8-fie-efc-equipos.ts [--huecos <cobertura/huecos-tras-lote7.json>] [--db <nuevo7.sqlite>]
 *
 * Cada prueba FIE por equipos de un Campeonato de Europa que sigue sin cuadro tras
 * `lote8-fie-equipos` se casa con la fila EFC del mismo arma, género, categoría y fecha (±3 días).
 * Los equipos del XML se identifican por nación con el equipo FIE de esa nación en la
 * clasificación oficial (`team:<id FIE>`); el XML se acepta sólo si su clasificación coincide
 * con la oficial en al menos el 80 % de las naciones comunes y en el campeón. Escribe
 * `hechos/lote8-fie-efc/fie__<temporada>__<id>.json` con las claves FIE, sin clasificación y con
 * los encuentros del cuadro principal (rondas `A<n>` como el resto de la FIE).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho } from '../../src/lib/ingest/hechos/formato';
import { argumento, CARPETA_TRABAJO } from './comun';
import { CARPETA_COBERTURA, compatibles, NUEVO7_COBERTURA } from './cobertura';
import { decodificarXml, fechaEfc, pruebaEquiposXml } from './lote7-efc';
import type { FilaEfc } from './lote7-fie-efc';
import { enCache as enCacheLote7, urlWayback } from './lote7-fie-red';
import { clasificaciones } from './lote8-fie-equipos';
import { HECHOS_LOTE8, RedLote8 } from './lote8-red';

export const SALIDA_FIE_EFC = HECHOS_LOTE8('fie-efc');
const INDICE = join(CARPETA_TRABAJO, 'cache-lote7-fie', 'efc-championships.json');
const PREFIJO_XML = 'service.eurofencing.info/results/downloadresultxml/';

const ARMA: Record<string, string> = { Epee: 'ESPADA', Foil: 'FLORETE', Sabre: 'SABLE' };
const CATEGORIA: Record<string, string> = { Cadets: 'M17', Juniors: 'M20', 'U23 EC': 'M23', Seniors: 'ABS' };

export type EquipoFie = { ref: string; pais: string | null; puesto: number | null };

/**
 * Encuentros del XML con las referencias FIE por nación. Devuelve null y el motivo si la
 * clasificación del XML no es la oficial.
 */
export function encuentrosConRefsFie(
  xml: { results: { factKey: string; countryCode: string | null; position: number | null }[]; bouts: AsaltoHecho[] },
  fie: readonly EquipoFie[],
): { bouts: AsaltoHecho[]; descartados: number } | { motivo: string } {
  const porPais = new Map<string, EquipoFie[]>();
  for (const e of fie) if (e.pais) porPais.set(e.pais, [...(porPais.get(e.pais) ?? []), e]);
  const refDe = new Map<string, EquipoFie>();
  let comunes = 0;
  let iguales = 0;
  for (const r of xml.results) {
    const cand = r.countryCode ? porPais.get(r.countryCode) ?? [] : [];
    if (cand.length !== 1) continue;
    refDe.set(r.factKey, cand[0]);
    if (r.position !== null && cand[0].puesto !== null) {
      comunes += 1;
      if (r.position === cand[0].puesto) iguales += 1;
    }
  }
  const campeonXml = xml.results.find((r) => r.position === 1);
  const campeonFie = fie.find((e) => e.puesto === 1);
  if (!campeonXml || !campeonFie || refDe.get(campeonXml.factKey)?.ref !== campeonFie.ref) return { motivo: 'campeon_distinto' };
  if (comunes < 2 || iguales / comunes < 0.8) return { motivo: `clasificacion_distinta:${iguales}/${comunes}` };
  const bouts: AsaltoHecho[] = [];
  let descartados = 0;
  for (const b of xml.bouts) {
    const a = refDe.get(b.aRef);
    const c = refDe.get(b.bRef);
    if (!a || !c || a.ref === c.ref) {
      descartados += 1;
      continue;
    }
    const swap = a.ref > c.ref;
    bouts.push({
      phase: 'TABLEAU', roundKey: b.roundKey.replace(/^T(\d+)$/, 'A$1'),
      aRef: swap ? c.ref : a.ref, bRef: swap ? a.ref : c.ref, aName: swap ? b.bName : b.aName, bName: swap ? b.aName : b.bName,
      scoreA: swap ? b.scoreB : b.scoreA, scoreB: swap ? b.scoreA : b.scoreB,
      winner: b.winner === null ? null : (b.winner === 'A') !== swap ? 'A' : 'B',
    });
  }
  return { bouts, descartados };
}

async function main(): Promise<void> {
  const huecos = JSON.parse(readFileSync(argumento('huecos', join(CARPETA_COBERTURA, 'huecos-tras-lote7.json')), 'utf8')) as {
    huecos: { id: string; fuente: string; formato: string; nombre: string; arma: string; genero: string; categoria: string; fecha: string; faltan: string[]; faltanTrasLote8?: string[] }[];
  };
  const objetivos = huecos.huecos.filter((h) => h.fuente === 'FIE' && h.formato === 'EQUIPOS' && /europe/i.test(h.nombre) &&
    (h.faltanTrasLote8 ?? h.faltan).includes('cuadro') && !(h.faltanTrasLote8 && h.faltanTrasLote8.length === 0));
  const yaLote8 = new Set(existsSync(HECHOS_LOTE8('fie-equipos')) ? readdirSync(HECHOS_LOTE8('fie-equipos')) : []);
  const filas = (JSON.parse(readFileSync(INDICE, 'utf8')) as FilaEfc[]).filter((f) => f.ev === 'Team' && f.xmlCap && f.xid);
  const db = new DatabaseSync(argumento('db', NUEVO7_COBERTURA), { readOnly: true });
  const edicion = db.prepare(`SELECT c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.competition_date, e.tournament_key, e.name,
      e.start_date, e.end_date, e.city, e.country_code FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND c.season = ? AND c.competition_key = ?`);
  const equiposDe = clasificaciones(db, join(CARPETA_TRABAJO, 'hechos'));
  const red = new RedLote8();
  mkdirSync(SALIDA_FIE_EFC, { recursive: true });
  const motivos: Record<string, number> = {};
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  const detalle: Record<string, unknown>[] = [];
  const escritos = new Set<string>();
  let encuentros = 0;
  for (const h of objetivos) {
    const [, season, key] = h.id.split(':');
    if (yaLote8.has(`fie__${season}__${key}.json`)) continue;
    const fila = filas.filter((f) => {
      const fin = fechaEfc(f.fecha);
      const ini = /^(\d{2})\/(\d{2})/.exec(f.fecha);
      const desde = ini && fin ? `${fin.slice(0, 4)}-${ini[2]}-${ini[1]}` : fin;
      const especie = { weapon: ARMA[f.arma] ?? null, gender: f.genero === 'Female' ? 'F' : f.genero === 'Male' ? 'M' : null, category: CATEGORIA[f.cat] ?? null, format: 'EQUIPOS', vet: null };
      const objetivo = { weapon: h.arma, gender: h.genero, category: h.categoria, format: 'EQUIPOS', fecha: h.fecha, vet: null };
      return [desde, fin].some((d) => d && compatibles(objetivo, { ...especie, fecha: d }, 3));
    });
    if (fila.length !== 1) {
      anotar(fila.length === 0 ? 'sin_xml_efc' : 'varias_filas_efc');
      detalle.push({ id: h.id, motivo: fila.length === 0 ? 'sin_xml_efc' : 'varias_filas_efc' });
      continue;
    }
    const f = fila[0];
    const url = urlWayback(f.xmlCap!, `https://${PREFIJO_XML}${f.xid}`);
    const doc = enCacheLote7(url) ?? (await red.obtener(url));
    if (!doc?.bytes || doc.status !== 200) {
      anotar('xml_no_descargado');
      detalle.push({ id: h.id, motivo: 'xml_no_descargado', url });
      continue;
    }
    const p = pruebaEquiposXml(decodificarXml(Buffer.from(doc.bytes)));
    if (!p) {
      anotar('xml_ilegible');
      detalle.push({ id: h.id, motivo: 'xml_ilegible', url });
      continue;
    }
    const fie: EquipoFie[] = [...equiposDe(season, key).values()].map((x) => ({ ref: x.ref, pais: x.pais ?? null, puesto: x.puesto }));
    // Sin clasificación FIE en ninguna lectura: la del XML de la EFC (organizador), con las
    // claves del XML; no hay clasificación oficial con la que validarla.
    const r = fie.length > 0 ? encuentrosConRefsFie(p, fie) : { bouts: p.bouts.map((b) => ({ ...b, roundKey: b.roundKey.replace(/^T(\d+)$/, 'A$1') })), descartados: 0 };
    const conClasificacion = fie.length === 0;
    if ('motivo' in r) {
      anotar(r.motivo.split(':')[0]);
      detalle.push({ id: h.id, motivo: r.motivo, url });
      continue;
    }
    if (r.bouts.length === 0) {
      anotar('sin_encuentros');
      detalle.push({ id: h.id, motivo: 'sin_encuentros', url });
      continue;
    }
    const e = edicion.get(season, key) as Record<string, string | null>;
    const hechos = hechosPrueba.parse({
      version: 1, source: 'fie', extractor: 'lector_fie', sourceUrl: url, sourceSha256: doc.sha256,
      edition: {
        season, tournamentKey: e.tournament_key, name: e.name, startDate: e.start_date, endDate: e.end_date, city: e.city,
        countryCode: e.country_code && /^[A-Z]{3}$/.test(e.country_code) ? e.country_code : null,
      },
      competition: { competitionKey: key, weapon: e.weapon, gender: e.gender, category: e.category, categoryRaw: e.category_raw, format: 'EQUIPOS', date: e.competition_date },
      status: {
        results: conClasificacion ? p.status.results : 'sin_resultados', pools: 'sin_resultados',
        tableau: r.descartados > 0 || p.status.tableau !== 'completo' ? 'parcial' : 'completo', publishedParticipants: conClasificacion ? p.status.publishedParticipants : null,
        notes: [
          `Lote 8: cuadro principal del Campeonato de Europa desde el XML de la EFC (id ${f.xid}, captura ${f.xmlCap} de la Wayback Machine); la API FIE lo publica vacío`,
          conClasificacion
            ? 'La FIE no publica clasificación: clasificación y equipos del XML de la EFC (claves team:efc:<nación>), sin clasificación oficial con la que validar'
            : 'Equipos identificados por nación con la clasificación oficial FIE (≥80 % de puestos iguales y mismo campeón); results vacío a propósito',
          ...(r.descartados ? [`${r.descartados} encuentros sin equipo FIE identificable`] : []),
          ...p.status.notes,
        ],
      },
      results: conClasificacion ? p.results : [],
      bouts: r.bouts,
    });
    const fichero = ficheroHechos(hechos);
    writeFileSync(join(SALIDA_FIE_EFC, fichero), `${JSON.stringify(hechos, null, 1)}\n`);
    escritos.add(fichero);
    encuentros += r.bouts.length;
    anotar('escrita');
    detalle.push({ id: h.id, motivo: 'escrita', encuentros: r.bouts.length, url });
  }
  db.close();
  for (const x of readdirSync(SALIDA_FIE_EFC)) if (x.endsWith('.json') && !x.startsWith('_') && !escritos.has(x)) rmSync(join(SALIDA_FIE_EFC, x));
  const informe = { generado: new Date().toISOString(), objetivos: objetivos.length, escritas: escritos.size, encuentros, motivos, peticiones: red.peticiones, detalle };
  writeFileSync(join(SALIDA_FIE_EFC, '_informe.json'), `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify({ ...informe, detalle: undefined }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
