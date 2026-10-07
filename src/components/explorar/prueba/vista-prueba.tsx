'use client';

import { ChevronDown, GitFork, Grid3x3, ListOrdered, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FilaClasificacion } from '@/lib/sport/explorar/edicion-modelo';
import { construirUrlEdicion, type VistaPrueba as Vista } from '@/lib/sport/explorar/edicion-url';
import type { AsaltosDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';
import { CuadroDePrueba, PoulesDePrueba } from '../asaltos-prueba';
import { ListaClasificacion } from './clasificacion';
import { enlaceFichaDePrueba, type BasePrueba } from './enlaces';
import {
  hayFiltro,
  inicioParaRonda,
  inicioPorDefecto,
  resaltado,
  separarRondas,
  ultimaRondaResaltada,
  vistaInicial,
  type Disponibles,
  type Filtro,
} from './logica';

// `corta` es el rótulo del móvil: «Clasificación» no cabe en un tercio de 320 px.
const VISTAS: { valor: Vista; etiqueta: string; corta?: string; icono: typeof ListOrdered }[] = [
  { valor: 'clasificacion', etiqueta: 'Clasificación', corta: 'Clasif.', icono: ListOrdered },
  { valor: 'poules', etiqueta: 'Poules', icono: Grid3x3 },
  { valor: 'directas', etiqueta: 'Directas', icono: GitFork },
];

const COLUMNAS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

function inicioDeFiltro(asaltos: AsaltosDePrueba | null, filtro: Filtro, actual: number): number {
  if (!asaltos) return actual;
  const i = ultimaRondaResaltada(separarRondas(asaltos.cuadro).principales, filtro);
  return i < 0 ? actual : inicioParaRonda(i);
}

/** Lleva la vista hasta el resaltado número `salto` (en orden del documento), si se ve. */
function irAResaltado(panel: HTMLElement | null, salto: number) {
  if (!panel) return;
  const visibles = [...panel.querySelectorAll<HTMLElement>('[data-resaltado="true"]')].filter(
    (el) => el.getClientRects().length > 0,
  );
  if (visibles.length === 0) return;
  const destino = visibles[salto % visibles.length];
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  destino.scrollIntoView({ block: 'center', behavior: quieto ? 'auto' : 'smooth' });
}

/**
 * Clasificación, poules y directas de una prueba con un buscador que baja hasta
 * el tirador y lo resalta en la vista abierta. La vista elegida se escribe en
 * la dirección (sin recargar) para que volver de una ficha la conserve.
 */
export function VistaPrueba({
  edicionId,
  base,
  persona,
  vista: pedida,
  clasificacion,
  asaltos: crudo,
  pieClasificacion,
  avisoAsaltos,
}: {
  edicionId: string;
  base: BasePrueba;
  /** Persona de la dirección: se resalta mientras no se escriba nada. */
  persona?: string;
  vista?: Vista;
  clasificacion: FilaClasificacion[];
  asaltos: AsaltosDePrueba | null | 'error';
  /** Paginación y avisos de la clasificación, pintados en el servidor. */
  pieClasificacion?: React.ReactNode;
  /** Aviso bajo poules y directas (asaltos truncados, por ejemplo). */
  avisoAsaltos?: React.ReactNode;
}) {
  const asaltos = crudo === 'error' ? null : crudo;
  const disponibles: Disponibles = {
    clasificacion: clasificacion.length > 0,
    poules: (asaltos?.poules.length ?? 0) > 0,
    directas: (asaltos?.cuadro.length ?? 0) > 0,
  };
  const [vista, setVista] = useState<Vista>(() => vistaInicial(pedida, disponibles));
  const [consulta, setConsulta] = useState('');
  const [salto, setSalto] = useState(0);
  const filtro: Filtro = useMemo(() => ({ consulta, persona }), [consulta, persona]);
  const [inicio, setInicio] = useState(() =>
    inicioDeFiltro(asaltos, { consulta: '', persona }, inicioPorDefecto(separarRondas(asaltos?.cuadro ?? []).principales)),
  );
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const enlace = useMemo(() => enlaceFichaDePrueba(edicionId, base, vista), [edicionId, base, vista]);

  const coincidencias = useMemo(() => {
    if (!hayFiltro(filtro)) return 0;
    if (vista === 'clasificacion') return clasificacion.filter((f) => resaltado(f, filtro)).length;
    if (vista === 'poules') return (asaltos?.poules ?? []).filter((p) => p.filas.some((f) => resaltado(f, filtro))).length;
    return (asaltos?.cuadro ?? []).reduce(
      (n, r) => n + r.asaltos.filter((a) => resaltado(a.a, filtro) || resaltado(a.b, filtro)).length,
      0,
    );
  }, [filtro, vista, clasificacion, asaltos]);

  // Sólo al cambiar lo buscado, la vista o el salto: mover las rondas con las
  // flechas no debe arrastrar la página hasta el resaltado.
  useEffect(() => {
    if (hayFiltro({ consulta, persona })) irAResaltado(panel.current, salto);
  }, [consulta, persona, vista, salto]);

  function cambiarVista(v: Vista) {
    if (!disponibles[v] || v === vista) return;
    setVista(v);
    setSalto(0);
    if (v === 'directas') setInicio((i) => inicioDeFiltro(asaltos, filtro, i));
    window.history.replaceState(null, '', construirUrlEdicion(edicionId, { ...base, vista: v, persona }));
  }

  function buscar(texto: string) {
    setConsulta(texto);
    setSalto(0);
    if (vista === 'directas') setInicio((i) => inicioDeFiltro(asaltos, { consulta: texto, persona }, i));
  }

  const panelId = `${id}-panel`;
  // Una vista sin datos no se ofrece: deshabilitada se leía como un fallo y no
  // llegaba al contraste mínimo. La elegida se queda aunque esté vacía.
  const ofrecidas = VISTAS.filter(({ valor }) => disponibles[valor] || valor === vista);
  const conPestanas = ofrecidas.length > 1;
  return (
    <section aria-label="Resultados de la prueba" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        {conPestanas ? (
          <div
            // Botones con `aria-current` y no pestañas ARIA: sin flechas ni `tabpanel`, `role="tab"` prometía un teclado que no hay.
            role="group"
            aria-label="Vista"
            className={cn('grid shrink-0 gap-0.5 rounded-full border bg-card p-0.5 sm:w-auto', COLUMNAS[ofrecidas.length])}
          >
            {ofrecidas.map(({ valor, etiqueta, corta, icono: Icono }) => {
              const activa = valor === vista;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-current={activa ? 'true' : undefined}
                  aria-controls={panelId}
                  onClick={() => cambiarVista(valor)}
                  className={cn(
                    'inline-flex h-[32px] min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
                    AREA_TACTIL,
                    activa
                      ? 'bg-foreground font-semibold text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icono aria-hidden className={cn('hidden size-4 shrink-0 sm:block', valor === 'directas' && 'rotate-90')} />
                  {corta ? (
                    <>
                      <span aria-hidden className="sm:hidden">{corta}</span>
                      <span className="truncate max-sm:sr-only">{etiqueta}</span>
                    </>
                  ) : (
                    <span className="truncate">{etiqueta}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        <form
          role="search"
          className="relative min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSalto((s) => s + 1);
          }}
        >
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={consulta}
            onChange={(e) => buscar(e.target.value)}
            placeholder="Buscar tirador"
            aria-label="Buscar un tirador en esta vista"
            enterKeyHint="search"
            autoComplete="off"
            className="h-[40px] w-full min-w-0 rounded-full border border-borde-campo bg-card pr-24 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
          />
          {consulta ? (
            <div className="absolute inset-y-0 right-0 flex items-center">
              <span aria-hidden className={cn('cifra px-1 text-sm', coincidencias === 0 ? 'text-muted-foreground' : 'text-foreground')}>
                {coincidencias}
              </span>
              {coincidencias > 1 ? (
                <button
                  type="submit"
                  aria-label="Siguiente coincidencia"
                  className="inline-flex size-[40px] items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => buscar('')}
                aria-label="Borrar la búsqueda"
                className="inline-flex size-[40px] items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : null}
          <span aria-live="polite" className="sr-only">
            {consulta.trim() ? `${coincidencias} ${coincidencias === 1 ? 'coincidencia' : 'coincidencias'}` : ''}
          </span>
        </form>
      </div>

      <div ref={panel} id={panelId} className="flex min-w-0 flex-col gap-3">
        {/* Entre el h1 de la edición y los h3 de cada poule; a la vista lo dicen los botones de arriba. */}
        <h2 className="sr-only">{VISTAS.find((v) => v.valor === vista)?.etiqueta}</h2>
        {vista === 'clasificacion' ? (
          <>
            <ListaClasificacion filas={clasificacion} enlace={enlace} filtro={filtro} />
            {pieClasificacion}
          </>
        ) : vista === 'poules' ? (
          <>
            <PoulesDePrueba poules={asaltos?.poules ?? []} enlace={enlace} filtro={filtro} />
            {avisoAsaltos}
          </>
        ) : (
          <>
            <CuadroDePrueba cuadro={asaltos?.cuadro ?? []} enlace={enlace} filtro={filtro} inicio={inicio} onInicio={setInicio} />
            {avisoAsaltos}
          </>
        )}
      </div>
    </section>
  );
}
