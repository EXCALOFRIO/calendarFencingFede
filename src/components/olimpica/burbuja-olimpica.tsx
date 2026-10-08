'use client';

import { BanderaPais } from '@/components/bandera';
import { Pastilla } from '@/components/sistema/pastilla';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  colorOlimpico,
  mejorMarcaOlimpica,
  type AnotacionOlimpica,
  type Referencia,
} from '@/lib/ranking/olimpica';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { PastillaOlimpica } from './pastilla-olimpica';
import {
  ESTADO_TEXTO,
  MOTIVO_TEXTO,
  esCaminoDeEquipo,
  etiquetaAccesible,
  fechaCorta,
  plural,
  puntos,
  textoCamino,
} from './textos';

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2 py-1">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="flex min-w-0 items-center gap-1 text-sm">{children}</dd>
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

const Suave = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
);

/**
 * El contenido de la burbuja. Sin estado propio, para poder pintarlo y
 * probarlo fuera del `Popover`.
 *
 *   verde     vía, puesto que cuenta, margen sobre el primero que se queda fuera.
 *   amarillo  vía, puesto, puntos y rivales que le faltan, y a quién pasar.
 *   gris      por qué no cuenta y qué tendría si contara.
 *
 * Siempre, la fecha del ranking FIE usado.
 */
export function ContenidoBurbujaOlimpica({
  anotacion,
  fechaRanking,
}: {
  anotacion: AnotacionOlimpica;
  fechaRanking?: string | null;
}) {
  const { estado } = anotacion;
  const color = colorOlimpico(anotacion);
  if (!estado || !color) return null;
  const isoFecha = fechaRanking ?? anotacion.fechaRanking ?? null;
  const fecha = fechaCorta(isoFecha);
  const camino = estado === 'pendiente' ? (anotacion.sinVeto?.camino ?? null) : anotacion.camino;
  const puesto = anotacion.puesto ?? null;
  const prueba = anotacion.prueba
    ? rotuloPrueba({ arma: anotacion.prueba.arma, genero: anotacion.prueba.genero }, { variante: 'corto' })
    : null;
  return (
    <div className="min-w-0" data-burbuja-olimpica={estado} data-color-olimpico={color}>
      <div className="flex min-w-0 items-center gap-2 border-b border-border pb-2">
        <PastillaOlimpica anotacion={anotacion} decorativa />
        <span className="text-sm font-semibold">{ESTADO_TEXTO[estado]}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {prueba ? `LA 2028 · ${prueba}` : 'LA 2028'}
        </span>
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
            <Suave>{ESTADO_TEXTO[anotacion.sinVeto.estado].toLowerCase()}</Suave>
          </Dato>
        ) : null}
        {estado !== 'pendiente' && anotacion.camino ? (
          <Dato rotulo="Vía">{textoCamino(anotacion.camino, anotacion.zona)}</Dato>
        ) : null}
        {puesto !== null ? (
          <Dato rotulo="Puesto">
            <span className="shrink-0 tabular-nums">{`${puesto}.º`}</span>
            <Suave>{esCaminoDeEquipo(camino) ? 'ranking por equipos' : 'ranking individual'}</Suave>
          </Dato>
        ) : null}
        {estado === 'cerca' && anotacion.faltan !== null ? (
          <Dato rotulo="Le faltan">
            <span className="cifra text-xl leading-none">{puntos(anotacion.faltan)}</span>
            <Suave>pts</Suave>
            {anotacion.puestosFaltan ? (
              <Suave>{`· ${plural(anotacion.puestosFaltan, 'puesto', 'puestos')}`}</Suave>
            ) : null}
          </Dato>
        ) : null}
        {estado === 'cerca' && anotacion.camino === 'ANFITRION' ? (
          <Dato rotulo="Le falta">Que EE. UU. le dé plaza</Dato>
        ) : null}
        {estado === 'cerca' && anotacion.contra ? (
          <Dato rotulo="Rival">
            <Quien r={anotacion.contra} />
          </Dato>
        ) : null}
        {estado === 'clasificado' && anotacion.margen !== null && anotacion.sobre ? (
          <>
            <Dato rotulo="Margen">
              <span className="cifra text-xl leading-none">{`+${puntos(anotacion.margen)}`}</span>
              <Suave>pts</Suave>
            </Dato>
            <Dato rotulo="Sobre">
              <Quien r={anotacion.sobre} />
            </Dato>
          </>
        ) : null}
        <Dato rotulo="Ranking">
          <Pastilla>Provisional</Pastilla>
          {fecha && isoFecha ? (
            <time dateTime={isoFecha} className="text-xs text-muted-foreground">
              {fecha}
            </time>
          ) : null}
        </Dato>
      </dl>
    </div>
  );
}

/**
 * La etiqueta olímpica que abre su explicación al tocarla, la misma en
 * /ranking, el perfil y Buscar. El área táctil crece con un pseudo-elemento
 * para llegar a 44 px sin agrandar la pastilla. Sin color (ver
 * `colorOlimpico`) no pinta nada, así que se puede poner sin condiciones.
 */
export function BurbujaOlimpica({
  anotacion,
  fechaRanking,
  compacta = false,
  className,
}: {
  anotacion: AnotacionOlimpica | null | undefined;
  /** Si no se pasa, la de la propia anotación (perfil, Buscar). */
  fechaRanking?: string | null;
  /** Ver `PastillaOlimpica`. */
  compacta?: boolean;
  className?: string;
}) {
  if (!anotacion || !colorOlimpico(anotacion)) return null;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={etiquetaAccesible(anotacion)}
        className={cn(
          // El botón mide 44 px de alto y los márgenes negativos le devuelven a la fila los 20 de la pastilla.
          'group relative -my-3 inline-flex h-[44px] shrink-0 items-center rounded-full outline-none',
          // A lo ancho, la baldosa compacta de 16 px necesita el área extra por fuera.
          'after:absolute after:inset-y-0 after:-inset-x-[14px] after:content-[""]',
          className,
        )}
      >
        <PastillaOlimpica
          anotacion={anotacion}
          compacta={compacta}
          decorativa
          className="group-focus-visible:ring-[3px] group-focus-visible:ring-ring"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(19rem,calc(100vw-2rem))] p-3">
        <ContenidoBurbujaOlimpica anotacion={anotacion} fechaRanking={fechaRanking} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Para una persona con marcas en varias armas (Buscar): enseña la mejor
 * (`mejorMarcaOlimpica`). Va FUERA del enlace de la fila: un botón no puede ir
 * dentro de un `<a>`.
 */
export function MarcaOlimpicaPersona({
  marcas,
  compacta = true,
  className,
}: {
  marcas: readonly { anotacion: AnotacionOlimpica }[] | null | undefined;
  compacta?: boolean;
  className?: string;
}) {
  const mejor = mejorMarcaOlimpica(marcas);
  return mejor ? <BurbujaOlimpica anotacion={mejor.anotacion} compacta={compacta} className={className} /> : null;
}
