import { CuerpoSeccion, rendimientoUtil, SeccionEstadisticas } from '@/components/explorar/perfil/secciones-perfil';
import { cargarRendimientoCompartido } from '@/lib/sport/explorar/perfil-cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';
import { exigirSesion, fichaPerfil, personaDeSegmento } from '../datos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Estadísticas · Ficha deportiva' };

/**
 * Sección Estadísticas: sólo lee el rendimiento. La tarjeta de cifras ya la
 * tiene el layout; la ficha sólo se relee si el rendimiento no se pudo leer.
 */
export default async function Pagina({ params }: { params: Promise<{ personaId: string }> }) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return null;
  const rendimiento = await cargarRendimientoCompartido(contextoReal(), personaId);
  const vista = rendimientoUtil(rendimiento) ? null : await fichaPerfil(personaId);
  return (
    <CuerpoSeccion>
      <SeccionEstadisticas rendimiento={rendimiento} ficha={vista?.tipo === 'ok' ? vista.ficha : null} />
    </CuerpoSeccion>
  );
}
