import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstadoSeries, ListaSeries } from '@/components/explorar/ediciones';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ediciones y series' };

/**
 * Entrada a las ediciones de los Juegos Olímpicos, los Juegos Mediterráneos y
 * el Campeonato del Mediterráneo, tal y como las publican las fuentes.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. Sólo lee lo ya indexado en Neon: no llama a
 * ninguna fuente externa, no inventa ediciones ni pruebas y no incluye datos de
 * cuenta ni ranking interno.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const vista = await cargarSeries(contextoReal());
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

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

      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Ediciones y series</h1>
        <p className="text-sm text-muted-foreground">
          Juegos Olímpicos, Juegos Mediterráneos y Campeonato del Mediterráneo, con las pruebas que cada
          fuente publicó.
        </p>
      </header>

      {vista.tipo === 'ok' ? <ListaSeries series={vista.series} /> : <EstadoSeries vista={vista} />}
    </div>
  );
}
