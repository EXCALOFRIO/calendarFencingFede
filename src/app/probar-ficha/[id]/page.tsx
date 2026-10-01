import { notFound } from 'next/navigation';
import { FichaEvento } from '@/components/calendario/ficha-evento';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { inscritosPublicados, listEvents } from '@/lib/queries/calendar';
import { CIRCUIT_LABEL, organismoDe, titularTorneo } from '@/lib/utils';

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
 * En producción devuelve 404. No es una pantalla de la aplicación.
 */
export const dynamic = 'force-dynamic';

export default async function BancoDePruebasFicha({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  const { id } = await params;
  const [evento] = await listEvents({ ids: [id], includePast: true, limit: 1 });
  if (!evento) notFound();

  const oficiales = await inscritosPublicados(id);
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);

  return (
    <Sheet open>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="gap-2 px-4 pt-4 pb-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{organismo}</Badge>
            <Badge variant="outline">
              {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
            </Badge>
          </div>
          <SheetTitle className="text-3xl leading-[0.95] sm:text-4xl">
            {titularTorneo(evento.name)}
          </SheetTitle>
        </SheetHeader>

        <FichaEvento
          evento={evento}
          tirador={null}
          inscritos={{ oficiales, estados: {}, pendientes: [] }}
        />
      </SheetContent>
    </Sheet>
  );
}
