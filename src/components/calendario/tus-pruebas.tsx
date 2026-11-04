import { Ban, ChevronDown } from 'lucide-react';
import { EnlaceIntencion } from '@/components/enlace-intencion';
import { FilaCompeticion } from '@/components/calendario/fila-competicion';
import { PastillaPlazo } from '@/components/calendario/tarjeta-bloque';
import { Pastilla, type TonoPastilla } from '@/components/sistema/pastilla';
import { textoDePlazo, tonoDePlazo } from '@/lib/calendario/rotulos';
import type { FilaTusPruebas } from '@/lib/calendario/tus-pruebas';
import { ENTRY_STATUS_LABEL, type EntryStatus } from '@/lib/entries/state-machine';
import { titularTorneo } from '@/lib/utils';

/**
 * «Tus pruebas», encima del listado del calendario: en qué está inscrito un
 * tirador de la cuenta y qué plazos suyos cierran pronto. Las filas son las
 * del calendario (`FilaCompeticion`) y llevan a la ficha del torneo
 * (`/?evento=<id>`), que se abre sola al volver.
 *
 * Va plegable con el patrón del sistema (`sis-details`), abierta por
 * defecto: la respuesta a «¿qué me toca?» tiene que estar a la vista, el
 * plegado es para quien no la quiera delante.
 *
 * Se pinta entera en el servidor como prop de `VistaCalendario`; sin
 * tiradores vinculados ni filas no se renderiza nada.
 */

const TONO_SOLICITUD: Partial<Record<EntryStatus, TonoPastilla>> = {
  federation_approved: 'ok',
  submitted: 'ok',
};

export function TusPruebas({
  filas,
  variosTiradores,
}: {
  filas: FilaTusPruebas[];
  /** El nombre del tirador sólo informa cuando hay más de uno en la cuenta. */
  variosTiradores: boolean;
}) {
  if (filas.length === 0) return null;

  return (
    <details className="sis-details group min-w-0 shrink-0" open>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">
          Tus pruebas
        </h2>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>

      <ul className="flex min-w-0 flex-col divide-y divide-border border-t border-border">
        {filas.map((f) => (
          <li key={f.clave} className="flex min-w-0 bg-card">
            <EnlaceIntencion
              href={`/?evento=${f.eventId}`}
              /*
                `data-evento`: la intención del calendario delega aquí y
                precarga la ficha antes del toque, igual que en una tarjeta.
              */
              data-evento={f.eventId}
              className="pulsable min-h-11 min-w-0 flex-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <FilaCompeticion
                desde={f.startDate}
                hasta={f.endDate}
                titulo={titularTorneo(f.eventName)}
                ciudad={f.city}
                pais={f.country}
                apagado={f.cancelada}
                tachado={f.cancelada}
                estado={
                  <>
                    {f.cancelada ? (
                      <Pastilla icono={Ban} className="text-muted-foreground">
                        Cancelada
                      </Pastilla>
                    ) : null}
                    {f.solicitud ? (
                      <Pastilla tono={TONO_SOLICITUD[f.solicitud] ?? 'neutro'}>
                        {ENTRY_STATUS_LABEL[f.solicitud]}
                      </Pastilla>
                    ) : null}
                    {!f.cancelada && f.diasCierre !== null ? (
                      <PastillaPlazo
                        plazo={{
                          texto: textoDePlazo(f.diasCierre),
                          tono: tonoDePlazo(f.diasCierre),
                        }}
                      />
                    ) : null}
                  </>
                }
                detalle={
                  <>
                    <Pastilla>{f.prueba}</Pastilla>
                    {variosTiradores ? (
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {f.athleteName}
                      </span>
                    ) : null}
                  </>
                }
              />
            </EnlaceIntencion>
          </li>
        ))}
      </ul>
    </details>
  );
}
