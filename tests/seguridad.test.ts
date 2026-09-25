import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * AUDITORÍA DE SEGURIDAD
 *
 * Tres tipos de prueba, y conviene distinguirlos al leer un fallo:
 *
 *  a) Acciones de servidor con sesión REAL de base de datos. Lo único que se
 *     simula es "quién ha iniciado sesión" (`auth.getSession`); a partir de ahí
 *     `getSessionProfile`, el rol, el club y la propiedad de cada ficha salen
 *     de la base de verdad. Es lo que permite comprobar que una acción no se
 *     fía de un identificador que venga del cliente.
 *  b) Peticiones HTTP reales contra el `next dev` que está corriendo.
 *  c) Revisión estática del código fuente, para las reglas que son "esto no
 *     puede aparecer en ninguna parte" (datos personales en la URL, HTML sin
 *     escapar, credenciales en los registros).
 *
 * Todo lo que se crea lleva el prefijo `e2e-seg-` y se borra al terminar.
 */

// `revalidatePath` solo existe dentro de una petición de Next.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

/** Identidad de la sesión simulada. El perfil y el rol salen de la base. */
let sesion: { id: string; email: string } | null = null;

vi.mock('@/lib/auth/server', () => ({
  auth: {
    getSession: async () => ({ data: sesion ? { user: sesion } : null }),
  },
}));

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
/**
 * Prefijo PROPIO de esta suite, no el genérico `e2e-`: el limpiado borra por
 * prefijo y con varias suites trabajando sobre la misma base una podría
 * llevarse por delante los datos de otra a mitad de ejecución.
 */
const PREFIJO = 'e2e-seg-';
const RAIZ = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

type Ctx = {
  clubA: string;
  clubB: string;
  perfilAdmin: string;
  perfilClubA: string;
  perfilClubB: string;
  perfilTirador: string;
  perfilOtro: string;
  perfilCoach: string;
  tiradorA: string;
  tiradorB: string;
  competicion: string;
  eventoId: string;
  entryA: string;
  entryB: string;
  convocatoriaB: string;
  convocadoB: string;
};

let ctx: Ctx;
let db: typeof import('../src/db')['db'];
let esquema: typeof import('../src/db/schema');

const correo = (etiqueta: string) => `${PREFIJO}${etiqueta}@pruebas.local`;

async function entrarComo(profileId: string | null) {
  if (profileId === null) {
    sesion = null;
    return;
  }
  const [fila] = await db
    .select({ email: esquema.userProfile.email, authUserId: esquema.userProfile.authUserId })
    .from(esquema.userProfile)
    .where(eqId(esquema.userProfile.id, profileId));
  sesion = { id: fila.authUserId ?? `auth-${profileId}`, email: fila.email };
}

// Pequeño envoltorio para no importar `eq` antes de tiempo.
let eqId: typeof import('drizzle-orm')['eq'];

beforeAll(async () => {
  const drizzle = await import('drizzle-orm');
  eqId = drizzle.eq;
  db = (await import('../src/db')).db;
  esquema = await import('../src/db/schema');
  const { newIcalToken } = await import('../src/lib/auth/session');

  await limpiar();

  const [clubA] = await db
    .insert(esquema.club)
    .values({ name: `${PREFIJO}Club Alfa` })
    .returning({ id: esquema.club.id });
  const [clubB] = await db
    .insert(esquema.club)
    .values({ name: `${PREFIJO}Club Beta` })
    .returning({ id: esquema.club.id });

  const perfil = async (
    etiqueta: string,
    role: 'admin' | 'coach' | 'club' | 'athlete' | 'guardian',
    clubId: string | null,
  ) => {
    const [p] = await db
      .insert(esquema.userProfile)
      .values({
        email: correo(etiqueta),
        fullName: `Prueba ${etiqueta}`,
        role,
        clubId,
        icalToken: newIcalToken(),
        authUserId: `${PREFIJO}auth-${etiqueta}`,
      })
      .returning({ id: esquema.userProfile.id });
    return p.id;
  };

  const perfilAdmin = await perfil('admin', 'admin', null);
  const perfilClubA = await perfil('club-a', 'club', clubA.id);
  const perfilClubB = await perfil('club-b', 'club', clubB.id);
  const perfilTirador = await perfil('tirador', 'athlete', clubA.id);
  const perfilOtro = await perfil('otro', 'athlete', clubB.id);
  const perfilCoach = await perfil('coach', 'coach', null);

  const [tiradorA] = await db
    .insert(esquema.athlete)
    .values({
      userProfileId: perfilTirador,
      firstName: 'Ana',
      lastName: `${PREFIJO}Alfa`,
      birthDate: '2008-05-05',
      gender: 'F',
      clubId: clubA.id,
    })
    .returning({ id: esquema.athlete.id });

  const [tiradorB] = await db
    .insert(esquema.athlete)
    .values({
      userProfileId: perfilOtro,
      firstName: 'Bruno',
      lastName: `${PREFIJO}Beta`,
      birthDate: '2008-06-06',
      gender: 'M',
      clubId: clubB.id,
    })
    .returning({ id: esquema.athlete.id });

  /**
   * Una prueba REAL del calendario, y de un evento que todavía no ha pasado:
   * el feed iCal no emite lo ya celebrado, así que con un evento antiguo la
   * comprobación de aislamiento entre tokens no probaría nada.
   */
  const hoy = new Date().toISOString().slice(0, 10);
  const [comp] = await db
    .select({ id: esquema.eventCompetition.id, eventId: esquema.eventCompetition.eventId })
    .from(esquema.eventCompetition)
    .innerJoin(esquema.event, eqId(esquema.eventCompetition.eventId, esquema.event.id))
    .where(drizzle.gte(esquema.event.endDate, hoy))
    .limit(1);
  if (!comp) throw new Error('La base no tiene ninguna prueba futura; no se puede auditar.');

  const [entryA] = await db
    .insert(esquema.entry)
    .values({
      athleteId: tiradorA.id,
      eventCompetitionId: comp.id,
      status: 'pending_club',
      requestedByProfileId: perfilTirador,
      requestedAt: new Date(),
    })
    .returning({ id: esquema.entry.id });

  const [entryB] = await db
    .insert(esquema.entry)
    .values({
      athleteId: tiradorB.id,
      eventCompetitionId: comp.id,
      status: 'pending_club',
      requestedByProfileId: perfilOtro,
      requestedAt: new Date(),
    })
    .returning({ id: esquema.entry.id });

  const [convocatoriaB] = await db
    .insert(esquema.callUp)
    .values({
      eventId: comp.eventId,
      title: `${PREFIJO}Convocatoria Beta`,
      published: true,
      publishedAt: new Date(),
      createdByProfileId: perfilAdmin,
    })
    .returning({ id: esquema.callUp.id });

  const [convocadoB] = await db
    .insert(esquema.callUpAthlete)
    .values({ callUpId: convocatoriaB.id, athleteId: tiradorB.id })
    .returning({ id: esquema.callUpAthlete.id });

  ctx = {
    clubA: clubA.id,
    clubB: clubB.id,
    perfilAdmin,
    perfilClubA,
    perfilClubB,
    perfilTirador,
    perfilOtro,
    perfilCoach,
    tiradorA: tiradorA.id,
    tiradorB: tiradorB.id,
    competicion: comp.id,
    eventoId: comp.eventId,
    entryA: entryA.id,
    entryB: entryB.id,
    convocatoriaB: convocatoriaB.id,
    convocadoB: convocadoB.id,
  };
}, 60_000);

afterAll(async () => {
  await limpiar();
}, 60_000);

async function limpiar() {
  const { like, inArray, sql } = await import('drizzle-orm');
  const s = esquema;

  // Orden: primero lo que cuelga, luego lo que sostiene.
  const perfiles = await db
    .select({ id: s.userProfile.id })
    .from(s.userProfile)
    .where(like(s.userProfile.email, `${PREFIJO}%`));
  const ids = perfiles.map((p) => p.id);

  const tiradores = await db
    .select({ id: s.athlete.id })
    .from(s.athlete)
    .where(like(s.athlete.lastName, `${PREFIJO}%`));
  const tIds = tiradores.map((t) => t.id);

  if (tIds.length > 0) {
    const entradas = await db
      .select({ id: s.entry.id })
      .from(s.entry)
      .where(inArray(s.entry.athleteId, tIds));
    const eIds = entradas.map((e) => e.id);
    if (eIds.length > 0) {
      await db.delete(s.entryEventLog).where(inArray(s.entryEventLog.entryId, eIds));
      await db.delete(s.notification).where(inArray(s.notification.relatedEntryId, eIds));
      await db.delete(s.entry).where(inArray(s.entry.id, eIds));
    }
    await db.delete(s.callUpAthlete).where(inArray(s.callUpAthlete.athleteId, tIds));
    await db.delete(s.athleteWeapon).where(inArray(s.athleteWeapon.athleteId, tIds));
    await db.delete(s.athlete).where(inArray(s.athlete.id, tIds));
  }

  await db.delete(s.callUp).where(like(s.callUp.title, `${PREFIJO}%`));
  await db.delete(s.notification).where(like(s.notification.dedupeKey, `%${PREFIJO}%`));
  if (ids.length > 0) {
    await db.delete(s.notification).where(
      sql`${s.notification.toEmail} like ${`${PREFIJO}%`}`,
    );
    await db.delete(s.profileWeapon).where(inArray(s.profileWeapon.profileId, ids));
    await db.delete(s.userProfile).where(inArray(s.userProfile.id, ids));
  }
  await db.delete(s.club).where(like(s.club.name, `${PREFIJO}%`));
}

// ---------------------------------------------------------------------------
// 1. Autorización: propiedad de la fila, no solo rol
// ---------------------------------------------------------------------------

describe('inscripciones: el identificador lo pone el cliente, así que se comprueba', () => {
  it('un tirador NO puede retirar la inscripción de otro sabiendo su entryId', async () => {
    const { transitionEntry } = await import('../src/lib/entries/actions');
    await entrarComo(ctx.perfilTirador);

    const r = await transitionEntry(ctx.entryB, 'withdrawn', 'me lo he pensado mejor');

    expect(r.ok).toBe(false);

    // Y sobre todo: la inscripción ajena sigue intacta.
    const [fila] = await db
      .select({ status: esquema.entry.status })
      .from(esquema.entry)
      .where(eqId(esquema.entry.id, ctx.entryB));
    expect(fila.status).toBe('pending_club');
  });

  it('un tutor o tirador tampoco puede reactivar la inscripción de otro', async () => {
    const { transitionEntry } = await import('../src/lib/entries/actions');
    await db
      .update(esquema.entry)
      .set({ status: 'rejected' })
      .where(eqId(esquema.entry.id, ctx.entryB));

    await entrarComo(ctx.perfilTirador);
    const r = await transitionEntry(ctx.entryB, 'pending_club');
    expect(r.ok).toBe(false);

    await db
      .update(esquema.entry)
      .set({ status: 'pending_club' })
      .where(eqId(esquema.entry.id, ctx.entryB));
  });

  it('sí puede retirar la suya (el control no rompe el caso normal)', async () => {
    const { transitionEntry } = await import('../src/lib/entries/actions');
    await entrarComo(ctx.perfilTirador);

    const r = await transitionEntry(ctx.entryA, 'withdrawn', 'lesión');
    expect(r.ok).toBe(true);

    await db
      .update(esquema.entry)
      .set({ status: 'pending_club' })
      .where(eqId(esquema.entry.id, ctx.entryA));
  });

  it('un club no puede validar la inscripción de un tirador de otro club', async () => {
    const { transitionEntry } = await import('../src/lib/entries/actions');
    await entrarComo(ctx.perfilClubA);

    const r = await transitionEntry(ctx.entryB, 'club_approved');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tu club/i);
  });

  it('un club no puede INSCRIBIR a un tirador de otro club', async () => {
    const { requestEntry } = await import('../src/lib/entries/actions');
    await entrarComo(ctx.perfilClubA);

    const r = await requestEntry(ctx.competicion, ctx.tiradorB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tu club/i);
  });

  it('un tirador no puede inscribir a otro tirador', async () => {
    const { requestEntry } = await import('../src/lib/entries/actions');
    await entrarComo(ctx.perfilTirador);

    const r = await requestEntry(ctx.competicion, ctx.tiradorB);
    expect(r.ok).toBe(false);
  });

  it('sin sesión no se llega a tocar nada', async () => {
    const { transitionEntry, requestEntry } = await import('../src/lib/entries/actions');
    await entrarComo(null);

    await expect(transitionEntry(ctx.entryA, 'withdrawn', 'x')).rejects.toThrow(
      'NO_AUTENTICADO',
    );
    await expect(requestEntry(ctx.competicion, ctx.tiradorA)).rejects.toThrow(
      'NO_AUTENTICADO',
    );
  });
});

describe('convocatorias: solo se responde por los tiradores propios', () => {
  it('un tirador no puede confirmar la convocatoria de otro', async () => {
    const { responderConvocatoria } = await import('../src/lib/callups/actions');
    await entrarComo(ctx.perfilTirador);

    const r = await responderConvocatoria(ctx.convocadoB, 'confirmado');
    expect(r.ok).toBe(false);

    const [fila] = await db
      .select({ status: esquema.callUpAthlete.status })
      .from(esquema.callUpAthlete)
      .where(eqId(esquema.callUpAthlete.id, ctx.convocadoB));
    expect(fila.status).toBe('pendiente');
  });

  it('el convocado sí puede responder por sí mismo', async () => {
    const { responderConvocatoria } = await import('../src/lib/callups/actions');
    await entrarComo(ctx.perfilOtro);

    const r = await responderConvocatoria(ctx.convocadoB, 'confirmado');
    expect(r.ok).toBe(true);
  });
});

describe('las acciones de administración exigen rol admin', () => {
  /**
   * Una acción de servidor es un endpoint público: que el botón no se pinte no
   * protege nada. Se comprueba una por una, con sesión de coach, de club y de
   * tirador, que son los tres roles que sí tienen sesión válida.
   */
  it('coach, club y tirador rebotan en todas ellas', async () => {
    const usuarios = await import('../src/app/(app)/admin/usuarios/actions');
    const cuarentena = await import('../src/app/(app)/admin/cuarentena/actions');
    const emparejar = await import('../src/app/(app)/admin/emparejar/actions');
    const inscripciones = await import('../src/app/(app)/admin/inscripciones/actions');
    const normativa = await import('../src/app/(app)/admin/normativa/actions');
    const convocatorias = await import('../src/lib/callups/actions');

    const acciones: [string, () => Promise<unknown>][] = [
      ['listarClubes', () => usuarios.listarClubes()],
      ['ultimasAltas', () => usuarios.ultimasAltas()],
      ['plantillaCsv', () => usuarios.plantillaCsv()],
      ['previsualizarCsv', () => usuarios.previsualizarCsv('nombre;apellidos\na;b')],
      ['importarUsuarios', () => usuarios.importarUsuarios('nombre;apellidos\na;b')],
      ['crearUsuario', () => usuarios.crearUsuario(new FormData())],
      ['crearClub', () => usuarios.crearClub(new FormData())],
      ['clubesPorId', () => usuarios.clubesPorId([ctx.clubA])],
      ['resolverCuarentena', () => cuarentena.resolverCuarentena(ctx.eventoId)],
      ['resolverVarias', () => cuarentena.resolverVarias([ctx.eventoId])],
      ['reabrirCuarentena', () => cuarentena.reabrirCuarentena(ctx.eventoId)],
      ['contarPendientes', () => cuarentena.contarPendientes()],
      ['asignarResultado', () => emparejar.asignarResultado(ctx.eventoId, ctx.tiradorA)],
      ['asignarTodosConEseNombre', () => emparejar.asignarTodosConEseNombre('x', ctx.tiradorA)],
      ['desasignarResultado', () => emparejar.desasignarResultado(ctx.eventoId)],
      ['moverInscripciones', () => inscripciones.moverInscripciones([ctx.entryB], 'club_approved')],
      ['exportarInscripcionesCsv', () => inscripciones.exportarInscripcionesCsv([ctx.entryB])],
      ['guardarPlazo', () => normativa.guardarPlazo(new FormData())],
      ['borrarPlazo', () => normativa.borrarPlazo(ctx.eventoId)],
      ['guardarCategoria', () => normativa.guardarCategoria(new FormData())],
      ['borrarCategoria', () => normativa.borrarCategoria(ctx.eventoId)],
      ['guardarReglaRanking', () => normativa.guardarReglaRanking(new FormData())],
      ['borrarReglaRanking', () => normativa.borrarReglaRanking(ctx.eventoId)],
      ['crearTemporada', () => normativa.crearTemporada(new FormData())],
      ['marcarTemporadaActual', () => normativa.marcarTemporadaActual(ctx.eventoId)],
      ['historialDe', () => normativa.historialDe('season', ctx.eventoId)],
      ['crearConvocatoria', () => convocatorias.crearConvocatoria(new FormData())],
      ['guardarConvocados', () => convocatorias.guardarConvocados(ctx.convocatoriaB, [])],
      ['quitarConvocado', () => convocatorias.quitarConvocado(ctx.convocadoB)],
      ['publicarConvocatoria', () => convocatorias.publicarConvocatoria(ctx.convocatoriaB)],
      ['eliminarConvocatoria', () => convocatorias.eliminarConvocatoria(ctx.convocatoriaB)],
      ['pruebasDelEvento', () => convocatorias.pruebasDelEvento(ctx.eventoId)],
    ];

    const coladas: string[] = [];

    for (const perfil of [ctx.perfilCoach, ctx.perfilClubA, ctx.perfilTirador]) {
      await entrarComo(perfil);
      for (const [nombre, ejecutar] of acciones) {
        const resultado = await ejecutar().then(
          (v) => ({ lanzo: false, valor: v }),
          () => ({ lanzo: true, valor: null }),
        );
        // Válido rechazar lanzando (requireRole) o devolviendo ok:false.
        const rechazada =
          resultado.lanzo ||
          (typeof resultado.valor === 'object' &&
            resultado.valor !== null &&
            'ok' in resultado.valor &&
            (resultado.valor as { ok: boolean }).ok === false);
        if (!rechazada) coladas.push(`${nombre} con el perfil ${perfil}`);
      }
    }

    expect(coladas).toEqual([]);
  }, 120_000);

  it('sin sesión tampoco', async () => {
    const usuarios = await import('../src/app/(app)/admin/usuarios/actions');
    await entrarComo(null);
    await expect(usuarios.listarClubes()).rejects.toThrow('NO_AUTENTICADO');
  });
});

// ---------------------------------------------------------------------------
// 2. Endpoints HTTP: cron, ingestión de admin, feed iCal
// ---------------------------------------------------------------------------

describe('endpoints de cron (peticiones reales al servidor de desarrollo)', () => {
  const rutas = ['/api/cron/notify', '/api/cron/ingest/fie'];

  it('sin cabecera Authorization responden 401', async () => {
    for (const ruta of rutas) {
      const res = await fetch(`${BASE_URL}${ruta}`);
      expect(res.status, ruta).toBe(401);
    }
  });

  it('con un secreto equivocado responden 401', async () => {
    for (const ruta of rutas) {
      const res = await fetch(`${BASE_URL}${ruta}`, {
        headers: { Authorization: 'Bearer secreto-que-no-es' },
      });
      expect(res.status, ruta).toBe(401);
    }
  });

  it('con el secreto correcto la puerta se abre (fuente inexistente = 404, no 401)', async () => {
    const secreto = process.env.CRON_SECRET;
    expect(secreto, 'CRON_SECRET tiene que estar en el .env para auditar esto').toBeTruthy();

    // Fuente que no existe: prueba que pasó la autorización sin lanzar ningún
    // scraper de verdad contra las federaciones.
    const res = await fetch(`${BASE_URL}/api/cron/ingest/fuente-inexistente`, {
      headers: { Authorization: `Bearer ${secreto}` },
    });
    expect(res.status).toBe(404);
  });

  it('en PRODUCCIÓN sin CRON_SECRET se niega (503), no se abre', async () => {
    // Los módulos se cargan ANTES de tocar el entorno: importarlos arrastra
    // los scrapers enteros y tarda, y no queremos medir eso.
    const ingest = await import('../src/app/api/cron/ingest/[source]/route');
    const notify = await import('../src/app/api/cron/notify/route');

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');
    try {
      const r1 = await ingest.GET(new Request('http://x/api/cron/ingest/fie'), {
        params: Promise.resolve({ source: 'fie' }),
      });
      const r2 = await notify.GET(new Request('http://x/api/cron/notify'));

      expect(r1.status).toBe(503);
      expect(r2.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60_000);
});

describe('/api/admin/ingest exige sesión de admin', () => {
  it('sin sesión: 401', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/ingest?source=fie`, { method: 'POST' });
    expect(res.status).toBe(401);
    const cuerpo = (await res.json()) as { ok: boolean };
    expect(cuerpo.ok).toBe(false);
  });

  it('con una cookie inventada: 401 (no se acepta cualquier cosa)', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/ingest?source=fie`, {
      method: 'POST',
      headers: { Cookie: '__Secure-neon-auth.session_token=inventada' },
    });
    expect(res.status).toBe(401);
  });
});

describe('feed iCal: ligado al token y nada más', () => {
  it('un token desconocido da 404 seco, no un calendario vacío', async () => {
    const res = await fetch(`${BASE_URL}/api/calendario/${'a'.repeat(40)}.ics`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/calendar');
  });

  it('un token demasiado corto ni siquiera toca la base', async () => {
    const res = await fetch(`${BASE_URL}/api/calendario/abc.ics`);
    expect(res.status).toBe(404);
  });

  it('cada token ve SOLO sus convocatorias', async () => {
    const [a] = await db
      .select({ token: esquema.userProfile.icalToken })
      .from(esquema.userProfile)
      .where(eqId(esquema.userProfile.id, ctx.perfilOtro));
    const [b] = await db
      .select({ token: esquema.userProfile.icalToken })
      .from(esquema.userProfile)
      .where(eqId(esquema.userProfile.id, ctx.perfilTirador));

    const feedOtro = await (
      await fetch(`${BASE_URL}/api/calendario/${a.token}.ics?tipo=convocatorias`)
    ).text();
    const feedTirador = await (
      await fetch(`${BASE_URL}/api/calendario/${b.token}.ics?tipo=convocatorias`)
    ).text();

    // El convocado es el tirador B; el A no está convocado a nada.
    expect(feedOtro).toContain('BEGIN:VEVENT');
    expect(feedTirador).not.toContain('BEGIN:VEVENT');
  });

  it('el feed no lleva nombres ni correos de nadie', async () => {
    const [a] = await db
      .select({ token: esquema.userProfile.icalToken })
      .from(esquema.userProfile)
      .where(eqId(esquema.userProfile.id, ctx.perfilOtro));

    const feed = await (
      await fetch(`${BASE_URL}/api/calendario/${a.token}.ics?tipo=convocatorias`)
    ).text();

    expect(feed).not.toContain('Bruno');
    expect(feed).not.toContain(correo('otro'));
    expect(feed).not.toMatch(/@pruebas\.local/);
  });

  it('se sirve con caché privada y sin indexar: la URL lleva la credencial', async () => {
    const [a] = await db
      .select({ token: esquema.userProfile.icalToken })
      .from(esquema.userProfile)
      .where(eqId(esquema.userProfile.id, ctx.perfilOtro));

    const res = await fetch(`${BASE_URL}/api/calendario/${a.token}.ics`);
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('el token no es adivinable: 200 valores distintos, hexadecimal, 40 caracteres', async () => {
    const { newIcalToken } = await import('../src/lib/auth/session');
    const generados = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const t = newIcalToken();
      expect(t).toMatch(/^[0-9a-f]{40}$/);
      generados.add(t);
    }
    expect(generados.size).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3. Fugas de datos personales
// ---------------------------------------------------------------------------

function ficherosFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) ficherosFuente(ruta, acc);
    else if (/\.(ts|tsx)$/.test(nombre)) acc.push(ruta);
  }
  return acc;
}

const FUENTES = ficherosFuente(join(RAIZ, 'src')).map((ruta) => ({
  ruta,
  texto: readFileSync(ruta, 'utf8'),
}));

/** Quita comentarios para que un ejemplo escrito en la documentación no falle. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('ningún dato personal viaja en la URL', () => {
  it('no se construye ninguna URL con el correo dentro', () => {
    const culpables: string[] = [];
    for (const { ruta, texto } of FUENTES) {
      const codigo = sinComentarios(texto);
      // `?email=` / `&email=` / `?correo=` en cualquier cadena o plantilla.
      const encontrado = codigo.match(/[?&](email|correo|dni|licencia|telefono)=/gi);
      if (encontrado) culpables.push(`${ruta}: ${encontrado.join(', ')}`);
    }
    expect(culpables).toEqual([]);
  });

  it('las rutas dinámicas son ids opacos, no nombres ni correos', () => {
    const rutas = ficherosFuente(join(RAIZ, 'src', 'app'))
      .map((r) => r.replace(RAIZ, ''))
      .filter((r) => r.includes('['));
    for (const r of rutas) {
      expect(r, r).not.toMatch(/\[(email|correo|nombre|dni|licencia)/i);
    }
  });
});

describe('los registros (console.*) no llevan credenciales ni correos', () => {
  it('ninguna llamada a console interpola algo que huela a secreto', () => {
    const sospechoso =
      /(email|correo|password|contrase|token|secret|apiKey|api_key|credencial|cookie|authorization)/i;
    const culpables: string[] = [];

    for (const { ruta, texto } of FUENTES) {
      const codigo = sinComentarios(texto);
      for (const llamada of codigo.match(/console\.\w+\([\s\S]*?\);/g) ?? []) {
        // Solo lo interpolado (`${...}`) y los argumentos, no el texto fijo:
        // "falta RESEND_API_KEY" es un mensaje legítimo.
        const interpolado = (llamada.match(/\$\{([^}]*)\}/g) ?? []).join(' ');
        if (sospechoso.test(interpolado)) culpables.push(`${ruta}: ${llamada.slice(0, 120)}`);
      }
    }

    expect(culpables).toEqual([]);
  });

  it('el saneado de Skermo tacha de verdad, y en profundidad', async () => {
    const { sanearParaRegistro } = await import('../src/lib/skermo/client');

    const saneado = sanearParaRegistro({
      url: 'https://app.skermo.org/x',
      cabeceras: { Cookie: 'laravel_session=abc', Accept: 'text/html' },
      campos: { _token: 'csrf-real-123', password: 'hunter2', licencia: 'ES123' },
      anidado: [{ authorization: 'Bearer zzz' }, { clave: 'contraseña-secreta' }],
    }) as Record<string, unknown>;

    const texto = JSON.stringify(saneado);
    expect(texto).not.toContain('laravel_session');
    expect(texto).not.toContain('csrf-real-123');
    expect(texto).not.toContain('hunter2');
    expect(texto).not.toContain('Bearer zzz');
    expect(texto).not.toContain('contraseña-secreta');
    // Y lo que NO es secreto se conserva: si tachara todo sería inútil.
    expect(texto).toContain('ES123');
    expect(texto).toContain('text/html');
  });

  it('redactar() no deja ni una pista del secreto', async () => {
    const { redactar } = await import('../src/lib/skermo/credentials');
    expect(redactar('SuperSecreta2026')).toBe('[omitido]');
    expect(redactar('SuperSecreta2026')).not.toContain('Super');
  });
});

// ---------------------------------------------------------------------------
// 4. Inyección y contenido no confiable
// ---------------------------------------------------------------------------

describe('inyección', () => {
  it('no hay HTML de fuentes externas renderizado sin escapar', () => {
    const culpables = FUENTES.filter(({ texto }) =>
      /dangerouslySetInnerHTML/.test(sinComentarios(texto)),
    ).map((f) => f.ruta);
    expect(culpables).toEqual([]);
  });

  it('no hay SQL construido concatenando entrada del usuario', () => {
    const culpables: string[] = [];
    for (const { ruta, texto } of FUENTES) {
      const codigo = sinComentarios(texto);
      // `sql.raw` con cualquier cosa que no sea una cadena literal.
      for (const uso of codigo.match(/sql\.raw\(([^)]*)\)/g) ?? []) {
        if (!/sql\.raw\(\s*['"`][^$]*['"`]\s*\)/.test(uso)) culpables.push(`${ruta}: ${uso}`);
      }
      // Concatenación dentro de una plantilla `sql` (lo parametrizado usa ${}).
      for (const uso of codigo.match(/sql`[^`]*`\s*\+/g) ?? []) {
        culpables.push(`${ruta}: ${uso}`);
      }
      if (/db\.execute\(\s*['"]/.test(codigo)) culpables.push(`${ruta}: db.execute con cadena`);
    }
    expect(culpables).toEqual([]);
  });

  it('el extractor de PDF trata el documento como texto, nunca como órdenes', async () => {
    const extract = await import('../src/lib/ai/extract');
    const modulo = readFileSync(join(RAIZ, 'src', 'lib', 'ai', 'extract.ts'), 'utf8');

    // El documento va delimitado y declarado como no confiable.
    expect(modulo).toMatch(/no\s+(es\s+)?(de\s+)?confian|no confiable|NO CONFIABLE/i);

    /**
     * La defensa que de verdad importa no es el prompt sino el cotejo: nada
     * que el modelo devuelva entra sin que la cita esté LITERALMENTE en el
     * documento. Una orden metida en el PDF puede convencer al modelo, pero no
     * puede fabricar una cita que el documento no contiene.
     */
    const verificada = extract.verificarCita(
      'El plazo de inscripción termina el 12 de marzo',
      'Bla bla. El plazo de inscripción termina el 12 de marzo. Bla.',
    );
    expect(verificada).toBe(true);

    expect(
      extract.verificarCita(
        'La cuota es de 300 euros',
        'Bla bla. El plazo de inscripción termina el 12 de marzo. Bla.',
      ),
    ).toBe(false);
  });
});
