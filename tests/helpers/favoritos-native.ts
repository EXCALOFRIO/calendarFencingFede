import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import type { SessionProfile } from '@/lib/auth/session';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { crearContexto, perfil, type Sentencia } from './explorar';

/** Synthetic, disposable SQLite; executes the production SQL and D1 batches. */
export function favoritosNative(opciones: {
  perfil?: SessionProfile | null;
  esquema?: { identidad: boolean; referencias: boolean };
  personas?: { id: string; nombre?: string }[];
  filas?: [perfil: string, persona: string, creado: number][];
  fusiones?: Record<string, string>;
} = {}) {
  const local = localD1();
  const database = createD1Database(local.binding);
  const dialecto = new SQLiteSyncDialect();
  const sentencias: Sentencia[] = [];
  const lotes: number[] = [];
  const cuenta = opciones.perfil === undefined ? perfil() : opciones.perfil;
  const filas = opciones.filas ?? [];
  const fusiones = opciones.fusiones ?? {};
  try {
    const perfiles = new Set([...filas.map(([p]) => p), ...(cuenta ? [cuenta.profileId] : [])]);
    for (const id of perfiles) {
      local.sqlite.prepare('INSERT INTO user_profile(id,email,full_name,ical_token) VALUES (?,?,?,?)')
        .run(id, `${id}@example.test`, 'Cuenta sintética', `synthetic-${id}`);
    }
    const personas = new Map((opciones.personas ?? []).map((p) => [p.id, p.nombre ?? p.id]));
    for (const [, id] of filas) if (!personas.has(id)) personas.set(id, id);
    for (const [id, destino] of Object.entries(fusiones)) {
      if (!personas.has(id)) personas.set(id, id);
      if (!personas.has(destino)) personas.set(destino, destino);
    }
    for (const [id, nombre] of personas) {
      local.sqlite.prepare('INSERT INTO sport_person(id,display_name,name_normalized,country_code,gender,birth_year) VALUES (?,?,?, ?,?,?)')
        .run(id, nombre, nombre.toLowerCase(), 'ESP', 'F', 1999);
    }
    for (const [id, destino] of Object.entries(fusiones)) {
      local.sqlite.prepare('UPDATE sport_person SET merged_into_person_id = ? WHERE id = ?').run(destino, id);
    }
    for (const [p, id, creado] of filas) {
      local.sqlite.prepare('INSERT INTO sport_favorite(profile_id,person_id,created_at) VALUES (?,?,?)').run(p, id, creado);
    }
  } catch (error) {
    local.close();
    throw error;
  }

  const ctx: ContextoExplorador = {
    ...crearContexto({ perfil: cuenta, esquema: opciones.esquema }).ctx,
    db: {
      execute: <T = Record<string, unknown>>(query: SQL) => {
        const { sql, params } = dialecto.sqlToQuery(query);
        sentencias.push({ text: sql, params });
        // Keep SQLiteRaw lazy: batch must own execution and rollback.
        return database.execute<T>(query);
      },
      batch: ((queries) => {
        lotes.push(queries.length);
        return database.batch(queries);
      }) as typeof database.batch,
    },
  };
  const de = (p: string): [string, number][] =>
    local.sqlite.prepare('SELECT person_id, created_at FROM sport_favorite WHERE profile_id = ? ORDER BY rowid').all(p)
      .map((r) => [`${p}|${r.person_id}`, Number(r.created_at)]);
  const favoritos = {
    get: (key: string): number | undefined => {
      const [p, id] = key.split('|');
      const row = local.sqlite.prepare('SELECT created_at FROM sport_favorite WHERE profile_id = ? AND person_id = ?').get(p, id);
      return row ? Number(row.created_at) : undefined;
    },
    has: (key: string): boolean => favoritos.get(key) !== undefined,
  };
  const reloj = () => Number(local.sqlite.prepare("SELECT cast(unixepoch('subsec') * 1000 AS integer) AS ms").get()!.ms);
  const marca = (ms: number) =>
    String(local.sqlite.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f', ? / 1000.0, 'unixepoch') AS marca").get(ms)!.marca);
  return { ...local, ctx, sentencias, lotes, favoritos, de, reloj, marca };
}
