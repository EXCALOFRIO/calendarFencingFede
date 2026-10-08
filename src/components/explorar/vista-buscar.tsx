import type * as React from 'react';
import { TransicionContenido } from '@/components/sistema/transicion';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import { construirUrl, hayCriterios, type CriteriosExplorar, type OpcionTemporada } from '@/lib/sport/explorar/url';
import { FormularioFiltros } from './formulario-filtros';
import { EstadoSinCoincidencias, EstadoSinLista, ListaDeportistas } from './resultados';

/**
 * Ámbito Tiradores de Explorar: la barra de perfiles en vivo, el selector de
 * ámbitos y los filtros (`FormularioFiltros`, que se mantiene montado entre
 * búsquedas para no cerrar la hoja) y, debajo, la lista completa de la
 * búsqueda de la URL o, sin búsqueda, `sugerencias` (que la página entrega en
 * diferido para no retrasar la barra). Los filtros puestos se ven una vez,
 * como chips de la barra de filtros.
 */
export function VistaBuscar({
  criterios,
  cursor,
  vista,
  temporadas,
  atajoEspana,
  profileId,
  sugerencias,
}: {
  criterios: CriteriosExplorar;
  cursor: string | undefined;
  vista: Exclude<VistaExplorar, { tipo: 'sin_sesion' }>;
  temporadas: OpcionTemporada[];
  atajoEspana: boolean;
  profileId: string;
  sugerencias: React.ReactNode;
}) {
  const inicio = !hayCriterios(criterios);
  const contenido = vista.tipo === 'ok' ? (
    vista.sinResultados ? (
      <EstadoSinCoincidencias criterios={criterios} />
    ) : (
      <ListaDeportistas
        key={construirUrl(criterios, cursor)}
        items={vista.items}
        siguiente={vista.siguiente}
        cursorActual={cursor}
        criterios={criterios}
      />
    )
  ) : inicio && vista.tipo === 'sin_criterio' ? (
    sugerencias
  ) : (
    <EstadoSinLista vista={vista} criterios={criterios} />
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 lg:mx-auto lg:max-w-2xl">
      <FormularioFiltros criterios={criterios} temporadas={temporadas} atajoEspana={atajoEspana} profileId={profileId}>
        <TransicionContenido clave="personas" nombre="explorar-contenido">
          <div className="flex min-w-0 flex-col gap-3">{contenido}</div>
        </TransicionContenido>
      </FormularioFiltros>
    </div>
  );
}
