import { afterEach, describe, expect, it, vi } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { leerFeedSiguiendo } from '@/lib/sport/explorar/seguidos';
import { crearContexto, perfil } from './helpers/explorar';

const CUENTA_X = '0000000a-0000-4000-8000-00000000000a';
const CUENTA_Y = '0000000b-0000-4000-8000-00000000000b';
const dialecto = new SQLiteSyncDialect();

function fila(cuenta: string) {
  return {
    id: `r-${cuenta}`, fechaOrden: '2026-09-01', umbral: '0000-00-00', fecha: '2026-09-01',
    puesto: 1, puestoLiteral: null, participantes: 10, personaId: `p-${cuenta}`, nombre: `Persona de ${cuenta}`,
    pais: 'ESP', pruebaId: 'c1', edicionId: 'e1', torneo: 'Copa', ciudad: null, paisEdicion: 'ESP',
    arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL', fuente: 'fie',
    ambitoEvento: null, circuitoEvento: null, fuenteEvento: null,
  };
}

function entorno() {
  const estado = { datos: 100 as number | null, seguidas: { [CUENTA_X]: 2, [CUENTA_Y]: 1 } as Record<string, number> };
  const feeds: string[] = [];
  const revisiones: string[] = [];
  const db: ContextoExplorador['db'] = {
    execute: (async (consulta: SQL) => {
      const { sql, params } = dialecto.sqlToQuery(consulta);
      const cuenta = String(params.find((p) => p === CUENTA_X || p === CUENTA_Y));
      if (/sport_capacity_ledger/.test(sql)) {
        revisiones.push(cuenta);
        const n = estado.seguidas[cuenta] ?? 0;
        return { rows: [{ datos: estado.datos, n, ultima: n * 1000, suma: n * 1000 }] };
      }
      if (/seguidas AS MATERIALIZED/.test(sql)) {
        feeds.push(cuenta);
        return { rows: [fila(cuenta)] };
      }
      return { rows: [] };
    }) as never,
  };
  const de = (cuenta: string): ContextoExplorador => ({
    ...crearContexto({ perfil: perfil({ profileId: cuenta }) }).ctx, db,
  });
  return { estado, feeds, revisiones, de };
}

afterEach(() => vi.useRealTimers());

describe('feed «Siguiendo»: memo por cuenta en el isolate', () => {
  it('repetir la visita no relee el feed; otra cuenta nunca recibe el de la primera', async () => {
    const t = entorno();
    const a = await leerFeedSiguiendo(t.de(CUENTA_X), {});
    const b = await leerFeedSiguiendo(t.de(CUENTA_X), {});
    expect(b).toEqual(a);
    expect(t.feeds).toEqual([CUENTA_X]);
    expect(t.revisiones).toEqual([CUENTA_X, CUENTA_X]);

    const y = await leerFeedSiguiendo(t.de(CUENTA_Y), {});
    if (y.estado !== 'ok') throw new Error(y.estado);
    expect(y.items.map((i) => i.persona.id)).toEqual([`p-${CUENTA_Y}`]);
    expect(t.feeds).toEqual([CUENTA_X, CUENTA_Y]);
  });

  it('seguir o dejar de seguir, o datos nuevos, invalidan la entrada', async () => {
    const t = entorno();
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    t.estado.seguidas[CUENTA_X] = 3;
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    expect(t.feeds).toHaveLength(2);
    t.estado.datos = 101;
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    expect(t.feeds).toHaveLength(3);
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    expect(t.feeds).toHaveLength(3);
  });

  it('cada filtro y cada página tienen su entrada, y caducan al minuto', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t = entorno();
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    await leerFeedSiguiendo(t.de(CUENTA_X), { soloMedallas: true });
    await leerFeedSiguiendo(t.de(CUENTA_X), { limite: 5 });
    expect(t.feeds).toHaveLength(3);
    vi.setSystemTime(Date.now() + 61_000);
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    expect(t.feeds).toHaveLength(4);
  });

  it('sin contador de escrituras no hay memo', async () => {
    const t = entorno();
    t.estado.datos = null;
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    await leerFeedSiguiendo(t.de(CUENTA_X), {});
    expect(t.feeds).toHaveLength(2);
  });
});
