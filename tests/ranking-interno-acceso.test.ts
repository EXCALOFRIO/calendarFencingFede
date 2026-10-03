import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Autorización del ranking INTERNO (`ranking_snapshot` / `ranking_point`).
 *
 * No hay sesión ni base reales: `@/db` es un registrador que anota qué tablas
 * se consultan y con qué condiciones, y `auth.getSession` devuelve la
 * identidad que fije cada caso. Esto prueba la política y que ninguna
 * consulta interna se lanza sin autorización; NO sustituye a una prueba con
 * login real ni a un commit SQL en Neon.
 */

const h = vi.hoisted(() => {
  const state = {
    queue: [] as unknown[][],
    froms: [] as unknown[],
    wheres: [] as unknown[],
    session: null as null | { id: string; email: string; emailVerified?: boolean },
  };
  const cadena: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) => ok(state.queue.shift() ?? []);
        }
        if (prop === 'from') {
          return (t: unknown) => {
            state.froms.push(t);
            return cadena;
          };
        }
        if (prop === 'where') {
          return (w: unknown) => {
            state.wheres.push(w);
            return cadena;
          };
        }
        return () => cadena;
      },
    },
  );
  return { state, cadena };
});

vi.mock('@/db', () => ({
  db: {
    select: () => h.cadena,
    selectDistinct: () => h.cadena,
  },
}));
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => h.state.session
        ? { user: { ...h.state.session, emailVerified: h.state.session.emailVerified ?? true } }
        : null,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { rankingPoint, rankingSnapshot } from '@/db/schema';
import { getSessionProfile } from '@/lib/auth/session';
import { puestosDeRanking } from '@/app/(app)/tiradores/consultas';
import { getPruebasPropias, getPuestosDeTemporada, getPuntosPorPrueba } from '@/app/(app)/estado/consultas';
import { getRankingParaEvento } from '@/lib/queries/callups';
import {
  getAthleteBreakdown,
  getAthleteRankingHistory,
  getPuestosOficiales,
  getRankingOficialScreenData,
  getRankingScreenData,
  getRankingTable,
  listGroupsForAthlete,
  listRankingGroups,
} from '@/lib/queries/ranking';
import { armasInternas, puedeVerInterno } from '@/lib/ranking/acceso-interno';

const dialect = new SQLiteSyncDialect();
const grupo = { weapon: 'ESPADA', gender: 'M', category: 'ABS' } as const;

function tocaInterno() {
  return h.state.froms.some((t) => t === rankingSnapshot || t === rankingPoint);
}

beforeEach(() => {
  h.state.queue = [];
  h.state.froms = [];
  h.state.wheres = [];
  h.state.session = null;
});

describe('armasInternas: rol y arma', () => {
  it('admin recibe todas las armas', () => {
    expect(armasInternas({ role: 'admin', weapons: [] }).sort()).toEqual([
      'ESPADA',
      'FLORETE',
      'SABLE',
    ]);
  });

  it('coach recibe solo sus armas', () => {
    expect(armasInternas({ role: 'coach', weapons: ['FLORETE'] })).toEqual(['FLORETE']);
    expect(armasInternas({ role: 'coach', weapons: [] })).toEqual([]);
  });

  it('athlete y sin sesión no reciben nada, aunque lleven armas', () => {
    expect(armasInternas({ role: 'athlete', weapons: ['FLORETE', 'ESPADA'] })).toEqual([]);
    expect(armasInternas(null)).toEqual([]);
  });

  it('pedir otra arma no amplía el permiso', () => {
    const armas = armasInternas({ role: 'coach', weapons: ['FLORETE'] });
    expect(puedeVerInterno(armas, 'FLORETE')).toBe(true);
    expect(puedeVerInterno(armas, 'ESPADA')).toBe(false);
    expect(puedeVerInterno(armas, "FLORETE' OR 1=1")).toBe(false);
  });
});

describe('las consultas internas no tocan la base sin autorización', () => {
  it('pantalla de ranking: athlete (lista vacía) no consulta nada', async () => {
    const datos = await getRankingScreenData([]);
    expect(h.state.froms).toHaveLength(0);
    expect(datos).toEqual({ groups: [], tables: {}, cutoffs: {}, breakdowns: {} });
  });

  it('tabla, desglose, historial y grupos: coach de otra arma recibe vacío', async () => {
    const florete = ['FLORETE'] as const;
    expect((await getRankingTable(florete, grupo)).rows).toEqual([]);
    expect(await getAthleteBreakdown(florete, 'ath-1', grupo)).toBeNull();
    expect(await getAthleteRankingHistory(florete, 'ath-1', grupo)).toEqual([]);
    expect(h.state.froms).toHaveLength(0);
    h.state.queue = [];
    expect(await listGroupsForAthlete([], 'ath-1')).toEqual([]);
    expect(await listRankingGroups([])).toEqual([]);
    expect(h.state.froms).toHaveLength(0);
  });

  it('«Mi estado»: puestos y puntos internos de un athlete no se consultan', async () => {
    expect(await getPuestosDeTemporada([], ['ath-1'])).toEqual([]);
    expect(await getPuntosPorPrueba([], ['ath-1'])).toEqual({});
    expect(h.state.froms).toHaveLength(0);
  });

  it('listado de tiradores: sin armas no se lee el snapshot', async () => {
    expect((await puestosDeRanking([])).size).toBe(0);
    expect(h.state.froms).toHaveLength(0);
  });

  it('convocatoria: sin armas no se leen candidatos del snapshot', async () => {
    h.state.queue = [[{ id: 's1', label: '2026-27' }], [{ id: 'c1', weapon: 'ESPADA', gender: 'M', category: 'ABS', format: 'INDIVIDUAL' }]];
    const r = await getRankingParaEvento([], 'ev-1');
    expect(tocaInterno()).toBe(false);
    expect(r.pruebas.every((p) => p.candidatos === null)).toBe(true);
  });
});

describe('filtro por arma antes de leer', () => {
  function armasEnParametros(): string[] {
    return h.state.wheres.flatMap((w) =>
      dialect
        .sqlToQuery(w as never)
        .params.flatMap((p) => {
          if (typeof p !== 'string' || !p.startsWith('[')) return [p];
          return JSON.parse(p) as unknown[];
        })
        .filter((p) => ['FLORETE', 'ESPADA', 'SABLE'].includes(String(p)))
        .map(String),
    );
  }

  it('listado de grupos solo pregunta por las armas autorizadas', async () => {
    h.state.queue = [[{ id: 's1' }], [{ computedAt: new Date() }]];
    h.state.froms = [];
    h.state.wheres = [];
    await listRankingGroups(['FLORETE']);
    expect(armasEnParametros()).toEqual(['FLORETE']);
  });

  it('«Mi estado» pregunta por el snapshot solo con las armas autorizadas', async () => {
    h.state.queue = [[{ id: 's1' }], [{ computedAt: new Date() }], [], []];
    await getPuestosDeTemporada(['SABLE'], ['ath-1']);
    expect(armasEnParametros()).toContain('SABLE');
    expect(armasEnParametros()).not.toContain('FLORETE');
    expect(armasEnParametros()).not.toContain('ESPADA');
  });

  it('puntos por prueba se limitan al arma de la prueba', async () => {
    await getPuntosPorPrueba(['ESPADA'], ['ath-1']);
    expect(armasEnParametros()).toEqual(['ESPADA']);
  });

  it('listado de tiradores limita el snapshot al arma del coach', async () => {
    h.state.queue = [[{ computedAt: new Date() }], []];
    await puestosDeRanking(['FLORETE']);
    expect(armasEnParametros()).toEqual(['FLORETE']);
  });
});

describe('identidad: rol verificado y revocación por petición', () => {
  const fila = (extra: Record<string, unknown>) => ({
    profileId: 'p1',
    email: 'cuenta@example.test',
    fullName: 'Nombre cualquiera',
    role: 'athlete',
    clubId: null,
    clubName: null,
    icalToken: 't',
    authUserId: 'u1',
    inviteStatus: 'aceptada',
    ...extra,
  });

  it('un correo no verificado no puede reclamar ni leer un perfil administrador', async () => {
    h.state.session = { id: 'u1', email: 'cuenta@example.test', emailVerified: false };
    h.state.queue = [[fila({ role: 'admin' })]];
    expect(await getSessionProfile()).toBeNull();
    expect(h.state.froms).toHaveLength(0);
  });

  it('cuenta revocada: sin perfil y sin armas, aunque la sesión siga viva', async () => {
    h.state.session = { id: 'u1', email: 'cuenta@example.test' };
    h.state.queue = [[fila({ role: 'admin', inviteStatus: 'revocada' })]];
    const perfil = await getSessionProfile();
    expect(perfil).toBeNull();
    expect(armasInternas(perfil)).toEqual([]);
  });

  it('el mismo usuario pierde acceso en la siguiente petición al revocarse', async () => {
    h.state.session = { id: 'u1', email: 'cuenta@example.test' };
    h.state.queue = [[fila({ role: 'admin' })]];
    expect(armasInternas(await getSessionProfile())).toHaveLength(3);
    h.state.queue = [[fila({ role: 'admin', inviteStatus: 'revocada' })]];
    expect(armasInternas(await getSessionProfile())).toEqual([]);
  });

  it('un nombre literal («aleramalr») no concede administración', async () => {
    h.state.session = { id: 'u1', email: 'cuenta@example.test' };
    h.state.queue = [[fila({ fullName: 'aleramalr', role: 'athlete' })]];
    expect(armasInternas(await getSessionProfile())).toEqual([]);
  });

  it('el admin verificado por rol conserva todas las armas, con cualquier nombre', async () => {
    h.state.session = { id: 'u1', email: 'cuenta@example.test' };
    h.state.queue = [[fila({ fullName: 'Otro', role: 'admin' })]];
    expect(armasInternas(await getSessionProfile())).toHaveLength(3);
  });

  it('coach: solo las armas de profile_weapon', async () => {
    h.state.session = { id: 'u1', email: 'cuenta@example.test' };
    h.state.queue = [[fila({ role: 'coach' })], [{ weapon: 'FLORETE' }]];
    expect(armasInternas(await getSessionProfile())).toEqual(['FLORETE']);
  });
});

// Evita que el import de getPruebasPropias (oficial, sin datos internos) se
// considere no usado: se comprueba que sigue sin tocar el ranking interno.
describe('lo oficial no arrastra el interno', () => {
  it('el ranking oficial publicado se lee sin consultar ranking_snapshot ni ranking_point', async () => {
    h.state.queue = [[{ id: 's1' }], [{ id: 'o1', seasonLabel: '2026-2027', weapon: 'ESPADA', gender: 'M', category: 'ABS', position: 1, totalPoints: '10', nombre: 'X', club: null, nacimiento: null, athleteId: 'ath-1', sourceUrl: null, updatedAt: new Date() }]];
    const oficial = await getRankingOficialScreenData();
    await getPuestosOficiales(['ath-1']);
    expect(oficial.groups.length).toBeGreaterThan(0);
    expect(tocaInterno()).toBe(false);
  });

  it('getPruebasPropias no consulta ranking_snapshot ni ranking_point', async () => {
    await getPruebasPropias([]).catch(() => undefined);
    expect(tocaInterno()).toBe(false);
  });
});
