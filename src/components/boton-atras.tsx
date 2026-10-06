'use client';

import { ChevronLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

/** Ruta madre: `/explorar/ediciones/abc` → `/explorar/ediciones`. */
export function rutaMadre(pathname: string): string {
  const partes = pathname.split('/').filter(Boolean);
  return partes.length <= 1 ? '/' : `/${partes.slice(0, -1).join('/')}`;
}

/** Sólo en subpantallas: en las secciones de la barra no hay «atrás». */
export function esSubpantalla(pathname: string): boolean {
  return pathname.split('/').filter(Boolean).length > 1;
}

/**
 * Flecha de volver de la cabecera, como en las aplicaciones de móvil. Instalada
 * como aplicación (PWA) no hay botón atrás del navegador, y los enlaces
 * «Volver a…» dentro de cada pantalla ocupaban una fila entera.
 *
 * Si se llegó navegando dentro de la aplicación vuelve en el historial (con el
 * scroll y los filtros de antes); si se abrió un enlace directo, sube a la
 * ruta madre en vez de sacar a la persona de la aplicación.
 */
export function BotonAtras() {
  const pathname = usePathname();
  const router = useRouter();
  const pasos = useRef(-1);

  useEffect(() => {
    pasos.current += 1;
  }, [pathname]);

  if (!esSubpantalla(pathname)) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Volver"
      className="-ml-2 size-11 shrink-0"
      onClick={() => (pasos.current > 0 ? router.back() : router.push(rutaMadre(pathname)))}
    >
      <ChevronLeft className="size-6" aria-hidden />
    </Button>
  );
}
