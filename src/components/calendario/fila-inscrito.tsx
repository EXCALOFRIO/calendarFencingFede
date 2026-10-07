import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { FotoDeportista } from '@/components/explorar/foto-deportista';
import { Badge } from '@/components/ui/badge';
import type { InscritoPublicado, PuestoInscrito } from '@/lib/entries/union';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { inicialesVisibles, nombreVisible } from '@/lib/sport/nombre-visible';
import { cn, titular } from '@/lib/utils';

/**
 * Un inscrito de la lista oficial, en una fila como las del ranking: retrato
 * pequeño, nombre, «tú», bandera y, si se sabe, sus puestos FIE y RFEE.
 *
 * Toda la fila lleva al perfil de Explorar cuando la persona está demostrada
 * por un ID o una licencia (`personaDeFila`); si no, la fila no enlaza: un
 * homónimo nunca hereda el perfil de otro. El club no sale: en las listas de
 * personas sólo va la nacionalidad.
 *
 * El retrato pasa por la ruta de fotos, que aplica el veto de menores: a quien
 * pueda serlo le quedan las iniciales.
 */
export function FilaInscrito({ inscrito }: { inscrito: InscritoPublicado }) {
  const personaId = inscrito.personaId ?? null;
  const extra = inscrito.extra ?? null;
  // Una fila de equipo sin persona puede ser el nombre del equipo, no de un tirador.
  const equipo = Boolean(inscrito.equipo) && !personaId;
  const nombre = equipo ? titular(inscrito.nombre) : nombreVisible(inscrito.nombre) || titular(inscrito.nombre);
  const clase = cn(
    'flex min-h-[44px] items-center gap-2.5 px-3 py-1.5',
    inscrito.esMio && 'bg-marcado',
  );

  const contenido = (
    <>
      {equipo ? null : personaId ? (
        <FotoDeportista personaId={personaId} nombre={nombre} tamano="fila" apagado />
      ) : (
        <span
          aria-hidden
          // Mide lo que el retrato `fila` con su anillo (28 + 2 × 3 px): los nombres quedan alineados.
          className="flex size-[34px] shrink-0 items-center justify-center rounded-full border-2 border-filete-alto font-display text-[12px] text-muted-foreground"
        >
          {inicialesVisibles(inscrito.nombre) || '—'}
        </span>
      )}
      {/*
        El nombre se queda con al menos 9 rem; si no caben al lado la bandera
        y los puestos, bajan a un segundo renglón en vez de partir palabras.
      */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="flex min-w-0 flex-[1_1_9rem] flex-wrap items-center gap-x-2">
          <span
            data-nombre
            className={cn(
              'min-w-0 break-words text-[14px] leading-[20px] font-medium',
              personaId && 'group-hover/inscrito:underline',
            )}
          >
            {nombre}
          </span>
          {inscrito.esMio ? <Badge variant="secondary">tú</Badge> : null}
        </span>
        {extra?.pais || extra?.mundial || extra?.nacional ? (
          <span className="flex shrink-0 items-center gap-2">
            {extra.pais ? <BanderaPais pais={extra.pais} soloBandera className="shrink-0" /> : null}
            <Puestos mundial={extra.mundial} nacional={extra.nacional} />
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div role="listitem">
      {personaId ? (
        <Link
          href={`${RUTA_EXPLORAR}/${personaId}`}
          prefetch={false}
          className={cn(
            clase,
            'group/inscrito outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset',
          )}
        >
          {contenido}
        </Link>
      ) : (
        <div className={clase}>{contenido}</div>
      )}
    </div>
  );
}

/** «FIE 23 · RFEE 4»: una pastilla, sin nada si no hay puesto. `abs` cuando es el absoluto. */
function Puestos({ mundial, nacional }: { mundial: PuestoInscrito | null; nacional: PuestoInscrito | null }) {
  const partes = [
    mundial ? { sigla: 'FIE', p: mundial } : null,
    nacional ? { sigla: 'RFEE', p: nacional } : null,
  ].filter((x) => x !== null);
  if (partes.length === 0) return null;
  return (
    <span className="shrink-0 rounded-full border px-2 font-mono text-[12px] leading-[20px] whitespace-nowrap text-muted-foreground tabular-nums">
      {partes.map(({ sigla, p }, i) => (
        <span key={sigla}>
          {i > 0 ? <span aria-hidden> · </span> : null}
          <span className="sr-only">{i > 0 ? ', ' : ''}ranking </span>
          {sigla} <span className="text-foreground">{p.puesto}</span>
          {p.absoluto ? (
            <>
              <span aria-hidden> abs</span>
              <span className="sr-only"> absoluto</span>
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}
