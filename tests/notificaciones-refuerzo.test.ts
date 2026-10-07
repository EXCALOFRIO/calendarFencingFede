import { afterEach, describe, expect, it } from 'vitest';
import { construirAvisosResultados, type AvisoNuevo } from '@/lib/notificaciones/agrupar';
import { guardarAvisos, guardarPreferencia, leerBandeja, leerPreferencias, leerPreferenciasDe, type AvisoGuardado } from '@/lib/notificaciones/bandeja';
import {
  construirAvisosCalendario, DIAS_AVISO_PLAZO, MAX_NUEVAS_POR_PERFIL, type EventoCalendario, type PlazoCalendario,
} from '@/lib/notificaciones/calendario';
import { entregarPush, MAX_PUSH_POR_PASADA, mensajeDe, mensajesDePerfil } from '@/lib/notificaciones/entrega';
import { criteriosCalendario } from '@/lib/notificaciones/programado';
import { generarClavesVapid } from '@/lib/notificaciones/push/vapid';
import { encolarEventosDeportivos, notificarEventosDeportivos, procesarEventosPendientes } from '@/lib/notificaciones/resultados';
import { guardarSuscripcion, listarSuscripciones } from '@/lib/notificaciones/suscripciones';
import { listaPersonas, nombrePrueba, puestoTexto, recortar, tiempoRelativo } from '@/lib/notificaciones/textos';
import { PREFERENCIAS_POR_DEFECTO, type ClavePreferencia } from '@/lib/notificaciones/tipos';
import { baseNotificaciones, suscripcionNavegador } from './helpers/notificaciones';

type Base = ReturnType<typeof baseNotificaciones>;
let base: Base | null = null;
afterEach(() => {
  base?.close();
  base = null;
});
const nueva = () => (base = baseNotificaciones());

const AHORA = new Date('2026-03-08T19:00:00Z');
/** Mayor de edad sin duda: a quien la sigue sí se le avisa de sus resultados. */
const ADULTA = 1990;
const vapid = async () => ({ ...(await generarClavesVapid()), asunto: 'mailto:avisos@example.test' });

function red(estado: (url: string) => number = () => 201) {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    llamadas.push(url);
    return new Response(null, { status: estado(url) });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

async function procesar(b: Base, eventos: Parameters<typeof encolarEventosDeportivos>[1], ahora = AHORA) {
  await encolarEventosDeportivos(b.db, eventos, ahora);
  return procesarEventosPendientes(b.db, ahora);
}

// ------------------------------------------------------------------ preferencias por tipo

describe('preferencias por tipo', () => {
  it('sin filas todo está encendido; una clave desconocida no entra ni por la base ni por el código', async () => {
    const b = nueva();
    const yo = b.perfil('Yo');
    expect(() => b.sqlite.prepare(`INSERT INTO notificacion_preferencia (profile_id, clave, activa, actualizada_en) VALUES (?, 'tipo:spam', 0, 0)`).run(yo))
      .toThrow(/CHECK/);
    expect(await leerPreferenciasDe(b.db, yo)).toEqual(PREFERENCIAS_POR_DEFECTO);
    await expect(guardarPreferencia(b.db, yo, 'tipo:spam' as ClavePreferencia, false)).rejects.toThrow();
    await guardarPreferencia(b.db, yo, 'tipo:calendario', false);
    await guardarPreferencia(b.db, yo, 'tipo:calendario', true);
    await guardarPreferencia(b.db, yo, 'canal:push', false);
    expect(await leerPreferenciasDe(b.db, yo)).toEqual({ ...PREFERENCIAS_POR_DEFECTO, 'canal:push': false });
  });

  it('las preferencias de una cuenta no afectan a otra', async () => {
    const b = nueva();
    const a = b.perfil('A');
    const c = b.perfil('C');
    await guardarPreferencia(b.db, a, 'tipo:seguidos', false);
    const prefs = await leerPreferencias(b.db, [a, c]);
    expect(prefs.get(a)!['tipo:seguidos']).toBe(false);
    expect(prefs.get(c)!['tipo:seguidos']).toBe(true);
  });

  it('tutora que además sigue a su hija: con «tu perfil» apagado le llega como «siguiendo»; con los dos apagados, nada', async () => {
    const b = nueva();
    const madre = b.perfil('Madre');
    const hija = b.atleta('Lucía', 'Sol', { tutor: madre, nacimiento: '2014-02-03' });
    const p = b.persona('Lucía Sol', { atleta: hija, anio: 2014 });
    b.seguir(madre, p);
    const prueba = b.prueba('Torneo');
    b.resultado(prueba.id, p, 4);
    b.preferencia(madre, 'tipo:perfil', false);
    await procesar(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(madre).map((a) => a.tipo)).toEqual(['seguidos']);
    b.sqlite.exec('DELETE FROM notificacion');
    b.preferencia(madre, 'tipo:seguidos', false);
    await procesar(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(madre)).toEqual([]);
  });

  it('con varios motivos manda el más personal, sin duplicar a la persona', () => {
    const lineas = [
      { profileId: 'p', motivo: 'seguidos' as const, clavePersona: 'x', personaId: 'x', nombre: 'Ana', puesto: null },
      { profileId: 'p', motivo: 'inscripciones' as const, clavePersona: 'x', personaId: null, nombre: 'Ana', puesto: 3 },
      { profileId: 'p', motivo: 'perfil' as const, clavePersona: 'x', personaId: 'x', nombre: 'Ana', puesto: 3 },
    ];
    const prueba = { competitionId: 'c', editionId: 'e', nombreEdicion: 'Torneo', arma: 'FLORETE', genero: 'F', categoria: 'M15' };
    const [aviso, ...resto] = construirAvisosResultados(prueba, lineas, new Map(), PREFERENCIAS_POR_DEFECTO);
    expect(resto).toEqual([]);
    expect(aviso.tipo).toBe('perfil');
    expect(aviso.titulo).toBe('Ana: 3.º en Florete femenino M15');
    expect(aviso.datos?.lineas).toEqual([{ nombre: 'Ana', puesto: 3, motivo: 'perfil' }]);
  });

  it('un aviso de tipo «prueba» se guarda aunque todos los tipos estén apagados, pero no con los dos canales apagados', async () => {
    const b = nueva();
    const yo = b.perfil('Yo');
    const apagado = { ...PREFERENCIAS_POR_DEFECTO, 'tipo:inscripciones': false, 'tipo:seguidos': false, 'tipo:perfil': false, 'tipo:calendario': false };
    const aviso: AvisoNuevo = { profileId: yo, tipo: 'prueba', clave: 'prueba:1', grupo: 'prueba', titulo: 'Prueba', cuerpo: '', url: '/notificaciones', datos: null };
    expect(await guardarAvisos(b.db, [aviso], new Map([[yo, apagado]]), AHORA)).toHaveLength(1);
    const mudo = { ...PREFERENCIAS_POR_DEFECTO, 'canal:campana': false, 'canal:push': false };
    expect(await guardarAvisos(b.db, [{ ...aviso, clave: 'prueba:2' }], new Map([[yo, mudo]]), AHORA)).toEqual([]);
  });
});

// ------------------------------------------------------------------ deduplicación por competición

describe('deduplicación por competición', () => {
  function dosPruebas() {
    const b = nueva();
    const yo = b.perfil('Yo');
    const ana = b.persona('Ana Uno', { anio: ADULTA });
    const bea = b.persona('Bea Dos', { anio: ADULTA });
    b.seguir(yo, ana);
    b.seguir(yo, bea);
    const p1 = b.prueba('Torneo A');
    const p2 = b.prueba('Torneo B');
    b.resultado(p1.id, ana, 1);
    b.resultado(p1.id, bea, 2);
    b.resultado(p2.id, ana, 5);
    return { b, yo, ana, bea, p1, p2 };
  }

  it('dos personas de la misma prueba en eventos separados de la misma pasada son UN aviso con las dos', async () => {
    const { b, yo, ana, bea, p1 } = dosPruebas();
    const r = await procesar(b, [
      { tipo: 'resultado_nuevo', competitionId: p1.id, personIds: [ana] },
      { tipo: 'resultado_nuevo', competitionId: p1.id, personIds: [bea] },
    ]);
    expect(r.competiciones).toBe(1);
    const avisos = b.avisos(yo);
    expect(avisos).toHaveLength(1);
    expect(JSON.parse(String(avisos[0].datos)).lineas.map((l: { nombre: string }) => l.nombre)).toEqual(['Ana Uno', 'Bea Dos']);
  });

  it('dos pruebas distintas son dos avisos, cada uno en su grupo', async () => {
    const { b, yo, p1, p2 } = dosPruebas();
    await procesar(b, [
      { tipo: 'resultados_publicados', competitionId: p1.id },
      { tipo: 'resultados_publicados', competitionId: p2.id },
    ]);
    const avisos = b.avisos(yo);
    expect(avisos.map((a) => a.grupo).sort()).toEqual([`competicion:${p1.id}`, `competicion:${p2.id}`].sort());
    expect(new Set(avisos.map((a) => a.clave)).size).toBe(2);
  });

  it('el mismo aviso dos veces en una lista, o guardado a la vez por dos pasadas, es una sola fila', async () => {
    const b = nueva();
    const yo = b.perfil('Yo');
    const aviso: AvisoNuevo = { profileId: yo, tipo: 'calendario', clave: 'nueva:e1', grupo: 'evento:e1', titulo: 'Nueva', cuerpo: 'c', url: '/', datos: null };
    expect(await guardarAvisos(b.db, [aviso, aviso, { ...aviso }], new Map(), AHORA)).toHaveLength(1);
    const otra = { ...aviso, clave: 'nueva:e2' };
    const [x, y] = await Promise.all([guardarAvisos(b.db, [otra], new Map(), AHORA), guardarAvisos(b.db, [otra], new Map(), AHORA)]);
    expect(x.length + y.length).toBe(1);
    expect(b.avisos(yo)).toHaveLength(2);
  });

  it('un resultado de una ficha fundida cuenta como la persona buena: no hay dos líneas para la misma tiradora', async () => {
    const b = nueva();
    const yo = b.perfil('Yo');
    const buena = b.persona('Marta García', { anio: ADULTA });
    const vieja = b.persona('M. García', { fundidaEn: buena, anio: ADULTA });
    b.seguir(yo, buena);
    const prueba = b.prueba('Torneo');
    b.resultado(prueba.id, vieja, 7);
    b.resultado(prueba.id, buena, 9);
    await procesar(b, [{ tipo: 'resultado_nuevo', competitionId: prueba.id, personIds: [vieja] }]);
    const [aviso] = b.avisos(yo);
    expect(aviso.titulo).toBe('Marta García: 7.º en Espada femenino M17');
  });

  it('un evento de una persona sin resultado en esa prueba no genera nada', async () => {
    const { b, yo, p2, bea } = dosPruebas();
    const r = await procesar(b, [{ tipo: 'resultado_nuevo', competitionId: p2.id, personIds: [bea] }]);
    expect(r.avisos).toBe(0);
    expect(b.avisos(yo)).toEqual([]);
  });

  it('identificadores mal formados o tipos desconocidos no entran en la cola', async () => {
    const b = nueva();
    const n = await encolarEventosDeportivos(b.db, [
      { tipo: 'resultados_publicados', competitionId: "x' OR 1=1 --" },
      { tipo: 'otro' as never, competitionId: 'abc' },
      { tipo: 'resultado_nuevo', competitionId: 'abc', personIds: [] },
      { tipo: 'resultado_nuevo', competitionId: 'abc', personIds: ['../../etc'] },
      { tipo: 'resultados_publicados', competitionId: 'abc' },
    ], AHORA);
    expect(n).toBe(1);
  });

  it('con más de tres avisos en una pasada, al móvil le llega uno solo que los resume', () => {
    const guardados: AvisoGuardado[] = Array.from({ length: MAX_PUSH_POR_PASADA + 2 }, (_, i) => ({
      id: String(i), estado: 'nuevo', push: true,
      aviso: { profileId: 'p', tipo: 'seguidos', clave: `resultados:${i}`, grupo: 'g', titulo: `Aviso ${i}`, cuerpo: 'c', url: '/x', datos: null },
    }));
    const mensajes = mensajesDePerfil(guardados);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toMatchObject({ titulo: '5 avisos nuevos', url: '/notificaciones', etiqueta: 'resumen' });
    expect(mensajesDePerfil(guardados.slice(0, 3))).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ suscripciones caducadas

describe('suscripción caducada (404/410) en la entrega real', () => {
  async function escenario() {
    const b = nueva();
    const yo = b.perfil('Yo');
    const p = b.persona('Ana Uno', { anio: ADULTA });
    b.seguir(yo, p);
    const prueba = b.prueba('Torneo');
    b.resultado(prueba.id, p, 2);
    await guardarSuscripcion(b.db, yo, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/movil-viejo'), new Date(AHORA.getTime() - 1000));
    await guardarSuscripcion(b.db, yo, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/movil-nuevo'), AHORA);
    return { b, yo, prueba };
  }

  it.each([404, 410])('un %i borra esa suscripción, entrega en la otra y el aviso sigue en la campana', async (codigo) => {
    const { b, yo, prueba } = await escenario();
    const r = red((url) => (url.endsWith('/movil-viejo') ? codigo : 201));
    const res = await notificarEventosDeportivos(b.db, [{ tipo: 'resultados_publicados', competitionId: prueba.id }], { vapid: await vapid(), fetch: r.f, ahora: AHORA });
    expect(res.push).toMatchObject({ enviadas: 1, caducadasBorradas: 1 });
    expect((await listarSuscripciones(b.db, [yo])).map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/movil-nuevo']);
    expect(await leerBandeja(b.db, yo)).toHaveLength(1);
  });

  it('una suscripción caducada no recibe el resto de mensajes de la misma pasada', async () => {
    const b = nueva();
    const yo = b.perfil('Yo');
    await guardarSuscripcion(b.db, yo, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/muerta'));
    const avisos: AvisoNuevo[] = [1, 2, 3].map((i) => ({
      profileId: yo, tipo: 'calendario', clave: `nueva:${i}`, grupo: `evento:${i}`, titulo: `N${i}`, cuerpo: '', url: '/', datos: null,
    }));
    const guardados = await guardarAvisos(b.db, avisos, new Map(), AHORA);
    const r = red(() => 410);
    const res = await entregarPush(b.db, guardados, { vapid: await vapid(), fetch: r.f, ahora: AHORA });
    expect(r.llamadas).toHaveLength(1);
    expect(res).toMatchObject({ enviadas: 0, caducadasBorradas: 1, sinClaves: false });
    // En la siguiente pasada ya no hay a quién enviar.
    const otra = await guardarAvisos(b.db, [{ ...avisos[0], clave: 'nueva:4' }], new Map(), AHORA);
    await entregarPush(b.db, otra, { vapid: await vapid(), fetch: r.f, ahora: AHORA });
    expect(r.llamadas).toHaveLength(1);
  });

  it('una suscripción a un host que no es un servicio de push se borra sin hacerle ninguna petición', async () => {
    const b = nueva();
    const yo = b.perfil('Yo');
    await guardarSuscripcion(b.db, yo, await suscripcionNavegador('https://169.254.169.254/latest/meta-data'));
    const [g] = await guardarAvisos(b.db, [{
      profileId: yo, tipo: 'calendario', clave: 'nueva:x', grupo: 'evento:x', titulo: 'N', cuerpo: '', url: '/', datos: null,
    }], new Map(), AHORA);
    const r = red();
    expect(await entregarPush(b.db, [g], { vapid: await vapid(), fetch: r.f, ahora: AHORA })).toMatchObject({ caducadasBorradas: 1 });
    expect(r.llamadas).toEqual([]);
    expect(await listarSuscripciones(b.db, [yo])).toEqual([]);
  });

  it('sin claves VAPID no se envía nada ni se tocan las suscripciones', async () => {
    const { b, yo, prueba } = await escenario();
    const r = red(() => 410);
    const res = await notificarEventosDeportivos(b.db, [{ tipo: 'resultados_publicados', competitionId: prueba.id }], { vapid: null, fetch: r.f, ahora: AHORA });
    expect(res.push.sinClaves).toBe(true);
    expect(r.llamadas).toEqual([]);
    expect(await listarSuscripciones(b.db, [yo])).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ privacidad de menores

describe('privacidad de menores en el texto', () => {
  function menor() {
    const b = nueva();
    const madre = b.perfil('Madre Tutora');
    const desconocido = b.perfil('Alguien que sigue');
    const nina = b.atleta('Lucía', 'Pérez Sanz', { tutor: madre, nacimiento: '2015-06-30' });
    const p = b.persona('PEREZ SANZ Lucía', { atleta: nina, anio: 2015 });
    b.seguir(desconocido, p);
    const prueba = b.prueba('Criterium M11 Madrid');
    b.resultado(prueba.id, p, 2, 'PEREZ SANZ Lucía');
    b.sqlite.prepare(`UPDATE sport_result SET source_club = 'CLUB ESGRIMA TRES CANTOS' WHERE person_id = ?`).run(p);
    return { b, madre, desconocido, nina, p, prueba };
  }

  it('ni el aviso ni el mensaje al móvil llevan fecha o año de nacimiento, edad, club, correo ni ids de la ficha', async () => {
    const { b, madre, desconocido, nina, prueba } = menor();
    await guardarSuscripcion(b.db, desconocido, await suscripcionNavegador('https://fcm.googleapis.com/fcm/send/desconocido'));
    const res = await notificarEventosDeportivos(b.db, [{ tipo: 'resultados_publicados', competitionId: prueba.id }], { vapid: await vapid(), fetch: red().f, ahora: AHORA });
    const visibles = b.avisos().map((a) => ({ titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, datos: a.datos, grupo: a.grupo, clave: a.clave }));
    const textos = [JSON.stringify(visibles), ...res.guardados.map((g) => JSON.stringify(mensajeDe(g)))].join('\n');
    for (const prohibido of ['2015', '06-30', '30/06', 'años', 'TRES CANTOS', 'Tres Cantos', '@example.test', nina, madre, 'Tutora', 'menor']) {
      expect(textos, prohibido).not.toContain(prohibido);
    }
    expect(b.avisos(madre)[0].titulo).toBe('Lucía Perez Sanz: 2.º en Espada femenino M17');
  });

  it('a quien solo sigue a una menor no le llega nada; a la tutora, sí, sin decir quién es la tutora', async () => {
    const { b, madre, desconocido, prueba } = menor();
    await procesar(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(desconocido)).toEqual([]);
    const [deMadre] = b.avisos(madre);
    expect(deMadre.tipo).toBe('perfil');
    expect(Object.keys(JSON.parse(String(deMadre.datos)).lineas[0]).sort()).toEqual(['motivo', 'nombre', 'puesto']);
  });

  it('sin año de nacimiento conocido se trata como posible menor; una adulta seguida sí avisa', async () => {
    const b = nueva();
    const yo = b.perfil('Sigue');
    const sinAnio = b.persona('Sin Año', { anio: null as unknown as number });
    b.sqlite.prepare(`UPDATE sport_person SET birth_year = NULL WHERE id = ?`).run(sinAnio);
    const adulta = b.persona('Adulta Uno', { anio: ADULTA });
    b.seguir(yo, sinAnio);
    b.seguir(yo, adulta);
    const prueba = b.prueba('Torneo');
    b.resultado(prueba.id, sinAnio, 1);
    b.resultado(prueba.id, adulta, 2);
    await procesar(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    const [aviso, ...resto] = b.avisos(yo);
    expect(resto).toEqual([]);
    expect(aviso.titulo).toBe('Adulta Uno: 2.º en Espada femenino M17');
    expect(JSON.stringify(aviso)).not.toContain('Sin Año');
  });

  it('una ficha fundida con un año de menor veta el aviso aunque la buena diga adulta', async () => {
    const b = nueva();
    const yo = b.perfil('Sigue');
    const buena = b.persona('Ana Mezcla', { anio: ADULTA });
    const vieja = b.persona('A. Mezcla', { fundidaEn: buena, anio: 2014 });
    b.seguir(yo, buena);
    const prueba = b.prueba('Torneo');
    b.resultado(prueba.id, vieja, 3);
    await procesar(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    expect(b.avisos(yo)).toEqual([]);
  });

  it('la dirección del aviso sólo lleva ids opacos y rutas internas', async () => {
    const { b, madre, p, prueba } = menor();
    await procesar(b, [{ tipo: 'resultados_publicados', competitionId: prueba.id }]);
    const url = String(b.avisos(madre)[0].url);
    expect(url).toBe(`/explorar/ediciones/${prueba.edicion}?prueba=${prueba.id}&persona=${p}`);
    expect(url).not.toMatch(/lucia|perez|%20/i);
  });
});

// ------------------------------------------------------------------ zona horaria de los plazos

describe('zona horaria de los plazos', () => {
  const criterios = [{ profileId: 'p', armas: null, generos: null, categorias: null }];
  const evento = (id: string, plazos: PlazoCalendario[], extra: Partial<EventoCalendario> = {}): EventoCalendario => ({
    id, name: `Torneo ${id}`, startDate: '2026-04-18', endDate: '2026-04-19', city: null,
    competitions: [{ weapon: 'ESPADA', gender: 'F', category: 'M17', format: 'INDIVIDUAL', deadlines: plazos }],
    ...extra,
  });
  const l1 = (iso: string): PlazoCalendario => ({ type: 'L1', label: 'Límite ordinario', deadlineAt: new Date(iso), blocking: false });

  it('en invierno (CET) la hora del cierre se escribe en hora de Madrid', () => {
    const [a] = construirAvisosCalendario(criterios, [evento('a', [l1('2026-03-04T22:59:00Z')])], new Set(), new Date('2026-03-02T07:00:00Z'), new Map());
    expect(a.cuerpo).toMatch(/04\/03\/2026,? 23:59/);
  });

  it('tras el cambio de hora (CEST) también: 21:59 UTC son las 23:59 de Madrid', () => {
    const [a] = construirAvisosCalendario(criterios, [evento('a', [l1('2026-03-31T21:59:00Z')])], new Set(), new Date('2026-03-29T07:00:00Z'), new Map());
    expect(a.cuerpo).toMatch(/31\/03\/2026,? 23:59/);
  });

  it('un cierre a las 00:30 de Madrid sale con el día de Madrid, no el de UTC', () => {
    const [a] = construirAvisosCalendario(criterios, [evento('a', [l1('2026-03-04T23:30:00Z')])], new Set(), new Date('2026-03-03T07:00:00Z'), new Map());
    expect(a.cuerpo).toMatch(/05\/03\/2026,? 00:30/);
    // La clave es estable entre pasadas del cron aunque cambie «ahora».
    const [b] = construirAvisosCalendario(criterios, [evento('a', [l1('2026-03-04T23:30:00Z')])], new Set(), new Date('2026-03-04T07:00:00Z'), new Map());
    expect(b.clave).toBe(a.clave);
  });

  it('la ventana es de tres días exactos: dentro en el límite, fuera un milisegundo después, nada si ya cerró', () => {
    const ahora = new Date('2026-03-02T07:00:00Z');
    const limite = new Date(ahora.getTime() + DIAS_AVISO_PLAZO * 86_400_000).toISOString();
    const despues = new Date(ahora.getTime() + DIAS_AVISO_PLAZO * 86_400_000 + 1).toISOString();
    const avisos = construirAvisosCalendario(criterios, [
      evento('dentro', [l1(limite)]), evento('fuera', [l1(despues)]), evento('pasado', [l1('2026-03-02T06:59:59Z')]),
    ], new Set(), ahora, new Map());
    expect(avisos.map((a) => a.grupo)).toEqual(['evento:dentro']);
    expect(avisos[0].titulo).toBe('Cierra la inscripción en 3 días: Torneo dentro');
  });

  it('un cierre dentro de una hora se anuncia como «1 día» (nunca «0 días»)', () => {
    const [a] = construirAvisosCalendario(criterios, [evento('a', [l1('2026-03-02T08:00:00Z')])], new Set(), new Date('2026-03-02T07:00:00Z'), new Map());
    expect(a.titulo).toBe('Cierra la inscripción en 1 día: Torneo a');
  });

  it('un plazo bloqueante anterior al ordinario manda; uno no bloqueante que no es L1 se ignora', () => {
    const plazos: PlazoCalendario[] = [
      l1('2026-03-04T22:59:00Z'),
      { type: 'PAGO', label: 'Pago', deadlineAt: new Date('2026-03-02T22:59:00Z'), blocking: true },
      { type: 'L2', label: 'Límite con recargo', deadlineAt: new Date('2026-03-02T10:00:00Z'), blocking: false },
    ];
    const [a] = construirAvisosCalendario(criterios, [evento('a', plazos)], new Set(), new Date('2026-03-02T07:00:00Z'), new Map());
    expect(a.clave).toBe('plazo:a:PAGO:2026-03-02');
    expect(a.cuerpo).toMatch(/^Pago: 02\/03\/2026,? 23:59/);
  });

  it('como mucho ocho competiciones nuevas por cuenta y pasada', () => {
    const eventos = Array.from({ length: 12 }, (_, i) => evento(`n${i}`, []));
    const avisos = construirAvisosCalendario(criterios, eventos, new Set(eventos.map((e) => e.id)), new Date('2026-03-02T07:00:00Z'), new Map());
    expect(avisos).toHaveLength(MAX_NUEVAS_POR_PERFIL);
  });

  it('una competición nueva que ya terminó no se anuncia', () => {
    const viejo = evento('v', [], { startDate: '2026-02-01', endDate: '2026-02-01' });
    expect(construirAvisosCalendario(criterios, [viejo], new Set(['v']), new Date('2026-03-02T07:00:00Z'), new Map())).toEqual([]);
  });
});

// ------------------------------------------------------------------ criterios del calendario y textos

describe('criterios de «tu calendario»', () => {
  it('sólo cuentas activas y enlazadas; la tutora hereda armas y género de su tiradora; las armas del perfil se suman', async () => {
    const b = nueva();
    const madre = b.perfil('Madre');
    const coach = b.perfil('Entrenador', { role: 'coach' });
    const sinEnlace = b.perfil('Invitada', { auth: false });
    const revocada = b.perfil('Revocada');
    b.sqlite.prepare(`UPDATE user_profile SET invite_status = 'revocada' WHERE id = ?`).run(revocada);
    const hija = b.atleta('Eva', 'Sol', { tutor: madre, genero: 'F' });
    b.sqlite.prepare(`INSERT INTO athlete_weapon (athlete_id, weapon) VALUES (?, 'SABLE')`).run(hija);
    b.sqlite.prepare(`INSERT INTO profile_weapon (profile_id, weapon) VALUES (?, 'FLORETE')`).run(coach);
    const c = await criteriosCalendario(b.db, null);
    const ids = c.map((x) => x.profileId).sort();
    expect(ids).toEqual([madre, coach].sort());
    expect(ids).not.toContain(sinEnlace);
    const deMadre = c.find((x) => x.profileId === madre)!;
    expect([...deMadre.armas!]).toEqual(['SABLE']);
    expect([...deMadre.generos!]).toEqual(['F']);
    expect(deMadre.categorias).toBeNull();
    const delCoach = c.find((x) => x.profileId === coach)!;
    expect([...delCoach.armas!]).toEqual(['FLORETE']);
    expect(delCoach.generos).toBeNull();
  });
});

describe('textos', () => {
  it('recortar no parte palabras salvo que no haya otra, y siempre cabe en el máximo', () => {
    expect(recortar('  uno   dos  ', 50)).toBe('uno dos');
    const r = recortar('Campeonato de España de Espada femenina absoluta', 20);
    expect(r.length).toBeLessThanOrEqual(20);
    expect(r.endsWith('…')).toBe(true);
    expect(r).not.toMatch(/\s…$/);
    expect(recortar('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('puesto: sólo enteros positivos', () => {
    expect([1, 0, -2, 2.5, null].map(puestoTexto)).toEqual(['1.º', 'sin puesto publicado', 'sin puesto publicado', 'sin puesto publicado', 'sin puesto publicado']);
  });

  it('lista de personas y nombre de prueba de equipos', () => {
    const l = [1, 2, 3, 4, 5, 6].map((i) => ({ nombre: `P${i}`, puesto: i }));
    expect(listaPersonas(l)).toBe('P1, 1.º; P2, 2.º; P3, 3.º; P4, 4.º y 2 más');
    expect(nombrePrueba({ arma: 'SABLE', genero: 'MIXTO', categoria: 'VET', formato: 'EQUIPOS' })).toBe('Sable mixto veteranos · equipos');
  });

  it('tiempo relativo en hora de Madrid, con el año sólo si no es el actual', () => {
    const ahora = Date.parse('2026-03-08T19:00:00Z');
    expect(tiempoRelativo(ahora - 30_000, ahora)).toBe('ahora');
    expect(tiempoRelativo(ahora - 5 * 60_000, ahora)).toBe('hace 5 min');
    expect(tiempoRelativo(ahora - 3 * 3_600_000, ahora)).toBe('hace 3 h');
    expect(tiempoRelativo(ahora - 2 * 86_400_000, ahora)).toBe('hace 2 d');
    // 23:30 UTC del 28 de febrero ya es 1 de marzo en Madrid.
    expect(tiempoRelativo(Date.parse('2026-02-28T23:30:00Z'), ahora)).toBe('1 mar');
    expect(tiempoRelativo(Date.parse('2025-12-31T23:30:00Z'), ahora)).toBe('1 ene');
    expect(tiempoRelativo(Date.parse('2025-12-30T12:00:00Z'), ahora)).toBe('30 dic 2025');
    expect(tiempoRelativo(ahora + 60_000, ahora)).toBe('ahora');
  });
});
