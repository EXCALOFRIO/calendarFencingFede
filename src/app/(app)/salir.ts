'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/server';
import { AUTH_COOKIES } from '@/lib/auth/cookies';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';
import { terminarAccesoQa } from '@/app/vista-previa/actions';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';

export async function salir() {
  const almacen = await cookies();
  if (almacen.has(COOKIE_ACCESO_QA)) await terminarAccesoQa();
  // Do not clear cookies unless managed-provider revocation was confirmed.
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    throw new Error('No se ha podido cerrar la sesión. Inténtalo de nuevo.');
  }
  almacen.delete(COOKIE_VISTA_PREVIA);
  for (const name of AUTH_COOKIES) {
    almacen.set(name, '', {
      path: '/', maxAge: 0, expires: new Date(0), httpOnly: true,
      secure: name.startsWith('__Secure-'), sameSite: 'lax',
    });
  }
  almacen.delete({ name: 'entrar_correo', path: '/entrar' });
  redirect('/entrar');
}
