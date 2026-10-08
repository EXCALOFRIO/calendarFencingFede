import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { EnlacePrecarga } from './enlace-precarga';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from './tactil';

/**
 * Cabecera de página, sección o grupo: título, una línea de contexto
 * opcional y una acción a la derecha (normalmente `VerMas`).
 *
 *   pagina  → h1, text-2xl
 *   seccion → h2, text-lg
 *   grupo   → h3, text-sm en gris (los subtítulos de una lista)
 */

export type NivelCabecera = 'pagina' | 'seccion' | 'grupo';

const ETIQUETA: Record<NivelCabecera, 'h1' | 'h2' | 'h3'> = { pagina: 'h1', seccion: 'h2', grupo: 'h3' };

const TITULO: Record<NivelCabecera, string> = {
  pagina: 'text-2xl font-semibold text-foreground',
  seccion: 'text-lg font-semibold text-foreground',
  grupo: 'text-sm font-medium text-muted-foreground',
};

export function CabeceraSeccion({
  titulo,
  nivel = 'seccion',
  como,
  contexto,
  accion,
  id,
  className,
}: {
  titulo: React.ReactNode;
  nivel?: NivelCabecera;
  /** Otro nivel de encabezado si la jerarquía de la página lo pide. */
  como?: 'h1' | 'h2' | 'h3' | 'h4';
  /** Línea pequeña bajo el título: «12 pruebas», «Actualizado el 5 oct». */
  contexto?: React.ReactNode;
  accion?: React.ReactNode;
  /** Para `aria-labelledby` de la sección. */
  id?: string;
  className?: string;
}) {
  const Titulo = como ?? ETIQUETA[nivel];
  return (
    <div
      data-slot="sistema-cabecera-seccion"
      data-nivel={nivel}
      className={cn('flex min-w-0 items-center justify-between gap-3', nivel === 'grupo' ? 'min-h-8' : 'min-h-11', className)}
    >
      <div className="flex min-w-0 flex-col">
        <Titulo id={id} className={cn('min-w-0 truncate leading-tight', TITULO[nivel])}>
          {titulo}
        </Titulo>
        {contexto ? <p className="min-w-0 truncate text-sm text-muted-foreground">{contexto}</p> : null}
      </div>
      {accion ? <div className="flex shrink-0 items-center gap-2">{accion}</div> : null}
    </div>
  );
}

/** «Ver más» o «Ver más (12)». La única redacción para abrir el resto de una lista. */
export function textoVerMas(cuenta?: number | null): string {
  return cuenta != null && cuenta > 0 ? `Ver más (${cuenta})` : 'Ver más';
}

export function VerMas({
  href,
  onClick,
  cuenta,
  detalle,
  className,
}: {
  href?: string;
  /** Sin `href`, botón. Sólo desde componentes cliente. */
  onClick?: () => void;
  cuenta?: number | null;
  /** Lo que se oye detrás, para distinguir varios «Ver más» en una página: «de clasificación». */
  detalle?: string;
  className?: string;
}) {
  const clases = cn(
    SIN_MINIMO,
    FOCO,
    AREA_TACTIL,
    'inline-flex h-8 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary-text [&_svg]:size-4',
    className,
  );
  const contenido = (
    <>
      <span>{textoVerMas(cuenta)}</span>
      {detalle ? <span className="sr-only"> {detalle}</span> : null}
      <ChevronRight aria-hidden />
    </>
  );
  if (href) {
    return (
      <EnlacePrecarga href={href} data-slot="sistema-ver-mas" className={clases}>
        {contenido}
      </EnlacePrecarga>
    );
  }
  return (
    <button type="button" onClick={onClick} data-slot="sistema-ver-mas" className={clases}>
      {contenido}
    </button>
  );
}
