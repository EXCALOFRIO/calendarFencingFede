import Link from 'next/link';
import { memo } from 'react';
import { BanderaPais } from '@/components/bandera';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { rutaPaisDe } from '@/lib/sport/explorar/enlace-pais';
import type { FilaClasificacionLigera } from '@/lib/sport/explorar/prueba-datos';
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

const comparable = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Un equipo con nombre en código («VCE-VA») trae el mismo código como club:
 * se compara sin mayúsculas, tildes, guiones ni espacios.
 */
export function repiteNombre(nombre: string, club: string | null | undefined): boolean {
  if (!club) return false;
  const c = comparable(club);
  return c !== '' && c === comparable(nombre);
}

/**
 * Memorizada: al escribir en el buscador sólo se repintan las filas que
 * cambian de resaltado. Fuera de la pantalla no se maquetan
 * (`content-visibility`), con 44 px de alto estimado.
 */
const Fila = memo(function Fila({ fila, enlace, marcada }: { fila: FilaClasificacionLigera; enlace?: EnlaceFicha; marcada: boolean }) {
  const nombre = nombreVisible(fila.nombre);
  const podio = medallaDe(fila.puesto) !== null;
  // Sin club: en Explorar no se enseña. En equipos, el nombre ya es el del equipo.
  const contenido = (
    <>
      <Puesto puesto={fila.puesto} />
      <span className="flex min-w-0 flex-col">
        <span className={cn('truncate font-medium', podio && 'font-semibold')}>{nombre}</span>
        {fila.puesto === null && fila.puestoPublicado ? (
          <span className="text-xs text-muted-foreground">{fila.puestoPublicado}</span>
        ) : null}
      </span>
    </>
  );
  const rejilla = 'grid min-h-[44px] grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 py-1 pl-3';
  const pais = rutaPaisDe(fila.pais);
  return (
    <li
      id={idFilaClasificacion(fila.id)}
      data-resaltado={marcada ? 'true' : undefined}
      className={cn(
        'grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 pr-3 [contain-intrinsic-size:auto_44px] [content-visibility:auto]',
        marcada && 'bg-marcado shadow-[inset_3px_0_0_var(--color-primary)]',
      )}
    >
      {fila.personaId && enlace ? (
        <Link
          href={enlace(fila.personaId)}
          prefetch={false}
          transitionTypes={[TIPO_TRANSICION.avanzar]}
          className={cn(
            rejilla,
            'transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none',
          )}
        >
          {contenido}
        </Link>
      ) : (
        <div className={rejilla}>{contenido}</div>
      )}
      {/* Hermano del enlace de la persona y no dentro: la bandera lleva a su país. */}
      {fila.pais && pais ? (
        <Link
          href={pais}
          prefetch={false}
          data-enlace="pais"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-end rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <BanderaPais pais={fila.pais} />
        </Link>
      ) : fila.pais ? (
        <BanderaPais pais={fila.pais} />
      ) : (
        <span aria-hidden />
      )}
    </li>
  );
});

/**
 * Clasificación final: puesto (con medalla en el podio), nombre y país. Con
 * `limite`, sólo las primeras filas (quien la usa ofrece «Ver más»).
 */
export function ListaClasificacion({
  filas,
  enlace,
  filtro = { consulta: '' },
  limite,
}: {
  filas: readonly FilaClasificacionLigera[];
  enlace?: EnlaceFicha;
  filtro?: Filtro;
  limite?: number;
}) {
  if (filas.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin clasificación.</p>;
  }
  const visibles = limite === undefined ? filas : filas.slice(0, limite);
  return (
    <ol aria-label="Clasificación" className="divide-y overflow-hidden rounded-lg border bg-card">
      {visibles.map((f) => (
        <Fila key={f.id} fila={f} enlace={enlace} marcada={resaltado(f, filtro)} />
      ))}
    </ol>
  );
}
