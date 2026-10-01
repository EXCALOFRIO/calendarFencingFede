import type { EstadoEsquema } from '@/lib/sport/esquema';
import { sha256 } from '@/lib/utils';
import type { PlanComplementario, PruebaCanonica, CandidatoComplementario } from './conciliar-complementario';
import type { ResultadoEnlace } from './enlaces-resultados';
import type { FilaCoberturaGenerica } from './fie-resultados-db';
import type { FilaResultado, ResumenEscritura } from './fie-resultados-persist';
import type { PuestoComplementario } from './sources/engarde';

/**
 * Persistencia de las fuentes complementarias y del estado de los enlaces.
 *
 *  - Los puestos de Engarde/FWW se cuelgan de una prueba CANÓNICA ya existente
 *    (`competitionId`) con su propia fuente: no crean ediciones ni pruebas, y no
 *    asignan persona (`person_id` queda `null`; sin ID no hay unión por nombre).
 *  - El estado de un enlace vive en `sport_import_coverage` con
 *    `fact_kind='link'`: el enum de estados no distingue «sólo enlace» de
 *    «verificado», así que el estado exacto va en `cursor`.
 *  - Lo que se rechaza o queda en revisión no escribe puestos.
 */

export type DepsComplemento = {
  esquema: () => Promise<EstadoEsquema>;
  upsertResultados: (
    competitionId: string,
    source: string,
    filas: FilaResultado[],
  ) => Promise<ResumenEscritura>;
  upsertCobertura: (source: string, fila: FilaCoberturaGenerica) => Promise<void>;
};

export type ResumenComplemento = {
  estado: 'aplicado' | 'esquema_no_aplicado';
  accion: PlanComplementario['accion'];
  puestos: ResumenEscritura;
  cobertura: FilaCoberturaGenerica['status'] | null;
};

const SIN_ESCRITURA: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };

async function filasDe(
  puestos: readonly PuestoComplementario[],
  fecha: string | null,
  url: string,
): Promise<FilaResultado[]> {
  return Promise.all(
    puestos.map(async (p) => ({
      sourceFactKey: p.clave,
      personId: null,
      sourceName: p.nombre,
      sourceCountryCode: p.pais,
      sourceClub: p.club,
      position: p.posicion,
      positionRaw: p.posicionRaw,
      officialPoints: null,
      occurredOn: fecha,
      sourceUrl: url,
      contentHash: await sha256(JSON.stringify([p.posicion, p.posicionRaw, p.nombre, p.pais, p.club, fecha])),
    })),
  );
}

/**
 * Escribe (o no) lo que decidió `planificarComplemento`. Sólo `escribir` toca
 * `sport_result`; `sin_hechos` registra cobertura (sin resultados, no publicado
 * o error) sin pisar cifras anteriores; el resto no escribe nada.
 */
export async function persistirComplemento(
  deps: DepsComplemento,
  entrada: {
    competitionId: string;
    prueba: PruebaCanonica;
    candidato: CandidatoComplementario;
    plan: PlanComplementario;
    publicado: number | null;
  },
): Promise<ResumenComplemento> {
  const { competitionId, prueba, candidato, plan } = entrada;
  const base: ResumenComplemento = {
    estado: 'aplicado',
    accion: plan.accion,
    puestos: SIN_ESCRITURA,
    cobertura: null,
  };
  if (plan.accion !== 'escribir' && plan.accion !== 'sin_hechos') return base;

  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...base, estado: 'esquema_no_aplicado' };

  const fila = {
    season: prueba.season,
    factKind: 'results',
    competitionKey: candidato.clave,
    competitionId,
    sourceUrl: candidato.url,
  };

  if (plan.accion === 'sin_hechos') {
    const status = plan.estado === 'sin_resultados' ? 'sin_resultados' : plan.estado === 'error' ? 'error' : 'pendiente';
    await deps.upsertCobertura(candidato.proveedor, {
      ...fila,
      status,
      ...(plan.estado === 'sin_resultados' ? { publishedTotal: 0, importedTotal: 0 } : {}),
      lastError: plan.estado === 'sin_resultados' ? null : plan.motivo,
      cursor: plan.estado,
    });
    return { ...base, cobertura: status };
  }

  const puestos = await deps.upsertResultados(
    competitionId,
    candidato.proveedor,
    await filasDe(plan.puestos, prueba.fecha, candidato.url),
  );
  await deps.upsertCobertura(candidato.proveedor, {
    ...fila,
    status: plan.cobertura,
    publishedTotal: entrada.publicado ?? plan.puestos.length,
    importedTotal: plan.puestos.length,
    lastError: null,
    cursor: plan.cobertura,
  });
  return { ...base, puestos, cobertura: plan.cobertura };
}

export const FUENTE_ENLACE = 'enlace';

function estadoCobertura(r: ResultadoEnlace): FilaCoberturaGenerica['status'] {
  switch (r.estado) {
    case 'verificado':
    case 'solo_enlace':
      return 'completo';
    case 'no_publicado':
    case 'solo_referencia':
      return 'pendiente';
    case 'rechazado':
    case 'revision':
      return 'conflicto';
    case 'error':
      return 'error';
  }
}

/**
 * Estado de los enlaces de una prueba, uno por proveedor. «No publicado»
 * queda `pendiente` (no es cero resultados ni error), FTL queda con
 * `imported_total = 0` y `cursor = 'solo_enlace'`.
 */
export async function persistirEnlaces(
  deps: Pick<DepsComplemento, 'upsertCobertura'>,
  prueba: Pick<PruebaCanonica, 'fuente' | 'season' | 'clave'>,
  enlaces: Record<'engarde' | 'fww' | 'ftl', ResultadoEnlace>,
  competitionId: string | null = null,
): Promise<Partial<Record<'engarde' | 'fww' | 'ftl', FilaCoberturaGenerica['status']>>> {
  const salida: Partial<Record<'engarde' | 'fww' | 'ftl', FilaCoberturaGenerica['status']>> = {};
  for (const proveedor of ['engarde', 'fww', 'ftl'] as const) {
    const r = enlaces[proveedor];
    const status = estadoCobertura(r);
    await deps.upsertCobertura(`${FUENTE_ENLACE}:${proveedor}`, {
      season: prueba.season,
      factKind: 'link',
      competitionKey: `${prueba.fuente}:${prueba.clave}`,
      competitionId,
      status,
      publishedTotal: null,
      importedTotal: 0,
      sourceUrl: r.url,
      lastError: r.motivos.length > 0 ? r.motivos.join(',') : null,
      cursor: r.estado,
    });
    salida[proveedor] = status;
  }
  return salida;
}
