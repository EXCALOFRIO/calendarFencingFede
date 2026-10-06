/**
 * Cobertura de pruebas celebradas de la FIE, la EFC y la RFEE nacional (sin autonómicas):
 * cuántas hay y cuántas tienen clasificación, poules, cuadro y todo lo que su formato tenga.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/cobertura.ts \
 *     [--db <nuevo7.sqlite>] [--hechos <calendario-trabajo/hechos>] [--hoy 2026-10-06] \
 *     [--md docs/cobertura-2026-10-06.md] [--salida <calendario-trabajo/cobertura>] [--sin-lote8]
 *
 * Fotos (mismo universo de pruebas en todas, para que los denominadores coincidan):
 *  - «antes»: sólo `nuevo7.sqlite`, abierto en modo lectura;
 *  - «lote 7»: nuevo7 más los ficheros `hechos/lote7-*`, leídos directamente (sin cargarlos);
 *  - «lote 8»: lo anterior más `hechos/lote8-*`, si existen.
 *
 * Unidades:
 *  - FIE: cada prueba del calendario FIE (`sport_competition`), salvo las copias de la temporada
 *    siguiente con fechas de la anterior (marcadores sin sede).
 *  - EFC: cada prueba de `lote7-efc` y las que su inventario (`_informe-efc.json`) conoce sin
 *    captura legible. Las que la FIE ya tiene se cuentan en la FIE.
 *  - RFEE: cada fila del catálogo nacional de Skermo (propio y las nacionales del `owa=1`), con
 *    las lecturas compatibles de cualquier fuente nacional (arma, género o mixto, categoría,
 *    grupo de veteranos, modalidad y ±2 días); las lecturas nacionales sin fila (temporadas
 *    anteriores al catálogo) se agrupan por el mismo criterio. Una fila sin lectura es un hueco.
 *
 * `lote7-equipos-correccion` (correcciones) y `lote7-pdf-opcional` (pruebas conjuntas) sólo
 * completan pruebas que ya existen: nunca crean unidades nuevas.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento, bandera, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';

export const NUEVO7_COBERTURA = join(CARPETA_TRABAJO, 'nuevo7.sqlite');
export const CARPETA_COBERTURA = join(CARPETA_TRABAJO, 'cobertura');
const INVENTARIO = join(CARPETA_CACHES, 'history-national', 'national-inventory.json');

export type Fuente = 'FIE' | 'EFC' | 'RFEE';
export type Foto = 'antes' | 'lote7' | 'lote8';
export const FOTOS: readonly Foto[] = ['antes', 'lote7', 'lote8'];
const SOLO_COMPLETAN = new Set(['lote7-equipos-correccion', 'lote7-pdf-opcional']);

/** Una lectura de una prueba (fila de nuevo7 o fichero de hechos), con lo que trae de cada fase. */
export type Registro = {
  origen: string;
  foto: Foto;
  source: string;
  season: string;
  key: string;
  edicion: string;
  categoriaRaw: string | null;
  weapon: string;
  gender: string;
  category: string;
  format: string;
  fecha: string | null;
  url: string | null;
  res: number;
  conPuesto: number;
  esp: number;
  pb: number;
  tb: number;
  poulesRondas: number;
  poulesTiradores: number;
  publicados: number | null;
  parcial: { results: boolean; pools: boolean; tableau: boolean };
  soloCompleta: boolean;
};

export const claveRegistro = (r: Pick<Registro, 'source' | 'season' | 'key'>) => `${r.source}|${r.season}|${r.key}`;
const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** Grupo de edad de veteranos (`40`, `50`...) de cualquiera de los textos, o null. */
export function grupoVet(...textos: (string | null | undefined)[]): string | null {
  for (const t of textos) {
    if (!t) continue;
    const m = /VET(?:ERANOS?)?\s*-?\s*\+?(\d0)(?!\d)|\+\s*(\d0)(?!\d)|:VET:(\d0)(?!\d)|(?<!\d)(\d0)\s*-\s*\d9(?!\d)/i.exec(t);
    if (m) return m[1] ?? m[2] ?? m[3] ?? m[4] ?? null;
  }
  return null;
}

export type Especie = { weapon: string | null; gender: string | null; category: string | null; format: string | null; fecha: string | null; vet: string | null };

/** Misma prueba: arma, categoría y modalidad iguales, género igual o mixto, grupo de veteranos compatible y ±`margen` días. */
export function compatibles(a: Especie, b: Especie, margen = 2): boolean {
  if (!a.fecha || !b.fecha || !a.weapon || a.weapon !== b.weapon || a.category !== b.category || a.format !== b.format) return false;
  if (a.gender !== b.gender && a.gender !== 'MIXTO' && b.gender !== 'MIXTO') return false;
  if (a.vet && b.vet && a.vet !== b.vet) return false;
  return Math.abs(dia(a.fecha) - dia(b.fecha)) <= margen;
}

export const especieDe = (r: Registro): Especie => ({
  weapon: r.weapon, gender: r.gender, category: r.category, format: r.format, fecha: r.fecha,
  vet: r.category === 'VET' ? grupoVet(r.categoriaRaw, r.key, r.edicion) : null,
});

// ------------------------------------------------------------------ fusión de lecturas

/**
 * Lectura de la misma prueba en otra foto: por fase gana la que trae más filas, como hace el
 * cargador (sólo sustituye una sección con otra completa y al menos igual de larga).
 */
export function fundir(a: Registro, b: Registro): Registro {
  const r: Registro = { ...a, foto: b.foto, origen: `${a.origen}+${b.origen}`, soloCompleta: a.soloCompleta && b.soloCompleta };
  if (b.conPuesto > a.conPuesto || (b.conPuesto === a.conPuesto && b.res > a.res)) {
    Object.assign(r, { res: b.res, conPuesto: b.conPuesto, esp: Math.max(a.esp, b.esp) });
    r.parcial = { ...r.parcial, results: b.parcial.results };
  } else r.esp = Math.max(a.esp, b.esp);
  if (b.pb > a.pb) {
    Object.assign(r, { pb: b.pb, poulesRondas: b.poulesRondas, poulesTiradores: b.poulesTiradores });
    r.parcial = { ...r.parcial, pools: b.parcial.pools };
  }
  if (b.tb > a.tb) {
    r.tb = b.tb;
    r.parcial = { ...r.parcial, tableau: b.parcial.tableau };
  }
  r.publicados = Math.max(a.publicados ?? 0, b.publicados ?? 0) || null;
  if (!r.fecha) r.fecha = b.fecha;
  return r;
}

// ------------------------------------------------------------------ evaluación de una prueba

export type EstadoFase = 'si' | 'no' | 'na';
export type Evaluacion = { clasificacion: boolean; poules: EstadoFase; cuadro: EstadoFase; completa: boolean; parcialDeclarado: boolean; espanoles: number };

const SIN_POULES = /ELIMINACI[OÓ]N DIRECTA|JEUX OLYMPIQUES(?! DE LA JEUNESSE)|OLYMPIC GAMES/i;

/**
 * Qué fases aplican a una prueba, a partir de lo publicado por todas sus lecturas:
 *  - clasificación: siempre;
 *  - poules: en individual siempre, salvo eliminación directa declarada en el nombre (o Juegos
 *    Olímpicos); por equipos sólo si alguna lectura trae poules (la mayoría no las tiene);
 *  - cuadro: siempre que haya al menos dos participantes, salvo poule única (una sola poule con
 *    todos los clasificados, que da la clasificación final).
 */
export function evaluar(regs: readonly Registro[], nombre = ''): Evaluacion {
  const res = Math.max(0, ...regs.map((r) => r.conPuesto));
  const pb = Math.max(0, ...regs.map((r) => r.pb));
  const tb = Math.max(0, ...regs.map((r) => r.tb));
  const participantes = Math.max(0, ...regs.map((r) => Math.max(r.res, r.publicados ?? 0)));
  const individual = regs.every((r) => r.format !== 'EQUIPOS');
  const masPoules = regs.reduce<Registro | null>((m, r) => (!m || r.pb > m.pb ? r : m), null);
  const pouleUnica = !!masPoules && masPoules.pb > 0 && masPoules.poulesRondas === 1 && masPoules.poulesTiradores >= Math.max(2, res);
  const poulesAplica = individual ? !SIN_POULES.test(nombre) || pb > 0 : pb > 0;
  const cuadroAplica = tb > 0 || (!pouleUnica && (participantes >= 2 || res === 0));
  const poules: EstadoFase = !poulesAplica ? 'na' : pb > 0 ? 'si' : 'no';
  const cuadro: EstadoFase = !cuadroAplica ? 'na' : tb > 0 ? 'si' : 'no';
  const clasificacion = res > 0;
  const completa = clasificacion && poules !== 'no' && cuadro !== 'no';
  const elegida = (f: 'res' | 'pb' | 'tb') => regs.reduce<Registro | null>((m, r) => (!m || r[f] > m[f] ? r : m), null);
  const parcialDeclarado = completa && (!!elegida('res')?.parcial.results || (poules === 'si' && !!elegida('pb')?.parcial.pools) || (cuadro === 'si' && !!elegida('tb')?.parcial.tableau));
  return { clasificacion, poules, cuadro, completa, parcialDeclarado, espanoles: Math.max(0, ...regs.map((r) => r.esp)) };
}

// ------------------------------------------------------------------ lectura de nuevo7

export function registrosNuevo7(db: DatabaseSync): Registro[] {
  const agregado = <T>(sql: string) => {
    const m = new Map<string, T>();
    for (const f of db.prepare(sql).iterate() as Iterable<Record<string, unknown>>) m.set(String(f.c), f as T);
    return m;
  };
  type R = { n: number; p: number; esp: number };
  const res = agregado<R>(`SELECT competition_id c, count(*) n, count(position) p, sum(source_country_code = 'ESP') esp FROM sport_result GROUP BY competition_id`);
  type B = { pb: number; tb: number; rondas: number };
  const bouts = agregado<B>(`SELECT competition_id c, sum(phase = 'POULE') pb, sum(phase = 'TABLEAU') tb,
      count(DISTINCT CASE WHEN phase = 'POULE' THEN round_key END) rondas FROM sport_bout GROUP BY competition_id`);
  const tiradores = agregado<{ t: number }>(`SELECT c, count(DISTINCT ref) t FROM (
      SELECT competition_id c, fencer_a_ref ref FROM sport_bout WHERE phase = 'POULE'
      UNION ALL SELECT competition_id c, fencer_b_ref ref FROM sport_bout WHERE phase = 'POULE') GROUP BY c`);
  type C = { publicados: number | null; rp: number; pp: number; tp: number };
  const cobertura = agregado<C>(`SELECT competition_id c, max(published_total) publicados,
      max(fact_kind IN ('results', 'ranking', 'pdf') AND status = 'parcial') rp,
      max(fact_kind = 'pools' AND status = 'parcial') pp, max(fact_kind = 'tableau' AND status = 'parcial') tp
      FROM sport_import_coverage WHERE competition_id IS NOT NULL GROUP BY competition_id`);
  const out: Registro[] = [];
  for (const c of db.prepare(`
      SELECT c.id, c.source, c.season, c.competition_key, c.weapon, c.gender, c.category, c.category_raw, c.format,
             coalesce(c.competition_date, e.start_date) fecha, coalesce(c.source_url, e.source_url) url, e.name, e.tournament_key
        FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id`).iterate() as Iterable<Record<string, string | null>>) {
    const r = res.get(c.id!);
    const b = bouts.get(c.id!);
    const v = cobertura.get(c.id!);
    out.push({
      origen: 'nuevo7', foto: 'antes', source: c.source!, season: c.season!, key: c.competition_key!, edicion: `${c.name ?? ''}`,
      categoriaRaw: c.category_raw, weapon: c.weapon!, gender: c.gender!, category: c.category!, format: c.format!, fecha: c.fecha,
      url: c.url, res: r?.n ?? 0, conPuesto: r?.p ?? 0, esp: Number(r?.esp ?? 0), pb: Number(b?.pb ?? 0), tb: Number(b?.tb ?? 0),
      poulesRondas: Number(b?.rondas ?? 0), poulesTiradores: Number(tiradores.get(c.id!)?.t ?? 0),
      publicados: v?.publicados ?? null, parcial: { results: !!v?.rp, pools: !!v?.pp, tableau: !!v?.tp }, soloCompleta: false,
    });
  }
  return out;
}

// ------------------------------------------------------------------ lectura de ficheros de hechos

export function registroDeHechos(h: HechosPrueba, origen: string, foto: Foto): Registro {
  const poules = h.bouts.filter((b) => b.phase === 'POULE');
  const tiradores = new Set(poules.flatMap((b) => [b.aRef, b.bRef]));
  return {
    origen, foto, source: h.source, season: h.edition.season, key: h.competition.competitionKey, edicion: h.edition.name,
    categoriaRaw: h.competition.categoryRaw, weapon: h.competition.weapon, gender: h.competition.gender, category: h.competition.category,
    format: h.competition.format, fecha: h.competition.date ?? h.edition.startDate, url: h.sourceUrl,
    res: h.results.length, conPuesto: h.results.filter((r) => r.position !== null).length,
    esp: h.results.filter((r) => r.countryCode === 'ESP').length,
    pb: poules.length, tb: h.bouts.length - poules.length, poulesRondas: new Set(poules.map((b) => b.roundKey)).size,
    poulesTiradores: tiradores.size, publicados: h.status.publishedParticipants ?? null,
    parcial: { results: h.status.results === 'parcial', pools: h.status.pools === 'parcial', tableau: h.status.tableau === 'parcial' },
    soloCompleta: SOLO_COMPLETAN.has(origen.split('/')[0]),
  };
}

export function ficherosHechos(dir: string): string[] {
  const out: string[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const ruta = join(d, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(ruta);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return out.sort();
}

export function registrosDeCarpetas(raiz: string, prefijo: 'lote7-' | 'lote8-' | 'lote8b-', foto: Foto): Registro[] {
  if (!existsSync(raiz)) return [];
  const out: Registro[] = [];
  for (const carpeta of readdirSync(raiz).filter((d) => d.startsWith(prefijo)).sort()) {
    for (const f of ficherosHechos(join(raiz, carpeta))) {
      const h = JSON.parse(readFileSync(f, 'utf8')) as HechosPrueba;
      if (h?.version !== 1 || !h.competition) continue;
      out.push(registroDeHechos(h, carpeta, foto));
    }
  }
  return out;
}

// ------------------------------------------------------------------ universo

export type FilaCatalogo = {
  fuente: string; temporada: string; claveCatalogo: string; clavePrueba?: string | null; nombre: string; fecha: string | null;
  arma: string | null; genero: string | null; categoria: string | null; categoriaOriginal?: string | null; formato: string | null;
  enlaces: { tipo: string; url: string; etiqueta?: string }[];
  /** Fila que sólo trae el índice con `owa=1`. */
  owa?: boolean;
};

export type Unidad = {
  id: string;
  fuente: Fuente;
  temporada: string;
  fecha: string;
  nombre: string;
  weapon: string;
  gender: string;
  category: string;
  format: string;
  /** Lecturas por foto (acumulativas: las de `lote7` incluyen las de nuevo7). */
  registros: Record<Foto, Registro[]>;
  catalogo: FilaCatalogo | null;
  /** Pruebas EFC conocidas por el inventario sin ningún fichero. */
  pendienteEfc: Record<string, unknown> | null;
};

const NOMBRE_NACIONAL = /\b(TNR|TLM|T\.N\.R|NACIONAL|CAMPEONATO\s+(DE\s+)?ESPA|CTO\.?\s*(DE\s+)?ESP|CESP|COPA\s+(DEL\s+REY|DE\s+LA\s+REINA|DE\s+ESPA)|CRITERIUM|LIGA\s+(NACIONAL|IBERDROLA|DE\s+CLUBES|MASTER|ORO|PLATA|BRONCE)|FENCING FOR EVERYONE|SILLA)/i;
const NOMBRE_REGIONAL = /CAMPIONAT DE CATALUNYA|LLIGA CATALANA|AUTON[OÓ]MIC|PROVINCIAL|TERRITORIAL|CAMPEONATO (DE )?(ANDALUC|MADRID|CASTILLA|GALICIA|ARAG|ASTURIAS|CANARIAS|BALEARES|EXTREMADURA|MURCIA|NAVARRA|LA RIOJA|CANTABRIA|EUSKADI|VALENCIA|LA COMUNIDAD)/i;
const CANCELADA = /CANCELAD|APLAZAD|SUSPENDID|ANULAD/i;
const NOMBRE_INTERNACIONAL = /MEDITERR|EUROPE|EUROPA|EUROPEO|WORLD|MUNDIAL|MUNDO|INTERNATIONAL|INTERNACIONAL|SATELLITE|SAT[EÉ]LITE|COPA DEL MUNDO|GRAND PRIX|EFC|FIE\b|U-?14 EFC|CIRCUIT/i;

/** Una lectura de una fuente nacional es de la RFEE nacional (y no autonómica). */
export function esNacional(r: Pick<Registro, 'source' | 'key' | 'edicion' | 'categoriaRaw' | 'origen'>): boolean {
  if (r.source === 'rfee_pdf' || r.source === 'skermo_rfee') return true;
  if (r.source !== 'engarde') return false;
  const texto = `${r.edicion} ${r.categoriaRaw ?? ''}`;
  if (NOMBRE_INTERNACIONAL.test(texto) && !NOMBRE_NACIONAL.test(texto)) return false;
  // Los lotes 7 y 8 sólo buscaron en Engarde pruebas nacionales y las validaron por nombres.
  if (!r.origen.startsWith('nuevo7')) return true;
  if (/^(engarde:rfee\/|rfee-wayback:)/.test(r.key)) return !NOMBRE_REGIONAL.test(texto);
  return NOMBRE_NACIONAL.test(texto) && !NOMBRE_REGIONAL.test(texto);
}

export const especieFila = (f: FilaCatalogo): Especie => ({
  weapon: f.arma, gender: f.genero, category: f.categoria, format: f.formato, fecha: f.fecha,
  vet: f.categoria === 'VET' ? grupoVet(f.categoriaOriginal) : null,
});

/** Filas celebradas y no anuladas del catálogo nacional: el propio y las nacionales que sólo trae `owa=1`. */
export function filasCatalogo(inv: { ownRfeeCatalog: FilaCatalogo[]; catalog: FilaCatalogo[] }, hoy: string): FilaCatalogo[] {
  // `claveCatalogo` numera cada índice por separado: la misma fila se reconoce por su contenido.
  const contenido = (f: FilaCatalogo) => [f.temporada, f.nombre, f.fecha, f.arma, f.genero, f.categoria, f.categoriaOriginal ?? '', f.formato].join('|');
  const propias = new Set(inv.ownRfeeCatalog.map(contenido));
  const vistas = new Set<string>();
  const ajenas = inv.catalog.filter((f) => {
    const k = contenido(f);
    if (propias.has(k) || vistas.has(k) || !NOMBRE_NACIONAL.test(f.nombre) || NOMBRE_INTERNACIONAL.test(f.nombre)) return false;
    vistas.add(k);
    return true;
  });
  return [...inv.ownRfeeCatalog, ...ajenas.map((f) => ({ ...f, owa: true }))]
    .filter((f) => !!f.fecha && f.fecha <= hoy && !CANCELADA.test(f.nombre) && !!f.arma && !!f.categoria && !!f.formato);
}

/** Identificador de la fila: los dos índices numeran sus filas por separado. */
export const idFila = (f: FilaCatalogo) => `rfee:${f.owa ? 'owa:' : ''}${f.claveCatalogo}`;

const DISTINTIVOS = ['ORO', 'PLATA', 'BRONCE', 'IBERDROLA', 'DIVISION', 'SILLA', 'CLUBES', 'CRITERIUM', 'EVERYONE', 'SATELITE', 'MASTER', 'TLM', 'TNR', 'CAMPEONATO', '1', '2', '3', '4'];

/** Palabras distintivas (división de liga, jornada, circuito) que comparten dos nombres. */
export function afinidad(a: string, b: string): number {
  const palabras = (s: string) => new Set(s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/(\d)\s*[ªº]/g, '$1').split(/[^A-Z0-9]+/).filter(Boolean));
  const x = palabras(a);
  const y = palabras(b.replace(/[_/]+/g, ' ').replace(/\bL ?(ORO|PLATA|BRONCE)\b/gi, '$1'));
  return DISTINTIVOS.filter((p) => x.has(p) && y.has(p)).length;
}

const idPdf = (s: string | null | undefined) => (s ? /([0-9a-f]{32})/i.exec(s)?.[1]?.toLowerCase() ?? null : null);

/** La fila del catálogo publica este registro: clave Skermo o el mismo PDF. */
function enlazada(f: FilaCatalogo, r: Registro): boolean {
  if (r.source === 'skermo_rfee' && f.clavePrueba && f.clavePrueba === r.key) return true;
  const id = r.source === 'rfee_pdf' ? idPdf(r.key) ?? idPdf(r.url) : null;
  return !!id && f.enlaces.some((e) => idPdf(e.url) === id);
}

/** Marcador FIE: prueba copiada en la temporada siguiente con fechas de la anterior. */
export const esMarcadorFie = (season: string, fecha: string | null) => !fecha || fecha < `${Number(season) - 1}-08-01`;

const ARMA_EFC: Record<string, string> = { sabre: 'SABLE', foil: 'FLORETE', epee: 'ESPADA', épée: 'ESPADA' };

/** «Sabre Female Cadets Individual», «23/09 - 24/09/2017» → especie de una prueba EFC sin fichero. */
export function especieEfcPendiente(prueba: string | undefined, fecha: string | undefined): Especie & { temporada: string | null } {
  const p = (prueba ?? '').toLowerCase();
  const arma = Object.entries(ARMA_EFC).find(([k]) => p.includes(k))?.[1] ?? null;
  const genero = /\b(female|women|ladies)\b/.test(p) ? 'F' : /\b(male|men)\b/.test(p) ? 'M' : /mixed/.test(p) ? 'MIXTO' : null;
  const categoria = /cadet/.test(p) ? 'M17' : /junior/.test(p) ? 'M20' : /u23|under 23/.test(p) ? 'M23' : /veteran/.test(p) ? 'VET' : /senior/.test(p) ? 'ABS' : null;
  const formato = /team/.test(p) ? 'EQUIPOS' : /individual/.test(p) ? 'INDIVIDUAL' : null;
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(fecha ?? '') ?? /(\d{2})\/(\d{2})\/(\d{4})/.exec(fecha ?? '');
  const ini = /^(\d{2})\/(\d{2})/.exec(fecha ?? '');
  let f: string | null = null;
  if (m) {
    const anio = Number(m[3]);
    const [d, mes] = ini ? [ini[1], ini[2]] : [m[1], m[2]];
    f = `${Number(mes) > Number(m[2]) ? anio - 1 : anio}-${mes}-${d}`;
  }
  const temporada = f ? (Number(f.slice(5, 7)) >= 8 ? `${f.slice(0, 4)}-${Number(f.slice(0, 4)) + 1}` : `${Number(f.slice(0, 4)) - 1}-${f.slice(0, 4)}`) : null;
  return { weapon: arma, gender: genero, category: categoria, format: formato, fecha: f, vet: null, temporada };
}

export type Entradas = {
  nuevo7: Registro[];
  lote7: Registro[];
  lote8: Registro[];
  catalogo: FilaCatalogo[];
  efcPendientes: Record<string, unknown>[];
  hoy: string;
  /** Si se pasa, recibe las lecturas de Engarde descartadas por no estar en el catálogo nacional. */
  descartes?: Registro[];
  /** Si se pasa, recibe las filas del catálogo RFEE que son pruebas FIE (se cuentan en la FIE). */
  filasEnFie?: FilaCatalogo[];
};

/** Lecturas acumuladas por foto y clave: la de lote7 funde nuevo7 con los ficheros del lote. */
export function lecturasPorFoto(e: Pick<Entradas, 'nuevo7' | 'lote7' | 'lote8'>): Record<Foto, Map<string, Registro>> {
  const antes = new Map(e.nuevo7.map((r) => [claveRegistro(r), r] as const));
  const sumar = (previas: Map<string, Registro>, nuevas: readonly Registro[]) => {
    const m = new Map(previas);
    for (const r of nuevas) {
      const k = claveRegistro(r);
      const p = m.get(k);
      m.set(k, p ? fundir(p, r) : r);
    }
    return m;
  };
  const lote7 = sumar(antes, e.lote7);
  return { antes, lote7, lote8: sumar(lote7, e.lote8) };
}

export function construirUnidades(e: Entradas): Unidad[] {
  const fotos = lecturasPorFoto(e);
  const finales = [...fotos.lote8.values()];
  const porFoto = (r: Registro): Record<Foto, Registro[]> => {
    const k = claveRegistro(r);
    const o = {} as Record<Foto, Registro[]>;
    for (const f of FOTOS) {
      const x = fotos[f].get(k);
      o[f] = x ? [x] : [];
    }
    return o;
  };
  const unidades: Unidad[] = [];

  // FIE
  for (const r of finales) {
    if (r.source !== 'fie' || !r.fecha || r.fecha > e.hoy || esMarcadorFie(r.season, r.fecha)) continue;
    unidades.push({ id: `fie:${r.season}:${r.key}`, fuente: 'FIE', temporada: r.season, fecha: r.fecha, nombre: r.edicion, weapon: r.weapon, gender: r.gender, category: r.category, format: r.format, registros: porFoto(r), catalogo: null, pendienteEfc: null });
  }

  // EFC
  for (const r of finales) {
    if (r.source !== 'efc' || r.soloCompleta || !r.fecha || r.fecha > e.hoy) continue;
    unidades.push({ id: `efc:${r.key}`, fuente: 'EFC', temporada: r.season, fecha: r.fecha, nombre: r.edicion, weapon: r.weapon, gender: r.gender, category: r.category, format: r.format, registros: porFoto(r), catalogo: null, pendienteEfc: null });
  }
  // Una prueba EFC sin XML capturado puede haberse leído de Engarde o de Fencing Worldwide.
  const leidasEfc = finales.filter((r) => r.source === 'efc' || r.source === 'fie').map(especieDe);
  for (const p of e.efcPendientes) {
    const s = especieEfcPendiente(p.prueba as string | undefined, p.fecha as string | undefined);
    if (s.fecha && s.fecha > e.hoy) continue;
    if (s.weapon && leidasEfc.some((x) => compatibles(x, s, 3))) continue;
    unidades.push({
      id: `efc-pendiente:${p.tid}:${p.xid}`, fuente: 'EFC', temporada: s.temporada ?? '?', fecha: s.fecha ?? '?', nombre: String(p.torneo ?? `torneo EFC ${p.tid}`),
      weapon: s.weapon ?? '?', gender: s.gender ?? '?', category: s.category ?? '?', format: s.format ?? '?',
      registros: { antes: [], lote7: [], lote8: [] }, catalogo: null, pendienteEfc: p,
    });
  }

  // RFEE: filas del catálogo
  const nacionales = finales.filter((r) => esNacional(r) && r.fecha);
  const filas = e.catalogo;
  const porArma = new Map<string, number[]>();
  filas.forEach((f, i) => {
    const k = `${f.arma}|${f.categoria}|${f.formato}`;
    (porArma.get(k) ?? porArma.set(k, []).get(k)!).push(i);
  });
  const deFila = filas.map(() => [] as Registro[]);
  const sinFila: Registro[] = [];
  for (const r of nacionales) {
    const s = especieDe(r);
    const cand = (porArma.get(`${r.weapon}|${r.category}|${r.format}`) ?? []).filter((i) => compatibles(especieFila(filas[i]), s));
    const exactas = cand.filter((i) => enlazada(filas[i], r));
    let elegidas = exactas.length > 0 ? exactas : cand;
    if (elegidas.length > 1) {
      const texto = `${r.edicion} ${r.key} ${r.categoriaRaw ?? ''}`;
      const af = elegidas.map((i) => afinidad(filas[i].nombre, texto));
      const max = Math.max(...af);
      elegidas = elegidas.filter((_, j) => af[j] === max);
    }
    if (elegidas.length === 0) sinFila.push(r);
    for (const i of elegidas) deFila[i].push(r);
  }
  const primeraCatalogo = filas.reduce((m, f) => (f.temporada < m ? f.temporada : m), '9999');
  const unidadDe = (id: string, regs: Registro[], base: { temporada: string; fecha: string; nombre: string; weapon: string; gender: string; category: string; format: string }, catalogo: FilaCatalogo | null): Unidad => {
    const registros = {} as Record<Foto, Registro[]>;
    for (const f of FOTOS) registros[f] = regs.map((r) => fotos[f].get(claveRegistro(r))).filter((x): x is Registro => !!x);
    return { id, fuente: 'RFEE', ...base, registros, catalogo, pendienteEfc: null };
  };
  // Copas del Mundo y otras pruebas FIE que la RFEE publica en su catálogo: se cuentan en la FIE.
  const fie = finales.filter((r) => r.source === 'fie').map(especieDe);
  filas.forEach((f, i) => {
    if (deFila[i].length === 0 && !NOMBRE_NACIONAL.test(f.nombre) && fie.some((x) => compatibles(x, especieFila(f)))) {
      e.filasEnFie?.push(f);
      return;
    }
    unidades.push(unidadDe(idFila(f), deFila[i], {
      temporada: f.temporada, fecha: f.fecha!, nombre: f.nombre, weapon: f.arma!, gender: f.genero ?? 'MIXTO', category: f.categoria!, format: f.formato!,
    }, f));
  });

  // RFEE: lecturas nacionales sin fila, agrupadas. Donde hay catálogo, una prueba de Engarde que
  // no casa con ninguna fila no es del calendario nacional (trofeo paralelo, categoría no RFEE).
  const fuera = (r: Registro) => r.source === 'engarde' && r.season >= primeraCatalogo && (!NOMBRE_NACIONAL.test(r.edicion) || /UNIVERSITARI/i.test(r.edicion));
  e.descartes?.push(...sinFila.filter(fuera));
  const orden = sinFila.filter((r) => r.fecha! <= e.hoy && !fuera(r)).sort((a, b) => (a.fecha! < b.fecha! ? -1 : a.fecha! > b.fecha! ? 1 : claveRegistro(a) < claveRegistro(b) ? -1 : 1));
  const grupos: Registro[][] = [];
  for (const r of orden) {
    const s = especieDe(r);
    const g = grupos.find((g) => g.some((x) => compatibles(especieDe(x), s)));
    if (g) g.push(r);
    else grupos.push([r]);
  }
  for (const g of grupos) {
    if (g.every((r) => r.soloCompleta)) continue;
    const ref = g.find((r) => r.source === 'skermo_rfee') ?? g.find((r) => r.source === 'rfee_pdf') ?? g[0];
    unidades.push(unidadDe(`rfee-lectura:${claveRegistro(ref)}`, g, {
      temporada: ref.season, fecha: ref.fecha!, nombre: ref.edicion, weapon: ref.weapon, gender: ref.gender, category: ref.category, format: ref.format,
    }, null));
  }
  const ids = new Set<string>();
  for (const u of unidades) {
    if (ids.has(u.id)) throw new Error(`Unidad repetida: ${u.id}`);
    ids.add(u.id);
  }
  return unidades;
}

// ------------------------------------------------------------------ recuento

export type Recuento = { pruebas: number; clasificacion: number; poulesAplica: number; poules: number; cuadroAplica: number; cuadro: number; completas: number; parcialDeclarado: number };
const vacio = (): Recuento => ({ pruebas: 0, clasificacion: 0, poulesAplica: 0, poules: 0, cuadroAplica: 0, cuadro: 0, completas: 0, parcialDeclarado: 0 });

export function sumar(r: Recuento, ev: Evaluacion): void {
  r.pruebas += 1;
  if (ev.clasificacion) r.clasificacion += 1;
  if (ev.poules !== 'na') r.poulesAplica += 1;
  if (ev.poules === 'si') r.poules += 1;
  if (ev.cuadro !== 'na') r.cuadroAplica += 1;
  if (ev.cuadro === 'si') r.cuadro += 1;
  if (ev.completa) r.completas += 1;
  if (ev.parcialDeclarado) r.parcialDeclarado += 1;
}

/** Temporada FIE «2026» → «2025-2026», para ordenar las tres fuentes igual. */
export const temporadaComun = (u: Pick<Unidad, 'fuente' | 'temporada'>) =>
  /^\d{4}$/.test(u.temporada) ? `${Number(u.temporada) - 1}-${u.temporada}` : u.temporada;

export type Evaluada = Unidad & { ev: Record<Foto, Evaluacion> };

export function evaluarUnidades(us: readonly Unidad[]): Evaluada[] {
  return us.map((u) => {
    const ev = {} as Record<Foto, Evaluacion>;
    for (const f of FOTOS) ev[f] = evaluar(u.registros[f], u.nombre);
    return { ...u, ev };
  });
}

export function matriz(us: readonly Evaluada[], clave: (u: Evaluada) => string): Map<string, Record<Foto, Recuento>> {
  const m = new Map<string, Record<Foto, Recuento>>();
  for (const u of us) {
    const k = clave(u);
    const r = m.get(k) ?? m.set(k, { antes: vacio(), lote7: vacio(), lote8: vacio() }).get(k)!;
    for (const f of FOTOS) sumar(r[f], u.ev[f]);
  }
  return new Map([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ------------------------------------------------------------------ huecos

export type Hueco = {
  id: string; prioridad: 1 | 2 | 3; fuente: Fuente; temporada: string; fecha: string; nombre: string;
  arma: string; genero: string; categoria: string; formato: string;
  faltan: ('clasificacion' | 'poules' | 'cuadro')[]; espanoles: 'si' | 'no' | 'desconocido';
  lecturas: { source: string; key: string; url: string | null; puestos: number; poules: number; cuadro: number }[];
  enlacesCatalogo: { tipo: string; url: string }[];
  efc: Record<string, unknown> | null;
};

export function prioridadDe(u: Evaluada, ev: Evaluacion): 1 | 2 | 3 {
  if (u.fuente === 'RFEE' && temporadaComun(u) >= '2013-2014') return 1;
  if (u.fuente === 'FIE' && (u.category === 'M17' || u.category === 'M20') && ev.espanoles > 0) return 2;
  return 3;
}

export function huecos(us: readonly Evaluada[], foto: Foto): Hueco[] {
  const out: Hueco[] = [];
  for (const u of us) {
    const ev = u.ev[foto];
    if (ev.completa) continue;
    const faltan: Hueco['faltan'] = [];
    if (!ev.clasificacion) faltan.push('clasificacion');
    if (ev.poules === 'no') faltan.push('poules');
    if (ev.cuadro === 'no') faltan.push('cuadro');
    out.push({
      id: u.id, prioridad: prioridadDe(u, ev), fuente: u.fuente, temporada: temporadaComun(u), fecha: u.fecha, nombre: u.nombre,
      arma: u.weapon, genero: u.gender, categoria: u.category, formato: u.format, faltan,
      espanoles: ev.espanoles > 0 ? 'si' : ev.clasificacion ? 'no' : 'desconocido',
      lecturas: u.registros[foto].map((r) => ({ source: r.source, key: r.key, url: r.url, puestos: r.conPuesto, poules: r.pb, cuadro: r.tb })),
      enlacesCatalogo: (u.catalogo?.enlaces ?? []).map((e) => ({ tipo: e.tipo, url: e.url })),
      efc: u.pendienteEfc,
    });
  }
  const espOrden = { si: 0, desconocido: 1, no: 2 } as const;
  return out.sort((a, b) => a.prioridad - b.prioridad || espOrden[a.espanoles] - espOrden[b.espanoles] || (a.fecha > b.fecha ? -1 : a.fecha < b.fecha ? 1 : 0));
}

// ------------------------------------------------------------------ búsqueda de cada hueco

export type EstadoBusqueda =
  | 'recuperado_lote8'
  | 'recuperado_lote8_parcial'
  | 'sin_fuente'
  | 'fuente_sin_datos'
  | 'fuente_sin_rondas'
  | 'fuente_sin_lector'
  | 'pendiente';

export type ContextoBusqueda = {
  /** Clase del hueco en `lote7-faltan/_informe-huecos.json` (filas del catálogo). */
  claseLote7: string | null;
  /** Motivo de `lote8-fie-equipos/_informe.json`. */
  fieEquipos: string | null;
  /** Motivo de `lote8-efc/_informe.json`. */
  efc: string | null;
  /** Motivo de `lote8-fie-efc/_informe.json` (Campeonatos de Europa por equipos desde el XML de la EFC). */
  fieEfc?: string | null;
  /** Motivo de `lote8b-fie-equipos-rondas/_informe.json` (rondas reconstruidas del cuadro por equipos). */
  fieRondas?: string | null;
  /** Motivo de `lote8b-fie-mediterraneo/_informe.json` (Juegos Mediterráneos desde Engarde). */
  fieMediterraneo?: string | null;
  /** Motivo de `lote8b-efc-pdf/_informe.json` (lector de los PDF de la EFC). */
  efcPdf?: string | null;
};

/** Estado de la búsqueda de un hueco tras el lote 8 y los sitios donde se buscó. */
export function estadoBusqueda(h: Hueco, despues: Hueco | null, ctx: ContextoBusqueda): { estado: EstadoBusqueda; dondeSeBusco: string[] } {
  const donde: string[] = [];
  let estado: EstadoBusqueda;
  if (h.fuente === 'FIE') {
    donde.push('API pública de la FIE (lotes 1-7)');
    if (h.temporada < '2014-2015' && h.formato === 'INDIVIDUAL') donde.push('Ophardt y PDF de la FIE (lote 7, fie-historico)');
    if (h.formato === 'EQUIPOS') donde.push(`API FIE, cuadro por equipos (lote 8): ${ctx.fieEquipos ?? 'no pedido'}`);
    if (ctx.fieEfc) donde.push(`XML de la EFC en la Wayback Machine (lote 8): ${ctx.fieEfc}`);
    if (ctx.fieRondas) donde.push(`rondas reconstruidas del cuadro FIE por equipos (lote 8b): ${ctx.fieRondas}`);
    if (ctx.fieMediterraneo) donde.push(`exportación estática de Engarde de los Juegos Mediterráneos (lote 8b): ${ctx.fieMediterraneo}`);
    if (h.formato === 'EQUIPOS' && ctx.fieEquipos === 'rondas_sin_nombre') estado = 'fuente_sin_rondas';
    else estado = h.formato === 'EQUIPOS' && !ctx.fieEquipos ? 'pendiente' : 'fuente_sin_datos';
  } else if (h.fuente === 'EFC') {
    donde.push('eurofencing.info en la Wayback Machine, Engarde y Fencing Worldwide (lote 7)');
    if (h.efc) {
      donde.push(`almacén público de la EFC en S3 (lote 8): ${ctx.efc ?? 'no pedido'}`);
      if (ctx.efcPdf) donde.push(`lector de PDF de la EFC: Engarde, FencingTime y Ophardt (lote 8b): ${ctx.efcPdf}`);
      estado = ctx.efcPdf
        ? 'fuente_sin_datos'
        : ctx.efc === 'pdf_sin_lector' || h.efc.motivo === 'xml_ilegible' ? 'fuente_sin_lector' : ctx.efc === 'sin_documento' ? 'sin_fuente' : 'pendiente';
    } else estado = 'fuente_sin_datos';
  } else {
    donde.push('catálogo de resultados de la RFEE en Skermo (HTML y PDF)');
    donde.push('Engarde: enlaces del catálogo y listas de torneos de organizadores españoles (lotes 7 y 8)');
    donde.push('esgrima.es y Wayback Machine (lote 7)');
    const sinEnlaces = h.enlacesCatalogo.length === 0 && h.lecturas.length === 0;
    if (ctx.claseLote7 === 'engarde_sin_datos') estado = 'fuente_sin_datos';
    else if (ctx.claseLote7 === 'pendiente') estado = 'pendiente';
    else if (sinEnlaces || ctx.claseLote7 === 'sin_documento') estado = 'sin_fuente';
    else estado = 'fuente_sin_datos';
  }
  if (!despues) estado = 'recuperado_lote8';
  else if (despues.faltan.length < h.faltan.length) estado = 'recuperado_lote8_parcial';
  return { estado, dondeSeBusco: donde };
}

// ------------------------------------------------------------------ informe

const pct = (a: number, b: number) => (b === 0 ? '–' : `${((100 * a) / b).toFixed(1).replace('.', ',')} %`);
const n = (x: number) => x.toLocaleString('es-ES');

function filaTabla(etiqueta: string, r: Recuento): string {
  return `| ${etiqueta} | ${n(r.pruebas)} | ${n(r.clasificacion)} | ${n(r.poules)}/${n(r.poulesAplica)} | ${n(r.cuadro)}/${n(r.cuadroAplica)} | ${n(r.completas)} | ${pct(r.completas, r.pruebas)} |`;
}

const CABECERA = '| | Pruebas | Clasificación | Poules (tiene/aplica) | Cuadro (tiene/aplica) | Completas | % |\n|---|---:|---:|---:|---:|---:|---:|';

export function tabla(m: Map<string, Record<Foto, Recuento>>, foto: Foto): string {
  return [CABECERA, ...[...m].map(([k, r]) => filaTabla(k, r[foto]))].join('\n');
}

function tablaComparada(m: Map<string, Record<Foto, Recuento>>, fotos: readonly Foto[]): string {
  const cab = `| | Pruebas | ${fotos.map((f) => `Clasif. ${f}`).join(' | ')} | ${fotos.map((f) => `Completas ${f}`).join(' | ')} |`;
  const sep = `|---|---:|${fotos.map(() => '---:').join('|')}|${fotos.map(() => '---:').join('|')}|`;
  const filas = [...m].map(([k, r]) => `| ${k} | ${n(r.antes.pruebas)} | ${fotos.map((f) => `${n(r[f].clasificacion)} (${pct(r[f].clasificacion, r[f].pruebas)})`).join(' | ')} | ${fotos.map((f) => `${n(r[f].completas)} (${pct(r[f].completas, r[f].pruebas)})`).join(' | ')} |`);
  return [cab, sep, ...filas].join('\n');
}

const tramoTemporada = (u: Evaluada) => {
  const t = temporadaComun(u);
  if (u.fuente === 'FIE' && t < '2002-2003') return '≤2001-2002';
  if (u.fuente === 'RFEE' && t < '2013-2014') return '≤2012-2013';
  return t;
};

export function informeMarkdown(us: readonly Evaluada[], hoy: string, fotos: readonly Foto[], extra: string[]): string {
  const partes: string[] = [];
  partes.push(`# Cobertura de pruebas celebradas (FIE, EFC y RFEE nacional)\n`);
  partes.push(`Medición del ${hoy.split('-').reverse().join('/')} con \`scripts/indexado/cobertura.ts\` (solo lectura). ` +
    `«Antes» es \`nuevo7.sqlite\` (producción); «lote7» suma los ficheros \`hechos/lote7-*\` leídos sin cargarlos` +
    (fotos.includes('lote8') ? '; «lote8» suma además `hechos/lote8-*` y `hechos/lote8b-*`.' : '.') +
    ' Las tres fotos usan el mismo universo de pruebas, así que los denominadores coinciden.\n');
  partes.push(`## Resumen por fuente\n\n${tablaComparada(matriz(us, (u) => u.fuente), fotos)}\n`);
  partes.push(`## Resumen por fuente y modalidad\n\n${tablaComparada(matriz(us, (u) => `${u.fuente} ${u.format === 'EQUIPOS' ? 'equipos' : u.format === 'INDIVIDUAL' ? 'individual' : '?'}`), fotos)}\n`);
  for (const fuente of ['RFEE', 'FIE', 'EFC'] as const) {
    const de = us.filter((u) => u.fuente === fuente);
    partes.push(`## ${fuente}\n`);
    partes.push(`### ${fuente} por temporada\n\n${tablaComparada(matriz(de, tramoTemporada), fotos)}\n`);
    partes.push(`### ${fuente} por temporada: fases tras el lote 7 (previsto)\n\n${tabla(matriz(de, tramoTemporada), 'lote7')}\n`);
    partes.push(`### ${fuente} por categoría y modalidad\n\n${tablaComparada(matriz(de, (u) => `${u.category} ${u.format === 'EQUIPOS' ? 'eq.' : 'ind.'}`), fotos)}\n`);
  }
  partes.push(...extra);
  return `${partes.join('\n')}\n`;
}

export function aObjeto(m: Map<string, Record<Foto, Recuento>>) {
  return Object.fromEntries(m);
}

// ------------------------------------------------------------------ main

function main(): void {
  const hoy = argumento('hoy', new Date().toISOString().slice(0, 10));
  const rutaDb = argumento('db', NUEVO7_COBERTURA);
  const raiz = argumento('hechos', join(CARPETA_TRABAJO, 'hechos'));
  const salida = argumento('salida', CARPETA_COBERTURA);
  const md = resolve(argumento('md', join('docs', `cobertura-${hoy}.md`)));
  const conLote8 = !bandera('sin-lote8');

  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const nuevo7 = registrosNuevo7(db);
  db.close();
  const lote7 = registrosDeCarpetas(raiz, 'lote7-', 'lote7');
  const lote8 = conLote8 ? [...registrosDeCarpetas(raiz, 'lote8-', 'lote8'), ...registrosDeCarpetas(raiz, 'lote8b-', 'lote8')] : [];
  const inv = JSON.parse(readFileSync(argumento('inventario', INVENTARIO), 'utf8'));
  const efcInforme = join(raiz, 'lote7-efc', '_informe-efc.json');
  const efcPendientes = existsSync(efcInforme)
    ? (JSON.parse(readFileSync(efcInforme, 'utf8')).detalle as Record<string, unknown>[]).filter((d) => d.motivo === 'xml_sin_captura' || d.motivo === 'xml_ilegible')
    : [];
  const descartes: Registro[] = [];
  const filasEnFie: FilaCatalogo[] = [];
  const unidades = evaluarUnidades(construirUnidades({ nuevo7, lote7, lote8, catalogo: filasCatalogo(inv, hoy), efcPendientes, hoy, descartes, filasEnFie }));
  const fotos: Foto[] = lote8.length > 0 ? ['antes', 'lote7', 'lote8'] : ['antes', 'lote7'];
  const ultima = fotos[fotos.length - 1];

  mkdirSync(salida, { recursive: true });
  // Aportación de cada carpeta del lote 8: pruebas a las que añade alguna fase y pruebas que completa.
  const aporteLote8: Record<string, { mejoradas: number; completadas: number }> = {};
  const fases = (ev: Evaluacion) => [ev.clasificacion, ev.poules === 'si', ev.cuadro === 'si'];
  for (const u of unidades) {
    const a = fases(u.ev.lote7);
    const b = fases(u.ev.lote8);
    if (!b.some((x, i) => x && !a[i])) continue;
    const carpetas = new Set(u.registros.lote8.flatMap((r) => r.origen.split('+')).filter((o) => /^lote8b?-/.test(o)).map((o) => o.split('/')[0]));
    for (const c of carpetas) {
      const x = (aporteLote8[c] ??= { mejoradas: 0, completadas: 0 });
      x.mejoradas += 1;
      if (u.ev.lote8.completa && !u.ev.lote7.completa) x.completadas += 1;
    }
  }
  const detalle = {
    aporteLote8,
    generado: new Date().toISOString(), hoy, db: rutaDb, fotos,
    lecturas: { nuevo7: nuevo7.length, lote7: lote7.length, lote8: lote8.length },
    filasCatalogoEnFie: filasEnFie.map((f) => `${f.temporada} ${f.fecha} ${f.nombre} ${f.arma} ${f.genero} ${f.categoria} ${f.formato}`),
    engardeFueraDeCatalogo: descartes.map((r) => ({ key: r.key, season: r.season, edicion: r.edicion, origen: r.origen, categoria: r.category })),
    porFuente: aObjeto(matriz(unidades, (u) => u.fuente)),
    porFuenteTemporadaCategoria: aObjeto(matriz(unidades, (u) => `${u.fuente}|${temporadaComun(u)}|${u.category}|${u.format}`)),
  };
  writeFileSync(join(salida, `cobertura-${hoy}.json`), `${JSON.stringify(detalle, null, 1)}\n`);

  const tras7 = huecos(unidades, 'lote7');
  const tras8 = new Map(huecos(unidades, 'lote8').map((h) => [h.id, h] as const));
  const leerJson = (ruta: string) => (existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null);
  const contenido = (f: { temporada: string; nombre: string; fecha: string | null; arma: string | null; genero: string | null; categoria: string | null; formato: string | null }) =>
    [f.temporada, f.nombre, f.fecha, f.arma, f.genero, f.categoria, f.formato].join('|');
  const clasesLote7 = new Map<string, string>(((leerJson(join(raiz, 'lote7-faltan', '_informe-huecos.json'))?.catalogo?.filas ?? []) as (FilaCatalogo & { clase: string })[]).map((f) => [contenido(f), f.clase]));
  const motivosFie = new Map<string, string>(((leerJson(join(raiz, 'lote8-fie-equipos', '_informe.json'))?.detalle ?? []) as { id: string; motivo: string }[]).map((d) => [d.id, d.motivo]));
  const motivosFieEfc = new Map<string, string>(((leerJson(join(raiz, 'lote8-fie-efc', '_informe.json'))?.detalle ?? []) as { id: string; motivo: string }[]).map((d) => [d.id, d.motivo]));
  const motivosEfc = new Map<string, string>(((leerJson(join(raiz, 'lote8-efc', '_informe.json'))?.detalle ?? []) as { tid: string; xid: string; motivo: string }[]).map((d) => [`efc-pendiente:${d.tid}:${d.xid}`, d.motivo]));
  const motivosRondas = new Map<string, string>(((leerJson(join(raiz, 'lote8b-fie-equipos-rondas', '_informe.json'))?.detalle ?? []) as { id: string; motivo: string }[]).map((d) => [d.id, d.motivo]));
  const motivosMed = new Map<string, string>(((leerJson(join(raiz, 'lote8b-fie-mediterraneo', '_informe.json'))?.detalle ?? []) as { fie?: string; motivo: string }[]).flatMap((d) => (d.fie ? [[d.fie, d.motivo] as [string, string]] : [])));
  const motivosEfcPdf = new Map<string, string>(((leerJson(join(raiz, 'lote8b-efc-pdf', '_informe.json'))?.detalle ?? []) as { tid: string; xid: string; motivo: string }[]).map((d) => [`efc-pendiente:${d.tid}:${d.xid}`, d.motivo]));
  const anotados = tras7.map((h) => {
    const despues = tras8.get(h.id) ?? null;
    const b = estadoBusqueda(h, lote8.length > 0 ? despues : h, {
      claseLote7: clasesLote7.get(contenido({ temporada: h.temporada, nombre: h.nombre, fecha: h.fecha, arma: h.arma, genero: h.genero, categoria: h.categoria, formato: h.formato })) ?? null,
      fieEquipos: motivosFie.get(h.id) ?? null,
      fieEfc: motivosFieEfc.get(h.id) ?? null,
      efc: motivosEfc.get(h.id) ?? null,
      fieRondas: motivosRondas.get(h.id) ?? null,
      fieMediterraneo: motivosMed.get(h.id) ?? null,
      efcPdf: motivosEfcPdf.get(h.id) ?? null,
    });
    return { ...h, estadoBusqueda: b.estado, dondeSeBusco: b.dondeSeBusco, faltanTrasLote8: despues?.faltan ?? [] };
  });
  const resumenBusqueda: Record<string, number> = {};
  for (const h of anotados) {
    const k = `${h.prioridad}|${h.fuente}|${h.estadoBusqueda}`;
    resumenBusqueda[k] = (resumenBusqueda[k] ?? 0) + 1;
  }
  const resumenHuecos = (hs: Hueco[]) => {
    const r: Record<string, number> = {};
    for (const h of hs) {
      const k = `${h.prioridad}|${h.fuente}|${h.faltan.join('+')}`;
      r[k] = (r[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(r).sort());
  };
  writeFileSync(join(salida, 'huecos-tras-lote7.json'), `${JSON.stringify({
    generado: new Date().toISOString(), hoy,
    criterio: 'Pruebas celebradas no completas tras nuevo7 + lote7-*. Prioridad 1: RFEE nacional desde 2013-2014; 2: FIE M17/M20 con españoles; 3: resto (dentro, primero las de españoles desconocidos).',
    total: tras7.length, resumen: resumenHuecos(tras7), resumenBusqueda: Object.fromEntries(Object.entries(resumenBusqueda).sort()), huecos: anotados,
  }, null, 1)}\n`);
  if (fotos.includes('lote8')) {
    const lista8 = anotados.filter((h) => h.estadoBusqueda !== 'recuperado_lote8');
    writeFileSync(join(salida, 'huecos-tras-lote8.json'), `${JSON.stringify({ generado: new Date().toISOString(), hoy, total: lista8.length, resumen: resumenHuecos([...tras8.values()]), huecos: lista8 }, null, 1)}\n`);
  }

  const resumenPrioridad = (foto: Foto) => {
    const hs = huecos(unidades, foto);
    const m = new Map<string, number>();
    for (const h of hs) {
      const k = `${h.prioridad} | ${h.fuente} | ${h.faltan.join(' + ')}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return ['| Prioridad | Fuente | Falta | Pruebas |', '|---:|---|---|---:|', ...[...m].sort().map(([k, v]) => `| ${k} | ${n(v)} |`)].join('\n');
  };
  const porCarpeta = new Map<string, { ficheros: number; puestos: number; poules: number; cuadro: number }>();
  for (const r of lote8) {
    const c = r.origen.split('/')[0];
    const x = porCarpeta.get(c) ?? porCarpeta.set(c, { ficheros: 0, puestos: 0, poules: 0, cuadro: 0 }).get(c)!;
    x.ficheros += 1;
    x.puestos += r.res;
    x.poules += r.pb;
    x.cuadro += r.tb;
  }
  const tablaLote8 = ['| Carpeta | Ficheros | Puestos | Asaltos de poule | Asaltos o encuentros de cuadro | Pruebas mejoradas | Pruebas completadas |', '|---|---:|---:|---:|---:|---:|---:|',
    ...[...porCarpeta].sort().map(([c, x]) => `| \`${c}\` | ${n(x.ficheros)} | ${n(x.puestos)} | ${n(x.poules)} | ${n(x.cuadro)} | ${n(aporteLote8[c]?.mejoradas ?? 0)} | ${n(aporteLote8[c]?.completadas ?? 0)} |`)].join('\n');
  const tablaBusqueda = ['| Prioridad | Fuente | Estado tras la búsqueda | Pruebas |', '|---:|---|---|---:|',
    ...Object.entries(resumenBusqueda).sort().map(([k, v]) => `| ${k.split('|').join(' | ')} | ${n(v)} |`)].join('\n');
  const extra = [
    ...(lote8.length > 0 ? [`## Lotes 8 y 8b\n\n${tablaLote8}\n`] : []),
    `## Búsqueda de los huecos tras el lote 7\n\n` +
    'Estados: `recuperado_lote8` (completa con lote 8), `recuperado_lote8_parcial` (le falta menos), `sin_fuente` (no hay documento publicado en ningún sitio mirado), ' +
    '`fuente_sin_datos` (la fuente existe pero no publica esa fase o no se pudo leer), `fuente_sin_rondas` (la FIE publica los encuentros sin ronda), ' +
    '`fuente_sin_lector` (documento localizado sin lector) y `pendiente` (sin buscar en el lote 8).\n\n' + `${tablaBusqueda}\n`,
    `## Huecos que quedan (${ultima})\n\nPrioridad 1: RFEE nacional desde 2013-2014. Prioridad 2: FIE M17/M20 con españoles en la clasificación. Prioridad 3: el resto. Lista completa en \`calendario-trabajo/cobertura/huecos-tras-lote7.json\`${fotos.includes('lote8') ? ' y `huecos-tras-lote8.json`' : ''}.\n\n${resumenPrioridad(ultima)}\n`,
    `## Criterios\n\n` +
    `- Celebrada: fecha ≤ ${hoy} y no anulada (catálogo RFEE con «cancelada», «aplazada», «suspendida» o «anulada» en el nombre). La FIE y la EFC no publican anulaciones en lo indexado: una prueba FIE sin clasificación puede estar anulada.\n` +
    `- FIE: se excluyen los marcadores (prueba de la temporada siguiente con fechas de la anterior).\n` +
    `- RFEE nacional: \`skermo_rfee\`, \`rfee_pdf\` y las pruebas de Engarde de la RFEE o con nombre de prueba nacional (TNR, TLM, Campeonato de España, Criterium, Liga…); las autonómicas no cuentan. Desde 2018-2019 el universo es el catálogo de Skermo; antes, las lecturas que hay.\n` +
    `- Aplica: la clasificación siempre; las poules en individual salvo eliminación directa declarada o Juegos Olímpicos, y por equipos sólo si alguna lectura las trae; el cuadro siempre que haya dos participantes, salvo poule única con todos los clasificados.\n` +
    `- Tiene una fase si al menos una lectura de la prueba la trae con una fila; «completa» = clasificación y todas las fases que aplican. ` +
    `${n(unidades.filter((u) => u.ev[ultima].parcialDeclarado).length)} de las completas (${ultima}) tienen alguna sección declarada parcial por su fuente.\n` +
    `- Lote 7: \`lote7-equipos-correccion\` y \`lote7-pdf-opcional\` sólo completan pruebas existentes; \`lote7-fie\` sustituye a la carpeta \`fie\` antigua (mismas claves que nuevo7).\n` +
    `- Del catálogo RFEE se sacan ${n(filasEnFie.length)} filas que son pruebas FIE (Copas del Mundo en España y similares; se cuentan en la FIE) y ${n(descartes.length)} lecturas de Engarde que no están en el calendario nacional (universitarios, trofeos paralelos).\n`,
    `## Cómo cargar los lotes 8 y 8b después del lote 7\n\n` +
    'Los ficheros de los lotes 8 y 8b tienen las mismas claves de edición y prueba que nuevo7 y el lote 7, con `results` vacío cuando sólo traen asaltos ' +
    '(el cargador no toca una sección sin filas). Se cargan sobre la copia que ya tiene el lote 7 (`nuevo8.sqlite` es esa base; se trabaja sobre una copia suya, nunca sobre el original), ' +
    'en este orden: primero el lote 8 y después el 8b, porque `lote8b-fie-equipos-rondas` completa pruebas FIE por equipos que `lote8-fie-equipos` no pudo escribir ' +
    'y `lote8b-fie-mediterraneo` añade asaltos a pruebas FIE de nuevo7:\n\n' +
    '```powershell\n' +
    'node node_modules/tsx/dist/cli.mjs scripts/indexado/cargar-hechos.ts --db <copia-de-nuevo8.sqlite> --carpetas lote8-fie-equipos,lote8-fie-efc,lote8-efc,lote8-engarde --informe <calendario-trabajo>/lote8-carga.json\n' +
    'node node_modules/tsx/dist/cli.mjs scripts/indexado/cargar-hechos.ts --db <copia-de-nuevo8.sqlite> --carpetas lote8b-fie-equipos-rondas,lote8b-fie-mediterraneo,lote8b-efc-pdf --informe <calendario-trabajo>/lote8b-carga.json\n' +
    '```\n\n' +
    'Las dos pasadas pueden ser una sola con las siete carpetas en ese orden. Las lecturas del cuadro FIE usan `extractor: lector_fie` para que, ' +
    'frente a otra lectura FIE de la misma prueba sin cuadro, gane la que lo trae (el cargador no aplica la comprobación de coherencia del cuadro a equipos, ' +
    'donde los perdedores siguen en las series de puestos). Las referencias de los encuentros FIE son `team:<id FIE>`, las mismas que los puestos; ' +
    'las de la EFC, `efc:<país>:<nombre>` y `team:efc:<país>` como en el lote 7. ' +
    '`lote8-engarde-cespm15` es de otra sesión y no forma parte de esta carga. Después, los mismos pasos posteriores a la carga que el lote 7.\n',
  ];
  writeFileSync(md, informeMarkdown(unidades, hoy, fotos, extra));
  const resumen = matriz(unidades, (u) => u.fuente);
  for (const [k, r] of resumen) {
    console.log(k, fotos.map((f) => `${f}: ${r[f].completas}/${r[f].pruebas} completas, ${r[f].clasificacion} clasif.`).join(' | '));
  }
  console.log(`huecos tras lote7: ${tras7.length} → ${join(salida, 'huecos-tras-lote7.json')}`);
  console.log(`informe: ${md}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
