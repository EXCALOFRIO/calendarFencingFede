import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leerFotoDeportista, MAX_MIEMBROS_FOTO } from '@/lib/sport/explorar/foto';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { perfil, UUID_A, UUID_B, UUID_C } from './helpers/explorar';

/**
 * Ejecuta SQLite real únicamente en :memory:, sin archivos ni D1/Neon.
 * El esquema sintético contiene sólo las columnas que lee esta función.
 */
const memorias: DatabaseSync[] = [];
afterEach(() => { memorias.splice(0).forEach((m) => m.close()); });

function escenario(opciones: { autenticada?: boolean; esquema?: boolean } = {}) {
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
    esquema: async () => ({ identidad: opciones.esquema !== false, referencias: true }),
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
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, opciones) =>
    opciones?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-type': 'image/jpeg', 'content-length': '2000' } })
      : Response.json({
        id: 123, countryCode: 'ESP', date: null, image: 'https://static.fie.org/portraits/sintetico.jpg',
        licenseNumber: 'no-debe-salir', biography: 'no-debe-salir',
      }));
  return {
    ctx, consultas, fetch,
    persona(id = UUID_A, destino: string | null = null, anio: number | null = 1990) {
      memoria.prepare('INSERT INTO sport_person VALUES (?, ?, ?)').run(id, destino, anio);
    },
    externo(id = UUID_A, valor = '123', estado = 'CONFIRMADO', esquema = 'fie_addr_id', fuente = 'fie') {
      memoria.prepare('INSERT INTO sport_external_id VALUES (?, ?, ?, ?, ?)').run(id, esquema, fuente, valor, estado);
    },
    leer(id: unknown = UUID_A) { return leerFotoDeportista(ctx, id, { fetch }); },
  };
}

describe('identidad exacta de retratos', () => {
  it('la canónica y un alias fundido leen la misma foto confirmada sin divulgar IDs privados ni payload', async () => {
    const s = escenario();
    s.persona();
    s.persona(UUID_B, UUID_A);
    s.externo(UUID_B);
    const resultado = await s.leer();
    expect(resultado.estado).toBe('publicada');
    expect(await s.leer(UUID_B)).toEqual(resultado);
    expect(JSON.stringify(resultado)).not.toMatch(/no-debe-salir|profileId|email|athleteId|birth|biography|license|11111111|22222222/);
    for (const consulta of s.consultas) {
      expect(consulta.sql).toMatch(/^\s*SELECT/);
      expect(consulta.sql).not.toMatch(/display_name|alias|ILIKE|::uuid|INSERT|UPDATE/);
      expect(consulta.params.length).toBeLessThanOrEqual(3);
    }
  });

  it.each(['PROPUESTO', 'RECHAZADO'])('no adjudica foto a un candidato %s', async (estado) => {
    const s = escenario(); s.persona(); s.externo(UUID_A, '123', estado);
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['pdf_ref', 'fie_license', 'rfee_license'])('un identificador %s no vale aunque parezca numérico', async (esquema) => {
    const s = escenario(); s.persona(); s.externo(UUID_A, '123', 'CONFIRMADO', esquema);
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['p0001', '12x', '0', '-1', '00123', '123.0', '10000000000'])('no convierte %s en un FIE ID', async (valor) => {
    const s = escenario(); s.persona(); s.externo(UUID_A, valor);
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('ausencia de ID/persona y fuente distinta no tienen efecto de búsqueda por nombre', async () => {
    const s = escenario();
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    s.persona();
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    s.externo(UUID_A, '123', 'CONFIRMADO', 'fie_addr_id', 'skermo_rfee');
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('un homónimo de otro grupo no aporta su ID a la persona consultada', async () => {
    const s = escenario(); s.persona(); s.persona(UUID_B); s.externo(UUID_B);
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('dos IDs FIE confirmados en un mismo grupo bloquean la foto', async () => {
    const s = escenario(); s.persona(); s.persona(UUID_B, UUID_A);
    s.externo(); s.externo(UUID_B, '124');
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('un ID confirmado en un grupo ajeno también bloquea la foto', async () => {
    const s = escenario(); s.persona(); s.persona(UUID_B);
    s.externo(); s.externo(UUID_B);
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('repetir exactamente el mismo ID en el grupo no crea una ambigüedad artificial', async () => {
    const s = escenario(); s.persona(); s.persona(UUID_B, UUID_A);
    s.externo(); s.externo(UUID_B);
    expect((await s.leer()).estado).toBe('publicada');
  });

  it('ciclos y autorreferencias se detienen sin red', async () => {
    const s = escenario(); s.persona(UUID_A, UUID_B); s.persona(UUID_B, UUID_A); s.externo();
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.consultas).toHaveLength(2);
    const propia = escenario(); propia.persona(UUID_A, UUID_A); propia.externo();
    expect(await propia.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(propia.consultas).toHaveLength(1);
    expect(s.fetch).not.toHaveBeenCalled(); expect(propia.fetch).not.toHaveBeenCalled();
  });

  it('no elige foto si hay descendientes fuera de la profundidad confirmable', async () => {
    const s = escenario();
    const d = '44444444-4444-4444-8444-444444444444';
    const e = '55555555-5555-4555-8555-555555555555';
    s.persona(); s.persona(UUID_B, UUID_A); s.persona(UUID_C, UUID_B);
    s.persona(d, UUID_C); s.persona(e, d); s.externo();
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(await s.leer(e)).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('acota la anchura; un conflicto no puede quedar escondido tras el límite', async () => {
    const s = escenario(); s.persona(); s.externo();
    for (let i = 0; i < MAX_MIEMBROS_FOTO; i++) {
      s.persona(`aaaaaaaa-aaaa-4aaa-8aaa-${i.toString(16).padStart(12, '0')}`, UUID_A);
    }
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.consultas).toHaveLength(2);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each([2008, 2009, 2030])('minimiza posibles menores de año %s incluso invocando la API directamente', async (anio) => {
    const s = escenario(); s.persona(UUID_A, null, anio); s.externo();
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('también considera el año de un miembro fundido, no sólo el de la canónica', async () => {
    const s = escenario(); s.persona(); s.persona(UUID_B, UUID_A, 2010); s.externo();
    expect(await s.leer()).toEqual({ estado: 'foto_no_publicada' });
    expect(s.fetch).not.toHaveBeenCalled();
  });
});

describe('guardas y límites de entrada', () => {
  it('sesión nula/revocada no consulta ni valida entradas ni hace red', async () => {
    const s = escenario({ autenticada: false });
    await expect(s.leer('inválida')).rejects.toThrow('NO_AUTENTICADO');
    expect(s.consultas).toHaveLength(0); expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each([null, '', '../', 'p0001', '123', { id: UUID_A }, `${UUID_A}' OR 1=1`])(
    'ID de persona inválido no llega a SQLite: %j', async (id) => {
      const s = escenario();
      expect(await s.leer(id)).toEqual({ estado: 'entrada_invalida' });
      expect(s.consultas).toHaveLength(0); expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it('identidad deportiva no disponible no consulta las tablas', async () => {
    const s = escenario({ esquema: false });
    expect(await s.leer()).toEqual({ estado: 'no_disponible' });
    expect(s.consultas).toHaveLength(0);
  });
});
