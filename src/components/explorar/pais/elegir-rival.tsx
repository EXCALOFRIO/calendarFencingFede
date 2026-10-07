'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChipFiltro, FilaChips, clasesChip } from '@/components/sistema/chip-filtro';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { cn } from '@/lib/utils';

export type OpcionRival = {
  codigo: string;
  nombre: string;
  href: string;
  /** «1.738–3.420»: victorias y derrotas en individual, o encuentros si sólo hay equipos. */
  balance: string;
  /** La bandera, pintada en el servidor. */
  bandera: React.ReactNode;
};

const EN_FILA = 8;

/**
 * Selector del rival desde la ficha del país: los que más se han cruzado en
 * una fila de chips y todos en una hoja. Cada opción es un enlace al cara a
 * cara con los filtros que ya había en la ficha.
 */
export function ElegirRival({ opciones }: { opciones: readonly OpcionRival[] }) {
  const [abierta, setAbierta] = useState(false);
  if (opciones.length === 0) return null;
  return (
    <FilaChips etiqueta="Rivales">
      {opciones.slice(0, EN_FILA).map((o) => (
        <Link key={o.codigo} href={o.href} prefetch={false} className={clasesChip(false)}>
          {o.bandera}
          <span>{o.codigo}</span>
        </Link>
      ))}
      {opciones.length > EN_FILA ? (
        <HojaInferior
          abierta={abierta}
          alCambiar={setAbierta}
          titulo="Rivales"
          disparador={<ChipFiltro tipo="menu">Todos</ChipFiltro>}
        >
          <ul className="-mx-[16px] flex flex-col">
            {opciones.map((o) => (
              <li key={o.codigo}>
                <Link
                  href={o.href}
                  prefetch={false}
                  onClick={() => setAbierta(false)}
                  className={cn(
                    'flex min-h-[48px] items-center gap-[12px] px-[16px] text-[14px] leading-[20px] outline-none',
                    'hover:bg-accent focus-visible:bg-accent',
                  )}
                >
                  {o.bandera}
                  <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                  <span className="shrink-0 text-[12px] leading-[16px] text-muted-foreground tabular-nums">{o.balance}</span>
                </Link>
              </li>
            ))}
          </ul>
        </HojaInferior>
      ) : null}
    </FilaChips>
  );
}
