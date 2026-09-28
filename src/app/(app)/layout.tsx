import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Marca } from '@/components/marca';
import { NavEscritorio, NavMovil } from '@/components/nav';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getManagedAthletes, getSessionProfile } from '@/lib/auth/session';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { getCurrentSeason, getDataFreshness } from '@/lib/queries/calendar';
import { CATEGORY_LABEL, WEAPON_LABEL, formatDateEs } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ROL: Record<string, string> = {
  admin: 'Dirección técnica',
  coach: 'Seleccionador',
  club: 'Club',
  athlete: 'Tirador',
  guardian: 'Tutor',
};

function iniciales(nombre: string): string {
  return nombre
    .replace(/^DEMO\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

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

  /**
   * Segunda línea del chip de usuario.
   *
   * Para un tirador es su arma y su categoría: es lo que le identifica aquí
   * y lo que determina todo lo que ve. Para el resto, su papel. Sale de la
   * ficha real; si no hay arma asignada, no se inventa.
   */
  const tirador = atletas[0];
  const categorias =
    tirador && temporada
      ? deriveCategoriesFromBirthDate(tirador.birthDate, temporada.categories)
      : null;

  const subtitulo =
    tirador && tirador.weapons.length > 0
      ? [
          WEAPON_LABEL[tirador.weapons[0]],
          categorias?.own
            ? (CATEGORY_LABEL[categorias.own as keyof typeof CATEGORY_LABEL] ??
              categorias.own)
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : (ROL[perfil.role] ?? perfil.role);

  const nombre = perfil.fullName.replace(/^DEMO\s+/i, '');

  /**
   * La cuenta de la dirección técnica se llama "Dirección técnica" y su papel
   * también, así que el chip enseñaba la misma frase dos veces, una encima de
   * otra. Cuando coinciden, sobra la segunda.
   */
  const segundaLinea =
    subtitulo.toLowerCase() === nombre.toLowerCase() ? null : subtitulo;

  return (
    <div className="hueco-barra flex min-h-dvh flex-col">
      {/*
        LA CABECERA ES UNA SUPERFICIE, NO UN CRISTAL SUCIO.

        Era `bg-background/85 backdrop-blur`: el color del lienzo al 85 % y un
        desenfoque de 8 px. Las dos cosas mal, y lo dice `REFERENCIAS.md` § 10
        por escrito: por debajo de 12 px el desenfoque «no se lee como
        material, se lee como una foto mal puesta», y el acrílico es para
        paneles **sobre una imagen** —«si detrás no hay nada que desenfocar,
        el acrílico no aporta nada y solo cuesta pintarlo»—. Detrás de esta
        barra no hay una foto: hay el calendario, y desenfocar texto solo lo
        convierte en puré.

        Así que va sólida y de nivel 1, un paso por encima del lienzo. Se gana
        que la barra existe como objeto, que el contenido ya no se transparenta
        por debajo al desplazarse, y una plaza del presupuesto de seis
        superficies con desenfoque por pantalla de `REFERENCIAS.md` § 10, que
        en el calendario venía justo.
      */}
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="ancho-app flex h-14 items-center gap-4 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/*
              La marca va con `titulo` en el móvil y sin él en el escritorio:
              a partir de `sm` al lado se lee «CalendarFencing», y entonces el
              nombre accesible del enlace lo dice la palabra. Abajo de `sm` la
              palabra se oculta y la marca es lo único que queda, así que
              tiene que nombrarse ella.
            */}
            <Marca className="size-7 sm:hidden" titulo="CalendarFencing, al calendario" />
            <Marca className="hidden size-7 sm:block" />
            {/* A dos tonos, igual que en la pantalla de acceso. */}
            <span className="hidden font-semibold tracking-tight sm:inline">
              Calendar<span className="text-primary">Fencing</span>
            </span>
          </Link>

          <div className="mx-auto">
            <NavEscritorio role={perfil.role} />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/perfil"
              className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-accent"
            >
              {/*
                El disco pasa de 28 a 32 px y las iniciales de 11 a 12 px. A
                11 px, dos letras en un círculo de 28 quedaban en cinco
                píxeles de trazo y se leían como una mancha; medido en la
                captura de producción, «AR» estaba más apagado que el nombre
                que tiene al lado, que es lo contrario de lo que se quiere.
              */}
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">
                  {iniciales(perfil.fullName)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden min-w-0 flex-col leading-tight md:flex">
                <span className="max-w-36 truncate text-xs font-medium">
                  {nombre}
                </span>
                {segundaLinea ? (
                  <span className="max-w-36 truncate text-[11px] text-muted-foreground">
                    {segundaLinea}
                  </span>
                ) : null}
              </span>
            </Link>

            <form action="/api/auth/sign-out" method="post">
              <Button variant="ghost" size="icon" type="submit" aria-label="Salir">
                <LogOut />
              </Button>
            </form>
          </div>
        </div>

        {/*
          Aviso de datos sin actualizar. Una línea: hay que decirlo, pero no
          es más importante que el calendario. El silencio sería lo peor,
          porque la gente decide viajes con lo que ve aquí.
        */}
        {frescura.stale ? (
          <p className="border-t bg-warn/10 px-4 py-1 text-center text-[11px] text-warn">
            {frescura.lastSeenAt
              ? `Sin actualizar desde el ${formatDateEs(frescura.lastSeenAt)}. Comprueba en la fuente oficial.`
              : 'Todavía no se ha cargado ningún dato.'}
          </p>
        ) : null}
      </header>

      {/*
        El mismo ancho que la cabecera, y de la misma fuente: `.ancho-app` es
        un token, no dos números escritos a mano que se desincronizan.
      */}
      <main className="ancho-app flex flex-1 flex-col px-4 py-4">{children}</main>

      <NavMovil role={perfil.role} />
    </div>
  );
}
