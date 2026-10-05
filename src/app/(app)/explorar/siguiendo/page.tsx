import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CabeceraSiguiendo, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { getSessionProfile } from '@/lib/auth/session';
import { contextoReal } from '@/lib/sport/explorar/real';
import { cargarConteoSiguiendo, cargarSiguiendo } from '@/lib/sport/explorar/siguiendo-pantalla';
import { leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Siguiendo' };

/**
 * Feed «Siguiendo»: últimos resultados de las personas que sigue la cuenta.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección. La cuenta sale siempre de la sesión: de la
 * URL sólo se leen el cursor (ligado a la cuenta y al filtro) y el filtro de
 * medallas, así que ningún parámetro enseña el feed de otra cuenta.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const criterios = leerCriteriosSiguiendo(await searchParams);
  const ctx = contextoReal();
  const [vista, siguiendo] = await Promise.all([
    cargarSiguiendo(ctx, { cursor: criterios.cursor || undefined, soloMedallas: criterios.soloMedallas }),
    cargarConteoSiguiendo(ctx),
  ]);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return (
    <div className="flex min-w-0 flex-col gap-6">
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

      <CabeceraSiguiendo siguiendo={siguiendo} criterios={criterios} />

      {vista.tipo === 'ok' && !vista.sinResultados ? (
        <FeedSiguiendo items={vista.items} siguiente={vista.siguiente} criterios={criterios} />
      ) : (
        <EstadoSiguiendo vista={vista} criterios={criterios} siguiendo={siguiendo} />
      )}
    </div>
  );
}
