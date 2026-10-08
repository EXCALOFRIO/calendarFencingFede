'use client';

import { Search, Swords } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { construirUrlCaraACara, rutaCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import {
  crearSolicitanteSugerencias,
  siguienteOpcion,
  type EstadoSugerencias,
} from '@/lib/sport/explorar/sugerencias-cliente';
import type { SugerenciaConResumen } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { WEAPON_LABEL } from '@/lib/utils';
import { AvatarAnillo } from '../avatar-anillo';

export type RivalRapido = {
  id: string;
  nombre: string;
  pais: string | null;
  asaltos: number;
  victorias: number;
  derrotas: number;
};

/**
 * Comparar con cualquier persona: búsqueda en vivo (las mismas sugerencias
 * del buscador de Explorar) y atajos a los rivales más habituales. Sin
 * JavaScript, el formulario abre la búsqueda de rival del cara a cara.
 */
export function CompararPerfil({
  personaId,
  nombre,
  rapidos,
  inicial,
  encabezado: Encabezado = 'h3',
}: {
  personaId: string;
  nombre: string;
  encabezado?: 'h2' | 'h3';
  rapidos: readonly RivalRapido[];
  /** Estado de arranque (texto y sugerencias ya cargadas); sólo para pintar la lista abierta sin red. */
  inicial?: { texto: string; items: SugerenciaConResumen[] };
}) {
  const id = React.useId();
  const listaId = `${id}-lista`;
  const [texto, setTexto] = React.useState(inicial?.texto ?? '');
  const [estado, setEstado] = React.useState<EstadoSugerencias>(
    inicial ? { estado: 'ok', items: inicial.items } : { estado: 'reposo', items: [] },
  );
  const [activa, setActiva] = React.useState(-1);
  const [abierta, setAbierta] = React.useState(Boolean(inicial));
  const solicitante = React.useRef<ReturnType<typeof crearSolicitanteSugerencias> | null>(null);

  React.useEffect(() => {
    const s = crearSolicitanteSugerencias((e) => {
      setEstado(e);
      setActiva(-1);
    }, fetch, { limite: 6 });
    solicitante.current = s;
    return () => s.cancelar();
  }, []);

  const items = estado.items.filter((s) => s.id !== personaId);
  const mostrar = abierta && texto.trim().length > 0 && estado.estado !== 'reposo';
  // Sin useRouter: la ficha también se pinta fuera del App Router (pruebas, HTML estático).
  const ir = (i: number) => document.getElementById(`${listaId}-${i}`)?.querySelector('a')?.click();
  const quien = nombreVisible(nombre) || nombre;

  return (
    <section aria-labelledby={`${id}-titulo`} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 sm:p-5">
      <Encabezado id={`${id}-titulo`} className="flex items-center gap-2 text-lg leading-tight">
        <Swords className="size-5 shrink-0" aria-hidden />
        Comparar
      </Encabezado>

      <form
        action={rutaCaraACara(personaId)}
        method="get"
        role="search"
        className="relative min-w-0"
        onSubmit={(e) => {
          const elegida = activa >= 0 ? activa : items.length === 1 ? 0 : -1;
          if (mostrar && elegida >= 0) {
            e.preventDefault();
            ir(elegida);
          }
        }}
      >
        <label htmlFor={`${id}-q`} className="sr-only">Buscar a otra persona para compararla con {quien}</label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={`${id}-q`}
          name="q"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Busca un nombre"
          value={texto}
          role="combobox"
          aria-expanded={mostrar}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={mostrar && activa >= 0 ? `${listaId}-${activa}` : undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierta(true);
            solicitante.current?.buscar(e.target.value);
          }}
          onFocus={() => setAbierta(true)}
          onBlur={() => setTimeout(() => setAbierta(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setAbierta(true);
              setActiva((a) => siguienteOpcion(e.key, a, items.length));
            } else if (e.key === 'Escape') {
              setAbierta(false);
            }
          }}
          className="h-[40px] w-full min-w-0 rounded-md border bg-background pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
        />
        {mostrar ? (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
            {estado.estado === 'cargando' ? (
              <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Buscando…</p>
            ) : estado.estado === 'error' ? (
              <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
                No se ha podido buscar ahora. Pulsa Intro para buscar en el cara a cara.
              </p>
            ) : items.length === 0 ? (
              <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Nadie con ese nombre en los datos importados.</p>
            ) : (
              <ul id={listaId} role="listbox" aria-label="Personas encontradas" className="max-h-80 overflow-y-auto py-1">
                {items.map((s, i) => (
                  <li
                    key={s.id}
                    id={`${listaId}-${i}`}
                    role="option"
                    aria-selected={i === activa}
                    onMouseDown={(e) => e.preventDefault()}
                    className={i === activa ? 'bg-accent' : 'hover:bg-accent'}
                  >
                    <Link
                      href={construirUrlCaraACara(personaId, { rival: s.id })}
                      prefetch={false}
                      tabIndex={-1}
                      className="flex min-h-[44px] items-center gap-3 px-3 py-2"
                    >
                      <AvatarAnillo nombre={nombreVisible(s.nombre)} tamano="sm" apagado />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{nombreVisible(s.nombre)}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          {s.pais ? <BanderaPais pais={s.pais} /> : null}
                          {s.armas.length > 0 ? <span>{s.armas.map((a) => WEAPON_LABEL[a]).join(', ')}</span> : null}
                          <span>
                            {s.resultados} {s.resultados === 1 ? 'resultado' : 'resultados'}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </form>

      {rapidos.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground">Rivales más habituales</p>
          <ul className="flex min-w-0 flex-wrap gap-2">
            {rapidos.map((r) => (
              <li key={r.id} className="min-w-0 max-w-full">
                <Link
                  href={construirUrlCaraACara(personaId, { rival: r.id })}
                  prefetch={false}
                  className="inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-full border bg-background py-1 pr-4 pl-1 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                >
                  <AvatarAnillo nombre={nombreVisible(r.nombre)} tamano="sm" apagado />
                  <span className="min-w-0 max-w-40 truncate font-medium">{nombreVisible(r.nombre)}</span>
                  <span className="cifra shrink-0 text-sm whitespace-nowrap text-muted-foreground" title={`${r.asaltos} asaltos: ${r.victorias} ganados, ${r.derrotas} perdidos`}>
                    {r.victorias}–{r.derrotas}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
