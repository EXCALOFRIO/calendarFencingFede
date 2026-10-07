/**
 * Lote 11: vuelve a contrastar con el lector de poules mejorado las fases `rfee_pdf` que
 * `lote10-pdf-auditar.ts` dejó sin evidencia (`listaDudosas` y `listaDudasCuadro` de su
 * `_informe.json`). Sólo lee la base (abierta en sólo lectura) y la caché de PDF.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote11-pdf-auditar.ts \
 *     [--db <nuevo11.sqlite>] [--cache <cache-rfee-2018>] [--previo <hechos/lote10-correccion-pdf>] \
 *     [--salida <hechos/lote11-correccion-pdf>]
 *
 * Misma regla de evidencia que el lote 10 (matriz entera determinada, V/M, TD e índice que
 * cuadran, todas sus filas casadas con tiradores guardados distintos), y dos exigencias más:
 *  - una victoria por prioridad con los tocados iguales («V3» frente a «3») no se puede guardar
 *    sólo con el marcador: la poule queda dudosa;
 *  - un tirador guardado sin fila en la matriz sólo pierde sus asaltos si el PDF lo da por
 *    retirado (DNS, abandono, exclusión): sus cruces están anulados.
 * Salida: `_correcciones.json` (fases en el formato de `lote10-pdf-sustituir.ts` y la cobertura que
 * aplica `lote11-pdf-sustituir.ts`) e `_informe.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { consistenciaCuadro } from '../../src/lib/ingest/hechos/cuadro-consistencia';
import { dividirPaginaPorPruebas } from '../../src/lib/ingest/sources/rfee-pdf/bloques';
import { docIdLegadoDeUrl, extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { analizarPagina, type PaginaAnalizada } from '../../src/lib/ingest/sources/rfee-pdf/paginas';
import { leerMatricesPoules, type PouleLeida } from '../../src/lib/ingest/sources/rfee-pdf/poules';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO } from './comun';
import {
  asignarNombres, auditarCuadro, CARPETA_CORRECCION, contrastarCuadro, contrastarPoule, extractorDe, mismoTexto,
  tiradoresDe, topeDe, type AsaltoBase, type Contraste, type CorreccionFase, type LecturaRelectura, type PoulePdf,
} from './lote10-pdf-auditar';
import { cargarManifiesto, rutaBlob } from './pdf-relectura-objetivos';

export const CARPETA_CORRECCION_11 = join(CARPETA_TRABAJO, 'hechos', 'lote11-correccion-pdf');

/** `prueba`: firma de la cabecera de sus páginas; dos poules con la misma firma son de la misma prueba. */
export type PoulePdf11 = PoulePdf & { retirados: string[]; prioridad: number; prueba: string };
/** `sinAtribuir`: motivos de las pruebas del documento que el lector no atribuye (sin puestos ni cuadro). */
export type Lectura11 = Omit<LecturaRelectura, 'poules'> & { poules: PoulePdf11[]; sinAtribuir?: string[] };

export const poulePdf = (p: PouleLeida, prueba = ''): PoulePdf11 => ({
  pagina: p.reg.pagina, yMax: p.reg.yMax, ronda: p.ronda, filas: p.filas, sinResolver: p.matriz.sinResolver,
  celdas: p.matriz.celdas.map((f) => f.map((c) => ({ gana: c.gana, puntos: c.puntos }))),
  retirados: p.retirados.map((r) => r.nombre), prioridad: p.matriz.prioridad, prueba,
});

export type CambioTraslado = { tipo: 'traslado'; aRef: string; bRef: string; desde: string; antes: [number, number]; despues: [number, number] };
/** Fase del lote 10 que además puede llevar asaltos guardados en otra ronda de la misma prueba. */
export type CorreccionFase11 = Omit<CorreccionFase, 'cambios'> & { cambios: (CorreccionFase['cambios'][number] | CambioTraslado)[] };

/** `releer` del lote 10 con los retirados y las victorias por prioridad de cada matriz. */
export async function releer11(bytes: Uint8Array, url: string): Promise<Lectura11> {
  const { paginas } = await extraerPaginas(bytes);
  const analizadas = paginas.flatMap(dividirPaginaPorPruebas).map(analizarPagina);
  const grupos = new Map<string, PaginaAnalizada[]>();
  for (const p of analizadas) {
    if (p.firma === '' || p.tipo !== 'poules') continue;
    (grupos.get(p.firma) ?? grupos.set(p.firma, []).get(p.firma)!).push(p);
  }
  const poules: PoulePdf11[] = [];
  const rechazadas: Lectura11['rechazadas'] = [];
  for (const [firma, g] of grupos) {
    for (const l of leerMatricesPoules(g).lecturas) {
      if ('matriz' in l) poules.push(poulePdf(l, firma));
      else if (l.region) rechazadas.push({ pagina: l.region.pagina, motivo: l.motivo, nombres: (l.filas ?? []).map((f) => f.nombre) });
    }
  }
  const lectura = leerResultadosPdf(paginas, { url, docId: docIdLegadoDeUrl(url) });
  const pruebas = lectura.pruebas.filter((p) => p.formato === 'INDIVIDUAL').map((p) => {
    const cuadro = p.asaltos.filter((a) => a.fase === 'TABLEAU');
    const c = consistenciaCuadro(cuadro.map((a) => ({ roundKey: a.ronda, aRef: a.refA, bRef: a.refB, scoreA: a.puntosA, scoreB: a.puntosB })));
    return { clave: p.clave, cuadro, cuadroCompleto: p.cobertura.cuadro.estado === 'completo', cuadroCoherente: c.incoherentes.size === 0,
      nombres: p.puestos.map((x) => x.nombre) };
  });
  const sinAtribuir = lectura.pruebas.filter((p) => p.estado === 'pendiente')
    .flatMap((p) => p.rechazos.filter((r) => r.seccion === 'prueba').map((r) => r.motivo));
  return { poules, rechazadas, pruebas, sinAtribuir: [...new Set(sinAtribuir)] };
}

// ------------------------------------------------------------------ decisión por poule

export type DecisionPoule =
  | { tipo: 'corregir'; contraste: Contraste }
  | { tipo: 'coincide'; contraste: Contraste }
  | { tipo: 'dudosa'; motivo: string; contraste: Contraste | null; detalle?: unknown };

/**
 * Tiradores guardados que no casan con ninguna fila de la matriz elegida: deben ser, cada uno,
 * uno distinto de los retirados que publica la poule.
 */
export function sobrantesSonRetirados(asaltos: readonly AsaltoBase[], pdf: PoulePdf11): boolean {
  const nombres = [...tiradoresDe(asaltos).values()].map((t) => t.nombre);
  const enMatriz = asignarNombres(nombres, pdf.filas.map((f) => f.nombre));
  const sueltos = nombres.filter((_, i) => enMatriz[i] === null);
  if (sueltos.length === 0) return true;
  const aRetirados = asignarNombres(sueltos, pdf.retirados);
  return aRetirados.every((x) => x !== null);
}

export function decidirPoule(asaltos: readonly AsaltoBase[], l: Lectura11, variasFuentes: boolean): DecisionPoule {
  const c = contrastarPoule(asaltos, l.poules);
  if (c.estado === 'sin_pareja_pdf') {
    const nombres = [...tiradoresDe(asaltos).values()].map((t) => t.nombre);
    const ilegible = l.rechazadas.find((r) => r.nombres.length === 0 || asignarNombres(nombres, r.nombres).filter((x) => x !== null).length >= 2);
    return { tipo: 'dudosa', motivo: ilegible ? `poule_pdf_rechazada:${ilegible.motivo}` : 'sin_pareja_pdf', contraste: null };
  }
  const pdf = c.pdf as PoulePdf11;
  if (pdf.prioridad > 0) return { tipo: 'dudosa', motivo: 'victoria_por_prioridad_con_tocados_iguales', contraste: c };
  if (c.estado === 'coincide') return { tipo: 'coincide', contraste: c };
  if (c.estado === 'coincide_parcial') return { tipo: 'dudosa', motivo: 'pdf_con_victorias_sin_tanteo', contraste: c };
  if (variasFuentes) return { tipo: 'dudosa', motivo: 'varias_fuentes', contraste: c };
  if (!c.completa) {
    return { tipo: 'dudosa', motivo: pdf.sinResolver > 0 ? 'pdf_con_victorias_sin_tanteo' : 'pdf_con_filas_sin_tirador_guardado', contraste: c,
      detalle: c.diferencias.slice(0, 8) };
  }
  if (!sobrantesSonRetirados(asaltos, pdf)) return { tipo: 'dudosa', motivo: 'tirador_guardado_sin_fila_en_el_pdf', contraste: c, detalle: c.diferencias.slice(0, 8) };
  return { tipo: 'corregir', contraste: c };
}

const celdaTexto = (c: { gana: boolean; puntos: number | null }) => (c.gana ? `V${c.puntos ?? '?'}` : String(c.puntos ?? '?'));

export function correccionPoule(
  comp: { source: string; season: string; competition_key: string },
  asaltos: readonly AsaltoBase[],
  ronda: string,
  url: string,
  c: Contraste,
): CorreccionFase {
  const tir = tiradoresDe(asaltos);
  const extractor = [...new Set(asaltos.flatMap((b) => [extractorDe(b.aRef), extractorDe(b.bRef)]))].sort().join('+');
  return {
    competicion: { source: comp.source, season: comp.season, competitionKey: comp.competition_key },
    url, fase: 'POULE', ronda, extractor,
    cambios: c.diferencias.map((d) => {
      if (d.tipo === 'marcador') return { tipo: 'marcador' as const, aRef: d.aRef, bRef: d.bRef, antes: d.antes, despues: d.despues };
      if (d.tipo === 'sobra') return { tipo: 'baja' as const, aRef: d.aRef, bRef: d.bRef, antes: d.antes };
      const [a, b, sa, sb] = d.aRef! < d.bRef! ? [d.aRef!, d.bRef!, d.despues![0], d.despues![1]] : [d.bRef!, d.aRef!, d.despues![1], d.despues![0]];
      return { tipo: 'alta' as const, aRef: a, bRef: b, aNombre: tir.get(a)!.nombre, bNombre: tir.get(b)!.nombre,
        aPersona: tir.get(a)!.persona, bPersona: tir.get(b)!.persona, despues: [sa, sb] as [number, number] };
    }),
    evidencia: { pagina: c.pdf!.pagina, yMax: c.pdf!.yMax,
      filas: c.pdf!.filas.map((x) => ({ nombre: x.nombre, club: x.club, vm: x.vm, ind: x.ind, td: x.td })),
      matriz: c.pdf!.celdas.map((fila, i) => fila.map((x, j) => (i === j ? '-' : celdaTexto(x))).join(' ')) },
  };
}

// ------------------------------------------------------------------ vueltas guardadas juntas

/**
 * Una poule guardada `Pn` que reúne la poule n de la primera vuelta y la n de otra vuelta de la
 * misma prueba (la lectura antigua no distinguía vueltas). Se separa sólo si cada matriz casa
 * entera con tiradores guardados distintos, cada asalto guardado cae dentro de una sola de ellas,
 * cada parte cuadra con su matriz según la regla del lote 10 y la ronda de destino está vacía.
 * La parte de la otra vuelta se traslada a su ronda (`V2Pn`) con el marcador del PDF.
 */
export function separarVueltas(
  asaltos: readonly AsaltoBase[],
  l: Lectura11,
  rondasOcupadas: ReadonlySet<string>,
): { partes: { pdf: PoulePdf11; asaltos: AsaltoBase[]; contraste: Contraste }[] } | string {
  const ronda = asaltos[0]?.ronda ?? '';
  const n = /^P(\d+)$/.exec(ronda)?.[1];
  if (!n) return 'no_es_primera_vuelta';
  const otraVuelta = new RegExp(`^V\\d+P${n}$`);
  const tir = tiradoresDe(asaltos);
  const refs = [...tir.keys()];
  const nombres = refs.map((r) => tir.get(r)!.nombre);
  const pruebas = new Set(l.poules.filter((p) => p.ronda === ronda).map((p) => p.prueba));
  const opciones: { pdf: PoulePdf11; refs: Set<string> }[][] = [];
  for (const prueba of pruebas) {
    const poules = l.poules.filter((p) => p.prueba === prueba && (p.ronda === ronda || otraVuelta.test(p.ronda)));
    if (poules.filter((p) => p.ronda === ronda).length !== 1 || poules.length < 2) continue;
    const casadas = poules.map((pdf) => {
      const a = asignarNombres(pdf.filas.map((f) => f.nombre), nombres);
      return a.every((x) => x !== null) ? { pdf, refs: new Set(a.map((x) => refs[x!])) } : null;
    });
    // Sólo las matrices que casan enteras; las otras vueltas sin ningún tirador guardado no cuentan.
    const enteras = casadas.filter((x): x is { pdf: PoulePdf11; refs: Set<string> } => x !== null);
    if (enteras.length >= 2 && enteras.some((x) => x.pdf.ronda === ronda)) opciones.push(enteras);
  }
  if (opciones.length !== 1) return opciones.length === 0 ? 'sin_vueltas_que_casen' : 'varias_pruebas_casan';
  const partes = opciones[0];
  if (refs.some((r) => !partes.some((p) => p.refs.has(r)))) return 'tirador_guardado_fuera_de_las_vueltas';
  const porParte = partes.map(() => [] as AsaltoBase[]);
  for (const b of asaltos) {
    const k = partes.flatMap((p, i) => (p.refs.has(b.aRef) && p.refs.has(b.bRef) ? [i] : []));
    if (k.length !== 1) return k.length === 0 ? 'asalto_guardado_entre_vueltas' : 'asalto_guardado_en_dos_vueltas';
    porParte[k[0]].push(b);
  }
  const out: { pdf: PoulePdf11; asaltos: AsaltoBase[]; contraste: Contraste }[] = [];
  for (const [i, p] of partes.entries()) {
    if (p.pdf.ronda !== ronda && rondasOcupadas.has(p.pdf.ronda)) return 'ronda_de_destino_ocupada';
    if (p.pdf.prioridad > 0) return 'victoria_por_prioridad_con_tocados_iguales';
    const c = contrastarPoule(porParte[i], [p.pdf]);
    if (c.pdf !== p.pdf || !(c.estado === 'coincide' || (c.estado === 'difiere' && c.completa))) return `vuelta_${p.pdf.ronda}_sin_evidencia_completa`;
    if (p.pdf.ronda !== ronda && c.diferencias.some((d) => d.tipo === 'sobra')) return 'asalto_repetido_en_la_otra_vuelta';
    out.push({ pdf: p.pdf, asaltos: porParte[i], contraste: c });
  }
  return { partes: out };
}

/** Las fases de una poule separada: la de su vuelta con sus diferencias, las demás trasladadas. */
export function correccionesVueltas(
  comp: { source: string; season: string; competition_key: string },
  ronda: string,
  url: string,
  partes: { pdf: PoulePdf11; asaltos: AsaltoBase[]; contraste: Contraste }[],
): CorreccionFase11[] {
  const fases: CorreccionFase11[] = [];
  for (const p of partes) {
    const base = correccionPoule(comp, p.asaltos, p.pdf.ronda, url, p.contraste);
    if (p.pdf.ronda === ronda) {
      if (base.cambios.length > 0) fases.push(base);
      continue;
    }
    const nuevo = new Map(base.cambios.flatMap((x) => (x.tipo === 'marcador' ? [[`${x.aRef}|${x.bRef}`, x.despues] as const] : [])));
    const traslados: CambioTraslado[] = p.asaltos.map((b) => ({ tipo: 'traslado', aRef: b.aRef, bRef: b.bRef, desde: ronda, antes: [b.sa, b.sb],
      despues: nuevo.get(`${b.aRef}|${b.bRef}`) ?? [b.sa, b.sb] }));
    fases.push({ ...base, cambios: [...traslados, ...base.cambios.filter((x) => x.tipo === 'alta')] });
  }
  return fases;
}

// ------------------------------------------------------------------ cobertura

export type Clave = { source: string; season: string; competitionKey: string };
/** Cobertura que deja el lote: `parcial` con su motivo, o `completo` donde el lote 10 la bajó y ya no queda nada dudoso. */
export type AccionCobertura = { competicion: Clave; kind: 'pools' | 'tableau'; estado: 'parcial' | 'completo'; motivo: string | null };
export type Correcciones11 = { generado: string; base: string; fases: CorreccionFase11[]; parciales: []; cobertura: AccionCobertura[] };

const ronda = (detalle: string) => detalle.split(':')[0];

/**
 * Por prueba y tipo de fase: el detalle de lote 10 menos lo que este lote resuelve, más lo
 * que sigue dudoso. Sin nada pendiente, la cobertura que bajó el lote 10 vuelve a `completo`.
 * Lo que el lote 10 dejó parcial y este lote no cambia no genera acción.
 */
export function planCobertura(
  previas: readonly { competicion: Clave; kind: 'pools' | 'tableau'; detalle: string[] }[],
  resueltas: ReadonlySet<string>,
  dudosas: readonly { competicion: Clave; kind: 'pools' | 'tableau'; ronda: string; motivo: string }[],
): AccionCobertura[] {
  const k = (c: Clave, kind: string) => `${c.source}|${c.season}|${c.competitionKey}|${kind}`;
  const plan = new Map<string, { competicion: Clave; kind: 'pools' | 'tableau'; detalle: string[]; previo: string[] | null }>();
  for (const p of previas) {
    // En el cuadro el detalle es la prueba entera: se resuelve con la clave `TABLEAU`.
    const quedan = p.detalle.filter((d) => !resueltas.has(`${k(p.competicion, p.kind)}|${p.kind === 'tableau' ? 'TABLEAU' : ronda(d)}`));
    plan.set(k(p.competicion, p.kind), { competicion: p.competicion, kind: p.kind, detalle: quedan, previo: p.detalle });
  }
  for (const d of dudosas) {
    const x = plan.get(k(d.competicion, d.kind)) ?? plan.set(k(d.competicion, d.kind), { competicion: d.competicion, kind: d.kind, detalle: [], previo: null }).get(k(d.competicion, d.kind))!;
    const texto = `${d.ronda}:${d.motivo}`;
    x.detalle = [...x.detalle.filter((t) => d.kind === 'tableau' || ronda(t) !== d.ronda), texto];
  }
  const igual = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
  return [...plan.values()]
    .filter((x) => x.previo === null || !igual([...new Set(x.detalle)], [...new Set(x.previo)]))
    .filter((x) => x.detalle.length > 0 || x.previo !== null)
    .map((x) => x.detalle.length === 0
      ? { competicion: x.competicion, kind: x.kind, estado: 'completo' as const, motivo: null }
      : { competicion: x.competicion, kind: x.kind, estado: 'parcial' as const,
        motivo: `lote11: relectura del PDF sin evidencia completa (${[...new Set(x.detalle)].slice(0, 12).join(', ')})`.slice(0, 500) });
}

// ------------------------------------------------------------------ principal

type Competicion = { id: string; source: string; season: string; competition_key: string; format: string };
type InformePrevio = {
  listaDudosas: { prueba: string; ronda: string; url: string; motivo: string }[];
  listaDudasCuadro: { prueba: string; url: string; motivo: string }[];
};

async function main(): Promise<void> {
  const rutaDb = argumento('db', join(CARPETA_TRABAJO, 'nuevo11.sqlite'));
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const previo = argumento('previo', CARPETA_CORRECCION);
  const salida = argumento('salida', CARPETA_CORRECCION_11);
  const inf10 = JSON.parse(readFileSync(join(previo, '_informe.json'), 'utf8')) as InformePrevio;
  const corr10 = JSON.parse(readFileSync(join(previo, '_correcciones.json'), 'utf8')) as { parciales: { competicion: Clave; kind: 'pools' | 'tableau'; detalle: string[] }[] };
  const t0 = Date.now();
  const db = new DatabaseSync(rutaDb, { readOnly: true });

  const claves = [...new Set([...inf10.listaDudosas.map((d) => d.prueba), ...inf10.listaDudasCuadro.map((d) => d.prueba)])];
  const compsPorClave = new Map<string, Competicion[]>();
  const qComp = db.prepare(`SELECT id, source, season, competition_key, format FROM sport_competition WHERE competition_key=?
    AND id IN (SELECT competition_id FROM sport_bout WHERE source='rfee_pdf')`);
  for (const k of claves) compsPorClave.set(k, qComp.all(k) as Competicion[]);
  const qBouts = db.prepare(`SELECT id, competition_id c, phase f, round_key r, fencer_a_ref ar, fencer_b_ref br, fencer_a_name an,
      fencer_b_name bn, fencer_a_person_id ap, fencer_b_person_id bp, score_a sa, score_b sb, source_url u
    FROM sport_bout WHERE source='rfee_pdf' AND competition_id=?`);
  const asaltosDe = new Map<string, AsaltoBase[]>();
  const cargar = (id: string) => asaltosDe.get(id) ?? asaltosDe.set(id, (qBouts.all(id) as Record<string, string | number | null>[]).map((r): AsaltoBase => ({
    id: String(r.id), competicion: String(r.c), fase: r.f as AsaltoBase['fase'], ronda: String(r.r), aRef: String(r.ar), bRef: String(r.br),
    aNombre: String(r.an ?? ''), bNombre: String(r.bn ?? ''), aPersona: (r.ap as string) ?? null, bPersona: (r.bp as string) ?? null,
    sa: Number(r.sa), sb: Number(r.sb), url: String(r.u ?? '').split('#')[0],
  }))).get(id)!;

  const manifiesto = cargarManifiesto(cache);
  const lecturas = new Map<string, Lectura11 | string>();
  const leer = async (u: string) => {
    if (lecturas.has(u)) return lecturas.get(u)!;
    const unidad = manifiesto.get(u);
    let l: Lectura11 | string;
    if (!unidad || !existsSync(rutaBlob(cache, unidad))) l = 'pdf_no_en_cache';
    else {
      try { l = await releer11(new Uint8Array(readFileSync(rutaBlob(cache, unidad))), u); } catch (e) { l = `error:${e instanceof Error ? e.message : String(e)}`.slice(0, 160); }
    }
    lecturas.set(u, l);
    return l;
  };
  const clave = (c: Competicion): Clave => ({ source: c.source, season: c.season, competitionKey: c.competition_key });
  const kc = (c: Clave, kind: string) => `${c.source}|${c.season}|${c.competitionKey}|${kind}`;

  const fases: CorreccionFase11[] = [];
  const resueltas = new Set<string>();
  const dudosas: { competicion: Clave; kind: 'pools' | 'tableau'; ronda: string; motivo: string; url: string; antes: string; detalle?: unknown }[] = [];
  const resueltasLista: { prueba: string; ronda: string; antes: string; como: 'corregida' | 'coincide'; cambios?: number }[] = [];
  const estadisticas = { comparados: 0, marcadoresDistintos: 0, faltan: 0, sobran: 0, poules: 0 };
  /** Por extractor de la lectura guardada: asaltos guardados en poules comparadas y marcadores que el PDF desmiente. */
  const porExtractor: Record<string, { asaltos: number; distintos: number; cambiaGanador: number }> = {};
  const sumar = (c: Contraste, bs: readonly AsaltoBase[]) => {
    if (c.estado === 'sin_pareja_pdf' || c.pdf?.sinResolver !== 0) return;
    estadisticas.poules += 1;
    estadisticas.comparados += c.comparados;
    estadisticas.marcadoresDistintos += c.diferencias.filter((x) => x.tipo === 'marcador').length;
    estadisticas.faltan += c.diferencias.filter((x) => x.tipo === 'falta').length;
    estadisticas.sobran += c.diferencias.filter((x) => x.tipo === 'sobra').length;
    const ext = (b: { aRef: string; bRef: string }) => [...new Set([extractorDe(b.aRef), extractorDe(b.bRef)])].sort().join('+');
    for (const b of bs) (porExtractor[ext(b)] ??= { asaltos: 0, distintos: 0, cambiaGanador: 0 }).asaltos += 1;
    for (const x of c.diferencias) {
      if (x.tipo !== 'marcador') continue;
      porExtractor[ext(x)].distintos += 1;
      if (x.cambiaGanador) porExtractor[ext(x)].cambiaGanador += 1;
    }
  };

  // ---- poules
  for (const d of inf10.listaDudosas) {
    const comp = (compsPorClave.get(d.prueba) ?? []).find((c) => cargar(c.id).some((b) => b.fase === 'POULE' && b.ronda === d.ronda && b.url === d.url));
    if (!comp) { dudosas.push({ competicion: { source: '?', season: '?', competitionKey: d.prueba }, kind: 'pools', ronda: d.ronda, motivo: 'poule_ya_no_esta_en_la_base', url: d.url, antes: d.motivo }); continue; }
    const bs = cargar(comp.id).filter((b) => b.fase === 'POULE' && b.ronda === d.ronda);
    const marcar = (motivo: string, detalle?: unknown) => dudosas.push({ competicion: clave(comp), kind: 'pools', ronda: d.ronda, motivo, url: d.url, antes: d.motivo, detalle });
    if (comp.format !== 'INDIVIDUAL') { marcar('prueba_por_equipos'); continue; }
    const l = await leer(d.url);
    if (typeof l === 'string') { marcar(l); continue; }
    const r = decidirPoule(bs, l, new Set(bs.map((b) => b.url)).size > 1);
    if (r.contraste) sumar(r.contraste, bs);
    if (r.tipo === 'dudosa' && r.motivo === 'sin_pareja_pdf') {
      const ocupadas = new Set(cargar(comp.id).filter((b) => b.fase === 'POULE').map((b) => b.ronda));
      const s = separarVueltas(bs, l, ocupadas);
      if (typeof s === 'string') { marcar(`sin_pareja_pdf:${s}`); continue; }
      const nuevas = correccionesVueltas(comp, d.ronda, d.url, s.partes);
      fases.push(...nuevas);
      resueltas.add(`${kc(clave(comp), 'pools')}|${d.ronda}`);
      resueltasLista.push({ prueba: d.prueba, ronda: d.ronda, antes: d.motivo, como: 'corregida', cambios: nuevas.reduce((t, f) => t + f.cambios.length, 0) });
      for (const p of s.partes) sumar(p.contraste, p.asaltos);
      continue;
    }
    if (r.tipo === 'dudosa') { marcar(r.motivo, r.detalle); continue; }
    resueltas.add(`${kc(clave(comp), 'pools')}|${d.ronda}`);
    if (r.tipo === 'coincide') { resueltasLista.push({ prueba: d.prueba, ronda: d.ronda, antes: d.motivo, como: 'coincide' }); continue; }
    const f = correccionPoule(comp, bs, d.ronda, d.url, r.contraste);
    fases.push(f);
    resueltasLista.push({ prueba: d.prueba, ronda: d.ronda, antes: d.motivo, como: 'corregida', cambios: f.cambios.length });
  }

  // ---- cuadros: la regla del lote 10, con el cuadro que da ahora el lector
  const dudasCuadro: typeof dudosas = [];
  for (const d of inf10.listaDudasCuadro) {
    const comp = (compsPorClave.get(d.prueba) ?? []).find((c) => cargar(c.id).some((b) => b.fase === 'TABLEAU' && b.url === d.url));
    const marcar = (motivo: string, detalle?: unknown) => dudasCuadro.push({ competicion: comp ? clave(comp) : { source: '?', season: '?', competitionKey: d.prueba },
      kind: 'tableau', ronda: 'TABLEAU', motivo, url: d.url, antes: d.motivo, detalle });
    if (!comp) { marcar('cuadro_ya_no_esta_en_la_base'); continue; }
    const todos = cargar(comp.id).filter((b) => b.fase === 'TABLEAU');
    const bs = todos.filter((b) => b.url === d.url);
    const l = await leer(d.url);
    if (typeof l === 'string') { marcar(l); continue; }
    if (bs.some((b) => b.ronda.startsWith('B'))) { marcar('dos_cuadros_no_comparado'); continue; }
    const nombres = [...tiradoresDe(bs).values()].map((t) => t.nombre);
    const prueba = [...l.pruebas].map((p) => ({ p, n: nombres.filter((x) => p.nombres.some((y) => mismoTexto(x, y))).length })).sort((a, b) => b.n - a.n)[0];
    if (!prueba || prueba.n < nombres.length * 0.75 || prueba.p.cuadro.length === 0) {
      marcar(l.sinAtribuir?.length ? `sin_cuadro_pdf:prueba_no_atribuible (${l.sinAtribuir.join('; ')})` : 'sin_cuadro_pdf');
      continue;
    }
    const r = contrastarCuadro(bs, prueba.p.cuadro);
    if (r.difieren.length === 0) {
      // Sin diferencias sólo cuenta como verificado si todo el cuadro guardado tiene pareja en el del PDF.
      if (r.sinPareja.length === 0) { resueltas.add(`${kc(clave(comp), 'tableau')}|TABLEAU`); resueltasLista.push({ prueba: d.prueba, ronda: 'TABLEAU', antes: d.motivo, como: 'coincide' }); }
      else marcar(`${r.sinPareja.length}_asaltos_sin_pareja_en_el_cuadro_pdf`);
      continue;
    }
    const topeCuadro = topeDe(prueba.p.cuadro.map((x) => ({ sa: x.puntosA, sb: x.puntosB })));
    const fiable = prueba.p.cuadroCoherente && r.difieren.every((x) => x.pdf.marcador === 'explicito' &&
      Math.max(...x.despues) <= topeCuadro && Math.min(...x.despues) < Math.max(...x.despues));
    const cambiado = todos.map((b) => { const x = r.difieren.find((y) => y.b.id === b.id); return x ? { ...b, sa: x.despues[0], sb: x.despues[1] } : b; });
    const despues = auditarCuadro(cambiado, () => undefined).incoherentes.size;
    const antes = auditarCuadro(todos, () => undefined).incoherentes.size;
    if (!fiable || despues > antes) {
      marcar(!fiable ? 'cuadro_pdf_no_fiable' : 'correccion_empeora_coherencia',
        r.difieren.slice(0, 5).map((x) => ({ ronda: x.b.ronda, a: x.b.aNombre, b: x.b.bNombre, antes: [x.b.sa, x.b.sb], despues: x.despues })));
      continue;
    }
    const extractor = [...new Set(bs.flatMap((b) => [extractorDe(b.aRef), extractorDe(b.bRef)]))].sort().join('+');
    const porRonda = new Map<string, typeof r.difieren>();
    for (const x of r.difieren) (porRonda.get(x.b.ronda) ?? porRonda.set(x.b.ronda, []).get(x.b.ronda)!).push(x);
    for (const [rk, grupo] of porRonda) {
      fases.push({ competicion: clave(comp), url: d.url, fase: 'TABLEAU', ronda: rk, extractor,
        cambios: grupo.map((x) => ({ tipo: 'marcador' as const, aRef: x.b.aRef, bRef: x.b.bRef, antes: [x.b.sa, x.b.sb] as [number, number], despues: x.despues })),
        evidencia: { pagina: null, lector: `${prueba.p.clave}: ${grupo.map((x) => `${x.pdf.nombreA} ${x.pdf.puntosA}-${x.pdf.puntosB} ${x.pdf.nombreB}`).join('; ')}` } });
    }
    if (r.sinPareja.length === 0 && despues === 0) { resueltas.add(`${kc(clave(comp), 'tableau')}|TABLEAU`); resueltasLista.push({ prueba: d.prueba, ronda: 'TABLEAU', antes: d.motivo, como: 'corregida', cambios: r.difieren.length }); }
    else marcar(r.sinPareja.length > 0 ? `${r.sinPareja.length}_asaltos_sin_pareja_en_el_cuadro_pdf` : 'cuadro_corregido_sigue_incoherente');
  }
  db.close();

  const cobertura = planCobertura(corr10.parciales, resueltas, [...dudosas, ...dudasCuadro].filter((x) => x.competicion.source !== '?'));
  const cuenta = (l: { motivo: string }[]) => l.reduce<Record<string, number>>((o, x) => ({ ...o, [x.motivo.split(':')[0]]: (o[x.motivo.split(':')[0]] ?? 0) + 1 }), {});
  const porCausa = (como: 'corregida' | 'coincide', fase: 'poule' | 'cuadro') => resueltasLista.filter((x) => x.como === como && (fase === 'cuadro') === (x.ronda === 'TABLEAU'))
    .reduce<Record<string, number>>((o, x) => ({ ...o, [x.antes]: (o[x.antes] ?? 0) + 1 }), {});
  const inf = {
    generado: new Date().toISOString(),
    base: rutaDb,
    casos: { poules: inf10.listaDudosas.length, cuadros: inf10.listaDudasCuadro.length },
    pdfs: { leidos: [...lecturas.values()].filter((x) => typeof x !== 'string').length, fallos: [...lecturas.values()].filter((x) => typeof x === 'string').length },
    poules: {
      corregidas: resueltasLista.filter((x) => x.como === 'corregida' && x.ronda !== 'TABLEAU').length,
      coinciden: resueltasLista.filter((x) => x.como === 'coincide' && x.ronda !== 'TABLEAU').length,
      siguenDudosas: dudosas.length,
      corregidasPorCausaPrevia: porCausa('corregida', 'poule'),
      coincidenPorCausaPrevia: porCausa('coincide', 'poule'),
      motivosDudosas: cuenta(dudosas),
      contraste: { ...estadisticas, tasaAsaltos: +(estadisticas.marcadoresDistintos / Math.max(1, estadisticas.comparados)).toFixed(5), porExtractor },
    },
    cuadros: {
      corregidos: resueltasLista.filter((x) => x.como === 'corregida' && x.ronda === 'TABLEAU').length,
      coinciden: resueltasLista.filter((x) => x.como === 'coincide' && x.ronda === 'TABLEAU').length,
      siguenDudosos: dudasCuadro.length,
      motivosDudosos: cuenta(dudasCuadro),
    },
    correcciones: {
      fases: fases.length,
      cambios: fases.flatMap((f) => f.cambios.map((c) => `${f.fase}:${c.tipo}`)).reduce<Record<string, number>>((o, x) => ({ ...o, [x]: (o[x] ?? 0) + 1 }), {}),
    },
    cobertura: { parcial: cobertura.filter((c) => c.estado === 'parcial').length, completo: cobertura.filter((c) => c.estado === 'completo').length },
    listaResueltas: resueltasLista,
    listaDudosas: dudosas,
    listaDudasCuadro: dudasCuadro,
    segundos: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(salida, { recursive: true });
  const corr: Correcciones11 = { generado: inf.generado, base: rutaDb, fases, parciales: [], cobertura };
  writeFileSync(join(salida, '_correcciones.json'), JSON.stringify(corr, null, 1));
  writeFileSync(join(salida, '_informe.json'), JSON.stringify(inf, null, 1));
  const { listaResueltas, listaDudosas, listaDudasCuadro, ...resumen } = inf;
  void listaResueltas; void listaDudosas; void listaDudasCuadro;
  console.log(JSON.stringify(resumen, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
