import type { PuntoEvolucion, ResumenRendimiento, TemporadaRendimiento } from '@/lib/sport/explorar/rendimiento';
import { decimal, fraccionDelante } from './comun';

/**
 * Frases que leen una gráfica en lenguaje sencillo («En 24-25 suele acabar por
 * delante del 72 % del cuadro»). Salen de los datos, son cortas (≤ 70
 * caracteres) y no se escriben si no hay dato que contar: `null`.
 */

export const porciento = (v: number) => `${Math.round(v * 100)} %`;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Temporada de referencia: la última con al menos tres competiciones o, si no hay, la última con alguna. */
export function temporadaDeReferencia(ts: readonly TemporadaRendimiento[]): TemporadaRendimiento | null {
  const inversa = [...ts].reverse();
  return inversa.find((t) => t.competiciones >= 3) ?? inversa.find((t) => t.competiciones > 0) ?? null;
}

function anterior(ts: readonly TemporadaRendimiento[], t: TemporadaRendimiento, valido: (x: TemporadaRendimiento) => boolean) {
  const i = ts.indexOf(t);
  for (let j = i - 1; j >= 0; j -= 1) if (valido(ts[j])) return ts[j];
  return null;
}

/** La de más `valor`; en empate, la más reciente. */
function mejorPor(ts: readonly TemporadaRendimiento[], valor: (t: TemporadaRendimiento) => number) {
  let mejor: TemporadaRendimiento | null = null;
  for (const t of ts) if (valor(t) > 0 && (!mejor || valor(t) >= valor(mejor))) mejor = t;
  return mejor;
}

export function fraseCompeticiones(ts: readonly TemporadaRendimiento[]): string | null {
  const conDatos = ts.filter((t) => t.competiciones > 0);
  if (conDatos.length < 2) return null;
  const mas = mejorPor(ts, (t) => t.competiciones)!;
  return `Su temporada más activa: ${mas.corta}, con ${plural(mas.competiciones, 'competición', 'competiciones')}.`;
}

export function fraseMedallas(ts: readonly TemporadaRendimiento[], total: ResumenRendimiento): string | null {
  if (total.medallas === 0) return null;
  const mejor = mejorPor(ts, (t) => t.medallas)!;
  if (ts.filter((t) => t.medallas > 0).length === 1) {
    return `${total.medallas === 1 ? 'Su medalla llegó' : 'Todas sus medallas llegaron'} en ${mejor.corta}.`;
  }
  return `Su mejor temporada: ${mejor.corta}, con ${plural(mejor.medallas, 'medalla', 'medallas')}.`;
}

export function fraseAsaltos(ts: readonly TemporadaRendimiento[]): string | null {
  const ref = temporadaDeReferencia(ts.filter((t) => t.asaltos.porcentaje !== null));
  if (!ref || ref.asaltos.porcentaje === null) return null;
  const base = `En ${ref.corta} ganó el ${porciento(ref.asaltos.porcentaje)} de sus asaltos`;
  const previa = anterior(ts, ref, (t) => t.asaltos.porcentaje !== null && t.asaltos.asaltos >= 10);
  if (!previa || previa.asaltos.porcentaje === null) return `${base}.`;
  const cambio = Math.round(ref.asaltos.porcentaje * 100) - Math.round(previa.asaltos.porcentaje * 100);
  if (Math.abs(cambio) < 3) return `${base}, como en ${previa.corta}.`;
  return `${base}, ${cambio > 0 ? 'más' : 'menos'} que en ${previa.corta} (${porciento(previa.asaltos.porcentaje)}).`;
}

export function fraseTocados(ts: readonly TemporadaRendimiento[]): string | null {
  const ref = temporadaDeReferencia(ts.filter((t) => t.asaltos.asaltos > 0));
  if (!ref) return null;
  const dados = ref.asaltos.dados / ref.asaltos.asaltos;
  const recibidos = ref.asaltos.recibidos / ref.asaltos.asaltos;
  return `En ${ref.corta} dio ${decimal(dados)} tocados por asalto y recibió ${decimal(recibidos)}.`;
}

/**
 * Parte del cuadro que acabó por detrás, mediana de las competiciones de la
 * temporada: ganar es el 100 % (todos detrás) y ser último, el 0 %.
 */
export function detrasMediano(puntos: readonly PuntoEvolucion[]): number | null {
  const v = puntos
    .map((p) => fraccionDelante(p.puesto, p.participantes))
    .filter((x): x is number => x !== null)
    .map((x) => 1 - x)
    .sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function frasePuestoRelativo(ts: readonly TemporadaRendimiento[], puntos: readonly PuntoEvolucion[]): string | null {
  const ref = temporadaDeReferencia(ts.filter((t) => t.percentilMediano !== null));
  if (!ref) return null;
  const detras = detrasMediano(puntos.filter((p) => p.temporada === ref.temporada));
  if (detras === null) return null;
  return `En ${ref.corta} suele acabar por delante del ${porciento(detras)} del cuadro.`;
}

/** Por tipo, categoría o arma: dónde gana más asaltos, si hay con qué comparar. */
export function fraseMejorGrupo(
  filas: readonly { etiqueta: string; competiciones: number; asaltos: { asaltos: number; porcentaje: number | null } }[],
): string | null {
  const validas = filas.filter((f) => f.competiciones >= 3 && f.asaltos.asaltos >= 10 && f.asaltos.porcentaje !== null);
  if (validas.length < 2) return null;
  const mejor = validas.reduce((a, b) => (b.asaltos.porcentaje! > a.asaltos.porcentaje! ? b : a));
  return `Donde más gana: ${mejor.etiqueta}, con el ${porciento(mejor.asaltos.porcentaje!)} de asaltos.`;
}
