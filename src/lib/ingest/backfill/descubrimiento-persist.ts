import type { FilaCoberturaGenerica } from '../fie-resultados-db';
import type { EstadoUnidad, UnidadInventario } from '../sources/historico-indice';
import type { UnidadDescubierta } from './plan';

/**
 * Progreso durable del descubrimiento. Cada unidad de índice (temporada) se
 * persiste ANTES de pasar a la siguiente, en este orden:
 *
 *  1. las pruebas y documentos que descubrió, como cobertura `pendiente` sin
 *     intentos (sólo se insertan si no existían: nunca pisan una lectura);
 *  2. el checkpoint del índice (`index:FED`), con la página siguiente si quedó
 *     parcial o falló a mitad.
 *
 * Si el proceso cae entre 1 y 2, la temporada se vuelve a leer y la inserción
 * es idempotente. El checkpoint lleva una marca: un índice guardado por
 * `inventario-historico`, que no sembró las pruebas, no cuenta como leído.
 */

export type FilaSemilla = {
  season: string;
  factKind: 'ranking' | 'results' | 'pdf';
  competitionKey: string;
  sourceUrl: string | null;
  cursor: string | null;
};

export type DepsPersistenciaDescubrimiento = {
  /** Upsert con las reglas de `escribirCobertura`. */
  escribirCobertura: (source: string, fila: FilaCoberturaGenerica) => Promise<void>;
  /** Inserta sólo las filas que no existen: un descubrimiento nunca pisa un estado ya leído. */
  sembrar: (filas: readonly { source: string; fila: FilaSemilla }[]) => Promise<void>;
  leerIndices: () => Promise<FilaIndiceGuardada[]>;
};

export type FilaIndiceGuardada = {
  source: string;
  season: string;
  competitionKey: string;
  status: string;
  publishedTotal: number | null;
  importedTotal: number;
  cursor: string | null;
  sourceUrl: string | null;
  lastError: string | null;
};

type CursorIndice = { v: 1; semillas: true; siguientePagina: number | null };

export const codificarCursorIndice = (siguientePagina: number | null): string =>
  JSON.stringify({ v: 1, semillas: true, siguientePagina } satisfies CursorIndice);

function decodificarCursorIndice(texto: string | null): CursorIndice | null {
  if (!texto) return null;
  try {
    const c = JSON.parse(texto) as Partial<CursorIndice>;
    if (c.v !== 1 || c.semillas !== true) return null;
    return { v: 1, semillas: true, siguientePagina: typeof c.siguientePagina === 'number' ? c.siguientePagina : null };
  } catch {
    return null;
  }
}

const ESTADO_COBERTURA = {
  leido: 'completo',
  parcial: 'parcial',
  sin_filas: 'sin_resultados',
  error: 'error',
  inaccesible: 'error',
} as const satisfies Partial<Record<EstadoUnidad, FilaCoberturaGenerica['status']>>;

const UNIDAD_DE_ESTADO: Record<string, EstadoUnidad> = {
  completo: 'leido',
  parcial: 'parcial',
  sin_resultados: 'sin_filas',
  error: 'error',
};

/**
 * Semilla de una unidad descubierta. Un PDF lleva la fila del índice de la que salió (índice,
 * referencia y título verificados) para que una lectura posterior no la pierda.
 */
export function semillaDeUnidad(u: UnidadDescubierta): { source: string; fila: FilaSemilla } {
  if (u.fuente === 'rfee_pdf') {
    const d = u.datos ?? {};
    const origen = {
      indice: typeof d.indice === 'number' ? d.indice : null,
      refOriginal: typeof d.refOriginal === 'string' ? d.refOriginal : null,
      sourceUrl: u.sourceUrl,
      titulo: typeof d.titulo === 'string' ? d.titulo : null,
    };
    return {
      source: 'rfee_pdf',
      fila: {
        season: u.season,
        factKind: 'pdf',
        competitionKey: u.competitionKey,
        sourceUrl: u.sourceUrl,
        cursor: JSON.stringify({ v: 1, sha256: null, semilla: true, origen }),
      },
    };
  }
  return {
    source: u.fuente,
    fila: {
      season: u.season,
      factKind: u.fuente === 'fie' ? 'ranking' : 'results',
      competitionKey: u.competitionKey,
      sourceUrl: u.sourceUrl,
      cursor: null,
    },
  };
}

/** Persiste lo descubierto en una unidad de índice y, sólo después, su checkpoint. */
export async function persistirUnidadDescubierta(
  deps: DepsPersistenciaDescubrimiento,
  unidad: UnidadInventario,
  descubiertas: readonly UnidadDescubierta[],
): Promise<void> {
  if (descubiertas.length > 0) await deps.sembrar(descubiertas.map(semillaDeUnidad));
  const status = ESTADO_COBERTURA[unidad.estado as keyof typeof ESTADO_COBERTURA];
  // Una unidad de federación (sin temporada) no es coberturable, y lo pendiente no ha leído nada.
  if (!status || !unidad.temporada) return;
  await deps.escribirCobertura(unidad.fuente, {
    season: unidad.temporada,
    factKind: 'index',
    competitionKey: `index:${unidad.federacion}`,
    competitionId: null,
    status,
    // Un fallo sin nada leído no pisa las cifras; con páginas ya leídas se guardan para poder retomarlas.
    ...(status === 'error' && unidad.filas === 0 ? {} : { publishedTotal: unidad.publicado, importedTotal: unidad.filas }),
    sourceUrl: unidad.url,
    lastError: unidad.error,
    cursor: codificarCursorIndice(status === 'completo' || status === 'sin_resultados' ? null : unidad.siguientePagina),
  });
}

/** Progreso guardado de ejecuciones anteriores: sólo cuenta el índice que dejó sus pruebas sembradas. */
export async function cargarProgresoIndice(deps: DepsPersistenciaDescubrimiento): Promise<UnidadInventario[]> {
  const previas: UnidadInventario[] = [];
  for (const f of await deps.leerIndices()) {
    const cursor = decodificarCursorIndice(f.cursor);
    const estado = UNIDAD_DE_ESTADO[f.status];
    if (!cursor || !estado || !f.competitionKey.startsWith('index:')) continue;
    const fuente = f.source as UnidadInventario['fuente'];
    if (fuente !== 'fie' && fuente !== 'skermo_rfee' && fuente !== 'skermo_regional') continue;
    previas.push({
      fuente,
      federacion: f.competitionKey.slice('index:'.length),
      temporada: f.season,
      estado,
      filas: f.importedTotal,
      publicado: f.publishedTotal,
      enlaces: { html: 0, pdf: 0, api: 0, externo: 0 },
      sinDocumento: 0,
      descuadradas: 0,
      siguientePagina: cursor.siguientePagina,
      url: f.sourceUrl ?? '',
      error: f.lastError,
    });
  }
  return previas;
}
