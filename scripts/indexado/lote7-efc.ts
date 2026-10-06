/**
 * Circuito europeo de la EFC (Confederación Europea de Esgrima), cadete y júnior, desde la
 * temporada 2017-2018, con fuente `efc`, en `hechos/lote7-efc/`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-efc.ts [--db <nuevo7.sqlite>] [--desde 2017-09-01]
 *
 * Fuentes, sin inicio de sesión:
 *  1. eurofencing.info (dominio expirado en 2026) en la Wayback Machine: las páginas de los
 *     torneos del circuito (`competitions/u17|u20/case:competitions/tournamentId:<n>`) dan
 *     sede, país y, por prueba, el XML de resultados en formato FIE
 *     (`service.eurofencing.info/results/downloadresultxml/<id>`), con clasificación,
 *     poules y cuadro (individual) o clasificación y encuentros (equipos).
 *  2. Engarde (engarde-service.com): pruebas del circuito alojadas por los organizadores
 *     (también las del organismo rfee, p. ej. Segovia 2026), con el lector de Engarde.
 *  3. Fencing Worldwide (Ophardt): torneos «European Cadet Circuit» de su archivo anual.
 * Una prueba que ya existe en nuevo7 o en otro lote 7 (mismo arma, género, categoría,
 * modalidad, fecha a ±2 días y, en individual, ≥30 % de nombres en común) no se escribe; las
 * pruebas FIE (Campeonatos de Europa) tampoco: son de la fuente `fie`.
 *
 * Claves:
 *  - edición `efc:<temporada>:<evento>`, con `<evento>` = `<sede>-<AAAAMMDD del primer día>`
 *    («budapest-20231014»), igual venga de la fuente que venga;
 *  - prueba `efc:<temporada>:<evento>:<arma><género>-<categoría>[-EQ]` («efc:2023-2024:budapest-20231014:EM-M17»);
 *  - tirador `efc:lic:<licencia EFC>` si el XML la publica, si no `efc:<nación>:<nombre normalizado>`;
 *    equipo `team:efc:<nación>[-<n>]`.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import type { AsaltoHecho, HechosPrueba, ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { argumento, CARPETA_TRABAJO } from './comun';
import { ENGARDE_BASE, parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { FWW_BASE, parsearResultadosFww, type PaginaFww } from '../../src/lib/ingest/sources/fww';
import { convertirPrueba, temporadaRfee, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { paginasDePrueba } from './engarde-descargar';
import { encuentrosEngarde, podioDe, refsEquipos, type Documento } from './lote7-equipos-engarde';
import { compatible, equivalentesLotes, equivalentesNuevo7, solapeNombres, type Equivalente } from './lote7-engarde-rfee';
import { abrirNuevo7, dia, EscritorHechos, NUEVO7 } from './lote7-faltan-comun';
import { indice, validarAtributos, type Atributos } from './lote7-faltan-engarde';
import { destinosDePruebaFww, leerPruebaFww, parsearArchivoFww, pruebasDeTorneoFww } from './lote7-fie-fww';
import { filasCampeonatoEfc, type FilaEfc } from './lote7-fie-efc';
import { leerXmlFie } from './lote7-fie-xml';
import { Red } from './lote7-faltan-red';

export const SALIDA_EFC = join(CARPETA_TRABAJO, 'hechos', 'lote7-efc');
/** Caché de otro lote con XML de la EFC ya bajados de la Wayback (sólo lectura). */
const SEMILLA_FIE = join(CARPETA_TRABAJO, 'cache-lote7-fie', 'raw');
const PREFIJO_XML = 'service.eurofencing.info/results/downloadresultxml/';

const wayback = (ts: string, original: string) => `https://web.archive.org/web/${ts}id_/${original}`;

class SemillaUrl {
  private readonly porUrl = new Map<string, string>();
  constructor(carpeta: string) {
    const reg = join(carpeta, '_registro.jsonl');
    if (!existsSync(reg)) return;
    for (const l of readFileSync(reg, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as { url: string; status: number; fichero: string | null };
        if (r.status === 200 && r.fichero) this.porUrl.set(r.url, join(carpeta, r.fichero));
      } catch {
        // Línea a medio escribir por el otro proceso.
      }
    }
  }
  leer(url: string): Buffer | null {
    const r = this.porUrl.get(url);
    return r && existsSync(r) ? readFileSync(r) : null;
  }
}

/** Texto de un XML con la codificación que declara (los de la EFC vienen en iso-8859-1). */
export function decodificarXml(b: Buffer): string {
  const cabecera = b.subarray(0, 200).toString('latin1');
  const cod = /encoding="([^"]+)"/i.exec(cabecera)?.[1]?.toLowerCase() ?? 'utf-8';
  return new TextDecoder(/8859|latin/.test(cod) ? 'latin1' : /1252/.test(cod) ? 'windows-1252' : 'utf-8').decode(b);
}

// ---------------------------------------------------------------------------
// Claves y atributos
// ---------------------------------------------------------------------------

const LETRAS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ı: 'i', þ: 'th' };
export const slug = (s: string) => s.toLowerCase().replace(/[øæœßłđıþ]/g, (x) => LETRAS[x]).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function claveEvento(sede: string, primerDia: string): string {
  return `${slug(sede) || 'sede'}-${primerDia.replace(/-/g, '')}`;
}

const LETRA_ARMA: Record<string, string> = { ESPADA: 'E', FLORETE: 'F', SABLE: 'S' };
const LETRA_GENERO: Record<string, string> = { M: 'M', F: 'F', MIXTO: 'X' };

export function clavePrueba(season: string, evento: string, a: Pick<Atributos, 'weapon' | 'gender' | 'category' | 'format'>): string {
  return `efc:${season}:${evento}:${LETRA_ARMA[a.weapon]}${LETRA_GENERO[a.gender]}-${a.category}${a.format === 'EQUIPOS' ? '-EQ' : ''}`;
}

/** Categoría FIE del XML («C» cadete, «J» júnior) o del texto de la página; sólo M17 y M20 están en el alcance. */
export function categoriaEfc(xml: string | null, texto: string): string | null {
  const c = (xml ?? '').trim().toUpperCase();
  if (c === 'C' || c === 'U17') return 'M17';
  if (c === 'J' || c === 'U20') return 'M20';
  if (c === 'U23') return 'M23';
  if (c === 'S') return 'ABS';
  const t = texto.toUpperCase();
  if (/CADET|U-?17|M-?17/.test(t)) return 'M17';
  if (/JUNIOR|U-?20|M-?20/.test(t)) return 'M20';
  if (/U-?23|M-?23/.test(t)) return 'M23';
  if (/U-?14|M-?14/.test(t)) return 'M14';
  return null;
}

const ARMA_XML: Record<string, string> = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' };

/** Fecha ISO de «14.10.2023» o «14/10/2023»; la última de un rango «02/06 - 05/06/2011». */
export function fechaEfc(s: string | null | undefined): string | null {
  const m = [...(s ?? '').matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{4})/g)].at(-1);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// ---------------------------------------------------------------------------
// XML de resultados (formato FIE)
// ---------------------------------------------------------------------------

export type PruebaEfc = {
  atributos: Atributos;
  titulo: string;
  campeonato: string;
  results: ResultadoHecho[];
  bouts: AsaltoHecho[];
  status: HechosPrueba['status'];
};

const rondaCuadro = (k: string) => k.replace(/^A(\d+)$/, 'T$1');

/** Clasificación, poules y cuadro de un XML individual; tiradores con clave de licencia EFC. */
export function pruebaIndividualXml(xml: string): PruebaEfc | null {
  const $ = cheerio.load(xml.replace(/^\uFEFF/, ''), { xmlMode: true });
  const raiz = $('CompetitionIndividuelle').first();
  if (raiz.length === 0) return null;
  const weapon = ARMA_XML[raiz.attr('Arme') ?? ''];
  const sexe = raiz.attr('Sexe');
  const gender = sexe === 'M' ? 'M' : sexe === 'F' ? 'F' : sexe === 'X' ? 'MIXTO' : null;
  const titulo = (raiz.attr('TitreLong') ?? raiz.attr('TitreCourt') ?? '').trim();
  const category = categoriaEfc(raiz.attr('Categorie') ?? null, titulo);
  const fecha = fechaEfc(raiz.attr('Date'));
  if (!weapon || !gender || !category || !fecha) return null;
  const results: ResultadoHecho[] = [];
  const porNombre = new Map<string, string | null>();
  const usadas = new Set<string>();
  let conPuesto = 0;
  raiz.children('Tireurs').children('Tireur').each((_, el) => {
    const t = $(el);
    const name = `${t.attr('Nom') ?? ''} ${t.attr('Prenom') ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!name) return;
    const pais = (t.attr('Nation') ?? '').trim().toUpperCase();
    const lic = (t.attr('Licence') ?? '').trim();
    let factKey = /^\d{5,}$/.test(lic) ? `efc:lic:${lic}` : `efc:${pais || 'XXX'}:${normalizeSportName(name).replace(/ /g, '-')}`;
    if (usadas.has(factKey)) factKey = `${factKey}:${t.attr('ID') ?? results.length}`;
    usadas.add(factKey);
    const pos = Number(t.attr('Classement'));
    if (Number.isInteger(pos) && pos > 0) conPuesto += 1;
    const nac = /(\d{4})$/.exec(t.attr('DateNaissance') ?? '')?.[1];
    results.push({
      factKey, name, countryCode: /^[A-Z]{3}$/.test(pais) ? pais : null, club: (t.attr('Club') ?? '').trim() || null,
      position: Number.isInteger(pos) && pos > 0 ? pos : null, positionRaw: t.attr('Statut') && t.attr('Statut') !== 'N' ? t.attr('Statut')! : null,
      points: null, fieId: null, license: null, birthYear: nac && Number(nac) >= 1900 && Number(nac) <= 2030 ? Number(nac) : null,
    });
    const k = `${normalizeSportName(name)}|${pais}`;
    porNombre.set(k, porNombre.has(k) ? null : factKey);
  });
  const lectura = leerXmlFie(xml);
  const ref = (x: { nombre: string; pais: string | null }) => porNombre.get(`${normalizeSportName(x.nombre)}|${x.pais ?? ''}`) ?? null;
  const nombreDe = new Map(results.map((r) => [r.factKey, r.name]));
  const bouts: AsaltoHecho[] = [];
  let sinRef = 0;
  for (const b of [...(lectura.poules?.bouts ?? []), ...(lectura.cuadro?.bouts ?? [])]) {
    const a = ref(b.a);
    const c = ref(b.b);
    if (!a || !c || a === c) {
      sinRef += 1;
      continue;
    }
    bouts.push({
      phase: b.phase, roundKey: b.phase === 'TABLEAU' ? rondaCuadro(b.roundKey) : b.roundKey, aRef: a, bRef: c,
      aName: nombreDe.get(a)!, bName: nombreDe.get(c)!, scoreA: b.scoreA, scoreB: b.scoreB, winner: b.winner,
    });
  }
  const nP = bouts.filter((b) => b.phase === 'POULE').length;
  const nT = bouts.filter((b) => b.phase === 'TABLEAU').length;
  const notas: string[] = [];
  const descP = Object.values(lectura.poules?.descartados ?? {}).reduce((s, n) => s + n, 0);
  const descT = Object.values(lectura.cuadro?.descartados ?? {}).reduce((s, n) => s + n, 0);
  if (descP) notas.push(`Poules: ${descP} asaltos descartados (${Object.keys(lectura.poules!.descartados).join(', ')})`);
  if (descT) notas.push(`Cuadro: ${descT} cruces descartados (${Object.keys(lectura.cuadro!.descartados).join(', ')})`);
  if (sinRef) notas.push(`${sinRef} asaltos con un tirador que no está en la lista`);
  return {
    atributos: { weapon, gender, category, format: 'INDIVIDUAL', fecha, division: null }, titulo, campeonato: raiz.attr('Championnat') ?? '',
    results,
    bouts,
    status: {
      results: conPuesto === 0 ? 'sin_resultados' : conPuesto === results.length ? 'completo' : 'parcial',
      pools: nP === 0 ? 'sin_resultados' : descP === 0 && nP === (lectura.poules?.esperados ?? nP) && sinRef === 0 ? 'completo' : 'parcial',
      tableau: nT === 0 ? 'sin_resultados' : lectura.cuadro?.completo && sinRef === 0 ? 'completo' : 'parcial',
      publishedParticipants: results.length,
      notes: notas,
    },
  };
}

/** Clasificación y encuentros (cuadro principal) de un XML por equipos. */
export function pruebaEquiposXml(xml: string): PruebaEfc | null {
  const $ = cheerio.load(xml.replace(/^\uFEFF/, ''), { xmlMode: true });
  const raiz = $('CompetitionParEquipes').first();
  if (raiz.length === 0) return null;
  const weapon = ARMA_XML[raiz.attr('Arme') ?? ''];
  const sexe = raiz.attr('Sexe');
  const gender = sexe === 'M' ? 'M' : sexe === 'F' ? 'F' : sexe === 'X' ? 'MIXTO' : null;
  const titulo = (raiz.attr('TitreLong') ?? raiz.attr('TitreCourt') ?? '').trim();
  const category = categoriaEfc(raiz.attr('Categorie') ?? null, titulo);
  const fecha = fechaEfc(raiz.attr('Date'));
  if (!weapon || !gender || !category || !fecha) return null;
  const equipos = raiz.children('Equipes').children('Equipe').toArray().map((el) => {
    const e = $(el);
    const pais = (e.attr('Nation') ?? '').trim().toUpperCase();
    return { id: e.attr('ID') ?? '', nombre: (e.attr('Nom') ?? '').trim() || pais, pais, puesto: Number(e.attr('Classement')) };
  }).filter((e) => e.nombre);
  const porPais = new Map<string, number>();
  for (const e of equipos) porPais.set(e.pais, (porPais.get(e.pais) ?? 0) + 1);
  const vistos = new Map<string, number>();
  const refDe = new Map<string, { factKey: string; name: string }>();
  const results: ResultadoHecho[] = [];
  for (const e of [...equipos].sort((a, b) => (a.puesto || 1e9) - (b.puesto || 1e9))) {
    const n = (vistos.get(e.pais) ?? 0) + 1;
    vistos.set(e.pais, n);
    const varios = (porPais.get(e.pais) ?? 0) > 1;
    const factKey = `team:efc:${e.pais || slug(e.nombre)}${varios ? `-${n}` : ''}`;
    const name = varios && e.nombre === e.pais ? `${e.pais} ${n}` : e.nombre;
    refDe.set(e.id, { factKey, name });
    results.push({
      factKey, name, countryCode: /^[A-Z]{3}$/.test(e.pais) ? e.pais : null, club: null,
      position: Number.isInteger(e.puesto) && e.puesto > 0 ? e.puesto : null, positionRaw: null, points: null, fieId: null, license: null, birthYear: null,
    });
  }
  const bouts: AsaltoHecho[] = [];
  let descartados = 0;
  const suite = raiz.find('Phases').children('PhaseDeTableaux').first().children('SuiteDeTableaux').first();
  suite.children('Tableau').each((_, te) => {
    const taille = Number($(te).attr('Taille'));
    $(te).children('Match').each((__, me) => {
      const lados = $(me).children('Equipe').toArray().map((x) => ({ ref: $(x).attr('REF') ?? '', score: Number($(x).attr('Score')), statut: $(x).attr('Statut') ?? '' }));
      if (lados.length !== 2) return;
      const [a, b] = lados;
      const ra = refDe.get(a.ref);
      const rb = refDe.get(b.ref);
      const valido = ra && rb && ra.factKey !== rb.factKey && Number.isInteger(taille) && taille >= 2 && [a.score, b.score].every((s) => Number.isInteger(s) && s >= 0 && s <= 45) &&
        (a.statut === 'V') !== (b.statut === 'V');
      if (!valido) {
        descartados += 1;
        return;
      }
      bouts.push({
        phase: 'TABLEAU', roundKey: `T${taille}`, aRef: ra.factKey, bRef: rb.factKey, aName: ra.name, bName: rb.name,
        scoreA: a.score, scoreB: b.score, winner: a.score === b.score ? (a.statut === 'V' ? 'A' : 'B') : null,
      });
    });
  });
  const conPuesto = results.filter((r) => r.position !== null).length;
  return {
    atributos: { weapon, gender, category, format: 'EQUIPOS', fecha, division: null }, titulo, campeonato: raiz.attr('Championnat') ?? '',
    results,
    bouts,
    status: {
      results: conPuesto === 0 ? 'sin_resultados' : conPuesto === results.length ? 'completo' : 'parcial',
      pools: 'sin_resultados',
      tableau: bouts.length === 0 ? 'sin_resultados' : descartados === 0 ? 'completo' : 'parcial',
      publishedParticipants: results.length,
      notes: descartados ? [`Cuadro: ${descartados} encuentros sin marcador legible`] : [],
    },
  };
}

// ---------------------------------------------------------------------------

/** Pruebas de la búsqueda global de Engarde (`getCompeForDisplay.php`, opción `all`). */
export function compsDeBusqueda(xml: string): { org: string; evt: string; compe: string; fecha: string | null; ciudad: string | null; titulo: string }[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('comp').toArray().map((el) => {
    const c = $(el);
    const f = /^(\d{4}) (\d{2}) (\d{2})$/.exec(c.attr('date') ?? '');
    const textos = c.children().toArray().map((x) => $(x).text().trim());
    return {
      org: c.attr('org') ?? '', evt: c.attr('evt') ?? '', compe: c.attr('compe') ?? '', fecha: f ? `${f[1]}-${f[2]}-${f[3]}` : null,
      ciudad: (c.attr('ville') ?? '').trim() || null, titulo: textos[1] ?? textos[0] ?? '',
    };
  }).filter((c) => c.org && c.evt);
}

type ContextoFww = {
  season: string; evento: string; competitionKey: string; atributos: Atributos; nombre: string; inicio: string; fin: string;
  ciudad: string; pais: string | null; url: string; sha: string;
};

/** Hechos EFC de una prueba de Fencing Worldwide: clasificación y, en individual, poules y cuadro. */
export function hechosFww(pag: PaginaFww, lectura: ReturnType<typeof leerPruebaFww> | null, ctx: ContextoFww): HechosPrueba | null {
  const usadas = new Set<string>();
  const results: ResultadoHecho[] = [];
  const porNombre = new Map<string, string | null>();
  for (const f of pag.filas) {
    const pais = f.nacion && /^[A-Z]{3}$/.test(f.nacion) ? f.nacion : null;
    let factKey = f.fwwId ? `fww:athlete:${f.fwwId}` : f.equipo || ctx.atributos.format === 'EQUIPOS'
      ? `team:efc:${pais ?? slug(f.nombre)}` : `efc:${pais ?? 'XXX'}:${normalizeSportName(f.nombre).replace(/ /g, '-')}`;
    if (usadas.has(factKey)) factKey = `${factKey}:${results.length}`;
    usadas.add(factKey);
    results.push({
      factKey, name: f.nombre, countryCode: pais, club: null, position: f.puesto, positionRaw: f.puesto === null ? f.puestoRaw || null : null,
      points: null, fieId: null, license: null, birthYear: null,
    });
    const k = `${normalizeSportName(f.nombre)}|${pais ?? ''}`;
    porNombre.set(k, porNombre.has(k) ? null : factKey);
  }
  const nombreDe = new Map(results.map((r) => [r.factKey, r.name]));
  const bouts: AsaltoHecho[] = [];
  let sinRef = 0;
  for (const b of [...(lectura?.poules?.bouts ?? []), ...(lectura?.cuadro?.bouts ?? [])]) {
    const a = porNombre.get(`${normalizeSportName(b.a.nombre)}|${b.a.pais ?? ''}`);
    const c = porNombre.get(`${normalizeSportName(b.b.nombre)}|${b.b.pais ?? ''}`);
    if (!a || !c || a === c) {
      sinRef += 1;
      continue;
    }
    bouts.push({
      phase: b.phase, roundKey: b.phase === 'TABLEAU' ? b.roundKey.replace(/^A(\d+)$/, 'T$1') : b.roundKey, aRef: a, bRef: c,
      aName: nombreDe.get(a)!, bName: nombreDe.get(c)!, scoreA: b.scoreA, scoreB: b.scoreB, winner: b.winner,
    });
  }
  if (results.length === 0 && bouts.length === 0) return null;
  const nP = bouts.filter((b) => b.phase === 'POULE').length;
  const nT = bouts.filter((b) => b.phase === 'TABLEAU').length;
  const conPuesto = results.filter((r) => r.position !== null).length;
  const a = ctx.atributos;
  return {
    version: 1, source: 'efc', extractor: 'lector_efc_fww', sourceUrl: ctx.url, sourceSha256: ctx.sha,
    edition: { season: ctx.season, tournamentKey: `efc:${ctx.season}:${ctx.evento}`, name: ctx.nombre, startDate: ctx.inicio, endDate: ctx.fin, city: ctx.ciudad || null, countryCode: ctx.pais },
    competition: {
      competitionKey: ctx.competitionKey, weapon: a.weapon as HechosPrueba['competition']['weapon'], gender: a.gender as HechosPrueba['competition']['gender'],
      category: a.category as HechosPrueba['competition']['category'], categoryRaw: pag.categoriaOriginal, format: a.format as HechosPrueba['competition']['format'], date: a.fecha,
    },
    status: {
      results: conPuesto === 0 ? 'sin_resultados' : pag.anomalias === 0 ? 'completo' : 'parcial',
      pools: nP === 0 ? 'sin_resultados' : sinRef === 0 && Object.keys(lectura?.poules?.descartados ?? {}).length === 0 ? 'completo' : 'parcial',
      tableau: nT === 0 ? 'sin_resultados' : lectura?.cuadro?.completo && sinRef === 0 ? 'completo' : 'parcial',
      publishedParticipants: results.length,
      notes: [`Prueba del circuito europeo publicada en Fencing Worldwide (Ophardt)`, ...(sinRef ? [`${sinRef} asaltos con un tirador que no está en la clasificación`] : [])],
    },
    results,
    bouts,
  };
}

const CIRCUITO = /\b(efc|ecc)\b|efc[-_ ]|cadet circuit|european cadet|circuit europ|circuito europeo|coupe d'europe|european circuit|europacup/i;
/** Campeonatos (FIE), circuitos de otras confederaciones y torneos infantiles. */
const NO_CIRCUITO = /championship|championnat|campeonato|meisterschaft|\basia|african?\b|pan ?am|commonwealth|\bkids\b/i;

export function armaDeFila(s: string): string | null {
  return /[eé]p[eé]e|degen|spada/i.test(s) ? 'ESPADA' : /foil|fleuret|florett|fioretto/i.test(s) ? 'FLORETE' : /sab(re|er|el)|s[aä]bel|sciabola/i.test(s) ? 'SABLE' : null;
}

type Evento = { tid: string; nombre: string; sede: string; pais: string | null; filas: FilaEfc[] };

async function cdx(red: Red, url: string): Promise<{ timestamp: string; original: string }[]> {
  const q = new URLSearchParams({ url, fl: 'timestamp,original,statuscode,length', matchType: 'prefix', filter: 'statuscode:200' });
  const r = await red.get(`https://web.archive.org/cdx/search/cdx?${q.toString()}`);
  if (r.status !== 200) throw new Error(`cdx HTTP ${r.status} ${url}`);
  return r.body.toString('utf8').split('\n').filter(Boolean).map((l) => {
    const [timestamp, original] = l.split(' ');
    return { timestamp, original };
  });
}

/** Nombre del torneo de la cabecera «Competitions - European Cadet Circuit - Hungary - Budapest». */
export function partesTorneoEfc(cabecera: string): { nombre: string; sede: string } {
  const partes = cabecera.replace(/^Competitions\s*-\s*/i, '').split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const sede = (partes.at(-1) ?? '').split(',')[0].trim();
  if (partes.length < 3) return { nombre: partes.join(' '), sede };
  const base = partes.slice(0, -2).join(' - ');
  return { nombre: slug(base).includes(slug(sede)) ? base : `${base} ${sede}`.trim(), sede };
}

async function main(): Promise<void> {
  const desde = argumento('desde', '2017-09-01');
  const db = abrirNuevo7(argumento('db', NUEVO7));
  // Los nombres de las pruebas de nuevo7 se leen al compararlas: la base sigue abierta hasta el final.
  const existentes: Equivalente[] = [...equivalentesNuevo7(db), ...equivalentesLotes(['lote7-efc', 'lote7-engarde-rfee'])];
  // La Wayback Machine pide calma: una petición cada 1,2 s.
  const red = new Red(undefined, 1200, 1);
  const semilla = new SemillaUrl(SEMILLA_FIE);
  const redEngarde = new Red();
  const escritores = new Map<string, EscritorHechos>();
  const escritor = { escribir: (h: HechosPrueba) => (escritores.get(h.extractor) ?? escritores.set(h.extractor, new EscritorHechos(h.extractor, SALIDA_EFC)).get(h.extractor)!).escribir(h) };
  const motivos: Record<string, number> = {};
  const anotar = (m: string, n = 1) => (motivos[m] = (motivos[m] ?? 0) + n);
  const detalle: Record<string, unknown>[] = [];

  // Torneos del circuito y XML capturados.
  const ultimas = new Map<string, { timestamp: string; original: string }>();
  for (const sec of ['u17', 'u20']) {
    for (const c of await cdx(red, `eurofencing.info/competitions/${sec}/case:competitions/`)) {
      const tid = /tournamentId:(\d+)$/.exec(c.original)?.[1];
      if (tid && (!ultimas.has(tid) || c.timestamp > ultimas.get(tid)!.timestamp)) ultimas.set(tid, c);
    }
  }
  const capturaXml = new Map<string, string>();
  for (const c of await cdx(red, PREFIJO_XML)) {
    const id = c.original.split('/').pop()!;
    if (!capturaXml.has(id) || c.timestamp > capturaXml.get(id)!) capturaXml.set(id, c.timestamp);
  }
  const eventos: Evento[] = [];
  for (const [tid, c] of [...ultimas].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const r = await red.get(wayback(c.timestamp, c.original));
    if (r.status !== 200) {
      anotar('torneo_sin_captura');
      continue;
    }
    const html = r.body.toString('utf8');
    const filas = filasCampeonatoEfc(html, tid);
    const cabecera = cheerio.load(html)('h1.page-header').text().replace(/\s+/g, ' ').trim();
    const { nombre, sede } = partesTorneoEfc(cabecera);
    const fechas = filas.map((f) => fechaEfc(f.fecha)).filter((f): f is string => !!f).sort();
    // Los Campeonatos de Europa son pruebas FIE (fuente `fie`), aunque la EFC publique su XML.
    if (/championship/i.test(cabecera)) {
      anotar('campeonato_de_europa_fie', filas.length);
      continue;
    }
    if (fechas.length === 0 || fechas.at(-1)! < desde) {
      anotar('torneo_anterior_o_sin_fecha');
      continue;
    }
    eventos.push({ tid, nombre: nombre || cabecera, sede: sede || filas[0]?.lugar || '', pais: filas.find((f) => /^[A-Z]{3}$/.test(f.pais))?.pais ?? null, filas });
  }

  const resumen = { torneos: eventos.length, pruebas: 0, escritas: 0, resultados: 0, poules: 0, cuadro: 0, encuentrosEquipos: 0, conEspanoles: 0 };
  for (const ev of eventos) {
    const pruebas: { fila: FilaEfc; p: PruebaEfc; url: string; sha: string }[] = [];
    for (const fila of ev.filas) {
      resumen.pruebas += 1;
      if (!fila.xid) {
        anotar('sin_xml_publicado');
        detalle.push({ tid: ev.tid, torneo: ev.nombre, prueba: `${fila.arma} ${fila.genero} ${fila.cat} ${fila.ev}`, fecha: fila.fecha, motivo: 'sin_xml_publicado', pdf: fila.pdf });
        continue;
      }
      const ts = capturaXml.get(fila.xid);
      if (!ts) {
        anotar('xml_sin_captura');
        detalle.push({ tid: ev.tid, torneo: ev.nombre, xid: fila.xid, prueba: `${fila.arma} ${fila.genero} ${fila.cat} ${fila.ev}`, fecha: fila.fecha, motivo: 'xml_sin_captura', pdf: fila.pdf });
        continue;
      }
      const url = wayback(ts, `https://${PREFIJO_XML}${fila.xid}`);
      const cuerpo = semilla.leer(url) ?? ((r) => (r.status === 200 ? r.body : null))(await red.get(url));
      if (!cuerpo) {
        anotar('xml_no_descargado');
        continue;
      }
      const xml = decodificarXml(cuerpo);
      const p = /<CompetitionParEquipes\b/.test(xml) ? pruebaEquiposXml(xml) : pruebaIndividualXml(xml);
      if (!p) {
        anotar('xml_ilegible');
        detalle.push({ tid: ev.tid, xid: fila.xid, motivo: 'xml_ilegible' });
        continue;
      }
      if (/^FIE$/i.test(p.campeonato)) {
        anotar('prueba_fie');
        continue;
      }
      if (p.atributos.category !== 'M17' && p.atributos.category !== 'M20') {
        anotar(`fuera_de_alcance_${p.atributos.category}`);
        continue;
      }
      pruebas.push({ fila, p, url: `https://${PREFIJO_XML}${fila.xid}`, sha: createHash('sha256').update(cuerpo).digest('hex') });
    }
    if (pruebas.length === 0) continue;
    const fechas = pruebas.map((x) => x.p.atributos.fecha).sort();
    const season = temporadaRfee(fechas[0]);
    const evento = claveEvento(ev.sede, fechas[0]);
    const usadas = new Set<string>();
    for (const { fila, p, url, sha } of pruebas) {
      let competitionKey = clavePrueba(season, evento, p.atributos);
      if (usadas.has(competitionKey)) competitionKey = `${competitionKey}-${fila.xid}`;
      usadas.add(competitionKey);
      const nombres = [...new Set(p.results.map((r) => normalizeSportName(r.name)).filter(Boolean))];
      const iguales = existentes.filter((c) => compatible(p.atributos, c)).filter((c) => {
        // Por equipos los nombres son naciones, comunes a todos los torneos: cuenta la misma edición.
        if (p.atributos.format === 'EQUIPOS') return c.key.startsWith(`efc:${season}:${evento}:`);
        const s = solapeNombres(nombres, c.nombres());
        return s !== null && s >= 0.3;
      });
      if (iguales.length > 0) {
        anotar('existe');
        detalle.push({ prueba: competitionKey, motivo: 'existe', equivalentes: iguales.map((c) => `${c.origen}:${c.source}:${c.key}`).slice(0, 4) });
        continue;
      }
      const h: HechosPrueba = {
        version: 1, source: 'efc', extractor: 'lector_efc_xml', sourceUrl: url, sourceSha256: sha,
        edition: {
          season, tournamentKey: `efc:${season}:${evento}`, name: ev.nombre, startDate: fechas[0], endDate: fechas.at(-1)!,
          city: ev.sede || null, countryCode: ev.pais,
        },
        competition: {
          competitionKey, weapon: p.atributos.weapon as HechosPrueba['competition']['weapon'], gender: p.atributos.gender as HechosPrueba['competition']['gender'],
          category: p.atributos.category as HechosPrueba['competition']['category'], categoryRaw: p.titulo || fila.cat || null,
          format: p.atributos.format as HechosPrueba['competition']['format'], date: p.atributos.fecha,
        },
        status: { ...p.status, notes: [...p.status.notes, `XML de resultados de la EFC (id ${fila.xid}) capturado por la Wayback Machine; torneo ${ev.tid} de eurofencing.info`] },
        results: p.results,
        bouts: p.bouts,
      };
      if (h.results.length === 0 && h.bouts.length === 0) {
        anotar('sin_hechos');
        continue;
      }
      escritor.escribir(h);
      existentes.push({
        origen: 'lote7-efc', source: 'efc', key: competitionKey, weapon: p.atributos.weapon, gender: p.atributos.gender, category: p.atributos.category,
        format: p.atributos.format, d: dia(p.atributos.fecha), division: null, resultados: h.results.length, poules: 0, cuadro: 0, nombres: () => nombres,
      });
      anotar('escrita');
      resumen.escritas += 1;
      resumen.resultados += h.results.length;
      resumen.poules += h.bouts.filter((b) => b.phase === 'POULE').length;
      resumen.cuadro += h.bouts.filter((b) => b.phase === 'TABLEAU').length;
      if (p.atributos.format === 'EQUIPOS') resumen.encuentrosEquipos += h.bouts.length;
      if (h.results.some((r) => r.countryCode === 'ESP')) resumen.conEspanoles += 1;
      detalle.push({
        prueba: competitionKey, torneo: ev.nombre, fecha: p.atributos.fecha, puestos: h.results.length, espanoles: h.results.filter((r) => r.countryCode === 'ESP').length,
        poules: h.bouts.filter((b) => b.phase === 'POULE').length, cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length, estados: h.status, motivo: 'escrita',
      });
    }
  }
  // Pruebas que la Wayback no tiene: las publicadas en Engarde y en Fencing Worldwide.
  // Un torneo es del circuito si su título lo dice o si la EFC publicó en esa sede, a ±2 días, una
  // prueba del mismo arma (otro torneo de la misma ciudad y fin de semana no lo es).
  const sedesEfc = eventos.map((e) => ({
    sede: slug(e.sede), dias: e.filas.map((f) => fechaEfc(f.fecha)).filter((f): f is string => !!f).map(dia),
    armas: new Set(e.filas.map((f) => armaDeFila(f.arma)).filter(Boolean)),
  }));
  const esDelCircuito = (titulo: string, ciudad: string | null, fecha: string, arma: string | null = null) => !NO_CIRCUITO.test(titulo) && (
    CIRCUITO.test(titulo) ||
    sedesEfc.some((s) => !!ciudad && s.sede === slug(ciudad) && s.dias.some((d) => Math.abs(d - dia(fecha)) <= 2) && (!arma || s.armas.has(arma))));
  const escribirSiFalta = (h: HechosPrueba, a: Atributos, extra: Record<string, unknown>): boolean => {
    // Sin clasificación publicada, los nombres de los asaltos.
    const nombres = [...new Set([...h.results.map((r) => r.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizeSportName).filter(Boolean))];
    const iguales = existentes.filter((c) => compatible(a, c)).filter((c) => {
      if (a.format === 'EQUIPOS') return c.key.startsWith(`${h.edition.tournamentKey}:`);
      const s = solapeNombres(nombres, c.nombres());
      return s !== null && s >= 0.3;
    });
    if (iguales.length > 0) {
      anotar(`${extra.origen}_existe`);
      detalle.push({ prueba: h.competition.competitionKey, ...extra, motivo: 'existe', equivalentes: iguales.map((c) => `${c.origen}:${c.source}:${c.key}`).slice(0, 4) });
      return false;
    }
    escritor.escribir(h);
    existentes.push({
      origen: 'lote7-efc', source: 'efc', key: h.competition.competitionKey, weapon: a.weapon, gender: a.gender, category: a.category, format: a.format,
      d: dia(a.fecha), division: null, resultados: h.results.length, poules: 0, cuadro: 0, nombres: () => nombres,
    });
    anotar(`${extra.origen}_escrita`);
    resumen.escritas += 1;
    resumen.resultados += h.results.length;
    resumen.poules += h.bouts.filter((b) => b.phase === 'POULE').length;
    resumen.cuadro += h.bouts.filter((b) => b.phase === 'TABLEAU').length;
    if (a.format === 'EQUIPOS') resumen.encuentrosEquipos += h.bouts.length;
    if (h.results.some((r) => r.countryCode === 'ESP')) resumen.conEspanoles += 1;
    detalle.push({
      prueba: h.competition.competitionKey, ...extra, torneo: h.edition.name, fecha: a.fecha, puestos: h.results.length,
      espanoles: h.results.filter((r) => r.countryCode === 'ESP').length, poules: h.bouts.filter((b) => b.phase === 'POULE').length,
      cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length, estados: h.status, motivo: 'escrita',
    });
    return true;
  };

  // Engarde: pruebas internacionales cadete, por meses.
  const hoy = new Date().toISOString().slice(0, 10);
  const torneosEngarde = new Map<string, { org: string; evt: string; titulos: string[]; ciudad: string | null; fechas: string[] }>();
  for (let m = new Date(`${desde.slice(0, 7)}-01T00:00:00Z`); m.toISOString().slice(0, 10) <= hoy; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const ini = m.toISOString().slice(0, 10);
    const fin = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    for (let pagina = 1; pagina <= 10; pagina += 1) {
      const r = await redEngarde.post(`${ENGARDE_BASE}/prog/getCompeForDisplay.php`, {
        option: 'all', sexe: '', arme: '', indiv: '', categorie: 'cadet', orderby: '', datefrom: ini, dateto: fin, country: '', city: '',
        type: 'international', state: '', page: String(pagina), lang: 'en', large: 'E', nrows: '50', organism: '', event: '', order: 'ASC', show_test: '0', cache: '1',
      });
      if (r.status !== 200) break;
      const comps = compsDeBusqueda(r.body.toString('utf8'));
      let nuevas = 0;
      for (const c of comps) {
        const k = `${c.org}/${c.evt}`;
        const t = torneosEngarde.get(k) ?? torneosEngarde.set(k, { org: c.org, evt: c.evt, titulos: [], ciudad: c.ciudad, fechas: [] }).get(k)!;
        if (!t.titulos.includes(c.titulo)) {
          t.titulos.push(c.titulo);
          nuevas += 1;
        }
        if (c.fecha) t.fechas.push(c.fecha);
      }
      if (comps.length < 50 || nuevas === 0) break;
    }
  }
  for (const t of torneosEngarde.values()) {
    const fecha = t.fechas.sort()[0];
    if (!fecha || !esDelCircuito(`${t.evt} ${t.titulos.join(' ')}`, t.ciudad, fecha)) {
      anotar('engarde_torneo_no_efc');
      continue;
    }
    const pruebas = await indice(redEngarde, t.org, t.evt);
    const fechas = pruebas.map((p) => p.fecha).filter((f): f is string => !!f).sort();
    if (fechas.length === 0 || fechas.at(-1)! >= hoy) continue;
    const tor = await redEngarde.get(urlTorneoEngarde(t.org, t.evt));
    const nombre = (tor.status === 200 ? parsearTorneoEngarde(tor.body.toString('utf8')).nombre : null) ?? t.titulos[0] ?? t.evt;
    const season = temporadaRfee(fechas[0]);
    const evento = claveEvento(t.ciudad ?? pruebas[0]?.ciudad ?? t.evt, fechas[0]);
    const usadas = new Set<string>();
    for (const p0 of pruebas) {
      const v = validarAtributos(p0);
      if (!v.ok || (v.atributos.category !== 'M17' && v.atributos.category !== 'M20')) {
        anotar(v.ok ? `engarde_fuera_de_alcance_${v.atributos.category}` : `engarde_${v.motivo}`);
        continue;
      }
      const a = v.atributos;
      if (!esDelCircuito(`${t.evt} ${t.titulos.join(' ')}`, t.ciudad, a.fecha, a.weapon)) {
        anotar('engarde_prueba_no_efc');
        continue;
      }
      const p: PruebaIndice = { ...p0, arma: a.weapon as PruebaIndice['arma'], generoFinal: a.gender as PruebaIndice['generoFinal'], categoriaFinal: a.category as PruebaIndice['categoriaFinal'] };
      const portada = await redEngarde.get(urlPruebaEngarde(t.org, t.evt, p.compe));
      const html = portada.status === 200 ? portada.body.toString('utf8') : null;
      if (!html || /currently has no data/i.test(html)) {
        anotar('engarde_sin_datos');
        continue;
      }
      const paginas: Paginas = { prueba: html, clasfinal: null, poules: [], cuadros: [], faltan: [] };
      const docs: Documento[] = [];
      for (const f of paginasDePrueba(html, t.org, t.evt, p.compe).slice(0, 24)) {
        const url = `${urlPruebaEngarde(t.org, t.evt, p.compe)}/${f}`;
        const r = await redEngarde.get(url);
        if (r.status !== 200) {
          paginas.faltan.push(f);
          continue;
        }
        const cuerpo = r.body.toString('utf8');
        const np = f.match(/^poules(\d+)\.htm$/i);
        if (/^clasfinal\.htm$/i.test(f)) paginas.clasfinal = cuerpo;
        else if (np) paginas.poules.push({ pagina: Number(np[1]), html: cuerpo });
        else paginas.cuadros.push({ url, html: cuerpo });
        const tipo = tipoDocumentoEngarde(f);
        if (tipo === 'poules' || tipo === 'cuadro') docs.push({ url, html: cuerpo, tipo, pagina: np ? Number(np[1]) : 1, antiguo: false });
      }
      const c = convertirPrueba(p, paginas, { season, nombreTorneo: nombre, inicio: fechas[0], fin: fechas.at(-1)!, ciudad: p.ciudad });
      if (!c.ok) {
        anotar(`engarde_${c.motivo}`);
        continue;
      }
      const h = c.hechos;
      if (a.format === 'EQUIPOS' && h.results.length > 0 && docs.length > 0) {
        const eq = encuentrosEngarde(docs, paginas.faltan, refsEquipos(h.results), podioDe(h.results));
        if (eq.bouts.length > 0) {
          h.bouts = eq.bouts as AsaltoHecho[];
          h.status.pools = eq.pools;
          h.status.tableau = eq.tableau;
          h.status.notes = h.status.notes.filter((n) => !/no se importan asaltos individuales/.test(n)).concat(eq.notas);
        }
      }
      let competitionKey = clavePrueba(season, evento, a);
      if (usadas.has(competitionKey)) competitionKey = `${competitionKey}-${slug(p.compe)}`;
      usadas.add(competitionKey);
      const efc: HechosPrueba = {
        ...h, source: 'efc', extractor: 'lector_efc_engarde',
        edition: { ...h.edition, season, tournamentKey: `efc:${season}:${evento}` },
        competition: { ...h.competition, competitionKey },
        status: { ...h.status, notes: [...h.status.notes, `Prueba del circuito europeo publicada en Engarde: ${t.org}/${t.evt}/${p.compe}`] },
      };
      escribirSiFalta(efc, a, { origen: 'engarde', engarde: `${t.org}/${t.evt}/${p.compe}` });
    }
  }

  // Fencing Worldwide (Ophardt): torneos del circuito en el archivo anual.
  const anios = [];
  for (let a = Number(desde.slice(0, 4)); a <= Number(hoy.slice(0, 4)); a += 1) anios.push(a);
  for (const anio of anios) {
    const arch = await redEngarde.get(`${FWW_BASE}/en/archive/${anio}`);
    if (arch.status !== 200) continue;
    for (const t of parsearArchivoFww(arch.body.toString('utf8'))) {
      if (t.desde < desde || t.hasta >= hoy || !esDelCircuito(t.nombre, t.ciudad, t.desde)) continue;
      const tor = await redEngarde.get(`${FWW_BASE}/en/${t.ruta}/tournament/`);
      if (tor.status !== 200) continue;
      const season = temporadaRfee(t.desde);
      const evento = claveEvento(t.ciudad, t.desde);
      const usadas = new Set<string>();
      for (const ruta of pruebasDeTorneoFww(tor.body.toString('utf8'))) {
        const res = await redEngarde.get(`${FWW_BASE}/en/${ruta}/results/`);
        if (res.status !== 200) continue;
        const pag = parsearResultadosFww(res.body.toString('utf8'));
        const category = pag.categoria === 'M17' || pag.categoria === 'M20' ? pag.categoria : categoriaEfc(null, `${pag.categoriaOriginal ?? ''} ${t.nombre}`);
        if (!pag.hayTabla || !pag.arma || !pag.genero || !pag.formato || (category !== 'M17' && category !== 'M20')) {
          anotar('fww_fuera_de_alcance_o_incompleta');
          continue;
        }
        const fecha = pag.fecha ?? t.desde;
        const a: Atributos = { weapon: pag.arma, gender: pag.genero, category, format: pag.formato, fecha, division: null };
        if (!esDelCircuito(t.nombre, t.ciudad, fecha, a.weapon)) {
          anotar('fww_prueba_no_efc');
          continue;
        }
        const global = await redEngarde.get(`${FWW_BASE}/en/${ruta}/global/`);
        const destinos = global.status === 200 ? destinosDePruebaFww(global.body.toString('utf8'), ruta) : [];
        const paginas: { destino: string; html: string }[] = [];
        for (const d of destinos) {
          const r = await redEngarde.get(`${FWW_BASE}/en/${ruta}/${d}`);
          if (r.status === 200) paginas.push({ destino: d, html: r.body.toString('utf8') });
        }
        let competitionKey = clavePrueba(season, evento, a);
        if (usadas.has(competitionKey)) competitionKey = `${competitionKey}-${ruta}`;
        usadas.add(competitionKey);
        const h = hechosFww(pag, a.format === 'INDIVIDUAL' ? leerPruebaFww(paginas, pag) : null, {
          season, evento, competitionKey, atributos: a, nombre: t.nombre, inicio: t.desde, fin: t.hasta, ciudad: t.ciudad, pais: t.pais,
          url: `${FWW_BASE}/en/${ruta}/results/`, sha: createHash('sha256').update(res.body).digest('hex'),
        });
        if (h) escribirSiFalta(h, a, { origen: 'fww', fww: ruta });
      }
    }
  }

  db.close();
  for (const e of escritores.values()) e.limpiarAntiguos();
  const informe = { generado: new Date().toISOString(), desde, resumen, motivos, peticiones: red.peticiones, detalle };
  new EscritorHechos('lector_efc_xml', SALIDA_EFC).informe('efc', informe);
  console.log(JSON.stringify({ ...informe, detalle: detalle.length }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
