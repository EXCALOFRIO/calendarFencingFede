'use client';

import { ChevronLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { BotonIcono } from './boton';
import { anteriorEsDeLaApp, ATRIBUTO_VUELTA, rutaMadre, TIPO_TRANSICION } from './navegacion';

/**
 * Cabecera de pantalla (`docs/diseno-sistema.md` § 1.2): 48 px, sólida, y un
 * filete abajo que sólo aparece cuando el contenido ya pasa por debajo.
 *
 * - `raiz`: la de una pestaña. Título a la izquierda en condensada de 20 px.
 * - `subpantalla`: flecha de volver, título centrado de 16 px.
 *
 * Va dentro de cada `page`, no en el layout, porque cada pantalla tiene su
 * título y sus acciones. Durante la transición de página se queda quieta: la
 * ancla `view-transition-name: cabecera` (ver `sistema.css`).
 */
export type PropsCabeceraCompacta = {
  /** `null`: sólo la flecha y las acciones (la pantalla pinta su título). */
  titulo: React.ReactNode | null;
  variante?: 'raiz' | 'subpantalla';
  /** Ruta a la que sube «Volver» si la pantalla se abrió con un enlace directo. */
  volverA?: string;
  /** Hasta dos `BotonIcono`; más acciones van en una hoja. */
  acciones?: React.ReactNode;
  /** Algo a la izquierda en vez de la flecha (el logo en la portada). */
  inicio?: React.ReactNode;
  /** `false` para la página de muestra, donde hay varias cabeceras a la vez. */
  anclada?: boolean;
  /** `false` para pintarla en línea (muestra, arneses). */
  pegajosa?: boolean;
  className?: string;
};

export function CabeceraCompacta({
  titulo,
  variante = 'subpantalla',
  volverA,
  acciones,
  inicio,
  anclada = true,
  pegajosa = true,
  className,
}: PropsCabeceraCompacta) {
  const desplazada = useDesplazada(pegajosa);
  useRegistrarPantalla();
  const sub = variante === 'subpantalla';
  const izquierda = inicio ?? (sub ? <BotonVolver volverA={volverA} /> : null);

  return (
    <header
      data-slot="sistema-cabecera"
      data-variante={variante}
      data-desplazada={desplazada || undefined}
      className={cn(
        'z-30 border-b bg-background pt-[env(safe-area-inset-top)] transition-[border-color] duration-200',
        pegajosa && 'sticky top-0',
        desplazada ? 'border-filete-alto' : 'border-transparent',
        className,
      )}
      style={anclada ? { viewTransitionName: 'cabecera' } : undefined}
    >
      <div
        className={cn(
          'ancho-app grid h-[48px] items-center gap-[8px] px-[8px]',
          sub ? 'grid-cols-[minmax(36px,1fr)_auto_minmax(36px,1fr)]' : 'grid-cols-[auto_minmax(0,1fr)_auto]',
        )}
      >
        {sub || izquierda ? <div className="flex min-w-0 items-center justify-self-start">{izquierda}</div> : <span aria-hidden />}
        {/* Sin título cuando la pantalla aún pinta su propio `<h1>`: dos encabezados iguales seguidos sobran. */}
        {titulo == null ? (
          <span aria-hidden />
        ) : (
          <h1
            className={cn(
              'min-w-0 truncate',
              sub
                ? 'max-w-[60vw] justify-self-center font-sans text-[16px] leading-[20px] font-semibold tracking-normal'
                : 'pl-[8px] text-[20px] leading-[24px] font-semibold',
            )}
          >
            {titulo}
          </h1>
        )}
        <div className="flex min-w-0 items-center justify-self-end gap-[4px]">{acciones}</div>
      </div>
    </header>
  );
}

function useDesplazada(activa: boolean): boolean {
  const [desplazada, setDesplazada] = useState(false);
  useEffect(() => {
    if (!activa) return;
    const medir = () => setDesplazada(window.scrollY > 2);
    medir();
    window.addEventListener('scroll', medir, { passive: true });
    return () => window.removeEventListener('scroll', medir);
  }, [activa]);
  return desplazada;
}

let pantallasVistas = 0;
let ultimaRuta: string | null = null;

/** Cuenta pantallas vistas en esta pestaña: el respaldo cuando no hay Navigation API. */
function useRegistrarPantalla() {
  const pathname = usePathname() ?? '/';
  useEffect(() => {
    if (ultimaRuta !== pathname) pantallasVistas += 1;
    ultimaRuta = pathname;
  }, [pathname]);
}

/**
 * Volver. Si la pantalla anterior es de la aplicación, vuelve en el historial
 * (con su scroll y sus filtros); si se llegó por un enlace directo, sube a la
 * ruta madre en vez de sacar a la persona de la aplicación.
 */
export function BotonVolver({ volverA, etiqueta = 'Volver' }: { volverA?: string; etiqueta?: string }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();

  return (
    <BotonIcono
      etiqueta={etiqueta}
      tamano="lg"
      className="[&_svg]:size-[22px]"
      onClick={() => {
        if (anteriorEsDeLaApp(window as never, pantallasVistas)) {
          const raiz = document.documentElement;
          raiz.setAttribute(ATRIBUTO_VUELTA, 'atras');
          window.setTimeout(() => raiz.removeAttribute(ATRIBUTO_VUELTA), 700);
          pantallasVistas = Math.max(0, pantallasVistas - 1);
          router.back();
          return;
        }
        router.push(volverA ?? rutaMadre(pathname), { transitionTypes: [TIPO_TRANSICION.volver] });
      }}
    >
      <ChevronLeft aria-hidden strokeWidth={2} />
    </BotonIcono>
  );
}
