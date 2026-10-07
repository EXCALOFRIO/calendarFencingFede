import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { FotoDeportista } from '@/components/explorar/foto-deportista';
import { rutaPaisDe } from '@/lib/sport/explorar/enlace-pais';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { puntos as formatoPuntos } from './formato';

/**
 * Una fila de ranking en UNA línea, igual en la tabla nacional y en la
 * internacional: puesto, retrato pequeño, bandera o código de club, nombre
 * (recortado con puntos suspensivos, nunca en dos renglones), lo que haga
 * falta detrás del nombre (la marca olímpica, «Tú») y los puntos. A 320 px no
 * se desplaza nada en horizontal: lo único que encoge es el nombre, y por debajo
 * de 360 px el código de club y los decimales salen de la vista (no del lector
 * de pantalla) y la marca olímpica pasa junto a los puntos para dejarle sitio. El retrato se queda siempre: es lo que hace
 * reconocible la fila de un vistazo.
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
  /** Código de club de Skermo, tal cual. */
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
  const claseNombre = cn('min-w-0 truncate text-[14px] leading-tight', mio ? 'font-semibold' : 'font-medium');
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
      <span className={cn('cifra text-right text-[15px] leading-none tabular-nums', mio ? 'text-primary-text' : puesto !== null && puesto <= 3 ? 'text-foreground' : 'text-muted-foreground')}>
        {puesto === null ? (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">Sin puesto</span>
          </>
        ) : (
          <>
            <span className="sr-only">Puesto </span>
            {puesto}
          </>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {sinRetrato ? null : personaId ? (
          <FotoDeportista personaId={personaId} nombre={nombre} tamano="fila" apagado />
        ) : (
          <span aria-hidden className="flex size-[28px] shrink-0 items-center justify-center rounded-full border border-filete-alto font-display text-[12px] text-muted-foreground">
            {inicialesVisibles(nombre) || '—'}
          </span>
        )}
        {pais ? <BanderaPais pais={pais} soloBandera className="shrink-0" /> : null}
        {personaId ? (
          <Link href={`${RUTA_EXPLORAR}/${personaId}`} prefetch={false} title={nombre} data-nombre className={cn(claseNombre, claseEnlace)}>
            <span className="truncate">{nombre}</span>
          </Link>
        ) : enlaceExterno ? (
          <a href={enlaceExterno} target="_blank" rel="noreferrer" title={nombre} data-nombre className={cn(claseNombre, claseEnlace, 'gap-1')}>
            <span className="truncate">{nombre}</span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : paisDestino ? (
          <Link href={paisDestino} prefetch={false} title={nombre} data-nombre data-enlace="pais" className={cn(claseNombre, claseEnlace)}>
            <span className="truncate">{nombre}</span>
          </Link>
        ) : (
          <span className={claseNombre} title={nombre} data-nombre>{nombre}</span>
        )}
        {mio ? (
          <span className="shrink-0 rounded-full border border-primary-text px-1.5 text-[12px] leading-4 text-primary-text">Tú</span>
        ) : null}
        {club ? (
          // Por debajo de 360 px se aparta de la vista pero no del lector de pantalla.
          <span
            className="max-w-[5.5rem] shrink-0 truncate font-mono text-[12px] tracking-tight text-muted-foreground uppercase max-[359px]:sr-only"
            title={`Club ${club}`}
          >
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
          <span className="cifra text-[13px] tabular-nums text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="sr-only">sin puntos</span>
          </span>
        ) : (
          <>
            {/*
              Por debajo de 360 px, sin decimales: el ancho que se ahorra es para
              el nombre. La cifra exacta sigue en el árbol accesible (`sr-only`).
            */}
            <span className="cifra text-[13px] tabular-nums max-[359px]:sr-only">
              {formatoPuntos(puntos)}
              <span className="sr-only"> puntos</span>
            </span>
            <span aria-hidden className="cifra text-[13px] tabular-nums min-[360px]:hidden" title={formatoPuntos(puntos)}>{formatoPuntos(Math.round(puntos))}</span>
          </>
        )}
        {accion}
      </span>
    </li>
  );
}
