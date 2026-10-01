import { describe, expect, it } from 'vitest';
import { codificarCursorFie } from '@/lib/ingest/backfill/cursor-fie';
import { planificarLote } from '@/lib/ingest/backfill/orquestador';
import {
  claveDeUnidad,
  planificarDesdeCobertura,
  resumenPorSerie,
  type FilaPlan,
  type OpcionesPlan,
  type UnidadDescubierta,
} from '@/lib/ingest/backfill/plan';

const AHORA = new Date('2025-03-10T12:00:00.000Z');

const opciones = (extra: Partial<OpcionesPlan> = {}): OpcionesPlan => ({
  ahora: AHORA,
  categoriasAmpliadas: false,
  maxReleer: 10,
  maxIntentos: 5,
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
  competitionDate: '2025-01-05',
  ...extra,
});

const motivos = (r: ReturnType<typeof planificarDesdeCobertura>) => r.tareas.map((t) => `${t.clave}:${t.motivo}`);

describe('planificarDesdeCobertura', () => {
  it('una unidad descubierta sin fila de cobertura es nunca_leido, con el tipo de su fuente', () => {
    const desc: UnidadDescubierta[] = [
      { fuente: 'fie', season: '2025', competitionKey: '7', sourceUrl: null },
      { fuente: 'skermo_rfee', season: '2023-2024', competitionKey: 'RFEE:55', sourceUrl: 'https://x' },
    ];
    const r = planificarDesdeCobertura([], desc, opciones());
    expect(r.tareas.map((t) => [t.clave, t.tipo, t.motivo])).toEqual([
      ['fie|2025|7', 'fie_prueba', 'nunca_leido'],
      ['skermo_rfee|2023-2024|RFEE:55', 'skermo_prueba', 'nunca_leido'],
    ]);
  });

  it('descubierta ya con fila no se vuelve a plantear como nunca leída', () => {
    const r = planificarDesdeCobertura(
      [fila({ competitionKey: '7', competitionDate: null })],
      [{ fuente: 'fie', season: '2025', competitionKey: '7', sourceUrl: null }],
      opciones(),
    );
    expect(r.tareas).toEqual([]);
  });

  it('error se reintenta; con los intentos agotados queda señalado, no oculto ni en bucle', () => {
    const r = planificarDesdeCobertura(
      [
        fila({ competitionKey: '1', status: 'error', lastError: 'HTTP 503', attempts: 2 }),
        fila({ competitionKey: '2', status: 'error', lastError: 'HTTP 503', attempts: 5 }),
      ],
      [],
      opciones(),
    );
    expect(motivos(r)).toEqual(['fie|2025|1:reintento_error']);
    expect(r.omitidas.agotadas).toEqual(['fie|2025|2']);
  });

  it('categorías M10/M12 sin soportar esperan a la migración y se releen sólo tras ampliarla', () => {
    const f = [
      fila({
        source: 'skermo_rfee',
        factKind: 'results',
        season: '2022-2023',
        competitionKey: 'RFEE:9',
        status: 'pendiente',
        lastError: 'La categoría «M-10» necesita la migración 0019 (M10/M12), sin aplicar',
        competitionDate: null,
      }),
    ];
    const sin = planificarDesdeCobertura(f, [], opciones({ categoriasAmpliadas: false }));
    expect(sin.tareas).toEqual([]);
    expect(sin.omitidas.esperaCategorias).toEqual(['skermo_rfee|2022-2023|RFEE:9']);
    const con = planificarDesdeCobertura(f, [], opciones({ categoriasAmpliadas: true }));
    expect(motivos(con)).toEqual(['skermo_rfee|2022-2023|RFEE:9:categorias_ampliadas']);
  });

  it('parcial con cursor de continuación FIE continúa en esa página y lo lleva en datos', () => {
    const cursor = codificarCursorFie({ fuente: 'fie', season: 2025, competitionId: 100, pageSize: 100, siguientePagina: 101, total: 10000 });
    const r = planificarDesdeCobertura([fila({ status: 'parcial', cursor })], [], opciones());
    expect(motivos(r)).toEqual(['fie|2025|100:continuar']);
    expect(r.tareas[0].datos).toMatchObject({ cursor });
  });

  it('un completo con cursor de continuación es inconsistente: continúa en vez de darse por bueno', () => {
    const cursor = codificarCursorFie({ fuente: 'fie', season: 2025, competitionId: 100, pageSize: 100, siguientePagina: 3, total: 1000 });
    const r = planificarDesdeCobertura([fila({ status: 'completo', cursor })], [], opciones());
    expect(motivos(r)).toEqual(['fie|2025|100:continuar']);
  });

  it('completo antiguo no se relee solo: completo no acredita frescura ni repara nada', () => {
    const r = planificarDesdeCobertura([fila({ status: 'completo', competitionDate: '2024-06-01' })], [], opciones());
    expect(r.tareas).toEqual([]);
    expect(r.omitidas.completas).toBe(1);
  });

  it('prueba reciente completa se revisita con cadencia: sí tras 12 h, no antes', () => {
    const vieja = fila({ competitionDate: '2025-03-09', lastCheckedAt: new Date('2025-03-09T00:00:00.000Z') });
    const reciente = fila({ competitionKey: '101', competitionDate: '2025-03-09', lastCheckedAt: new Date('2025-03-10T08:00:00.000Z') });
    const r = planificarDesdeCobertura([vieja, reciente], [], opciones());
    expect(motivos(r)).toEqual(['fie|2025|100:cadencia_reciente']);
  });

  it('--releer por clave o temporada, acotado por maxReleer; el resto se informa como diferido', () => {
    const filas = [1, 2, 3].map((n) => fila({ competitionKey: String(n), competitionDate: '2024-01-01' }));
    const porClave = planificarDesdeCobertura(filas, [], opciones({ releer: { claves: ['fie|2025|2'] } }));
    expect(motivos(porClave)).toEqual(['fie|2025|2:releer']);
    expect(porClave.tareas[0].releer).toBe(true);

    const porTemporada = planificarDesdeCobertura(filas, [], opciones({ releer: { temporadas: ['2025'] }, maxReleer: 2 }));
    expect(porTemporada.tareas).toHaveLength(2);
    expect(porTemporada.omitidas.releerDiferidas).toEqual(['fie|2025|3']);
  });

  it('conflicto va a revisión y nunca se reintenta automáticamente', () => {
    const r = planificarDesdeCobertura([fila({ status: 'conflicto', competitionDate: null })], [], opciones());
    expect(r.tareas).toEqual([]);
    expect(r.omitidas.enRevision).toEqual(['fie|2025|100']);
  });

  it('varias filas de hecho de la misma prueba dan una sola tarea, con el motivo más urgente', () => {
    const cursor = codificarCursorFie({ fuente: 'fie', season: 2025, competitionId: 100, pageSize: 100, siguientePagina: 2, total: 300 });
    const r = planificarDesdeCobertura(
      [
        fila({ factKind: 'ranking', status: 'parcial', cursor }),
        fila({ factKind: 'pools', status: 'error', lastError: 'HTTP 500' }),
        fila({ factKind: 'tableau', status: 'pendiente' }),
      ],
      [],
      opciones(),
    );
    expect(motivos(r)).toEqual(['fie|2025|100:continuar']);
  });

  it('las complementarias se planifican después de las primarias aunque su motivo sea más urgente', () => {
    const r = planificarDesdeCobertura(
      [
        fila({ source: 'engarde', factKind: 'results', competitionKey: 'org/1', status: 'error', lastError: 'HTTP 500', competitionDate: null }),
        fila({ competitionKey: '9', status: 'pendiente', competitionDate: null }),
      ],
      [],
      opciones(),
    );
    const ordenadas = planificarLote(r.tareas).tareas;
    expect(ordenadas.map((t) => [t.clave, t.fase])).toEqual([
      ['fie|2025|9', 'primaria'],
      ['engarde|2025|org/1', 'complementaria'],
    ]);
  });

  it('Engarde se agrupa por torneo: varias pruebas del mismo torneo son una unidad', () => {
    const r = planificarDesdeCobertura(
      ['org/evt/1', 'org/evt/2', 'org/otro/1'].map((k) =>
        fila({ source: 'engarde', factKind: 'results', competitionKey: k, status: 'pendiente', attempts: 0, lastCheckedAt: null, competitionDate: null, competitionId: 'c1' }),
      ),
      [],
      opciones(),
    );
    expect(r.tareas.map((t) => [t.clave, t.tipo])).toEqual([
      ['engarde|2025|org/evt', 'engarde_torneo'],
      ['engarde|2025|org/otro', 'engarde_torneo'],
    ]);
    expect(r.tareas[0].datos?.competitionId).toBe('c1');
  });

  it('PDF: sólo cuenta la fila de documento y su tarea lleva la URL', () => {
    const r = planificarDesdeCobertura(
      [
        fila({ source: 'rfee_pdf', factKind: 'pdf', competitionKey: 'doc:abc', status: 'error', lastError: 'El PDF pesa 99999999 bytes', sourceUrl: 'https://app.skermo.org/x/abc.pdf', competitionDate: null }),
        fila({ source: 'rfee_pdf', factKind: 'results', competitionKey: 'pdf:abc:K', status: 'completo', competitionDate: null }),
      ],
      [],
      opciones(),
    );
    expect(r.tareas.map((t) => [t.tipo, t.clave, t.datos?.sourceUrl])).toEqual([
      ['pdf_documento', 'rfee_pdf|2025|doc:abc', 'https://app.skermo.org/x/abc.pdf'],
    ]);
  });

  it('PDF parcial queda en revisión y sólo se relee con --releer explícito', () => {
    const f = fila({ source: 'rfee_pdf', factKind: 'pdf', competitionKey: 'doc:abc', status: 'parcial', competitionDate: null, attempts: 1 });
    const sin = planificarDesdeCobertura([f], [], opciones());
    expect(sin.tareas).toEqual([]);
    expect(sin.omitidas.enRevision).toEqual(['rfee_pdf|2025|doc:abc']);
    const con = planificarDesdeCobertura([f], [], opciones({ releer: { claves: ['rfee_pdf|2025|doc:abc'] } }));
    expect(motivos(con)).toEqual(['rfee_pdf|2025|doc:abc:releer']);
  });

  it('no planifica enlaces ni índices: no son unidades de lectura de resultados', () => {
    const r = planificarDesdeCobertura(
      [fila({ source: 'enlace', factKind: 'link', status: 'pendiente' }), fila({ factKind: 'index', competitionKey: 'index:FIE', status: 'pendiente' })],
      [],
      opciones(),
    );
    expect(r.tareas).toEqual([]);
  });

  it('claveDeUnidad coincide con la clave de tarea', () => {
    expect(claveDeUnidad({ fuente: 'fie', season: '2025', competitionKey: '1' })).toBe('fie|2025|1');
  });
});

describe('resumenPorSerie', () => {
  it('cuenta descubiertas e importadas por serie; el índice de serie no demuestra importación', () => {
    const r = resumenPorSerie(
      [
        { nombre: 'Jeux Olympiques Paris 2024', clave: 'fie|2024|1' },
        { nombre: 'Juegos Mediterráneos Orán 2022', clave: 'fie|2022|2' },
        { nombre: 'Campeonato del Mediterráneo 2024', clave: 'fie|2024|3' },
        { nombre: 'Copa del mundo', clave: 'fie|2024|4' },
        { nombre: 'Youth Olympic Games 2018', clave: 'fie|2018|5' },
      ],
      new Set(['fie|2024|1']),
    );
    expect(r.juegos_olimpicos).toEqual({ descubiertas: 1, importadas: 1 });
    expect(r.juegos_mediterraneos).toEqual({ descubiertas: 1, importadas: 0 });
    expect(r.campeonato_mediterraneo).toEqual({ descubiertas: 1, importadas: 0 });
    expect(r.sin_serie).toEqual({ descubiertas: 2, importadas: 0 });
  });
});
