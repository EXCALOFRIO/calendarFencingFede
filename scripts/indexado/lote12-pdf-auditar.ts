/**
 * Lote 12: vuelve a contrastar con el lector de cuadros mejorado los cuadros `rfee_pdf` que
 * `lote11-pdf-auditar.ts` dejó sin evidencia (`listaDudasCuadro` de su `_informe.json`). Sólo lee
 * la base (abierta en sólo lectura) y la caché de PDF.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote12-pdf-auditar.ts \
 *     [--db <nuevo12.sqlite>] [--cache <cache-rfee-2018>] [--previo <hechos/lote11-correccion-pdf>] \
 *     [--salida <hechos/lote12-correccion-pdf>]
 *
 * Qué cambia respecto al lote 11:
 *  - el lector reconoce las cabeceras y los títulos en catalán y francés, y la auditoría le da como
 *    pista el arma y el género de la competición guardada cuando la cabecera no los declara (sólo
 *    lo que falta, nunca contra lo que la cabecera nombra);
 *  - un PDF con dos cuadros (fase previa `A*` y fase final `B*` en la misma competición): cada
 *    familia de rondas se contrasta con la prueba del PDF cuyos tiradores casan con ella;
 *  - el cuadro del PDF se valida contra su propia clasificación (`comprobarCuadroClasificacion`):
 *    el perdedor de la tabla de N queda entre N/2+1 y N, la final da el 1 y el 2...
 *
 * Regla de evidencia por asalto del PDF («fiable»): marcador explícito y posible (ganador con más
 * tocados y sin pasar del tope del cuadro), coherente con el resto del cuadro leído y con la
 * clasificación final. Con eso:
 *  - `marcador`: la misma pareja guardada en la misma ronda con otro marcador;
 *  - `baja` + `alta` (sustitución): la ronda guarda a un tirador distinto frente al mismo rival
 *    (lo que en el lote 11 «empeoraba la coherencia»: el ganador de la ronda anterior estaba mal);
 *  - `alta`: un cruce fiable que la base no tiene, entre tiradores ya guardados en la competición
 *    y sin asalto en esa ronda;
 *  - `baja` sola: sólo con el cuadro del PDF entero leído y validado.
 * Las correcciones de un cuadro se aplican todas o ninguna, y sólo si tras aplicarlas ningún asalto
 * tocado queda incoherente y el cuadro no tiene más incoherencias que antes (con los puestos de la
 * clasificación del PDF). El cuadro sólo vuelve a `completo` si queda igual que el del PDF.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { consistenciaCuadro } from '../../src/lib/ingest/hechos/cuadro-consistencia';
import type { HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { comprobarCuadroClasificacion } from '../../src/lib/ingest/resultados-auto/validacion-estricta';
import { docIdLegadoDeUrl, extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { leerResultadosPdf, type PistasPrueba } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { Arma, AsaltoPdf, Genero } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';
import { asignarNombres, auditarCuadro, extractorDe, mismoTexto, topeDe, type AsaltoBase } from './lote10-pdf-auditar';
import { CARPETA_CORRECCION_11, type Clave } from './lote11-pdf-auditar';
import { cargarManifiesto, rutaBlob } from './pdf-relectura-objetivos';

export const CARPETA_CORRECCION_12 = join(CARPETA_TRABAJO, 'hechos', 'lote12-correccion-pdf');

// ------------------------------------------------------------------ cuadro del PDF

export type PuestoCuadro = { ref: string; nombre: string; posicion: number | null };
export type CuadroPdf = {
  clave: string;
  cuadro: AsaltoPdf[];
  /** La cobertura del cuadro que da el lector: `completo` si no dejó ningún cruce sin leer. */
  completo: boolean;
  puestos: PuestoCuadro[];
  /** Fallos de la validación del cuadro contra la clasificación y contra sí mismo. */
  fallos: string[];
};

const tamano = (ronda: string): number | null => {
  const m = /^[ATB](\d+)$/.exec(ronda);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 && (n & (n - 1)) === 0 ? n : null;
};
const familia = (ronda: string) => (ronda.startsWith('B') ? 'B' : 'A');
const pareja = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Tope del cuadro: el tanteo de victoria más repetido (15 en adultos, 10 en los más pequeños). */
export const topeCuadro = (cuadro: readonly AsaltoPdf[]) => topeDe(cuadro.map((x) => ({ sa: x.puntosA, sb: x.puntosB })));

/** Un marcador de eliminación directa posible: ganador con más tocados, sin pasar del tope. */
export const marcadorPosible = (a: number, b: number, tope: number) => a !== b && Math.max(a, b) <= tope;

/** El perdedor de la tabla de N queda entre N/2+1 y N; el finalista es el 2 y el campeón el 1. */
export function cuadraConPuestos(n: number, pg: number | null | undefined, pp: number | null | undefined): boolean {
  if (pg === null || pg === undefined || pp === null || pp === undefined) return false;
  if (n === 2) return pg === 1 && pp === 2;
  if (n === 4) return (pp === 3 || pp === 4) && pg <= 2;
  return pp >= n / 2 + 1 && pp <= n && pg <= n / 2;
}

/**
 * Validación del cuadro leído: coherencia interna, marcadores posibles y `comprobarCuadroClasificacion`.
 * `previa`: el cuadro de una fase previa (sus ganadores siguen en otra fase), cuya clasificación
 * del PDF ya ordena por el resultado final: no se mide contra ella.
 */
export function validarCuadroPdf(cuadro: readonly AsaltoPdf[], puestos: readonly PuestoCuadro[], previa = false): string[] {
  const fallos: string[] = [];
  if (cuadro.length === 0) return ['cuadro_vacio'];
  const c = consistenciaCuadro(cuadro.map((a) => ({ roundKey: a.ronda, aRef: a.refA, bRef: a.refB, scoreA: a.puntosA, scoreB: a.puntosB })));
  for (const [m, n] of Object.entries(c.motivos)) fallos.push(`${m}:${n}`);
  const tope = topeCuadro(cuadro);
  const imposibles = cuadro.filter((a) => !marcadorPosible(a.puntosA, a.puntosB, tope)).length;
  if (imposibles > 0) fallos.push(`marcador_imposible:${imposibles}`);
  if (previa) {
    const sinConfirmar = cuadro.filter((a) => confirmado(cuadro, a) === false).length;
    if (sinConfirmar > 0) fallos.push(`ganador_sin_ronda_siguiente:${sinConfirmar}`);
    return fallos;
  }
  const h = {
    competition: { format: 'INDIVIDUAL' },
    results: puestos.map((p) => ({ name: p.nombre, position: p.posicion })),
    bouts: cuadro.map((a) => ({ phase: 'TABLEAU', roundKey: a.ronda === 'C2' ? 'T2-3' : `T${tamano(a.ronda) ?? a.ronda}`,
      aName: a.nombreA, bName: a.nombreB, scoreA: a.puntosA, scoreB: a.puntosB, winner: null })),
  } as unknown as HechosPrueba;
  fallos.push(...comprobarCuadroClasificacion(h));
  return fallos;
}

/**
 * ¿El ganador tira la ronda siguiente? `null` si el cuadro leído no tiene ningún asalto de esa
 * ronda (la última de una fase previa, o una página que no se leyó).
 */
export function confirmado(cuadro: readonly AsaltoPdf[], a: AsaltoPdf): boolean | null {
  const n = tamano(a.ronda);
  if (n === null || n <= 2) return null;
  const siguiente = cuadro.filter((x) => tamano(x.ronda) === n / 2);
  if (siguiente.length === 0) return null;
  const g = a.puntosA > a.puntosB ? a.refA : a.refB;
  return siguiente.some((x) => x.refA === g || x.refB === g);
}

/**
 * Asaltos del cuadro del PDF que cumplen la regla de evidencia, por índice. En una fase previa
 * la clasificación no sirve de contraste: su ganador tiene que tirar la ronda siguiente si se leyó.
 */
export function asaltosFiables(p: CuadroPdf, previa = false): Set<number> {
  const pos = new Map(p.puestos.map((x) => [x.ref, x.posicion]));
  const c = consistenciaCuadro(p.cuadro.map((a) => ({ roundKey: a.ronda, aRef: a.refA, bRef: a.refB, scoreA: a.puntosA, scoreB: a.puntosB })));
  const tope = topeCuadro(p.cuadro);
  const out = new Set<number>();
  for (const [i, a] of p.cuadro.entries()) {
    const n = tamano(a.ronda);
    if (n === null || a.marcador !== 'explicito' || c.incoherentes.has(i) || !marcadorPosible(a.puntosA, a.puntosB, tope)) continue;
    const [g, q] = a.puntosA > a.puntosB ? [a.refA, a.refB] : [a.refB, a.refA];
    if (previa ? confirmado(p.cuadro, a) !== false : cuadraConPuestos(n, pos.get(g), pos.get(q))) out.add(i);
  }
  return out;
}

export type LecturaCuadros = { pruebas: CuadroPdf[]; sinAtribuir: string[] };

export async function leerCuadros(bytes: Uint8Array, url: string, pistas?: PistasPrueba): Promise<LecturaCuadros> {
  const { paginas } = await extraerPaginas(bytes);
  const lectura = leerResultadosPdf(paginas, { url, docId: docIdLegadoDeUrl(url), pistas });
  const pruebas = lectura.pruebas.filter((p) => p.formato === 'INDIVIDUAL').map((p): CuadroPdf => {
    const cuadro = p.asaltos.filter((a) => a.fase === 'TABLEAU');
    const puestos = p.puestos.map((x) => ({ ref: x.ref, nombre: x.nombre, posicion: x.posicion }));
    return { clave: p.clave, cuadro, completo: p.cobertura.cuadro.estado === 'completo', puestos, fallos: validarCuadroPdf(cuadro, puestos) };
  });
  const sinAtribuir = lectura.pruebas.filter((p) => p.estado === 'pendiente')
    .flatMap((p) => p.rechazos.filter((r) => r.seccion === 'prueba').map((r) => r.motivo));
  return { pruebas, sinAtribuir: [...new Set(sinAtribuir)] };
}

// ------------------------------------------------------------------ contraste con la base

export type TiradorBase = { ref: string; nombre: string; persona: string | null };
export type CambioCuadro =
  | { tipo: 'marcador'; aRef: string; bRef: string; antes: [number, number]; despues: [number, number] }
  | { tipo: 'baja'; aRef: string; bRef: string; antes: [number, number] }
  | { tipo: 'alta'; aRef: string; bRef: string; aNombre: string; bNombre: string; aPersona: string | null; bPersona: string | null; despues: [number, number] };
export type CambioRonda = { ronda: string; cambio: CambioCuadro; evidencia: string };

export type Reconciliacion = {
  estado: 'coincide' | 'corregido' | 'dudoso';
  motivo: string | null;
  cambios: CambioRonda[];
  /** Lo que sigue sin evidencia, para el informe. */
  pendientes: { noFiables: number; sinTirador: number; guardadosSinPareja: number; pdfSinGuardar: number; incoherentesDespues: number; muestras: string[] };
  /** El cuadro del PDF se leyó entero (sin regiones ni cruces sin atribuir), validado y casado. */
  pdfEntero: boolean;
  detalle?: unknown;
};

/**
 * Casa los tiradores del cuadro del PDF con los guardados en la competición: primero con los
 * del cuadro guardado; los que no, con el resto de tiradores de la competición. Lo ambiguo no casa.
 */
export function casarTiradores(pdf: readonly { ref: string; nombre: string }[], cuadro: readonly TiradorBase[], resto: readonly TiradorBase[]): Map<string, TiradorBase> {
  const out = new Map<string, TiradorBase>();
  const a = asignarNombres(pdf.map((x) => x.nombre), cuadro.map((x) => x.nombre));
  for (const [i, j] of a.entries()) if (j !== null) out.set(pdf[i].ref, cuadro[j]);
  const usados = new Set([...out.values()].map((t) => t.ref));
  const faltan = pdf.filter((x) => !out.has(x.ref));
  const libres = resto.filter((t) => !usados.has(t.ref));
  if (faltan.length > 0 && libres.length > 0) {
    const b = asignarNombres(faltan.map((x) => x.nombre), libres.map((x) => x.nombre));
    for (const [i, j] of b.entries()) if (j !== null) out.set(faltan[i].ref, libres[j]);
  }
  return out;
}

/**
 * Cuadro guardado (una familia de rondas, de un PDF) frente al del lector. `tiradores`: los de la
 * competición fuera de este cuadro, para las altas de quien aún no tiene asalto en él.
 */
export function reconciliarCuadro(
  guardado: readonly AsaltoBase[],
  pdf: CuadroPdf,
  tiradoresCompeticion: readonly TiradorBase[],
  previa = false,
): Reconciliacion {
  const fam = familia(guardado[0]?.ronda ?? 'A');
  const prefijo = guardado.find((b) => tamano(b.ronda) !== null)?.ronda[0] ?? 'A';
  const fiables = asaltosFiables(pdf, previa);
  const fallosPdf = previa ? validarCuadroPdf(pdf.cuadro, pdf.puestos, true) : pdf.fallos;
  const delPdf = pdf.cuadro.map((x, i) => ({ x, i, n: tamano(x.ronda) })).filter((y) => y.n !== null) as { x: AsaltoPdf; i: number; n: number }[];
  const tirPdf = new Map<string, string>();
  for (const { x } of delPdf) { tirPdf.set(x.refA, x.nombreA); tirPdf.set(x.refB, x.nombreB); }
  const enCuadro = new Map<string, TiradorBase>();
  for (const b of guardado) {
    if (!enCuadro.has(b.aRef)) enCuadro.set(b.aRef, { ref: b.aRef, nombre: b.aNombre, persona: b.aPersona });
    if (!enCuadro.has(b.bRef)) enCuadro.set(b.bRef, { ref: b.bRef, nombre: b.bNombre, persona: b.bPersona });
  }
  const resto = tiradoresCompeticion.filter((t) => !enCuadro.has(t.ref));
  const mapa = casarTiradores([...tirPdf].map(([ref, nombre]) => ({ ref, nombre })), [...enCuadro.values()], resto);
  const posBase = new Map<string, number | null>();
  for (const [r, t] of mapa) posBase.set(t.ref, pdf.puestos.find((p) => p.ref === r)?.posicion ?? null);

  const porClave = new Map<string, AsaltoBase>();
  for (const b of guardado) {
    const n = tamano(b.ronda);
    if (n !== null) porClave.set(`${n}|${pareja(b.aRef, b.bRef)}`, b);
  }
  const usados = new Set<string>();
  const cambios: CambioRonda[] = [];
  let noFiables = 0;
  let sinTirador = 0;
  const muestras: string[] = [];
  const pdfSueltos: { x: AsaltoPdf; n: number; a: TiradorBase; b: TiradorBase }[] = [];
  const texto = (x: AsaltoPdf) => `${x.ronda} ${x.nombreA} ${x.puntosA}-${x.puntosB} ${x.nombreB} (p${x.region.pagina})`;
  for (const { x, i, n } of delPdf) {
    const ta = mapa.get(x.refA);
    const tb = mapa.get(x.refB);
    if (!ta || !tb || ta.ref === tb.ref) { sinTirador += 1; muestras.push(`sin_tirador ${texto(x)}`); continue; }
    const k = `${n}|${pareja(ta.ref, tb.ref)}`;
    const b = porClave.get(k);
    if (!b) {
      if (fiables.has(i)) pdfSueltos.push({ x, n, a: ta, b: tb });
      else { noFiables += 1; muestras.push(`no_fiable ${texto(x)}`); }
      continue;
    }
    usados.add(b.id);
    const despues: [number, number] = b.aRef === ta.ref ? [x.puntosA, x.puntosB] : [x.puntosB, x.puntosA];
    if (despues[0] === b.sa && despues[1] === b.sb) continue;
    if (!fiables.has(i)) { noFiables += 1; muestras.push(`no_fiable ${texto(x)} (guardado ${b.sa}-${b.sb})`); continue; }
    cambios.push({ ronda: b.ronda, cambio: { tipo: 'marcador', aRef: b.aRef, bRef: b.bRef, antes: [b.sa, b.sb], despues }, evidencia: texto(x) });
  }
  // Sustituciones: un cruce fiable sin guardar y un guardado sin pareja, en la misma ronda y con un tirador en común.
  const sueltosBase = () => guardado.filter((b) => !usados.has(b.id) && tamano(b.ronda) !== null);
  const pdfPendientes: typeof pdfSueltos = [];
  const alta = (ronda: string, s: (typeof pdfSueltos)[number]): CambioRonda => {
    const [p, q] = s.a.ref < s.b.ref ? [s.a, s.b] : [s.b, s.a];
    const puntos = (t: TiradorBase) => (t === s.a ? s.x.puntosA : s.x.puntosB);
    return { ronda, evidencia: texto(s.x), cambio: { tipo: 'alta', aRef: p.ref, bRef: q.ref, aNombre: p.nombre, bNombre: q.nombre,
      aPersona: p.persona, bPersona: q.persona !== null && q.persona === p.persona ? null : q.persona, despues: [puntos(p), puntos(q)] } };
  };
  // Un tirador guardado dos veces en el cuadro con refs distintas («ALDANA JULIAN N» y «ALDANA
  // JULIAN Naiara»): un alta con una de ellas duplicaría el cruce que ya tiene la otra. (En las
  // poules puede llevar otra ref sin que importe: el cuadro no las mezcla.)
  const conGemelo = (t: TiradorBase) => [...enCuadro.values()].some((o) => o.ref !== t.ref && mismoTexto(o.nombre, t.nombre));
  let pdfSinGuardar = 0;
  for (const s of pdfSueltos) {
    if (conGemelo(s.a) || conGemelo(s.b)) {
      pdfSinGuardar += 1;
      muestras.push(`tirador_guardado_dos_veces ${texto(s.x)}`);
      continue;
    }
    const cand = sueltosBase().filter((b) => tamano(b.ronda) === s.n && [b.aRef, b.bRef].filter((r) => r === s.a.ref || r === s.b.ref).length === 1);
    if (cand.length === 1) {
      const b = cand[0];
      usados.add(b.id);
      cambios.push({ ronda: b.ronda, evidencia: texto(s.x), cambio: { tipo: 'baja', aRef: b.aRef, bRef: b.bRef, antes: [b.sa, b.sb] } });
      cambios.push(alta(b.ronda, s));
    } else pdfPendientes.push(s);
  }
  // Altas: cruces fiables entre dos tiradores sin ningún asalto guardado en esa ronda.
  const enRonda = (n: number, ref: string) => guardado.some((b) => tamano(b.ronda) === n && !cambios.some((c) => c.cambio.tipo === 'baja' && c.cambio.aRef === b.aRef && c.cambio.bRef === b.bRef && c.ronda === b.ronda) && (b.aRef === ref || b.bRef === ref))
    || cambios.some((c) => c.cambio.tipo === 'alta' && tamano(c.ronda) === n && (c.cambio.aRef === ref || c.cambio.bRef === ref));
  for (const s of pdfPendientes) {
    if (enRonda(s.n, s.a.ref) || enRonda(s.n, s.b.ref)) { pdfSinGuardar += 1; muestras.push(`pdf_sin_guardar ${texto(s.x)}`); continue; }
    cambios.push(alta(`${prefijo}${s.n}`, s));
  }
  // Bajas solas: sólo con el cuadro entero leído, validado y casado.
  const pdfEntero = pdf.completo && fallosPdf.length === 0 && sinTirador === 0 && noFiables === 0 && fiables.size === delPdf.length;
  let guardadosSinPareja = 0;
  for (const b of sueltosBase()) {
    if (pdfEntero) cambios.push({ ronda: b.ronda, evidencia: `${pdf.clave}: el cuadro del PDF no publica este cruce`, cambio: { tipo: 'baja', aRef: b.aRef, bRef: b.bRef, antes: [b.sa, b.sb] } });
    else { guardadosSinPareja += 1; muestras.push(`guardado_sin_pareja ${b.ronda} ${b.aNombre} ${b.sa}-${b.sb} ${b.bNombre}`); }
  }
  const otros = guardado.filter((b) => tamano(b.ronda) === null).length;
  guardadosSinPareja += otros;

  // El cuadro guardado con las correcciones, frente a sí mismo y a la clasificación del PDF.
  const quitados = new Set(cambios.flatMap((c) => (c.cambio.tipo === 'baja' ? [`${c.ronda}|${c.cambio.aRef}|${c.cambio.bRef}`] : [])));
  const nuevo = new Map(cambios.flatMap((c) => (c.cambio.tipo === 'marcador' ? [[`${c.ronda}|${c.cambio.aRef}|${c.cambio.bRef}`, c.cambio.despues] as const] : [])));
  type B = { ronda: string; aRef: string; bRef: string; sa: number; sb: number; tocado: boolean };
  const antes: B[] = guardado.map((b) => ({ ronda: b.ronda, aRef: b.aRef, bRef: b.bRef, sa: b.sa, sb: b.sb, tocado: false }));
  const despues: B[] = [
    ...antes.filter((b) => !quitados.has(`${b.ronda}|${b.aRef}|${b.bRef}`)).map((b) => {
      const d = nuevo.get(`${b.ronda}|${b.aRef}|${b.bRef}`);
      return d ? { ...b, sa: d[0], sb: d[1], tocado: true } : b;
    }),
    ...cambios.flatMap((c) => (c.cambio.tipo === 'alta' ? [{ ronda: c.ronda, aRef: c.cambio.aRef, bRef: c.cambio.bRef, sa: c.cambio.despues[0], sb: c.cambio.despues[1], tocado: true }] : [])),
  ];
  // Sin el prefijo de la otra familia: auditarCuadro mide una familia de rondas como el cuadro principal.
  const comoA = (l: B[]) => l.map((b) => ({ ...b, ronda: fam === 'B' ? `A${b.ronda.slice(1)}` : b.ronda }));
  const puesto = (r: string) => (previa ? undefined : posBase.get(r));
  const iAntes = auditarCuadro(comoA(antes), puesto).incoherentes;
  const iDespues = auditarCuadro(comoA(despues), puesto).incoherentes;
  const tocadoIncoherente = despues.some((b, i) => b.tocado && iDespues.has(i));
  const pendientes = { noFiables, sinTirador, guardadosSinPareja, pdfSinGuardar, incoherentesDespues: iDespues.size, muestras: muestras.slice(0, 8) };
  if (cambios.length > 0 && (tocadoIncoherente || iDespues.size > iAntes.size)) {
    return { estado: 'dudoso', motivo: 'correccion_empeora_coherencia', cambios: [], pendientes: { ...pendientes, incoherentesDespues: iAntes.size }, pdfEntero,
      detalle: cambios.slice(0, 6).map((c) => ({ ronda: c.ronda, ...c.cambio, evidencia: c.evidencia })) };
  }
  const limpio = noFiables === 0 && sinTirador === 0 && guardadosSinPareja === 0 && pdfSinGuardar === 0 && iDespues.size === 0;
  const motivo = limpio ? null
    : noFiables > 0 ? `${noFiables}_asaltos_pdf_no_fiables`
      : sinTirador > 0 ? `${sinTirador}_asaltos_pdf_con_tirador_no_casado`
        : guardadosSinPareja > 0 ? `${guardadosSinPareja}_asaltos_sin_pareja_en_el_cuadro_pdf`
          : pdfSinGuardar > 0 ? `${pdfSinGuardar}_asaltos_pdf_sin_guardar`
            : 'cuadro_corregido_sigue_incoherente';
  return { estado: limpio ? (cambios.length > 0 ? 'corregido' : 'coincide') : 'dudoso', motivo, cambios, pendientes, pdfEntero };
}

/** La prueba del PDF cuyo cuadro casa con más tiradores del cuadro guardado (y al menos con 3 de cada 4). */
export function elegirPrueba(guardado: readonly AsaltoBase[], pruebas: readonly CuadroPdf[]): CuadroPdf | null {
  const nombres = [...new Set(guardado.flatMap((b) => [b.aNombre, b.bNombre]))];
  const orden = pruebas.filter((p) => p.cuadro.length > 0).map((p) => {
    const delCuadro = [...new Set(p.cuadro.flatMap((x) => [x.nombreA, x.nombreB]))];
    return { p, n: nombres.filter((x) => delCuadro.some((y) => mismoTexto(x, y))).length };
  }).sort((a, b) => b.n - a.n);
  const [mejor, segunda] = orden;
  if (!mejor || mejor.n < nombres.length * 0.75) return null;
  if (segunda && segunda.n === mejor.n) return null;
  return mejor.p;
}

// ------------------------------------------------------------------ cobertura y salida

export type FaseCuadro12 = {
  competicion: Clave;
  url: string;
  fase: 'TABLEAU';
  ronda: string;
  extractor: string;
  cambios: CambioCuadro[];
  evidencia: { pagina: null; lector: string };
};
/**
 * `completo` cuando el cuadro guardado queda igual que el del PDF: vuelve a `completo` lo que bajaron
 * los lotes 10 u 11 y, con `pdfEntero` (el PDF publica el cuadro entero y se leyó todo), también lo
 * que la carga dejó parcial por cruces sin leer. `parcial` actualiza el motivo de los lotes 10-12.
 */
export type AccionCobertura12 = { competicion: Clave; kind: 'tableau'; estado: 'parcial' | 'completo'; motivo: string | null; pdfEntero?: boolean };
export type Correcciones12 = { generado: string; base: string; fases: FaseCuadro12[]; cobertura: AccionCobertura12[] };

export function agruparFases(competicion: Clave, url: string, extractor: string, clave: string, cambios: readonly CambioRonda[]): FaseCuadro12[] {
  const porRonda = new Map<string, CambioRonda[]>();
  for (const c of cambios) (porRonda.get(c.ronda) ?? porRonda.set(c.ronda, []).get(c.ronda)!).push(c);
  return [...porRonda].map(([ronda, l]) => ({ competicion, url, fase: 'TABLEAU' as const, ronda, extractor, cambios: l.map((c) => c.cambio),
    evidencia: { pagina: null, lector: `${clave}: ${[...new Set(l.map((c) => c.evidencia))].join('; ')}`.slice(0, 2000) } }));
}

type Competicion = { id: string; source: string; season: string; competition_key: string; format: string; weapon: string | null; gender: string | null };
type DudaCuadro11 = { competicion: Clave; kind: 'tableau'; ronda: string; motivo: string; url: string; antes: string };

const ARMAS = new Set(['ESPADA', 'FLORETE', 'SABLE']);
const GENEROS = new Set(['M', 'F', 'MIXTO']);

async function main(): Promise<void> {
  const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo12.sqlite'));
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const previo = argumento('previo', CARPETA_CORRECCION_11);
  const salida = argumento('salida', CARPETA_CORRECCION_12);
  const inf11 = JSON.parse(readFileSync(join(previo, '_informe.json'), 'utf8')) as { listaDudasCuadro: DudaCuadro11[] };
  const t0 = Date.now();
  const db = new DatabaseSync(rutaDb, { readOnly: true });
  const qComp = db.prepare(`SELECT id, source, season, competition_key, format, weapon, gender FROM sport_competition WHERE source=? AND season=? AND competition_key=?`);
  const qBouts = db.prepare(`SELECT id, competition_id c, phase f, round_key r, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an,
      fencer_b_name bn, fencer_a_person_id ap, fencer_b_person_id bp, score_a sa, score_b sb, source_url u
    FROM sport_bout WHERE source='rfee_pdf' AND competition_id=?`);
  const cargar = (id: string) => (qBouts.all(id) as Record<string, string | number | null>[]).map((r): AsaltoBase => ({
    id: String(r.id), competicion: String(r.c), fase: r.f as AsaltoBase['fase'], ronda: String(r.r), aRef: String(r.ar), bRef: String(r.br),
    aNombre: String(r.an ?? ''), bNombre: String(r.bn ?? ''), aPersona: (r.ap as string) ?? null, bPersona: (r.bp as string) ?? null,
    sa: Number(r.sa), sb: Number(r.sb), url: String(r.u ?? '').split('#')[0],
  }));

  const manifiesto = cargarManifiesto(cache);
  const lecturas = new Map<string, LecturaCuadros | string>();
  const leer = async (u: string, pistas: PistasPrueba) => {
    const k = `${u}|${pistas.arma ?? ''}|${pistas.genero ?? ''}`;
    if (lecturas.has(k)) return lecturas.get(k)!;
    const unidad = manifiesto.get(u);
    let l: LecturaCuadros | string;
    if (!unidad || !existsSync(rutaBlob(cache, unidad))) l = 'pdf_no_en_cache';
    else {
      try { l = await leerCuadros(new Uint8Array(readFileSync(rutaBlob(cache, unidad))), u, pistas); } catch (e) { l = `error:${e instanceof Error ? e.message : String(e)}`.slice(0, 160); }
    }
    lecturas.set(k, l);
    return l;
  };

  const fases: FaseCuadro12[] = [];
  const cobertura: AccionCobertura12[] = [];
  const resueltos: { prueba: string; url: string; antes: string; como: 'corregido' | 'coincide'; cambios: number; familias: number }[] = [];
  const dudosos: { competicion: Clave; url: string; antes: string; motivo: string; pendientes?: unknown; detalle?: unknown }[] = [];
  const parciales: { prueba: string; url: string; antes: string; motivo: string; cambios: number }[] = [];
  const validacion: Record<string, number> = {};

  for (const d of inf11.listaDudasCuadro) {
    const marcar = (motivo: string, extra: { pendientes?: unknown; detalle?: unknown } = {}) => {
      dudosos.push({ competicion: d.competicion, url: d.url, antes: d.motivo, motivo, ...extra });
      if (d.competicion.source !== '?') cobertura.push({ competicion: d.competicion, kind: 'tableau', estado: 'parcial',
        motivo: `lote12: relectura del cuadro del PDF sin evidencia completa (TABLEAU:${motivo})`.slice(0, 500) });
    };
    const comp = d.competicion.source === '?' ? undefined
      : (qComp.get(d.competicion.source, d.competicion.season, d.competicion.competitionKey) as Competicion | undefined);
    if (!comp) { dudosos.push({ competicion: d.competicion, url: d.url, antes: d.motivo, motivo: 'cuadro_ya_no_esta_en_la_base' }); continue; }
    const todos = cargar(comp.id);
    const cuadro = todos.filter((b) => b.fase === 'TABLEAU' && b.url === d.url);
    if (cuadro.length === 0) { marcar('cuadro_ya_no_esta_en_la_base'); continue; }
    const pistas: PistasPrueba = {
      arma: comp.weapon && ARMAS.has(comp.weapon) ? (comp.weapon as Arma) : null,
      genero: comp.gender && GENEROS.has(comp.gender) ? (comp.gender as Genero) : null,
    };
    const l = await leer(d.url, pistas);
    if (typeof l === 'string') { marcar(l); continue; }
    for (const p of l.pruebas) for (const f of p.fallos) validacion[f.split(':')[0]] = (validacion[f.split(':')[0]] ?? 0) + 1;
    const tiradores = new Map<string, TiradorBase>();
    for (const b of todos.filter((x) => x.url === d.url)) {
      if (!tiradores.has(b.aRef)) tiradores.set(b.aRef, { ref: b.aRef, nombre: b.aNombre, persona: b.aPersona });
      if (!tiradores.has(b.bRef)) tiradores.set(b.bRef, { ref: b.bRef, nombre: b.bNombre, persona: b.bPersona });
    }
    const familias = [...new Set(cuadro.map((b) => familia(b.ronda)))].sort();
    const extractor = [...new Set(cuadro.flatMap((b) => [extractorDe(b.aRef), extractorDe(b.bRef)]))].sort().join('+');
    const porFamilia: { fam: string; prueba: CuadroPdf | null; r: Reconciliacion | null }[] = [];
    for (const fam of familias) {
      const g = cuadro.filter((b) => familia(b.ronda) === fam);
      const prueba = elegirPrueba(g, l.pruebas);
      // Con dos cuadros, `A*` es la fase previa y `B*` la final.
      const previa = fam === 'A' && familias.includes('B');
      porFamilia.push({ fam, prueba, r: prueba ? reconciliarCuadro(g, prueba, [...tiradores.values()], previa) : null });
    }
    // Una prueba del PDF no puede justificar dos familias del cuadro guardado.
    const repetida = porFamilia.length > 1 && new Set(porFamilia.map((x) => x.prueba?.clave)).size < porFamilia.length;
    const sinPrueba = porFamilia.find((x) => !x.prueba);
    if (repetida || (sinPrueba && porFamilia.every((x) => !x.prueba))) {
      const atribuible = l.pruebas.some((p) => p.cuadro.length > 0);
      marcar(repetida ? 'dos_cuadros_con_la_misma_prueba_pdf'
        : !atribuible ? (l.sinAtribuir.length ? `sin_cuadro_pdf:prueba_no_atribuible (${l.sinAtribuir.join('; ')})` : 'sin_cuadro_pdf') : 'cuadro_pdf_no_casa_con_el_guardado');
      continue;
    }
    const nuevas: FaseCuadro12[] = [];
    let cambios = 0;
    const motivos: string[] = [];
    for (const x of porFamilia) {
      if (!x.prueba || !x.r) { motivos.push(`${x.fam}:cuadro_pdf_no_casa_con_el_guardado`); continue; }
      if (x.r.motivo) motivos.push(`${x.fam}:${x.r.motivo}`);
      if (x.r.cambios.length === 0) continue;
      nuevas.push(...agruparFases(d.competicion, d.url, extractor, x.prueba.clave, x.r.cambios));
      cambios += x.r.cambios.length;
    }
    fases.push(...nuevas);
    if (motivos.length === 0) {
      resueltos.push({ prueba: d.competicion.competitionKey, url: d.url, antes: d.motivo, como: cambios > 0 ? 'corregido' : 'coincide', cambios, familias: familias.length });
      cobertura.push({ competicion: d.competicion, kind: 'tableau', estado: 'completo', motivo: null,
        pdfEntero: porFamilia.every((x) => x.r?.pdfEntero === true) });
    } else {
      if (cambios > 0) parciales.push({ prueba: d.competicion.competitionKey, url: d.url, antes: d.motivo, motivo: motivos.join(', '), cambios });
      marcar(motivos.join(', '), { pendientes: porFamilia.map((x) => ({ fam: x.fam, prueba: x.prueba?.clave ?? null, fallosPdf: x.prueba?.fallos ?? null, ...x.r?.pendientes })),
        detalle: porFamilia.flatMap((x) => (x.r?.detalle ? [x.r.detalle] : [])) });
    }
  }
  db.close();

  const causa = (motivo: string) => motivo.split(', ')[0].replace(/^[AB]:/, '').split(/[:(]/)[0].trim().replace(/^\d+_/, 'n_');
  const cuenta = (l: { motivo: string }[]) => l.reduce<Record<string, number>>((o, x) => ({ ...o, [causa(x.motivo)]: (o[causa(x.motivo)] ?? 0) + 1 }), {});
  const porCausa = (como: string) => resueltos.filter((x) => x.como === como).reduce<Record<string, number>>((o, x) => ({ ...o, [x.antes]: (o[x.antes] ?? 0) + 1 }), {});
  const inf = {
    generado: new Date().toISOString(),
    base: rutaDb,
    casos: inf11.listaDudasCuadro.length,
    pdfs: { lecturas: [...lecturas.values()].filter((x) => typeof x !== 'string').length, fallos: [...lecturas.values()].filter((x) => typeof x === 'string').length },
    cuadros: {
      corregidos: resueltos.filter((x) => x.como === 'corregido').length,
      coinciden: resueltos.filter((x) => x.como === 'coincide').length,
      corregidosPorCausaPrevia: porCausa('corregido'),
      coincidenPorCausaPrevia: porCausa('coincide'),
      conCorreccionParcial: parciales.length,
      siguenDudosos: dudosos.length,
      motivosDudosos: cuenta(dudosos),
      motivosDudososPorCausaPrevia: dudosos.reduce<Record<string, number>>((o, x) => ({ ...o, [`${x.antes} -> ${causa(x.motivo)}`]: (o[`${x.antes} -> ${causa(x.motivo)}`] ?? 0) + 1 }), {}),
    },
    validacionCuadrosPdf: validacion,
    correcciones: {
      fases: fases.length,
      cambios: fases.flatMap((f) => f.cambios.map((c) => `TABLEAU:${c.tipo}`)).reduce<Record<string, number>>((o, x) => ({ ...o, [x]: (o[x] ?? 0) + 1 }), {}),
    },
    cobertura: { parcial: cobertura.filter((c) => c.estado === 'parcial').length, completo: cobertura.filter((c) => c.estado === 'completo').length },
    listaResueltos: resueltos,
    listaParciales: parciales,
    listaDudosos: dudosos,
    segundos: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(salida, { recursive: true });
  const corr: Correcciones12 = { generado: inf.generado, base: rutaDb, fases, cobertura };
  writeFileSync(join(salida, '_correcciones.json'), JSON.stringify(corr, null, 1));
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 1));
  const { listaResueltos, listaParciales, listaDudosos, ...resumen } = inf;
  void listaResueltos; void listaParciales; void listaDudosos;
  console.log(JSON.stringify(resumen, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
