import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  identificarObservacion,
  refsPublicadas,
  type RefPublicada,
} from '@/lib/entries/identidad';
import type { EstadoEsquema } from '@/lib/sport/esquema';
import type { EstadoCobertura } from './sources/fie-resultados';
import type {
  EntradaRanking,
  LecturaRanking,
  PublicacionRanking,
} from './sources/ranking-oficial-historico';

/**
 * Persistencia de una lectura de ranking oficial en `sport_ranking_publication`
 * y `sport_ranking_entry`.
 *
 * Todo lo que toca la base entra por `DepsPersistenciaRanking`. Reglas de esta
 * capa:
 *  - sólo se ADJUNTA una persona que ya está confirmada por ID (FIE) o por la
 *    licencia que Skermo publicó para ese mismo ID de ranking en esa temporada.
 *    No se crea ninguna persona desde un ranking (el censo ya existe) y el
 *    nombre no es nunca clave: sin ID confirmado la fila queda pendiente, con
 *    el ID de la fuente y el nombre publicado;
 *  - selecciones/equipos jamás llevan persona;
 *  - una lectura que no es una lista sólo toca la cobertura;
 *  - la escritura no duplica: una lista idéntica a la última de la misma
 *    temporada no crea otra publicación (ver `ranking-oficial-db.ts`).
 */

export type FilaEntradaRanking = {
  sourceRef: string;
  personId: string | null;
  sourceName: string | null;
  countryCode: string | null;
  position: number | null;
  points: string | null;
};

export type ResultadoEscrituraRanking = {
  estado: 'creada' | 'sin_cambios';
  publicationId: string;
  /** Filas con persona recién adjuntada en una lista que no había cambiado. */
  personasIncorporadas: number;
};

export type FilaCoberturaRanking = {
  season: string;
  /** Fuente de la lista: `skermo_ranking` o `fie_tiradores`. */
  source: string;
  factKind: 'ranking';
  competitionKey: string;
  competitionId: null;
  status: EstadoCobertura;
  publishedTotal?: number | null;
  importedTotal?: number;
  sourceUrl: string;
  lastError: string | null;
};

export type DepsPersistenciaRanking = {
  esquema: () => Promise<EstadoEsquema>;
  /** Como en los puestos finales: sin esta dependencia M10/M12 no se guardan. */
  categoriasHistoricas?: () => Promise<boolean>;
  evidencia: DepsEvidencia;
  /**
   * Licencia RFEE publicada para cada ID de ranking de Skermo en ESA temporada
   * (la ficha del tirador, no el nombre). Vacío si no se resolvió ninguna.
   */
  licenciasRfee?: (season: string, skermoIds: string[]) => Promise<ReadonlyMap<string, string>>;
  escribirPublicacion: (
    publicacion: PublicacionRanking,
    filas: FilaEntradaRanking[],
  ) => Promise<ResultadoEscrituraRanking>;
  /** Optional effective status, e.g. an empty-after-published conflict. */
  upsertCobertura: (fila: FilaCoberturaRanking) => Promise<void | EstadoCobertura>;
};

export type ResumenPersistenciaRanking = {
  estado: 'aplicado' | 'esquema_no_aplicado';
  publicacion: 'creada' | 'sin_cambios' | null;
  entradas: number;
  personas: { adjuntas: number; pendientes: number; conflictos: number; incorporadas: number };
  cobertura: EstadoCobertura | null;
};

/** Lo que identifica el contenido de una lista: referencia, puesto, puntos, nombre y país. */
export function huellaDeEntrada(e: {
  sourceRef: string;
  position: number | null;
  points: string | number | null;
  sourceName: string | null;
  countryCode: string | null;
}): string {
  const puntos = e.points === null ? null : Number(e.points);
  return JSON.stringify([e.sourceRef, e.position, puntos, e.sourceName, e.countryCode]);
}

export function mismaLista(
  guardadas: readonly Parameters<typeof huellaDeEntrada>[0][],
  nuevas: readonly Parameters<typeof huellaDeEntrada>[0][],
): boolean {
  if (guardadas.length !== nuevas.length) return false;
  const a = guardadas.map(huellaDeEntrada).sort();
  const b = nuevas.map(huellaDeEntrada).sort();
  return a.every((h, i) => h === b[i]);
}

/** Último día de la temporada: FIE «2024» acaba el 31/08/2024; RFEE «2021-2022», el 31/08/2022. */
export function finDeTemporada(season: string): string | null {
  const rfee = season.match(/^(\d{4})-(\d{4})$/);
  if (rfee) return `${rfee[2]}-08-31`;
  return /^\d{4}$/.test(season) ? `${season}-08-31` : null;
}

/**
 * Día con el que se identifica a una persona: el de la lectura, pero nunca
 * posterior al fin de la temporada, para que un ID vigente sólo en una época
 * no se aplique a una lista de otra.
 */
export function diaDeObservacion(season: string, publicadoEl: string): string {
  const fin = finDeTemporada(season);
  return fin && fin < publicadoEl ? fin : publicadoEl;
}

function esHistorica(categoria: string): boolean {
  return categoria === 'M10' || categoria === 'M12';
}

async function resolverPersonas(
  deps: DepsPersistenciaRanking,
  pub: PublicacionRanking,
): Promise<{ personas: Map<string, string | null>; resumen: ResumenPersistenciaRanking['personas'] }> {
  const personas = new Map<string, string | null>();
  const resumen = { adjuntas: 0, pendientes: 0, conflictos: 0, incorporadas: 0 };
  const dia = diaDeObservacion(pub.season, pub.publicadoEl);

  const individuales = pub.formato === 'INDIVIDUAL' ? pub.entradas : [];
  const licencias =
    pub.fuente === 'skermo_ranking' && deps.licenciasRfee
      ? await deps.licenciasRfee(
          pub.season,
          individuales.flatMap((e) => (e.referencia?.tipo === 'skermo' ? [e.referencia.skermoId] : [])),
        )
      : new Map<string, string>();

  const observaciones: { entrada: EntradaRanking; refs: RefPublicada[] }[] = [];
  for (const entrada of individuales) {
    const r = entrada.referencia;
    let refs: RefPublicada[] = [];
    if (r?.tipo === 'fie') {
      refs = refsPublicadas({ fuente: 'fie', fieId: r.fieId, observadoEl: dia });
    } else if (r?.tipo === 'skermo') {
      const licencia = licencias.get(r.skermoId);
      if (licencia) {
        refs = refsPublicadas({ fuente: 'skermo_rfee', licencia, observadoEl: dia }).map((ref) => ({
          ...ref,
          scopeSeason: pub.season,
        }));
      }
    }
    observaciones.push({ entrada, refs });
  }

  const evidencia = await cargarEvidencia(
    deps.evidencia,
    observaciones.flatMap((o) => o.refs),
  );

  for (const { entrada, refs } of observaciones) {
    if (refs.length === 0) {
      personas.set(entrada.sourceRef, null);
      resumen.pendientes += 1;
      continue;
    }
    const { resolucion } = identificarObservacion(
      { fuente: pub.fuente === 'fie_tiradores' ? 'fie' : 'skermo_rfee', refs, arma: pub.arma, dia },
      evidencia,
    );
    if (resolucion.kind === 'confirmed') {
      personas.set(entrada.sourceRef, resolucion.personId);
      resumen.adjuntas += 1;
    } else {
      personas.set(entrada.sourceRef, null);
      if (resolucion.kind === 'conflict') resumen.conflictos += 1;
      else resumen.pendientes += 1;
    }
  }
  return { personas, resumen };
}

export async function persistirLecturaRanking(
  deps: DepsPersistenciaRanking,
  lectura: LecturaRanking,
): Promise<ResumenPersistenciaRanking> {
  const resumen: ResumenPersistenciaRanking = {
    estado: 'aplicado',
    publicacion: null,
    entradas: 0,
    personas: { adjuntas: 0, pendientes: 0, conflictos: 0, incorporadas: 0 },
    cobertura: null,
  };
  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...resumen, estado: 'esquema_no_aplicado' };

  const { publicacion, cobertura } = lectura;
  const base = {
    season: lectura.season,
    source: lectura.fuente,
    factKind: 'ranking' as const,
    competitionKey: lectura.clave,
    competitionId: null,
    sourceUrl: lectura.url,
  };

  // Una lista con filas mal leídas o repetidas es peor que no tenerla: no pasa
  // a ser «la última» de su temporada. Sólo queda anotada en la cobertura, sin
  // pisar las cifras de la última lectura buena.
  if (!publicacion || cobertura.estado !== 'completo') {
    const effective = await deps.upsertCobertura({
      ...base,
      status: cobertura.estado,
      ...(cobertura.estado === 'sin_resultados' ? { publishedTotal: 0, importedTotal: 0 } : {}),
      lastError: cobertura.error,
    });
    resumen.cobertura = effective ?? cobertura.estado;
    return resumen;
  }

  if (esHistorica(publicacion.categoria) && !(deps.categoriasHistoricas && (await deps.categoriasHistoricas()))) {
    await deps.upsertCobertura({
      ...base,
      status: 'pendiente',
      lastError: `La categoría «${publicacion.categoriaOriginal}» necesita la migración 0019 (M10/M12), sin aplicar`,
    });
    resumen.cobertura = 'pendiente';
    return { ...resumen, estado: 'esquema_no_aplicado' };
  }

  const { personas, resumen: porPersona } = await resolverPersonas(deps, publicacion);
  const filas: FilaEntradaRanking[] = publicacion.entradas.map((e) => ({
    sourceRef: e.sourceRef,
    personId: personas.get(e.sourceRef) ?? null,
    sourceName: e.nombre,
    countryCode: e.pais,
    position: e.posicion,
    points: e.puntos,
  }));

  const escrito = await deps.escribirPublicacion(publicacion, filas);
  resumen.publicacion = escrito.estado;
  resumen.entradas = filas.length;
  resumen.personas = { ...porPersona, incorporadas: escrito.personasIncorporadas };

  await deps.upsertCobertura({
    ...base,
    status: cobertura.estado,
    publishedTotal: cobertura.publicado,
    importedTotal: cobertura.importado,
    lastError: cobertura.error,
  });
  resumen.cobertura = cobertura.estado;
  return resumen;
}
