'use client';

import { RotateCw } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CaraTarjeta = { clave: string; rotulo: string; contenido: ReactNode };

/**
 * Tarjeta de cifras que gira en 3D de una cara a otra (General → Internacional
 * → Nacional). Sólo hay dos caras físicas: la que no se ve recibe la siguiente
 * antes de girar, así se puede saltar a cualquiera. Con movimiento reducido no
 * gira: las caras se funden.
 *
 * Sin JavaScript se ve la primera cara y nada más (los botones no hacen nada).
 */
export function TarjetaGiratoria({
  caras,
  etiqueta,
  inicial = 0,
}: {
  caras: readonly CaraTarjeta[];
  etiqueta: string;
  /** Índice de la cara con la que se abre. */
  inicial?: number;
}) {
  const primera = Math.min(Math.max(0, inicial), caras.length - 1);
  const [estado, setEstado] = useState({ giro: 0, frente: primera, dorso: (primera + 1) % caras.length });
  const visible = estado.giro % 2 === 0 ? estado.frente : estado.dorso;

  const ir = (k: number) => {
    if (k === visible) return;
    setEstado((e) => (e.giro % 2 === 0
      ? { giro: e.giro + 1, frente: e.frente, dorso: k }
      : { giro: e.giro + 1, frente: k, dorso: e.dorso }));
  };

  if (caras.length === 1) return <div className="min-w-0">{caras[0].contenido}</div>;

  const cara = (indice: number, detras: boolean) => {
    const oculta = (estado.giro % 2 === 0) === detras;
    return (
      <div
        data-cara={caras[indice].clave}
        aria-hidden={oculta || undefined}
        inert={oculta || undefined}
        className={cn(
          'col-start-1 row-start-1 min-w-0 [backface-visibility:hidden]',
          detras && 'motion-safe:[transform:rotateY(180deg)]',
          'motion-reduce:transition-opacity motion-reduce:duration-300',
          oculta && 'motion-reduce:pointer-events-none motion-reduce:opacity-0',
        )}
      >
        {caras[indice].contenido}
      </div>
    );
  };

  return (
    <section aria-label={etiqueta} className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <div role="group" aria-label="Qué cifras ver" className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-1 sm:flex sm:flex-none">
          {caras.map((c, i) => (
            <button
              key={c.clave}
              type="button"
              aria-pressed={i === visible}
              onClick={() => ir(i)}
              className={cn(
                'inline-flex h-11 min-w-0 items-center justify-center rounded-full px-1.5 text-[0.8125rem] whitespace-nowrap text-muted-foreground max-[359px]:px-1 max-[359px]:text-xs sm:px-4',
                'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                'aria-pressed:bg-marcado aria-pressed:font-semibold aria-pressed:text-primary-text',
              )}
            >
              {c.rotulo}
            </button>
          ))}
        </div>
        {/* En móvil las tres pestañas ocupan el ancho; el botón de girar sólo sale con sitio. */}
        <button
          type="button"
          onClick={() => ir((visible + 1) % caras.length)}
          className="hidden size-11 shrink-0 items-center sm:ml-auto sm:inline-flex justify-center rounded-full border border-filete-alto text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`Girar: ver ${caras[(visible + 1) % caras.length].rotulo.toLowerCase()}`}
        >
          <RotateCw className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-w-0 [perspective:1400px]">
        <div
          data-giro={estado.giro}
          className="grid min-w-0 [transform-style:preserve-3d] motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-[cubic-bezier(.2,.7,.2,1)] motion-safe:[transform:rotateY(var(--giro))]"
          style={{ '--giro': `${estado.giro * 180}deg` } as CSSProperties}
        >
          {cara(estado.frente, false)}
          {cara(estado.dorso, true)}
        </div>
      </div>
    </section>
  );
}
