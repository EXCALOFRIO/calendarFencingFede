import Link from 'next/link';
import { ArrowRight, Search, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FUENTES_CATALOGO, urlCatalogo, type CriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import type { VistaCatalogo } from '@/lib/sport/explorar/catalogo';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/edicion-url';
import { FilaEdicion } from './ediciones';
import { SelectorFuenteCatalogo } from './selector-fuente-catalogo';

export function CatalogoEdiciones({
  vista, criterios, cursor,
}: { vista: VistaCatalogo; criterios: CriteriosCatalogo; cursor?: string }) {
  const filtrado = Boolean(criterios.q || criterios.fuente || criterios.temporada || cursor);
  const fuenteConocida = !criterios.fuente || FUENTES_CATALOGO.some((f) => f.valor === criterios.fuente);
  return (
    <section id="catalogo-ediciones" aria-labelledby="titulo-catalogo" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 id="titulo-catalogo" className="text-2xl leading-tight sm:text-3xl">Todas las ediciones importadas</h2>
        <p className="medida text-sm text-muted-foreground">
          Busca por nombre o ciudad. También aparecen las ediciones sin vínculos al calendario o a una persona.
        </p>
      </header>
      <form method="get" action={RUTA_EDICIONES} role="search" aria-label="Buscar ediciones" className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="catalogo-q">Nombre o ciudad</Label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="catalogo-q" name="q" type="search" maxLength={100} defaultValue={criterios.q} placeholder="Nombre de la competición o ciudad" className="min-h-11 bg-secondary pl-9" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="catalogo-fuente">Fuente</Label>
          <SelectorFuenteCatalogo
            id="catalogo-fuente"
            valorInicial={criterios.fuente}
            fuentes={FUENTES_CATALOGO}
            desconocida={fuenteConocida ? null : criterios.fuente}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="catalogo-temporada">Temporada</Label>
          <Input id="catalogo-temporada" name="temporada" maxLength={9} defaultValue={criterios.temporada}
            placeholder="2026 o 2025-2026" aria-describedby="catalogo-temporada-ayuda" className="min-h-11 bg-secondary" />
          <p id="catalogo-temporada-ayuda" className="text-xs text-muted-foreground">FIE: año. RFEE: temporada doble.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4 sm:col-span-2 lg:col-span-4">
          <Button type="submit" className="min-h-11"><Search aria-hidden className="size-4" />Buscar ediciones</Button>
          {filtrado ? <Button asChild variant="outline" className="min-h-11"><Link href={RUTA_EDICIONES} prefetch={false}>Quitar filtros</Link></Button> : null}
        </div>
      </form>
      {vista.estado === 'ok' ? (
        <>
          <div role="status" className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-xl border bg-card p-4">
                <dt className="text-sm text-muted-foreground">Ediciones{filtrado ? ' encontradas' : ' importadas'}</dt>
                <dd className="cifra mt-2 break-words text-3xl leading-none sm:text-4xl">{vista.total.toLocaleString('es-ES')}</dd>
              </div>
              <div className="min-w-0 rounded-xl border bg-card p-4">
                <dt className="text-sm text-muted-foreground">Pruebas catalogadas</dt>
                <dd className="cifra mt-2 break-words text-3xl leading-none sm:text-4xl">{vista.pruebas.toLocaleString('es-ES')}</dd>
              </div>
            </dl>
            <p className="medida text-sm text-muted-foreground">Tener una prueba catalogada no significa que su clasificación esté completa.</p>
          </div>
          {vista.ediciones.length ? (
            <ul aria-label="Catálogo de ediciones" className="divide-y overflow-hidden rounded-xl border bg-card">
              {vista.ediciones.map((e) => <FilaEdicion key={e.id} e={e} catalogo={urlCatalogo(criterios, cursor)} />)}
            </ul>
          ) : (
            <div role="status" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
              <SearchX aria-hidden className="size-6 text-muted-foreground" />
              <p className="text-sm">{cursor ? 'No quedan ediciones en esta página. Vuelve al inicio de la búsqueda.' : 'No hay ediciones importadas que coincidan con estos filtros.'}</p>
              {filtrado ? <p className="text-sm text-muted-foreground">Prueba con un nombre más corto o quita los filtros.</p> : null}
            </div>
          )}
          <nav aria-label="Páginas del catálogo" className="flex flex-wrap items-center gap-3">
            {cursor ? <Button asChild variant="outline" className="min-h-11"><Link href={urlCatalogo(criterios)} prefetch={false} scroll={false}>Inicio de la búsqueda</Link></Button> : null}
            {vista.siguiente ? <Button asChild variant="outline" className="min-h-11"><Link href={urlCatalogo(criterios, vista.siguiente)} prefetch={false} scroll={false}>Siguientes ediciones<ArrowRight aria-hidden className="size-4" /></Link></Button> : null}
          </nav>
        </>
      ) : (
        <div role="alert" className="rounded-md border bg-card p-4 text-sm">
          {vista.estado === 'entrada_invalida' ? 'Revisa el nombre, la fuente y la temporada de búsqueda.'
            : vista.estado === 'cursor_invalido' ? 'El enlace de página no corresponde a esta búsqueda. Vuelve a buscar.'
              : vista.estado === 'no_disponible' ? 'El catálogo aún no está preparado en esta instalación.'
                : 'No se ha podido leer el catálogo. No significa que no haya ediciones.'}
        </div>
      )}
    </section>
  );
}
