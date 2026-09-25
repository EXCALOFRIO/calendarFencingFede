import 'dotenv/config';
import type { BrowserContext } from 'playwright';
import {
  asegurarPerfil,
  BASE_URL,
  correoDePrueba,
  iniciarSesion,
  type RolPrueba,
} from './sesion.js';

/**
 * Sesiones reutilizables.
 *
 * `sesion.ts` inicia sesión en cada llamada, y Neon Auth limita el número de
 * intentos: con un caso por rol y varios contextos de navegador, la tanda de
 * pruebas se choca contra un HTTP 429 a mitad de camino y los fallos que salen
 * después son mentira.
 *
 * Aquí la cookie se pide UNA vez por correo y se reutiliza en todos los
 * contextos. Sigue siendo autenticación de verdad —es la misma cookie que
 * emite el servidor— pero se gasta un inicio de sesión por rol y no veinte.
 */

type Cookie = { name: string; value: string };

const cache = new Map<string, Cookie[]>();

/** Reintenta el inicio de sesión si el servicio devuelve 429. */
async function conReintento(email: string, nombre: string): Promise<Cookie[]> {
  let ultimo: unknown = null;
  for (let intento = 0; intento < 4; intento += 1) {
    try {
      return await iniciarSesion(email, nombre);
    } catch (e) {
      ultimo = e;
      const mensaje = e instanceof Error ? e.message : String(e);
      if (!mensaje.includes('429')) throw e;
      const espera = 15_000 * (intento + 1);
      console.log(`    (límite de peticiones de Neon Auth; esperando ${espera / 1000} s)`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimo;
}

export type Perfil = { email: string; profileId: string };

const perfiles = new Map<string, Perfil>();

/**
 * Crea el perfil con el rol (y el club) que se pida y deja la sesión puesta en
 * el contexto del navegador.
 */
export async function entrarComo(
  context: BrowserContext,
  etiqueta: string,
  rol: RolPrueba,
  opciones: { armas?: ('FLORETE' | 'ESPADA' | 'SABLE')[]; clubId?: string | null } = {},
): Promise<Perfil> {
  const email = correoDePrueba(etiqueta);
  const nombre = `Prueba ${etiqueta}`;

  // El perfil se reasegura siempre: los casos cambian el club a propósito y
  // no queremos que un caso anterior deje el rol tocado.
  const profileId = await asegurarPerfil(email, nombre, rol, {
    armas: opciones.armas,
    clubId: opciones.clubId ?? undefined,
  });

  /**
   * "Sin club" tiene que significar sin club.
   *
   * `asegurarPerfil` interpreta la ausencia de `clubId` como "ponle el
   * primero que encuentres" para los roles de club y tirador, así que pedir
   * `clubId: null` acababa asignando la RFEE y la prueba de "cuenta sin club"
   * no probaba nada. Se fuerza aquí, después.
   */
  if (opciones.clubId === null) {
    const { db } = await import('../../src/db');
    const { userProfile } = await import('../../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(userProfile).set({ clubId: null }).where(eq(userProfile.id, profileId));
  }

  perfiles.set(etiqueta, { email, profileId });

  let cookies = cache.get(email);
  if (!cookies) {
    cookies = await conReintento(email, nombre);
    cache.set(email, cookies);
  }

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

/**
 * Cabecera `Cookie` de un rol ya autenticado.
 *
 * Sirve para llamar a una acción de servidor con `fetch`, sin navegador: es
 * la forma de comprobar que la autorización está en el SERVIDOR y no solo en
 * que la pantalla no pinte el botón.
 */
export function cabeceraCookie(etiqueta: string): string {
  const email = correoDePrueba(etiqueta);
  const cookies = cache.get(email);
  if (!cookies) throw new Error(`No hay cookies cacheadas para "${etiqueta}"`);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function perfilDe(etiqueta: string): Perfil {
  const p = perfiles.get(etiqueta);
  if (!p) throw new Error(`No hay perfil cacheado para "${etiqueta}"`);
  return p;
}
