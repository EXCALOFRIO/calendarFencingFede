import { describe, expect, it } from 'vitest';
import { descubrirCatalogo, type DepsDescubrimiento } from '@/lib/ingest/backfill/descubrimiento';
import type { DepsPersistenciaDescubrimiento } from '@/lib/ingest/backfill/descubrimiento-persist';
import { planificarDesdeCobertura, type FilaPlan } from '@/lib/ingest/backfill/plan';
import { AlmacenCobertura } from './helpers/almacen-cobertura';

/**
 * El filtro de fuentes limita qué se ejecuta, no qué se descubre: un índice global que se guarda
 * como completo ha de dejar sembradas TODAS sus unidades, y un filtro sólo de PDF necesita los
 * índices Skermo de los que salen. Almacén en memoria con el upsert real; simulación controlada.
 */

function persistenciaDe(almacen: AlmacenCobertura): DepsPersistenciaDescubrimiento {
  return {
    escribirCobertura: async (source, f) => almacen.escribir(source, f),
    sembrar: async (filas) => {
      for (const { source, fila } of filas) almacen.insertarSiNoExiste(source, { ...fila, status: 'pendiente' });
    },
    leerIndices: async () =>
      [...almacen.filas.values()]
        .filter((f) => f.factKind === 'index')
        .map((f) => ({
          source: f.source,
          season: f.season,
          competitionKey: f.competitionKey,
          status: f.status,
          publishedTotal: f.publishedTotal,
          importedTotal: f.importedTotal,
          cursor: f.cursor,
          sourceUrl: f.sourceUrl,
          lastError: f.lastError,
        })),
  };
}

function montar() {
  const almacen = new AlmacenCobertura();
  const peticionesSkermo: string[] = [];
  const peticionesFie: string[] = [];
  const deps = (): DepsDescubrimiento => ({
    fie: {
      json: async (url) => {
        peticionesFie.push(url);
        throw new Error('la FIE no debe leerse en estas pruebas');
      },
    },
    skermo: {
      indice: async (fed, t) => {
        peticionesSkermo.push(`${fed}:${t ?? ''}`);
        return `<html data-fed="${fed}"/>`;
      },
      temporadas: () => [{ value: '1', label: '2024-2025', selected: true }],
      parsear: (_html, fed) => ({
        rows: [
          {
            competitionId: fed === 'RFEE' ? '77' : '12',
            resultsUrl: `https://skermo.example/${fed}/resultados`,
            date: '2025-01-10',
            name: `Copa ${fed}`,
            weapon: 'FLORETE',
            gender: 'M',
            category: 'SENIOR',
            categoryRaw: 'Senior',
            format: 'INDIVIDUAL',
            city: null,
            country: null,
            documents: [{ title: 'Clasificación', url: `https://skermo.example/docs/${fed.toLowerCase()}.pdf` }],
            liveLinks: [],
            externalUrls: [],
          },
        ],
        rowsSeen: 1,
        mismatches: 0,
      }),
    },
    federaciones: () => [
      { codigo: 'RFEE', verificada: true },
      { codigo: 'AND', verificada: true },
    ],
    persistencia: persistenciaDe(almacen),
  });
  return { almacen, peticionesSkermo, peticionesFie, deps };
}

/** Filas que `leerFilas` entregaría al plan con `--fuentes`: el filtro de ejecución se aplica sobre lo guardado. */
const filasPlan = (almacen: AlmacenCobertura, fuentes: readonly string[] = []): FilaPlan[] =>
  [...almacen.filas.values()]
    .filter((f) => f.factKind !== 'index' && (!fuentes.length || fuentes.includes(f.source)))
    .map((f) => ({
      source: f.source,
      season: f.season,
      factKind: f.factKind,
      competitionKey: f.competitionKey,
      status: f.status as FilaPlan['status'],
      publishedTotal: f.publishedTotal,
      importedTotal: f.importedTotal,
      attempts: f.attempts,
      cursor: f.cursor,
      lastCheckedAt: f.lastCheckedAt,
      lastError: f.lastError,
      sourceUrl: f.sourceUrl,
      competitionDate: null,
    }));

const OPCIONES_PLAN = {
  ahora: new Date('2026-12-02T00:00:00Z'),
  categoriasAmpliadas: false,
  maxReleer: 10,
  maxIntentos: 3,
  horasEntreRelecturas: 24,
};

describe('el filtro de ejecución no recorta lo que un índice completo siembra', () => {
  it('skermo_rfee-only guarda el índice completo con sus PDF y una pasada posterior sin filtro los planifica', async () => {
    const { almacen, peticionesSkermo, deps } = montar();

    await descubrirCatalogo(deps(), { fuentes: ['skermo_rfee'] }, 10);

    expect(almacen.obtener('skermo_rfee', 'index', 'index:RFEE', '2024-2025')?.status).toBe('completo');
    expect(almacen.obtener('skermo_rfee', 'results', 'RFEE:77', '2024-2025')).toMatchObject({ status: 'pendiente', attempts: 0 });
    expect(almacen.obtener('rfee_pdf', 'pdf', 'doc:rfee', '2024-2025')).toMatchObject({ status: 'pendiente', attempts: 0 });
    // Skermo regional no estaba pedido: su índice no se lee.
    expect(almacen.obtener('skermo_regional', 'index', 'index:AND', '2024-2025')).toBeUndefined();

    // Pasada default/all: el índice RFEE ya está completo y no se vuelve a pedir, pero el PDF sigue planificado.
    peticionesSkermo.length = 0;
    await descubrirCatalogo(deps(), {}, 10);
    expect(peticionesSkermo.filter((p) => p === 'RFEE:2024-2025' || p === 'RFEE:1')).toEqual([]);

    const plan = planificarDesdeCobertura(filasPlan(almacen), [], OPCIONES_PLAN);
    const pdf = plan.tareas.find((t) => t.fuente === 'rfee_pdf');
    expect(pdf).toMatchObject({ tipo: 'pdf_documento', competitionKey: 'doc:rfee', motivo: 'nunca_leido' });
  });

  it('rfee_pdf-only descubre los índices Skermo padres, siembra los PDF y el plan ejecuta sólo esa fuente', async () => {
    const { almacen, deps } = montar();

    const r = await descubrirCatalogo(deps(), { fuentes: ['rfee_pdf'] }, 10);

    expect(r.peticiones).toBeGreaterThan(0);
    expect(almacen.obtener('rfee_pdf', 'pdf', 'doc:rfee', '2024-2025')).toMatchObject({ status: 'pendiente', attempts: 0 });
    expect(almacen.obtener('rfee_pdf', 'pdf', 'doc:and', '2024-2025')).toMatchObject({ status: 'pendiente', attempts: 0 });

    const plan = planificarDesdeCobertura(filasPlan(almacen, ['rfee_pdf']), [], OPCIONES_PLAN);
    expect(plan.tareas.map((t) => t.fuente).sort()).toEqual(['rfee_pdf', 'rfee_pdf']);
  });

  it('rfee_pdf-only no lee la FIE ni los índices cuando el tope de peticiones no deja margen', async () => {
    const { almacen, peticionesFie, deps } = montar();
    await descubrirCatalogo(deps(), { fuentes: ['rfee_pdf'] }, 0);
    expect(peticionesFie).toEqual([]);
    expect([...almacen.filas.values()]).toHaveLength(0);
  });
});
