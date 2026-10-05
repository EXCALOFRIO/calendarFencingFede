import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hechosPrueba } from '@/lib/ingest/hechos/formato';
import { leerPruebaFie } from '@/lib/ingest/sources/fie-resultados';
import { asaltosPorPrioridad, convertirPrueba, urlCanonica } from '../scripts/indexado/fie-a-hechos';

type Fixture = { respuestas: Record<string, unknown> };
const cargar = (nombre: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/fie-resultados/${nombre}.json`, import.meta.url), 'utf8'));

function fetchDe(fx: Fixture, cambios: Record<string, (body: unknown) => unknown> = {}) {
  const mapa = new Map(Object.entries(fx.respuestas).map(([u, b]) => [urlCanonica(u), b]));
  return async (url: string) => {
    const clave = urlCanonica(url);
    if (!mapa.has(clave)) throw new Error('cache_miss');
    const body = structuredClone(mapa.get(clave));
    const cambio = Object.entries(cambios).find(([sufijo]) => clave.endsWith(sufijo))?.[1];
    return cambio ? cambio(body) : body;
  };
}

const opciones = { tamanoPagina: 24, sourceSha256: () => 'a'.repeat(64) };

describe('fie-a-hechos', () => {
  it('convierte una prueba individual con las mismas claves que la persistencia', async () => {
    const fx = cargar('paris-2024-246');
    const c = await convertirPrueba(2024, 246, fetchDe(fx), opciones);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const h = hechosPrueba.parse(c.hechos);
    const lectura = await leerPruebaFie(2024, 246, { fetchJson: fetchDe(fx) }, { tamanoPagina: 24 });

    expect(h.source).toBe('fie');
    expect(h.extractor).toBe('lector_fie');
    expect(h.competition.competitionKey).toBe('246');
    expect(h.edition.season).toBe('2024');
    expect(h.results).toHaveLength(lectura.ranking!.puestos.length);
    for (const r of h.results) {
      expect(r.factKey).toBe(r.fieId);
      expect(r.fieId).toMatch(/^\d+$/);
    }
    const asaltosLector = lectura.poules!.asaltos.length + lectura.cuadro!.asaltos.length;
    expect(h.bouts).toHaveLength(asaltosLector + c.prioridad);
    for (const b of h.bouts) expect(b.aRef < b.bRef).toBe(true);
    expect(h.status.results).toBe('completo');
  });

  it('en equipos usa team:<id> como clave y no asigna fieId ni asaltos', async () => {
    const c = await convertirPrueba(2024, 250, fetchDe(cargar('paris-2024-250-equipos')), opciones);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.hechos.competition.format).toBe('EQUIPOS');
    expect(c.hechos.results.length).toBeGreaterThan(0);
    for (const r of c.hechos.results) {
      expect(r.factKey).toMatch(/^team:\d+$/);
      expect(r.fieId).toBeNull();
    }
    expect(c.hechos.bouts).toHaveLength(0);
  });

  it('añade las victorias por prioridad con winner orientado al orden canónico', async () => {
    const tableau = {
      tableau: [{
        suiteTableId: 'A',
        rounds: {
          A8: [
            { fencer1: { id: 900, name: 'FIE 900', isWinner: false, score: 14 }, fencer2: { id: 1000, name: 'FIE 1000', isWinner: true, score: 14 } },
            { fencer1: { id: 901, name: 'FIE 901', isWinner: true, score: 5 }, fencer2: { id: 902, name: 'FIE 902', isWinner: false, score: 5, status: 'A' } },
            { fencer1: { id: 903, name: 'FIE 903', isWinner: true, score: 0 }, fencer2: { id: 904, name: 'FIE 904', isWinner: false, score: 0 } },
          ],
        },
      }],
    };
    const poules = {
      pools: [{
        poolId: 7,
        rows: [
          { fencerId: 50, name: 'FIE 50', matches: [null, { score: 4, v: true }] },
          { fencerId: 6, name: 'FIE 6', matches: [{ score: 4, v: false }, null] },
        ],
      }],
    };
    const r = asaltosPorPrioridad(poules, tableau);
    expect(r.ceroCero).toBe(1);
    // '1000' < '900' en orden de texto, igual que checkBout.
    expect(r.asaltos).toContainEqual(expect.objectContaining({ phase: 'TABLEAU', roundKey: 'A8', aRef: '1000', bRef: '900', scoreA: 14, scoreB: 14, winner: 'A' }));
    expect(r.asaltos).toContainEqual(expect.objectContaining({ phase: 'POULE', roundKey: 'P7', aRef: '50', bRef: '6', winner: 'A' }));
    expect(r.asaltos).toHaveLength(2);
  });

  it('descarta marcadores fuera de rango y marca la fase como parcial', async () => {
    const fx = cargar('paris-2024-246');
    const cambios = {
      '/results/tableau': (body: unknown) => {
        const t = body as { tableau: { rounds: Record<string, { fencer1?: { score?: number; isWinner?: boolean } | null; isBye?: boolean }[]> }[] };
        for (const cuadro of t.tableau) {
          for (const cruces of Object.values(cuadro.rounds)) {
            const c = cruces.find((x) => !x.isBye && x.fencer1?.isWinner === true && typeof x.fencer1.score === 'number');
            if (c) {
              c.fencer1!.score = 154;
              return t;
            }
          }
        }
        return t;
      },
    };
    const c = await convertirPrueba(2024, 246, fetchDe(fx, cambios), opciones);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.fueraDeRango).toBe(1);
    expect(c.hechos.status.tableau).toBe('parcial');
    expect(c.hechos.bouts.every((b) => b.scoreA <= 45 && b.scoreB <= 45)).toBe(true);
  });

  it('una metadata ausente es un error, no un fichero', async () => {
    const c = await convertirPrueba(2024, 9999, async () => { throw new Error('cache_miss'); }, opciones);
    expect(c).toMatchObject({ ok: false, codigo: 'metadata' });
  });
});
