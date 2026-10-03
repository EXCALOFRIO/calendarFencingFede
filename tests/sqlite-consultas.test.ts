import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { integer, SQLiteSyncDialect, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { AHORA_SQL, contieneSinMayusculas, enLista, lotesDeInsercion, textoSinAcentos } from '@/lib/sqlite';

const dialecto = new SQLiteSyncDialect();

describe('consultas nativas de SQLite para D1', () => {
  it('consulta más de cien identificadores con un solo parámetro', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('create table item (id text primary key)');
      db.prepare('insert into item values (?)').run('id-180');
      const consulta = dialecto.sqlToQuery(
        sql`select id from item where ${enLista(sql`id`, Array.from({ length: 200 }, (_, i) => `id-${i}`))}`,
      );
      expect(consulta.params).toHaveLength(1);
      expect(db.prepare(consulta.sql).all(consulta.params[0] as string)).toEqual([{ id: 'id-180' }]);
    } finally {
      db.close();
    }
  });

  it('trata comillas y texto SQL como valores, sin ejecutar instrucciones', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('create table item (id text)');
      const valor = "'; drop table item; --";
      db.prepare('insert into item values (?)').run(valor);
      const consulta = dialecto.sqlToQuery(sql`select id from item where ${enLista(sql`id`, [valor])}`);
      expect(db.prepare(consulta.sql).all(consulta.params[0] as string)).toEqual([{ id: valor }]);
      expect(db.prepare('select count(*) as n from item').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('una lista vacía no coincide con ninguna fila', () => {
    const consulta = dialecto.sqlToQuery(sql`select 1 as n where ${enLista(sql`1`, [])}`);
    const db = new DatabaseSync(':memory:');
    try {
      expect(consulta.params).toHaveLength(0);
      expect(db.prepare(consulta.sql).all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('conserva los tipos booleanos y numéricos de la lista', () => {
    const consulta = dialecto.sqlToQuery(sql`select 1 as n where ${enLista(sql`1`, [true, 2, null])}`);
    const db = new DatabaseSync(':memory:');
    try {
      expect(db.prepare(consulta.sql).all(consulta.params[0] as string)).toEqual([{ n: 1 }]);
    } finally {
      db.close();
    }
  });

  it('rechaza valores no finitos y listas demasiado grandes', () => {
    expect(() => enLista(sql`id`, [Number.NaN])).toThrow('no válido');
    expect(() => enLista(sql`id`, ['x'.repeat(1_000_001)])).toThrow('tamaño permitido');
  });

  it('busca sin distinguir mayúsculas españolas, conservando los acentos', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const consulta = dialecto.sqlToQuery(
        sql`select 1 as n where ${contieneSinMayusculas(sql`'CAMPEONATO DE ESPAÑA EN CÓRDOBA'`, '%España en Córdoba%')}`,
      );
      expect(consulta.params).toHaveLength(1);
      expect(db.prepare(consulta.sql).all(consulta.params[0] as string)).toEqual([{ n: 1 }]);
    } finally {
      db.close();
    }
  });

  it('usa el reloj de SQLite en milisegundos UTC', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const antes = Date.now();
      const consulta = dialecto.sqlToQuery(sql`select ${AHORA_SQL} as ahora`);
      const fila = db.prepare(consulta.sql).get() as { ahora: number };
      expect(Number.isSafeInteger(fila.ahora)).toBe(true);
      expect(fila.ahora).toBeGreaterThanOrEqual(antes - 5);
      expect(fila.ahora).toBeLessThanOrEqual(Date.now() + 5);
    } finally {
      db.close();
    }
  });

  it('conserva la búsqueda de nombres sin acentos ni mayúsculas y sin nuevos parámetros', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const consulta = dialecto.sqlToQuery(
        sql`select ${textoSinAcentos(sql`'HÉCTOR MARIÑO ÇÁSAUS'`)} as nombre`,
      );
      expect(consulta.params).toHaveLength(0);
      expect(db.prepare(consulta.sql).get()).toEqual({ nombre: 'hector marino casaus' });
    } finally {
      db.close();
    }
  });

  it('trocea inserciones sin perder filas y cuenta los defaults de cliente', () => {
    const tabla = sqliteTable('ejemplo', {
      id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
      nombre: text('nombre').notNull(),
      activo: integer('activo', { mode: 'boolean' }).default(true),
    });
    const filas = Array.from({ length: 100 }, (_, i) => ({ nombre: `dato-${i}` }));
    const lotes = lotesDeInsercion(filas, tabla);
    expect(lotes.map((lote) => lote.length)).toEqual([30, 30, 30, 10]);
    expect(lotes.flat()).toEqual(filas);
    expect(lotesDeInsercion([], tabla)).toEqual([]);
  });
});
