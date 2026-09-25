'use server';

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { athlete, club, entry, event, eventCompetition } from '@/db/schema';
import { requireRole } from '@/lib/auth/session';
import { transitionEntries } from '@/lib/entries/actions';
import type { EntryStatus } from '@/lib/entries/state-machine';
import { competitionLabel } from '@/lib/queries/callups';

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Bandeja federativa.
 *
 * Los cambios de estado pasan SIEMPRE por `transitionEntries`, que aplica la
 * máquina de estados. Si esta pantalla escribiera directamente en la tabla,
 * acabaría permitiendo saltos que la bandeja del club no permite y las dos
 * pantallas dirían cosas distintas sobre la misma inscripción.
 */
export async function moverInscripciones(
  entryIds: string[],
  destino: EntryStatus,
  motivo?: string,
): Promise<ResultadoAccion> {
  await requireRole('admin');
  return transitionEntries(entryIds, destino, motivo);
}

export type CsvExportado = {
  filename: string;
  /** Contenido listo para descargar desde el navegador. */
  content: string;
  filas: number;
};

/** Marca de orden de bytes: sin ella Excel abre el CSV con los acentos rotos. */
const BOM = '﻿';

/**
 * Genera el CSV de inscripciones para subirlo a Skermo / FIE.
 *
 * Decisiones del formato, todas por lo mismo (que se abra bien en España sin
 * tocar nada): separador `;`, que es lo que espera Excel con configuración
 * española; BOM al principio por los acentos; y fechas en ISO, que es lo que
 * aceptan los dos sistemas sin ambigüedad.
 *
 * Nunca se inventa un valor: si un tirador no tiene licencia, la celda va
 * vacía y la pantalla avisa antes de exportar.
 */
export async function exportarInscripcionesCsv(
  entryIds: string[],
): Promise<{ ok: true; csv: CsvExportado } | { ok: false; error: string }> {
  await requireRole('admin');

  if (entryIds.length === 0) {
    return { ok: false, error: 'No has seleccionado ninguna inscripción.' };
  }

  const filas = await db
    .select({
      entryId: entry.id,
      status: entry.status,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      birthDate: athlete.birthDate,
      gender: athlete.gender,
      rfeeLicense: athlete.rfeeLicense,
      fieLicense: athlete.fieLicense,
      clubName: club.name,
      weapon: eventCompetition.weapon,
      competitionGender: eventCompetition.gender,
      category: eventCompetition.category,
      categoryRaw: eventCompetition.categoryRaw,
      format: eventCompetition.format,
      eventName: event.name,
      startDate: event.startDate,
      city: event.city,
      country: event.country,
      sourceUrl: event.sourceUrl,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .leftJoin(club, eq(athlete.clubId, club.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(inArray(entry.id, entryIds));

  if (filas.length === 0) {
    return { ok: false, error: 'Esas inscripciones ya no existen.' };
  }

  const cabecera = [
    'Licencia RFEE',
    'Licencia FIE',
    'Apellidos',
    'Nombre',
    'Fecha de nacimiento',
    'Género del tirador',
    'Club',
    'Arma',
    'Género de la prueba',
    'Categoría',
    'Categoría en la fuente',
    'Formato',
    'Prueba',
    'Evento',
    'Fecha de inicio',
    'Ciudad',
    'País',
    'Estado en la app',
    'Enlace al evento',
  ];

  const cuerpo = filas.map((f) => [
    f.rfeeLicense ?? '',
    f.fieLicense ?? '',
    f.lastName,
    f.firstName,
    f.birthDate,
    f.gender,
    f.clubName ?? '',
    f.weapon,
    f.competitionGender,
    f.category,
    f.categoryRaw ?? '',
    f.format,
    competitionLabel({
      weapon: f.weapon,
      gender: f.competitionGender,
      category: f.category,
      format: f.format,
    }),
    f.eventName,
    f.startDate,
    f.city ?? '',
    f.country ?? '',
    f.status,
    f.sourceUrl ?? '',
  ]);

  const content =
    BOM +
    [cabecera, ...cuerpo]
      .map((fila) => fila.map(escaparCelda).join(';'))
      .join('\r\n') +
    '\r\n';

  const dia = new Date().toISOString().slice(0, 10);

  return {
    ok: true,
    csv: {
      filename: `inscripciones-${dia}.csv`,
      content,
      filas: cuerpo.length,
    },
  };
}

/** Comillas dobles si hay separador, comillas o saltos de línea dentro. */
function escaparCelda(valor: string): string {
  const texto = String(valor ?? '');
  if (/[";\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}
