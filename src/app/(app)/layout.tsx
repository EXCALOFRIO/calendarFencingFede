import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CabeceraApp } from '@/components/cabecera-app';
import { CabeceraEscritorio } from '@/components/cabecera-escritorio';
import { NavMovil } from '@/components/nav';
import { CampanaNotificaciones } from '@/components/notificaciones/campana';
import { describirCuenta, ROL } from '@/components/tu/cuenta';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import { getCurrentSeason, getDataFreshness } from '@/lib/queries/calendar';
import { formatDateEs } from '@/lib/utils';
import { terminarAccesoQa, terminarVistaPrevia } from '@/app/vista-previa/actions';

export const dynamic = 'force-dynamic';

/**
 * Armazón de la aplicación (`docs/diseno-sistema.md` § 1):
 *
 *  - en el móvil, la cabecera compacta de cada pantalla (`CabeceraApp`) y una
 *    sola barra inferior con Calendario, Explorar, Buscar, Ranking y Tú;
 *  - desde 1024 px, una cabecera de 56 px con la marca, los mismos cinco
 *    destinos, la campana y el avatar, y la cabecera compacta debajo con el
 *    título y la flecha de volver.
 *
 * Salir, Mi estado, Gestión y los ajustes están en «Tú». Las transiciones de
 * página van en `template.tsx`, que sí se vuelve a montar al navegar.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [frescura, temporada, atletas] = await Promise.all([
    getDataFreshness(),
    getCurrentSeason(),
    getManagedAthletes(perfil.profileId),
  ]);
  const cuenta = describirCuenta(perfil, atletas, temporada);
  const campana = <CampanaNotificaciones profileId={perfil.profileId} />;

  /*
    Aviso de datos sin actualizar: una línea dentro del Calendario, que es
    donde la gente decide viajes con lo que ve. No va en la cabecera de todas
    las pantallas.
  */
  const aviso = frescura.stale ? (
    <p role="status" className="ancho-app flex items-center gap-2 px-4 pt-2 text-xs leading-4 text-warn">
      <TriangleAlert aria-hidden className="size-[14px] shrink-0" />
      {frescura.lastSeenAt
        ? `Sin actualizar desde el ${formatDateEs(frescura.lastSeenAt)}. Comprueba en la fuente oficial.`
        : 'Todavía no se ha cargado ningún dato.'}
    </p>
  ) : null;

  return (
    <div className="hueco-barra flex min-h-svh flex-col">
      {/* Primer elemento enfocable: salta la cabecera y la navegación. */}
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>

      <CabeceraEscritorio campana={campana} cuenta={cuenta} esAdmin={perfil.role === 'admin'} />
      <CabeceraApp campana={campana} aviso={aviso} />

      {perfil.preview ? (
        <aside aria-label="Vista previa de solo lectura" className="border-b border-filete bg-warn-tinte">
          <div className="ancho-app flex flex-wrap items-center justify-between gap-3 px-4 py-2">
            <p className="min-w-0 text-sm">
              <strong>{perfil.qa ? 'QA temporal' : 'Vista previa'} · {ROL[perfil.role]}</strong>
              <span className="block text-muted-foreground sm:ml-2 sm:inline">Solo lectura. Caduca a los 30 minutos.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/vista-previa">Cambiar vista</Link>
              </Button>
              <form action={terminarVistaPrevia}>
                <Button type="submit" size="sm">
                  {perfil.qa ? 'Volver al selector' : 'Salir de la vista previa'}
                </Button>
              </form>
              {perfil.qa ? (
                <form action={terminarAccesoQa}>
                  <Button variant="outline" size="sm" type="submit">Cerrar acceso técnico</Button>
                </form>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}

      {/*
        El mismo ancho que la cabecera, y de la misma fuente: `.ancho-app` es
        un token, no dos números escritos a mano que se desincronizan.
      */}
      <main
        id="contenido"
        tabIndex={-1}
        className="ancho-app flex flex-1 flex-col px-4 py-4 outline-none"
      >
        {children}
      </main>

      <NavMovil cuenta={perfil.profileId} />
      {/*
        Avisos de toda la aplicación («Inscripción solicitada», «Convocatoria
        publicada»): sin este montaje `sonner` no pinta nada. Aquí y no en la
        raíz porque /entrar no avisa de nada y así no descarga la librería.

        `richColors` está apagado a propósito: los colores los pone el tema
        de la aplicación, y el rojo y el verde de la librería no son los del
        semáforo de plazos.
      */}
      <Toaster position="bottom-center" closeButton />
    </div>
  );
}
