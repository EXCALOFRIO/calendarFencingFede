import { and, eq, inArray, or } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import {
  athlete,
  athleteWeapon,
  club,
  profileWeapon,
  userProfile,
} from '@/db/schema';
import { auth } from './server';

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
};

/**
 * Perfil de la persona que ha entrado, o `null`.
 *
 * Va envuelto en `cache()` de React para que una misma petición no consulte la
 * base cinco veces: cada consulta a Neon es un viaje HTTP.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.email) return null;

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
      or(
        eq(userProfile.authUserId, user.id),
        eq(userProfile.email, user.email.toLowerCase()),
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
  if (row.inviteStatus === 'revocada') return null;

  /**
   * Primer acceso: el perfil se creó por invitación (alta individual o
   * importación CSV) antes de que la persona tuviera cuenta. Al entrar por
   * primera vez se enlaza con su identidad. Esto es lo que permite dar de alta
   * a 20 personas por CSV sin que ninguna exista todavía en el sistema de
   * autenticación.
   */
  if (!row.authUserId) {
    await db
      .update(userProfile)
      .set({ authUserId: user.id, inviteStatus: 'aceptada', updatedAt: new Date() })
      .where(eq(userProfile.id, row.profileId));
  }

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
    role: row.role as Role,
    clubId: row.clubId,
    clubName: row.clubName,
    icalToken: row.icalToken,
    weapons,
  };
});

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
