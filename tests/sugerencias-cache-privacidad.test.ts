import { afterEach, describe, expect, it, vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { almacenMemoria } from '@/lib/cache/almacenes';
import { crearCache, type EventoCache } from '@/lib/cache/cache';
import { buscarDatoDeCuenta } from '@/lib/cache/privacidad';
import { normalizeSportName as normalizarNombre } from '@/lib/identity/resolver';
import { contextoPublico } from '@/lib/sport/explorar/contexto-publico';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { leerSugerenciasPublicas, sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { crearSugerenciasCompartidas } from '@/lib/sport/explorar/sugerencias-cache';
import { crearContexto, perfil, UUID_A as A, UUID_B as B, UUID_C as C } from './helpers/explorar';
import { construirIndiceExplorar } from './helpers/indice-explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const CUENTA_X = '0000000a-0000-4000-8000-00000000000a';
const CUENTA_Y = '0000000b-0000-4000-8000-00000000000b';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const dialecto = new SQLiteSyncDialect();

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const db = createD1Database(local.binding);
  const sentencias: string[] = [];
  const registrada: ContextoExplorador['db'] = {
    execute: ((consulta: SQL) => {
      sentencias.push(dialecto.sqlToQuery(consulta).sql);
      return db.execute(consulta);
    }) as never,
  };
  for (const cuenta of [CUENTA_X, CUENTA_Y]) {
    local.sqlite.prepare('INSERT INTO user_profile (id,email,full_name,ical_token) VALUES (?,?,?,?)')
      .run(cuenta, `${cuenta}@example.test`, 'Cuenta sintética', cuenta);
  }
  const persona = (id: string, nombre: string, anio: number | null = 1990) =>
    local.sqlite.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,merged_into_person_id,country_code,gender,birth_year)
      VALUES (?,?,?,NULL,'ESP','M',?)`).run(id, nombre, normalizarNombre(nombre), anio);
  const seguir = (cuenta: string, id: string) =>
    local.sqlite.prepare('INSERT INTO sport_favorite VALUES (?,?,?)').run(cuenta, id, 1);
  const base = { db: registrada, esquema: crearContexto().ctx.esquema, indiceExplorar: async () => true };
  const de = (cuenta: string): ContextoExplorador => ({
    ...crearContexto({ perfil: perfil({ profileId: cuenta }) }).ctx, ...base,
  });
  // El cargador compartido usa el contexto público: si leyera la sesión, fallaría.
  const publico = vi.fn((hoy: string) => ({
    ...contextoPublico(hoy, base),
    perfil: async () => { throw new Error('la parte pública no lee la sesión'); },
  }));
  const eventos: EventoCache[] = [];
  const almacen = almacenMemoria();
  const cache = crearCache({
    almacen: () => almacen,
    versiones: { de: async () => 'v1', olvidar() {} },
    esperar: () => {},
    registrar: (e) => eventos.push(e),
  });
  const publicas = crearSugerenciasCompartidas({ cache, publico });
  return { sqlite: local.sqlite, persona, seguir, de, publico, publicas, eventos, sentencias };
}

describe('sugerencias: parte pública compartida, «la sigues» por cuenta', () => {
  it('dos cuentas, misma consulta: una sola lectura pública y marcas distintas', async () => {
    const t = entorno();
    t.persona(A, 'Ana Perez');
    t.persona(B, 'Ana Perez Lopez');
    t.persona(C, 'Ana Perez', 2014);
    construirIndiceExplorar(t.sqlite);
    t.seguir(CUENTA_X, B);

    const x = await sugerirPersonas(t.de(CUENTA_X), { q: 'ana perez' }, { publicas: t.publicas });
    const antes = t.sentencias.length;
    const y = await sugerirPersonas(t.de(CUENTA_Y), { q: 'ana perez' }, { publicas: t.publicas });
    if (x.estado !== 'ok' || y.estado !== 'ok') throw new Error('sin sugerencias');

    expect(t.publico).toHaveBeenCalledTimes(1);
    expect(t.eventos.filter((e) => e.tipo === 'privado')).toEqual([]);
    expect(t.eventos.map((e) => e.tipo)).toEqual(['fallo', 'calculada', 'fresca']);
    // La segunda cuenta sólo lee lo suyo: ni el índice ni el resumen.
    const deY = t.sentencias.slice(antes);
    expect(deY).toHaveLength(1);
    expect(deY[0]).toMatch(/sport_favorite/);
    expect(deY[0]).not.toMatch(/explorar_token/);

    const marcas = (r: typeof x) => Object.fromEntries(r.items.map((i) => [i.id, i.seguida]));
    expect(marcas(x)).toEqual({ [A]: false, [B]: true, [C]: false });
    expect(marcas(y)).toEqual({ [A]: false, [B]: false, [C]: false });
    // Lo seguido va delante sólo para quien lo sigue; el resto del DTO es el mismo.
    expect(x.items[0].id).toBe(B);
    const sinMarca = (r: typeof x) => r.items.map(({ seguida: _s, ...i }) => i).sort((a, b) => a.id.localeCompare(b.id));
    expect(sinMarca(x)).toEqual(sinMarca(y));
    expect(x.items.find((i) => i.id === C)?.anioNacimiento).toBeNull();
  });

  it('lo guardado no lleva nada de la cuenta ni el año de un posible menor', async () => {
    const t = entorno();
    t.persona(A, 'Ana Perez');
    t.persona(C, 'Ana Perez', 2014);
    construirIndiceExplorar(t.sqlite);
    t.seguir(CUENTA_X, A);
    const valor = await leerSugerenciasPublicas(t.publico('2026-10-02'), 'ana perez');
    expect(buscarDatoDeCuenta(valor)).toBeNull();
    expect(JSON.stringify(valor)).not.toContain(CUENTA_X);
    expect(valor.candidatos.every((c) => !('seguida' in c))).toBe(true);
    expect(valor.candidatos.find((c) => c.id === C)?.anioNacimiento).toBeNull();
    expect(Object.keys(valor.resumen).sort()).toEqual([A, C].sort());
  });

  it('una seguida fuera de las 48 raíces públicas más populares sigue saliendo primero para quien la sigue', async () => {
    const t = entorno();
    for (let i = 1; i <= 60; i++) t.persona(uuid(i), `Ana Lopez ${String.fromCharCode(64 + (i % 26) + 1)}`);
    t.persona(A, 'Ana Lopez');
    construirIndiceExplorar(t.sqlite);
    t.sqlite.prepare('UPDATE explorar_persona SET peso = 100 WHERE id <> ?').run(A);
    t.sqlite.prepare('UPDATE explorar_persona SET peso = 0 WHERE id = ?').run(A);
    t.seguir(CUENTA_X, A);

    const x = await sugerirPersonas(t.de(CUENTA_X), { q: 'ana lopez', limite: 20 }, { publicas: t.publicas });
    const y = await sugerirPersonas(t.de(CUENTA_Y), { q: 'ana lopez', limite: 20 }, { publicas: t.publicas });
    if (x.estado !== 'ok' || y.estado !== 'ok') throw new Error('sin sugerencias');
    expect(x.items[0]).toMatchObject({ id: A, seguida: true });
    expect(y.items.some((i) => i.id === A)).toBe(false);
    expect(t.publico).toHaveBeenCalledTimes(1);
  });

  it('sin caché (o si devuelve null) lee la parte pública con el contexto de la petición', async () => {
    const t = entorno();
    t.persona(A, 'Ana Perez');
    construirIndiceExplorar(t.sqlite);
    t.seguir(CUENTA_Y, A);
    const r = await sugerirPersonas(t.de(CUENTA_Y), { q: 'ana perez' }, { publicas: async () => null });
    expect(r).toMatchObject({ estado: 'ok', items: [{ id: A, seguida: true }] });
    expect(t.publico).not.toHaveBeenCalled();
  });
});
