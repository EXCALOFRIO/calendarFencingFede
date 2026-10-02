import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstadoFicha, FichaCompleta } from '@/components/explorar/ficha-deportiva';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { leerCriteriosFicha, personaDeRuta } from '@/lib/sport/explorar/ficha-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ficha deportiva' };

/**
 * Ficha deportiva de una persona indexada, abierta siempre por su
 * identificador: dos homónimos nunca comparten ficha.
 *
 * La guarda de sesión va aquí además de en el layout, porque un layout no se
 * vuelve a ejecutar al navegar entre páginas hermanas y esta ruta se puede
 * abrir escribiendo la dirección. La ficha no lee ni envía datos de cuenta
 * (correo, tutor, consentimiento, licencias) de ninguna persona, tenga cuenta
 * o no. Nada aquí llama a una fuente externa.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ personaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [{ personaId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const personaId = personaDeRuta(segmento);
  const criterios = leerCriteriosFicha(consulta);

  const vista = personaId
    ? await cargarFichaPantalla(contextoReal(), personaId, criterios)
    : ({ tipo: 'entrada_invalida' } as const);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Volver">
        <Link
          href={RUTA_EXPLORAR}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver a Explorar
        </Link>
      </nav>

      {vista.tipo === 'ok' && personaId ? (
        <FichaCompleta
          ficha={vista.ficha}
          historial={vista.historial}
          base={`${RUTA_EXPLORAR}/${personaId}`}
          criterios={criterios}
          nivel="pagina"
        />
      ) : vista.tipo === 'ok' ? null : (
        <>
          <h1 className="text-2xl sm:text-3xl">Ficha deportiva</h1>
          <EstadoFicha vista={vista} />
        </>
      )}
    </div>
  );
}
