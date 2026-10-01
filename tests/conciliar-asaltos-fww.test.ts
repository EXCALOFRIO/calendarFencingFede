import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conciliarAsaltosFww } from '@/lib/ingest/conciliar-asaltos-fww';
import { estadoAsaltosPrimarios, type PruebaCanonica } from '@/lib/ingest/conciliar-complementario';
import type { CanonicaConPrimarios } from '@/lib/ingest/conciliar-torneo-engarde';
import { persistirAsaltosComplemento, type DepsAsaltosComplemento } from '@/lib/ingest/complementarios-persist';
import type { FilaCoberturaGenerica } from '@/lib/ingest/fie-resultados-db';
import type { FilaAsalto } from '@/lib/ingest/fie-resultados-persist';
import type { DepsEngarde } from '@/lib/ingest/sources/engarde';

const fixture = (n: string) => readFileSync(`tests/fixtures/complementarios/${n}`, 'utf8');
const BASE = 'https://www.fencingworldwide.com/en/926885-2025';
const POOLS1 = `${BASE}/pools/1`;
const DIRECT2 = `${BASE}/direct/2`;

const basel: PruebaCanonica = {
  fuente: 'fie',
  season: '2026',
  clave: 'b1',
  serie: null,
  nombreEdicion: 'World Cup of Switzerland',
  ciudad: 'Basel',
  fecha: '2026-01-02',
  arma: 'ESPADA',
  genero: 'M',
  categoria: 'M17',
  formato: 'INDIVIDUAL',
};
const canonica = (
  extra: Partial<PruebaCanonica> = {},
  primariosAsaltos?: CanonicaConPrimarios['primariosAsaltos'],
): CanonicaConPrimarios => ({
  competitionId: 'c-basel',
  prueba: { ...basel, ...extra },
  primarios: { estado: 'sin_resultados' },
  primariosAsaltos,
});

const depsCon = (r: Record<string, { status: number; body: string }>): Pick<DepsEngarde, 'get'> & { pedidas: string[] } => {
  const pedidas: string[] = [];
  return {
    pedidas,
    get: async (url) => {
      pedidas.push(url);
      return r[url] ?? { status: 404, body: '' };
    },
  };
};
const respuestas = {
  [POOLS1]: { status: 200, body: fixture('fww-basel-u17-pools1.html') },
  [DIRECT2]: { status: 200, body: fixture('fww-basel-u17-direct2.html') },
};
const escribe = { poules: 'no_publicado', cuadro: 'no_publicado' } as const;

describe('conciliarAsaltosFww', () => {
  it('lee los destinos exactos ofrecidos y planifica poules y cuadro por separado', async () => {
    const deps = depsCon(respuestas);
    const r = await conciliarAsaltosFww({ canonica: canonica({}, escribe), urls: { poules: [POOLS1], cuadro: [DIRECT2] } }, deps);
    expect(deps.pedidas).toEqual([POOLS1, DIRECT2]);
    expect(r.poules.plan).toMatchObject({ accion: 'escribir', fase: 'POULE' });
    expect(r.cuadro.plan).toMatchObject({ accion: 'escribir', fase: 'TABLEAU' });
    if (r.cuadro.plan.accion === 'escribir') {
      expect(r.cuadro.plan.asaltos.length).toBeGreaterThan(0);
      expect(r.cuadro.plan.asaltos.every((a) => a.url === DIRECT2 && a.refA.startsWith('fww:athlete:'))).toBe(true);
    }
    if (r.poules.plan.accion === 'escribir') {
      expect(r.poules.plan.asaltos.every((a) => a.url === POOLS1 && a.fase === 'POULE')).toBe(true);
    }
  });

  it('con la primaria desconocida o con cuadro publicado no escribe: difiere o no cambia', async () => {
    const r = await conciliarAsaltosFww(
      { canonica: canonica({}, { poules: 'desconocido', cuadro: 'publicado_completo' }), urls: { poules: [POOLS1], cuadro: [DIRECT2] } },
      depsCon(respuestas),
    );
    expect(r.poules.plan).toEqual({ accion: 'diferir', motivo: 'primaria_pendiente' });
    expect(r.cuadro.plan).toEqual({ accion: 'sin_cambios', motivo: 'primaria_publica' });
  });

  it('otra edición con la misma tupla deportiva va a revisión: no se escribe ningún asalto', async () => {
    const r = await conciliarAsaltosFww(
      { canonica: canonica({ nombreEdicion: 'Bari Grand Prix' }, escribe), urls: { poules: [POOLS1], cuadro: [DIRECT2] } },
      depsCon(respuestas),
    );
    expect(r.poules.plan).toEqual({ accion: 'revision', motivos: ['edicion_no_verificable'] });
    expect(r.cuadro.plan).toEqual({ accion: 'revision', motivos: ['edicion_no_verificable'] });
  });

  it('una prueba por equipos no produce asaltos aunque el destino exista', async () => {
    const r = await conciliarAsaltosFww(
      { canonica: canonica({ formato: 'EQUIPOS' }, escribe), urls: { poules: [POOLS1], cuadro: [] } },
      depsCon(respuestas),
    );
    expect(r.poules.plan.accion).toBe('rechazar');
  });

  it('destino 404, 500 o 200 sin contenido no acreditan nada y no escriben asaltos', async () => {
    const vacio = fixture('fww-basel-u17-pools1.html').replace(/<table[^>]*\bpool\b[\s\S]*<\/table>/, '');
    const pools2 = `${BASE}/pools/2`;
    const r404 = await conciliarAsaltosFww({ canonica: canonica({}, escribe), urls: { poules: [POOLS1], cuadro: [DIRECT2] } }, depsCon({}));
    expect(r404.poules.plan).toMatchObject({ accion: 'sin_hechos', estado: 'no_publicado' });
    const r500 = await conciliarAsaltosFww(
      { canonica: canonica({}, escribe), urls: { poules: [POOLS1], cuadro: [DIRECT2] } },
      depsCon({ [POOLS1]: { status: 500, body: '' }, [DIRECT2]: { status: 500, body: '' } }),
    );
    expect(r500.cuadro.plan).toMatchObject({ accion: 'sin_hechos', estado: 'error' });
    const r200 = await conciliarAsaltosFww(
      { canonica: canonica({}, escribe), urls: { poules: [pools2], cuadro: [] } },
      depsCon({ [pools2]: { status: 200, body: vacio } }),
    );
    expect(r200.poules.plan).toMatchObject({ accion: 'sin_hechos', estado: 'no_publicado' });
  });

  it('un results/ no se lee como si fuese poules ni cuadro', async () => {
    const deps = depsCon({ [`${BASE}/results/`]: { status: 200, body: fixture('fww-basel-u17-resultados.html') } });
    const r = await conciliarAsaltosFww({ canonica: canonica({}, escribe), urls: { poules: [`${BASE}/results/`], cuadro: [] } }, deps);
    expect(deps.pedidas).toEqual([]);
    expect(r.poules.plan).toMatchObject({ accion: 'sin_hechos', estado: 'no_publicado' });
  });

  it('caller + persistencia controlada: escribe asaltos y cobertura de cada fase y no confirma personas', async () => {
    const escritos: { source: string; filas: FilaAsalto[] }[] = [];
    const coberturas: FilaCoberturaGenerica[] = [];
    const deps: DepsAsaltosComplemento = {
      esquema: async () => ({ identidad: true, referencias: true }),
      upsertAsaltos: async (_id, source, filas) => {
        escritos.push({ source, filas });
        return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
      },
      upsertCobertura: async (_s, fila) => {
        coberturas.push(fila);
      },
    };
    const c = canonica({}, escribe);
    const r = await conciliarAsaltosFww({ canonica: c, urls: { poules: [POOLS1], cuadro: [DIRECT2] } }, depsCon(respuestas));
    for (const [fase, x] of [['POULE', r.poules], ['TABLEAU', r.cuadro]] as const) {
      await persistirAsaltosComplemento(deps, { competitionId: c.competitionId, prueba: c.prueba, candidato: x.candidato!, fase, plan: x.plan });
    }
    expect(escritos.map((e) => e.source)).toEqual(['fww', 'fww']);
    expect(escritos.every((e) => e.filas.length > 0 && e.filas.every((f) => f.fencerAPersonId === null && f.fencerBPersonId === null && f.fencerARef < f.fencerBRef))).toBe(true);
    expect(coberturas.map((f) => f.factKind)).toEqual(['pools', 'tableau']);
    expect(coberturas.every((f) => f.competitionKey === '926885-2025' && (f.status === 'completo' || f.status === 'parcial'))).toBe(true);
    const claves = escritos[0].filas.map((f) => `${f.phase}|${f.roundKey}|${f.fencerARef}|${f.fencerBRef}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('estadoAsaltosPrimarios', () => {
  const cob = (status: 'pendiente' | 'completo' | 'parcial' | 'sin_resultados' | 'error' | 'conflicto', extra: { publishedTotal?: number | null; cursor?: string | null } = {}) => ({
    status,
    publishedTotal: extra.publishedTotal ?? null,
    cursor: extra.cursor ?? null,
  });

  it('sin asaltos ni cobertura de ese hecho es desconocido, nunca «no publica»', () => {
    expect(estadoAsaltosPrimarios(0, [])).toBe('desconocido');
  });

  it('con asaltos de la primaria, completo o parcial según su cobertura', () => {
    expect(estadoAsaltosPrimarios(12, [cob('completo')])).toBe('publicado_completo');
    expect(estadoAsaltosPrimarios(12, [cob('parcial')])).toBe('publicado_parcial');
    expect(estadoAsaltosPrimarios(12, [])).toBe('publicado_parcial');
  });

  it('cero publicado, error, pendiente y no publicado explícito son estados distintos', () => {
    expect(estadoAsaltosPrimarios(0, [cob('sin_resultados')])).toBe('sin_resultados');
    expect(estadoAsaltosPrimarios(0, [cob('completo', { publishedTotal: 0 })])).toBe('sin_resultados');
    expect(estadoAsaltosPrimarios(0, [cob('error')])).toBe('error');
    expect(estadoAsaltosPrimarios(0, [cob('pendiente')])).toBe('pendiente');
    expect(estadoAsaltosPrimarios(0, [cob('pendiente', { cursor: 'no_publicado' })])).toBe('no_publicado');
  });
});
