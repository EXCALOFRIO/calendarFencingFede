'use client';

import { Star } from 'lucide-react';
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

/** Destino del foco tras quitar desde la lista, cuando la fila desaparece. */
export const ID_ENCABEZADO_FAVORITOS = 'favoritos-resultados';

/**
 * Guardar/Quitar un favorito. El estado cambia al instante y se confirma (o se
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
  variante?: 'ficha' | 'lista';
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
  const enLista = variante === 'lista';

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-estado={optimista ? 'favorito' : 'sin-guardar'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
            optimista ? 'border-primary-text bg-marcado text-primary-text' : 'text-muted-foreground',
          )}
        >
          <Star className={cn('size-3.5', optimista && 'fill-current')} aria-hidden />
          {optimista ? 'Favorito' : 'Sin guardar'}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={alternar}
          aria-disabled={pendiente}
          aria-label={`${accion}: ${nombre}`}
          className={cn('min-h-11', pendiente && 'opacity-70')}
        >
          {accion}
        </Button>
      </div>

      {/* Siempre presente para que el lector de pantalla anuncie el cambio. */}
      <p role="status" className={cn('medida text-xs text-muted-foreground', enLista && 'sr-only')}>
        {cambio && cambio.resultado !== 'error' ? cambio.mensaje : ''}
      </p>
      {cambio?.resultado === 'error' ? (
        <p role="alert" className="medida text-sm text-danger">
          {cambio.mensaje}
        </p>
      ) : null}
      {enLista ? null : (
        <p className="medida text-xs text-muted-foreground">
          Acceso rápido privado a esta ficha. No envía avisos ni notificaciones.
        </p>
      )}
    </div>
  );
}
