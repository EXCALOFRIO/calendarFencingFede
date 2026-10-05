/**
 * Coherencia de un cuadro de eliminación directa leído de un PDF.
 *
 * En eliminación directa nadie tira dos veces en la misma ronda, una pareja no se cruza
 * dos veces y quien pierde no vuelve a aparecer en rondas posteriores. Las rondas se
 * reconocen por el tamaño (`A32`, `T32` → 32); las que no lo llevan (tercer puesto `C2`,
 * `T2-3`, rondas sin número) no cuentan.
 */

export type AsaltoCuadro = {
  roundKey: string;
  aRef: string;
  bRef: string;
  scoreA: number;
  scoreB: number;
  winner?: 'A' | 'B' | null;
};

export type MotivoIncoherencia = 'tirador_repetido_en_ronda' | 'pareja_repetida' | 'perdedor_sigue';

export type Coherencia = {
  /** Asaltos del cuadro principal (ronda con tamaño). */
  evaluados: number;
  /** Índices (en la lista de entrada) de los asaltos implicados en alguna incoherencia. */
  incoherentes: Set<number>;
  /** Asaltos cuyo ganador aparece en la ronda siguiente leída. */
  confirmados: number;
  motivos: Partial<Record<MotivoIncoherencia, number>>;
};

export function tamanoRonda(roundKey: string): number | null {
  const m = /^[AT](\d+)$/.exec(roundKey);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 && (n & (n - 1)) === 0 ? n : null;
}

const ganador = (b: AsaltoCuadro): string | null =>
  b.scoreA > b.scoreB ? b.aRef : b.scoreB > b.scoreA ? b.bRef : b.winner === 'A' ? b.aRef : b.winner === 'B' ? b.bRef : null;

export function consistenciaCuadro(asaltos: readonly AsaltoCuadro[]): Coherencia {
  const incoherentes = new Set<number>();
  const motivos: Coherencia['motivos'] = {};
  const marcar = (motivo: MotivoIncoherencia, indices: number[]) => {
    for (const i of indices) {
      if (!incoherentes.has(i)) motivos[motivo] = (motivos[motivo] ?? 0) + 1;
      incoherentes.add(i);
    }
  };
  const principales = asaltos.map((b, i) => ({ b, i, n: tamanoRonda(b.roundKey) })).filter((x) => x.n !== null) as
    { b: AsaltoCuadro; i: number; n: number }[];

  const porRondaTirador = new Map<string, number[]>();
  const porPareja = new Map<string, number[]>();
  const rondasDe = new Map<string, { n: number; i: number; gana: boolean }[]>();
  for (const { b, i, n } of principales) {
    for (const ref of [b.aRef, b.bRef]) {
      const k = `${n}|${ref}`;
      porRondaTirador.set(k, [...(porRondaTirador.get(k) ?? []), i]);
    }
    const pareja = [b.aRef, b.bRef].sort().join('|');
    porPareja.set(pareja, [...(porPareja.get(pareja) ?? []), i]);
    const g = ganador(b);
    for (const ref of [b.aRef, b.bRef]) {
      rondasDe.set(ref, [...(rondasDe.get(ref) ?? []), { n, i, gana: g === ref }]);
    }
  }
  for (const l of porRondaTirador.values()) if (l.length > 1) marcar('tirador_repetido_en_ronda', l);
  for (const l of porPareja.values()) if (l.length > 1) marcar('pareja_repetida', l);
  for (const l of rondasDe.values()) {
    for (const derrota of l.filter((x) => !x.gana)) {
      const despues = l.filter((x) => x.n < derrota.n);
      if (despues.length > 0) marcar('perdedor_sigue', [derrota.i, ...despues.map((x) => x.i)]);
    }
  }

  const rondas = new Set(principales.map((x) => x.n));
  let confirmados = 0;
  for (const { b, n } of principales) {
    const g = ganador(b);
    if (g === null || n <= 2 || !rondas.has(n / 2)) continue;
    if ((rondasDe.get(g) ?? []).some((x) => x.n === n / 2)) confirmados += 1;
  }
  return { evaluados: principales.length, incoherentes, confirmados, motivos };
}

/** Peso de una lectura del cuadro para elegir entre varias: asaltos coherentes, luego confirmados. */
export function pesoCuadro(asaltos: readonly AsaltoCuadro[]): [number, number] {
  const c = consistenciaCuadro(asaltos);
  const fuera = asaltos.length - c.evaluados;
  return [c.evaluados - c.incoherentes.size + fuera, c.confirmados];
}
