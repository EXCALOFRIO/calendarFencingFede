import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
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
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE event_competition(id TEXT PRIMARY KEY, competition_date TEXT);
        CREATE TABLE competition_registration(id TEXT PRIMARY KEY,
          event_competition_id TEXT REFERENCES event_competition(id), source TEXT);
      `);
      for (let i = 0; i < 10; i++) {
        sqlite.prepare("INSERT INTO event_competition VALUES (?,date('now',?))").run(
          `competition-${i}`, i < 7 ? '-1 day' : i === 7 ? '+0 days' : '+1 day',
        );
        sqlite.prepare('INSERT INTO competition_registration VALUES (?,?,?)')
          .run(`registration-${i}`, `competition-${i}`, 'fie');
      }
      sqlite.prepare("INSERT INTO competition_registration VALUES ('other-source','competition-0','other')").run();
      const consultas: string[] = [];
      const consultar = async (text: string) => {
        consultas.push(text);
        return sqlite.prepare(text).all();
      };
      const sinTabla = await contarReferenciasHistoricas(consultar);
      expect(sinTabla).toEqual({ tablaDisponible: false, inscripcionesFie: 10, inscripcionesFieHistoricas: 7, conReferencia: null, historicasSinReferencia: null });
      expect(consultas).toHaveLength(2);

      sqlite.exec('CREATE TABLE sport_registration_ref(registration_id TEXT REFERENCES competition_registration(id))');
      for (const i of [0, 7, 8, 9, 9]) {
        // Two references on the same inscription must not double its count.
        sqlite.prepare('INSERT INTO sport_registration_ref VALUES (?)').run(`registration-${i}`);
      }
      const conTabla = await contarReferenciasHistoricas(consultar);
      expect(conTabla).toEqual({ tablaDisponible: true, inscripcionesFie: 10, inscripcionesFieHistoricas: 7, conReferencia: 4, historicasSinReferencia: 6 });
      expect(consultas).toHaveLength(5);
      for (const text of consultas) {
        expect(text).toMatch(/^\s*select/i);
        expect(text).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
      }
    } finally {
      sqlite.close();
    }
  });
});
