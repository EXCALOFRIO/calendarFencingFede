import 'dotenv/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { chromium, devices } from 'playwright';
import { db } from '../../src/db';
import {
  athlete,
  athleteWeapon,
  officialRankingEntry,
  userProfile,
} from '../../src/db/schema';
import { vincularFichaDesdeRanking } from '../../src/lib/altas/desde-ranking';
import { newIcalToken } from '../../src/lib/auth/session';

/**
 * El flujo de `/alta`, de verdad y con la base delante.
 *
 *   npx tsx tests/ui/alta.mts
 *
 * No comprueba que la pantalla cargue: crea una cuenta sin ficha, se busca,
 * confirma con la licencia y **mira en la base** que la ficha se creó, que el
 * arma está y que TODAS las filas del ranking quedaron emparejadas. Y prueba
 * los caminos malos, que es donde una pantalla de identidad se rompe:
 * licencia equivocada, nombre que no existe, ficha que ya tiene dueño y cuenta
 * que ya tiene ficha.
 *
 * Se limpia al terminar: la cuenta de prueba y su ficha se borran, y las filas
 * del ranking vuelven a quedar sin emparejar. Las fichas de Llavador y Mariño
 * NO se tocan: se usan para enseñar la aplicación.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const CORREO = 'prueba.alta@demo.local';
const CONTRASENA = 'Demo-2026-Esgrima!';

/**
 * A quién se reclama en la prueba: Ana Mariño Lasso, que está en DOS
 * clasificaciones (florete femenino M20 y absoluto). Es el caso interesante,
 * porque comprueba que se emparejan todas sus filas y no solo la buscada.
 */
const LICENCIA = 'AML00995';
const APELLIDOS = 'mariño lasso';
/** Ficha con dueño: la de Llavador, que no se toca y tiene que rebotar. */
const LICENCIA_AJENA = 'CLF01835';

let fallos = 0;
/** Cuántas filas del ranking tiene esa licencia, para comprobar la limpieza. */
let filasDeLaLicencia = 0;
const pasos: string[] = [];

function comprobar(titulo: string, bien: boolean, detalle = '') {
  if (!bien) fallos += 1;
  const linea = `${bien ? '·' : '✗'} ${titulo}${detalle ? `  ${detalle}` : ''}`;
  pasos.push(linea);
  console.log(linea);
}

// --------------------------------------------------------------- limpieza ---

async function limpiar(): Promise<void> {
  const [perfil] = await db
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.email, CORREO))
    .limit(1);

  const fichas = await db
    .select({ id: athlete.id, licencia: athlete.rfeeLicense })
    .from(athlete)
    .where(
      perfil
        ? sql`${athlete.userProfileId} = ${perfil.id} or upper(${athlete.rfeeLicense}) = ${LICENCIA}`
        : sql`upper(${athlete.rfeeLicense}) = ${LICENCIA}`,
    );

  if (fichas.length > 0) {
    const ids = fichas.map((f) => f.id);
    await db
      .update(officialRankingEntry)
      .set({ athleteId: null })
      .where(inArray(officialRankingEntry.athleteId, ids));
    await db.delete(athleteWeapon).where(inArray(athleteWeapon.athleteId, ids));
    await db.delete(athlete).where(inArray(athlete.id, ids));
  }

  if (perfil) {
    await db.delete(userProfile).where(eq(userProfile.id, perfil.id));
  }

  // La cuenta de autenticación la gestiona Neon en su propio esquema. Si no se
  // deja borrar, se dice: una cuenta sin perfil no puede entrar a nada, pero
  // dejarla sin avisar es dejar basura callada.
  try {
    await db.execute(sql`delete from neon_auth."user" where email = ${CORREO}`);
  } catch {
    console.log(
      '  (la cuenta de autenticación no se ha podido borrar; sin perfil no ' +
        'da acceso a nada)',
    );
  }
}

// ------------------------------------------------------------- andamiaje ---

type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
};

function leerCookies(res: Response): Cookie[] {
  const { hostname } = new URL(BASE);
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i === -1) return null;
      return {
        name: par.slice(0, i).trim(),
        value: par.slice(i + 1),
        domain: hostname,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      };
    })
    .filter((c): c is Cookie => c !== null);
}

async function sesion(): Promise<Cookie[]> {
  await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CONTRASENA, name: 'Prueba Alta' }),
  }).catch(() => null);

  const entrada = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CONTRASENA }),
  });

  const cookies = entrada.ok ? leerCookies(entrada) : [];
  if (cookies.length === 0) {
    throw new Error(
      `No se pudo entrar como ${CORREO} (HTTP ${entrada.status}). Sin sesión ` +
        'esta prueba fotografiaría la pantalla de acceso, así que se aborta.',
    );
  }
  return cookies;
}

// ------------------------------------------------------------------ obra ---

/** Deja el mundo como lo encuentra alguien que acaba de recibir la invitación. */
async function preparar(): Promise<{ perfilId: string; cookies: Cookie[] }> {
  await limpiar();
  const [perfil] = await db
    .insert(userProfile)
    .values({
      email: CORREO,
      fullName: 'Prueba Alta',
      role: 'athlete',
      icalToken: newIcalToken(),
      inviteStatus: 'pendiente',
    })
    .returning({ id: userProfile.id });
  return { perfilId: perfil.id, cookies: await sesion() };
}

const [filaAjena] = await db
  .select({ clave: officialRankingEntry.skermoAthleteId })
  .from(officialRankingEntry)
  .where(sql`upper(${officialRankingEntry.sourceLicense}) = ${LICENCIA_AJENA}`)
  .limit(1);

const navegador = await chromium.launch();

/**
 * Las dos vueltas —móvil y escritorio— empiezan de cero cada una: la cuenta se
 * borra y se vuelve a crear sin ficha. Es lo que permite que las dos recorran
 * el flujo completo, incluido el alta, en vez de que la segunda se encuentre la
 * ficha ya hecha por la primera y no pruebe nada.
 */
for (const [nombre, config] of [
  ['iphone', devices['iPhone 14 Pro']],
  ['escritorio', { viewport: { width: 1440, height: 900 } }],
] as const) {
  console.log(`\n== Preparando una cuenta sin ficha (${nombre})`);
  const { perfilId, cookies } = await preparar();
  console.log(`   perfil ${perfilId} (${CORREO}), sin ficha de tirador`);

  /**
   * Los rebotes que no se pueden provocar desde la interfaz sin tener otra
   * cuenta delante, así que se piden directamente a la regla de negocio, que es
   * exactamente la misma que ejecuta la pantalla.
   */
  const ajena = await vincularFichaDesdeRanking({
    profileId: perfilId,
    clave: filaAjena?.clave ?? 'no-existe',
    licencia: LICENCIA_AJENA,
    origen: 'autoservicio',
  });
  comprobar(
    'reclamar una ficha que ya tiene dueño rebota',
    !ajena.ok && ajena.motivo === 'YA_VINCULADO',
    ajena.ok ? 'la vinculó, y NO debía' : ajena.motivo,
  );

  const inexistente = await vincularFichaDesdeRanking({
    profileId: perfilId,
    clave: 'fila-que-no-existe',
    licencia: LICENCIA,
    origen: 'autoservicio',
  });
  comprobar(
    'reclamar una fila inexistente rebota',
    !inexistente.ok && inexistente.motivo === 'NO_ENCONTRADO',
    inexistente.ok ? 'la vinculó' : inexistente.motivo,
  );

  const ctx = await navegador.newContext({ ...config, locale: 'es-ES' });
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();

  const errores: string[] = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });

  console.log(`\n== ${nombre}`);

  // 1. El hueco se nota en «Mi estado», que es la puerta de entrada.
  await p.goto(`${BASE}/estado`, { waitUntil: 'networkidle', timeout: 60_000 });
  await p.screenshot({ path: `capturas/${nombre}-alta-0-estado-sin-ficha.png`, fullPage: true });
  comprobar(
    'una cuenta sin ficha ve la invitación a vincularla en /estado',
    await p.getByRole('link', { name: /Vincular mi ficha/i }).isVisible(),
  );

  await p.getByRole('link', { name: /Vincular mi ficha/i }).click();
  await p.waitForURL('**/alta', { timeout: 30_000 });
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: `capturas/${nombre}-alta-1-buscador.png`, fullPage: true });
  comprobar('el enlace lleva a /alta', new URL(p.url()).pathname === '/alta');

  // 2. Camino malo: un nombre que no existe.
  await p.getByLabel('Tu nombre o tu licencia').fill('zzqqxvbnm');
  await p.getByRole('button', { name: 'Buscarme' }).click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);
  comprobar(
    'un nombre que no existe lo dice y explica qué hacer',
    await p.getByText(/Nadie en el ranking oficial encaja/i).isVisible(),
  );
  await p.screenshot({ path: `capturas/${nombre}-alta-2-sin-resultados.png`, fullPage: true });

  // 3. Una ficha con dueño no ofrece el botón: se dice por qué.
  await p.getByLabel('Tu nombre o tu licencia').fill('llavador');
  await p.getByRole('button', { name: 'Buscarme' }).click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);
  comprobar(
    'una ficha con dueño se marca y no deja reclamarla',
    (await p.getByText(/ya está vinculada a una cuenta/i).isVisible()) &&
      (await p.getByRole('button', { name: 'Soy yo' }).count()) === 0,
  );
  await p.screenshot({ path: `capturas/${nombre}-alta-3-ya-vinculada.png`, fullPage: true });

  // 4. Camino malo: la licencia equivocada.
  await p.getByLabel('Tu nombre o tu licencia').fill(APELLIDOS);
  await p.getByRole('button', { name: 'Buscarme' }).click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `capturas/${nombre}-alta-4-resultados.png`, fullPage: true });
  comprobar(
    'buscando por apellido aparece con sus dos clasificaciones',
    (await p.getByText(/Florete femenino/i).count()) >= 2,
    `${await p.getByText(/Florete femenino/i).count()} clasificaciones a la vista`,
  );

  await p.getByRole('button', { name: 'Soy yo' }).first().click();
  await p.waitForTimeout(300);
  await p.getByLabel('Tu número de licencia RFEE').fill('ZZZ99999');
  await p.getByRole('button', { name: 'Vincular mi ficha' }).click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(600);
  comprobar(
    'la licencia equivocada rebota con el motivo',
    await p.getByText(/Esa licencia no es la de esta ficha/i).isVisible(),
  );
  await p.screenshot({ path: `capturas/${nombre}-alta-5-licencia-mal.png`, fullPage: true });

  // 5. Camino bueno.
  await p.getByLabel('Tu número de licencia RFEE').fill(LICENCIA);
  await p.getByRole('button', { name: 'Vincular mi ficha' }).click();
  await p.waitForURL('**/alta?hecha=1', { timeout: 30_000 });
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `capturas/${nombre}-alta-6-hecha.png`, fullPage: true });

  comprobar(
    'al confirmar se enseña que ha funcionado',
    await p.getByRole('heading', { name: /Tu ficha ya está vinculada/i }).isVisible(),
  );
  comprobar(
    'y se enseña el puesto oficial como cifra, no un «listo» verde',
    await p.getByText(/puesto de \d+/i).first().isVisible(),
  );

  // Volver a la misma URL sin el testigo enseña la ficha, no el buscador.
  await p.goto(`${BASE}/alta`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `capturas/${nombre}-alta-6b-vuelta.png`, fullPage: true });
  comprobar(
    'volver a /alta con ficha enseña la ficha, no el buscador',
    await p.getByRole('heading', { name: /^Tu ficha$/i }).isVisible(),
  );

  // 6. «Mi estado» ya sabe quién es.
  await p.goto(`${BASE}/estado`, { waitUntil: 'networkidle', timeout: 60_000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `capturas/${nombre}-alta-7-estado.png`, fullPage: true });
  comprobar(
    '«Mi estado» enseña la clasificación oficial de la RFEE',
    await p.getByText(/Clasificación oficial de la RFEE/i).first().isVisible(),
  );

  await p.goto(`${BASE}/ranking`, { waitUntil: 'networkidle', timeout: 60_000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `capturas/${nombre}-alta-8-ranking.png`, fullPage: true });
  comprobar(
    '«Ranking» abre por su grupo y la marca como suya',
    await p.getByText('Tú', { exact: true }).first().isVisible(),
  );

  const desborde = await p.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  comprobar('sin desborde horizontal', desborde <= 0, `${desborde}px`);

  if (errores.length > 0) {
    comprobar(
      'sin errores de consola',
      false,
      [...new Set(errores)].slice(0, 3).join(' | ').slice(0, 220),
    );
  } else {
    comprobar('sin errores de consola', true);
  }

  await ctx.close();

  // --------------------------------------------- lo que dice la base ahora ---

  const [ficha] = await db
    .select({
      id: athlete.id,
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      perfil: athlete.userProfileId,
      nacimiento: athlete.birthDate,
      notas: athlete.notes,
      consentimiento: athlete.consentSignedAt,
      caducidad: athlete.rfeeLicenseValidUntil,
    })
    .from(athlete)
    .where(sql`upper(${athlete.rfeeLicense}) = ${LICENCIA}`)
    .limit(1);

  comprobar(
    'la ficha existe en la base',
    Boolean(ficha),
    ficha ? `${ficha.firstName} ${ficha.lastName}` : '',
  );
  comprobar(
    'y cuelga de la cuenta que la reclamó',
    ficha?.perfil === perfilId,
    ficha?.perfil ?? 'sin cuenta',
  );
  comprobar(
    'los datos salen de la fuente, no del teclado',
    ficha?.nacimiento === '2008-09-12',
    ficha?.nacimiento ?? 'sin fecha',
  );
  comprobar(
    'se marca como alta de autoservicio',
    Boolean(ficha?.notas?.includes('autoservicio')),
  );
  comprobar(
    'no se inventa el consentimiento ni la caducidad de la licencia',
    ficha?.consentimiento === null && ficha?.caducidad === null,
  );

  const armas = ficha
    ? await db
        .select({ weapon: athleteWeapon.weapon })
        .from(athleteWeapon)
        .where(eq(athleteWeapon.athleteId, ficha.id))
    : [];
  comprobar(
    'tiene el arma asignada',
    armas.some((a) => a.weapon === 'FLORETE'),
    armas.map((a) => a.weapon).join(', ') || 'ninguna',
  );

  const suyas = await db
    .select({
      weapon: officialRankingEntry.weapon,
      category: officialRankingEntry.category,
      position: officialRankingEntry.position,
      athleteId: officialRankingEntry.athleteId,
    })
    .from(officialRankingEntry)
    .where(sql`upper(${officialRankingEntry.sourceLicense}) = ${LICENCIA}`);

  comprobar(
    'TODAS sus filas del ranking quedan emparejadas, no solo la buscada',
    suyas.length > 1 && suyas.every((f) => f.athleteId === ficha?.id),
    suyas.map((f) => `${f.weapon} ${f.category} ${f.position ?? '—'}`).join(' / '),
  );
  filasDeLaLicencia = suyas.length;

  // Con ficha ya vinculada, una segunda reclamación tiene que rebotar.
  const segunda = await vincularFichaDesdeRanking({
    profileId: perfilId,
    clave: filaAjena?.clave ?? 'no-existe',
    licencia: LICENCIA_AJENA,
    origen: 'autoservicio',
  });
  comprobar(
    'una cuenta que ya tiene ficha no puede reclamar otra',
    !segunda.ok && segunda.motivo === 'YA_TIENES_FICHA',
    segunda.ok ? 'la vinculó' : segunda.motivo,
  );

  // Y las fichas de demostración siguen intactas.
  const demo = await db
    .select({ licencia: athlete.rfeeLicense, perfil: athlete.userProfileId })
    .from(athlete)
    .where(inArray(athlete.rfeeLicense, ['CLF01835', 'MMB01326']));
  comprobar(
    'las fichas de Llavador y Mariño siguen en su sitio',
    demo.length === 2 && demo.every((d) => d.perfil !== null),
  );
}

await navegador.close();

console.log('\n== Limpiando');
await limpiar();

const [queda] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(athlete)
  .where(sql`upper(${athlete.rfeeLicense}) = ${LICENCIA}`);
const [sinEmparejar] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(officialRankingEntry)
  .where(
    and(
      sql`upper(${officialRankingEntry.sourceLicense}) = ${LICENCIA}`,
      sql`${officialRankingEntry.athleteId} is null`,
    ),
  );
const [cuenta] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(userProfile)
  .where(eq(userProfile.email, CORREO));

comprobar('la ficha de prueba se ha borrado', queda.n === 0);
comprobar('la cuenta de prueba se ha borrado', cuenta.n === 0);
comprobar(
  'y sus filas del ranking vuelven a estar sin emparejar',
  sinEmparejar.n === filasDeLaLicencia,
  `${sinEmparejar.n} de ${filasDeLaLicencia}`,
);

console.log(
  fallos === 0
    ? `\nSin problemas. ${pasos.length} comprobaciones.`
    : `\n${fallos} comprobaciones han fallado de ${pasos.length}.`,
);
process.exit(fallos === 0 ? 0 : 1);
