import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { normalizeSportName as normalizarNombre } from '@/lib/identity/resolver';
import { buscarDeportistas, sqlBusqueda, sqlBusquedaIndexada } from '@/lib/sport/explorar/busqueda';
import { SENTENCIAS_INDICE } from '@/lib/sport/explorar/indice-sql';
import {
  clavesVariante, sqlCandidatosIndexados, sqlCandidatosSugerencias, sugerirPersonas, unionAcotada,
} from '@/lib/sport/explorar/sugerencias';
import { crearContexto, CLAVES_PRIVADAS, clavesDe } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const MIGRACION = readFileSync(new URL('../drizzle-d1/0004_indice_explorar.sql', import.meta.url), 'utf8')
  .replace(/--> statement-breakpoint/g, '');
const EDICION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRUEBA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const s = local.sqlite;
  s.exec(MIGRACION);
  const db = createD1Database(local.binding);
  const sinIndice = { ...crearContexto().ctx, db };
  const conIndice = { ...sinIndice, indiceExplorar: async () => true };
  s.prepare(`INSERT INTO sport_edition (id,source,season,tournament_key,name,start_date)
    VALUES (?,'fie','2026',?,'CAMPEONATO DE CÓRDOBA','2026-05-03')`).run(EDICION, EDICION);
  s.prepare(`INSERT INTO sport_competition (id,edition_id,source,season,competition_key,weapon,gender,category,category_raw,format,competition_date)
    VALUES (?,?,'fie','2026',?,'ESPADA','M','ABS','Senior','INDIVIDUAL','2026-05-03')`).run(PRUEBA, EDICION, PRUEBA);
  let resultados = 0;
  function persona(id: string, nombre: string, destino: string | null = null) {
    s.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,merged_into_person_id,country_code,gender,birth_year)
      VALUES (?,?,?,?,'ESP','M',1998)`).run(id, nombre, normalizarNombre(nombre), destino);
  }
  function alias(id: string, nombre: string) {
    s.prepare('INSERT INTO sport_person_alias (person_id,source,name_original,name_normalized) VALUES (?,?,?,?)')
      .run(id, 'sintetica', nombre, normalizarNombre(nombre));
  }
  function resultado(personaId: string, puesto = 5) {
    const id = `r-${++resultados}`;
    s.prepare(`INSERT INTO sport_result (id,competition_id,source,source_fact_key,person_id,source_name,source_country_code,position,content_hash)
      VALUES (?,?,'fie',?,?,'Nombre publicado','ESP',?,'hash')`).run(id, PRUEBA, id, personaId, puesto);
  }
  function reconstruir() {
    s.exec('BEGIN');
    for (const sentencia of SENTENCIAS_INDICE) s.exec(sentencia);
    s.exec('COMMIT');
  }
  function plan(consulta: SQL) {
    const q = new SQLiteSyncDialect().sqlToQuery(consulta);
    expect(q.params.length).toBeLessThanOrEqual(100);
    return s.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params as never[]).map((p) => String(p.detail));
  }
  return { ...local, db, sinIndice, conIndice, persona, alias, resultado, reconstruir, plan };
}

/** Términos por cadena de SELECT compuesto: D1 rechaza más de cinco. */
function maxTerminosCompuestos(texto: string): number {
  const limpio = texto.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');
  const pila = [1];
  let maximo = 1;
  const tokens = limpio.match(/\(|\)|\bUNION\s+ALL\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/gi) ?? [];
  for (const t of tokens) {
    if (t === '(') pila.push(1);
    else if (t === ')') pila.pop();
    else maximo = Math.max(maximo, ++pila[pila.length - 1]);
  }
  return maximo;
}

function poblar(t: ReturnType<typeof entorno>) {
  const nombres = [
    'Carlos Llavador Fernández', 'Carlos Martínez Ruiz', 'María José García', 'José María Pérez',
    'Lucía Redondo Martín', 'Marta Martínez', 'Mario Garcés', 'Juan Pérez García', 'Juana Pérez',
    'Garcia Lopez Ana', 'Ma Lin', 'Martín Mas',
  ];
  nombres.forEach((nombre, i) => t.persona(uuid(i + 1), nombre));
  t.persona(uuid(50), 'Carlos Yavador', uuid(1));
  t.alias(uuid(50), 'CARLOS YAVADOR');
  t.alias(uuid(7), 'Mario Garcés Ortiz');
  t.persona(uuid(51), 'Marta Martinez', uuid(6));
  for (let i = 0; i < 5; i++) t.resultado(uuid(6), i + 1);
  for (let i = 0; i < 2; i++) t.resultado(uuid(2), 3);
  t.resultado(uuid(51), 1);
  t.resultado(uuid(1), 2);
}

async function paginas(ctx: Parameters<typeof buscarDeportistas>[0], entrada: Record<string, unknown>) {
  const salida: unknown[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await buscarDeportistas(ctx, { ...entrada, limite: 2, ...(cursor ? { cursor } : {}) });
    if (r.estado !== 'ok') throw new Error(r.estado);
    salida.push(r.items);
    if (!r.siguiente) return salida;
    cursor = r.siguiente;
  }
  throw new Error('demasiadas páginas');
}

const CONSULTAS = ['carlos', 'mar', 'ma', 'garcia', 'perez juan', 'yavador', 'martinez', 'zzz', 'ma lin', 'garces ortiz'];

describe('índice de palabras de Explorar (0004)', () => {
  it('la búsqueda indexada devuelve las mismas páginas que la búsqueda en vivo, también con altas posteriores', async () => {
    const t = entorno();
    poblar(t);
    t.reconstruir();
    for (const q of CONSULTAS) {
      expect(await paginas(t.conIndice, { q }), q).toEqual(await paginas(t.sinIndice, { q }));
      expect(await paginas(t.conIndice, { q, arma: 'ESPADA' }), q).toEqual(await paginas(t.sinIndice, { q, arma: 'ESPADA' }));
    }
    // Altas tras la reconstrucción: una persona, un alias sobre una indexada y
    // una persona nueva fundida en una indexada.
    t.persona(uuid(60), 'Carla Marín');
    t.alias(uuid(5), 'Lucía Zabala');
    t.persona(uuid(61), 'Zoe Garcíaz', uuid(9));
    t.alias(uuid(61), 'Zoe Garcíaz');
    for (const q of [...CONSULTAS, 'zabala', 'zoe', 'carla mar']) {
      expect(await paginas(t.conIndice, { q }), q).toEqual(await paginas(t.sinIndice, { q }));
    }
    expect((await paginas(t.conIndice, { q: 'zabala' })).flat()).toHaveLength(1);
    expect((await paginas(t.conIndice, { q: 'zoe' })).flat()).toHaveLength(1);
  });

  it('una sentencia por página, sin recorrer personas ni alias enteros', async () => {
    const t = entorno();
    poblar(t);
    t.reconstruir();
    const antes = t.calls.length;
    const r = await buscarDeportistas(t.conIndice, { q: 'martinez' });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items.map((p) => [p.nombre, p.resultadosImportados, p.armas, p.trayectoria.oros]))
      .toEqual([['Carlos Martínez Ruiz', 2, ['ESPADA'], 0], ['Marta Martínez', 6, ['ESPADA'], 2]]);
    expect(t.calls.length - antes).toBe(1);
    const planes = t.plan(sqlBusquedaIndexada({ q: 'garcia lopez' }, 24, null));
    expect(planes.some((d) => d.includes('explorar_token') || /SEARCH t USING PRIMARY KEY \(token>\? AND token<\?\)/.test(d))).toBe(true);
    expect(planes.filter((d) => /^SCAN (sport_person|sport_person_alias|explorar_token|explorar_persona)\b/.test(d))).toEqual([]);
  });

  it('sugerencias con índice: erratas, orden por resultados, alias del grupo, altas posteriores y fusiones nuevas', async () => {
    const t = entorno();
    poblar(t);
    t.reconstruir();
    const nombres = async (q: string) => {
      const r = await sugerirPersonas(t.conIndice, { q });
      if (r.estado !== 'ok') throw new Error(r.estado);
      expect(CLAVES_PRIVADAS.filter((k) => clavesDe(r).has(k))).toEqual([]);
      expect(r.items.every((i) => !('peso' in i))).toBe(true);
      return r.items.map((i) => i.nombre);
    };
    // «martnez» no empieza ninguna palabra: sólo la errata lo encuentra.
    expect(await nombres('martnez')).toEqual(['Marta Martínez', 'Carlos Martínez Ruiz']);
    expect(await nombres('carlos llavdor')).toEqual(['Carlos Llavador Fernández']);
    expect(await nombres('yavador carlos')).toEqual(['Carlos Llavador Fernández']);
    const r = await sugerirPersonas(t.conIndice, { q: 'yavador' });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items[0]).toMatchObject({ id: uuid(1), alias: 'CARLOS YAVADOR', resultados: 1, armas: ['ESPADA'] });

    t.persona(uuid(70), 'Martina Nueva');
    t.sqlite.prepare('UPDATE sport_person SET merged_into_person_id = ? WHERE id = ?').run(uuid(1), uuid(2));
    // «martin» queda a una errata: se sugiere, pero detrás del alta exacta.
    expect(await nombres('martina')).toEqual(['Martina Nueva', 'Lucía Redondo Martín', 'Martín Mas']);
    expect(await nombres('martinez')).toEqual(['Marta Martínez']);
    expect(t.calls.every((c) => c.parameters <= 100)).toBe(true);
  });

  it('sin índice sigue sugiriendo; y ninguna sentencia supera el límite de D1 de SELECT compuesto', async () => {
    const t = entorno();
    poblar(t);
    const r = await sugerirPersonas(t.sinIndice, { q: 'carlos llavador fernandez lopez' });
    expect(r.estado).toBe('ok');
    const dialecto = new SQLiteSyncDialect();
    const textos = [
      sqlCandidatosSugerencias('carlos llavador fernandez lopez'),
      sqlCandidatosIndexados('carlos llavador fernandez lopez'),
      sqlBusquedaIndexada({ q: 'garcia lopez', arma: 'ESPADA', temporada: '2026', ambito: 'NACIONAL' }, 24, null),
      sqlBusquedaIndexada({ q: 'garcia', nacionalidad: 'ESP' }, 24, ['garcia', uuid(1)]),
      sqlBusqueda({ q: 'garcia lopez' }, 24, null),
    ].map((s) => dialecto.sqlToQuery(s).sql);
    for (const texto of textos) expect(maxTerminosCompuestos(texto)).toBeLessThanOrEqual(5);
    const veinte = Array.from({ length: 20 }, (_, i) => sql`SELECT ${i} AS n`);
    expect(maxTerminosCompuestos(dialecto.sqlToQuery(sql.join(veinte, sql` UNION ALL `)).sql)).toBe(20);
    const anidada = dialecto.sqlToQuery(sql`SELECT count(*) AS n FROM (${unionAcotada(veinte)})`);
    expect(maxTerminosCompuestos(anidada.sql)).toBeLessThanOrEqual(5);
    expect(t.sqlite.prepare(anidada.sql).get(...anidada.params as never[])).toEqual({ n: 20 });
  });

  it('las claves de errata coinciden con las variantes que guarda la reconstrucción', () => {
    expect(clavesVariante('mar')).toEqual([]);
    expect(clavesVariante('lope')).toEqual(['lope']);
    expect(clavesVariante('lopez').sort()).toEqual(['lope', 'lopez', 'lopz', 'loez', 'lpez', 'opez'].sort());
    expect(clavesVariante('x'.repeat(25))).toEqual(['x'.repeat(24)]);
  });
});
