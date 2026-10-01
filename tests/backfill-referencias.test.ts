import { describe, expect, it } from 'vitest';
import { contarReferenciasHistoricas, leerCoberturaAgregada, leerFilasPlan } from '@/lib/ingest/backfill/cobertura-db';
import {
  MAX_REESCRITURAS_POR_REFERENCIAS,
  clasificarHuellaInscritos,
  repartirReescrituras,
} from '@/lib/ingest/backfill/referencias';
import { huellaDeInscritos } from '@/lib/ingest/sources/fie';

const inscritos = [
  { nombre: 'A', equipo: 'ESP', licencia: null, inscritoEl: null, fieId: 1 },
  { nombre: 'B', equipo: 'ESP', licencia: null, inscritoEl: null, fieId: 2 },
] satisfies Parameters<typeof huellaDeInscritos>[0];

async function huellas(lista = inscritos) {
  return {
    sinRef: await huellaDeInscritos(lista, 'dest', false),
    conRef: await huellaDeInscritos(lista, 'dest', true),
  };
}

describe('clasificarHuellaInscritos (migración 0018)', () => {
  it('lista nunca leída: sin huella guardada', async () => {
    const h = await huellas();
    expect(clasificarHuellaInscritos({ guardada: null, ...h, conReferencias: true })).toBe('sin_huella');
  });

  it('tras 0018, una lista guardada con huella antigua y mismo contenido fuerza UNA reescritura', async () => {
    const h = await huellas();
    expect(clasificarHuellaInscritos({ guardada: h.sinRef, ...h, conReferencias: true })).toBe('reescritura_por_referencias');
  });

  it('tras esa reescritura la huella nueva coincide: sin cambios, ya no se reescribe más', async () => {
    const h = await huellas();
    expect(clasificarHuellaInscritos({ guardada: h.conRef, ...h, conReferencias: true })).toBe('sin_cambios');
  });

  it('contenido distinto se cuenta aparte de la reescritura por referencias', async () => {
    const h = await huellas();
    const otra = await huellas([inscritos[0]] as typeof inscritos);
    expect(clasificarHuellaInscritos({ guardada: otra.sinRef, ...h, conReferencias: true })).toBe('contenido_cambiado');
  });

  it('sin la tabla de referencias nunca hay reescritura por referencias', async () => {
    const h = await huellas();
    expect(clasificarHuellaInscritos({ guardada: h.sinRef, ...h, conReferencias: false })).toBe('sin_cambios');
    expect(clasificarHuellaInscritos({ guardada: 'otra', ...h, conReferencias: false })).toBe('contenido_cambiado');
  });
});

describe('repartirReescrituras', () => {
  it('acota las reescrituras forzadas por 0018 y difiere el resto sin tocar los cambios de contenido', () => {
    const l = (n: number, clase: string) => ({ id: `${clase}${n}`, clase }) as { id: string; clase: Parameters<typeof repartirReescrituras>[0][number]['clase'] };
    const leidas = [l(1, 'reescritura_por_referencias'), l(2, 'contenido_cambiado'), l(3, 'reescritura_por_referencias'), l(4, 'reescritura_por_referencias'), l(5, 'sin_cambios')];
    const r = repartirReescrituras(leidas, 2);
    expect(r.escribir.map((x) => x.id)).toEqual(['reescritura_por_referencias1', 'contenido_cambiado2', 'reescritura_por_referencias3', 'sin_cambios5']);
    expect(r.diferidas.map((x) => x.id)).toEqual(['reescritura_por_referencias4']);
    expect(r.reescritas).toBe(2);
  });

  it('el límite por defecto es finito y conservador', () => {
    expect(MAX_REESCRITURAS_POR_REFERENCIAS).toBeGreaterThan(0);
    expect(MAX_REESCRITURAS_POR_REFERENCIAS).toBeLessThanOrEqual(100);
  });
});

describe('lecturas SQL de cobertura (sólo SELECT)', () => {
  it('leerFilasPlan convierte filas, avisa si truncó y valida filtros', async () => {
    const consultas: string[] = [];
    const filas = [
      { source: 'fie', season: '2025', fact_kind: 'ranking', competition_key: '1', status: 'parcial', published_total: '300', imported_total: 100, attempts: 2, cursor: null, last_checked_at: '2025-03-01T00:00:00Z', last_error: null, source_url: null, competition_date: '2025-02-01' },
      { source: 'fie', season: '2025', fact_kind: 'ranking', competition_key: '2', status: 'completo', published_total: null, imported_total: 0, attempts: 1, cursor: null, last_checked_at: null, last_error: null, source_url: null, competition_date: null },
    ];
    const r = await leerFilasPlan(async (t) => (consultas.push(t), filas), { limite: 1, fuentes: ['fie'], temporadas: ['2025'] });
    expect(r.truncado).toBe(true);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ publishedTotal: 300, importedTotal: 100, competitionDate: '2025-02-01' });
    expect(r.filas[0].lastCheckedAt?.toISOString()).toBe('2025-03-01T00:00:00.000Z');
    expect(consultas[0]).toMatch(/^\s*select/i);
    expect(consultas[0]).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
    await expect(leerFilasPlan(async () => [], { limite: 1, fuentes: ["fie'; drop table x; --"] })).rejects.toThrow();
    await expect(leerFilasPlan(async () => [], { limite: 1, temporadas: ['2025 or 1=1'] })).rejects.toThrow();
  });

  it('leerCoberturaAgregada mapea clase de cursor y consistencia', async () => {
    const r = await leerCoberturaAgregada(async () => [
      { source: 'fie', fact_kind: 'ranking', status: 'completo', clase_cursor: 'continuacion', consistente: false, n: 3, publicado: '30', importado: '20' },
      { source: 'rfee_pdf', fact_kind: 'tableau', status: 'sin_resultados', clase_cursor: 'no_publicado', consistente: true, n: 1, publicado: '0', importado: '0' },
    ]);
    expect(r[0]).toMatchObject({ claseCursor: 'continuacion', consistente: false, n: 3, publicado: 30, importado: 20 });
    expect(r[1]).toMatchObject({ claseCursor: 'no_publicado', consistente: true });
  });

  it('contarReferenciasHistoricas separa las históricas sin referencia y respeta la tabla ausente', async () => {
    const sinTabla = await contarReferenciasHistoricas(async (t) =>
      /to_regclass/.test(t) ? [{ ok: false }] : [{ total: 10, historicas: 7 }],
    );
    expect(sinTabla).toMatchObject({ tablaDisponible: false, inscripcionesFie: 10, inscripcionesFieHistoricas: 7, conReferencia: null, historicasSinReferencia: null });

    const conTabla = await contarReferenciasHistoricas(async (t) => {
      if (/to_regclass/.test(t)) return [{ ok: true }];
      if (/con_ref/.test(t)) return [{ con_ref: 4, hist_sin_ref: 6 }];
      return [{ total: 10, historicas: 7 }];
    });
    expect(conTabla).toMatchObject({ tablaDisponible: true, conReferencia: 4, historicasSinReferencia: 6 });
  });
});
