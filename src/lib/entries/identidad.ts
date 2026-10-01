import {
  resolveByExternalId,
  type ExternalIdRow,
  type Resolution,
} from '@/lib/identity/resolver';

/**
 * Qué ficha local es la persona de una inscripción publicada, y con qué prueba.
 *
 * Código puro. El `athlete_id` que trae la fila de inscripción NO cuenta: pudo
 * escribirlo el antiguo puente por nombre contra el ranking, que unía dos
 * cadenas escritas igual sin probar que fueran la misma persona. Aquí sólo
 * cuenta lo que la propia observación demuestra por su cuenta:
 *
 *  - un ID/licencia publicados que el resolvedor confirma para una persona
 *    deportiva (esquema migrado), dentro de su ámbito y vigencia;
 *  - el ID FIE publicado, si coincide con una ficha FIE que una persona
 *    confirmó contra un tirador;
 *  - la licencia publicada, si coincide con la de un único tirador y estaba
 *    vigente el día de la prueba.
 *
 * Si las pruebas se contradicen, la observación no pertenece a nadie: ni se
 * funde con otra fila ni marca «es mío».
 */

export const SCHEME_FIE_ID = 'fie_addr_id';
export const SCHEME_FIE_LICENCIA = 'fie_license';
export const SCHEME_RFEE_LICENCIA = 'rfee_license';

/** Una licencia comparable: sin espacios, sin guiones y en mayúsculas. */
export function normalizarLicencia(valor: string): string {
  return valor.replace(/[\s-]/g, '').toUpperCase();
}

/** Referencia publicada por la fuente para un participante, con su ámbito. */
export type RefPublicada = {
  scheme: string;
  value: string;
  scopeSource: string;
  scopeFederation: string;
  scopeSeason: string;
  scopeWeapon: string;
  /** Día (YYYY-MM-DD) en que la fuente la publicó o la leímos. */
  observadoEl: string | null;
};

/**
 * Las referencias que se retienen de una fila publicada: el ID de la FIE y la
 * licencia, cada una con la federación en la que significa algo.
 */
export function refsPublicadas(entrada: {
  fuente: string;
  fieId?: number | null;
  licencia?: string | null;
  observadoEl: string | null;
}): RefPublicada[] {
  const refs: RefPublicada[] = [];
  if (entrada.fieId !== null && entrada.fieId !== undefined) {
    refs.push({
      scheme: SCHEME_FIE_ID,
      value: String(entrada.fieId),
      scopeSource: 'fie',
      scopeFederation: '',
      scopeSeason: '',
      scopeWeapon: '',
      observadoEl: entrada.observadoEl,
    });
  }
  const licencia = entrada.licencia ? normalizarLicencia(entrada.licencia) : '';
  if (licencia) {
    const esFie = entrada.fuente === 'fie';
    refs.push({
      scheme: esFie ? SCHEME_FIE_LICENCIA : SCHEME_RFEE_LICENCIA,
      value: licencia,
      scopeSource: entrada.fuente,
      scopeFederation: esFie ? 'FIE' : 'RFEE',
      scopeSeason: '',
      scopeWeapon: '',
      observadoEl: entrada.observadoEl,
    });
  }
  return refs;
}

/** Temporada de una fecha ISO: FIE = año en que termina; RFEE = «2026-2027». */
export function temporadaDe(fuente: string, dia: string | null): string | undefined {
  if (!dia || !/^\d{4}-\d{2}/.test(dia)) return undefined;
  const anio = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  const inicio = mes >= 9 ? anio : anio - 1;
  return fuente === 'fie' ? String(inicio + 1) : `${inicio}-${inicio + 1}`;
}

export type PersonaDeportiva = {
  /** Ficha local enlazada y confirmada, si la hay. */
  athleteId: string | null;
  mergedIntoPersonId: string | null;
};

export type AtletaConLicencias = {
  id: string;
  rfeeLicense: string | null;
  rfeeValidUntil: string | null;
  fieLicense: string | null;
  fieValidUntil: string | null;
};

/** Ficha FIE cuyo enlace con un tirador confirmó una persona. */
export type FichaFieConfirmada = {
  fieId: number;
  fieLicense: string | null;
  athleteId: string;
};

export type EvidenciaExterna = {
  /** Sólo con el esquema migrado; vacío en legacy. */
  externos: readonly ExternalIdRow[];
  personas: ReadonlyMap<string, PersonaDeportiva>;
  atletas: readonly AtletaConLicencias[];
  fichasFie: readonly FichaFieConfirmada[];
};

export const EVIDENCIA_VACIA: EvidenciaExterna = {
  externos: [],
  personas: new Map(),
  atletas: [],
  fichasFie: [],
};

export type ObservacionAIdentificar = {
  fuente: string;
  /** Referencias retenidas, más la licencia que ya guardaba la fila. */
  refs: readonly RefPublicada[];
  arma: string;
  /** Día de la prueba (YYYY-MM-DD), que es el día del hecho observado. */
  dia: string | null;
};

export type IdentidadObservacion = {
  /** Ficha local probada por la propia observación; `null` si no hay prueba. */
  athleteId: string | null;
  resolucion: Resolution;
};

function personaCanonica(
  personId: string,
  personas: ReadonlyMap<string, PersonaDeportiva>,
): string {
  let actual = personId;
  const vistas = new Set<string>();
  while (!vistas.has(actual)) {
    vistas.add(actual);
    const siguiente = personas.get(actual)?.mergedIntoPersonId;
    if (!siguiente) return actual;
    actual = siguiente;
  }
  return actual;
}

/** Une las resoluciones de cada referencia: dos personas distintas son conflicto. */
function combinar(
  resoluciones: readonly Resolution[],
  personas: ReadonlyMap<string, PersonaDeportiva>,
): Resolution {
  const confirmadas = new Set<string>();
  const propuestas = new Set<string>();
  for (const r of resoluciones) {
    if (r.kind === 'confirmed') confirmadas.add(personaCanonica(r.personId, personas));
    else if (r.kind === 'conflict') {
      for (const p of r.personIds) confirmadas.add(personaCanonica(p, personas));
    } else if (r.kind === 'review') {
      for (const p of r.personIds) propuestas.add(personaCanonica(p, personas));
    }
  }
  if (confirmadas.size > 1) {
    return { kind: 'conflict', personIds: [...confirmadas] };
  }
  if (confirmadas.size === 1) return { kind: 'confirmed', personId: [...confirmadas][0] };
  if (propuestas.size > 0) return { kind: 'review', personIds: [...propuestas] };
  return { kind: 'none' };
}

export function resolverReferencias(
  obs: ObservacionAIdentificar,
  evidencia: EvidenciaExterna,
): Resolution {
  if (evidencia.externos.length === 0) return { kind: 'none' };
  return combinar(
    obs.refs.map((ref) =>
      resolveByExternalId(evidencia.externos, {
        scheme: ref.scheme,
        value: ref.value,
        source: ref.scopeSource,
        federation: ref.scopeFederation || undefined,
        season: ref.scopeSeason || temporadaDe(obs.fuente, obs.dia),
        weapon: ref.scopeWeapon || obs.arma,
        on: obs.dia ?? undefined,
      }),
    ),
    evidencia.personas,
  );
}

function vigente(hasta: string | null, dia: string | null): boolean {
  if (!hasta) return true;
  if (!dia) return false;
  return hasta >= dia;
}

/**
 * Tiradores que la propia observación demuestra. Más de uno distinto, o una
 * licencia compartida por dos tiradores, es contradicción y no atribuye a nadie.
 */
function atletasPorEvidencia(
  obs: ObservacionAIdentificar,
  resolucion: Resolution,
  evidencia: EvidenciaExterna,
): { ids: Set<string>; ambiguo: boolean } {
  const ids = new Set<string>();
  let ambiguo = false;

  if (resolucion.kind === 'confirmed') {
    const enlazada = evidencia.personas.get(resolucion.personId)?.athleteId;
    if (enlazada) ids.add(enlazada);
  }

  for (const ref of obs.refs) {
    if (ref.scheme === SCHEME_FIE_ID) {
      for (const f of evidencia.fichasFie) {
        if (String(f.fieId) === ref.value) ids.add(f.athleteId);
      }
      continue;
    }
    const licencia = normalizarLicencia(ref.value);
    const dueños = new Set<string>();
    for (const a of evidencia.atletas) {
      const rfee =
        a.rfeeLicense &&
        normalizarLicencia(a.rfeeLicense) === licencia &&
        vigente(a.rfeeValidUntil, obs.dia);
      const fie =
        a.fieLicense &&
        normalizarLicencia(a.fieLicense) === licencia &&
        vigente(a.fieValidUntil, obs.dia);
      if (rfee || fie) dueños.add(a.id);
    }
    for (const f of evidencia.fichasFie) {
      if (f.fieLicense && normalizarLicencia(f.fieLicense) === licencia) dueños.add(f.athleteId);
    }
    if (dueños.size > 1) ambiguo = true;
    for (const id of dueños) ids.add(id);
  }

  return { ids, ambiguo };
}

export function identificarObservacion(
  obs: ObservacionAIdentificar,
  evidencia: EvidenciaExterna,
): IdentidadObservacion {
  const resolucion = resolverReferencias(obs, evidencia);
  if (resolucion.kind === 'conflict') return { athleteId: null, resolucion };

  const { ids, ambiguo } = atletasPorEvidencia(obs, resolucion, evidencia);
  if (ambiguo || ids.size > 1) {
    // Evidencias que se contradicen: la persona no se funde ni se atribuye.
    return {
      athleteId: null,
      resolucion: {
        kind: 'conflict',
        personIds: resolucion.kind === 'confirmed' ? [resolucion.personId] : [],
      },
    };
  }
  return { athleteId: ids.size === 1 ? [...ids][0] : null, resolucion };
}

/** Valores a cargar de la base para identificar un lote de observaciones. */
export function valoresDeEvidencia(refs: readonly RefPublicada[]): {
  licencias: string[];
  fieIds: number[];
  valores: string[];
} {
  const licencias = new Set<string>();
  const fieIds = new Set<number>();
  const valores = new Set<string>();
  for (const r of refs) {
    valores.add(r.value);
    if (r.scheme === SCHEME_FIE_ID) {
      const n = Number(r.value);
      if (Number.isInteger(n)) fieIds.add(n);
    } else {
      licencias.add(normalizarLicencia(r.value));
    }
  }
  return { licencias: [...licencias], fieIds: [...fieIds], valores: [...valores] };
}
