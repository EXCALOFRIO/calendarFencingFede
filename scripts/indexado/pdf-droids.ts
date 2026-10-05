/**
 * Extracción con droids de los PDF RFEE que el lector local no lee entero.
 *
 * Por cada PDF lanza `droid exec` (sólo herramienta Read, sin red), valida en
 * código la respuesta contra el texto del propio PDF y escribe un fichero de
 * hechos por prueba (formato común `hechosPrueba`). Las claves se calculan
 * aquí, igual que el lector local, a partir de la URL y de la cabecera: el
 * modelo nunca decide una clave.
 *
 * Uso:
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/pdf-droids.ts [--limite N] [--solo sha,sha]
 *     [--concurrencia 8] [--modelo gpt-6-luna] [--modelo-fuerte gpt-6-sol] [--timeout 300]
 *     [--reintentar-fallos] [--revalidar]
 *
 * `--revalidar` vuelve a pasar la validación sobre las respuestas crudas guardadas, sin lanzar droids.
 * Reanudable: un PDF con estado `hecho` en pdf-droid-raw/_estado no se vuelve a lanzar.
 * Los registros nunca imprimen nombres de personas; las respuestas crudas quedan en pdf-droid-raw.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { freemem, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ARMAS, CATEGORIAS, FORMATOS, GENEROS, ficheroHechos, hechosPrueba,
  type AsaltoHecho, type HechosPrueba, type ResultadoHecho,
} from '../../src/lib/ingest/hechos/formato';
import { metadatosDeCabecera } from '../../src/lib/ingest/sources/rfee-pdf/cabecera';
import { normalizar } from '../../src/lib/ingest/sources/rfee-pdf/geometria';

// ---------------------------------------------------------------- claves

/** Igual que `docIdDeUrl` del lector: namespace nuevo por URL completa. */
export function docIdDeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return `url-${createHash('sha256').update(u.href).digest('hex')}`;
}

/** Igual que el `slug` de la cohorte en `rfee-pdf/resultados.ts`. */
export function slugCohorte(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 24);
}

export const claveEdicion = (docId: string): string => `pdf:${docId}`;

/** `pdf:<docId>:<docId>:ARMA:G:FORMATO:CAT:COHORTE`, con `~n` si se repite dentro del documento. */
export function claveCompeticion(
  docId: string,
  p: { weapon: string; gender: string; format: string; category: string; cohorte: string | null },
  existentes: Set<string>,
): string {
  const base = [docId, p.weapon, p.gender, p.format, p.category, slugCohorte(p.cohorte ?? '')].join(':');
  let k = base;
  for (let i = 2; existentes.has(k); i += 1) k = `${base}~${i}`;
  existentes.add(k);
  return `pdf:${docId}:${k}`;
}

/** Forma comparable de un nombre o texto: sin tildes, mayúsculas, sólo letras y cifras. */
export function compacto(s: string): string {
  return normalizar(s).replace(/[^A-Z0-9]/g, '');
}

export const claveNombre = (s: string): string => normalizar(s).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------- respuesta del droid

type Estado = 'completo' | 'parcial' | 'sin_resultados' | 'ilegible';
const ESTADOS: readonly Estado[] = ['completo', 'parcial', 'sin_resultados', 'ilegible'];

type AsaltoCrudo = { aName?: unknown; bName?: unknown; scoreA?: unknown; scoreB?: unknown; winner?: unknown; round?: unknown };
type PruebaCruda = {
  headerLines?: unknown; weapon?: unknown; gender?: unknown; category?: unknown; categoryRaw?: unknown;
  format?: unknown; date?: unknown; pages?: unknown; publishedParticipants?: unknown;
  status?: { results?: unknown; pools?: unknown; tableau?: unknown };
  results?: unknown; pools?: unknown; tableau?: unknown; notes?: unknown;
};

/** Saca el objeto JSON de la respuesta (tolera vallas markdown o texto alrededor). */
export function extraerJson(texto: string): unknown {
  const limpio = texto.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch {
    const i = limpio.indexOf('{');
    if (i < 0) throw new Error('respuesta_sin_json');
    const fin = finDeObjeto(limpio, i);
    if (fin < 0) throw new Error('respuesta_json_incompleta');
    // Los modelos a veces cierran de más (`]}` sobrantes) tras un objeto completo; cualquier otro resto se rechaza.
    if (!/^[\s\]}`]*$/.test(limpio.slice(fin + 1)) && !/^\s*```/.test(limpio.slice(fin + 1))) {
      throw new Error('respuesta_con_texto_tras_json');
    }
    return JSON.parse(limpio.slice(i, fin + 1));
  }
}

/** Índice del `}` que cierra el objeto que empieza en `inicio`, respetando cadenas; -1 si no cierra. */
function finDeObjeto(s: string, inicio: number): number {
  let prof = 0;
  let enCadena = false;
  for (let k = inicio; k < s.length; k += 1) {
    const c = s[k];
    if (enCadena) {
      if (c === '\\') k += 1;
      else if (c === '"') enCadena = false;
    } else if (c === '"') enCadena = true;
    else if (c === '{' || c === '[') prof += 1;
    else if (c === '}' || c === ']') {
      prof -= 1;
      if (prof === 0) return k;
    }
  }
  return -1;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const enumDe = <T extends string>(v: unknown, valores: readonly T[]): T | null => {
  const s = str(v)?.toUpperCase();
  return (valores as readonly string[]).includes(s ?? '') ? (s as T) : null;
};
const estadoDe = (v: unknown): Estado | null => {
  const s = str(v)?.toLowerCase();
  return (ESTADOS as readonly string[]).includes(s ?? '') ? (s as Estado) : null;
};

// ---------------------------------------------------------------- validación

export type ContextoValidacion = {
  url: string;
  sha256: string;
  docId: string;
  season: string;
  editionName: string | null;
  editionStart?: string | null;
  editionEnd?: string | null;
  /** Texto de cada página según `unpdf`. */
  paginas: string[];
  extractor: string;
};

export type Descartes = Record<string, number>;

export type ResultadoValidacion = {
  hechos: HechosPrueba[];
  /** Filas propuestas por el modelo y filas aceptadas, por sección. */
  propuestas: { results: number; bouts: number };
  aceptadas: { results: number; bouts: number };
  descartes: Descartes;
  problemas: string[];
  sinTexto: boolean;
};

const sumarDescarte = (d: Descartes, motivo: string, n = 1) => {
  d[motivo] = (d[motivo] ?? 0) + n;
};

const RE_RONDA = /^T(\d+)(?:-(\d+))?$/;
const esPotenciaDeDos = (n: number) => n >= 2 && n <= 1024 && (n & (n - 1)) === 0;

/** Texto mínimo (letras y cifras) para considerar que el PDF tiene capa de texto. */
const MIN_TEXTO = 80;

export function validarExtraccion(crudo: unknown, ctx: ContextoValidacion): ResultadoValidacion {
  const descartes: Descartes = {};
  const problemas: string[] = [];
  const propuestas = { results: 0, bouts: 0 };
  const aceptadas = { results: 0, bouts: 0 };
  const texto = compacto(ctx.paginas.join(' '));
  const sinTexto = texto.length < MIN_TEXTO;
  const enPdf = (nombre: string) => {
    const c = compacto(nombre);
    return c.length >= 2 && texto.includes(c);
  };

  const raiz = (crudo ?? {}) as { documentTitle?: unknown; competitions?: unknown };
  const pruebas = arr(raiz.competitions) as PruebaCruda[];
  if (pruebas.length === 0) problemas.push('sin_competiciones');

  const existentes = new Set<string>();
  const borradores: { h: Omit<HechosPrueba, 'edition'>; fecha: string | null }[] = [];

  for (const [ip, p] of pruebas.entries()) {
    const notas: string[] = [];
    const cabecera = arr(p.headerLines).map(str).filter((l): l is string => l !== null);
    const meta = metadatosDeCabecera(cabecera);
    const cabeceraLeida = cabecera.filter((l) => enPdf(l)).length;
    if (cabecera.length > 0 && cabeceraLeida === 0 && !sinTexto) notas.push('cabecera_no_localizada_en_texto');

    const delModelo = {
      weapon: enumDe(p.weapon, ARMAS),
      gender: enumDe(p.gender, GENEROS),
      format: enumDe(p.format, FORMATOS),
      category: enumDe(p.category, CATEGORIAS),
    };
    // La cabecera leída manda (es lo que usa el lector local para su clave); el modelo sólo completa huecos.
    const weapon = meta.arma ?? delModelo.weapon;
    const gender = meta.genero ?? delModelo.gender;
    const format = meta.formato ?? delModelo.format;
    const categoriaCabecera = enumDe(meta.categoria, CATEGORIAS);
    const category = categoriaCabecera ?? delModelo.category;
    for (const [campo, cab, mod] of [
      ['arma', meta.arma, delModelo.weapon], ['genero', meta.genero, delModelo.gender],
      ['formato', meta.formato, delModelo.format], ['categoria', categoriaCabecera, delModelo.category],
    ] as const) {
      if (cab && mod && cab !== mod) notas.push(`conflicto_${campo}_cabecera_modelo`);
    }
    if (!weapon || !gender || !format || !category) {
      problemas.push(`prueba_${ip + 1}_sin_atributos`);
      sumarDescarte(descartes, 'prueba_sin_atributos');
      continue;
    }
    const competitionKey = claveCompeticion(ctx.docId, { weapon, gender, format, category, cohorte: meta.cohorte }, existentes);
    const fechaModelo = str(p.date);
    const fecha = fechaModelo && /^\d{4}-\d{2}-\d{2}$/.test(fechaModelo) ? fechaModelo : meta.fecha;
    const individual = format === 'INDIVIDUAL';

    // ---- clasificación
    const filas = arr(p.results) as Record<string, unknown>[];
    propuestas.results += filas.length;
    let descResultados = 0;
    let anomalias = 0;
    // Un nombre repetido en la clasificación individual es ambiguo: no se sabe qué fila es la buena.
    const cuentaNombres = contar(filas.map((f) => str(f?.name)).filter((n): n is string => n !== null).map(compacto));
    const repetidos = new Set(Object.keys(cuentaNombres).filter((k) => cuentaNombres[k] > 1));
    const aceptadosRes: Omit<ResultadoHecho, 'factKey'>[] = [];
    let previo = 0;
    let sinPuesto = 0;
    for (const [iFila, f] of filas.entries()) {
      const nombre = str(f?.name);
      const posicion = f?.position === null || f?.position === undefined ? null : int(f.position);
      // El índice cuenta las filas impresas, no las aceptadas: una fila descartada no debe desplazar las siguientes.
      const filaNumerica = iFila + 1;
      const motivo =
        !nombre ? 'resultado_sin_nombre'
          : !enPdf(nombre) ? 'resultado_nombre_no_en_pdf'
          : f?.position !== null && f?.position !== undefined && (posicion === null || posicion < 1) ? 'resultado_posicion_invalida'
          : posicion !== null && posicion < previo ? 'resultado_posicion_no_monotona'
          : individual && repetidos.has(compacto(nombre)) ? 'resultado_duplicado'
          : null;
      if (motivo) {
        sumarDescarte(descartes, motivo);
        descResultados += 1;
        continue;
      }
      if (posicion !== null) {
        if (posicion !== previo && posicion !== filaNumerica) anomalias += 1;
        previo = posicion;
      }
      if (posicion === null && !str(f?.positionRaw)) sinPuesto += 1;
      const club = str(f?.club);
      const pais = str(f?.country)?.toUpperCase() ?? null;
      if (club && !enPdf(club)) sumarDescarte(descartes, 'club_no_en_pdf_anulado');
      aceptadosRes.push({
        name: nombre as string,
        countryCode: pais && /^[A-Z]{3}$/.test(pais) ? pais : null,
        club: club && enPdf(club) ? club : null,
        position: posicion,
        positionRaw: str(f?.positionRaw) ?? (posicion === null ? null : String(posicion)),
        points: null,
        fieId: null,
        license: null,
        birthYear: null,
      });
    }
    const numericas = aceptadosRes.filter((r) => r.position !== null).length;
    if (numericas > 0 && anomalias / numericas > 0.2) {
      sumarDescarte(descartes, 'resultado_posiciones_no_contiguas', aceptadosRes.length);
      descResultados += aceptadosRes.length;
      aceptadosRes.length = 0;
      notas.push('clasificacion_descartada_posiciones_no_contiguas');
    } else if (anomalias > 0) {
      notas.push(`posiciones_con_huecos:${anomalias}`);
    }
    if (sinPuesto > 0 && aceptadosRes.length > 0) notas.push(`filas_sin_puesto_legible:${sinPuesto}`);

    const cuentaPorPos = new Map<number, number>();
    for (const r of aceptadosRes) if (r.position !== null) cuentaPorPos.set(r.position, (cuentaPorPos.get(r.position) ?? 0) + 1);
    const ordinalPorPos = new Map<number, number>();
    const results: ResultadoHecho[] = aceptadosRes.map((r, i) => {
      let sufijo: string;
      if (r.position === null) sufijo = `x${i + 1}`;
      else if (cuentaPorPos.get(r.position) === 1) sufijo = String(r.position);
      else {
        const k = (ordinalPorPos.get(r.position) ?? 0) + 1;
        ordinalPorPos.set(r.position, k);
        sufijo = `${r.position}-${k}`;
      }
      return { factKey: `${competitionKey}:pdfd:${sufijo}`, ...r };
    });
    aceptadas.results += results.length;

    const refExacta = new Map<string, string>();
    const refCompacta = new Map<string, string | null>();
    for (const r of results) {
      if (!refExacta.has(r.name)) refExacta.set(r.name, r.factKey);
      const c = compacto(r.name);
      refCompacta.set(c, refCompacta.has(c) ? null : r.factKey);
    }
    const ref = (nombre: string) =>
      refExacta.get(nombre) ?? refCompacta.get(compacto(nombre)) ?? `${competitionKey}:pdfd:n:${claveNombre(nombre)}`;

    // ---- asaltos
    const bouts: AsaltoHecho[] = [];
    const comprobarAsalto = (a: AsaltoCrudo, maxTocados: number): { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null } | string => {
      const an = str(a?.aName);
      const bn = str(a?.bName);
      const sa = int(a?.scoreA);
      const sb = int(a?.scoreB);
      const w = str(a?.winner)?.toUpperCase() ?? null;
      if (!an || !bn) return 'asalto_sin_nombre';
      if (compacto(an) === compacto(bn)) return 'asalto_mismo_tirador';
      if (!enPdf(an) || !enPdf(bn)) return 'asalto_nombre_no_en_pdf';
      if (sa === null || sb === null || sa < 0 || sb < 0 || sa > 45 || sb > 45) return 'asalto_marcador_invalido';
      if (sa > maxTocados || sb > maxTocados) return 'asalto_marcador_fuera_de_rango';
      if (w !== null && w !== 'A' && w !== 'B') return 'asalto_ganador_invalido';
      if (sa !== sb) {
        const mayor = sa > sb ? 'A' : 'B';
        if (w !== null && w !== mayor) return 'asalto_ganador_incoherente';
        return { a: an, b: bn, sa, sb, w: null };
      }
      if (w === null) return 'asalto_empate_sin_ganador';
      return { a: an, b: bn, sa, sb, w };
    };
    const empujar = (fase: 'POULE' | 'TABLEAU', ronda: string, x: { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null }) =>
      bouts.push({
        phase: fase, roundKey: ronda, aRef: ref(x.a), bRef: ref(x.b), aName: x.a, bName: x.b,
        scoreA: x.sa, scoreB: x.sb, winner: x.w,
      });

    let descPoules = 0;
    let boutsPoules = 0;
    const poules = arr(p.pools) as { pool?: unknown; fencers?: unknown; bouts?: unknown }[];
    const vueltasPorNumero = new Map<number, number>();
    for (const [iPool, pool] of poules.entries()) {
      const lista = arr(pool?.bouts) as AsaltoCrudo[];
      propuestas.bouts += lista.length;
      const numero = int(pool?.pool) ?? iPool + 1;
      // Un número de poule repetido es otra vuelta de poules, como `V2P3` en el lector local.
      const vuelta = (vueltasPorNumero.get(numero) ?? 0) + 1;
      vueltasPorNumero.set(numero, vuelta);
      const rondaPoule = vuelta === 1 ? `P${numero}` : `V${vuelta}P${numero}`;
      const tiradores = new Set(arr(pool?.fencers).map(str).filter((s): s is string => s !== null).map(compacto));
      const parejas = new Set<string>();
      const nombresEnBouts = new Set<string>();
      const validos: { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null }[] = [];
      for (const a of lista) {
        // Las poules de equipos son relevos a 45.
        const r = comprobarAsalto(a, individual ? 15 : 45);
        if (typeof r === 'string') {
          sumarDescarte(descartes, `poule_${r}`);
          descPoules += 1;
          continue;
        }
        const ca = compacto(r.a);
        const cb = compacto(r.b);
        if (tiradores.size > 0 && (!tiradores.has(ca) || !tiradores.has(cb))) {
          sumarDescarte(descartes, 'poule_tirador_fuera_de_poule');
          descPoules += 1;
          continue;
        }
        const pareja = [ca, cb].sort().join('|');
        if (parejas.has(pareja)) {
          sumarDescarte(descartes, 'poule_asalto_duplicado');
          descPoules += 1;
          continue;
        }
        parejas.add(pareja);
        nombresEnBouts.add(ca).add(cb);
        validos.push(r);
      }
      const n = Math.max(tiradores.size, nombresEnBouts.size);
      const maximo = (n * (n - 1)) / 2;
      if (validos.length > maximo) {
        sumarDescarte(descartes, 'poule_mas_asaltos_que_posibles', validos.length);
        descPoules += validos.length;
        continue;
      }
      for (const v of validos) empujar('POULE', rondaPoule, v);
      boutsPoules += validos.length;
    }

    let descCuadro = 0;
    let boutsCuadro = 0;
    const cuadro = arr(p.tableau) as AsaltoCrudo[];
    propuestas.bouts += cuadro.length;
    const porRonda = new Map<string, Set<string>>();
    for (const a of cuadro) {
      const ronda = str(a?.round)?.toUpperCase().replace(/\s+/g, '') ?? '';
      const m = ronda.match(RE_RONDA);
      if (!m || !esPotenciaDeDos(Number(m[1])) || (m[2] !== undefined && ronda !== 'T2-3')) {
        sumarDescarte(descartes, 'cuadro_ronda_invalida');
        descCuadro += 1;
        continue;
      }
      const r = comprobarAsalto(a, individual ? 15 : 45);
      if (typeof r === 'string') {
        sumarDescarte(descartes, `cuadro_${r}`);
        descCuadro += 1;
        continue;
      }
      const usados = porRonda.get(ronda) ?? new Set<string>();
      const ca = compacto(r.a);
      const cb = compacto(r.b);
      if (usados.has(ca) || usados.has(cb)) {
        sumarDescarte(descartes, 'cuadro_tirador_repetido_en_ronda');
        descCuadro += 1;
        continue;
      }
      usados.add(ca).add(cb);
      porRonda.set(ronda, usados);
      empujar('TABLEAU', ronda, r);
      boutsCuadro += 1;
    }
    aceptadas.bouts += bouts.length;

    // ---- estados
    const st = p.status ?? {};
    const estadoFinal = (declarado: Estado | null, filasOk: number, descartadas: number): Estado => {
      if (filasOk === 0) return descartadas > 0 || declarado === 'ilegible' ? 'ilegible' : 'sin_resultados';
      if (descartadas > 0) return 'parcial';
      if (declarado === 'completo') return 'completo';
      return 'parcial';
    };
    const publicados = int(p.publishedParticipants);
    let estadoRes = estadoFinal(estadoDe(st.results), results.length, descResultados);
    if (estadoRes === 'completo' && publicados !== null && results.length < publicados) {
      estadoRes = 'parcial';
      notas.push('menos_puestos_que_participantes_declarados');
    }
    if (estadoRes === 'completo' && (anomalias > 0 || sinPuesto > 0)) estadoRes = 'parcial';
    const estadoPoules = estadoFinal(estadoDe(st.pools), boutsPoules, descPoules);
    const estadoCuadro = estadoFinal(estadoDe(st.tableau), boutsCuadro, descCuadro);
    if (sinTexto) notas.push('pdf_sin_capa_de_texto');
    const totalDesc = descResultados + descPoules + descCuadro;
    if (totalDesc > 0) notas.push(`filas_descartadas_validacion:${totalDesc}`);

    borradores.push({
      fecha,
      h: {
        version: 1,
        source: 'rfee_pdf',
        extractor: ctx.extractor,
        sourceUrl: ctx.url,
        sourceSha256: ctx.sha256,
        competition: {
          competitionKey, weapon, gender, category,
          categoryRaw: str(p.categoryRaw) ?? meta.categoriaPublicada,
          format, date: fecha,
        },
        status: {
          results: estadoRes, pools: estadoPoules, tableau: estadoCuadro,
          publishedParticipants: publicados, notes: notas,
        },
        results,
        bouts,
      },
    });
  }

  const fechas = borradores.map((b) => b.fecha).filter((f): f is string => f !== null).sort();
  const titulo = str(raiz.documentTitle);
  const edition = {
    season: ctx.season,
    tournamentKey: claveEdicion(ctx.docId),
    name: ctx.editionName ?? titulo ?? `RFEE ${ctx.docId}`,
    startDate: fechas[0] ?? ctx.editionStart ?? null,
    endDate: fechas.at(-1) ?? ctx.editionEnd ?? null,
    city: null,
    countryCode: null,
  };
  const hechos: HechosPrueba[] = [];
  for (const b of borradores) {
    const r = hechosPrueba.safeParse({ ...b.h, edition });
    if (r.success) hechos.push(r.data);
    else {
      problemas.push(`zod:${b.h.competition.competitionKey}:${r.error.issues.map((i) => i.path.join('.')).slice(0, 5).join(',')}`);
      sumarDescarte(descartes, 'prueba_no_pasa_esquema');
    }
  }
  return { hechos, propuestas, aceptadas, descartes, problemas, sinTexto };
}

/** Peso de una extracción para elegir entre intentos: filas válidas, penalizando descartes. */
export function puntuar(v: ResultadoValidacion): number {
  const desc = Object.values(v.descartes).reduce((a, b) => a + b, 0);
  return v.aceptadas.results * 2 + v.aceptadas.bouts - desc;
}

/** ¿Merece la pena repetir con el modelo fuerte? */
export function necesitaEscalar(
  v: ResultadoValidacion | null,
  lectorLocal: { results?: number | null; bouts?: number | null } = {},
): boolean {
  if (!v) return true;
  if (v.sinTexto) return false;
  if (v.hechos.length === 0) return true;
  const propuestas = v.propuestas.results + v.propuestas.bouts;
  const aceptadas = v.aceptadas.results + v.aceptadas.bouts;
  if (propuestas === 0) return true;
  // El droid sólo aporta si llega a lo que ya lee el lector local (con margen para filas descartadas).
  if ((lectorLocal.results ?? 0) * 0.9 > v.aceptadas.results || (lectorLocal.bouts ?? 0) * 0.9 > v.aceptadas.bouts) return true;
  return (propuestas - aceptadas) / propuestas > 0.15;
}

// ---------------------------------------------------------------- troceado de PDF largos

/**
 * Los modelos recortan la respuesta en PDF largos (cientos de asaltos). Para
 * esos se pide la clasificación en una pasada y los asaltos por tramos de páginas.
 */
export const PAGINAS_POR_TRAMO = 6;

export function tramos(paginas: number, porTramo = PAGINAS_POR_TRAMO): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 1; a <= paginas; a += porTramo) out.push([a, Math.min(paginas, a + porTramo - 1)]);
  return out;
}

export const ALCANCE_RESULTADOS =
  'SCOPE OF THIS PASS: extract ONLY the competitions and their final classification (results). Return empty "pools" and "tableau" lists and set status.pools and status.tableau to "sin_resultados". Bouts are extracted in other passes.';

export const alcanceAsaltos = (a: number, b: number) =>
  `SCOPE OF THIS PASS: look ONLY at pages ${a} to ${b} and extract ONLY the pool bouts and tableau bouts printed on those pages, completely. Return an empty "results" list with status.results "sin_resultados". For each competition with bouts on those pages still fill headerLines, weapon, gender, category, categoryRaw, format and date. Set status.pools / status.tableau for what appears on these pages ("sin_resultados" if none).`;

/** Firma de una prueba para emparejar pasadas: los mismos atributos que la clave. */
function firmaPrueba(p: PruebaCruda, conCohorte: boolean): string {
  const meta = metadatosDeCabecera(arr(p.headerLines).map(str).filter((l): l is string => l !== null));
  const partes: (string | null)[] = [
    meta.arma ?? enumDe(p.weapon, ARMAS), meta.genero ?? enumDe(p.gender, GENEROS),
    meta.formato ?? enumDe(p.format, FORMATOS), enumDe(meta.categoria, CATEGORIAS) ?? enumDe(p.category, CATEGORIAS),
  ];
  if (conCohorte) partes.push(slugCohorte(meta.cohorte ?? ''));
  return partes.join(':');
}

const PEOR: Record<Estado, number> = { completo: 0, sin_resultados: 1, parcial: 2, ilegible: 3 };

/** Une el estado de una sección leída por tramos: vacía si ningún tramo la tiene, parcial si alguno lo es. */
function unirEstado(estados: (Estado | null)[]): Estado {
  const con = estados.filter((e): e is Estado => e !== null && e !== 'sin_resultados');
  if (con.length === 0) return 'sin_resultados';
  return con.reduce((a, b) => (PEOR[b] > PEOR[a] ? b : a));
}

/**
 * Une la pasada de clasificación con las pasadas de asaltos. Cada prueba de un
 * tramo se asigna a la prueba de la clasificación con la misma firma (con
 * cohorte, luego sin ella, luego la única que haya); si no casa, entra como
 * prueba propia sin clasificación.
 */
export function fusionarTramos(resultados: unknown, trozos: unknown[]): unknown {
  const base = (resultados ?? {}) as { documentTitle?: unknown; competitions?: unknown };
  const pruebas = (arr(base.competitions) as PruebaCruda[]).map((p) => ({
    ...p,
    pools: [] as { pool?: unknown; fencers?: unknown; bouts?: unknown }[],
    tableau: [] as AsaltoCrudo[],
    _pools: [] as (Estado | null)[],
    _tableau: [] as (Estado | null)[],
  }));
  type Destino = (typeof pruebas)[number];
  const buscar = (p: PruebaCruda): Destino | null => {
    for (const conCohorte of [true, false]) {
      const f = firmaPrueba(p, conCohorte);
      const c = pruebas.filter((d) => firmaPrueba(d, conCohorte) === f);
      if (c.length === 1) return c[0];
    }
    return pruebas.length === 1 ? pruebas[0] : null;
  };
  for (const trozo of trozos) {
    for (const p of arr((trozo as { competitions?: unknown } | null)?.competitions) as PruebaCruda[]) {
      const poolsT = arr(p.pools) as { pool?: unknown; fencers?: unknown; bouts?: unknown }[];
      const tabT = arr(p.tableau) as AsaltoCrudo[];
      let d = buscar(p);
      if (!d) {
        if (poolsT.length === 0 && tabT.length === 0) continue;
        d = { ...p, results: [], status: { results: 'sin_resultados' }, pools: [], tableau: [], _pools: [], _tableau: [] };
        pruebas.push(d);
      }
      d._pools.push(estadoDe(p.status?.pools));
      d._tableau.push(estadoDe(p.status?.tableau));
      for (const pool of poolsT) {
        // Una poule partida entre dos tramos se une por su número.
        const existente = d.pools.find((x) => int(x.pool) !== null && int(x.pool) === int(pool.pool));
        if (!existente) {
          d.pools.push({ pool: pool.pool, fencers: [...arr(pool.fencers)], bouts: [...arr(pool.bouts)] });
          continue;
        }
        const fencers = arr(existente.fencers);
        for (const f of arr(pool.fencers)) if (!fencers.includes(f)) fencers.push(f);
        existente.fencers = fencers;
        existente.bouts = [...arr(existente.bouts), ...arr(pool.bouts)];
      }
      for (const a of tabT) {
        const repetido = d.tableau.some((x) =>
          str(x.round) === str(a.round) && x.scoreA === a.scoreA && x.scoreB === a.scoreB
          && str(x.aName) === str(a.aName) && str(x.bName) === str(a.bName));
        if (!repetido) d.tableau.push(a);
      }
    }
  }
  return {
    documentTitle: base.documentTitle ?? null,
    competitions: pruebas.map(({ _pools, _tableau, ...p }) => {
      // Una poule que aparece en dos tramos repite asaltos: se quedan una vez por pareja.
      const pools = p.pools.map((pool) => {
        const vistos = new Set<string>();
        const bouts = (arr(pool.bouts) as AsaltoCrudo[]).filter((b) => {
          const k = [compacto(str(b.aName) ?? ''), compacto(str(b.bName) ?? '')].sort().join('|');
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        });
        return { ...pool, bouts };
      });
      return {
        ...p,
        pools,
        status: { ...(p.status ?? {}), pools: unirEstado(_pools), tableau: unirEstado(_tableau) },
      };
    }),
  };
}

// ---------------------------------------------------------------- ejecución

const TEMP = process.env.TEMP ?? join(homedir(), 'AppData', 'Local', 'Temp');
const TRABAJO = join(TEMP, 'calendario-trabajo');
const RUTAS = {
  calidad: join(TRABAJO, 'hechos', 'pdf-calidad.json'),
  salida: join(TRABAJO, 'hechos', 'pdf-droid'),
  crudo: join(TRABAJO, 'pdf-droid-raw'),
  estado: join(TRABAJO, 'pdf-droid-raw', '_estado'),
  trabajo: join(TRABAJO, 'pdf-droid-work'),
  base: join(TRABAJO, 'base.sqlite'),
  inventario: join(TEMP, 'qa-prod-calendario', 'history-national', 'national-inventory.json'),
  droid: join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'droid', 'bin', 'droid'),
  prompt: join(dirname(fileURLToPath(import.meta.url)), 'pdf-droid-prompt.md'),
};

type EntradaCalidad = {
  pdfId: string; url: string; sha256: string; blobPath: string; season?: string | null;
  docId?: string | null; needsDroid: boolean; reason?: string;
  /** Lo que ya lee el lector local de este PDF. */
  pages?: number | null; results?: number | null; bouts?: number | null;
};

type EstadoPdf = {
  pdfId: string; url: string; urls: string[]; sha256: string; hecho: boolean; modelo: string | null;
  clavesEnProduccion: number; resultadosEscritos: number; asaltosEscritos: number;
  /** `completo` (una llamada) o `tramos` (clasificación + asaltos por páginas). */
  modo: string | null;
  intentos: { modelo: string; ok: boolean; motivo: string | null; segundos: number; puntuacion: number | null }[];
  ficheros: string[];
  propuestas: { results: number; bouts: number };
  aceptadas: { results: number; bouts: number };
  descartes: Descartes;
  estados: { results: Record<string, number>; pools: Record<string, number>; tableau: Record<string, number> };
  problemas: string[];
  sinTexto: boolean;
  error: string | null;
  segundos: number;
  terminadoEn: string;
};

function argumentos() {
  const a = process.argv.slice(2);
  const valor = (n: string) => {
    const i = a.indexOf(n);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    limite: valor('--limite') ? Number(valor('--limite')) : Infinity,
    solo: valor('--solo')?.split(',').filter(Boolean) ?? null,
    concurrencia: Number(valor('--concurrencia') ?? 8),
    modelo: valor('--modelo') ?? 'gpt-6-luna',
    modeloFuerte: valor('--modelo-fuerte') ?? 'gpt-6-sol',
    timeoutMs: Number(valor('--timeout') ?? 300) * 1000,
    timeoutFuerteMs: Number(valor('--timeout-fuerte') ?? 600) * 1000,
    reintentarFallos: a.includes('--reintentar-fallos'),
    /** Vuelve a validar las respuestas crudas guardadas, sin lanzar droids. */
    revalidar: a.includes('--revalidar'),
  };
}

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

async function escribirAtomico(ruta: string, contenido: string) {
  const tmp = `${ruta}.${process.pid}.tmp`;
  await writeFile(tmp, contenido, 'utf8');
  // En Windows un lector (antivirus, el cargador) bloquea el destino unos milisegundos: EPERM/EBUSY pasajeros.
  for (let i = 1; ; i += 1) {
    try {
      await rename(tmp, ruta);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
}

async function esperarCalidad(): Promise<EntradaCalidad[]> {
  for (;;) {
    if (existsSync(RUTAS.calidad)) {
      try {
        const j = JSON.parse(await readFile(RUTAS.calidad, 'utf8')) as EntradaCalidad[];
        if (Array.isArray(j)) return j;
      } catch {
        // Puede estar a medio escribir.
      }
    }
    log('esperando pdf-calidad.json');
    await new Promise((r) => setTimeout(r, 180_000));
  }
}

type Metadatos = {
  edicionPorDoc: Map<string, { name: string; season: string; start: string | null; end: string | null }>;
  docPorUrl: Map<string, string>;
  tituloPorUrl: Map<string, { titulo: string | null; season: string }>;
  clavesProd: Set<string>;
};

async function cargarMetadatos(): Promise<Metadatos> {
  const edicionPorDoc: Metadatos['edicionPorDoc'] = new Map();
  const docPorUrl = new Map<string, string>();
  const clavesProd = new Set<string>();
  if (existsSync(RUTAS.base)) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(RUTAS.base, { readOnly: true });
    const eds = db.prepare(`select tournament_key, name, season, start_date, end_date, source_url from sport_edition where source = 'rfee_pdf'`).all() as {
      tournament_key: string; name: string; season: string; start_date: string | null; end_date: string | null; source_url: string | null;
    }[];
    for (const e of eds) {
      const doc = e.tournament_key.replace(/^pdf:/, '');
      edicionPorDoc.set(doc, { name: e.name, season: e.season, start: e.start_date, end: e.end_date });
      if (e.source_url) docPorUrl.set(e.source_url.split('#')[0], doc);
    }
    for (const c of db.prepare(`select competition_key from sport_competition where source = 'rfee_pdf'`).all() as { competition_key: string }[]) {
      clavesProd.add(c.competition_key);
    }
    db.close();
  }
  const tituloPorUrl: Metadatos['tituloPorUrl'] = new Map();
  if (existsSync(RUTAS.inventario)) {
    const inv = JSON.parse(await readFile(RUTAS.inventario, 'utf8')) as {
      readingUnits?: { sourceUrl: string; season: string; datos?: { titulo?: string | null } }[];
    };
    for (const u of inv.readingUnits ?? []) {
      if (!tituloPorUrl.has(u.sourceUrl)) tituloPorUrl.set(u.sourceUrl, { titulo: u.datos?.titulo ?? null, season: u.season });
    }
  }
  return { edicionPorDoc, docPorUrl, tituloPorUrl, clavesProd };
}

async function textoPdf(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await extractText(doc, { mergePages: false });
    return text;
  } finally {
    await doc.loadingTask.destroy();
  }
}

function matarArbol(pid: number) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

async function lanzarDroid(modelo: string, carpeta: string, promptPath: string, timeoutMs: number) {
  return await new Promise<{ ok: boolean; stdout: string; stderr: string; motivo: string | null }>((resolve) => {
    const hijo = spawn(process.execPath, [
      RUTAS.droid, 'exec', '-m', modelo, '--cwd', carpeta, '--only-tools', 'Read', '-o', 'json', '-f', promptPath,
    ], { cwd: carpeta, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let vencido = false;
    hijo.stdout.on('data', (d) => (stdout += d));
    hijo.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => {
      vencido = true;
      if (hijo.pid) matarArbol(hijo.pid);
    }, timeoutMs);
    hijo.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${e.message}`, motivo: 'spawn_error' });
    });
    hijo.on('close', (code) => {
      clearTimeout(t);
      resolve({ ok: !vencido && code === 0, stdout, stderr, motivo: vencido ? 'timeout' : code === 0 ? null : `exit_${code}` });
    });
  });
}

let permisosDroid = 8;
const enEspera: (() => void)[] = [];

/** Limita los droids vivos (cada uno ocupa ~800 MB) y no lanza otro si la máquina va justa de memoria. */
async function semaforo<T>(f: () => Promise<T>): Promise<T> {
  if (permisosDroid > 0) permisosDroid -= 1;
  else await new Promise<void>((r) => enEspera.push(r));
  try {
    while (freemem() < 2.5 * 1024 ** 3) await new Promise((r) => setTimeout(r, 15_000));
    return await f();
  } finally {
    const siguiente = enEspera.shift();
    if (siguiente) siguiente();
    else permisosDroid += 1;
  }
}

const contar = (lista: string[]) => lista.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

/**
 * Un droid por contenido (SHA-256). El mismo PDF publicado en varias URL produce
 * los hechos de cada URL con sus propias claves, igual que el lector local.
 */
async function procesarPdf(grupo: EntradaCalidad[], meta: Metadatos, opt: ReturnType<typeof argumentos>, previo: EstadoPdf | null): Promise<EstadoPdf> {
  const inicio = Date.now();
  const e = grupo[0];
  const contextos = grupo.map((x) => {
    const docId = x.docId ?? meta.docPorUrl.get(x.url) ?? docIdDeUrl(x.url);
    const ed = meta.edicionPorDoc.get(docId);
    const inv = meta.tituloPorUrl.get(x.url);
    return {
      url: x.url, sha256: x.sha256, docId, season: x.season ?? ed?.season ?? inv?.season ?? null,
      editionName: ed?.name ?? inv?.titulo ?? null, editionStart: ed?.start ?? null, editionEnd: ed?.end ?? null,
    };
  });
  const estado: EstadoPdf = {
    pdfId: e.pdfId, url: e.url, urls: grupo.map((x) => x.url), sha256: e.sha256, hecho: false, modelo: null, intentos: [], ficheros: [],
    propuestas: { results: 0, bouts: 0 }, aceptadas: { results: 0, bouts: 0 }, descartes: {},
    estados: { results: {}, pools: {}, tableau: {} }, problemas: [], sinTexto: false, error: null, segundos: 0,
    terminadoEn: '', clavesEnProduccion: 0, resultadosEscritos: 0, asaltosEscritos: 0, modo: null,
  };
  const carpeta = join(RUTAS.trabajo, e.sha256);
  try {
    if (contextos.some((c) => !c.season)) throw new Error('sin_temporada');
    const bytes = new Uint8Array(await readFile(e.blobPath));
    if (createHash('sha256').update(bytes).digest('hex') !== e.sha256) throw new Error('sha256_no_coincide');
    const paginas = await textoPdf(bytes);
    const pdf = join(carpeta, 'documento.pdf');
    const plantilla = (await readFile(RUTAS.prompt, 'utf8'))
      .replaceAll('{{PDF_PATH}}', pdf).replaceAll('{{PAGES}}', String(paginas.length));
    let preparado = false;
    const preparar = async () => {
      if (preparado) return;
      await mkdir(carpeta, { recursive: true });
      // Se escriben los bytes ya verificados: copyFile sobre la caché compartida da EBUSY en Windows.
      await writeFile(pdf, bytes);
      preparado = true;
    };
    const validar = (crudo: unknown, modelo: string, c: (typeof contextos)[number]) =>
      validarExtraccion(crudo, { ...c, season: c.season as string, paginas, extractor: `droid:${modelo}` });

    /** Una llamada (con un reintento) para un alcance; devuelve el JSON del modelo o null. */
    const pedir = async (modelo: string, etiqueta: string, alcance: string): Promise<unknown | null> => {
      for (let intento = 1; intento <= 2; intento += 1) {
        const nombreCrudo = join(RUTAS.crudo, `${e.sha256}__${modelo}__${etiqueta ? `${etiqueta}__` : ''}${intento}`);
        const t0 = Date.now();
        let stdout: string;
        let motivo: string | null = null;
        if (opt.revalidar) {
          if (!existsSync(`${nombreCrudo}.json`)) return null;
          stdout = await readFile(`${nombreCrudo}.json`, 'utf8');
        } else {
          await preparar();
          const promptPath = join(carpeta, `prompt-${modelo}-${etiqueta || 'todo'}.md`);
          await writeFile(promptPath, plantilla.replaceAll('{{ALCANCE}}', alcance), 'utf8');
          const r = await semaforo(() =>
            lanzarDroid(modelo, carpeta, promptPath, modelo === opt.modelo ? opt.timeoutMs : opt.timeoutFuerteMs));
          stdout = r.stdout;
          motivo = r.ok ? null : r.motivo;
          await writeFile(`${nombreCrudo}.json`, r.stdout, 'utf8');
          if (r.stderr.trim()) await writeFile(`${nombreCrudo}.err.txt`, r.stderr, 'utf8');
        }
        const segundos = Math.round((Date.now() - t0) / 1000);
        let crudo: unknown | null = null;
        if (motivo === null) {
          try {
            const sobre = JSON.parse(stdout) as { is_error?: boolean; result?: string };
            if (sobre.is_error || typeof sobre.result !== 'string') motivo = 'droid_is_error';
            else crudo = extraerJson(sobre.result);
          } catch (err) {
            motivo = `json_invalido:${(err as Error).message.slice(0, 60)}`;
          }
        }
        estado.intentos.push({ modelo: etiqueta ? `${modelo}:${etiqueta}` : modelo, ok: crudo !== null, motivo, segundos, puntuacion: null });
        if (crudo !== null) return crudo;
      }
      return null;
    };

    type Candidato = { crudo: unknown; v: ResultadoValidacion; modelo: string; modo: string };
    const completo = async (modelo: string): Promise<Candidato | null> => {
      const crudo = await pedir(modelo, '', '');
      return crudo === null ? null : { crudo, v: validar(crudo, modelo, contextos[0]), modelo, modo: 'completo' };
    };
    const troceado = async (modelo: string): Promise<Candidato | null> => {
      const partes = tramos(paginas.length);
      const [res, ...trozos] = await Promise.all([
        pedir(modelo, 'res', ALCANCE_RESULTADOS),
        ...partes.map(([a, b]) => pedir(modelo, `p${a}-${b}`, alcanceAsaltos(a, b))),
      ]);
      if (res === null) return null;
      if (trozos.some((t) => t === null)) estado.problemas.push(`tramos_sin_respuesta:${trozos.filter((t) => t === null).length}`);
      const crudo = fusionarTramos(res, trozos.filter((t) => t !== null));
      return { crudo, v: validar(crudo, modelo, contextos[0]), modelo, modo: 'tramos' };
    };
    const mejor = (a: Candidato | null, b: Candidato | null) => (!a ? b : !b ? a : puntuar(b.v) >= puntuar(a.v) ? b : a);
    const local = { results: e.results, bouts: e.bouts };

    let elegido: Candidato | null;
    if (paginas.length > PAGINAS_POR_TRAMO) {
      elegido = await troceado(opt.modelo);
      if (necesitaEscalar(elegido?.v ?? null, local) && opt.modeloFuerte !== opt.modelo) {
        elegido = mejor(elegido, await troceado(opt.modeloFuerte));
      }
    } else {
      elegido = await completo(opt.modelo);
      if (necesitaEscalar(elegido?.v ?? null, local) && opt.modeloFuerte !== opt.modelo) {
        elegido = mejor(elegido, await completo(opt.modeloFuerte));
      }
    }
    if (!elegido) throw new Error(estado.intentos.at(-1)?.motivo ?? 'sin_respuesta_valida');
    estado.modo = elegido.modo;

    // Una revalidación puede cambiar claves: los ficheros anteriores de este PDF se retiran antes de escribir.
    for (const f of previo?.ficheros ?? []) await rm(join(RUTAS.salida, f), { force: true });
    const { v, modelo } = elegido;
    for (const c of contextos) {
      const vc = c === contextos[0] && modelo === elegido.modelo ? v : validar(elegido.crudo, modelo, c);
      for (const h of vc.hechos) {
        const nombre = ficheroHechos(h);
        // Doble comprobación: nada sin validar llega a la carpeta de hechos.
        hechosPrueba.parse(h);
        await escribirAtomico(join(RUTAS.salida, nombre), `${JSON.stringify(h, null, 2)}\n`);
        estado.ficheros.push(nombre);
        estado.resultadosEscritos += h.results.length;
        estado.asaltosEscritos += h.bouts.length;
        if (meta.clavesProd.has(h.competition.competitionKey)) estado.clavesEnProduccion += 1;
      }
    }
    Object.assign(estado, {
      hecho: true, modelo, propuestas: v.propuestas, aceptadas: v.aceptadas, descartes: v.descartes,
      problemas: v.problemas, sinTexto: v.sinTexto,
      estados: {
        results: contar(v.hechos.map((h) => h.status.results)),
        pools: contar(v.hechos.map((h) => h.status.pools)),
        tableau: contar(v.hechos.map((h) => h.status.tableau)),
      },
    });
  } catch (err) {
    estado.error = (err as Error).message.slice(0, 200);
    if (previo?.hecho) return previo;
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
  estado.segundos = Math.round((Date.now() - inicio) / 1000) + (opt.revalidar ? previo?.segundos ?? 0 : 0);
  estado.terminadoEn = new Date().toISOString();
  await escribirAtomico(join(RUTAS.estado, `${e.sha256}.json`), JSON.stringify(estado, null, 2));
  return estado;
}

async function leerEstados(): Promise<EstadoPdf[]> {
  const out: EstadoPdf[] = [];
  for (const f of await readdir(RUTAS.estado)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await readFile(join(RUTAS.estado, f), 'utf8')) as EstadoPdf);
    } catch {
      // Fichero a medio escribir: se ignora en este informe.
    }
  }
  return out;
}

async function escribirInforme(seleccion: { pdfs: number; urls: number }, inicio: number) {
  const estados = await leerEstados();
  const sumar = (sel: (e: EstadoPdf) => Record<string, number>) =>
    estados.reduce<Record<string, number>>((m, e) => {
      for (const [k, n] of Object.entries(sel(e))) m[k] = (m[k] ?? 0) + n;
      return m;
    }, {});
  const hechos = estados.filter((e) => e.hecho);
  const propuestas = hechos.reduce((m, e) => ({ results: m.results + e.propuestas.results, bouts: m.bouts + e.propuestas.bouts }), { results: 0, bouts: 0 });
  const aceptadas = hechos.reduce((m, e) => ({ results: m.results + e.aceptadas.results, bouts: m.bouts + e.aceptadas.bouts }), { results: 0, bouts: 0 });
  const informe = {
    generadoEn: new Date().toISOString(),
    segundosEstaEjecucion: Math.round((Date.now() - inicio) / 1000),
    seleccion,
    pdfsProcesados: hechos.length,
    urlsProcesadas: hechos.reduce((n, e) => n + (e.urls?.length ?? 1), 0),
    pdfsFallidos: estados.filter((e) => !e.hecho).length,
    pdfsSinTexto: hechos.filter((e) => e.sinTexto).length,
    /** Pruebas distintas por contenido y ficheros escritos (uno por prueba y URL). */
    competicionesPorContenido: hechos.reduce((n, e) => n + Object.values(e.estados.results).reduce((a, b) => a + b, 0), 0),
    ficherosEscritos: hechos.reduce((n, e) => n + e.ficheros.length, 0),
    resultadosEscritos: hechos.reduce((n, e) => n + (e.resultadosEscritos ?? 0), 0),
    asaltosEscritos: hechos.reduce((n, e) => n + (e.asaltosEscritos ?? 0), 0),
    clavesCoincidentesConProduccion: hechos.reduce((n, e) => n + (e.clavesEnProduccion ?? 0), 0),
    /** Filas por contenido (sin multiplicar por URL): propuestas por el modelo y aceptadas por la validación. */
    propuestas,
    aceptadas,
    tasaDescarte: {
      results: propuestas.results ? +(1 - aceptadas.results / propuestas.results).toFixed(4) : 0,
      bouts: propuestas.bouts ? +(1 - aceptadas.bouts / propuestas.bouts).toFixed(4) : 0,
    },
    porModelo: contar(hechos.map((e) => e.modelo ?? '?')),
    porModo: contar(hechos.map((e) => e.modo ?? 'completo')),
    intentosPorModelo: contar(estados.flatMap((e) => e.intentos.map((i) => `${i.modelo}:${i.ok ? 'ok' : i.motivo ?? 'fallo'}`))),
    estados: { results: sumar((e) => e.estados.results), pools: sumar((e) => e.estados.pools), tableau: sumar((e) => e.estados.tableau) },
    descartes: sumar((e) => e.descartes),
    segundosDroidTotales: estados.reduce((n, e) => n + e.segundos, 0),
    fallos: estados.filter((e) => !e.hecho).map((e) => ({ pdfId: e.pdfId, url: e.url, sha256: e.sha256, error: e.error, intentos: e.intentos })),
    pdfsSinCompeticiones: hechos.filter((e) => e.ficheros.length === 0).map((e) => ({ pdfId: e.pdfId, url: e.url, problemas: e.problemas })),
  };
  await escribirAtomico(join(RUTAS.salida, '_informe.json'), `${JSON.stringify(informe, null, 2)}\n`);
  return informe;
}

async function main() {
  const opt = argumentos();
  const inicio = Date.now();
  for (const d of [RUTAS.salida, RUTAS.crudo, RUTAS.estado, RUTAS.trabajo]) await mkdir(d, { recursive: true });
  if (!existsSync(RUTAS.droid)) throw new Error(`No encuentro droid en ${RUTAS.droid}`);

  const calidad = await esperarCalidad();
  const meta = await cargarMetadatos();
  const previos = new Map((await leerEstados()).map((e) => [e.sha256, e]));
  const grupos = new Map<string, EntradaCalidad[]>();
  for (const e of calidad) {
    if (!e.needsDroid || (opt.solo && !opt.solo.includes(e.sha256))) continue;
    const g = grupos.get(e.sha256) ?? [];
    if (!g.some((x) => x.url === e.url)) g.push(e);
    grupos.set(e.sha256, g);
  }
  const saltar = (sha: string) => {
    const p = previos.get(sha);
    if (opt.revalidar) return !p;
    return p !== undefined && (p.hecho || !opt.reintentarFallos);
  };
  const pendientes = [...grupos.values()]
    .filter((g) => !saltar(g[0].sha256) && existsSync(g[0].blobPath))
    .slice(0, opt.limite);
  const seleccion = { pdfs: grupos.size, urls: [...grupos.values()].reduce((n, g) => n + g.length, 0) };
  log(`seleccionados=${seleccion.pdfs} urls=${seleccion.urls} pendientes=${pendientes.length} concurrencia=${opt.concurrencia} modelo=${opt.modelo} fuerte=${opt.modeloFuerte}${opt.revalidar ? ' revalidar' : ''}`);

  let siguiente = 0;
  let terminados = 0;
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= pendientes.length) return;
      // Cada droid ocupa ~800 MB: no se lanza otro si la máquina va justa.
      const g = pendientes[i];
      const r = await procesarPdf(g, meta, opt, previos.get(g[0].sha256) ?? null);
      terminados += 1;
      log(`[${terminados}/${pendientes.length}] ${g[0].sha256.slice(0, 12)} ${r.hecho ? 'ok' : `fallo:${r.error}`} modelo=${r.modelo ?? '-'} urls=${g.length} ficheros=${r.ficheros.length} res=${r.aceptadas.results}/${r.propuestas.results} asaltos=${r.aceptadas.bouts}/${r.propuestas.bouts} ${r.segundos}s`);
      if (terminados % 10 === 0) await escribirInforme(seleccion, inicio);
    }
  };
  permisosDroid = Math.max(1, opt.concurrencia);
  await Promise.all(Array.from({ length: Math.max(1, opt.concurrencia) }, trabajador));
  const informe = await escribirInforme(seleccion, inicio);
  log(`fin procesados=${informe.pdfsProcesados} fallidos=${informe.pdfsFallidos} ficheros=${informe.ficherosEscritos} resultados=${informe.resultadosEscritos} asaltos=${informe.asaltosEscritos}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
