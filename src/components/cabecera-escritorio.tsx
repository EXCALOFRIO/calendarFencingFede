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
          className={cn('flex h-[36px] shrink-0 items-center gap-[10px] rounded-full pr-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring', AREA_TACTIL)}
        >
          <Marca className="size-[28px]" />
          <span className="text-[15px] font-semibold tracking-tight">
            Calendar<span className="text-primary-text">Fencing</span>
          </span>
        </Link>

        <div className="mx-auto">
          <NavEscritorio />
        </div>

        <div className="flex shrink-0 items-center gap-[4px]">
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
            aria-label={`Tú: ${cuenta.nombre}`}
            className={cn('flex h-[40px] items-center gap-[8px] rounded-full py-[4px] pr-[10px] pl-[4px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', AREA_TACTIL)}
          >
            <Avatar className="size-[32px]">
              <AvatarFallback className="text-[12px]">{cuenta.iniciales}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="max-w-36 truncate text-[12px] font-medium">{cuenta.nombre}</span>
              {cuenta.segundaLinea ? (
                <span className="max-w-36 truncate text-[11px] text-muted-foreground">{cuenta.segundaLinea}</span>
              ) : null}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
