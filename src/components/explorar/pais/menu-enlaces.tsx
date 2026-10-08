'use client';

import { Check, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ChipFiltro } from '@/components/sistema/chip-filtro';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { FOCO, PULSACION } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';

export type OpcionEnlace = {
  clave: string;
  texto: string;
  href: string;
  marcado: boolean;
  /** Cifra o balance a la derecha («12–8»). */
  detalle?: string;
  /** Bandera u otro icono, pintado en el servidor. */
  icono?: React.ReactNode;
};

/**
 * Un chip que abre una hoja con enlaces (filtro secundario o lista larga):
 * cada opción navega a la misma pantalla con ese valor. El chip lleva el
 * valor elegido y va marcado mientras haya uno.
 */
export function MenuEnlaces({
  titulo,
  rotulo,
  elegido,
  opciones,
  buscar,
  boton = false,
  mantenerScroll = true,
}: {
  /** Título de la hoja («Temporada»). */
  titulo: string;
  /** Texto del chip sin nada elegido. */
  rotulo: string;
  /** Texto del valor elegido; `null` si ninguno. */
  elegido: string | null;
  opciones: readonly OpcionEnlace[];
  /** Con muchas opciones: un campo que filtra por el texto. */
  buscar?: boolean;
  /** Un botón ancho con `rotulo` en vez del chip (la acción principal de una sección). */
  boton?: boolean;
  /** `false` cuando la opción lleva a otra pantalla y no a la misma con otro filtro. */
  mantenerScroll?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [texto, setTexto] = useState('');
  const plegar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibles = buscar && texto.trim()
    ? opciones.filter((o) => plegar(`${o.texto} ${o.clave}`).includes(plegar(texto.trim())))
    : opciones;
  return (
    <HojaInferior
      abierta={abierta}
      alCambiar={(v) => {
        setAbierta(v);
        if (!v) setTexto('');
      }}
      titulo={titulo}
      disparador={boton ? (
        <button
          type="button"
          aria-haspopup="dialog"
          className={cn(
            'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold text-foreground hover:bg-accent',
            FOCO,
            PULSACION,
          )}
        >
          <Search aria-hidden className="size-4" />
          {rotulo}
        </button>
      ) : <ChipFiltro tipo="menu" marcado={elegido !== null}>{elegido ?? rotulo}</ChipFiltro>}
    >
      {buscar ? (
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar"
          aria-label={`Buscar en ${titulo.toLowerCase()}`}
          className="mb-3 h-11 w-full rounded-xl bg-secondary px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : null}
      <ul className="-mx-4 flex flex-col">
        {visibles.map((o) => (
          <li key={o.clave}>
            <Link
              href={o.href}
              prefetch={false}
              scroll={mantenerScroll ? false : undefined}
              aria-current={o.marcado ? 'true' : undefined}
              onClick={() => setAbierta(false)}
              className={cn(
                'flex min-h-12 items-center gap-3 px-4 text-sm outline-none',
                'hover:bg-accent focus-visible:bg-accent',
                o.marcado && 'font-semibold',
              )}
            >
              {o.icono}
              <span className="min-w-0 flex-1 truncate">{o.texto}</span>
              {o.detalle ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{o.detalle}</span> : null}
              {o.marcado ? <Check aria-hidden className="size-4 shrink-0" /> : null}
            </Link>
          </li>
        ))}
      </ul>
      {visibles.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Sin resultados</p> : null}
    </HojaInferior>
  );
}
