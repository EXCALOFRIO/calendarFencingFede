import { afterEach, describe, expect, it } from 'vitest';
import { construirAvisosResultados, type LineaResultado } from '@/lib/notificaciones/agrupar';
import {
  agruparBandeja, contarNoLeidas, contarPruebasRecientes, guardarAvisos, leerBandeja, abrirAviso, MAX_PRUEBAS_POR_HORA, type FilaBandeja,
} from '@/lib/notificaciones/bandeja';
import { construirAvisosCalendario, type EventoCalendario } from '@/lib/notificaciones/calendario';
import { compararLecturas, registrarLecturasPerfil, personasVinculadas } from '@/lib/notificaciones/perfil';
import { generarClavesVapid } from '@/lib/notificaciones/push/vapid';
import {
  consumirEventosIngesta, encolarEventosDeportivos, notificarEventosDeportivos, notificarResultadosNuevos, procesarEventosPendientes,
} from '@/lib/notificaciones/resultados';
import {
  CONCURRENCIA_PUSH, guardarSuscripcion, listarSuscripciones, MAX_FALLOS, MAX_SUSCRIPCIONES_POR_PERFIL, enviarASuscripciones, validarSuscripcion,
} from '@/lib/notificaciones/suscripciones';
import { PREFERENCIAS_POR_DEFECTO, type Preferencias } from '@/lib/notificaciones/tipos';
import { baseNotificaciones, suscripcionNavegador } from './helpers/notificaciones';

type Base = ReturnType<typeof baseNotificaciones>;
let base: Base | null = null;
afterEach(() => {
  base?.close();
  base = null;
});

const AHORA = new Date('2026-03-08T19:00:00Z');

/** Una cuenta con dos tiradoras inscritas en la misma prueba, una seguidora y un tercero que no tiene nada que ver. */
function escenario() {
  const b = (base = baseNotificaciones());
  const madre = b.perfil('Madre de dos');
  const seguidora = b.perfil('Seguidora');
  const ajeno = b.perfil('Sin relación');
  const revocada = b.perfil('Revocada');
  b.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(revocada);
  const lucia = b.atleta('Lucía', 'García', { tutor: madre, nacimiento: '2011-02-03' });
  const marta = b.atleta('Marta', 'García', { tutor: madre, nacimiento: '2009-07-08' });
  const evento = b.evento('Copa de España M17 Valencia');
  const ec = b.pruebaApp(evento);
  b.inscribir(lucia, ec);
  b.inscribir(marta, ec);
  const pLucia = b.persona('Lucía García', { atleta: lucia, anio: 2011 });
  const pMarta = b.persona('Marta García', { atleta: marta, anio: 2009 });
  // Una ficha de Marta fundida en la buena: el resultado cuelga de la fundida.
  const pMartaVieja = b.persona('M. García', { fundidaEn: pMarta });
  const pOtra = b.persona('Carla Ruiz');
  b.seguir(seguidora, pOtra);
  b.seguir(seguidora, pLucia);
  b.seguir(revocada, pOtra);
  const prueba = b.prueba('Copa de España M17 Valencia', { eventCompetitionId: ec });
  b.resultado(prueba.id, pLucia, 3, 'GARCIA Lucia');
  b.resultado(prueba.id, pMartaVieja, 12, 'GARCIA Marta');
  b.resultado(prueba.id, pOtra, 1, 'RUIZ Carla');
  b.resultado(prueba.id, null, 2, 'Sin identificar');
  return { b, madre, seguidora, ajeno, revocada, lucia, marta, pLucia, pMarta, pOtra, prueba, ec };
}

async function vapid() {
  return { ...(await generarClavesVapid()), asunto: 'mailto:avisos@example.test' };
}

const fetch201 = (() => {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    llamadas.push(url);
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  return { f, llamadas };
});

describe('resultados publicados: agrupación y deduplicación', () => {
  it('un aviso por perfil y competición, no uno por tirador, con las dos tiradoras dentro', async () => {
    const { b, madre, seguidora, ajeno, revocada, prueba } = escenario();
    const r = await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(r.eventos).toBe(1);
    const deMadre = b.avisos(madre);
    expect(deMadre).toHaveLength(1);
    expect(deMadre[0].tipo).toBe('perfil');
    expect(deMadre[0].clave).toBe(`resultados:${prueba.id}`);
    expect(deMadre[0].titulo).toBe('Resultados de Espada femenina M17');
    const datos = JSON.parse(String(deMadre[0].datos));
    expect(datos.lineas.map((l: { nombre: string; puesto: number }) => [l.nombre, l.puesto])).toEqual([['Lucía García', 3], ['Marta García', 12]]);
    expect(String(deMadre[0].url)).toBe(`/explorar/ediciones/${prueba.edicion}?prueba=${prueba.id}`);

    const deSeguidora = b.avisos(seguidora);
    expect(deSeguidora).toHaveLength(1);
    expect(deSeguidora[0].tipo).toBe('seguidos');
    // Lucía (2011) puede ser menor: a quien solo la sigue no le llega su resultado.
    expect(JSON.parse(String(deSeguidora[0].datos)).lineas.map((l: { nombre: string }) => l.nombre)).toEqual(['Carla Ruiz']);
    expect(b.avisos(ajeno)).toHaveLength(0);
    expect(b.avisos(revocada)).toHaveLength(0);
  });

  it('«Siguiendo» no avisa de un posible menor ni de alguien sin año; si una ficha fundida es menor, tampoco', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const adulta = b.persona('Ana Adulta', { anio: 1995 });
    const sinAnio = b.persona('Sin Año', { anio: null });
    const limite = b.persona('Cumple Dieciocho', { anio: 2008 });
    const mezclada = b.persona('Mezcla Adulta', { anio: 1990 });
    b.persona('Mezcla Joven', { anio: 2012, fundidaEn: mezclada });
    for (const p of [adulta, sinAnio, limite, mezclada]) b.seguir(yo, p);
    const prueba = b.prueba('Torneo');
    for (const [i, p] of [adulta, sinAnio, limite, mezclada].entries()) b.resultado(prueba.id, p, i + 1);
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    const [aviso] = b.avisos(yo);
    expect(aviso.titulo).toBe('Ana Adulta: 1.º en Espada femenina M17');
    expect(JSON.parse(String(aviso.datos)).lineas.map((l: { nombre: string }) => l.nombre)).toEqual(['Ana Adulta']);
  });

  it('el mismo evento otra vez, u otro de las mismas personas, no repite ni empuja de nuevo', async () => {
    const { b, madre, prueba, pLucia } = escenario();
    const claves = await vapid();
    await guardarSuscripcion(b.db, madre, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/madre'));
    const red = fetch201();
    const primero = await notificarEventosDeportivos(b.db, [{ tipo: 'resultados_publicados', competitionId: prueba.id }], { vapid: claves, fetch: red.f, ahora: AHORA });
    expect(primero.push.enviadas).toBe(1);
    const segundo = await notificarEventosDeportivos(b.db, [
      { tipo: 'resultados_publicados', competitionId: prueba.id },
      { tipo: 'resultado_nuevo', competitionId: prueba.id, personIds: [pLucia] },
    ], { vapid: claves, fetch: red.f, ahora: new Date(AHORA.getTime() + 60_000) });
    expect(segundo.guardados).toHaveLength(0);
    expect(segundo.push.enviadas).toBe(0);
    expect(red.llamadas).toHaveLength(1);
    expect(b.avisos(madre)).toHaveLength(1);
    expect(b.sqlite.prepare('SELECT count(*) AS n FROM notificacion_evento WHERE procesado_en IS NULL').get()!.n).toBe(0);
  });

  it('un resultado nuevo que añade a otra persona actualiza el mismo aviso y vuelve a no leído', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const a = b.persona('Ana Uno');
    const c = b.persona('Bea Dos');
    b.seguir(yo, a);
    b.seguir(yo, c);
    const prueba = b.prueba('Torneo');
    b.resultado(prueba.id, a, 5);
    await notificarEventosDeportivos(b.db, [{ tipo: 'resultado_nuevo', competitionId: prueba.id, personIds: [a] }], { vapid: null, ahora: AHORA });
    const [primero] = b.avisos(yo);
    expect(primero.titulo).toBe('Ana Uno: 5.º en Espada femenina M17');
    await abrirAviso(b.db, yo, String(primero.id), AHORA);
    expect(await contarNoLeidas(b.db, yo)).toBe(0);
    b.resultado(prueba.id, c, 2);
    const r = await notificarEventosDeportivos(b.db, [{ tipo: 'resultado_nuevo', competitionId: prueba.id, personIds: [c] }], { vapid: null, ahora: new Date(AHORA.getTime() + 1000) });
    expect(r.guardados.map((g) => g.estado)).toEqual(['actualizado']);
    expect(r.guardados[0].push).toBe(true);
    const filas = b.avisos(yo);
    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe(primero.id);
    expect(filas[0].titulo).toBe('Resultados de Espada femenina M17');
    expect(await contarNoLeidas(b.db, yo)).toBe(1);
  });

  it('privacidad: el aviso no lleva año de nacimiento, fecha, foto ni club; solo nombre, prueba y puesto', async () => {
    const { b, madre, prueba } = escenario();
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    const texto = JSON.stringify(b.avisos());
    for (const prohibido of ['2011', '2009', '2010', '2011-02-03', 'foto', 'birth', 'nacimiento']) expect(texto).not.toContain(prohibido);
    const [aviso] = b.avisos(madre);
    expect(Object.keys(JSON.parse(String(aviso.datos)).lineas[0]).sort()).toEqual(['motivo', 'nombre', 'puesto']);
  });

  it('una inscripción retirada no cuenta y una prueba sin enlace a la app sigue avisando a quien sigue', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const at = b.atleta('Eva', 'Sol', { propietario: yo });
    const ec = b.pruebaApp(b.evento('Torneo'));
    b.inscribir(at, ec, 'withdrawn');
    const prueba = b.prueba('Torneo', { eventCompetitionId: ec });
    b.resultado(prueba.id, b.persona('Otra'), 1);
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(yo)).toHaveLength(0);
  });

  it('una inscripción enviada sin persona deportiva vinculada avisa igual, «sin puesto publicado»', async () => {
    const b = (base = baseNotificaciones());
    const entrenador = b.perfil('Entrenador', { role: 'coach' });
    const at = b.atleta('Eva', 'Sol');
    const ec = b.pruebaApp(b.evento('Torneo'));
    b.inscribir(at, ec, 'submitted', entrenador);
    const prueba = b.prueba('Torneo', { eventCompetitionId: ec });
    b.resultado(prueba.id, b.persona('Otra'), 1);
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    const [aviso] = b.avisos(entrenador);
    expect(aviso.tipo).toBe('inscripciones');
    expect(aviso.titulo).toBe('Eva Sol: sin puesto publicado en Espada femenina M17');
  });

  it('una clasificación sin ninguna persona identificada sigue avisando de la inscripción', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const at = b.atleta('Eva', 'Sol', { propietario: yo });
    const ec = b.pruebaApp(b.evento('Torneo'));
    b.inscribir(at, ec);
    const prueba = b.prueba('Torneo', { eventCompetitionId: ec });
    b.resultado(prueba.id, null, 1, 'Sin identificar');
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(yo).map((a) => a.tipo)).toEqual(['inscripciones']);
  });
});

describe('eventos de la ingesta automática (resultado_auto_evento)', () => {
  // Las columnas que se leen, como en drizzle-d1/0017_resultados_automaticos.sql.
  const TABLA = `CREATE TABLE resultado_auto_evento (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, competition_id TEXT NOT NULL,
    person_id TEXT, posicion INTEGER, datos TEXT, creado_en INTEGER NOT NULL)`;

  it('sin la tabla de la ingesta no hace nada y no falla', async () => {
    const { b } = escenario();
    expect(await consumirEventosIngesta(b.db, AHORA)).toEqual({ leidos: 0, encolados: 0, disponible: false });
  });

  it('arranca en el máximo (sin atracón de lo antiguo), traduce los tipos y avanza el cursor', async () => {
    const { b, madre, seguidora, prueba, pLucia } = escenario();
    b.sqlite.exec(TABLA);
    const evento = b.sqlite.prepare(`INSERT INTO resultado_auto_evento (tipo, competition_id, person_id, creado_en) VALUES (?, ?, ?, 1)`);
    evento.run('prueba_publicada', prueba.id, null);
    expect(await notificarResultadosNuevos(b.db, { vapid: null, ahora: AHORA })).toMatchObject({ leidos: 0, avisos: 0 });
    expect(b.avisos()).toHaveLength(0);

    evento.run('fases_publicadas', prueba.id, null);
    evento.run('resultado_persona', prueba.id, pLucia);
    const r = await notificarResultadosNuevos(b.db, { vapid: null, ahora: AHORA });
    expect(r.leidos).toBe(2);
    expect(b.avisos(madre).map((a) => a.tipo)).toEqual(['perfil']);
    // La seguidora solo sigue a Lucía entre las personas del evento, y Lucía puede ser menor.
    expect(b.avisos(seguidora)).toEqual([]);
    expect(b.sqlite.prepare(`SELECT ultimo_id FROM notificacion_cursor WHERE fuente = 'resultado_auto_evento'`).get()!.ultimo_id).toBe(3);

    evento.run('prueba_publicada', prueba.id, null);
    const otra = await notificarResultadosNuevos(b.db, { vapid: null, ahora: AHORA });
    expect(otra.leidos).toBe(1);
    // La prueba entera sí trae a Carla (adulta), que la seguidora también sigue.
    expect(otra.guardados.map((g) => g.aviso.profileId)).toEqual([seguidora]);
    expect(b.avisos()).toHaveLength(2);
  });
});

async function procesarDespues(b: Base, eventos: Parameters<typeof encolarEventosDeportivos>[1]) {
  await encolarEventosDeportivos(b.db, eventos, AHORA);
  return procesarEventosPendientes(b.db, AHORA);
}

describe('preferencias', () => {
  it('un tipo desactivado no genera aviso; los demás tipos del mismo perfil, sí', async () => {
    const { b, madre, seguidora, prueba } = escenario();
    b.preferencia(seguidora, 'tipo:seguidos', false);
    b.preferencia(madre, 'tipo:perfil', false);
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(seguidora)).toHaveLength(0);
    // Sin «perfil», la madre sigue enterándose por «inscripciones».
    const [aviso] = b.avisos(madre);
    expect(aviso.tipo).toBe('inscripciones');
    b.preferencia(madre, 'tipo:inscripciones', false);
    b.sqlite.exec('DELETE FROM notificacion');
    await procesarDespues(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(madre)).toHaveLength(0);
  });

  it('campana apagada y móvil encendido: fuera de la bandeja pero llega al móvil; los dos apagados: nada', async () => {
    const { b, madre, seguidora, prueba } = escenario();
    b.preferencia(madre, 'canal:campana', false);
    b.preferencia(seguidora, 'canal:campana', false);
    b.preferencia(seguidora, 'canal:push', false);
    await guardarSuscripcion(b.db, madre, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/madre'));
    const red = fetch201();
    const r = await notificarEventosDeportivos(b.db, [{ tipo: 'resultados_publicados', competitionId: prueba.id }], { vapid: await vapid(), fetch: red.f, ahora: AHORA });
    expect(r.push.enviadas).toBe(1);
    expect(b.avisos(madre)[0].en_bandeja).toBe(0);
    expect(await contarNoLeidas(b.db, madre)).toBe(0);
    expect(await leerBandeja(b.db, madre)).toEqual([]);
    expect(b.avisos(seguidora)).toHaveLength(0);
  });

  it('push apagado: aviso en la campana y nada al móvil', async () => {
    const { b, madre, prueba } = escenario();
    b.preferencia(madre, 'canal:push', false);
    await guardarSuscripcion(b.db, madre, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/madre'));
    const red = fetch201();
    await notificarEventosDeportivos(b.db, [{ tipo: 'resultados_publicados', competitionId: prueba.id }], { vapid: await vapid(), fetch: red.f, ahora: AHORA });
    expect(red.llamadas).toHaveLength(0);
    expect(await contarNoLeidas(b.db, madre)).toBe(1);
  });

  it('construirAvisosResultados descarta las líneas de tipos apagados antes de agrupar', () => {
    const prefs = new Map<string, Preferencias>([['p', { ...PREFERENCIAS_POR_DEFECTO, 'tipo:seguidos': false }]]);
    const B = '00000000-0000-4000-8000-00000000000b';
    const C = '00000000-0000-4000-8000-00000000000c';
    const lineas: LineaResultado[] = [
      { profileId: 'p', motivo: 'seguidos', clavePersona: 'a', personaId: 'a', nombre: 'A', puesto: 1 },
      { profileId: 'p', motivo: 'perfil', clavePersona: B, personaId: B, nombre: 'B', puesto: 7 },
    ];
    const prueba = { competitionId: C, editionId: 'e', nombreEdicion: 'Torneo', arma: 'SABLE', genero: 'M', categoria: 'ABS' };
    const avisos = construirAvisosResultados(prueba, lineas, prefs, PREFERENCIAS_POR_DEFECTO);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].titulo).toBe('B: 7.º en Sable masculino');
    expect(avisos[0].url).toBe(`/explorar/ediciones/e?prueba=${C}&persona=${B}`);
  });
});

describe('suscripciones caducadas', () => {
  it('404/410 se borran en el acto; un rechazo suma fallos y a los cinco se borra; un 5xx no toca nada', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    for (const nombre of ['ok', 'gone', 'notfound', 'rechazo', 'caido']) {
      await guardarSuscripcion(b.db, yo, await suscripcionNavegador(`https://fcm.googleapis.com/fcm/send/${nombre}`));
    }
    const estado: Record<string, number> = { ok: 201, gone: 410, notfound: 404, rechazo: 403, caido: 503 };
    const red = (async (url: string) => new Response(null, { status: estado[url.split('/').pop()!] })) as unknown as typeof fetch;
    const claves = await vapid();
    const mensaje = { titulo: 't', cuerpo: 'c', url: '/notificaciones', etiqueta: 'e' };
    const subs = await listarSuscripciones(b.db, [yo]);
    const r = await enviarASuscripciones(b.db, subs.map((s) => ({ suscripcion: s, mensaje })), claves, { fetch: red, ahora: AHORA });
    expect(r).toEqual({ enviadas: 1, caducadasBorradas: 2, rechazadas: 1, errores: 1, omitidas: 0 });
    const quedan = (await listarSuscripciones(b.db, [yo])).map((s) => s.endpoint.split('/').pop()).sort();
    expect(quedan).toEqual(['caido', 'ok', 'rechazo']);
    for (let i = 1; i < MAX_FALLOS; i++) {
      const rechazo = (await listarSuscripciones(b.db, [yo])).filter((s) => s.endpoint.endsWith('/rechazo'));
      await enviarASuscripciones(b.db, rechazo.map((s) => ({ suscripcion: s, mensaje })), claves, { fetch: red, ahora: AHORA });
    }
    expect((await listarSuscripciones(b.db, [yo])).map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['caido', 'ok']);
  });

  it('el mismo dispositivo con otra cuenta se queda la suscripción; lo que manda el navegador se valida', async () => {
    const b = (base = baseNotificaciones());
    const a = b.perfil('A');
    const c = b.perfil('C');
    const sub = await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/uno');
    await guardarSuscripcion(b.db, a, sub);
    await guardarSuscripcion(b.db, c, sub);
    expect(await listarSuscripciones(b.db, [a])).toHaveLength(0);
    expect(await listarSuscripciones(b.db, [c])).toHaveLength(1);
    expect(validarSuscripcion({ ...sub, endpoint: 'http://x.test' })).toBeNull();
    expect(validarSuscripcion({ ...sub, p256dh: 'AAAA' })).toBeNull();
    expect(validarSuscripcion({ ...sub, auth: 'AAAA' })).toBeNull();
    expect(validarSuscripcion({ ...sub, dispositivo: 'x'.repeat(200) })!.dispositivo).toHaveLength(80);
    expect(validarSuscripcion({ ...sub, endpoint: 'https://push.example.test/uno' })).toBeNull();
  });

  it('como mucho diez dispositivos por cuenta: al suscribir el undécimo se va el más antiguo', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const otra = b.perfil('Otra');
    await guardarSuscripcion(b.db, otra, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/otra'), AHORA);
    for (let i = 0; i < MAX_SUSCRIPCIONES_POR_PERFIL + 2; i++) {
      await guardarSuscripcion(b.db, yo, await suscripcionNavegador(`https://fcm.googleapis.com/fcm/send/d${i}`), new Date(AHORA.getTime() + i * 1000));
    }
    const mias = (await listarSuscripciones(b.db, [yo])).map((s) => s.endpoint.split('/').pop());
    expect(mias).toHaveLength(MAX_SUSCRIPCIONES_POR_PERFIL);
    expect(mias).not.toContain('d0');
    expect(mias).not.toContain('d1');
    expect(mias[0]).toBe(`d${MAX_SUSCRIPCIONES_POR_PERFIL + 1}`);
    expect(await listarSuscripciones(b.db, [otra])).toHaveLength(1);
    // Volver a suscribir uno que ya estaba no quita a nadie más.
    await guardarSuscripcion(b.db, yo, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/d5'), new Date(AHORA.getTime() + 60_000));
    expect(await listarSuscripciones(b.db, [yo])).toHaveLength(MAX_SUSCRIPCIONES_POR_PERFIL);
  });

  it('una suscripción guardada con un host que ya no se admite se borra sin llamarla', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const sub = await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/buena');
    await guardarSuscripcion(b.db, yo, sub);
    b.sqlite.prepare(`INSERT INTO notificacion_suscripcion (id, profile_id, endpoint, p256dh, auth, creada_en, fallos)
      VALUES ('vieja', ?, 'https://169.254.169.254/latest', ?, ?, 1, 0)`).run(yo, sub.p256dh, sub.auth);
    const red = fetch201();
    const subs = await listarSuscripciones(b.db, [yo]);
    const mensaje = { titulo: 't', cuerpo: 'c', url: '/notificaciones', etiqueta: 'e' };
    const r = await enviarASuscripciones(b.db, subs.map((s) => ({ suscripcion: s, mensaje })), await vapid(), { fetch: red.f, ahora: AHORA });
    expect(r).toMatchObject({ enviadas: 1, caducadasBorradas: 1 });
    expect(red.llamadas).toEqual([sub.endpoint]);
    expect((await listarSuscripciones(b.db, [yo])).map((s) => s.id)).not.toContain('vieja');
  });

  it('envía en paralelo con un tope de concurrencia y deja sin intentar lo que pasa del tope por pasada', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    for (let i = 0; i < 10; i++) await guardarSuscripcion(b.db, yo, await suscripcionNavegador(`https://fcm.googleapis.com/fcm/send/p${i}`));
    let enVuelo = 0;
    let maximo = 0;
    const red = (async () => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo--;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const subs = await listarSuscripciones(b.db, [yo]);
    const mensaje = { titulo: 't', cuerpo: 'c', url: '/notificaciones', etiqueta: 'e' };
    const r = await enviarASuscripciones(b.db, subs.map((s) => ({ suscripcion: s, mensaje })), await vapid(), {
      fetch: red, ahora: AHORA, concurrencia: 3, maxEnvios: 8,
    });
    expect(r).toEqual({ enviadas: 8, caducadasBorradas: 0, rechazadas: 0, errores: 0, omitidas: 2 });
    expect(maximo).toBeGreaterThan(1);
    expect(maximo).toBeLessThanOrEqual(3);
    expect(CONCURRENCIA_PUSH).toBe(6);
  });

  it('las pruebas de la última hora se cuentan por cuenta', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const otra = b.perfil('Otra');
    const prueba = (profileId: string, t: Date) => guardarAvisos(b.db, [{
      profileId, tipo: 'prueba', clave: `prueba:${t.getTime()}`, grupo: 'prueba', titulo: 'Prueba', cuerpo: '', url: '/notificaciones', datos: null,
    }], new Map(), t);
    await prueba(yo, new Date(AHORA.getTime() - 2 * 3_600_000));
    for (let i = 0; i < MAX_PRUEBAS_POR_HORA; i++) await prueba(yo, new Date(AHORA.getTime() - i * 60_000));
    await prueba(otra, AHORA);
    expect(await contarPruebasRecientes(b.db, yo, AHORA)).toBe(MAX_PRUEBAS_POR_HORA);
    expect(await contarPruebasRecientes(b.db, otra, AHORA)).toBe(1);
  });
});

describe('cambios de perfil: ranking y estado olímpico', () => {
  const lectura = (clave: string, valor: string, etiqueta = 'Ranking nacional · Espada femenina M17') => ({ clave, valor, etiqueta });

  it('la primera lectura no avisa; un cambio sí; la misma lectura otra vez, no; una clave que desaparece, tampoco', async () => {
    const { b, madre, pMarta } = escenario();
    const personas = await personasVinculadas(b.db);
    expect(personas.find((p) => p.personId === pMarta)?.perfiles).toEqual([madre]);
    const leer = (valor: string, olimpico?: string) => [{
      personId: pMarta,
      lecturas: [
        lectura('nacional:ESPADA-F-M17', valor),
        ...(olimpico ? [lectura('olimpico:ESPADA-F', olimpico, 'Estado olímpico · Espada femenina')] : []),
      ],
    }];
    expect((await registrarLecturasPerfil(b.db, personas, leer('2025-2026|8', 'cerca'), AHORA)).guardados).toHaveLength(0);
    const cambio = await registrarLecturasPerfil(b.db, personas, leer('2025-2026|5', 'clasificado'), AHORA);
    expect(cambio.cambios).toBe(2);
    const [aviso] = b.avisos(madre);
    expect(aviso.tipo).toBe('perfil');
    expect(aviso.titulo).toBe('Cambios en el perfil de Marta García');
    expect(aviso.cuerpo).toBe('Ranking nacional · Espada femenina M17: 5.º (antes 8.º); Estado olímpico · Espada femenina: en plaza olímpica (antes cerca de la plaza olímpica)');
    // Ranking y plaza olímpica: se abre la sección Ranking del perfil.
    expect(aviso.url).toBe(`/explorar/${pMarta}/ranking`);
    expect((await registrarLecturasPerfil(b.db, personas, leer('2025-2026|5', 'clasificado'), AHORA)).guardados).toHaveLength(0);
    expect((await registrarLecturasPerfil(b.db, personas, leer('2025-2026|5'), AHORA)).cambios).toBe(0);
    expect(b.avisos(madre)).toHaveLength(1);
  });

  it('con «tu perfil» apagado guarda la lectura pero no avisa, y al encender no llega lo atrasado', async () => {
    const { b, madre, pMarta } = escenario();
    b.preferencia(madre, 'tipo:perfil', false);
    const personas = await personasVinculadas(b.db);
    const una = (v: string) => [{ personId: pMarta, lecturas: [lectura('nacional:x', v)] }];
    await registrarLecturasPerfil(b.db, personas, una('t|8'), AHORA);
    await registrarLecturasPerfil(b.db, personas, una('t|5'), AHORA);
    expect(b.avisos(madre)).toHaveLength(0);
    b.preferencia(madre, 'tipo:perfil', true);
    await registrarLecturasPerfil(b.db, personas, una('t|5'), AHORA);
    expect(b.avisos(madre)).toHaveLength(0);
  });

  it('compararLecturas: temporada nueva y entrada en una lista nueva se describen así', () => {
    const antes = new Map([['nacional:a', '2024-2025|4']]);
    const c = compararLecturas(antes, [lectura('nacional:a', '2025-2026|2'), lectura('nacional:b', '2025-2026|30', 'Ranking nacional · Espada femenina M20')]);
    expect(c.map((x) => x.texto)).toEqual([
      'Ranking nacional · Espada femenina M17: 2.º en 2025-2026 (antes 4.º en 2024-2025)',
      'Ranking nacional · Espada femenina M20: entras en el 30.º',
    ]);
  });
});

describe('tu calendario: competiciones nuevas y plazos', () => {
  const ahora = new Date('2026-03-02T07:00:00Z');
  const evento = (id: string, weapon: string, category: string, cierre: Date | null, extra: Partial<EventoCalendario> = {}): EventoCalendario => ({
    id, name: `Torneo ${id}`, startDate: '2026-03-14', endDate: '2026-03-15', city: 'Madrid',
    competitions: [{
      weapon, gender: 'F', category, format: 'INDIVIDUAL',
      deadlines: cierre ? [{ type: 'L1', label: 'Límite ordinario', deadlineAt: cierre, blocking: false }] : [],
    }],
    ...extra,
  });
  const criterios = [{ profileId: 'p', armas: new Set(['ESPADA']), generos: new Set(['F']), categorias: new Set(['M17', 'M20']) }];

  it('avisa del cierre a tres días o menos y de lo nuevo, solo de lo que encaja con arma y categoría', () => {
    const eventos = [
      evento('a', 'ESPADA', 'M17', new Date('2026-03-04T21:59:00Z')),
      evento('b', 'SABLE', 'M17', new Date('2026-03-04T21:59:00Z')),
      evento('c', 'ESPADA', 'M17', new Date('2026-03-10T21:59:00Z')),
      evento('d', 'ESPADA', 'M20', null),
    ];
    const avisos = construirAvisosCalendario(criterios, eventos, new Set(['d', 'b']), ahora, new Map());
    expect(avisos.map((a) => a.clave)).toEqual(['plazo:a:L1:2026-03-04', 'nueva:d']);
    expect(avisos[0].titulo).toBe('Cierra la inscripción en 3 días: Torneo a');
    expect(avisos[0].grupo).toBe('evento:a');
    expect(avisos[0].url.startsWith('/?')).toBe(true);
    expect(avisos[1].titulo).toBe('Nueva competición: Torneo d');
  });

  it('con el tipo apagado no sale nada; sin criterios conocidos no se filtra', () => {
    const eventos = [evento('a', 'SABLE', 'ABS', new Date('2026-03-03T21:59:00Z'))];
    const apagado = new Map([['p', { ...PREFERENCIAS_POR_DEFECTO, 'tipo:calendario': false }]]);
    expect(construirAvisosCalendario(criterios, eventos, new Set(['a']), ahora, apagado)).toEqual([]);
    const todo = [{ profileId: 'q', armas: null, generos: null, categorias: null }];
    expect(construirAvisosCalendario(todo, eventos, new Set(), ahora, new Map()).map((a) => a.clave)).toEqual(['plazo:a:L1:2026-03-03']);
  });

  it('guardado dos veces es un aviso: el cron puede correr cuantas veces quiera', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const avisos = construirAvisosCalendario([{ ...criterios[0], profileId: yo }], [evento('a', 'ESPADA', 'M17', new Date('2026-03-04T21:59:00Z'))], new Set(['a']), ahora, new Map());
    expect(await guardarAvisos(b.db, avisos, new Map(), ahora)).toHaveLength(2);
    expect(await guardarAvisos(b.db, avisos, new Map(), ahora)).toHaveLength(0);
    expect(b.avisos(yo)).toHaveLength(2);
  });
});

describe('bandeja: agrupación por competición', () => {
  const fila = (id: string, grupo: string, horasAtras: number, extra: Partial<FilaBandeja> = {}): FilaBandeja => ({
    id, tipo: 'calendario', grupo, titulo: `t-${id}`, cuerpo: 'c', url: '/', datos: null, leida: false,
    creadaEn: AHORA.getTime() - horasAtras * 3_600_000, actualizadaEn: AHORA.getTime() - horasAtras * 3_600_000, ...extra,
  });

  it('cada grupo sale una vez, en el tramo de su aviso más reciente, sin repetir textos iguales', () => {
    const inicio = new Date('2026-03-08T00:00:00Z').getTime();
    const secciones = agruparBandeja([
      fila('1', 'evento:a', 1),
      fila('2', 'evento:a', 30, { titulo: 'antes' }),
      fila('3', 'evento:a', 40, { titulo: 'antes' }),
      fila('4', 'competicion:x', 50, { leida: true }),
      fila('5', 'persona:y', 24 * 40),
    ], AHORA, inicio);
    expect(secciones.map((s) => [s.titulo, s.grupos.map((g) => g.grupo)])).toEqual([
      ['Hoy', ['evento:a']],
      ['Esta semana', ['competicion:x']],
      ['Antes', ['persona:y']],
    ]);
    const a = secciones[0].grupos[0];
    expect(a.anteriores.map((f) => f.id)).toEqual(['2']);
    expect(a.noLeidas).toBe(2);
  });

  it('abrir un aviso marca leído todo su grupo y devuelve solo rutas internas', async () => {
    const b = (base = baseNotificaciones());
    const yo = b.perfil('Yo');
    const otro = b.perfil('Otro');
    const aviso = (clave: string, url = '/x') => ({ profileId: yo, tipo: 'calendario' as const, clave, grupo: 'evento:a', titulo: clave, cuerpo: '', url, datos: null });
    const g = await guardarAvisos(b.db, [aviso('nueva:a'), aviso('plazo:a')], new Map(), AHORA);
    expect(await contarNoLeidas(b.db, yo)).toBe(2);
    expect(await abrirAviso(b.db, otro, g[0].id)).toBeNull();
    expect(await abrirAviso(b.db, yo, g[0].id)).toBe('/x');
    expect(await contarNoLeidas(b.db, yo)).toBe(0);
    await expect(guardarAvisos(b.db, [aviso('mala', 'https://evil.test')], new Map(), AHORA)).rejects.toThrow();
    await expect(guardarAvisos(b.db, [aviso('mala', '//evil.test')], new Map(), AHORA)).rejects.toThrow();
  });
});
