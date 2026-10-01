import { describe, expect, it } from 'vitest';
import { codificarCursorFie } from '@/lib/ingest/backfill/cursor-fie';
import { unidadesDesdeCatalogo } from '@/lib/ingest/backfill/inventario-unidades';
import {
  planificarDesdeCobertura,
  type FilaPlan,
  type OpcionesPlan,
} from '@/lib/ingest/backfill/plan';
import { filaCatalogoFie, filaCatalogoSkermo, type FilaCatalogo } from '@/lib/ingest/sources/historico-indice';
import { docIdDeUrl } from '@/lib/ingest/sources/rfee-pdf/lectura';

const AHORA = new Date('2025-03-10T12:00:00.000Z');

const opciones = (extra: Partial<OpcionesPlan> = {}): OpcionesPlan => ({
  ahora: AHORA,
  categoriasAmpliadas: false,
  maxReleer: 10,
  maxIntentos: 3,
  horasEntreRelecturas: 12,
  ...extra,
});

const fila = (extra: Partial<FilaPlan> = {}): FilaPlan => ({
  source: 'fie',
  season: '2025',
  factKind: 'ranking',
  competitionKey: '100',
  status: 'completo',
  publishedTotal: 50,
  importedTotal: 50,
  attempts: 1,
  cursor: null,
  lastCheckedAt: new Date('2025-01-01T00:00:00.000Z'),
  lastError: null,
  sourceUrl: null,
  competitionDate: '2024-01-05',
  ...extra,
});

describe('fallos y cursores en el plan', () => {
  it('el error de metadata FIE (competitions) sigue siendo una unidad planificable y se retoma sin --unidad', () => {
    const r = planificarDesdeCobertura(
      [fila({ factKind: 'competitions', competitionKey: '7', status: 'error', attempts: 1, lastError: 'HTTP 503', competitionDate: null })],
      [],
      opciones(),
    );
    expect(r.tareas.map((t) => [t.clave, t.tipo, t.motivo])).toEqual([['fie|2025|7', 'fie_prueba', 'reintento_error']]);
  });

  it('el error de metadata agotado queda señalado, no reintentado', () => {
    const r = planificarDesdeCobertura(
      [fila({ factKind: 'competitions', competitionKey: '7', status: 'error', attempts: 3, lastError: 'HTTP 503', competitionDate: null })],
      [],
      opciones(),
    );
    expect(r.tareas).toHaveLength(0);
    expect(r.omitidas.agotadas).toEqual(['fie|2025|7']);
  });

  it('un error de metadata antiguo no reabre una unidad cuyo ranking ya se leyó', () => {
    const r = planificarDesdeCobertura(
      [
        fila({ factKind: 'competitions', competitionKey: '7', status: 'error', attempts: 1, lastError: 'HTTP 503', competitionDate: null }),
        fila({ competitionKey: '7', status: 'completo', competitionDate: '2024-01-05' }),
      ],
      [],
      opciones(),
    );
    expect(r.tareas).toHaveLength(0);
    expect(r.omitidas.completas).toBe(1);
  });

  it('un error con cursor y los intentos agotados respeta max-intentos y conserva el cursor para un reintento explícito', () => {
    const cursor = codificarCursorFie({ fuente: 'fie', season: 2025, competitionId: 100, pageSize: 100, siguientePagina: 101, total: 10000 });
    const agotada = fila({ status: 'error', attempts: 3, cursor, lastError: 'HTTP 503' });
    const r = planificarDesdeCobertura([agotada], [], opciones());
    expect(r.tareas).toHaveLength(0);
    expect(r.omitidas.agotadas).toEqual(['fie|2025|100']);

    // Con más margen de intentos el mismo cursor se retoma desde donde estaba.
    const r2 = planificarDesdeCobertura([agotada], [], opciones({ maxIntentos: 6 }));
    expect(r2.tareas.map((t) => [t.motivo, t.datos?.cursor])).toEqual([['continuar', cursor]]);
  });

  it('un parcial exitoso con cursor continúa aunque se hayan gastado los intentos', () => {
    const cursor = codificarCursorFie({ fuente: 'fie', season: 2025, competitionId: 100, pageSize: 100, siguientePagina: 101, total: 10000 });
    const r = planificarDesdeCobertura([fila({ status: 'parcial', attempts: 9, cursor })], [], opciones());
    expect(r.tareas.map((t) => t.motivo)).toEqual(['continuar']);
  });
});

const catalogoSkermo = (): FilaCatalogo[] => {
  const base = {
    competitionId: '55',
    resultsUrl: 'https://app.skermo.org/resultados/55',
    documents: [
      { url: 'https://app.skermo.org/docs/aaa111.pdf', title: 'Resultados M10/M12' },
      { url: 'https://app.skermo.org/docs/bbb222.pdf', title: 'Otro documento' },
    ],
    externalUrls: [],
    liveLinks: [],
    name: 'Criterium',
    date: '2024-06-15',
    weapon: 'EPEE',
    gender: 'M',
    format: 'INDIVIDUAL',
    category: 'M15',
    categoryRaw: 'M15',
  } as unknown as Parameters<typeof filaCatalogoSkermo>[0];
  const sinId = { ...base, competitionId: null, resultsUrl: null, documents: [{ url: 'https://app.skermo.org/docs/ccc333.pdf', title: 'Sólo PDF' }] } as unknown as Parameters<typeof filaCatalogoSkermo>[0];
  return [
    filaCatalogoSkermo(base, { federacion: 'RFEE', temporada: '2023-2024', orden: 1 }),
    filaCatalogoSkermo(sinId, { federacion: 'RFEE', temporada: '2023-2024', orden: 2 }),
  ];
};

describe('unidadesDesdeCatalogo: inventario → unidades pendientes reales', () => {
  it('una fila Skermo con HTML y PDFs genera una unidad de prueba y una por documento, con URL y referencia original', () => {
    const unidades = unidadesDesdeCatalogo(catalogoSkermo());
    const html = unidades.filter((u) => u.fuente === 'skermo_rfee');
    expect(html.map((u) => u.competitionKey)).toEqual(['RFEE:55']);
    const pdf = unidades.filter((u) => u.fuente === 'rfee_pdf');
    expect(pdf.map((u) => [u.competitionKey, u.sourceUrl])).toEqual([
      [`doc:${docIdDeUrl('https://app.skermo.org/docs/aaa111.pdf')}`, 'https://app.skermo.org/docs/aaa111.pdf'],
      [`doc:${docIdDeUrl('https://app.skermo.org/docs/bbb222.pdf')}`, 'https://app.skermo.org/docs/bbb222.pdf'],
      [`doc:${docIdDeUrl('https://app.skermo.org/docs/ccc333.pdf')}`, 'https://app.skermo.org/docs/ccc333.pdf'],
    ]);
    // La referencia original es la de la fila del índice; el título de la fila no se impone a documentos con varias pruebas.
    expect(pdf[0].datos).toMatchObject({ refOriginal: 'skermo_rfee|2023-2024|RFEE:55', titulo: 'Criterium', indice: 1 });
    expect(pdf[2].datos).toMatchObject({ refOriginal: 'skermo_rfee|2023-2024|fila:RFEE:2', indice: 2 });
  });

  it('una prueba FIE del catálogo genera una unidad fie sin depender de cobertura de resultados previa', () => {
    const fie = filaCatalogoFie({
      competitionId: 1478,
      season: 2027,
      name: 'Gran Prix',
      type: 'I',
      category: 'S',
      federation: 'FIE',
      startDate: '2026-12-01',
      weapon: 'F',
      gender: 'M',
    });
    expect(fie).not.toBeNull();
    const unidades = unidadesDesdeCatalogo([fie!]);
    expect(unidades).toMatchObject([{ fuente: 'fie', season: '2027', competitionKey: '1478' }]);

    const plan = planificarDesdeCobertura([], unidades, opciones());
    expect(plan.tareas.map((t) => [t.clave, t.tipo, t.motivo])).toEqual([['fie|2027|1478', 'fie_prueba', 'nunca_leido']]);
  });

  it('el plan conserva URL y referencia de la unidad PDF y no repite las que ya tienen cobertura', () => {
    const unidades = unidadesDesdeCatalogo(catalogoSkermo());
    const docA = `doc:${docIdDeUrl('https://app.skermo.org/docs/aaa111.pdf')}`;
    const plan = planificarDesdeCobertura(
      [fila({ source: 'rfee_pdf', factKind: 'pdf', competitionKey: docA, season: '2023-2024', status: 'completo', competitionDate: null })],
      unidades,
      opciones(),
    );
    const pdfs = plan.tareas.filter((t) => t.tipo === 'pdf_documento');
    expect(pdfs.map((t) => t.competitionKey)).toEqual([
      `doc:${docIdDeUrl('https://app.skermo.org/docs/bbb222.pdf')}`,
      `doc:${docIdDeUrl('https://app.skermo.org/docs/ccc333.pdf')}`,
    ]);
    expect(pdfs[0].datos).toMatchObject({
      sourceUrl: 'https://app.skermo.org/docs/bbb222.pdf',
      refOriginal: 'skermo_rfee|2023-2024|RFEE:55',
    });
  });

  it('filtra por fuentes y temporadas pedidas', () => {
    const todo = catalogoSkermo();
    expect(unidadesDesdeCatalogo(todo, { fuentes: ['fie'] })).toEqual([]);
    expect(unidadesDesdeCatalogo(todo, { temporadas: ['2020-2021'] })).toEqual([]);
    expect(unidadesDesdeCatalogo(todo, { fuentes: ['rfee_pdf'] }).every((u) => u.fuente === 'rfee_pdf')).toBe(true);
  });
});
