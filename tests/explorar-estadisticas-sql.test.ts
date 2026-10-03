import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { sqlCobertura, sqlEstadisticas, sqlHistorial } from '@/lib/sport/explorar/ficha';
import { aDetalleEstadistico, type FilaAgregadoEstadistico } from '@/lib/sport/explorar/estadisticas';
import { tipoConProcedencia, TIPOS_FIE, TIPOS_SKERMO_SIN_REFINAR } from '@/lib/sport/explorar/estadisticas-tipo';
import { UUID_A, UUID_B } from './helpers/explorar';

const bases: DatabaseSync[] = [];
afterEach(() => bases.splice(0).forEach((db) => db.close()));

function fixture() {
  const db = new DatabaseSync(':memory:');
  bases.push(db);
  db.exec(`
    CREATE TABLE event(id TEXT PRIMARY KEY, source TEXT, circuit TEXT, canonical_event_id TEXT, scope TEXT);
    CREATE TABLE sport_edition(id TEXT PRIMARY KEY, source TEXT, event_id TEXT, name TEXT, start_date TEXT, city TEXT, country_code TEXT);
    CREATE TABLE sport_competition(id TEXT PRIMARY KEY, edition_id TEXT, event_competition_id TEXT,
      season TEXT, weapon TEXT, gender TEXT, category TEXT, category_raw TEXT, format TEXT,
      competition_date TEXT, source_url TEXT);
    CREATE TABLE sport_result(id TEXT PRIMARY KEY, competition_id TEXT, person_id TEXT, position INTEGER,
      position_raw TEXT, official_points TEXT, occurred_on TEXT, source TEXT, source_url TEXT, revised_at INTEGER);
    CREATE TABLE sport_import_coverage(competition_id TEXT, fact_kind TEXT, status TEXT);
  `);
  function agregar(id: string, opciones: {
    tipo?: string | null; fuente?: string; categoria?: string; raw?: string | null;
    temporada?: string; puesto?: number | null; literal?: string | null; formato?: string;
    persona?: string; equivalencia?: string | null; fecha?: string | null; titulo?: string;
    arma?: string; genero?: string; puntos?: string | null;
  } = {}) {
    const fecha = opciones.fecha === undefined ? '2026-03-01' : opciones.fecha;
    db.prepare('INSERT INTO event VALUES (?, ?, ?, NULL, ?)').run(id, opciones.fuente ?? 'fie', opciones.tipo ?? null, 'INTERNACIONAL');
    db.prepare('INSERT INTO sport_edition VALUES (?, ?, ?, ?, ?, NULL, NULL)').run(
      id, opciones.fuente ?? 'fie', id, opciones.titulo ?? 'Torneo documentado', fecha,
    );
    db.prepare('INSERT INTO sport_competition VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').run(
      id, id, opciones.equivalencia ?? null, opciones.temporada ?? '2026',
      opciones.arma ?? 'ESPADA', opciones.genero ?? 'F',
      opciones.categoria ?? 'ABS', opciones.raw === undefined ? 'Senior' : opciones.raw,
      opciones.formato ?? 'INDIVIDUAL', fecha,
    );
    db.prepare('INSERT INTO sport_result VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, id, opciones.persona ?? UUID_A, opciones.puesto === undefined ? 3 : opciones.puesto,
      opciones.literal ?? null, opciones.puntos ?? null, fecha, opciones.fuente ?? 'fie', `https://example.test/${id}`, 1_790_000_000_000,
    );
  }
  function ejecutar(consulta: SQL) {
    const q = new SQLiteSyncDialect().sqlToQuery(consulta);
    expect(q.sql).not.toMatch(/::|DISTINCT ON|DATE '|ILIKE|pg_catalog/);
    expect(q.params.length).toBeLessThanOrEqual(100);
    return db.prepare(q.sql).all(...q.params as SQLInputValue[]);
  }
  function detalle(ids: string[] = [UUID_A]) {
    return aDetalleEstadistico(ejecutar(sqlEstadisticas(ids)) as FilaAgregadoEstadistico[]);
  }
  return { db, agregar, ejecutar, detalle };
}

describe('estadísticas nativas SQLite y evidencia de tipo', () => {
  it('cubre cada tipo documentado sin deducir tipos por el nombre ni por la categoría', () => {
    const f = fixture();
    TIPOS_FIE.forEach((tipo, i) => f.agregar(`tipo-${i}`, { tipo }));
    f.agregar('desconocida', { titulo: 'CAMPEONATO DEL MUNDO GRAND PRIX', tipo: 'OTRO' });
    const d = f.detalle();
    expect(d.resumen.pruebas).toBe(TIPOS_FIE.length + 1);
    expect(d.porCategoria.map((r) => r.tipo)).toEqual(expect.arrayContaining([...TIPOS_FIE, null]));
    expect(tipoConProcedencia('fie', 'FIE_CIRCUITO')).toBeNull();
    expect(tipoConProcedencia('skermo_rfee', 'CTO_ESPANA')).toBeNull();
    expect(tipoConProcedencia('skermo_rfee', 'SEN_GP')).toBeNull();
    expect(tipoConProcedencia('skermo_rfee', 'LIGA_ORO')).toBeNull();
    expect(tipoConProcedencia('efc', 'CTO_EUROPA')).toBeNull();
    expect(tipoConProcedencia('skermo_rfee', 'TNR')).toBe('TNR');
  });

  it('separa campeonatos de España por categoría y mantiene los tramos literales de veteranos', () => {
    const f = fixture();
    f.agregar('senior', { tipo: 'CTO_ESPANA' });
    f.agregar('junior', { tipo: 'CTO_ESPANA', categoria: 'M20', raw: 'Junior' });
    f.agregar('vet40', { tipo: 'CTO_ESPANA', categoria: 'VET', raw: '+40' });
    f.agregar('vet50', { tipo: 'CTO_ESPANA', categoria: 'VET', raw: '+50' });
    f.agregar('hist12', { tipo: 'CTO_EUROPA', categoria: 'M12', raw: 'M-12' });
    expect(f.detalle().porCategoria.map((r) => r.categoria.raw)).toEqual(
      expect.arrayContaining(['Senior', 'Junior', '+40', '+50', 'M-12']),
    );
    expect(f.detalle().porCategoria).toHaveLength(5);
  });

  it('un circuito RFEE afinado por nombre queda desconocido; un tipo FIE vinculado conserva la evidencia', () => {
    const f = fixture();
    f.agregar('rfee', { fuente: 'skermo_rfee', tipo: 'CTO_ESPANA', titulo: 'CAMPEONATO DE ESPAÑA' });
    f.agregar('fie', { tipo: 'SEN_GP' });
    f.db.prepare('UPDATE event SET canonical_event_id = ? WHERE id = ?').run('fie', 'rfee');
    expect(f.detalle().porCategoria).toMatchObject([{ tipo: 'SEN_GP', pruebas: 2 }]);
  });

  it('conserva los demás tipos RFEE verificables y no atribuye tipo a una edición sin vínculo', () => {
    const f = fixture();
    TIPOS_SKERMO_SIN_REFINAR.forEach((tipo, i) => f.agregar(`rfee-${i}`, { tipo, fuente: 'skermo_rfee' }));
    f.agregar('sin-vinculo', { tipo: 'CTO_MUNDO', titulo: 'CAMPEONATO DEL MUNDO' });
    f.db.prepare('UPDATE sport_edition SET event_id = NULL WHERE id = ?').run('sin-vinculo');
    expect(f.detalle().porCategoria.map((c) => c.tipo)).toEqual(
      expect.arrayContaining([...TIPOS_SKERMO_SIN_REFINAR, null]),
    );
  });

  it('dos tipos oficiales incompatibles no se resuelven a favor del evento directo ni del canónico', () => {
    const f = fixture();
    f.agregar('directo', { tipo: 'SEN_WC' });
    f.agregar('canonico', { tipo: 'SEN_GP' });
    f.db.prepare('UPDATE event SET canonical_event_id = ? WHERE id = ?').run('canonico', 'directo');
    const d = f.detalle();
    expect(d.porCategoria.find((c) => c.tipo === null)?.pruebas).toBe(1);
    expect(d.porCategoria.some((c) => c.tipo === 'SEN_WC')).toBe(false);
    expect(f.ejecutar(sqlHistorial([UUID_A], {}, 25, null)).find((r) => r.id === 'directo')?.tipo).toBeNull();
  });

  it('conserva abandonos, fechas ausentes y cobertura parcial sin convertirlos en puesto cero', () => {
    const f = fixture();
    f.agregar('abandono', { puesto: null, literal: 'Abandono', fecha: null });
    f.agregar('victoria', { tipo: 'CTO_MUNDO', puesto: 1 });
    f.db.prepare('INSERT INTO sport_import_coverage VALUES (?, ?, ?)').run('abandono', 'results', 'parcial');
    const d = f.detalle();
    expect(d.resumen).toMatchObject({
      pruebas: 2, conPuesto: 1, sinPuesto: 1, sinFecha: 1, mejorPuesto: 1, victorias: 1, podios: 1,
    });
    expect(d.porCategoria.find((r) => r.tipo === null)?.mejorPuesto).toBeNull();
    const [conteo, lecturas] = sqlCobertura([UUID_A]);
    expect(f.ejecutar(conteo)).toMatchObject([{ resultados: 2, pruebas: 2, ediciones: 2 }]);
    expect(f.ejecutar(lecturas)).toMatchObject([{ estado: 'parcial', pruebas: 1 }]);
    const h = f.ejecutar(sqlHistorial([UUID_A], {}, 25, null));
    expect(h.find((r) => r.id === 'abandono')).toMatchObject({ puesto: null, puestoPublicado: 'Abandono', fecha: null, fechaOrden: '0001-01-01' });
  });

  it('deduplica hechos idénticos con equivalencia explícita, pero no torneos de igual nombre y fecha', () => {
    const f = fixture();
    f.agregar('fie-a', { tipo: 'SEN_WC', equivalencia: 'cal-a' });
    f.agregar('pdf-a', { tipo: 'SEN_WC', equivalencia: 'cal-a' });
    f.agregar('otra-prueba', { tipo: 'SEN_WC' });
    f.db.exec(`INSERT INTO sport_result SELECT 'duplicado', competition_id, person_id, position,
      position_raw, official_points, occurred_on, 'pdf', NULL, revised_at FROM sport_result WHERE id = 'fie-a'`);
    expect(f.detalle().resumen).toMatchObject({ pruebas: 2, conPuesto: 2, podios: 2 });
    expect(f.ejecutar(sqlCobertura([UUID_A])[0])).toMatchObject([{ resultados: 4, pruebas: 3 }]);
  });

  it('no elige un puesto ganador entre fuentes en conflicto, ni convierte un cero inválido en resultado', () => {
    const f = fixture();
    f.agregar('a', { equivalencia: 'cal-a', puesto: 1 });
    f.agregar('b', { equivalencia: 'cal-a', puesto: 9 });
    f.agregar('cero', { puesto: 0 });
    expect(f.detalle().resumen).toMatchObject({
      pruebas: 2, conflictos: 1, conPuesto: 0, sinPuesto: 2, mejorPuesto: null, victorias: 0, podios: 0,
    });
    expect(f.ejecutar(sqlHistorial([UUID_A], {}, 25, null)).find((r) => r.id === 'cero')?.puesto).toBeNull();
  });

  it('equivalencias explícitas con categoría literal nula mantienen un solo hecho aunque falte tipo en una fuente', () => {
    const f = fixture();
    f.agregar('fie', { tipo: 'CTO_MUNDO', raw: null, equivalencia: 'cal-a' });
    f.agregar('pdf', { fuente: 'rfee_pdf', raw: null, equivalencia: 'cal-a' });
    expect(f.detalle().resumen).toMatchObject({ pruebas: 1, conPuesto: 1, conflictos: 0 });
    expect(f.detalle().porCategoria).toMatchObject([
      { tipo: 'CTO_MUNDO', categoria: { codigo: 'ABS', raw: null }, pruebas: 1 },
    ]);
  });

  it('deduplicar exige idénticos hechos: no descarta discrepancias en literal, puntos o fecha', () => {
    const f = fixture();
    f.agregar('literal-a', { equivalencia: 'literal', puesto: null, literal: 'Abandono' });
    f.agregar('literal-b', { equivalencia: 'literal', puesto: null, literal: 'No presentada' });
    f.agregar('puntos-a', { equivalencia: 'puntos', puntos: '10.5' });
    f.agregar('puntos-b', { equivalencia: 'puntos', puntos: '20.5' });
    f.agregar('fecha-a', { equivalencia: 'fecha', fecha: '2026-02-01' });
    f.agregar('fecha-b', { equivalencia: 'fecha', fecha: '2026-03-01' });
    expect(f.detalle().resumen).toMatchObject({
      pruebas: 3, conPuesto: 0, sinPuesto: 3, conflictos: 3, sinFecha: 1, podios: 0,
    });
  });

  it('agrega sólo los IDs confirmados suministrados, excluye equipos y separa armas/géneros', () => {
    const f = fixture();
    f.agregar('a');
    f.agregar('b', { persona: UUID_B });
    f.agregar('equipo', { formato: 'EQUIPOS', persona: UUID_B, puesto: 1 });
    f.agregar('masculino', { genero: 'M' });
    f.agregar('florete', { arma: 'FLORETE' });
    expect(f.detalle().resumen.pruebas).toBe(3);
    expect(f.detalle([UUID_A, UUID_B]).resumen.pruebas).toBe(4);
    expect(f.detalle([UUID_A, UUID_B]).porCategoria).toHaveLength(3);
  });

  it('los grupos confirmados grandes usan un solo parámetro JSON y el grupo vacío no tiene historia', () => {
    const f = fixture();
    const ids = Array.from({ length: 150 }, (_, i) => `persona-${i}`);
    ids.forEach((persona, i) => f.agregar(`prueba-${i}`, { persona }));
    expect(f.detalle(ids).resumen.pruebas).toBe(150);
    expect(f.detalle([]).resumen).toMatchObject({ pruebas: 0, conPuesto: 0, mejorPuesto: null });
  });

  it('acota desgloses con centinela, sin recortar los totales ni descargar resultados individuales', () => {
    const f = fixture();
    for (let i = 0; i < 125; i++) {
      f.agregar(`fila-${i}`, { categoria: 'VET', raw: `tramo-${i}`, temporada: String(1900 + i) });
    }
    const rows = f.ejecutar(sqlEstadisticas([UUID_A])) as FilaAgregadoEstadistico[];
    const d = aDetalleEstadistico(rows);
    expect(d.resumen.pruebas).toBe(125);
    expect(d.porCategoria).toHaveLength(120);
    expect(d.porTemporada).toHaveLength(24);
    expect(d.categoriasRecortadas).toBe(true);
    expect(d.temporadasRecortadas).toBe(true);
    expect(d.porTemporada[0].temporada).toBe('2001');
    expect(d.porTemporada.at(-1)?.temporada).toBe('2024');
    expect(rows.length).toBeLessThanOrEqual(1 + 1 + 121 + 25);
  });

  it('ejecuta el cursor de historial y sus filtros sobre una misma fila con fechas TEXT', () => {
    const f = fixture();
    f.agregar('00000000-0000-4000-8000-000000000003', { fecha: '2026-03-01', titulo: 'Open Madrid' });
    f.agregar('00000000-0000-4000-8000-000000000002', { fecha: '2026-02-01', titulo: 'Open Madrid' });
    f.agregar('00000000-0000-4000-8000-000000000001', { fecha: '2026-01-01', titulo: 'Open Madrid', temporada: '2025' });
    const rows = f.ejecutar(sqlHistorial([UUID_A], { temporada: '2026', torneo: 'open madrid', desde: '2026-01-01', hasta: '2026-12-31' }, 25, ['2026-03-01', '00000000-0000-4000-8000-000000000003']));
    expect(rows).toMatchObject([{ fecha: '2026-02-01', temporada: '2026' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].enlace).toContain('https://example.test/');
  });
});
