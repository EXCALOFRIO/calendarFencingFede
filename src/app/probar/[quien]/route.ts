/**
 * Atajo para entrar como un usuario de demostración, SOLO en desarrollo.
 *
 *   /probar/llavador       Carlos Llavador, 3.º de España en florete ABS
 *   /probar/marino         María Mariño, 3.ª de España en florete ABS
 *   /probar/tiradora       tiradora absoluta de espada, con cuenta propia
 *   /probar/tutora         madre con dos hijos tiradores
 *   /probar/seleccionador  seleccionador de florete
 *   /probar/espada         seleccionadora de espada
 *   /probar/admin          dirección técnica
 *   /probar/club           maestro de club
 *
 * Existe para poder ver la aplicación desde los ojos de cada rol sin teclear
 * correo y contraseña cada vez. En producción se niega antes de hacer nada.
 * Es temporal: se va con `npm run demo:borrar` cuando haya usuarios de
 * verdad.
 *
 * Detalle de implementación que no es evidente: se llama a NUESTRO endpoint
 * `/api/auth/...` en vez de al SDK de servidor de Neon Auth. El SDK habla
 * directamente con su API y devuelve 403 en este caso; el proxy de la
 * aplicación, que es el camino que usa la pantalla de acceso de verdad, sí
 * funciona. Así este atajo recorre exactamente el mismo camino que una
 * persona, en lugar de uno paralelo que podría comportarse distinto.
 */

const CUENTAS: Record<string, string> = {
  /**
   * Dos tiradores de verdad del ranking nacional, dados de alta con
   * `scripts/alta-desde-ranking.ts` a partir de la fila que publica Skermo:
   * nombre, licencia, fecha de nacimiento, club, arma y puesto son los
   * oficiales, no inventados.
   */
  llavador: 'carlos.llavador@demo.local',
  marino: 'maria.marino@demo.local',

  tiradora: 'tiradora@demo.local',
  tutora: 'madre@demo.local',
  seleccionador: 'seleccionador.florete@demo.local',
  espada: 'seleccionador.espada@demo.local',
  admin: 'direccion.tecnica@demo.local',
  club: 'maestro.club@demo.local',
};

/**
 * Cuentas de verdad, que a propósito NO tienen atajo.
 *
 * `aleramlar@gmail.com` existe como dirección técnica, pero su contraseña es
 * la que puso su dueño, no la de demostración, así que este atajo solo podría
 * dar un 401. Y en su caso concreto el camino normal sí funciona: Resend, sin
 * dominio verificado, puede escribir **al titular de la cuenta**, que es
 * justamente esa dirección. O sea que el código por correo le llega.
 *
 * Para ver la aplicación con permisos de administración sin ser él está
 * `/probar/admin`, que entra como dirección técnica y ve exactamente lo
 * mismo.
 */
const CUENTAS_REALES: Record<string, string> = {
  aleramlar:
    'Esa es una cuenta real: entra en /entrar con tu contraseña, o pide un ' +
    'código por correo, que a tu dirección sí llega. Para ver la aplicación ' +
    'con permisos de administración usa /probar/admin.',
};

const CONTRASENA = 'Demo-2026-Esgrima!';

export const dynamic = 'force-dynamic';

function texto(cuerpo: string, status: number): Response {
  return new Response(cuerpo, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ quien: string }> },
) {
  if (process.env.NODE_ENV === 'production') {
    return texto('No disponible.', 404);
  }

  const { quien } = await params;

  const aviso = CUENTAS_REALES[quien];
  if (aviso) return texto(`${aviso}\n`, 409);

  const email = CUENTAS[quien];

  if (!email) {
    return texto(
      `No existe la cuenta de prueba "${quien}".\n\n` +
        `Disponibles: ${Object.keys(CUENTAS).join(', ')}\n`,
      404,
    );
  }

  const origen = new URL(req.url).origin;
  const cuerpo = JSON.stringify({ email, password: CONTRASENA, name: quien });
  const cabeceras = { 'Content-Type': 'application/json' };

  // La cuenta de autenticación no existe hasta el primer acceso: los datos de
  // demostración solo crean el perfil en nuestra base. Si ya existe, el alta
  // falla y se sigue adelante.
  await fetch(`${origen}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: cabeceras,
    body: cuerpo,
  }).catch(() => null);

  const entrada = await fetch(`${origen}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: cabeceras,
    body: cuerpo,
  });

  const cookies = entrada.ok ? (entrada.headers.getSetCookie?.() ?? []) : [];

  if (cookies.length === 0) {
    return texto(
      `No se pudo entrar como ${email} (HTTP ${entrada.status}).\n\n` +
        'Comprueba que los datos de demostración existen: npm run demo\n',
      500,
    );
  }

  // Redirección con las cookies de sesión ya puestas.
  const cabecerasRespuesta = new Headers({ Location: '/' });
  for (const c of cookies) cabecerasRespuesta.append('Set-Cookie', c);

  return new Response(null, { status: 303, headers: cabecerasRespuesta });
}
