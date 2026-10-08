'use client';

import { Flag, MapPin } from 'lucide-react';
import * as React from 'react';
import { InsigniaOrganismo } from '@/components/insignia-organismo';
import { Pastilla } from '@/components/sistema/pastilla';
import type { EventView } from '@/lib/queries/calendar';
import {
  CIRCUIT_LABEL,
  type Organismo,
  cn,
  organismoDe,
  titular,
  titularTorneo,
} from '@/lib/utils';
import { rangoFechas } from '@/lib/fechas';
import { torneoTerminado } from './ficha/terminado';

/**
 * ===========================================================================
 * LA CABECERA DE LA FICHA DE UN TORNEO
 * ===========================================================================
 *
 * Vivía dentro de `vista.tsx`, que tiene más de mil líneas y es de otro
 * dueño. Se saca a su propio fichero por una razón concreta: es la pieza que
 * le falta a la ficha para parecerse a la referencia de la FIE —foto de la
 * sede a sangre, panel encima, pastilla con el rango de fechas, bandera y
 * línea de contexto— y quien rediseña la ficha no podía tocarla sin pisar el
 * calendario. Ahora sí.
 */

/**
 * Cabecera de la ficha.
 *
 * Cuando la fuente publica cartel, el título va **encima de la imagen**, no
 * debajo: es lo que hace el calendario de la FIE y es lo que convierte una
 * lista de datos en la ficha de un torneo. La imagen se enlaza a su origen
 * (`static.fie.org`), nunca se copia.
 *
 * Cuando no hay cartel no se pone un hueco gris ni un dibujo de relleno: se
 * pinta una franja con el color del organismo, que ya dice algo —de quién
 * es el torneo— en lugar de ocupar sitio por ocupar.
 *
 * No depende de ningún diálogo: el título de la subpantalla lo pone
 * `PantallaFicha`, y este es el título grande (`data-titulo-ficha`), que es
 * el que dice cuándo debe aparecer el pequeño.
 */
export function CabeceraFicha({ evento }: { evento: EventView }) {
  const [fallo, setFallo] = React.useState(false);
  React.useEffect(() => setFallo(false), [evento.id]);

  const hayFoto = Boolean(evento.imageUrl) && !fallo;
  const terminado = torneoTerminado(evento);
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  // Tintes opacos (`--org-*-tinte`): un color con alfa dejaba ver el panel de detrás.
  const tinte: string = {
    RFEE: 'bg-org-rfee-tinte',
    FIE: 'bg-org-fie-tinte',
    EFC: 'bg-org-efc-tinte',
    AUT: 'bg-org-aut-tinte',
  }[organismo satisfies Organismo];
  const franja: string = {
    RFEE: 'bg-org-rfee-relleno',
    FIE: 'bg-org-fie-relleno',
    EFC: 'bg-org-efc-relleno',
    AUT: 'bg-org-aut-relleno',
  }[organismo satisfies Organismo];

  return (
    <div className="relative">
      {hayFoto ? (
        /*
          El hueco de la foto lleva el color de quien organiza DEBAJO: los
          carteles de la FIE tardan medio segundo largo en llegar y el hueco
          se lee como parte del diseño mientras tanto.
        */
        <div className={cn('relative w-full', tinte)}>
          <img
            src={evento.imageUrl ?? ''}
            alt=""
            width={1200}
            height={528}
            className="h-[176px] w-full object-cover sm:h-[208px]"
            fetchPriority="high"
            // Es lo primero que se ve: con carga diferida la ficha abría con un boquete.
            loading="eager"
            decoding="async"
            // Si el cartel desaparece del origen, se quita el hueco en vez de dejar un icono roto.
            onError={() => setFallo(true)}
          />
          {/* Velo de legibilidad sobre la foto: una de las tres transparencias admitidas. */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/10"
            aria-hidden
          />
        </div>
      ) : (
        <div className={cn('h-[4px] w-full', franja)} aria-hidden />
      )}

      <div
        className={cn(
          'relative flex flex-col gap-2 px-4',
          hayFoto ? '-mt-16 sm:-mt-20' : 'pt-4',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <InsigniaOrganismo organismo={organismo} />
          <Pastilla tamano="md" className="border-border bg-transparent text-xs">
            {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
          </Pastilla>
          {/* Un torneo pasado se abre para ver quién ganó: icono y palabra, no solo color. */}
          {terminado ? (
            <Pastilla tamano="md" icono={Flag} className="bg-muted text-xs text-muted-foreground">
              Terminada
            </Pastilla>
          ) : null}
        </div>
        <h2 data-titulo-ficha className="text-3xl leading-tight text-balance">
          {titularTorneo(evento.name)}
        </h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted-foreground">Dónde</dt>
            <dd className="flex min-w-0 items-start gap-1 text-sm text-foreground">
              <MapPin className="mt-1 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {evento.city ? titular(evento.city) : 'Sin sede'}
                {evento.country ? `, ${evento.country}` : ''}
              </span>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">Cuándo</dt>
            <dd className="text-sm text-foreground">
              {rangoFechas(evento.startDate, evento.endDate, 'linea', { anio: 'auto' })}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
