import { drizzle } from 'drizzle-orm/neon-http';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import type { Db } from '@/db';

vi.mock('@/db', () => ({ db: {} }));

import { escribirPublicacion } from '@/lib/ingest/ranking-oficial-db';
import type { FilaEntradaRanking } from '@/lib/ingest/ranking-oficial-persist';
import type { PublicacionRanking } from '@/lib/ingest/sources/ranking-oficial-historico';
import { leerRankingOficial } from '@/lib/sport/ranking-oficial-db';

/**
 * Cliente Neon HTTP CONTROLADO: registra el SQL y los parámetros que Drizzle
 * envía, separando lo que viaja en una transacción no interactiva
 * (`client.transaction`, lo que usa `db.batch`) de lo que sale suelto. No hay
 * PostgreSQL ni Neon: demuestra la orquestación y el orden del lote, no su
 * efecto real en la base.
 */
type Sentencia = { text: string; params: unknown[] };

function clienteControlado(
  opciones: {
    ultima?: { id: string; publishedOn: string };
    guardadas?: unknown[][];
    fallaTransaccion?: Error;
    filasLectura?: unknown[];
  } = {},
) {
  const sueltas: Sentencia[] = [];
  const transacciones: Sentencia[][] = [];

  const responder = (text: string): { rows: unknown[]; rowCount: number } => {
    let rows: unknown[] = [];
    if (/^select .*from "sport_ranking_publication"/i.test(text) && opciones.ultima) {
      rows = [[opciones.ultima.id, opciones.ultima.publishedOn]];
    } else if (/^select .*from "sport_ranking_entry"/i.test(text)) {
      rows = opciones.guardadas ?? [];
    } else if (/sport_ranking_publication/.test(text) && /jsonb_agg/.test(text)) {
      rows = opciones.filasLectura ?? [];
    } else if (/^update .*returning/i.test(text)) {
      rows = [['id']];
    }
    return { rows, rowCount: rows.length };
  };

  const cliente = Object.assign(
    (text: string, params: unknown[] = []) => {
      const sentencia: Sentencia = { text, params };
      return {
        sentencia,
        then: (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => {
          sueltas.push(sentencia);
          return Promise.resolve(responder(text)).then(ok, ko);
        },
      };
    },
    {
      transaction: async (consultas: { sentencia: Sentencia }[]) => {
        transacciones.push(consultas.map((c) => c.sentencia));
        if (opciones.fallaTransaccion) throw opciones.fallaTransaccion;
        return consultas.map((c) => responder(c.sentencia.text));
      },
    },
  );

  const db = drizzle(cliente as never, { schema }) as unknown as Db;
  return { db, sueltas, transacciones };
}

const escrituras = (s: Sentencia[]) => s.filter((x) => /^(insert|update|delete)/i.test(x.text));

const pub = (publicadoEl = '2026-05-10'): PublicacionRanking => ({
  fuente: 'skermo_ranking',
  season: '2025-2026',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M10',
  categoriaOriginal: 'M-10',
  formato: 'INDIVIDUAL',
  publicadoEl,
  url: 'https://example.test/ranking',
  total: 0,
  entradas: [],
});

const fila = (n: number, personId: string | null = null): FilaEntradaRanking => ({
  sourceRef: `ref-${n}`,
  personId,
  sourceName: `Tirador ${n}`,
  countryCode: 'ESP',
  position: n,
  points: '10.000',
});

const filas = (n: number) => Array.from({ length: n }, (_, i) => fila(i + 1));

const UUID = '11111111-1111-4111-8111-111111111111';

describe('escritura atómica de una publicación oficial', () => {
  it('nueva: cabecera y todos los lotes viajan en UNA transacción, con el UUID decidido antes', async () => {
    const { db, sueltas, transacciones } = clienteControlado();

    const r = await escribirPublicacion(db, pub(), filas(1200), UUID);

    expect(r).toEqual({ estado: 'creada', publicationId: UUID, personasIncorporadas: 0 });
    expect(transacciones).toHaveLength(1);
    const [lote] = transacciones;
    expect(lote).toHaveLength(4);
    expect(lote[0].text).toMatch(/^insert into "sport_ranking_publication"/);
    expect(lote[0].params).toContain(UUID);
    for (const entrada of lote.slice(1)) {
      expect(entrada.text).toMatch(/^insert into "sport_ranking_entry"/);
      expect(entrada.params).toContain(UUID);
    }
    // 500 + 500 + 200 filas de siete columnas (con la publicación).
    expect(lote.slice(1).map((e) => e.params.length)).toEqual([3500, 3500, 1400]);
    expect(escrituras(sueltas)).toEqual([]);
  });

  it('un lote de entradas que falla no deja cabecera ni escritura suelta ni borrado compensatorio', async () => {
    const { db, sueltas, transacciones } = clienteControlado({
      fallaTransaccion: new Error('lote 2 rechazado'),
    });

    await expect(escribirPublicacion(db, pub(), filas(1200), UUID)).rejects.toThrow('lote 2 rechazado');

    expect(transacciones).toHaveLength(1);
    expect(escrituras(sueltas)).toEqual([]);
    expect(sueltas.some((s) => /^delete/i.test(s.text))).toBe(false);
  });

  it('otra fecha de la misma temporada es una publicación nueva y no toca la anterior', async () => {
    const { db, sueltas, transacciones } = clienteControlado({
      ultima: { id: 'anterior', publishedOn: '2026-05-03' },
      guardadas: [['ref-1', null, 'Tirador 1', 'ESP', 1, '10.000']],
    });

    const r = await escribirPublicacion(db, pub('2026-05-10'), filas(3), UUID);

    expect(r.publicationId).toBe(UUID);
    expect(transacciones).toHaveLength(1);
    expect(transacciones[0].map((s) => s.text.split(' ').slice(0, 3).join(' '))).toEqual([
      'insert into "sport_ranking_publication"',
      'insert into "sport_ranking_entry"',
    ]);
    expect(transacciones[0].some((s) => s.params.includes('anterior'))).toBe(false);
    expect(escrituras(sueltas)).toEqual([]);
  });

  it('corrección del mismo día: cabecera, upsert de entradas y retirada de obsoletas en un solo lote, sólo de esa publicación', async () => {
    const { db, sueltas, transacciones } = clienteControlado({
      ultima: { id: 'hoy', publishedOn: '2026-05-10' },
      guardadas: [
        ['ref-1', null, 'Tirador 1', 'ESP', 1, '10.000'],
        ['ref-9', null, 'Tirador 9', 'ESP', 2, '9.000'],
      ],
    });

    const r = await escribirPublicacion(db, pub('2026-05-10'), filas(600), UUID);

    expect(r).toEqual({ estado: 'creada', publicationId: 'hoy', personasIncorporadas: 0 });
    expect(transacciones).toHaveLength(1);
    const [lote] = transacciones;
    expect(lote.map((s) => s.text.split(' ').slice(0, 3).join(' '))).toEqual([
      'update "sport_ranking_publication" set',
      'insert into "sport_ranking_entry"',
      'insert into "sport_ranking_entry"',
      'delete from "sport_ranking_entry"',
    ]);
    expect(lote[1].text).toMatch(/on conflict \("publication_id","source_ref"\) do update/);
    expect(lote[0].params).toContain('hoy');
    expect(lote[1].params).toContain('hoy');
    expect(lote[3].params[0]).toBe('hoy');
    expect(lote[3].text).toMatch(/"publication_id" = \$1 and "sport_ranking_entry"\."source_ref" not in/);
    expect(lote.some((s) => s.params.includes(UUID))).toBe(false);
    expect(escrituras(sueltas)).toEqual([]);
  });

  it('una corrección que falla no se completa por pasos: ninguna sentencia se confirma fuera del lote', async () => {
    const { db, sueltas } = clienteControlado({
      ultima: { id: 'hoy', publishedOn: '2026-05-10' },
      guardadas: [['ref-9', null, 'Tirador 9', 'ESP', 2, '9.000']],
      fallaTransaccion: new Error('violación'),
    });

    await expect(escribirPublicacion(db, pub('2026-05-10'), filas(5), UUID)).rejects.toThrow('violación');
    expect(escrituras(sueltas)).toEqual([]);
  });

  it('repetición idéntica: no crea publicación ni evolución; sólo adjunta personas nuevas en un lote', async () => {
    const guardadas = [
      ['ref-1', null, 'Tirador 1', 'ESP', 1, '10.000'],
      ['ref-2', null, 'Tirador 2', 'ESP', 2, '10.000'],
    ];
    const sinPersona = clienteControlado({ ultima: { id: 'hoy', publishedOn: '2026-05-10' }, guardadas });
    const igual = await escribirPublicacion(sinPersona.db, pub(), filas(2), UUID);
    expect(igual).toEqual({ estado: 'sin_cambios', publicationId: 'hoy', personasIncorporadas: 0 });
    expect(sinPersona.transacciones).toEqual([]);
    expect(escrituras(sinPersona.sueltas)).toEqual([]);

    const conPersona = clienteControlado({ ultima: { id: 'hoy', publishedOn: '2026-05-10' }, guardadas });
    const adjunta = await escribirPublicacion(
      conPersona.db,
      pub(),
      [fila(1, '22222222-2222-4222-8222-222222222222'), fila(2)],
      UUID,
    );
    expect(adjunta.estado).toBe('sin_cambios');
    expect(adjunta.personasIncorporadas).toBe(1);
    expect(conPersona.transacciones).toHaveLength(1);
    expect(conPersona.transacciones[0]).toHaveLength(1);
    expect(conPersona.transacciones[0][0].text).toMatch(/"person_id" is null/);
  });
});

describe('lectura consistente de una publicación oficial', () => {
  const cruda = {
    id: 'pub-1',
    source: 'skermo_ranking',
    season: '2025-2026',
    weapon: 'ESPADA',
    gender: 'M',
    category: 'M10',
    categoryRaw: 'M-10',
    format: 'INDIVIDUAL',
    publishedOn: '2026-05-10',
    publishedTotal: 2,
    sourceUrl: 'https://example.test/ranking',
    filas: [
      { sourceRef: 'ref-1', personId: null, sourceName: 'Tirador 1', countryCode: 'ESP', position: 1, points: '10.000' },
    ],
  };
  const filtro = { source: 'skermo_ranking', season: '2025-2026', weapon: 'ESPADA', gender: 'M' };

  function lectura(rows: unknown[]) {
    const sentencias: Sentencia[] = [];
    const db = {
      execute: async (consulta: unknown) => {
        sentencias.push(new PgDialect().sqlToQuery(consulta as never) as never);
        return { rows };
      },
    } as unknown as Db;
    return { db, sentencias };
  }

  it('cabecera y filas salen de UNA sentencia (un único snapshot), con temporada y modalidad exactas', async () => {
    const { db, sentencias } = lectura([cruda]);

    const r = await leerRankingOficial(db, filtro);

    expect(sentencias).toHaveLength(1);
    const { sql: texto, params } = sentencias[0] as unknown as { sql: string; params: unknown[] };
    expect(texto).toMatch(/FROM sport_ranking_publication/);
    expect(texto).toMatch(/FROM sport_ranking_entry/);
    expect(texto).toMatch(/season = \$2/);
    expect(params.slice(0, 5)).toEqual(['skermo_ranking', '2025-2026', 'ESPADA', 'M', 'INDIVIDUAL']);
    expect(r?.publicacion).toMatchObject({ id: 'pub-1', season: '2025-2026', format: 'INDIVIDUAL', category: 'M10' });
    expect(r?.publicacion).not.toHaveProperty('filas');
    expect(r?.filas).toEqual(cruda.filas);
  });

  it('sin publicación en esa temporada devuelve null, no otra temporada', async () => {
    const { db } = lectura([]);
    expect(await leerRankingOficial(db, { ...filtro, season: '2099-2100' })).toBeNull();
  });

  it('equipos y categoría literal se piden como filtros distintos y la página se acota', async () => {
    const { db, sentencias } = lectura([{ ...cruda, format: 'EQUIPOS', filas: '[]' }]);

    const r = await leerRankingOficial(
      db,
      { ...filtro, format: 'EQUIPOS', categoryRaw: 'M-10', hasta: '2026-06-01' },
      { limite: 9999, desde: 20 },
    );

    const { sql: texto, params } = sentencias[0] as unknown as { sql: string; params: unknown[] };
    expect(params).toEqual(
      expect.arrayContaining(['EQUIPOS', 'M-10', '2026-06-01', 500, 20]),
    );
    expect(texto).toMatch(/published_on <= \$/);
    expect(r?.publicacion.format).toBe('EQUIPOS');
    expect(r?.filas).toEqual([]);
  });
});
