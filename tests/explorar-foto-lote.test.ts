import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leerFotoDeportista, MAX_MIEMBROS_FOTO } from '@/lib/sport/explorar/foto';
import {
  fotosResueltas, leerFotosDeportistas, MAX_FOTOS_POR_LOTE, MAX_RED_POR_LOTE,
} from '@/lib/sport/explorar/foto-lote';
import { olvidarFotosEnMemoria } from '@/lib/sport/explorar/fotos/cache';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { ERROR_NO_AUTENTICADO } from '@/lib/sport/explorar/contexto';
import { perfil } from './helpers/explorar';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const memorias: DatabaseSync[] = [];
afterEach(() => { memorias.splice(0).forEach((m) => m.close()); olvidarFotosEnMemoria(); });

function escenario(opciones: { autenticada?: boolean } = {}) {
  const memoria = new DatabaseSync(':memory:');
  memorias.push(memoria);
  memoria.exec(`
    CREATE TABLE sport_person(id TEXT PRIMARY KEY, merged_into_person_id TEXT, birth_year INTEGER);
    CREATE TABLE sport_external_id(person_id TEXT, scheme TEXT, scope_source TEXT, value TEXT, link_status TEXT);
  `);
  const dialecto = new SQLiteSyncDialect();
  const consultas: { sql: string; params: unknown[] }[] = [];
  const execute = async (consulta: SQL) => {
    const query = dialecto.sqlToQuery(consulta);
    consultas.push(query);
    return { rows: memoria.prepare(query.sql).all(...query.params as SQLInputValue[]) };
  };
  const ctx: ContextoExplorador = {
    db: { execute: execute as ContextoExplorador['db']['execute'] },
    perfil: async () => opciones.autenticada === false ? null : perfil(),
    esquema: async () => ({ identidad: true, referencias: true }),
    hoy: () => '2026-10-03',
    propietario: {
      atletasDeCuenta: async () => [], personasEnlazadas: async () => [], fichasFiePorAtleta: async () => [],
      evidencia: {
        esquema: async () => ({ identidad: true, referencias: true }),
        atletasPorLicencia: async () => [], fichasFie: async () => [], externos: async () => [],
        personas: async () => new Map(),
      },
    },
  };
  // La FIE sintética: cada ID tiene su retrato, salvo 999 (sin foto publicada).
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
    const id = Number(/(\d+)(?:\D*)$/.exec(String(url))?.[1] ?? 0);
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'image/jpeg', 'content-length': '2000' } });
    return Response.json({ id, countryCode: 'ESP', date: null, image: id === 999 ? null : `https://static.fie.org/portraits/${id}.jpg` });
  });
  return {
    ctx, consultas, fetch,
    persona(id: string, destino: string | null = null, anio: number | null = 1990) {
      memoria.prepare('INSERT INTO sport_person VALUES (?, ?, ?)').run(id, destino, anio);
    },
    externo(id: string, valor: string, estado = 'CONFIRMADO') {
      memoria.prepare('INSERT INTO sport_external_id VALUES (?, ?, ?, ?, ?)').run(id, 'fie_addr_id', 'fie', valor, estado);
    },
  };
}

/** Un mapa con todos los casos de `explorar-foto.test.ts`, numerados para poder pedirlos juntos. */
function catalogo(s: ReturnType<typeof escenario>) {
  const casos: Record<string, string> = {};
  let n = 1;
  const nuevo = (nombre: string) => { const id = uuid(n++); casos[nombre] = id; return id; };
  // Adulto canónico con su FIE.
  s.persona(nuevo('adulto')); s.externo(casos.adulto, '101');
  // Alias fundido en otro adulto; el ID FIE cuelga del alias.
  s.persona(nuevo('canonica')); s.persona(nuevo('alias'), casos.canonica); s.externo(casos.alias, '102');
  // Dos alias del mismo grupo pedidos a la vez comparten resolución.
  s.persona(nuevo('alias2'), casos.canonica);
  // Menor (2010), y un grupo con un menor fundido.
  s.persona(nuevo('menor'), null, 2010); s.externo(casos.menor, '103');
  s.persona(nuevo('adultoConMenor')); s.persona(nuevo('menorFundido'), casos.adultoConMenor, 2009);
  s.externo(casos.adultoConMenor, '104');
  // Sin año en ningún miembro.
  s.persona(nuevo('sinAnio'), null, null); s.externo(casos.sinAnio, '105');
  // Dos IDs FIE distintos en el grupo.
  s.persona(nuevo('dosIds')); s.externo(casos.dosIds, '106'); s.externo(casos.dosIds, '107');
  // El mismo ID confirmado en otra persona ajena.
  s.persona(nuevo('conflicto')); s.externo(casos.conflicto, '108');
  s.persona(nuevo('ajena')); s.externo(casos.ajena, '108');
  // Sólo propuesto, o valor no numérico.
  s.persona(nuevo('propuesto')); s.externo(casos.propuesto, '109', 'PROPUESTO');
  s.persona(nuevo('raro')); s.externo(casos.raro, '0110');
  // Sin foto publicada en la FIE.
  s.persona(nuevo('sinFoto')); s.externo(casos.sinFoto, '999');
  // Ciclo y cadena demasiado larga.
  const c1 = nuevo('ciclo'); const c2 = nuevo('ciclo2');
  s.persona(c1, c2); s.persona(c2, c1);
  const cadena = [nuevo('cadena'), uuid(900), uuid(901), uuid(902), uuid(903)];
  cadena.forEach((id, i) => s.persona(id, cadena[i + 1] ?? null));
  s.externo(cadena.at(-1)!, '111');
  // Grupo demasiado grande.
  s.persona(nuevo('grande')); s.externo(casos.grande, '112');
  for (let i = 0; i < MAX_MIEMBROS_FOTO; i++) s.persona(uuid(2000 + i), casos.grande);
  // Grupo con nietos dentro del límite.
  s.persona(nuevo('abuela')); s.persona(nuevo('hija'), casos.abuela); s.persona(nuevo('nieta'), casos.hija);
  s.externo(casos.nieta, '113');
  // No existe.
  nuevo('inexistente');
  return casos;
}

describe('fotos en lote: misma respuesta que una a una', () => {
  it('cada caso del lote coincide con la ruta individual', async () => {
    const s = escenario();
    const casos = catalogo(s);
    const ids = Object.values(casos);
    expect(ids.length).toBeLessThanOrEqual(MAX_FOTOS_POR_LOTE);

    const individual: Record<string, unknown> = {};
    for (const id of ids) individual[id] = await leerFotoDeportista(s.ctx, id, { fetch: s.fetch });
    const consultasIndividuales = s.consultas.length;
    olvidarFotosEnMemoria();
    s.consultas.length = 0;

    const lote = await leerFotosDeportistas(s.ctx, ids, { fetch: s.fetch });
    expect(lote.estado).toBe('ok');
    if (lote.estado !== 'ok') return;
    // Lo que va a la red está acotado: lo que no cabe sale pendiente y se pide aparte.
    const pendientes = ids.filter((id) => lote.fotos[id].estado === 'pendiente');
    for (const id of ids) {
      if (pendientes.includes(id)) continue;
      expect(lote.fotos[id], Object.keys(casos).find((k) => casos[k] === id)).toEqual(individual[id]);
    }
    expect(pendientes.every((id) => (individual[id] as { estado: string }).estado === 'publicada')).toBe(true);

    expect(lote.fotos[casos.adulto].estado).toBe('publicada');
    for (const nombre of ['menor', 'adultoConMenor', 'menorFundido', 'sinAnio', 'dosIds', 'conflicto', 'propuesto',
      'raro', 'sinFoto', 'ciclo', 'ciclo2', 'cadena', 'grande', 'inexistente']) {
      expect(lote.fotos[casos[nombre]], nombre).toEqual({ estado: 'foto_no_publicada' });
    }
    expect(lote.fotos[casos.alias]).toEqual(lote.fotos[casos.canonica]);
    expect(lote.fotos[casos.alias2]).toEqual(lote.fotos[casos.canonica]);

    expect(s.consultas.length).toBeLessThan(consultasIndividuales / 5);
    for (const c of s.consultas) {
      expect(c.sql).toMatch(/^\s*SELECT/);
      expect(c.params.length).toBeLessThanOrEqual(3);
    }
    expect(JSON.stringify(lote)).not.toMatch(/19\d\d|20[01]\d|birth|anio|00000000-0000-4000-8000-000000000[89]/);
  });

  it('lo habitual (canónicas sin fundidas) son cuatro consultas para toda la lista', async () => {
    const s = escenario();
    const ids = Array.from({ length: MAX_FOTOS_POR_LOTE }, (_, i) => uuid(i + 1));
    ids.forEach((id, i) => { s.persona(id); s.externo(id, String(500 + i)); });
    const lote = await leerFotosDeportistas(s.ctx, ids, { fetch: s.fetch });
    expect(s.consultas).toHaveLength(4);
    if (lote.estado !== 'ok') throw new Error(lote.estado);
    const estados = Object.values(lote.fotos).map((f) => f.estado);
    expect(estados.filter((e) => e === 'publicada')).toHaveLength(MAX_RED_POR_LOTE);
    expect(estados.filter((e) => e === 'pendiente')).toHaveLength(MAX_FOTOS_POR_LOTE - MAX_RED_POR_LOTE);
    // Dos peticiones a la FIE (GET y HEAD) por resolución nueva, y ninguna más.
    expect(s.fetch).toHaveBeenCalledTimes(2 * MAX_RED_POR_LOTE);

    // Con la memoria ya caliente, el siguiente lote resuelve las primeras sin red.
    s.fetch.mockClear();
    const segundo = await leerFotosDeportistas(s.ctx, ids, { fetch: s.fetch });
    if (segundo.estado !== 'ok') throw new Error(segundo.estado);
    expect(Object.values(segundo.fotos).filter((f) => f.estado === 'publicada')).toHaveLength(2 * MAX_RED_POR_LOTE);
    expect(s.fetch).toHaveBeenCalledTimes(2 * MAX_RED_POR_LOTE);
    expect(fotosResueltas(segundo)[ids[0]]).toMatchObject({ src: expect.stringContaining('static.fie.org') });
    expect(ids[MAX_FOTOS_POR_LOTE - 1] in fotosResueltas(segundo)).toBe(false);
  });

  it('entrada: sin sesión lanza; vacía, repetida en exceso o no UUID es inválida', async () => {
    await expect(leerFotosDeportistas(escenario({ autenticada: false }).ctx, [uuid(1)])).rejects.toThrow(ERROR_NO_AUTENTICADO);
    const s = escenario();
    for (const mala of [[], ['no-uuid'], [1], 'x', Array.from({ length: MAX_FOTOS_POR_LOTE + 1 }, (_, i) => uuid(i + 1))]) {
      expect(await leerFotosDeportistas(s.ctx, mala)).toEqual({ estado: 'entrada_invalida' });
    }
    expect(s.consultas).toHaveLength(0);
    expect(fotosResueltas({ estado: 'no_disponible' })).toEqual({});
  });
});
