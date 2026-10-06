import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import type { FilaClasificacion } from '@/lib/sport/explorar/edicion-modelo';
import { CLASES_MEDALLA, medallaDe, type Medalla } from '@/lib/sport/explorar/presentacion';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import type { EnlaceFicha } from './enlaces';
import { resaltado, type Filtro } from './logica';

/** El metal va escrito para lectores de pantalla: el color no puede ser la única señal. */
const METAL: Record<Medalla, string> = { oro: 'Oro', plata: 'Plata', bronce: 'Bronce' };

export function idFilaClasificacion(id: string): string {
  return `puesto-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

function Puesto({ puesto }: { puesto: number | null }) {
  const medalla = medallaDe(puesto);
  if (medalla) {
    return (
      <span
        className={cn(
          'cifra inline-flex size-8 items-center justify-center justify-self-center rounded-full border-2 text-lg leading-none',
          CLASES_MEDALLA[medalla],
        )}
      >
        <span className="sr-only">{METAL[medalla]}, puesto </span>
        {puesto}
      </span>
    );
  }
  return (
    <span className="cifra text-center text-lg leading-none text-muted-foreground">
      <span className="sr-only">{puesto === null ? 'Sin puesto numérico' : 'Puesto '}</span>
      {puesto ?? '—'}
    </span>
  );
}

function Fila({ fila, enlace, filtro }: { fila: FilaClasificacion; enlace?: EnlaceFicha; filtro: Filtro }) {
  const nombre = nombreVisible(fila.nombre);
  const marcada = resaltado(fila, filtro);
  const podio = medallaDe(fila.puesto) !== null;
  const contenido = (
    <>
      <Puesto puesto={fila.puesto} />
      <span className="flex min-w-0 flex-col">
        <span className={cn('truncate font-medium', podio && 'font-semibold')}>{nombre}</span>
        {fila.club || (fila.puesto === null && fila.puestoPublicado) ? (
          <span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
            {fila.puesto === null && fila.puestoPublicado ? <span className="shrink-0">{fila.puestoPublicado}</span> : null}
            {fila.club ? <span className="truncate">{fila.club}</span> : null}
          </span>
        ) : null}
      </span>
      {fila.pais ? <BanderaPais pais={fila.pais} /> : <span aria-hidden />}
    </>
  );
  const rejilla = 'grid min-h-11 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1';
  return (
    <li
      id={idFilaClasificacion(fila.id)}
      data-resaltado={marcada ? 'true' : undefined}
      className={cn('scroll-mt-24', marcada && 'bg-marcado shadow-[inset_3px_0_0_var(--color-primary)]')}
    >
      {fila.personaId && enlace ? (
        <Link
          href={enlace(fila.personaId)}
          prefetch={false}
          aria-label={`Abrir la ficha deportiva de ${nombre}`}
          className={cn(
            rejilla,
            'transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none',
          )}
        >
          {contenido}
        </Link>
      ) : (
        <div className={rejilla}>{contenido}</div>
      )}
    </li>
  );
}

/** Clasificación final: puesto (con medalla en el podio), nombre, club y país. */
export function ListaClasificacion({
  filas,
  enlace,
  filtro = { consulta: '' },
}: {
  filas: FilaClasificacion[];
  enlace?: EnlaceFicha;
  filtro?: Filtro;
}) {
  if (filas.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin clasificación.</p>;
  }
  return (
    <ol aria-label="Clasificación" className="divide-y overflow-hidden rounded-lg border bg-card">
      {filas.map((f) => (
        <Fila key={f.id} fila={f} enlace={enlace} filtro={filtro} />
      ))}
    </ol>
  );
}
