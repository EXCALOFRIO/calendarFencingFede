import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  identificarObservacion,
  refsPublicadas,
  SCHEME_FIE_ID,
} from '@/lib/entries/identidad';
import { normalizeSportName, resultFactKey, SIN_VIGENCIA } from '@/lib/identity/resolver';
import type { EstadoEsquema } from '@/lib/sport/esquema';
import {
  confirmarIdExterno,
  type DepsGuardConfirmacion,
  type IdExternoCandidato,
} from '@/lib/sport/id-guard';
import { sha256 } from '@/lib/utils';
import { codificarCursorFie } from './backfill/cursor-fie';
import { motivoDePresupuesto } from './backfill/presupuesto-http';
import type {
  AsaltoFie,
  EstadoCobertura,
  LecturaPruebaFie,
  PruebaFie,
  PuestoFie,
} from './sources/fie-resultados';
import { claveEdicionSerieSinTorneo } from './series-complementarias';

/**
 * Clave natural de la edición (`tournament_key`) de una prueba FIE y si agrupa
 * pruebas por serie. Con `tournamentId` se conserva tal cual. Sin él, sólo las
 * pruebas de una serie complementaria con ciudad publicada comparten edición
 * (los Juegos de París: individual y equipos); cualquier otra sigue siendo su
 * propia edición `competition:<id>`, nunca se une por nombre o fecha.
 */
export function claveEdicionFie(
  p: Pick<PruebaFie, 'tournamentId' | 'competitionId' | 'nombre' | 'categoriaCompeticion' | 'ciudad'>,
): { clave: string; agrupaPruebas: boolean } {
  if (p.tournamentId !== null) return { clave: String(p.tournamentId), agrupaPruebas: false };
  const serie = claveEdicionSerieSinTorneo({
    nombre: p.nombre,
    categoriaCompeticion: p.categoriaCompeticion,
    ciudad: p.ciudad,
  });
  return serie === null
    ? { clave: `competition:${p.competitionId}`, agrupaPruebas: false }
    : { clave: serie, agrupaPruebas: true };
}

/**
 * Persistencia de una lectura de resultados FIE sobre el modelo deportivo.
 *
 * Todo lo que toca la base entra por `DepsPersistenciaFie`, de modo que la
 * orquestación (identidad, deduplicado, cobertura) se prueba con dependencias
 * controladas y la implementación real vive en `fie-resultados-db.ts`.
 *
 * Reglas que esta capa añade a la lectura:
 *  - Una persona sólo se identifica por el ID FIE publicado, con el mismo
 *    camino de referencias/evidencia confirmada que la unión de inscritos. Un
 *    ID sin persona crea una persona NUEVA con ese ID confirmado a través del
 *    guard compartido; nunca se une a una ficha por parecerse el nombre.
 *  - En equipos el `fencer.id` es del equipo: no se resuelve ninguna persona.
 *  - Una lectura fallida sólo toca la cobertura: no borra ni sustituye datos
 *    ya importados, y los hechos que ya no aparecen tampoco se eliminan.
 */

export const FUENTE_FIE = 'fie';

export type ResumenEscritura = { nuevos: number; revisados: number; sinCambios: number };

export type FilaResultado = {
  sourceFactKey: string;
  personId: string | null;
  sourceName: string;
  sourceCountryCode: string | null;
  /** Fuentes que publican club (Skermo); la FIE no lo da en el ranking. */
  sourceClub?: string | null;
  position: number | null;
  positionRaw: string | null;
  officialPoints: string | null;
  occurredOn: string | null;
  sourceUrl: string;
  contentHash: string;
};

export type FilaAsalto = {
  phase: 'POULE' | 'TABLEAU';
  roundKey: string;
  fencerARef: string;
  fencerBRef: string;
  fencerAPersonId: string | null;
  fencerBPersonId: string | null;
  fencerAName: string;
  fencerBName: string;
  scoreA: number;
  scoreB: number;
  occurredOn: string | null;
  sourceUrl: string;
  contentHash: string;
};

export type FilaCobertura = {
  season: string;
  factKind: 'competitions' | 'ranking' | 'pools' | 'tableau';
  competitionKey: string;
  competitionId: string | null;
  status: EstadoCobertura;
  /** `undefined` = no tocar la cifra anterior (lectura fallida). */
  publishedTotal?: number | null;
  importedTotal?: number;
  sourceUrl: string;
  lastError: string | null;
  /** Checkpoint de continuación; `null` lo limpia y `undefined` no lo toca. */
  cursor?: string | null;
  /** Fase aplazada por el presupuesto del lote: no es una lectura, no gasta un intento. */
  sinIntento?: boolean;
};

export type DepsPersistenciaFie = {
  esquema: () => Promise<EstadoEsquema>;
  evidencia: DepsEvidencia;
  guard: DepsGuardConfirmacion;
  /** Short serverless increments may store unresolved facts without a per-person write loop. */
  crearIdentidades?: boolean;
  upsertPrueba: (prueba: PruebaFie) => Promise<string>;
  upsertResultados: (competitionId: string, filas: FilaResultado[]) => Promise<ResumenEscritura>;
  upsertAsaltos: (competitionId: string, filas: FilaAsalto[]) => Promise<ResumenEscritura>;
  upsertCobertura: (fila: FilaCobertura) => Promise<void>;
  /**
   * Puestos ya guardados de la prueba (claves naturales distintas) y cuántos
   * siguen sin persona. Sólo hace falta al continuar un ranking paginado: el
   * total acumulado y deduplicado sale de aquí, no de sumar lecturas.
   */
  contarResultados?: (competitionId: string) => Promise<{ total: number; sinPersona: number }>;
  /** Sólo para pruebas deterministas; por defecto `crypto.randomUUID`. */
  nuevoId?: () => string;
};

export type ResumenPersistencia = {
  estado: 'aplicado' | 'esquema_no_aplicado';
  competitionId: string | null;
  puestos: ResumenEscritura;
  poules: ResumenEscritura;
  cuadro: ResumenEscritura;
  personas: { confirmadas: number; creadas: number; enRevision: number; conflictos: number };
  cobertura: Partial<Record<FilaCobertura['factKind'], EstadoCobertura>>;
};

const SIN_ESCRITURA: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };

type DatosPersona = { nombre: string; pais: string | null; genero: 'M' | 'F' | null };

async function hashDe(...partes: unknown[]): Promise<string> {
  return sha256(JSON.stringify(partes));
}

async function filasDeResultados(
  puestos: readonly PuestoFie[],
  prueba: PruebaFie,
  url: string,
  personas: ReadonlyMap<number, string | null>,
): Promise<FilaResultado[]> {
  const individual = prueba.formato === 'INDIVIDUAL';
  return Promise.all(
    puestos.map(async (p) => ({
      sourceFactKey: individual ? resultFactKey(String(p.fieId)) : `team:${p.fieId}`,
      personId: individual ? (personas.get(p.fieId) ?? null) : null,
      sourceName: p.nombre,
      sourceCountryCode: p.paisCodigo,
      position: p.posicion,
      positionRaw: p.posicion === null ? null : String(p.posicion),
      officialPoints: p.puntosPrueba === null ? null : String(p.puntosPrueba),
      occurredOn: prueba.fecha,
      sourceUrl: url,
      contentHash: await hashDe(p.posicion, p.puntosPrueba, p.nombre, p.paisCodigo, prueba.fecha),
    })),
  );
}

async function filasDeAsaltos(
  asaltos: readonly AsaltoFie[],
  prueba: PruebaFie,
  url: string,
  personas: ReadonlyMap<number, string | null>,
): Promise<FilaAsalto[]> {
  return Promise.all(
    asaltos.map(async (a) => {
      const pa = personas.get(Number(a.refA)) ?? null;
      const pb = personas.get(Number(a.refB)) ?? null;
      // Fusiones mal encadenadas no pueden convertir un cruce en consigo mismo.
      const iguales = pa !== null && pa === pb;
      return {
        phase: a.fase,
        roundKey: a.ronda,
        fencerARef: a.refA,
        fencerBRef: a.refB,
        fencerAPersonId: iguales ? null : pa,
        fencerBPersonId: iguales ? null : pb,
        fencerAName: a.nombreA,
        fencerBName: a.nombreB,
        scoreA: a.puntosA,
        scoreB: a.puntosB,
        occurredOn: prueba.fecha,
        sourceUrl: url,
        contentHash: await hashDe(a.fase, a.ronda, a.refA, a.refB, a.puntosA, a.puntosB),
      };
    }),
  );
}

/**
 * Persona de cada ID FIE individual. Devuelve `null` para quien queda en
 * revisión o en conflicto; esos hechos se guardan igualmente con su ID FIE.
 */
async function resolverPersonas(
  deps: DepsPersistenciaFie,
  prueba: PruebaFie,
  participantes: ReadonlyMap<number, DatosPersona>,
): Promise<{ personas: Map<number, string | null>; resumen: ResumenPersistencia['personas'] }> {
  const personas = new Map<number, string | null>();
  const resumen = { confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 };
  const observaciones = [...participantes.keys()].map((fieId) => ({
    fieId,
    refs: refsPublicadas({ fuente: FUENTE_FIE, fieId, observadoEl: prueba.fecha }),
  }));
  const evidencia = await cargarEvidencia(
    deps.evidencia,
    observaciones.flatMap((o) => o.refs),
  );

  for (const { fieId, refs } of observaciones) {
    const { resolucion } = identificarObservacion(
      { fuente: FUENTE_FIE, refs, arma: prueba.arma, dia: prueba.fecha },
      evidencia,
    );
    if (resolucion.kind === 'confirmed') {
      personas.set(fieId, resolucion.personId);
      resumen.confirmadas += 1;
      continue;
    }
    if (resolucion.kind === 'review') {
      personas.set(fieId, null);
      resumen.enRevision += 1;
      continue;
    }
    if (resolucion.kind === 'conflict') {
      personas.set(fieId, null);
      resumen.conflictos += 1;
      continue;
    }

    if (deps.crearIdentidades === false) {
      personas.set(fieId, null);
      resumen.enRevision += 1;
      continue;
    }
    const datos = participantes.get(fieId)!;
    const id = deps.nuevoId?.() ?? crypto.randomUUID();
    const candidato: IdExternoCandidato = {
      personId: id,
      scheme: SCHEME_FIE_ID,
      value: String(fieId),
      scopeSource: FUENTE_FIE,
      scopeFederation: '',
      scopeSeason: '',
      scopeWeapon: '',
      validFrom: SIN_VIGENCIA,
      validTo: null,
      linkedVia: 'fie_resultados',
      evidence: `ID FIE publicado en resultados ${prueba.season}/${prueba.competitionId}`,
    };
    const confirmado = await confirmarIdExterno(deps.guard, candidato, {
      id,
      displayName: datos.nombre,
      nameNormalized: normalizeSportName(datos.nombre),
      gender: datos.genero,
      countryCode: datos.pais,
      aliasSource: FUENTE_FIE,
    });
    if (confirmado.ok) {
      personas.set(fieId, id);
      resumen.creadas += 1;
    } else {
      personas.set(fieId, null);
      resumen.conflictos += 1;
    }
  }
  return { personas, resumen };
}

function participantesDe(lectura: LecturaPruebaFie): Map<number, DatosPersona> {
  const mapa = new Map<number, DatosPersona>();
  for (const a of [...(lectura.poules?.asaltos ?? []), ...(lectura.cuadro?.asaltos ?? [])]) {
    if (!mapa.has(Number(a.refA))) mapa.set(Number(a.refA), { nombre: a.nombreA, pais: null, genero: null });
    if (!mapa.has(Number(a.refB))) mapa.set(Number(a.refB), { nombre: a.nombreB, pais: null, genero: null });
  }
  // El ranking manda: trae país y género publicados para el mismo ID.
  for (const p of lectura.ranking?.puestos ?? []) {
    mapa.set(p.fieId, { nombre: p.nombre, pais: p.paisCodigo, genero: p.genero });
  }
  return mapa;
}

export async function persistirLecturaFie(
  deps: DepsPersistenciaFie,
  lectura: LecturaPruebaFie,
): Promise<ResumenPersistencia> {
  const resumen: ResumenPersistencia = {
    estado: 'aplicado',
    competitionId: null,
    puestos: SIN_ESCRITURA,
    poules: SIN_ESCRITURA,
    cuadro: SIN_ESCRITURA,
    personas: { confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 },
    cobertura: {},
  };
  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...resumen, estado: 'esquema_no_aplicado' };

  const season = String(lectura.season);
  const competitionKey = String(lectura.competitionId);
  const { prueba } = lectura;

  if (!prueba) {
    await deps.upsertCobertura({
      season,
      factKind: 'competitions',
      competitionKey,
      competitionId: null,
      status: 'error',
      sourceUrl: `https://fie.org/api/fie/competition/${lectura.season}/${lectura.competitionId}`,
      lastError: lectura.errorPrueba,
    });
    resumen.cobertura.competitions = 'error';
    return resumen;
  }

  const competitionId = await deps.upsertPrueba(prueba);
  resumen.competitionId = competitionId;
  const individual = prueba.formato === 'INDIVIDUAL';

  let personas = new Map<number, string | null>();
  if (individual) {
    const r = await resolverPersonas(deps, prueba, participantesDe(lectura));
    personas = r.personas;
    resumen.personas = r.resumen;
  }

  const { ranking, poules, cuadro } = lectura;

  if (ranking) {
    const ok = ranking.cobertura.estado !== 'error';
    if (ok && ranking.puestos.length > 0) {
      resumen.puestos = await deps.upsertResultados(
        competitionId,
        await filasDeResultados(ranking.puestos, prueba, ranking.url, personas),
      );
    }

    let estadoLectura: EstadoCobertura = ranking.cobertura.estado;
    let importado = ranking.cobertura.importado;
    let sinIdentidad = resumen.personas.conflictos + resumen.personas.enRevision;
    const continuada = ranking.paginaDesde > 1 || ranking.siguientePagina !== null;
    if (ok && continuada && deps.contarResultados) {
      // Totales acumulados y deduplicados por clave natural, no la suma de lecturas.
      const guardados = await deps.contarResultados(competitionId);
      importado = guardados.total;
      sinIdentidad = prueba.formato === 'INDIVIDUAL' ? guardados.sinPersona : 0;
      const total = ranking.cobertura.publicado;
      const cerrada =
        ranking.siguientePagina === null &&
        ranking.cobertura.error === null &&
        total !== null &&
        importado >= total;
      estadoLectura = cerrada ? 'completo' : 'parcial';
    }

    const estado = estadoLectura === 'completo' && sinIdentidad > 0 ? 'conflicto' : estadoLectura;
    await deps.upsertCobertura({
      season,
      factKind: 'ranking',
      competitionKey,
      competitionId,
      status: estado,
      ...(ok ? { publishedTotal: ranking.cobertura.publicado, importedTotal: importado } : {}),
      // Sólo una lectura válida mueve el checkpoint; un fallo inicial conserva el anterior.
      ...(ok
        ? {
            cursor:
              ranking.siguientePagina === null
                ? null
                : codificarCursorFie({
                    fuente: 'fie',
                    season: lectura.season,
                    competitionId: lectura.competitionId,
                    pageSize: ranking.tamanoPagina,
                    siguientePagina: ranking.siguientePagina,
                    total: ranking.cobertura.publicado,
                  }),
          }
        : {}),
      sourceUrl: ranking.url,
      lastError:
        ranking.cobertura.error ??
        (estado === 'conflicto' ? `${sinIdentidad} participantes sin identidad confirmada` : null),
    });
    resumen.cobertura.ranking = estado;
  }

  for (const [parte, factKind, clave] of [
    [poules, 'pools', 'poules'],
    [cuadro, 'tableau', 'cuadro'],
  ] as const) {
    if (!parte) continue;
    // Una fase que el presupuesto del lote no dejó pedir no es un fallo de la fuente: queda
    // pendiente y reanudable, sin gastar un intento y sin tocar lo que ya hubiera guardado.
    if (motivoDePresupuesto(parte.cobertura.error)) {
      await deps.upsertCobertura({
        season,
        factKind,
        competitionKey,
        competitionId,
        status: 'pendiente',
        sourceUrl: parte.url,
        lastError: parte.cobertura.error,
        sinIntento: true,
      });
      resumen.cobertura[factKind] = 'pendiente';
      continue;
    }
    const ok = parte.cobertura.estado !== 'error';
    if (ok && parte.asaltos.length > 0) {
      resumen[clave] = await deps.upsertAsaltos(
        competitionId,
        await filasDeAsaltos(parte.asaltos, prueba, parte.url, personas),
      );
    }
    await deps.upsertCobertura({
      season,
      factKind,
      competitionKey,
      competitionId,
      status: parte.cobertura.estado,
      ...(ok ? { publishedTotal: parte.cobertura.publicado, importedTotal: parte.cobertura.importado } : {}),
      sourceUrl: parte.url,
      lastError: parte.cobertura.error,
    });
    resumen.cobertura[factKind] = parte.cobertura.estado;
  }

  return resumen;
}
