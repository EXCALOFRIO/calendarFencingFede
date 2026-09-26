import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { userProfile } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { getSessionProfile } from '@/lib/auth/session';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Entrar' };

/**
 * Acceso con código de un solo uso enviado por correo.
 *
 * Se elige esto en vez de contraseña porque el público son tiradores y padres
 * que entran cada pocas semanas: una contraseña más que recordar acaba en
 * "he olvidado mi contraseña" y en que nadie usa la herramienta. Además no
 * custodiamos ninguna contraseña.
 */

async function enviarCodigo(formData: FormData) {
  'use server';

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email) redirect('/entrar?error=falta-email');

  /**
   * Solo se envía código a quien ya tiene perfil. La app no es de registro
   * abierto: las altas las hace el admin (una a una o por CSV). Esto evita que
   * cualquiera cree cuentas en una herramienta que maneja datos de menores.
   */
  const [profile] = await db
    .select({ id: userProfile.id, inviteStatus: userProfile.inviteStatus })
    .from(userProfile)
    .where(eq(userProfile.email, email))
    .limit(1);

  if (!profile) redirect('/entrar?error=sin-invitacion');

  /**
   * Un acceso revocado no recibe código.
   *
   * Sin esto, quitar a alguien del equipo le cambiaba el rol pero no le
   * cerraba la puerta: seguía pudiendo entrar. Y como el perfil no se borra
   * a propósito (borrarlo dejaría huérfano el historial de cambios y sus
   * fichas de tirador), la única forma de cerrar de verdad es mirar aquí.
   */
  if (profile.inviteStatus === 'revocada') redirect('/entrar?error=revocado');

  // `type: 'sign-in'` distingue este código de los de verificación de correo
  // o cambio de contraseña, que tienen otra plantilla y otra caducidad.
  const { error } = await auth.emailOtp.sendVerificationOtp({
    email,
    type: 'sign-in',
  });
  await recordarCorreoEnCurso(email);

  if (error) redirect('/entrar?error=envio');

  redirect('/entrar?paso=codigo');
}

/**
 * DATOS PERSONALES FUERA DE LA URL.
 *
 * El correo del paso 2 viajaba en la cadena de consulta
 * (`/entrar?paso=codigo&email=...`). Una URL con un dato personal dentro acaba
 * en el historial del navegador, en los registros de acceso del servidor y en
 * la cabecera `Referer` de cualquier recurso externo que cargue la página. Con
 * datos de menores de por medio eso no es aceptable, así que el correo viaja
 * en una cookie httpOnly de vida corta: no la lee el JavaScript de la página,
 * no se queda en el historial y caduca sola.
 */
const COOKIE_CORREO = 'entrar_correo';
const COOKIE_CORREO_SEGUNDOS = 15 * 60;

async function recordarCorreoEnCurso(email: string) {
  (await cookies()).set(COOKIE_CORREO, email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/entrar',
    maxAge: COOKIE_CORREO_SEGUNDOS,
  });
}

async function leerCorreoEnCurso(): Promise<string> {
  return (await cookies()).get(COOKIE_CORREO)?.value ?? '';
}

async function verificarCodigo(formData: FormData) {
  'use server';

  // El correo sale de la cookie, no de un campo oculto que el navegador pueda
  // cambiar: así el código verificado es el del correo al que se envió.
  const email = (await leerCorreoEnCurso()).trim().toLowerCase();
  const otp = String(formData.get('otp') ?? '').trim();

  if (!email) redirect('/entrar?error=caducado');

  const { error } = await auth.signIn.emailOtp({ email, otp });
  if (error) {
    redirect('/entrar?paso=codigo&error=codigo');
  }

  (await cookies()).delete({ name: COOKIE_CORREO, path: '/entrar' });
  redirect('/');
}

/**
 * Acceso con contraseña, SOLO fuera de producción.
 *
 * Existe para poder enseñar y trastear la aplicación con los usuarios de
 * demostración, cuyos correos son inventados y por tanto nunca van a recibir
 * un código. Solo funciona si `accesoConContrasena()` lo permite; si no, se
 * niega antes de hacer nada.
 */

/**
 * ¿Se permite entrar con contraseña?
 *
 * El acceso normal es un código de un solo uso por correo, y es el que se
 * queda cuando esto sea de verdad. Pero el correo sale por Resend, que hasta
 * que no haya un dominio verificado **solo puede escribir a la dirección del
 * titular de la cuenta**. En un despliegue recién hecho eso significa que no
 * podría entrar nadie, ni siquiera para enseñarlo.
 *
 * Por eso hay una segunda puerta, y está **apagada salvo que se encienda a
 * mano** con `ACCESO_CON_CONTRASENA=1`. No se usa `NODE_ENV` para decidirlo:
 * un despliegue de demostración es «producción» a todos los efectos y aun
 * así la necesita, mientras que una producción de verdad tiene que poder
 * cerrarla sin tocar código. Es un interruptor explícito, se ve en el panel
 * de Cloudflare y se quita borrando la variable.
 *
 * Mientras está encendida, la pantalla lo dice en voz alta: nadie debe
 * descubrir por sorpresa que hay una puerta más.
 */
function accesoConContrasena(): boolean {
  if (process.env.ACCESO_CON_CONTRASENA === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

async function entrarConContrasena(formData: FormData) {
  'use server';

  if (!accesoConContrasena()) {
    redirect('/entrar?error=solo-desarrollo');
  }

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  const [profile] = await db
    .select({ id: userProfile.id, inviteStatus: userProfile.inviteStatus })
    .from(userProfile)
    .where(eq(userProfile.email, email))
    .limit(1);

  if (!profile) redirect('/entrar?error=sin-invitacion');
  if (profile.inviteStatus === 'revocada') redirect('/entrar?error=revocado');

  /**
   * Se entra por NUESTRO proxy `/api/auth/...`, no por el SDK de servidor.
   *
   * Es el mismo camino que recorre la pantalla de acceso de verdad y el que
   * usa `/probar/[quien]`. El SDK (`auth.signIn.email`) funciona en local
   * pero en el despliegue devolvía error y dejaba al usuario de vuelta en
   * `/entrar` aunque la contraseña fuese correcta: comprobado contra la URL
   * de producción, donde el proxy contestaba 200 con su token y el SDK no.
   *
   * La URL se compone con la cabecera `host` de la petición en curso, no con
   * `NEXT_PUBLIC_APP_URL`, para que funcione igual en local, en el
   * despliegue y en cualquier dominio que se le ponga delante.
   */
  const cabeceras = await headers();
  const host = cabeceras.get('host') ?? 'localhost:3000';
  const esquema = host.startsWith('localhost') ? 'http' : 'https';
  const origen = `${esquema}://${host}`;
  const cuerpo = JSON.stringify({ email, password, name: email.split('@')[0] });
  const tipo = { 'Content-Type': 'application/json' };

  // La cuenta de autenticación no existe hasta el primer acceso: los perfiles
  // se siembran en nuestra base, no en Neon Auth. Si ya existe, el alta falla
  // y se sigue adelante.
  await fetch(`${origen}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: tipo,
    body: cuerpo,
  }).catch(() => null);

  const entrada = await fetch(`${origen}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: tipo,
    body: cuerpo,
  }).catch(() => null);

  const recibidas = entrada?.ok ? (entrada.headers.getSetCookie?.() ?? []) : [];
  if (recibidas.length === 0) redirect('/entrar?error=contrasena');

  /**
   * Las cookies que devuelve el proxy se vuelven a poner en la respuesta de
   * esta acción. Se copian los atributos que importan y no se inventa
   * ninguno: si la cookie venía marcada `HttpOnly` y `Secure`, sale igual.
   */
  const almacen = await cookies();
  for (const cabecera of recibidas) {
    const [par, ...atributos] = cabecera.split(';');
    const i = par.indexOf('=');
    if (i === -1) continue;

    const opciones: Parameters<typeof almacen.set>[2] = { path: '/' };
    for (const atributo of atributos) {
      const [clave, valor] = atributo.split('=').map((t) => t.trim());
      const nombre = clave.toLowerCase();
      if (nombre === 'httponly') opciones.httpOnly = true;
      else if (nombre === 'secure') opciones.secure = true;
      else if (nombre === 'path') opciones.path = valor;
      else if (nombre === 'max-age') opciones.maxAge = Number(valor);
      else if (nombre === 'samesite') {
        const v = valor?.toLowerCase();
        if (v === 'lax' || v === 'strict' || v === 'none') opciones.sameSite = v;
      }
    }

    almacen.set(par.slice(0, i).trim(), par.slice(i + 1), opciones);
  }

  redirect('/');
}


/** Campo de texto. 16 px en móvil: por debajo, iOS hace zoom al enfocar. */
function Campo(props: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className="h-11 w-full rounded-md border bg-background px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
    />
  );
}

function Etiqueta(props: React.ComponentProps<'label'>) {
  return <label {...props} className="text-sm font-medium text-muted-foreground" />;
}

/** Aviso en línea. El color nunca va solo: siempre lleva el texto. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

const ERRORES: Record<string, string> = {
  'falta-email': 'Escribe tu correo.',
  'sin-invitacion':
    'Ese correo no está dado de alta. El alta la hace el administrador; ' +
    'si crees que debería estar, escríbele.',
  envio: 'No se ha podido enviar el código. Inténtalo dentro de un minuto.',
  codigo: 'El código no es válido o ha caducado. Pide uno nuevo.',
  revocado:
    'Ese acceso está revocado. Si crees que es un error, habla con el ' +
    'administrador.',
  contrasena: 'Usuario o contraseña incorrectos.',
  'solo-desarrollo':
    'El acceso con contraseña solo funciona en el entorno de desarrollo.',
  caducado: 'Ha pasado demasiado tiempo. Vuelve a pedir un código.',
};

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ paso?: string; error?: string }>;
}) {
  if (await getSessionProfile()) redirect('/');

  const params = await searchParams;
  const esPasoCodigo = params.paso === 'codigo';
  const error = params.error ? ERRORES[params.error] : null;
  // Nunca de la URL: ver `recordarCorreoEnCurso`.
  const correoEnCurso = esPasoCodigo ? await leerCorreoEnCurso() : '';

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/*
        Mitad de presentación.

        La pantalla de acceso era una tarjeta centrada sobre fondo negro: no
        decía qué es esto ni por qué merece la pena entrar. Aquí, a la
        izquierda, va lo único que hace falta saber —qué agrega y que está al
        día— con cifras REALES de la base, no un eslogan. En el móvil se
        reduce a la marca y una línea, que es lo que cabe sin empujar el
        formulario fuera de la pantalla.
      */}
      <section className="flex flex-col justify-between gap-8 border-b px-6 py-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md bg-primary"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none">
              <path
                d="M5 19 19 5M19 19 5 5"
                stroke="white"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="font-semibold tracking-tight">Esgrima</span>
        </div>

        <div className="flex flex-col gap-4">
          <h1 className="text-4xl leading-[0.95] sm:text-5xl lg:text-6xl">
            Todo el calendario
            <br />
            en un solo sitio
          </h1>
          <p className="medida text-sm text-muted-foreground sm:text-base">
            La RFEE, la FIE y el circuito europeo, filtrados por tu arma, tu
            género y tu categoría. Con los plazos marcados, las convocatorias y
            el estado de cada inscripción.
          </p>
        </div>

      </section>

      {/* Mitad del formulario. */}
      <section className="flex items-center justify-center px-4 py-10 lg:px-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>
                {esPasoCodigo ? 'Escribe el código' : 'Entrar con tu correo'}
              </CardTitle>
              <CardDescription>
                {esPasoCodigo
                  ? `Te hemos mandado un código de 6 cifras a ${correoEnCurso}. Caduca en unos minutos.`
                  : 'Te mandamos un código de un solo uso. No hace falta contraseña.'}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {error ? <Aviso>{error}</Aviso> : null}

              {esPasoCodigo ? (
                <form action={verificarCodigo} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Etiqueta htmlFor="otp">Código</Etiqueta>
                    <input
                      id="otp"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={8}
                      placeholder="000000"
                      required
                      autoFocus
                      className="cifra h-14 w-full rounded-md border bg-background px-3 text-center text-3xl tracking-[0.35em] outline-none placeholder:text-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <Button type="submit" size="lg">
                    Entrar
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href="/entrar">Usar otro correo</a>
                  </Button>
                </form>
              ) : (
                <form action={enviarCodigo} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Etiqueta htmlFor="email">Correo electrónico</Etiqueta>
                    <Campo
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="tu@correo.es"
                      required
                      autoFocus
                    />
                  </div>
                  <Button type="submit" size="lg">
                    Enviarme un código
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/*
            Segunda puerta. Si el interruptor está apagado ni siquiera
            aparece en el HTML, así que no se puede ni intentar.
          */}
          {accesoConContrasena() && !esPasoCodigo ? (
            <div className="mt-4 rounded-md border border-dashed p-3">
              <p className="text-xs text-muted-foreground">
                <span className="text-foreground">Acceso con contraseña.</span>{' '}
                Está abierto porque todavía no hay dominio verificado para
                enviar los códigos por correo. Se cierra quitando la variable{' '}
                <code className="text-foreground">ACCESO_CON_CONTRASENA</code>.
              </p>
              <form action={entrarConContrasena} className="mt-2 flex flex-col gap-2">
                <Campo
                  name="email"
                  type="email"
                  placeholder="seleccionador.florete@demo.local"
                  autoComplete="off"
                  required
                />
                <Campo
                  name="password"
                  type="password"
                  placeholder="Contraseña"
                  autoComplete="off"
                  required
                />
                <Button type="submit" variant="outline" size="sm">
                  Entrar con contraseña
                </Button>
              </form>
            </div>
          ) : null}

          <p className="medida mt-6 text-xs text-muted-foreground">
            Las altas las hace el administrador. Si eres menor de 14 años, la
            cuenta debe estar a nombre de tu padre, madre o tutor.
          </p>
        </div>
      </section>
    </main>
  );
}
