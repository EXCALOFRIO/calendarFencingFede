import { Settings } from 'lucide-react';
import Link from 'next/link';
import { Marca } from '@/components/marca';
import { NavEscritorio } from '@/components/nav';
import { BotonIcono } from '@/components/sistema/boton';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

/**
 * Cabecera del escritorio (≥ 1024 px, `docs/diseno-sistema.md` § 1.6): 56 px,
 * sólida y del color del lienzo, con la marca, los cinco destinos, la
 * campana, Gestión (sólo administración) y el avatar, que lleva a «Tú». En el
 * móvil no se pinta: allí cada pantalla lleva su cabecera compacta.
 */
export function CabeceraEscritorio({
  campana,
  cuenta,
  esAdmin,
}: {
  campana: React.ReactNode;
  cuenta: { nombre: string; iniciales: string; segundaLinea: string | null };
  esAdmin: boolean;
}) {
  return (
    <header
      data-slot="cabecera-escritorio"
      className="sticky top-0 z-30 hidden border-b border-filete-alto bg-background lg:block"
      style={{ viewTransitionName: 'cabecera-escritorio' }}
    >
      <div className="ancho-app flex h-[56px] items-center gap-4 px-4">
        <Link
          href="/"
          className={cn('flex h-[36px] shrink-0 items-center gap-3 rounded-full pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring', AREA_TACTIL)}
        >
          <Marca className="size-[28px]" />
          <span className="text-base font-semibold tracking-tight">
            Calendar<span className="text-primary-text">Fencing</span>
          </span>
        </Link>

        <div className="mx-auto">
          <NavEscritorio />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {campana}
          {esAdmin ? (
            <BotonIcono asChild etiqueta="Gestión">
              <Link href="/admin" prefetch={false}>
                <Settings aria-hidden strokeWidth={2} />
              </Link>
            </BotonIcono>
          ) : null}
          <Link
            href="/explorar/yo"
            prefetch={false}
            className={cn('flex h-[40px] items-center gap-2 rounded-full py-1 pr-3 pl-1 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', AREA_TACTIL)}
          >
            {/* Sin aria-label que tape el nombre visible (WCAG 2.5.3); las iniciales sobran para el lector. */}
            <span className="sr-only">Tú: </span>
            <Avatar aria-hidden className="size-8">
              <AvatarFallback className="text-xs">{cuenta.iniciales}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col leading-4">
              <span className="max-w-36 truncate text-xs font-medium">{cuenta.nombre}</span>
              {cuenta.segundaLinea ? (
                <span className="max-w-36 truncate text-xs text-muted-foreground">{cuenta.segundaLinea}</span>
              ) : null}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
