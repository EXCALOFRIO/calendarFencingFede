import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { db } from '@/db';
import {
  athlete,
  athleteWeapon,
  club,
  profileWeapon,
  userProfile,
} from '@/db/schema';
import { getAuth } from './server';
import { correoVerificado, esRolAplicacion } from './access-policy';
import { COOKIE_VISTA_PREVIA, verificarVistaPrevia } from './preview-token';
import { exigirEscritura, vistaPreviaCaducada } from './read-only';
import { COOKIE_ACCESO_QA, leerConcesionQa, verificarSesionQa } from './qa-token';

/**
 * Los papeles que existen en la aplicación.
 *
 * **Ya no hay `club`.** Esto se montó pensando en que el club validara las
 * inscripciones de sus tiradores, como se hace en Skermo, y esa no es la
 * aplicación que se ha construido: la usa la **selección española**, no los
 * clubes. Son tres papeles y nada más:
 *
 *   admin      la dirección técnica: lo ve y lo gestiona todo
 *   coach      el seleccionador de un arma; lleva sus dos géneros
 *   athlete    el tirador (los de la cabeza del ranking, que son los que
 *              tienen acceso)
 *   guardian   el padre, madre o tutor, cuando el tirador es menor de 14 y no
 *              puede consentir el tratamiento por sí mismo (RGPD)
 *
 * El valor `club` **sigue existiendo en el tipo `user_role` de Postgres** a
 * propósito: en Postgres no se puede quitar un valor de un enum sin recrearlo
 * y migrar la columna, y no merece la pena para algo que ya no se usa. Lo que
 * se ha quitado es de aquí hacia arriba: no se puede dar de alta a nadie con
 * ese papel y ninguna pantalla lo ofrece.
 *
 * El club **sí sigue siendo un dato del tirador** (`athlete.club_id`), porque
 * el ranking oficial y las listas de inscritos de Skermo vienen con él y forma
 * parte de cómo se identifica a una persona. Lo que desaparece es el club como
 * usuario que aprueba cosas.
 *
 * **Y tampoco hay `guardian`.** Petición del usuario: *«no es para madres ni
 * nada, es solo el seleccionador y los tiradores y ya»*. Los tiradores con
 * acceso son la cabeza del ranking, que tienen 14 años o más y **pueden
 * consentir el tratamiento de sus datos por sí mismos**, así que la cuenta a
 * nombre del tutor no hace falta.
 *
 * Lo que **no** se ha quitado, y es lo importante, es la barrera legal: en
 * España un menor de 14 años no puede consentir por sí mismo (RGPD, art. 8 y
 * LOPDGDD art. 7). `requiresGuardianAccount()` en `src/lib/categories.ts`
 * sigue en pie y el alta **se niega** si la fecha de nacimiento cae por debajo
 * de esa edad, en vez de crear una cuenta que no debería existir. Quitar un
 * papel de la interfaz es una decisión de producto; quitar la comprobación
 * sería un problema legal, y son cosas distintas.
 *
 * `athlete.guardian_profile_id` se queda en el esquema: hay tres fichas que lo
 * usan y borrar la columna dejaría huérfano ese enlace sin ganar nada.
 */
export type Role = 'admin' | 'coach' | 'athlete';

export type Weapon = 'FLORETE' | 'ESPADA' | 'SABLE';

export type SessionProfile = {
  authUserId: string;
  email: string;
  profileId: string;
  fullName: string;
  role: Role;
  clubId: string | null;
  clubName: string | null;
  icalToken: string;
  /**
   * Armas de las que se ocupa, solo para los seleccionadores (`coach`).
   * Determina qué tiradores ve primero al entrar, no lo que puede ver: un
   * seleccionador puede mirar cualquier arma con un clic.
   */
  weapons: Weapon[];
  /** No cambia la identidad real ni el perfil del administrador. */
  preview?: { adminProfileId: string; expiresAt: number };
  /** Identidad técnica efímera; nunca tiene permisos de escritura. */
  qa?: { grantId: string; expiresAt: number };
};

/**
 * Perfil de la persona que ha entrado, o `null`.
 *
 * Va envuelto en `cache()` de React para que una misma petición no consulte la
 * base cinco veces. No hay caché de sesión compartida entre peticiones.
 */
export const getAuthenticatedProfile = cache(async (): Promise<SessionProfile | null> => {
  try {
    return await leerPerfilAutenticado();
  } catch {
    // Drizzle errors can contain bound emails/credentials. Do not let Next
    // log them as unhandled page/action errors, or fall back to personal QA.
    if ((await cookies()).get(COOKIE_ACCESO_QA)) vistaPreviaCaducada();
    return null;
  }
});

async function leerPerfilAutenticado(): Promise<SessionProfile | null> {
  const qaCookie = (await cookies()).get(COOKIE_ACCESO_QA);
  if (qaCookie) {
    const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? '';
    const token = verificarSesionQa(qaCookie.value, leerConcesionQa(), secret);
    if (!token) vistaPreviaCaducada();
    const [admin] = await db.select({
      profileId: userProfile.id,
      email: userProfile.email,
      fullName: userProfile.fullName,
      role: userProfile.role,
      clubId: userProfile.clubId,
      clubName: club.name,
    }).from(userProfile).leftJoin(club, eq(userProfile.clubId, club.id))
      .where(and(
        eq(userProfile.id, token.adminProfileId),
        eq(userProfile.role, 'admin'),
        ne(userProfile.inviteStatus, 'revocada'),
      )).limit(1);
    if (!admin || admin.role !== 'admin') vistaPreviaCaducada();
    return {
      ...admin,
      role: 'admin',
      authUserId: `qa:${token.grantId}`,
      icalToken: '',
      weapons: [],
      qa: { grantId: token.grantId, expiresAt: token.expiresAt },
      preview: { adminProfileId: admin.profileId, expiresAt: token.expiresAt },
    };
  }
  const session = await getAuth().api.getSession({ headers: await headers() }).catch(() => null);
  const user = session?.user;
  if (!user?.email || !correoVerificado(user)) return null;

  const [row] = await db
    .select({
      profileId: userProfile.id,
      email: userProfile.email,
      fullName: userProfile.fullName,
      role: userProfile.role,
      clubId: userProfile.clubId,
      clubName: club.name,
      icalToken: userProfile.icalToken,
      authUserId: userProfile.authUserId,
      inviteStatus: userProfile.inviteStatus,
    })
    .from(userProfile)
    .leftJoin(club, eq(userProfile.clubId, club.id))
    .where(
      and(
        eq(userProfile.authUserId, user.id),
        sql`lower(trim(${userProfile.email})) = ${user.email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);

  if (!row) return null;

  /**
   * Acceso revocado: se corta aquí, no solo al pedir el código.
   *
   * Si solo se comprobara en la pantalla de acceso, alguien con la aplicación
   * ya abierta en el móvil seguiría dentro hasta que caducase su sesión, que
   * son días. Comprobándolo aquí, la siguiente página que cargue ya lo echa.
   */
  if (row.inviteStatus === 'revocada' || !esRolAplicacion(row.role)) return null;

  // Se conservan los IDs del proveedor gestionado. Solo verificar un OTP
  // puede reclamar una invitación sin enlace; leer la sesión nunca la reclama.
  if (row.authUserId !== user.id || row.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) return null;

  // Solo se consultan las armas de quien puede tenerlas: para un tirador o un
  // tutor sería una consulta de más en cada carga de página.
  let weapons: Weapon[] = [];
  if (row.role === 'coach') {
    const rows = await db
      .select({ weapon: profileWeapon.weapon })
      .from(profileWeapon)
      .where(eq(profileWeapon.profileId, row.profileId));
    weapons = rows.map((r) => r.weapon);
  }

  return {
    authUserId: user.id,
    email: row.email,
    profileId: row.profileId,
    fullName: row.fullName,
    role: row.role,
    clubId: row.clubId,
    clubName: row.clubName,
    icalToken: row.icalToken,
    weapons,
  };
}

/** La vista previa siempre vuelve a comprobar la cuenta administradora real. */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  try {
    return await leerPerfilEfectivo();
  } catch {
    // Preserve the public read-only failure without leaking private SQL data.
    vistaPreviaCaducada();
  }
});

async function leerPerfilEfectivo(): Promise<SessionProfile | null> {
  const real = await getAuthenticatedProfile();
  if (!real) return null;
  const previewCookie = (await cookies()).get(COOKIE_VISTA_PREVIA);
  if (!previewCookie) return real;

  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? '';
  const token = verificarVistaPrevia(previewCookie.value, secret, real);
  // Nunca volver silenciosamente al admin con una cookie caducada: un
  // formulario abierto como tirador no debe acabar escribiendo como admin.
  if (!token) vistaPreviaCaducada();

  const [row] = await db
    .select({
      profileId: userProfile.id,
      email: userProfile.email,
      fullName: userProfile.fullName,
      role: userProfile.role,
      clubId: userProfile.clubId,
      clubName: club.name,
    })
    .from(userProfile)
    .leftJoin(club, eq(userProfile.clubId, club.id))
    .where(
      and(
        eq(userProfile.id, token.profileId),
        eq(userProfile.role, token.role),
        ne(userProfile.inviteStatus, 'revocada'),
      ),
    )
    .limit(1);
  if (!row || !esRolAplicacion(row.role)) vistaPreviaCaducada();

  const weapons = row.role === 'coach'
    ? (await db.select({ weapon: profileWeapon.weapon }).from(profileWeapon)
      .where(eq(profileWeapon.profileId, row.profileId))).map((r) => r.weapon)
    : [];
  return {
    ...row,
    role: row.role,
    authUserId: real.authUserId,
    // El feed personal es una credencial duradera: no se copia a la vista.
    icalToken: '',
    weapons,
    ...(real.qa ? { qa: real.qa } : {}),
    preview: {
      adminProfileId: real.profileId,
      expiresAt: Math.min(token.expiresAt, real.qa?.expiresAt ?? token.expiresAt),
    },
  };
}

/** Lanza si no hay sesión. Para rutas y acciones que exigen estar dentro. */
export async function requireProfile(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) throw new Error('NO_AUTENTICADO');
  return profile;
}

export async function requireRole(...roles: Role[]): Promise<SessionProfile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) {
    throw new Error(
      `Esta pantalla es para ${roles.join(' o ')}, y tu cuenta es "${profile.role}".`,
    );
  }
  return profile;
}

export async function requireWritableProfile(): Promise<SessionProfile> {
  const profile = await requireProfile();
  exigirEscritura(profile);
  return profile;
}

export async function requireWritableRole(...roles: Role[]): Promise<SessionProfile> {
  const profile = await requireRole(...roles);
  exigirEscritura(profile);
  return profile;
}

export type AthleteSummary = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  birthDate: string;
  gender: 'M' | 'F' | 'MIXTO';
  clubId: string | null;
  clubName: string | null;
  rfeeLicense: string | null;
  fieLicense: string | null;
  fieLicenseValidUntil: string | null;
  rfeeLicenseValidUntil: string | null;
  consentSignedAt: Date | null;
  weapons: ('FLORETE' | 'ESPADA' | 'SABLE')[];
};

/**
 * Tiradores que gestiona esta cuenta.
 *
 * Puede ser uno (el propio tirador) o varios: un padre o madre con dos hijos
 * es un caso muy real, y así no hace falta duplicar correos ni cuentas.
 */
export const getManagedAthletes = cache(
  async (profileId: string): Promise<AthleteSummary[]> => {
    const rows = await db
      .select({
        id: athlete.id,
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        birthDate: athlete.birthDate,
        gender: athlete.gender,
        clubId: athlete.clubId,
        clubName: club.name,
        rfeeLicense: athlete.rfeeLicense,
        fieLicense: athlete.fieLicense,
        fieLicenseValidUntil: athlete.fieLicenseValidUntil,
        rfeeLicenseValidUntil: athlete.rfeeLicenseValidUntil,
        consentSignedAt: athlete.consentSignedAt,
      })
      .from(athlete)
      .leftJoin(club, eq(athlete.clubId, club.id))
      .where(
        and(
          eq(athlete.active, true),
          or(
            eq(athlete.userProfileId, profileId),
            eq(athlete.guardianProfileId, profileId),
          ),
        ),
      )
      .orderBy(athlete.firstName);

    if (rows.length === 0) return [];

    /**
     * Solo las armas de ESTOS tiradores. Antes se leía la tabla entera y se
     * filtraba en memoria: con una cuenta que gestiona a uno o dos tiradores
     * eso se traía todas las filas de la federación en cada carga de página.
     */
    const weapons = await db
      .select({ athleteId: athleteWeapon.athleteId, weapon: athleteWeapon.weapon })
      .from(athleteWeapon)
      .where(
        inArray(
          athleteWeapon.athleteId,
          rows.map((r) => r.id),
        ),
      );

    const byAthlete = new Map<string, ('FLORETE' | 'ESPADA' | 'SABLE')[]>();
    for (const w of weapons) {
      const list = byAthlete.get(w.athleteId) ?? [];
      list.push(w.weapon);
      byAthlete.set(w.athleteId, list);
    }

    return rows.map((r) => ({
      ...r,
      fullName: `${r.firstName} ${r.lastName}`.trim(),
      weapons: byAthlete.get(r.id) ?? [],
    }));
  },
);

/** Token para el feed iCal. Se genera al crear el perfil y es revocable. */
export function newIcalToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().slice(0, 8);
}
