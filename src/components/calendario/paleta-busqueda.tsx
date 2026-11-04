'use client';

import { CalendarSearch } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { rangoFechas } from '@/lib/fechas';
import type { EventView } from '@/lib/queries/calendar';
import { pastillaDeCircuito } from '@/lib/calendario/rotulos';
import { nombreDeMes } from '@/lib/calendario/bloques';
import { titularTorneo } from '@/lib/utils';
import { Sede } from './fila-competicion';

/**
 * La paleta de búsqueda del calendario (`Command` + `Dialog`).
 *
 * Vive en su propio trozo, pedido con `next/dynamic` en `vista.tsx` la
 * primera vez que se abre: `cmdk` y el envoltorio de `ui/dialog` son los
 * últimos ~20 KB que el calendario dejaba en su carga inicial por una
 * herramienta que se toca una vez cada muchas visitas. Una vez montada se
 * queda montada (cerrada), así que el cierre conserva su animación.
 *
 * No filtra el calendario: lleva a él. Cada resultado dice de qué es —arma,
 * género, categoría, circuito— y cuándo y dónde, que es justo lo que hace
 * falta para reconocer el que se buscaba entre cuatro «Copa del Mundo
 * Cadete» del mismo mes.
 */
export function PaletaBusqueda({
  abierta,
  onAbierta,
  busqueda,
  onBusqueda,
  saltoDeMes,
  coincidencias,
  onIrAMes,
  onElegir,
  hoy,
}: {
  abierta: boolean;
  onAbierta: (abierta: boolean) => void;
  busqueda: string;
  onBusqueda: (texto: string) => void;
  /** «marzo 2019» escrito en el buscador: se ofrece ir a ese mes. */
  saltoDeMes: { anio: number; mes: number } | null;
  coincidencias: EventView[];
  /** Ir al tramo de una fecha (la del `saltoDeMes`). */
  onIrAMes: (destino: Date) => void;
  /** Elegir una coincidencia: la vista la señala y salta a su mes. */
  onElegir: (evento: EventView, indice: number) => void;
  /** «Hoy» en Madrid, la referencia de las fechas. */
  hoy: string;
}) {
  return (
    <Dialog open={abierta} onOpenChange={onAbierta}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Buscar un torneo o una sede</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            value={busqueda}
            onValueChange={onBusqueda}
            placeholder="Buscar un torneo o una sede"
          />
          <CommandList>
            {/*
              IR A UN MES CUALQUIERA, TAMBIÉN DE HACE AÑOS.

              El calendario llega hacia atrás hasta donde llega Explorar, y
              eso son décadas: a marzo de 2019 había que dar más de ochenta
              toques a la flecha. Escribir «2019» o «marzo 2019» ofrece ir
              directamente. Va arriba y aparte de las coincidencias.
            */}
            {saltoDeMes ? (
              <CommandItem
                value={`ir-a-${saltoDeMes.anio}-${saltoDeMes.mes}`}
                onSelect={() => {
                  onIrAMes(new Date(saltoDeMes.anio, saltoDeMes.mes, 1));
                  onBusqueda('');
                  onAbierta(false);
                }}
                className="min-h-11 gap-2 py-3 text-sm font-medium"
              >
                <CalendarSearch className="size-4" aria-hidden />
                Ir a {nombreDeMes(saltoDeMes.anio, saltoDeMes.mes).toLocaleLowerCase('es-ES')}
              </CommandItem>
            ) : null}
            {busqueda.trim() === '' ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Torneo, ciudad o mes («marzo 2019»)
              </p>
            ) : saltoDeMes && coincidencias.length === 0 ? null : coincidencias.length === 0 ? (
              <CommandEmpty>Sin coincidencias</CommandEmpty>
            ) : (
              coincidencias.slice(0, 40).map((e, i) => {
                const circuito = pastillaDeCircuito(e);
                return (
                  <CommandItem
                    key={e.id}
                    value={e.id}
                    onSelect={() => {
                      onElegir(e, i);
                      onAbierta(false);
                    }}
                    className="min-h-11 flex-col items-start gap-1 py-3"
                  >
                    <span className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 text-sm font-medium break-words">
                        {titularTorneo(e.name)}
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {rangoFechas(e.startDate, e.endDate, 'linea', { anio: 'auto', referencia: hoy })}
                      </span>
                    </span>
                    {/* Dos datos y no tres: el circuito ya dice de quién es. */}
                    <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {circuito ? <span className="min-w-0 break-words">{circuito}</span> : null}
                      {e.city ? <Sede ciudad={e.city} pais={e.country} /> : null}
                    </span>
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
