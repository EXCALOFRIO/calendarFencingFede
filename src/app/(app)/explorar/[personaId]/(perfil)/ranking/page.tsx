import { CuerpoSeccion, SeccionRanking } from '@/components/explorar/perfil/secciones-perfil';
import { cargarEuropeoCompartido } from '@/lib/sport/explorar/perfil-cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';
import { exigirSesion, extrasPerfil, personaDeSegmento } from '../datos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ranking · Ficha deportiva' };

/** Sección Ranking: Internacional, Europeo y Nacional con la misma lectura que la línea de la cabecera. */
export default async function Pagina({ params }: { params: Promise<{ personaId: string }> }) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return null;
  const [extras, europeo] = await Promise.all([extrasPerfil(personaId), cargarEuropeoCompartido(contextoReal(), personaId)]);
  return (
    <CuerpoSeccion>
      <SeccionRanking extras={extras} europeo={europeo} />
    </CuerpoSeccion>
  );
}
