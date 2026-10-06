/**
 * Campeonatos del Mediterráneo (2015 y 2024) alojados en Engarde por la RFEE: sus asaltos se
 * pasan a las claves FIE de la misma prueba, para completar la prueba FIE en lugar de crear otra.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8b-fie-mediterraneo.ts [--db <nuevo8.sqlite>]
 *
 * Por cada prueba del índice de Engarde (`rfee/medit2015`, `rfee/med2024`) se busca la prueba FIE
 * del mismo arma, género, categoría y fecha (±3 días) con nombre de Campeonato del Mediterráneo.
 * Sin prueba FIE no se escribe nada (la de Engarde ya está en la base). Con ella, la página de
 * Engarde se lee con `convertirPrueba` y cada tirador se identifica con su puesto FIE por nombre
 * normalizado y nación (único). Se acepta sólo si se identifican al menos el 90 % de los tiradores
 * de las dos clasificaciones, coincide el campeón y coincide el puesto en al menos el 80 %; los
 * asaltos con algún tirador sin identificar no se escriben. Sale en `hechos/lote8b-fie-mediterraneo/`
 * con las claves FIE, sin clasificación (la FIE ya la tiene) y con poules y cuadro.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { decodificarHtml, documentosDelMenu } from '../../src/lib/ingest/sources/engarde-antiguo';
import { ENGARDE_BASE } from '../../src/lib/ingest/sources/engarde';
import { argumento, CARPETA_TRABAJO, normalizarNombre } from './comun';
import { nombresCompatiblesRecorte, prepararNombre } from './dedupe-pruebas';
import { convertirEntrada, type EntradaPrueba } from './engarde-historico-a-hechos';
import { portadaEstatica } from './lote7-engarde-rfee-estaticas';
import { NUEVO8 } from './lote8b-fie-equipos-rondas';
import { RedLote8 } from './lote8-red';

export const SALIDA_MED = join(CARPETA_TRABAJO, 'hechos', 'lote8b-fie-mediterraneo');
const TORNEOS = [{ org: 'rfee', evt: 'medit2015', fecha: '2015-01-31' }, { org: 'rfee', evt: 'med2024', fecha: '2024-02-03' }];
type Arma = 'ESPADA' | 'FLORETE' | 'SABLE';
const ARMA: Record<string, Arma> = { e: 'ESPADA', f: 'FLORETE', s: 'SABLE' };

/** Atributos desde el código de la prueba (`ef_cadet`, `sm17`): el índice de 2015 los publica mal. */
export function atributosDeCodigo(compe: string, categoriaOriginal: string | null): { arma: Arma; genero: 'M' | 'F'; categoria: 'M15' | 'M17' | 'M20' } | null {
  const m = /^([efs])([mf])(?:_|\d)/i.exec(compe);
  if (!m) return null;
  const c = `${categoriaOriginal ?? ''} ${compe}`.toLowerCase();
  const categoria = /junior|20/.test(c) ? 'M20' : /cadet|17/.test(c) ? 'M17' : /minime|15/.test(c) ? 'M15' : null;
  if (!categoria) return null;
  return { arma: ARMA[m[1].toLowerCase()], genero: m[2].toLowerCase() === 'm' ? 'M' : 'F', categoria };
}

export type PuestoFie = { ref: string; nombre: string; pais: string | null; puesto: number | null };

/** Identifica los tiradores de Engarde con los puestos FIE y comprueba que es la misma clasificación. */
export function identificar(engarde: HechosPrueba['results'], fie: readonly PuestoFie[]): { mapa: Map<string, string> } | { motivo: string } {
  const clave = (n: string, p: string | null) => `${normalizarNombre(n)}|${p ?? ''}`;
  const porClave = new Map<string, PuestoFie[]>();
  const porNombre = new Map<string, PuestoFie[]>();
  for (const f of fie) {
    porClave.set(clave(f.nombre, f.pais), [...(porClave.get(clave(f.nombre, f.pais)) ?? []), f]);
    porNombre.set(normalizarNombre(f.nombre), [...(porNombre.get(normalizarNombre(f.nombre)) ?? []), f]);
  }
  const mapa = new Map<string, string>();
  const usados = new Set<string>();
  let comunes = 0;
  let iguales = 0;
  let campeon = false;
  const preparados = fie.map((f) => ({ f, n: prepararNombre(f.nombre) }));
  for (const r of engarde) {
    let c = porClave.get(clave(r.name, r.countryCode)) ?? porNombre.get(normalizarNombre(r.name)) ?? [];
    if (c.length === 0) {
      // Nombre recortado o con otra grafía: el único de la misma nación que encaja palabra a palabra.
      const n = prepararNombre(r.name);
      c = preparados.filter((x) => x.f.pais === r.countryCode && !usados.has(x.f.ref) && nombresCompatiblesRecorte(n, x.n)).map((x) => x.f);
    }
    if (c.length !== 1 || usados.has(c[0].ref)) continue;
    usados.add(c[0].ref);
    mapa.set(r.factKey, c[0].ref);
    if (r.position !== null && c[0].puesto !== null) {
      comunes += 1;
      if (r.position === c[0].puesto) iguales += 1;
      if (r.position === 1 && c[0].puesto === 1) campeon = true;
    }
  }
  if (mapa.size < 0.9 * engarde.length || mapa.size < 0.9 * fie.length) return { motivo: `tiradores_sin_identificar:${mapa.size}/${engarde.length}/${fie.length}` };
  if (!campeon) return { motivo: 'campeon_distinto' };
  if (iguales < 0.8 * comunes) return { motivo: `puestos_distintos:${iguales}/${comunes}` };
  return { mapa };
}

/** Asaltos con las referencias FIE, orientados `aRef < bRef`; los que tienen un tirador sin identificar se quitan. */
export function asaltosFie(bouts: readonly AsaltoHecho[], mapa: ReadonlyMap<string, string>, nombre: ReadonlyMap<string, string>): { bouts: AsaltoHecho[]; quitados: number } {
  const out: AsaltoHecho[] = [];
  let quitados = 0;
  for (const b of bouts) {
    const a = mapa.get(b.aRef);
    const c = mapa.get(b.bRef);
    if (!a || !c || a === c) {
      quitados += 1;
      continue;
    }
    const swap = a > c;
    out.push({
      phase: b.phase, roundKey: b.phase === 'TABLEAU' ? b.roundKey.replace(/^T(\d+)$/, 'A$1') : b.roundKey,
      aRef: swap ? c : a, bRef: swap ? a : c, aName: nombre.get(swap ? c : a) ?? (swap ? b.bName : b.aName), bName: nombre.get(swap ? a : c) ?? (swap ? b.aName : b.bName),
      scoreA: swap ? b.scoreB : b.scoreA, scoreB: swap ? b.scoreA : b.scoreB, winner: b.winner === null ? null : (b.winner === 'A') !== swap ? 'A' : 'B',
    });
  }
  return { bouts: out, quitados };
}

async function main(): Promise<void> {
  const db = new DatabaseSync(argumento('db', NUEVO8), { readOnly: true });
  const fieDe = db.prepare(`SELECT c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.competition_date, e.tournament_key, e.name,
      e.start_date, e.end_date, e.city, e.country_code FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id
     WHERE c.source = 'fie' AND c.format = 'INDIVIDUAL' AND e.name LIKE '%diterran%' AND c.weapon = ? AND c.gender = ? AND c.category = ?
       AND abs(julianday(coalesce(c.competition_date, e.start_date)) - julianday(?)) <= 3`);
  const puestosDe = db.prepare(`SELECT r.source_fact_key ref, r.source_name nombre, r.source_country_code pais, r.position puesto FROM sport_result r
      JOIN sport_competition c ON c.id = r.competition_id WHERE c.source = 'fie' AND c.season = ? AND c.competition_key = ?`);
  const red = new RedLote8();
  mkdirSync(SALIDA_MED, { recursive: true });
  const detalle: Record<string, unknown>[] = [];
  const motivos: Record<string, number> = {};
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  const escritos = new Set<string>();
  let poules = 0;
  let cuadro = 0;
  const hoy = new Date().toISOString().slice(0, 10);
  /** Página de la exportación estática; null si no existe o Engarde dice que no tiene datos. */
  const estatica = async (rel: string): Promise<{ html: string; url: string } | null> => {
    const url = `${ENGARDE_BASE}/files/${rel}`;
    const d = await red.obtener(url);
    if (d.status !== 200 || !d.bytes) return null;
    // El servidor anuncia utf-8 pero estas exportaciones son ISO-8859-1 según su <meta>.
    const html = decodificarHtml(Buffer.from(d.bytes));
    return /<title>\s*Engarde\s*<\/title>|currently has no data/i.test(html) ? null : { html, url };
  };
  for (const t of TORNEOS) {
    // La página dinámica de estas pruebas dice «currently has no data»: sólo queda la exportación estática.
    const portada = await estatica(`${t.org}/${t.evt}/`);
    if (!portada) {
      anotar('sin_exportacion_estatica');
      detalle.push({ id: `${t.org}/${t.evt}`, motivo: 'sin_exportacion_estatica' });
      continue;
    }
    const { titulo, pruebas } = portadaEstatica(portada.html);
    for (const { compe, nombre } of pruebas) {
      const id = `${t.org}/${t.evt}/${compe}`;
      const at = atributosDeCodigo(compe, nombre);
      if (!at) {
        anotar('equipos_o_sin_atributos');
        detalle.push({ id, motivo: 'equipos_o_sin_atributos' });
        continue;
      }
      const fie = fieDe.all(at.arma, at.genero, at.categoria, t.fecha) as Record<string, string | null>[];
      if (fie.length !== 1) {
        const m = fie.length === 0 ? 'sin_prueba_fie' : 'varias_pruebas_fie';
        anotar(m);
        detalle.push({ id, motivo: m, atributos: at });
        continue;
      }
      const f = fie[0];
      const menu = await estatica(`${t.org}/${t.evt}/${compe}/menu.html`);
      if (!menu) {
        anotar('sin_menu');
        detalle.push({ id, motivo: 'sin_menu' });
        continue;
      }
      const docs: { fichero: string; html: string; url: string; tipo: string }[] = [];
      const faltan: string[] = [];
      for (const d of documentosDelMenu(menu.html)) {
        const r = await estatica(`${t.org}/${t.evt}/${compe}/${d.fichero}`);
        if (r) docs.push({ fichero: d.fichero, html: r.html, url: r.url, tipo: d.tipo });
        else faltan.push(d.fichero);
      }
      const entrada: EntradaPrueba = {
        org: t.org, evt: t.evt, compe, claveTorneo: `engarde:${t.org}/${t.evt}`, claveCompeticion: `engarde:${t.org}/${t.evt}/${compe}`, nombreTorneo: titulo ?? t.evt,
        comp: { sexe: '', arme: '', estindividuelle: '', categorie: '', etat: 'completed', ville: '', pays: '' },
        legado: true, titulos: [nombre, titulo ?? ''], fechaIndice: null, fechaTorneo: t.fecha, temporadaCarpeta: null,
        clasificacion: docs.find((d) => d.tipo === 'clasificacion') ?? null,
        poules: docs.filter((d) => d.tipo === 'poules').map((d) => ({ ...d, pagina: Number(/(\d+)\.html?$/i.exec(d.fichero)?.[1] ?? 1) })),
        cuadros: docs.filter((d) => d.tipo === 'cuadro'),
        faltan, extractor: 'lector_engarde_estatica',
      };
      const conv = convertirEntrada(entrada, hoy);
      if (!conv.ok) {
        anotar(conv.motivo);
        detalle.push({ id, motivo: conv.motivo });
        continue;
      }
      const c = conv.hechos.competition;
      if (c.weapon !== at.arma || (c.gender !== at.genero && c.gender !== 'MIXTO') || c.format !== 'INDIVIDUAL') {
        anotar('atributos_contradictorios');
        detalle.push({ id, motivo: 'atributos_contradictorios', leidos: `${c.weapon} ${c.gender} ${c.category} ${c.format}` });
        continue;
      }
      const fiePuestos = puestosDe.all(f.season, f.competition_key) as PuestoFie[];
      const ident = identificar(conv.hechos.results, fiePuestos);
      if ('motivo' in ident) {
        anotar(ident.motivo.split(':')[0]);
        detalle.push({ id, fie: `fie:${f.season}:${f.competition_key}`, motivo: ident.motivo });
        continue;
      }
      const nombres = new Map(fiePuestos.map((x) => [x.ref, x.nombre]));
      const { bouts, quitados } = asaltosFie(conv.hechos.bouts, ident.mapa, nombres);
      if (bouts.length === 0) {
        anotar('sin_asaltos');
        detalle.push({ id, motivo: 'sin_asaltos' });
        continue;
      }
      const st = conv.hechos.status;
      const parcial = (s: HechosPrueba['status']['pools']) => (s === 'completo' && quitados > 0 ? 'parcial' : s);
      const nP = bouts.filter((b) => b.phase === 'POULE').length;
      const nT = bouts.length - nP;
      const h = hechosPrueba.parse({
        version: 1, source: 'fie', extractor: 'lector_fie', sourceUrl: conv.hechos.sourceUrl, sourceSha256: conv.hechos.sourceSha256,
        edition: {
          season: f.season, tournamentKey: f.tournament_key, name: f.name, startDate: f.start_date, endDate: f.end_date, city: f.city,
          countryCode: f.country_code && /^[A-Z]{3}$/.test(f.country_code) ? f.country_code : null,
        },
        competition: { competitionKey: f.competition_key, weapon: f.weapon, gender: f.gender, category: f.category, categoryRaw: f.category_raw, format: 'INDIVIDUAL', date: f.competition_date },
        status: {
          results: 'sin_resultados', pools: nP ? parcial(st.pools) : 'sin_resultados', tableau: nT ? parcial(st.tableau) : 'sin_resultados', publishedParticipants: null,
          notes: [
            `Lote 8b: poules y cuadro de la exportación estática de Engarde (files/${id}), la misma prueba que la FIE publica sin asaltos; tiradores identificados con su ID FIE por nombre y nación`,
            `Validado contra la clasificación FIE: ${ident.mapa.size} de ${conv.hechos.results.length} tiradores identificados, mismo campeón y ≥80 % de puestos iguales; results vacío a propósito`,
            ...(quitados ? [`${quitados} asaltos con un tirador sin identificar no se escriben`] : []),
            ...st.notes,
          ],
        },
        results: [],
        bouts,
      });
      const fichero = ficheroHechos(h);
      writeFileSync(join(SALIDA_MED, fichero), `${JSON.stringify(h, null, 1)}\n`);
      escritos.add(fichero);
      poules += nP;
      cuadro += nT;
      anotar('escrita');
      detalle.push({ id, fie: `fie:${f.season}:${f.competition_key}`, motivo: 'escrita', poules: nP, cuadro: nT, quitados });
    }
  }
  db.close();
  for (const x of readdirSync(SALIDA_MED)) if (x.endsWith('.json') && !x.startsWith('_') && !escritos.has(x)) rmSync(join(SALIDA_MED, x));
  const informe = { generado: new Date().toISOString(), escritas: escritos.size, poules, cuadro, motivos, peticiones: red.peticiones, detalle };
  writeFileSync(join(SALIDA_MED, '_informe.json'), `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify(informe, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
