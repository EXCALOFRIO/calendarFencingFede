import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CIERRE_NOCTURNO,
  ORDEN_NOCTURNO,
  PENDIENTE_MAX_MS,
  planInvalidacion,
  trasIngesta,
} from '../src/lib/ingest/tras-ingesta';
import { TAREAS_CRON } from '../src/lib/cron/programado';
import { despuesDePasada, FUENTE_RESULTADOS_AUTO } from '../src/lib/ingest/resultados-auto/runtime';
import type { ResumenResultadosAuto } from '../src/lib/ingest/resultados-auto/ejecutar';
import { dependenciasDeFuente } from '../src/lib/cache/invalidar';
import type { DbAvisos } from '../src/lib/notificaciones/db';

const db = { execute: vi.fn() } as unknown as DbAvisos;
const silencio = { warn: vi.fn() };
const resumenNotificar = { eventos: 3, avisos: 2, push: { enviadas: 1 } };

function pasada(parcial: Partial<ResumenResultadosAuto> = {}): ResumenResultadosAuto {
  return {
    ok: true, status: 'ok', filas: 0, bytesLedger: 0, peticiones: 0, eventos: 0,
    unidades: { procesadas: 0, escritas: 0, sinCambios: 0, esperando: 0, revision: 0, errores: 0, descubiertas: 0 },
    ia: { llamadas: 0, neuronas: 0, aceptadas: 0 }, detalle: [], ...parcial,
  };
}

afterEach(() => { silencio.warn.mockReset(); });

describe('trasIngesta', () => {
  it('invalida la caché de la fuente y genera los avisos, en ese orden', async () => {
    const orden: string[] = [];
    const invalidar = vi.fn(async (f: string) => { orden.push(`invalidar:${f}`); });
    const notificar = vi.fn(async (d: DbAvisos) => { orden.push('notificar'); expect(d).toBe(db); return resumenNotificar; });
    const r = await trasIngesta('fie', { db, invalidar, notificar, registro: silencio });
    expect(orden).toEqual(['invalidar:fie', 'notificar']);
    expect(r).toEqual({ cache: 'ok', avisos: { estado: 'ok', eventos: 3, avisos: 2, push: 1 } });
  });

  it('una pasada sin cambios no sube la época de la caché, pero sí genera los avisos', async () => {
    const invalidar = vi.fn(async () => {});
    const notificar = vi.fn(async () => resumenNotificar);
    const r = await trasIngesta('rfee_wp', { db, invalidar, notificar, registro: silencio, resultado: { sinCambios: true } });
    expect(invalidar).not.toHaveBeenCalled();
    expect(notificar).toHaveBeenCalledOnce();
    expect(r.cache).toBe('sin_cambios');

    await trasIngesta('rfee_wp', { db, invalidar, notificar, registro: silencio, resultado: { sinCambios: false } });
    expect(invalidar).toHaveBeenCalledWith('rfee_wp');
  });

  it('un fallo de la caché no impide los avisos ni lanza', async () => {
    const notificar = vi.fn(async () => resumenNotificar);
    const r = await trasIngesta('fie', {
      db, notificar, registro: silencio, invalidar: async () => { throw new Error('D1_ERROR secreto@example.test'); },
    });
    expect(notificar).toHaveBeenCalledOnce();
    expect(r.cache).toBe('error');
    expect(r.avisos).toMatchObject({ estado: 'ok' });
    expect(JSON.stringify(silencio.warn.mock.calls)).not.toContain('secreto@example.test');
  });

  it('un fallo de los avisos no lanza ni filtra el mensaje', async () => {
    const r = await trasIngesta('skermo_rfee', {
      db, registro: silencio, invalidar: async () => {},
      notificar: async () => { throw new TypeError('SELECT email FROM user_profile WHERE persona@example.test'); },
    });
    expect(r).toEqual({ cache: 'ok', avisos: { estado: 'error' } });
    const texto = JSON.stringify([r, silencio.warn.mock.calls]);
    expect(texto).not.toContain('persona@example.test');
    expect(texto).toContain('TypeError');
  });

  it('sin las tablas de avisos degrada a «sin_tablas» sin registrar error', async () => {
    const r = await trasIngesta('fie', {
      db, registro: silencio, invalidar: async () => {},
      notificar: async () => { throw new Error('no such table: notificacion_evento'); },
    });
    expect(r.avisos).toEqual({ estado: 'sin_tablas' });
    expect(silencio.warn).not.toHaveBeenCalled();
  });
});

describe('después de una pasada de resultados automáticos', () => {
  it('no hace nada si la pasada no escribió', async () => {
    const invalidar = vi.fn(async () => {});
    const notificar = vi.fn(async () => resumenNotificar);
    for (const status of ['ok', 'ocupado', 'tope_diario', 'ledger_bajo']) {
      const r = await despuesDePasada(pasada({ status }), { db, invalidar, notificar });
      expect(r).not.toHaveProperty('tras');
    }
    expect(invalidar).not.toHaveBeenCalled();
    expect(notificar).not.toHaveBeenCalled();
  });

  it('con filas o eventos, aunque se cortara, avisa e invalida `deporte`', async () => {
    const invalidar = vi.fn(async () => {});
    const notificar = vi.fn(async () => resumenNotificar);
    const r1 = await despuesDePasada(pasada({ status: 'tiempo', filas: 40 }), { db, invalidar, notificar });
    const r2 = await despuesDePasada(pasada({ status: 'error', ok: false, eventos: 2 }), { db, invalidar, notificar });
    expect(r1.tras).toMatchObject({ cache: 'ok', avisos: { estado: 'ok' } });
    expect(r2).toMatchObject({ ok: false, status: 'error' });
    expect(invalidar).toHaveBeenCalledWith(FUENTE_RESULTADOS_AUTO);
    expect(notificar).toHaveBeenCalledTimes(2);
    expect(dependenciasDeFuente(FUENTE_RESULTADOS_AUTO)).toEqual(['deporte']);
  });

  it('un fallo de los avisos conserva el resumen de la pasada', async () => {
    const r = await despuesDePasada(pasada({ filas: 5 }), {
      db, registro: silencio, invalidar: async () => {}, notificar: async () => { throw new Error('x'); },
    });
    expect(r).toMatchObject({ ok: true, status: 'ok', filas: 5, tras: { avisos: { estado: 'error' } } });
  });
});

describe('cableado', () => {
  const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

  it('las dos rutas de runIngest llaman a trasIngesta después de runIngest', () => {
    for (const ruta of ['src/app/api/cron/ingest/[source]/route.ts', 'src/app/api/admin/ingest/route.ts']) {
      const texto = leer(ruta);
      expect(texto, ruta).toContain('await trasIngesta(source');
      expect(texto.indexOf('await runIngest('), ruta).toBeLessThan(texto.indexOf('await trasIngesta(source'));
    }
  });

  it('el cron pasa el resultado para no invalidar lo que no cambió', () => {
    expect(leer('src/app/api/cron/ingest/[source]/route.ts')).toContain('await trasIngesta(source, { resultado, cadena: !forzar })');
  });

  it('la pasada automática pasa por despuesDePasada', () => {
    expect(leer('src/lib/ingest/resultados-auto/runtime.ts')).toMatch(/return await despuesDePasada\(r, \{ db \}\)/);
  });

  it('las acciones de normativa y extracción invalidan el calendario', () => {
    const normativa = leer('src/app/(app)/admin/normativa/actions.ts');
    expect(normativa).toMatch(/async function revalidar\(deps: readonly Dependencia\[\] = \['calendario'\]\)/);
    expect(normativa).toContain("await invalidarCacheSinFallar(deps, 'normativa')");
    expect(normativa).not.toMatch(/^\s+revalidar\(/m);
    const extraccion = leer('src/app/(app)/admin/extraccion/actions.ts');
    expect(extraccion.match(/invalidarCacheSinFallar\(\['calendario'\], 'extraccion'\)/g)).toHaveLength(4);
    expect(leer('src/app/api/cron/extraer/route.ts')).toContain("invalidarCacheSinFallar(['calendario'], 'extraer')");
  });
});

describe('invalidarCacheSinFallar', () => {
  it('sin D1 no lanza', async () => {
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { invalidarCacheSinFallar } = await import('../src/lib/cache');
    await expect(invalidarCacheSinFallar(['calendario'], 'prueba')).resolves.toBeUndefined();
    registro.mockRestore();
  });
});

/** refresco_programado real (0012) sobre node:sqlite, con el `execute` que usan los módulos. */
function baseRefresco() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle-d1/0012_refresco_programado.sql', import.meta.url), 'utf8'));
  const dialecto = new SQLiteSyncDialect();
  const db = {
    async execute(query: SQL) {
      const q = dialecto.sqlToQuery(query);
      return { rows: sqlite.prepare(q.sql).all(...(q.params as (string | number | null)[])) };
    },
  } as unknown as DbAvisos;
  const pendientes = () =>
    sqlite.prepare(`SELECT clave FROM refresco_programado WHERE tarea = 'cache_pendiente' ORDER BY clave`).all().map((f) => f.clave);
  return { db, pendientes };
}

describe('una invalidación por familia y noche', () => {
  const notificar = async () => resumenNotificar;

  it('el orden de la cadena es el de TAREAS_CRON', () => {
    const rutas = Object.entries(TAREAS_CRON)
      .filter(([, ruta]) => ruta.startsWith('/api/cron/ingest/'))
      .sort(([a], [b]) => {
        const hora = (e: string) => { const [m, h] = e.split(' ').map(Number); return h * 60 + m; };
        return hora(a) - hora(b);
      })
      .map(([, ruta]) => ruta.replace('/api/cron/ingest/', ''));
    expect(rutas).toEqual([...ORDEN_NOCTURNO]);
    for (const cierre of Object.values(CIERRE_NOCTURNO)) expect(ORDEN_NOCTURNO).toContain(cierre);
  });

  it('plan: aplaza hasta el cierre de cada familia y entonces invalida lo pendiente', () => {
    const ahora = 1_000_000_000;
    expect(planInvalidacion('skermo_rfee', ['calendario', 'deporte'], new Map(), ahora)).toEqual({
      ahora: [], aplazar: ['calendario', 'deporte'], limpiar: [],
    });
    const pendientes = new Map([['calendario', ahora - 1000], ['deporte', ahora - 1000]] as const);
    expect(planInvalidacion('rfee_wp', [], pendientes, ahora)).toEqual({ ahora: ['calendario'], aplazar: [], limpiar: ['calendario'] });
    expect(planInvalidacion('fie_tiradores', ['ranking-fie', 'deporte'], pendientes, ahora)).toEqual({
      ahora: ['ranking-fie', 'deporte', 'calendario'], aplazar: [], limpiar: ['deporte', 'calendario'],
    });
  });

  it('plan: lo pendiente demasiado viejo se invalida en la siguiente pasada de la cadena', () => {
    const ahora = 10 * PENDIENTE_MAX_MS;
    const viejo = new Map([['calendario', ahora - PENDIENTE_MAX_MS - 1]] as const);
    expect(planInvalidacion('skermo_rfee', [], viejo, ahora).ahora).toEqual(['calendario']);
  });

  it('una noche entera sube cada época una sola vez, al cerrar su familia', async () => {
    const { db, pendientes } = baseRefresco();
    const familias: string[][] = [];
    const invalidarFamilias = vi.fn(async (d: readonly string[]) => { familias.push([...d].sort()); });
    const cambia = { sinCambios: false };
    const quieta = { sinCambios: true };
    const noche: [string, { sinCambios: boolean }][] = [
      ['skermo_rfee', cambia], ['fie', cambia], ['efc', quieta], ['skermo_regional', cambia],
      ['rfee_wp', quieta], ['skermo_ranking', quieta], ['fie_tiradores', quieta],
    ];
    const caches: string[] = [];
    for (const [fuente, resultado] of noche) {
      const r = await trasIngesta(fuente, { db, notificar, registro: silencio, resultado, cadena: true, invalidarFamilias });
      caches.push(r.cache);
    }
    expect(familias).toEqual([['calendario'], ['deporte']]);
    expect(caches).toEqual(['aplazada', 'aplazada', 'sin_cambios', 'aplazada', 'ok', 'sin_cambios', 'ok']);
    expect(pendientes()).toEqual([]);
  });

  it('sin cambios en toda la noche no se invalida nada', async () => {
    const { db } = baseRefresco();
    const invalidarFamilias = vi.fn(async () => {});
    for (const fuente of ORDEN_NOCTURNO) {
      await trasIngesta(fuente, { db, notificar, registro: silencio, resultado: { sinCambios: true }, cadena: true, invalidarFamilias });
    }
    expect(invalidarFamilias).not.toHaveBeenCalled();
  });

  it('si la invalidación falla, lo pendiente se conserva para la siguiente', async () => {
    const { db, pendientes } = baseRefresco();
    await trasIngesta('skermo_rfee', { db, notificar, registro: silencio, resultado: { sinCambios: false }, cadena: true, invalidarFamilias: async () => {} });
    const r = await trasIngesta('rfee_wp', {
      db, notificar, registro: silencio, resultado: { sinCambios: true }, cadena: true,
      invalidarFamilias: async () => { throw new Error('D1'); },
    });
    expect(r.cache).toBe('error');
    expect(pendientes()).toEqual(['calendario', 'deporte']);
  });

  it('sin la tabla, invalida en el acto como antes', async () => {
    const roto = { execute: async () => { throw new Error('no such table: refresco_programado'); } } as unknown as DbAvisos;
    const invalidarFamilias = vi.fn(async () => {});
    const r = await trasIngesta('skermo_rfee', { db: roto, notificar, registro: silencio, resultado: { sinCambios: false }, cadena: true, invalidarFamilias });
    expect(r.cache).toBe('ok');
    expect(invalidarFamilias).toHaveBeenCalledWith(['calendario', 'deporte']);
  });
});
