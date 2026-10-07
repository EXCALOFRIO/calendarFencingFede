'use client';

import { LoaderCircle, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import {
  CLAVES_CATALOGO,
  FUENTES_CATALOGO,
  RUTA_EDICIONES,
  hayFiltrosCatalogo,
  urlCatalogo,
  type CriteriosCatalogo,
} from '@/lib/sport/explorar/catalogo-url';
import { categoriaVisible, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import { CATEGORY_LABEL, WEAPON_LABEL, cn } from '@/lib/utils';
import { CAMPO_BUSCAR, ChipAnios, ChipOpciones } from './buscador-filtros';

/** Espera tras la última tecla: el índice responde en milisegundos, lo que cuesta es la ida y vuelta. */
export const ESPERA_COMPETICIONES = 150;

const ARMAS = Object.entries(WEAPON_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const CATEGORIAS = Object.keys(CATEGORY_LABEL)
  .sort((a, b) => ordenCategoriaVisible(a) - ordenCategoriaVisible(b))
  .map((valor) => ({ valor, etiqueta: categoriaVisible(valor) }));

/**
 * Buscador de competiciones: el campo busca mientras se escribe (la URL se
 * reemplaza, así la lista la pinta el servidor desde el índice en memoria) y
 * los chips de organizador, arma, categoría y fechas filtran al tocarlos.
 * Mientras llega la lista nueva se queda la anterior, un poco apagada.
 * `children` es esa lista.
 */
export function BuscadorCompeticiones({
  criterios,
  anioActual,
  children,
}: {
  criterios: CriteriosCatalogo;
  anioActual: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const entrada = React.useRef<HTMLInputElement>(null);
  const [pendiente, empezar] = React.useTransition();
  const [texto, setTexto] = React.useState(criterios.q);
  const temporizador = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const envio = React.useRef<string | null>(null);
  const urlActual = urlCatalogo(criterios);
  const criteriosActuales = React.useRef(criterios);
  React.useEffect(() => { criteriosActuales.current = criterios; }, [criterios]);

  const navegar = React.useCallback((c: CriteriosCatalogo, reemplazar: boolean) => {
    clearTimeout(temporizador.current);
    const url = urlCatalogo(c);
    if (envio.current === url) return;
    envio.current = url;
    empezar(() => {
      if (reemplazar) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    });
  }, [router]);
  React.useEffect(() => {
    // La transición terminada (también si falla) permite volver a intentar.
    if (!pendiente) envio.current = null;
  }, [pendiente, urlActual]);

  // Lo escrito manda mientras el campo tiene el foco; si no, la URL (Atrás, un enlace).
  React.useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === entrada.current) return;
    setTexto(criterios.q);
  }, [criterios.q]);

  React.useEffect(() => {
    const q = texto.replace(/\s+/g, ' ').trim();
    if (q === criterios.q.trim()) return;
    const t = setTimeout(() => navegar({ ...criteriosActuales.current, q }, true), ESPERA_COMPETICIONES);
    temporizador.current = t;
    return () => clearTimeout(t);
  }, [texto, criterios.q, urlActual, navegar]);

  const poner = (parcial: Partial<CriteriosCatalogo>) => navegar({ ...criterios, q: texto.trim(), ...parcial }, false);
  const filtros = hayFiltrosCatalogo(criterios);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form
        method="get"
        action={RUTA_EDICIONES}
        role="search"
        aria-label="Buscar competiciones"
        aria-busy={pendiente}
        className="flex min-w-0 flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navegar({ ...criterios, q: texto.trim() }, false);
          entrada.current?.blur();
        }}
      >
        {CLAVES_CATALOGO.filter((k) => k !== 'q' && criterios[k]).map((k) => (
          <input key={k} type="hidden" name={k} value={criterios[k]} />
        ))}
        <div className="relative w-full lg:max-w-2xl">
          <label htmlFor="catalogo-q" className="sr-only">Buscar competiciones</label>
          {pendiente ? (
            <LoaderCircle aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : (
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
          )}
          <input
            ref={entrada}
            id="catalogo-q"
            name="q"
            type="search"
            value={texto}
            maxLength={100}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Mundial, Copa del Mundo, Turín…"
            className={cn(CAMPO_BUSCAR, 'pr-[40px]')}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && texto) { e.preventDefault(); setTexto(''); }
            }}
          />
          {texto ? (
            <button
              type="button"
              aria-label="Borrar búsqueda"
              className="absolute top-1/2 right-0 flex size-[44px] -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
              onClick={() => { setTexto(''); entrada.current?.focus(); }}
            >
              <X className="size-[18px]" aria-hidden />
            </button>
          ) : null}
        </div>
        <FilaChips etiqueta="Filtros de competiciones">
          <ChipOpciones
            etiqueta="Organizador"
            valor={criterios.fuente}
            opciones={FUENTES_CATALOGO}
            textoTodas="Todos"
            onElegir={(fuente) => poner({ fuente })}
          />
          <ChipOpciones etiqueta="Arma" valor={criterios.arma} opciones={ARMAS} textoTodas="Todas" onElegir={(arma) => poner({ arma })} />
          <ChipOpciones
            etiqueta="Categoría"
            valor={criterios.categoria}
            opciones={CATEGORIAS}
            textoTodas="Todas"
            onElegir={(categoria) => poner({ categoria })}
          />
          <ChipAnios
            valor={{ desde: criterios.desde, hasta: criterios.hasta }}
            anioActual={anioActual}
            onElegir={({ desde, hasta }) => poner({ desde, hasta, temporada: '' })}
          />
          {criterios.temporada ? (
            <ChipFiltro tipo="quitar" onClick={() => poner({ temporada: '' })}>{`Temporada ${criterios.temporada}`}</ChipFiltro>
          ) : null}
          {filtros ? (
            <button
              type="button"
              className="inline-flex h-[32px] shrink-0 items-center px-[4px] text-[13px] font-semibold whitespace-nowrap text-primary-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              onClick={() => navegar({ ...criterios, q: texto.trim(), fuente: '', arma: '', categoria: '', desde: '', hasta: '', temporada: '' }, false)}
            >
              Quitar filtros
            </button>
          ) : null}
        </FilaChips>
      </form>
      <div className={cn('flex min-w-0 flex-col gap-3 transition-opacity duration-150 motion-reduce:transition-none', pendiente && 'opacity-60')}>
        {children}
      </div>
    </div>
  );
}
