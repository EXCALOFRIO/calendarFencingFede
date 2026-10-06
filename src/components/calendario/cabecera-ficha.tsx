'use client';

import { Flag, MapPin } from 'lucide-react';
import * as React from 'react';
import { InsigniaOrganismo } from '@/components/insignia-organismo';
import { Badge } from '@/components/ui/badge';
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
 */
export function CabeceraFicha({ evento }: { evento: EventView }) {
  const [fallo, setFallo] = React.useState(false);
  React.useEffect(() => setFallo(false), [evento.id]);

  const hayFoto = Boolean(evento.imageUrl) && !fallo;
  const terminado = torneoTerminado(evento);
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const tinte: string = {
    RFEE: 'from-org-rfee/40',
    FIE: 'from-org-fie/35',
    EFC: 'from-org-efc/40',
    AUT: 'from-muted-foreground/30',
  }[organismo satisfies Organismo];

  return (
    <div className="relative">
      {/*
        Sin cartel no se reserva sitio para el cartel.

        Antes, cuando la fuente no publicaba imagen se pintaba una franja
        de 96 px con un degradado tan sutil que en pantalla era un hueco
        negro: 140 px de nada antes del título. Solo 26 de los 249 torneos
        traen cartel, así que el caso normal es este. Ahora sin foto queda
        una banda fina del color de quien organiza, que además dice algo.
      */}
      {hayFoto ? (
        /*
          El hueco de la foto lleva el color de quien organiza DEBAJO.

          Los carteles de la FIE son JPEG de 4000 px enlazados a
          `static.fie.org`: tardan medio segundo largo en pintar y durante
          ese rato la hoja abria con un rectángulo negro de 200 px. Con el
          tinte detras, el hueco se lee como parte del diseño mientras la
          foto llega, y si no llega nunca tampoco pasa nada.
        */
        <div className={cn('relative w-full bg-gradient-to-br to-card', tinte)}>
          <img
            src={evento.imageUrl ?? ''}
            alt=""
            className="h-44 w-full object-cover sm:h-52"
            fetchPriority="high"
            /* Nada de `lazy`: es lo primero que se ve de la hoja. Con carga
               diferida el hueco se reservaba y la foto entraba medio segundo
               despues, de modo que la ficha siempre abria con un boquete. */
            loading="eager"
            decoding="async"
            /* Y si el cartel ha desaparecido de `static.fie.org`, se quita el
               hueco en vez de dejar 200 px de nada con un icono roto. */
            onError={() => setFallo(true)}
          />
          {/* Velo de abajo arriba para que el texto se lea sobre la foto. */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/10"
            aria-hidden
          />
        </div>
      ) : (
        <div className={cn('h-1 w-full bg-gradient-to-r to-transparent', tinte)} aria-hidden />
      )}

      <SheetHeader
        className={cn(
          'relative gap-2 px-4 pb-0',
          hayFoto ? '-mt-16 sm:-mt-20' : 'pt-4',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <InsigniaOrganismo organismo={organismo} />
          <Badge variant="outline">
            {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
          </Badge>
          {/*
            Un torneo pasado se abre para ver quién ganó, y sin esta pastilla
            la ficha se leía igual que la de uno por venir hasta llegar a la
            barra de plazos en gris. Va con icono y palabra, no solo con color.
          */}
          {terminado ? (
            <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground">
              <Flag aria-hidden />
              Terminada
            </Badge>
          ) : null}
        </div>
        <SheetTitle className="text-3xl leading-[0.95] sm:text-4xl">
          {titularTorneo(evento.name)}
        </SheetTitle>
        {/*
          Dónde y cuándo, en dos columnas con su rótulo.

          Antes era una cadena «Casablanca, MA · 15-18 oct 2026». Una línea
          de datos pegados con puntos medios es rápida de escribir y lenta de
          leer: hay que analizarla para saber qué es cada trozo. En columnas
          se ve de un vistazo, que es justo lo que se pidió.
        */}
        <SheetDescription asChild>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
            <div className="flex min-w-0 flex-col">
              <dt className="text-xs text-muted-foreground">Dónde</dt>
              <dd className="flex min-w-0 items-start gap-1.5 text-sm text-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  {evento.city ? titular(evento.city) : 'Sede sin publicar'}
                  {evento.country ? `, ${evento.country}` : ''}
                </span>
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Cuándo</dt>
              <dd className="text-sm text-foreground">
                {formatDateRangeEs(evento.startDate, evento.endDate)}
              </dd>
            </div>
          </dl>
        </SheetDescription>
      </SheetHeader>
    </div>
  );
}
