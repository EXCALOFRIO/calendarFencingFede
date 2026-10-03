'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { userProfile } from '@/db/schema';
import { getAuthenticatedProfile } from '@/lib/auth/session';
import { esRolAplicacion } from '@/lib/auth/access-policy';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';
import {
  COOKIE_VISTA_PREVIA,
  DURACION_VISTA_PREVIA,
  firmarVistaPrevia,
} from '@/lib/auth/preview-token';

async function exigirOrigen() {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseURL || (await headers()).get('origin') !== new URL(baseURL).origin) {
    throw new Error('NO_AUTORIZADO');
  }
}

export async function iniciarVistaPrevia(datos: FormData) {
  await exigirOrigen();
  const admin = await getAuthenticatedProfile();
  if (!admin || admin.role !== 'admin') throw new Error('NO_AUTORIZADO');
  const profileId = String(datos.get('profileId') ?? '');
  const role = String(datos.get('role') ?? '');
  if (!esRolAplicacion(role)) throw new Error('Papel no disponible.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) throw new Error('Perfil no disponible.');

  const [target] = await db.select({ id: userProfile.id }).from(userProfile)
    .where(and(
      eq(userProfile.id, profileId),
      eq(userProfile.role, role),
      ne(userProfile.inviteStatus, 'revocada'),
    )).limit(1).catch(() => []);
  if (!target) throw new Error('Perfil no disponible.');

  const issuedAt = Date.now();
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? '';
  const value = firmarVistaPrevia({
    version: 1,
    adminAuthUserId: admin.authUserId,
    adminProfileId: admin.profileId,
    profileId: target.id,
    role,
    issuedAt,
    expiresAt: issuedAt + DURACION_VISTA_PREVIA * 1000,
  }, secret);
  (await cookies()).set(COOKIE_VISTA_PREVIA, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    // Cookie de sesión: no desaparece al caducar la firma. Así una acción de
    // una pestaña antigua se deniega, en vez de recuperar permisos de admin.
  });
  redirect('/');
}

export async function terminarVistaPrevia() {
  await exigirOrigen();
  const admin = await getAuthenticatedProfile();
  if (!admin || admin.role !== 'admin') throw new Error('NO_AUTORIZADO');
  (await cookies()).delete(COOKIE_VISTA_PREVIA);
  redirect('/vista-previa');
}

export async function terminarAccesoQa() {
  await exigirOrigen();
  // También permite salir de una concesión revocada o caducada.
  const almacen = await cookies();
  almacen.delete(COOKIE_ACCESO_QA);
  almacen.delete(COOKIE_VISTA_PREVIA);
  redirect('/entrar');
}
