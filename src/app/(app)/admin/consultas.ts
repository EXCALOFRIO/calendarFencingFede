import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  athleteWeapon,
  club,
  configChangeLog,
  deadlineRule,
  entry,
  event,
  eventCompetition,
  ingestQuarantine,
  ingestRun,
  profileWeapon,
  rankingRule,
  result,
  season,
  seasonCategory,
  userProfile,
} from '@/db/schema';
import type { Weapon } from '@/lib/auth/session';
import type { EntryStatus } from '@/lib/entries/state-machine';
import { openQuarantineCount, sourceHealth } from '@/lib/ingest/runner';

/**
 * Consultas de lectura del panel.
 *
 * Están en un módulo normal y NO en los `actions.ts`: un fichero con
 * `'use server'` convierte cada función exportada en un endpoint público, y
 * una consulta que devuelve correos y licencias no tiene por qué serlo. Aquí
 * solo entran componentes de servidor, que ya han pasado por `exigirRol`.
 *
 * El patrón es el mismo de `src/lib/queries`: varias consultas en paralelo y
 * el cosido en memoria, en vez de un JOIN que multiplica filas por la red.
 * Neon habla por HTTP y lo caro es el viaje, no el CPU.
 */

/** Estados vivos de una inscripción: los que todavía piden una decisión. */
export const ESTADOS_VIVOS: EntryStatus[] = [
  'pending_club',
  'club_approved',
  'federation_approved',
  'submitted',
];

// ------------------------------------------------------------- portada ---

export type ResumenGestion = {
  esperandoFederacion: number;
  listasParaEnviar: number;
  enElClub: number;
  cuarentena: number;
  sinEmparejar: number;
  fuentesConRetraso: number;
  fuentesTotales: number;
  cuentas: number;
  ultimaEjecucion: Date | null;
};

export async function resumenGestion(): Promise<ResumenGestion> {
  const hoy = new Date().toISOString().slice(0, 10);

  const [porEstado, cuarentena, sinEmparejar, cuentas, salud, ultima] =
    await Promise.all([
      db
        .select({ status: entry.status, n: count() })
        .from(entry)
        .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
        .innerJoin(event, eq(eventCompetition.eventId, event.id))
        .where(and(gte(event.startDate, hoy), inArray(entry.status, ESTADOS_VIVOS)))
        .groupBy(entry.status),

      db
        .select({ n: count() })
        .from(ingestQuarantine)
        .where(isNull(ingestQuarantine.resolvedAt)),

      db.select({ n: count() }).from(result).where(isNull(result.athleteId)),

      db.select({ n: count() }).from(userProfile),

      sourceHealth(),

      db
        .select({ startedAt: ingestRun.startedAt })
        .from(ingestRun)
        .orderBy(desc(ingestRun.startedAt))
        .limit(1),
    ]);

  const de = (estado: EntryStatus) =>
    porEstado.find((f) => f.status === estado)?.n ?? 0;

  return {
    esperandoFederacion: de('club_approved'),
    listasParaEnviar: de('federation_approved'),
    enElClub: de('pending_club'),
    cuarentena: cuarentena[0]?.n ?? 0,
    sinEmparejar: sinEmparejar[0]?.n ?? 0,
    fuentesConRetraso: salud.filter((s) => s.stale).length,
    fuentesTotales: salud.length,
    cuentas: cuentas[0]?.n ?? 0,
    ultimaEjecucion: ultima[0]?.startedAt ?? null,
  };
}

// -------------------------------------------------------- inscripciones ---

export type FilaInscripcion = {
  id: string;
  status: EntryStatus;
  requestedAt: Date | null;
  athleteId: string;
  tirador: string;
  clubNombre: string | null;
  licenciaRfee: string | null;
  licenciaFie: string | null;
  eventId: string;
  eventoNombre: string;
  eventoInicio: string;
  eventoCiudad: string | null;
  eventoPais: string | null;
  weapon: Weapon;
  gender: 'M' | 'F' | 'MIXTO';
  category: string;
  format: 'INDIVIDUAL' | 'EQUIPOS';
  /** Días naturales hasta el comienzo del evento. Negativo = ya pasó. */
  diasHastaEvento: number;
};

/**
 * Bandeja federativa: todo lo vivo de eventos que aún no se han celebrado.
 *
 * No se filtra a `club_approved` aunque sea lo único que la RFEE tiene que
 * aprobar: hace falta ver también lo que sigue atascado en el club y lo ya
 * enviado, porque la pregunta real del día antes de un plazo es «¿va a faltar
 * alguien?», no «¿qué me toca firmar?».
 */
export async function listarBandejaInscripciones(): Promise<FilaInscripcion[]> {
  const hoy = new Date();
  const hoyIso = hoy.toISOString().slice(0, 10);

  const filas = await db
    .select({
      id: entry.id,
      status: entry.status,
      requestedAt: entry.requestedAt,
      athleteId: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      licenciaRfee: athlete.rfeeLicense,
      licenciaFie: athlete.fieLicense,
      clubNombre: club.name,
      eventId: event.id,
      eventoNombre: event.name,
      eventoInicio: event.startDate,
      eventoCiudad: event.city,
      eventoPais: event.country,
      weapon: eventCompetition.weapon,
      gender: eventCompetition.gender,
      category: eventCompetition.category,
      format: eventCompetition.format,
    })
    .from(entry)
    .innerJoin(athlete, eq(entry.athleteId, athlete.id))
    .leftJoin(club, eq(athlete.clubId, club.id))
    .innerJoin(eventCompetition, eq(entry.eventCompetitionId, eventCompetition.id))
    .innerJoin(event, eq(eventCompetition.eventId, event.id))
    .where(and(gte(event.startDate, hoyIso), inArray(entry.status, ESTADOS_VIVOS)))
    .orderBy(asc(event.startDate), asc(athlete.lastName));

  const inicioDeHoy = Date.parse(`${hoyIso}T00:00:00Z`);

  return filas.map((f) => ({
    id: f.id,
    status: f.status as EntryStatus,
    requestedAt: f.requestedAt,
    athleteId: f.athleteId,
    tirador: `${f.firstName} ${f.lastName}`.trim(),
    clubNombre: f.clubNombre,
    licenciaRfee: f.licenciaRfee,
    licenciaFie: f.licenciaFie,
    eventId: f.eventId,
    eventoNombre: f.eventoNombre,
    eventoInicio: f.eventoInicio,
    eventoCiudad: f.eventoCiudad,
    eventoPais: f.eventoPais,
    weapon: f.weapon,
    gender: f.gender,
    category: f.category,
    format: f.format,
    diasHastaEvento: Math.round(
      (Date.parse(`${f.eventoInicio}T00:00:00Z`) - inicioDeHoy) / 86_400_000,
    ),
  }));
}

// ------------------------------------------------------------ normativa ---

export type TemporadaFila = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  current: boolean;
};

export type PlazoFila = {
  id: string;
  seasonId: string;
  scope: 'NACIONAL' | 'INTERNACIONAL' | 'AUTONOMICO';
  circuit: string | null;
  category: string | null;
  type: 'L1' | 'L2' | 'L3' | 'FIE_D7';
  label: string;
  daysBefore: number;
  surchargeEur: string | null;
  blocking: boolean;
  active: boolean;
  sourceDocument: string | null;
  sourceUrl: string | null;
  effectiveFrom: Date;
  updatedAt: Date;
  actualizadoPor: string | null;
};

export type CategoriaFila = {
  id: string;
  seasonId: string;
  code: string;
  birthYearMin: number | null;
  birthYearMax: number | null;
  rank: number;
  laddered: boolean;
  sourceDocument: string | null;
  sourceUrl: string | null;
  updatedAt: Date;
  actualizadoPor: string | null;
};

export type ReglaRankingFila = {
  id: string;
  seasonId: string;
  weapon: string | null;
  category: string | null;
  countingEvents: number;
  coefficients: Record<string, number>;
  pointsTable: Record<string, number>;
  rankingPlaces: number;
  technicalPlaces: number;
  cutoffDate: Date | null;
  active: boolean;
  sourceDocument: string | null;
  sourceUrl: string | null;
  effectiveFrom: Date;
  updatedAt: Date;
  actualizadoPor: string | null;
};

export type Normativa = {
  temporadas: TemporadaFila[];
  temporadaActual: TemporadaFila | null;
  plazos: PlazoFila[];
  categorias: CategoriaFila[];
  reglasRanking: ReglaRankingFila[];
  cambiosRecientes: {
    id: string;
    tableName: string;
    action: string;
    changedAt: Date;
    quien: string | null;
  }[];
};

function mapaNumerico(valor: unknown): Record<string, number> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const salida: Record<string, number> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) salida[k] = n;
  }
  return salida;
}

export async function listarNormativa(): Promise<Normativa> {
  const [temporadas, plazos, categorias, reglas, cambios, perfiles] =
    await Promise.all([
      db.select().from(season).orderBy(desc(season.startDate)),
      db.select().from(deadlineRule).orderBy(desc(deadlineRule.daysBefore)),
      db.select().from(seasonCategory).orderBy(asc(seasonCategory.rank)),
      db.select().from(rankingRule).orderBy(asc(rankingRule.weapon)),
      db
        .select()
        .from(configChangeLog)
        .orderBy(desc(configChangeLog.changedAt))
        .limit(12),
      db.select({ id: userProfile.id, fullName: userProfile.fullName }).from(userProfile),
    ]);

  const nombre = new Map(perfiles.map((p) => [p.id, p.fullName]));
  const quien = (id: string | null) => (id ? (nombre.get(id) ?? null) : null);

  const lista: TemporadaFila[] = temporadas.map((t) => ({
    id: t.id,
    label: t.label,
    startDate: t.startDate,
    endDate: t.endDate,
    current: t.current,
  }));

  return {
    temporadas: lista,
    temporadaActual: lista.find((t) => t.current) ?? null,
    plazos: plazos.map((p) => ({
      id: p.id,
      seasonId: p.seasonId,
      scope: p.scope,
      circuit: p.circuit,
      category: p.category,
      type: p.type,
      label: p.label,
      daysBefore: p.daysBefore,
      surchargeEur: p.surchargeEur,
      blocking: p.blocking,
      active: p.active,
      sourceDocument: p.sourceDocument,
      sourceUrl: p.sourceUrl,
      effectiveFrom: p.effectiveFrom,
      updatedAt: p.updatedAt,
      actualizadoPor: quien(p.updatedByProfileId),
    })),
    categorias: categorias.map((c) => ({
      id: c.id,
      seasonId: c.seasonId,
      code: c.code,
      birthYearMin: c.birthYearMin,
      birthYearMax: c.birthYearMax,
      rank: c.rank,
      laddered: c.laddered,
      sourceDocument: c.sourceDocument,
      sourceUrl: c.sourceUrl,
      updatedAt: c.updatedAt,
      actualizadoPor: quien(c.updatedByProfileId),
    })),
    reglasRanking: reglas.map((r) => ({
      id: r.id,
      seasonId: r.seasonId,
      weapon: r.weapon,
      category: r.category,
      countingEvents: r.countingEvents,
      coefficients: mapaNumerico(r.coefficients),
      pointsTable: mapaNumerico(r.pointsTable),
      rankingPlaces: r.rankingPlaces,
      technicalPlaces: r.technicalPlaces,
      cutoffDate: r.cutoffDate,
      active: r.active,
      sourceDocument: r.sourceDocument,
      sourceUrl: r.sourceUrl,
      effectiveFrom: r.effectiveFrom,
      updatedAt: r.updatedAt,
      actualizadoPor: quien(r.updatedByProfileId),
    })),
    cambiosRecientes: cambios.map((c) => ({
      id: c.id,
      tableName: c.tableName,
      action: c.action,
      changedAt: c.changedAt,
      quien: quien(c.changedByProfileId),
    })),
  };
}

// ----------------------------------------------------------- equipo ---

export type MiembroEquipo = {
  profileId: string;
  email: string;
  fullName: string;
  role: 'admin' | 'coach';
  weapons: Weapon[];
  inviteStatus: 'pendiente' | 'aceptada' | 'revocada';
  haEntrado: boolean;
  createdAt: Date;
};

export async function listarEquipo(): Promise<MiembroEquipo[]> {
  const perfiles = await db
    .select({
      id: userProfile.id,
      email: userProfile.email,
      fullName: userProfile.fullName,
      role: userProfile.role,
      inviteStatus: userProfile.inviteStatus,
      authUserId: userProfile.authUserId,
      createdAt: userProfile.createdAt,
    })
    .from(userProfile)
    .where(inArray(userProfile.role, ['admin', 'coach']))
    .orderBy(asc(userProfile.role), asc(userProfile.fullName));

  if (perfiles.length === 0) return [];

  const armas = await db
    .select({ profileId: profileWeapon.profileId, weapon: profileWeapon.weapon })
    .from(profileWeapon)
    .where(
      inArray(
        profileWeapon.profileId,
        perfiles.map((p) => p.id),
      ),
    );

  const porPerfil = new Map<string, Weapon[]>();
  for (const a of armas) {
    const lista = porPerfil.get(a.profileId) ?? [];
    lista.push(a.weapon);
    porPerfil.set(a.profileId, lista);
  }

  return perfiles.map((p) => ({
    profileId: p.id,
    email: p.email,
    fullName: p.fullName,
    role: p.role as 'admin' | 'coach',
    weapons: porPerfil.get(p.id) ?? [],
    inviteStatus: p.inviteStatus,
    haEntrado: Boolean(p.authUserId),
    createdAt: p.createdAt,
  }));
}

// -------------------------------------------------------- cuarentena ---

export type FilaCuarentena = {
  id: string;
  source: string;
  sourceId: string | null;
  rawPayload: unknown;
  validationErrors: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
  ejecucion: Date | null;
};

export async function listarCuarentena(): Promise<FilaCuarentena[]> {
  const filas = await db
    .select({
      id: ingestQuarantine.id,
      source: ingestQuarantine.source,
      sourceId: ingestQuarantine.sourceId,
      rawPayload: ingestQuarantine.rawPayload,
      validationErrors: ingestQuarantine.validationErrors,
      resolvedAt: ingestQuarantine.resolvedAt,
      createdAt: ingestQuarantine.createdAt,
      ejecucion: ingestRun.startedAt,
    })
    .from(ingestQuarantine)
    .leftJoin(ingestRun, eq(ingestQuarantine.ingestRunId, ingestRun.id))
    .orderBy(asc(ingestQuarantine.resolvedAt), desc(ingestQuarantine.createdAt))
    .limit(200);

  return filas;
}

// --------------------------------------------------------- emparejar ---

export type ResultadoSinEmparejar = {
  id: string;
  sourceAthleteName: string;
  sourceLicense: string | null;
  sourceClub: string | null;
  position: number;
  weapon: string | null;
  gender: string | null;
  category: string | null;
  sourceUrl: string | null;
  eventoNombre: string | null;
  eventoInicio: string | null;
};

export type TiradorParaEmparejar = {
  id: string;
  nombre: string;
  clubNombre: string | null;
  birthDate: string;
  rfeeLicense: string | null;
  weapons: Weapon[];
};

export async function listarSinEmparejar(): Promise<ResultadoSinEmparejar[]> {
  return db
    .select({
      id: result.id,
      sourceAthleteName: result.sourceAthleteName,
      sourceLicense: result.sourceLicense,
      sourceClub: result.sourceClub,
      position: result.position,
      weapon: result.weapon,
      gender: result.gender,
      category: result.category,
      sourceUrl: result.sourceUrl,
      eventoNombre: event.name,
      eventoInicio: event.startDate,
    })
    .from(result)
    .leftJoin(event, eq(result.eventId, event.id))
    .where(isNull(result.athleteId))
    .orderBy(asc(result.sourceAthleteName), asc(result.position))
    .limit(400);
}

export async function listarTiradoresParaEmparejar(): Promise<TiradorParaEmparejar[]> {
  const filas = await db
    .select({
      id: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      birthDate: athlete.birthDate,
      rfeeLicense: athlete.rfeeLicense,
      clubNombre: club.name,
    })
    .from(athlete)
    .leftJoin(club, eq(athlete.clubId, club.id))
    .where(eq(athlete.active, true))
    .orderBy(asc(athlete.lastName), asc(athlete.firstName));

  if (filas.length === 0) return [];

  const armas = await db
    .select({ athleteId: athleteWeapon.athleteId, weapon: athleteWeapon.weapon })
    .from(athleteWeapon)
    .where(
      inArray(
        athleteWeapon.athleteId,
        filas.map((f) => f.id),
      ),
    );

  const porTirador = new Map<string, Weapon[]>();
  for (const a of armas) {
    const lista = porTirador.get(a.athleteId) ?? [];
    lista.push(a.weapon);
    porTirador.set(a.athleteId, lista);
  }

  return filas.map((f) => ({
    id: f.id,
    nombre: `${f.firstName} ${f.lastName}`.trim(),
    clubNombre: f.clubNombre,
    birthDate: f.birthDate,
    rfeeLicense: f.rfeeLicense,
    weapons: porTirador.get(f.id) ?? [],
  }));
}

/** Cuántos resultados ya emparejados hay. Da contexto al tamaño de la cola. */
export async function contarResultadosEmparejados(): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(result)
    .where(isNotNull(result.athleteId));
  return fila?.n ?? 0;
}

// ------------------------------------------------------------- salud ---

export type SaludIngestion = Awaited<ReturnType<typeof sourceHealth>>;

export async function saludDeLaIngestion() {
  const [fuentes, cuarentenaPorFuente, ultimas] = await Promise.all([
    sourceHealth(),
    openQuarantineCount(),
    db
      .select({
        id: ingestRun.id,
        source: ingestRun.source,
        status: ingestRun.status,
        startedAt: ingestRun.startedAt,
        durationMs: ingestRun.durationMs,
        itemsSeen: ingestRun.itemsSeen,
        itemsCreated: ingestRun.itemsCreated,
        itemsUpdated: ingestRun.itemsUpdated,
        itemsQuarantined: ingestRun.itemsQuarantined,
        error: ingestRun.error,
        triggeredBy: ingestRun.triggeredBy,
      })
      .from(ingestRun)
      .orderBy(desc(ingestRun.startedAt))
      .limit(25),
  ]);

  return { fuentes, cuarentenaPorFuente, ultimas };
}

// ------------------------------------------------------------ usuarios ---

export type ClubFila = { id: string; name: string; regionalFederation: string | null };

export async function listarClubesParaAlta(): Promise<ClubFila[]> {
  return db
    .select({
      id: club.id,
      name: club.name,
      regionalFederation: club.regionalFederation,
    })
    .from(club)
    .where(eq(club.active, true))
    .orderBy(asc(club.name));
}

export type AltaReciente = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  inviteStatus: string;
  createdAt: Date;
  clubNombre: string | null;
  fichas: string[];
};

export async function listarAltasRecientes(): Promise<AltaReciente[]> {
  const perfiles = await db
    .select({
      id: userProfile.id,
      fullName: userProfile.fullName,
      email: userProfile.email,
      role: userProfile.role,
      inviteStatus: userProfile.inviteStatus,
      createdAt: userProfile.createdAt,
      clubNombre: club.name,
    })
    .from(userProfile)
    .leftJoin(club, eq(userProfile.clubId, club.id))
    .orderBy(desc(userProfile.createdAt))
    .limit(30);

  if (perfiles.length === 0) return [];

  const ids = perfiles.map((p) => p.id);

  const fichas = await db
    .select({
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      userProfileId: athlete.userProfileId,
      guardianProfileId: athlete.guardianProfileId,
    })
    .from(athlete)
    .where(
      or(
        inArray(athlete.userProfileId, ids),
        inArray(athlete.guardianProfileId, ids),
      ),
    );

  const porPerfil = new Map<string, string[]>();
  for (const f of fichas) {
    const nombre = `${f.firstName} ${f.lastName}`.trim();
    for (const clave of [f.userProfileId, f.guardianProfileId]) {
      if (!clave) continue;
      const lista = porPerfil.get(clave) ?? [];
      lista.push(nombre);
      porPerfil.set(clave, lista);
    }
  }

  return perfiles.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    email: p.email,
    role: p.role,
    inviteStatus: p.inviteStatus,
    createdAt: p.createdAt,
    clubNombre: p.clubNombre,
    fichas: porPerfil.get(p.id) ?? [],
  }));
}
