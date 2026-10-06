import { notFound, redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/auth/session';
import { CabeceraFicha } from '@/components/calendario/cabecera-ficha';
import { FichaEvento } from '@/components/calendario/ficha-evento';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { listEvents } from '@/lib/queries/calendar';
import { inscritosPublicados } from '@/lib/queries/inscritos-union';

/**
 * BANCO DE PRUEBAS DE LA FICHA. Solo en desarrollo.
 *
 * Existe porque la ficha vive dentro de una hoja lateral que solo se abre
 * tocando una barra del calendario, y el calendario está siendo rediseñado por
 * otro agente: cada pocos minutos deja de compilar, y entonces no hay forma de
 * capturar la ficha ni de juzgarla. Un `200` no dice nada en este proyecto y
 * una captura del calendario roto, menos.
 *
 * Así que esto abre la hoja con el torneo que se le pida y nada más:
 *
 *   /probar-ficha/<id del evento>
 *
 * A propósito **no** se le pasa el evento con `getEvent`: se le pasa el mismo
 * objeto que le daría el calendario (`listEvents`, sin lo extraído), para que
 * la ficha tenga que ir a buscar los datos de los PDFs por su cuenta, que es
 * lo que hace en producción.
 *
 * En producción devuelve 404. No es una pantalla de la aplicación. En
 * desarrollo exige sesión: no hay atajo para los registros deportivos privados.
 */
export const dynamic = 'force-dynamic';

export default async function BancoDePruebasFicha({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  // La lista de inscritos es un registro deportivo privado: ni siquiera el
  // banco de pruebas la lee sin sesión, y la guarda va antes de cualquier consulta.
  if (!(await getSessionProfile())) redirect('/entrar');

  const { id } = await params;
  const [evento] = await listEvents({ ids: [id], includePast: true, limit: 1 });
  if (!evento) notFound();

  const oficiales = await inscritosPublicados(id);

  return (
    <Sheet open>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {/* La misma cabecera que abre el calendario, con su «Terminada». */}
        <CabeceraFicha evento={evento} />

        <FichaEvento
          evento={evento}
          tirador={null}
          inscritos={{ oficiales, estados: {}, pendientes: [] }}
        />
      </SheetContent>
    </Sheet>
  );
}
