'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { masFeedAccion } from '@/app/(app)/explorar/acciones';
import { construirUrlInicio } from '@/lib/sport/explorar/inicio-url';
import type { EntradaSiguiendo } from '@/lib/sport/explorar/tipos-social';
import { anadirSinRepetir } from './resultados';
import { TarjetaSiguiendo } from './tarjeta-feed';

type Estado = 'reposo' | 'cargando' | 'error' | 'fin';

/**
 * Feed con carga incremental: al acercarse al final se pide la página
 * siguiente por el cursor y se añade debajo, sin navegar ni repetir. Sin
 * JavaScript (o si el observador no está), «Ver más» es un enlace a esa
 * página, y el mismo botón reintenta tras un fallo.
 */
export function FeedIncremental({
  items,
  siguiente,
  soloMedallas,
  limite,
}: {
  items: EntradaSiguiendo[];
  siguiente: string | null;
  soloMedallas: boolean;
  limite: number;
}) {
  const [lista, setLista] = React.useState(items);
  const [cursor, setCursor] = React.useState(siguiente);
  const [estado, setEstado] = React.useState<Estado>(siguiente ? 'reposo' : 'fin');
  const centinela = React.useRef<HTMLDivElement>(null);
  const enVuelo = React.useRef(false);

  const cargar = React.useCallback(async () => {
    if (!cursor || enVuelo.current) return;
    enVuelo.current = true;
    setEstado('cargando');
    try {
      const r = await masFeedAccion({ cursor, soloMedallas, limite });
      if (r.estado !== 'ok') {
        setEstado('error');
        return;
      }
      setLista((actual) => anadirSinRepetir(actual, r.items));
      setCursor(r.siguiente);
      setEstado(r.siguiente ? 'reposo' : 'fin');
    } catch {
      setEstado('error');
    } finally {
      enVuelo.current = false;
    }
  }, [cursor, soloMedallas, limite]);

  React.useEffect(() => {
    const nodo = centinela.current;
    if (!nodo || estado !== 'reposo' || typeof IntersectionObserver === 'undefined') return;
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) void cargar();
    }, { rootMargin: '600px 0px' });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [cargar, estado]);

  return (
    <>
      <ol className="flex min-w-0 flex-col divide-y divide-filete-alto" aria-label="Resultados, del más reciente al más antiguo">
        {lista.map((e) => <TarjetaSiguiendo key={e.id} e={e} />)}
      </ol>
      <div ref={centinela} className="flex min-h-[44px] flex-col items-center justify-center gap-1 pt-1">
        {cursor ? (
          <Link
            href={construirUrlInicio({ soloMedallas, cursor })}
            prefetch={false}
            rel="next"
            aria-disabled={estado === 'cargando'}
            className="inline-flex h-[44px] items-center gap-1.5 px-4 text-[13px] font-semibold text-primary-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={(ev) => {
              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
              ev.preventDefault();
              void cargar();
            }}
          >
            {estado === 'cargando' ? <LoaderCircle className="size-[16px] animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {estado === 'error' ? 'Reintentar' : 'Ver más'}
          </Link>
        ) : lista.length > limite ? (
          <p className="text-[12px] text-muted-foreground">No hay más resultados.</p>
        ) : null}
        <p role="status" className="sr-only">
          {estado === 'cargando' ? 'Cargando más resultados…' : estado === 'error' ? 'No se han podido cargar más resultados.' : ''}
        </p>
      </div>
    </>
  );
}
