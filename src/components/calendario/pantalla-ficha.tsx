'use client';

import { ChevronLeft } from 'lucide-react';
import { Dialog } from 'radix-ui';
import * as React from 'react';
import { BotonIcono } from '@/components/sistema/boton';
import { cn } from '@/lib/utils';

/**
 * La ficha de un torneo como subpantalla (`docs/diseno-sistema.md` § 1.2):
 * en el móvil ocupa la pantalla entera, con la flecha de volver y el título
 * centrado; desde 640 px es un panel a la derecha sobre el calendario.
 *
 * No es una ruta: el calendario ya tiene el torneo en memoria y la ficha se
 * pinta al instante. Para que el botón «Atrás» del sistema y el gesto de
 * borde la cierren en vez de sacar a la persona del calendario, al abrirla se
 * apila una entrada en el historial (ver `useEntradaDeHistorial`).
 *
 * El título de la cabecera aparece cuando el título grande de la ficha
 * (`[data-titulo-ficha]`) ha pasado por debajo de ella: dos títulos iguales
 * seguidos sobran.
 */
export function PantallaFicha({
  abierta,
  alCerrar,
  titulo,
  children,
}: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  const cuerpo = React.useRef<HTMLDivElement>(null);
  const [conTitulo, setConTitulo] = React.useState(false);

  React.useEffect(() => {
    setConTitulo(false);
    cuerpo.current?.scrollTo({ top: 0 });
  }, [titulo]);

  const medir = React.useCallback(() => {
    const caja = cuerpo.current;
    if (!caja) return;
    const grande = caja.querySelector('[data-titulo-ficha]');
    const visible = grande
      ? grande.getBoundingClientRect().bottom <= caja.getBoundingClientRect().top
      : caja.scrollTop > 8;
    setConTitulo((previo) => (previo === visible ? previo : visible));
  }, []);

  return (
    <Dialog.Root open={abierta} onOpenChange={(o) => (o ? null : alCerrar())}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-slot="ficha-velo"
          className="fixed inset-0 z-50 hidden bg-velo duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:block"
        />
        <Dialog.Content
          data-slot="pantalla-ficha"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // El foco va al panel y no al primer enlace: en el móvil no debe saltar nada.
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none',
            // En el panel, «el fondo» es el del panel: los velos y degradados de dentro se apagan en él.
            'sm:left-auto sm:w-full sm:max-w-xl sm:border-l sm:border-filete-alto sm:bg-popover sm:shadow-[var(--sombra-hoja-der)] sm:[--background:var(--popover)]',
            // Avanza: 28 px y fundido al entrar, sólo fundido al salir. Con movimiento reducido, nada.
            'ease-[cubic-bezier(0.2,0,0,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-[28px] data-[state=open]:duration-200',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[120ms]',
            'motion-reduce:data-[state=open]:slide-in-from-right-0',
          )}
        >
          <header data-slot="pantalla-ficha-cabecera" className="shrink-0 border-b border-filete bg-inherit pt-[env(safe-area-inset-top)]">
            <div className="grid h-[48px] grid-cols-[minmax(36px,1fr)_auto_minmax(36px,1fr)] items-center gap-[8px] px-[8px]">
              <Dialog.Close asChild>
                <BotonIcono etiqueta="Volver" tamano="lg" className="justify-self-start [&_svg]:size-[22px]">
                  <ChevronLeft aria-hidden strokeWidth={2} />
                </BotonIcono>
              </Dialog.Close>
              <Dialog.Title
                className={cn(
                  // Dos renglones como mucho: 2 × 20 px caben en la fila de 48.
                  'max-w-[60vw] min-w-0 line-clamp-2 break-words text-center font-sans text-[16px] leading-[20px] font-semibold tracking-normal transition-opacity duration-150 sm:max-w-[420px]',
                  conTitulo ? 'opacity-100' : 'opacity-0',
                )}
              >
                {titulo}
              </Dialog.Title>
              <span aria-hidden />
            </div>
          </header>
          <div
            ref={cuerpo}
            data-slot="pantalla-ficha-cuerpo"
            onScroll={medir}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Una entrada del historial mientras hay una ficha abierta: «Atrás» la
 * cierra y deja el calendario como estaba. Cerrarla con la flecha, Escape o
 * el velo deshace la entrada. Pasar de una ficha a otra (de los resultados a
 * la ficha del mismo torneo) no apila nada más.
 */
export function useEntradaDeHistorial(abierta: boolean, cerrar: () => void) {
  const apilada = React.useRef(false);
  const cerrarVivo = React.useRef(cerrar);
  React.useEffect(() => {
    cerrarVivo.current = cerrar;
  }, [cerrar]);

  React.useEffect(() => {
    if (abierta && !apilada.current) {
      window.history.pushState({ ...(window.history.state ?? {}), fichaCalendario: true }, '');
      apilada.current = true;
    } else if (!abierta && apilada.current) {
      apilada.current = false;
      window.history.back();
    }
  }, [abierta]);

  React.useEffect(() => {
    if (!abierta) return;
    const alVolver = () => {
      apilada.current = false;
      cerrarVivo.current();
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, [abierta]);
}
