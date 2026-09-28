import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { chromium, devices } from 'playwright';
import { db } from '../../src/db';
import {
  athlete,
  athleteWeapon,
  fieFencer,
  officialRankingEntry,
  userProfile,
} from '../../src/db/schema';
import { newIcalToken } from '../../src/lib/auth/session';

/**
 * «¿Cómo te llamas?»: el alta reconociéndose por el nombre, con la base delante.
 *
 *   npx tsx tests/ui/alta-nombre.mts
 *
 * Hermana de `tests/ui/alta.mts`, que recorre la vía de la licencia. Hacen
 * falta las dos porque son dos pruebas de identidad distintas: allí la prueba
 * es un número del carné, aquí es que la propia persona diga «sí, soy yo». Lo
 * que se comprueba de esta es, sobre todo, **que no vincula nada sin ese clic**
 * y que deja escrito quién lo dio.
 *
 * Las dos vueltas prueban las dos fuentes, que crean la ficha con datos
 * distintos:
 *
 *   móvil       Abril Rodés Torà, del ranking de la RFEE, 3 clasificaciones.
 *   escritorio  Jorge Casaus Pielago, que **no está en el ranking de la RFEE**
 *               y sí en la FIE. Es el caso que pidió el usuario y el que
 *               justifica buscar también ahí.
 *
 * Se limpia al terminar: la cuenta de prueba, su ficha, las filas del ranking
 * y el enlace con la FIE vuelven a como estaban. Las fichas de demostración
 * —Llavador y Mariño— no se tocan.
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const CORREO = 'prueba.alta.nombre@demo.local';
const CONTRASENA = 'Demo-2026-Esgrima!';

/** El nombre de la cuenta va con errata a propósito: es lo que se perdona. */
const NOMBRE_CUENTA = 'Jorje Casaus';

/** Escrito con erratas, tal y como lo teclearía quien lleva prisa. */
const BUSQUEDA_RFEE = 'abril rodes torra';
const ESPERADO_RFEE = 'Abril Rodés Torà';
const LICENCIA_RFEE = 'ART11422';

const BUSQUEDA_FIE = 'Jorje Casaus';
const ESPERADO_FIE = 'Jorge Casaus Pielago';
const FIE_ID = 54066;

let fallos = 0;
let comprobaciones = 0;

function comprobar(titulo: string, bien: boolean, detalle = '') {
  comprobaciones += 1;
  if (!bien) fallos += 1;
  console.log(`${bien ? '·' : '✗'} ${titulo}${detalle ? `  ${detalle}` : ''}`);
}

// --------------------------------------------------------------- limpieza ---

async function limpiar(): Promise<void> {
  const [perfil] = await db
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.email, CORREO))
    .limit(1);

  const fichas = perfil
    ? await db
        .select({ id: athlete.id })
        .from(athlete)
        .where(eq(athlete.userProfileId, perfil.id))
    : [];

  if (fichas.length > 0) {
    const ids = fichas.map((f) => f.id);
    await db
      .update(officialRankingEntry)
      .set({ athleteId: null })
      .where(inArray(officialRankingEntry.athleteId, ids));
    /**
     * El enlace con la FIE vuelve a PROPUESTO, que es como lo deja la
     * ingestión. Si se quedara CONFIRMADO apuntando a una ficha borrada, la
     * cola de revisión de `/admin/emparejar` enseñaría un enlace fantasma.
     */
    await db
      .update(fieFencer)
      .set({
        athleteId: null,
        linkStatus: 'PROPUESTO',
        linkedVia: null,
        linkedAt: null,
        matchEvidence: null,
      })
      .where(inArray(fieFencer.athleteId, ids));
    await db.delete(athleteWeapon).where(inArray(athleteWeapon.athleteId, ids));
    await db.delete(athlete).where(inArray(athlete.id, ids));
  }

  if (perfil) {
    await db.delete(userProfile).where(eq(userProfile.id, perfil.id));
  }

  try {
    await db.execute(sql`delete from neon_auth."user" where email = ${CORREO}`);
  } catch {
    console.log(
      '  (la cuenta de autenticación no se ha podido borrar; sin perfil no da ' +
        'acceso a nada)',
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
    body: JSON.stringify({
      email: CORREO,
      password: CONTRASENA,
      name: NOMBRE_CUENTA,
    }),
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
        'esto fotografiaría la pantalla de acceso, así que se aborta.',
    );
  }
  return cookies;
}

/** Una cuenta recién invitada, sin ficha, con el nombre mal escrito. */
async function preparar(): Promise<{ perfilId: string; cookies: Cookie[] }> {
  await limpiar();
  const [perfil] = await db
    .insert(userProfile)
    .values({
      email: CORREO,
      fullName: NOMBRE_CUENTA,
      role: 'athlete',
      icalToken: newIcalToken(),
      inviteStatus: 'pendiente',
    })
    .returning({ id: userProfile.id });
  return { perfilId: perfil.id, cookies: await sesion() };
}

// ------------------------------------------------------------------ obra ---

const navegador = await chromium.launch();

for (const [vista, config, busqueda, esperado, fuente] of [
  ['iphone', devices['iPhone 14 Pro'], BUSQUEDA_RFEE, ESPERADO_RFEE, 'RFEE'],
  [
    'escritorio',
    { viewport: { width: 1440, height: 900 } },
    BUSQUEDA_FIE,
    ESPERADO_FIE,
    'FIE',
  ],
] as const) {
  console.log(`\n== Preparando una cuenta sin ficha (${vista})`);
  const { perfilId, cookies } = await preparar();

  const ctx = await navegador.newContext({ ...config, locale: 'es-ES' });
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();

  const errores: string[] = [];
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });

  const buscar = async (texto: string) => {
    await p.goto(`${BASE}/alta?q=${encodeURIComponent(texto)}`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
  };

  console.log(`\n== ${vista}`);

  // 1. La puerta: un campo con el nombre de la cuenta ya escrito.
  await p.goto(`${BASE}/alta`, { waitUntil: 'networkidle', timeout: 60_000 });
  await p.screenshot({
    path: `capturas/${vista}-nombre-1-campo.png`,
    fullPage: true,
  });
  comprobar(
    'lo primero que se pide es el nombre',
    await p.getByLabel('¿Cómo te llamas?').isVisible(),
  );
  comprobar(
    'y viene con el nombre de la cuenta escrito, para no preguntarlo dos veces',
    (await p.getByLabel('¿Cómo te llamas?').inputValue()) === NOMBRE_CUENTA,
  );

  // 2. Dos letras no devuelven nada, nunca: es el límite que evita el censo.
  await buscar('ab');
  comprobar(
    'con dos letras no se busca y se dice por qué',
    await p.getByText(/al menos 3 letras/i).isVisible(),
  );
  comprobar(
    'y no se propone a nadie',
    (await p.getByRole('button', { name: 'Sí, soy yo' }).count()) === 0,
  );
  await p.screenshot({
    path: `capturas/${vista}-nombre-2-dos-letras.png`,
    fullPage: true,
  });

  // 3. Un nombre que no existe se dice, no se disimula con un parecido.
  await buscar('Zacarias Zuzunaga');
  comprobar(
    'un nombre que no está en las listas lo dice y ofrece la salida',
    await p.getByText(/No apareces en las listas oficiales/i).isVisible(),
  );
  comprobar(
    'y no inventa un candidato para no dejar la pantalla vacía',
    (await p.getByRole('button', { name: 'Sí, soy yo' }).count()) === 0,
  );
  await p.screenshot({
    path: `capturas/${vista}-nombre-3-nadie.png`,
    fullPage: true,
  });

  // 4. Dos homónimos reales: se enseñan los dos con lo que los distingue.
  await buscar('javier moreno');
  comprobar(
    'con dos homónimos se enseñan los dos y no elige la aplicación',
    (await p.getByRole('button', { name: 'Sí, soy yo' }).count()) >= 2,
    `${await p.getByRole('button', { name: 'Sí, soy yo' }).count()} botones`,
  );
  comprobar(
    'y se avisa de que puede haber homónimos',
    await p.getByText(/Puede haber homónimos/i).isVisible(),
  );
  await p.screenshot({
    path: `capturas/${vista}-nombre-4-homonimos.png`,
    fullPage: true,
  });

  // 5. Un apellido muy común no saca el censo: cinco como máximo.
  await buscar('garcia');
  const muchos = await p.locator('section > ul > li').count();
  comprobar(
    'un apellido común se corta en cinco candidatos',
    muchos === 5,
    `${muchos} candidatos`,
  );
  comprobar(
    'y se dice que hay más, para que nadie crea que no está',
    await p.getByText(/Hay más gente que encaja/i).isVisible(),
  );

  // 6. Una ficha con dueño se marca y no se puede reclamar.
  await buscar('carlos llavador');
  comprobar(
    'una ficha con dueño se marca y no deja reclamarla',
    (await p.getByText(/ya está vinculada a una cuenta/i).isVisible()) &&
      (await p.getByRole('button', { name: 'Sí, soy yo' }).count()) === 0,
  );
  await p.screenshot({
    path: `capturas/${vista}-nombre-5-ya-vinculada.png`,
    fullPage: true,
  });

  // 7. Y el camino bueno, con el nombre mal escrito.
  await buscar(busqueda);
  await p.screenshot({
    path: `capturas/${vista}-nombre-6-candidato.png`,
    fullPage: true,
  });
  comprobar(
    `«${busqueda}» encuentra a ${esperado} (${fuente})`,
    await p.getByText(esperado, { exact: false }).first().isVisible(),
  );
  comprobar(
    'se pregunta «¿eres tú?» y no se vincula solo',
    (await p.getByRole('heading', { name: /¿Eres tú\?/i }).isVisible()) &&
      (await db
        .select({ id: athlete.id })
        .from(athlete)
        .where(eq(athlete.userProfileId, perfilId))
        .then((f) => f.length === 0)),
  );
  /**
   * La fecha de nacimiento COMPLETA no se pinta nunca: en estas listas hay
   * menores y a esta pantalla se llega escribiendo un apellido. El año sí, que
   * es lo que hace falta para distinguir a dos homónimos.
   */
  const texto = await p.locator('body').innerText();
  comprobar(
    'no se enseña la fecha de nacimiento completa de nadie',
    !/\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sept|oct|nov|dic)/i.test(texto) &&
      !/\d{4}-\d{2}-\d{2}/.test(texto),
  );
  comprobar('ni una licencia de nadie', !texto.includes(LICENCIA_RFEE));

  await p.getByRole('button', { name: 'Sí, soy yo' }).first().click();
  await p.waitForURL('**/alta?hecha=1', { timeout: 30_000 });
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(600);
  await p.screenshot({
    path: `capturas/${vista}-nombre-7-hecha.png`,
    fullPage: true,
  });
  comprobar(
    'al confirmar se enseña la ficha, con sus datos y no un «listo» verde',
    await p
      .getByRole('heading', { name: /Tu ficha ya está vinculada/i })
      .isVisible(),
  );

  const desborde = await p.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  comprobar('sin desborde horizontal', desborde <= 0, `${desborde}px`);
  comprobar(
    'sin errores de consola',
    errores.length === 0,
    [...new Set(errores)].slice(0, 2).join(' | ').slice(0, 200),
  );

  await ctx.close();

  // --------------------------------------------- lo que dice la base ahora ---

  const [ficha] = await db
    .select({
      id: athlete.id,
      nombre: athlete.firstName,
      apellidos: athlete.lastName,
      nacimiento: athlete.birthDate,
      licencia: athlete.rfeeLicense,
      licenciaFie: athlete.fieLicense,
      comoSeVinculo: athlete.linkedVia,
      quienLoConfirmo: athlete.linkedByProfileId,
      cuando: athlete.linkedAt,
      evidencia: athlete.linkedEvidence,
      consentimiento: athlete.consentSignedAt,
    })
    .from(athlete)
    .where(eq(athlete.userProfileId, perfilId))
    .limit(1);

  comprobar(
    'la ficha existe y cuelga de la cuenta que la confirmó',
    Boolean(ficha),
    ficha ? `${ficha.nombre} ${ficha.apellidos}` : 'no se creó',
  );
  comprobar(
    'los datos salen de la fuente, no del teclado',
    Boolean(ficha?.nacimiento) && ficha?.nacimiento !== null,
    ficha?.nacimiento ?? 'sin fecha',
  );
  /**
   * El rastro, que es lo que hace legítima esta vía: sin él, «la vinculó la
   * persona» sería una afirmación sin respaldo. `persona` es el mismo
   * vocabulario que ya usaba `fie_fencer.linked_via`.
   */
  comprobar(
    'queda escrito que lo confirmó la propia persona, y cuándo',
    ficha?.comoSeVinculo === 'persona' &&
      ficha?.quienLoConfirmo === perfilId &&
      ficha?.cuando !== null,
    `${ficha?.comoSeVinculo ?? 'sin rastro'} / ${ficha?.cuando?.toISOString() ?? 'sin fecha'}`,
  );
  comprobar(
    'y qué escribió para encontrarse',
    Boolean(ficha?.evidencia?.includes(busqueda)),
    ficha?.evidencia?.slice(0, 90) ?? 'sin evidencia',
  );
  comprobar(
    'no se inventa el consentimiento, que la fuente no publica',
    ficha?.consentimiento === null,
  );

  const armas = ficha
    ? await db
        .select({ weapon: athleteWeapon.weapon })
        .from(athleteWeapon)
        .where(eq(athleteWeapon.athleteId, ficha.id))
    : [];
  comprobar(
    'tiene su arma asignada, que es lo que filtra el calendario',
    armas.length > 0,
    armas.map((a) => a.weapon).join(', ') || 'ninguna',
  );

  if (fuente === 'RFEE') {
    const suyas = await db
      .select({ athleteId: officialRankingEntry.athleteId })
      .from(officialRankingEntry)
      .where(sql`upper(${officialRankingEntry.sourceLicense}) = ${LICENCIA_RFEE}`);
    comprobar(
      'TODAS sus filas del ranking quedan emparejadas, no solo la buscada',
      suyas.length > 1 && suyas.every((f) => f.athleteId === ficha?.id),
      `${suyas.filter((f) => f.athleteId === ficha?.id).length} de ${suyas.length}`,
    );
    comprobar(
      'y la licencia se copia de la fuente, no se teclea',
      ficha?.licencia === LICENCIA_RFEE,
      ficha?.licencia ?? 'sin licencia',
    );
  } else {
    const [enLaFie] = await db
      .select({
        athleteId: fieFencer.athleteId,
        estado: fieFencer.linkStatus,
        via: fieFencer.linkedVia,
      })
      .from(fieFencer)
      .where(eq(fieFencer.fieId, FIE_ID))
      .limit(1);
    comprobar(
      'el enlace con la FIE queda confirmado por la persona',
      enLaFie?.athleteId === ficha?.id &&
        enLaFie?.estado === 'CONFIRMADO' &&
        enLaFie?.via === 'persona',
      `${enLaFie?.estado ?? 'sin fila'} / ${enLaFie?.via ?? 'sin vía'}`,
    );
    comprobar(
      'con la licencia de la FIE y sin inventarse una de la RFEE',
      Boolean(ficha?.licenciaFie) && ficha?.licencia === null,
      `FIE ${ficha?.licenciaFie ?? '—'} / RFEE ${ficha?.licencia ?? 'ninguna'}`,
    );
  }

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
  .from(userProfile)
  .where(eq(userProfile.email, CORREO));
comprobar('la cuenta de prueba y su ficha se han borrado', queda.n === 0);

const [fieLimpia] = await db
  .select({ estado: fieFencer.linkStatus, athleteId: fieFencer.athleteId })
  .from(fieFencer)
  .where(eq(fieFencer.fieId, FIE_ID))
  .limit(1);
comprobar(
  'y el enlace con la FIE vuelve a estar propuesto, no confirmado a un fantasma',
  fieLimpia?.estado === 'PROPUESTO' && fieLimpia?.athleteId === null,
  `${fieLimpia?.estado ?? 'sin fila'}`,
);

const [rankingLimpio] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(officialRankingEntry)
  .where(
    sql`upper(${officialRankingEntry.sourceLicense}) = ${LICENCIA_RFEE} and ${officialRankingEntry.athleteId} is not null`,
  );
comprobar(
  'y sus filas del ranking vuelven a estar sin emparejar',
  rankingLimpio.n === 0,
  `${rankingLimpio.n} emparejadas`,
);

console.log(
  fallos === 0
    ? `\nSin problemas. ${comprobaciones} comprobaciones.`
    : `\n${fallos} comprobaciones han fallado de ${comprobaciones}.`,
);
process.exit(fallos === 0 ? 0 : 1);
