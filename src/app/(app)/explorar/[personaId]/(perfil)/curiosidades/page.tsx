import { CuerpoSeccion, SeccionCuriosidades } from '@/components/explorar/perfil/secciones-perfil';
import { cargarCuriosidadesCompartidas } from '@/lib/sport/explorar/perfil-cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';
import { exigirSesion, personaDeSegmento, tituloPerfil } from '../datos';

export const dynamic = 'force-dynamic';
export function generateMetadata({ params }: { params: Promise<{ personaId: string }> }) {
  return tituloPerfil(params, 'Curiosidades');
}

/** Sección Curiosidades: balance por fase y curiosidades de sus asaltos, en una sola lectura. */
export default async function Pagina({ params }: { params: Promise<{ personaId: string }> }) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return null;
  const stats = await cargarCuriosidadesCompartidas(contextoReal(), personaId);
  return (
    <CuerpoSeccion>
      <SeccionCuriosidades personaId={personaId} stats={stats} />
    </CuerpoSeccion>
  );
}
