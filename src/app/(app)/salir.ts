'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';

/**
 * Cerrar la sesión.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO EXISTE Y NO UN `<form action="/api/auth/sign-out">`
 * ---------------------------------------------------------------------------
 * Era eso, un formulario de HTML apuntando al proxy de autenticación, y **no
 * funcionaba**. Un formulario de HTML manda el cuerpo como
 * `application/x-www-form-urlencoded`, y el servidor de Neon Auth —que por
 * debajo es Fastify— solo acepta `application/json`, así que contestaba con un
 * 415 en la cara del usuario:
 *
 *   {"code":"FST_ERR_CTP_INVALID_MEDIA_TYPE","message":"Unsupported Media Type"}
 *
 * No se arregla poniendo `enctype`: los formularios de HTML no pueden enviar
 * JSON. Y no se arregla con un `fetch` en el cliente sin motivo: esto es una
 * acción de servidor, funciona sin JavaScript en el navegador y no expone
 * ninguna ruta nueva.
 *
 * `auth.signOut()` invalida la sesión **en el servidor** además de borrar la
 * galleta, que es la diferencia entre salir de verdad y solo dejar de
 * presentar el carné: si alguien copió la galleta, borrarla de este navegador
 * no la caduca.
 *
 * Y se borran las dos galletas a mano por si acaso. Son dos y hacen cosas
 * distintas: `session_token` es la sesión (7 días) y `local.session_data` es
 * una caché de 5 minutos con los datos del usuario. Dejar la segunda puesta
 * haría que la aplicación siguiera creyendo durante cinco minutos que hay
 * alguien dentro.
 */
const GALLETAS = [
  '__Secure-neon-auth.session_token',
  '__Secure-neon-auth.local.session_data',
  // Sin el prefijo `__Secure-`, que es lo que se usa en local sobre http.
  'neon-auth.session_token',
  'neon-auth.local.session_data',
];

export async function salir() {
  // Si la llamada falla —red, servidor de Neon caído— se sigue: borrar las
  // galletas de este navegador es lo que el usuario ha pedido, y dejarle
  // dentro porque no se pudo avisar al servidor sería lo contrario.
  await auth.signOut().catch(() => {});

  /**
   * BORRAR UNA GALLETA `__Secure-` EXIGE MANDARLA OTRA VEZ COMO `Secure`.
   *
   * `cookies().delete(nombre)` escribe `Set-Cookie: nombre=; Max-Age=0` **sin
   * el atributo `Secure`**, y el navegador RECHAZA cualquier galleta con el
   * prefijo `__Secure-` que no lo lleve. O sea que el borrado se tiraba en
   * silencio: la aplicación redirigía a `/entrar` como si hubieras salido, y
   * volviendo a `/` seguías dentro. Comprobado con el navegador: después de
   * pulsar «Salir» las dos galletas seguían en el contexto.
   *
   * Así que se caducan a mano, con los MISMOS atributos con los que se
   * pusieron (`Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`). En local, sobre
   * http, las que no llevan prefijo se borran igual y `secure` no molesta
   * porque `localhost` cuenta como contexto seguro.
   */
  const galleteria = await cookies();
  for (const nombre of GALLETAS) {
    if (!galleteria.get(nombre)) continue;
    galleteria.set(nombre, '', {
      path: '/',
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      secure: nombre.startsWith('__Secure-'),
      sameSite: 'lax',
    });
  }

  redirect('/entrar');
}
