'use server';

import { count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { configChangeLog, profileWeapon, userProfile } from '@/db/schema';
import { newIcalToken, requireRole } from '@/lib/auth/session';

/**
 * EQUIPO: quién entra al panel y con qué alcance.
 *
 * El alta aquí no manda ningún correo. No hace falta: la pantalla de acceso
 * (`/entrar`) solo envía código a correos que YA tienen perfil, así que crear
 * el perfil es exactamente lo que abre la puerta. Prometer una "invitación"
 * que no existe sería mentir en la interfaz.
 *
 * Hay tres operaciones parecidas que NO son lo mismo, y por eso están
 * separadas:
 *   - quitar del equipo: pierde el panel, sigue entrando en la app.
 *   - revocar el acceso: no vuelve a entrar, pero conserva rol y datos.
 *   - restaurar el acceso: deshace lo anterior.
 * Ninguna borra el perfil: eso dejaría huérfano el historial de cambios y sus
 * fichas de tirador.
 *
 * Todo cambio queda en `config_change_log` con el antes y el después, igual
 * que la normativa: si mañana alguien tiene permisos que no debería, se ve
 * quién se los dio y cuándo.
 */

export type RolEquipo = 'admin' | 'coach';
export type ArmaEquipo = 'FLORETE' | 'ESPADA' | 'SABLE';

/** Perfil que ya existía con ese correo, para ofrecer actualizarlo. */
export type PerfilExistente = {
  profileId: string;
  fullName: string;
  role: string;
};

export type ResultadoEquipo =
  | { ok: true; message: string }
  | { ok: false; error: string; yaExiste?: PerfilExistente };

const ROLES_EQUIPO: RolEquipo[] = ['admin', 'coach'];
const ARMAS: ArmaEquipo[] = ['FLORETE', 'ESPADA', 'SABLE'];

/**
 * Etiquetas duplicadas respecto a la interfaz a propósito: un módulo
 * `'use server'` solo puede exportar funciones asíncronas, así que no se
 * pueden compartir desde aquí.
 */
const ROL_LABEL: Record<string, string> = {
  admin: 'administración',
  coach: 'seleccionador',
  club: 'responsable de club',
  athlete: 'tirador',
  guardian: 'padre, madre o tutor',
};

/**
 * Motivo por el que el último administrador es intocable: si se queda el
 * sistema sin ninguno, nadie puede volver a entrar al panel para nombrar otro.
 * No hay puerta trasera, y crearla sería peor.
 */
const ERROR_ULTIMO_ADMIN =
  'Esta es la única cuenta con permisos de administración. Si le quitas el rol ' +
  'o el acceso, nadie podrá volver a entrar al panel para devolvérselos a ' +
  'nadie. Nombra antes a otra persona como administración y después vuelve aquí.';

// ------------------------------------------------------------ utilidades ---

function limpiar(valor: FormDataEntryValue | null | undefined): string {
  return String(valor ?? '').trim();
}

function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Solo se aceptan las tres armas del enum; lo demás se descarta sin ruido. */
function leerArmas(valores: FormDataEntryValue[]): ArmaEquipo[] {
  const armas = valores
    .map((v) => String(v).trim().toUpperCase())
    .filter((v): v is ArmaEquipo => (ARMAS as string[]).includes(v));
  return [...new Set(armas)];
}

async function armasDe(profileId: string): Promise<ArmaEquipo[]> {
  const filas = await db
    .select({ weapon: profileWeapon.weapon })
    .from(profileWeapon)
    .where(eq(profileWeapon.profileId, profileId));
  return filas.map((f) => f.weapon);
}

/** Cuántas cuentas de administración quedan. Manda sobre bajas y degradaciones. */
async function cuantosAdministradores(): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(userProfile)
    .where(eq(userProfile.role, 'admin'));
  return fila?.n ?? 0;
}

/** Mismo patrón que la normativa: sin esto, un permiso es un permiso sin historia. */
async function registrarCambio(
  tableName: string,
  rowId: string,
  action: 'crear' | 'editar' | 'borrar',
  before: unknown,
  after: unknown,
  changedByProfileId: string,
) {
  await db.insert(configChangeLog).values({
    tableName,
    rowId,
    action,
    before: (before ?? null) as never,
    after: (after ?? null) as never,
    changedByProfileId,
  });
}

function mismoConjunto(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function revalidar() {
  revalidatePath('/admin/ajustes');
  // La portada del panel cuenta con los permisos para decidir qué enseña.
  revalidatePath('/admin');
}

/** Guarda las armas de un perfil dejándolas exactamente como se piden. */
async function fijarArmas(profileId: string, armas: ArmaEquipo[]) {
  await db.delete(profileWeapon).where(eq(profileWeapon.profileId, profileId));
  if (armas.length === 0) return;
  await db
    .insert(profileWeapon)
    .values(armas.map((weapon) => ({ profileId, weapon })))
    .onConflictDoNothing();
}

function validarRolYArmas(
  rol: string,
  armas: ArmaEquipo[],
): { ok: false; error: string } | null {
  if (!(ROLES_EQUIPO as string[]).includes(rol)) {
    return {
      ok: false,
      error: 'Elige si la persona es administración o seleccionador de un arma.',
    };
  }
  if (rol === 'coach' && armas.length === 0) {
    return {
      ok: false,
      error:
        'Un seleccionador se ocupa de al menos un arma: sin ninguna no vería a ' +
        'ningún tirador al entrar. Marca florete, espada o sable.',
    };
  }
  return null;
}

// ----------------------------------------------------------------- altas ---

/**
 * Da de alta a alguien en el equipo.
 *
 * No envía nada: crea el perfil con `inviteStatus: 'pendiente'` y su token de
 * calendario. A partir de ese momento la persona ya puede entrar escribiendo
 * su correo en `/entrar`, porque esa pantalla solo manda código a correos con
 * perfil. `invitedAt` se queda a null a posta: no ha habido invitación, y
 * poner una fecha ahí haría creer que se mandó un correo.
 */
export async function crearMiembroEquipo(
  formData: FormData,
): Promise<ResultadoEquipo> {
  const perfil = await requireRole('admin');

  const email = limpiar(formData.get('email')).toLowerCase();
  const fullName = limpiar(formData.get('fullName'));
  const rol = limpiar(formData.get('role'));
  const armas = leerArmas(formData.getAll('weapons'));

  if (!emailValido(email)) {
    return { ok: false, error: 'Ese correo no tiene forma de correo electrónico.' };
  }
  if (fullName.length < 2) {
    return {
      ok: false,
      error: 'Escribe el nombre de la persona: es lo que se ve en el resto de la app.',
    };
  }

  const problema = validarRolYArmas(rol, armas);
  if (problema) return problema;

  const [existente] = await db
    .select({
      id: userProfile.id,
      fullName: userProfile.fullName,
      role: userProfile.role,
    })
    .from(userProfile)
    .where(eq(userProfile.email, email))
    .limit(1);

  // Nunca se duplica un correo: se ofrece cambiarle el alcance al que ya hay.
  if (existente) {
    return {
      ok: false,
      error:
        `Ya hay un perfil con ${email}: ${existente.fullName}, con rol de ` +
        `${ROL_LABEL[existente.role] ?? existente.role}. No se crea otro; ` +
        'puedes darle este alcance al perfil que ya existe.',
      yaExiste: {
        profileId: existente.id,
        fullName: existente.fullName,
        role: existente.role,
      },
    };
  }

  const armasFinales: ArmaEquipo[] = rol === 'coach' ? armas : [];

  const [creado] = await db
    .insert(userProfile)
    .values({
      email,
      fullName,
      role: rol as RolEquipo,
      icalToken: newIcalToken(),
      inviteStatus: 'pendiente',
      invitedAt: null,
    })
    .returning({ id: userProfile.id });

  await fijarArmas(creado.id, armasFinales);

  await registrarCambio(
    'user_profile',
    creado.id,
    'crear',
    null,
    { email, fullName, role: rol, weapons: armasFinales },
    perfil.profileId,
  );

  revalidar();

  return {
    ok: true,
    message:
      `${fullName} ya forma parte del equipo como ` +
      `${ROL_LABEL[rol] ?? rol}${
        armasFinales.length > 0 ? ` de ${armasFinales.length} arma(s)` : ''
      }. No se ha enviado ningún correo: puede entrar cuando quiera escribiendo ` +
      `${email} en la pantalla de acceso.`,
  };
}

// --------------------------------------------------------------- edición ---

/**
 * Cambia el rol, las armas y, si se indica, el nombre de un miembro.
 *
 * Un administrador no lleva un arma concreta: su alcance es todo. Por eso, al
 * pasar a `admin` se borran sus filas de `profile_weapon` en vez de dejarlas
 * ahí engañando.
 */
export async function actualizarMiembroEquipo(
  formData: FormData,
): Promise<ResultadoEquipo> {
  const perfil = await requireRole('admin');

  const profileId = limpiar(formData.get('profileId'));
  const rol = limpiar(formData.get('role'));
  const fullName = limpiar(formData.get('fullName'));
  const armas = leerArmas(formData.getAll('weapons'));

  if (!profileId) return { ok: false, error: 'Falta saber a quién hay que cambiar.' };

  const problema = validarRolYArmas(rol, armas);
  if (problema) return problema;

  const [antes] = await db
    .select({ fullName: userProfile.fullName, role: userProfile.role })
    .from(userProfile)
    .where(eq(userProfile.id, profileId))
    .limit(1);

  if (!antes) return { ok: false, error: 'Ese perfil ya no existe.' };

  if (antes.role === 'admin' && rol !== 'admin' && (await cuantosAdministradores()) <= 1) {
    return { ok: false, error: ERROR_ULTIMO_ADMIN };
  }

  const armasAntes = await armasDe(profileId);
  const armasFinales: ArmaEquipo[] = rol === 'coach' ? armas : [];
  const nombreFinal = fullName.length >= 2 ? fullName : antes.fullName;

  await db
    .update(userProfile)
    .set({ role: rol as RolEquipo, fullName: nombreFinal, updatedAt: new Date() })
    .where(eq(userProfile.id, profileId));

  await fijarArmas(profileId, armasFinales);

  await registrarCambio(
    'user_profile',
    profileId,
    'editar',
    { role: antes.role, fullName: antes.fullName, weapons: armasAntes },
    { role: rol, fullName: nombreFinal, weapons: armasFinales },
    perfil.profileId,
  );

  // Fila aparte para el cambio de armas: así "¿quién le quitó el sable?" se
  // busca por `profile_weapon` sin tener que abrir todos los cambios de perfil.
  if (!mismoConjunto(armasAntes, armasFinales)) {
    await registrarCambio(
      'profile_weapon',
      profileId,
      'editar',
      { weapons: armasAntes },
      { weapons: armasFinales },
      perfil.profileId,
    );
  }

  revalidar();

  return {
    ok: true,
    message:
      `${nombreFinal} queda como ${ROL_LABEL[rol] ?? rol}` +
      (armasFinales.length > 0 ? ` de ${armasFinales.join(', ').toLowerCase()}` : '') +
      '.',
  };
}

// ------------------------------------------------------------------ baja ---

/**
 * Quita a alguien del equipo.
 *
 * No borra la cuenta, la degrada a cuenta normal (rol `athlete`) y le quita
 * las armas. Borrar el `user_profile` dejaría a null el "quién lo cambió" de
 * todo el registro de cambios y desligaría sus fichas de tirador: se perdería
 * justo la trazabilidad por la que existe este registro.
 */
export async function quitarDelEquipo(profileId: string): Promise<ResultadoEquipo> {
  const perfil = await requireRole('admin');

  const [antes] = await db
    .select({ fullName: userProfile.fullName, role: userProfile.role })
    .from(userProfile)
    .where(eq(userProfile.id, profileId))
    .limit(1);

  if (!antes) return { ok: false, error: 'Ese perfil ya no existe.' };

  if (antes.role !== 'admin' && antes.role !== 'coach') {
    return {
      ok: false,
      error: `${antes.fullName} ya no tiene permisos de equipo. No hay nada que quitar.`,
    };
  }

  if (antes.role === 'admin' && (await cuantosAdministradores()) <= 1) {
    return { ok: false, error: ERROR_ULTIMO_ADMIN };
  }

  const armasAntes = await armasDe(profileId);

  await db
    .update(userProfile)
    .set({ role: 'athlete', updatedAt: new Date() })
    .where(eq(userProfile.id, profileId));

  await fijarArmas(profileId, []);

  await registrarCambio(
    'user_profile',
    profileId,
    'borrar',
    { role: antes.role, fullName: antes.fullName, weapons: armasAntes },
    { role: 'athlete', weapons: [] },
    perfil.profileId,
  );

  if (armasAntes.length > 0) {
    await registrarCambio(
      'profile_weapon',
      profileId,
      'borrar',
      { weapons: armasAntes },
      { weapons: [] },
      perfil.profileId,
    );
  }

  revalidar();

  return {
    ok: true,
    message:
      `${antes.fullName} sale del equipo. Su cuenta sigue existiendo y puede ` +
      'entrar en la app como cualquier otra persona, pero ya no ve el panel.',
  };
}

// --------------------------------------------------------------- acceso ---

/**
 * Cierra la puerta: deja de poder entrar en la app.
 *
 * `inviteStatus: 'revocada'` no es decorativo, lo mira `/entrar` antes de
 * mandar el código de acceso. Se distingue de "quitar del equipo" porque son
 * dos decisiones distintas: una le quita el panel y la otra le quita la app
 * entera. El perfil no se borra —seguiría haciendo falta para el historial de
 * cambios y para sus fichas de tirador— y se puede deshacer cuando se quiera.
 */
export async function revocarAcceso(profileId: string): Promise<ResultadoEquipo> {
  const perfil = await requireRole('admin');

  const [antes] = await db
    .select({
      fullName: userProfile.fullName,
      role: userProfile.role,
      inviteStatus: userProfile.inviteStatus,
    })
    .from(userProfile)
    .where(eq(userProfile.id, profileId))
    .limit(1);

  if (!antes) return { ok: false, error: 'Ese perfil ya no existe.' };

  if (antes.inviteStatus === 'revocada') {
    return { ok: false, error: `${antes.fullName} ya tenía el acceso revocado.` };
  }

  // Misma salvaguarda que la baja: sin administrador no se vuelve a entrar.
  if (antes.role === 'admin' && (await cuantosAdministradores()) <= 1) {
    return { ok: false, error: ERROR_ULTIMO_ADMIN };
  }

  await db
    .update(userProfile)
    .set({ inviteStatus: 'revocada', updatedAt: new Date() })
    .where(eq(userProfile.id, profileId));

  await registrarCambio(
    'user_profile',
    profileId,
    'editar',
    { inviteStatus: antes.inviteStatus },
    { inviteStatus: 'revocada' },
    perfil.profileId,
  );

  revalidar();

  return {
    ok: true,
    message:
      `${antes.fullName} ya no puede entrar: la pantalla de acceso dejará de ` +
      'mandarle código. Sus datos y su rol se quedan como están, y puedes ' +
      'devolverle el acceso cuando quieras.',
  };
}

/** Vuelve a abrir la puerta. Revocar sin vuelta atrás sería una trampa. */
export async function restaurarAcceso(profileId: string): Promise<ResultadoEquipo> {
  const perfil = await requireRole('admin');

  const [antes] = await db
    .select({
      fullName: userProfile.fullName,
      inviteStatus: userProfile.inviteStatus,
    })
    .from(userProfile)
    .where(eq(userProfile.id, profileId))
    .limit(1);

  if (!antes) return { ok: false, error: 'Ese perfil ya no existe.' };

  if (antes.inviteStatus !== 'revocada') {
    return { ok: false, error: `${antes.fullName} no tiene el acceso revocado.` };
  }

  /**
   * Vuelve a 'pendiente', no a 'aceptada': quien ya había entrado se detecta
   * por `authUserId`, que no se toca aquí. Marcar 'aceptada' a ciegas diría
   * que ha entrado alguien que quizá nunca lo hizo.
   */
  await db
    .update(userProfile)
    .set({ inviteStatus: 'pendiente', updatedAt: new Date() })
    .where(eq(userProfile.id, profileId));

  await registrarCambio(
    'user_profile',
    profileId,
    'editar',
    { inviteStatus: 'revocada' },
    { inviteStatus: 'pendiente' },
    perfil.profileId,
  );

  revalidar();

  return {
    ok: true,
    message: `${antes.fullName} vuelve a poder entrar con su correo de siempre.`,
  };
}
