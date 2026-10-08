'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { EnlacePrecarga } from './enlace-precarga';
import { AREA_TACTIL, FOCO, SIN_MINIMO } from './tactil';

/**
 * Control segmentado: elegir uno entre pocos valores.
 *
 * - Con `onCambio` son botones con semántica de `radiogroup`: una sola
 *   parada de tabulador y las flechas cambian la elección.
 * - Si todas las opciones traen `href` son enlaces dentro de un `nav`, con
 *   `aria-current` en el activo; `replace`, `scroll` y `transitionTypes`
 *   pasan a `Link`.
 *
 * Las opciones miden lo mismo y, si no caben, saltan a otra fila (rejilla
 * `auto-fit`): nunca hay desplazamiento horizontal. El indicador del activo
 * sólo anima `opacity` y `transform`.
 */

export type OpcionSegmento = {
  valor: string;
  etiqueta: React.ReactNode;
  href?: string;
  /** Cifra pequeña detrás del rótulo. */
  cuenta?: number;
  deshabilitada?: boolean;
};

export type VarianteSegmento = 'pastilla' | 'subrayado';

export type PropsSelectorSegmentado = {
  /** Nombre accesible del grupo («Arma», «Vista»). */
  etiqueta: string;
  opciones: readonly OpcionSegmento[];
  /** Valor de la opción activa. */
  valor: string | null | undefined;
  onCambio?: (valor: string) => void;
  variante?: VarianteSegmento;
  /** `md`: 44 px visibles. `sm`: 36 px visibles con área táctil de 44. */
  tamano?: 'sm' | 'md';
  /** Ancho mínimo de cada opción antes de saltar de fila, en rem. */
  anchoMinimo?: 4 | 5 | 6 | 8;
  /** Sólo enlaces: sustituye la entrada del historial en vez de añadir una. */
  replace?: boolean;
  /** Sólo enlaces: `false` conserva el desplazamiento. */
  scroll?: boolean;
  /** Sólo enlaces: tipos de transición de `Link` (`TIPO_TRANSICION`). */
  transitionTypes?: string[];
  className?: string;
};

const REJILLA: Record<NonNullable<PropsSelectorSegmentado['anchoMinimo']>, string> = {
  4: 'grid-cols-[repeat(auto-fit,minmax(min(100%,4rem),1fr))]',
  5: 'grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))]',
  6: 'grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))]',
  8: 'grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))]',
};

export function SelectorSegmentado({
  etiqueta,
  opciones,
  valor,
  onCambio,
  variante = 'pastilla',
  tamano = 'md',
  anchoMinimo = 5,
  replace,
  scroll,
  transitionTypes,
  className,
}: PropsSelectorSegmentado) {
  const botones = React.useRef<(HTMLButtonElement | null)[]>([]);
  const comoEnlaces = !onCambio && opciones.length > 0 && opciones.every((o) => o.href);
  const pastilla = variante === 'pastilla';

  const contenedor = cn(
    'grid min-w-0',
    REJILLA[anchoMinimo],
    pastilla ? 'gap-1 rounded-xl bg-secondary p-1' : 'border-b border-border',
    className,
  );

  const clasesOpcion = (activa: boolean) =>
    cn(
      SIN_MINIMO,
      FOCO,
      'group/segmento relative isolate inline-flex min-w-0 items-center justify-center gap-1 px-2 text-sm font-medium select-none',
      '[-webkit-tap-highlight-color:transparent] disabled:pointer-events-none disabled:text-off',
      tamano === 'md' ? 'h-11' : cn('h-9', AREA_TACTIL),
      pastilla ? 'rounded-md' : '',
      activa ? (pastilla ? 'text-background' : 'font-semibold text-foreground') : 'text-muted-foreground hover:text-foreground',
    );

  const indicador = (activa: boolean) => (
    <span
      aria-hidden
      data-indicador
      className={cn(
        'pointer-events-none absolute -z-10 transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none',
        pastilla ? 'inset-0 rounded-md bg-foreground' : 'inset-x-2 bottom-0 h-0 border-b-2 border-primary',
        activa ? 'scale-100 opacity-100' : pastilla ? 'scale-95 opacity-0' : 'scale-x-0 opacity-0',
      )}
    />
  );

  const contenido = (o: OpcionSegmento, activa: boolean) => (
    <>
      {indicador(activa)}
      <span className="min-w-0 truncate">{o.etiqueta}</span>
      {o.cuenta !== undefined ? (
        <span className={cn('text-xs tabular-nums', activa && pastilla ? 'text-background' : 'text-muted-foreground')}>
          {o.cuenta}
        </span>
      ) : null}
    </>
  );

  if (comoEnlaces) {
    return (
      <nav aria-label={etiqueta} data-slot="sistema-segmentado" data-variante={variante}>
        <ul className={contenedor} role="list">
          {opciones.map((o) => {
            const activa = o.valor === valor;
            return (
              <li key={o.valor} className="grid min-w-0">
                <EnlacePrecarga
                  href={o.href!}
                  replace={replace}
                  scroll={scroll}
                  transitionTypes={transitionTypes}
                  aria-current={activa ? 'page' : undefined}
                  aria-disabled={o.deshabilitada || undefined}
                  tabIndex={o.deshabilitada ? -1 : undefined}
                  className={cn(clasesOpcion(activa), o.deshabilitada && 'pointer-events-none text-off')}
                >
                  {contenido(o, activa)}
                </EnlacePrecarga>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  const habilitadas = opciones.map((o, i) => (o.deshabilitada ? -1 : i)).filter((i) => i >= 0);
  const indiceActivo = opciones.findIndex((o) => o.valor === valor);
  const enfocable = indiceActivo >= 0 && !opciones[indiceActivo].deshabilitada ? indiceActivo : habilitadas[0];

  const mover = (desde: number, paso: number | 'inicio' | 'fin') => {
    if (habilitadas.length === 0) return;
    const pos = habilitadas.indexOf(desde);
    const destino =
      paso === 'inicio'
        ? habilitadas[0]
        : paso === 'fin'
          ? habilitadas[habilitadas.length - 1]
          : habilitadas[(pos + paso + habilitadas.length) % habilitadas.length];
    botones.current[destino]?.focus();
    onCambio?.(opciones[destino].valor);
  };

  return (
    <div
      role="radiogroup"
      aria-label={etiqueta}
      data-slot="sistema-segmentado"
      data-variante={variante}
      className={contenedor}
    >
      {opciones.map((o, i) => {
        const activa = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(nodo) => {
              botones.current[i] = nodo;
            }}
            type="button"
            role="radio"
            aria-checked={activa}
            disabled={o.deshabilitada}
            tabIndex={i === enfocable ? 0 : -1}
            onClick={() => onCambio?.(o.valor)}
            onKeyDown={(e) => {
              const paso =
                e.key === 'ArrowRight' || e.key === 'ArrowDown'
                  ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : e.key === 'Home'
                      ? 'inicio'
                      : e.key === 'End'
                        ? 'fin'
                        : null;
              if (paso === null) return;
              e.preventDefault();
              mover(i, paso);
            }}
            className={clasesOpcion(activa)}
          >
            {contenido(o, activa)}
          </button>
        );
      })}
    </div>
  );
}
