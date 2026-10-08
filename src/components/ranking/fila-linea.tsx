import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Avatar } from '@/components/sistema/avatar';
import { MarcaPropia, Puesto } from '@/components/sistema/pastilla';
import { rutaPaisDe } from '@/lib/sport/explorar/enlace-pais';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';
import { puntos as formatoPuntos } from './formato';

/**
 * Una fila de ranking en UNA línea, igual en la tabla nacional y en la
 * internacional, con el orden de `FilaPersona`: puesto, avatar, bandera,
 * nombre (recortado con puntos suspensivos, nunca en dos renglones), lo que
 * haga falta detrás del nombre (la marca olímpica, «Tú») y los puntos. A
 * 320 px no se desplaza nada en horizontal: lo único que encoge es el nombre,
 * y por debajo de 360 px el club sale de la vista (no del lector de pantalla)
 * y la marca olímpica pasa junto a los puntos para dejarle sitio. El avatar se
 * queda siempre: es lo que hace reconocible la fila de un vistazo.
 *
 * El nombre lleva a la ficha de la persona en Explorar cuando se sabe quién
 * es; si no, a su ficha externa (FIE) si la hay, o a nada.
 */
export function FilaLinea({
  puesto,
  nombre,
  personaId = null,
  enlaceExterno = null,
  pais = null,
  club = null,
  puntos,
  mio = false,
  resaltada = false,
  tras,
  accion,
  sinRetrato = false,
  enlacePais = false,
}: {
  /** Selecciones: la fila es un país y no lleva retrato. */
  sinRetrato?: boolean;
  /** La fila es un país: sin persona ni ficha externa, el nombre abre la página del país. */
  enlacePais?: boolean;
  puesto: number | null;
  nombre: string;
  personaId?: string | null;
  enlaceExterno?: string | null;
  /** ISO-3 de la FIE; sin él no hay bandera. */
  pais?: string | null;
  /** Código de club de Skermo, tal cual (sólo el ranking nacional). */
  club?: string | null;
  puntos: number | null;
  mio?: boolean;
  /** Fondo tenue (España en la tabla internacional). */
  resaltada?: boolean;
  /** Justo detrás del nombre; por debajo de 360 px, a la izquierda de los puntos. */
  tras?: React.ReactNode;
  /** Botón al final de la fila (abrir el detalle). */
  accion?: React.ReactNode;
}) {
  const claseNombre = cn('min-w-0 truncate text-sm leading-5', mio ? 'font-semibold' : 'font-medium');
  /*
    El enlace ocupa el alto de la fila (40 px, en px y no en rem para que no
    crezca con la raíz del móvil) y un pseudoelemento le añade 2 px arriba y
    abajo: 44 px de objetivo táctil aunque el texto sea de 14. Gana a
    `.ranking a[href]` porque las utilidades van después de base.
  */
  const claseEnlace = "relative flex min-h-[40px] items-center after:absolute after:inset-x-0 after:-inset-y-[2px] after:content-[''] hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none";
  const conTras = tras !== undefined && tras !== null && tras !== false;
  const paisDestino = enlacePais ? rutaPaisDe(pais) : null;
  return (
    <li
      data-mio={mio || undefined}
      className={cn(
        'grid min-h-[40px] min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 bg-card px-2 sm:px-3',
        /*
          Con algo detrás del nombre, desde 360 px va en su columna pegada al
          nombre (que sólo ocupa lo que mide) y un hueco empuja los puntos a la
          derecha. Por debajo comparte celda con los puntos, a su izquierda: un
          botón de 44 px en la línea del nombre se comería medio nombre.
        */
        conTras
          ? 'min-[360px]:grid-cols-[1.75rem_minmax(0,max-content)_auto_minmax(0,1fr)_auto] sm:grid-cols-[2.25rem_minmax(0,max-content)_auto_minmax(0,1fr)_auto]'
          : 'sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]',
        (mio || resaltada) && 'bg-marcado',
      )}
    >
      {/* Las cifras de cuatro dígitos no caben en el disco de 24 px: el ancho crece con ellas. */}
      <Puesto puesto={puesto} className="w-auto min-w-6 justify-self-center" />
      <span className="flex min-w-0 items-center gap-2">
        {sinRetrato ? null : <Avatar personaId={personaId} nombre={nombre} tamano={28} apagado />}
        {pais ? <BanderaPais pais={pais} soloBandera className="shrink-0" /> : null}
        {personaId ? (
          <Link href={`${RUTA_EXPLORAR}/${personaId}`} prefetch={false} title={nombre} data-nombre className={cn(claseNombre, claseEnlace)}>
            <span className="truncate">{nombre}</span>
          </Link>
        ) : enlaceExterno ? (
          <a href={enlaceExterno} target="_blank" rel="noreferrer" title={nombre} data-nombre className={cn(claseNombre, claseEnlace)}>
            <span className="truncate">{nombre}</span>
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : paisDestino ? (
          <Link href={paisDestino} prefetch={false} title={nombre} data-nombre data-enlace="pais" className={cn(claseNombre, claseEnlace)}>
            <span className="truncate">{nombre}</span>
          </Link>
        ) : (
          <span className={claseNombre} title={nombre} data-nombre>{nombre}</span>
        )}
        {mio ? <MarcaPropia /> : null}
        {club ? (
          // Por debajo de 360 px se aparta de la vista pero no del lector de pantalla.
          <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground max-[359px]:sr-only" title={`Club ${club}`}>
            <span className="sr-only">club </span>
            {club}
          </span>
        ) : null}
      </span>
      {conTras ? (
        <span className="col-start-3 row-start-1 flex items-center justify-self-start">{tras}</span>
      ) : null}
      <span
        className={cn(
          'flex items-center gap-1',
          conTras && 'col-start-3 row-start-1 justify-self-end pl-4 min-[360px]:col-start-5 min-[360px]:pl-0',
        )}
      >
        {puntos === null ? (
          <span className="cifra text-sm tabular-nums text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="sr-only">sin puntos</span>
          </span>
        ) : (
          <span className="cifra text-sm tabular-nums">
            {formatoPuntos(puntos)}
            <span className="sr-only"> puntos</span>
          </span>
        )}
        {accion}
      </span>
    </li>
  );
}
