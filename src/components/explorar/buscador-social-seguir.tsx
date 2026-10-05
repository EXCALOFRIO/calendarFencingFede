'use client';

import { useOptimistic, useState, useTransition } from 'react';
import {
  guardarFavoritoAccion,
  quitarFavoritoAccion,
} from '@/app/(app)/explorar/favoritos-acciones';
import { Button } from '@/components/ui/button';
import { alternarFavorito } from '@/lib/sport/explorar/favorito-alternar';
import {
  type LecturaFavorito,
  estadoInicial,
  iniciarOperacion,
  reconciliarProp,
  resolverOperacion,
} from '@/lib/sport/explorar/favorito-estado';
import { cn } from '@/lib/utils';
import { mensajeSeguir } from './boton-favorito';

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
      <Button
        type="button"
        size="sm"
        variant={optimista ? 'outline' : 'default'}
        onClick={alternar}
        aria-disabled={pendiente}
        aria-busy={pendiente}
        title={optimista ? `Dejar de seguir a ${nombre}` : `Seguir a ${nombre}: es privado y no le avisa`}
        data-estado={optimista ? 'favorito' : 'sin-guardar'}
        className={cn(
          'min-w-[5.5rem] cursor-pointer rounded-lg px-2.5 text-[0.8125rem] font-semibold aria-disabled:cursor-wait sm:min-w-[6.25rem] sm:px-3 sm:text-sm',
          optimista && 'border-filete-alto bg-transparent text-foreground hover:bg-accent',
          pendiente && 'opacity-70',
        )}
      >
        {error ? 'Reintentar' : optimista ? 'Siguiendo' : 'Seguir'}
        <span className="sr-only">
          {optimista ? `: toca para dejar de seguir a ${nombre}` : ` a ${nombre}`}
        </span>
      </Button>
      <span role="status" className="sr-only">
        {pendiente ? 'Guardando el cambio…' : cambio && !error ? mensajeSeguir(cambio, nombre) : ''}
      </span>
      {error ? <span role="alert" className="sr-only">{mensajeSeguir(cambio, nombre)}</span> : null}
    </span>
  );
}
