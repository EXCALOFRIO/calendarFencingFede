/**
 * Medidas de completitud de poules y cuadro de una prueba individual, comunes al
 * listado de objetivos (`pdf-relectura-objetivos.ts`) y a la relectura de PDF
 * (`pdf-relectura.ts`). Funciones puras: sin base ni disco.
 *
 * Poule completa: cada tirador cruza con todos los de su poule, n·(n−1)/2 asaltos.
 * Cuadro completo, por tramo (`A…` previa y `B…` principal en las pruebas de dos
 * fases; `A…`/`T…` en las de una): en eliminación directa cada asalto elimina a
 * uno, así que con N tiradores en el cuadro hay N−1 asaltos; por ronda, la primera
 * (tamaño S) tiene N − S/2 y cada una de las siguientes, la mitad de su tamaño.
 */
import { normalizarNombre } from './comun';

export type AsaltoMedido = {
  phase: 'POULE' | 'TABLEAU' | string;
  roundKey: string;
  aName: string;
  bName: string;
  scoreA: number;
  scoreB: number;
};

export type MedidaPoules = {
  poules: number;
  asaltos: number;
  esperados: number;
  /** Tiradores distintos en alguna poule (por nombre normalizado). */
  tiradores: number;
  incompletas: string[];
  completo: boolean;
};

export function medirPoules(asaltos: readonly AsaltoMedido[]): MedidaPoules {
  const porPoule = new Map<string, { n: number; nombres: Set<string> }>();
  const tiradores = new Set<string>();
  for (const b of asaltos) {
    if (b.phase !== 'POULE') continue;
    const p = porPoule.get(b.roundKey) ?? { n: 0, nombres: new Set<string>() };
    p.n += 1;
    for (const n of [b.aName, b.bName]) {
      const k = normalizarNombre(n);
      p.nombres.add(k);
      tiradores.add(k);
    }
    porPoule.set(b.roundKey, p);
  }
  let esperados = 0;
  let total = 0;
  const incompletas: string[] = [];
  for (const [k, p] of porPoule) {
    const n = p.nombres.size;
    const e = (n * (n - 1)) / 2;
    esperados += e;
    total += p.n;
    if (p.n < e) incompletas.push(k);
  }
  return {
    poules: porPoule.size, asaltos: total, esperados, tiradores: tiradores.size,
    incompletas: incompletas.sort(), completo: porPoule.size > 0 && incompletas.length === 0,
  };
}

/** `A64`, `T64`, `B64` → tramo y tamaño; `C2`, `T2-3` y claves sin tamaño → null. */
export function rondaConTramo(roundKey: string): { tramo: 'A' | 'B'; tamano: number } | null {
  const m = /^([ABT])(\d{1,3})$/.exec(roundKey.trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 2 || (n & (n - 1)) !== 0) return null;
  return { tramo: m[1] === 'B' ? 'B' : 'A', tamano: n };
}

export type MedidaTramo = {
  tramo: 'A' | 'B';
  /** Tamaño de la primera ronda leída. */
  primera: number;
  /** Tiradores en el cuadro: los publicados si se conocen, si no los que se deducen de lo leído. */
  tiradores: number;
  tiradoresDeducidos: boolean;
  porRonda: Record<string, { asaltos: number; esperados: number }>;
  asaltos: number;
  esperados: number;
  /** Ronda de 2 (final) leída. Un tramo previa no la tiene: termina en la ronda que clasifica. */
  conFinal: boolean;
  completo: boolean;
};

export type MedidaCuadro = {
  asaltos: number;
  esperados: number;
  tramos: MedidaTramo[];
  /** Asaltos con ronda sin tamaño (tercer puesto, claves desconocidas). */
  otros: number;
  completo: boolean;
  /** Indicio de que falta una ronda inicial entera: demasiados puestos para el tamaño leído. */
  rondaInicialDudosa: boolean;
};

/**
 * `tiradoresCuadro`: tiradores que el documento declara en el cuadro (fórmula,
 * «clasificación después de poules») por tramo; `resultados`: puestos de la prueba.
 * Sin tiradores declarados se deducen: los de la primera ronda más los que
 * entran directamente en la segunda (exentos).
 */
export function medirCuadro(
  asaltos: readonly AsaltoMedido[],
  opciones: { tiradoresCuadro?: Partial<Record<'A' | 'B', number>>; resultados?: number; conPoules?: boolean } = {},
): MedidaCuadro {
  const porTramo = new Map<'A' | 'B', Map<number, AsaltoMedido[]>>();
  let otros = 0;
  for (const b of asaltos) {
    if (b.phase !== 'TABLEAU') continue;
    const r = rondaConTramo(b.roundKey);
    if (!r) {
      otros += 1;
      continue;
    }
    const t = porTramo.get(r.tramo) ?? new Map<number, AsaltoMedido[]>();
    t.set(r.tamano, [...(t.get(r.tamano) ?? []), b]);
    porTramo.set(r.tramo, t);
  }
  const dosTramos = porTramo.has('A') && porTramo.has('B');
  const tramos: MedidaTramo[] = [];
  for (const [tramo, rondas] of [...porTramo.entries()].sort()) {
    const tamanos = [...rondas.keys()].sort((a, b) => b - a);
    const primera = tamanos[0];
    const nombres = (n: number) => new Set((rondas.get(n) ?? []).flatMap((b) => [normalizarNombre(b.aName), normalizarNombre(b.bName)]));
    const enPrimera = nombres(primera);
    const exentos = [...nombres(primera / 2)].filter((n) => !enPrimera.has(n)).length;
    const declarados = opciones.tiradoresCuadro?.[tramo];
    const deducidos = Math.min(primera, enPrimera.size + exentos);
    const tiradores = declarados && declarados > primera / 2 && declarados <= primera ? declarados : deducidos;
    const porRonda: MedidaTramo['porRonda'] = {};
    // Un tramo previa de una prueba en dos fases termina en la ronda que clasifica, no en la final.
    const ultima = dosTramos && tramo === 'A' ? Math.min(...tamanos) : 2;
    let esperados = 0;
    let total = 0;
    for (let s = primera; s >= ultima; s /= 2) {
      const n = rondas.get(s)?.length ?? 0;
      // Con los tiradores deducidos de un cuadro a medio leer, la primera ronda espera al menos lo leído.
      const e = s === primera ? Math.max(tiradores - primera / 2, Math.min(n, primera / 2)) : s / 2;
      porRonda[String(s)] = { asaltos: n, esperados: e };
      esperados += e;
      total += Math.min(n, e);
    }
    const conFinal = rondas.has(2);
    tramos.push({
      tramo, primera, tiradores, tiradoresDeducidos: !(declarados && tiradores === declarados), porRonda,
      asaltos: total, esperados, conFinal,
      completo: Object.values(porRonda).every((r) => r.asaltos >= r.esperados) && (ultima !== 2 || conFinal),
    });
  }
  const principal = tramos.find((t) => t.tramo === (dosTramos ? 'B' : 'A'));
  // Sin dato publicado: si el cuadro leído no llega a dos tercios de los puestos y hubo
  // poules, lo normal es que falte la ronda inicial (las poules eliminan del 20 al 30 %).
  const rondaInicialDudosa = !dosTramos && principal !== undefined && principal.tiradoresDeducidos &&
    opciones.conPoules === true && (opciones.resultados ?? 0) > principal.primera * 1.5;
  const asaltosTotal = tramos.reduce((n, t) => n + t.asaltos, 0);
  const esperadosTotal = tramos.reduce((n, t) => n + t.esperados, 0);
  return {
    asaltos: asaltosTotal, esperados: esperadosTotal, tramos, otros,
    completo: tramos.length > 0 && tramos.every((t) => t.completo) && !rondaInicialDudosa,
    rondaInicialDudosa,
  };
}

/**
 * Tiradores del cuadro que declara el propio documento, en el texto de las páginas
 * de una prueba: «Eliminación directa : 24 tiradores», «Clasificación después de
 * poules (orden por lugar - 24 tiradores)», «Direct elimination: 24 fencers».
 */
export function tiradoresDeclarados(texto: string): number | null {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const patrones = [
    /Eliminacion directa\s*:\s*(\d{1,3})\s*tiradores/i,
    /Clasificacion despues de (?:las )?poules\s*\([^)]*?(\d{1,3})\s*tiradores\)/i,
    /Direct elimination\s*:\s*(\d{1,3})\s*fencers/i,
    /Ranking after (?:the )?pools?\s*\([^)]*?(\d{1,3})\s*fencers\)/i,
  ];
  for (const re of patrones) {
    const m = re.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}
