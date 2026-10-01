import { palabrasNombre } from '@/lib/nombres';

/**
 * Resolución de identidad deportiva, sin base de datos.
 *
 * Sólo un ID externo CONFIRMADO, dentro de su ámbito y vigencia, identifica a
 * una persona. El nombre únicamente produce candidatos para revisión: dos
 * personas con el mismo nombre nunca se fusionan por él.
 */

/** Valor de `valid_from` cuando la fuente no publica inicio de vigencia. */
export const SIN_VIGENCIA = '1900-01-01';

export type LinkStatus = 'PROPUESTO' | 'CONFIRMADO' | 'RECHAZADO';

export type ExternalIdRow = {
  personId: string | null;
  scheme: string;
  value: string;
  scopeSource: string;
  scopeFederation: string;
  scopeSeason: string;
  scopeWeapon: string;
  validFrom: string;
  validTo: string | null;
  linkStatus: LinkStatus;
};

export type ExternalIdQuery = {
  scheme: string;
  value: string;
  source: string;
  federation?: string;
  season?: string;
  weapon?: string;
  /** Día (YYYY-MM-DD) en que se observó el hecho; imprescindible si el ID tiene vigencia. */
  on?: string;
};

export type Resolution =
  | { kind: 'confirmed'; personId: string }
  | { kind: 'review'; personIds: string[] }
  | { kind: 'conflict'; personIds: string[] }
  | { kind: 'none' };

/** Palabras sin acentos, minúsculas y ordenadas: las fuentes invierten nombre/apellidos. */
export function normalizeSportName(name: string): string {
  return palabrasNombre(name).sort().join(' ');
}

function scopeMatches(rowValue: string, queryValue: string | undefined): boolean {
  if (rowValue === '') return true;
  return queryValue === rowValue;
}

function inValidity(row: ExternalIdRow, on: string | undefined): boolean {
  const hasValidity = row.validFrom > SIN_VIGENCIA || row.validTo !== null;
  if (!hasValidity) return true;
  if (!on) return false;
  return row.validFrom <= on && (row.validTo === null || on <= row.validTo);
}

export function resolveByExternalId(
  rows: readonly ExternalIdRow[],
  query: ExternalIdQuery,
): Resolution {
  const value = query.value.trim();
  if (!value) return { kind: 'none' };

  const sameId = rows.filter(
    (r) =>
      r.scheme === query.scheme &&
      r.value === value &&
      r.scopeSource === query.source &&
      r.linkStatus !== 'RECHAZADO' &&
      r.personId !== null &&
      scopeMatches(r.scopeFederation, query.federation) &&
      scopeMatches(r.scopeSeason, query.season) &&
      scopeMatches(r.scopeWeapon, query.weapon) &&
      inValidity(r, query.on),
  );

  const confirmed = [...new Set(sameId.filter((r) => r.linkStatus === 'CONFIRMADO').map((r) => r.personId!))];
  if (confirmed.length === 1) return { kind: 'confirmed', personId: confirmed[0] };
  if (confirmed.length > 1) return { kind: 'conflict', personIds: confirmed };

  const proposed = [...new Set(sameId.map((r) => r.personId!))];
  return proposed.length ? { kind: 'review', personIds: proposed } : { kind: 'none' };
}

export type PersonNameRow = { personId: string; nameNormalized: string };

/** Nunca devuelve `confirmed`: un nombre sólo propone candidatos a revisar. */
export function candidatesByName(
  people: readonly PersonNameRow[],
  name: string,
): Resolution {
  const wanted = normalizeSportName(name);
  if (!wanted) return { kind: 'none' };
  const ids = [...new Set(people.filter((p) => p.nameNormalized === wanted).map((p) => p.personId))];
  return ids.length ? { kind: 'review', personIds: ids } : { kind: 'none' };
}

/** Identidad de una prueba FIE: temporada FIE + competitionId, no el torneo. */
export function fieCompetitionKey(season: number | string, competitionId: number | string) {
  return { source: 'fie', season: String(season), competitionKey: String(competitionId) };
}

/** El hecho se identifica por el participante en la fuente, nunca por el puesto. */
export function resultFactKey(participantRef: string): string {
  return participantRef.trim();
}

export type BoutInput = {
  individual: boolean;
  fencerARef: string | null;
  fencerBRef: string | null;
  scoreA: number | null;
  scoreB: number | null;
  isBye?: boolean;
};

export type BoutCheck =
  | { ok: true; fencerARef: string; fencerBRef: string; swapped: boolean }
  | { ok: false; reason: 'team' | 'bye' | 'missing_fencer' | 'same_fencer' | 'no_score' };

/**
 * Sólo dos individuales inequívocos con marcador final son un asalto. El orden
 * canónico (A < B) hace que una poule publicada desde ambas perspectivas
 * produzca la misma clave.
 */
export function checkBout(input: BoutInput): BoutCheck {
  if (!input.individual) return { ok: false, reason: 'team' };
  if (input.isBye) return { ok: false, reason: 'bye' };
  const a = input.fencerARef?.trim();
  const b = input.fencerBRef?.trim();
  if (!a || !b) return { ok: false, reason: 'missing_fencer' };
  if (a === b) return { ok: false, reason: 'same_fencer' };
  if (input.scoreA === null || input.scoreB === null) return { ok: false, reason: 'no_score' };
  const swapped = a > b;
  return swapped
    ? { ok: true, fencerARef: b, fencerBRef: a, swapped }
    : { ok: true, fencerARef: a, fencerBRef: b, swapped };
}
