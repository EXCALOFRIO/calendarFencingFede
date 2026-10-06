import { Rss, Star, Trophy } from 'lucide-react';
import Link from 'next/link';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/catalogo-url';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';

// 44 px de alto dibujados, no sólo de toque. Por debajo de 400 px la letra baja a 13 px y por debajo de 360 px se van los iconos, para que las tres quepan sin cortarse.
const PASTILLA =
  'flex h-11 min-w-0 shrink items-center gap-1 rounded-full border bg-card px-2 text-[0.8125rem] max-[359px]:px-2.5 max-[359px]:text-xs min-[400px]:px-3 min-[400px]:text-sm font-medium whitespace-nowrap hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/**
 * Cabecera de la pantalla principal: el nombre de la sección y sus tres
 * colecciones en una sola fila de pastillas con icono y palabra.
 */
export function CabeceraExplorar({ siguiendo }: { siguiendo: number | null }) {
  return (
    <header className="flex min-w-0 flex-col gap-3">
      <h1 className="text-3xl leading-none sm:text-4xl">{NOMBRE_SECCION}</h1>
      <nav aria-label={`Colecciones de ${NOMBRE_SECCION}`} className="flex min-w-0 flex-nowrap gap-1 min-[400px]:gap-2">
        <Link href={RUTA_SIGUIENDO} prefetch={false} className={PASTILLA}>
          <Rss className="size-3.5 shrink-0 text-muted-foreground max-[359px]:hidden" aria-hidden />
          <span className="truncate">Siguiendo</span>
          {typeof siguiendo === 'number' && siguiendo > 0 ? (
            <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[0.6875rem] leading-[1.125rem] tabular-nums text-foreground">
              {siguiendo.toLocaleString('es-ES')}
            </span>
          ) : null}
        </Link>
        <Link href={RUTA_EDICIONES} prefetch={false} className={PASTILLA}>
          <Trophy className="size-3.5 shrink-0 text-muted-foreground max-[359px]:hidden" aria-hidden />
          <span className="truncate">Ediciones</span>
        </Link>
        <Link href={RUTA_FAVORITOS} prefetch={false} className={PASTILLA}>
          <Star className="size-3.5 shrink-0 text-muted-foreground max-[359px]:hidden" aria-hidden />
          <span className="truncate">Favoritos</span>
        </Link>
      </nav>
    </header>
  );
}
