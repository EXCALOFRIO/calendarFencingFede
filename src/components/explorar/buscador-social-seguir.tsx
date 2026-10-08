'use client';

import { Check, RotateCw, UserPlus } from 'lucide-react';
import { useEffect, useOptimistic, useState, useTransition } from 'react';
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
  const aviso = pendiente ? 'Guardando el cambio…' : cambio && !error ? mensajeSeguir(cambio, nombre) : '';
  // La región ya existe antes del primer aviso: una región que nace con el texto no siempre se anuncia.
  useEffect(() => {
    regionAviso();
  }, []);
  useEffect(() => {
    if (aviso) regionAviso().textContent = aviso;
  }, [aviso]);
  const Icono = error ? RotateCw : optimista ? Check : UserPlus;
  const etiqueta = error
    ? `Reintentar: seguir a ${nombre}`
    : optimista
      ? `Siguiendo: toca para dejar de seguir a ${nombre}`
      : `Seguir a ${nombre}`;
  return (
    <span className={cn('relative shrink-0', className)}>
      {/*
        La pastilla mide 30 px, pero el botón ocupa los 44 px de alto de un toque.
        Por debajo de 360 px la palabra se come el nombre: queda sólo el icono en
        un botón de 44 × 44, y la etiqueta lo dice entero.
      */}
      <button
        type="button"
        onClick={alternar}
        aria-disabled={pendiente}
        aria-busy={pendiente}
        aria-label={etiqueta}
        title={optimista ? `Dejar de seguir a ${nombre}` : `Seguir a ${nombre}: es privado y no le avisa`}
        data-estado={optimista ? 'favorito' : 'sin-guardar'}
        className="group relative flex h-[44px] cursor-pointer items-center justify-center rounded-lg outline-none aria-disabled:cursor-wait max-[359px]:size-[44px]"
      >
        <span
          className={cn(
            clasesSeguir(optimista, error),
            'h-[30px] gap-1 rounded-full px-3 text-sm group-focus-visible:ring-[3px] group-focus-visible:ring-ring',
            'max-[359px]:size-[32px] max-[359px]:px-0',
            pendiente && 'opacity-70',
          )}
        >
          <span className="max-[359px]:sr-only">{error ? 'Reintentar' : optimista ? 'Siguiendo' : 'Seguir'}</span>
          <Icono
            className={cn('size-[16px]', !optimista || error ? 'min-[360px]:hidden' : 'min-[360px]:size-[14px]')}
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      </button>
      {error ? <span role="alert" className="sr-only">{mensajeSeguir(cambio, nombre)}</span> : null}
    </span>
  );
}

/**
 * Una sola región viva para todos los «Seguir» de la pantalla: con una por
 * fila, una lista de 25 resultados eran 25 regiones `status` vacías.
 */
function regionAviso(): HTMLElement {
  let region = document.getElementById(ID_AVISO);
  if (!region) {
    region = document.createElement('div');
    region.id = ID_AVISO;
    region.setAttribute('role', 'status');
    region.className = 'sr-only';
    document.body.appendChild(region);
  }
  return region;
}

const ID_AVISO = 'aviso-seguir';