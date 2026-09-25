import 'dotenv/config';
import { eq } from 'drizzle-orm';
import type { BrowserContext } from 'playwright';

/**
 * Sesión real para las pruebas de extremo a extremo.
 *
 * El acceso normal de la aplicación es con código de un solo uso por correo,
 * que en una prueba automática no se puede leer. Pero Neon Auth también acepta
 * alta e inicio de sesión con contraseña, así que las pruebas crean su propio
 * usuario por la API, recogen la cookie de sesión y se la ponen al navegador.
 *
 * Es autenticación de verdad, no un atajo que salta la comprobación: la app no
 * distingue esta sesión de la de una persona, y por eso vale para probar que
 * los permisos funcionan.
 *
 * Todos los usuarios de prueba llevan el prefijo `PREFIJO_PRUEBAS` para poder
 * borrarlos después de un tirón (`npm run e2e:limpiar`).
 */

export const PREFIJO_PRUEBAS = 'e2e-';
export const DOMINIO_PRUEBAS = 'pruebas.local';
const CONTRASENA = 'Pruebas-2026-Esgrima!';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export type RolPrueba = 'admin' | 'coach' | 'club' | 'athlete' | 'guardian';

export function correoDePrueba(etiqueta: string): string {
  return `${PREFIJO_PRUEBAS}${etiqueta}@${DOMINIO_PRUEBAS}`;
}

type Cookie = { name: string; value: string };

function leerCookies(res: Response): Cookie[] {
  // `getSetCookie` devuelve las cabeceras por separado; sin él, varias
  // cookies llegan concatenadas en una sola cadena y se rompe el troceo.
  const crudas = res.headers.getSetCookie?.() ?? [];
  return crudas
    .map((c) => {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      return i === -1 ? null : { name: par.slice(0, i).trim(), value: par.slice(i + 1) };
    })
    .filter((c): c is Cookie => c !== null);
}

/**
 * Crea (o reutiliza) el usuario de autenticación y devuelve sus cookies.
 * Si ya existe, el alta falla y se pasa directamente al inicio de sesión.
 */
export async function iniciarSesion(email: string, nombre: string): Promise<Cookie[]> {
  await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA, name: nombre }),
  }).catch(() => null);

  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });

  if (!res.ok) {
    throw new Error(
      `No se pudo iniciar sesión como ${email}: HTTP ${res.status} ${await res.text()}`,
    );
  }

  const cookies = leerCookies(res);
  if (cookies.length === 0) {
    throw new Error(`El inicio de sesión de ${email} no devolvió ninguna cookie`);
  }
  return cookies;
}

/**
 * Asegura que existe el `user_profile` con el rol pedido.
 *
 * Hace falta además del usuario de autenticación porque la app separa
 * identidad de perfil: sin perfil, la sesión es válida pero no se ve nada.
 */
export async function asegurarPerfil(
  email: string,
  nombre: string,
  rol: RolPrueba,
  opciones: { armas?: ('FLORETE' | 'ESPADA' | 'SABLE')[]; clubId?: string } = {},
): Promise<string> {
  const { db } = await import('../../src/db');
  const { club, profileWeapon, userProfile } = await import('../../src/db/schema');
  const { newIcalToken } = await import('../../src/lib/auth/session');

  let clubId = opciones.clubId ?? null;
  if (!clubId && (rol === 'club' || rol === 'athlete')) {
    const [c] = await db.select({ id: club.id }).from(club).limit(1);
    clubId = c?.id ?? null;
  }

  const [existente] = await db
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.email, email))
    .limit(1);

  let profileId: string;

  if (existente) {
    await db
      .update(userProfile)
      .set({ role: rol, fullName: nombre, clubId })
      .where(eq(userProfile.id, existente.id));
    profileId = existente.id;
  } else {
    const [creado] = await db
      .insert(userProfile)
      .values({
        email,
        fullName: nombre,
        role: rol,
        clubId,
        icalToken: newIcalToken(),
        inviteStatus: 'pendiente',
      })
      .returning({ id: userProfile.id });
    profileId = creado.id;
  }

  if (opciones.armas?.length) {
    await db.delete(profileWeapon).where(eq(profileWeapon.profileId, profileId));
    await db
      .insert(profileWeapon)
      .values(opciones.armas.map((weapon) => ({ profileId, weapon })))
      .onConflictDoNothing();
  }

  return profileId;
}

/** Deja el navegador con la sesión puesta y el perfil listo. */
export async function autenticar(
  context: BrowserContext,
  etiqueta: string,
  rol: RolPrueba,
  opciones: { armas?: ('FLORETE' | 'ESPADA' | 'SABLE')[] } = {},
): Promise<{ email: string; profileId: string }> {
  const email = correoDePrueba(etiqueta);
  const nombre = `Prueba ${etiqueta}`;

  const profileId = await asegurarPerfil(email, nombre, rol, opciones);
  const cookies = await iniciarSesion(email, nombre);

  /**
   * Se ponen con `domain` + `path` y no con `url`: Playwright rechaza la
   * combinación de `url` http con `secure: true`, y estas cookies llevan el
   * prefijo `__Secure-`, que Chrome exige que sea segura. `localhost` cuenta
   * como contexto seguro, así que sobre http funciona igual.
   */
  const { hostname } = new URL(BASE_URL);
  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax' as const,
    })),
  );

  return { email, profileId };
}

/** Borra todo lo que hayan dejado las pruebas. */
export async function limpiarDatosDePrueba(): Promise<void> {
  const { db } = await import('../../src/db');
  const { userProfile } = await import('../../src/db/schema');
  const { like } = await import('drizzle-orm');

  const borrados = await db
    .delete(userProfile)
    .where(like(userProfile.email, `${PREFIJO_PRUEBAS}%`))
    .returning({ email: userProfile.email });

  console.log(`Perfiles de prueba borrados: ${borrados.length}`);
  console.log(
    'Nota: los usuarios de autenticación quedan en el esquema neon_auth, que ' +
      'gestiona Neon. Se identifican por el prefijo "e2e-".',
  );
}
