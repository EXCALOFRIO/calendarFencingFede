import { readFileSync } from 'node:fs';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';

/** Base desechable: 0000 (aplicación y tablas deportivas) + 0014 (notificaciones). Sin guardas deportivas. */
export function baseNotificaciones() {
  const local = localD1();
  local.sqlite.exec(readFileSync(new URL('../../drizzle-d1/0014_notificaciones.sql', import.meta.url), 'utf8'));
  const db = createD1Database(local.binding);
  const s = local.sqlite;
  let n = 0;
  const uuid = () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };

  const perfil = (nombre: string, extra: { role?: string; auth?: boolean } = {}) => {
    const id = uuid();
    s.prepare(`INSERT INTO user_profile (id, auth_user_id, email, full_name, role, invite_status, ical_token)
      VALUES (?, ?, ?, ?, ?, 'aceptada', ?)`).run(id, extra.auth === false ? null : `auth-${id}`, `${id}@example.test`, nombre, extra.role ?? 'athlete', `tok-${id}`);
    return id;
  };
  const atleta = (nombre: string, apellido: string, opciones: { propietario?: string; tutor?: string; nacimiento?: string; genero?: string } = {}) => {
    const id = uuid();
    s.prepare(`INSERT INTO athlete (id, user_profile_id, guardian_profile_id, first_name, last_name, birth_date, gender, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(id, opciones.propietario ?? null, opciones.tutor ?? null, nombre, apellido, opciones.nacimiento ?? '2010-05-04', opciones.genero ?? 'F');
    return id;
  };
  // Adulta por defecto: a quien sigue a un posible menor (o sin año) no le llegan sus resultados.
  const persona = (nombre: string, opciones: { atleta?: string; fundidaEn?: string; anio?: number | null } = {}) => {
    const id = uuid();
    s.prepare(`INSERT INTO sport_person (id, athlete_id, display_name, name_normalized, merged_into_person_id, birth_year)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, opciones.atleta ?? null, nombre, nombre.toLowerCase(), opciones.fundidaEn ?? null, opciones.anio === undefined ? 1990 : opciones.anio);
    return id;
  };
  const evento = (nombre: string) => {
    const id = uuid();
    s.prepare(`INSERT INTO event (id, source, source_id, name, start_date, end_date, scope, content_hash)
      VALUES (?, 'skermo_rfee', ?, ?, '2026-03-07', '2026-03-08', 'NACIONAL', 'h')`).run(id, id, nombre);
    return id;
  };
  const pruebaApp = (eventId: string) => {
    const id = uuid();
    s.prepare(`INSERT INTO event_competition (id, event_id, weapon, gender, category, format, content_hash)
      VALUES (?, ?, 'ESPADA', 'F', 'M17', 'INDIVIDUAL', 'h')`).run(id, eventId);
    return id;
  };
  const prueba = (nombre: string, opciones: { eventCompetitionId?: string; eventId?: string } = {}) => {
    const edicion = uuid();
    s.prepare(`INSERT INTO sport_edition (id, source, season, tournament_key, name, event_id) VALUES (?, 'skermo', '2025-2026', ?, ?, ?)`)
      .run(edicion, edicion, nombre, opciones.eventId ?? null);
    const id = uuid();
    s.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category, format, event_competition_id)
      VALUES (?, ?, 'skermo', '2025-2026', ?, 'ESPADA', 'F', 'M17', 'INDIVIDUAL', ?)`).run(id, edicion, id, opciones.eventCompetitionId ?? null);
    return { id, edicion };
  };
  const resultado = (competitionId: string, personId: string | null, puesto: number, nombre = 'X') => {
    s.prepare(`INSERT INTO sport_result (id, competition_id, source, source_fact_key, person_id, source_name, position, content_hash)
      VALUES (?, ?, 'skermo', ?, ?, ?, ?, 'h')`).run(uuid(), competitionId, uuid(), personId, nombre, puesto);
  };
  const inscribir = (athleteId: string, eventCompetitionId: string, estado = 'submitted', pedidoPor: string | null = null) => {
    s.prepare(`INSERT INTO entry (id, athlete_id, event_competition_id, status, requested_by_profile_id) VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), athleteId, eventCompetitionId, estado, pedidoPor);
  };
  const seguir = (profileId: string, personId: string) => {
    s.prepare(`INSERT INTO sport_favorite (profile_id, person_id, created_at) VALUES (?, ?, ?)`).run(profileId, personId, Date.now());
  };
  const preferencia = (profileId: string, clave: string, activa: boolean) => {
    s.prepare(`INSERT INTO notificacion_preferencia (profile_id, clave, activa, actualizada_en) VALUES (?, ?, ?, ?)
      ON CONFLICT (profile_id, clave) DO UPDATE SET activa = excluded.activa`).run(profileId, clave, activa ? 1 : 0, Date.now());
  };
  const avisos = (profileId?: string) => (profileId
    ? s.prepare('SELECT * FROM notificacion WHERE profile_id = ? ORDER BY creada_en, id').all(profileId)
    : s.prepare('SELECT * FROM notificacion ORDER BY creada_en, id').all()) as Record<string, unknown>[];

  return {
    ...local, db, uuid, perfil, atleta, persona, evento, pruebaApp, prueba, resultado, inscribir, seguir, preferencia, avisos,
  };
}

/** Suscripción con claves reales de navegador (para que el cifrado funcione) y su endpoint. */
export async function suscripcionNavegador(endpoint: string) {
  const par = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
  return { endpoint, p256dh: b64(publica), auth: b64(auth), dispositivo: 'Pruebas' };
}
