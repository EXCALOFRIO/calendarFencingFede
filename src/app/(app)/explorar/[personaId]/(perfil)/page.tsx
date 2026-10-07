import { CuerpoSeccion, SeccionResultados } from '@/components/explorar/perfil/secciones-perfil';
import { cargarFichaPantalla } from '@/lib/sport/explorar/ficha-pantalla';
import { leerCriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { exigirSesion, fichaPerfil, personaDeSegmento, tituloPerfil } from './datos';

export const dynamic = 'force-dynamic';
export function generateMetadata({ params }: { params: Promise<{ personaId: string }> }) {
  return tituloPerfil(params, null);
}

/**
 * Sección Resultados del perfil (la raíz de la ficha). La ficha la comparte
 * con la cabecera en la misma petición; sólo una página anterior del
 * historial paginado (con `cursor`) hace su propia lectura.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ personaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirSesion();
  const [{ personaId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const personaId = personaDeSegmento(segmento);
  if (!personaId) return null;
  const criterios = leerCriteriosFicha(consulta);
  const vista = criterios.cursor
    ? await cargarFichaPantalla(contextoReal(), personaId, criterios, { diferirRivales: true })
    : await fichaPerfil(personaId);
  // Los estados de error ya los pinta el layout.
  if (vista.tipo !== 'ok') return null;
  return (
    <CuerpoSeccion>
      <SeccionResultados ficha={vista.ficha} historial={vista.historial} base={`${RUTA_EXPLORAR}/${personaId}`} criterios={criterios} />
    </CuerpoSeccion>
  );
}
