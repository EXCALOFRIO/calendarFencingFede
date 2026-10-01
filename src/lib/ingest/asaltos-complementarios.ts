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

/**
 * Duelo cuyas observaciones publicadas se contradicen y que por eso no se
 * importa. `clave` incluye las referencias de los participantes (en Engarde, su
 * nombre): sirve para reconciliar entre páginas y no debe escribirse en logs.
 * `fase`, `ronda` y `urls` bastan para revisarlo.
 */
export type ConflictoAsalto = {
  clave: string;
  fase: AsaltoComplementario['fase'];
  ronda: string;
  urls: string[];
};

export type ParteAsaltosComplementarios = {
  asaltos: AsaltoComplementario[];
  /** Enfrentamientos con resultado publicado (candidatos a asalto), cada cruce una vez. */
  publicado: number;
  importado: number;
  excluidos: ExclusionesAsaltos;
  /** Duelos con tanteos contradictorios: cuentan en `publicado` y no están en `asaltos`. */
  conflictos: ConflictoAsalto[];
  /** `false` si hay secciones o rondas que no se pudieron interpretar. */
  completo: boolean;
};

export function sumarExclusiones(destino: ExclusionesAsaltos, otras: ExclusionesAsaltos): void {
  for (const k of Object.keys(destino) as (keyof ExclusionesAsaltos)[]) destino[k] += otras[k];
}

const exclusionesVacias = (): ExclusionesAsaltos => ({
  bye: 0,
  sinParticipante: 0,
  sinMarcador: 0,
  sinGanador: 0,
  noReciproco: 0,
  incoherente: 0,
  rondaDesconocida: 0,
  duplicado: 0,
});

export function claveAsalto(a: Pick<AsaltoComplementario, 'fase' | 'ronda' | 'refA' | 'refB'>): string {
  return `${a.fase}|${a.ronda}|${a.refA}|${a.refB}`;
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
  private readonly retirados = new Map<string, ConflictoAsalto>();
  private candidatos = 0;
  readonly excluidos: ExclusionesAsaltos = exclusionesVacias();

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
    const clave = claveAsalto(asalto);
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
    this.retirados.set(clave, { clave, fase: e.fase, ronda: e.ronda, urls: [] });
    this.excluidos.incoherente += 1;
  }

  resumen(seccionesCompletas: boolean): ParteAsaltosComplementarios {
    const asaltos = [...this.vistos.values()];
    return {
      asaltos,
      publicado: this.candidatos,
      importado: asaltos.length,
      excluidos: this.excluidos,
      conflictos: [...this.retirados.values()],
      completo: seccionesCompletas && asaltos.length === this.candidatos,
    };
  }
}

/**
 * Reúne las partes de varias páginas de una misma lectura. El duelo se
 * identifica por fase, ronda y referencias: repetido con el mismo tanteo cuenta
 * una vez; con tanteos distintos, en la misma o en distinta página, se retira
 * por completo y ninguna observación posterior lo recupera.
 */
export class FusionAsaltos {
  private readonly vistos = new Map<string, AsaltoComplementario>();
  private readonly conflictos = new Map<string, ConflictoAsalto>();
  /** Candidatos sin clave de duelo (excluidos por marcador, participante…): cada uno es un hecho distinto. */
  private sinClave = 0;
  private seccionesCompletas = true;
  readonly excluidos: ExclusionesAsaltos = exclusionesVacias();

  anadir(parte: ParteAsaltosComplementarios, url: string): void {
    this.sinClave += parte.publicado - parte.asaltos.length - parte.conflictos.length;
    this.seccionesCompletas &&= parte.completo;
    sumarExclusiones(this.excluidos, parte.excluidos);

    for (const c of parte.conflictos) {
      this.vistos.delete(c.clave);
      this.registrarConflicto(c.clave, c.fase, c.ronda, url);
    }
    for (const a of parte.asaltos) {
      const clave = claveAsalto(a);
      const conflicto = this.conflictos.get(clave);
      if (conflicto) {
        if (!conflicto.urls.includes(url)) conflicto.urls.push(url);
        continue;
      }
      const previo = this.vistos.get(clave);
      if (!previo) {
        this.vistos.set(clave, { ...a, url });
      } else if (previo.puntosA === a.puntosA && previo.puntosB === a.puntosB) {
        this.excluidos.duplicado += 1;
      } else {
        this.vistos.delete(clave);
        this.excluidos.incoherente += 1;
        this.registrarConflicto(clave, a.fase, a.ronda, previo.url ?? url, url);
      }
    }
  }

  private registrarConflicto(clave: string, fase: ConflictoAsalto['fase'], ronda: string, ...urls: string[]): void {
    const c = this.conflictos.get(clave) ?? { clave, fase, ronda, urls: [] };
    for (const u of urls) if (!c.urls.includes(u)) c.urls.push(u);
    this.conflictos.set(clave, c);
  }

  resumen(otrasSeccionesCompletas: boolean): ParteAsaltosComplementarios {
    const asaltos = [...this.vistos.values()];
    const publicado = this.sinClave + asaltos.length + this.conflictos.size;
    return {
      asaltos,
      publicado,
      importado: asaltos.length,
      excluidos: this.excluidos,
      conflictos: [...this.conflictos.values()],
      completo: this.seccionesCompletas && otrasSeccionesCompletas && asaltos.length === publicado,
    };
  }
}

/** Frase sin nombres para el motivo de una lectura cuando hubo duelos contradictorios. */
export function motivoConflictos(conflictos: readonly ConflictoAsalto[]): string | null {
  return conflictos.length === 0
    ? null
    : `${conflictos.length} cruce(s) con tanteos contradictorios entre páginas, excluidos para revisión`;
}
