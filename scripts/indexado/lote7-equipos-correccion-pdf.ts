/**
 * Relectura estricta de las poules por equipos rfee_pdf que no cuadran con su PDF
 * (`cache-lote7-equipos/auditoria-poules-guardadas.json`, `lote7-equipos-auditoria.ts`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-equipos-correccion-pdf.ts \
 *     [--db <nuevo7.sqlite>] [--concurrencia 3] [--timeout 480] [--rondas 2] [--revalidar]
 *
 * Cada documento lo leen dos modelos distintos (gpt-6-luna y gpt-6-sol, sólo Read, sin red).
 * Si alguna prueba no se acepta, otra ronda pide una lectura nueva a cada modelo (hasta
 * `--rondas`); vale cualquier pareja luna/sol que cumpla todo lo siguiente.
 * Las poules de una prueba se aceptan sólo si:
 *  1. las dos lecturas son idénticas (mismas poules, mismos equipos, mismos marcadores);
 *  2. cada fila de cada poule cuadra con la fila impresa: victorias (V/M o V y D), tocados dados
 *     y recibidos o índice (`comprobarPouleImpresa`);
 *  3. la clasificación de la poule impresa (columna `cl.` o `CLASIF.`) es la que sale de esos
 *     encuentros; si el documento no la imprime, no se puede contradecir;
 *  4. la lectura tiene al menos tantos equipos como lo guardado (sustituir no pierde una poule).
 * Las claves salen de la base. Lo aceptado va a `hechos/lote7-equipos-correccion/` (lo aplica
 * `lote7-equipos-corregir.ts`, no `cargar-hechos`); lo rechazado, con el motivo, a
 * `_rechazadas.json` en la misma carpeta.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { AsaltoHecho } from '../../src/lib/ingest/hechos/formato';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import {
  CACHE_EQUIPOS, escribirHechos, hechosDePrueba, motivoEncuentro, NUEVO7, pruebasEquipos, type PruebaEquipos,
} from './lote7-equipos-comun';
import { asignar, fijarConcurrencia, lanzarDroid, pdfsEnCache, RUTAS, semaforo, sinPaginacion, textoPdf } from './lote7-equipos-pdf';
import { claveNombre, compacto, extraerJson } from './pdf-droids';

export const SALIDA_CORRECCION = join(CARPETA_TRABAJO, 'hechos', 'lote7-equipos-correccion');
const AUDITORIA = join(CACHE_EQUIPOS, 'auditoria-poules-guardadas.json');
const CRUDO = join(CACHE_EQUIPOS, 'droid-correccion');
const MODELOS = ['gpt-6-luna', 'gpt-6-sol'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const ALCANCE_POULES =
  'SCOPE OF THIS PASS: extract ONLY the pools (poules / league tables) of every team competition, completely and exactly; return empty "results" and "tableau" lists with status "sin_resultados". Copy each pool number as printed.';

// ---------------------------------------------------------------- comprobación de cada fila

export type PouleLeida = { numero: number; equipos: string[]; bouts: { a: string; b: string; sa: number; sb: number; w: 'A' | 'B' | null }[] };

type Totales = { nombre: string; v: number; d: number; dados: number; recibidos: number };

/** Números de una línea, con los decimales tal cual («0.600», «0,66667»). */
export function numerosLinea(l: string): string[] {
  return l.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
}

const num = (s: string) => Number(s.replace(',', '.'));

/**
 * La fila impresa del equipo (una línea que empieza por su nombre) contiene, seguidos,
 * `V/M índice TD [cl]` (Engarde) o `V D coef TD TR dif [CLASIF]` (tabla de liga) con los valores
 * de sus encuentros. Devuelve el puesto impreso al final si lo hay, `undefined` si la fila cuadra
 * sin puesto y `null` si ninguna línea cuadra.
 */
export function filaImpresa(lineas: readonly string[], t: Totales, tamano: number): { puesto: number | undefined; formato: 'engarde' | 'liga' } | null {
  const c = compacto(t.nombre);
  if (c.length < 2) return null;
  const ind = t.dados - t.recibidos;
  const jugados = t.v + t.d;
  for (const l of lineas) {
    if (!compacto(l).startsWith(c)) continue;
    const xs = numerosLinea(l);
    for (let k = 0; k < xs.length; k += 1) {
      // Engarde: V/M con tres decimales = victorias / (equipos de la poule - 1) o / encuentros.
      if (/^\d[.,]\d{3}$/.test(xs[k]) && k + 2 < xs.length) {
        const vm = num(xs[k]);
        const vmOk = [tamano - 1, jugados].some((den) => den > 0 && Math.abs(vm - t.v / den) < 0.0006);
        if (vmOk && num(xs[k + 1]) === ind && num(xs[k + 2]) === t.dados && k + 4 >= xs.length) {
          return { puesto: k + 3 < xs.length ? num(xs[k + 3]) : undefined, formato: 'engarde' };
        }
      }
      // Liga: V D coef TD TR dif [CLASIF].
      if (k + 5 < xs.length && num(xs[k]) === t.v && num(xs[k + 1]) === t.d && num(xs[k + 3]) === t.dados &&
        num(xs[k + 4]) === t.recibidos && num(xs[k + 5]) === ind && k + 7 >= xs.length &&
        (jugados === 0 || Math.abs(num(xs[k + 2]) - t.v / jugados) < 0.001)) {
        return { puesto: k + 6 < xs.length ? num(xs[k + 6]) : undefined, formato: 'liga' };
      }
    }
  }
  return null;
}

/** Totales de cada equipo de la poule a partir de sus encuentros. */
export function totalesPoule(p: PouleLeida): Totales[] {
  const m = new Map<string, Totales>();
  const de = (n: string) => {
    const k = compacto(n);
    const t = m.get(k) ?? { nombre: n, v: 0, d: 0, dados: 0, recibidos: 0 };
    m.set(k, t);
    return t;
  };
  for (const e of p.equipos) de(e);
  for (const b of p.bouts) {
    const ta = de(b.a);
    const tb = de(b.b);
    const ganaA = b.sa > b.sb || (b.sa === b.sb && b.w === 'A');
    ta.dados += b.sa;
    ta.recibidos += b.sb;
    tb.dados += b.sb;
    tb.recibidos += b.sa;
    if (ganaA) {
      ta.v += 1;
      tb.d += 1;
    } else {
      tb.v += 1;
      ta.d += 1;
    }
  }
  return [...m.values()];
}

/** Puesto en la poule que dan los encuentros: Engarde por V/M, índice y TD; liga por coeficiente, diferencia y TD. */
function puestosCalculados(ts: readonly Totales[], formato: 'engarde' | 'liga', tamano: number): number[] {
  const clave = (t: Totales): number[] => {
    const jugados = t.v + t.d;
    const vm = formato === 'engarde' ? t.v / Math.max(1, tamano - 1) : jugados ? t.v / jugados : 0;
    return [vm, t.dados - t.recibidos, t.dados];
  };
  const ks = ts.map(clave);
  return ks.map((k) => 1 + ks.filter((o) => o[0] > k[0] + 1e-9 || (Math.abs(o[0] - k[0]) < 1e-9 &&
    (o[1] > k[1] || (o[1] === k[1] && o[2] > k[2])))).length);
}

/** `null` si la poule cuadra con lo impreso; si no, el motivo. */
export function comprobarPouleImpresa(lineas: readonly string[], p: PouleLeida): string | null {
  const ts = totalesPoule(p);
  const tamano = ts.length;
  const filas = ts.map((t) => filaImpresa(lineas, t, tamano));
  if (filas.some((f) => f === null)) return 'fila_no_cuadra_con_lo_impreso';
  const conPuesto = filas.filter((f) => f!.puesto !== undefined).length;
  if (conPuesto === 0) return null;
  if (conPuesto !== filas.length) return 'clasificacion_impresa_incompleta';
  const calc = puestosCalculados(ts, filas[0]!.formato, tamano);
  return calc.every((x, i) => x === filas[i]!.puesto) ? null : 'clasificacion_de_poule_no_coincide';
}

// ---------------------------------------------------------------- una lectura

export type LecturaPoules = Map<number, { poules: PouleLeida[]; problemas: string[] }>;

/** Poules de cada prueba guardada (índice en `objetivos`) según una respuesta del modelo. */
export function poulesDeLectura(crudo: unknown, paginas: readonly string[], objetivos: readonly PruebaEquipos[]): LecturaPoules {
  const texto = compacto(sinPaginacion(paginas.join('\n')));
  const enPdf = (s: string) => compacto(s).length >= 2 && texto.includes(compacto(s));
  const crudas = arr((crudo as { competitions?: unknown } | null)?.competitions) as Record<string, unknown>[];
  const { asignadas } = asignar(crudas, objetivos);
  const out: LecturaPoules = new Map();
  for (const [ic, io] of asignadas) {
    const problemas: string[] = [];
    const poules: PouleLeida[] = [];
    for (const [ip, pool] of (arr(crudas[ic].pools) as Record<string, unknown>[]).entries()) {
      const numero = int(pool?.pool) ?? ip + 1;
      const equipos = arr(pool?.teams).map(str).filter((s): s is string => s !== null);
      const nombres = new Set(equipos.map(compacto));
      const parejas = new Set<string>();
      const bouts: PouleLeida['bouts'] = [];
      for (const x of arr(pool?.bouts) as Record<string, unknown>[]) {
        const a = str(x?.aName);
        const b = str(x?.bName);
        const sa = int(x?.scoreA);
        const sb = int(x?.scoreB);
        const w = str(x?.winner)?.toUpperCase() ?? null;
        const motivo = !a || !b || sa === null || sb === null ? 'encuentro_incompleto'
          : compacto(a) === compacto(b) ? 'mismo_equipo'
          : !enPdf(a) || !enPdf(b) ? 'nombre_no_en_pdf'
          : nombres.size > 0 && (!nombres.has(compacto(a)) || !nombres.has(compacto(b))) ? 'equipo_fuera_de_poule'
          : (w !== null && w !== 'A' && w !== 'B') ? 'ganador_invalido'
          : motivoEncuentro({ aName: a, bName: b, scoreA: sa, scoreB: sb, winner: sa === sb ? (w as 'A' | 'B' | null) : (w as 'A' | 'B' | null) });
        if (motivo) {
          problemas.push(`P${numero}:${motivo}`);
          continue;
        }
        const k = [compacto(a!), compacto(b!)].sort().join('|');
        if (parejas.has(k)) {
          problemas.push(`P${numero}:encuentro_duplicado`);
          continue;
        }
        parejas.add(k);
        bouts.push({ a: a!, b: b!, sa: sa!, sb: sb!, w: sa === sb ? (w as 'A' | 'B') : null });
      }
      poules.push({ numero, equipos, bouts });
    }
    const numeros = poules.map((p) => p.numero);
    if (new Set(numeros).size !== numeros.length) problemas.push('numero_de_poule_repetido');
    out.set(io, { poules, problemas });
  }
  return out;
}

/** Firma de las poules de una lectura: dos lecturas idénticas dan la misma. */
export function firmaPoules(poules: readonly PouleLeida[]): string {
  return poules
    .map((p) => {
      const enc = p.bouts.map((b) => {
        const [x, y] = compacto(b.a) < compacto(b.b) ? [[b.a, b.sa], [b.b, b.sb]] : [[b.b, b.sb], [b.a, b.sa]];
        const gana = b.sa === b.sb ? (b.w === 'A' ? compacto(b.a) : compacto(b.b)) : '';
        return `${compacto(String(x[0]))}:${x[1]}-${compacto(String(y[0]))}:${y[1]}${gana ? `>${gana}` : ''}`;
      }).sort();
      return `P${p.numero}[${[...new Set([...p.equipos.map(compacto), ...p.bouts.flatMap((b) => [compacto(b.a), compacto(b.b)])])].sort().join(',')}]{${enc.join(';')}}`;
    })
    .sort()
    .join('\n');
}

export type Veredicto = { ok: true; poules: PouleLeida[] } | { ok: false; motivo: string };

/** Decide una prueba con las dos lecturas y el texto del PDF. */
export function decidir(
  lecturas: readonly ({ poules: PouleLeida[]; problemas: string[] } | undefined)[],
  lineas: readonly string[],
  equiposGuardados: number,
): Veredicto {
  if (lecturas.length < 2 || lecturas.some((l) => !l)) return { ok: false, motivo: 'falta_una_de_las_dos_lecturas' };
  const [a, b] = lecturas as { poules: PouleLeida[]; problemas: string[] }[];
  if (a.poules.length === 0 || a.poules.every((p) => p.bouts.length === 0)) return { ok: false, motivo: 'lectura_sin_poules' };
  if (a.problemas.length > 0 || b.problemas.length > 0) return { ok: false, motivo: `encuentros_descartados:${[...a.problemas, ...b.problemas].slice(0, 3).join(',')}` };
  if (firmaPoules(a.poules) !== firmaPoules(b.poules)) return { ok: false, motivo: 'las_dos_lecturas_difieren' };
  for (const p of a.poules) {
    const m = comprobarPouleImpresa(lineas, p);
    if (m) return { ok: false, motivo: `P${p.numero}:${m}` };
  }
  const equipos = new Set(a.poules.flatMap((p) => [...p.equipos, ...p.bouts.flatMap((x) => [x.a, x.b])].map(compacto)));
  if (equipos.size < equiposGuardados) return { ok: false, motivo: 'menos_equipos_que_lo_guardado' };
  return { ok: true, poules: a.poules };
}

// ---------------------------------------------------------------- ejecución

type Auditada = { prueba: string; url: string; filasNoCuadran: number; encuentros: number };

async function leerModelo(sha: string, modelo: string, pdf: Uint8Array, paginas: number, objetivos: PruebaEquipos[], timeoutMs: number, revalidar: boolean, ronda = 1): Promise<unknown | null> {
  const ruta = join(CRUDO, ronda === 1 ? `${sha}__${modelo}.json` : `${sha}__${modelo}__r${ronda}.json`);
  const valido = (s: string) => {
    try {
      const j = JSON.parse(s) as { is_error?: boolean; result?: unknown };
      return !j.is_error && typeof j.result === 'string' ? extraerJson(j.result) : null;
    } catch {
      return null;
    }
  };
  if (existsSync(ruta)) {
    const v = valido(await readFile(ruta, 'utf8'));
    if (v !== null || revalidar) return v;
  }
  if (revalidar) return null;
  const carpeta = join(CACHE_EQUIPOS, 'droid-trabajo', `corr-${sha}-${modelo}-${ronda}`);
  await mkdir(carpeta, { recursive: true });
  try {
    const doc = join(carpeta, 'documento.pdf');
    await writeFile(doc, pdf);
    const esperadas = objetivos.map((o, i) => `${i + 1}. ${o.weapon} / ${o.gender} / ${o.category}`).join('\n');
    const prompt = (await readFile(RUTAS.prompt, 'utf8')).replaceAll('{{PDF_PATH}}', doc).replaceAll('{{PAGES}}', String(paginas))
      .replaceAll('{{EXPECTED}}', esperadas).replaceAll('{{ALCANCE}}', ALCANCE_POULES);
    const pp = join(carpeta, 'prompt.md');
    await writeFile(pp, prompt, 'utf8');
    for (let intento = 1; intento <= 2; intento += 1) {
      const r = await semaforo(() => lanzarDroid(modelo, carpeta, pp, timeoutMs));
      const v = r.ok ? valido(r.stdout) : null;
      if (v !== null || intento === 2) {
        await writeFile(ruta, r.stdout, 'utf8');
        return v;
      }
    }
    return null;
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const concurrencia = Math.min(3, Number(argumento('concurrencia', '3')));
  const timeoutMs = Number(argumento('timeout', '480')) * 1000;
  const revalidar = bandera('revalidar');
  const rondas = Math.max(1, Math.min(3, Number(argumento('rondas', '2'))));
  fijarConcurrencia(concurrencia);
  await mkdir(CRUDO, { recursive: true });
  await mkdir(SALIDA_CORRECCION, { recursive: true });
  const auditadas = (JSON.parse(readFileSync(AUDITORIA, 'utf8')) as { pruebas: Auditada[] }).pruebas.filter((p) => p.filasNoCuadran > 0);
  const db = new DatabaseSync(argumento('db', NUEVO7), { readOnly: true });
  const todas = pruebasEquipos(db, 'rfee_pdf');
  const equiposGuardados = db.prepare(`SELECT count(DISTINCT n) n FROM (SELECT fencer_a_name n FROM sport_bout WHERE competition_id=? AND phase='POULE'
    UNION SELECT fencer_b_name FROM sport_bout WHERE competition_id=? AND phase='POULE')`);
  const guardados = new Map(todas.map((p) => [p.competitionKey, Number((equiposGuardados.get(p.id, p.id) as { n: number }).n)]));
  db.close();
  const cache = pdfsEnCache();
  const objetivo = new Set(auditadas.map((a) => a.prueba));
  const porUrl = new Map<string, PruebaEquipos[]>();
  for (const p of todas) {
    const u = (p.sourceUrl ?? '').split('#')[0];
    if (auditadas.some((a) => a.url === u)) porUrl.set(u, [...(porUrl.get(u) ?? []), p]);
  }
  const aceptadas: { prueba: string; url: string; poules: number; encuentros: number; antes: number }[] = [];
  const rechazadas: { prueba: string; edicion: string; url: string; motivo: string }[] = [];
  const escritos = new Set<string>();
  const docs = [...porUrl.entries()];
  let i = 0;
  const trabajador = async () => {
    for (;;) {
      const d = docs[i++];
      if (!d) return;
      const [url, objetivos] = d;
      objetivos.sort((x, y) => Number(/~(\d+)$/.exec(x.competitionKey)?.[1] ?? 1) - Number(/~(\d+)$/.exec(y.competitionKey)?.[1] ?? 1));
      const c = cache.get(url);
      const mios = objetivos.filter((o) => objetivo.has(o.competitionKey));
      const rechazar = (motivo: string) => mios.forEach((o) => rechazadas.push({ prueba: o.competitionKey, edicion: o.edition.name, url, motivo }));
      if (!c || !existsSync(c.ruta)) {
        rechazar('pdf_no_en_cache');
        continue;
      }
      const bytes = new Uint8Array(readFileSync(c.ruta));
      const paginas = await textoPdf(bytes);
      const lineas = paginas.flatMap((p) => p.split(/\r?\n/));
      // Cada ronda pide otra lectura a cada modelo; una prueba se acepta con cualquier pareja
      // (una de cada modelo) idéntica y que cuadre. Lo ya aceptado no pide más rondas.
      const porModelo: LecturaPoules[][] = MODELOS.map(() => []);
      const veredictos = new Map<PruebaEquipos, Veredicto>();
      for (let ronda = 1; ronda <= rondas; ronda += 1) {
        if (ronda > 1 && mios.every((o) => veredictos.get(o)?.ok)) break;
        const nuevas = await Promise.all(MODELOS.map(async (m) => {
          const crudo = await leerModelo(c.sha256, m, bytes, paginas.length, objetivos, timeoutMs, revalidar, ronda);
          return crudo === null ? null : poulesDeLectura(crudo, paginas, objetivos);
        }));
        nuevas.forEach((l, k) => l && porModelo[k].push(l));
        for (const o of mios) {
          if (veredictos.get(o)?.ok) continue;
          const io = objetivos.indexOf(o);
          let v: Veredicto | null = null;
          parejas: for (const a of porModelo[0]) {
            for (const b of porModelo[1]) {
              const x = decidir([a.get(io), b.get(io)], lineas, guardados.get(o.competitionKey) ?? 0);
              if (x.ok) {
                v = x;
                break parejas;
              }
              v ??= x;
            }
          }
          veredictos.set(o, v ?? { ok: false, motivo: `sin_respuesta_valida:${MODELOS.filter((_, k) => porModelo[k].length === 0).join('+')}` });
        }
      }
      for (const o of mios) {
        const v = veredictos.get(o) ?? { ok: false as const, motivo: 'sin_veredicto' };
        if (!v.ok) {
          rechazadas.push({ prueba: o.competitionKey, edicion: o.edition.name, url, motivo: v.motivo });
          continue;
        }
        const ref = (n: string) => {
          const xs = o.resultados.filter((r) => compacto(r.name) === compacto(n));
          return xs.length === 1 ? xs[0].factKey : `${o.competitionKey}:pdfd:n:${claveNombre(n)}`;
        };
        const bouts: AsaltoHecho[] = v.poules.flatMap((p) => p.bouts.map((b) => ({
          phase: 'POULE' as const, roundKey: `P${p.numero}`, aRef: ref(b.a), bRef: ref(b.b), aName: b.a, bName: b.b,
          scoreA: b.sa, scoreB: b.sb, winner: b.w,
        })));
        const h = hechosDePrueba(o, {
          extractor: 'droid:gpt-6-luna+gpt-6-sol', sourceUrl: url, sourceSha256: c.sha256, results: [], bouts,
          status: {
            results: 'sin_resultados', pools: 'completo', tableau: 'sin_resultados', publishedParticipants: null,
            notes: ['Poules releídas por dos modelos con lecturas idénticas y filas que cuadran con el PDF; sustituyen a las guardadas (lote7-equipos-corregir.ts)'],
          },
        });
        escritos.add(escribirHechos(SALIDA_CORRECCION, h));
        aceptadas.push({ prueba: o.competitionKey, url, poules: v.poules.length, encuentros: bouts.length, antes: auditadas.find((a) => a.prueba === o.competitionKey)?.encuentros ?? 0 });
      }
      console.log(`${new Date().toISOString()} ${c.sha256.slice(0, 12)} hecho aceptadas=${aceptadas.length} rechazadas=${rechazadas.length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrencia }, trabajador));
  for (const f of readdirSync(SALIDA_CORRECCION)) if (f.endsWith('.json') && !f.startsWith('_') && !escritos.has(f)) rmSync(join(SALIDA_CORRECCION, f));
  const motivos = rechazadas.reduce<Record<string, number>>((m, r) => ((m[r.motivo.replace(/^P\d+:/, '').split(':')[0]] = (m[r.motivo.replace(/^P\d+:/, '').split(':')[0]] ?? 0) + 1), m), {});
  writeFileSync(join(SALIDA_CORRECCION, '_rechazadas.json'), JSON.stringify({ motivos, rechazadas }, null, 2));
  writeFileSync(join(SALIDA_CORRECCION, '_informe.json'), JSON.stringify({
    generado: new Date().toISOString(), auditadas: auditadas.length, aceptadas: aceptadas.length, rechazadas: rechazadas.length,
    encuentros: aceptadas.reduce((n, a) => n + a.encuentros, 0), encuentrosAntes: aceptadas.reduce((n, a) => n + a.antes, 0),
    motivos, detalle: aceptadas,
  }, null, 2));
  console.log(JSON.stringify({ auditadas: auditadas.length, aceptadas: aceptadas.length, rechazadas: rechazadas.length, motivos }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
