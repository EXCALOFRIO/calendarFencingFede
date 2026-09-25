import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center gap-4 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
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
            <span className="hidden font-semibold tracking-tight sm:inline">
              Esgrima
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
              <Avatar className="size-7">
                <AvatarFallback className="text-[11px]">
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

      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col px-4 py-4">
        {children}
      </main>

      <NavMovil role={perfil.role} />
    </div>
  );
}
