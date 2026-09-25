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

export type Role = 'admin' | 'coach' | 'club' | 'athlete' | 'guardian';

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
