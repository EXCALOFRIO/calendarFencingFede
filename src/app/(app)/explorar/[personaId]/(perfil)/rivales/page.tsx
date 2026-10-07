import { CuerpoSeccion, SeccionRivales } from '@/components/explorar/perfil/secciones-perfil';
import { cargarRivalesCompartidos } from '@/lib/sport/explorar/perfil-cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';
import { exigirSesion, personaDeSegmento } from '../datos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rivales · Ficha deportiva' };

/** Sección Rivales: comparador, más enfrentados, sugeridos y relevos; no relee la ficha. */
export default async function Pagina({ params }: { params: Promise<{ personaId: string }> }) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return null;
  const { datos, relevos } = await cargarRivalesCompartidos(contextoReal(), personaId);
  return (
    <CuerpoSeccion>
      <SeccionRivales personaId={personaId} datos={datos} relevos={relevos} />
    </CuerpoSeccion>
  );
}
