import { DIAS_TRAS_COMPETICION } from '../cadencia-ranking';
import { clasificarSerie, SERIES_COMPLEMENTARIAS, type SerieComplementaria } from '../series-complementarias';
import { claseDeCursor } from './estado';
import type { EstimacionLote } from './capacidad';
import { PRIORIDAD_MOTIVO, type MotivoTarea, type Tarea, type TipoTarea } from './orquestador';

/**
 * Planificación del backfill a partir de lo YA persistido: filas de
 * `sport_import_coverage` y unidades descubiertas por el inventario. Es pura:
 * no lee red ni base. Reglas que importan:
 *
 *  - «completo» no acredita frescura ni repara nada: una unidad completa sólo
 *    se vuelve a leer por cadencia (prueba reciente), por `--releer` explícito
 *    y acotado, o porque su cursor de continuación dice que no terminó;
 *  - un error se reintenta hasta `maxIntentos`; agotado queda señalado para
 *    revisión, no se oculta ni se reintenta en bucle;
 *  - las unidades con categorías antes no soportadas (M10/M12) esperan a que el
 *    esquema las admita; sólo entonces se releen;
 *  - un conflicto va a revisión humana y no se reintenta solo;
 *  - una tarea por clave de prueba o documento, con el motivo más urgente.
 */

export type FilaPlan = {
  source: string;
  season: string;
  factKind: string;
  competitionKey: string;
  status: 'pendiente' | 'completo' | 'parcial' | 'sin_resultados' | 'error' | 'conflicto';
  publishedTotal: number | null;
  importedTotal: number;
  attempts: number;
  cursor: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  sourceUrl: string | null;
  /** Fecha de la prueba, si se conoce; marca la ventana de revisita de resultados recientes. */
  competitionDate: string | null;
  /** Prueba canónica a la que se asocia la fila, si la hay (las complementarias cotejan contra ella). */
  competitionId?: string | null;
};

export type UnidadDescubierta = {
  fuente: string;
  season: string;
  competitionKey: string;
  sourceUrl: string | null;
  /** Entrada propia del adaptador que acompaña a la unidad (referencia de la fila del índice, título...). */
  datos?: Record<string, unknown>;
};

export type OpcionesPlan = {
  ahora: Date;
  /** ¿El esquema ya admite M10/M12 (migración 0019)? */
  categoriasAmpliadas: boolean;
  releer?: { claves?: readonly string[]; temporadas?: readonly string[]; fuentes?: readonly string[] };
  maxReleer: number;
  maxIntentos: number;
  horasEntreRelecturas: number;
};

export type PlanBackfill = {
  tareas: Tarea[];
  omitidas: {
    agotadas: string[];
    enRevision: string[];
    esperaCategorias: string[];
    releerDiferidas: string[];
    completas: number;
  };
};

/**
 * Engarde se lee por torneo (`org/evt`), no por prueba: todas las pruebas de un
 * torneo comparten unidad, así que no se planifican lecturas repetidas del
 * mismo índice.
 */
export function claveBaseDeUnidad(fuente: string, competitionKey: string): string {
  return fuente === 'engarde' ? competitionKey.split('/').slice(0, 2).join('/') : competitionKey;
}

export const claveDeUnidad = (u: { fuente: string; season: string; competitionKey: string }): string =>
  `${u.fuente}|${u.season}|${claveBaseDeUnidad(u.fuente, u.competitionKey)}`;

const TIPO_POR_FUENTE: Record<string, TipoTarea> = {
  fie: 'fie_prueba',
  skermo_rfee: 'skermo_prueba',
  skermo_regional: 'skermo_prueba',
  rfee_pdf: 'pdf_documento',
  engarde: 'engarde_torneo',
  fww: 'fww_prueba',
  // Sólo entra por unidades indicadas: los enlaces no tienen filas de lectura que replanificar.
  enlaces_fie: 'enlaces_fie',
};

export const FUENTES_COMPLEMENTARIAS_PLAN: readonly string[] = ['engarde', 'fww', 'enlaces_fie'];

const HECHOS_DE_LECTURA = new Set(['ranking', 'results', 'pools', 'tableau']);

const PATRON_CATEGORIAS = /migraci[oó]n 0019|M10\/M12/i;

export function estimarTarea(tipo: TipoTarea, f: Pick<FilaPlan, 'publishedTotal'> | null): EstimacionLote {
  const publicados = f?.publishedTotal ?? null;
  switch (tipo) {
    case 'fie_prueba':
      return { puestos: publicados ?? 150, asaltos: 250, documentos: 0, unidades: 3 };
    case 'skermo_prueba':
      return { puestos: publicados ?? 60, asaltos: 0, documentos: 0, unidades: 1 };
    case 'pdf_documento':
      return { puestos: publicados ?? 120, asaltos: 250, documentos: 1, unidades: 3 };
    case 'engarde_torneo':
    case 'fww_prueba':
      return { puestos: publicados ?? 60, asaltos: 120, documentos: 0, unidades: 2 };
    default:
      return { puestos: 0, asaltos: 0, documentos: 0, unidades: 1 };
  }
}

function esReciente(f: FilaPlan, o: OpcionesPlan): boolean {
  if (!f.competitionDate) return false;
  const dias = Math.floor((o.ahora.getTime() - Date.parse(`${f.competitionDate}T00:00:00.000Z`)) / 86_400_000);
  if (dias < 0 || dias >= DIAS_TRAS_COMPETICION) return false;
  if (!f.lastCheckedAt) return true;
  return (o.ahora.getTime() - f.lastCheckedAt.getTime()) / 3_600_000 >= o.horasEntreRelecturas;
}

function pidenReleer(f: FilaPlan, clave: string, o: OpcionesPlan): boolean {
  const r = o.releer;
  if (!r) return false;
  if (r.claves?.includes(clave)) return true;
  const temporadaOk = r.temporadas?.includes(f.season) ?? false;
  if (!temporadaOk) return false;
  return !r.fuentes || r.fuentes.includes(f.source);
}

type Evaluacion =
  | { motivo: MotivoTarea }
  | { omitir: 'agotada' | 'revision' | 'categorias' | 'completa' };

function evaluarFila(f: FilaPlan, clave: string, o: OpcionesPlan): Evaluacion {
  if (f.status === 'conflicto') return { omitir: 'revision' };
  const continuacion = claseDeCursor(f.cursor) === 'continuacion';

  if (f.status === 'completo' || f.status === 'sin_resultados') {
    if (continuacion) return { motivo: 'continuar' };
    if (pidenReleer(f, clave, o)) return { motivo: 'releer' };
    if (esReciente(f, o)) return { motivo: 'cadencia_reciente' };
    return { omitir: 'completa' };
  }

  // Un documento parcial espera revisión (cabecera, región, OCR): releerlo con la misma huella no la resuelve.
  if (f.source === 'rfee_pdf' && f.status === 'parcial') {
    return pidenReleer(f, clave, o) ? { motivo: 'releer' } : { omitir: 'revision' };
  }
  if (f.lastError && PATRON_CATEGORIAS.test(f.lastError)) {
    return o.categoriasAmpliadas ? { motivo: 'categorias_ampliadas' } : { omitir: 'categorias' };
  }
  // Un error con cursor agotado también respeta max-intentos: el cursor queda para reintentar de forma explícita.
  if (f.status === 'error' && f.attempts >= o.maxIntentos) return { omitir: 'agotada' };
  if (continuacion) return { motivo: 'continuar' };
  if (f.status === 'pendiente' && !f.lastCheckedAt && f.attempts === 0) return { motivo: 'nunca_leido' };
  return f.attempts >= o.maxIntentos ? { omitir: 'agotada' } : { motivo: 'reintento_error' };
}

export function planificarDesdeCobertura(
  filas: readonly FilaPlan[],
  descubiertas: readonly UnidadDescubierta[],
  opciones: OpcionesPlan,
): PlanBackfill {
  const plan: PlanBackfill = {
    tareas: [],
    omitidas: { agotadas: [], enRevision: [], esperaCategorias: [], releerDiferidas: [], completas: 0 },
  };

  const grupos = new Map<string, FilaPlan[]>();
  const metadataFie: FilaPlan[] = [];
  for (const f of filas) {
    const tipo = TIPO_POR_FUENTE[f.source];
    if (!tipo) continue;
    const esDocumento = f.source === 'rfee_pdf';
    // Un fallo de metadata FIE no deja filas de lectura: es lo único que dice que la unidad hay que retomarla.
    if (f.source === 'fie' && f.factKind === 'competitions') {
      metadataFie.push(f);
      continue;
    }
    if (esDocumento ? f.factKind !== 'pdf' : !HECHOS_DE_LECTURA.has(f.factKind)) continue;
    const clave = claveDeUnidad({ fuente: f.source, season: f.season, competitionKey: f.competitionKey });
    const g = grupos.get(clave);
    if (g) g.push(f);
    else grupos.set(clave, [f]);
  }
  // Un error de metadata antiguo no reabre una unidad que después sí se leyó.
  for (const f of metadataFie) {
    const clave = claveDeUnidad({ fuente: f.source, season: f.season, competitionKey: f.competitionKey });
    if (!grupos.has(clave)) grupos.set(clave, [f]);
  }

  for (const [clave, grupo] of grupos) {
    let mejor: { motivo: MotivoTarea; fila: FilaPlan } | null = null;
    const omisiones = new Set<string>();
    for (const f of grupo) {
      const e = evaluarFila(f, clave, opciones);
      if ('motivo' in e) {
        if (!mejor || PRIORIDAD_MOTIVO[e.motivo] < PRIORIDAD_MOTIVO[mejor.motivo]) mejor = { motivo: e.motivo, fila: f };
      } else {
        omisiones.add(e.omitir);
      }
    }
    if (!mejor) {
      // Prima lo que más exige atención humana si ninguna fila pide lectura.
      if (omisiones.has('revision')) plan.omitidas.enRevision.push(clave);
      else if (omisiones.has('categorias')) plan.omitidas.esperaCategorias.push(clave);
      else if (omisiones.has('agotada')) plan.omitidas.agotadas.push(clave);
      else plan.omitidas.completas += 1;
      continue;
    }
    const f = mejor.fila;
    const tipo = TIPO_POR_FUENTE[f.source];
    const cursor = grupo.find((x) => claseDeCursor(x.cursor) === 'continuacion')?.cursor ?? null;
    const urlsDe = (hechos: readonly string[]) => [
      ...new Set(grupo.filter((x) => hechos.includes(x.factKind) && x.sourceUrl).map((x) => x.sourceUrl as string)),
    ];
    const urlResultados = urlsDe(['ranking', 'results'])[0] ?? grupo.find((x) => x.sourceUrl)?.sourceUrl ?? null;
    plan.tareas.push({
      clave,
      tipo,
      fuente: f.source,
      season: f.season,
      competitionKey: claveBaseDeUnidad(f.source, f.competitionKey),
      motivo: mejor.motivo,
      releer: mejor.motivo === 'releer',
      fase: FUENTES_COMPLEMENTARIAS_PLAN.includes(f.source) ? 'complementaria' : 'primaria',
      estimacion: estimarTarea(tipo, f),
      datos: {
        cursor,
        sourceUrl: urlResultados,
        poules: urlsDe(['pools']),
        cuadro: urlsDe(['tableau']),
        competitionId: grupo.find((x) => x.competitionId)?.competitionId ?? null,
      },
    });
  }

  for (const u of descubiertas) {
    const clave = claveDeUnidad(u);
    const tipo = TIPO_POR_FUENTE[u.fuente];
    if (!tipo || grupos.has(clave) || plan.tareas.some((t) => t.clave === clave)) continue;
    plan.tareas.push({
      clave,
      tipo,
      fuente: u.fuente,
      season: u.season,
      competitionKey: u.competitionKey,
      motivo: 'nunca_leido',
      releer: false,
      fase: FUENTES_COMPLEMENTARIAS_PLAN.includes(u.fuente) ? 'complementaria' : 'primaria',
      estimacion: estimarTarea(tipo, null),
      datos: { cursor: null, sourceUrl: u.sourceUrl, competitionId: null, ...(u.datos ?? {}) },
    });
  }

  // `--releer` es una operación acotada: la lectura de unidades ya completas no puede desbordar el lote.
  const releer = plan.tareas.filter((t) => t.motivo === 'releer').sort((a, b) => a.clave.localeCompare(b.clave));
  const diferidas = new Set(releer.slice(Math.max(0, opciones.maxReleer)).map((t) => t.clave));
  if (diferidas.size > 0) {
    plan.omitidas.releerDiferidas = [...diferidas];
    plan.tareas = plan.tareas.filter((t) => !diferidas.has(t.clave));
  }
  return plan;
}

export type ResumenSerie = { descubiertas: number; importadas: number };

/**
 * Conecta la clasificación de las tres series al inventario: cuántas pruebas
 * descubiertas pertenecen a cada una y cuántas tienen puestos importados. Que
 * el índice nombre una serie no demuestra que sus resultados estén importados.
 */
export function resumenPorSerie(
  catalogo: readonly { nombre: string; clave: string; categoriaCompeticion?: string | null }[],
  importadas: ReadonlySet<string>,
): Record<SerieComplementaria | 'sin_serie', ResumenSerie> {
  const salida = Object.fromEntries(
    [...SERIES_COMPLEMENTARIAS, 'sin_serie'].map((s) => [s, { descubiertas: 0, importadas: 0 }]),
  ) as Record<SerieComplementaria | 'sin_serie', ResumenSerie>;
  for (const c of catalogo) {
    const serie = clasificarSerie({ nombre: c.nombre, categoriaCompeticion: c.categoriaCompeticion }) ?? 'sin_serie';
    salida[serie].descubiertas += 1;
    if (importadas.has(c.clave)) salida[serie].importadas += 1;
  }
  return salida;
}
