/**
 * Huecos RFEE de prioridad 1 cuyo catálogo (o cuya lectura existente) enlaza un torneo de Engarde
 * que ya no publica los datos: se buscan en la Wayback Machine las exportaciones estáticas
 * archivadas (`/files/{org}/{evt}/{compe}/…`) y se leen con el lector de exportaciones estáticas
 * (`convertirEntrada` de `engarde-historico-a-hechos.ts`), como `lote7-faltan-engarde-wayback.ts`,
 * pero también para las pruebas que existen sin alguna fase.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-engarde-wayback.ts \
 *     --huecos <huecos-tras-lote7.json de cobertura.ts sobre nuevo9> [--db <nuevo9.sqlite>]
 *
 * Se escribe una prueba (clave de Engarde `engarde:{org}/{evt}/{compe}`) si:
 *  - arma, categoría, modalidad y fecha (±2 días) casan con un único hueco del mismo torneo y
 *    el género es compatible; en veteranos, también el grupo de edad;
 *  - aporta alguna fase que al hueco le falta;
 *  - si el hueco tiene ya clasificación en la base (Skermo o PDF), al menos el 60 % de sus
 *    nombres están en la lectura y, de los que están, el 90 % tienen el mismo puesto; en
 *    equipos con lectura de otra fuente no se escribe (nada la fusionaría).
 * Los asaltos con marcadores imposibles (empate sin ganador, más de 5 tocados en poule, más de
 * 15 en cuadro individual o de 45 en equipos) se quitan y la fase pasa a parcial.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import type { AsaltoHecho, HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { grupoVet } from './cobertura';
import { argumento } from './comun';
import { enlaceEngarde } from './engarde-descargar';
import { convertirEntrada, type EntradaPrueba } from './engarde-historico-a-hechos';
import { nombresCompatibles } from './lote7-engarde-rfee';
import { documentoArchivado } from './lote7-faltan-engarde-wayback';
import { dia, EscritorHechos } from './lote7-faltan-comun';
import { HECHOS_LOTE10, NUEVO9, redLote10 } from './lote10-red';

export type Hueco = {
  id: string; prioridad: number; fuente: string; temporada: string; fecha: string; nombre: string; arma: string; genero: string; categoria: string;
  formato: string; faltan: string[]; lecturas: { source: string; key: string; url: string | null; puestos: number; poules: number; cuadro: number }[];
  enlacesCatalogo: { tipo: string; url: string }[];
};

/** Asalto con un marcador imposible para su fase y modalidad. */
export function marcadorImposible(b: Pick<AsaltoHecho, 'phase' | 'scoreA' | 'scoreB' | 'winner'>, equipos: boolean): boolean {
  if (b.scoreA === b.scoreB && !b.winner) return true;
  const max = Math.max(b.scoreA, b.scoreB);
  if (equipos) return max > 45;
  return b.phase === 'POULE' ? max > 5 : max > 15;
}

/** Quita los asaltos imposibles; la fase afectada pasa a parcial. */
export function depurarMarcadores(h: HechosPrueba): number {
  const equipos = h.competition.format === 'EQUIPOS';
  const antes = h.bouts.length;
  const fuera = new Set(h.bouts.filter((b) => marcadorImposible(b, equipos)).map((b) => b.phase));
  h.bouts = h.bouts.filter((b) => !marcadorImposible(b, equipos));
  if (fuera.has('POULE') && h.status.pools === 'completo') h.status.pools = 'parcial';
  if (fuera.has('TABLEAU') && h.status.tableau === 'completo') h.status.tableau = 'parcial';
  const n = antes - h.bouts.length;
  if (n > 0) h.status.notes.push(`${n} asaltos con marcadores imposibles no se incluyen`);
  return n;
}

/** Fases que la lectura aporta: las que al hueco le faltan y la lectura trae. */
export function fasesAportadas(h: HechosPrueba, faltan: readonly string[]): string[] {
  const tiene = {
    clasificacion: h.results.some((r) => r.position !== null),
    poules: h.bouts.some((b) => b.phase === 'POULE'),
    cuadro: h.bouts.some((b) => b.phase === 'TABLEAU'),
  } as Record<string, boolean>;
  return faltan.filter((f) => tiene[f]);
}

/** Cotejo con la clasificación oficial: fracción de nombres oficiales presentes y de puestos iguales entre ellos. */
export function cotejarClasificacion(h: HechosPrueba, oficial: readonly { nombre: string; puesto: number | null }[]): { presentes: number; mismosPuestos: number } {
  if (oficial.length === 0) return { presentes: 1, mismosPuestos: 1 };
  const nuestros = h.results.map((r) => ({ n: normalizeSportName(r.name), p: r.position }));
  let presentes = 0;
  let conPuesto = 0;
  let iguales = 0;
  for (const o of oficial) {
    const n = normalizeSportName(o.nombre);
    const x = nuestros.find((y) => nombresCompatibles(y.n, n));
    if (!x) continue;
    presentes += 1;
    if (o.puesto === null || x.p === null) continue;
    conPuesto += 1;
    if (o.puesto === x.p) iguales += 1;
  }
  return { presentes: presentes / oficial.length, mismosPuestos: conPuesto === 0 ? 1 : iguales / conPuesto };
}

const compatibleGenero = (a: string, b: string) => a === b || a === 'MIXTO' || b === 'MIXTO';

async function main(): Promise<void> {
  const rutaHuecos = argumento('huecos', '');
  if (!rutaHuecos) throw new Error('falta --huecos <huecos-tras-lote7.json>');
  const huecos = ((JSON.parse(readFileSync(rutaHuecos, 'utf8')) as { huecos: Hueco[] }).huecos).filter((h) => h.prioridad === 1 && h.fuente === 'RFEE' && h.faltan.length > 0);
  const db = new DatabaseSync(argumento('db', NUEVO9), { readOnly: true });
  const oficialDe = db.prepare(`SELECT r.source_name n, r.position p FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id WHERE c.source = ? AND c.competition_key = ?`);

  // Torneos de Engarde que enlaza cada hueco (catálogo o lectura de Engarde ya existente).
  const torneos = new Map<string, { org: string; evt: string; huecos: Hueco[] }>();
  for (const h of huecos) {
    const urls = [...h.enlacesCatalogo.map((e) => e.url), ...h.lecturas.filter((l) => l.source === 'engarde' && l.url).map((l) => l.url!)];
    for (const u of urls) {
      const r = enlaceEngarde(u);
      if (r.tipo !== 'torneo') continue;
      const k = `${r.org}/${r.evt}`;
      const t = torneos.get(k) ?? torneos.set(k, { org: r.org, evt: r.evt, huecos: [] }).get(k)!;
      if (!t.huecos.includes(h)) t.huecos.push(h);
    }
  }
  const red = redLote10('wayback');
  const escritor = new EscritorHechos('lector_engarde_wayback', HECHOS_LOTE10('engarde-wayback'));
  const detalle: Record<string, unknown>[] = [];
  const motivos: Record<string, number> = {};
  const anotar = (m: string, d: Record<string, unknown>) => {
    motivos[m] = (motivos[m] ?? 0) + 1;
    detalle.push({ ...d, motivo: m });
  };
  const totales = { ficheros: 0, puestos: 0, poules: 0, cuadro: 0, descartados: 0, huecos: 0 };
  const usados = new Set<string>();

  for (const t of [...torneos.values()].sort((a, b) => `${a.org}/${a.evt}`.localeCompare(`${b.org}/${b.evt}`))) {
    const cdx = await red.get(`http://web.archive.org/cdx/search/cdx?url=engarde-service.com/files/${t.org}/${t.evt}/&matchType=prefix&collapse=urlkey&filter=statuscode:200&output=json&limit=2000`);
    const filas = cdx.status === 200 && cdx.body.length > 2 ? (JSON.parse(cdx.body.toString('utf8')) as string[][]).slice(1) : [];
    const porCompe = new Map<string, { timestamp: string; original: string; compe: string; fichero: string }[]>();
    // Campos por defecto del CDX: urlkey, timestamp, original, ...
    for (const [, timestamp, original] of filas) {
      const d = documentoArchivado(original, t.org, t.evt);
      if (!d || !tipoDocumentoEngarde(d.fichero)) continue;
      (porCompe.get(d.compe) ?? porCompe.set(d.compe, []).get(d.compe)!).push({ timestamp, original, ...d });
    }
    if (porCompe.size === 0) {
      anotar('sin_capturas_de_documentos', { torneo: `${t.org}/${t.evt}`, huecos: t.huecos.map((h) => h.id) });
      continue;
    }
    for (const [compe, capturas] of porCompe) {
      const docs: { fichero: string; html: string; url: string; tipo: string }[] = [];
      for (const c of capturas) {
        const r = await red.get(`http://web.archive.org/web/${c.timestamp}id_/${c.original}`);
        if (r.status !== 200) continue;
        docs.push({ fichero: c.fichero, html: r.body.toString('utf8'), url: `https://web.archive.org/web/${c.timestamp}/${c.original}`, tipo: tipoDocumentoEngarde(c.fichero)! });
      }
      const clave = `engarde:${t.org}/${t.evt}/${compe}`;
      const entrada: EntradaPrueba = {
        org: t.org, evt: t.evt, compe, claveTorneo: `engarde:${t.org}/${t.evt}`, claveCompeticion: clave,
        nombreTorneo: t.huecos[0]?.nombre ?? `${t.org}/${t.evt}`,
        comp: { sexe: '', arme: '', estindividuelle: '', categorie: '', etat: 'completed', ville: '', pays: '' },
        legado: true, titulos: [], fechaIndice: null, fechaTorneo: t.huecos[0]?.fecha ?? null, temporadaCarpeta: null,
        clasificacion: docs.find((d) => d.tipo === 'clasificacion') ?? null,
        poules: docs.filter((d) => d.tipo === 'poules').map((d) => ({ ...d, pagina: Number(/(\d+)\.html?$/i.exec(d.fichero)?.[1] ?? 1) })),
        cuadros: docs.filter((d) => d.tipo === 'cuadro'),
        faltan: [], extractor: 'lector_engarde_wayback',
      };
      const r = convertirEntrada(entrada, '2100-01-01');
      if (!r.ok) {
        anotar(r.motivo, { prueba: clave });
        continue;
      }
      const h = r.hechos;
      const c = h.competition;
      const fecha = c.date ?? h.edition.startDate;
      const grupo = c.category === 'VET' ? grupoVet(c.categoryRaw, clave, ...docs.map((d) => /<title>([\s\S]*?)<\/title>/i.exec(d.html)?.[1] ?? '')) : null;
      const candidatos = t.huecos.filter((x) => x.arma === c.weapon && x.categoria === c.category && x.formato === c.format && compatibleGenero(x.genero, c.gender) &&
        !!fecha && Math.abs(dia(x.fecha) - dia(fecha)) <= 2 && (c.category !== 'VET' || !grupo || grupoVet(x.id, x.nombre, ...x.lecturas.map((l) => l.key)) === null || grupoVet(x.id, x.nombre, ...x.lecturas.map((l) => l.key)) === grupo));
      const info = { prueba: clave, atributos: `${c.weapon} ${c.gender} ${c.category} ${c.format} ${fecha}`, documentos: docs.map((d) => d.fichero) };
      if (candidatos.length !== 1) {
        anotar(candidatos.length === 0 ? 'no_casa_con_ningun_hueco' : 'casa_con_varios_huecos', { ...info, huecos: candidatos.map((x) => x.id) });
        continue;
      }
      const hueco = candidatos[0];
      if (usados.has(hueco.id)) {
        anotar('hueco_ya_cubierto_por_otra_lectura', { ...info, hueco: hueco.id });
        continue;
      }
      const descartados = depurarMarcadores(h);
      const aporta = fasesAportadas(h, hueco.faltan);
      if (aporta.length === 0) {
        anotar('no_aporta_las_fases_que_faltan', { ...info, hueco: hueco.id, faltan: hueco.faltan });
        continue;
      }
      const otras = hueco.lecturas.filter((l) => l.key !== clave && (l.source === 'skermo_rfee' || l.source === 'rfee_pdf') && l.puestos > 0);
      if (c.format === 'EQUIPOS' && otras.length > 0 && !hueco.lecturas.some((l) => l.key === clave)) {
        anotar('equipos_con_lectura_de_otra_fuente', { ...info, hueco: hueco.id });
        continue;
      }
      let cotejo: { presentes: number; mismosPuestos: number } | null = null;
      for (const l of otras) {
        const oficial = (oficialDe.all(l.source, l.key) as { n: string; p: number | null }[]).map((x) => ({ nombre: x.n, puesto: x.p }));
        cotejo = cotejarClasificacion(h, oficial);
        if (cotejo.presentes < 0.6 || cotejo.mismosPuestos < 0.9) break;
      }
      if (cotejo && (cotejo.presentes < 0.6 || cotejo.mismosPuestos < 0.9)) {
        anotar('no_cuadra_con_la_clasificacion_oficial', { ...info, hueco: hueco.id, cotejo });
        continue;
      }
      h.edition = { ...h.edition, season: hueco.temporada };
      h.status.notes.push('Exportación estática de Engarde archivada en la Wayback Machine; Engarde ya no publica los datos de esta prueba');
      if (cotejo) h.status.notes.push(`Clasificación cotejada con la oficial: ${Math.round(cotejo.presentes * 100)} % de sus nombres, ${Math.round(cotejo.mismosPuestos * 100)} % con el mismo puesto`);
      escritor.escribir(h);
      usados.add(hueco.id);
      totales.ficheros += 1;
      totales.huecos += 1;
      totales.puestos += h.results.length;
      totales.poules += h.bouts.filter((b) => b.phase === 'POULE').length;
      totales.cuadro += h.bouts.filter((b) => b.phase === 'TABLEAU').length;
      totales.descartados += descartados;
      anotar('escrita', { ...info, hueco: hueco.id, aporta, cotejo, estados: h.status });
    }
  }
  db.close();
  escritor.limpiarAntiguos();
  const informe = { generado: new Date().toISOString(), torneos: torneos.size, totales, motivos, peticiones: red.peticiones, detalle };
  escritor.informe('engarde-wayback', informe);
  console.log(JSON.stringify({ ...informe, detalle: detalle.filter((d) => d.motivo === 'escrita').length }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
