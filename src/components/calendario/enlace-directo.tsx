import { ExternalLink } from 'lucide-react';
import {
  NOMBRE_PROVEEDOR,
  estadoDirecto,
  type EnlaceDirecto,
  type EstadoDirecto,
} from '@/lib/calendario/enlaces-directo';
import { cn } from '@/lib/utils';

/**
 * La pastilla «En directo» / «Resultados» que lleva a Engarde, Fencing Time
 * Live u Ophardt. Siempre en otra pestaña: FTL pide iniciar sesión allí.
 *
 * El área táctil es de 44 px (lo impone `.calendario a[href]`), lo visible es
 * la pastilla de 24 px de dentro.
 */
export function PastillaDirecto({
  enlace,
  estado,
  soloIcono = false,
  clase,
}: {
  enlace: EnlaceDirecto;
  estado: EstadoDirecto;
  /** Al lado de «Resultados» de Explorar no se repite la palabra. */
  soloIcono?: boolean;
  clase?: string;
}) {
  const directo = estado === 'directo';
  const texto = directo ? 'En directo' : 'Resultados';
  const etiqueta = `${texto} en ${NOMBRE_PROVEEDOR[enlace.proveedor]} (se abre en otra pestaña)`;
  return (
    <a
      href={enlace.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={etiqueta}
      title={NOMBRE_PROVEEDOR[enlace.proveedor]}
      data-directo={estado}
      data-proveedor={enlace.proveedor}
      className={cn(
        'group inline-flex min-h-[44px] shrink-0 items-center rounded-full focus-visible:outline-none',
        clase,
      )}
    >
      <span
        className={cn(
          'inline-flex h-[24px] items-center gap-1 rounded-full border px-2 text-xs font-semibold leading-none transition-colors group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring',
          directo ? 'border-danger text-danger' : 'border-filete text-primary-text',
          soloIcono && !directo && 'px-1',
        )}
      >
        {directo ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-danger" /> : null}
        {soloIcono && !directo ? null : texto}
        {directo ? null : <ExternalLink className="size-3" aria-hidden />}
      </span>
    </a>
  );
}

/** Pastilla de una prueba de la ficha: en directo el día que se tira. */
export function PastillaDirectoDePrueba({
  enlace,
  fecha,
  evento,
  hoy,
  clase,
}: {
  enlace: EnlaceDirecto | null | undefined;
  fecha: string | null;
  evento: { startDate: string; endDate: string; timezone: string | null };
  hoy: string;
  clase?: string;
}) {
  if (!enlace) return null;
  const dia = fecha?.slice(0, 10);
  const rango = dia ? { desde: dia, hasta: dia } : { desde: evento.startDate, hasta: evento.endDate };
  return <PastillaDirecto enlace={enlace} estado={estadoDirecto(rango, hoy, evento.timezone)} clase={clase} />;
}
