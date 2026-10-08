import * as React from 'react';
import { FotoDeportista } from '@/components/explorar/foto-deportista';
import type { FotoPublicada } from '@/lib/sport/explorar/foto-contrato';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';

/**
 * El avatar de una persona en cuatro medidas. Con `personaId` delega en
 * `FotoDeportista`, que agrupa las peticiones de foto de toda la pantalla en
 * una sola y sólo pide las que se ven; sin él, o mientras no hay foto, se
 * ven las iniciales, y es el único sitio donde se calculan.
 */

export type TamanoAvatar = 28 | 40 | 56 | 96;

const CAJA: Record<TamanoAvatar, string> = {
  28: 'size-7 text-xs',
  40: 'size-10 text-sm',
  56: 'size-14 text-base',
  96: 'size-24 text-2xl',
};

/** La medida de retrato que se pide: el doble de la caja basta en pantallas densas. */
const FOTO: Record<TamanoAvatar, 'mini' | 'retrato'> = { 28: 'mini', 40: 'mini', 56: 'retrato', 96: 'retrato' };

/*
  `FotoDeportista` fija ancho y alto en `style`; sólo una utilidad con
  `!important` gana a un estilo en línea, y así la caja manda sobre la medida.
*/
const AJUSTE_FOTO =
  '[&>div]:w-full! [&>div]:h-full! [&_[data-slot=avatar]]:size-full! [&_[data-slot=avatar-fallback]]:text-[length:inherit]';

export function Avatar({
  personaId,
  nombre,
  tamano = 40,
  apagado = false,
  foto,
  decorativo = true,
  className,
}: {
  personaId?: string | null;
  nombre: string;
  tamano?: TamanoAvatar;
  /** Sin resultados propios o baja: la foto en gris. */
  apagado?: boolean;
  /** Ya resuelta en el servidor; `null` es «sin foto». */
  foto?: FotoPublicada | null;
  /** Junto a un nombre visible el avatar no se anuncia. */
  decorativo?: boolean;
  className?: string;
}) {
  const caja = cn(
    'relative inline-flex shrink-0 overflow-hidden rounded-full',
    CAJA[tamano],
    apagado && '[&_img]:grayscale',
    className,
  );
  if (personaId) {
    return (
      <span data-slot="sistema-avatar" className={cn(caja, AJUSTE_FOTO)}>
        <FotoDeportista personaId={personaId} nombre={nombre} tamano={FOTO[tamano]} decorativa={decorativo} foto={foto} />
      </span>
    );
  }
  return (
    <span
      data-slot="sistema-avatar"
      className={cn(caja, 'items-center justify-center border border-border bg-muted font-semibold text-foreground')}
      aria-hidden={decorativo || undefined}
      role={decorativo ? undefined : 'img'}
      aria-label={decorativo ? undefined : nombre}
    >
      {inicialesVisibles(nombre) || '—'}
    </span>
  );
}
