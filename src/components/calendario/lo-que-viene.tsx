'use client';

import * as React from 'react';
import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { agruparEnBloques } from '@/lib/calendario/bloques';
import { diasEntre, hoyMadrid } from '@/lib/fechas';
import type { EventView } from '@/lib/queries/calendar';
import { TarjetaBloque } from './tarjeta-bloque';

/**
 * Lo próximo que no se ve en el mes que se está mirando: la respuesta a «¿y
 * entonces cuándo compito?» cuando el mes está flojo. Pinta la misma tarjeta
 * que el calendario; lo único propio es el título, que dice que esto no es de
 * este mes.
 *
 * Arma, género y categoría van siempre en estas tarjetas, aunque el filtro sea
 * de una sola: son torneos de dentro de semanas y el contexto de la cabecera
 * queda lejos.
 */
export function LoQueViene({
  eventos,
  inscripciones,
  onAbrir,
}: {
  eventos: EventView[];
  /** competitionId -> estado, para marcar en qué estás inscrito. */
  inscripciones: Record<string, string>;
  onAbrir: (e: EventView) => void;
}) {
  const idTitulo = React.useId();
  const bloques = React.useMemo(() => agruparEnBloques(eventos), [eventos]);
  const vacio = React.useMemo(() => new Set<string>(), []);

  if (eventos.length === 0) return null;

  return (
    <section aria-labelledby={idTitulo} className="flex min-h-0 min-w-0 flex-col gap-1">
      <CabeceraSeccion id={idTitulo} titulo="Más adelante" nivel="grupo" como="h2" />
      <ul className="flex min-w-0 flex-col border-t border-border">
        {bloques.map((bloque) => (
          <li key={bloque.clave}>
            <TarjetaBloque
              bloque={bloque}
              inscripciones={inscripciones}
              // Sin resaltado ni «lo próximo»: la búsqueda salta al mes del torneo.
              resaltados={vacio}
              proximo={null}
              mostrarArma
              mostrarGenero
              mostrarCategoria
              onAbrir={onAbrir}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Días naturales hasta una fecha ISO, en el calendario de Madrid. Cero o menos = ya empezó. */
export function diasHasta(iso: string): number {
  return diasEntre(hoyMadrid(), iso.slice(0, 10));
}
