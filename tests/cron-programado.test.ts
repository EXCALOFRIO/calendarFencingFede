import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAlmacenCronSql, type ConsultaCron, type BaseCronD1 } from '@/lib/cron/almacen-d1';
import {
  TAREAS_CRON,
  consumirRespuestaCron,
  crearManejadorProgramado,
  normalizarMinutoProgramado,
  type CierreCron,
  type ContextoCron,
  type EntornoCron,
  type ReservaCron,
} from '@/lib/cron/programado';

const entorno: EntornoCron = {
  DB: { prepare: vi.fn() } as BaseCronD1,
  CRON_SECRET: 'secreto-ficticio-de-pruebas',
  NEXT_PUBLIC_APP_URL: 'https://app.invalid///',
};
const instante = Date.UTC(2026, 9, 3, 3, 0);
const contexto = { waitUntil: vi.fn() };
const tareas = [
  ['0 3 * * *', '/api/cron/ingest/skermo_rfee'],
  ['30 3 * * *', '/api/cron/ingest/fie'],
  ['0 4 * * *', '/api/cron/ingest/efc'],
  ['30 4 * * *', '/api/cron/ingest/skermo_regional'],
  ['0 5 * * *', '/api/cron/ingest/rfee_wp'],
  ['30 5 * * *', '/api/cron/ingest/skermo_ranking'],
  ['0 6 * * *', '/api/cron/extraer'],
  ['45 6 * * *', '/api/cron/ingest/fie_tiradores'],
  ['0 7 * * *', '/api/cron/notify'],
  ['20 0-2,8-23 * * *', '/api/cron/resultados'],
] as const;

/**
 * Doble local de la restricción única de SQLite. Todas las conexiones
 * comparten filas; no hay DB ni HTTP real. La inserción decide atómicamente
 * tras ceder un turno, para intercalar las dos solicitudes concurrentes.
 */
function preparar() {
  const filas = new Map<string, { estado: string; cierre?: CierreCron }>();
  const query = vi.fn(async (texto: string, parametros: unknown[]): Promise<unknown[]> => {
    await Promise.resolve();
    const clave = `${parametros[0]}|${parametros[1]}`;
    if (texto.includes('INSERT INTO')) {
      expect(texto).toContain('ON CONFLICT ("task", "scheduled_minute") DO NOTHING');
      expect(texto).toContain('RETURNING "task"');
      expect(parametros).toHaveLength(2);
      if (filas.has(clave)) return [];
      filas.set(clave, { estado: 'reclamada' });
      return [{ task: parametros[0] }];
    }
    expect(texto).toContain('UPDATE "cron_execution"');
    const fila = filas.get(clave);
    if (!fila || fila.estado !== 'reclamada') return [];
    fila.estado = String(parametros[2]);
    fila.cierre = {
      estado: parametros[2] as CierreCron['estado'],
      httpStatus: parametros[3] as number | null,
      motivo: parametros[4] as CierreCron['motivo'],
    };
    return [{ task: parametros[0] }];
  });
  const almacen = crearAlmacenCronSql({ query });
  const crearAlmacen = vi.fn(async (_base: BaseCronD1) => almacen);
  const servir = vi.fn(async (_peticion: Request, _env: EntornoCron, _ctx: ContextoCron) => Response.json({ ok: true }));
  const registro = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const scheduled = crearManejadorProgramado({ servir, crearAlmacen, registro });
  const disparar = (scheduledTime = instante + 4_000, cron = '0 3 * * *', env = entorno) =>
    scheduled({ cron, scheduledTime }, env, contexto);
  return { filas, query, almacen, crearAlmacen, servir, registro, scheduled, disparar };
}

beforeEach(() => vi.clearAllMocks());

describe('normalización del minuto UTC programado', () => {
  it('agrupa :04 y :56, pero no el minuto siguiente ni otro día', () => {
    const minuto = Math.floor(instante / 60_000);
    expect(normalizarMinutoProgramado(instante + 4_000)).toBe(minuto);
    expect(normalizarMinutoProgramado(instante + 56_000)).toBe(minuto);
    expect(normalizarMinutoProgramado(instante + 59_999)).toBe(minuto);
    expect(normalizarMinutoProgramado(instante + 60_000)).toBe(minuto + 1);
    expect(normalizarMinutoProgramado(instante + 86_400_000)).toBe(minuto + 1_440);
    expect(normalizarMinutoProgramado(0)).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rechaza el instante inválido %s',
    (valor) => expect(() => normalizarMinutoProgramado(valor)).toThrow(),
  );
});

describe('despacho con reserva persistente', () => {
  it.each(tareas)('despacha %s a su ruta original', async (cron, ruta) => {
    const p = preparar();
    await p.disparar(instante + 56_000, cron);
    expect(p.crearAlmacen).toHaveBeenCalledWith(entorno.DB);
    const [peticion, env, ctx] = p.servir.mock.calls[0];
    expect(peticion.url).toBe(`https://app.invalid${ruta}`);
    expect(peticion.method).toBe('GET');
    expect(peticion.headers.get('authorization')).toBe(`Bearer ${entorno.CRON_SECRET}`);
    expect(peticion.headers.get('user-agent')).toBe('cloudflare-cron/1.0');
    expect(env).toBe(entorno);
    expect(ctx).toBe(contexto);
    expect(p.query.mock.calls[0][1]).toEqual([ruta, Math.floor(instante / 60_000)]);
    expect([...p.filas.values()][0].estado).toBe('completada');
    expect(contexto.waitUntil).not.toHaveBeenCalled();
  });

  it('mantiene las tareas anteriores; el incremento deportivo antiguo ya no tiene franja', () => {
    expect(Object.entries(TAREAS_CRON)).toEqual(tareas);
    expect(Object.values(TAREAS_CRON)).not.toContain('/api/cron/sport');
  });

  it('reclama antes de despachar y sólo gana una invocación concurrente :04/:56', async () => {
    const p = preparar();
    p.servir.mockImplementation(async () => {
      expect(p.filas.size).toBe(1);
      expect([...p.filas.values()][0].estado).toBe('reclamada');
      return Response.json({ ok: true });
    });
    await Promise.all([p.disparar(instante + 4_000), p.disparar(instante + 56_000)]);
    expect(p.servir).toHaveBeenCalledTimes(1);
    expect(p.query.mock.calls.filter(([s]) => s.includes('INSERT INTO'))).toHaveLength(2);
    expect(p.query.mock.calls.filter(([s]) => s.includes('UPDATE'))).toHaveLength(1);
    await p.disparar(instante + 56_000);
    expect(p.servir).toHaveBeenCalledTimes(1);
    expect(p.filas.size).toBe(1);
  });

  it('usa scheduledTime, no el reloj de llegada; distingue tareas y minutos', async () => {
    const p = preparar();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(instante + 86_400_000);
    try {
      await p.disparar();
      await p.disparar(instante + 56_000);
      await p.disparar(instante + 4_000, '0 4 * * *');
      await p.disparar(instante + 60_000);
      expect(p.servir).toHaveBeenCalledTimes(3);
      expect(p.filas.size).toBe(3);
      expect(p.query.mock.calls[0][1][1]).toBe(Math.floor(instante / 60_000));
    } finally {
      reloj.mockRestore();
    }
  });

  it.each([
    { ...entorno, DB: undefined },
    { ...entorno, DB: null as unknown as BaseCronD1 },
    { ...entorno, CRON_SECRET: undefined },
    { ...entorno, CRON_SECRET: ' ' },
  ])('cierra sin driver ni despacho si falta configuración %#', async (env) => {
    const p = preparar();
    await p.disparar(instante, '0 3 * * *', env);
    expect(p.crearAlmacen).not.toHaveBeenCalled();
    expect(p.servir).not.toHaveBeenCalled();
    expect(p.query).not.toHaveBeenCalled();
    expect(p.registro.error).toHaveBeenCalledTimes(1);
  });

  it.each(['cron desconocido', '__proto__', 'toString'])('ignora %s sin cargar el driver', async (cron) => {
    const p = preparar();
    await p.disparar(instante, cron);
    expect(p.crearAlmacen).not.toHaveBeenCalled();
    expect(p.servir).not.toHaveBeenCalled();
    expect(p.registro.warn).toHaveBeenCalledTimes(1);
  });

  it('rechaza el instante inválido antes de abrir la conexión', async () => {
    const p = preparar();
    await p.disparar(NaN);
    expect(p.crearAlmacen).not.toHaveBeenCalled();
    expect(p.servir).not.toHaveBeenCalled();
  });

  it.each(['conexion', 'claim'])('no despacha ni filtra el error si falla %s', async (fase) => {
    const p = preparar();
    const error = new Error('credencial-ficticia-no-registrable');
    if (fase === 'conexion') p.crearAlmacen.mockRejectedValueOnce(error);
    else p.query.mockRejectedValueOnce(error);
    await p.disparar();
    expect(p.servir).not.toHaveBeenCalled();
    expect(p.query.mock.calls.filter(([s]) => s.includes('UPDATE'))).toHaveLength(0);
    expect(JSON.stringify(p.registro)).not.toContain(error.message);
    expect(JSON.stringify(p.registro.error.mock.calls)).not.toContain(error.message);
  });

  it('un INSERT confirmado pero con respuesta perdida bloquea la siguiente entrega', async () => {
    const p = preparar();
    p.crearAlmacen.mockResolvedValueOnce({
      reclamar: async (reserva) => {
        await p.almacen.reclamar(reserva);
        throw new Error('respuesta perdida');
      },
      cerrar: p.almacen.cerrar,
    });
    await p.disparar();
    await p.disparar(instante + 56_000);
    expect(p.servir).not.toHaveBeenCalled();
    expect([...p.filas.values()][0].estado).toBe('reclamada');
  });

  it('sin URL pública conserva https://localhost para el fetch interno', async () => {
    const p = preparar();
    await p.disparar(instante, '0 3 * * *', { ...entorno, NEXT_PUBLIC_APP_URL: undefined });
    expect(p.servir.mock.calls[0][0].url).toBe('https://localhost/api/cron/ingest/skermo_rfee');
  });
});

describe('consumo completo y política tras fallos', () => {
  it('no cierra ni resuelve hasta EOF; el duplicado se omite mientras corre', async () => {
    const p = preparar();
    let terminar!: () => void;
    const encoder = new TextEncoder();
    const respuesta = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(' \n{"ok":true,'));
        terminar = () => {
          controller.enqueue(encoder.encode('"status":"parcial","note":"dato personal ficticio"}\n'));
          controller.close();
        };
      },
    }));
    p.servir.mockResolvedValueOnce(respuesta);
    let resuelta = false;
    const ejecucion = p.disparar().then(() => { resuelta = true; });
    await vi.waitFor(() => expect(p.servir).toHaveBeenCalledTimes(1));
    await p.disparar(instante + 56_000);
    expect(resuelta).toBe(false);
    expect(p.query.mock.calls.filter(([s]) => s.includes('UPDATE'))).toHaveLength(0);
    terminar();
    await ejecucion;
    expect(respuesta.bodyUsed).toBe(true);
    expect([...p.filas.values()][0].estado).toBe('completada');
    expect(JSON.stringify(p.registro.log.mock.calls)).not.toContain('dato personal ficticio');
  });

  it.each([
    [Response.json({ ok: false, status: 'error', error: 'detalle privado ficticio' }), 'resultado', 200],
    [Response.json({ ok: true, status: 'error' }), 'resultado', 200],
    [Response.json({ ok: true }, { status: 503 }), 'http', 503],
    [new Response('página de login', { status: 302 }), 'http', 302],
    [new Response('JSON truncado'), 'respuesta_invalida', 200],
    [Response.json({ status: 'ok' }), 'respuesta_invalida', 200],
  ] as const)('registra el fallo lógico/HTTP sin liberar la clave %#', async (respuesta, motivo, httpStatus) => {
    const p = preparar();
    p.servir.mockResolvedValueOnce(respuesta);
    await p.disparar();
    expect(respuesta.bodyUsed).toBe(true);
    expect([...p.filas.values()][0].cierre).toEqual({ estado: 'fallida', motivo, httpStatus });
    await p.disparar(instante + 56_000);
    expect(p.servir).toHaveBeenCalledTimes(1);
    expect(p.filas.size).toBe(1);
    expect(p.query.mock.calls.every(([s]) => !/DELETE|TRUNCATE/i.test(s))).toBe(true);
    expect(JSON.stringify(p.registro.log.mock.calls)).not.toContain('detalle privado ficticio');
  });

  it('registra una excepción de dispatch sin mensaje ni credenciales', async () => {
    const p = preparar();
    p.servir.mockRejectedValueOnce(new Error('dato-secreto-ficticio'));
    await p.disparar();
    expect([...p.filas.values()][0].cierre).toEqual({
      estado: 'fallida', httpStatus: null, motivo: 'excepcion',
    });
    await p.disparar(instante + 56_000);
    expect(p.servir).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(p.registro.log.mock.calls)).not.toContain('dato-secreto-ficticio');
  });

  it('un fallo del stream deja reserva fallida con el HTTP conocido', async () => {
    const p = preparar();
    p.servir.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(new Error('stream interrumpido')); },
    })));
    await p.disparar();
    expect([...p.filas.values()][0].cierre).toEqual({
      estado: 'fallida', httpStatus: 200, motivo: 'excepcion',
    });
  });

  it('aunque falle el cierre, la reserva reclamada sigue bloqueando duplicados', async () => {
    const p = preparar();
    p.crearAlmacen.mockResolvedValue({
      reclamar: p.almacen.reclamar,
      cerrar: async () => { throw new Error('error-db-ficticio'); },
    });
    await p.disparar();
    expect([...p.filas.values()][0].estado).toBe('reclamada');
    await p.disparar(instante + 56_000);
    expect(p.servir).toHaveBeenCalledTimes(1);
    expect(p.registro.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(p.registro.error.mock.calls)).not.toContain('error-db-ficticio');
  });

  it.each([
    { ok: true, status: 'ok' },
    { ok: true, status: 'parcial' },
    { ok: true, procesadas: 0, motivo: 'IA apagada' },
    { ok: true, errores: 1, detalle: [] },
    { ok: true, avisosEncolados: 0, correo: {} },
  ])('respeta los resúmenes de éxito actuales %#', async (resultado) => {
    expect(await consumirRespuestaCron(Response.json(resultado))).toEqual({
      estado: 'completada', httpStatus: 200, motivo: null,
    });
  });

  it.each([null, [], 'ok', {}, { ok: 'true' }])('no confunde un resultado inválido con éxito %#', async (resultado) => {
    expect((await consumirRespuestaCron(Response.json(resultado))).motivo).toBe('respuesta_invalida');
  });
});

describe('almacén SQL', () => {
  it('devuelve false para conflicto y no convierte una actualización ausente en éxito', async () => {
    const query = vi.fn<ConsultaCron['query']>().mockResolvedValue([]);
    const almacen = crearAlmacenCronSql({ query });
    const reserva: ReservaCron = { tarea: '/api/cron/notify', minutoUtc: 1234 };
    expect(await almacen.reclamar(reserva)).toBe(false);
    await expect(almacen.cerrar(reserva, {
      estado: 'fallida', httpStatus: 500, motivo: 'http',
    })).rejects.toThrow('No se pudo registrar el cierre');
    expect(query.mock.calls[1][1]).toEqual(['/api/cron/notify', 1234, 'fallida', 500, 'http']);
    expect(query.mock.calls[1][0]).toContain('"status" = \'reclamada\'');
  });
});
