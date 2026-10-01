import type { EstadoEsquema } from '@/lib/sport/esquema';
import { sha256 } from '@/lib/utils';
import type { AsaltoComplementario } from './asaltos-complementarios';
import type {
  PlanAsaltos,
  PlanComplementario,
  PruebaCanonica,
  CandidatoComplementario,
} from './conciliar-complementario';
import type { ResultadoEnlace } from './enlaces-resultados';
import type { FilaCoberturaGenerica } from './fie-resultados-db';
import type { FilaAsalto, FilaResultado, ResumenEscritura } from './fie-resultados-persist';
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

type PlanSinHechosEscritos =
  | { accion: 'revision'; motivos: readonly string[] }
  | { accion: 'conflicto'; motivo: string }
  | { accion: 'diferir'; motivo: string };

/**
 * Revisión, conflicto y aplazamiento no escriben hechos, pero SÍ dejan constancia
 * de qué candidato (URL, clave), con qué motivo y en qué estado: sin ella, una
 * cobertura «completo» anterior seguiría intacta y la revisión humana no sabría
 * qué mirar. `rechazar` y `sin_cambios` no registran nada.
 */
export function estadoDeAccionSinHechos(plan: { accion: string }): {
  status: FilaCoberturaGenerica['status'];
  lastError: string;
  cursor: string;
} | null {
  const p = plan as PlanSinHechosEscritos;
  switch (p.accion) {
    case 'revision':
      return { status: 'conflicto', lastError: `revision: ${p.motivos.join(',')}`.slice(0, 300), cursor: 'revision' };
    case 'conflicto':
      return { status: 'conflicto', lastError: p.motivo.slice(0, 300), cursor: 'conflicto' };
    case 'diferir':
      return { status: 'pendiente', lastError: `diferido: ${p.motivo}`, cursor: 'diferido' };
    default:
      return null;
  }
}

/** Constancia de un candidato revisado, en conflicto o diferido. `competitionId` es `null` si no hubo canónica aceptada. */
export async function persistirEstadoCandidato(
  deps: Pick<DepsComplemento, 'esquema' | 'upsertCobertura'>,
  entrada: {
    season: string;
    competitionId: string | null;
    candidato: Pick<CandidatoComplementario, 'proveedor' | 'clave' | 'url'>;
    factKind: 'results' | 'pools' | 'tableau';
    plan: { accion: string };
  },
): Promise<{ estado: 'aplicado' | 'esquema_no_aplicado' | 'omitido'; cobertura: FilaCoberturaGenerica['status'] | null }> {
  const estado = estadoDeAccionSinHechos(entrada.plan);
  if (!estado) return { estado: 'omitido', cobertura: null };
  if (!(await deps.esquema()).identidad) return { estado: 'esquema_no_aplicado', cobertura: null };
  await deps.upsertCobertura(entrada.candidato.proveedor, {
    season: entrada.season,
    factKind: entrada.factKind,
    competitionKey: entrada.candidato.clave,
    competitionId: entrada.competitionId,
    status: estado.status,
    sourceUrl: entrada.candidato.url,
    lastError: estado.lastError,
    cursor: estado.cursor,
  });
  return { estado: 'aplicado', cobertura: estado.status };
}

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
  if (plan.accion !== 'escribir' && plan.accion !== 'sin_hechos') {
    const r = await persistirEstadoCandidato(deps, {
      season: prueba.season,
      competitionId,
      candidato,
      factKind: 'results',
      plan,
    });
    return r.estado === 'esquema_no_aplicado' ? { ...base, estado: 'esquema_no_aplicado' } : { ...base, cobertura: r.cobertura };
  }

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

export type DepsAsaltosComplemento = Pick<DepsComplemento, 'esquema' | 'upsertCobertura'> & {
  upsertAsaltos: (competitionId: string, source: string, filas: FilaAsalto[]) => Promise<ResumenEscritura>;
};

export type ResumenAsaltosComplemento = {
  estado: 'aplicado' | 'esquema_no_aplicado';
  accion: PlanAsaltos['accion'];
  asaltos: ResumenEscritura;
  cobertura: FilaCoberturaGenerica['status'] | null;
};

/**
 * Las referencias de Engarde llevan el nombre publicado: su orden en Postgres
 * (`sport_bout_canonical_order`) dependería de la collation de la base. Se
 * guardan como hash hexadecimal de longitud fija, cuyo orden es el mismo con
 * cualquier collation; el nombre sigue en `fencer_*_name` y nunca identifica
 * a una persona.
 */
async function refAlmacenada(ref: string): Promise<string> {
  return ref.startsWith('engarde:') ? `engarde:${(await sha256(ref)).slice(0, 32)}` : ref;
}

async function filasDeAsaltos(
  asaltos: readonly AsaltoComplementario[],
  fecha: string | null,
  urlPorDefecto: string,
): Promise<FilaAsalto[]> {
  const filas = new Map<string, FilaAsalto>();
  for (const a of asaltos) {
    const [ra, rb] = await Promise.all([refAlmacenada(a.refA), refAlmacenada(a.refB)]);
    if (ra === rb) continue;
    const invertir = ra > rb;
    const [x, y] = invertir ? [rb, ra] : [ra, rb];
    const fila: FilaAsalto = {
      phase: a.fase,
      roundKey: a.ronda,
      fencerARef: x,
      fencerBRef: y,
      // Sin ID publicado no hay unión a una persona: el nombre no confirma identidad.
      fencerAPersonId: null,
      fencerBPersonId: null,
      fencerAName: invertir ? a.nombreB : a.nombreA,
      fencerBName: invertir ? a.nombreA : a.nombreB,
      scoreA: invertir ? a.puntosB : a.puntosA,
      scoreB: invertir ? a.puntosA : a.puntosB,
      occurredOn: fecha,
      sourceUrl: a.url ?? urlPorDefecto,
      contentHash: await sha256(JSON.stringify([a.fase, a.ronda, x, y, invertir ? a.puntosB : a.puntosA, invertir ? a.puntosA : a.puntosB])),
    };
    // Un duelo publicado desde las dos perspectivas es uno solo.
    filas.set(`${fila.phase}|${fila.roundKey}|${x}|${y}`, fila);
  }
  return [...filas.values()];
}

/**
 * Escribe los asaltos individuales de UNA fase (poules o cuadro) de una fuente
 * complementaria. Cada fase tiene su cobertura (`pools`/`tableau`), distinta de
 * la de los finales. `sin_hechos` sólo registra cobertura; el resto no escribe.
 */
export async function persistirAsaltosComplemento(
  deps: DepsAsaltosComplemento,
  entrada: {
    competitionId: string;
    prueba: PruebaCanonica;
    candidato: CandidatoComplementario;
    fase: AsaltoComplementario['fase'];
    plan: PlanAsaltos;
  },
): Promise<ResumenAsaltosComplemento> {
  const { competitionId, prueba, candidato, fase, plan } = entrada;
  const base: ResumenAsaltosComplemento = {
    estado: 'aplicado',
    accion: plan.accion,
    asaltos: SIN_ESCRITURA,
    cobertura: null,
  };
  if (plan.accion !== 'escribir' && plan.accion !== 'sin_hechos') {
    const r = await persistirEstadoCandidato(deps, {
      season: prueba.season,
      competitionId,
      candidato,
      factKind: fase === 'POULE' ? 'pools' : 'tableau',
      plan,
    });
    return r.estado === 'esquema_no_aplicado' ? { ...base, estado: 'esquema_no_aplicado' } : { ...base, cobertura: r.cobertura };
  }
  if (plan.accion === 'escribir' && plan.fase !== fase) return base;

  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...base, estado: 'esquema_no_aplicado' };

  const fila = {
    season: prueba.season,
    factKind: fase === 'POULE' ? 'pools' : 'tableau',
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

  const filas = await filasDeAsaltos(plan.asaltos, prueba.fecha, candidato.url);
  const asaltos = await deps.upsertAsaltos(competitionId, candidato.proveedor, filas);
  await deps.upsertCobertura(candidato.proveedor, {
    ...fila,
    status: plan.cobertura,
    publishedTotal: plan.publicado,
    importedTotal: filas.length,
    lastError: null,
    cursor: plan.cobertura,
  });
  return { ...base, asaltos, cobertura: plan.cobertura };
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
