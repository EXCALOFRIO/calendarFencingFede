import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/server';
import { getSessionProfile } from '@/lib/auth/session';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';
import { FondoCompeticion } from '@/components/acceso/fondo-competicion';
import { Marca } from '@/components/marca';
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
 * Se elige esto en vez de contraseña porque el público son tiradores
 * que entran cada pocas semanas: una contraseña más que recordar acaba en
 * "he olvidado mi contraseña" y en que nadie usa la herramienta. Además no
 * custodiamos ninguna contraseña.
 */

async function enviarCodigo(formData: FormData) {
  'use server';

  if ((await cookies()).has(COOKIE_VISTA_PREVIA) || (await cookies()).has(COOKIE_ACCESO_QA)) redirect('/vista-previa');
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email) redirect('/entrar?error=falta-email');

  // Same invitation, origin and persistent limits as direct HTTP. Always
  // advance to the same screen: no invitation-existence oracle in the UI.
  await getAuth().api.sendVerificationOTP({
    body: { email, type: 'sign-in' },
    headers: await headers(),
  }).catch(() => {});
  await recordarCorreoEnCurso(email);
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

  if ((await cookies()).has(COOKIE_VISTA_PREVIA) || (await cookies()).has(COOKIE_ACCESO_QA)) redirect('/vista-previa');
  // El correo sale de la cookie, no de un campo oculto que el navegador pueda
  // cambiar: así el código verificado es el del correo al que se envió.
  const email = (await leerCorreoEnCurso()).trim().toLowerCase();
  const otp = String(formData.get('otp') ?? '').trim();

  if (!email) redirect('/entrar?error=caducado');

  const entrada = await getAuth().api.signInEmailOTP({
    body: { email, otp },
    headers: await headers(),
  }).catch(() => null);
  if (!entrada) {
    redirect('/entrar?paso=codigo&error=codigo');
  }

  (await cookies()).delete({ name: COOKIE_CORREO, path: '/entrar' });
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
  envio: 'No se ha podido enviar el código. Inténtalo dentro de un minuto.',
  codigo: 'El código no es válido o ha caducado. Pide uno nuevo.',
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
          <Marca className="size-7" />
          {/*
            El rótulo a dos tonos: «Calendar» en el color del texto y
            «Fencing» en el rojo de la aplicación. Una palabra compuesta de
            quince letras en un solo tono se lee como una frase; partida por el
            color se lee como una marca, y de paso el rojo aparece aquí arriba
            sin meter un adorno que no dice nada.
          */}
          <span className="font-semibold tracking-tight">
            Calendar<span className="text-primary">Fencing</span>
          </span>
        </div>

        {/*
          El titular, sobre una superficie SÓLIDA. Y el por qué importa, porque
          aquí se probó lo contrario y se descartó mirándolo.

          Debajo hay fotos, así que lo primero que se hizo fue un panel de
          acrílico —desenfoque del fondo, tinte y filete de luz—, que es lo que
          hace la FIE sobre la foto de la sede. En la captura se ve que **no
          aporta nada**: en este punto de la columna la fotografía de ambiente
          ya está casi negra, así que no hay nada que desenfocar y el
          `backdrop-blur` se paga sin que se note. Es el caso que la propia
          regla de `REFERENCIAS.md` § 10 excluye: acrílico solo donde de verdad
          hay imagen viva debajo.

          El panel se queda, pero sólido, y por una razón de composición y no
          de legibilidad: el titular ya daba 16,89:1 sobre la foto. Lo que hace
          es **anclar el bloque** para que la columna no se lea como «fotos
          arriba, texto abajo» con un hueco en medio.
        */}
        <div className="medida flex flex-col gap-4 rounded-md border-t border-t-filete bg-card p-5 sm:p-6">
          <h1 className="text-4xl leading-[0.95] sm:text-5xl lg:text-6xl">
            Todo el calendario
            <br />
            en un solo sitio
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            La RFEE, la FIE y el circuito europeo, filtrados por tu arma, tu
            género y tu categoría. Con los plazos marcados y las convocatorias
            de la selección.
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
                  ? `Si tu correo está invitado, recibirás un código de 6 cifras en ${correoEnCurso}. Caduca en 5 minutos.`
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
                      pattern="[0-9]{6}"
                      minLength={6}
                      maxLength={6}
                      placeholder="000000"
                      required
                      autoFocus
                      className="cifra h-14 w-full rounded-md border bg-background px-3 text-center text-3xl tracking-[0.35em] outline-none placeholder:text-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <Button type="submit" size="lg" className="h-11">
                    Entrar
                  </Button>
                  <Button variant="ghost" size="sm" className="h-11" asChild>
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
                  <Button type="submit" size="lg" className="h-11">
                    Enviarme un código
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/*
            Aquí NO va el aviso de los menores de 14 años.

            La regla del RGPD sigue vigente y se aplica donde de verdad decide
            algo: en el alta (`src/app/(app)/admin/usuarios/actions.ts`, con
            `requiresGuardianAccount`), que es la pantalla del administrador.
            En esta pantalla no le servía a nadie: quien llega aquí ya tiene
            cuenta, así que la cuestión del tutor está resuelta desde antes.
          */}
          <p className="medida mt-6 text-xs text-muted-foreground">
            Las altas las hace el administrador.
          </p>
        </div>
      </section>

      {/*
        Las fotos del Campeonato del Mundo. Va **último** a propósito: la tira
        del pie es un elemento del flujo y ocupa una fila de la rejilla, así
        que puesta antes empujaría el campo del correo fuera de la primera
        pantalla en un móvil.
      */}
      <FondoCompeticion />
    </main>
  );
}
