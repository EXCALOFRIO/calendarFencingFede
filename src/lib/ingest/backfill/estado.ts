import { decodificarCursorFie } from './cursor-fie';

/**
 * Estado por prueba y tipo de dato, con denominadores. «Completo» significa
 * completo PARA LO PUBLICADO por esa fuente y ese tipo de hecho: no acredita
 * frescura ni que exista historial de otro tipo (finales completos no dicen
 * nada de poules) y jamás se afirma sin saber cuántas unidades se
 * descubrieron.
 */

export type EstadoHecho =
  | 'pendiente'
  | 'parcial'
  | 'no_publicado'
  | 'sin_resultados'
  | 'error'
  | 'conflicto'
  | 'completo';

export const ESTADOS_HECHO: readonly EstadoHecho[] = [
  'pendiente',
  'parcial',
  'no_publicado',
  'sin_resultados',
  'error',
  'conflicto',
  'completo',
];

export type HechoCobertura = 'puestos' | 'poules' | 'cuadro' | 'documento' | 'enlace' | 'indice';
export const HECHOS: readonly HechoCobertura[] = ['puestos', 'poules', 'cuadro', 'documento', 'enlace', 'indice'];

const HECHO_POR_TIPO: Record<string, HechoCobertura> = {
  ranking: 'puestos',
  results: 'puestos',
  pools: 'poules',
  tableau: 'cuadro',
  pdf: 'documento',
  link: 'enlace',
  index: 'indice',
};

export function hechoDeFactKind(factKind: string): HechoCobertura | null {
  return HECHO_POR_TIPO[factKind] ?? null;
}

export const ETIQUETA_ESTADO: Record<EstadoHecho, string> = {
  pendiente: 'Pendiente de leer',
  parcial: 'Parcial: faltan datos publicados',
  no_publicado: 'La fuente no lo publica (comprobado)',
  sin_resultados: 'Leído: la fuente no publica datos',
  error: 'Error de lectura: se reintentará',
  conflicto: 'En revisión por conflicto',
  completo: 'Completo para lo publicado por la fuente',
};

export type ClaseCursor = 'no_publicado' | 'continuacion' | null;

/** Qué significa el cursor de una fila de cobertura. Los estados finos de enlace no son continuación. */
export function claseDeCursor(cursor: string | null | undefined): ClaseCursor {
  if (!cursor) return null;
  if (cursor === 'no_publicado') return 'no_publicado';
  return decodificarCursorFie(cursor) ? 'continuacion' : null;
}

export type FilaCoberturaAgregada = {
  source: string;
  factKind: string;
  status: 'pendiente' | 'completo' | 'parcial' | 'sin_resultados' | 'error' | 'conflicto';
  claseCursor: ClaseCursor;
  /** `false` si `imported_total < published_total`: un «completo» así no se acepta. */
  consistente: boolean;
  /** Filas de cobertura agrupadas bajo esta combinación. */
  n: number;
  publicado: number;
  importado: number;
};

export function estadoDeFila(f: Pick<FilaCoberturaAgregada, 'status' | 'claseCursor' | 'consistente'>): EstadoHecho {
  if (f.claseCursor === 'no_publicado' && (f.status === 'pendiente' || f.status === 'sin_resultados')) {
    return 'no_publicado';
  }
  if (f.status === 'completo') return f.claseCursor === 'continuacion' || !f.consistente ? 'parcial' : 'completo';
  return f.status;
}

export type ResumenHecho = {
  /** Filas de cobertura existentes (unidades leídas o intentadas). */
  unidades: number;
  porEstado: Record<EstadoHecho, number>;
  publicado: number;
  importado: number;
  /** Unidades descubiertas por el inventario para este hecho; `null` si no se conoce. */
  descubiertas: number | null;
  /** Descubiertas sin fila de cobertura; `null` sin denominador. Nunca se leen como vacío. */
  nuncaLeidas: number | null;
};

export type CoberturaPorHecho = Record<HechoCobertura, ResumenHecho>;

export function resumirCoberturaPorHecho(
  filas: readonly FilaCoberturaAgregada[],
  descubiertas: Partial<Record<HechoCobertura, number>> = {},
): CoberturaPorHecho {
  const salida = Object.fromEntries(
    HECHOS.map((h) => [
      h,
      {
        unidades: 0,
        porEstado: Object.fromEntries(ESTADOS_HECHO.map((e) => [e, 0])) as Record<EstadoHecho, number>,
        publicado: 0,
        importado: 0,
        descubiertas: descubiertas[h] ?? null,
        nuncaLeidas: null as number | null,
      },
    ]),
  ) as CoberturaPorHecho;

  for (const f of filas) {
    const hecho = hechoDeFactKind(f.factKind);
    if (!hecho) continue;
    const r = salida[hecho];
    r.unidades += f.n;
    r.porEstado[estadoDeFila(f)] += f.n;
    r.publicado += f.publicado;
    r.importado += f.importado;
  }
  for (const h of HECHOS) {
    const r = salida[h];
    r.nuncaLeidas = r.descubiertas === null ? null : Math.max(0, r.descubiertas - r.unidades);
  }
  return salida;
}

export type LecturaDeHecho =
  | 'sin_datos'
  | 'incompleto'
  | 'sin_publicar'
  | 'completo_para_lo_publicado';

/**
 * Cómo puede presentarse un hecho sin mentir. `completo_para_lo_publicado`
 * exige un denominador conocido, todas las unidades leídas y todas completas.
 * Nada aquí produce «cero resultados»: sin lectura es `sin_datos`, con error o
 * parcial `incompleto` y un vacío acreditado es `sin_publicar`.
 */
export function lecturaDeHecho(r: ResumenHecho): LecturaDeHecho {
  if (r.unidades === 0) return 'sin_datos';
  const e = r.porEstado;
  const sinPublicar = e.sin_resultados + e.no_publicado;
  if (e.completo === 0 && sinPublicar === r.unidades) return 'sin_publicar';
  const todoLeido = r.nuncaLeidas === 0;
  if (todoLeido && e.completo + sinPublicar === r.unidades && e.completo > 0) return 'completo_para_lo_publicado';
  return 'incompleto';
}
