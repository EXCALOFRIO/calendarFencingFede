'use client';

import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import * as React from 'react';
import { Boton } from '@/components/sistema/boton';
import { ChipFiltro, clasesChip } from '@/components/sistema/chip-filtro';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';

/**
 * Lo que las listas largas con filtros (hoy, /ranking) necesitan además de las
 * piezas del sistema (`src/components/sistema/`): el botón «Filtros» con su
 * cuenta, un buscador compacto, los apartados de opciones de la hoja y la hoja
 * de filtros con su pie. Los chips y la hoja son los del sistema; aquí sólo se
 * componen, para que no haya dos chips con dos tamaños en la aplicación.
 */

/** El chip «Filtros», con cuántos hay puestos. */
export function BotonFiltros({
  activos,
  ...resto
}: Omit<React.ComponentProps<typeof ChipFiltro>, 'children' | 'tipo'> & { activos: number }) {
  return (
    <ChipFiltro
      tipo="menu"
      icono={SlidersHorizontal}
      marcado={activos > 0}
      contador={activos}
      // Sin aria-label: el nombre sale de lo visible, «Filtros 1», y el lector oye además «activo» (WCAG 2.5.3).
      detalle={activos > 0 ? (activos === 1 ? 'activo' : 'activos') : undefined}
      {...resto}
    >
      Filtros
    </ChipFiltro>
  );
}

/** Buscador compacto, redondo como los chips, con aspa para vaciarlo. */
export function CampoBuscar({
  valor,
  onCambio,
  etiqueta,
  placeholder = 'Buscar',
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  etiqueta: string;
  placeholder?: string;
  className?: string;
}) {
  /*
    El campo mide 40 px. La etiqueta que lo envuelve suma 2 px arriba y abajo:
    tocar ese borde también enfoca el campo, así que el objetivo táctil llega a
    44 px sin que el campo se vea más alto.
  */
  return (
    <div role="search" className={cn('relative min-w-0', className)}>
      <label className="relative block py-[2px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        {/* 16 px en el móvil: por debajo, iOS hace zoom al enfocar. */}
        <input
          type="search"
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          placeholder={placeholder}
          aria-label={etiqueta}
          autoComplete="off"
          enterKeyHint="search"
          className={cn(
            SIN_MINIMO,
            'h-[40px] w-full rounded-[12px] border border-transparent bg-secondary pr-9 pl-9 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring sm:text-[14px]',
            '[&::-webkit-search-cancel-button]:hidden',
          )}
        />
      </label>
      {valor ? (
        <button
          type="button"
          onClick={() => onCambio('')}
          aria-label="Vaciar la búsqueda"
          className={cn(SIN_MINIMO, FOCO, AREA_TACTIL, 'absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export type OpcionFiltro = { valor: string; etiqueta: React.ReactNode; detalle?: React.ReactNode };

/** Un apartado de la hoja: título pequeño y las opciones en chips (se elige una). */
export function OpcionesFiltro({
  titulo,
  valor,
  opciones,
  onCambio,
}: {
  titulo: string;
  valor: string;
  opciones: readonly OpcionFiltro[];
  onCambio: (v: string) => void;
}) {
  const id = React.useId();
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend id={id} className="mb-[8px] text-[12px] font-medium text-muted-foreground">{titulo}</legend>
      <div role="radiogroup" aria-labelledby={id} className="flex min-w-0 flex-wrap gap-[8px]">
        {opciones.map((o) => {
          const elegido = o.valor === valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={elegido}
              onClick={() => onCambio(o.valor)}
              className={clasesChip(elegido)}
            >
              {elegido ? <Check aria-hidden /> : null}
              <span>{o.etiqueta}</span>
              {o.detalle !== undefined ? (
                <span className={cn('text-[12px] tabular-nums', elegido ? 'text-background' : 'text-muted-foreground')}>{o.detalle}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * La hoja de filtros: la `HojaInferior` del sistema con los apartados y, en el
 * pie, «Restablecer» (si hay algo que quitar) y el botón que cierra diciendo
 * cuántos resultados quedan. Los cambios se aplican al momento.
 */
export function HojaFiltros({
  abierta,
  onAbierta,
  titulo = 'Filtros',
  resultados,
  onLimpiar,
  children,
}: {
  abierta: boolean;
  onAbierta: (v: boolean) => void;
  titulo?: string;
  /** «Ver 907 tiradores». */
  resultados: string;
  /** Si se pasa, aparece «Restablecer». */
  onLimpiar?: (() => void) | null;
  children: React.ReactNode;
}) {
  return (
    <HojaInferior
      abierta={abierta}
      alCambiar={onAbierta}
      titulo={titulo}
      pie={<PieHojaFiltros resultados={resultados} onLimpiar={onLimpiar} onCerrar={() => onAbierta(false)} />}
    >
      <CuerpoHojaFiltros>{children}</CuerpoHojaFiltros>
    </HojaInferior>
  );
}

/** Los apartados, separados de la hoja para poder pintarlos fuera del portal (capturas). */
export function CuerpoHojaFiltros({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-[20px] pt-[4px]">{children}</div>;
}

export function PieHojaFiltros({
  resultados,
  onLimpiar,
  onCerrar,
}: {
  resultados: string;
  onLimpiar?: (() => void) | null;
  onCerrar: () => void;
}) {
  return (
    <div className="flex items-center gap-[8px]">
      {onLimpiar ? (
        <Boton variante="fantasma" tamano="lg" onClick={onLimpiar}>
          Restablecer
        </Boton>
      ) : null}
      <Boton variante="primario" tamano="lg" ancho="completo" className="flex-1" onClick={onCerrar}>
        {resultados}
      </Boton>
    </div>
  );
}
