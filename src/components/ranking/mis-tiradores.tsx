'use client';

import type * as React from 'react';
import { Escudo } from '@/components/escudo';
import { Avatar } from '@/components/sistema/avatar';
import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { cn } from '@/lib/utils';
import type { Federacion } from '@/components/escudo';

export type TiradorPropio = {
  athleteId: string;
  apellidos: string;
  nombre: string;
  personaId: string | null;
  lados: LadoCompacto[];
};

/** Un lado (nacional o internacional) con su mejor puesto de la temporada. */
export type LadoCompacto = {
  federacion: Federacion;
  etiqueta: string;
  motivoVacio?: string;
  mejor: { etiqueta: string; puesto: number | null } | null;
};

type Lado = 'RFEE' | 'FIE';

/**
 * Tus tiradores, arriba y en poco sitio: avatar, nombre y su mejor puesto
 * nacional e internacional de la temporada, en un segmentado. Elegir un lado
 * cambia la tabla de abajo a ese ranking. El detalle largo (pares, tira de
 * temporadas) vive en la ficha de cada uno en Explorar.
 */
export function MisTiradores({
  tiradores,
  elegida,
  onElegir,
  onIntencion,
}: {
  tiradores: readonly TiradorPropio[];
  /** El ranking que se ve; con el europeo no se marca ningún lado. */
  elegida: 'RFEE' | 'FIE' | 'EFC';
  onElegir: (f: Lado) => void;
  /** El dedo llega a un lado: se puede adelantar la tabla de ese ranking. */
  onIntencion?: (f: Lado) => void;
}) {
  if (tiradores.length === 0) return null;
  /*
    El segmentado no admite eventos por opción: el dedo o el foco se leen al
    subir hasta la tarjeta y el lado se reconoce por `data-lado`.
  */
  const intencion = (e: React.SyntheticEvent) => {
    const lado = (e.target as Element).closest('button')?.querySelector<HTMLElement>('[data-lado]')?.dataset.lado;
    if (lado === 'RFEE' || lado === 'FIE') onIntencion?.(lado);
  };
  return (
    <section aria-label="Tus tiradores" className="flex min-w-0 flex-col gap-2">
      <CabeceraSeccion nivel="grupo" titulo={tiradores.length === 1 ? 'Tu tirador' : 'Tus tiradores'} />
      <div className={cn('grid min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border', tiradores.length > 1 && 'sm:grid-cols-2')}>
        {tiradores.map((t) => {
          const nombre = `${t.nombre} ${t.apellidos}`.trim();
          return (
            <article
              key={t.athleteId}
              data-tirador-propio={t.athleteId}
              className="flex min-w-0 items-center gap-3 bg-card px-3 py-2"
            >
              <Avatar personaId={t.personaId} nombre={nombre} tamano={40} />
              <div
                className="flex min-w-0 flex-1 flex-col gap-1"
                onPointerOver={intencion}
                onPointerDown={intencion}
                onFocus={intencion}
              >
                <p className="truncate text-sm font-semibold" title={nombre}>{nombre}</p>
                <SelectorSegmentado
                  etiqueta={`Ranking de ${nombre}`}
                  tamano="sm"
                  anchoMinimo={6}
                  valor={elegida === 'EFC' ? null : elegida}
                  onCambio={(v) => onElegir(v as Lado)}
                  opciones={t.lados.map((lado) => {
                    const fed: Lado = lado.federacion === 'FIE' ? 'FIE' : 'RFEE';
                    const mejor = lado.mejor;
                    const puesto = mejor?.puesto ?? null;
                    return {
                      valor: fed,
                      deshabilitada: !mejor,
                      etiqueta: (
                        <span data-lado={fed} className="inline-flex min-w-0 items-center gap-1">
                          <Escudo federacion={lado.federacion} tamano="nota" decorativo />
                          {/* En el móvil el escudo ya dice cuál es; el nombre queda para el lector de pantalla. */}
                          <span className="shrink-0 max-sm:sr-only">{lado.etiqueta}</span>
                          <span className="cifra shrink-0">{puesto !== null ? `${puesto}º` : '—'}</span>
                          {mejor ? (
                            <span className="min-w-0 truncate font-normal">{mejor.etiqueta}</span>
                          ) : lado.motivoVacio ? (
                            <span className="sr-only">{lado.motivoVacio}</span>
                          ) : null}
                        </span>
                      ),
                    };
                  })}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
