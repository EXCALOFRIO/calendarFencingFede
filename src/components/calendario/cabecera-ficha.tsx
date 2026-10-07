'use client';

import { Flag, MapPin } from 'lucide-react';
import * as React from 'react';
import { InsigniaOrganismo } from '@/components/insignia-organismo';
import { Badge } from '@/components/ui/badge';
import type { EventView } from '@/lib/queries/calendar';
import {
  CIRCUIT_LABEL,
  type Organismo,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
} from '@/lib/utils';
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
          'relative flex flex-col gap-[8px] px-[16px]',
          hayFoto ? '-mt-[64px] sm:-mt-[80px]' : 'pt-[16px]',
        )}
      >
        <div className="flex flex-wrap items-center gap-[6px]">
          <InsigniaOrganismo organismo={organismo} className="h-[24px] text-[12px]" />
          <Badge variant="outline" className="text-[12px]">
            {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
          </Badge>
          {/* Un torneo pasado se abre para ver quién ganó: icono y palabra, no solo color. */}
          {terminado ? (
            <Badge variant="secondary" className="gap-1 bg-muted text-[12px] text-muted-foreground">
              <Flag aria-hidden />
              Terminada
            </Badge>
          ) : null}
        </div>
        <h2 data-titulo-ficha className="text-[28px] leading-[30px] text-balance">
          {titularTorneo(evento.name)}
        </h2>
        <dl className="grid grid-cols-2 gap-x-[12px] gap-y-[4px]">
          <div className="flex min-w-0 flex-col">
            <dt className="text-[12px] leading-[16px] text-muted-foreground">Dónde</dt>
            <dd className="flex min-w-0 items-start gap-[6px] text-[14px] leading-[20px] text-foreground">
              <MapPin className="mt-[3px] size-[14px] shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {evento.city ? titular(evento.city) : 'Sin sede'}
                {evento.country ? `, ${evento.country}` : ''}
              </span>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[12px] leading-[16px] text-muted-foreground">Cuándo</dt>
            <dd className="text-[14px] leading-[20px] text-foreground">
              {formatDateRangeEs(evento.startDate, evento.endDate)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
