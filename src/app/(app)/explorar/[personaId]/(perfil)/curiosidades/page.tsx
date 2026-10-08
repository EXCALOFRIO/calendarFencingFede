import { redirect } from 'next/navigation';
import { rutaCuriosidades } from '@/lib/sport/explorar/perfil-secciones';
import { exigirSesion, personaDeSegmento } from '../datos';

export const dynamic = 'force-dynamic';

/**
 * Curiosidades ya no es una sección: vive al final de Estadísticas. Los
 * enlaces antiguos llegan allí, al bloque, sin apilar una entrada en el
 * historial (`redirect` sustituye fuera de una acción de servidor).
 */
export default async function Pagina({ params }: { params: Promise<{ personaId: string }> }) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return null;
  redirect(rutaCuriosidades(personaId));
}
