import { redirect } from 'next/navigation';
import { EdicionCompleta, EstadoEdicion } from '@/components/explorar/ediciones';
import { getSessionProfile } from '@/lib/auth/session';
import { edicionDeRuta, leerCriteriosEdicion } from '@/lib/sport/explorar/edicion-url';
import { cargarEdicionCompartida } from '@/lib/sport/explorar/cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edición' };

/**
 * Una edición con un selector de sus pruebas y la clasificación, las poules y
 * las directas de la elegida (`prueba=`; sin ella, la primera con puestos).
 * `vista=` abre poules o directas y `persona=` resalta a esa persona en las
 * tres vistas. Cada nombre vinculado abre la ficha deportiva de esa persona
 * (nunca una cuenta) y la ficha vuelve aquí con la misma prueba, vista y
 * persona resaltada.
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección; nada se consulta antes de ella.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ edicionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [{ edicionId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const edicionId = edicionDeRuta(segmento);
  const criterios = leerCriteriosEdicion(consulta);

  const vista = edicionId
    ? await cargarEdicionCompartida(contextoReal(), edicionId, criterios)
    : ({ tipo: 'entrada_invalida' } as const);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return vista.tipo === 'ok' ? (
    <EdicionCompleta edicion={vista.edicion} criterios={criterios} conjunta={vista.conjunta ?? null} />
  ) : (
    <EstadoEdicion vista={vista} />
  );
}
