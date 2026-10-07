/**
 * Validación en código de una extracción de un PDF RFEE hecha por un modelo de lenguaje
 * (droids del lote manual o Workers AI en la ingesta automática). Las claves se calculan
 * aquí a partir de la URL y de la cabecera: el modelo nunca decide una clave, y cada
 * nombre tiene que estar en el texto del propio PDF. Sin red ni disco.
 */
import { createHash } from 'node:crypto';
import {
  ARMAS, CATEGORIAS, FORMATOS, GENEROS, hechosPrueba,
  type AsaltoHecho, type HechosPrueba, type ResultadoHecho,
} from './formato';
import { metadatosDeCabecera } from '../sources/rfee-pdf/cabecera';
import { normalizar } from '../sources/rfee-pdf/geometria';
import { consistenciaCuadro } from './cuadro-consistencia';
import type { PruebaFecha } from './fechas-catalogo';
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

export type Estado = 'completo' | 'parcial' | 'sin_resultados' | 'ilegible';
export const ESTADOS: readonly Estado[] = ['completo', 'parcial', 'sin_resultados', 'ilegible'];

export type AsaltoCrudo = { aName?: unknown; bName?: unknown; scoreA?: unknown; scoreB?: unknown; winner?: unknown; round?: unknown };
export type PruebaCruda = {
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

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
export const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const enumDe = <T extends string>(v: unknown, valores: readonly T[]): T | null => {
  const s = str(v)?.toUpperCase();
  return (valores as readonly string[]).includes(s ?? '') ? (s as T) : null;
};
export const estadoDe = (v: unknown): Estado | null => {
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
  /** Fecha de la prueba en el catálogo nacional, para cuando ni el modelo ni la cabecera la dan. */
  fechaCatalogo?: (p: PruebaFecha) => string | null;
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

const contar = (lista: string[]) => lista.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

const sumarDescarte = (d: Descartes, motivo: string, n = 1) => {
  d[motivo] = (d[motivo] ?? 0) + n;
};

const RE_RONDA = /^T(\d+)(?:-(\d+))?$/;
const esPotenciaDeDos = (n: number) => n >= 2 && n <= 1024 && (n & (n - 1)) === 0;

/** Texto mínimo (letras y cifras) para considerar que el PDF tiene capa de texto. */
const MIN_TEXTO = 80;

/**
 * Los criterium de menores (M11, M13) publican, en vez de clasificación, una lista de
 * «GANADORAS/GANADORES» (quienes ganan su asalto de T8) y otra de «FINALISTAS», sin puestos.
 * El modelo numera esas listas (1, 2, 3, 3...) y el puesto es inventado. Devuelve el texto
 * compactado de cada lista, cortado en el fin de página, o `null` si el documento no las trae.
 */
export function listasGanadores(paginas: readonly string[]): { ganadores: string; finalistas: string } | null {
  let ganadores = '';
  let finalistas = '';
  for (const p of paginas) {
    const marcas = [...p.matchAll(/\b(GANADOR(?:A|E)S|FINALISTAS)\b/gi)];
    marcas.forEach((m, i) => {
      const trozo = compacto(p.slice(m.index! + m[0].length, marcas[i + 1]?.index ?? p.length));
      if (/^GANADOR/i.test(m[1])) ganadores += `|${trozo}`;
      else finalistas += `|${trozo}`;
    });
  }
  return ganadores && finalistas ? { ganadores, finalistas } : null;
}

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

  const listas = listasGanadores(ctx.paginas);
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
    const fecha = (fechaModelo && /^\d{4}-\d{2}-\d{2}$/.test(fechaModelo) ? fechaModelo : meta.fecha) ??
      ctx.fechaCatalogo?.({ weapon, gender, category, format }) ?? null;
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
    let etiquetadasAntes = 0;
    let numeradasAntes = 0;
    let primeraNumerica: number | null = null;
    let sinPuesto = 0;
    let puestosDeLista = 0;
    for (const [iFila, f] of filas.entries()) {
      const nombre = str(f?.name);
      const cn = nombre ? compacto(nombre) : '';
      const enLista = !listas || !individual || cn.length < 6 ? null
        : listas.ganadores.includes(cn) ? 'Ganador' : listas.finalistas.includes(cn) ? 'Finalista' : null;
      const posicion = enLista || f?.position === null || f?.position === undefined ? null : int(f.position);
      // El índice cuenta las filas impresas, no las aceptadas: una fila descartada no debe desplazar las siguientes.
      const filaNumerica = iFila + 1;
      const motivo =
        !nombre ? 'resultado_sin_nombre'
          : !enPdf(nombre) ? 'resultado_nombre_no_en_pdf'
          : !enLista && f?.position !== null && f?.position !== undefined && (posicion === null || posicion < 1) ? 'resultado_posicion_invalida'
          : posicion !== null && posicion < previo ? 'resultado_posicion_no_monotona'
          : individual && repetidos.has(compacto(nombre)) ? 'resultado_duplicado'
          : null;
      if (motivo) {
        sumarDescarte(descartes, motivo);
        descResultados += 1;
        continue;
      }
      if (posicion !== null) {
        // Tras filas con etiqueta sin número («CAMPEONA», «FINALISTA») el cuadro de puestos lo fija
        // la propia fuente (puede haber 5 finalistas y luego el 9): se mide la contigüidad sólo entre
        // las filas numeradas, a partir de la primera.
        const esperada: number = etiquetadasAntes > 0 ? (primeraNumerica ?? posicion) + numeradasAntes : filaNumerica;
        if (posicion !== previo && posicion !== esperada) anomalias += 1;
        primeraNumerica ??= posicion;
        numeradasAntes += 1;
        previo = posicion;
      } else if (str(f?.positionRaw) && !/\d/.test(str(f?.positionRaw) ?? '')) {
        etiquetadasAntes += 1;
      }
      if (enLista) {
        puestosDeLista += 1;
        sumarDescarte(descartes, 'resultado_puesto_de_lista_anulado');
      } else if (posicion === null && !str(f?.positionRaw)) sinPuesto += 1;
      const club = str(f?.club);
      const pais = str(f?.country)?.toUpperCase() ?? null;
      if (club && !enPdf(club)) sumarDescarte(descartes, 'club_no_en_pdf_anulado');
      aceptadosRes.push({
        name: nombre as string,
        countryCode: pais && /^[A-Z]{3}$/.test(pais) ? pais : null,
        club: club && enPdf(club) ? club : null,
        position: posicion,
        positionRaw: enLista ?? str(f?.positionRaw) ?? (posicion === null ? null : String(posicion)),
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
    if (puestosDeLista > 0) notas.push(`puestos_no_publicados_lista_ganadores_finalistas:${puestosDeLista}`);

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
    // Un cuadro individual incoherente (pareja que se cruza dos veces, perdedor que sigue) tiene
    // al menos un asalto mal leído y no se sabe cuál: se descartan todos los implicados. Los de
    // equipos se quedan fuera: suelen tirar los puestos y el perdedor sigue legítimamente.
    const enCuadro = individual ? bouts.filter((b) => b.phase === 'TABLEAU') : [];
    const coherencia = consistenciaCuadro(enCuadro);
    if (coherencia.incoherentes.size > 0) {
      const fuera = new Set([...coherencia.incoherentes].map((i) => enCuadro[i]));
      for (let i = bouts.length - 1; i >= 0; i -= 1) if (fuera.has(bouts[i])) bouts.splice(i, 1);
      for (const [motivo, n] of Object.entries(coherencia.motivos)) sumarDescarte(descartes, `cuadro_${motivo}`, n);
      descCuadro += fuera.size;
      boutsCuadro -= fuera.size;
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
