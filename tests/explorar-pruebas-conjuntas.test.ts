import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import {
  conjuntasDe, crearDetectorConjuntas, ETIQUETA_PRUEBA_CONJUNTA, pruebaConjuntaDe,
} from '@/lib/sport/explorar/pruebas-conjuntas';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const CONJUNTA = '11111111-1111-4111-8111-111111111111';
const PARTE_M = '22222222-2222-4222-8222-222222222222';
const PARTE_F = '33333333-3333-4333-8333-333333333333';
const OTRA = '44444444-4444-4444-8444-444444444444';
const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

function entorno(conTabla: boolean) {
  const local = localD1();
  cierres.push(local.close);
  const s = local.sqlite;
  if (conTabla) {
    // Sin la guardia de 0002 en esta base: sólo la tabla y sus índices de la migración.
    const migracion = readFileSync(new URL('../drizzle-d1/0013_pruebas_conjuntas.sql', import.meta.url), 'utf8');
    s.exec(migracion.slice(0, migracion.indexOf('CREATE TRIGGER')));
  }
  s.exec(`INSERT INTO sport_edition (id, source, season, tournament_key, name) VALUES ('e1', 'engarde', '2024', 't1', 'Criterium')`);
  for (const [id, g] of [[CONJUNTA, 'MIXTO'], [PARTE_M, 'M'], [PARTE_F, 'F'], [OTRA, 'M']]) {
    s.prepare(`INSERT INTO sport_competition (id, edition_id, source, season, competition_key, weapon, gender, category)
      VALUES (?, 'e1', 'engarde', '2024', ?, 'SABLE', ?, 'M11')`).run(id, id, g);
  }
  if (conTabla) {
    s.exec(`INSERT INTO sport_competition_combined (id, part_competition_id, combined_competition_id, rule, shared_names, created_at) VALUES
      ('k1', '${PARTE_M}', '${CONJUNTA}', 'partes', 4, 1), ('k2', '${PARTE_F}', '${CONJUNTA}', 'partes', 4, 1)`);
  }
  return createD1Database(local.binding);
}

describe('pruebas conjuntas (app)', () => {
  it('enlaza una parte y la propia conjunta con todas sus partes', async () => {
    const db = entorno(true);
    const hay = crearDetectorConjuntas(db);
    const esperado = { conjuntaId: CONJUNTA, regla: 'partes', partes: [PARTE_M, PARTE_F].sort() };
    expect(await pruebaConjuntaDe(db, PARTE_F, hay)).toEqual(esperado);
    expect(await pruebaConjuntaDe(db, CONJUNTA, hay)).toEqual(esperado);
    expect(await pruebaConjuntaDe(db, OTRA, hay)).toBeNull();
    expect(await pruebaConjuntaDe(db, 'no-es-uuid', hay)).toBeNull();
    expect(await conjuntasDe(db, [PARTE_M, OTRA, CONJUNTA], hay))
      .toEqual(new Map([[PARTE_M, CONJUNTA], [CONJUNTA, CONJUNTA]]));
    expect(ETIQUETA_PRUEBA_CONJUNTA).toBe('Poules y cuadro: prueba conjunta');
  });

  it('sin la migración 0013 no hay enlaces ni errores', async () => {
    const db = entorno(false);
    const hay = crearDetectorConjuntas(db);
    expect(await pruebaConjuntaDe(db, PARTE_M, hay)).toBeNull();
    expect(await conjuntasDe(db, [PARTE_M], hay)).toEqual(new Map());
  });
});
