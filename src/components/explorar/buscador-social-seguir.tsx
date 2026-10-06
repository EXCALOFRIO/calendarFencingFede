'use client';

import { Check } from 'lucide-react';
import { useOptimistic, useState, useTransition } from 'react';
import {
  guardarFavoritoAccion,
  quitarFavoritoAccion,
} from '@/app/(app)/explorar/favoritos-acciones';
import { alternarFavorito } from '@/lib/sport/explorar/favorito-alternar';
import {
  type LecturaFavorito,
  estadoInicial,
  iniciarOperacion,
  reconciliarProp,
  resolverOperacion,
} from '@/lib/sport/explorar/favorito-estado';
import { cn } from '@/lib/utils';
import { clasesSeguir, mensajeSeguir } from './boton-favorito';

/**
 * «Seguir» compacto para las filas del buscador: el mismo favorito privado y
 * el mismo estado optimista que `BotonFavorito`, en una pastilla que cabe
 * junto al nombre. Un fallo se anuncia y deja «Reintentar» en el botón, sin
 * texto debajo que descoloque la fila.
 */
export function BotonSeguirCompacto({
  personaId,
  nombre,
  inicial,
  lectura,
  className,
}: {
  personaId: string;
  nombre: string;
  inicial: boolean;
  /** Objeto de la lectura de la que sale `inicial`: instancia nueva en cada lectura. */
  lectura: LecturaFavorito;
  className?: string;
}) {
  const [estado, setEstado] = useState(() => estadoInicial(inicial, lectura));
  const reconciliado = reconciliarProp(estado, inicial, lectura);
  if (reconciliado !== estado) setEstado(reconciliado);
  const { guardado, cambio } = reconciliado;
  const [optimista, setOptimista] = useOptimistic(guardado);
  const [pendiente, iniciar] = useTransition();

  function alternar() {
    if (pendiente || reconciliado.enVuelo) return;
    setEstado(iniciarOperacion);
    iniciar(async () => {
      setOptimista(!guardado);
      const r = await alternarFavorito(personaId, guardado, {
        guardar: guardarFavoritoAccion,
        quitar: quitarFavoritoAccion,
      });
      setEstado((e) => resolverOperacion(e, r));
    });
  }

  const error = cambio?.resultado === 'error';
  return (
    <span className={cn('relative shrink-0', className)}>
      {/* La pastilla mide 32 px, pero el botón ocupa los 44 px de alto de un toque. */}
      <button
        type="button"
        onClick={alternar}
        aria-disabled={pendiente}
        aria-busy={pendiente}
        title={optimista ? `Dejar de seguir a ${nombre}` : `Seguir a ${nombre}: es privado y no le avisa`}
        data-estado={optimista ? 'favorito' : 'sin-guardar'}
        className="group relative flex h-11 cursor-pointer items-center rounded-lg outline-none aria-disabled:cursor-wait"
      >
        <span
          className={cn(
            clasesSeguir(optimista, error),
            'h-8 gap-1 rounded-full px-3 text-sm group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50',
            pendiente && 'opacity-70',
          )}
        >
          {error ? 'Reintentar' : optimista ? (
            // En 320 px «Siguiendo» se come el nombre: queda la marca, y la palabra para el lector.
            <span className="max-[359px]:sr-only">Siguiendo</span>
          ) : 'Seguir'}
          {optimista && !error ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : null}
        </span>
        <span className="sr-only">
          {optimista ? `: toca para dejar de seguir a ${nombre}` : ` a ${nombre}`}
        </span>
      </button>
      <span role="status" className="sr-only">
        {pendiente ? 'Guardando el cambio…' : cambio && !error ? mensajeSeguir(cambio, nombre) : ''}
      </span>
      {error ? <span role="alert" className="sr-only">{mensajeSeguir(cambio, nombre)}</span> : null}
    </span>
  );
}
