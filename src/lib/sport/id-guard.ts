import type { ExternalIdRow } from '@/lib/identity/resolver';

/**
 * Guard compartido para CONFIRMAR un ID externo de una persona deportiva.
 *
 * El índice único de `sport_external_id` sólo ve la clave exacta, incluido
 * `valid_from`, así que dos filas confirmadas para personas distintas con
 * inicios de vigencia diferentes caben en la tabla aunque se pisen. El
 * resolvedor devuelve entonces `conflict` y nadie queda identificado. Este
 * guard cierra el hueco ANTES de escribir:
 *
 *  - misma identidad de ID: `scheme`, `value` y `scope_source` iguales;
 *  - ámbitos compatibles: federación, temporada y arma, donde el vacío es un
 *    comodín que casa con cualquier valor (igual que en el resolvedor);
 *  - vigencias que se solapan, con extremos INCLUSIVOS y fin abierto (`null`)
 *    como «hasta siempre»;
 *  - sólo cuenta como choque otra persona CONFIRMADA distinta (siguiendo la
 *    fusión de una persona en otra). Repetir una confirmación para la misma
 *    persona es idempotente.
 *
 * Aquí está la regla pura y el orquestador. La comprobación + escritura
 * atómica vive en `id-guard-db.ts`, y cualquier adaptador que confirme IDs
 * (FIE, Skermo, PDF) debe pasar por `confirmarIdExterno`.
 */

const FIN_ABIERTO = '9999-12-31';

export type IdExternoCandidato = {
  personId: string;
  scheme: string;
  value: string;
  scopeSource: string;
  scopeFederation: string;
  scopeSeason: string;
  scopeWeapon: string;
  validFrom: string;
  /** null = sin fecha de fin publicada. */
  validTo: string | null;
  linkedVia: string;
  evidence: string;
};

export type PersonaNuevaConId = {
  /** Se genera antes de escribir para que la persona y su ID entren a la vez. */
  id: string;
  displayName: string;
  nameNormalized: string;
  gender: 'M' | 'F' | null;
  countryCode: string | null;
  aliasSource: string;
};

export type ResultadoConfirmacion =
  | { ok: true }
  | { ok: false; motivo: 'invalido'; detalle: string }
  | { ok: false; motivo: 'conflicto'; personIds: string[] };

/** Contrato de persistencia. `confirmar` debe comprobar y escribir como UNA unidad atómica. */
export type DepsGuardConfirmacion = {
  /**
   * Escribe la confirmación sólo si no hay conflicto, y devuelve `false` si lo
   * hubo. Con `persona` crea esa persona en la misma unidad, de modo que un
   * rechazo no deja una persona huérfana ni un ID suelto.
   */
  confirmar: (
    candidato: IdExternoCandidato,
    persona?: PersonaNuevaConId,
  ) => Promise<boolean>;
  /** Filas confirmadas que chocan con el candidato; sólo para explicar un rechazo. */
  conflictos: (candidato: IdExternoCandidato) => Promise<ExternalIdRow[]>;
};

export function ambitoCompatible(a: string, b: string): boolean {
  return a === '' || b === '' || a === b;
}

type Vigencia = { validFrom: string; validTo: string | null };

/** Intervalos cerrados `[from, to]`; `to = null` no acaba. */
export function vigenciasSolapan(a: Vigencia, b: Vigencia): boolean {
  return a.validFrom <= (b.validTo ?? FIN_ABIERTO) && b.validFrom <= (a.validTo ?? FIN_ABIERTO);
}

type ClaveExterna = Pick<
  ExternalIdRow,
  'scheme' | 'value' | 'scopeSource' | 'scopeFederation' | 'scopeSeason' | 'scopeWeapon'
>;

export function mismoIdYAmbito(a: ClaveExterna, b: ClaveExterna): boolean {
  return (
    a.scheme === b.scheme &&
    a.value.trim() === b.value.trim() &&
    a.scopeSource === b.scopeSource &&
    ambitoCompatible(a.scopeFederation, b.scopeFederation) &&
    ambitoCompatible(a.scopeSeason, b.scopeSeason) &&
    ambitoCompatible(a.scopeWeapon, b.scopeWeapon)
  );
}

/** Errores que impiden siquiera comparar; el candidato jamás se escribe. */
export function validarCandidato(c: IdExternoCandidato): string | null {
  if (!c.personId) return 'falta la persona';
  if (!c.scheme || !c.scopeSource) return 'falta esquema o fuente del ID';
  if (!c.value.trim()) return 'ID vacío';
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!fecha.test(c.validFrom)) return 'validFrom no es una fecha ISO';
  if (c.validTo !== null && !fecha.test(c.validTo)) return 'validTo no es una fecha ISO';
  if (c.validTo !== null && c.validTo < c.validFrom) return 'la vigencia acaba antes de empezar';
  return null;
}

/**
 * Filas confirmadas de OTRA persona que chocan con el candidato. `canonica`
 * sigue la fusión de personas (A→B); sin ella cada persona es la suya.
 */
export function conflictosDeConfirmacion(
  existentes: readonly ExternalIdRow[],
  candidato: IdExternoCandidato,
  canonica: (personId: string) => string = (id) => id,
): ExternalIdRow[] {
  const propia = canonica(candidato.personId);
  return existentes.filter(
    (e) =>
      e.linkStatus === 'CONFIRMADO' &&
      e.personId !== null &&
      canonica(e.personId) !== propia &&
      mismoIdYAmbito(e, candidato) &&
      vigenciasSolapan(e, candidato),
  );
}

export async function confirmarIdExterno(
  deps: DepsGuardConfirmacion,
  candidato: IdExternoCandidato,
  persona?: PersonaNuevaConId,
): Promise<ResultadoConfirmacion> {
  const detalle = validarCandidato(candidato);
  if (detalle) return { ok: false, motivo: 'invalido', detalle };
  if (persona && persona.id !== candidato.personId) {
    return { ok: false, motivo: 'invalido', detalle: 'la persona nueva no es la del candidato' };
  }
  if (await deps.confirmar(candidato, persona)) return { ok: true };
  const filas = await deps.conflictos(candidato);
  const personIds = [...new Set(filas.flatMap((f) => (f.personId ? [f.personId] : [])))];
  return { ok: false, motivo: 'conflicto', personIds };
}
