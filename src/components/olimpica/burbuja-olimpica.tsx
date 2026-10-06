'use client';

import { BanderaPais } from '@/components/bandera';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AnotacionOlimpica, Referencia } from '@/lib/ranking/olimpica';
import { cn } from '@/lib/utils';
import { InsigniaOlimpica } from './insignia-olimpica';
import {
  ESTADO_TEXTO,
  MOTIVO_TEXTO,
  etiquetaAccesible,
  fechaCorta,
  puntos,
  textoCamino,
} from './textos';

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 py-1">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-sm">{children}</dd>
    </div>
  );
}

function Quien({ r }: { r: Referencia }) {
  return (
    <>
      <BanderaPais pais={r.noc} soloBandera />
      <span className="min-w-0 truncate">{r.nombre ?? r.noc}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{`${r.posicion}.º`}</span>
    </>
  );
}

/**
 * El contenido de la burbuja. Sin estado propio, para poder pintarlo y
 * probarlo fuera del `Popover`.
 */
export function ContenidoBurbujaOlimpica({
  anotacion,
  fechaRanking,
}: {
  anotacion: AnotacionOlimpica;
  fechaRanking: string | null;
}) {
  const { estado } = anotacion;
  if (!estado) return null;
  const fecha = fechaCorta(fechaRanking);
  return (
    <div className="min-w-0" data-burbuja-olimpica={estado}>
      <div className="flex min-w-0 items-center gap-2 border-b border-border pb-2">
        <InsigniaOlimpica anotacion={anotacion} />
        <span className="text-sm font-semibold">{ESTADO_TEXTO[estado]}</span>
        <span className="ml-auto text-xs text-muted-foreground">LA 2028</span>
      </div>
      <dl className="mt-1 min-w-0">
        {estado === 'pendiente' && anotacion.motivo ? (
          <Dato rotulo="Motivo">{MOTIVO_TEXTO[anotacion.motivo]}</Dato>
        ) : null}
        {estado === 'pendiente' && anotacion.sinVeto ? (
          <Dato rotulo="Si contara">
            <span className="min-w-0 truncate">
              {textoCamino(anotacion.sinVeto.camino, anotacion.sinVeto.zona)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {ESTADO_TEXTO[anotacion.sinVeto.estado].toLowerCase()}
            </span>
          </Dato>
        ) : null}
        {estado !== 'pendiente' && anotacion.camino ? (
          <Dato rotulo="Vía">{textoCamino(anotacion.camino, anotacion.zona)}</Dato>
        ) : null}
        {estado === 'cerca' && anotacion.contra ? (
          <Dato rotulo="Rival">
            <Quien r={anotacion.contra} />
          </Dato>
        ) : null}
        {estado === 'cerca' && anotacion.faltan !== null ? (
          <Dato rotulo="Faltan">
            <span className="cifra text-xl leading-none">{puntos(anotacion.faltan)}</span>
            <span className="text-xs text-muted-foreground">pts</span>
          </Dato>
        ) : null}
        {estado !== 'pendiente' && anotacion.margen !== null && anotacion.sobre ? (
          <Dato rotulo="Margen">
            <span className="shrink-0 tabular-nums">{`+${puntos(anotacion.margen)}`}</span>
            <Quien r={anotacion.sobre} />
          </Dato>
        ) : null}
        <Dato rotulo="Ranking">
          <Badge variant="outline">Provisional</Badge>
          {fecha && fechaRanking ? (
            <time dateTime={fechaRanking} className="text-xs text-muted-foreground">
              {fecha}
            </time>
          ) : null}
        </Dato>
      </dl>
    </div>
  );
}

/**
 * La pastilla olímpica que abre su explicación al tocarla. El área táctil
 * crece con un pseudo-elemento para llegar a 44 px sin agrandar la pastilla.
 */
export function BurbujaOlimpica({
  anotacion,
  fechaRanking,
  compacta = false,
  className,
}: {
  anotacion: AnotacionOlimpica | null | undefined;
  fechaRanking: string | null;
  /** Ver `InsigniaOlimpica`. */
  compacta?: boolean;
  className?: string;
}) {
  if (!anotacion?.estado) return null;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={etiquetaAccesible(anotacion)}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full outline-none',
          'after:absolute after:-inset-3 after:content-[""]',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
      >
        <InsigniaOlimpica anotacion={anotacion} compacta={compacta} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-3">
        <ContenidoBurbujaOlimpica anotacion={anotacion} fechaRanking={fechaRanking} />
      </PopoverContent>
    </Popover>
  );
}
