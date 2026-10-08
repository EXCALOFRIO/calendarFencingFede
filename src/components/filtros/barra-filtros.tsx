'use client';

import * as React from 'react';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';
import { BotonFiltros, HojaFiltros } from './chips';

export { CampoBuscar, OpcionesFiltro, SeccionFiltro, type OpcionFiltro } from './chips';

/**
 * La barra de filtros de una lista: buscador opcional, un único botón
 * «Filtros» con cuántos hay puestos, y los puestos como chips que se quitan
 * con un toque y saltan de línea. Todo lo demás vive en la hoja, por
 * apartados (`OpcionesFiltro`, `SeccionFiltro`), que se pasan como `children`.
 *
 * La hoja puede ir controlada (`abierta` + `onAbierta`) o sola.
 */

export type FiltroActivo = {
  /** Estable entre renders: `arma`, `genero`… */
  clave: string;
  /** Lo que se ve en el chip: «Espada», «M17». */
  etiqueta: string;
  onQuitar: () => void;
};

export function BarraFiltros({
  buscador,
  activos,
  resultados,
  onLimpiar,
  titulo = 'Filtros',
  abierta: abiertaControlada,
  onAbierta,
  etiqueta = 'Filtros puestos',
  className,
  children,
}: {
  /** Normalmente un `CampoBuscar`. */
  buscador?: React.ReactNode;
  activos: readonly FiltroActivo[];
  /** Texto del botón que cierra la hoja: «Ver 907 tiradores». */
  resultados: string;
  /** Quita todos; aparece «Restablecer» en la hoja y «Quitar todos» tras los chips. */
  onLimpiar?: (() => void) | null;
  titulo?: string;
  abierta?: boolean;
  onAbierta?: (v: boolean) => void;
  /** Nombre accesible del grupo de chips puestos. */
  etiqueta?: string;
  className?: string;
  /** Los apartados de la hoja. */
  children: React.ReactNode;
}) {
  const [abiertaPropia, setAbiertaPropia] = React.useState(false);
  const abierta = abiertaControlada ?? abiertaPropia;
  const cambiar = (v: boolean) => {
    if (abiertaControlada === undefined) setAbiertaPropia(v);
    onAbierta?.(v);
  };

  const boton = <BotonFiltros activos={activos.length} onClick={() => cambiar(true)} aria-expanded={abierta} />;

  const chips = activos.map((f) => (
    <ChipFiltro key={f.clave} tipo="quitar" onClick={f.onQuitar}>
      {f.etiqueta}
    </ChipFiltro>
  ));

  const limpiarTodo =
    onLimpiar && activos.length > 1 ? (
      <button
        type="button"
        onClick={onLimpiar}
        className={cn(SIN_MINIMO, AREA_TACTIL, FOCO, 'inline-flex h-8 items-center rounded-full px-2 text-sm font-medium text-primary-text')}
      >
        Quitar todos
      </button>
    ) : null;

  return (
    <div data-slot="barra-filtros" className={cn('flex min-w-0 flex-col gap-3', className)}>
      {buscador ? (
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">{buscador}</div>
          {boton}
        </div>
      ) : null}
      {buscador ? (
        activos.length > 0 ? (
          <FilaChips etiqueta={etiqueta}>
            {chips}
            {limpiarTodo}
          </FilaChips>
        ) : null
      ) : (
        <FilaChips etiqueta={etiqueta}>
          {boton}
          {chips}
          {limpiarTodo}
        </FilaChips>
      )}
      <HojaFiltros abierta={abierta} onAbierta={cambiar} titulo={titulo} resultados={resultados} onLimpiar={activos.length > 0 ? onLimpiar : null}>
        {children}
      </HojaFiltros>
    </div>
  );
}
