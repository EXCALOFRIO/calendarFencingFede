import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';

/**
 * Anillo de los retratos: degradado entre los dos carmesís del tema. Vive
 * aquí y no en `foto-deportista.tsx` porque aquel es un módulo de cliente y
 * una constante importada desde él en un componente de servidor llega como
 * referencia de cliente, no como texto.
 */
export const ANILLO = 'rounded-full bg-linear-to-tr from-primary via-primary-text to-primary p-[2px]';

const TAMANOS = {
  sm: { caja: 'size-10', letra: 'text-sm' },
  md: { caja: 'size-16', letra: 'text-xl' },
  lg: { caja: 'size-20 sm:size-24', letra: 'text-3xl' },
} as const;

/**
 * Iniciales dentro de un anillo, para listas y carruseles. No pide foto: cada
 * retrato FIE cuesta dos peticiones externas, y en una lista se multiplican.
 * `apagado` cambia el degradado por un filete para quien no es el
 * protagonista de la pantalla.
 */
export function AvatarAnillo({
  nombre,
  tamano = 'md',
  apagado = false,
  className,
}: {
  nombre: string;
  tamano?: keyof typeof TAMANOS;
  apagado?: boolean;
  className?: string;
}) {
  const t = TAMANOS[tamano];
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0', apagado ? 'rounded-full bg-filete-alto p-[2px]' : ANILLO, className)}>
      <span className="inline-flex rounded-full bg-background p-[2px]">
        <Avatar className={t.caja}>
          <AvatarFallback className={cn('font-display', t.letra)}>{inicialesVisibles(nombre) || '—'}</AvatarFallback>
        </Avatar>
      </span>
    </span>
  );
}
