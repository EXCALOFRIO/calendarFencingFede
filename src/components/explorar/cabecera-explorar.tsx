import Link from 'next/link';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/catalogo-url';
import { RUTA_BUSCAR } from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';

export type PestanaBuscar = 'personas' | 'competiciones' | 'paises';

/** Países vive en `/explorar/buscar` con `?ver=paises`: misma ruta, misma pestaña y cabecera de Buscar. */
export const RUTA_BUSCAR_PAISES = `${RUTA_BUSCAR}?ver=paises`;

/**
 * Pestañas de Buscar: tres pestañas subrayadas (tiradores, competiciones y
 * países), sin pastillas. El título («Buscar») está en la cabecera compacta
 * de la aplicación, así que aquí no hay `<h1>`. Siguiendo está en Tú.
 */
export function CabeceraExplorar({ activa = 'personas' }: { activa?: PestanaBuscar }) {
  const pestana = (clave: PestanaBuscar, href: string, texto: string) => (
    <Link
      href={href}
      prefetch={false}
      aria-current={activa === clave ? 'page' : undefined}
      // Se ve de 36 px y se toca en 44 (el `::after`); el subrayado va en `::before`.
      className={cn(
        'flex h-[36px] min-w-0 flex-1 items-center justify-center px-1 text-[14px] whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring sm:flex-none sm:px-5',
        AREA_TACTIL,
        activa === clave
          ? 'font-semibold text-foreground before:absolute before:inset-x-0 before:bottom-0 before:h-[2px] before:rounded-full before:bg-foreground'
          : 'font-medium text-muted-foreground hover:text-foreground',
      )}
    >
      {texto}
    </Link>
  );
  return (
    <nav aria-label="Qué buscar" className="-mt-[4px] flex min-w-0 border-b border-filete-alto lg:max-w-2xl">
      {pestana('personas', RUTA_BUSCAR, 'Tiradores')}
      {pestana('competiciones', RUTA_EDICIONES, 'Competiciones')}
      {pestana('paises', RUTA_BUSCAR_PAISES, 'Países')}
    </nav>
  );
}
