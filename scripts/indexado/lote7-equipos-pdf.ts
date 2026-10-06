/**
 * Clasificación y encuentros de las pruebas por equipos rfee_pdf que están
 * incompletas, leídos con droids sobre el PDF ya descargado.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-pdf.ts \
 *     [--db <nuevo7.sqlite>] [--salida <hechos/lote7-equipos>] [--plan] [--limite N] [--solo sha,sha]
 *     [--concurrencia 4] [--modelo gpt-6-luna] [--modelo-fuerte gpt-6-sol] [--timeout 420]
 *     [--reintentar-fallos] [--revalidar]
 *
 * 1. Objetivos: cada prueba EQUIPOS rfee_pdf de la copia, agrupada por documento (URL sin
 *    `#page`). El PDF sale de la caché del backfill (`hechos/pdf-calidad.json`) o de la de
 *    `rfee-huecos`; nada se descarga.
 * 2. Del texto del PDF (unpdf) se ve qué publica: clasificación final, poules, cuadro con
 *    marcadores. Sólo va al droid el documento que publica algo que a alguna de sus pruebas
 *    le falta (`--plan` escribe esa decisión sin lanzar nada).
 * 3. `droid exec` (sólo Read, sin red) con `pdf-equipos-prompt.md`. La respuesta se valida en
 *    código contra el texto del PDF: nombres impresos, marcadores a 45 como máximo, el
 *    marcador «45/38» del cuadro impreso, cada fila de poule cuadra con los tocados dados y
 *    recibidos (o el índice) que imprime el documento, cuadro coherente con el podio.
 * 4. Las pruebas del modelo se asignan a las guardadas por arma, género y orden de aparición
 *    (`~n`); las claves salen de la base. Una prueba que no se puede asignar sin ambigüedad
 *    no se escribe y queda en el informe.
 *
 * Al cargar: la clasificación sólo se envía si la guardada falta o es parcial y la nueva es
 * completa y más larga; las poules y el cuadro siguen las reglas rfee_pdf de `cargar-hechos`.
 * Cuando se escribe la prueba raíz de un documento con partes `~n`, las partes que no se
 * escriben llevan un fichero vacío (`lote7_equipos_vacio`) para que el cargador no las absorba.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { freemem, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AsaltoHecho, HechosPrueba, ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { metadatosDeCabecera } from '../../src/lib/ingest/sources/rfee-pdf/cabecera';
import { argumento, CARPETA_TRABAJO } from './comun';
import {
  CACHE_EQUIPOS, clasificacionGuardada, escribirHechos, hechosDePrueba, incoherentesCuadroEquipos, motivoEncuentro, NUEVO7, pruebasEquipos,
  raizClave, SALIDA_EQUIPOS, tercerPuestoComoRonda, type PruebaEquipos,
} from './lote7-equipos-comun';
import { claveNombre, compacto, extraerJson } from './pdf-droids';

type Estado = HechosPrueba['status']['results'];
const ESTADOS: readonly Estado[] = ['completo', 'parcial', 'sin_resultados', 'ilegible'];

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const estadoDe = (v: unknown): Estado | null => {
  const s = str(v)?.toLowerCase();
  return (ESTADOS as readonly string[]).includes(s ?? '') ? (s as Estado) : null;
};
const sumar = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);

// ---------------------------------------------------------------- lo que publica el texto

export type Publica = { clasificacion: boolean; poules: boolean; cuadro: boolean; texto: boolean };

const RE_FINAL = /clasificaci[oó]n\s+general\s+final|classement\s+g[ée]n[ée]ral\s+final|final\s+ranking|clasificaci[oó]n\s+final|\bCLASIF\b/i;
const RE_POULE = /poule\s*(?:no|n[º°o.])?\s*\d|poules?,\s*vuelta|EQUIPO\s+CLUB\b|\bV\s*\/\s*M\b/i;
/** «45/38» sin ser parte de una fecha («21/10/2018»). */
const RE_MARCADOR = /(?<![\d/])(?:4[0-5]|[1-3]?\d)\s*\/\s*(?:4[0-5]|[1-3]?\d)(?![\d/])/;
const RE_CUADRO = /tabla\s+de\s+\d|tableau\s+(?:of|de)\s+\d|semi-?final|\bfinal\b|tercer\s+lugar|eliminaci[oó]n\s+directa/i;

/** Texto sin los «página 1/3» de la paginación, que parecen marcadores. */
export const sinPaginacion = (t: string): string => t.replace(/\b(?:p[aá]gina|page|p[aà]g\.?)\s*\d+\s*\/\s*\d+/gi, ' ');

export function quePublica(paginas: readonly string[]): Publica {
  const t = sinPaginacion(paginas.join('\n'));
  return {
    texto: compacto(t).length >= 80,
    clasificacion: RE_FINAL.test(t),
    poules: RE_POULE.test(t),
    cuadro: RE_CUADRO.test(t) && RE_MARCADOR.test(t),
  };
}

/** Lo que le falta a una prueba guardada y el documento parece publicar. */
export function faltas(p: Pick<PruebaEquipos, 'resultados' | 'poules' | 'cuadro' | 'cobertura'>, pub: Publica): string[] {
  const f: string[] = [];
  if (pub.clasificacion && (p.resultados.length === 0 || p.cobertura.results === 'parcial')) f.push('results');
  if (pub.poules && (p.poules === 0 || (p.cobertura.pools !== undefined && p.cobertura.pools !== 'completo'))) f.push('pools');
  if (pub.cuadro && (p.cuadro === 0 || (p.cobertura.tableau !== undefined && p.cobertura.tableau !== 'completo'))) f.push('tableau');
  return f;
}

// ---------------------------------------------------------------- asignación de pruebas

type PruebaCruda = {
  headerLines?: unknown; weapon?: unknown; gender?: unknown; category?: unknown; division?: unknown; date?: unknown;
  publishedTeams?: unknown; finalRankingHeading?: unknown; status?: { results?: unknown; pools?: unknown; tableau?: unknown };
  results?: unknown; pools?: unknown; tableau?: unknown; relayBoutsWithFencerNames?: unknown; notes?: unknown;
};

const numeroParte = (k: string) => Number(/~(\d+)$/.exec(k)?.[1] ?? 1);

/**
 * Prueba guardada de cada prueba del modelo. Por arma y género: si el documento tiene tantas
 * como la base, en orden de aparición (la base numera `~n` en ese orden); si hay una sola en la
 * base y varias en el modelo, la única cuya categoría coincide. Lo demás queda sin asignar.
 */
export function asignar(
  crudas: readonly PruebaCruda[],
  objetivos: readonly Pick<PruebaEquipos, 'competitionKey' | 'weapon' | 'gender' | 'category' | 'resultados' | 'poules' | 'cuadro'>[],
): { asignadas: Map<number, number>; sinAsignar: { indice: number; motivo: string }[] } {
  const atributos = crudas.map((p) => {
    const meta = metadatosDeCabecera(arr(p.headerLines).map(str).filter((l): l is string => l !== null));
    const w = meta.arma ?? (str(p.weapon)?.toUpperCase() ?? null);
    const g = meta.genero ?? (str(p.gender)?.toUpperCase() ?? null);
    return { w, g, formato: meta.formato, cat: str(p.category)?.toUpperCase() ?? null };
  });
  const asignadas = new Map<number, number>();
  const sinAsignar: { indice: number; motivo: string }[] = [];
  const grupos = new Map<string, number[]>();
  atributos.forEach((a, i) => {
    if (a.formato === 'INDIVIDUAL') return sinAsignar.push({ indice: i, motivo: 'cabecera_individual' });
    if (!a.w || !a.g) return sinAsignar.push({ indice: i, motivo: 'sin_arma_o_genero' });
    const k = `${a.w}:${a.g}`;
    grupos.set(k, [...(grupos.get(k) ?? []), i]);
  });
  for (const [k, idx] of grupos) {
    const destinos = objetivos
      .map((o, j) => ({ o, j }))
      .filter(({ o }) => `${o.weapon}:${o.gender}` === k)
      .sort((x, y) => numeroParte(x.o.competitionKey) - numeroParte(y.o.competitionKey) || (x.o.competitionKey < y.o.competitionKey ? -1 : 1));
    if (destinos.length === idx.length) {
      idx.forEach((i, n) => asignadas.set(i, destinos[n].j));
      continue;
    }
    if (destinos.length === 1) {
      const conCategoria = idx.filter((i) => atributos[i].cat === destinos[0].o.category);
      if (conCategoria.length === 1) {
        asignadas.set(conCategoria[0], destinos[0].j);
        for (const i of idx) if (i !== conCategoria[0]) sinAsignar.push({ indice: i, motivo: 'sobra_en_documento' });
        continue;
      }
    }
    // Una sola prueba en el documento y en la base la raíz más partes `~n` vacías (lecturas
    // antiguas que partieron el documento): la prueba es la raíz.
    const vacia = (o: (typeof destinos)[number]['o']) => o.resultados.length === 0 && o.poules === 0 && o.cuadro === 0;
    if (idx.length === 1 && destinos.length > 1 && raizClave(destinos[0].o.competitionKey) === destinos[0].o.competitionKey &&
      destinos.slice(1).every((d) => vacia(d.o) && raizClave(d.o.competitionKey) === destinos[0].o.competitionKey)) {
      asignadas.set(idx[0], destinos[0].j);
      continue;
    }
    for (const i of idx) sinAsignar.push({ indice: i, motivo: destinos.length === 0 ? 'sin_prueba_guardada' : 'asignacion_ambigua' });
  }
  return { asignadas, sinAsignar };
}

// ---------------------------------------------------------------- validación

/** Líneas del texto cuyo comienzo es el nombre del equipo. */
function lineasDeEquipo(lineas: readonly { c: string; numeros: Set<number> }[], nombre: string) {
  const c = compacto(nombre);
  return c.length < 2 ? [] : lineas.filter((l) => l.c.startsWith(c));
}

/**
 * ¿Cuadra la fila impresa del equipo con sus encuentros? Alguna línea que empieza por su nombre
 * trae los tocados dados y, además, los recibidos o el índice (dados - recibidos). `null` si el
 * texto no tiene esa línea.
 */
export function filaCuadra(lineas: readonly { c: string; numeros: Set<number> }[], nombre: string, dados: number, recibidos: number): boolean | null {
  const candidatas = lineasDeEquipo(lineas, nombre);
  if (candidatas.length === 0) return null;
  return candidatas.some((l) => l.numeros.has(dados) && (l.numeros.has(recibidos) || l.numeros.has(dados - recibidos)));
}

export function prepararLineas(paginas: readonly string[]): { c: string; numeros: Set<number> }[] {
  return paginas.flatMap((p) => p.split(/\r?\n/)).map((l) => ({
    c: compacto(l),
    numeros: new Set([...l.matchAll(/(?<![\d.,])-?\d{1,4}(?![\d.,]\d)/g)].map((m) => Number(m[0]))),
  }));
}

export type ContextoEquipos = {
  url: string;
  sha256: string;
  paginas: string[];
  extractor: string;
  objetivos: PruebaEquipos[];
};

export type ValidacionEquipos = {
  hechos: HechosPrueba[];
  sinAsignar: { indice: number; motivo: string; cabecera: string }[];
  descartes: Record<string, number>;
  propuestas: { results: number; bouts: number };
  aceptadas: { results: number; bouts: number };
  relevosConNombres: number;
  sinTexto: boolean;
};

const RE_RONDA = /^T(\d+)(?:-(\d+))?$/;
const potencia = (n: number) => n >= 2 && n <= 256 && (n & (n - 1)) === 0;

export function validarEquipos(crudo: unknown, ctx: ContextoEquipos): ValidacionEquipos {
  const descartes: Record<string, number> = {};
  const propuestas = { results: 0, bouts: 0 };
  const aceptadas = { results: 0, bouts: 0 };
  const textoPlano = sinPaginacion(ctx.paginas.join('\n'));
  const texto = compacto(textoPlano);
  const sinTexto = texto.length < 80;
  const enPdf = (s: string) => {
    const c = compacto(s);
    return c.length >= 2 && texto.includes(c);
  };
  const lineas = prepararLineas(ctx.paginas);
  const raiz = (crudo ?? {}) as { competitions?: unknown };
  const crudas = arr(raiz.competitions) as PruebaCruda[];
  const { asignadas, sinAsignar } = asignar(crudas, ctx.objetivos);
  const hechos: HechosPrueba[] = [];
  let relevosConNombres = 0;

  for (const [ic, io] of asignadas) {
    const p = crudas[ic];
    const o = ctx.objetivos[io];
    const notas: string[] = [];
    if (p.relayBoutsWithFencerNames === true) relevosConNombres += 1;

    // ---- clasificación
    const titulo = str(p.finalRankingHeading);
    // La tabla de liga imprime los equipos por número de sorteo y el puesto en la columna CLASIF.
    const deLiga = /^CLASIF\.?$/i.test(titulo ?? '');
    const filas = (arr(p.results) as Record<string, unknown>[]).map((f, i) => ({ f, i }))
      .sort((x, y) => (deLiga ? (int(x.f?.position) ?? 1e9) - (int(y.f?.position) ?? 1e9) : 0) || x.i - y.i)
      .map((x) => x.f);
    propuestas.results += filas.length;
    const conTitulo = titulo !== null && (enPdf(titulo) || /^CLASIF\.?$/i.test(titulo)) && RE_FINAL.test(textoPlano);
    let descRes = 0;
    const filasOk: Omit<ResultadoHecho, 'factKey'>[] = [];
    if (filas.length > 0 && !conTitulo) {
      sumar(descartes, 'resultado_sin_clasificacion_final', filas.length);
      descRes = filas.length;
      notas.push('El modelo propuso una clasificación que el documento no titula como final');
    } else {
      const vistos = new Set<string>();
      let previo = 0;
      let anomalias = 0;
      filas.forEach((f, i) => {
        const nombre = str(f?.name);
        const pos = f?.position === null || f?.position === undefined ? null : int(f.position);
        const motivo = !nombre ? 'resultado_sin_nombre'
          : !enPdf(nombre) ? 'resultado_nombre_no_en_pdf'
          : f?.position !== null && f?.position !== undefined && (pos === null || pos < 1) ? 'resultado_posicion_invalida'
          : pos !== null && pos < previo ? 'resultado_posicion_no_monotona'
          : vistos.has(compacto(nombre)) ? 'resultado_duplicado'
          : null;
        if (motivo) {
          sumar(descartes, motivo);
          descRes += 1;
          return;
        }
        vistos.add(compacto(nombre!));
        if (pos !== null) {
          if (pos !== previo && pos !== i + 1) anomalias += 1;
          previo = pos;
        }
        filasOk.push({
          name: nombre!, countryCode: null, club: null, position: pos,
          positionRaw: str(f?.positionRaw) ?? (pos === null ? null : String(pos)),
          points: null, fieId: null, license: null, birthYear: null,
        });
      });
      const numericas = filasOk.filter((r) => r.position !== null).length;
      if (numericas > 0 && anomalias / numericas > 0.2) {
        sumar(descartes, 'resultado_posiciones_no_contiguas', filasOk.length);
        descRes += filasOk.length;
        filasOk.length = 0;
      }
    }
    const publicados = int(p.publishedTeams);
    const cuenta = new Map<number, number>();
    for (const r of filasOk) if (r.position !== null) cuenta.set(r.position, (cuenta.get(r.position) ?? 0) + 1);
    const orden = new Map<number, number>();
    const results: ResultadoHecho[] = filasOk.map((r, i) => {
      let suf: string;
      if (r.position === null) suf = `x${i + 1}`;
      else if (cuenta.get(r.position) === 1) suf = String(r.position);
      else {
        const k = (orden.get(r.position) ?? 0) + 1;
        orden.set(r.position, k);
        suf = `${r.position}-${k}`;
      }
      return { factKey: `${o.competitionKey}:pdfd:${suf}`, ...r };
    });
    let estadoRes: Estado = results.length === 0 ? (descRes > 0 ? 'ilegible' : 'sin_resultados')
      : descRes > 0 || estadoDe(p.status?.results) !== 'completo' ? 'parcial' : 'completo';
    if (estadoRes === 'completo' && publicados !== null && results.length < publicados) estadoRes = 'parcial';
    if (deLiga && results.length > 0) notas.push('Clasificación de la columna CLASIF. de la tabla de liga');

    // ¿Se envía la clasificación? Sólo si mejora la guardada sin poder borrarla con menos filas.
    const enviarRes = results.length > 0 && (o.resultados.length === 0 ||
      (o.cobertura.results !== 'completo' && estadoRes === 'completo' && results.length > o.resultados.length));
    if (results.length > 0 && !enviarRes) notas.push('Clasificación leída pero no enviada: la guardada ya es igual o mejor');

    // ---- referencias: el puesto guardado, luego el leído, luego por nombre.
    const porNombre = new Map<string, string | null>();
    const anotar = (n: string, k: string) => {
      const c = compacto(n);
      porNombre.set(c, porNombre.has(c) && porNombre.get(c) !== k ? null : k);
    };
    const fuenteRefs = enviarRes ? results.map((r) => ({ name: r.name, factKey: r.factKey })) : o.resultados;
    for (const r of fuenteRefs) anotar(r.name, r.factKey);
    const ref = (n: string) => porNombre.get(compacto(n)) ?? `${o.competitionKey}:pdfd:n:${claveNombre(n)}`;
    const podioNombres = (enviarRes ? results : o.resultados) as { name: string; position: number | null }[];
    const unico = (n: number) => {
      const xs = podioNombres.filter((r) => r.position === n);
      return xs.length === 1 ? xs[0].name : null;
    };

    const leer = (a: Record<string, unknown>) => {
      const an = str(a?.aName);
      const bn = str(a?.bName);
      const sa = int(a?.scoreA);
      const sb = int(a?.scoreB);
      const w = str(a?.winner)?.toUpperCase() ?? null;
      if (!an || !bn) return 'sin_nombre';
      if (compacto(an) === compacto(bn)) return 'mismo_equipo';
      if (!enPdf(an) || !enPdf(bn)) return 'nombre_no_en_pdf';
      if (sa === null || sb === null) return 'marcador_invalido';
      if (w !== null && w !== 'A' && w !== 'B') return 'ganador_invalido';
      const b: AsaltoHecho = {
        phase: 'POULE', roundKey: 'P1', aRef: ref(an), bRef: ref(bn), aName: an, bName: bn, scoreA: sa, scoreB: sb,
        winner: sa === sb ? (w as 'A' | 'B' | null) : null,
      };
      const m = motivoEncuentro({ ...b, winner: sa === sb ? b.winner : (w as 'A' | 'B' | null) });
      return m ?? b;
    };

    // ---- poules
    const bouts: AsaltoHecho[] = [];
    let descPoules = 0;
    let poulesSinFila = 0;
    const vueltas = new Map<number, number>();
    for (const [ip, pool] of (arr(p.pools) as { pool?: unknown; teams?: unknown; bouts?: unknown }[]).entries()) {
      const lista = arr(pool?.bouts) as Record<string, unknown>[];
      propuestas.bouts += lista.length;
      const numero = int(pool?.pool) ?? ip + 1;
      const vuelta = (vueltas.get(numero) ?? 0) + 1;
      vueltas.set(numero, vuelta);
      const ronda = vuelta === 1 ? `P${numero}` : `V${vuelta}P${numero}`;
      const equipos = new Set(arr(pool?.teams).map(str).filter((s): s is string => s !== null).map(compacto));
      const parejas = new Set<string>();
      const validos: AsaltoHecho[] = [];
      for (const a of lista) {
        const r = leer(a);
        if (typeof r === 'string') {
          sumar(descartes, `poule_${r}`);
          descPoules += 1;
          continue;
        }
        if (equipos.size > 0 && (!equipos.has(compacto(r.aName)) || !equipos.has(compacto(r.bName)))) {
          sumar(descartes, 'poule_equipo_fuera_de_poule');
          descPoules += 1;
          continue;
        }
        const k = [compacto(r.aName), compacto(r.bName)].sort().join('|');
        if (parejas.has(k)) {
          sumar(descartes, 'poule_encuentro_duplicado');
          descPoules += 1;
          continue;
        }
        parejas.add(k);
        validos.push({ ...r, phase: 'POULE', roundKey: ronda });
      }
      // Cada fila de la poule debe cuadrar con lo que imprime el documento; si una no cuadra, la poule entera está mal leída.
      const totales = new Map<string, { nombre: string; dados: number; recibidos: number }>();
      for (const b of validos) {
        for (const [n, d, r] of [[b.aName, b.scoreA, b.scoreB], [b.bName, b.scoreB, b.scoreA]] as const) {
          const t = totales.get(compacto(n)) ?? { nombre: n, dados: 0, recibidos: 0 };
          t.dados += d;
          t.recibidos += r;
          totales.set(compacto(n), t);
        }
      }
      const comprobaciones = [...totales.values()].map((t) => filaCuadra(lineas, t.nombre, t.dados, t.recibidos));
      if (comprobaciones.some((c) => c === false)) {
        sumar(descartes, 'poule_fila_no_cuadra', validos.length);
        descPoules += validos.length;
        continue;
      }
      if (comprobaciones.some((c) => c === null)) poulesSinFila += 1;
      bouts.push(...validos);
    }
    if (poulesSinFila > 0) notas.push(`poules_sin_fila_impresa_para_comprobar:${poulesSinFila}`);

    // ---- cuadro
    let descCuadro = 0;
    const porRonda = new Map<string, Set<string>>();
    const cuadro: AsaltoHecho[] = [];
    for (const a of arr(p.tableau) as Record<string, unknown>[]) {
      propuestas.bouts += 1;
      const ronda = str(a?.round)?.toUpperCase().replace(/\s+/g, '') ?? '';
      const m = RE_RONDA.exec(ronda);
      if (!m || !potencia(Number(m[1])) || (m[2] !== undefined && Number(m[2]) < 3)) {
        sumar(descartes, 'cuadro_ronda_invalida');
        descCuadro += 1;
        continue;
      }
      const r = leer(a);
      if (typeof r === 'string') {
        sumar(descartes, `cuadro_${r}`);
        descCuadro += 1;
        continue;
      }
      const [mx, mn] = [Math.max(r.scoreA, r.scoreB), Math.min(r.scoreA, r.scoreB)];
      if (!new RegExp(`(?<![\\d/])${mx}\\s*[/-]\\s*${mn}(?![\\d/])`).test(textoPlano)) {
        sumar(descartes, 'cuadro_marcador_no_impreso');
        descCuadro += 1;
        continue;
      }
      const usados = porRonda.get(ronda) ?? new Set<string>();
      if (usados.has(compacto(r.aName)) || usados.has(compacto(r.bName))) {
        sumar(descartes, 'cuadro_equipo_repetido_en_ronda');
        descCuadro += 1;
        continue;
      }
      usados.add(compacto(r.aName)).add(compacto(r.bName));
      porRonda.set(ronda, usados);
      cuadro.push({ ...r, phase: 'TABLEAU', roundKey: ronda });
    }
    const reparado = tercerPuestoComoRonda(cuadro);
    if (reparado.some((b, i) => b !== cuadro[i])) notas.push('Encuentro por el tercer puesto leído en el cuadro principal: pasa a T2-3');
    const fuera = incoherentesCuadroEquipos(reparado, { primero: unico(1), segundo: unico(2) }, (x, y) => compacto(x) === compacto(y));
    if (fuera.size > 0) {
      sumar(descartes, 'cuadro_incoherente', fuera.size);
      descCuadro += fuera.size;
    }
    bouts.push(...reparado.filter((_, i) => !fuera.has(i)));

    const nPoules = bouts.filter((b) => b.phase === 'POULE').length;
    const nCuadro = bouts.filter((b) => b.phase === 'TABLEAU').length;
    const final = (declarado: Estado | null, filasOk: number, desc: number, extra = false): Estado => {
      if (filasOk === 0) return desc > 0 || declarado === 'ilegible' ? 'ilegible' : 'sin_resultados';
      return desc > 0 || extra || declarado !== 'completo' ? 'parcial' : 'completo';
    };
    const estadoPoules = final(estadoDe(p.status?.pools), nPoules, descPoules, poulesSinFila > 0);
    const estadoCuadro = final(estadoDe(p.status?.tableau), nCuadro, descCuadro);
    const division = str(p.division);
    if (division) notas.push(`División: ${division}`);
    const totalDesc = descRes + descPoules + descCuadro;
    if (totalDesc > 0) notas.push(`filas_descartadas_validacion:${totalDesc}`);
    if (!enviarRes && results.length === 0 && nPoules === 0 && nCuadro === 0) continue;

    aceptadas.results += enviarRes ? results.length : 0;
    aceptadas.bouts += bouts.length;
    const guardada = clasificacionGuardada(o);
    if (!enviarRes && guardada.results.length > 0) notas.push('Clasificación guardada copiada sin cambios');
    hechos.push(hechosDePrueba(o, {
      extractor: ctx.extractor,
      sourceUrl: ctx.url,
      sourceSha256: ctx.sha256,
      results: enviarRes ? results : guardada.results,
      bouts,
      status: {
        results: enviarRes ? estadoRes : guardada.estado,
        pools: estadoPoules,
        tableau: estadoCuadro,
        publishedParticipants: enviarRes ? publicados : null,
        notes: notas,
      },
    }));
  }
  return {
    hechos,
    sinAsignar: sinAsignar.map((s) => ({ ...s, cabecera: arr(crudas[s.indice]?.headerLines).map(str).filter(Boolean).join(' / ').slice(0, 200) })),
    descartes, propuestas, aceptadas, relevosConNombres, sinTexto,
  };
}

/** Peso de una lectura para elegir entre la del modelo normal y la del fuerte. */
export function puntuarEquipos(v: ValidacionEquipos): number {
  const d = Object.values(v.descartes).reduce((a, b) => a + b, 0);
  return v.aceptadas.results * 2 + v.aceptadas.bouts - d;
}

/** Hecho vacío para una parte `~n` que no se escribe: el cargador no la absorbe en su raíz. */
export function hechoVacio(p: PruebaEquipos, url: string, sha256: string): HechosPrueba {
  const guardada = clasificacionGuardada(p);
  return hechosDePrueba(p, {
    extractor: 'lote7_equipos_vacio',
    sourceUrl: url,
    sourceSha256: sha256,
    results: guardada.results,
    bouts: [],
    status: {
      results: guardada.estado, pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null,
      notes: ['Marcador de parte de documento: sin hechos nuevos, evita que la carga la funda con su raíz'],
    },
  });
}

// ---------------------------------------------------------------- ejecución

export const RUTAS = {
  calidad: join(CARPETA_TRABAJO, 'hechos', 'pdf-calidad.json'),
  huecos: join(CARPETA_TRABAJO, 'rfee-huecos'),
  crudo: join(CACHE_EQUIPOS, 'droid-crudo'),
  estado: join(CACHE_EQUIPOS, 'droid-estado'),
  trabajo: join(CACHE_EQUIPOS, 'droid-trabajo'),
  droid: join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'droid', 'bin', 'droid'),
  prompt: join(dirname(fileURLToPath(import.meta.url)), 'pdf-equipos-prompt.md'),
};

type Documento = { url: string; sha256: string; ruta: string; objetivos: PruebaEquipos[] };

const sinAncla = (u: string) => u.split('#')[0];

/** URL → PDF en caché (backfill y rfee-huecos), con su SHA-256 declarado. */
export function pdfsEnCache(): Map<string, { ruta: string; sha256: string }> {
  const m = new Map<string, { ruta: string; sha256: string }>();
  if (existsSync(RUTAS.calidad)) {
    for (const e of JSON.parse(readFileSync(RUTAS.calidad, 'utf8')) as { url: string; sha256: string; blobPath: string }[]) {
      m.set(sinAncla(e.url), { ruta: e.blobPath, sha256: e.sha256 });
    }
  }
  const man = join(RUTAS.huecos, 'manifiesto.json');
  if (existsSync(man)) {
    const j = JSON.parse(readFileSync(man, 'utf8')) as unknown;
    const lista = (Array.isArray(j) ? j : Object.values(j as object).find(Array.isArray) ?? []) as { url?: string; fichero?: string; sha256?: string }[];
    for (const e of lista) {
      if (e?.url && e.fichero && e.sha256) m.set(sinAncla(e.url), { ruta: join(RUTAS.huecos, 'raw', 'pdfs', e.fichero), sha256: e.sha256 });
    }
  }
  return m;
}

export async function textoPdf(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await extractText(doc, { mergePages: false });
    return text;
  } finally {
    await doc.loadingTask.destroy();
  }
}

export function lanzarDroid(modelo: string, carpeta: string, promptPath: string, timeoutMs: number) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; motivo: string | null }>((resolve) => {
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
      if (hijo.pid) spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
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

let permisos = 4;
/** Droids vivos a la vez para semaforo (máquina compartida). */
export function fijarConcurrencia(n: number): void {
  permisos = Math.max(1, n);
}
const cola: (() => void)[] = [];
export async function semaforo<T>(f: () => Promise<T>): Promise<T> {
  if (permisos > 0) permisos -= 1;
  else await new Promise<void>((r) => cola.push(r));
  try {
    while (freemem() < 2.5 * 1024 ** 3) await new Promise((r) => setTimeout(r, 15_000));
    return await f();
  } finally {
    const s = cola.shift();
    if (s) s();
    else permisos += 1;
  }
}

type EstadoDoc = {
  sha256: string; url: string; hecho: boolean; modelo: string | null; error: string | null;
  intentos: { modelo: string; ok: boolean; motivo: string | null; segundos: number; puntuacion: number | null }[];
  ficheros: string[]; vacios: string[];
  aceptadas: { results: number; bouts: number }; propuestas: { results: number; bouts: number };
  descartes: Record<string, number>; sinAsignar: ValidacionEquipos['sinAsignar']; relevosConNombres: number;
  segundos: number;
};

function argumentos() {
  const a = process.argv.slice(2);
  const v = (n: string) => {
    const i = a.indexOf(n);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    plan: a.includes('--plan'),
    limite: v('--limite') ? Number(v('--limite')) : Infinity,
    solo: v('--solo')?.split(',').filter(Boolean) ?? null,
    concurrencia: Math.min(4, Number(v('--concurrencia') ?? 4)),
    modelo: v('--modelo') ?? 'gpt-6-luna',
    modeloFuerte: v('--modelo-fuerte') ?? 'gpt-6-sol',
    timeoutMs: Number(v('--timeout') ?? 420) * 1000,
    reintentarFallos: a.includes('--reintentar-fallos'),
    revalidar: a.includes('--revalidar'),
  };
}

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

async function procesar(doc: Documento, paginas: string[], opt: ReturnType<typeof argumentos>, salida: string): Promise<EstadoDoc> {
  const t0 = Date.now();
  const est: EstadoDoc = {
    sha256: doc.sha256, url: doc.url, hecho: false, modelo: null, error: null, intentos: [], ficheros: [], vacios: [],
    aceptadas: { results: 0, bouts: 0 }, propuestas: { results: 0, bouts: 0 }, descartes: {}, sinAsignar: [],
    relevosConNombres: 0, segundos: 0,
  };
  const carpeta = join(RUTAS.trabajo, doc.sha256);
  try {
    const bytes = new Uint8Array(await readFile(doc.ruta));
    const pdf = join(carpeta, 'documento.pdf');
    const esperadas = doc.objetivos
      .map((o, i) => `${i + 1}. ${o.weapon} / ${o.gender} / ${o.category}${o.categoryRaw ? ` (${o.categoryRaw})` : ''}`)
      .join('\n');
    const prompt = (await readFile(RUTAS.prompt, 'utf8'))
      .replaceAll('{{PDF_PATH}}', pdf).replaceAll('{{PAGES}}', String(paginas.length)).replaceAll('{{EXPECTED}}', esperadas).replaceAll('{{ALCANCE}}', '');
    const ctx = (modelo: string): ContextoEquipos => ({
      url: doc.url, sha256: doc.sha256, paginas, extractor: `droid:${modelo}`, objetivos: doc.objetivos,
    });
    const pedir = async (modelo: string): Promise<ValidacionEquipos | null> => {
      for (let intento = 1; intento <= 2; intento += 1) {
        const crudoRuta = join(RUTAS.crudo, `${doc.sha256}__${modelo}__${intento}.json`);
        const inicio = Date.now();
        let stdout: string;
        let motivo: string | null = null;
        // Una respuesta guardada y bien formada se reutiliza: reanudar o leer el mismo PDF de otra URL no relanza el droid.
        const guardada = existsSync(crudoRuta) ? await readFile(crudoRuta, 'utf8') : null;
        const reutilizable = guardada !== null && (() => {
          try {
            const s = JSON.parse(guardada) as { is_error?: boolean; result?: unknown };
            return !s.is_error && typeof s.result === 'string';
          } catch {
            return false;
          }
        })();
        if (opt.revalidar || reutilizable) {
          if (guardada === null) return null;
          stdout = guardada;
        } else {
          await mkdir(carpeta, { recursive: true });
          if (!existsSync(pdf)) await writeFile(pdf, bytes);
          const pp = join(carpeta, `prompt-${modelo}.md`);
          await writeFile(pp, prompt, 'utf8');
          const r = await semaforo(() => lanzarDroid(modelo, carpeta, pp, modelo === opt.modelo ? opt.timeoutMs : opt.timeoutMs * 1.5));
          stdout = r.stdout;
          motivo = r.ok ? null : r.motivo;
          await writeFile(crudoRuta, r.stdout, 'utf8');
        }
        let v: ValidacionEquipos | null = null;
        if (motivo === null) {
          try {
            const sobre = JSON.parse(stdout) as { is_error?: boolean; result?: string };
            if (sobre.is_error || typeof sobre.result !== 'string') motivo = 'droid_is_error';
            else v = validarEquipos(extraerJson(sobre.result), ctx(modelo));
          } catch (e) {
            motivo = `json_invalido:${(e as Error).message.slice(0, 60)}`;
          }
        }
        est.intentos.push({ modelo, ok: v !== null, motivo, segundos: Math.round((Date.now() - inicio) / 1000), puntuacion: v ? puntuarEquipos(v) : null });
        if (v) return v;
      }
      return null;
    };
    let mejor: { v: ValidacionEquipos; modelo: string } | null = null;
    const v1 = await pedir(opt.modelo);
    if (v1) mejor = { v: v1, modelo: opt.modelo };
    const flojo = (v: ValidacionEquipos | null) => {
      if (!v) return true;
      if (v.sinTexto) return false;
      const desc = Object.values(v.descartes).reduce((a, b) => a + b, 0);
      const prop = v.propuestas.results + v.propuestas.bouts;
      return v.hechos.length === 0 || v.sinAsignar.length > 0 || (prop > 0 && desc / prop > 0.1) ||
        (v.descartes.cuadro_incoherente ?? 0) > 0 || (v.descartes.poule_fila_no_cuadra ?? 0) > 0;
    };
    if (flojo(v1) && opt.modeloFuerte !== opt.modelo) {
      const v2 = await pedir(opt.modeloFuerte);
      if (v2 && (!mejor || puntuarEquipos(v2) >= puntuarEquipos(mejor.v))) mejor = { v: v2, modelo: opt.modeloFuerte };
    }
    if (!mejor) throw new Error(est.intentos.at(-1)?.motivo ?? 'sin_respuesta_valida');
    const { v } = mejor;
    for (const h of v.hechos) est.ficheros.push(escribirHechos(salida, h));
    Object.assign(est, {
      hecho: true, modelo: mejor.modelo, aceptadas: v.aceptadas, propuestas: v.propuestas, descartes: v.descartes,
      sinAsignar: v.sinAsignar, relevosConNombres: v.relevosConNombres,
    });
  } catch (e) {
    est.error = (e as Error).message.slice(0, 200);
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
  est.segundos = Math.round((Date.now() - t0) / 1000);
  await writeFile(join(RUTAS.estado, `${doc.sha256}.json`), JSON.stringify(est, null, 2));
  return est;
}

async function main() {
  const opt = argumentos();
  const salida = join(argumento('salida', SALIDA_EQUIPOS), 'pdf');
  for (const d of [salida, RUTAS.crudo, RUTAS.estado, RUTAS.trabajo]) await mkdir(d, { recursive: true });
  if (!opt.plan && !opt.revalidar && !existsSync(RUTAS.droid)) throw new Error(`No encuentro droid en ${RUTAS.droid}`);
  const db = new DatabaseSync(argumento('db', NUEVO7), { readOnly: true });
  const pruebas = pruebasEquipos(db, 'rfee_pdf');
  db.close();
  const cache = pdfsEnCache();

  // Documentos con sus pruebas por equipos.
  const porUrl = new Map<string, PruebaEquipos[]>();
  for (const p of pruebas) {
    const u = sinAncla(p.sourceUrl ?? p.edition.sourceUrl ?? '');
    porUrl.set(u, [...(porUrl.get(u) ?? []), p]);
  }
  const plan: { url: string; sha256: string | null; decision: string; faltas: Record<string, string[]>; publica: Publica | null }[] = [];
  const pendientes: { doc: Documento; paginas: string[] }[] = [];
  for (const [url, objetivos] of porUrl) {
    const c = cache.get(url);
    if (!c || !existsSync(c.ruta)) {
      plan.push({ url, sha256: null, decision: 'pdf_no_en_cache', faltas: {}, publica: null });
      continue;
    }
    const bytes = new Uint8Array(readFileSync(c.ruta));
    if (createHash('sha256').update(bytes).digest('hex') !== c.sha256) {
      plan.push({ url, sha256: c.sha256, decision: 'sha256_no_coincide', faltas: {}, publica: null });
      continue;
    }
    const paginas = await textoPdf(bytes);
    const pub = quePublica(paginas);
    const f = Object.fromEntries(objetivos.map((o) => [o.competitionKey, faltas(o, pub)]).filter(([, x]) => x.length > 0));
    const decision = !pub.texto ? 'sin_capa_de_texto' : Object.keys(f).length === 0 ? 'nada_que_anadir' : 'droid';
    plan.push({ url, sha256: c.sha256, decision, faltas: f, publica: pub });
    if (decision === 'droid' && (!opt.solo || opt.solo.includes(c.sha256))) {
      const orden = [...objetivos].sort((x, y) => numeroParte(x.competitionKey) - numeroParte(y.competitionKey));
      pendientes.push({ doc: { url, sha256: c.sha256, ruta: c.ruta, objetivos: orden }, paginas });
    }
  }
  const contarPlan = plan.reduce<Record<string, number>>((m, p) => (sumar(m, p.decision), m), {});
  await writeFile(join(CACHE_EQUIPOS, 'plan-pdf.json'), JSON.stringify({ contarPlan, plan }, null, 2));
  log(`documentos=${plan.length} ${JSON.stringify(contarPlan)} pruebas=${pruebas.length}`);
  if (opt.plan) return;

  const previos = new Map<string, EstadoDoc>();
  for (const f of await readdir(RUTAS.estado)) {
    if (!f.endsWith('.json')) continue;
    try {
      const e = JSON.parse(await readFile(join(RUTAS.estado, f), 'utf8')) as EstadoDoc;
      previos.set(e.sha256, e);
    } catch {
      // Estado a medio escribir: se repite el documento.
    }
  }
  // El mismo PDF publicado en dos URL se lee una vez y se escribe para cada URL.
  const porSha = new Map<string, { doc: Documento; paginas: string[] }[]>();
  for (const x of pendientes) porSha.set(x.doc.sha256, [...(porSha.get(x.doc.sha256) ?? []), x]);
  const cola2 = [...porSha.values()].filter((g) => {
    const p = previos.get(g[0].doc.sha256);
    if (opt.revalidar) return p !== undefined;
    return !p || (!p.hecho && opt.reintentarFallos);
  }).slice(0, opt.limite);
  log(`pendientes=${cola2.length} concurrencia=${opt.concurrencia}`);
  permisos = opt.concurrencia;
  let i = 0;
  let hechos = 0;
  const trabajador = async () => {
    for (;;) {
      const g = cola2[i++];
      if (!g) return;
      for (const x of g) {
        const r = await procesar({ ...x.doc, sha256: x.doc.sha256 }, x.paginas, opt, salida);
        hechos += 1;
        log(`[${hechos}] ${x.doc.sha256.slice(0, 12)} ${r.hecho ? 'ok' : `fallo:${r.error}`} modelo=${r.modelo ?? '-'} ficheros=${r.ficheros.length} res=${r.aceptadas.results}/${r.propuestas.results} enc=${r.aceptadas.bouts}/${r.propuestas.bouts} ${r.segundos}s`);
      }
    }
  };
  await Promise.all(Array.from({ length: opt.concurrencia }, trabajador));
  await cerrar(pruebas, salida);
}

/** Ficheros vacíos para las partes `~n` de las raíces escritas, e informe final. */
async function cerrar(pruebas: PruebaEquipos[], salida: string) {
  const estados: EstadoDoc[] = [];
  for (const f of await readdir(RUTAS.estado)) {
    if (f.endsWith('.json')) estados.push(JSON.parse(await readFile(join(RUTAS.estado, f), 'utf8')) as EstadoDoc);
  }
  const escritos = new Set<string>();
  const claves = new Set<string>();
  for (const f of await readdir(salida)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const h = JSON.parse(await readFile(join(salida, f), 'utf8')) as HechosPrueba;
    if (h.extractor === 'lote7_equipos_vacio') continue;
    escritos.add(f);
    claves.add(`${h.edition.season}\u0000${h.competition.competitionKey}`);
  }
  let vacios = 0;
  for (const p of pruebas) {
    const raiz = raizClave(p.competitionKey);
    if (raiz === p.competitionKey || claves.has(`${p.season}\u0000${p.competitionKey}`)) continue;
    if (!claves.has(`${p.season}\u0000${raiz}`)) continue;
    const url = p.sourceUrl ?? p.edition.sourceUrl;
    if (!url) continue;
    escribirHechos(salida, hechoVacio(p, sinAncla(url), '0'.repeat(64)));
    vacios += 1;
  }
  const s = (sel: (e: EstadoDoc) => Record<string, number>) =>
    estados.reduce<Record<string, number>>((m, e) => {
      for (const [k, n] of Object.entries(sel(e))) sumar(m, k, n);
      return m;
    }, {});
  const informe = {
    generado: new Date().toISOString(),
    documentos: estados.length,
    hechos: estados.filter((e) => e.hecho).length,
    fallidos: estados.filter((e) => !e.hecho).map((e) => ({ sha256: e.sha256, url: e.url, error: e.error })),
    ficheros: escritos.size,
    vacios,
    resultados: estados.reduce((n, e) => n + e.aceptadas.results, 0),
    encuentros: estados.reduce((n, e) => n + e.aceptadas.bouts, 0),
    propuestas: { results: estados.reduce((n, e) => n + e.propuestas.results, 0), bouts: estados.reduce((n, e) => n + e.propuestas.bouts, 0) },
    descartes: s((e) => e.descartes),
    porModelo: estados.reduce<Record<string, number>>((m, e) => (sumar(m, e.modelo ?? '-'), m), {}),
    documentosConRelevosConNombres: estados.filter((e) => e.relevosConNombres > 0).length,
    sinAsignar: estados.flatMap((e) => e.sinAsignar.map((x) => ({ url: e.url, ...x }))),
  };
  await writeFile(join(salida, '_informe.json'), JSON.stringify(informe, null, 2));
  log(`fin ${JSON.stringify({ ...informe, fallidos: informe.fallidos.length, sinAsignar: informe.sinAsignar.length })}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
