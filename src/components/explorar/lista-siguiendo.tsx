'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { masSiguiendoAccion } from '@/app/(app)/explorar/acciones';
import type { PersonaSeguida } from '@/lib/sport/explorar/siguiendo-lista';
import { construirUrlSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { CLASE_LISTA_PERFILES, FilaPerfil } from './buscador-social-fila';
import { BotonSeguirCompacto } from './buscador-social-seguir';
import { anadirSinRepetir } from './resultados';

/**
 * Personas que sigue la cuenta, como la lista «Siguiendo» de una red social:
 * retrato redondo, nombre, bandera y el botón «Siguiendo». Tocarlo deja de
 * seguir al momento y el botón pasa a «Seguir», que es el deshacer: la fila no
 * desaparece aunque el servidor ya no la devuelva, porque las filas son estado
 * de esta lista y no se sustituyen al refrescarse la página.
 */
export function ListaSiguiendo({ items, siguiente }: { items: PersonaSeguida[]; siguiente: string | null }) {
  const [lista, setLista] = React.useState(items);
  const [cursor, setCursor] = React.useState(siguiente);
  const [estado, setEstado] = React.useState<'reposo' | 'cargando' | 'error'>('reposo');

  async function verMas(ev: React.MouseEvent<HTMLAnchorElement>) {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    if (!cursor || estado === 'cargando') return;
    setEstado('cargando');
    try {
      const r = await masSiguiendoAccion({ cursor });
      if (r.estado !== 'ok') {
        setEstado('error');
        return;
      }
      setLista((actual) => anadirSinRepetir(actual, r.items));
      setCursor(r.siguiente);
      setEstado('reposo');
    } catch {
      setEstado('error');
    }
  }

  return (
    <section aria-labelledby="siguiendo-lista" className="flex min-w-0 flex-col lg:max-w-2xl">
      <h2 id="siguiendo-lista" className="sr-only">Personas que sigues</h2>
      <ul className={CLASE_LISTA_PERFILES} aria-label="Personas que sigues">
        {lista.map((p) => {
          const nombre = nombreVisible(p.nombre) || p.nombre;
          return (
            <FilaPerfil
              key={p.id}
              p={p}
              accion={<BotonSeguirCompacto personaId={p.id} nombre={nombre} inicial lectura={p} />}
            />
          );
        })}
      </ul>
      {cursor ? (
        <div className="flex flex-col items-center pt-1">
          <Link
            href={construirUrlSiguiendo({ cursor })}
            prefetch={false}
            rel="next"
            aria-disabled={estado === 'cargando'}
            onClick={verMas}
            className="inline-flex h-[44px] items-center gap-1.5 px-4 text-[13px] font-semibold text-primary-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            {estado === 'cargando' ? <LoaderCircle className="size-[16px] animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {estado === 'error' ? 'Reintentar' : 'Ver más'}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
