import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as esquema from '@/db/schema/notificaciones';
import { CLAVES_PREFERENCIA } from '@/lib/notificaciones/tipos';

const DIR = new URL('../drizzle-d1/', import.meta.url);
const MIGRACION = readFileSync(new URL('0014_notificaciones.sql', DIR), 'utf8');
const sentencias = MIGRACION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(';').map((s) => s.trim()).filter(Boolean);

function todas() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync(DIR).filter((x) => /^\d{4}_.+\.sql$/.test(x)).sort()) db.exec(readFileSync(new URL(f, DIR), 'utf8'));
  return db;
}

const TABLAS = [
  esquema.notificacion, esquema.notificacionPreferencia, esquema.notificacionSuscripcion,
  esquema.notificacionEvento, esquema.notificacionCursor, esquema.notificacionLectura,
];

describe('migración 0014_notificaciones', () => {
  it('es solo aditiva: tablas e índices nuevos con IF NOT EXISTS, nada sport_ y ningún cambio de datos', () => {
    expect(sentencias.length).toBeGreaterThan(0);
    for (const s of sentencias) {
      expect(s, s.slice(0, 60)).toMatch(/^CREATE (TABLE|(UNIQUE )?INDEX) IF NOT EXISTS notificacion/);
    }
    expect(MIGRACION).not.toMatch(/\b(DROP|ALTER|INSERT|UPDATE|DELETE FROM|TRIGGER|RENAME)\b/);
    expect(MIGRACION).not.toMatch(/CREATE TABLE IF NOT EXISTS sport_/);
  });

  it('se aplica sobre todas las anteriores, dos veces sin error, y deja la base íntegra', () => {
    const db = todas();
    db.exec(MIGRACION);
    expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('el contrato drizzle coincide con la migración: columnas e índices', () => {
    const db = todas();
    for (const tabla of TABLAS) {
      const config = getTableConfig(tabla);
      const fisicas = (db.prepare(`PRAGMA table_info("${config.name}")`).all() as { name: string; notnull: number }[]);
      expect(fisicas.map((c) => c.name).sort(), config.name).toEqual(config.columns.map((c) => c.name).sort());
      for (const c of config.columns) expect(fisicas.find((f) => f.name === c.name)!.notnull === 1 || c.primary, `${config.name}.${c.name}`).toBe(c.notNull);
      const indices = (db.prepare(`PRAGMA index_list("${config.name}")`).all() as { name: string }[]).map((i) => i.name);
      for (const i of config.indexes) expect(indices, config.name).toContain(i.config.name);
    }
    db.close();
  });

  it('las preferencias admitidas son exactamente las del código, y las rutas solo internas', () => {
    expect([...esquema.CLAVES_PREFERENCIA].sort()).toEqual([...CLAVES_PREFERENCIA].sort());
    const db = todas();
    db.prepare(`INSERT INTO user_profile (id, email, full_name, ical_token) VALUES ('u', 'u@x.test', 'U', 't')`).run();
    const insertar = (url: string) => db.prepare(`INSERT INTO notificacion (id, profile_id, tipo, clave, grupo, titulo, cuerpo, url, creada_en, actualizada_en)
      VALUES (?, 'u', 'prueba', ?, 'g', 't', '', ?, 1, 1)`).run(url, url, url);
    expect(() => insertar('/notificaciones')).not.toThrow();
    expect(() => insertar('https://malo.test')).toThrow();
    expect(() => insertar('//malo.test')).toThrow();
    expect(() => db.prepare(`INSERT INTO notificacion_preferencia VALUES ('u', 'tipo:otro', 1, 1)`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO notificacion_suscripcion (id, profile_id, endpoint, p256dh, auth, creada_en)
      VALUES ('s', 'u', 'http://inseguro.test', '${'A'.repeat(87)}', '${'A'.repeat(22)}', 1)`).run()).toThrow();
    // Borrar la cuenta se lleva sus avisos, preferencias y dispositivos.
    db.prepare(`INSERT INTO notificacion_suscripcion (id, profile_id, endpoint, p256dh, auth, creada_en)
      VALUES ('s', 'u', 'https://push.test/x', '${'A'.repeat(87)}', '${'A'.repeat(22)}', 1)`).run();
    db.prepare(`DELETE FROM user_profile WHERE id = 'u'`).run();
    expect(db.prepare('SELECT count(*) AS n FROM notificacion').get()!.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM notificacion_suscripcion').get()!.n).toBe(0);
    db.close();
  });
});
