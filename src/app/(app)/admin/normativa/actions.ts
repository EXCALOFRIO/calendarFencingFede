'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import {
  configChangeLog,
  deadlineRule,
  rankingRule,
  season,
  seasonCategory,
} from '@/db/schema';
import { requireRole } from '@/lib/auth/session';
import { parseFechaMadrid } from '@/lib/callups/fechas';

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * NORMATIVA CONFIGURABLE
 *
 * Ningún número de la normativa vive en el código. Aquí se editan los plazos y
 * recargos, las categorías por temporada y los coeficientes del ranking, y
 * cada cambio deja rastro en `config_change_log` con el antes y el después.
 *
 * El motivo es muy concreto: la normativa de la RFEE cambia cada temporada. Si
 * los importes estuvieran en un `.ts`, cambiarlos exigiría tocar código y
 * desplegar. Y cuando alguien discuta un recargo, hace falta poder enseñar de
 * qué circular sale, desde cuándo y quién lo puso.
 */

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? '').trim();
}

function numeroOpcional(formData: FormData, campo: string): number | null {
  const v = texto(formData, campo);
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function booleano(formData: FormData, campo: string): boolean {
  const v = texto(formData, campo).toLowerCase();
  return v === 'true' || v === 'on' || v === '1' || v === 'si';
}

/** Deja constancia del cambio. Sin esto, un importe es un número sin historia. */
async function registrarCambio(
  tableName: string,
  rowId: string,
  action: 'crear' | 'editar' | 'borrar',
  before: unknown,
  after: unknown,
  changedByProfileId: string,
) {
  await db.insert(configChangeLog).values({
    tableName,
    rowId,
    action,
    before: (before ?? null) as never,
    after: (after ?? null) as never,
    changedByProfileId,
  });
}

function revalidar() {
  revalidatePath('/admin/normativa');
  // Los plazos alimentan el semáforo de todo el calendario.
  revalidatePath('/calendario');
  revalidatePath('/');
}

// ------------------------------------------------------------ temporadas ---

/**
 * Crea una temporada.
 *
 * Todo lo demás (categorías, plazos, coeficientes) cuelga de una temporada,
 * así que sin esto el resto de pantallas no tienen dónde guardar nada.
 */
export async function crearTemporada(formData: FormData): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const label = texto(formData, 'label');
  const startDate = texto(formData, 'startDate');
  const endDate = texto(formData, 'endDate');
  const actual = booleano(formData, 'current');

  if (!/^\d{4}-\d{4}$/.test(label)) {
    return { ok: false, error: 'La etiqueta de la temporada tiene la forma 2026-2027.' };
  }
  if (!startDate || !endDate) {
    return { ok: false, error: 'Indica la fecha de inicio y la de fin.' };
  }
  if (startDate >= endDate) {
    return { ok: false, error: 'La fecha de fin tiene que ser posterior a la de inicio.' };
  }

  const [existente] = await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.label, label))
    .limit(1);
  if (existente) return { ok: false, error: `La temporada ${label} ya existe.` };

  // Solo puede haber una temporada marcada como actual.
  if (actual) await db.update(season).set({ current: false });

  const [creada] = await db
    .insert(season)
    .values({ label, startDate, endDate, current: actual })
    .returning({ id: season.id });

  await registrarCambio(
    'season',
    creada.id,
    'crear',
    null,
    { label, startDate, endDate, current: actual },
    perfil.profileId,
  );

  revalidar();
  return { ok: true, message: `Temporada ${label} creada.` };
}

export async function marcarTemporadaActual(seasonId: string): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  await db.update(season).set({ current: false });
  const [actualizada] = await db
    .update(season)
    .set({ current: true })
    .where(eq(season.id, seasonId))
    .returning({ id: season.id, label: season.label });

  if (!actualizada) return { ok: false, error: 'Esa temporada ya no existe.' };

  await registrarCambio(
    'season',
    seasonId,
    'editar',
    null,
    { current: true },
    perfil.profileId,
  );

  revalidar();
  return { ok: true, message: `${actualizada.label} es ahora la temporada actual.` };
}

// ------------------------------------------------- plazos y recargos (L1…) ---

/**
 * Crea o edita una regla de plazo.
 *
 * `daysBefore` son días naturales antes del inicio del evento. Lo que sale de
 * aquí siempre se marca en la interfaz como ESTIMADO: si la fuente publica el
 * plazo real de un evento, ese gana.
 */
export async function guardarPlazo(formData: FormData): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const id = texto(formData, 'id');
  const seasonId = texto(formData, 'seasonId');
  const scope = texto(formData, 'scope');
  const circuit = texto(formData, 'circuit');
  const category = texto(formData, 'category');
  const tipo = texto(formData, 'type');
  const label = texto(formData, 'label');
  const daysBefore = numeroOpcional(formData, 'daysBefore');
  const surchargeEur = numeroOpcional(formData, 'surchargeEur');
  const blocking = booleano(formData, 'blocking');
  const active = texto(formData, 'active') === '' ? true : booleano(formData, 'active');
  const sourceDocument = texto(formData, 'sourceDocument');
  const sourceUrl = texto(formData, 'sourceUrl');
  const effectiveFrom = parseFechaMadrid(texto(formData, 'effectiveFrom'));

  if (!seasonId) return { ok: false, error: 'Elige la temporada.' };
  if (!scope) return { ok: false, error: 'Elige el ámbito (nacional, internacional…).' };
  if (!tipo) return { ok: false, error: 'Elige el tipo de plazo (L1, L2, L3, FIE_D7).' };
  if (!label) return { ok: false, error: 'Ponle una etiqueta legible al plazo.' };
  if (daysBefore === null || daysBefore < 0) {
    return { ok: false, error: 'Indica cuántos días antes del evento cierra el plazo.' };
  }
  if (!sourceDocument) {
    return {
      ok: false,
      error:
        'Indica de qué documento sale este plazo. Un importe sin procedencia no se ' +
        'puede defender cuando alguien lo discuta.',
    };
  }

  const valores = {
    seasonId,
    scope: scope as 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO',
    circuit: (circuit || null) as never,
    category: (category || null) as never,
    type: tipo as 'L1' | 'L2' | 'L3' | 'FIE_D7',
    label,
    daysBefore,
    surchargeEur: surchargeEur === null ? null : String(surchargeEur),
    blocking,
    active,
    sourceDocument,
    sourceUrl: sourceUrl || null,
    effectiveFrom: effectiveFrom ?? new Date(),
    updatedAt: new Date(),
    updatedByProfileId: perfil.profileId,
  };

  if (id) {
    const [antes] = await db
      .select()
      .from(deadlineRule)
      .where(eq(deadlineRule.id, id))
      .limit(1);
    if (!antes) return { ok: false, error: 'Esa regla ya no existe.' };

    await db.update(deadlineRule).set(valores).where(eq(deadlineRule.id, id));
    await registrarCambio('deadline_rule', id, 'editar', antes, valores, perfil.profileId);
    revalidar();
    return { ok: true, message: `Plazo "${label}" actualizado.` };
  }

  const [creada] = await db
    .insert(deadlineRule)
    .values(valores)
    .returning({ id: deadlineRule.id });

  await registrarCambio(
    'deadline_rule',
    creada.id,
    'crear',
    null,
    valores,
    perfil.profileId,
  );

  revalidar();
  return { ok: true, message: `Plazo "${label}" creado.` };
}

export async function borrarPlazo(id: string): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const [antes] = await db
    .select()
    .from(deadlineRule)
    .where(eq(deadlineRule.id, id))
    .limit(1);
  if (!antes) return { ok: false, error: 'Esa regla ya no existe.' };

  await db.delete(deadlineRule).where(eq(deadlineRule.id, id));
  await registrarCambio('deadline_rule', id, 'borrar', antes, null, perfil.profileId);

  revalidar();
  return { ok: true, message: `Plazo "${antes.label}" borrado.` };
}

// ---------------------------------------------- categorías de la temporada ---

/**
 * Crea o edita la franja de años de nacimiento de una categoría.
 *
 * Los años son inclusivos. `rank` ordena la escalera de menor a mayor edad y
 * es lo que permite decir "puedes subir de categoría, pero no bajar".
 */
export async function guardarCategoria(formData: FormData): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const id = texto(formData, 'id');
  const seasonId = texto(formData, 'seasonId');
  const code = texto(formData, 'code');
  const birthYearMin = numeroOpcional(formData, 'birthYearMin');
  const birthYearMax = numeroOpcional(formData, 'birthYearMax');
  const rank = numeroOpcional(formData, 'rank');
  const laddered = booleano(formData, 'laddered');
  const sourceDocument = texto(formData, 'sourceDocument');
  const sourceUrl = texto(formData, 'sourceUrl');

  if (!seasonId) return { ok: false, error: 'Elige la temporada.' };
  if (!code) return { ok: false, error: 'Elige la categoría.' };
  if (rank === null) {
    return {
      ok: false,
      error: 'Indica el orden de la categoría (1 la más joven, hacia arriba).',
    };
  }
  if (birthYearMin !== null && birthYearMax !== null && birthYearMin > birthYearMax) {
    return { ok: false, error: 'El año mínimo no puede ser mayor que el máximo.' };
  }
  if (!sourceDocument) {
    return {
      ok: false,
      error: 'Indica de qué circular salen estos años de nacimiento.',
    };
  }

  const valores = {
    seasonId,
    code: code as never,
    birthYearMin,
    birthYearMax,
    rank,
    laddered,
    sourceDocument,
    sourceUrl: sourceUrl || null,
    updatedAt: new Date(),
    updatedByProfileId: perfil.profileId,
  };

  if (id) {
    const [antes] = await db
      .select()
      .from(seasonCategory)
      .where(eq(seasonCategory.id, id))
      .limit(1);
    if (!antes) return { ok: false, error: 'Esa categoría ya no existe.' };

    await db.update(seasonCategory).set(valores).where(eq(seasonCategory.id, id));
    await registrarCambio(
      'season_category',
      id,
      'editar',
      antes,
      valores,
      perfil.profileId,
    );
    revalidar();
    return { ok: true, message: `Categoría ${code} actualizada.` };
  }

  try {
    const [creada] = await db
      .insert(seasonCategory)
      .values(valores)
      .returning({ id: seasonCategory.id });

    await registrarCambio(
      'season_category',
      creada.id,
      'crear',
      null,
      valores,
      perfil.profileId,
    );
  } catch {
    return {
      ok: false,
      error: `La categoría ${code} ya está definida en esa temporada. Edítala en vez de crearla otra vez.`,
    };
  }

  revalidar();
  return { ok: true, message: `Categoría ${code} creada.` };
}

export async function borrarCategoria(id: string): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const [antes] = await db
    .select()
    .from(seasonCategory)
    .where(eq(seasonCategory.id, id))
    .limit(1);
  if (!antes) return { ok: false, error: 'Esa categoría ya no existe.' };

  await db.delete(seasonCategory).where(eq(seasonCategory.id, id));
  await registrarCambio('season_category', id, 'borrar', antes, null, perfil.profileId);

  revalidar();
  return { ok: true, message: `Categoría ${antes.code} borrada de la temporada.` };
}

// ------------------------------------------------- coeficientes de ranking ---

/**
 * Crea o edita los parámetros del ranking interno.
 *
 * `coefficients` y `pointsTable` llegan como JSON generado por el editor de
 * pares de la interfaz, no escrito a mano: aquí se valida que sean objetos de
 * números antes de guardarlos, porque un coeficiente que sea texto reventaría
 * el cálculo entero del ranking.
 */
export async function guardarReglaRanking(
  formData: FormData,
): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const id = texto(formData, 'id');
  const seasonId = texto(formData, 'seasonId');
  const weapon = texto(formData, 'weapon');
  const category = texto(formData, 'category');
  const countingEvents = numeroOpcional(formData, 'countingEvents');
  const rankingPlaces = numeroOpcional(formData, 'rankingPlaces') ?? 0;
  const technicalPlaces = numeroOpcional(formData, 'technicalPlaces') ?? 0;
  const cutoffDate = parseFechaMadrid(texto(formData, 'cutoffDate'));
  const sourceDocument = texto(formData, 'sourceDocument');
  const sourceUrl = texto(formData, 'sourceUrl');
  const effectiveFrom = parseFechaMadrid(texto(formData, 'effectiveFrom'));
  const active = texto(formData, 'active') === '' ? true : booleano(formData, 'active');

  if (!seasonId) return { ok: false, error: 'Elige la temporada.' };
  if (countingEvents === null || countingEvents <= 0) {
    return { ok: false, error: 'Indica cuántas pruebas cuentan (las mejores N).' };
  }
  if (!sourceDocument) {
    return { ok: false, error: 'Indica de qué documento salen estos coeficientes.' };
  }

  const coefficients = parsearMapaNumerico(texto(formData, 'coefficients'));
  if (!coefficients.ok) return { ok: false, error: `Coeficientes: ${coefficients.error}` };

  const pointsTable = parsearMapaNumerico(texto(formData, 'pointsTable'));
  if (!pointsTable.ok) return { ok: false, error: `Tabla de puntos: ${pointsTable.error}` };

  if (Object.keys(pointsTable.valor).length === 0) {
    return {
      ok: false,
      error: 'La tabla de puesto a puntos no puede estar vacía: sin ella no hay ranking.',
    };
  }

  const valores = {
    seasonId,
    weapon: (weapon || null) as never,
    category: (category || null) as never,
    countingEvents,
    coefficients: coefficients.valor as never,
    pointsTable: pointsTable.valor as never,
    rankingPlaces,
    technicalPlaces,
    cutoffDate,
    sourceDocument,
    sourceUrl: sourceUrl || null,
    effectiveFrom: effectiveFrom ?? new Date(),
    updatedAt: new Date(),
    updatedByProfileId: perfil.profileId,
    active,
  };

  if (id) {
    const [antes] = await db
      .select()
      .from(rankingRule)
      .where(eq(rankingRule.id, id))
      .limit(1);
    if (!antes) return { ok: false, error: 'Esa regla ya no existe.' };

    await db.update(rankingRule).set(valores).where(eq(rankingRule.id, id));
    await registrarCambio('ranking_rule', id, 'editar', antes, valores, perfil.profileId);
    revalidar();
    return { ok: true, message: 'Coeficientes actualizados.' };
  }

  try {
    const [creada] = await db
      .insert(rankingRule)
      .values(valores)
      .returning({ id: rankingRule.id });

    await registrarCambio(
      'ranking_rule',
      creada.id,
      'crear',
      null,
      valores,
      perfil.profileId,
    );
  } catch {
    return {
      ok: false,
      error:
        'Ya hay una regla para esa combinación de temporada, arma y categoría. ' +
        'Edítala en vez de crear otra.',
    };
  }

  revalidar();
  return { ok: true, message: 'Coeficientes guardados.' };
}

export async function borrarReglaRanking(id: string): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const [antes] = await db
    .select()
    .from(rankingRule)
    .where(eq(rankingRule.id, id))
    .limit(1);
  if (!antes) return { ok: false, error: 'Esa regla ya no existe.' };

  await db.delete(rankingRule).where(eq(rankingRule.id, id));
  await registrarCambio('ranking_rule', id, 'borrar', antes, null, perfil.profileId);

  revalidar();
  return { ok: true, message: 'Regla de ranking borrada.' };
}

type MapaNumerico =
  | { ok: true; valor: Record<string, number> }
  | { ok: false; error: string };

/** Valida que el JSON del editor sea de verdad un objeto clave -> número. */
function parsearMapaNumerico(json: string): MapaNumerico {
  if (!json.trim()) return { ok: true, valor: {} };

  let datos: unknown;
  try {
    datos = JSON.parse(json);
  } catch {
    return { ok: false, error: 'no se ha podido leer el contenido.' };
  }

  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return { ok: false, error: 'se esperaba una lista de pares clave y valor.' };
  }

  const valor: Record<string, number> = {};
  for (const [k, v] of Object.entries(datos as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) {
      return { ok: false, error: `el valor de "${k}" no es un número.` };
    }
    valor[k.trim()] = n;
  }
  return { ok: true, valor };
}

/** Historial de cambios de una fila, para enseñarlo al lado del valor. */
export async function historialDe(tableName: string, rowId: string) {
  await requireRole('admin');
  return db
    .select()
    .from(configChangeLog)
    .where(
      and(eq(configChangeLog.tableName, tableName), eq(configChangeLog.rowId, rowId)),
    )
    .orderBy(desc(configChangeLog.changedAt))
    .limit(20);
}
