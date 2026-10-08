import { CuerpoSeccion, rendimientoUtil, SeccionEstadisticas } from '@/components/explorar/perfil/secciones-perfil';
import { cargarCuriosidadesCompartidas, cargarRendimientoCompartido } from '@/lib/sport/explorar/perfil-cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';
import { exigirSesion, fichaPerfil, personaDeSegmento, tituloPerfil } from '../datos';

export const dynamic = 'force-dynamic';
export function generateMetadata({ params }: { params: Promise<{ personaId: string }> }) {
  return tituloPerfil(params, 'Estadísticas');
}

/**
 * Sección Estadísticas: el rendimiento y, al final, las curiosidades de sus
 * asaltos (antes una sección aparte). Las dos lecturas van a la vez. La
 * tarjeta de cifras ya la tiene el layout; la ficha sólo se relee si el
 * rendimiento no se pudo leer.
 */
export default async function Pagina({ params }: { params: Promise<{ personaId: string }> }) {
  await exigirSesion();
  const personaId = personaDeSegmento((await params).personaId);
  if (!personaId) return null;
  const ctx = contextoReal();
  const [rendimiento, curiosidades] = await Promise.all([
    cargarRendimientoCompartido(ctx, personaId),
    cargarCuriosidadesCompartidas(ctx, personaId),
  ]);
  const vista = rendimientoUtil(rendimiento) ? null : await fichaPerfil(personaId);
  return (
    <CuerpoSeccion>
      <SeccionEstadisticas
        rendimiento={rendimiento}
        ficha={vista?.tipo === 'ok' ? vista.ficha : null}
        personaId={personaId}
        curiosidades={curiosidades}
      />
    </CuerpoSeccion>
  );
}
