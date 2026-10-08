'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { BotonIcono } from './boton';
import { conResistencia, decidirCierre } from './gesto-hoja';

/**
 * Hoja inferior (`docs/diseno-sistema.md` § 1.4). En el móvil sube desde
 * abajo y se cierra arrastrando el asa o la cabecera hacia abajo, tocando el
 * velo o con Escape; desde 640 px es un panel centrado de 440 px.
 *
 * Es un `Dialog` de Radix: foco atrapado, bloqueo del scroll de detrás y
 * `aria-modal` vienen de ahí. Superficie de cristal de panel
 * (`.cristal-panel`, sobre `--popover`); el velo es `--velo`, sin desenfoque
 * (ver `globals.css`).
 */
export type PropsHojaInferior = {
  abierta: boolean;
  alCambiar: (abierta: boolean) => void;
  titulo: string;
  /** Una línea, sólo si el título no basta. */
  descripcion?: string;
  /** Acción principal fija abajo (p. ej. «Ver 120 resultados»). */
  pie?: React.ReactNode;
  /** Botón que la abre; si no se pasa, se controla sólo con `abierta`. */
  disparador?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

const CURVA = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function HojaInferior({
  abierta,
  alCambiar,
  titulo,
  descripcion,
  pie,
  disparador,
  children,
  className,
}: PropsHojaInferior) {
  const panel = useRef<HTMLDivElement>(null);
  const gesto = useRef<{ y0: number; y: number; t: number; v: number } | null>(null);

  const empezar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !panel.current) return;
    if (window.matchMedia('(min-width: 640px)').matches) return;
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    gesto.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    panel.current.style.transition = 'none';
  };

  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    if (!g || !panel.current) return;
    const dt = Math.max(1, e.timeStamp - g.t);
    g.v = (e.clientY - g.y) / dt;
    g.y = e.clientY;
    g.t = e.timeStamp;
    panel.current.style.transform = `translate3d(0, ${conResistencia(e.clientY - g.y0)}px, 0)`;
  };

  const soltar = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    gesto.current = null;
    if (!g || !panel.current) return;
    const cerrar = decidirCierre({
      desplazamiento: e.clientY - g.y0,
      alto: panel.current.offsetHeight,
      velocidad: g.v,
    });
    if (cerrar) {
      // La animación de salida parte de la posición arrastrada: no se toca el transform.
      panel.current.style.transition = '';
      alCambiar(false);
      return;
    }
    panel.current.style.transition = `transform 220ms ${CURVA}`;
    panel.current.style.transform = '';
  };

  return (
    <Dialog.Root open={abierta} onOpenChange={alCambiar}>
      {disparador ? <Dialog.Trigger asChild>{disparador}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay
          data-slot="sistema-hoja-velo"
          className="fixed inset-0 z-50 bg-velo data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <Dialog.Content
          ref={panel}
          data-slot="sistema-hoja"
          onOpenAutoFocus={(e) => {
            // Sin esto el foco cae en el primer campo y en el móvil sube el teclado.
            e.preventDefault();
            panel.current?.focus();
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[min(88dvh,calc(100dvh-48px))] flex-col',
            'cristal-panel rounded-t-[16px] border-t pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-[var(--sombra-hoja-aba)] outline-none',
            // Duraciones y curvas: `sistema.css` (240 / 180 ms, las mismas que las hojas de `ui/`).
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[min(640px,calc(100dvh-64px))] sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:rounded-[16px] sm:border sm:pb-0 sm:shadow-[var(--sombra-flotante)]',
            'sm:data-[state=open]:slide-in-from-bottom-[16px] sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:slide-out-to-bottom-[16px] sm:data-[state=closed]:fade-out-0',
            className,
          )}
          {...(descripcion ? {} : { 'aria-describedby': undefined })}
        >
          <div
            data-slot="sistema-hoja-asa"
            className="shrink-0 touch-none select-none sm:touch-auto"
            onPointerDown={empezar}
            onPointerMove={mover}
            onPointerUp={soltar}
            onPointerCancel={soltar}
          >
            <div aria-hidden className="mx-auto mt-[8px] h-[4px] w-[36px] rounded-full bg-[color-mix(in_oklab,var(--muted-foreground)_45%,var(--popover))] sm:hidden" />
            <div className="grid h-[44px] grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-[8px] px-[8px] sm:h-[52px]">
              <span aria-hidden />
              <Dialog.Title className="line-clamp-2 break-words text-center font-sans text-base leading-5 font-semibold tracking-normal">
                {titulo}
              </Dialog.Title>
              <Dialog.Close asChild>
                <BotonIcono etiqueta="Cerrar" tamano="md" className="justify-self-end">
                  <X aria-hidden />
                </BotonIcono>
              </Dialog.Close>
            </div>
            {descripcion ? (
              <Dialog.Description className="-mt-1 px-[16px] pb-[8px] text-center text-sm text-muted-foreground">
                {descripcion}
              </Dialog.Description>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[16px] pb-[16px]">{children}</div>
          {pie ? <div className="shrink-0 border-t border-filete px-[16px] py-[12px]">{pie}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
