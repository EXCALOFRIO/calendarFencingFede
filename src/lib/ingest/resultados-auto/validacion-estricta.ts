/**
 * Comprobaciones que una extracción hecha por IA tiene que pasar ENTERAS para escribirse. A
 * diferencia de `validarExtraccion` (que descarta filas dudosas y deja la sección «parcial»),
 * aquí un solo fallo bloquea la prueba: queda en la cola de revisión y no se escribe nada.
 *
 *  - Ningún descarte de `validarExtraccion` (nombres que no están en el texto del PDF,
 *    marcadores imposibles, rondas inválidas, cuadro incoherente...).
 *  - Poules: todos los asaltos de cada poule (n·(n−1)/2) y, por tirador, victorias, tocados
 *    dados y recibidos (y por tanto el índice) iguales a los del resumen que imprime el PDF.
 *  - Cuadro coherente con la clasificación: el ganador de la final es el 1, el finalista el 2,
 *    los semifinalistas el 3, y quien pierde en la tabla de N queda entre N/2+1 y N; todos los
 *    del cuadro están en la clasificación.
 *  - Clasificación individual completa: posiciones desde 1 y sin nombres repetidos.
 */
import type { HechosPrueba } from '../hechos/formato';
import { arr, compacto, int, str, type ResultadoValidacion } from '../hechos/pdf-validacion';
import { consistenciaCuadro } from '../hechos/cuadro-consistencia';

export type FalloEstricto = { prueba: string; motivo: string; detalle?: string };

type PouleCruda = {
  pool?: unknown;
  fencers?: unknown;
  bouts?: unknown;
  summary?: unknown;
};

const tamano = (ronda: string) => Number(/^T(\d+)/.exec(ronda)?.[1] ?? NaN);

function ganador(b: { scoreA: number; scoreB: number; winner: 'A' | 'B' | null }): 'A' | 'B' | null {
  if (b.winner) return b.winner;
  return b.scoreA === b.scoreB ? null : b.scoreA > b.scoreB ? 'A' : 'B';
}

/** Poules de la respuesta cruda frente a su propio resumen impreso. */
export function comprobarPoules(poules: readonly PouleCruda[], individual: boolean): string[] {
  const fallos: string[] = [];
  for (const [i, p] of poules.entries()) {
    const etiqueta = `poule_${int(p.pool) ?? i + 1}`;
    const tiradores = arr(p.fencers).map(str).filter((s): s is string => s !== null);
    const n = tiradores.length;
    const bouts = arr(p.bouts) as Record<string, unknown>[];
    if (n < 2) { fallos.push(`${etiqueta}:sin_tiradores`); continue; }
    if (individual && bouts.length !== (n * (n - 1)) / 2) {
      fallos.push(`${etiqueta}:asaltos_${bouts.length}_de_${(n * (n - 1)) / 2}`);
      continue;
    }
    const resumen = arr(p.summary) as Record<string, unknown>[];
    if (!individual) continue;
    if (resumen.length !== n) { fallos.push(`${etiqueta}:sin_resumen_completo`); continue; }
    const cuenta = new Map(tiradores.map((t) => [compacto(t), { v: 0, td: 0, tr: 0 }]));
    for (const b of bouts) {
      const a = compacto(str(b.aName) ?? '');
      const c = compacto(str(b.bName) ?? '');
      const sa = int(b.scoreA);
      const sb = int(b.scoreB);
      const w = str(b.winner)?.toUpperCase() ?? null;
      const ca = cuenta.get(a);
      const cb = cuenta.get(c);
      if (!ca || !cb || sa === null || sb === null) { fallos.push(`${etiqueta}:asalto_fuera_de_poule`); break; }
      const g = ganador({ scoreA: sa, scoreB: sb, winner: w === 'A' || w === 'B' ? w : null });
      if (!g) { fallos.push(`${etiqueta}:asalto_sin_ganador`); break; }
      ca.td += sa; ca.tr += sb; cb.td += sb; cb.tr += sa;
      if (g === 'A') ca.v += 1; else cb.v += 1;
    }
    for (const r of resumen) {
      const c = cuenta.get(compacto(str(r.name) ?? ''));
      const v = int(r.victories);
      const td = int(r.touchesScored);
      const tr = int(r.touchesReceived);
      if (!c) { fallos.push(`${etiqueta}:resumen_tirador_desconocido`); break; }
      if (v !== c.v || td !== c.td || tr !== c.tr) { fallos.push(`${etiqueta}:resumen_no_cuadra`); break; }
      const indice = r.index === undefined || r.index === null ? null : Number(r.index);
      if (indice !== null && indice !== c.td - c.tr) { fallos.push(`${etiqueta}:indice_no_cuadra`); break; }
    }
  }
  return fallos;
}

/** Cuadro individual frente a la clasificación final de la misma prueba. */
export function comprobarCuadroClasificacion(h: HechosPrueba): string[] {
  if (h.competition.format !== 'INDIVIDUAL') return [];
  const cuadro = h.bouts.filter((b) => b.phase === 'TABLEAU');
  if (cuadro.length === 0 || h.results.length === 0) return [];
  const pos = new Map<string, number | null>();
  for (const r of h.results) pos.set(compacto(r.name), r.position);
  const fallos: string[] = [];
  let mayor = 0;
  for (const b of cuadro) {
    const n = tamano(b.roundKey);
    const g = ganador(b);
    if (!g) { fallos.push(`cuadro_sin_ganador_${b.roundKey}`); continue; }
    const pa = pos.get(compacto(b.aName));
    const pb = pos.get(compacto(b.bName));
    if (pa === undefined || pb === undefined) { fallos.push(`cuadro_tirador_sin_puesto_${b.roundKey}`); continue; }
    if (b.roundKey === 'T2-3') continue;
    mayor = Math.max(mayor, n);
    const [pg, pp] = g === 'A' ? [pa, pb] : [pb, pa];
    if (pp === null || pg === null) { fallos.push(`cuadro_puesto_nulo_${b.roundKey}`); continue; }
    if (n === 2) {
      if (pg !== 1 || pp !== 2) fallos.push('final_no_cuadra_con_clasificacion');
    } else if (n === 4) {
      if (pp !== 3 && pp !== 4) fallos.push('semifinal_no_cuadra_con_clasificacion');
      if (pg > 2) fallos.push('semifinal_ganador_no_finalista');
    } else if (pp < n / 2 + 1 || pp > n) {
      fallos.push(`perdedor_${b.roundKey}_fuera_de_su_tramo`);
    }
  }
  // Every fencer ranked inside the first table entered it; a bye still fences the next round.
  if (mayor > 0) {
    const enCuadro = new Set(cuadro.flatMap((b) => [compacto(b.aName), compacto(b.bName)]));
    const faltan = h.results.filter((r) => r.position !== null && r.position <= mayor && !enCuadro.has(compacto(r.name)));
    if (faltan.length > 0) fallos.push('clasificados_del_cuadro_que_no_tiran');
  }
  return [...new Set(fallos)];
}

export function comprobarClasificacion(h: HechosPrueba): string[] {
  if (h.results.length === 0) return ['sin_clasificacion'];
  const fallos: string[] = [];
  const numericas = h.results.map((r) => r.position).filter((p): p is number => p !== null);
  if (numericas.length && Math.min(...numericas) !== 1) fallos.push('clasificacion_no_empieza_en_1');
  if (h.competition.format === 'INDIVIDUAL') {
    const nombres = h.results.map((r) => compacto(r.name));
    if (new Set(nombres).size !== nombres.length) fallos.push('clasificacion_nombres_repetidos');
  }
  return fallos;
}

/**
 * Veredicto completo de una extracción por IA ya pasada por `validarExtraccion`. `crudo` es la
 * respuesta del modelo (para las poules con su resumen). Vacío = se puede escribir.
 */
export function veredictoEstricto(v: ResultadoValidacion, crudo: unknown): FalloEstricto[] {
  const fallos: FalloEstricto[] = [];
  if (v.sinTexto) fallos.push({ prueba: '*', motivo: 'pdf_sin_texto' });
  for (const p of v.problemas) fallos.push({ prueba: '*', motivo: 'problema_validacion', detalle: p.slice(0, 120) });
  for (const [motivo, n] of Object.entries(v.descartes)) {
    if (n > 0) fallos.push({ prueba: '*', motivo: `descarte:${motivo}`, detalle: String(n) });
  }
  if (v.hechos.length === 0) fallos.push({ prueba: '*', motivo: 'sin_pruebas_validas' });
  const crudas = arr((crudo as { competitions?: unknown })?.competitions) as Record<string, unknown>[];
  for (const [i, h] of v.hechos.entries()) {
    const k = h.competition.competitionKey;
    for (const s of ['results', 'pools', 'tableau'] as const) {
      const e = h.status[s];
      if (s === 'results' ? e !== 'completo' : e !== 'completo' && e !== 'sin_resultados') {
        fallos.push({ prueba: k, motivo: `seccion_${s}_${e}` });
      }
    }
    for (const m of comprobarClasificacion(h)) fallos.push({ prueba: k, motivo: m });
    for (const m of comprobarCuadroClasificacion(h)) fallos.push({ prueba: k, motivo: m });
    const cruda = crudas[i];
    if (cruda) for (const m of comprobarPoules(arr(cruda.pools) as PouleCruda[], h.competition.format === 'INDIVIDUAL')) {
      fallos.push({ prueba: k, motivo: m });
    }
  }
  fallos.push(...pruebasRepetidas(v.hechos));
  return fallos;
}

/**
 * The model may return the same event twice: `claveCompeticion` gives the copy a `~2` key, so both
 * would be written. Same attributes and at least half of the fencers in common is a repeat.
 */
function pruebasRepetidas(hechos: readonly HechosPrueba[]): FalloEstricto[] {
  const fallos: FalloEstricto[] = [];
  const vistas: { base: string; nombres: Set<string>; clave: string }[] = [];
  for (const h of hechos) {
    const clave = h.competition.competitionKey;
    const base = clave.replace(/~\d+$/, '');
    const nombres = new Set(h.results.map((r) => compacto(r.name)));
    for (const o of vistas) {
      if (o.base !== base || nombres.size === 0 || o.nombres.size === 0) continue;
      const comunes = [...nombres].filter((n) => o.nombres.has(n)).length;
      if (comunes * 2 >= Math.min(nombres.size, o.nombres.size)) fallos.push({ prueba: clave, motivo: 'prueba_repetida', detalle: o.clave });
    }
    vistas.push({ base, nombres, clave });
  }
  return fallos;
}

/**
 * Lectura determinista (PDF, Engarde) antes de escribirse sin revisión humana: una poule
 * individual que no sea un todos contra todos limpio (pareja repetida, más asaltos de los
 * posibles o, en un PDF que declara la sección completa, alguien sin sus n−1 asaltos) se quita entera, y
 * del cuadro se quitan los asaltos incoherentes. La sección afectada pasa a «parcial». Mejor
 * sin asaltos que con asaltos duplicados o inventados.
 */
export function sanearAsaltos(h: HechosPrueba): { hechos: HechosPrueba; poulesQuitadas: string[]; cuadroQuitados: number } {
  if (h.competition.format !== 'INDIVIDUAL' || h.bouts.length === 0) return { hechos: h, poulesQuitadas: [], cuadroQuitados: 0 };
  const poules = new Map<string, typeof h.bouts>();
  for (const b of h.bouts) if (b.phase === 'POULE') (poules.get(b.roundKey) ?? poules.set(b.roundKey, []).get(b.roundKey)!).push(b);
  const quitadas: string[] = [];
  for (const [ronda, bs] of poules) {
    const refs = new Set(bs.flatMap((b) => [b.aRef, b.bRef]));
    const k = refs.size;
    const parejas = new Set(bs.map((b) => [b.aRef, b.bRef].sort().join('|')));
    const porTirador = new Map<string, number>();
    for (const b of bs) for (const r of [b.aRef, b.bRef]) porTirador.set(r, (porTirador.get(r) ?? 0) + 1);
    const repetida = parejas.size !== bs.length || bs.some((b) => b.aRef === b.bRef);
    const demasiados = bs.length > (k * (k - 1)) / 2;
    // Only for PDFs: a misread matrix shows up as extra refs with too few bouts. Engarde pages are
    // structured, and there a short poule is a withdrawal, not a reading error.
    const incompleta = h.source === 'rfee_pdf' && h.status.pools === 'completo' && [...porTirador.values()].some((n) => n !== k - 1);
    if (repetida || demasiados || incompleta) quitadas.push(ronda);
  }
  const cuadro = h.bouts.map((b, i) => ({ b, i })).filter((x) => x.b.phase === 'TABLEAU');
  const coh = consistenciaCuadro(cuadro.map((x) => x.b));
  const fuera = new Set([...coh.incoherentes].map((j) => cuadro[j].i));
  if (quitadas.length === 0 && fuera.size === 0) return { hechos: h, poulesQuitadas: [], cuadroQuitados: 0 };
  const sinPoules = new Set(quitadas);
  const bouts = h.bouts.filter((b, i) => !(b.phase === 'POULE' && sinPoules.has(b.roundKey)) && !fuera.has(i));
  const notas = [...h.status.notes];
  if (quitadas.length) notas.push(`Poules quitadas por incoherentes: ${quitadas.join(',')}`);
  if (fuera.size) notas.push(`${fuera.size} asaltos del cuadro quitados por incoherentes`);
  return {
    hechos: {
      ...h, bouts,
      status: {
        ...h.status,
        pools: quitadas.length && h.status.pools !== 'sin_resultados' ? 'parcial' : h.status.pools,
        tableau: fuera.size && h.status.tableau !== 'sin_resultados' ? 'parcial' : h.status.tableau,
        notes: notas,
      },
    },
    poulesQuitadas: quitadas,
    cuadroQuitados: fuera.size,
  };
}
