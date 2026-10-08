'use client';

import { CalendarOff } from 'lucide-react';
import * as React from 'react';
import {
  itemsDelMes,
  nombreDeMes,
  rangoCorto,
  type Bloque,
  type ItemMes,
} from '@/lib/calendario/bloques';
import type { EventView } from '@/lib/queries/calendar';
import { cn } from '@/lib/utils';
import { DivisorHueco, TarjetaBloque, type PasadoDeTarjeta } from './tarjeta-bloque';

/**
 * El calendario como lista de bloques: una columna por mes en el escritorio y
 * un feed de una columna en el móvil. Los dos pintan las mismas piezas, la
 * tarjeta de bloque y el divisor de semanas libres, y el alto de un mes es el
 * de sus competiciones (no el de una cuadrícula de 31 casillas).
 */

type Comun = {
  inscripciones: Record<string, string>;
  resaltados: Set<string>;
  proximo: string | null;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
  pasado?: PasadoDeTarjeta;
};

/**
 * Cómo está lo ya celebrado de un mes: `listo` también cuando no hay nada que
 * pedir (un mes futuro). Solo con `listo` se puede decir «sin competiciones».
 */
export type EstadoDelMes = 'listo' | 'cargando' | 'fallo';

const claveMes = (anio: number, mes: number) => `${anio}-${String(mes + 1).padStart(2, '0')}`;

/**
 * Una columna de mes, en escritorio. Con título cuando hay más de un mes en
 * pantalla; con uno, el nombre ya está en la cabecera del periodo.
 */
export function ColumnaMes({
  anio,
  mes,
  bloques,
  conTitulo,
  estado = 'listo',
  ...comun
}: {
  anio: number;
  mes: number;
  bloques: Bloque[];
  conTitulo: boolean;
  /** Si lo ya celebrado del mes está aún en camino. */
  estado?: EstadoDelMes;
} & Comun) {
  const items = React.useMemo(() => itemsDelMes(bloques, anio, mes), [bloques, anio, mes]);

  return (
    <section
      aria-label={nombreDeMes(anio, mes)}
      aria-busy={estado === 'cargando' || undefined}
      data-mes={claveMes(anio, mes)}
      data-bloques={items.filter((i) => i.tipo === 'bloque').length}
      // `flex-1`: el mes vacío se centra en la celda de la rejilla, no arriba del todo.
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {conTitulo ? (
        <h2 className="mb-2 shrink-0 border-b border-border pb-2 text-xl font-semibold">{nombreDeMes(anio, mes, false)}</h2>
      ) : null}

      {items.length === 0 ? (
        <MesVacio anio={anio} mes={mes} estado={estado} grande />
      ) : (
        <>
          <ul className="flex min-w-0 flex-col border-t border-border">
            {items.map((item) => (
              <ItemDeLista key={claveDeItem(item)} item={item} {...comun} />
            ))}
          </ul>
          <AvisoPasado estado={estado} />
        </>
      )}
    </section>
  );
}

/**
 * Lo ya celebrado que no llegó, debajo de lo que sí hay: un mes con media
 * lista no puede parecer completo. Mientras llega no se dice nada; la vista
 * sigue pintando el tramo anterior hasta tenerlo.
 */
function AvisoPasado({ estado }: { estado: EstadoDelMes }) {
  if (estado !== 'fallo') return null;
  return (
    <p role="alert" className="py-2 text-xs text-muted-foreground">
      No se pudo cargar
    </p>
  );
}

function claveDeItem(item: ItemMes): string {
  return item.tipo === 'bloque' ? item.bloque.clave : `hueco_${item.hueco.desde}`;
}

function ItemDeLista({ item, ...comun }: { item: ItemMes } & Comun) {
  if (item.tipo === 'hueco') {
    return (
      <li>
        <DivisorHueco
          texto={item.hueco.texto}
          rango={rangoCorto({ desde: item.hueco.desde, hasta: item.hueco.hasta })}
        />
      </li>
    );
  }
  return (
    <li>
      <TarjetaBloque bloque={item.bloque} {...comun} />
    </li>
  );
}

/**
 * El mes vacío. No explica nada que no conste: un mes sin torneos cargados no
 * es un mes sin competiciones. Mientras lo ya celebrado está en camino no se
 * dice «sin competiciones» (el mes puede tener setenta torneos ya tirados).
 */
function MesVacio({
  anio,
  mes,
  estado,
  grande = false,
}: {
  anio: number;
  mes: number;
  estado: EstadoDelMes;
  grande?: boolean;
}) {
  const texto = textoDeMesVacio(nombreDeMes(anio, mes, false), estado);
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3',
        grande ? 'min-h-40 flex-1 flex-col justify-center text-center' : 'mb-2',
      )}
    >
      <CalendarOff className={cn('shrink-0 text-off', grande ? 'size-8' : 'size-5')} aria-hidden />
      <p role={estado === 'fallo' ? 'alert' : undefined} className="min-w-0 text-sm text-muted-foreground">
        {texto}
      </p>
    </div>
  );
}

function textoDeMesVacio(nombre: string, estado: EstadoDelMes): string {
  if (estado === 'cargando') return '';
  if (estado === 'fallo') return 'No se pudo cargar';
  return `Sin competiciones cargadas en ${nombre.toLocaleLowerCase('es-ES')}`;
}

/**
 * El feed del móvil: una sola columna con uno o tres meses y, detrás, «lo
 * próximo». Con varios meses, arriba va una rejilla de botones (uno por mes,
 * todos del mismo ancho, con cuántos torneos tiene) que lleva a cada mes, y
 * cada mes lleva su título pegajoso para no perderse en el feed continuo.
 */
export function FeedMovil({
  meses,
  bloques,
  pie,
  estadoDelMes,
  ...comun
}: {
  /** Los meses que se están mirando, en orden. Uno o tres. */
  meses: { anio: number; mes: number }[];
  bloques: Bloque[];
  /** Lo que va detrás del calendario: «lo próximo, fuera de este mes». */
  pie?: React.ReactNode;
  /** Si lo ya celebrado de cada mes (`AAAA-MM`) está aún en camino. */
  estadoDelMes?: (mes: string) => EstadoDelMes;
} & Comun) {
  const porMes = React.useMemo(
    () => meses.map((m) => ({ ...m, items: itemsDelMes(bloques, m.anio, m.mes) })),
    [meses, bloques],
  );

  const idBase = React.useId();
  const ancla = (m: { anio: number; mes: number }) => `${idBase}-${m.anio}-${m.mes}`.replace(/:/g, '');
  const estadoDe = (m: { anio: number; mes: number }): EstadoDelMes =>
    estadoDelMes?.(claveMes(m.anio, m.mes)) ?? 'listo';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {porMes.length > 1 ? (
        <nav aria-label="Ir a un mes" className="mb-2 grid shrink-0 grid-cols-3 gap-2">
          {porMes.map((m) => {
            const torneos = m.items.reduce(
              (n, i) => n + (i.tipo === 'bloque' ? i.bloque.eventos.length : 0),
              0,
            );
            return (
              <button
                key={`${m.anio}-${m.mes}`}
                type="button"
                onClick={() => {
                  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                  document
                    .getElementById(ancla(m))
                    ?.scrollIntoView({ behavior: sinMovimiento ? 'auto' : 'smooth', block: 'start' });
                }}
                className={cn(
                  'pulsable flex h-11 min-w-0 items-center justify-center gap-2 rounded-full border px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                  torneos === 0 ? 'border-border text-muted-foreground' : 'border-input bg-card text-foreground',
                )}
                aria-label={`Ir a ${nombreDeMes(m.anio, m.mes).toLocaleLowerCase('es-ES')}, ${
                  torneos === 0
                    ? 'sin competiciones cargadas'
                    : `${torneos} ${torneos === 1 ? 'torneo' : 'torneos'}`
                }`}
              >
                <span aria-hidden>{nombreDeMes(m.anio, m.mes, false).slice(0, 3)}</span>
                {torneos > 0 ? (
                  <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
                    {torneos}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {porMes.map((m) => (
          <section key={`${m.anio}-${m.mes}`} id={ancla(m)} className="scroll-mt-1">
            {/* Fondo sólido, sin alfa ni desenfoque: va por encima de las tarjetas al desplazarse. */}
            <h2
              className={cn(
                'sticky top-0 z-10 mb-2 border-b border-border bg-background py-2 text-xl font-semibold',
                // Con un solo mes, el título del periodo ya lo dice en la cabecera.
                porMes.length === 1 && 'sr-only',
              )}
            >
              {nombreDeMes(m.anio, m.mes)}
            </h2>

            {m.items.length === 0 ? (
              <MesVacio anio={m.anio} mes={m.mes} estado={estadoDe(m)} />
            ) : (
              <>
                <ul className="flex min-w-0 flex-col border-t border-border">
                  {m.items.map((item) => (
                    <ItemDeLista key={claveDeItem(item)} item={item} {...comun} />
                  ))}
                </ul>
                <AvisoPasado estado={estadoDe(m)} />
              </>
            )}
          </section>
        ))}

        {pie ? <div className="pt-2">{pie}</div> : null}
      </div>
    </div>
  );
}
