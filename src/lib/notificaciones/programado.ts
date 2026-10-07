import { sql } from 'drizzle-orm';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { getCurrentSeason, listEvents } from '@/lib/queries/calendar';
import { guardarAvisos, leerPreferencias, podarBandeja, type AvisoGuardado } from './bandeja';
import { construirAvisosCalendario, HORAS_NUEVA, type CriteriosCalendario, type EventoCalendario } from './calendario';
import { esFaltaDeTabla, filasDe, type DbAvisos } from './db';
import { entregarPush, type ResumenEntrega } from './entrega';
import { crearLectorPerfil } from './lector-perfil';
import { revisarCambiosDePerfil } from './perfil';
import { consumirEventosIngesta, procesarEventosPendientes } from './resultados';

/**
 * Lo que hace el cron de avisos (`/api/cron/notify`, 07:00 UTC) con las
 * notificaciones de la aplicación. Cada paso va por separado: si falla uno,
 * los demás salen igual, y sin la migración 0014 todo se queda en
 * «sin_migracion» sin romper el correo.
 */

type Estado = 'ok' | 'sin_migracion' | 'error';

export type ResumenProgramado = {
  resultados: { estado: Estado; eventos: number; avisos: number };
  perfil: { estado: Estado; personas: number; cambios: number };
  calendario: { estado: Estado; perfiles: number; avisos: number };
  guardados: number;
  push: ResumenEntrega | { estado: Estado };
};

async function paso<T>(fn: () => Promise<T>): Promise<{ estado: Estado; valor: T | null }> {
  try {
    return { estado: 'ok', valor: await fn() };
  } catch (error) {
    return { estado: esFaltaDeTabla(error) ? 'sin_migracion' : 'error', valor: null };
  }
}

/** Criterios de «tu calendario» de cada cuenta activa, como el feed iCal «todo». */
export async function criteriosCalendario(db: DbAvisos, categoriasTemporada: Parameters<typeof deriveCategoriesFromBirthDate>[1] | null): Promise<CriteriosCalendario[]> {
  const perfiles = await filasDe<{ id: string }>(db, sql`
    SELECT id FROM user_profile
    WHERE invite_status <> 'revocada' AND auth_user_id IS NOT NULL AND role IN ('admin', 'coach', 'athlete')`);
  if (perfiles.length === 0) return [];
  const atletas = await filasDe<{ id: string; user_profile_id: string | null; guardian_profile_id: string | null; birth_date: string; gender: string }>(db, sql`
    SELECT id, user_profile_id, guardian_profile_id, birth_date, gender FROM athlete
    WHERE active = 1 AND (user_profile_id IS NOT NULL OR guardian_profile_id IS NOT NULL)`);
  const armasAtleta = await filasDe<{ athlete_id: string; weapon: string }>(db, sql`
    SELECT w.athlete_id, w.weapon FROM athlete_weapon w JOIN athlete a ON a.id = w.athlete_id
    WHERE a.active = 1 AND (a.user_profile_id IS NOT NULL OR a.guardian_profile_id IS NOT NULL)`);
  const armasPerfil = await filasDe<{ profile_id: string; weapon: string }>(db, sql`SELECT profile_id, weapon FROM profile_weapon`);

  const criterios = new Map<string, { armas: Set<string>; generos: Set<string>; categorias: Set<string> }>();
  for (const p of perfiles) criterios.set(p.id, { armas: new Set(), generos: new Set(), categorias: new Set() });
  const armasDe = new Map<string, string[]>();
  for (const w of armasAtleta) armasDe.set(w.athlete_id, [...(armasDe.get(w.athlete_id) ?? []), w.weapon]);
  for (const a of atletas) {
    for (const profileId of new Set([a.user_profile_id, a.guardian_profile_id])) {
      const c = profileId ? criterios.get(profileId) : undefined;
      if (!c) continue;
      for (const w of armasDe.get(a.id) ?? []) c.armas.add(w);
      c.generos.add(a.gender);
      if (categoriasTemporada) for (const cat of deriveCategoriesFromBirthDate(a.birth_date, categoriasTemporada).eligible) c.categorias.add(cat);
    }
  }
  for (const w of armasPerfil) criterios.get(w.profile_id)?.armas.add(w.weapon);
  return [...criterios].map(([profileId, c]) => ({
    profileId,
    armas: c.armas.size ? c.armas : null,
    generos: c.generos.size ? c.generos : null,
    categorias: c.categorias.size ? c.categorias : null,
  }));
}

async function avisosCalendario(db: DbAvisos, ahora: Date): Promise<{ perfiles: number; guardados: AvisoGuardado[]; avisos: number }> {
  const temporada = await getCurrentSeason();
  const perfiles = await criteriosCalendario(db, temporada?.categories ?? null);
  if (perfiles.length === 0) return { perfiles: 0, guardados: [], avisos: 0 };
  const [vistas, nuevas] = await Promise.all([
    listEvents({ conPlazos: true, scope: ['NACIONAL', 'INTERNACIONAL'], limit: 500 }),
    filasDe<{ id: string }>(db, sql`
      SELECT id FROM event WHERE first_seen_at >= ${ahora.getTime() - HORAS_NUEVA * 3_600_000}
        AND cancelled = 0 AND disappeared_at IS NULL`),
  ]);
  const eventos: EventoCalendario[] = vistas.map((e) => ({
    id: e.id, name: e.name, startDate: e.startDate, endDate: e.endDate, city: e.city,
    competitions: e.competitions.map((c) => ({
      weapon: c.weapon, gender: c.gender, category: c.category, format: c.format,
      deadlines: c.deadlines.map((d) => ({ type: d.type, label: d.label, deadlineAt: d.deadlineAt, blocking: d.blocking })),
    })),
  }));
  const preferencias = await leerPreferencias(db, perfiles.map((p) => p.profileId));
  const avisos = construirAvisosCalendario(perfiles, eventos, new Set(nuevas.map((n) => n.id)), ahora, preferencias);
  return { perfiles: perfiles.length, guardados: await guardarAvisos(db, avisos, preferencias, ahora), avisos: avisos.length };
}

export async function generarAvisosProgramados(db: DbAvisos, ahora = new Date()): Promise<ResumenProgramado> {
  const resultados = await paso(async () => {
    await consumirEventosIngesta(db, ahora);
    return procesarEventosPendientes(db, ahora);
  });
  const perfil = await paso(() => revisarCambiosDePerfil(db, crearLectorPerfil(db), ahora));
  const calendario = await paso(() => avisosCalendario(db, ahora));
  const guardados = [
    ...(resultados.valor?.guardados ?? []),
    ...(perfil.valor?.guardados ?? []),
    ...(calendario.valor?.guardados ?? []),
  ];
  const push = await paso(() => entregarPush(db, guardados, { ahora }));
  await paso(() => podarBandeja(db, ahora));
  return {
    resultados: { estado: resultados.estado, eventos: resultados.valor?.eventos ?? 0, avisos: resultados.valor?.avisos ?? 0 },
    perfil: { estado: perfil.estado, personas: perfil.valor?.personas ?? 0, cambios: perfil.valor?.cambios ?? 0 },
    calendario: { estado: calendario.estado, perfiles: calendario.valor?.perfiles ?? 0, avisos: calendario.valor?.avisos ?? 0 },
    guardados: guardados.length,
    push: push.valor ?? { estado: push.estado },
  };
}
