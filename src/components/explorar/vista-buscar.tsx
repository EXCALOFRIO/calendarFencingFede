import type * as React from 'react';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import { construirUrl, hayCriterios, type CriteriosExplorar, type OpcionTemporada } from '@/lib/sport/explorar/url';
import { CabeceraExplorar } from './cabecera-explorar';
import { FormularioFiltros } from './formulario-filtros';
import { ChipsActivos, EstadoSinCoincidencias, EstadoSinLista, ListaDeportistas } from './resultados';

/**
 * Pestaña Buscar: la barra de perfiles en vivo, los filtros y, debajo, la
 * lista completa de la búsqueda de la URL o, sin búsqueda, `sugerencias`
 * (que la página entrega en diferido para no retrasar la barra).
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
      <CabeceraExplorar activa="personas" />
      <FormularioFiltros
        key={construirUrl(criterios, cursor)}
        criterios={criterios}
        temporadas={temporadas}
        atajoEspana={atajoEspana}
        profileId={profileId}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {inicio ? null : <ChipsActivos criterios={criterios} />}
          {contenido}
        </div>
      </FormularioFiltros>
    </div>
  );
}
