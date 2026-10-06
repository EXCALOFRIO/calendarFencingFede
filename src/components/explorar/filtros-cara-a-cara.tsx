'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  construirUrlCaraACara,
  FASE_FILTRO,
  type CriteriosCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-url';
import type { OpcionTemporada } from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';
import { ARMAS, agruparTemporadas } from './formulario-filtros';

type Props = {
  personaId: string;
  criterios: CriteriosCaraACara;
  temporadas: OpcionTemporada[];
};

/**
 * Filtros del cara a cara. Con rival elegido son tres pastillas en una fila
 * que se aplican al elegir; sin rival, el formulario de búsqueda de
 * rival. En los dos casos la URL se escribe con `router.push`: Atrás vuelve a
 * la consulta anterior y cada cambio empieza en la primera página. La página
 * remonta este componente (`key`) cuando cambia la URL.
 */
export function FiltrosCaraACara(props: Props) {
  return props.criterios.rival ? <FiltrosCompactos {...props} /> : <BuscarRival {...props} />;
}

type OpcionPastilla = { valor: string; etiqueta: string };
type GrupoPastilla = { etiqueta?: string; opciones: OpcionPastilla[] };

/**
 * Pastilla de filtro: sin valor dice su nombre; con valor, el elegido,
 * resaltado. Al elegir se cierra y se aplica. El botón mide 44 px de alto
 * (área táctil) y la pastilla visible, 36.
 */
function PastillaFiltro({
  etiqueta,
  todas,
  valor,
  grupos,
  onElegir,
}: {
  etiqueta: string;
  /** Rótulo de la opción que quita el filtro. */
  todas: string;
  valor: string;
  grupos: GrupoPastilla[];
  onElegir: (valor: string) => void;
}) {
  const [abierta, setAbierta] = React.useState(false);
  const elegida = grupos.flatMap((g) => g.opciones).find((o) => o.valor === valor);
  const elegir = (v: string) => {
    setAbierta(false);
    if (v !== valor) onElegir(v);
  };
  return (
    <Popover open={abierta} onOpenChange={setAbierta}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={elegida ? `${etiqueta}: ${elegida.etiqueta}` : etiqueta}
          className="group h-11 min-w-0 px-0 hover:bg-transparent"
        >
          <span
            className={cn(
              'inline-flex h-9 w-full min-w-0 items-center justify-between gap-1.5 rounded-full border bg-card pr-2.5 pl-3.5 text-sm transition-colors group-hover:bg-secondary',
              elegida ? 'border-primary-text/60 font-medium text-foreground' : 'border-filete-alto font-normal text-muted-foreground',
            )}
          >
            <span className="truncate">{elegida?.etiqueta ?? etiqueta}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem value={`__${todas}`} data-marcado={valor === ''} onSelect={() => elegir('')}>
                <Check className={cn('size-4', valor === '' ? 'opacity-100' : 'opacity-0')} aria-hidden />
                {todas}
              </CommandItem>
            </CommandGroup>
            {grupos.map((g, i) => (
              <CommandGroup key={g.etiqueta ?? i} heading={g.etiqueta}>
                {g.opciones.map((o) => (
                  <CommandItem key={o.valor} value={o.valor} data-marcado={o.valor === valor} onSelect={() => elegir(o.valor)}>
                    <Check className={cn('size-4', o.valor === valor ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    {o.etiqueta}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Temporada, arma y fase en una sola fila de pastillas que se aplican al elegir. */
function FiltrosCompactos({ personaId, criterios, temporadas }: Props) {
  const router = useRouter();
  const [pendiente, empezar] = React.useTransition();
  const { sueltas, grupos } = agruparTemporadas(temporadas, criterios.temporada);
  const poner = (parcial: Partial<CriteriosCaraACara>) =>
    empezar(() => router.push(construirUrlCaraACara(personaId, { ...criterios, ...parcial, cursor: '', q: '' })));

  return (
    <div
      role="search"
      aria-label="Filtros del cara a cara"
      aria-busy={pendiente}
      className={cn(
        'grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 transition-opacity sm:flex sm:justify-end',
        pendiente && 'opacity-60',
      )}
    >
      <PastillaFiltro
        etiqueta="Temporada"
        todas="Todas las temporadas"
        valor={criterios.temporada}
        grupos={[...(sueltas.length > 0 ? [{ opciones: sueltas }] : []), ...grupos.filter((g) => g.opciones.length > 0)]}
        onElegir={(temporada) => poner({ temporada })}
      />
      <PastillaFiltro
        etiqueta="Arma"
        todas="Todas las armas"
        valor={criterios.arma}
        grupos={[{ opciones: ARMAS }]}
        onElegir={(arma) => poner({ arma })}
      />
      <PastillaFiltro
        etiqueta="Fase"
        todas="Poule y directa"
        valor={criterios.fase}
        grupos={[{ opciones: FASE_FILTRO.map((f) => ({ valor: f.valor, etiqueta: f.valor === 'TABLEAU' ? 'Directa' : f.etiqueta })) }]}
        onElegir={(fase) => poner({ fase })}
      />
    </div>
  );
}

/**
 * Elección de rival: sólo el nombre. Temporada, arma y fase se eligen ya en
 * el duelo; la búsqueda escribe `q` y empieza en la primera página.
 */
function BuscarRival({ personaId, criterios }: Props) {
  const router = useRouter();
  const [pendiente, empezar] = React.useTransition();
  const [q, setQ] = React.useState(criterios.q);
  const corta = q.trim().length === 1;

  return (
    <form
      role="search"
      aria-label="Buscar rival"
      aria-busy={pendiente}
      className="flex min-w-0 items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (corta) return;
        empezar(() => router.push(construirUrlCaraACara(personaId, { q: q.trim() })));
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Label htmlFor="h2h-q" className="sr-only">
          Nombre del rival
        </Label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="h2h-q"
          type="search"
          value={q}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Rival"
          className="h-11 rounded-full pl-9"
          aria-invalid={corta}
          aria-describedby={corta ? 'h2h-q-ayuda' : undefined}
          onChange={(e) => setQ(e.target.value)}
        />
        {corta ? (
          <p id="h2h-q-ayuda" className="mt-1 px-3 text-xs text-danger">
            Al menos dos letras.
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pendiente} className="h-11 rounded-full px-5">
        {pendiente ? 'Buscando…' : 'Buscar'}
      </Button>
    </form>
  );
}