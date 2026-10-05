import { readFileSync } from 'node:fs';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';

/** Base desechable con el mismo SQL nativo, nunca un destino remoto. */
export function fixtureDeportivaD1() {
  const local = localD1();
  try {
    local.sqlite.exec(readFileSync(new URL('../../drizzle-d1/0002_guardia_deportiva.sql', import.meta.url), 'utf8'));
    local.sqlite.exec(readFileSync(new URL('../../drizzle-d1/0005_presupuesto_8gib.sql', import.meta.url), 'utf8'));
    return { ...local, db: createD1Database(local.binding) };
  } catch (error) {
    local.close();
    throw error;
  }
}
