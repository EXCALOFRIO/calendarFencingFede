'use client';

import { ChevronDown, GitFork, Grid3x3, ListOrdered, Loader2, Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { ahorrarDatos } from '@/components/sistema/red-cliente';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { construirUrlEdicion, type VistaPrueba as Vista } from '@/lib/sport/explorar/edicion-url';
import { cargarVistaDePrueba } from '@/lib/sport/explorar/prueba-acciones';
import { tieneVista, type DatosVistas, type DisponiblesPrueba } from '@/lib/sport/explorar/prueba-datos';
import type { RondaCuadro } from '@/lib/sport/explorar/tipos-busqueda';
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
  type Filtro,
} from './logica';

// `corta` es el rótulo del móvil: «Clasificación» no cabe en un tercio de 320 px.
const VISTAS: { valor: Vista; etiqueta: string; corta?: string; icono: typeof ListOrdered }[] = [
  { valor: 'clasificacion', etiqueta: 'Clasificación', corta: 'Clasif.', icono: ListOrdered },
  { valor: 'poules', etiqueta: 'Poules', icono: Grid3x3 },
  { valor: 'directas', etiqueta: 'Directas', icono: GitFork },
];

const COLUMNAS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

/** Filas de la clasificación que se pintan al abrir y en cada «Ver más». */
export const TRAMO_CLASIFICACION = 100;

function inicioDeFiltro(cuadro: readonly RondaCuadro[], filtro: Filtro, actual: number): number {
  const i = ultimaRondaResaltada(separarRondas(cuadro).principales, filtro);
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

/** Tras la carga de la página y en un rato libre del hilo principal. */
function enRatoLibre(tarea: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let cancelar = () => {};
  const programar = () => {
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(tarea, { timeout: 4000 });
      cancelar = () => w.cancelIdleCallback?.(id);
    } else {
      const id = window.setTimeout(tarea, 1500);
      cancelar = () => window.clearTimeout(id);
    }
  };
  if (document.readyState === 'complete') {
    programar();
    return () => cancelar();
  }
  window.addEventListener('load', programar, { once: true });
  return () => {
    window.removeEventListener('load', programar);
    cancelar();
  };
}

/**
 * Clasificación, poules y directas con un buscador que baja hasta el tirador y
 * lo resalta en la vista abierta. Llega con los datos de una sola vista; las
 * demás se piden al servidor al elegirlas (la vista de antes sigue a la vista,
 * con un indicador en el botón, hasta que llegan) y, con buena red, en un rato
 * libre tras la carga. Lo ya recibido se queda: volver a una vista es inmediato.
 * La vista elegida se escribe en la dirección (sin recargar) para que volver
 * de una ficha la conserve.
 */
export function VistaPruebaCliente({
  edicionId,
  base,
  persona,
  vista: inicial,
  disponibles,
  datos: iniciales,
  pieClasificacion,
  avisoAsaltos,
}: {
  edicionId: string;
  base: BasePrueba;
  persona?: string;
  vista: Vista;
  disponibles: DisponiblesPrueba;
  datos: DatosVistas;
  pieClasificacion?: ReactNode;
  avisoAsaltos?: ReactNode;
}) {
  const [vista, setVista] = useState<Vista>(inicial);
  const [datos, setDatos] = useState<DatosVistas>(iniciales);
  const [esperando, setEsperando] = useState<Vista | null>(null);
  const [elegida, setElegida] = useState<Vista | null>(null);
  const [pintando, startTransition] = useTransition();
  const [consulta, setConsulta] = useState('');
  // Las listas se filtran con la búsqueda diferida: el campo responde a cada tecla.
  const diferida = useDeferredValue(consulta);
  const [salto, setSalto] = useState(0);
  const [inicio, setInicio] = useState<number | null>(null);
  const [limite, setLimite] = useState(TRAMO_CLASIFICACION);
  const filtro: Filtro = useMemo(() => ({ consulta: diferida, persona }), [diferida, persona]);
  const panel = useRef<HTMLDivElement>(null);
  const pedidos = useRef(new Map<Vista, Promise<DatosVistas | null>>());
  const destino = useRef<Vista | null>(null);
  const id = useId();

  const enlace = useMemo(() => enlaceFichaDePrueba(edicionId, base, vista), [edicionId, base, vista]);

  function pedir(v: Vista): Promise<DatosVistas | null> {
    const previo = pedidos.current.get(v);
    if (previo) return previo;
    const pedido = cargarVistaDePrueba({ edicionId, prueba: base.prueba, cursor: base.cursor, vista: v })
      .catch(() => null)
      .then((d) => {
        if (d) setDatos((prev) => ({ ...d, ...prev }));
        else pedidos.current.delete(v);
        return d;
      });
    pedidos.current.set(v, pedido);
    return pedido;
  }

  // Con buena red, las otras vistas se piden en un rato libre; con ahorro de datos o 2G, nunca.
  useEffect(() => {
    if (ahorrarDatos()) return;
    const faltan = VISTAS.map((v) => v.valor).filter((v) => disponibles[v] && !tieneVista(iniciales, v));
    if (faltan.length === 0) return;
    return enRatoLibre(async () => {
      for (const v of faltan) {
        if (ahorrarDatos()) return;
        await pedir(v);
      }
    });
    // Sólo al montar: `key` lo vuelve a montar con otra prueba o página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cuadro = datos.cuadro ?? [];
  const inicioCuadro = inicio ?? inicioDeFiltro(cuadro, { consulta: '', persona }, inicioPorDefecto(separarRondas(cuadro).principales));

  const filas = datos.clasificacion;
  const enClasificacion = useMemo(() => {
    if (!filas || !hayFiltro(filtro)) return [];
    const indices: number[] = [];
    filas.forEach((f, i) => {
      if (resaltado(f, filtro)) indices.push(i);
    });
    return indices;
  }, [filas, filtro]);

  const coincidencias = useMemo(() => {
    if (!hayFiltro(filtro)) return 0;
    if (vista === 'clasificacion') return enClasificacion.length;
    if (vista === 'poules') return (datos.poules ?? []).filter((p) => p.filas.some((f) => resaltado(f, filtro))).length;
    return cuadro.reduce((n, r) => n + r.asaltos.filter((a) => resaltado(a.a, filtro) || resaltado(a.b, filtro)).length, 0);
  }, [filtro, vista, enClasificacion, datos.poules, cuadro]);

  // En la clasificación, el resaltado al que se salta tiene que estar pintado aunque pase del tramo.
  const objetivo = vista === 'clasificacion' && enClasificacion.length > 0 ? salto % enClasificacion.length : salto;
  const pintadas = Math.max(limite, vista === 'clasificacion' && enClasificacion.length > 0 ? enClasificacion[objetivo] + 1 : 0);

  // Sólo al cambiar lo buscado, la vista o el salto: mover las rondas con las
  // flechas no debe arrastrar la página hasta el resaltado.
  useEffect(() => {
    if (hayFiltro({ consulta: diferida, persona })) irAResaltado(panel.current, objetivo);
  }, [diferida, persona, vista, objetivo]);

  function mostrar(v: Vista, nuevos?: DatosVistas | null) {
    startTransition(() => {
      if (nuevos) setDatos((prev) => ({ ...nuevos, ...prev }));
      setVista(v);
      setSalto(0);
      if (v === 'directas' && hayFiltro(filtro)) {
        setInicio((i) => inicioDeFiltro(nuevos?.cuadro ?? cuadro, filtro, i ?? inicioCuadro));
      }
    });
    window.history.replaceState(null, '', construirUrlEdicion(edicionId, { ...base, vista: v, persona }));
  }

  async function cambiarVista(v: Vista) {
    if (!disponibles[v]) return;
    destino.current = v;
    setElegida(v);
    if (v === vista) {
      setEsperando(null);
      return;
    }
    if (tieneVista(datos, v)) {
      setEsperando(null);
      mostrar(v);
      return;
    }
    setEsperando(v);
    const nuevos = await pedir(v);
    // Si mientras tanto se eligió otra vista, esta respuesta sólo se guarda.
    if (destino.current !== v) return;
    setEsperando(null);
    if (!nuevos) {
      window.location.assign(construirUrlEdicion(edicionId, { ...base, vista: v, persona }));
      return;
    }
    mostrar(v, nuevos);
  }

  function buscar(texto: string) {
    setConsulta(texto);
    setSalto(0);
    if (vista === 'directas') setInicio((i) => inicioDeFiltro(cuadro, { consulta: texto, persona }, i ?? inicioCuadro));
  }

  const panelId = `${id}-panel`;
  // Una vista sin datos no se ofrece: deshabilitada se leía como un fallo y no
  // llegaba al contraste mínimo. La elegida se queda aunque esté vacía.
  const ofrecidas = VISTAS.filter(({ valor }) => disponibles[valor] || valor === vista);
  const conPestanas = ofrecidas.length > 1;
  const cargandoEn = esperando ?? (pintando ? elegida : null);
  const restantes = (filas?.length ?? 0) - pintadas;
  return (
    <section aria-label="Resultados de la prueba" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        {conPestanas ? (
          <div
            // Botones con `aria-current` y no pestañas ARIA: sin flechas ni `tabpanel`, `role="tab"` prometía un teclado que no hay.
            role="group"
            aria-label="Vista"
            className={cn('grid shrink-0 gap-1 rounded-full border bg-card p-1 sm:w-auto', COLUMNAS[ofrecidas.length])}
          >
            {ofrecidas.map(({ valor, etiqueta, corta, icono: Icono }) => {
              const activa = valor === vista;
              const cargando = cargandoEn === valor && !activa;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-current={activa ? 'true' : undefined}
                  aria-controls={panelId}
                  aria-busy={cargando || undefined}
                  onClick={() => void cambiarVista(valor)}
                  className={cn(
                    'inline-flex h-[32px] min-w-0 items-center justify-center gap-1 rounded-full px-3 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
                    AREA_TACTIL,
                    activa
                      ? 'bg-foreground font-semibold text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {cargando ? (
                    <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <Icono aria-hidden className={cn('hidden size-4 shrink-0 sm:block', valor === 'directas' && 'rotate-90')} />
                  )}
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
            className="h-[40px] w-full min-w-0 rounded-full border border-borde-campo bg-card pr-24 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
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
            {diferida.trim() ? `${coincidencias} ${coincidencias === 1 ? 'coincidencia' : 'coincidencias'}` : ''}
          </span>
        </form>
      </div>

      <div ref={panel} id={panelId} className="flex min-w-0 flex-col gap-3">
        {/* Entre el h1 de la edición y los h3 de cada poule; a la vista lo dicen los botones de arriba. */}
        <h2 className="sr-only">{VISTAS.find((v) => v.valor === vista)?.etiqueta}</h2>
        {vista === 'clasificacion' ? (
          <>
            <ListaClasificacion filas={filas ?? []} enlace={enlace} filtro={filtro} limite={pintadas} />
            {restantes > 0 ? (
              <button
                type="button"
                onClick={() => setLimite(pintadas + TRAMO_CLASIFICACION)}
                className={cn(
                  'inline-flex h-[32px] items-center justify-center self-center rounded-full border border-input bg-card px-5 text-sm transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
                  AREA_TACTIL,
                )}
              >
                Ver más
                <span className="sr-only"> puestos ({restantes} más)</span>
              </button>
            ) : (
              pieClasificacion
            )}
          </>
        ) : vista === 'poules' ? (
          <>
            <PoulesDePrueba poules={datos.poules ?? []} enlace={enlace} filtro={filtro} />
            {avisoAsaltos}
          </>
        ) : (
          <>
            <CuadroDePrueba cuadro={cuadro} enlace={enlace} filtro={filtro} inicio={inicioCuadro} onInicio={setInicio} />
            {avisoAsaltos}
          </>
        )}
      </div>
    </section>
  );
}
