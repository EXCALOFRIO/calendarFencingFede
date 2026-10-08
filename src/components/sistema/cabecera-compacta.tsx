'use client';

import { ChevronLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { BotonIcono } from './boton';
import { anteriorEsDeLaApp, ATRIBUTO_VUELTA, rutaMadre, TIPO_TRANSICION } from './navegacion';

/**
 * Cabecera de pantalla (`docs/diseno-sistema.md` § 1.2): 48 px. En reposo
 * tiene el color del lienzo; cuando el contenido ya pasa por debajo, pasa a
 * cristal (`.cristal`) con su filete abajo.
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
  /** `false`: el título se pinta como rótulo (`<p>`) porque el `<h1>` es el nombre que pinta la pantalla. */
  encabezado?: boolean;
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
  encabezado = true,
  className,
}: PropsCabeceraCompacta) {
  const desplazada = useDesplazada(pegajosa);
  useRegistrarPantalla();
  const sub = variante === 'subpantalla';
  const Titulo = encabezado ? 'h1' : 'p';
  const izquierda = inicio ?? (sub ? <BotonVolver volverA={volverA} /> : null);

  return (
    <header
      data-slot="sistema-cabecera"
      data-variante={variante}
      data-desplazada={desplazada || undefined}
      className={cn(
        'cristal z-30 border-b pt-[env(safe-area-inset-top)] transition-[border-color,background-color] duration-200',
        pegajosa && 'sticky top-0',
        // En reposo se funde con el lienzo; el cristal y su canto aparecen cuando el contenido pasa por debajo.
        !desplazada && 'border-transparent bg-background',
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
          <Titulo
            className={cn(
              // Dos renglones como mucho (WCAG 1.4.4/1.4.10): 2 × 20 px o 2 × 24 px caben en los 48 px de la fila.
              'min-w-0 line-clamp-2 break-words',
              sub
                ? 'max-w-[60vw] justify-self-center text-center font-sans text-base leading-5 font-semibold tracking-normal'
                : 'pl-[8px] text-xl leading-6 font-semibold',
              !encabezado && !sub && 'font-display',
            )}
          >
            {titulo}
          </Titulo>
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
