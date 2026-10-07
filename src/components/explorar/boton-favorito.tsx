'use client';

import { Star, UserCheck, UserPlus } from 'lucide-react';
import { useOptimistic, useState, useTransition } from 'react';
import {
  guardarFavoritoAccion,
  quitarFavoritoAccion,
} from '@/app/(app)/explorar/favoritos-acciones';
import { Button } from '@/components/ui/button';
import { alternarFavorito, type CambioFavorito } from '@/lib/sport/explorar/favorito-alternar';
import {
  type LecturaFavorito,
  estadoInicial,
  iniciarOperacion,
  reconciliarProp,
  resolverOperacion,
} from '@/lib/sport/explorar/favorito-estado';
import { cn } from '@/lib/utils';

/** Los mensajes de favoritos, dichos como «seguir». Los errores no cambian. */
export function mensajeSeguir(cambio: CambioFavorito | null | undefined, nombre: string): string | undefined {
  if (!cambio) return undefined;
  if (cambio.resultado === 'guardado') return `Ahora sigues a ${nombre}. Es privado: no recibe ningún aviso.`;
  if (cambio.resultado === 'quitado') return `Has dejado de seguir a ${nombre}.`;
  return cambio.mensaje;
}

/**
 * Aspecto de «Seguir» en todo Explorar, como en una red social: lleno para
 * seguir y apagado, con su marca, para «Siguiendo». El tamaño lo pone cada uso.
 */
export function clasesSeguir(siguiendo: boolean, error = false): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1 rounded-lg font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none',
    error
      ? 'bg-transparent text-danger ring-1 ring-danger/50 ring-inset'
      : siguiendo
        ? 'bg-secondary text-foreground ring-1 ring-filete-alto ring-inset group-hover:bg-accent'
        : 'bg-primary text-primary-foreground group-hover:brightness-110',
  );
}

/** Destino del foco tras quitar desde la lista, cuando la fila desaparece. */
export const ID_ENCABEZADO_FAVORITOS = 'favoritos-resultados';

/**
 * Estrella de favorito. El estado cambia al instante y se confirma (o se
 * deshace con un mensaje) cuando responde el servidor. Un favorito es sólo un
 * acceso rápido privado: ni este control ni sus textos prometen avisos.
 *
 * Mientras hay una petición en curso el botón queda `aria-disabled` (no
 * `disabled`, para no perder el foco del teclado) y los toques repetidos se
 * ignoran: no hay dos peticiones a la vez. Aun así, guardar es idempotente en
 * el servidor.
 */
export function BotonFavorito({
  personaId,
  nombre,
  inicial,
  lectura,
  variante = 'ficha',
}: {
  personaId: string;
  nombre: string;
  inicial: boolean;
  /** Objeto de la lectura de servidor de la que sale inicial: instancia nueva en cada lectura. */
  lectura: LecturaFavorito;
  /** `perfil` es el botón con rótulo de la cabecera de la ficha. */
  variante?: 'ficha' | 'lista' | 'perfil';
}) {
  const [estado, setEstado] = useState(() => estadoInicial(inicial, lectura));
  // La misma instancia sigue montada al navegar o refrescar: una lectura nueva
  // se reconcilia durante el render, aunque su valor sea igual al anterior, sin
  // pisar una operación en vuelo.
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
      if (variante === 'lista' && r.resultado === 'quitado') {
        document.getElementById(ID_ENCABEZADO_FAVORITOS)?.focus();
      }
    });
  }

  const accion = optimista ? 'Quitar de favoritos' : 'Guardar en favoritos';
  const mensaje = variante === 'perfil' ? mensajeSeguir(cambio, nombre) : cambio?.mensaje;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      {variante === 'perfil' ? (
        // «Seguir» es el mismo favorito privado. El rótulo cambia como en
        // cualquier red social, así que no lleva `aria-pressed` (anunciaría el
        // estado dos veces); el nombre accesible empieza por el texto visible.
        <button
          type="button"
          onClick={alternar}
          aria-disabled={pendiente}
          aria-busy={pendiente}
          title={optimista ? `Dejar de seguir a ${nombre}` : `Seguir a ${nombre}: es privado y no le avisa`}
          data-estado={optimista ? 'favorito' : 'sin-guardar'}
          className={cn(
            'group relative w-full cursor-pointer rounded-lg outline-none aria-disabled:cursor-wait',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
        >
          <span className={cn(clasesSeguir(optimista), 'h-11 w-full px-4 text-sm', pendiente && 'opacity-70')}>
            {optimista ? <UserCheck className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            {optimista ? 'Siguiendo' : 'Seguir'}
          </span>
          <span className="sr-only">
            {optimista ? `: toca para dejar de seguir a ${nombre}` : ` a ${nombre}`}
          </span>
        </button>
      ) : (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={alternar}
        aria-disabled={pendiente}
        aria-busy={pendiente}
        aria-pressed={optimista}
        aria-label={`${accion}: ${nombre}`}
        title={accion}
        data-estado={optimista ? 'favorito' : 'sin-guardar'}
        className={cn(
          'min-h-11 min-w-11 shrink-0 cursor-pointer bg-transparent hover:bg-transparent',
          'transition-colors hover:text-primary-text focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'aria-disabled:cursor-wait motion-reduce:transition-none',
          optimista ? 'text-primary-text' : 'text-muted-foreground',
          pendiente && 'opacity-70',
        )}
      >
        <Star className={cn('size-5', optimista && 'fill-current')} aria-hidden />
      </Button>
      )}

      {/* Siempre presente para que el lector de pantalla anuncie el cambio. */}
      <p role="status" className="sr-only">
        {pendiente
          ? variante === 'perfil' ? 'Guardando el cambio…' : 'Guardando cambio de favorito…'
          : cambio && cambio.resultado !== 'error' ? mensaje : ''}
      </p>
      {cambio?.resultado === 'error' ? (
        <p role="alert" className="medida text-sm text-danger">
          {mensaje}
        </p>
      ) : null}
    </div>
  );
}
