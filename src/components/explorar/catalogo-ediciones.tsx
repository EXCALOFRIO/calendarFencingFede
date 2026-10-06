import Link from 'next/link';
import { Search, SearchX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FUENTES_CATALOGO, urlCatalogo, type CriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import type { VistaCatalogo } from '@/lib/sport/explorar/catalogo';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/edicion-url';
import type { VistaSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { EstadoSeries, FilaEdicion, ListaSeries } from './ediciones';
import { SelectorFuenteCatalogo } from './selector-fuente-catalogo';

/** Pantalla de `/explorar/ediciones`: catálogo y series. Volver es la flecha de la cabecera. */
export function PantallaEdiciones({
  catalogo,
  criterios,
  cursor,
  series,
}: {
  catalogo: VistaCatalogo;
  criterios: CriteriosCatalogo;
  cursor?: string;
  series: VistaSeries;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4">
      <h1 className="text-3xl leading-tight sm:text-4xl">Ediciones</h1>
      <CatalogoEdiciones vista={catalogo} criterios={criterios} cursor={cursor} />
      <section aria-labelledby="titulo-series" className="flex flex-col gap-3 pt-4">
        <h2 id="titulo-series" className="text-2xl">Series</h2>
        {series.tipo === 'ok' ? (
          <ListaSeries series={series.series} />
        ) : series.tipo === 'sin_sesion' ? null : (
          <EstadoSeries vista={series} />
        )}
      </section>
    </div>
  );
}

const CAMPO =
  'h-10 min-w-0 rounded-full border border-input bg-card px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';

/**
 * Catálogo de ediciones: buscador de una fila (nombre o ciudad, fuente y
 * temporada) y una lista de filas de una línea, con «Ver más» para seguir.
 */
export function CatalogoEdiciones({
  vista, criterios, cursor,
}: { vista: VistaCatalogo; criterios: CriteriosCatalogo; cursor?: string }) {
  const filtrado = Boolean(criterios.q || criterios.fuente || criterios.temporada || cursor);
  const fuenteConocida = !criterios.fuente || FUENTES_CATALOGO.some((f) => f.valor === criterios.fuente);
  return (
    <section id="catalogo-ediciones" aria-labelledby="titulo-catalogo" className="flex min-w-0 flex-col gap-3">
      <h2 id="titulo-catalogo" className="sr-only">Todas las ediciones</h2>
      <form method="get" action={RUTA_EDICIONES} role="search" aria-label="Buscar ediciones" className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor="catalogo-q" className="sr-only">Nombre o ciudad</label>
        <div className="relative min-w-0 flex-[1_1_14rem]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id="catalogo-q" name="q" type="search" maxLength={100} defaultValue={criterios.q} placeholder="Nombre o ciudad" className={`${CAMPO} w-full pl-9`} />
        </div>
        <label htmlFor="catalogo-fuente" className="sr-only">Fuente</label>
        <SelectorFuenteCatalogo
          id="catalogo-fuente"
          valorInicial={criterios.fuente}
          fuentes={FUENTES_CATALOGO}
          desconocida={fuenteConocida ? null : criterios.fuente}
        />
        <label htmlFor="catalogo-temporada" className="sr-only">Temporada</label>
        <input id="catalogo-temporada" name="temporada" maxLength={9} defaultValue={criterios.temporada}
          placeholder="Temporada" inputMode="numeric" className={`${CAMPO} w-28`} />
        <Button type="submit" size="icon" aria-label="Buscar" className="size-10 rounded-full">
          <Search aria-hidden className="size-4" />
        </Button>
        {filtrado ? (
          <Button asChild variant="ghost" size="icon" className="size-10 rounded-full text-muted-foreground">
            <Link href={RUTA_EDICIONES} prefetch={false} aria-label="Quitar filtros" title="Quitar filtros">
              <X aria-hidden className="size-4" />
            </Link>
          </Button>
        ) : null}
      </form>
      {vista.estado === 'ok' ? (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            <span className="cifra text-base text-foreground">{vista.total.toLocaleString('es-ES')}</span>{' '}
            {vista.total === 1 ? 'edición' : 'ediciones'}
          </p>
          {vista.ediciones.length ? (
            <ul aria-label="Catálogo de ediciones" className="divide-y border-y">
              {vista.ediciones.map((e) => <FilaEdicion key={e.id} e={e} catalogo={urlCatalogo(criterios, cursor)} />)}
            </ul>
          ) : (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <SearchX aria-hidden className="size-5" />
              {cursor ? 'No hay más ediciones.' : 'No hay ediciones importadas con estos filtros.'}
            </p>
          )}
          {cursor || vista.siguiente ? (
            <nav aria-label="Páginas del catálogo" className="flex flex-wrap items-center justify-center gap-2">
              {cursor ? (
                <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground">
                  <Link href={urlCatalogo(criterios)} prefetch={false} scroll={false}>Inicio de la búsqueda</Link>
                </Button>
              ) : null}
              {vista.siguiente ? (
                <Button asChild variant="outline" size="sm" className="rounded-full px-5">
                  <Link href={urlCatalogo(criterios, vista.siguiente)} prefetch={false} scroll={false} rel="next">Ver más</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <p role="alert" className="py-4 text-sm">
          {vista.estado === 'entrada_invalida' ? 'Revisa la búsqueda.'
            : vista.estado === 'cursor_invalido' ? 'Esa página ya no vale. Vuelve a buscar.'
              : vista.estado === 'no_disponible' ? 'El catálogo aún no está listo.'
                : 'No se ha podido leer el catálogo.'}
        </p>
      )}
    </section>
  );
}
