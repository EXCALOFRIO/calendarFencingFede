import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL } from '../utils';

/**
 * Tipos y etiquetas de convocatorias.
 *
 * Están separados de `src/lib/queries/callups.ts` a propósito: ese fichero
 * abre la conexión a la base de datos, y las tarjetas del tirador y el panel
 * del seleccionador son componentes de cliente. Si importaran de allí, el
 * cliente arrastraría el módulo de base de datos al navegador.
 */

export type PlaceType = 'ranking' | 'tecnica';
export type CallUpStatus = 'pendiente' | 'confirmado' | 'rechazado';

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  ranking: 'Plaza por ranking',
  tecnica: 'Plaza por criterio técnico',
};

export const CALL_UP_STATUS_LABEL: Record<CallUpStatus, string> = {
  pendiente: 'Pendiente de respuesta',
  confirmado: 'Confirmada',
  rechazado: 'Rechazada',
};

/** Etiqueta legible de una prueba: "Espada masculino · M17". */
export function competitionLabel(c: {
  weapon: string;
  gender: string;
  category: string;
  format?: string | null;
}): string {
  const arma = WEAPON_LABEL[c.weapon as keyof typeof WEAPON_LABEL] ?? c.weapon;
  const genero = GENDER_LABEL[c.gender as keyof typeof GENDER_LABEL] ?? c.gender;
  const cat = CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category;
  const formato = c.format === 'EQUIPOS' ? ' · equipos' : '';
  return `${arma} ${genero.toLowerCase()} · ${cat}${formato}`;
}

export type CallUpForAthlete = {
  /** Fila de `call_up_athlete`: es lo que se confirma o se rechaza. */
  id: string;
  callUpId: string;
  title: string;
  body: string | null;
  pdfUrl: string | null;
  pdfName: string | null;
  travelNotes: string | null;
  publishedAt: Date | null;
  eventId: string;
  eventName: string;
  eventStartDate: string;
  eventEndDate: string;
  eventCity: string | null;
  eventCountry: string | null;
  eventSourceUrl: string | null;
  competition: string | null;
  placeType: PlaceType;
  rankingPositionAtCutoff: number | null;
  status: CallUpStatus;
  respondBy: Date | null;
  respondedAt: Date | null;
  rejectionReason: string | null;
  athleteId: string;
  athleteName: string;
};

export type CallUpSummary = {
  id: string;
  title: string;
  published: boolean;
  publishedAt: Date | null;
  respondBy: Date | null;
  pdfUrl: string | null;
  pdfName: string | null;
  createdAt: Date;
  eventId: string;
  eventName: string;
  eventStartDate: string;
  eventEndDate: string;
  eventCity: string | null;
  total: number;
  confirmados: number;
  rechazados: number;
  pendientes: number;
};

export type CallUpAthleteRow = {
  id: string;
  athleteId: string;
  athleteName: string;
  clubName: string | null;
  rfeeLicense: string | null;
  competition: string | null;
  eventCompetitionId: string | null;
  placeType: PlaceType;
  rankingPositionAtCutoff: number | null;
  status: CallUpStatus;
  rejectionReason: string | null;
  respondedAt: Date | null;
};

export type CallUpDetail = CallUpSummary & {
  body: string | null;
  travelNotes: string | null;
  createdByName: string | null;
  convocados: CallUpAthleteRow[];
};

export type CandidatoRanking = {
  athleteId: string;
  athleteName: string;
  clubName: string | null;
  rfeeLicense: string | null;
  position: number;
  totalPoints: string;
};

export type RankingPrueba = {
  eventCompetitionId: string;
  label: string;
  /** Null = todavía no hay ranking interno calculado para esa combinación. */
  candidatos: CandidatoRanking[] | null;
  computedAt: Date | null;
  rankingPlaces: number | null;
  technicalPlaces: number | null;
  cutoffDate: Date | null;
};

export type AthletePicker = {
  id: string;
  name: string;
  clubName: string | null;
  rfeeLicense: string | null;
  birthDate: string;
  gender: string;
};

export type EventoConvocable = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  city: string | null;
  scope: string;
  competitions: {
    id: string;
    weapon: string;
    gender: string;
    category: string;
    format: string;
    label: string;
  }[];
};
