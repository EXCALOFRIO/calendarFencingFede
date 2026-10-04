import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstadoSeries, ListaSeries } from '@/components/explorar/ediciones';
import { CatalogoEdiciones } from '@/components/explorar/catalogo-ediciones';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarCatalogoEdiciones } from '@/lib/sport/explorar/catalogo';
import { leerCriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import { cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ediciones y series' };

/**
 * Catálogo paginado de todas las ediciones importadas y series especiales.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. Sólo lee lo ya indexado en D1: no llama a
 * ninguna fuente externa, no inventa ediciones ni pruebas y no incluye datos de
 * cuenta ni ranking interno.
 */
export default async function Pagina({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const { criterios, cursor } = leerCriteriosCatalogo(await searchParams);
  const entrada = Object.fromEntries(Object.entries(criterios).filter(([, valor]) => valor));
  const ctx = contextoReal();
  const [vista, catalogo] = await Promise.all([
    cargarSeries(ctx),
    cargarCatalogoEdiciones(ctx, { ...entrada, ...(cursor ? { cursor } : {}) }),
  ]);
  if (vista.tipo === 'sin_sesion' || catalogo.estado === 'sin_sesion') redirect('/entrar');

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Volver">
        <Link
          href={RUTA_EXPLORAR}
          prefetch={false}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver a Explorar
        </Link>
      </nav>

      <header className="flex min-w-0 flex-col gap-2 border-b pb-4">
        <h1 className="text-3xl leading-tight sm:text-4xl">Ediciones y series</h1>
        <p className="medida text-sm text-muted-foreground">
          Consulta las pruebas y clasificaciones publicadas de cada edición.
        </p>
      </header>

      <CatalogoEdiciones vista={catalogo} criterios={criterios} cursor={cursor} />
      <section aria-label="Series especiales" className="flex flex-col gap-4 border-t pt-6">
        <h2 className="text-2xl">Series especiales</h2>
        {vista.tipo === 'ok' ? <ListaSeries series={vista.series} /> : <EstadoSeries vista={vista} />}
      </section>
    </div>
  );
}
