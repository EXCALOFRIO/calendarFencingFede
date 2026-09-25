import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Fase 10: custodia de las credenciales de Skermo del club.
 *
 * ORDEN DE PREFERENCIA (de más seguro a menos):
 *
 * 1. NO PERSISTIR. Es el comportamiento por defecto y el que debería usar todo
 *    el mundo: el club teclea usuario y contraseña en el momento del envío,
 *    viven en memoria durante esa petición y se van con ella. Si nunca se
 *    guarda una contraseña, nunca se puede filtrar una contraseña.
 * 2. Si el club decide explícitamente "recordar la sesión": cifrado autenticado
 *    AES-256-GCM con `CREDENTIAL_ENCRYPTION_KEY`, que vive en las variables de
 *    entorno de Vercel y NUNCA en la base de datos. Un volcado de la base sin
 *    la clave no sirve de nada. IV aleatorio por cifrado y tag de autenticación
 *    guardado junto al texto cifrado (GCM, no CBC: así un texto cifrado
 *    manipulado falla al descifrar en vez de producir basura silenciosa).
 * 3. Borrado a un clic: `olvidarCredencial`.
 *
 * LO QUE NO SE HACE NUNCA. Que quede escrito, porque son los tres errores que
 * convierten esto en un incidente:
 *
 *   - NO se registran credenciales en logs. Ni en claro, ni "solo los primeros
 *     caracteres", ni dentro de un objeto que alguien vuelca con
 *     `console.log`. Por eso `redactar()` existe y por eso `requestSnapshot`
 *     pasa por `sanearParaRegistro` antes de guardarse (ver client.ts).
 *   - NO se envían al cliente. Estas funciones son de servidor: la contraseña
 *     descifrada no sale nunca en una respuesta HTTP, ni en un payload de
 *     Server Component, ni en un mensaje de error.
 *   - NO se reutilizan para nada que no sea la operación que el club acaba de
 *     aprobar. Se descifran en el momento del envío, se usan para una petición
 *     concreta y se descartan. Nada de sesiones persistentes reutilizadas para
 *     tareas de fondo: si el club no está delante aprobando, no se usan.
 */

/** Marca de versión del formato: permite rotar el algoritmo sin adivinar. */
const PREFIJO_V1 = 'gcm1';
const LONGITUD_IV = 12; // 96 bits, el recomendado para GCM
const LONGITUD_TAG = 16;

export type CredencialesSkermo = {
  usuario: string;
  /** Solo en memoria durante la operación. No se serializa jamás. */
  password: string;
};

/**
 * Sustituto para cualquier sitio donde se vea la tentación de imprimir una
 * credencial. Devuelve siempre lo mismo: no hay "pista parcial" que valga.
 */
export function redactar(_valor: unknown): string {
  return '[omitido]';
}

export function hayClaveDeCifrado(): boolean {
  try {
    leerClave();
    return true;
  } catch {
    return false;
  }
}

/**
 * Lee `CREDENTIAL_ENCRYPTION_KEY`. Acepta base64 (`openssl rand -base64 32`) o
 * hex de 64 caracteres, y exige 32 bytes exactos: AES-256 no admite otra cosa,
 * y una clave corta rellenada con ceros daría una falsa sensación de cifrado.
 */
function leerClave(): Buffer {
  const bruta = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!bruta) {
    throw new Error(
      'Falta CREDENTIAL_ENCRYPTION_KEY. Sin ella no se puede recordar ninguna ' +
        'credencial: genera una con "openssl rand -base64 32" y ponla en las ' +
        'variables de entorno de Vercel (nunca en la base de datos).',
    );
  }

  const clave = /^[0-9a-fA-F]{64}$/.test(bruta)
    ? Buffer.from(bruta, 'hex')
    : Buffer.from(bruta, 'base64');

  if (clave.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY debe tener 32 bytes (AES-256) y tiene ${clave.length}. ` +
        'Genera una nueva con "openssl rand -base64 32".',
    );
  }
  return clave;
}

/**
 * Cifra con AES-256-GCM.
 *
 * El `aad` (additional authenticated data) se usa para atar el texto cifrado a
 * un club concreto: si alguien copiara la fila de un club a otro en la base de
 * datos, el descifrado fallaría en vez de dar la contraseña del vecino.
 *
 * Formato: `gcm1.<iv>.<tag>.<cifrado>`, todo en base64url. El IV y el tag van
 * junto al texto cifrado porque hacen falta para descifrar y no son secretos;
 * lo secreto es la clave, que está en el entorno.
 */
export function cifrarCredencial(textoPlano: string, aad?: string): string {
  const clave = leerClave();
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));

  const cifrado = Buffer.concat([
    cipher.update(textoPlano, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIJO_V1,
    iv.toString('base64url'),
    tag.toString('base64url'),
    cifrado.toString('base64url'),
  ].join('.');
}

/**
 * Descifra y VERIFICA. Si el texto cifrado se ha tocado, si el tag no cuadra o
 * si la clave no es la misma, lanza. Nunca devuelve un resultado parcial ni
 * "lo que se pueda": una credencial medio descifrada es un fallo, no un dato.
 */
export function descifrarCredencial(payload: string, aad?: string): string {
  const partes = payload.split('.');
  if (partes.length !== 4 || partes[0] !== PREFIJO_V1) {
    throw new Error('La credencial guardada no tiene el formato esperado (gcm1).');
  }

  const [, ivB64, tagB64, cifradoB64] = partes;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== LONGITUD_IV || tag.length !== LONGITUD_TAG) {
    throw new Error('La credencial guardada tiene un IV o un tag de longitud inválida.');
  }

  const decipher = createDecipheriv('aes-256-gcm', leerClave(), iv);
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(cifradoB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Mensaje genérico a propósito: no se detalla qué falló exactamente.
    throw new Error(
      'No se pudo descifrar la credencial: o la clave de cifrado ha cambiado o el ' +
        'dato guardado se ha modificado. Hay que volver a introducir la contraseña.',
    );
  }
}

// ---------------------------------------------------------------------------
// Persistencia (opción 2: solo si el club lo pide expresamente)
// ---------------------------------------------------------------------------

/**
 * Las tres funciones siguientes tocan base de datos. El import de `@/db` es
 * dinámico a propósito: ese módulo lanza si falta `DATABASE_URL`, y el cifrado
 * de aquí arriba tiene que poder probarse (y usarse) sin base de datos.
 */

/**
 * Guarda la contraseña cifrada. Solo debe llamarse cuando el club ha marcado
 * explícitamente "recordar", y siempre desde el servidor.
 */
export async function recordarCredencial(
  clubId: string,
  credenciales: CredencialesSkermo,
): Promise<void> {
  const { db } = await import('@/db');
  const { clubSkermoSettings } = await import('@/db/schema');

  // El clubId va como AAD: ata el texto cifrado a este club (ver arriba).
  const cifrada = cifrarCredencial(credenciales.password, clubId);

  await db
    .insert(clubSkermoSettings)
    .values({
      clubId,
      skermoUsername: credenciales.usuario,
      encryptedPassword: cifrada,
      credentialStoredAt: new Date(),
    })
    .onConflictDoUpdate({
      target: clubSkermoSettings.clubId,
      set: {
        skermoUsername: credenciales.usuario,
        encryptedPassword: cifrada,
        credentialStoredAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

/**
 * Recupera las credenciales guardadas, si las hay. Devuelve `null` cuando el
 * club no ha querido recordarlas, que es el caso normal y no es un error.
 */
export async function leerCredencialGuardada(
  clubId: string,
): Promise<CredencialesSkermo | null> {
  const { db } = await import('@/db');
  const { clubSkermoSettings } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const [fila] = await db
    .select({
      usuario: clubSkermoSettings.skermoUsername,
      cifrada: clubSkermoSettings.encryptedPassword,
    })
    .from(clubSkermoSettings)
    .where(eq(clubSkermoSettings.clubId, clubId))
    .limit(1);

  if (!fila?.usuario || !fila.cifrada) return null;

  return {
    usuario: fila.usuario,
    // Se descifra AQUÍ, en el momento del envío, y no se cachea en ningún lado.
    password: descifrarCredencial(fila.cifrada, clubId),
  };
}

/** Borrado a un clic. Deja el usuario, quita el secreto. */
export async function olvidarCredencial(clubId: string): Promise<void> {
  const { db } = await import('@/db');
  const { clubSkermoSettings } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await db
    .update(clubSkermoSettings)
    .set({ encryptedPassword: null, credentialStoredAt: null, updatedAt: new Date() })
    .where(eq(clubSkermoSettings.clubId, clubId));
}
