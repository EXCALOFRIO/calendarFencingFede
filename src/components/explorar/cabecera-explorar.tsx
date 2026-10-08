'use client';

import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { ViewTransition } from 'react';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { AMBITOS, urlAmbito, type AmbitoExplorar } from '@/lib/sport/explorar/ambitos-url';
import { cn } from '@/lib/utils';

export type PestanaBuscar = 'personas' | 'competiciones' | 'paises';
export type { AmbitoExplorar };

export { RUTA_BUSCAR_PAISES } from '@/lib/sport/explorar/url';

/**
 * Cabecera de Explorar, la misma en sus cuatro ámbitos: el campo de búsqueda
 * del ámbito (`buscador`) arriba y, debajo, el selector «Para ti · Tiradores ·
 * Torneos · Países». El título («Explorar») y la campana van en la cabecera
 * compacta de la aplicación, así que aquí no hay `<h1>`.
 *
 * Cambiar de ámbito sustituye la entrada del historial (Atrás sale de
 * Explorar de una vez) y conserva lo escrito: `q` o, si no se pasa, el `q`
 * de la URL. El selector lleva nombre de transición propio: al cambiar de
 * ruta se funde con el de la pantalla nueva en vez de saltar con la página.
 */
type PropsCabecera = {
  activa?: AmbitoExplorar;
  /** Lo escrito en el ámbito actual; `undefined` lo toma de la URL. */
  q?: string | null;
  /** El campo de búsqueda del ámbito, que va encima del selector. */
  buscador?: React.ReactNode;
  className?: string;
};

export function CabeceraExplorar(props: PropsCabecera) {
  return props.q === undefined && props.activa !== 'inicio' ? <CabeceraConUrl {...props} /> : <Cabecera {...props} q={props.q ?? ''} />;
}

function CabeceraConUrl(props: PropsCabecera) {
  const params = useSearchParams();
  return <Cabecera {...props} q={params?.get('q') ?? ''} />;
}

function Cabecera({ activa = 'personas', q, buscador, className }: PropsCabecera & { q: string }) {
  const texto = activa === 'inicio' ? '' : q;
  const opciones = AMBITOS.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta, href: urlAmbito(a.valor, texto) }));
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 lg:max-w-2xl', className)}>
      {buscador}
      <ViewTransition name="explorar-ambitos" share="sis-fundido" default="none">
        <SelectorSegmentado
          etiqueta="Qué explorar"
          variante="subrayado"
          tamano="sm"
          anchoMinimo={4}
          replace
          valor={activa}
          opciones={opciones}
        />
      </ViewTransition>
    </div>
  );
}
