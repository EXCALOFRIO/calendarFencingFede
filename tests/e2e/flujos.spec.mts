import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { db } from '../../src/db';
import { entry, userProfile } from '../../src/db/schema';
import { listEvents } from '../../src/lib/queries/calendar';
import {
  crearClubes,
  crearConvocatoriaBorrador,
  crearInscripcion,
  crearTirador,
  leerInscripcion,
  limpiar,
} from './fixtures.mjs';
import { BASE_URL } from './sesion.js';
import { cabeceraCookie, entrarComo } from './sesiones.mjs';
import {
  caso,
  comprobar,
  comprobarIgual,
  ir,
  nota,
  nuevaSesion,
  recoger,
  reintentar,
  resumen,
  rutasDePagina,
  textoDe,
  type ErrorDeNavegador,
} from './utilidades.mjs';
import { fileURLToPath } from 'node:url';

/**
 * Flujos completos de extremo a extremo con un navegador real.
 *
 * Se ejecuta con `npx tsx tests/e2e/flujos.spec.mts [bloques]` contra el
 * `next dev` que ya esté levantado. Usa los datos reales de la base y solo
 * añade lo imprescindible para poder probar el flujo de inscripción: dos
 * clubes y dos tiradores, todos con la marca `e2e-`, que se borran al acabar.
 *
 * Las comprobaciones se apoyan en la BASE DE DATOS siempre que se puede, y en
 * el texto de la pantalla solo cuando lo que se prueba ES el texto (estados
 * vacíos y explicaciones). Así la interfaz puede rediseñarse sin invalidar las
 * pruebas de los flujos.
 */

const VIEWPORT = { width: 1280, height: 900 };

/**
 * Rutas de página de la aplicación. Se descubren al arrancar leyendo
 * `src/app`, no se escriben a mano: así la lista sigue siendo la de verdad
 * aunque se añadan o se muevan pantallas.
 */
let RUTAS_PAGINA: string[] = [];

/** Ruta de "Mi estado": la portada o `/estado`, según cómo esté montada. */
let RUTA_ESTADO = '/';

/** Ruta del calendario: `/calendario` o la portada, según el montaje. */
let RUTA_CALENDARIO = '/calendario';

/**
 * Rutas que TIENEN que estar cerradas para cada rol.
 *
 * Se afirma solo sobre lo que la aplicación promete (`/admin` para
 * administración y `/club` para club y administración); del resto no se
 * exige acceso, porque si alguien añade una pantalla con otro criterio la
 * prueba no debe fallar por eso, solo avisar.
 */
function debeEstarCerrada(rol: string, ruta: string): boolean {
  if (ruta.startsWith('/admin')) return rol !== 'admin';
  if (ruta === '/club') return rol !== 'admin' && rol !== 'club';
  return false;
}

type Ctx = {
  browser: Browser;
  clubAlfa: string;
  clubBeta: string;
  tiradorAlfa: string;
  tiradorBeta: string;
  perfilTirador: string;
  perfilAdmin: string;
  perfilClubAlfa: string;
  perfilClubBeta: string;
  competicion: {
    id: string;
    eventoId: string;
    eventoNombre: string;
    etiqueta: string;
    inicio: string;
  };
  /** Segunda prueba abierta, para probar el envío directo de la acción. */
  competicion2: { id: string; eventoNombre: string; inicio: string } | null;
  eventoFicha: { id: string; nombre: string; inicio: string };
};

/**
 * Petición capturada de la acción de servidor `requestEntry`.
 *
 * Se guarda tal cual la manda el navegador del tirador para poder repetirla
 * después con la sesión de OTRA persona. Así se comprueba la autorización del
 * servidor y no solo que la pantalla no pinte el botón.
 */
let peticionSolicitud: {
  url: string;
  cabeceras: Record<string, string>;
  cuerpo: string;
} | null = null;

const erroresGlobales: { ruta: string; rol: string; tipo: string; texto: string }[] = [];

function anotarErrores(rol: string, ruta: string, errores: ErrorDeNavegador[]) {
  for (const e of recoger(errores)) {
    erroresGlobales.push({ ruta, rol, tipo: e.tipo, texto: e.texto.slice(0, 400) });
    nota(`⚠ ${rol} en ${ruta}: [${e.tipo}] ${e.texto.slice(0, 200)}`);
  }
}

async function contexto(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: VIEWPORT, locale: 'es-ES' });
}

/**
 * Busca un evento en el calendario y abre su ficha lateral.
 *
 * Con reintentos porque en `next dev` el bundle puede llegar después del
 * primer clic y entonces el botón todavía no responde: sin esto, un fallo de
 * hidratación tardía se confunde con un fallo de la aplicación.
 */
async function abrirFicha(page: Page, nombre: string, fechaIso?: string) {
  const panel = page.getByRole('dialog').filter({ hasText: new RegExp(nombre, 'i') });
  const fichaAbierta = async () =>
    (await panel.count()) > 0 && (await panel.first().isVisible());

  // El buscador se localiza por su papel, no por una clase ni un id: así
  // sobrevive a un rediseño mientras siga siendo un campo de búsqueda.
  const buscador = page
    .locator('input[type="search"][aria-label*="Buscar"], input[aria-label*="Buscar torneo"]')
    .first();

  /**
   * "Lo mío" viene activado y deja fuera lo que no es del arma o la categoría
   * del tirador. Para buscar una prueba concreta hay que quitarlo; lo que se
   * puede o no solicitar sigue mandándolo el servidor, no este filtro.
   */
  const loMio = page.locator('button[aria-pressed="true"]').filter({ hasText: /Lo m[íi]o/i });
  await reintentar(
    async () => {
      if ((await loMio.count()) > 0) await loMio.first().click();
    },
    async () => (await loMio.count()) === 0,
    3,
    800,
  );

  if ((await buscador.count()) > 0) {
    await buscador.fill('').catch(() => null);
    await buscador.fill(nombre).catch(() => null);
    await page.waitForTimeout(800);
  }

  /**
   * Camino 1: la pantalla lista los eventos y se puede pulsar el nombre
   * directamente (así era el calendario en lista).
   */
  const porNombre = () => page.getByRole('button').filter({ hasText: nombre });
  const directos = Math.min(await porNombre().count(), 6);
  for (let i = 0; i < directos; i += 1) {
    await porNombre().nth(i).click({ timeout: 1500 }).catch(() => null);
    await page.waitForTimeout(900);
    if (await fichaAbierta()) return panel.first();
    // Si lo que se abrió fue la hoja del día, dentro estará la fila del evento.
    const fila = page.getByRole('dialog').getByRole('button').filter({ hasText: nombre });
    if ((await fila.count()) > 0) {
      await fila.first().click().catch(() => null);
      await page.waitForTimeout(900);
      if (await fichaAbierta()) return panel.first();
    }
  }

  /**
   * Camino 2: rejilla mensual. Se avanza hasta el mes de la competición y se
   * pulsa la casilla de su día, que abre la hoja con los eventos de ese día.
   */
  if (fechaIso) {
    const objetivo = new Date(`${fechaIso}T12:00:00Z`);
    const hoy = new Date();
    const saltos =
      (objetivo.getUTCFullYear() - hoy.getFullYear()) * 12 +
      (objetivo.getUTCMonth() - hoy.getMonth());

    const boton = saltos >= 0 ? 'Siguiente' : 'Anterior';
    for (let i = 0; i < Math.abs(saltos); i += 1) {
      await page.getByRole('button', { name: boton, exact: true }).first().click().catch(() => null);
      await page.waitForTimeout(500);
    }

    const dia = objetivo.getUTCDate();
    const celda = page.locator(`button[aria-label^="${dia}: "]`).first();
    for (let intento = 0; intento < 3; intento += 1) {
      await celda.click({ timeout: 1500 }).catch(() => null);
      await page.waitForTimeout(900);

      const fila = page.getByRole('dialog').getByRole('button').filter({ hasText: nombre });
      if ((await fila.count()) > 0) {
        await fila.first().click().catch(() => null);
        await page.waitForTimeout(900);
      }
      if (await fichaAbierta()) return panel.first();
    }
  }

  comprobar(false, `No se llega a la ficha de "${nombre}" desde el calendario`);
  return panel.first();
}

/**
 * Abre "Mi estado" sin depender de en qué ruta esté montada.
 *
 * Devuelve la primera de las candidatas cuyo texto case con el marcador; si
 * ninguna casa, la última visitada, para poder enseñarla en el fallo.
 */
async function abrirEstado(
  page: Page,
  marcador: RegExp,
): Promise<{ ruta: string; status: number | undefined; texto: string; casa: boolean }> {
  const candidatas = RUTA_ESTADO === '/' ? ['/'] : [RUTA_ESTADO, '/'];
  let ultimo = { ruta: '/', status: undefined as number | undefined, texto: '', casa: false };

  for (const ruta of candidatas) {
    const res = await ir(page, `${BASE_URL}${ruta}`);
    const texto = await textoDe(page);
    ultimo = { ruta, status: res?.status(), texto, casa: marcador.test(texto) };
    if (ultimo.casa) return ultimo;
  }
  return ultimo;
}

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------

/**
 * Comprobación previa: que la aplicación compile.
 *
 * Si `next dev` tiene un error de compilación, TODAS las rutas (incluidas las
 * de API) devuelven 500, y entonces la tanda produce veinte fallos que no son
 * fallos de la aplicación sino del momento. Mejor parar aquí y decirlo.
 */
async function comprobarQueLaAppResponde(): Promise<void> {
  let ultimo = 0;
  for (let intento = 0; intento < 3; intento += 1) {
    const res = await fetch(`${BASE_URL}/entrar`, { redirect: 'manual' }).catch(() => null);
    ultimo = res?.status ?? 0;
    if (ultimo > 0 && ultimo < 500) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    `El servidor de desarrollo devuelve ${ultimo} en /entrar: la aplicación no ` +
      'compila ahora mismo. Arréglalo (o espera a que termine quien la esté ' +
      'tocando) antes de lanzar las pruebas; si no, todos los casos fallarían ' +
      'por el mismo motivo y no se vería nada útil.',
  );
}

async function preparar(): Promise<Ctx> {
  await comprobarQueLaAppResponde();

  console.log('Limpiando restos de ejecuciones anteriores…');
  console.log('  ' + ((await limpiar()).join(', ') || 'nada que borrar'));

  const raizApp = fileURLToPath(new URL('../../src/app', import.meta.url));
  const todas = await rutasDePagina(raizApp);
  // `/entrar` se prueba aparte (es la única pública) y las rutas dinámicas se
  // recorren con un identificador real más abajo.
  RUTAS_PAGINA = todas.filter((r) => r !== '/entrar' && !r.includes('['));
  RUTA_ESTADO = todas.includes('/estado') ? '/estado' : '/';
  RUTA_CALENDARIO = todas.includes('/calendario') ? '/calendario' : '/';
  console.log(`\nRutas descubiertas (${RUTAS_PAGINA.length}): ${RUTAS_PAGINA.join(' ')}`);
  console.log(`"Mi estado" en ${RUTA_ESTADO} · calendario en ${RUTA_CALENDARIO}`);

  const browser = await chromium.launch();
  const { alfa, beta } = await crearClubes();

  // Un único inicio de sesión por rol; después se reutiliza la cookie.
  const ctxTmp = await contexto(browser);
  const pTirador = await entrarComo(ctxTmp, 'flujo-tirador', 'athlete', { clubId: alfa });
  const pAdmin = await entrarComo(ctxTmp, 'flujo-admin', 'admin', { clubId: null });
  const pClubAlfa = await entrarComo(ctxTmp, 'flujo-club-alfa', 'club', { clubId: alfa });
  const pClubBeta = await entrarComo(ctxTmp, 'flujo-club-beta', 'club', { clubId: beta });
  await entrarComo(ctxTmp, 'flujo-coach', 'coach', { armas: ['ESPADA'], clubId: null });
  await entrarComo(ctxTmp, 'flujo-guardian', 'guardian', { clubId: null });
  await entrarComo(ctxTmp, 'flujo-huerfano', 'athlete', { clubId: alfa });
  await ctxTmp.close();

  // Tirador de verdad: nacido en 2008 → le toca M20 y puede subir a M23 y ABS.
  const tiradorAlfa = await crearTirador({
    nombre: 'Álvaro',
    apellido: 'Flujos Alfa',
    nacimiento: '2008-03-15',
    genero: 'M',
    clubId: alfa,
    licencia: 'E2EFLUJO-ALFA',
    armas: ['ESPADA'],
    perfilId: pTirador.profileId,
  });

  const tiradorBeta = await crearTirador({
    nombre: 'Berta',
    apellido: 'Flujos Beta',
    nacimiento: '2008-07-02',
    genero: 'F',
    clubId: beta,
    licencia: 'E2EFLUJO-BETA',
    armas: ['ESPADA'],
  });

  // Prueba real, con plazo abierto, de espada masculina en una categoría suya.
  const eventos = await listEvents({ limit: 500 });
  const candidatas = eventos.flatMap((e) =>
    e.competitions
      .filter(
        (c) =>
          !c.status.closed &&
          c.weapon === 'ESPADA' &&
          c.gender === 'M' &&
          ['M20', 'M23', 'ABS'].includes(c.category),
      )
      .map((c) => ({
        id: c.id,
        eventoId: e.id,
        eventoNombre: e.name,
        etiqueta: `${c.weapon} ${c.gender} ${c.category}`,
        inicio: e.startDate,
      })),
  );

  if (candidatas.length === 0) {
    throw new Error('No hay ninguna prueba abierta de espada masculina en los datos.');
  }
  const competicion = candidatas[0];

  const conTodo =
    eventos.find((e) => e.documents.length > 0 && e.sourceUrl && (e.venue || e.city)) ??
    eventos.find((e) => e.sourceUrl) ??
    eventos[0];

  console.log('\nDatos preparados:');
  console.log(`  clubes: alfa=${alfa} beta=${beta}`);
  console.log(`  prueba: ${competicion.eventoNombre} (${competicion.etiqueta}, ${competicion.inicio})`);
  console.log(`  ficha:  ${conTodo.name}`);

  return {
    browser,
    clubAlfa: alfa,
    clubBeta: beta,
    tiradorAlfa,
    tiradorBeta,
    perfilTirador: pTirador.profileId,
    perfilAdmin: pAdmin.profileId,
    perfilClubAlfa: pClubAlfa.profileId,
    perfilClubBeta: pClubBeta.profileId,
    competicion,
    /**
     * La segunda prueba tiene que estar en OTRO evento: si estuviera en el
     * mismo, la ficha ya mostraría la inscripción hecha y no habría botón que
     * pulsar para capturar la llamada a la acción.
     */
    competicion2: (() => {
      const otra = candidatas.find(
        (x) =>
          x.eventoId !== competicion.eventoId &&
          x.eventoNombre !== competicion.eventoNombre,
      );
      return otra
        ? { id: otra.id, eventoNombre: otra.eventoNombre, inicio: otra.inicio }
        : null;
    })(),
    eventoFicha: { id: conTodo.id, nombre: conTodo.name, inicio: conTodo.startDate },
  };
}

// ---------------------------------------------------------------------------
// 1. Flujo del tirador
// ---------------------------------------------------------------------------

async function flujoTirador(c: Ctx) {
  await caso('1a. "Mi estado" de un tirador sin ficha vinculada lo explica', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-huerfano', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);

    const r = await abrirEstado(page, /ning[úu]n tirador|sin tirador|no tiene.*tirador/i);
    comprobarIgual(r.status, 200, `HTTP de "Mi estado" (${r.ruta})`);
    comprobar(
      r.casa,
      `No aparece la explicación de cuenta sin tirador en ${r.ruta}. Texto: ${r.texto.slice(0, 400)}`,
    );
    comprobar(
      /calendario/i.test(r.texto),
      'El estado vacío no ofrece ninguna salida (enlace al calendario)',
    );
    comprobar(r.texto.length > 80, 'La pantalla está prácticamente en blanco');
    anotarErrores('athlete', r.ruta, errores);
    await ctx.close();
  });

  await caso('1b. La ficha de una prueba muestra sede, plazos, documentos y fuente', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-huerfano', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);

    await ir(page, `${BASE_URL}${RUTA_CALENDARIO}`);
    const panel = await abrirFicha(page, c.eventoFicha.nombre, c.eventoFicha.inicio);
    const texto = (await panel.innerText()).replace(/\s+/g, ' ');

    /**
     * Se comprueba el CONTENIDO (sede, pruebas, documentos, plazo y origen),
     * no los títulos concretos: la ficha se puede rediseñar, pero esos cinco
     * datos tienen que seguir estando.
     */
    const evento = (await listEvents({ limit: 500 })).find((e) => e.id === c.eventoFicha.id);
    comprobar(evento, 'El evento de la ficha ya no está en el calendario');

    const sede = evento!.venue ?? evento!.city ?? '';
    comprobar(
      sede === '' || texto.toLowerCase().includes(sede.toLowerCase().slice(0, 12)),
      `La ficha no dice dónde es (esperaba "${sede}"). Texto: ${texto.slice(0, 400)}`,
    );

    const arma = evento!.competitions[0];
    comprobar(
      new RegExp(arma.category, 'i').test(texto) ||
        /espada|florete|sable/i.test(texto),
      'La ficha no lista las pruebas del evento',
    );

    comprobar(
      evento!.documents.length === 0 ||
        texto.toLowerCase().includes(evento!.documents[0].title.toLowerCase().slice(0, 15)),
      `La ficha no enseña los ${evento!.documents.length} documentos del evento`,
    );

    comprobar(
      /le[íi]do|fuente/i.test(texto),
      `Falta la trazabilidad de la fuente. Texto: ${texto.slice(0, 400)}`,
    );
    comprobar(
      /Quedan \d+ d[íi]a|cerrada|no publicado|vencid|Cierre|plazo/i.test(texto),
      `La ficha no dice nada del plazo. Texto: ${texto.slice(0, 500)}`,
    );

    // El enlace a la fuente tiene que llevar a una URL real, no a un "#".
    const enlaces = await panel.locator('a[href^="http"]').evaluateAll((as) =>
      as.map((a) => (a as HTMLAnchorElement).href),
    );
    comprobar(
      enlaces.some((h) => h.includes('skermo') || h.includes('esgrima') || h.includes('fie')),
      `Ningún enlace de la ficha apunta a la fuente oficial: ${enlaces.slice(0, 5).join(', ')}`,
    );
    nota(`ficha de «${c.eventoFicha.nombre}»: sede, pruebas, documentos, plazo y fuente`);

    anotarErrores('athlete', '/calendario (ficha)', errores);
    await ctx.close();
  });
}

// ---------------------------------------------------------------------------
// 2. Flujo de inscripción completo
// ---------------------------------------------------------------------------

async function flujoInscripcion(c: Ctx) {
  await caso('2a. El tirador solicita la inscripción desde el calendario', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);

    await ir(page, `${BASE_URL}${RUTA_CALENDARIO}`);
    const panel = await abrirFicha(page, c.competicion.eventoNombre, c.competicion.inicio);

    const boton = panel.getByRole('button', { name: /Solicitar inscripci[óo]n/i }).first();
    comprobar(
      await boton.count(),
      'No hay botón de solicitud: el tirador no puede inscribirse en una prueba de su arma y su categoría',
    );

    // La comprobación de verdad es la fila en la base, no el mensaje.
    const enviada = await reintentar(
      async () => {
        await boton.click();
      },
      async () => (await leerInscripcion(c.tiradorAlfa, c.competicion.id)) !== null,
      4,
      2500,
    );

    const est = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
    comprobar(enviada && est, `No se creó la inscripción. Pantalla: ${(await textoDe(page)).slice(0, 400)}`);
    comprobarIgual(est!.entrada.status, 'pending_club', 'Estado de la inscripción');
    comprobarIgual(est!.entrada.requestedByProfileId, c.perfilTirador, 'Quién la solicitó');
    comprobar(est!.entrada.requestedAt, 'No se ha guardado requested_at');
    comprobarIgual(est!.log.length, 1, 'Filas en entry_event_log');
    comprobarIgual(est!.log[0].fromStatus, null, 'from_status de la primera fila del log');
    comprobarIgual(est!.log[0].toStatus, 'pending_club', 'to_status de la primera fila');
    comprobarIgual(est!.log[0].actorProfileId, c.perfilTirador, 'Actor del log');
    nota('entry en pending_club, con requested_at, actor y 1 fila de auditoría');

    anotarErrores('athlete', '/calendario (solicitar)', errores);
    await ctx.close();
  });

  await caso('2b. "Mi estado" dice que la pelota está en el club', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);

    const r = await abrirEstado(page, new RegExp(c.competicion.eventoNombre, 'i'));
    comprobar(
      r.casa,
      `La inscripción no aparece en "Mi estado" (${r.ruta}). Texto: ${r.texto.slice(0, 500)}`,
    );
    comprobar(
      /tu club|club/i.test(r.texto),
      `No dice que la pelota está en el club. Texto: ${r.texto.slice(0, 700)}`,
    );
    anotarErrores('athlete', `${r.ruta} (tras solicitar)`, errores);
    await ctx.close();
  });

  await caso('2c. El club valida la solicitud', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-club-alfa', 'club', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);

    const res = await ir(page, `${BASE_URL}/club`);
    comprobarIgual(res?.status(), 200, 'HTTP de la bandeja del club');
    comprobar(
      (await textoDe(page)).includes('Álvaro'),
      'La solicitud no aparece en la bandeja de su club',
    );

    const tarjeta = page.getByRole('button').filter({ hasText: 'Álvaro Flujos Alfa' }).first();
    const validar = page.getByRole('button', { name: /^Validar/ }).first();

    const seleccionada = await reintentar(
      async () => {
        await tarjeta.click();
      },
      async () => (await validar.count()) > 0 && (await validar.isVisible()),
    );
    comprobar(seleccionada, 'No aparece la acción de validar al marcar la solicitud');

    await reintentar(
      async () => {
        await validar.click();
      },
      async () => {
        const e = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
        return e?.entrada.status === 'club_approved';
      },
      3,
      2500,
    );

    const est = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
    comprobarIgual(est!.entrada.status, 'club_approved', 'Estado tras validar el club');
    comprobarIgual(est!.log.length, 2, 'Filas en entry_event_log tras validar');
    comprobarIgual(est!.log[1].fromStatus, 'pending_club', 'from_status del segundo log');
    comprobarIgual(est!.log[1].actorProfileId, c.perfilClubAlfa, 'Actor de la validación');
    comprobarIgual(
      est!.entrada.clubDecidedByProfileId,
      c.perfilClubAlfa,
      'club_decided_by_profile_id',
    );
    comprobar(est!.entrada.clubDecidedAt, 'No se ha guardado club_decided_at');
    nota('club_approved, con decisor y fecha, y 2 filas de auditoría');

    anotarErrores('club', '/club (validar)', errores);
    await ctx.close();
  });

  await caso('2d. "Mi estado" pasa a esperar a la RFEE', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);
    const r = await abrirEstado(page, /RFEE/);
    comprobar(
      r.casa,
      `No refleja la validación del club en ${r.ruta}. Texto: ${r.texto.slice(0, 700)}`,
    );
    anotarErrores('athlete', `${r.ruta} (validada)`, errores);
    await ctx.close();
  });

  await caso('2e. La federación aprueba desde la bandeja de administración', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-admin', 'admin', { clubId: null });
    const { page, errores } = await nuevaSesion(ctx);

    const res = await ir(page, `${BASE_URL}/admin/inscripciones`);
    comprobarIgual(res?.status(), 200, 'HTTP de la bandeja federativa');
    comprobar(
      (await textoDe(page)).includes('Álvaro'),
      'La inscripción validada por el club no llega a la bandeja de la federación',
    );

    /**
     * La bandeja puede tener más inscripciones (las de demostración, por
     * ejemplo), así que se busca la casilla DE ESTA inscripción: primero por
     * su etiqueta accesible y, si la interfaz cambia, por la fila que lleva
     * el nombre del tirador.
     */
    const porPapel = page.getByRole('checkbox', { name: /Álvaro/i });
    const porEtiqueta = page.locator(
      '[role="checkbox"][aria-label*="Álvaro"], input[type=checkbox][aria-label*="Álvaro"]',
    );
    const porFila = page
      .locator('tr, li')
      .filter({ hasText: /Álvaro Flujos Alfa/i })
      .locator('[role="checkbox"], input[type=checkbox]');

    let casilla = porPapel.first();
    if ((await porPapel.count()) === 0) {
      casilla = (await porEtiqueta.count()) > 0 ? porEtiqueta.first() : porFila.first();
    }
    comprobar(await casilla.count(), 'No se localiza la casilla de la inscripción del tirador');

    const aprobar = page.getByRole('button', { name: /^Aprobar/ }).first();

    const marcada = await reintentar(
      async () => {
        await casilla.click();
      },
      async () => (await aprobar.count()) > 0 && (await aprobar.isVisible()),
    );
    comprobar(marcada, 'No aparece la acción de aprobar al marcar la inscripción');

    await reintentar(
      async () => {
        await aprobar.click();
      },
      async () => {
        const e = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
        return e?.entrada.status === 'federation_approved';
      },
      3,
      2500,
    );

    const est = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
    comprobarIgual(est!.entrada.status, 'federation_approved', 'Estado tras aprobar');
    comprobarIgual(est!.log.length, 3, 'Filas en entry_event_log tras aprobar');
    comprobarIgual(est!.log[2].fromStatus, 'club_approved', 'from_status del tercer log');
    comprobarIgual(est!.log[2].toStatus, 'federation_approved', 'to_status del tercer log');
    comprobarIgual(est!.log[2].actorProfileId, c.perfilAdmin, 'Actor de la aprobación');
    comprobar(est!.entrada.federationDecidedAt, 'No se ha guardado federation_decided_at');
    nota('federation_approved, con decisor y fecha, y 3 filas de auditoría');

    anotarErrores('admin', '/admin/inscripciones (aprobar)', errores);
    await ctx.close();
  });

  await caso('2f. "Mi estado" refleja la aprobación de la RFEE', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);
    const r = await abrirEstado(page, /env[íi]o a la organizaci[óo]n|organizaci[óo]n|Aceptada por la RFEE/i);
    comprobar(
      r.casa,
      `No refleja la aprobación federativa en ${r.ruta}. Texto: ${r.texto.slice(0, 800)}`,
    );
    anotarErrores('athlete', `${r.ruta} (aprobada)`, errores);
    await ctx.close();
  });
}

// ---------------------------------------------------------------------------
// 3. Permisos
// ---------------------------------------------------------------------------

/** ¿La página ha dejado pasar al contenido protegido o lo ha bloqueado? */
function bloqueada(status: number | undefined, texto: string): boolean {
  if (status === undefined) return false;
  if (status >= 400) return true;
  return (
    /solo para administraci[óo]n/i.test(texto) ||
    /Esta pantalla es para/i.test(texto) ||
    /no tiene permisos/i.test(texto) ||
    /NO_AUTENTICADO/.test(texto)
  );
}

async function permisos(c: Ctx) {
  const cerrada = async (
    etiqueta: string,
    rol: 'athlete' | 'club' | 'coach' | 'guardian',
    clubId: string | null,
    ruta: string,
    marcador: RegExp,
  ) => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, etiqueta, rol, { clubId });
    const { page, errores } = await nuevaSesion(ctx);
    const res = await ir(page, `${BASE_URL}${ruta}`);
    const texto = await textoDe(page);
    recoger(errores);
    await ctx.close();
    return { status: res?.status(), texto, filtrado: marcador.test(texto) };
  };

  await caso('3a. Un tirador no entra en /admin', async () => {
    const r = await cerrada('flujo-tirador', 'athlete', c.clubAlfa, '/admin', /Salud de las fuentes/i);
    nota(`/admin como athlete → HTTP ${r.status}`);
    comprobar(bloqueada(r.status, r.texto), `Un tirador ve /admin: ${r.texto.slice(0, 300)}`);
    comprobar(!r.filtrado, 'Un tirador ve el contenido del panel de administración');
  });

  await caso('3b. Un tirador no entra en /club', async () => {
    const r = await cerrada('flujo-tirador', 'athlete', c.clubAlfa, '/club', /Valida aqu[íi] las solicitudes/i);
    nota(`/club como athlete → HTTP ${r.status}`);
    comprobar(bloqueada(r.status, r.texto), `Un tirador ve /club: ${r.texto.slice(0, 300)}`);
    comprobar(!r.filtrado, 'Un tirador ve la bandeja de validación del club');
    // Bloquear con un error del framework no es bloquear bien: el 500 también
    // se registra como incidencia en el panel y no explica nada al usuario.
    comprobar(
      r.status !== 500,
      '/club bloquea con un 500 del framework en vez de con una pantalla explicativa',
    );
  });

  await caso('3c. Un responsable de club no entra en /admin', async () => {
    const r = await cerrada('flujo-club-beta', 'club', c.clubBeta, '/admin', /Salud de las fuentes/i);
    nota(`/admin como club → HTTP ${r.status}`);
    comprobar(bloqueada(r.status, r.texto), `Un club ve /admin: ${r.texto.slice(0, 300)}`);
    comprobar(!r.filtrado, 'Un responsable de club ve el panel de administración');
  });

  await caso('3d. Un seleccionador no entra en /admin ni en /club', async () => {
    const a = await cerrada('flujo-coach', 'coach', null, '/admin', /Salud de las fuentes/i);
    comprobar(bloqueada(a.status, a.texto), `Un coach ve /admin (HTTP ${a.status})`);
    const b = await cerrada('flujo-coach', 'coach', null, '/club', /Valida aqu[íi] las solicitudes/i);
    nota(`/admin=${a.status} /club=${b.status} como coach`);
    comprobar(bloqueada(b.status, b.texto), `Un coach ve /club (HTTP ${b.status})`);
  });

  await caso('3e. Un club no puede validar la inscripción de otro club', async () => {
    /**
     * Se le da al club Beta una solicitud propia para que tenga algo que
     * seleccionar, y en el envío de la acción de servidor se cambia el
     * identificador por el de la inscripción del club Alfa. Es exactamente lo
     * que haría quien trastee con las herramientas del navegador, y prueba la
     * comprobación de verdad (la del servidor), no la de la pantalla.
     */
    const entradaAlfa = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
    comprobar(entradaAlfa, 'Falta la inscripción del club Alfa para la prueba cruzada');
    const idAlfa = entradaAlfa!.entrada.id;
    const estadoPrevio = entradaAlfa!.entrada.status;
    const logPrevio = entradaAlfa!.log.length;

    const idBeta = await crearInscripcion(c.tiradorBeta, c.competicion.id, c.perfilClubBeta);

    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-club-beta', 'club', { clubId: c.clubBeta });
    const { page, errores } = await nuevaSesion(ctx);

    await ir(page, `${BASE_URL}/club`);
    const tarjeta = page.getByRole('button').filter({ hasText: 'Berta Flujos Beta' }).first();
    comprobar(await tarjeta.count(), 'La solicitud del club Beta no aparece en su bandeja');

    const validar = page.getByRole('button', { name: /^Validar/ }).first();
    const seleccionada = await reintentar(
      async () => {
        await tarjeta.click();
      },
      async () => (await validar.count()) > 0 && (await validar.isVisible()),
    );
    comprobar(seleccionada, 'No se pudo seleccionar la solicitud del club Beta');

    let sustituido = false;
    await page.route('**/club*', async (route) => {
      const req = route.request();
      const cuerpo = req.postData();
      if (req.method() === 'POST' && cuerpo?.includes(idBeta)) {
        sustituido = true;
        await route.continue({ postData: cuerpo.replaceAll(idBeta, idAlfa) });
        return;
      }
      await route.continue();
    });

    await validar.click();
    await page.waitForTimeout(5000);

    comprobar(sustituido, 'No se pudo interceptar la acción de servidor para la prueba');

    const despues = await leerInscripcion(c.tiradorAlfa, c.competicion.id);
    comprobarIgual(
      despues!.entrada.status,
      estadoPrevio,
      'La inscripción del otro club ha cambiado de estado',
    );
    comprobarIgual(
      despues!.log.length,
      logPrevio,
      'Se ha registrado una transición sobre la inscripción de otro club',
    );

    const texto = await textoDe(page);
    comprobar(
      /no es de un tirador de tu club/i.test(texto),
      `El servidor rechazó el cambio pero la pantalla no lo explica: ${texto.slice(0, 400)}`,
    );

    // Y la suya propia tampoco se ha tocado: el envío iba con el id cambiado.
    const beta = await leerInscripcion(c.tiradorBeta, c.competicion.id);
    comprobarIgual(beta!.entrada.status, 'pending_club', 'La inscripción del club Beta');
    nota('el club Beta no pudo tocar la inscripción del club Alfa');

    recoger(errores);
    await ctx.close();
  });

  await caso('3f. Un club no puede inscribir a un tirador de otro club', async () => {
    comprobar(c.competicion2, 'Hacen falta dos pruebas abiertas para esta comprobación');
    const otra = c.competicion2!;

    /**
     * Se captura la llamada real a la acción de servidor desde el navegador
     * del tirador (y se ABORTA, para que no llegue a crear nada), y después
     * se repite con la sesión del responsable del club Beta.
     *
     * La pantalla del club Beta ni siquiera pinta ese botón, pero una acción
     * de servidor es un endpoint público: quien conozca su identificador
     * puede llamarla. Lo que se prueba aquí es la comprobación del SERVIDOR.
     */
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);

    let captura: { url: string; cabeceras: Record<string, string>; cuerpo: string } | null =
      null;

    // Solo se intercepta la PÁGINA, no los recursos: un `**/*` en modo
    // desarrollo pasa por el manejador cada trozo de bundle y la página se
    // queda sin hidratar a tiempo.
    await page.route(
      (url) => url.pathname === RUTA_CALENDARIO || url.pathname === `${RUTA_CALENDARIO}/`,
      async (route) => {
        const req = route.request();
        const cuerpo = req.postData();
        if (req.method() === 'POST' && cuerpo?.includes(c.tiradorAlfa)) {
          captura = { url: req.url(), cabeceras: await req.allHeaders(), cuerpo };
          await route.abort();
          return;
        }
        await route.continue();
      },
    );

    await ir(page, `${BASE_URL}${RUTA_CALENDARIO}`);
    const panel = await abrirFicha(page, otra.eventoNombre, otra.inicio);
    const boton = panel.getByRole('button', { name: /Solicitar inscripci[óo]n/i }).first();
    comprobar(await boton.count(), 'No hay botón de solicitud en la segunda prueba');

    await reintentar(
      async () => {
        await boton.click();
      },
      async () => captura !== null,
      4,
      2000,
    );
    recoger(errores);
    await ctx.close();

    comprobar(captura, 'No se pudo capturar la llamada a la acción de solicitud');
    const cap = captura as unknown as { url: string; cabeceras: Record<string, string>; cuerpo: string };
    peticionSolicitud = cap;

    const prohibidas = ['cookie', 'host', 'content-length', ':authority', ':method', ':path', ':scheme'];
    const cabeceras: Record<string, string> = {};
    for (const [k, v] of Object.entries(cap.cabeceras)) {
      if (!prohibidas.includes(k.toLowerCase())) cabeceras[k] = v;
    }
    cabeceras.cookie = cabeceraCookie('flujo-club-beta');

    const res = await fetch(cap.url, {
      method: 'POST',
      headers: cabeceras,
      body: cap.cuerpo,
      redirect: 'manual',
    });
    const respuesta = await res.text();
    nota(`acción repetida con la sesión del club Beta → HTTP ${res.status}`);
    comprobar(
      res.status < 400,
      `La acción no se pudo invocar (HTTP ${res.status}); la prueba no sería concluyente: ${respuesta.slice(0, 200)}`,
    );

    /**
     * La prueba que se comprueba es la que iba EN LA PETICIÓN capturada, no
     * la que se eligió al preparar los datos: la ficha puede haber abierto
     * otra prueba del mismo evento y entonces se estaría mirando donde no es.
     */
    const uuids = [
      ...new Set(
        cap.cuerpo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [],
      ),
    ];
    const competicionPedida = uuids.find((u) => u.toLowerCase() !== c.tiradorAlfa.toLowerCase());
    comprobar(
      competicionPedida,
      `No se identifica la prueba dentro de la petición capturada: ${cap.cuerpo.slice(0, 200)}`,
    );
    nota(`prueba solicitada en la petición: ${competicionPedida}`);

    const colada = await leerInscripcion(c.tiradorAlfa, competicionPedida!);
    if (colada) {
      // Se limpia para no dejar la base sucia si la comprobación falla.
      await db.delete(entry).where(eq(entry.id, colada.entrada.id));
    }
    comprobar(
      colada === null,
      'El responsable del club Beta ha conseguido inscribir a un tirador del club Alfa',
    );
    nota('la acción de servidor rechaza al tirador de otro club');
  });
}

// ---------------------------------------------------------------------------
// 4. Feed iCal
// ---------------------------------------------------------------------------

async function feedIcal(c: Ctx) {
  await caso('4. El feed iCal responde, es estable y rechaza tokens inventados', async () => {
    const [perfil] = await db
      .select({ token: userProfile.icalToken })
      .from(userProfile)
      .where(eq(userProfile.id, c.perfilTirador))
      .limit(1);
    const token = perfil.token;

    const uno = await fetch(`${BASE_URL}/api/calendario/${token}?tipo=todo`);
    comprobarIgual(uno.status, 200, 'HTTP del feed');
    const tipo = uno.headers.get('content-type') ?? '';
    comprobar(tipo.includes('text/calendar'), `Content-Type inesperado: ${tipo}`);
    const cuerpo1 = await uno.text();
    comprobar(cuerpo1.startsWith('BEGIN:VCALENDAR'), 'El feed no empieza por BEGIN:VCALENDAR');
    comprobar(cuerpo1.trimEnd().endsWith('END:VCALENDAR'), 'El feed no acaba por END:VCALENDAR');

    const uids = (texto: string) =>
      [...texto.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim()).sort();

    const dos = await fetch(`${BASE_URL}/api/calendario/${token}?tipo=todo`);
    const cuerpo2 = await dos.text();

    const u1 = uids(cuerpo1);
    const u2 = uids(cuerpo2);
    comprobar(u1.length > 0, 'El feed no trae ningún VEVENT');
    comprobarIgual(u1.join('|'), u2.join('|'), 'Los UID no son estables entre dos peticiones');
    comprobarIgual(new Set(u1).size, u1.length, 'Hay UID repetidos dentro del mismo feed');
    nota(`${u1.length} eventos en el feed, UID estables y sin repetir`);

    comprobar(cuerpo1.includes('X-WR-CALNAME'), 'Falta el nombre del calendario en el feed');
    comprobarIgual(
      uno.headers.get('x-robots-tag'),
      'noindex, nofollow',
      'El feed debería pedir que no lo indexen (lleva la credencial en la URL)',
    );

    // Token inventado de la misma longitud: 404 seco, sin calendario vacío.
    const falso = 'f'.repeat(token.length);
    const noExiste = await fetch(`${BASE_URL}/api/calendario/${falso}?tipo=todo`);
    comprobarIgual(noExiste.status, 404, 'Un token inventado debería dar 404');
    comprobar(
      !(await noExiste.text()).includes('BEGIN:VCALENDAR'),
      'Un token inventado devuelve un calendario',
    );

    const corto = await fetch(`${BASE_URL}/api/calendario/abc?tipo=todo`);
    comprobarIgual(corto.status, 404, 'Un token corto debería dar 404');

    // Con extensión `.ics`, que es como lo pide y lo copia mucha gente.
    const conExtension = await fetch(`${BASE_URL}/api/calendario/${token}.ics?tipo=todo`);
    nota(`con sufijo .ics → HTTP ${conExtension.status}`);
    comprobarIgual(conExtension.status, 200, 'La URL con sufijo .ics debería servir el feed');
    comprobarIgual(
      uids(await conExtension.text()).join('|'),
      u1.join('|'),
      'El feed servido con .ics difiere del normal',
    );

    const falsoIcs = await fetch(`${BASE_URL}/api/calendario/${falso}.ics?tipo=todo`);
    comprobarIgual(falsoIcs.status, 404, 'Un token inventado con .ics debería dar 404');
  });

  await caso('4b. Un tipo de feed inventado no rompe y cae en "todo"', async () => {
    const [perfil] = await db
      .select({ token: userProfile.icalToken })
      .from(userProfile)
      .where(eq(userProfile.id, c.perfilTirador))
      .limit(1);
    const res = await fetch(`${BASE_URL}/api/calendario/${perfil.token}?tipo=loquesea`);
    comprobarIgual(res.status, 200, 'Un tipo desconocido debería caer en el feed completo');
    comprobar((await res.text()).includes('BEGIN:VCALENDAR'), 'No devuelve un calendario');
  });
}

// ---------------------------------------------------------------------------
// 5. Rutas de cron
// ---------------------------------------------------------------------------

async function contarIngestRuns(): Promise<number> {
  const r = await db.execute(sql`select count(*)::int as n from ingest_run`);
  const filas =
    (r as unknown as { rows?: { n: number }[] }).rows ?? (r as unknown as { n: number }[]);
  return Number(filas[0].n);
}

async function rutasCron() {
  await caso('5. El cron de ingestión exige la cabecera Authorization', async () => {
    const secreto = process.env.CRON_SECRET;
    comprobar(secreto, 'Falta CRON_SECRET en el entorno; la prueba no sería concluyente');

    const antes = await contarIngestRuns();

    const sinCabecera = await fetch(`${BASE_URL}/api/cron/ingest/skermo_rfee`);
    nota(`sin cabecera → HTTP ${sinCabecera.status}`);
    comprobarIgual(sinCabecera.status, 401, 'Sin cabecera debería dar 401');
    comprobarIgual((await sinCabecera.json()).ok, false, 'El cuerpo debería decir ok:false');

    const malSecreto = await fetch(`${BASE_URL}/api/cron/ingest/skermo_rfee`, {
      headers: { Authorization: 'Bearer secreto-que-no-es' },
    });
    comprobarIgual(malSecreto.status, 401, 'Con un secreto falso debería dar 401');

    // Sin el prefijo "Bearer", por si la comparación fuese laxa.
    const sinBearer = await fetch(`${BASE_URL}/api/cron/ingest/skermo_rfee`, {
      headers: { Authorization: secreto! },
    });
    comprobarIgual(sinBearer.status, 401, 'El secreto suelto, sin "Bearer", debería dar 401');

    const despues = await contarIngestRuns();
    comprobarIgual(antes, despues, 'Una petición no autorizada ha lanzado la ingestión');
    nota('ninguna ejecución registrada con peticiones no autorizadas');

    /**
     * Con la cabecera buena pasa el control. Se usa una fuente inexistente a
     * propósito: así se prueba la autorización sin disparar un scraper que
     * tarda minutos y toca datos reales en cada ejecución de la tanda.
     */
    const autorizada = await fetch(`${BASE_URL}/api/cron/ingest/no_existe`, {
      headers: { Authorization: `Bearer ${secreto}` },
    });
    comprobarIgual(
      autorizada.status,
      404,
      'Con la cabecera correcta debería pasar el control y fallar por fuente desconocida',
    );
    comprobar(
      String((await autorizada.json()).error).includes('Fuente desconocida'),
      'El mensaje no es el de fuente desconocida: ¿ha fallado por autorización?',
    );
    nota('la cabecera correcta pasa el control de autorización');

    const notify = await fetch(`${BASE_URL}/api/cron/notify`);
    nota(`/api/cron/notify sin cabecera → HTTP ${notify.status}`);
    comprobarIgual(notify.status, 401, '/api/cron/notify sin cabecera debería dar 401');
  });

  if (process.env.E2E_INGESTA_REAL === '1') {
    await caso('5b. La ingestión real de skermo_rfee responde con la cabecera', async () => {
      const antes = await contarIngestRuns();
      const res = await fetch(`${BASE_URL}/api/cron/ingest/skermo_rfee`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        signal: AbortSignal.timeout(300_000),
      });
      comprobarIgual(res.status, 200, 'La ingestión autorizada debería responder 200');
      const cuerpo = await res.json();
      nota(`fuente=${cuerpo.fuente} estado=${cuerpo.status} leídas=${cuerpo.itemsSeen}`);
      comprobar(await contarIngestRuns() > antes, 'No ha quedado constancia en ingest_run');
    });
  }
}

// ---------------------------------------------------------------------------
// 6. Navegación completa por rol
// ---------------------------------------------------------------------------

async function navegacion(c: Ctx) {
  const roles: {
    etiqueta: string;
    rol: 'admin' | 'coach' | 'club' | 'athlete' | 'guardian';
    club: string | null;
  }[] = [
    { etiqueta: 'flujo-admin', rol: 'admin', club: null },
    { etiqueta: 'flujo-club-alfa', rol: 'club', club: c.clubAlfa },
    { etiqueta: 'flujo-coach', rol: 'coach', club: null },
    { etiqueta: 'flujo-tirador', rol: 'athlete', club: c.clubAlfa },
    { etiqueta: 'flujo-guardian', rol: 'guardian', club: null },
  ];

  for (const r of roles) {
    await caso(`6. Navegación completa como ${r.rol}`, async () => {
      const ctx = await contexto(c.browser);
      await entrarComo(ctx, r.etiqueta, r.rol, { clubId: r.club });
      const { page, errores } = await nuevaSesion(ctx);

      const problemas: string[] = [];
      const rutas = [...RUTAS_PAGINA];

      if (r.rol === 'admin') {
        const convocatoria = await crearConvocatoriaBorrador(c.competicion.eventoId, c.perfilAdmin);
        rutas.push(`/admin/convocatorias/${convocatoria}`);
      }

      for (const ruta of rutas) {
        const etiquetaRuta = ruta.startsWith('/admin/convocatorias/')
          ? '/admin/convocatorias/[id]'
          : ruta;
        const res = await ir(page, `${BASE_URL}${ruta}`);
        const status = res?.status();
        const texto = await textoDe(page);
        const cerrada = debeEstarCerrada(r.rol, etiquetaRuta);

        if (status === 500) {
          problemas.push(
            `${etiquetaRuta}: HTTP 500 (error del servidor, no una pantalla explicativa)`,
          );
        } else if (cerrada) {
          if (!bloqueada(status, texto)) {
            problemas.push(`${etiquetaRuta}: HTTP ${status} y NO bloqueada para ${r.rol}`);
          }
        } else {
          if (status !== 200) {
            problemas.push(`${etiquetaRuta}: HTTP ${status} (debería ser accesible)`);
          } else if (texto.trim().length < 60) {
            problemas.push(`${etiquetaRuta}: pantalla prácticamente en blanco`);
          } else if (bloqueada(status, texto)) {
            nota(`(informativo) ${etiquetaRuta} está cerrada para ${r.rol}`);
          }
        }

        for (const e of recoger(errores)) {
          erroresGlobales.push({
            ruta: etiquetaRuta,
            rol: r.rol,
            tipo: e.tipo,
            texto: e.texto.slice(0, 400),
          });
          problemas.push(`${etiquetaRuta}: [${e.tipo}] ${e.texto.slice(0, 180)}`);
        }
      }

      await ctx.close();

      comprobar(
        problemas.length === 0,
        `Problemas navegando como ${r.rol}:\n       - ${problemas.join('\n       - ')}`,
      );
      nota(`${rutas.length} rutas recorridas sin errores de consola ni 500`);
    });
  }
}

// ---------------------------------------------------------------------------
// 7. Estados vacíos
// ---------------------------------------------------------------------------

async function estadosVacios(c: Ctx) {
  await caso('7a. El ranking sin calcular explica qué falta', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);
    await ir(page, `${BASE_URL}/ranking`);
    const texto = await textoDe(page);

    comprobar(
      /ranking/i.test(texto) && /inventad|de mentira|no se enseña/i.test(texto),
      `El ranking vacío no explica por qué lo está. Texto: ${texto.slice(0, 400)}`,
    );
    comprobar(
      /resultados|c[áa]lculo|normativa/i.test(texto),
      'El estado vacío no dice qué falta para que haya ranking',
    );
    comprobar(texto.length > 200, 'La pantalla de ranking está prácticamente en blanco');
    anotarErrores('athlete', '/ranking', errores);
    await ctx.close();
  });

  await caso('7b. Una convocatoria sin publicar no la ve el tirador', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-tirador', 'athlete', { clubId: c.clubAlfa });
    const { page, errores } = await nuevaSesion(ctx);
    await ir(page, `${BASE_URL}/convocatorias`);
    const texto = await textoDe(page);

    comprobar(
      /convocatoria/i.test(texto) &&
        /ninguna|todav[í i]a no|sin tirador|no hay/i.test(texto),
      `No se explica la ausencia de convocatorias. Texto: ${texto.slice(0, 400)}`,
    );
    comprobar(
      !texto.includes('e2e-flujo-Convocatoria de prueba'),
      'Una convocatoria sin publicar se está enseñando al tirador',
    );
    comprobar(texto.length > 150, 'La pantalla de convocatorias está prácticamente en blanco');
    anotarErrores('athlete', '/convocatorias', errores);
    await ctx.close();
  });

  await caso('7c. Un club sin solicitudes ve una explicación, no una pantalla vacía', async () => {
    // Se retira la solicitud del club Beta para dejar su bandeja a cero.
    await db.delete(entry).where(eq(entry.athleteId, c.tiradorBeta));

    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-club-beta', 'club', { clubId: c.clubBeta });
    const { page, errores } = await nuevaSesion(ctx);
    await ir(page, `${BASE_URL}/club`);
    const texto = await textoDe(page);

    comprobar(
      /no hay nada pendiente|Cuando un tirador de tu club solicite/i.test(texto),
      `La bandeja vacía del club no se explica. Texto: ${texto.slice(0, 400)}`,
    );
    comprobar(!texto.includes('Álvaro'), 'El club Beta ve tiradores del club Alfa');
    anotarErrores('club', '/club (vacío)', errores);
    await ctx.close();
  });

  await caso('7d. Un club sin club asignado lo explica en vez de romperse', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-club-beta', 'club', { clubId: null });
    const { page, errores } = await nuevaSesion(ctx);
    const res = await ir(page, `${BASE_URL}/club`);
    const texto = await textoDe(page);
    comprobarIgual(res?.status(), 200, 'HTTP de /club sin club asignado');
    comprobar(
      /no tiene club asignado/i.test(texto),
      `No se explica la falta de club. Texto: ${texto.slice(0, 400)}`,
    );
    anotarErrores('club', '/club (sin club)', errores);
    await ctx.close();
  });

  await caso('7e. El panel de administración no inventa números', async () => {
    const ctx = await contexto(c.browser);
    await entrarComo(ctx, 'flujo-admin', 'admin', { clubId: null });
    const { page, errores } = await nuevaSesion(ctx);
    await ir(page, `${BASE_URL}/admin`);
    const texto = await textoDe(page);

    const sinEmparejarReal = Number(
      (
        (await db.execute(
          sql`select count(*)::int as n from result where athlete_id is null`,
        )) as unknown as { rows: { n: number }[] }
      ).rows[0].n,
    );
    comprobar(
      texto.includes(String(sinEmparejarReal)),
      `El panel no muestra los ${sinEmparejarReal} resultados sin emparejar que hay en la base`,
    );
    comprobar(
      /resultado/i.test(texto) && /cuarentena|le[íi]da|fuente/i.test(texto),
      'El panel no acompaña los números con su explicación',
    );
    nota(`${sinEmparejarReal} resultados sin emparejar reflejados en el panel`);
    anotarErrores('admin', '/admin', errores);
    await ctx.close();
  });
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

const soloFiltro = process.argv[2] ?? '';

const ctx = await preparar();
try {
  const bloques: [string, () => Promise<void>][] = [
    ['1', () => flujoTirador(ctx)],
    ['2', () => flujoInscripcion(ctx)],
    ['3', () => permisos(ctx)],
    ['4', () => feedIcal(ctx)],
    ['5', () => rutasCron()],
    ['6', () => navegacion(ctx)],
    ['7', () => estadosVacios(ctx)],
  ];

  for (const [clave, fn] of bloques) {
    if (soloFiltro && !soloFiltro.includes(clave)) continue;
    await fn();
  }
} finally {
  await ctx.browser.close();
  console.log('\nLimpiando datos de prueba…');
  console.log('  ' + ((await limpiar()).join(', ') || 'nada que borrar'));
}

if (erroresGlobales.length > 0) {
  console.log('\nERRORES DE NAVEGADOR RECOGIDOS:');
  for (const e of erroresGlobales) {
    console.log(`  [${e.rol}] ${e.ruta} (${e.tipo}): ${e.texto}`);
  }
}

process.exit(resumen() > 0 ? 1 : 0);
