import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { estadoErrorAcceso } from '@/lib/auth/errores';
import { getAuth } from '@/lib/auth/server';
import { getSessionProfile } from '@/lib/auth/session';
import { COOKIE_VISTA_PREVIA } from '@/lib/auth/preview-token';
import { COOKIE_ACCESO_QA } from '@/lib/auth/qa-token';
import { FondoCompeticion } from '@/components/acceso/fondo-competicion';
import { FormularioAcceso, type EstadoAcceso } from '@/components/acceso/formulario-acceso';
import { Marca } from '@/components/marca';
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

async function enviarCodigo(_estado: EstadoAcceso, formData: FormData): Promise<EstadoAcceso> {
  'use server';

  if ((await cookies()).has(COOKIE_VISTA_PREVIA) || (await cookies()).has(COOKIE_ACCESO_QA)) redirect('/vista-previa');
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email) return { error: ERRORES['falta-email'] };

  // Same invitation, origin and persistent limits as direct HTTP. Always
  // advance to the same screen: no invitation-existence oracle in the UI.
  // The only exception, 429, is reached identically by invented addresses.
  if (await pedirCodigo(email) === 'limitado') return { error: ERRORES.limite };
  await recordarCorreoEnCurso(email);
  redirect('/entrar?paso=codigo');
}

async function pedirCodigo(email: string): Promise<'enviado' | 'limitado'> {
  try {
    await getAuth().api.sendVerificationOTP({ body: { email, type: 'sign-in' }, headers: await headers() });
  } catch (error) {
    if (estadoErrorAcceso(error) === 429) return 'limitado';
  }
  return 'enviado';
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

async function verificarCodigo(_estado: EstadoAcceso, formData: FormData): Promise<EstadoAcceso> {
  'use server';

  if ((await cookies()).has(COOKIE_VISTA_PREVIA) || (await cookies()).has(COOKIE_ACCESO_QA)) redirect('/vista-previa');
  // El correo sale de la cookie, no de un campo oculto que el navegador pueda
  // cambiar: así el código verificado es el del correo al que se envió.
  const email = (await leerCorreoEnCurso()).trim().toLowerCase();
  // NFKC: un teclado o un pegado con cifras de ancho completo sigue valiendo.
  const otp = String(formData.get('otp') ?? '').normalize('NFKC').replace(/\s/g, '');

  if (!email) redirect('/entrar?error=caducado');

  try {
    await getAuth().api.signInEmailOTP({ body: { email, otp }, headers: await headers() });
  } catch (error) {
    // Solo errores genéricos: conserva el campo en memoria, no en URL/cookie.
    // Un 4xx es el código; lo demás (proveedor o D1 caídos) no es culpa suya.
    const estado = estadoErrorAcceso(error) ?? 500;
    return { error: estado >= 400 && estado < 500 ? ERRORES.codigo : ERRORES.comprobar };
  }

  (await cookies()).delete({ name: COOKIE_CORREO, path: '/entrar' });
  redirect('/');
}

async function reenviarCodigo(): Promise<EstadoAcceso> {
  'use server';

  if ((await cookies()).has(COOKIE_VISTA_PREVIA) || (await cookies()).has(COOKIE_ACCESO_QA)) redirect('/vista-previa');
  const email = (await leerCorreoEnCurso()).trim().toLowerCase();
  if (!email) redirect('/entrar?error=caducado');
  // Mismo proveedor, origen y límites persistentes. Ni el resultado ni el
  // mensaje distinguen invitación o fallo del proveedor; el límite por IP y
  // correo lo alcanza igual una dirección inventada.
  if (await pedirCodigo(email) === 'limitado') return { error: ERRORES.limite };
  return { aviso: 'Si el correo está invitado, recibirás otro código.' };
}

async function cambiarCorreo() {
  'use server';

  (await cookies()).delete({ name: COOKIE_CORREO, path: '/entrar' });
  redirect('/entrar');
}

const ERRORES: Record<string, string> = {
  'falta-email': 'Escribe tu correo.',
  envio: 'No se ha podido enviar el código. Inténtalo dentro de un minuto.',
  codigo: 'El código no es válido o ha caducado. Pide uno nuevo.',
  comprobar: 'No se pudo comprobar el código. Inténtalo de nuevo.',
  limite: 'Has pedido demasiados códigos. Prueba en unos minutos.',
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
    <main className="grid min-h-svh content-start lg:grid-cols-[1.1fr_1fr]">
      {/*
        Mitad de presentación.

        La pantalla de acceso era una tarjeta centrada sobre fondo negro: no
        decía qué es esto ni por qué merece la pena entrar. Aquí, a la
        izquierda, va lo único que hace falta saber —qué agrega y que está al
        día— con cifras REALES de la base, no un eslogan. En el móvil se
        reduce a la marca y una línea, que es lo que cabe sin empujar el
        formulario fuera de la pantalla.
      */}
      <section className="flex flex-col justify-between gap-4 border-b px-6 py-6 lg:gap-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
        <div className="flex items-center gap-2">
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
        <div className="medida flex flex-col gap-4 rounded-md border-t border-t-filete bg-card p-4 lg:p-6">
          <h1 className="text-2xl leading-tight lg:text-6xl lg:leading-[0.95]">
            Todo el calendario
            <br />
            en un solo sitio
          </h1>
          <p className="hidden text-sm text-muted-foreground lg:block lg:text-base">
            La RFEE, la FIE y el circuito europeo, filtrados por tu arma, tu
            género y tu categoría. Con los plazos marcados y las convocatorias
            de la selección.
          </p>
        </div>
      </section>

      {/* Mitad del formulario. */}
      <section className="flex items-center justify-center px-4 py-6 lg:min-h-svh lg:px-10 lg:py-10">
        <div className="w-full max-w-sm">
          <Card className="gap-6 rounded-xl shadow-none">
            <CardHeader>
              <CardTitle className="text-2xl">
                {esPasoCodigo ? 'Mira tu correo' : 'Entra al calendario'}
              </CardTitle>
              <CardDescription className="break-words leading-5">
                {esPasoCodigo
                  ? `Si tu correo está invitado, recibirás un código en ${correoEnCurso}.`
                  : 'Tu temporada, en un solo sitio.'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <FormularioAcceso
                key={esPasoCodigo ? 'codigo' : 'correo'}
                pasoCodigo={esPasoCodigo}
                accion={esPasoCodigo ? verificarCodigo : enviarCodigo}
                reenviar={reenviarCodigo}
                cambiarCorreo={cambiarCorreo}
                errorInicial={error}
              />
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
