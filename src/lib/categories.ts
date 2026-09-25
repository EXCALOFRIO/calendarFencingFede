import { yearFromIsoDate } from './utils';

export type CategoryCode = 'M13' | 'M15' | 'M17' | 'M20' | 'ABS' | 'VET';

/**
 * Una fila de `season_category`. Es DATOS, no código: la edita el admin cada
 * temporada a partir de la circular de categorías de la RFEE. Por eso esta
 * función recibe las filas y no las tiene escritas dentro.
 */
export type SeasonCategoryRow = {
  code: CategoryCode;
  birthYearMin: number | null;
  birthYearMax: number | null;
  rank: number;
  laddered: boolean;
};

export type EligibilityResult = {
  /** La categoría que le corresponde por edad. Null si ningún rango encaja. */
  own: CategoryCode | null;
  /** Todas en las que puede competir, de la suya hacia arriba. */
  eligible: CategoryCode[];
  /** Explicación legible, para poder enseñarla en el perfil. */
  explanation: string;
};

/**
 * Deriva las categorías de un tirador a partir de su AÑO DE NACIMIENTO y de la
 * tabla de la temporada.
 *
 * Se trabaja con el año, no con la fecha completa, porque así están definidas
 * las categorías en la normativa: el nacido el 31 de diciembre y el nacido el
 * 1 de enero del mismo año están en la misma categoría.
 *
 * Regla de la escalera: un M17 puede tirar M17, M20 y Absoluto, pero no M15.
 * Se sube de categoría, no se baja. VET no forma parte de la escalera
 * (`laddered = false`): se entra por edad y además se puede tirar Absoluto.
 */
export function deriveCategories(
  birthYear: number,
  rows: SeasonCategoryRow[],
): EligibilityResult {
  if (rows.length === 0) {
    return {
      own: null,
      eligible: [],
      explanation:
        'La temporada no tiene categorías configuradas todavía. Un admin debe ' +
        'rellenar la tabla de categorías con los años de nacimiento de la circular.',
    };
  }

  const inRange = (r: SeasonCategoryRow) =>
    (r.birthYearMin === null || birthYear >= r.birthYearMin) &&
    (r.birthYearMax === null || birthYear <= r.birthYearMax);

  const ladder = [...rows].filter((r) => r.laddered).sort((a, b) => a.rank - b.rank);
  const extras = rows.filter((r) => !r.laddered);

  const ownRow = ladder.find(inRange) ?? null;

  const eligible: CategoryCode[] = [];
  if (ownRow) {
    for (const r of ladder) {
      if (r.rank >= ownRow.rank) eligible.push(r.code);
    }
  } else {
    // Sin rango que encaje en la escalera: si supera el mínimo de la última
    // (típicamente ABS), puede tirar ABS. Es el caso del adulto veterano.
    const top = ladder.at(-1);
    if (top) eligible.push(top.code);
  }

  for (const r of extras) {
    if (inRange(r) && !eligible.includes(r.code)) eligible.push(r.code);
  }

  const ordered = rows
    .filter((r) => eligible.includes(r.code))
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.code);

  const explanation = ownRow
    ? `Nacido en ${birthYear}: le corresponde ${ownRow.code}. Puede competir en ` +
      `${ordered.join(', ')} porque se puede subir de categoría, no bajar.`
    : `Nacido en ${birthYear}: ningún rango de la escalera encaja, así que ` +
      `queda ${ordered.join(', ') || 'sin categorías'}. Revisa la tabla de la temporada.`;

  return { own: ownRow?.code ?? null, eligible: ordered, explanation };
}

/** Igual que `deriveCategories` pero partiendo de la fecha ISO de nacimiento. */
export function deriveCategoriesFromBirthDate(
  birthDateIso: string,
  rows: SeasonCategoryRow[],
): EligibilityResult {
  return deriveCategories(yearFromIsoDate(birthDateIso), rows);
}

/** Edad cumplida a día de hoy. Solo para mostrar, nunca para categorizar. */
export function ageOn(birthDateIso: string, on: Date = new Date()): number {
  const [y, m, d] = birthDateIso.slice(0, 10).split('-').map(Number);
  let age = on.getUTCFullYear() - y;
  const beforeBirthday =
    on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * RGPD: en España un menor de 14 años no puede consentir el tratamiento por sí
 * mismo, así que la cuenta la tiene el padre o tutor y el tirador es un perfil
 * vinculado.
 */
export function requiresGuardianAccount(
  birthDateIso: string,
  on: Date = new Date(),
): boolean {
  return ageOn(birthDateIso, on) < 14;
}
