import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hayFiltrosCatalogo, urlCatalogo, type CriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import type { VistaCatalogo } from '@/lib/sport/explorar/catalogo';
import type { VistaSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { BuscadorCompeticiones } from './buscador-competiciones';
import { EstadoSeries, FilaEdicion, ListaSeries } from './ediciones';
import { CabeceraExplorar } from './cabecera-explorar';

/**
 * Pantalla de `/explorar/ediciones` (pestaña Competiciones de Buscar): el
 * buscador y la lista y, sin búsqueda ni filtros, las series. Volver es la
 * flecha de la cabecera.
 */
export function PantallaEdiciones({
  catalogo,
  criterios,
  cursor,
  series,
  anioActual = new Date().getUTCFullYear(),
}: {
  catalogo: VistaCatalogo;
  criterios: CriteriosCatalogo;
  cursor?: string;
  series: VistaSeries;
  anioActual?: number;
}) {
  const buscando = Boolean(criterios.q || hayFiltrosCatalogo(criterios) || cursor);
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 lg:mx-auto lg:max-w-2xl">
      <CabeceraExplorar activa="competiciones" />
      <CatalogoEdiciones vista={catalogo} criterios={criterios} cursor={cursor} anioActual={anioActual} />
      {buscando ? null : (
        <section aria-labelledby="titulo-series" className="flex flex-col gap-3 pt-4">
          <h2 id="titulo-series" className="text-2xl">Series</h2>
          {series.tipo === 'ok' ? (
            <ListaSeries series={series.series} />
          ) : series.tipo === 'sin_sesion' ? null : (
            <EstadoSeries vista={series} />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Catálogo de ediciones: el buscador (texto, organizador, arma, categoría y
 * fechas) y una lista de filas de una línea, de la más reciente a la más
 * antigua, con «Ver más» para seguir.
 */
export function CatalogoEdiciones({
  vista, criterios, cursor, anioActual = new Date().getUTCFullYear(),
}: { vista: VistaCatalogo; criterios: CriteriosCatalogo; cursor?: string; anioActual?: number }) {
  return (
    <section id="catalogo-ediciones" aria-labelledby="titulo-catalogo" className="flex min-w-0 flex-col gap-3">
      <h2 id="titulo-catalogo" className="sr-only">Competiciones</h2>
      <BuscadorCompeticiones criterios={criterios} anioActual={anioActual}>
        {vista.estado === 'ok' ? (
          <>
            <p role="status" className="text-[12px] text-muted-foreground">
              <span className="cifra text-base text-foreground">{vista.total.toLocaleString('es-ES')}</span>{' '}
              {vista.total === 1 ? 'edición' : 'ediciones'}
            </p>
            {vista.ediciones.length ? (
              <ul aria-label="Competiciones" className="divide-y border-y">
                {vista.ediciones.map((e) => <FilaEdicion key={e.id} e={e} catalogo={urlCatalogo(criterios, cursor)} />)}
              </ul>
            ) : (
              <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <SearchX aria-hidden className="size-5" />
                {cursor ? 'No hay más ediciones.' : 'Sin ediciones con estos filtros.'}
              </p>
            )}
            {cursor || vista.siguiente ? (
              <nav aria-label="Páginas del catálogo" className="flex flex-wrap items-center justify-center gap-2">
                {cursor ? (
                  <Button asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground">
                    <Link href={urlCatalogo(criterios)} prefetch={false} scroll={false}>Primeras</Link>
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
      </BuscadorCompeticiones>
    </section>
  );
}
