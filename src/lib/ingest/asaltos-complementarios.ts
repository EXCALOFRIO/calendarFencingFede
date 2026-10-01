import { checkBout } from '@/lib/identity/resolver';

/**
 * Asaltos individuales leídos de una fuente complementaria (Engarde, Fencing
 * Worldwide). Mismo contrato que el lector FIE: un asalto es siempre entre dos
 * individuales inequívocos con marcador final, `refA < refB` y un duelo
 * publicado desde las dos perspectivas cuenta una sola vez.
 *
 * La referencia de un participante identifica a quien PUBLICA la fuente (ID
 * FWW, o nombre + nación/club en Engarde); jamás es una persona confirmada.
 */

export type AsaltoComplementario = {
  fase: 'POULE' | 'TABLEAU';
  /** `R{ronda}P{n}` en poule; `T32…T8`, `SF`, `F` en cuadro. */
  ronda: string;
  refA: string;
  refB: string;
  nombreA: string;
  nombreB: string;
  puntosA: number;
  puntosB: number;
  /** Página de origen del cruce; la fija el lector de red, no el parser puro. */
  url?: string;
};

export type ExclusionesAsaltos = {
  bye: number;
  /** Sin referencia estable del participante (sin ID FWW, nombre repetido…). */
  sinParticipante: number;
  /** Enfrentamiento publicado sin marcador legible o con letras que no son V/D. */
  sinMarcador: number;
  sinGanador: number;
  /** Sólo una de las dos perspectivas de una poule trae resultado. */
  noReciproco: number;
  /** Las dos perspectivas, o el ganador y los participantes, se contradicen. */
  incoherente: number;
  rondaDesconocida: number;
  duplicado: number;
};

export type ParteAsaltosComplementarios = {
  asaltos: AsaltoComplementario[];
  /** Enfrentamientos con resultado publicado (candidatos a asalto), cada cruce una vez. */
  publicado: number;
  importado: number;
  excluidos: ExclusionesAsaltos;
  /** `false` si hay secciones o rondas que no se pudieron interpretar. */
  completo: boolean;
};

export function sumarExclusiones(destino: ExclusionesAsaltos, otras: ExclusionesAsaltos): void {
  for (const k of Object.keys(destino) as (keyof ExclusionesAsaltos)[]) destino[k] += otras[k];
}

type Entrada = {
  fase: AsaltoComplementario['fase'];
  ronda: string;
  a: { ref: string; nombre: string; puntos: number };
  b: { ref: string; nombre: string; puntos: number };
};

/** Acumula asaltos sin duplicar: un cruce repetido y coherente cuenta una vez, uno contradictorio se retira. */
export class AcumuladorAsaltos {
  private readonly vistos = new Map<string, AsaltoComplementario>();
  private readonly retirados = new Set<string>();
  private candidatos = 0;
  readonly excluidos: ExclusionesAsaltos = {
    bye: 0,
    sinParticipante: 0,
    sinMarcador: 0,
    sinGanador: 0,
    noReciproco: 0,
    incoherente: 0,
    rondaDesconocida: 0,
    duplicado: 0,
  };

  /** Un enfrentamiento publicado que no puede ser asalto. Un BYE no es un resultado publicado. */
  excluir(motivo: keyof ExclusionesAsaltos): void {
    this.excluidos[motivo] += 1;
    if (motivo !== 'bye' && motivo !== 'duplicado') this.candidatos += 1;
  }

  anadir(e: Entrada): void {
    const chequeo = checkBout({
      individual: true,
      fencerARef: e.a.ref,
      fencerBRef: e.b.ref,
      scoreA: e.a.puntos,
      scoreB: e.b.puntos,
    });
    if (!chequeo.ok) {
      this.excluir(chequeo.reason === 'same_fencer' ? 'incoherente' : 'sinParticipante');
      return;
    }
    const [x, y] = chequeo.swapped ? [e.b, e.a] : [e.a, e.b];
    const asalto: AsaltoComplementario = {
      fase: e.fase,
      ronda: e.ronda,
      refA: x.ref,
      refB: y.ref,
      nombreA: x.nombre,
      nombreB: y.nombre,
      puntosA: x.puntos,
      puntosB: y.puntos,
    };
    const clave = `${e.fase}|${e.ronda}|${asalto.refA}|${asalto.refB}`;
    if (this.retirados.has(clave)) return;
    const previo = this.vistos.get(clave);
    if (!previo) {
      this.vistos.set(clave, asalto);
      this.candidatos += 1;
      return;
    }
    if (previo.puntosA === asalto.puntosA && previo.puntosB === asalto.puntosB) {
      this.excluidos.duplicado += 1;
      return;
    }
    this.vistos.delete(clave);
    this.retirados.add(clave);
    this.excluidos.incoherente += 1;
  }

  resumen(seccionesCompletas: boolean): ParteAsaltosComplementarios {
    const asaltos = [...this.vistos.values()];
    return {
      asaltos,
      publicado: this.candidatos,
      importado: asaltos.length,
      excluidos: this.excluidos,
      completo: seccionesCompletas && asaltos.length === this.candidatos,
    };
  }
}
