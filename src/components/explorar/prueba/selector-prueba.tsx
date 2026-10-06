'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type OpcionFormato = { valor: string; etiqueta: string; href: string; activa: boolean };
export type OpcionDePrueba = { id: string; href: string; activa: boolean; etiqueta: string; variante?: string };
/** Pruebas de un arma y un género, una por categoría (y día o grupo, si se repite). */
export type GrupoDePruebas = { clave: string; titulo: string; opciones: OpcionDePrueba[] };
export type PruebaActual = { titulo: string; categoria: string; variante?: string };

const PASTILLA =
  'inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none';
const MARCADA = 'bg-marcado font-semibold text-primary-text ring-1 ring-primary-text ring-inset';
const LIBRE = 'text-muted-foreground hover:bg-accent hover:text-foreground';

/**
 * Selector de prueba en una sola fila: individual o equipos y una pastilla con
 * la prueba elegida que abre la lista de las demás, agrupadas por arma y
 * género. Cada opción es un enlace: sin JavaScript, la página elegida es la de
 * la dirección.
 */
export function SelectorPrueba({
  formatos,
  actual,
  grupos,
}: {
  formatos: OpcionFormato[];
  actual: PruebaActual;
  grupos: GrupoDePruebas[];
}) {
  const [abierto, setAbierto] = useState(false);
  const opciones = grupos.reduce((n, g) => n + g.opciones.length, 0);
  const contenido = (
    <>
      <span className="truncate font-semibold text-foreground">{actual.titulo}</span>
      <span className="truncate text-muted-foreground">{actual.categoria}</span>
      {actual.variante ? <span className="truncate text-muted-foreground">{actual.variante}</span> : null}
    </>
  );
  return (
    <nav aria-label="Elegir prueba" className="flex min-w-0 flex-wrap items-center gap-2">
      {formatos.length > 1 ? (
        <div role="group" aria-label="Formato" className="flex shrink-0 gap-0.5 rounded-full border bg-card p-0.5">
          {formatos.map((f) => (
            <Link
              key={f.valor}
              href={f.href}
              prefetch={false}
              aria-current={f.activa ? 'true' : undefined}
              className={cn(PASTILLA, 'px-3', f.activa ? MARCADA : LIBRE)}
            >
              {f.etiqueta}
            </Link>
          ))}
        </div>
      ) : null}
      {opciones > 1 ? (
        <Popover open={abierto} onOpenChange={setAbierto}>
          <PopoverTrigger
            aria-label={`Prueba: ${actual.titulo} ${actual.categoria}. Cambiar de prueba`}
            className={cn(PASTILLA, 'max-w-full border bg-card hover:bg-accent')}
          >
            {contenido}
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto p-3">
            {grupos.map((g) => (
              <section key={g.clave} aria-label={g.titulo} className="flex flex-col gap-1.5">
                <h3 className="text-xs text-muted-foreground">{g.titulo}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {g.opciones.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={o.href}
                        prefetch={false}
                        onClick={() => setAbierto(false)}
                        aria-current={o.activa ? 'true' : undefined}
                        className={cn(PASTILLA, 'border', o.activa ? MARCADA : LIBRE)}
                      >
                        {o.etiqueta}
                        {o.variante ? <span className="text-xs text-muted-foreground">{o.variante}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </PopoverContent>
        </Popover>
      ) : (
        <p className={cn(PASTILLA, 'max-w-full border bg-card')}>{contenido}</p>
      )}
    </nav>
  );
}
