import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { normalizeSportName as normalizarNombre } from '@/lib/identity/resolver';
import { anioNacimientoPublico, posibleMenor } from '@/lib/sport/explorar/anio-publico';
import { buscarDeportistas } from '@/lib/sport/explorar/busqueda';
import { listarFavoritos } from '@/lib/sport/explorar/favoritos';
import { vetarEnlaceFie } from '@/lib/sport/explorar/ficha';
import { leerCabeceras } from '@/lib/sport/explorar/personas';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { crearContexto, perfil, UUID_A as A, UUID_B as B, UUID_C as C } from './helpers/explorar';
import { construirIndiceExplorar } from './helpers/indice-explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

/** `crearContexto` fija hoy en 2026-10-02: quien nació en 2008 o después puede ser menor. */
const HOY = '2026-10-02';
const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const db = createD1Database(local.binding);
  const ctx = { ...crearContexto().ctx, db };
  const cuenta = perfil().profileId;
  local.sqlite.prepare('INSERT INTO user_profile (id,email,full_name,ical_token) VALUES (?,?,?,?)')
    .run(cuenta, `${cuenta}@example.test`, 'Cuenta sintética', cuenta);
  const persona = (id: string, nombre: string, anio: number | null, pais = 'ESP') =>
    local.sqlite.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,merged_into_person_id,country_code,gender,birth_year)
      VALUES (?,?,?,NULL,?,'M',?)`).run(id, nombre, normalizarNombre(nombre), pais, anio);
  const favorito = (id: string, fecha: number) =>
    local.sqlite.prepare('INSERT INTO sport_favorite VALUES (?,?,?)').run(cuenta, id, fecha);
  return { db, ctx, persona, favorito, sqlite: local.sqlite };
}

describe('anioNacimientoPublico', () => {
  it('null para posibles menores, años inválidos o ausentes', () => {
    expect(anioNacimientoPublico(1990, HOY)).toBe(1990);
    expect(anioNacimientoPublico('1990', HOY)).toBe(1990);
    expect(anioNacimientoPublico(2008, HOY)).toBeNull();
    expect(anioNacimientoPublico(2012, HOY)).toBeNull();
    expect(anioNacimientoPublico(null, HOY)).toBeNull();
    expect(anioNacimientoPublico('x', HOY)).toBeNull();
    expect(posibleMenor(null, HOY)).toBe(false);
  });
});

describe('vetarEnlaceFie: mismo criterio que la foto', () => {
  it('sin año conocido en el grupo, o con algún posible menor, no hay enlace', () => {
    expect(vetarEnlaceFie([null], HOY)).toBe(true);
    expect(vetarEnlaceFie([null, null], HOY)).toBe(true);
    expect(vetarEnlaceFie([1990, 2012], HOY)).toBe(true);
    expect(vetarEnlaceFie([1990], HOY)).toBe(false);
    expect(vetarEnlaceFie([null, 1990], HOY)).toBe(false);
  });
});

describe('el año de un posible menor no sale del servidor', () => {
  it('búsqueda (homónimos), favoritos y cabeceras', async () => {
    const t = entorno();
    t.persona(A, 'Ana Perez', 2012);
    t.persona(B, 'Ana Perez', 1990);
    t.persona(C, 'Ana Perez', null);
    const r = await buscarDeportistas(t.ctx, { nacionalidad: 'ESP' });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(Object.fromEntries(r.items.map((p) => [p.id, p.anioNacimiento]))).toEqual({ [A]: null, [B]: 1990, [C]: null });

    t.favorito(A, 2);
    t.favorito(B, 1);
    const f = await listarFavoritos(t.ctx, {});
    if (f.estado !== 'ok') throw new Error(f.estado);
    expect(Object.fromEntries(f.items.map((p) => [p.id, p.anioNacimiento]))).toEqual({ [A]: null, [B]: 1990 });

    const cab = await leerCabeceras(t.db, [A, B], { hoy: HOY });
    expect(cab.get(A)?.anioNacimiento).toBeNull();
    expect(cab.get(B)?.anioNacimiento).toBe(1990);
    // La ficha decide ella misma (enseña el año propio de un menor).
    expect((await leerCabeceras(t.db, [A], { sinFiltrar: true })).get(A)?.anioNacimiento).toBe(2012);
  });

  it('sugerencias de homónimos', async () => {
    const t = entorno();
    t.persona(A, 'Ana Perez', 2012);
    t.persona(B, 'Ana Perez', 1990);
    t.persona(C, 'Ana Perez', null);
    construirIndiceExplorar(t.sqlite);
    const s = await sugerirPersonas({ ...t.ctx, indiceExplorar: async () => true }, { q: 'ana perez' });
    if (s.estado !== 'ok') throw new Error(s.estado);
    expect(Object.fromEntries(s.items.map((p) => [p.id, p.anioNacimiento]))).toEqual({ [A]: null, [B]: 1990, [C]: null });
  });
});
