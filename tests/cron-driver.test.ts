import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { crearAlmacenCronD1, type BaseCronD1, type SentenciaCronD1 } from '@/lib/cron/almacen-d1';

describe('driver perezoso para el Worker exterior', () => {
  it('no consulta hasta reclamar; recibe el binding explícito sin Neon', async () => {
    const all = vi.fn(async () => ({ success: true, results: [{ task: 'tarea' }] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind, all })) as unknown as BaseCronD1['prepare'];
    const almacen = await crearAlmacenCronD1({ prepare });
    expect(prepare).not.toHaveBeenCalled();
    expect(almacen.reclamar).toBeTypeOf('function');
    expect(almacen.cerrar).toBeTypeOf('function');
    expect(await almacen.reclamar({ tarea: '/api/cron/notify', minutoUtc: 10 })).toBe(true);
    expect(bind).toHaveBeenCalledWith('/api/cron/notify', 10);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('ejecuta las reservas y el cierre reales en SQLite sin repetir una franja', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`create table cron_execution (
      task text not null, scheduled_minute integer not null,
      status text not null default 'reclamada', finished_at integer,
      http_status integer, failure_code text,
      primary key (task, scheduled_minute)
    )`);
    const base: BaseCronD1 = {
      prepare(texto) {
        let valores: (string | number | null)[] = [];
        const sentencia: SentenciaCronD1 = {
          bind(...parametros) { valores = parametros; return sentencia; },
          async all<T>() {
            // ?1…?5 conserva el orden lógico aunque SET aparezca antes de WHERE.
            const parametros = Object.fromEntries(valores.map((valor, i) => [`?${i + 1}`, valor]));
            const filas = sqlite.prepare(texto).all(parametros);
            return { success: true, results: filas as T[] };
          },
        };
        return sentencia;
      },
    };
    try {
      const almacen = await crearAlmacenCronD1(base);
      const reserva = { tarea: '/api/cron/notify', minutoUtc: 200 };
      expect(await almacen.reclamar(reserva)).toBe(true);
      expect(await almacen.reclamar(reserva)).toBe(false);
      await almacen.cerrar(reserva, { estado: 'fallida', httpStatus: 503, motivo: 'http' });
      const fila = sqlite.prepare('select status, http_status, failure_code, finished_at from cron_execution').get();
      expect(fila).toMatchObject({ status: 'fallida', http_status: 503, failure_code: 'http' });
      expect(typeof fila?.finished_at).toBe('number');
      expect(await almacen.reclamar(reserva)).toBe(false);
      await expect(almacen.cerrar(reserva, { estado: 'completada', httpStatus: 200, motivo: null }))
        .rejects.toThrow('No se pudo registrar el cierre');
    } finally {
      sqlite.close();
    }
  });

  it('falla cerrado sin binding o sin confirmación del driver', async () => {
    await expect(crearAlmacenCronD1(undefined as unknown as BaseCronD1)).rejects.toThrow('binding');
    const sentencia: SentenciaCronD1 = {
      bind() { return sentencia; },
      async all() { return { success: false, results: [] }; },
    };
    const almacen = await crearAlmacenCronD1({ prepare: () => sentencia });
    await expect(almacen.reclamar({ tarea: 'tarea', minutoUtc: 0 })).rejects.toThrow('confirmó');
  });
});
