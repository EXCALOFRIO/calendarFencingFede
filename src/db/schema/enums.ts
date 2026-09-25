import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Valores de dominio. Todos salen del calendario y las circulares oficiales
 * de la RFEE / FIE / EFC, no de suposiciones.
 */

export const weaponEnum = pgEnum('weapon', ['FLORETE', 'ESPADA', 'SABLE']);

/** Las pruebas son separadas por género; MIXTO solo aparece en algunos equipos. */
export const genderEnum = pgEnum('gender', ['M', 'F', 'MIXTO']);

/**
 * Categorías.
 *
 * El calendario nacional de la RFEE 2026-2027 usa M13/M15/M17/M20/ABS/VET
 * (no M14, como decía el brief original). Pero el filtro de Skermo ofrece
 * además M9, M11, M14 y M23, que sí usan algunas federaciones autonómicas, y
 * desglosa veteranos en VET30/40/50/60/70.
 *
 * Se incluyen todas para que ninguna prueba autonómica se pierda por el
 * camino. Los veteranos se normalizan a VET y el texto exacto de la fuente se
 * conserva en `event_competition.category_raw`, para no perder información.
 */
export const categoryEnum = pgEnum('category_code', [
  'M9',
  'M11',
  'M13',
  'M14',
  'M15',
  'M17',
  'M20',
  'M23',
  'ABS',
  'VET',
]);

export const eventTypeEnum = pgEnum('competition_format', ['INDIVIDUAL', 'EQUIPOS']);

/**
 * Fuentes de ingestión. Una por scraper, para poder aislar fallos.
 *
 * `skermo_ranking` no produce eventos de calendario: alimenta
 * `official_ranking_entry` con el ranking nacional de la RFEE. Va aparte y no
 * dentro de `skermo_rfee` porque son 60 peticiones (3 armas × 2 géneros × 10
 * categorías) y no tienen por qué arrastrar al calendario si Skermo tarda.
 */
export const sourceEnum = pgEnum('event_source', [
  'skermo_rfee',
  'skermo_regional',
  'fie',
  'efc',
  'rfee_wp',
  'skermo_ranking',
]);

/**
 * Circuitos.
 *
 * La lista sale del campo "Tipo" real del calendario de la RFEE en Skermo
 * (leído el 25/09/2026, 425 competiciones): "Circuito FIE" (198),
 * "Circuito Europeo M14" (77), "Circuito Cadete Europeo" (48),
 * "EFC Eurofence league" (30), "Circuito Sub23 Europeo" (30), "TNR" (21),
 * "LIGA DE CLUBES" (13), "Copa Europa" (6) y concentraciones del PFCAR.
 *
 * `FIE_CIRCUITO` existe porque Skermo etiqueta todas las pruebas FIE igual, sin
 * distinguir Copa del Mundo de Gran Premio o Satélite. Esa distinción la aporta
 * la API de la FIE, que sí publica el tipo; hasta entonces no se adivina.
 */
export const circuitEnum = pgEnum('circuit', [
  'TNR',
  'LIGA_ORO',
  'LIGA_PLATA',
  'LIGA_IBERDROLA',
  'LIGA_BRONCE',
  'LIGA_CLUBES',
  'CTO_ESPANA',
  'CONCENTRACION',
  'SATELITE',
  'FIE_CIRCUITO',
  'ECC',
  'EUR_CLUBES',
  'U14_EFC',
  'SUB23_EFC',
  'EFC_LEAGUE',
  'EUV',
  'CAD_WC',
  'JUN_WC',
  'SEN_WC',
  'SEN_GP',
  'CTO_EUROPA',
  'CTO_MUNDO',
  'TLM',
  'OTRO',
]);

/**
 * Límites de inscripción. L1 ordinario, L2/L3 con recargo, FIE_D7 cierre duro
 * de la FIE a 7 días (bloqueo, no recargo).
 */
export const deadlineTypeEnum = pgEnum('deadline_type', ['L1', 'L2', 'L3', 'FIE_D7']);

/**
 * Si el plazo lo publica la fuente es PUBLICADO y manda sobre el CALCULADO a
 * partir de deadline_rule. Nunca se presentan igual en la interfaz.
 */
export const deadlineOriginEnum = pgEnum('deadline_origin', ['PUBLICADO', 'CALCULADO']);

/**
 * Roles.
 *
 * `coach` es el seleccionador de un arma (el entrenador de florete, por
 * ejemplo). Se separa de `admin` porque su ámbito natural es su arma: entra y
 * ve a SUS tiradores sin tener que filtrar. Puede ver el resto con un clic
 * —no se le esconde nada—, pero lo suyo es lo que aparece primero.
 *
 * Qué arma o armas le tocan se guarda en `profile_weapon`, no aquí: hay quien
 * lleva dos.
 */
export const roleEnum = pgEnum('user_role', [
  'admin',
  'coach',
  'club',
  'athlete',
  'guardian',
]);

export const inviteStatusEnum = pgEnum('invite_status', [
  'pendiente',
  'aceptada',
  'revocada',
]);

/** Máquina de estados de una inscripción. Las transiciones válidas viven en
 *  src/lib/entries/state-machine.ts, no repartidas por la interfaz. */
export const entryStatusEnum = pgEnum('entry_status', [
  'draft',
  'pending_club',
  'club_approved',
  'federation_approved',
  'submitted',
  'rejected',
  'withdrawn',
]);

export const submissionStatusEnum = pgEnum('submission_status', [
  'dry_run',
  'sent',
  'verified',
  'failed',
]);

export const placeTypeEnum = pgEnum('place_type', ['ranking', 'tecnica']);

export const callUpStatusEnum = pgEnum('call_up_athlete_status', [
  'pendiente',
  'confirmado',
  'rechazado',
]);

export const ingestStatusEnum = pgEnum('ingest_status', ['ok', 'parcial', 'error']);

export const scopeEnum = pgEnum('competition_scope', [
  'NACIONAL',
  'INTERNACIONAL',
  'AUTONOMICO',
]);

export const proposalStatusEnum = pgEnum('proposal_status', [
  'pendiente',
  'aprobada',
  'descartada',
]);

/**
 * Estado de un enlace entre los dos registros del MISMO torneo (el de Skermo
 * y el de la FIE).
 *
 * - `AUTOMATICO`: lo ha decidido el emparejador y cumple el criterio estricto
 *   (misma ciudad canónica, fechas que se solapan y las pruebas de la FIE
 *   contenidas en las de Skermo). Se recalcula en cada ingestión.
 * - `DUDOSO`: había más de un candidato posible y NO se ha unido nada. Es una
 *   fila de revisión para el admin, no un enlace. Ante la duda no se funde:
 *   un duplicado visible molesta, dos torneos distintos fundidos engañan.
 * - `CONFIRMADO`: lo ha aprobado una persona. Manda sobre el automatismo y no
 *   se recalcula.
 * - `RECHAZADO`: una persona ha dicho que no son el mismo torneo. El
 *   emparejador no vuelve a proponerlo nunca.
 */
export const eventLinkStatusEnum = pgEnum('event_link_status', [
  'AUTOMATICO',
  'DUDOSO',
  'CONFIRMADO',
  'RECHAZADO',
]);
