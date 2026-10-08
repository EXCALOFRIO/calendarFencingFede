import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';
import { fieClasificacion } from '@/db/schema';
import { consultarAlVolver, OCULTA_MIN_MS } from '@/components/notificaciones/contador-cliente';
import { hayQueMarcarListaVista } from '@/lib/cron/niveles';
import { planificarEnlaces } from '@/lib/ingest/enlazar';
import { CIERRE_CALENDARIO_NOCTURNO, tocaEmparejar } from '@/lib/ingest/runner';
import { hayTrabajoPendiente, migracionAplicada, tablaExiste } from '@/lib/ingest/resultados-auto/estado';
import { indicesDeDescubrimiento } from '@/lib/ingest/resultados-auto/ejecutar';
import type { BaseResultados } from '@/lib/ingest/resultados-auto/sql';
import { cerrarLecturaGrupo, escritorLecturaD1, type GrupoClasificacionFie } from '@/lib/ingest/sources/fie-clasificacion-lectura';
import { generarClavesVapid } from '@/lib/notificaciones/push/vapid';
import { enviarASuscripciones, guardarSuscripcion, listarSuscripciones, MAX_FALLOS } from '@/lib/notificaciones/suscripciones';
import { baseNotificaciones, suscripcionNavegador } from './helpers/notificaciones';

const AHORA = new Date('2026-10-08T03:00:00Z');

describe('emparejado FIE↔Skermo: una vez por noche y solo la diferencia', () => {
  it('por cron solo tras la última fuente de calendario; a mano, tras cualquiera de calendario', () => {
    expect(CIERRE_CALENDARIO_NOCTURNO).toBe('skermo_regional');
    expect(['skermo_rfee', 'fie', 'efc', 'skermo_regional'].filter((f) => tocaEmparejar(f as never, 'cron'))).toEqual(['skermo_regional']);
    expect(tocaEmparejar('fie', 'admin:x@example.test')).toBe(true);
    expect(tocaEmparejar('fie', 'cron:forzado')).toBe(true);
    expect(tocaEmparejar('rfee_wp', 'admin:x@example.test')).toBe(false);
  });

  it('un par igual no se escribe, uno que cambia sí, lo que ya no se propone se borra y lo manual no se toca', () => {
    const previos = [
      { id: 'l1', canonicalEventId: 'p1', linkedEventId: 'f1', status: 'AUTOMATICO', cityKey: 'madrid', rule: 'r', note: null },
      { id: 'l2', canonicalEventId: 'p2', linkedEventId: 'f2', status: 'AUTOMATICO', cityKey: 'oran', rule: 'r', note: null },
      { id: 'l3', canonicalEventId: 'p3', linkedEventId: 'f3', status: 'AUTOMATICO', cityKey: 'gante', rule: 'r', note: null },
      { id: 'l4', canonicalEventId: 'p4', linkedEventId: 'f4', status: 'CONFIRMADO', cityKey: 'x', rule: 'a mano', note: null },
    ];
    const filas = [
      { canonicalEventId: 'p1', linkedEventId: 'f1', status: 'AUTOMATICO', cityKey: 'madrid', rule: 'r', note: null },
      { canonicalEventId: 'p2', linkedEventId: 'f2', status: 'AUTOMATICO', cityKey: 'oran', rule: 'r + desempate', note: null },
      { canonicalEventId: 'p4', linkedEventId: 'f4', status: 'AUTOMATICO', cityKey: 'x', rule: 'confirmado', note: null },
      { canonicalEventId: 'p5', linkedEventId: 'f5', status: 'DUDOSO', cityKey: 'y', rule: 'ambiguo', note: 'n' },
    ];
    const pares = filas.filter((f) => f.status === 'AUTOMATICO');
    const eventos = [
      { id: 'f1', canonicalEventId: 'p1' },
      { id: 'f2', canonicalEventId: 'p2' },
      { id: 'f3', canonicalEventId: 'p3' },
      { id: 'f4', canonicalEventId: null },
      { id: 'p1', canonicalEventId: null },
    ];
    const plan = planificarEnlaces(filas, previos, pares, eventos);
    expect(plan.escribir.map((f) => f.linkedEventId)).toEqual(['f2', 'f5']);
    expect(plan.borrar).toEqual(['l3']);
    expect(plan.canonicos).toEqual([{ id: 'f3', canon: null }, { id: 'f4', canon: 'p4' }]);
    // Segunda pasada con lo ya escrito: nada.
    const guardado = [...previos.filter((p) => p.id !== 'l3').map((p) => {
      const f = filas.find((x) => x.linkedEventId === p.linkedEventId)!;
      return p.status === 'CONFIRMADO' ? p : { ...p, ...f };
    }), { id: 'l5', ...filas[3] }];
    const segunda = planificarEnlaces(filas, guardado, pares, [
      { id: 'f1', canonicalEventId: 'p1' }, { id: 'f2', canonicalEventId: 'p2' }, { id: 'f3', canonicalEventId: null }, { id: 'f4', canonicalEventId: 'p4' },
    ]);
    expect(segunda).toEqual({ escribir: [], borrar: [], canonicos: [] });
  });
});

describe('fecha de lectura de una lista sin cambios', () => {
  const hace = (d: number) => new Date(AHORA.getTime() - d * 86_400_000);
  it('diaria del día −1 al +14, semanal fuera', () => {
    expect(hayQueMarcarListaVista('2026-10-07', hace(1), AHORA)).toBe(true);
    expect(hayQueMarcarListaVista('2026-10-22', hace(1), AHORA)).toBe(true);
    expect(hayQueMarcarListaVista('2026-10-23', hace(1), AHORA)).toBe(false);
    expect(hayQueMarcarListaVista('2026-03-01', hace(6), AHORA)).toBe(false);
    expect(hayQueMarcarListaVista('2026-03-01', hace(7), AHORA)).toBe(true);
    expect(hayQueMarcarListaVista(null, hace(1), AHORA)).toBe(true);
    expect(hayQueMarcarListaVista('2026-03-01', null, AHORA)).toBe(true);
  });
});

const MIGRACIONES = readdirSync(new URL('../drizzle-d1/', import.meta.url)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
function sqliteHasta(hasta: string) {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRACIONES.filter((m) => m <= hasta)) sqlite.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  return sqlite;
}

describe('clasificación mundial: sin count(*) por combinación', () => {
  const GRUPO: GrupoClasificacionFie = { season: 2027, format: 'INDIVIDUAL', weapon: 'ESPADA', gender: 'M', categoryRaw: 'S' };
  function base() {
    const sqlite = sqliteHasta('0009_zzz');
    const dialecto = new SQLiteSyncDialect();
    const consultas: string[] = [];
    const db = {
      async execute(query: SQL) {
        const q = dialecto.sqlToQuery(query);
        consultas.push(q.sql.trim().split(/\s+/).slice(0, 4).join(' '));
        return { rows: sqlite.prepare(q.sql).all(...(q.params as (string | number | null)[])) };
      },
    };
    const ins = sqlite.prepare(`INSERT INTO fie_clasificacion
      (season, weapon, gender, category, category_raw, format, fie_id, position, points, content_hash)
      VALUES (2027, 'ESPADA', 'M', 'ABS', 'S', 'INDIVIDUAL', ?, ?, '1.000', 'h')`);
    return { sqlite, db, consultas, ins };
  }

  it('la primera lectura cuenta; las siguientes usan el recuento guardado y no borran si no sobra nada', async () => {
    const { db, consultas, ins } = base();
    for (const id of [1, 2, 3]) ins.run(id, id);
    const escritor = escritorLecturaD1(db, fieClasificacion);
    await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3], sourceUrl: null, yaGuardadas: 3 }, AHORA);
    expect(consultas.some((c) => c.startsWith('select count(*)'))).toBe(true);
    consultas.length = 0;
    const r = await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3], sourceUrl: null, yaGuardadas: 3 }, AHORA);
    expect(r).toEqual({ borradas: 0, registrada: true, podaOmitida: false });
    expect(consultas.some((c) => c.startsWith('select count(*)'))).toBe(false);
    expect(consultas.some((c) => c.startsWith('delete'))).toBe(false);
  });

  it('con una fila que ya no viene, la poda sigue funcionando', async () => {
    const { sqlite, db, ins } = base();
    for (const id of [1, 2, 3, 4]) ins.run(id, id);
    const escritor = escritorLecturaD1(db, fieClasificacion);
    await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3, 4], sourceUrl: null, yaGuardadas: 4 }, AHORA);
    const r = await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3], sourceUrl: null, yaGuardadas: 3 }, AHORA);
    expect(r.borradas).toBe(1);
    expect(sqlite.prepare('SELECT count(*) n FROM fie_clasificacion').get()).toEqual({ n: 3 });
  });

  it('tras una respuesta cortada, la siguiente cortada tampoco poda (se guarda lo que queda, no lo leído)', async () => {
    const { sqlite, db, ins } = base();
    for (let id = 1; id <= 10; id++) ins.run(id, id);
    const escritor = escritorLecturaD1(db, fieClasificacion);
    await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], sourceUrl: null, yaGuardadas: 10 }, AHORA);
    expect((await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2, 3], sourceUrl: null, yaGuardadas: 3 }, AHORA)).podaOmitida).toBe(true);
    expect((await cerrarLecturaGrupo(escritor, GRUPO, { ok: true, fieIds: [1, 2], sourceUrl: null, yaGuardadas: 2 }, AHORA)).podaOmitida).toBe(true);
    expect(sqlite.prepare('SELECT count(*) n FROM fie_clasificacion').get()).toEqual({ n: 10 });
  });
});

describe('resultados automáticos: una pasada sin nada vencido', () => {
  function base(): { b: BaseResultados; sqlite: DatabaseSync; lecturas: string[] } {
    const sqlite = sqliteHasta('0017_zzz');
    const lecturas: string[] = [];
    const b: BaseResultados = {
      tablasConocidas: new Set(),
      filasEscritas: 0,
      async leer(texto, params = []) {
        lecturas.push(texto);
        return sqlite.prepare(texto).all(...(params as (string | number | null)[])) as never;
      },
      async escribirDeporte() {},
      async escribirPropias() {},
    };
    return { b, sqlite, lecturas };
  }
  const cfg = { ventanaDias: 21 };
  const ahora = AHORA.getTime();
  const claves = indicesDeDescubrimiento(ahora, cfg).map((i) => i.clave);
  const alta = (sqlite: DatabaseSync, clave: string, fuente: string, estado: string, proxima: number) =>
    sqlite.prepare(`INSERT INTO resultado_auto_unidad (clave, fuente, temporada, estado, intentos, proxima) VALUES (?, ?, '2026-2027', ?, 0, ?)`)
      .run(clave, fuente, estado, proxima);

  it('índices sin leer o vencidos, o una unidad vencida, son trabajo; si no, una sola lectura y fuera', async () => {
    const { b, sqlite, lecturas } = base();
    expect(await hayTrabajoPendiente(b, ahora, claves)).toBe(true);
    for (const c of claves) alta(sqlite, c, 'indice', 'hecho', ahora + 3_600_000);
    alta(sqlite, 'fie|2027|1', 'fie', 'esperando', ahora + 60_000);
    alta(sqlite, 'fie|2027|2', 'fie', 'revision', 0);
    lecturas.length = 0;
    expect(await hayTrabajoPendiente(b, ahora, claves)).toBe(false);
    expect(lecturas).toHaveLength(1);
    alta(sqlite, 'fie|2027|3', 'fie', 'pendiente', ahora - 1);
    expect(await hayTrabajoPendiente(b, ahora, claves)).toBe(true);
  });

  it('sin la migración no se sabe (null) y se sigue el camino normal', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const b = { leer: async (t: string) => sqlite.prepare(t).all() } as unknown as BaseResultados;
    expect(await hayTrabajoPendiente(b, ahora, claves)).toBeNull();
  });

  it('las tablas que existen se recuerdan; las que faltan se vuelven a mirar', async () => {
    const { b, lecturas } = base();
    expect(await migracionAplicada(b)).toBe(true);
    expect(await tablaExiste(b, 'tabla_futura')).toBe(false);
    lecturas.length = 0;
    expect(await migracionAplicada(b)).toBe(true);
    expect(await tablaExiste(b, 'resultado_auto_unidad')).toBe(true);
    expect(lecturas).toHaveLength(0);
    expect(await tablaExiste(b, 'tabla_futura')).toBe(false);
    expect(lecturas).toHaveLength(1);
  });
});

describe('push: el resultado de los envíos se apunta en lote', () => {
  let b: ReturnType<typeof baseNotificaciones> | null = null;
  afterEach(() => { b?.close(); b = null; });
  const mensaje = { titulo: 't', cuerpo: 'c', url: '/notificaciones', etiqueta: 'e' };

  it('200 envíos correctos son una sola escritura, no 200', async () => {
    b = baseNotificaciones();
    const claves = { ...(await generarClavesVapid()), asunto: 'mailto:avisos@example.test' };
    const perfiles = Array.from({ length: 20 }, (_, i) => b!.perfil(`P${i}`));
    for (const [i, p] of perfiles.entries()) {
      for (let d = 0; d < 10; d++) await guardarSuscripcion(b.db, p, await suscripcionNavegador(`https://fcm.googleapis.com/fcm/send/${i}-${d}`));
    }
    const subs = await listarSuscripciones(b.db, perfiles);
    expect(subs).toHaveLength(200);
    const red = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    b.calls.length = 0;
    const r = await enviarASuscripciones(b.db, subs.map((s) => ({ suscripcion: s, mensaje })), claves, { fetch: red, ahora: AHORA });
    expect(r.enviadas).toBe(200);
    expect(b.calls.filter((c) => /notificacion_suscripcion/.test(c.sql))).toHaveLength(1);
    const fila = b.sqlite.prepare('SELECT count(*) n, min(ultimo_envio_en) m FROM notificacion_suscripcion WHERE fallos = 0').get();
    expect(fila).toEqual({ n: 200, m: AHORA.getTime() });
  });

  it('los rechazos se suman, un envío correcto los pone a cero y a MAX_FALLOS la suscripción se borra', async () => {
    b = baseNotificaciones();
    const claves = { ...(await generarClavesVapid()), asunto: 'mailto:avisos@example.test' };
    const yo = b.perfil('Yo');
    await guardarSuscripcion(b.db, yo, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/r'));
    let estado = 403;
    const red = (async () => new Response(null, { status: estado })) as unknown as typeof fetch;
    const enviar = async (n: number) => {
      const [s] = await listarSuscripciones(b!.db, [yo]);
      if (!s) return null;
      return enviarASuscripciones(b!.db, Array.from({ length: n }, () => ({ suscripcion: s, mensaje })), claves, { fetch: red, ahora: AHORA });
    };
    await enviar(2);
    expect((await listarSuscripciones(b.db, [yo]))[0].fallos).toBe(2);
    estado = 201;
    await enviar(1);
    expect((await listarSuscripciones(b.db, [yo]))[0].fallos).toBe(0);
    estado = 403;
    const r = await enviar(MAX_FALLOS + 2);
    expect(r).toMatchObject({ rechazadas: MAX_FALLOS, caducadasBorradas: 1 });
    expect(await listarSuscripciones(b.db, [yo])).toHaveLength(0);
  });
});

describe('campana', () => {
  it('al volver a la pestaña se consulta solo si estuvo oculta al menos un minuto', () => {
    expect(consultarAlVolver(null, 1_000_000)).toBe(false);
    expect(consultarAlVolver(1_000_000 - OCULTA_MIN_MS + 1, 1_000_000)).toBe(false);
    expect(consultarAlVolver(1_000_000 - OCULTA_MIN_MS, 1_000_000)).toBe(true);
  });
});
