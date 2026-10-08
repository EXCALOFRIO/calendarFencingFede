import { MapPin } from 'lucide-react';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { BloqueFecha } from '@/components/sistema/bloque-fecha';
import type { EntradaFecha } from '@/lib/fechas';
import { cn, titular } from '@/lib/utils';

/**
 * La fila de una competición, la misma en el calendario y en «Cómo voy»:
 *
 *   ┌──────┬──────────────────────────────────────────┐
 *   │15–18 │ Copa del Mundo de Florete                 │
 *   │ OCT  │ 🇯🇵 Takamatsu        [Cierra en 2 días] [Inscrito] │
 *   │      │ [FIE] Copa del Mundo · [Florete masculino]│
 *   └──────┴──────────────────────────────────────────┘
 *
 * La fecha en bloque a la izquierda, con ancho fijo para que los nombres de
 * una lista caigan en la misma vertical. El estado (plazo, inscripción,
 * puesto) siempre en el mismo sitio: alineado a la derecha de la línea de la
 * sede, y debajo de ella, también a la derecha, si no cabe.
 *
 * Con `onClick` la fila entera es un botón y por dentro sólo lleva texto: un
 * `<button>` no puede contener otros controles. Sin él es un bloque y puede
 * llevar enlaces y horarios en `children`.
 */
export function FilaCompeticion({
  desde,
  hasta,
  titulo,
  ciudad,
  pais,
  detalle,
  estado,
  apagado = false,
  onClick,
  className,
  datos,
  children,
}: {
  desde: EntradaFecha;
  hasta?: EntradaFecha | null;
  titulo: React.ReactNode;
  ciudad?: string | null;
  pais?: string | null;
  /** La línea de pastillas: organismo, circuito, prueba. */
  detalle?: React.ReactNode;
  /** Pastillas de estado: plazo, «Inscrito», puesto. */
  estado?: React.ReactNode;
  /** Ya celebrada: fecha y nombre en gris, sin velo de opacidad. */
  apagado?: boolean;
  onClick?: () => void;
  className?: string;
  /** Atributos `data-*` para la delegación de eventos y las capturas. */
  datos?: Record<`data-${string}`, string | boolean | undefined>;
  /** Sólo sin `onClick`: lo que va debajo, dentro de la columna central. */
  children?: React.ReactNode;
}) {
  const boton = Boolean(onClick);
  const Titulo = boton ? 'span' : 'h3';
  const contenido = (
    <>
      <BloqueFecha
        desde={desde}
        hasta={hasta}
        tamano="fila"
        className={cn(apagado && '[&>span]:text-muted-foreground')}
      />
      <span className="flex min-w-0 flex-col gap-1">
        <Titulo
          className={cn(
            'min-w-0 text-sm leading-snug font-semibold break-words',
            apagado ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {titulo}
        </Titulo>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Sede ciudad={ciudad} pais={pais} />
          {estado ? (
            <span
              data-slot="estado-competicion"
              className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1"
            >
              {estado}
            </span>
          ) : null}
        </span>
        {detalle ? <span className="flex min-w-0 flex-wrap items-center gap-1">{detalle}</span> : null}
        {children}
      </span>
    </>
  );

  const clases = cn(
    'grid w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 px-3 py-3 text-left',
    className,
  );

  if (boton) {
    return (
      <button
        type="button"
        onClick={onClick}
        {...datos}
        className={cn(
          clases,
          // `.pulsable` ya fija `transition` (scale); un `transition-colors` aquí lo pisaría.
          'pulsable cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        {contenido}
      </button>
    );
  }
  return (
    <div {...datos} className={clases}>
      {contenido}
    </div>
  );
}

/** La sede con su bandera, también la española. Sin ciudad, «Sede sin publicar». */
export function Sede({ ciudad, pais, className }: { ciudad?: string | null; pais?: string | null; className?: string }) {
  const nombre = ciudad ? titular(ciudad) : '';
  return (
    <span className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}>
      {pais ? (
        <BanderaPais pais={pais} soloBandera className="shrink-0" />
      ) : (
        <MapPin className="size-3 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 break-words">{nombre || 'Sede sin publicar'}</span>
    </span>
  );
}
