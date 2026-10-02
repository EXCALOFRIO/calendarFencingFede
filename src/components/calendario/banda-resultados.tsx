'use client';

import Link from 'next/link';
import * as React from 'react';
import { resultadosDelEvento } from '@/app/(app)/explorar/resultados-evento';
import {
  EnlacesResultados,
  EstadoResultadosPrueba,
  nombreDePrueba,
} from '@/components/explorar/prueba-resultados';
import { Skeleton } from '@/components/ui/skeleton';
import type { VistaResultadosEvento } from '@/lib/sport/explorar/ediciones-pantalla';
import { construirUrlEdicion, urlExplorarDePrueba } from '@/lib/sport/explorar/edicion-url';

/**
 * Resultados verificados del torneo, leídos aparte de la ficha: abrirla no
 * espera a esta lectura. Cada estado se dice distinto —cargando, sin sesión,
 * no disponible, error, sin edición vinculada— para que un fallo nunca se lea
 * como «no hay resultados».
 */

type Lectura = { evento: string; vista: VistaResultadosEvento | 'fallo' };

const ENLACE =
  'inline-flex min-h-11 items-center text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-0';

export function BandaResultados({ eventoId, retorno }: { eventoId: string; retorno?: string }) {
  const [lectura, setLectura] = React.useState<Lectura | null>(null);

  React.useEffect(() => {
    let vigente = true;
    resultadosDelEvento(eventoId)
      .then((vista) => {
        if (vigente) setLectura({ evento: eventoId, vista });
      })
      .catch(() => {
        if (vigente) setLectura({ evento: eventoId, vista: 'fallo' });
      });
    return () => {
      vigente = false;
    };
  }, [eventoId]);

  const vista = lectura && lectura.evento === eventoId ? lectura.vista : null;

  return (
    <section
      aria-labelledby="banda-resultados"
      className="flex flex-col gap-3 border-t border-t-filete pt-4 pb-1"
    >
      <h3 id="banda-resultados" className="text-xl leading-none sm:text-lg">
        Resultados
      </h3>
      {vista === null ? (
        <div role="status" aria-label="Leyendo resultados" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <CuerpoResultados vista={vista} retorno={retorno} />
      )}
    </section>
  );
}

function Nota({ children, alerta = false }: { children: React.ReactNode; alerta?: boolean }) {
  return (
    <p role={alerta ? 'alert' : undefined} className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * `retorno` es el calendario tal y como se está mirando (periodo, ámbito y
 * filtros): los enlaces a la edición lo llevan para que Atrás desde la
 * edición, una persona o los favoritos devuelva a esa misma vista.
 */
export function CuerpoResultados({
  vista,
  retorno,
}: {
  vista: VistaResultadosEvento | 'fallo';
  retorno?: string;
}) {
  if (vista === 'fallo' || vista.tipo === 'error') {
    return (
      <Nota alerta>
        No se han podido leer los resultados de este torneo. Que no se vean no significa que no existan: vuelve a
        abrir la ficha.
      </Nota>
    );
  }
  if (vista.tipo === 'sin_sesion') {
    return <Nota>Inicia sesión para ver los resultados verificados de este torneo.</Nota>;
  }
  if (vista.tipo === 'no_disponible') {
    return <Nota>Los resultados deportivos no están disponibles ahora mismo.</Nota>;
  }
  if (vista.tipo === 'entrada_invalida') {
    return <Nota>Este torneo no tiene un identificador válido para consultar resultados.</Nota>;
  }
  if (vista.ediciones.length === 0) {
    return (
      <Nota>
        Este torneo no tiene todavía una edición deportiva vinculada, así que no hay resultados que enseñar. No
        significa que no los vaya a haber.
      </Nota>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {vista.ediciones.map((edicion) => (
        <li key={edicion.id} className="flex flex-col gap-2">
          <Link href={construirUrlEdicion(edicion.id, { origen: retorno })} className={ENLACE}>
            {edicion.nombre} · temporada {edicion.temporada}
          </Link>
          {edicion.pruebasDetalle.length === 0 ? (
            <Nota>Esta edición todavía no tiene pruebas importadas.</Nota>
          ) : (
            <ul className="flex flex-col gap-3">
              {edicion.pruebasDetalle.map((prueba) => (
                <li key={prueba.id} className="flex flex-col gap-1 rounded-md border border-filete p-3">
                  <p className="text-sm font-medium">{nombreDePrueba(prueba)}</p>
                  <EstadoResultadosPrueba estado={prueba.resultados.estado} importados={prueba.resultados.importados} />
                  <EnlacesResultados enlaces={prueba.enlaces} />
                  <span className="flex flex-wrap gap-x-4">
                    <Link href={construirUrlEdicion(edicion.id, { prueba: prueba.id, origen: retorno })} className={ENLACE}>
                      Ver clasificación
                    </Link>
                    <Link href={urlExplorarDePrueba(edicion.id, prueba)} className={ENLACE}>
                      Buscar deportistas de esta prueba
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
